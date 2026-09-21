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
  /**
   * What the move stream MEASURED about the slow solves, when there is enough of
   * it — which part of the phase the extra time went to. Arithmetic, like
   * `fact`. Null when the call below it rests on the older spread heuristic.
   */
  measured: string | null;
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
        measured: null,
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
      measured: null,
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

  const fact = `${bottleneck.phase} is ${sharePct}% of your solve across ${usable.length} solves, and your slowest was ${spread}× your fastest.`;

  // Measured, when the stream allows it: split the phase's slow solves from its
  // fast ones and ask which part the extra time went to. This replaces the spread
  // heuristic below rather than sitting beside it — once the answer can be read
  // off the clock, inferring it from variance is guessing at something known.
  const slow = explainSlowSolves(solves, bottleneck.phase);
  if (slow) {
    const looking = slow.fromLookMs >= slow.fromTurnMs;
    const [lookNoun, lookAdvice] = LOOKING[bottleneck.phase];
    return {
      kind: looking ? "recognition" : "execution",
      phase: bottleneck.phase,
      sampleSize: usable.length,
      fact: `${fact} Per solve it is ${formatSeconds(slow.lookMs)} ${lookNoun} and ${formatSeconds(slow.turnMs)} turning.`,
      measured: `In your slower half of ${slow.n} solves, ${bottleneck.phase} takes ${formatSeconds(slow.slowerByMs)} longer: ${moreOrLess(slow.fromLookMs, lookNoun)}, ${moreOrLess(slow.fromTurnMs, "turning")}.`,
      interpretation: looking
        ? `So the slow solves are slow in the looking, not the hands. ${lookAdvice}`
        : `So the slow solves are slow in the turning, not the looking — the algorithms and fingertricks themselves. Drilling the executions, and cutting moves from them, usually pays more than recognition work here.`,
    };
  }

  return {
    kind: inconsistent ? "recognition" : "execution",
    phase: bottleneck.phase,
    sampleSize: usable.length,
    fact,
    measured: null,
    interpretation: inconsistent
      ? `That spread is wide relative to your other phases, which usually means recognition rather than hand speed — you know some cases cold and stall on others. Drilling the specific cases tends to help more than turning faster.`
      : `That time is fairly consistent, which usually points at execution rather than recognition — the algorithms and fingertricks themselves, rather than spotting what to do.`,
  };
}

// ---------------------------------------------------------------------------
// Looking and turning
// ---------------------------------------------------------------------------

/**
 * What "looking" means in each phase, and the practice that usually helps when
 * it is the problem. The cross has no entry: the clock starts on its first
 * turn, so its looking happens in inspection, outside the solve.
 */
const LOOKING: Record<PhaseGroup, [noun: string, advice: string]> = {
  Cross: ["before its first turn", ""],
  F2L: [
    "between pairs",
    "What usually helps is lookahead: solving deliberately slower, so the next pair is found while the current one is still going in.",
  ],
  OLL: [
    "recognising the case",
    "Drilling recognition of the cases that stall you — the list below — usually helps more than faster algorithms.",
  ],
  PLL: [
    "recognising the case",
    "Drilling recognition of the cases that stall you — the list below — usually helps more than faster algorithms.",
  ],
};

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** "1.2s more turning", or "0.3s less turning" — never "-0.3s more". */
function moreOrLess(ms: number, noun: string): string {
  return `${formatSeconds(Math.abs(ms))} ${ms < 0 ? "less" : "more"} ${noun}`;
}

/** Enough solves that each half of a slow/fast split holds at least five. */
export const MIN_SOLVES_FOR_DECOMPOSITION = 10;

interface LookTurnSample {
  lookMs: number;
  turnMs: number;
  turns: number;
}

/**
 * One solve's looking and turning in `phase`, or null if the solve cannot say.
 *
 * Every split in the phase has to carry a measured recognition — a phase
 * assembled from some measured pairs and some unmeasured ones would report the
 * unmeasured pairs as all turning. Splits recorded before recognition was
 * measured, and hand-marked laps, carry none.
 */
