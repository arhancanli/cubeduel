import { DEFAULT_EVENT, isEventId } from "@/lib/events";
import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { startRun } from "@/lib/server/rush";

/**
 * Opens a Rush run and hands out the first scramble.
 *
 * Starting a run closes any the player left open. Holding several and reporting
 * only the best is the same highlight-reel problem the ranked reroll rule exists
 * to stop.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = (await readJson<{ event?: unknown }>(request)) ?? {};
  if (body.event !== undefined && !isEventId(body.event)) {
    return jsonError("Unknown event.", 400);
  }

  try {
    return Response.json(await startRun(auth.profile.id, body.event ?? DEFAULT_EVENT, "keyboard"));
  } catch {
    return jsonError("Could not start a run.", 500);
  }
}
