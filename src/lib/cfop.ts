/**
 * Splitting a solve into its phases — cross, each F2L pair, OLL, PLL.
 *
 * This is the difference between "you took 22 seconds" and "F2L pair 3 costs you
 * 2.1s every solve". A total time tells a cuber nothing they can act on; a phase
 * breakdown tells them exactly what to drill, which is the whole reason to record
 * moves at all.
 *
 * Nothing here hardcodes piece indices. The groups are derived from the puzzle
 * definition by intersecting which pieces each face turn disturbs — the DFR corner
 * is the only corner moved by all of D, F and R; the FR edge is the only edge moved
 * by both F and R. If cubing.js ever renumbers its orbits, this keeps working.
 */

import { ollCaseId, pllCaseId } from "./lastLayer";

const SOLVED_OPTIONS = {
  ignorePuzzleOrientation: true,
  ignoreCenterOrientation: true,
};

interface OrbitData {
  pieces: number[];
  orientation: number[];
}

interface Pattern {
  patternData: Record<string, OrbitData>;
  applyMove(move: string): Pattern;
  applyAlg(alg: string): Pattern;
  experimentalIsSolved(options: typeof SOLVED_OPTIONS): boolean;
}

interface KPuzzleLike {
  defaultPattern(): Pattern;
}

const ROTATION_FAMILIES = new Set(["x", "y", "z"]);

