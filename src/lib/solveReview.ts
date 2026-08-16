import type { PhaseSplit } from "./cfop";
import { groupSplits, MIN_SOLVES_FOR_DIAGNOSIS, PHASE_ORDER, type PhaseGroup } from "./phaseStats";
import type { StoredSolve } from "./solveHistory";

/**
 * One solve, against the solver's own par.
 *
 * Cubing's central ambiguity is "was that slow because the scramble was bad, or
 * because I am bad?" — and a stopwatch cannot answer it, which is where the demand
 * for practice quietly dies. Chess gets the answer free from a loss and an engine
 * eval. Cubing has neither, so the culprit has to be manufactured.
 *
 * It can be manufactured honestly, because the counterfactual comes from the
 * solver's own history rather than from a model of a stronger player. Par is simply
 * what *they* usually take for that phase. A gap against that is a fact about them,
 * not a judgement handed down from a rating.
 */

export interface PhaseGap {
  phase: PhaseGroup;
  actualMs: number;
  /** What this solver usually takes for this phase. */
  parMs: number;
  /** Positive means slower than usual. */
  gapMs: number;
}

export type ReviewKind = "reviewed" | "no-par" | "no-splits";

export interface SolveReview {
  kind: ReviewKind;
  durationMs: number;
  /** Sum of pars — the solve this solver would usually have. Null without a par. */
  parMs: number | null;
  gapMs: number | null;
  gaps: PhaseGap[];
  /** The phase that lost the most time. Null when nothing was slower than usual. */
  culprit: PhaseGap | null;
  /** The culprit's share of all time lost, 0–1. */
  culpritShare: number;
  /** How many past solves the par is drawn from. */
  sampleSize: number;
}

function usable(solves: readonly StoredSolve[]): StoredSolve[] {
  return solves.filter((s) => s.penalty !== "DNF" && s.splits.length > 0);
}

/**
 * Mean time per phase across `history`. The solve under review is excluded by the
 * caller — comparing a solve against a par it helped set would flatten every gap
 * toward zero, and the flattening would be worst exactly when history is shortest.
 */
function parFor(history: readonly StoredSolve[]): Map<PhaseGroup, number> {
  const totals = new Map<PhaseGroup, number[]>();
  for (const solve of history) {
    for (const [phase, ms] of groupSplits(solve.splits)) {
      const list = totals.get(phase) ?? [];
      list.push(ms);
      totals.set(phase, list);
    }
  }
  const par = new Map<PhaseGroup, number>();
  for (const [phase, values] of totals) {
    par.set(phase, values.reduce((a, b) => a + b, 0) / values.length);
  }
  return par;
}

export function reviewSolve(
  splits: PhaseSplit[],
  durationMs: number,
  history: readonly StoredSolve[],
): SolveReview {
  const empty = {
    durationMs,
    parMs: null,
    gapMs: null,
    gaps: [],
    culprit: null,
    culpritShare: 0,
  };

  if (splits.length === 0) {
    return { ...empty, kind: "no-splits", sampleSize: 0 };
  }

  const past = usable(history);
  if (past.length < MIN_SOLVES_FOR_DIAGNOSIS) {
    return { ...empty, kind: "no-par", sampleSize: past.length };
  }

  const par = parFor(past);
  const actual = groupSplits(splits);

  const gaps: PhaseGap[] = PHASE_ORDER.filter(
    (phase) => actual.has(phase) && par.has(phase),
  ).map((phase) => {
    const actualMs = actual.get(phase)!;
    const parMs = par.get(phase)!;
    return { phase, actualMs, parMs, gapMs: actualMs - parMs };
  });

  if (gaps.length === 0) {
    return { ...empty, kind: "no-par", sampleSize: past.length };
  }

  const parTotal = gaps.reduce((a, g) => a + g.parMs, 0);
  const lost = gaps.filter((g) => g.gapMs > 0);
  const totalLost = lost.reduce((a, g) => a + g.gapMs, 0);
  const culprit = lost.length > 0 ? lost.reduce((a, b) => (b.gapMs > a.gapMs ? b : a)) : null;

  return {
    kind: "reviewed",
    durationMs,
    parMs: parTotal,
    gapMs: gaps.reduce((a, g) => a + g.gapMs, 0),
    gaps,
    culprit,
    culpritShare: culprit && totalLost > 0 ? culprit.gapMs / totalLost : 0,
    sampleSize: past.length,
  };
}
