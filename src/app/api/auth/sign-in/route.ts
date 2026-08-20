import { normaliseEmail } from "@/lib/auth/email";
import {
  SIGN_IN_REFUSAL,
  callerIp,
  callerUserAgent,
  jsonError,
  readJson,
  recordAttempt,
  tooManyAttempts,
} from "@/lib/server/authRoutes";
import { setSessionCookie } from "@/lib/server/currentUser";
import { createSession } from "@/lib/server/sessions";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { checkCredentials } from "@/lib/server/users";

/**
 * Signing in with an address and a password.
 *
 * Every refusal returns the same message with the same status. A wrong
 * password, an unknown address and an account that only has a passkey are
 * indistinguishable from outside, because the alternative answers "does this
 * person have an account here?" to anybody who asks.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return jsonError("Signing in is not available right now.", 503);
  }

  const body = await readJson<{ email?: unknown; password?: unknown }>(request);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return jsonError("Malformed request.", 400);
  }

  const email = normaliseEmail(body.email);
  const ip = await callerIp();

  if (await tooManyAttempts(email, ip)) {
    return jsonError("Too many attempts. Wait a few minutes.", 429);
  }

  const user = await checkCredentials(email, body.password);

  // Recorded either way. Counting only failures leaves the attack that works at
  // scale — one common password across many accounts — invisible.
  await recordAttempt(email, ip, Boolean(user));

  if (!user) return jsonError(SIGN_IN_REFUSAL, 401);

  const session = await createSession(user.id, {
    userAgent: await callerUserAgent(),
    ip,
  });
  if (!session) return jsonError("Could not start a session. Try again.", 500);

  await setSessionCookie(session.token);
  return Response.json({ ok: true });
}
