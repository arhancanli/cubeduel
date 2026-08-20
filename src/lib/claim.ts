import { DEFAULT_EVENT, type EventId } from "./events";
import { PHASE_ORDER, groupSplits, type PhaseGroup } from "./phaseStats";
import { ESTABLISHED_DEVIATION, ratingForMs } from "./rating";
import type { StoredSolve } from "./solveHistory";
import {
  bestSingle,
  bestTrimmedAverage,
  effectiveMs,
  type AvgResult,
  type Timed,
} from "./stats";

/**
 * What a guest already has, described back to them at the moment they are asked
 * to make an account.
 *
 * The whole product refuses to gate solving behind a sign-up — you land on the
 * timer and you are cubing within a second. That is right, and it leaves one
 * problem: an account has to earn itself later, from a standing start, against
 * somebody who is mid-session and does not want a form.
 *
 * This is the argument for it. By the time anybody is asked, they have a solve
 * count, a best time, a shape, and a pace that maps to a place on the ladder —
 * all of it already computed, all of it sitting in their browser and nowhere
 * else. The sign-up is not "create an account", it is "keep this".
 *
 * ## The rule this module exists to hold
 *
 * A projected rating is **not** a rating, and nothing here is allowed to blur
 * that. Ranked ratings come from solves the server issued a scramble for and
 * replayed afterwards; practice solves are typed on a keyboard with nobody
 * watching and could be anything. So `projectedRating` is deliberately named,
 * deliberately optional, and every caller is expected to label it as where this
 * pace *would* put somebody rather than where they stand.
 *
 * Getting this wrong would be the single most damaging thing the product could
 * do. The entire claim of the ladder is that a number on it means something,
 * and a projection presented as an achievement is exactly the lie the
 * verification exists to prevent.
 */

/**
 * Below this there is nothing worth showing back.
 *
 * Five is not arbitrary: it is the smallest window an average of five can be
 * taken from, and the rating is computed on averages rather than singles. Under
 * that there is no pace to speak of, only a handful of times.
 */
export const MIN_SOLVES_TO_CLAIM = 5;

/**
 * Below this a projection is noise dressed as a number.
 *
 * A single average of five moves a great deal with one lucky scramble. Twelve is
 * the same threshold `phaseStats` uses before it will call a trend, for the same
 * reason — it is where one outlier stops dominating.
 */
export const MIN_SOLVES_TO_PROJECT = 12;

export interface PhaseShare {
  phase: PhaseGroup;
  ms: number;
  /** Fraction of the solve, 0–1. */
  share: number;
}

export interface ClaimSummary {
  solveCount: number;
  /** Distinct calendar days with at least one solve. */
  dayCount: number;
  bestSingle: number | null;
  bestAo5: AvgResult;
  /** Total time spent solving, which is often the most affecting number here. */
  totalMs: number;
  firstSolveAt: number | null;

  /**
   * Where this pace would sit on the ladder. Null when there is not enough to
   * say, which is a real and common answer rather than a failure.
   *
   * Never present this as a rating the person holds. See the note at the top.
   */
  projectedRating: number | null;

  /**
   * The shape of their solve — how the time divides across cross, F2L, OLL and
   * PLL. Empty when no solve was splittable, which is the case for anyone who
   * used the plain timer rather than keyboard cubing.
   */
  shape: PhaseShare[];

  /** Whether there is enough here to be worth showing at all. */
  worthClaiming: boolean;
}

/**
 * `StoredSolve` names its time `durationMs`; the statistics take the structural
 * `Timed` shape, which names it `ms`. One adapter here rather than an inline
 * object at each call site, so the two cannot drift apart on a penalty field.
 */
