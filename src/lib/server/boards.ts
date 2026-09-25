import "server-only";

import { ESTABLISHED_DEVIATION, type RatingPool } from "../rating";
import { weekKey, weekStart } from "../weekly";
import { db } from "./supabase";

/**
 * Leaderboards and the numbers on a profile.
 *
 * Read-only, and every query here runs on the server against the service-role
 * client. There is no public read path to the database at all, which means a
 * leaderboard row cannot be fetched, tampered with and re-rendered — what the
 * page shows is what the server computed.
 */

export interface BoardEntry {
  rank: number;
  handle: string;
  displayName: string;
  country: string | null;
  rating: number;
  deviation: number;
  solveCount: number;
}

/**
 * The global ladder.
 *
 * Only established ratings appear. A leaderboard that let a player top it after
 * five lucky solves would be worse than useless — the first thing anyone would
 * learn is that the ranking does not track skill. The deviation cut is what makes
 * a placing a claim rather than a coincidence, and the page says so in words.
 */
export async function ratingBoard(
  event: string,
  pool: RatingPool,
  limit = 100,
): Promise<BoardEntry[]> {
  const { data, error } = await db()
    .from("ratings")
    .select("rating, deviation, solve_count, profiles!inner(handle, display_name, country)")
    .eq("event", event)
    .eq("pool", pool)
    .lte("deviation", ESTABLISHED_DEVIATION)
    // A row can exist with a null rating: a player whose windows have all failed
    // has a deviation but no rating. They are not ranked, because there is
    // nothing to rank them by.
    .not("rating", "is", null)
    .order("rating", { ascending: false })
    .limit(limit);

  // Thrown rather than degraded to an empty list. "Nobody is ranked yet" and
  // "the database is unreachable" are opposite facts, and rendering the first
  // when the second is true is the most misleading thing this page could do —
  // it was doing exactly that against a project with no schema, and looked fine.
  if (error) {
    throw new Error(`Could not load the rating board: ${error.message}`);
  }
  if (!data) return [];

  return data.map((row, index) => {
    // The embedded profile arrives as an object for a to-one relationship, but
    // the generated types describe it loosely enough to be worth narrowing here
    // rather than trusting the shape.
    const profile = row.profiles as unknown as {
      handle: string;
      display_name: string;
      country: string | null;
    };
    return {
      rank: index + 1,
      handle: profile.handle,
      displayName: profile.display_name,
      country: profile.country,
      // The query excludes nulls; this keeps the narrowing explicit rather than
      // asserting it away.
      rating: row.rating ?? 0,
      deviation: row.deviation,
      solveCount: row.solve_count,
    };
  });
}

export interface DailyEntry {
  rank: number;
  handle: string;
  displayName: string;
  durationMs: number;
  penalty: string;
  verified: boolean;
}

/**
 * One shared scramble, everyone's time against it, for a single day.
 *
 * Unlike the rating board this needs no establishment threshold: it is a single
 * result on a single puzzle, and it claims nothing beyond that. DNFs sort last
 * because a DNF is worse than any finite time, exactly as the WCA ranks them.
 */
