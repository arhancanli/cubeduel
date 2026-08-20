import { after } from "next/server";

import { normaliseEmail } from "@/lib/auth/email";
import { callerIp, jsonError, readJson, tooManyAttempts } from "@/lib/server/authRoutes";
import { startPasswordReset } from "@/lib/server/emailTokens";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Asking for a reset link.
 *
 * Always answers the same thing, and the work happens in `after()` — that is
 * the whole design. `startPasswordReset` does a lookup, a rate check, an insert
 * and an HTTP call for an address that has an account, and a lookup alone for
 * one that does not. Awaiting that inside the request makes the two paths
 * measurably different lengths, which hands back precisely the answer the
 * identical message exists to withhold.
 *
 * Deferring until the response is sent removes the difference rather than
 * trying to balance it.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return jsonError("Password reset is not available right now.", 503);
  }

  const body = await readJson<{ email?: unknown }>(request);
  if (!body || typeof body.email !== "string") return jsonError("Malformed request.", 400);

  const email = normaliseEmail(body.email);
  const ip = await callerIp();

  // Rate limited by origin only. Limiting by address would mean answering
  // "has this address been asked about recently", which is the leak again.
  if (await tooManyAttempts(null, ip)) {
    return jsonError("Too many attempts. Wait a few minutes.", 429);
  }

  after(async () => {
    await startPasswordReset(email);
  });

  // Deliberately not "we sent you an email". We do not know that, and for an
  // address with no account it is false.
  return Response.json({ ok: true });
}
