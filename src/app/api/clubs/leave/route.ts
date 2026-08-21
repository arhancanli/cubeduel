import { jsonError, readJson } from "@/lib/server/authRoutes";
import { leaveClub } from "@/lib/server/clubs";
import { currentProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Leaving a club.
 *
 * The last owner is refused, for the same reason the last passkey cannot be
 * removed: it produces a state nobody can recover from without database access.
 * The refusal lives in `leaveClub`; this only carries it back.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Clubs are not available right now.", 503);

  const profile = await currentProfile();
  if (!profile) return jsonError("Sign in first.", 401);

  const body = await readJson<{ clubId?: unknown }>(request);
  if (!body || typeof body.clubId !== "string") return jsonError("Malformed request.", 400);

  const result = await leaveClub(profile.id, body.clubId);
  if (!result.ok) return jsonError(result.error, 400);
  return Response.json({ ok: true });
}
