"use client";

/**
 * Authoritative cube state for a solve in progress.
 *
 * The app cannot ask the input device whether the cube is solved. A keyboard
 * puzzle starts from a solved cube and knows nothing about the scramble we asked
 * the player to apply, so its own idea of "solved" is the inverse of ours. Instead
 * the tracker is seeded with the scramble and every move from every source is
 * applied to it, which makes solve detection exact, identical across input
 * devices, and testable without a browser.
 *
 * Whole-cube rotations are ignored when checking: someone who finishes holding the
 * cube a quarter turn round has still solved it.
 */

import { isSolvedPattern, loadKPuzzle, type Pattern } from "./cubeReplay";
import { OLL_SKIP, ollCaseId, type PatternLike } from "./lastLayer";

export class CubeStateTracker {
  private pattern: Pattern;

  private constructor(
    private readonly solvedPattern: Pattern,
    scramble: string,
  ) {
    this.pattern = scramble ? solvedPattern.applyAlg(scramble) : solvedPattern;
  }

  static async create(scramble: string): Promise<CubeStateTracker> {
    const kpuzzle = await loadKPuzzle();
    return new CubeStateTracker(kpuzzle.defaultPattern(), scramble);
  }

  /** Applies a move and reports whether the cube is now solved. */
  applyMove(move: string): boolean {
    this.pattern = this.pattern.applyMove(move);
    return this.isSolved();
  }

  isSolved(): boolean {
    return isSolvedPattern(this.pattern);
  }

  /**
   * Whether the last layer is oriented — one flat face, PLL still to do.
   *
   * This is what ends an OLL drill. Asking `isSolved` instead would make every
   * OLL rep secretly an OLL+PLL rep, and the time recorded against the OLL case
   * would include permuting it.
   */
  isLastLayerOriented(): boolean {
    return ollCaseId(this.pattern) === OLL_SKIP;
  }

  /** The current state, for callers that need to identify the case itself. */
  currentPattern(): PatternLike {
    return this.pattern;
  }

  /** Re-seed for the next scramble without reloading the puzzle definition. */
  reset(scramble: string): void {
    this.pattern = scramble ? this.solvedPattern.applyAlg(scramble) : this.solvedPattern;
  }
}

/** Warm the puzzle definition so the first solve isn't waiting on a chunk. */
export function warmCubeState(): void {
  void loadKPuzzle().catch(() => {});
}
