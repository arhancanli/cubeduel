import type { PhaseSplit, TimedMove } from "./cfop";
import { countMoves, isRotation } from "./moveStream";

/**
 * Solve review: the solve read back one turn at a time.
 *
 * Chess has game review — every move judged, the better one shown. Cubing has
 * never had the equivalent, because nothing else keeps the turns. This does.
 * It reads the stream for the handful of things a coach would stop the tape at:
 *
 * - **The cross route.** Your cross against the shortest one on the same face,
 *   with the route written out. The only moment here judged against something
 *   other than yourself, and it is judged against a proven optimum.
 * - **Pauses.** A gap several times your ordinary one. Before a phase's first
 *   turn it is looking for the next thing; inside a phase it is losing the thread.
 * - **Turns undone, and the long way round.** R then R'; R R R where R' would do.
 * - **Rotations in F2L.** Each one is a regrip and a fresh look.
 * - **A two-look last layer.** An OLL or PLL that took far more turns than the
 *   one algorithm for that case, which is what doing it in two steps looks like.
 * - **Skips**, which are luck, and credited as such.
 *
 * Every cost is an estimate in your own currency: extra turns are priced at your
 * own pace in that phase, and a pause costs only what it exceeded your ordinary
 * gap by. Nothing is compared with a model of a faster cuber. The one number
 * rolled up from them is called "recoverable", never "wasted" — some of it is
 * the thinking any solve needs.
 */

export interface CrossReference {
  /** Length of the shortest cross on the face actually used, in face turns. */
  moves: number;
  /** One route of that length. */
  solution: string;
  face: string;
}

export interface CaseReference {
  stage: "OLL" | "PLL";
  label: string;
  name: string | null;
  slug: string;
  /** Turns in the one-look algorithm this site teaches for the case. */
  moveCount: number;
}

export interface ReviewInput {
  moves: TimedMove[];
  splits: PhaseSplit[];
  durationMs: number;
  cross?: CrossReference | null;
  oll?: CaseReference | null;
  pll?: CaseReference | null;
}

export type MomentKind =
  | "cross-route"
  | "cross-clean"
  | "pause"
  | "undo"
  | "long-way"
  | "rotations"
  | "two-look"
  | "skip";

export interface Moment {
  kind: MomentKind;
  /** "good" is credit; "cost" is where time went. */
  tone: "good" | "cost";
  phase: string;
  /** Where in the solve to start watching. */
  atMs: number;
  costMs: number;
  title: string;
  detail: string;
  /** Notation worth showing on its own line, e.g. the shorter cross. */
  alg?: string;
  /** Where to practise it. */
  href?: string;
}

export interface MoveReview {
  /** Face turns in the whole solve, merged and cancelled the usual way. */
  turns: number;
  /** The ordinary time between two turns in this solve. */
  typicalGapMs: number;
  moments: Moment[];
  /** Sum of the costs, never more than the solve itself. */
  recoverableMs: number;
}

/** A pause shorter than this is thinking at speed, whatever the ratio says. */
export const PAUSE_FLOOR_MS = 800;
/** …and it must also be this many ordinary gaps long. */
export const PAUSE_RATIO = 4;
export const MAX_PAUSES = 3;
/** A cross this many turns over the shortest is worth a look at the route. */
export const CROSS_SLACK = 2;

interface Turn {
  move: string;
  atMs: number;
  layer: string;
  quarters: number;
}

