import "server-only";

import type { PhaseSplit, TimedMove } from "../cfop";
import type { EventId } from "../events";
import { MIN_SOLVES_FOR_DIAGNOSIS } from "../phaseStats";
import type { StoredSolve } from "../solveHistory";
import { isSealed } from "../weekly";
import { db } from "./supabase";

/**
 * One solve, addressable forever.
 *
 * This is the move stream made into a thing you can send somebody. Every other
 * timer can show you a number; this can show you the solve. A permalink is the
 * only form in which that is worth anything — a replay you can only watch in the
 * four seconds after you stopped the clock is not evidence, it is a flourish.
 *
 * ## Why par comes only from solves before this one
 *
 * `reviewSolve` compares a solve against what that cuber usually takes. On the
 * timer, "usually" means their history up to now, which is the right answer for
 * a verdict delivered once.
 *
 * A permalink is not delivered once. If par were drawn from all their solves,
 * the page would re-derive its verdict on every view, and a link shared today
 * saying "your F2L cost you 3.1 seconds" would quietly become "your F2L was
 * fine" a fortnight later once they got faster — the number moving because the
 * *reader* arrived later, not because anything about the solve changed.
 *
 * So par is drawn from the solves that existed when this one happened. The page
 * says the same thing forever, which is the only property that makes it worth
 * linking to.
 */

export interface SolvePageData {
  id: string;
  handle: string;
  displayName: string;
  event: EventId;
  scramble: string;
  durationMs: number;
  penalty: "OK" | "PLUS2" | "DNF";
  moveCount: number;
  tps: number;
  /** Every move with the moment it was made. This is what makes replay real. */
  moves: TimedMove[];
  splits: PhaseSplit[];
  ollCase: string | null;
  pllCase: string | null;
  source: "keyboard" | "smartcube" | "manual";
  mode: "practice" | "daily" | "duel" | "ranked";
  verified: boolean;
  solvedAt: string;
  /** The solver's earlier solves, for par. Never includes this one. */
  history: StoredSolve[];
}

function asSplits(value: unknown): PhaseSplit[] {
  return Array.isArray(value) ? (value as PhaseSplit[]) : [];
}

/**
 * The move stream, with the timestamps that make it a recording.
 *
 * Stored as `{move, atMs}` by the verifier, which is the whole reason this page
 * can play a solve back at the speed it happened rather than animating it at
 * some invented tempo. A replay at the wrong speed teaches the wrong thing: the
 * pauses are the information.
 */
function asMoves(value: unknown): TimedMove[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is TimedMove =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as TimedMove).move === "string" &&
      typeof (m as TimedMove).atMs === "number" &&
      Number.isFinite((m as TimedMove).atMs),
  );
}

export async function solvePage(id: string): Promise<SolvePageData | null> {
  // A malformed id is a 404 rather than a database error. The ids are uuids and
  // this route is linked from the open web, so it will be probed.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const { data: solve, error } = await db()
    .from("solves")
    .select(
      "id, profile_id, event, scramble, duration_ms, penalty, move_count, tps, moves, splits, oll_case, pll_case, source, mode, verified, solved_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !solve) return null;
  // This week's competition scrambles stay hidden until the week closes.
  if (isSealed(solve.mode, Date.parse(solve.solved_at))) return null;

  const { data: profile } = await db()
    .from("profiles")
    .select("handle, display_name")
    .eq("id", solve.profile_id)
    .maybeSingle();

  // A solve whose owner is gone has nobody to attribute it to, and an
  // unattributed time on a public page is exactly the kind of number this
  // project refuses to print.
  if (!profile?.handle) return null;

  // Same event only. A par mixing 2x2 and 4x4 phases would compare a solve
  // against an average of two different puzzles.
  const { data: past } = await db()
    .from("solves")
    .select("id, scramble, duration_ms, penalty, move_count, tps, splits, oll_case, pll_case, source, solved_at")
    .eq("profile_id", solve.profile_id)
    .eq("event", solve.event)
    .eq("verified", true)
    .lt("solved_at", solve.solved_at)
    .order("solved_at", { ascending: false })
    .limit(MIN_SOLVES_FOR_DIAGNOSIS * 10);

  const history: StoredSolve[] = (past ?? []).map((row) => ({
    id: row.id,
    at: new Date(row.solved_at).getTime(),
    scramble: row.scramble,
    durationMs: row.duration_ms,
    penalty: row.penalty as StoredSolve["penalty"],
    moveCount: row.move_count,
    tps: row.tps,
    splits: asSplits(row.splits),
    ollCase: row.oll_case,
    pllCase: row.pll_case,
    ollSetup: null,
    pllSetup: null,
    source: row.source === "smartcube" ? "smartcube" : "keyboard",
  }));

  return {
    id: solve.id,
    handle: profile.handle,
    displayName: profile.display_name ?? profile.handle,
    event: solve.event as EventId,
    scramble: solve.scramble,
    durationMs: solve.duration_ms,
    penalty: solve.penalty as SolvePageData["penalty"],
    moveCount: solve.move_count,
    tps: solve.tps,
    moves: asMoves(solve.moves),
    splits: asSplits(solve.splits),
    ollCase: solve.oll_case,
    pllCase: solve.pll_case,
    source: solve.source as SolvePageData["source"],
    mode: solve.mode as SolvePageData["mode"],
    verified: solve.verified,
    solvedAt: solve.solved_at,
    history,
  };
}
