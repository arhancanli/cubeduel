import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { submitRace, type RaceSubmit } from "@/lib/server/races";

/**
 * A player's solve, replayed against the scramble the server generated before
 * it counts — exactly as a ranked or challenge solve is.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("race");
  if (!auth.ok) return auth.response;
  const body = await readJson<Omit<RaceSubmit, "profileId">>(request);
  if (
    !body ||
    typeof body.code !== "string" ||
    typeof body.clientId !== "string" ||
    !Array.isArray(body.moves) ||
    typeof body.durationMs !== "number" ||
    (body.source !== "keyboard" && body.source !== "smartcube") ||
    (body.penalty !== "OK" && body.penalty !== "PLUS2" && body.penalty !== "DNF")
  ) {
    return jsonError("Malformed submission.", 400);
  }
  const result = await submitRace({ ...body, profileId: auth.profile.id });
  return Response.json(result);
}
