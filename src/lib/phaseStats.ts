import type { PhaseSplit } from "./cfop";
import type { StoredSolve } from "./solveHistory";

/**
 * Aggregate phase analysis — what to actually practise.
 *
 * The discipline here is separating three different kinds of claim, because it
 * would be very easy to dress all of them up as equally solid:
 *
 *   1. Arithmetic. "OLL is 31% of your solve time over 60 solves." Indisputable.
 *   2. Descriptive. "OLL is your most variable phase." Also indisputable, but only
 *      describes the sample.
 *   3. Interpretation. "Variable means a recognition gap." Domain reasoning, and
 *      labelled as such rather than presented as a measurement.
 *
 * Nothing is asserted below a stated sample size, and a change that sits inside
 * normal variation is reported as no change rather than as progress.
 */

export type PhaseGroup = "Cross" | "F2L" | "OLL" | "PLL";

export const PHASE_ORDER: PhaseGroup[] = ["Cross", "F2L", "OLL", "PLL"];

/** Below this, the sample is too small to say anything and we say so instead. */
export const MIN_SOLVES_FOR_DIAGNOSIS = 5;
/** A trend needs two halves that are each worth comparing. */
export const MIN_SOLVES_FOR_TREND = 12;

export function groupOf(phase: string): PhaseGroup | null {
  if (phase === "Cross") return "Cross";
  // F2L 1..4 collapse: which pair number a slot happened to be is an artefact of
  // completion order, but the stage as a whole is a real thing to train.
  if (phase.startsWith("F2L")) return "F2L";
  if (phase === "OLL") return "OLL";
  if (phase === "PLL") return "PLL";
  return null; // "Unfinished" contributes nothing.
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n−1). Null below two points, where it is undefined. */
function sampleSd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Total time spent in each phase group, for one solve. */
export function groupSplits(splits: PhaseSplit[]): Map<PhaseGroup, number> {
  const totals = new Map<PhaseGroup, number>();
  for (const split of splits) {
    const group = groupOf(split.phase);
    if (!group) continue;
    totals.set(group, (totals.get(group) ?? 0) + split.durationMs);
  }
  return totals;
}

export interface PhaseAggregate {
  phase: PhaseGroup;
  n: number;
  meanMs: number;
  bestMs: number;
  worstMs: number;
  sdMs: number | null;
  /** Standard deviation over the mean. Null below two solves. */
  cv: number | null;
  /** This phase's mean as a fraction of the summed phase means. */
  shareOfSolve: number;
}

/** Only solves that were actually split contribute; DNFs and unfinished do not. */
function analysable(solves: readonly StoredSolve[]): StoredSolve[] {
  return solves.filter((s) => s.penalty !== "DNF" && s.splits.length > 0);
}

export function aggregatePhases(solves: readonly StoredSolve[]): PhaseAggregate[] {
  const usable = analysable(solves);
  const byPhase = new Map<PhaseGroup, number[]>();

  for (const solve of usable) {
    for (const [group, ms] of groupSplits(solve.splits)) {
      const list = byPhase.get(group) ?? [];
      list.push(ms);
      byPhase.set(group, list);
    }
  }

  const aggregates = PHASE_ORDER.filter((p) => (byPhase.get(p)?.length ?? 0) > 0).map((phase) => {
    const values = byPhase.get(phase)!;
    const m = mean(values);
    const sd = sampleSd(values);
    return {
      phase,
      n: values.length,
      meanMs: m,
      bestMs: Math.min(...values),
      worstMs: Math.max(...values),
      sdMs: sd,
      cv: sd !== null && m > 0 ? sd / m : null,
      shareOfSolve: 0,
    };
  });

  const totalMean = aggregates.reduce((a, p) => a + p.meanMs, 0);
  for (const aggregate of aggregates) {
    aggregate.shareOfSolve = totalMean > 0 ? aggregate.meanMs / totalMean : 0;
  }
  return aggregates;
}

export type DiagnosisKind = "insufficient" | "recognition" | "execution";

export interface Diagnosis {
  kind: DiagnosisKind;
  /** The phase to work on. Null only when there isn't enough data to name one. */
  phase: PhaseGroup | null;
  sampleSize: number;
  /** Arithmetic fact — safe to state flatly. */
  fact: string;
  /** Domain interpretation — hedged, because it is reasoning and not measurement. */
  interpretation: string;
}

/**
 * The relative-spread cut for calling a phase inconsistent.
 *
 * Deliberately relative — a phase is "variable" compared to that cuber's own other
 * phases, not against an absolute constant. There is no calibration data here to
 * justify an absolute threshold, and inventing one would make a made-up number look
 * like a measured one.
 */
const INCONSISTENCY_RATIO = 1.4;

