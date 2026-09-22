/**
 * A sub-second 3x3 solving engine.
 *
 * Written from scratch — cube model, coordinates, tables and search — rather
 * than wrapped around an existing solver, because the interesting parts of this
 * product depend on it and on understanding it:
 *
 *   - **Move efficiency.** "You used 58 moves; the engine used 20." A timer can
 *     tell you how long you took. Only a solver can tell you how much of that was
 *     the cube being hard and how much was you going the long way round.
 *   - **Bot opponents.** A bot that counts down to a chosen time is a fake
 *     opponent with a number attached. One that replays a real solution at a
 *     modelled turn rate is beatable-feeling and inspectable.
 *   - **The coach.** Comparing what somebody did against what was available is
 *     the only way to say anything specific about a particular solve.
 *
 * Measured over 200 uniformly random states on a laptop, searching from six
 * sides (see `symmetry.ts`): at the defaults, mean 20.54 moves in the half-turn
 * metric with a 9ms median; at the server's settings (target 19, 1s), mean 19.02
 * with a 91ms median. Tables load from the precomputed file in about 30ms.
 *
 * That is over a move above optimal on average: God's number, 20, is the
 * WORST case, and a random cube's true minimum averages about 17.7 (two thirds
 * of positions need 18, a quarter need 17 — cube20.org). An earlier version of
 * this comment compared the mean with God's number and called it within a move
 * of optimal, which is the comparison that flatters.
 * This is not an optimal solver and does not claim to be — it is a two-phase
 * solver, which trades a provable minimum for finishing in milliseconds instead
 * of minutes. Ask for a lower `targetLength` and it will spend the extra time.
 *
 * ```ts
 * import { buildTables, solveScramble } from "@/lib/solver";
 *
 * buildTables();                       // once, ~750ms
 * const result = solveScramble("R U R' U' F2 L D B' R2 U");
 * result.moves;   // ["D'", "L'", ...]
 * result.length;  // 18
 * ```
 */

export {
  solvedCube,
  cloneCube,
  compose,
  cubeFromAlg,
  isSolved,
  parseMoves,
  validate,
  BASE_MOVES,
  FACES,
  type CubieCube,
  type Face,
} from "./cube";

export {
  getTwist,
  getFlip,
  getSlice,
  getCornerPerm,
  getEdge8Perm,
  getSlicePerm,
  isInG1,
} from "./coords";

export {
  MOVES,
  PHASE2_MOVES,
  buildTables,
  resetTables,
  type SolverTables,
} from "./tables";

export {
  solve,
  solveScramble,
  type SolveOptions,
  type SolveResult,
} from "./search";
