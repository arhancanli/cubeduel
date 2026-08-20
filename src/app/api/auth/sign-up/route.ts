import { after } from "next/server";

import { normaliseEmail } from "@/lib/auth/email";
import {
  callerIp,
  callerUserAgent,
  jsonError,
  readJson,
  tooManyAttempts,
} from "@/lib/server/authRoutes";
import { startEmailVerification } from "@/lib/server/emailTokens";
import { setSessionCookie } from "@/lib/server/currentUser";
import { createSession } from "@/lib/server/sessions";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { createUser } from "@/lib/server/users";

/**
 * Making an account.
 *
 * A password is optional. Somebody arriving through the claim screen adds a
 * passkey immediately afterwards and never chooses one — which is the intended
 * path, and the reason `users.password_hash` is nullable.
 *
 * The account is signed in straight away rather than after confirming the
 * address. Making somebody visit their inbox before they can keep the solves
 * they just did is the same wall the product refuses everywhere else; what
 * verification gates is *recovery*, not use.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return jsonError("Accounts are not available right now.", 503);
  }

  const body = await readJson<{ email?: unknown; password?: unknown }>(request);
  if (!body || typeof body.email !== "string") {
    return jsonError("Malformed request.", 400);
  }
  if (body.password !== undefined && typeof body.password !== "string") {
    return jsonError("Malformed request.", 400);
  }

  const email = normaliseEmail(body.email);
  const ip = await callerIp();

  // Sign-up is the one endpoint that admits an address is taken, so it is also
  // the one worth grinding to enumerate. The same counter that limits sign-in
  // limits this.
  if (await tooManyAttempts(email, ip)) {
    return jsonError("Too many attempts. Wait a few minutes.", 429);
  }

  const created = await createUser({ email, password: body.password });
  if (!created.ok) return jsonError(created.error, 400);

  const session = await createSession(created.user.id, {
    userAgent: await callerUserAgent(),
    ip,
  });
  if (!session) return jsonError("Could not start a session. Try again.", 500);

  await setSessionCookie(session.token);

  // Deferred until the response has been sent. The work is a token insert and
  // an HTTP call to a mail provider, and none of it should sit between somebody
  // and the page they are waiting for.
  after(async () => {
    await startEmailVerification(created.user);
  });

  return Response.json({
    ok: true,
    created: created.created,
    email: created.user.email,
  });
}
