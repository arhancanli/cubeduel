import { DEFAULT_EVENT } from "@/lib/events";
import { UNRATED, WINDOW_SIZE, isEstablished, msForRating } from "@/lib/rating";
import { listChallenges } from "@/lib/server/challenges";
import { duelRecord } from "@/lib/server/duels";
import { ensureProfile } from "@/lib/server/profiles";
import { currentRating, pendingResultCount } from "@/lib/server/ranked";
import { bestRun } from "@/lib/server/rush";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Everything the signed-in front page shows, in one round trip.
 *
 * The front page is static so that a visitor sees it instantly; a player who
 * is signed in asks for this after it paints. Each part is read independently
 * and a part that fails comes back null rather than failing the whole answer —
 * a duel record that could not be read is no reason to hide the rating.
 *
 * Never cached: it is one person's standing, and it changes with every solve.
 */
export const dynamic = "force-dynamic";

async function settle<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!isDatabaseConfigured()) return Response.json({ signedIn: false });
  const profile = await ensureProfile().catch(() => null);
  if (!profile) return Response.json({ signedIn: false });

  const event = DEFAULT_EVENT;
  const [rating, pending, duels, challenges, rush] = await Promise.all([
    settle(currentRating(profile.id, event, "keyboard")),
    settle(pendingResultCount(profile.id, event, "keyboard")),
    settle(duelRecord(profile.id)),
    settle(listChallenges(profile.id)),
    settle(bestRun(profile.id, event)),
  ]);

  const state = rating ?? UNRATED;
  return Response.json(
    {
      signedIn: true,
      handle: profile.handle,
      ranked: rating
        ? {
            rating: state.rating === null ? null : Math.round(state.rating),
            deviation: Math.round(state.deviation),
            established: isEstablished(state),
            peak: state.peak === null ? null : Math.round(state.peak),
            // The rating read back as the average that earned it.
            averageMs: state.rating === null ? null : Math.round(msForRating(state.rating, event)),
            pending: pending ?? 0,
            windowSize: WINDOW_SIZE,
          }
        : null,
      duels: duels ? { wins: duels.wins, losses: duels.losses } : null,
      challengesAwaiting: challenges ? challenges.filter((c) => c.awaitingYou).length : null,
      rushBest: rush ? rush.score : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
