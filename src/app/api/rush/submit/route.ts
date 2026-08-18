import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { submitRushSolve, type RushSubmitInput } from "@/lib/server/rush";

/**
 * Records one solve in a run and issues the next scramble.
 *
 * The response carries the state the *server* computed by replaying the run's
 * stored solves — never the client's running total. The browser keeps its own
 * for feel, and where they disagree this one is the record.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = await readJson<Omit<RushSubmitInput, "profileId">>(request);
  if (!body || typeof body.runId !== "string" || !Array.isArray(body.moves)) {
    return jsonError("Malformed submission.", 400);
  }

  try {
    const result = await submitRushSolve({ ...body, profileId: auth.profile.id });
    return Response.json(result);
  } catch {
    return jsonError("Could not record that solve.", 500);
  }
}
