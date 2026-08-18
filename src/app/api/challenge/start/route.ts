import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { startSide } from "@/lib/server/challenges";

/**
 * Opens this player's half and releases the scramble to them.
 *
 * This is the moment inspection starts, and the stamp it writes is never moved.
 * Closing the tab and coming back does not buy a fresh fifteen seconds.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = (await readJson<{ challengeId?: unknown }>(request)) ?? {};
  if (typeof body.challengeId !== "string") {
    return jsonError("Which challenge?", 400);
  }

  const result = await startSide(auth.profile.id, body.challengeId);
  if (!result.ok) return jsonError(result.reason, 400);

  return Response.json(result);
}
