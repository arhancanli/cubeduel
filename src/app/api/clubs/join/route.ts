import { jsonError, readJson } from "@/lib/server/authRoutes";
import { joinByCode } from "@/lib/server/clubs";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Joining by invite code.
 *
 * The code is read leniently — pasted URLs, spaces, capitals and hyphens are
 * all the same code — because these get copied off a whiteboard and repeated
 * across a room, and refusing a near-miss teaches somebody the product is fussy
 * rather than that they mistyped.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Clubs are not available right now.", 503);

  const profile = await ensureProfile();
  if (!profile) return jsonError("Sign in to join a club.", 401);

  const body = await readJson<{ code?: unknown }>(request);
  if (!body || typeof body.code !== "string") return jsonError("Malformed request.", 400);

  const result = await joinByCode(profile.id, body.code);
  if (!result.ok) return jsonError(result.error, 400);

  return Response.json({ ok: true, slug: result.value.slug, name: result.value.name });
}
