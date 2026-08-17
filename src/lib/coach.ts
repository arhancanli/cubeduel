import { aggregateCases, type CaseAggregate, type Stage } from "./caseStats";
import { MIN_SOLVES_FOR_TREND, compareHalves } from "./phaseStats";
import type { StoredSolve } from "./solveHistory";

/**
 * Goals, and the plan to reach one.
 *
 * Every timer app will happily tell you that you are "on track for sub-15 by
 * March". Almost none of them can justify it: they fit a line through noise and
 * read a date off it. A cuber who is congratulated for random drift learns the
 * wrong lesson about whatever they changed that week, and a cuber given a
 * confident date that does not arrive stops believing the app.
 *
 * So this module makes exactly three kinds of claim, and keeps them apart:
 *
 * 1. **Arithmetic.** "You are 3.4 seconds from your goal." Indisputable.
 * 2. **Measured.** "Your last 30 solves are 1.2s faster than the 30 before,
 *    which is outside normal variation." True of the sample, with the test
 *    stated.
 * 3. **Refused.** "Your solves show no clear change, so there is no honest way
 *    to tell you when you will get there." The most common answer, and the one
 *    every other app replaces with a guess.
 *
 * A projection appears *only* when the underlying trend clears the significance
 * bar in `phaseStats` — the difference between halves must exceed twice the
 * standard error of that difference. Everything inside that band is reported as
 * no clear change, and no date is invented.
 */

/** Below this a goal is not a goal, it is a typo. */
export const MIN_GOAL_MS = 2000;
export const MAX_GOAL_MS = 600_000;

export interface Goal {
  /** The average the player is aiming for, in milliseconds. */
  targetMs: number;
  /** Their average when they set it, so progress has a starting point. */
  baselineMs: number;
  setAt: number;
}

export type GoalStatus =
  | "no-goal"
  | "insufficient"
  | "reached"
  | "improving"
  | "no-clear-change"
  | "worsening";

export interface GoalProgress {
  status: GoalStatus;
  targetMs: number;
  baselineMs: number;
  /** Mean of the recent window, or null when there are too few solves. */
  currentMs: number | null;
  /** How much of the original gap has been closed, 0..1. Null when unmeasurable. */
  closed: number | null;
  /**
   * Solves left at the measured rate. Present **only** when the improvement is
   * statistically distinguishable from noise.
   */
  solvesRemaining: number | null;
  /** Written for the player, and never claiming more than the data supports. */
  explanation: string;
}

