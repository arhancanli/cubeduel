/**
 * Replaying a move stream against a scramble, on either side of the wire.
 *
 * `cubeState.ts` does this in the browser to detect the end of a solve. The server
 * needs the identical calculation to decide whether a submitted solve is real, and
 * "identical" has to mean the same code rather than the same intent — two
 * implementations of cube arithmetic that agree today will disagree eventually,
 * and the disagreement would show up as honest players being rejected.
 *
 * So the puzzle definition and the replay live here, with no `"use client"`, and
 * both sides import them. cubing.js's KPuzzle is pure JavaScript with no WASM and
 * no DOM, and loads in single-digit milliseconds under Node.
 */

const SOLVED_OPTIONS = {
  ignorePuzzleOrientation: true,
  ignoreCenterOrientation: true,
};

export interface Pattern {
  applyMove(move: string): Pattern;
  applyAlg(alg: string): Pattern;
  experimentalIsSolved(options: typeof SOLVED_OPTIONS): boolean;
  /**
   * Raw orbit data. The trainer needs it to ask a narrower question than "is the
   * cube solved" — an OLL drill finishes the moment the last layer is *oriented*,
   * which is several moves before the puzzle is done.
   */
  patternData: Record<string, { pieces: number[]; orientation: number[] }>;
}

interface KPuzzleLike {
  defaultPattern(): Pattern;
}

let kpuzzlePromise: Promise<KPuzzleLike> | null = null;

/** Cached for the lifetime of the process — the definition never changes. */
export function loadKPuzzle(): Promise<KPuzzleLike> {
  kpuzzlePromise ??= import("cubing/puzzles").then(
    (m) => m.puzzles["3x3x3"].kpuzzle() as unknown as Promise<KPuzzleLike>,
  );
  return kpuzzlePromise;
}

export function isSolvedPattern(pattern: Pattern): boolean {
  return pattern.experimentalIsSolved(SOLVED_OPTIONS);
}

/**
 * A single move: optional layer count, a face or rotation, optional wide marker,
 * optional double or prime. Deliberately the same shape as the scramble-link
 * allowlist in `scrambleParam.ts` — both guard the same algorithm parser against
 * the same untrusted input.
 */
export const MOVE_PATTERN = /^(\d+)?([UDFBLRMESudfblrxyz])(w)?(['2]|2'|'2)?$/;

export function isValidMove(move: string): boolean {
  return MOVE_PATTERN.test(move);
}

/**
 * Applies a scramble and then a solution, and reports whether the cube ends
 * solved. Throws nothing: an unparseable move is a `false`, because this sits
 * behind an HTTP handler and a malformed submission is a rejection, not a 500.
 */
export async function replaySolves(
  scramble: string,
  moves: readonly string[],
): Promise<boolean> {
  const kpuzzle = await loadKPuzzle();
  try {
    let pattern = kpuzzle.defaultPattern().applyAlg(scramble);
    for (const move of moves) {
      if (!isValidMove(move)) return false;
      pattern = pattern.applyMove(move);
    }
    return isSolvedPattern(pattern);
  } catch {
    return false;
  }
}
