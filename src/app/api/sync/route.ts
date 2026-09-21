import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { storePracticeSolves } from "@/lib/server/practiceSync";

/**
 * Uploads locally-recorded solves so history follows a player between devices.
 * What is kept, and why none of it can reach the ladder, is in
 * `src/lib/server/practiceSync.ts`.
 */

/**
 * The client sends 100 at a time. The cap is higher so an older client sending
 * larger batches still syncs. The analysis each request may ask for is bounded
 * separately, in moves, by `storePracticeSolves` — a count of solves says
 * nothing about how long their streams are.
 */
const MAX_BATCH = 250;

export async function POST(request: Request) {
  const auth = await requireProfile("sync");
  if (!auth.ok) return auth.response;

  const body = await readJson<{ solves?: unknown }>(request);
  if (!body || !Array.isArray(body.solves)) {
    return jsonError("Malformed request.", 400);
  }
  if (body.solves.length > MAX_BATCH) {
    return jsonError(`Send at most ${MAX_BATCH} solves at a time.`, 413);
  }

  try {
    return Response.json(await storePracticeSolves(auth.profile.id, body.solves));
  } catch {
    return jsonError("Could not save those solves.", 500);
  }
}