/** Solves that carry a usable time. */
function usable(solves: readonly StoredSolve[]): StoredSolve[] {
  return solves.filter((s) => s.penalty !== "DNF" && s.durationMs > 0);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The window a cuber would recognise as "where I am now". */
export const RECENT_WINDOW = 12;

export function currentAverage(solves: readonly StoredSolve[]): number | null {
  const finite = usable(solves);
  if (finite.length === 0) return null;
  return mean(finite.slice(-RECENT_WINDOW).map((s) => s.durationMs));
}

export function evaluateGoal(
  goal: Goal | null,
  solves: readonly StoredSolve[],
): GoalProgress {
  if (!goal) {
    return {
      status: "no-goal",
      targetMs: 0,
      baselineMs: 0,
      currentMs: currentAverage(solves),
      closed: null,
      solvesRemaining: null,
      explanation: "No goal set.",
    };
  }

  const current = currentAverage(solves);
  const finite = usable(solves);

  if (current === null || finite.length < MIN_SOLVES_FOR_TREND) {
    return {
      status: "insufficient",
      targetMs: goal.targetMs,
      baselineMs: goal.baselineMs,
      currentMs: current,
      closed: null,
      solvesRemaining: null,
      explanation: `Not enough solves yet. Progress needs at least ${MIN_SOLVES_FOR_TREND} analysed solves before it means anything — you have ${finite.length}.`,
    };
  }

  const originalGap = goal.baselineMs - goal.targetMs;
  const closed =
    originalGap > 0
      ? Math.max(0, Math.min(1, (goal.baselineMs - current) / originalGap))
      : null;

  if (current <= goal.targetMs) {
    return {
      status: "reached",
      targetMs: goal.targetMs,
      baselineMs: goal.baselineMs,
      currentMs: current,
      closed: 1,
      solvesRemaining: 0,
      explanation: `Reached. Your last ${Math.min(RECENT_WINDOW, finite.length)} solves average faster than the goal.`,
    };
  }

  // Over every timed solve, not just the ones with phase splits. A goal is about
  // total time, and a cuber who only uses the stopwatch has times without splits
  // — refusing to track their goal because of that would be the wrong gate. The
  // significance rule is the shared one, so "real change" means the same thing
  // here as it does beside the phase analysis.
  const trend = compareHalves(finite.map((s) => s.durationMs));

  if (trend.kind === "insufficient") {
    return {
      status: "insufficient",
      targetMs: goal.targetMs,
      baselineMs: goal.baselineMs,
      currentMs: current,
      closed,
      solvesRemaining: null,
      explanation: "Not enough analysed solves to say whether you are getting faster.",
    };
  }

  if (trend.kind === "worsening") {
    return {
      status: "worsening",
      targetMs: goal.targetMs,
      baselineMs: goal.baselineMs,
      currentMs: current,
      closed,
      solvesRemaining: null,
      explanation:
        "Your recent solves are slower than your earlier ones by more than normal variation. That is worth knowing rather than smoothing over — a new method or a new cube usually costs time before it saves any.",
    };
  }

  if (trend.kind === "unclear") {
    return {
      status: "no-clear-change",
      targetMs: goal.targetMs,
      baselineMs: goal.baselineMs,
      currentMs: current,
      closed,
      solvesRemaining: null,
      explanation:
        "Your times are not changing in a way that stands out from normal variation, so there is no honest way to say when you will reach this. That is not the same as no progress — it means the evidence cannot tell yet.",
    };
  }

  // Improving, and the improvement cleared the significance test.
  //
  // The rate is measured across the whole sample: the gap between the two halves
  // divided by the number of solves separating their midpoints.
  const solvesBetweenMidpoints = Math.max(1, finite.length / 2);
  const msPerSolve = Math.abs(trend.deltaMs) / solvesBetweenMidpoints;
  const remaining = current - goal.targetMs;
  const solvesRemaining =
    msPerSolve > 0 ? Math.ceil(remaining / msPerSolve) : null;

  return {
    status: "improving",
    targetMs: goal.targetMs,
    baselineMs: goal.baselineMs,
    currentMs: current,
    closed,
    solvesRemaining,
    explanation:
      solvesRemaining === null
        ? "You are getting faster, but not fast enough to project from."
        : `At the rate your last ${finite.length} solves actually show, about ${solvesRemaining} more solves. This assumes the rate holds, which it usually does not — improvement comes in steps, not a line.`,
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface PlanItem {
  stage: Stage;
  caseId: string;
  name: string | null;
  setupAlg: string | null;
  /** Times this case has been seen in the sample. */
  occurrences: number;
  /** Seconds this case costs you per solve, on average. */
  perSolveMs: number;
}

export interface Plan {
  items: PlanItem[];
  /** What the whole plan is worth per solve, if every item were fixed. */
  totalPerSolveMs: number;
  /** How far the plan gets you toward the goal. Null without a goal. */
  coversGapFraction: number | null;
  /** Stated plainly when the plan cannot get there on its own. */
  verdict: string;
}

/** Nothing is recommended on thinner evidence than this. */
export const MIN_SOLVES_FOR_PLAN = 12;

/**
 * What to work on, ranked by the time it would actually give back.
 *
 * Not "your slowest case". A case you meet once a month and fumble for four
 * seconds costs less than one you meet every third solve and lose half a second
 * on, and only the second is worth a practice session. `caseStats` already ranks
 * by recoverable time; this converts that into a per-solve figure a person can
 * weigh against their goal, and then says whether it is enough.
 */
export function buildPlan(
  solves: readonly StoredSolve[],
  goal: Goal | null,
  names: ReadonlyMap<string, string> = new Map(),
  limit = 3,
): Plan {
  const analysed = usable(solves);

  if (analysed.length < MIN_SOLVES_FOR_PLAN) {
    return {
      items: [],
      totalPerSolveMs: 0,
      coversGapFraction: null,
      verdict: `A plan needs at least ${MIN_SOLVES_FOR_PLAN} analysed solves. Below that, one bad solve looks like a weakness.`,
    };
  }

  const candidates: CaseAggregate[] = [
    ...aggregateCases(solves, "OLL", names),
    ...aggregateCases(solves, "PLL", names),
  ]
    .filter((c) => c.excessMs > 0)
    .sort((a, b) => b.excessMs - a.excessMs)
    .slice(0, limit);

  const items: PlanItem[] = candidates.map((c) => ({
    stage: c.stage,
    caseId: c.caseId,
    name: c.name,
    setupAlg: c.setupAlg,
    occurrences: c.n,
    // `excessMs` is the total recoverable across the whole sample, so it has to
    // be spread over the sample to become "per solve" — quoting the total as a
    // per-solve saving would overstate it by a factor of the sample size.
    perSolveMs: c.excessMs / analysed.length,
  }));

  const totalPerSolveMs = items.reduce((sum, i) => sum + i.perSolveMs, 0);

  if (items.length === 0) {
    return {
      items,
      totalPerSolveMs: 0,
      coversGapFraction: null,
      verdict:
        "No case stands out as costing you more than the others. At that point the gain is in overall speed rather than any one algorithm.",
    };
  }

  const current = currentAverage(solves);
  if (!goal || current === null || current <= goal.targetMs) {
    return {
      items,
      totalPerSolveMs,
      coversGapFraction: null,
      verdict: `Fixing these would give back about ${(totalPerSolveMs / 1000).toFixed(1)}s per solve.`,
    };
  }

  const gap = current - goal.targetMs;
  const covers = totalPerSolveMs / gap;

  return {
    items,
    totalPerSolveMs,
    coversGapFraction: covers,
    verdict:
      covers >= 1
        ? `These alone are worth about ${(totalPerSolveMs / 1000).toFixed(1)}s per solve, which covers the ${(gap / 1000).toFixed(1)}s between you and your goal.`
        : `These are worth about ${(totalPerSolveMs / 1000).toFixed(1)}s per solve — roughly ${Math.round(covers * 100)}% of the ${(gap / 1000).toFixed(1)}s you need. The rest has to come from turning faster or pausing less, not from algorithms.`,
  };
}