function parse(move: string): { layer: string; quarters: number } {
  const layer = move.replace(/['2]+$/, "");
  const quarters = move.endsWith("2") ? 2 : move.endsWith("'") ? 3 : 1;
  return { layer, quarters };
}

function inverseOf(move: string): string {
  const { layer, quarters } = parse(move);
  return quarters === 1 ? `${layer}'` : quarters === 3 ? layer : `${layer}2`;
}

/**
 * The phase a moment belongs to. A phase runs from the previous phase's last
 * turn (exclusive) to its own last turn (inclusive); the first turn of the solve
 * belongs to the first phase.
 */
function phaseOf(splits: readonly PhaseSplit[], atMs: number): string {
  for (const split of splits) {
    if (atMs <= split.endMs) return split.phase;
  }
  return splits.length > 0 ? splits[splits.length - 1].phase : "Solve";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function turnsIn(moves: readonly TimedMove[], splits: readonly PhaseSplit[], phase: string): TimedMove[] {
  return moves.filter((m) => !isRotation(m.move) && phaseOf(splits, m.atMs) === phase);
}

export function reviewMoves(input: ReviewInput): MoveReview {
  const { moves, splits, durationMs } = input;
  const turns: Turn[] = moves
    .filter((m) => !isRotation(m.move))
    .map((m) => ({ ...m, ...parse(m.move) }));

  if (turns.length === 0) {
    return { turns: 0, typicalGapMs: 0, moments: [], recoverableMs: 0 };
  }

  // The ordinary gap: between consecutive turns of the same phase. The gap
  // before a phase's first turn is left out — that is the looking.
  const inPhaseGaps: number[] = [];
  for (let i = 1; i < turns.length; i++) {
    if (phaseOf(splits, turns[i].atMs) === phaseOf(splits, turns[i - 1].atMs)) {
      inPhaseGaps.push(turns[i].atMs - turns[i - 1].atMs);
    }
  }
  const typical = median(inPhaseGaps);
  const moments: Moment[] = [];

  // --- Pauses -----------------------------------------------------------------
  const threshold = Math.max(PAUSE_FLOOR_MS, typical * PAUSE_RATIO);
  const pauses: Moment[] = [];
  for (let i = 1; i < turns.length; i++) {
    const gap = turns[i].atMs - turns[i - 1].atMs;
    if (gap < threshold) continue;
    const phase = phaseOf(splits, turns[i].atMs);
    const opensPhase = phaseOf(splits, turns[i - 1].atMs) !== phase;
    pauses.push({
      kind: "pause",
      tone: "cost",
      phase,
      atMs: turns[i - 1].atMs,
      costMs: gap - typical,
      title: opensPhase ? `${seconds(gap)} before ${phase}` : `${seconds(gap)} pause in ${phase}`,
      detail: opensPhase
        ? `Looking for what to do next. Your ordinary gap between turns is ${seconds(typical)}; the rest of this is recognition you could do while finishing ${phaseBefore(splits, phase) ?? "the previous step"}.`
        : `The hands stopped mid-${phase}. Usually a lost piece or a changed plan — watch what the cube looked like here.`,
    });
  }
  pauses.sort((a, b) => b.costMs - a.costMs);
  moments.push(...pauses.slice(0, MAX_PAUSES));

  // --- Undone turns and the long way round -----------------------------------
  // Consecutive in the full stream: a rotation in between means the second turn
  // is on a different physical layer, so nothing was undone.
  for (let i = 0; i < moves.length - 1; i++) {
    const a = moves[i];
    const b = moves[i + 1];
    if (isRotation(a.move) || isRotation(b.move)) continue;
    const pa = parse(a.move);
    const pb = parse(b.move);
    if (pa.layer !== pb.layer) continue;

    if (pa.quarters !== 2 && b.move === inverseOf(a.move)) {
      const before = i > 0 ? moves[i - 1].atMs : a.atMs;
      const from = phaseOf(splits, a.atMs);
      const to = phaseOf(splits, b.atMs);
      // Across a phase boundary this is not a misread: one algorithm ended on
      // the turn the next one starts by undoing. Knowing the next case before
      // the first finishes removes both — "cancelling into" it.
      const seam = from !== to;
      moments.push({
        kind: "undo",
        tone: "cost",
        phase: from,
        atMs: a.atMs,
        costMs: Math.max(0, b.atMs - before),
        title: seam ? `${a.move} then ${b.move} — ${from} and ${to} cancel` : `${a.move} then ${b.move} — undone`,
        detail: seam
          ? `The last turn of ${from} and the first of ${to} undo each other. Recognising the next case before ${from} finishes lets you leave both out — cubers call it cancelling into the next algorithm.`
          : "Two turns that cancel. Usually a misread piece: the fix is looking one turn further before starting.",
      });
      continue;
    }

    const c = moves[i + 2];
    if (
      c &&
      !isRotation(c.move) &&
      pa.quarters !== 2 &&
      a.move === b.move &&
      b.move === c.move
    ) {
      moments.push({
        kind: "long-way",
        tone: "cost",
        phase: phaseOf(splits, a.atMs),
        atMs: a.atMs,
        costMs: Math.max(0, c.atMs - a.atMs),
        title: `${a.move} ${a.move} ${a.move} — ${inverseOf(a.move)} is one turn`,
        detail: "Three quarter turns one way land where a single turn the other way would.",
      });
      i += 2;
    }
  }

  // --- Rotations in F2L -----------------------------------------------------
  const f2lRotations = moves
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => isRotation(m.move) && phaseOf(splits, m.atMs).startsWith("F2L"));
  if (f2lRotations.length >= 2) {
    let cost = 0;
    for (const { i } of f2lRotations) {
      const prev = [...moves.slice(0, i)].reverse().find((m) => !isRotation(m.move));
      const next = moves.slice(i + 1).find((m) => !isRotation(m.move));
      if (prev && next) cost += Math.max(0, next.atMs - prev.atMs - typical);
    }
    const first = f2lRotations[0].m;
    moments.push({
      kind: "rotations",
      tone: "cost",
      phase: phaseOf(splits, first.atMs),
      atMs: first.atMs,
      costMs: cost,
      title: `${f2lRotations.length} rotations during F2L`,
      detail:
        "Every rotation is a regrip and a fresh look at a cube that has just moved. Solving back-slot pairs from where they are, rather than turning the cube to face them, removes most of them.",
    });
  }

  // --- The cross route --------------------------------------------------------
  const crossSplit = splits.find((s) => s.phase === "Cross");
  if (input.cross && crossSplit) {
    const crossTurns = turnsIn(moves, splits, "Cross").map((m) => m.move);
    const yours = countMoves(crossTurns);
    const extra = yours - input.cross.moves;
    if (yours > 0 && extra >= CROSS_SLACK) {
      const perTurn = crossSplit.durationMs / yours;
      moments.push({
        kind: "cross-route",
        tone: "cost",
        phase: "Cross",
        atMs: 0,
        costMs: extra * perTurn,
        title: `Cross in ${yours} — the shortest was ${input.cross.moves}`,
        detail: `On the same face, from the same scramble, held the way the scramble was written. Planning the whole cross in inspection is what gets a cross this short.`,
        alg: input.cross.solution,
      });
    } else if (yours > 0) {
      moments.push({
        kind: "cross-clean",
        tone: "good",
        phase: "Cross",
        atMs: 0,
        costMs: 0,
        title:
          extra <= 0
            ? `Cross in ${yours} — as short as it gets`
            : `Cross in ${yours} — one off the shortest`,
        detail: "A planned cross. Nothing to find here.",
      });
    }
  }

  // --- The last layer -----------------------------------------------------------
  for (const ref of [input.oll, input.pll]) {
    if (!ref) continue;
    const split = splits.find((s) => s.phase === ref.stage);
    if (!split) continue;
    const phaseTurns = turnsIn(moves, splits, ref.stage).map((m) => m.move);
    const yours = countMoves(phaseTurns);
    const margin = Math.max(4, Math.ceil(ref.moveCount / 2));
    if (yours >= ref.moveCount + margin) {
      const perTurn = split.durationMs / yours;
      const caseName = ref.name ? `${ref.label} (${ref.name})` : ref.label;
      moments.push({
        kind: "two-look",
        tone: "cost",
        phase: ref.stage,
        atMs: split.startMs,
        costMs: (yours - ref.moveCount) * perTurn,
        title: `${ref.stage} took ${yours} turns — ${caseName} is ${ref.moveCount} in one look`,
        detail: `That is what a two-step ${ref.stage} looks like. This case is worth learning on its own.`,
        href: `/learn/${ref.slug}`,
      });
    }
  }

  // --- Skips ------------------------------------------------------------------
  const lastPair = [...splits].reverse().find((s) => s.phase.startsWith("F2L"));
  if (lastPair && !splits.some((s) => s.phase === "OLL") && splits.some((s) => s.phase === "PLL")) {
    moments.push({
      kind: "skip",
      tone: "good",
      phase: "OLL",
      atMs: lastPair.endMs,
      costMs: 0,
      title: "OLL skip",
      detail: "The last layer was already oriented when the last pair went in. Luck, and worth enjoying.",
    });
  }
  const pllSplit = splits.find((s) => s.phase === "PLL");
  if (pllSplit && countMoves(turnsIn(moves, splits, "PLL").map((m) => m.move)) <= 1) {
    moments.push({
      kind: "skip",
      tone: "good",
      phase: "PLL",
      atMs: pllSplit.startMs,
      costMs: 0,
      title: "PLL skip",
      detail: "Solved with at most a turn of the top layer. Luck, and worth enjoying.",
    });
  }

  moments.sort((a, b) => a.atMs - b.atMs);
  const total = moments.reduce((sum, m) => sum + (m.tone === "cost" ? m.costMs : 0), 0);

  return {
    turns: countMoves(turns.map((t) => t.move)),
    typicalGapMs: typical,
    moments,
    recoverableMs: Math.min(total, Math.max(0, durationMs)),
  };
}

function phaseBefore(splits: readonly PhaseSplit[], phase: string): string | null {
  const i = splits.findIndex((s) => s.phase === phase);
  return i > 0 ? splits[i - 1].phase : null;
}
