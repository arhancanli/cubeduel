import { jsonError, readJson } from "@/lib/server/authRoutes";
import { createClub } from "@/lib/server/clubs";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Creating a club.
 *
 * Needs a profile rather than merely a session, because the creator is
 * immediately its owner and ownership hangs off a profile. `ensureProfile`
 * creates one on first sight, so nobody is stopped here for not having visited
 * a page that would have made one.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Clubs are not available right now.", 503);

  const profile = await ensureProfile();
  if (!profile) return jsonError("Sign in to start a club.", 401);

  const body = await readJson<{ name?: unknown; slug?: unknown; bio?: unknown }>(request);
  if (!body || typeof body.name !== "string" || typeof body.slug !== "string") {
    return jsonError("Malformed request.", 400);
  }

  const result = await createClub(profile.id, {
    name: body.name,
    slug: body.slug,
    bio: typeof body.bio === "string" ? body.bio : undefined,
  });

  if (!result.ok) return jsonError(result.error, 400);
  return Response.json({ ok: true, slug: result.value.slug });
}
