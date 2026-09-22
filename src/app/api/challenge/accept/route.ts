import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { acceptChallenge } from "@/lib/server/challenges";

/**
 * Takes the second seat of an open challenge.
 *
 * The response carries no scramble, exactly as creating one does not: accepting
 * gets you the seat, and opening your attempt is what gets you the cube. Between
 * those two moments the scramble is still nobody's.
 *
 * A refusal is a 409 rather than a 400 when somebody simply got there first —
 * the request was fine, the world moved.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = (await readJson<{ id?: unknown }>(request)) ?? {};
  if (typeof body.id !== "string") return jsonError("Which challenge?", 400);

  const result = await acceptChallenge(auth.profile.id, body.id);
  if (!result.ok) {
    return jsonError(result.reason, result.refusal === "already taken" ? 409 : 400);
  }

  return Response.json(result);
}
