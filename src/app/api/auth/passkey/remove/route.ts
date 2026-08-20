import { jsonError, readJson } from "@/lib/server/authRoutes";
import { currentSession } from "@/lib/server/currentUser";
import { removePasskey } from "@/lib/server/passkeys";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Removes a passkey.
 *
 * The lockout guard lives in `removePasskey`, not here: an account with one
 * passkey and no password that deletes the passkey is unreachable forever, and
 * the refusal is the feature. This route only carries the answer back.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Passkeys are not available right now.", 503);

  const session = await currentSession();
  if (!session) return jsonError("Sign in first.", 401);

  const body = await readJson<{ passkeyId?: unknown }>(request);
  if (!body || typeof body.passkeyId !== "string") return jsonError("Malformed request.", 400);

  // Scoped to the signed-in account inside `removePasskey`, which is what stops
  // a guessed id reaching somebody else's credential.
  const result = await removePasskey(session.user.id, body.passkeyId);
  if (!result.ok) return jsonError(result.error, 400);

  return Response.json({ ok: true });
}
