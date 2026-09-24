import type { EventId } from "./events";
import type { StoredSolve } from "./solveHistory";
import { groupSplits, PHASE_ORDER } from "./phaseStats";
import { eventOf, splitLabelsFor } from "./timerEvents";
import { FACE_COLOUR, shortestCross } from "./solveStudy";

/**
 * A review for a solve timed on a real cube.
 *
 * Such a solve has no turns to read back, but it is not nothing. It has a
 * scramble, and the best cross in that scramble can be worked out exactly. And
 * if the phases were split, each one can be set against the same phase in your
 * own recent solves — which is the only fair comparison: a phase is slow for
 * you, not slow in general.
 */

/** Solves needed, besides this one, before a phase is called slow or fast. */
export const MIN_OTHERS = 5;
/**
 * The smallest difference worth naming, as a share of your usual. Very steady
 * solves have almost no spread, and a hundredth of a second outside it is
 * still nothing anybody could act on.
 */
const MIN_SHARE = 0.1;
/** How far back "your usual" reaches. */
const RECENT = 50;

export type PhaseVerdict = "slower" | "faster" | "usual" | "unknown";

export interface PhaseReview {
  phase: string;
  ms: number;
  /** Your mean for this phase over recent solves; null below the minimum sample. */
  usualMs: number | null;
  verdict: PhaseVerdict;
}

export interface SplitReview {
  phases: PhaseReview[];
  /** The phase furthest above your usual, if any was outside your normal spread. */
  costliest: string | null;
  /** How many solves "your usual" is made of. */
  sample: number;
}

/** The phases a solve of this puzzle is read in. */
function phasesOf(event: EventId): readonly string[] {
  return event === "333" ? PHASE_ORDER : splitLabelsFor(event);
}

function complete(solve: StoredSolve, phases: readonly string[]): Map<string, number> | null {
  if (solve.penalty === "DNF" || solve.splits.length === 0 || phases.length === 0) return null;
  let groups: Map<string, number>;
  if (eventOf(solve) === "333") {
    // A stream-read 3x3 solve splits F2L into its four pairs; they are one phase here.
    groups = groupSplits(solve.splits);
  } else {
    groups = new Map();
    for (const s of solve.splits) groups.set(s.phase, (groups.get(s.phase) ?? 0) + s.durationMs);
  }
  return phases.every((p) => groups.has(p)) ? groups : null;
}

/**
 * Each phase of `solve` against the same phase over your other recent solves.
 *
 * "Slower" and "faster" mean more than one standard deviation from your mean,
 * and at least a tenth of it: inside that, the difference is the ordinary
 * wobble between solves, and calling it out would be reading tea leaves.
 */
export function reviewSplits(solve: StoredSolve, history: readonly StoredSolve[]): SplitReview | null {
  const event = eventOf(solve);
  const order = phasesOf(event);
  const mine = complete(solve, order);
  if (!mine) return null;

  // Only the same puzzle: a 5x5's centres say nothing about a 3x3's cross.
  const others = history
    .filter((s) => s.id !== solve.id && eventOf(s) === event)
    .map((s) => complete(s, order))
    .filter((g): g is Map<string, number> => g !== null)
    .slice(-RECENT);
  const judged = others.length >= MIN_OTHERS;

  const phases = order.map((phase): PhaseReview => {
    const ms = mine.get(phase)!;
    if (!judged) return { phase, ms, usualMs: null, verdict: "unknown" };
    const xs = others.map((g) => g.get(phase)!);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1));
    const band = Math.max(sd, mean * MIN_SHARE);
    const verdict = ms > mean + band ? "slower" : ms < mean - band ? "faster" : "usual";
    return { phase, ms, usualMs: Math.round(mean), verdict };
  });

  let costliest: string | null = null;
  let worst = 0;
  for (const p of phases) {
    if (p.verdict !== "slower" || p.usualMs === null) continue;
    if (p.ms - p.usualMs > worst) {
      worst = p.ms - p.usualMs;
      costliest = p.phase;
    }
  }

  return { phases, costliest, sample: others.length };
}

export interface CrossOption {
  face: string;
  colour: string;
  moves: number;
  solution: string;
}

const FACES = ["U", "D", "F", "B", "R", "L"];

/**
 * The shortest cross on each of the six faces, shortest first.
 *
 * White first among equals: it is the cross most people build, so if it is as
 * good as any, that is the one worth showing.
 */
export async function crossOptions(scramble: string): Promise<CrossOption[]> {
  const found = await Promise.all(FACES.map((face) => shortestCross(scramble, face)));
  return found
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({ face: c.face, colour: FACE_COLOUR[c.face], moves: c.moves, solution: c.solution }))
    .sort((a, b) => a.moves - b.moves || FACES.indexOf(a.face) - FACES.indexOf(b.face));
}

const TURNED_OVER: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "F", B: "B" };

/**
 * A route written with white on top, rewritten for the cube turned over — white
 * down, green still in front, which is how most people build a cross.
 *
 * Turning over like that (z2) swaps top with bottom and right with left, and
 * keeps each turn's direction: a clockwise turn of a face is still clockwise
 * looking at that face.
 */
export function turnOver(route: string): string {
  return route
    .split(/\s+/)
    .filter(Boolean)
    .map((m) => (TURNED_OVER[m[0]] ?? m[0]) + m.slice(1))
    .join(" ");
}
