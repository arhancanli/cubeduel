import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { createChallenge } from "@/lib/server/challenges";

/**
 * Challenges another player by handle.
 *
 * The response deliberately does not include the scramble. The challenger chose
 * an opponent, not a scramble — handing it over here would let them study it and
 * then pick their moment, which is the whole thing the feature is built to avoid.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = (await readJson<{ handle?: unknown }>(request)) ?? {};
  if (typeof body.handle !== "string" || body.handle.length > 40) {
    return jsonError("Pick somebody to challenge.", 400);
  }

  const result = await createChallenge(auth.profile.id, body.handle.trim());
  if (!result.ok) return jsonError(result.reason, 400);

  return Response.json(result);
}
