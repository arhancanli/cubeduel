import { cloneCube, isSolved, multiply, validate, cubeFromAlg, type CubieCube } from "./cube";
import {
  SLICE_COUNT,
  SLICE_PERM_COUNT,
  FLIP_COUNT,
  TWIST_COUNT,
  getCornerPerm,
  getEdge8Perm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
} from "./coords";
import { UD_SYMMETRY_COUNT } from "./phase1Table";
import { directionsOf } from "./symmetry";
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
   * Stop as soon as a solution this short is found. Not a bound on what exists:
   * God's number, 20, is the WORST case, and a random cube's true minimum is 17
   * or 18 moves about 95% of the time. The target is how hard to try, traded
   * against time — see the measurements on DEFAULTS.
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
  /**
   * How many views of the cube to search: 1 is the cube as given; 6 adds it
   * turned a third and two thirds of the way round its URF-DBL diagonal, and all
   * three inverted (see `symmetry.ts`). The views share one best-so-far and one
   * clock, so six costs no more time than one — it spends it where the cube is
   * easiest.
   */
  directions?: 1 | 6;
  /**
   * Whether to use the exact phase-one table when it is loaded. True unless
   * asked otherwise.
   *
   * Exists so both paths can be run on purpose. The table is generated, so
   * whether it is there varies by machine, and "whichever the file system
   * happens to offer" is not a thing to test or measure against — the fallback
   * has to be exercised deliberately or it rots unnoticed.
   */
  exactTable?: boolean;
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
  /**
   * Which view of the cube the returned solution was found from. The phase
   * lengths above describe the search in THAT view: for an inverted one, the
   * returned moves are its phase two reversed, followed by its phase one.
   */
  direction: { rotation: 0 | 1 | 2; inverted: boolean };
}

const MAX_PHASE1_DEPTH = 13;
const MAX_PHASE2_DEPTH = 18;

/** How often to consult the clock. Date.now() per node measurably dominates. */
const CLOCK_CHECK_INTERVAL = 4096;

/**
 * Defaults chosen from measurement, not taste. Over 200 uniformly random states,
 * searching from all six sides, with the exact phase-one table loaded
 * (`scripts/bench-solver.mts`):
 *
 *   target 21, 250ms budget -> mean 20.55 htm, median  6ms, p95  27ms
 *   target 20, 150ms budget -> mean 19.70 htm, median  8ms, p95  39ms
 *   target 19, 450ms budget -> mean 18.93 htm, median 27ms, p95 451ms
 *   target 18, 450ms budget -> mean 18.66 htm — the budget, nearly every time
 *
 * Twenty at 150ms is the default: it is a whole move shorter than the old
 * default of 21 and no slower, which is what the exact table bought. Wanting
 * one move better than that costs roughly ten times the time, because the
 * search has to enumerate a great many more phase ones to find the one whose
 * phase two is short.
 *
 * These are also the numbers with the table. Without it — it is generated, and
 * a caller may not have it — the same settings give 19.81 at 33ms, and the gap
 * widens the harder the target: 19.15 against 18.93 at target 19. The default
 * is chosen to be sensible either way.
 *
 * The duel opponent solves at these defaults while a player waits, so its
 * ceiling is what matters there; the server, which computes each answer once
 * for everybody and caches it, takes 19 (see `server/solveService.ts`).
 */
const DEFAULTS: Required<SolveOptions> = {
  targetLength: 20,
  maxLength: 26,
  timeBudgetMs: 150,
  hardCeilingMs: 5000,
  directions: 6,
  exactTable: true,
};

/** Face index of each move, for the redundancy filters. */
const FACE_OF = MOVES.map((_, i) => (i / 3) | 0);