export async function dailyBoard(
  day: number,
  event = "333",
  limit = 100,
): Promise<DailyEntry[]> {
  const { data, error } = await db()
    .from("daily_results")
    .select("duration_ms, penalty, verified, profiles!inner(handle, display_name)")
    .eq("day", day)
    .eq("event", event)
    .order("penalty", { ascending: true })
    .order("duration_ms", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Could not load the daily board: ${error.message}`);
  }
  if (!data) return [];

  const rows = data.map((row) => {
    const profile = row.profiles as unknown as {
      handle: string;
      display_name: string;
    };
    return {
      handle: profile.handle,
      displayName: profile.display_name,
      durationMs: row.duration_ms,
      penalty: row.penalty,
      verified: row.verified,
    };
  });

  // Postgres cannot express "DNF sorts after every time" in one ORDER BY without
  // a CASE, and the ordering matters more than the round trip saved by trying.
  rows.sort((a, b) => {
    const aDnf = a.penalty === "DNF";
    const bDnf = b.penalty === "DNF";
    if (aDnf !== bDnf) return aDnf ? 1 : -1;
    const aMs = a.durationMs + (a.penalty === "PLUS2" ? 2000 : 0);
    const bMs = b.durationMs + (b.penalty === "PLUS2" ? 2000 : 0);
    return aMs - bMs;
  });

  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

export interface ProfileStats {
  rating: number | null;
  deviation: number;
  peak: number | null;
  established: boolean;
  rank: number | null;
  rankedSolves: number;
  bestSingleMs: number | null;
  /** Duel record. Kept apart from the rating, which duels deliberately do not move. */
  duelWins: number;
  duelLosses: number;
  recent: {
    /** So each row can link to the solve itself. */
    id: string;
    durationMs: number;
    penalty: string;
    scramble: string;
    moveCount: number;
    solvedAt: string;
    mode: string;
    /** Which puzzle: a 5x5 time in an unlabelled list reads as a very slow 3x3. */
    event: string;
  }[];
  history: { at: string; rating: number }[];
}

export async function profileStats(
  profileId: string,
  event = "333",
  pool: RatingPool = "keyboard",
): Promise<ProfileStats> {
  const [ratingRow, best, recent, history, duels] = await Promise.all([
    db()
      .from("ratings")
      .select("*")
      .eq("profile_id", profileId)
      .eq("event", event)
      .eq("pool", pool)
      .maybeSingle(),
    db()
      .from("solves")
      .select("duration_ms")
      .eq("profile_id", profileId)
      .eq("event", event)
      .eq("verified", true)
      .neq("penalty", "DNF")
      .order("duration_ms", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db()
      .from("solves")
      .select("id, event, duration_ms, penalty, scramble, move_count, solved_at, mode")
      .eq("profile_id", profileId)
      // This week's competition solves carry scrambles others have yet to
      // solve; they appear here once the week closes.
      .or(`mode.neq.weekly,solved_at.lt.${new Date(weekStart(weekKey(Date.now()))).toISOString()}`)
      .order("solved_at", { ascending: false })
      .limit(25),
    db()
      .from("rating_events")
      .select("at, rating_after")
      .eq("profile_id", profileId)
      .eq("event", event)
      .eq("pool", pool)
      .order("at", { ascending: true })
      .limit(200),
    db()
      .from("duels")
      .select("outcome")
      .eq("profile_id", profileId)
      .not("outcome", "is", null),
  ]);

  const rating = ratingRow.data;
  const established =
    rating !== null && rating !== undefined
      ? rating.deviation <= ESTABLISHED_DEVIATION
      : false;

  let rank: number | null = null;
  if (rating && established) {
    // Rank is "how many established players rate above me, plus one". Counted
    // rather than read from a stored column, because a stored rank is wrong the
    // moment anyone else finishes a window.
    const { count } = await db()
      .from("ratings")
      .select("profile_id", { count: "exact", head: true })
      .eq("event", event)
      .eq("pool", pool)
      .lte("deviation", ESTABLISHED_DEVIATION)
      .gt("rating", rating.rating);
    rank = (count ?? 0) + 1;
  }

  return {
    rating: rating?.rating ?? null,
    deviation: rating?.deviation ?? 350,
    peak: rating?.peak_rating ?? null,
    established,
    rank,
    rankedSolves: rating?.solve_count ?? 0,
    bestSingleMs: best.data?.duration_ms ?? null,
    duelWins: duels.data?.filter((d) => d.outcome === "win").length ?? 0,
    duelLosses: duels.data?.filter((d) => d.outcome === "loss").length ?? 0,
    recent:
      recent.data?.map((row) => ({
        id: row.id,
        durationMs: row.duration_ms,
        penalty: row.penalty,
        scramble: row.scramble,
        moveCount: row.move_count,
        solvedAt: row.solved_at,
        mode: row.mode,
        event: row.event,
      })) ?? [],
    history:
      history.data
        // A failed window is a real event but it has no rating to plot — the
        // rule is that it moves the deviation and leaves the rating alone.
        // Dropping it here keeps the chart a chart of ratings.
        ?.filter((row) => row.rating_after !== null)
        .map((row) => ({ at: row.at, rating: row.rating_after as number })) ?? [],
  };
}

export interface RushEntry {
  rank: number;
  handle: string;
  displayName: string;
  score: number;
  bestStreak: number;
  event: string;
  at: string;
}

/**
 * The best Rush run each player has finished.
 *
 * One row per player, not per run — a board where somebody appears eight times
 * because they had a good afternoon tells you about their afternoon rather than
 * about the field.
 *
 * Rush is the one board here that can honestly mix events. A rating cannot: a
 * 3000 on 5x5 and a 3000 on 3x3 mean the same standard but the times behind them
 * are nothing alike, so a combined rating board would be comparing scales. A
 * Rush score is a count of solves held under a target derived from the player's
 * own pace, so it already means "how far past yourself could you hold it" — which
 * is the same question whichever puzzle was in their hands.
 */
export async function rushBoard(event?: string, limit = 100): Promise<RushEntry[]> {
  let query = db()
    .from("rush_runs")
    .select("score, best_streak, event, ended_at, profiles!inner(handle, display_name)")
    .eq("status", "finished")
    // A zero-solve run is a run somebody started and did not clear once. It is
    // not a result, and a board full of them is noise.
    .gt("score", 0)
    .order("score", { ascending: false })
    .order("best_streak", { ascending: false })
    // Deliberately over-fetched: the best-per-player pass below collapses rows,
    // so fetching exactly `limit` would return fewer than `limit` players.
    .limit(limit * 5);

  if (event) query = query.eq("event", event);

  const { data, error } = await query;

  // An outage that renders as an empty board is indistinguishable from nobody
  // having played, which is the failure nobody investigates.
  if (error) throw new Error(`Could not load the rush board: ${error.message}`);
  if (!data) return [];

  const best = new Map<string, RushEntry>();
  for (const row of data) {
    const profile = row.profiles as unknown as { handle: string; display_name: string };
    const existing = best.get(profile.handle);
    if (existing && existing.score >= row.score) continue;
    best.set(profile.handle, {
      rank: 0,
      handle: profile.handle,
      displayName: profile.display_name,
      score: row.score,
      bestStreak: row.best_streak,
      event: row.event,
      at: row.ended_at ?? "",
    });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || b.bestStreak - a.bestStreak)
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