function family(move: string): string {
  return move.replace(/^\d*/, "").replace(/['2]+$/, "");
}

export function isRotationMove(move: string): boolean {
  return ROTATION_FAMILIES.has(family(move));
}

function invertMove(move: string): string {
  if (move.endsWith("2")) return move;
  if (move.endsWith("'")) return move.slice(0, -1);
  return `${move}'`;
}

/** Reverse order, each move inverted — the standard alg inverse. */
function invertAlg(moves: readonly string[]): string {
  return moves.slice().reverse().map(invertMove).join(" ");
}

/** Indices in `orbit` that a single turn of `move` disturbs. */
function disturbedBy(solved: Pattern, move: string, orbit: string): Set<number> {
  const after = solved.applyMove(move);
  const a = solved.patternData[orbit];
  const b = after.patternData[orbit];
  const out = new Set<number>();
  for (let i = 0; i < a.pieces.length; i++) {
    if (a.pieces[i] !== b.pieces[i] || a.orientation[i] !== b.orientation[i]) out.add(i);
  }
  return out;
}

function intersect(...sets: Set<number>[]): number[] {
  const [first, ...rest] = sets;
  return [...first].filter((v) => rest.every((s) => s.has(v)));
}

export interface PieceGroups {
  /** The face the cross is built on, e.g. "D". */
  crossFace: string;
  /** The four edges of the cross layer. */
  crossEdges: number[];
  /** One entry per F2L slot: the corner and the edge that belong in it. */
  slots: { name: string; corner: number; edge: number }[];
  lastLayerCorners: number[];
  lastLayerEdges: number[];
}

const OPPOSITE: Record<string, string> = {
  U: "D",
  D: "U",
  R: "L",
  L: "R",
  F: "B",
  B: "F",
};

/** The four side faces around each face, in cyclic order, so adjacent pairs are slots. */
const AROUND: Record<string, string[]> = {
  U: ["F", "R", "B", "L"],
  D: ["F", "R", "B", "L"],
  R: ["U", "F", "D", "B"],
  L: ["U", "F", "D", "B"],
  F: ["U", "R", "D", "L"],
  B: ["U", "R", "D", "L"],
};

export const CROSS_FACES = ["U", "D", "R", "L", "F", "B"];

/**
 * Derives the piece groups for a cross built on `crossFace`.
 *
 * Cubers do not all build on the same face — white-on-bottom and white-on-top are
 * both completely normal, and colour-neutral solvers pick whichever cross is easiest
 * for the scramble in front of them. Hard-coding one face made the analysis silently
 * wrong for everyone else, so the face is a parameter and the caller works out which
 * one the solve actually used.
 *
 * Nothing is hardcoded beyond the face names: the pieces are found by intersecting
 * which pieces each turn disturbs. The DFR corner is the only corner moved by all of
 * D, F and R; the FR edge is the only edge moved by both F and R.
 */
export function derivePieceGroups(solved: Pattern, crossFace = "D"): PieceGroups {
  const cornersBy: Record<string, Set<number>> = {};
  const edgesBy: Record<string, Set<number>> = {};
  for (const move of CROSS_FACES) {
    cornersBy[move] = disturbedBy(solved, move, "CORNERS");
    edgesBy[move] = disturbedBy(solved, move, "EDGES");
  }

  const lastLayer = OPPOSITE[crossFace];
  const around = AROUND[crossFace];

  const slots = around.map((a, i) => {
    const b = around[(i + 1) % around.length];
    const corner = intersect(cornersBy[crossFace], cornersBy[a], cornersBy[b]);
    const edge = intersect(edgesBy[a], edgesBy[b]);
    if (corner.length !== 1 || edge.length !== 1) {
      throw new Error(
        `Could not resolve F2L slot ${a}${b} for cross ${crossFace}: corners=${corner}, edges=${edge}`,
      );
    }
    return { name: `${a}${b}`, corner: corner[0], edge: edge[0] };
  });

  return {
    crossFace,
    crossEdges: [...edgesBy[crossFace]],
    slots,
    lastLayerCorners: [...cornersBy[lastLayer]],
    lastLayerEdges: [...edgesBy[lastLayer]],
  };
}

function pieceSolved(pattern: Pattern, orbit: string, index: number): boolean {
  const o = pattern.patternData[orbit];
  return o.pieces[index] === index && o.orientation[index] === 0;
}

function pieceOriented(pattern: Pattern, orbit: string, index: number): boolean {
  return pattern.patternData[orbit].orientation[index] === 0;
}

/** Booleans describing how far through CFOP a single position is. */
interface Milestones {
  cross: boolean;
  slots: boolean[];
  oll: boolean;
  solved: boolean;
}

function evaluate(pattern: Pattern, groups: PieceGroups): Milestones {
  const cross = groups.crossEdges.every((i) => pieceSolved(pattern, "EDGES", i));
  const slots = groups.slots.map(
    (s) => pieceSolved(pattern, "CORNERS", s.corner) && pieceSolved(pattern, "EDGES", s.edge),
  );
  const f2lDone = cross && slots.every(Boolean);
  // Only meaningful once F2L is in: before then a last-layer slot can hold a piece
  // that belongs elsewhere, and its orientation says nothing about the U face.
  const oll =
    f2lDone &&
    groups.lastLayerCorners.every((i) => pieceOriented(pattern, "CORNERS", i)) &&
    groups.lastLayerEdges.every((i) => pieceOriented(pattern, "EDGES", i));

  return { cross, slots, oll, solved: pattern.experimentalIsSolved(SOLVED_OPTIONS) };
}

export interface PhaseSplit {
  phase: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  moveCount: number;
  tps: number;
}

export interface TimedMove {
  move: string;
  atMs: number;
}

export interface SolveAnalysis {
  splits: PhaseSplit[];
  /** Canonical last-layer case ids, or null when the stage was never reached. */
  ollCase: string | null;
  pllCase: string | null;
  /**
   * Algorithms that reproduce the state the solver faced at each last-layer stage,
   * so the case can be drawn later without storing the whole solve. The trailing
   * inverse-rotation is what makes the drawing match the orientation the case was
   * canonicalised in.
   */
  ollSetup: string | null;
  pllSetup: string | null;
}

const NO_ANALYSIS: SolveAnalysis = {
  splits: [],
  ollCase: null,
  pllCase: null,
  ollSetup: null,
  pllSetup: null,
};

/**
 * An algorithm producing the canonical cube state at timeline index `index`
 * (0 being before any move).
 */
function setupAlgAt(
  scramble: string,
  moves: readonly TimedMove[],
  index: number,
): string {
  const applied = moves.slice(0, index).map((m) => m.move);
  const rotations = applied.filter(isRotationMove);
  const parts = [scramble, ...applied];
  if (rotations.length > 0) parts.push(invertAlg(rotations));
  return parts.filter(Boolean).join(" ");
}

let kpuzzlePromise: Promise<KPuzzleLike> | null = null;
function loadKPuzzle(): Promise<KPuzzleLike> {
  kpuzzlePromise ??= import("cubing/puzzles").then(
    (m) => m.puzzles["3x3x3"].kpuzzle() as unknown as Promise<KPuzzleLike>,
  );
  return kpuzzlePromise;
}

/**
 * Replays a finished solve and returns its phase splits.
 *
 * Analysed after the fact rather than live, so a milestone is recorded at the
 * *last* point it became true. A cuber who breaks an F2L pair and reinserts it
 * finished that pair on the second attempt, and a live detector would credit the
 * first and report nonsense.
 *
 * Rotations are undone before every check. Cubers rotate constantly during F2L, and
 * without this the "cross edges" would stop referring to the pieces they actually
 * solved the moment the cube was turned in their hands.
 */
interface Candidate extends SolveAnalysis {
  crossFace: string;
  /** How far through CFOP this reading of the solve gets. */
  score: number;
  /** Where the cross landed. */
  crossAt: number;
  /** Where every F2L slot was in at once — the strongest signal of the real cross. */
  f2lAt: number;
}

/** Reads one solve under one assumption about which face the cross was built on. */
function interpret(
  scramble: string,
  moves: readonly TimedMove[],
  patterns: readonly Pattern[],
  groups: PieceGroups,
): Candidate {
  const timeline = patterns.map((p) => evaluate(p, groups));
  const empty: Candidate = {
    ...NO_ANALYSIS,
    crossFace: groups.crossFace,
    score: 0,
    crossAt: Number.MAX_SAFE_INTEGER,
    f2lAt: Number.MAX_SAFE_INTEGER,
  };

  const firstAfter = (from: number, pick: (m: Milestones) => boolean): number | null => {
    for (let i = from + 1; i < timeline.length; i++) {
      if (pick(timeline[i])) return i;
    }
    return null;
  };

  /*
   * Milestones are found in order, each searched for only after the previous one,
   * and never re-credited once found.
   *
   * The alternative — taking the last moment each milestone held — is wrong,
   * because OLL and PLL algorithms routinely tear an F2L pair out and put it back.
   * Scanning globally would credit those pairs as being finished during PLL. Once
   * a pair has been inserted, later disturbance is part of a later phase.
   */
  const endAt = moves.length - 1;
  const boundaries: { phase: string; at: number }[] = [];
  let cursor = 0;
  let score = 0;
  let crossAt = 0;

  // A milestone already standing before the first move is not work the solver did.
  if (!timeline[0].cross) {
    const at = firstAfter(cursor, (m) => m.cross);
    if (at === null) return empty;
    boundaries.push({ phase: "Cross", at: at - 1 });
    cursor = at;
    crossAt = at;
  }
  score += 1;

  const pending = new Set(groups.slots.map((_, i) => i).filter((i) => !timeline[cursor].slots[i]));
  let pairNumber = 1;
  while (pending.size > 0) {
    const at = firstAfter(cursor, (m) => [...pending].some((s) => m.slots[s]));
    if (at === null) break;
    for (const s of [...pending]) {
      if (timeline[at].slots[s]) pending.delete(s);
    }
    boundaries.push({ phase: `F2L ${pairNumber++}`, at: at - 1 });
    cursor = at;
    score += 1;
  }

  /*
   * The OLL case has to be read at the moment F2L is *genuinely* complete — every
   * slot in at once.
   *
   * The pair-crediting loop above credits a slot the first instant it looks solved,
   * which can fall in the middle of an insertion while a previously-placed pair is
   * momentarily out. Reading orientation there gives a corner-twist sum no real cube
   * can have, and the case matches nothing. The phase boundaries are left alone —
   * they describe the work — but the case is read from the true completion.
   */
  const f2lCompleteAt =
    timeline[cursor].cross && timeline[cursor].slots.every(Boolean)
      ? cursor
      : firstAfter(cursor, (m) => m.cross && m.slots.every(Boolean));

  const ollCase = f2lCompleteAt !== null ? ollCaseId(patterns[f2lCompleteAt]) : null;
  const ollSetup =
    f2lCompleteAt !== null ? setupAlgAt(scramble, moves, f2lCompleteAt) : null;

  if (!timeline[cursor].oll) {
    const at = firstAfter(cursor, (m) => m.oll);
    if (at !== null) {
      boundaries.push({ phase: "OLL", at: at - 1 });
      cursor = at;
    }
  }
  if (timeline[cursor].oll) score += 1;

  const pllReached = timeline[cursor].oll;
  const pllCase = pllReached ? pllCaseId(patterns[cursor]) : null;
  const pllSetup = pllReached ? setupAlgAt(scramble, moves, cursor) : null;

  const finished = Boolean(timeline[endAt + 1]?.solved);
  if (finished) score += 1;
  boundaries.push({ phase: finished ? "PLL" : "Unfinished", at: endAt });

  const splits: PhaseSplit[] = [];
  let prevIndex = -1;
  let prevMs = 0;

  for (const { phase, at } of boundaries) {
    // A milestone already true at the previous boundary contributes no phase — it
    // happens when a scramble leaves a pair solved, or a pair is finished as a
    // side effect of the previous one.
    if (at <= prevIndex) continue;

    const endMs = moves[at].atMs;
    const durationMs = endMs - prevMs;
    const moveCount = moves
      .slice(prevIndex + 1, at + 1)
      .filter((m) => !isRotationMove(m.move)).length;

    splits.push({
      phase,
      startMs: prevMs,
      endMs,
      durationMs,
      moveCount,
      tps: durationMs > 0 ? moveCount / (durationMs / 1000) : 0,
    });

    prevIndex = at;
    prevMs = endMs;
  }

  return {
    splits,
    ollCase,
    pllCase,
    ollSetup,
    pllSetup,
    crossFace: groups.crossFace,
    score,
    crossAt,
    f2lAt: f2lCompleteAt ?? Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Replays a finished solve and returns its phase splits and last-layer cases.
 *
 * The cross face is *inferred*, not assumed. Cubers do not all build on the same
 * face — white-on-top and white-on-bottom are both ordinary, and colour-neutral
 * solvers choose per scramble. Every face is tried and the reading that gets
 * furthest through CFOP wins, tie-broken by whichever cross was finished earliest.
 * Assuming one face made the analysis confidently wrong for most of the world:
 * it reported a single "Cross" phase covering the entire solve.
 *
 * Analysed after the fact rather than live, so a pair broken and reinserted is
 * credited where the work actually happened. Rotations are undone before every
 * check, because cubers rotate constantly during F2L and the cross edges would
 * otherwise stop referring to the pieces they actually solved.
 */
export async function analyzeSolve(
  scramble: string,
  moves: readonly TimedMove[],
): Promise<SolveAnalysis> {
  if (moves.length === 0) return NO_ANALYSIS;

  const kpuzzle = await loadKPuzzle();
  const solved = kpuzzle.defaultPattern();

  // The move replay is the expensive part, so it happens once and every candidate
  // cross face is evaluated against the same patterns.
  let pattern = scramble ? solved.applyAlg(scramble) : solved;
  const rotations: string[] = [];
  const patterns: Pattern[] = [pattern];

  for (const { move } of moves) {
    pattern = pattern.applyMove(move);
    if (isRotationMove(move)) rotations.push(move);
    const canonical = rotations.length > 0 ? pattern.applyAlg(invertAlg(rotations)) : pattern;
    patterns.push(canonical);
  }

  let best: Candidate | null = null;
  for (const face of CROSS_FACES) {
    const candidate = interpret(scramble, moves, patterns, derivePieceGroups(solved, face));
    if (candidate.score === 0) continue;
    /*
     * Ranked by how early the first two layers were genuinely finished.
     *
     * Raw milestone count is the wrong key: on a *wrong* cross face the pieces
     * still fall into place eventually, and a wrong reading can invent more phases
     * than the true one — a pure-PLL scramble read against the wrong face reports
     * two F2L pairs. What separates the real cross is timing. On the face the
     * solver actually built, F2L is done well before the end; on every other face
     * nothing resolves until the final move solves the whole cube.
     */
    if (
      best === null ||
      candidate.f2lAt < best.f2lAt ||
      (candidate.f2lAt === best.f2lAt && candidate.crossAt < best.crossAt) ||
      (candidate.f2lAt === best.f2lAt &&
        candidate.crossAt === best.crossAt &&
        candidate.score > best.score)
    ) {
      best = candidate;
    }
  }

  if (best === null) return NO_ANALYSIS;
  const { splits, ollCase, pllCase, ollSetup, pllSetup } = best;
  return { splits, ollCase, pllCase, ollSetup, pllSetup };
}