/** Whether each move is one phase two may make — a generator of G1. */
const IS_PHASE2_MOVE = MOVES.map((_, i) => PHASE2_MOVES.includes(i));
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
      direction: { rotation: 0, inverted: false },
    };
  }

  const t = buildTables();

  // TypeScript cannot see assignments made inside a nested closure, so a plain
  // `let best: number[] | null` narrows to `never` by the end of this function.
  // Holding it on an object sidesteps the analysis without resorting to a cast.
  //
  // One best-so-far for every direction: a solution found looking at the cube
  // from one side immediately tightens the bound every other side searches under.
  const found: {
    moves: number[] | null;
    phase1: number;
    direction: { rotation: 0 | 1 | 2; inverted: boolean };
  } = { moves: null, phase1: 0, direction: { rotation: 0, inverted: false } };
  let candidates = 0;
  let nodes = 0;
  let stop = false;
  let sinceClockCheck = 0;

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
   * The two-phase search for one view of the cube. Each view keeps its own
   * stacks and starting coordinates and searches one phase-one depth per call,
   * so the views can take turns: every depth is tried from every side before
   * any side goes deeper, and whichever side the cube is easiest from finds the
   * short answer first.
   */
  function searcher(direction: ReturnType<typeof directionsOf>[number]) {
    const start = direction.cube;
    const phase1Stack = new Int32Array(MAX_PHASE1_DEPTH);

    /**
     * The cube after each move of the path phase one is currently walking:
     * `path[i]` is `start` with the first `i` moves of `phase1Stack` applied.
     *
     * Phase two needs the whole state, not the three numbers phase one tracks,
     * and it used to be rebuilt from `start` every time a phase-one solution
     * turned up — allocating a cube per move, two million times over a hard
     * solve. A depth-first search changes only the tail of its path between one
     * solution and the next, so all that is really needed is to redo the part
     * that changed: `valid` is how much of `path` still matches the stack.
     */
    const path = Array.from({ length: MAX_PHASE1_DEPTH + 1 }, () => cloneCube(start));
    let valid = 0;
    const phase2Stack = new Int32Array(MAX_PHASE2_DEPTH);
    // Hoisted out of the search: the exact table's four arrays are read on
    // every node, and reaching them through `t.phase1` each time costs more
    // than the lookup itself.
    const exact = opts.exactTable ? t.phase1 : null;
    const classIndex = exact?.classIndex;
    const classSym = exact?.classSym;
    const twistConj = exact?.twistConj;
    const distances = exact?.distances;

    const twist0 = getTwist(start);
    const flip0 = getFlip(start);
    const slice0 = getSlice(start);

    /**
     * Finishes a cube already in G1 within `limit` moves, shortest first.
     *
     * `entryFace` is the face phase one ended on, and it matters: without it the
     * two halves are filtered independently and the seam goes unchecked. Solving
     * a cube scrambled by `R` returned `R R2` — two moves that are one move,
     * `R'`, and a pair the within-phase filter would never have allowed had it
     * seen them together.
     *
     * Nothing is lost by forbidding it. Any combination reachable by ending
     * phase one on a face and immediately reusing it is also reachable by phase
     * one ending on the merged turn, which the phase-one search already explores.
     */
    function solvePhase2(state: CubieCube, limit: number, entryFace: number): number[] | null {
      const corner0 = getCornerPerm(state);
      const edge0 = getEdge8Perm(state);
      const sliceP0 = getSlicePerm(state);

      if (corner0 === 0 && edge0 === 0 && sliceP0 === 0) return [];

      for (let depth = 1; depth <= Math.min(limit, MAX_PHASE2_DEPTH); depth++) {
        if (descend(depth, corner0, edge0, sliceP0, entryFace, 0)) {
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
     * Called for each phase-one solution found. Records it when it beats what
     * any direction has.
     *
     * Deliberately does NOT stop the search on reaching the target. Phase-one
     * solutions are enumerated in move order, not in order of how good the
     * total will be, so the first one to clear a generous target is often poor:
     * a cube scrambled by a single `R` was being "solved" in eight moves because
     * `R` comes before `R'` in the move list and the resulting total still
     * cleared the target of 21. Finishing the current depth costs little at
     * shallow depths and is bounded by the budget at deep ones.
     */
    function tryFinish(length: number): void {
      // Bring the path up to date from wherever the search last changed it.
      for (let i = valid; i < length; i++) {
        multiply(path[i], MOVE_CUBES[phase1Stack[i]], path[i + 1]);
      }
      if (valid < length) valid = length;
      const state = path[length];

      const cap = found.moves ? found.moves.length - length - 1 : opts.maxLength - length;
      if (cap < 0) return;

      const entryFace = length > 0 ? FACE_OF[phase1Stack[length - 1]] : -1;
      const tail = solvePhase2(state, cap, entryFace);
      if (!tail) return;

      candidates++;
      found.moves = direction.toOriginal([
        ...Array.from(phase1Stack.slice(0, length)),
        ...tail,
      ]);
      found.phase1 = length;
      found.direction = { rotation: direction.rotation, inverted: direction.inverted };
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
        // A phase one that ENDS on a move phase two could have made is the
        // same problem as the phase one before that move, already handed to
        // phase two one depth earlier — the move is simply the first of that
        // phase two. G1 is closed under its own moves, so the state before it
        // was in G1 too. Skipping these is not an approximation; without it the
        // same phase-two problem was being re-solved for every G1 move that
        // could end the sequence.
        if (twist === 0 && flip === 0 && slice === 0 && (ply === 0 || !IS_PHASE2_MOVE[phase1Stack[ply - 1]])) {
          tryFinish(ply);
        }
        return;
      }
      if (budgetSpent()) return;

      // With the exact table this is not a bound but the answer: the number of
      // moves this position needs to reach G1. Anything above what is left
      // cannot get there, and — unlike a bound that underestimates — nothing
      // below it is explored for nothing.
      if (classIndex !== undefined && classSym !== undefined
        && twistConj !== undefined && distances !== undefined) {
        const pair = slice * FLIP_COUNT + flip;
        const index = classIndex[pair] * TWIST_COUNT
          + twistConj[twist * UD_SYMMETRY_COUNT + classSym[pair]];
        const byte = distances[index >> 1];
        if ((index & 1 ? byte >> 4 : byte & 15) > remaining) return;
      } else {
        const lower = Math.max(
          t.twistFlipPrune[twist * FLIP_COUNT + flip],
          t.twistSlicePrune[twist * SLICE_COUNT + slice],
          t.flipSlicePrune[flip * SLICE_COUNT + slice],
        );
        if (lower > remaining) return;
      }

      for (let m = 0; m < MOVE_COUNT; m++) {
        const face = FACE_OF[m];
        if (!allowed(face, lastFace)) continue;

        phase1Stack[ply] = m;
        // Everything the path held beyond this move describes a different
        // branch now.
        if (valid > ply) valid = ply;
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

    return (depth: number) => searchPhase1(depth, twist0, flip0, slice0, -1, 0);
  }

  const searches = directionsOf(cube, opts.directions).map(searcher);

  outer: for (let depth = 0; depth <= MAX_PHASE1_DEPTH; depth++) {
    for (const searchDepth of searches) {
      if (stop) break outer;
      // Good enough: stop asking for better.
      if (found.moves && found.moves.length <= opts.targetLength) break outer;
      // A phase one this long already costs more than the whole solution we
      // have, so nothing deeper can improve on it — from any direction.
      if (found.moves && depth >= found.moves.length) break outer;
      searchDepth(depth);
    }
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
    direction: found.direction,
  };
}

/** Convenience: solve the state produced by an algorithm. */
export function solveScramble(
  scramble: string,
  options?: SolveOptions,
): SolveResult | null {
  return solve(cubeFromAlg(scramble), options);
}
