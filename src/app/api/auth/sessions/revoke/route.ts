import { jsonError, readJson } from "@/lib/server/authRoutes";
import { currentSession } from "@/lib/server/currentUser";
import { revokeSessionById } from "@/lib/server/sessions";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Signing out one device from the list in settings.
 *
 * This exists because `revokeSessionById` did not: it was written, documented
 * as "what the device list's sign out acts on", and never called by anything.
 * The settings page showed somebody every session on their account and gave
 * them no way to end one — which is the state you are in precisely when you
 * most need to, having just spotted a device you do not recognise.
 *
 * The scoping to the owner lives in `revokeSessionById`, so a guessed id from
 * another account ends nothing.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Not available right now.", 503);

  const session = await currentSession();
  if (!session) return jsonError("Sign in first.", 401);

  const body = await readJson<{ sessionId?: unknown }>(request);
  if (!body || typeof body.sessionId !== "string") return jsonError("Malformed request.", 400);

  const revoked = await revokeSessionById(session.user.id, body.sessionId);
  if (!revoked) return jsonError("That session is already gone.", 400);

  return Response.json({ ok: true });
}
