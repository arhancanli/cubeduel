import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { setFollowing } from "@/lib/server/follows";

/**
 * Follow or unfollow a player: `{ handle, follow: true | false }`. Answers with
 * where things now stand, so the button shows the server's count rather than
 * one it guessed.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("follow");
  if (!auth.ok) return auth.response;

  const body = await readJson<{ handle?: unknown; follow?: unknown }>(request);
  if (!body || typeof body.handle !== "string" || body.handle.length > 40 || typeof body.follow !== "boolean") {
    return jsonError("Malformed request.", 400);
  }

  const result = await setFollowing(auth.profile.id, body.handle, body.follow);
  if (!result.ok) return jsonError(result.error, result.status);
  return Response.json({ following: result.following, followers: result.followers });
}