function lookTurnOf(splits: readonly PhaseSplit[], phase: PhaseGroup): LookTurnSample | null {
  const inPhase = splits.filter((s) => groupOf(s.phase) === phase);
  if (inPhase.length === 0 || inPhase.some((s) => s.recognitionMs === undefined)) return null;
  let lookMs = 0;
  let turnMs = 0;
  let turns = 0;
  for (const split of inPhase) {
    lookMs += split.recognitionMs!;
    turnMs += split.durationMs - split.recognitionMs!;
    turns += split.moveCount;
  }
  return { lookMs, turnMs, turns };
}

export interface LookTurn {
  phase: PhaseGroup;
  /** Solves that carry a measured split of this phase. */
  n: number;
  /** Mean per solve. */
  lookMs: number;
  turnMs: number;
  /** Turns per second while actually turning — hand speed with the pauses taken out. */
  turningTps: number;
}

/**
 * Looking and turning in each phase, averaged over the solves that measured it.
 *
 * The cross is left out: its looking happens in inspection, which is never
 * inside the clock, so it would always read as 0.0s looking — a true number that
 * says nothing and invites the wrong conclusion.
 */
export function lookAndTurn(solves: readonly StoredSolve[]): LookTurn[] {
  const out: LookTurn[] = [];
  for (const phase of PHASE_ORDER) {
    if (phase === "Cross") continue;
    const samples = analysable(solves)
      .map((s) => lookTurnOf(s.splits, phase))
      .filter((x): x is LookTurnSample => x !== null);
    if (samples.length < MIN_SOLVES_FOR_DIAGNOSIS) continue;
    const turnMs = samples.reduce((a, x) => a + x.turnMs, 0);
    const turns = samples.reduce((a, x) => a + x.turns, 0);
    out.push({
      phase,
      n: samples.length,
      lookMs: mean(samples.map((x) => x.lookMs)),
      turnMs: mean(samples.map((x) => x.turnMs)),
      turningTps: turnMs > 0 ? turns / (turnMs / 1000) : 0,
    });
  }
  return out;
}

export interface SlowSolves {
  n: number;
  /** Means over every measured solve. */
  lookMs: number;
  turnMs: number;
  /** How much longer the phase takes in the slower half than in the faster. */
  slowerByMs: number;
  /** How much of that difference is looking, and how much turning. They sum to it. */
  fromLookMs: number;
  fromTurnMs: number;
}

/**
 * Where the slow solves lose their time, in one phase.
 *
 * The solves are ranked by how long the phase took and cut in half; the halves'
 * looking and turning are compared. That answers the useful question — what
 * makes a slow solve slow — using nothing but the cuber's own solves: no
 * population norm, no threshold for "too much looking", which there is no data
 * here to set honestly.
 *
 * Comparing looking against turning directly would not do: turning is the larger
 * of the two for almost everyone, so that comparison would name "execution" for
 * nearly every cuber whatever was actually slowing them down.
 */
export function explainSlowSolves(
  solves: readonly StoredSolve[],
  phase: PhaseGroup,
): SlowSolves | null {
  if (phase === "Cross") return null;
  const samples = analysable(solves)
    .map((s) => lookTurnOf(s.splits, phase))
    .filter((x): x is LookTurnSample => x !== null);
  if (samples.length < MIN_SOLVES_FOR_DECOMPOSITION) return null;

  const ranked = [...samples].sort((a, b) => a.lookMs + a.turnMs - (b.lookMs + b.turnMs));
  const half = Math.floor(ranked.length / 2);
  const fast = ranked.slice(0, half);
  const slow = ranked.slice(ranked.length - half);

  const fromLookMs = mean(slow.map((x) => x.lookMs)) - mean(fast.map((x) => x.lookMs));
  const fromTurnMs = mean(slow.map((x) => x.turnMs)) - mean(fast.map((x) => x.turnMs));
  return {
    n: samples.length,
    lookMs: mean(samples.map((x) => x.lookMs)),
    turnMs: mean(samples.map((x) => x.turnMs)),
    slowerByMs: fromLookMs + fromTurnMs,
    fromLookMs,
    fromTurnMs,
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
