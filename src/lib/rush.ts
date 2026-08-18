import { EVENTS, type EventId } from "./events";
import type { Penalty } from "./types";

/**
 * Rush: solve under a target that keeps tightening, until you miss three.
 *
 * Every other mode here measures you. This one presses on you, and that is a
 * different thing. A timer tells you your average; it never puts you in the
 * position of needing *this* solve to be fast, which is the position every
 * competition round actually is. Chess.com's Puzzle Rush is the closest
 * analogue, and it is the single most-played thing on that site — nothing in
 * cubing has an equivalent.
 *
 * ## The target is yours, not everyone's
 *
 * A fixed target cannot work. Ten seconds is a lazy solve for somebody averaging
 * eight and unreachable for somebody averaging forty, so a shared number makes
 * the mode trivial for the fast and pointless for everyone else. The target
 * starts from *your own* recent pace and tightens from there, which means the
 * mode is equally intense at every level — a world-class cuber and a beginner
 * both end up at the edge of what they can currently do, which is the only place
 * anybody improves.
 *
 * ## Why it tightens rather than holding steady
 *
 * A constant target is a plateau: you either clear it comfortably every time or
 * you never clear it. Tightening finds the boundary. The run ends when you have
 * missed three, so the score is "how far past your own pace could you hold it",
 * and that number moves when you get better and not otherwise.
 */

/** Misses allowed before the run ends. */
export const RUSH_LIVES = 3;

/**
 * How much slack the first target gets over your established pace.
 *
 * Generous on purpose. The first solve of a run is the one where people are
 * still settling, and an opening target that catches somebody mid-breath teaches
 * them the mode is unfair rather than hard.
 */
export const OPENING_SLACK = 1.25;

/** Each cleared solve tightens the target by this much. */
export const TIGHTEN_PER_SOLVE = 0.02;

/**
 * The floor, as a fraction of your pace. Without it the target converges on zero
 * and the run always ends the same way — on an impossible target rather than on
 * a genuine limit, which would make the score a measure of arithmetic instead of
 * cubing.
 */
export const TIGHTEST = 0.6;

export interface RushState {
  /** Solves cleared inside the target. */
  score: number;
  /** Misses so far, out of RUSH_LIVES. */
  misses: number;
  /** Longest unbroken run of cleared solves. */
  bestStreak: number;
  /** Current unbroken run. */
  streak: number;
  /** The target the next solve has to beat, in milliseconds. */
  targetMs: number;
  over: boolean;
}

/**
 * Where a run starts.
 *
 * `paceMs` is the player's own reference time — their established ranked average
 * where they have one. Somebody unrated gets the event's "strong club cuber"
 * mark, which is a deliberately soft start: better to open too easy and let the
 * tightening find them than to open too hard and have them bounce.
 */
export function startRush(paceMs: number, event: EventId): RushState {
  return {
    score: 0,
    misses: 0,
    bestStreak: 0,
    streak: 0,
    targetMs: Math.round(referencePace(paceMs, event) * OPENING_SLACK),
    over: false,
  };
}

/** The pace a run is built from, clamped so a corrupt rating cannot set it. */
export function referencePace(paceMs: number, event: EventId): number {
  const def = EVENTS[event];
  if (!Number.isFinite(paceMs) || paceMs <= 0) return def.strongMs;
  // Nobody's target should be built from a time faster than the event's floor
  // for a plausible single, or slower than five minutes.
  return Math.min(Math.max(paceMs, def.minSolveMs), 300_000);
}

export interface RushSolve {
  durationMs: number;
  penalty: Penalty;
}

/** The time a solve is judged on. A DNF never clears a target. */
export function effectiveMs(solve: RushSolve): number | null {
  if (solve.penalty === "DNF") return null;
  return solve.durationMs + (solve.penalty === "PLUS2" ? 2000 : 0);
}

/**
 * Applies one solve to a run.
 *
 * Pure, and takes the whole state rather than mutating it, so the server can
 * recompute a run from its stored solves and get the same answer the client
 * showed. A score the client reports and the server cannot reproduce is not a
 * score, it is a claim.
 */
export function applySolve(
  state: RushState,
  solve: RushSolve,
  paceMs: number,
  event: EventId,
): RushState {
  if (state.over) return state;

  const time = effectiveMs(solve);
  const cleared = time !== null && time <= state.targetMs;

  const score = cleared ? state.score + 1 : state.score;
  const misses = cleared ? state.misses : state.misses + 1;
  const streak = cleared ? state.streak + 1 : 0;
  const bestStreak = Math.max(state.bestStreak, streak);
  const over = misses >= RUSH_LIVES;

  return {
    score,
    misses,
    streak,
    bestStreak,
    // Tightens on a cleared solve only. Tightening after a miss would compound
    // a bad solve into an impossible next one and end runs in a spiral rather
    // than at a limit.
    targetMs: cleared ? nextTarget(score, paceMs, event) : state.targetMs,
    over,
  };
}

/**
 * The target after `cleared` successful solves.
 *
 * Computed from the count rather than by repeatedly shrinking the last value, so
 * replaying a run from its solves gives exactly the same targets — no drift, and
 * no dependence on the order the server happens to process things in.
 */
export function nextTarget(cleared: number, paceMs: number, event: EventId): number {
  const pace = referencePace(paceMs, event);
  const factor = Math.max(TIGHTEST, OPENING_SLACK - cleared * TIGHTEN_PER_SOLVE);
  return Math.round(pace * factor);
}

/**
 * Replays a whole run from its solves.
 *
 * This is what the server trusts. The client shows a running score for feel; the
 * record comes from here, over solves that were each verified against the
 * scramble they were issued for.
 */
export function replayRush(
  solves: readonly RushSolve[],
  paceMs: number,
  event: EventId,
): RushState {
  let state = startRush(paceMs, event);
  for (const solve of solves) {
    if (state.over) break;
    state = applySolve(state, solve, paceMs, event);
  }
  return state;
}
