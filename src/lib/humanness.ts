import type { SubmittedMove } from "./verifySolve";

/**
 * Whether a solve looks like a person did it.
 *
 * Verification proves a move stream really solves the scramble it was issued
 * for. It cannot prove a human produced it: a program that solves the cube and
 * replays the answer at a believable speed passes every check in
 * `verifySolve.ts`, and always will. This is the layer that looks at *how* the
 * moves arrived rather than whether they work.
 *
 * ## What this is not
 *
 * It is not proof, and nothing here bans anybody. Every signal below is
 * evidence with a false-positive story attached, and the output is a score and a
 * list of reasons for a human to read. A ladder that auto-banned on a statistic
 * would eventually throw out a real player having an extraordinary solve, and
 * that is a worse failure than missing a cheat — the cheat costs one rating, the
 * false ban costs the belief the whole thing runs on.
 *
 * ## The signals, and why they are hard to fake together
 *
 * **Move count.** A human solving 3x3 with CFOP takes somewhere near 55 moves.
 * Getting under about 30 while racing a clock is not a talented human, it is a
 * search. This is the strongest single signal and the one a cheat trips first,
 * because the obvious way to cheat is to replay an engine's answer — and an
 * engine's answer is 20 moves.
 *
 * **Pauses.** People stop. They stop to find the next pair, they stop to
 * recognise the last layer, and those stops are long relative to their turning.
 * A replayed solution has no reason to pause, so its inter-move gaps cluster
 * tightly around one value. Measured as the spread of the gaps and the size of
 * the largest one.
 *
 * **Rhythm.** Even during a burst, human turning speed wanders — fingers,
 * grip changes, a cube that catches. Perfectly even spacing is a metronome, and
 * the cheapest cheat to write is a metronome.
 *
 * Any one of these can be explained away. A short solve happens when the
 * scramble is kind. A low-pause solve happens on a well-known case somebody has
 * drilled a thousand times. What is genuinely hard is producing all three
 * signatures at once while also being fast, and that is what the combined score
 * looks for.
 */

/** Under this many moves, a 3x3 speedsolve stops being humanly plausible. */
export const IMPLAUSIBLY_SHORT_MOVES = 30;

/** A typical CFOP solve, for scale. */
export const TYPICAL_HUMAN_MOVES = 55;

export interface HumannessSignal {
  key: "moveCount" | "pauseSpread" | "longestPause" | "rhythm";
  /** 0 = looks human, 1 = looks generated. */
  score: number;
  detail: string;
}

export interface HumannessReport {
  /** 0 = nothing unusual, 1 = every signal maxed. */
  score: number;
  signals: HumannessSignal[];
  /** Written for a person reviewing a flagged result. */
  reasons: string[];
  /** True when there was not enough to say anything. */
  inconclusive: boolean;
}

/** Milliseconds between consecutive turns. */
function gaps(moves: readonly SubmittedMove[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    const gap = moves[i].atMs - moves[i - 1].atMs;
    // Non-monotonic timestamps are a broken client, not evidence of anything.
    if (gap >= 0) out.push(gap);
  }
  return out;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Coefficient of variation — spread relative to size.
 *
 * Used rather than the raw standard deviation because it has to compare a
 * six-second solver with a forty-second one, and a fast solver's gaps are
 * smaller in absolute terms without being any more even.
 */
function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

/** Maps a value to 0..1 across a range, flat outside it. */
function ramp(value: number, humanAt: number, machineAt: number): number {
  if (humanAt === machineAt) return 0;
  const t = (value - humanAt) / (machineAt - humanAt);
  return Math.min(1, Math.max(0, t));
}

export function assessHumanness(
  moves: readonly SubmittedMove[],
  durationMs: number,
): HumannessReport {
  const turns = moves.filter((m) => !/^\d*[xyz]/i.test(m.move));

  // Too little to say anything. Saying so is the honest answer; scoring it zero
  // would let a two-move stream read as "looks human".
  if (turns.length < 8 || durationMs <= 0) {
    return { score: 0, signals: [], reasons: [], inconclusive: true };
  }

  const g = gaps(turns);
  const med = median(g);
  const spread = coefficientOfVariation(g);
  const longest = med > 0 ? Math.max(...g) / med : 0;

  const signals: HumannessSignal[] = [
    {
      key: "moveCount",
      // 55 moves is ordinary CFOP; 30 is where a human stops being a plausible
      // explanation; 20 is what this repository's own solver returns.
      score: ramp(turns.length, TYPICAL_HUMAN_MOVES * 0.75, 20),
      detail: `${turns.length} turns (a CFOP solve is around ${TYPICAL_HUMAN_MOVES})`,
    },
    {
      key: "pauseSpread",
      // Human gap distributions are heavy-tailed: mostly quick turns with
      // recognition pauses mixed in. Below ~0.35 the turning is suspiciously even.
      score: ramp(spread, 0.55, 0.12),
      detail: `gap spread ${spread.toFixed(2)} (people vary; metronomes do not)`,
    },
    {
      key: "longestPause",
      // Almost every human solve contains at least one pause several times the
      // median — finding a pair, recognising the last layer.
      score: ramp(longest, 3, 1.2),
      detail: `longest pause ${longest.toFixed(1)}x the median gap`,
    },
    {
      key: "rhythm",
      // Turn rate itself. Above roughly 12 turns per second sustained across a
      // whole solve is beyond hands, without being so extreme that the hard
      // limit in `verifySolve` would already have refused it.
      score: ramp(turns.length / (durationMs / 1000), 9, 16),
      detail: `${(turns.length / (durationMs / 1000)).toFixed(1)} turns per second`,
    },
  ];

  // The maximum rather than the mean, because these are alternative ways of
  // being impossible rather than parts of one measurement. A twenty-move solve
  // is damning whatever its rhythm looked like, and averaging would let three
  // ordinary signals dilute one that is conclusive.
  const score = Math.max(...signals.map((s) => s.score));

  const reasons = signals
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.detail);

  return { score, signals, reasons, inconclusive: false };
}

/**
 * Where the line sits.
 *
 * Deliberately high. Everything below it is left alone, because the cost of
 * being wrong is asymmetric: missing a cheat costs one rating, and wrongly
 * flagging a real player costs the belief that the ladder is worth playing.
 */
export const REVIEW_THRESHOLD = 0.8;

export function needsReview(report: HumannessReport): boolean {
  return !report.inconclusive && report.score >= REVIEW_THRESHOLD;
}

/**
 * The score to store against a solve, or null when there is not enough to say.
 *
 * Null rather than zero for a short stream: zero would claim it looked human,
 * which is a claim nothing measured.
 */
export function humannessOf(
  moves: readonly SubmittedMove[],
  durationMs: number,
): number | null {
  const report = assessHumanness(moves, durationMs);
  return report.inconclusive ? null : Number(report.score.toFixed(4));
}
