import { requireProfile } from "@/lib/server/apiAuth";
import { listChallenges } from "@/lib/server/challenges";

/**
 * Everything this player is involved in.
 *
 * Redaction happens in the server module, not here: each row is passed through
 * `visibleTo` before it is shaped for the wire, so a scramble the viewer has not
 * opened and an opponent's time on an unsettled challenge never reach this file
 * at all. A rule enforced at the last moment before serialisation is a rule one
 * refactor away from being skipped.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  try {
    return Response.json({ challenges: await listChallenges(auth.profile.id) });
  } catch {
    // An outage that renders as "you have no challenges" is indistinguishable
    // from the truth, and nobody ever investigates it.
    return Response.json({ error: "Could not load your challenges." }, { status: 500 });
  }
}
