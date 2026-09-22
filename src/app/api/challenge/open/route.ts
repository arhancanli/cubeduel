import { currentProfile } from "@/lib/server/profiles";
import { listOpenChallenges } from "@/lib/server/challenges";

/**
 * The open board: challenges nobody has taken yet.
 *
 * Readable signed out, because it is the page's argument. Somebody who arrives
 * knowing nobody here should be able to see that there is a game waiting before
 * being asked to make an account — the sign-in comes when they take one.
 *
 * Your own offers are left out by the server, not here: the one thing you cannot
 * do with your own challenge is take it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await currentProfile().catch(() => null);

  try {
    return Response.json({ open: await listOpenChallenges(profile?.id ?? null) });
  } catch {
    // Never an empty board on failure: "nobody has left a challenge" and "the
    // database is down" look identical, and only one of them is worth waiting
    // out.
    return Response.json({ error: "Could not load the open challenges." }, { status: 500 });
  }
}
