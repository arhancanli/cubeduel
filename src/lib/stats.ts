import type { Penalty } from "./types";

/**
 * Everything here needs a time and a penalty and nothing else. Taking the
 * structural shape rather than a full `Solve` lets the rating engine and the
 * server rate a window of attempts without fabricating scrambles and ids to
 * satisfy a type. `Solve` already satisfies this, so every existing caller is
 * unaffected.
 */
export interface Timed {
  /** Raw stopped time in ms, before any penalty is applied. */
  ms: number;
  penalty: Penalty;
}

/**
 * A computed average. `dnf` means the average itself is a DNF (too many DNFs to
 * trim away); `none` means there aren't enough solves to compute it at all.
 * Keeping these distinct matters — the UI shows "DNF" for one and "—" for the other.
 */
export type AvgResult =
  | { kind: "value"; ms: number }
  | { kind: "dnf" }
  | { kind: "none" };

export const NO_AVG: AvgResult = { kind: "none" };
export const DNF_AVG: AvgResult = { kind: "dnf" };

/**
 * Time a solve actually counts for, after penalties. `null` is a DNF, which
 * sorts as worse than any finite time.
 */
export function effectiveMs(solve: Timed): number | null {
  if (solve.penalty === "DNF") return null;
  if (solve.penalty === "PLUS2") return solve.ms + 2000;
  return solve.ms;
}

/** The solve as a WCA *result*: penalty applied, truncated to centiseconds. */
function resultMs(solve: Timed): number | null {
  const effective = effectiveMs(solve);
  return effective === null ? null : truncateToCentiseconds(effective);
}

/**
 * WCA results carry centisecond precision, so averages round to the nearest
 * centisecond rather than the nearest millisecond (Regulation 9f2).
 */
function roundToCentiseconds(ms: number): number {
  return Math.round(ms / 10) * 10;
}

/**
 * A recorded *result* is truncated to centiseconds before it takes part in
 * anything (Regulation 9f1) — a 10.009 solve is the result 10.00, and the extra
 * milliseconds do not exist as far as the average is concerned.
 *
 * Averaging raw milliseconds and rounding at the end instead put our ao5 a
 * hundredth under the WCA figure for the same five solves about half the time.
 * Small, but this is the number cubers compare between apps, and being off by a
 * hundredth is exactly the kind of wrongness that costs trust in everything else.
 */
function truncateToCentiseconds(ms: number): number {
  return Math.floor(ms / 10) * 10;
}

/**
 * How many to drop from each end. One for ao5 and ao12, as the WCA does; for the
 * big averages the community's rule, and csTimer's: 5% from each end, rounded
 * up — three from an ao50, five from an ao100. Trimming one from an ao50 would
 * give a number no other timer agrees with.
 */
export function trimFromEachEnd(size: number): number {
  return size <= 12 ? 1 : Math.ceil(size * 0.05);
}

/**
 * Trimmed average: drop the best and worst `trimFromEachEnd(size)`, mean the
 * rest. DNFs count as the worst, so as many DNFs as are trimmed are survivable
 * and one more is not.
 */
export function trimmedAverage(window: Timed[], size: number): AvgResult {
  if (window.length < size) return NO_AVG;
  const sample = window.slice(-size);
  const trim = trimFromEachEnd(size);

  const times = sample.map(resultMs);
  const dnfCount = times.filter((t) => t === null).length;
  if (dnfCount > trim) return DNF_AVG;

  const finite = (times.filter((t) => t !== null) as number[]).sort((a, b) => a - b);

  // DNFs already fill part of the worst end, so only the rest of it is trimmed.
  const kept = finite.slice(trim, finite.length - (trim - dnfCount));
  if (kept.length === 0) return NO_AVG;

  const sum = kept.reduce((a, b) => a + b, 0);
  return { kind: "value", ms: roundToCentiseconds(sum / kept.length) };
}

/**
 * Untrimmed mean (mo3 and friends). Any DNF poisons the whole thing — there is
 * nothing to trim it away with.
 */
export function meanOf(window: Timed[], size: number): AvgResult {
  if (window.length < size) return NO_AVG;
  const sample = window.slice(-size);
  const times = sample.map(resultMs);
  if (times.some((t) => t === null)) return DNF_AVG;
  const sum = (times as number[]).reduce((a, b) => a + b, 0);
  return { kind: "value", ms: roundToCentiseconds(sum / times.length) };
}

/** Mean of every non-DNF solve in the session. */
export function sessionMean(solves: Timed[]): AvgResult {
  const finite = solves.map(resultMs).filter((t) => t !== null) as number[];
  if (finite.length === 0) return NO_AVG;
  const sum = finite.reduce((a, b) => a + b, 0);
  return { kind: "value", ms: roundToCentiseconds(sum / finite.length) };
}

/** Fastest single in the list, ignoring DNFs. `null` if there isn't one. */
export function bestSingle(solves: Timed[]): number | null {
  const finite = solves.map(effectiveMs).filter((t) => t !== null) as number[];
  if (finite.length === 0) return null;
  return Math.min(...finite);
}

/** Slowest single in the list, ignoring DNFs. */
export function worstSingle(solves: Timed[]): number | null {
  const finite = solves.map(effectiveMs).filter((t) => t !== null) as number[];
  if (finite.length === 0) return null;
  return Math.max(...finite);
}

/**
 * Best rolling trimmed average of `size` across the whole session — the number
 * people actually chase, as opposed to the current one.
 */
export function bestTrimmedAverage(solves: Timed[], size: number): AvgResult {
  if (solves.length < size) return NO_AVG;
  let best: number | null = null;
  for (let end = size; end <= solves.length; end++) {
    const result = trimmedAverage(solves.slice(end - size, end), size);
    if (result.kind === "value" && (best === null || result.ms < best)) {
      best = result.ms;
    }
  }
  return best === null ? DNF_AVG : { kind: "value", ms: best };
}

/** Current ao5 / ao12 over the most recent solves. */
export function ao5(solves: Timed[]): AvgResult {
  return trimmedAverage(solves, 5);
}

export function ao12(solves: Timed[]): AvgResult {
  return trimmedAverage(solves, 12);
}

export function ao50(solves: Timed[]): AvgResult {
  return trimmedAverage(solves, 50);
}

export function ao100(solves: Timed[]): AvgResult {
  return trimmedAverage(solves, 100);
}

export function mo3(solves: Timed[]): AvgResult {
  return meanOf(solves, 3);
}