export function diagnose(solves: readonly StoredSolve[]): Diagnosis {
  const usable = analysable(solves);
  const aggregates = aggregatePhases(solves);

  if (usable.length < MIN_SOLVES_FOR_DIAGNOSIS || aggregates.length === 0) {
    const needed = MIN_SOLVES_FOR_DIAGNOSIS - usable.length;
    const recorded = solves.length;
    const unanalysable = recorded - usable.length;

    /*
     * Saying "5 more solves" beside a counter reading 14 is the app contradicting
     * itself, and it was the single most common reason testers closed the tab. A
     * hand-timed solve has no move data — there is nothing to split — so counting it
     * toward the analyser was never going to happen no matter how many they did.
     * Say which kind of solve is missing instead of implying they are nearly there.
     */
    if (unanalysable > 0 && usable.length === 0) {
      return {
        kind: "insufficient",
        phase: null,
        sampleSize: 0,
        fact: `${recorded} solve${recorded === 1 ? "" : "s"} recorded, none with move data.`,
        interpretation:
          "A stopwatch only knows the total. Phase analysis needs to see the turns, which means solving on Play or with a connected smart cube — timing by hand will never unlock it, however many you do.",
      };
    }

    return {
      kind: "insufficient",
      phase: null,
      sampleSize: usable.length,
      fact:
        usable.length === 0
          ? "No solves analysed yet."
          : `${usable.length} of ${recorded} solves carry move data.`,
      interpretation: `${needed} more solve${needed === 1 ? "" : "s"} with move data before there's enough to point at anything.`,
    };
  }

  const bottleneck = aggregates.reduce((a, b) => (b.meanMs > a.meanMs ? b : a));
  const sharePct = Math.round(bottleneck.shareOfSolve * 100);

  const withCv = aggregates.filter((a) => a.cv !== null);
  const cvs = withCv.map((a) => a.cv!).sort((a, b) => a - b);
  const medianCv = cvs.length > 0 ? cvs[Math.floor(cvs.length / 2)] : 0;
  const bottleneckCv = bottleneck.cv;

  // Two phases can be slow for opposite reasons. A phase that is *reliably* slow is
  // an execution problem: the algorithm or the fingertricks. A phase whose time
  // swings is a recognition problem: sometimes you see it instantly and sometimes
  // you stall. They need different practice, which is why the split is worth making.
  const inconsistent =
    bottleneckCv !== null && medianCv > 0 && bottleneckCv / medianCv >= INCONSISTENCY_RATIO;

  const spread =
    bottleneck.bestMs > 0 ? (bottleneck.worstMs / bottleneck.bestMs).toFixed(1) : "—";

  return {
    kind: inconsistent ? "recognition" : "execution",
    phase: bottleneck.phase,
    sampleSize: usable.length,
    fact: `${bottleneck.phase} is ${sharePct}% of your solve across ${usable.length} solves, and your slowest was ${spread}× your fastest.`,
    interpretation: inconsistent
      ? `That spread is wide relative to your other phases, which usually means recognition rather than hand speed — you know some cases cold and stall on others. Drilling the specific cases tends to help more than turning faster.`
      : `That time is fairly consistent, which usually points at execution rather than recognition — the algorithms and fingertricks themselves, rather than spotting what to do.`,
  };
}

export type TrendKind = "improving" | "worsening" | "unclear" | "insufficient";

export interface Trend {
  kind: TrendKind;
  deltaMs: number;
  earlierN: number;
  recentN: number;
}

/**
 * Compares the recent half of the sample against the earlier half.
 *
 * A raw difference of means says almost nothing on a noisy measure like solve time,
 * so a change is only called if it clears twice the standard error of the
 * difference. Everything inside that band is reported as unclear — a cuber
 * congratulated for random drift learns the wrong lesson about what worked.
 */
export function totalTimeTrend(solves: readonly StoredSolve[]): Trend {
  // Split-gated on purpose: this is the trend shown beside the phase analysis,
  // and it should describe the same solves that analysis is drawn from.
  return compareHalves(
    analysable(solves)
      .filter((s) => s.durationMs > 0)
      .map((s) => s.durationMs),
  );
}

/**
 * The significance test itself, over plain numbers.
 *
 * Extracted so there is exactly ONE definition of "this change is real" in the
 * app. The goal tracker needs the same rule over a different set of solves — a
 * cuber who only ever uses the stopwatch has times but no phase splits, and
 * still deserves to be told honestly whether they are getting faster — and two
 * copies of a statistical test drift apart the first time one is tuned.
 */
export function compareHalves(values: readonly number[]): Trend {
  const usable = values.filter((v) => v > 0);
  if (usable.length < MIN_SOLVES_FOR_TREND) {
    return { kind: "insufficient", deltaMs: 0, earlierN: usable.length, recentN: 0 };
  }

  const mid = Math.floor(usable.length / 2);
  const earlier = usable.slice(0, mid);
  const recent = usable.slice(mid);

  const earlierMean = mean(earlier);
  const recentMean = mean(recent);
  const delta = recentMean - earlierMean;

  const sdEarlier = sampleSd(earlier) ?? 0;
  const sdRecent = sampleSd(recent) ?? 0;
  const se = Math.sqrt(sdEarlier ** 2 / earlier.length + sdRecent ** 2 / recent.length);

  if (se === 0 || Math.abs(delta) < 2 * se) {
    return { kind: "unclear", deltaMs: delta, earlierN: earlier.length, recentN: recent.length };
  }
  return {
    kind: delta < 0 ? "improving" : "worsening",
    deltaMs: delta,
    earlierN: earlier.length,
    recentN: recent.length,
  };
}
