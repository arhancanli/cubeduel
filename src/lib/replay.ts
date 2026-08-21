import type { PhaseSplit, TimedMove } from "./cfop";

/**
 * Reading a recorded solve at a moment in time.
 *
 * Pure, and separate from the component, because every bug this has had was an
 * off-by-one at one of the two ends — and an off-by-one in a replay is invisible
 * in a screenshot. It looks like a cube.
 */

/**
 * How many moves have been made by `atMs`.
 *
 * Strictly greater, deliberately. The first move of a solve is stamped at 0, so
 * `<=` would mean it is already turned the instant the replay opens, and the
 * scrambled cube — the state the solver actually faced, and the one thing you
 * want to study before pressing play — could never be seen at all.
 *
 * The moves are already in solve order, which the verifier guarantees: it
 * rejects any stream whose timestamps go backwards.
 */
export function movesPlayedBy(moves: readonly TimedMove[], atMs: number): number {
  let count = 0;
  while (count < moves.length && atMs > moves[count].atMs) count++;
  return count;
}

/**
 * The clock the replay runs against.
 *
 * One millisecond past the final move, so that move can be reached: a move
 * counts as played once the clock is past it, and a solve whose last turn lands
 * exactly on the buzzer would otherwise never complete.
 *
 * It is also at least the recorded duration, because the timer stops when the
 * solver stops it rather than when the cube is solved. Cutting the replay at the
 * last move would hide that final beat, which is a real part of the solve and
 * often the difference between two times.
 */
export function replayLengthMs(moves: readonly TimedMove[], durationMs: number): number {
  return Math.max(durationMs, (moves.at(-1)?.atMs ?? 0) + 1, 1);
}

/**
 * Which phase the playhead is inside.
 *
 * Anything past the last split still belongs to the last phase. The alternative
 * — no phase — puts a dash on screen for the final moments of every solve, which
 * reads as a defect rather than as the truth that the clock outran the cube.
 */
export function phaseAt(splits: readonly PhaseSplit[], atMs: number): PhaseSplit | undefined {
  return splits.find((split) => atMs < split.endMs) ?? splits.at(-1);
}
