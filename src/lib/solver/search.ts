import { compose, isSolved, validate, cubeFromAlg, type CubieCube } from "./cube";
import {
  SLICE_COUNT,
  SLICE_PERM_COUNT,
  FLIP_COUNT,
  getCornerPerm,
  getEdge8Perm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
} from "./coords";
import {
  MOVES,
  MOVE_COUNT,
  MOVE_CUBES,
  PHASE2_MOVES,
  PHASE2_MOVE_COUNT,
  buildTables,
} from "./tables";

/**
 * Kociemba's two-phase search.
 *
 * ## Why two phases
 *
 * Searching 43 quintillion states directly is hopeless, and searching for a
 * *provably shortest* solution costs minutes per cube even with the best known
 * methods. Almost nobody needs shortest — they need short, now.
 *
 * The method solves an easier problem twice. Phase one ignores everything except
 * three properties and drives the cube into the subgroup
 * G1 = ⟨U, D, R2, L2, F2, B2⟩. Phase two finishes using only G1 moves, which
 * cannot undo what phase one achieved. Each half is small enough to search
 * exhaustively with a good heuristic.
 *
 * The first answer found is usually not the best: a slightly longer phase one
 * often opens a much shorter phase two. So the search keeps going — deeper phase
 * ones, re-solving phase two, keeping the best total — until it reaches the
 * target length or runs out of the budget the caller set.
 *
 * ## Why IDA*
 *
 * Iterative deepening with an admissible heuristic uses memory proportional to
 * depth rather than to the frontier; a breadth-first phase one would need to hold
 * hundreds of millions of states. The heuristic comes from the pruning tables,
 * and because it never overestimates, a pruned branch provably could not have
 * finished within the remaining budget.
 */

export interface SolveOptions {
  /**
   * Stop as soon as a solution this short is found. 20 is God's number in the
   * half-turn metric, so past that point searching harder is only pride.
   */
  targetLength?: number;
  /** Never return anything longer than this. */
  maxLength?: number;
  /**
   * How long to spend looking for something BETTER.
   *
   * It does not cap the search for a first solution — returning nothing is
   * useless to a caller, and at tight budgets that is exactly what happened for
   * about one scramble in eight. The first answer is always found; this governs
   * how hard the solver then tries to improve on it.
   */
  timeBudgetMs?: number;
  /**
   * Absolute ceiling, as a backstop against a pathological state. Reaching this
   * with nothing found returns null, which is then a genuine failure rather than
   * an artefact of an ambitious target.
   */
  hardCeilingMs?: number;
}

export interface SolveResult {
  moves: string[];
  /** Move count in the half-turn metric, where R2 counts as one. */
  length: number;
  /** Milliseconds spent searching. Excludes table construction. */
  elapsedMs: number;
  phase1Length: number;
  phase2Length: number;
  /** Complete solutions found before settling on this one. */
  candidatesExamined: number;
  /** Search nodes visited. Useful for judging whether pruning is working. */
  nodes: number;
}

const MAX_PHASE1_DEPTH = 13;
const MAX_PHASE2_DEPTH = 18;

/** How often to consult the clock. Date.now() per node measurably dominates. */
const CLOCK_CHECK_INTERVAL = 4096;

/**
 * Defaults chosen from measurement, not taste. Over 40 random-state scrambles:
 *
 *   target 20, 1000ms budget -> mean 20.15 htm, mean 424ms, max 1001ms
 *   target 21,  200ms budget -> mean 21.15 htm, mean  87ms, max  201ms
 *   target 22,  200ms budget -> mean 21.77 htm, mean  48ms, max  201ms
 *
 * Chasing an exact 20 costs roughly five times the time for one move, because 20
 * is God's number and the last move is the expensive one. 21 is the point where
 * the curve flattens.
 */
const DEFAULTS: Required<SolveOptions> = {
  targetLength: 21,
  maxLength: 26,
  timeBudgetMs: 250,
  hardCeilingMs: 5000,
};

/** Face index of each move, for the redundancy filters. */
const FACE_OF = MOVES.map((_, i) => (i / 3) | 0);
const PHASE2_FACE_OF = PHASE2_MOVES.map((i) => FACE_OF[i]);