function timed(solve: StoredSolve): Timed {
  return { ms: solve.durationMs, penalty: solve.penalty };
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Builds the summary from whatever is in local history.
 *
 * Takes solves rather than reading storage itself, so it is a pure function of
 * its input and can be tested without a browser — and so the sign-up screen can
 * be shown a made-up history to check how it renders at one solve, at five, and
 * at five hundred.
 */
export function summariseClaim(
  solves: readonly StoredSolve[],
  event: EventId = DEFAULT_EVENT,
): ClaimSummary {
  const counted = solves.filter((solve) => effectiveMs(timed(solve)) !== null);

  const days = new Set<number>();
  let totalMs = 0;
  let firstSolveAt: number | null = null;

  for (const solve of counted) {
    days.add(startOfDay(solve.at));
    // The raw duration, not the penalised one: this is time spent at the cube,
    // and a +2 does not mean two extra seconds were lived.
    totalMs += solve.durationMs;
    if (firstSolveAt === null || solve.at < firstSolveAt) firstSolveAt = solve.at;
  }

  const bestAo5 = bestTrimmedAverage(counted.map(timed), 5);

  // Projected from the best average of five rather than from the best single.
  // Ranked rates averages, so projecting from a single would advertise a number
  // the ladder would never award — and it would flatter, because a lucky single
  // is the least representative thing a session contains.
  // Rounded here rather than at the point of display. `ratingForMs` returns a
  // raw logarithm, and every other place that shows a rating remembers to round
  // it — this one did not, and the sign-up screen advertised a projected rating
  // of 1990.942818539531 until somebody looked at the page. Rounding at the
  // source means no future caller can forget.
  const projectedRating =
    counted.length >= MIN_SOLVES_TO_PROJECT && bestAo5.kind === "value"
      ? Math.round(ratingForMs(bestAo5.ms, event))
      : null;

  return {
    solveCount: counted.length,
    dayCount: days.size,
    bestSingle: bestSingle(counted.map(timed)),
    bestAo5,
    totalMs,
    firstSolveAt,
    projectedRating,
    shape: shapeOf(counted),
    worthClaiming: counted.length >= MIN_SOLVES_TO_CLAIM,
  };
}

/**
 * The proportions of a typical solve, from every solve that could be split.
 *
 * Averaged across solves rather than summed, so one very long solve does not
 * decide the shape. Solves without splits are skipped rather than counted as
 * zero — a stopwatch user has no phases, and treating that as "no time in F2L"
 * would draw a picture that is not merely incomplete but wrong.
 */
function shapeOf(solves: readonly StoredSolve[]): PhaseShare[] {
  const totals = new Map<PhaseGroup, number>();
  let splittable = 0;

  for (const solve of solves) {
    if (solve.splits.length === 0) continue;
    const grouped = groupSplits(solve.splits);
    if (grouped.size === 0) continue;

    splittable++;
    for (const [phase, ms] of grouped) {
      totals.set(phase, (totals.get(phase) ?? 0) + ms);
    }
  }

  if (splittable === 0) return [];

  const means = PHASE_ORDER.map((phase) => ({
    phase,
    ms: (totals.get(phase) ?? 0) / splittable,
  })).filter((entry) => entry.ms > 0);

  const sum = means.reduce((total, entry) => total + entry.ms, 0);
  if (sum <= 0) return [];

  return means.map((entry) => ({ ...entry, share: entry.ms / sum }));
}

/**
 * How far a projection is from a rating that would actually count.
 *
 * Ranked needs roughly twenty verified solves before the deviation narrows
 * enough for a rating to be published at all. Saying so turns the projection
 * from a claim into an invitation, and it is the honest framing: this is what
 * the ladder would need to see before it agrees with you.
 */
export const SOLVES_TO_ESTABLISH = 20;

export interface ClaimHeadline {
  /** The one number worth leading with. */
  value: string;
  label: string;
}

/**
 * Picks what to lead with, given how much there is.
 *
 * Deliberately not always the rating. Somebody with eight solves has no
 * projection, and showing them an empty slot where a number should be is worse
 * than leading with the thing they do have — a best time they were pleased with
 * twenty minutes ago.
 */
export function headlineFor(
  summary: ClaimSummary,
  formatMs: (ms: number) => string,
): ClaimHeadline | null {
  if (!summary.worthClaiming) return null;

  if (summary.projectedRating !== null) {
    return { value: String(summary.projectedRating), label: "projected rating" };
  }
  if (summary.bestAo5.kind === "value") {
    return { value: formatMs(summary.bestAo5.ms), label: "best average of 5" };
  }
  if (summary.bestSingle !== null) {
    return { value: formatMs(summary.bestSingle), label: "best single" };
  }
  return { value: String(summary.solveCount), label: "solves" };
}

/** Established-rating deviation, re-exported so the screen can explain itself. */
export { ESTABLISHED_DEVIATION };
