import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { startDuel } from "@/lib/server/duels";

/**
 * Starts a race against a bot.
 *
 * The response includes the opponent's full trajectory, deliberately. It was
 * committed to the database before this request returned, so handing it over
 * costs nothing and buys everything: the opponent's progress renders locally
 * from a real move stream, with no polling and no realtime channel.
 */
export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = (await readJson<{ botId?: unknown }>(request)) ?? {};
  if (typeof body.botId !== "string" || body.botId.length > 40) {
    return jsonError("Pick an opponent.", 400);
  }

  try {
    return Response.json(await startDuel(auth.profile.id, body.botId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the duel.";
    return jsonError(message, message === "Unknown opponent." ? 400 : 500);
  }
}