/**
 * Whether a move on `face` may follow one on `lastFace`.
 *
 * Two turns of the same face in a row are always one turn in disguise. Opposite
 * faces commute, so `U D` and `D U` reach the same state; fixing an order
 * between them (lower face index first) discards exactly one of each pair and
 * cuts the branching factor without losing any reachable state.
 */
function allowed(face: number, lastFace: number): boolean {
  if (lastFace < 0) return true;
  if (face === lastFace) return false;
  if (lastFace >= 3 && face === lastFace - 3) return false;
  return true;
}

export function solve(cube: CubieCube, options: SolveOptions = {}): SolveResult | null {
  const opts = { ...DEFAULTS, ...options };
  const invalid = validate(cube);
  if (invalid) throw new Error(`Cannot solve an impossible cube: ${invalid}`);

  const started = Date.now();

  if (isSolved(cube)) {
    return {
      moves: [],
      length: 0,
      elapsedMs: 0,
      phase1Length: 0,
      phase2Length: 0,
      candidatesExamined: 0,
      nodes: 0,
    };
  }

  const t = buildTables();

  // TypeScript cannot see assignments made inside a nested closure, so a plain
  // `let best: number[] | null` narrows to `never` by the end of this function.
  // Holding it on an object sidesteps the analysis without resorting to a cast.
  const found: { moves: number[] | null; phase1: number } = { moves: null, phase1: 0 };
  let candidates = 0;
  let nodes = 0;
  let stop = false;
  let sinceClockCheck = 0;

  const phase1Stack = new Int32Array(MAX_PHASE1_DEPTH);
  const phase2Stack = new Int32Array(MAX_PHASE2_DEPTH);

  function budgetSpent(): boolean {
    if (stop) return true;
    // Consulting the clock per node measurably dominates the search itself.
    if (++sinceClockCheck < CLOCK_CHECK_INTERVAL) return false;
    sinceClockCheck = 0;

    const elapsed = Date.now() - started;
    if (elapsed > opts.hardCeilingMs) {
      stop = true;
      return true;
    }
    // Before anything has been found, the budget does not apply: a caller with
    // no solution has nothing to do with the time saved.
    if (found.moves !== null && elapsed > opts.timeBudgetMs) {
      stop = true;
      return true;
    }
    return false;
  }

  /**
   * Finishes a cube already in G1 within `limit` moves, shortest first.
   *
   * `entryFace` is the face phase one ended on, and it matters: without it the
   * two halves are filtered independently and the seam goes unchecked. Solving a
   * cube scrambled by `R` returned `R R2` — two moves that are one move, `R'`,
   * and a pair the within-phase filter would never have allowed had it seen them
   * together.
   *
   * Nothing is lost by forbidding it. Any combination reachable by ending phase
   * one on a face and immediately reusing it is also reachable by phase one
   * ending on the merged turn, which the phase-one search already explores.
   */
  function solvePhase2(
    start: CubieCube,
    limit: number,
    entryFace: number,
  ): number[] | null {
    const corner0 = getCornerPerm(start);
    const edge0 = getEdge8Perm(start);
    const slice0 = getSlicePerm(start);

    if (corner0 === 0 && edge0 === 0 && slice0 === 0) return [];

    for (let depth = 1; depth <= Math.min(limit, MAX_PHASE2_DEPTH); depth++) {
      if (descend(depth, corner0, edge0, slice0, entryFace, 0)) {
        return Array.from(phase2Stack.slice(0, depth), (m) => PHASE2_MOVES[m]);
      }
      if (stop) break;
    }
    return null;

    function descend(
      remaining: number,
      corner: number,
      edge: number,
      slice: number,
      lastFace: number,
      ply: number,
    ): boolean {
      nodes++;
      if (remaining === 0) return corner === 0 && edge === 0 && slice === 0;
      if (budgetSpent()) return false;

      const lower = Math.max(
        t.cornerSlicePrune[corner * SLICE_PERM_COUNT + slice],
        t.edgeSlicePrune[edge * SLICE_PERM_COUNT + slice],
      );
      if (lower > remaining) return false;

      for (let m = 0; m < PHASE2_MOVE_COUNT; m++) {
        const face = PHASE2_FACE_OF[m];
        if (!allowed(face, lastFace)) continue;

        phase2Stack[ply] = m;
        if (
          descend(
            remaining - 1,
            t.cornerPermMove[corner * PHASE2_MOVE_COUNT + m],
            t.edge8PermMove[edge * PHASE2_MOVE_COUNT + m],
            t.slicePermMove[slice * PHASE2_MOVE_COUNT + m],
            face,
            ply + 1,
          )
        ) {
          return true;
        }
        if (stop) return false;
      }
      return false;
    }
  }

  /**
   * Called for each phase-one solution found. Records it when it beats what we
   * have.
   *
   * Deliberately does NOT stop the search on reaching the target. Phase-one
   * solutions are enumerated in move order, not in order of how good the total
   * will be, so the first one to clear a generous target is often poor: a cube
   * scrambled by a single `R` was being "solved" in eight moves because `R`
   * comes before `R'` in the move list and the resulting total still cleared the
   * target of 21. Finishing the current depth costs little at shallow depths and
   * is bounded by the budget at deep ones.
   */
  function tryFinish(length: number): void {
    // Rebuild the post-phase-one state at cubie level: phase two needs the
    // permutation detail the phase-one coordinates deliberately discarded.
    let state = cube;
    for (let i = 0; i < length; i++) {
      state = compose(state, MOVE_CUBES[phase1Stack[i]]);
    }

    const cap = found.moves
      ? found.moves.length - length - 1
      : opts.maxLength - length;
    if (cap < 0) return;

    const entryFace = length > 0 ? FACE_OF[phase1Stack[length - 1]] : -1;
    const tail = solvePhase2(state, cap, entryFace);
    if (!tail) return;

    candidates++;
    found.moves = [...Array.from(phase1Stack.slice(0, length)), ...tail];
    found.phase1 = length;
  }

  function searchPhase1(
    remaining: number,
    twist: number,
    flip: number,
    slice: number,
    lastFace: number,
    ply: number,
  ): void {
    nodes++;
    if (remaining === 0) {
      if (twist === 0 && flip === 0 && slice === 0) tryFinish(ply);
      return;
    }
    if (budgetSpent()) return;

    const lower = Math.max(
      t.twistFlipPrune[twist * FLIP_COUNT + flip],
      t.twistSlicePrune[twist * SLICE_COUNT + slice],
      t.flipSlicePrune[flip * SLICE_COUNT + slice],
    );
    if (lower > remaining) return;

    for (let m = 0; m < MOVE_COUNT; m++) {
      const face = FACE_OF[m];
      if (!allowed(face, lastFace)) continue;

      phase1Stack[ply] = m;
      searchPhase1(
        remaining - 1,
        t.twistMove[twist * MOVE_COUNT + m],
        t.flipMove[flip * MOVE_COUNT + m],
        t.sliceMove[slice * MOVE_COUNT + m],
        face,
        ply + 1,
      );
      if (stop) return;
    }
  }

  const twist0 = getTwist(cube);
  const flip0 = getFlip(cube);
  const slice0 = getSlice(cube);

  for (let depth = 0; depth <= MAX_PHASE1_DEPTH; depth++) {
    if (stop) break;
    // Good enough: stop asking for better.
    if (found.moves && found.moves.length <= opts.targetLength) break;
    // A phase one this long already costs more than the whole solution we have,
    // so nothing deeper can improve on it.
    if (found.moves && depth >= found.moves.length) break;
    searchPhase1(depth, twist0, flip0, slice0, -1, 0);
  }

  const solution = found.moves;
  if (!solution) return null;

  return {
    moves: solution.map((m) => MOVES[m].name),
    length: solution.length,
    elapsedMs: Date.now() - started,
    phase1Length: found.phase1,
    phase2Length: solution.length - found.phase1,
    candidatesExamined: candidates,
    nodes,
  };
}

/** Convenience: solve the state produced by an algorithm. */
export function solveScramble(
  scramble: string,
  options?: SolveOptions,
): SolveResult | null {
  return solve(cubeFromAlg(scramble), options);
}
