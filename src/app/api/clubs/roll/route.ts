import { jsonError, readJson } from "@/lib/server/authRoutes";
import { rollJoinCode } from "@/lib/server/clubs";
import { currentProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Issuing a new invite code.
 *
 * An invite code is meant to be pasted into a group chat, so it will eventually
 * end up somewhere its owner did not intend. Being able to replace it is what
 * makes sharing it freely a reasonable thing to do.
 *
 * Owner-only, enforced in `rollJoinCode` rather than here.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Clubs are not available right now.", 503);

  const profile = await currentProfile();
  if (!profile) return jsonError("Sign in first.", 401);

  const body = await readJson<{ clubId?: unknown }>(request);
  if (!body || typeof body.clubId !== "string") return jsonError("Malformed request.", 400);

  const result = await rollJoinCode(body.clubId, profile.id);
  if (!result.ok) return jsonError(result.error, 400);
  return Response.json({ ok: true, code: result.value });
}
