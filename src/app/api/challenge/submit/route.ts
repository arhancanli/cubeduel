import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { submitSide, type SubmitInput } from "@/lib/server/challenges";

/**
 * Records this player's solve and settles the challenge if that completed it.
 *
 * The solve is replayed against the scramble the server stored, exactly as a
 * ranked one is. A win over a real person is worth less than nothing if the
 * solve behind it was never checked.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = await readJson<Omit<SubmitInput, "profileId">>(request);
  if (!body || typeof body.challengeId !== "string" || !Array.isArray(body.moves)) {
    return jsonError("Malformed submission.", 400);
  }

  const result = await submitSide({ ...body, profileId: auth.profile.id });
  if (!result.accepted) return Response.json(result, { status: 200 });

  return Response.json(result);
}
