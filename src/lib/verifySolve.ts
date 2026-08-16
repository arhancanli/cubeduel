import { isValidMove, replaySolves } from "./cubeReplay";

/**
 * Deciding whether a submitted solve is real.
 *
 * This is the load-bearing piece of the whole ladder. A leaderboard nobody
 * believes is worse than no leaderboard, and the only way to believe one is for
 * the server to re-derive every ranked result from evidence instead of taking the
 * client's word for a number.
 *
 * ## What this proves, and what it does not
 *
 * Being precise about this matters more than the checks themselves, because the
 * temptation is to call the result "cheat-proof" and stop thinking.
 *
 * **Proved.** The submitted moves genuinely solve the exact scramble the server
 * issued, that scramble was never seen by anyone before it was issued, the attempt
 * is single-use, and the claimed time is internally consistent with the move
 * timestamps and with the server's own clock.
 *
 * **Not proved.** That a human did it. A program that solves the scramble at a
 * plausible turn rate with plausible pauses would pass everything here. That is
 * the same position chess sites are in with engines, and it is answered the same
 * way — behavioural analysis over many results, not a check on a single one. That
 * layer does not exist yet, and this file does not pretend it does.
 *
 * The distinction has a practical consequence: these checks are designed to be
 * *specific*, never rejecting an honest solve, rather than *sensitive*. A false
 * rejection costs a real player a real result, which is a much worse failure than
 * letting a determined cheat through to be caught later by their record.
 */

/**
 * Nobody turns this fast. World-record hand speeds sit near 11 turns per second
 * over a whole solve and the very best keyboard cubers are not far above that, so
 * this bound is roughly double the human ceiling. It is here to catch a script
 * dumping a solution instantly, not to adjudicate between fast humans.
 */
export const MAX_PLAUSIBLE_TPS = 25;

/**
 * Below this a "solve" is a scripted submission whatever its move count says.
 * Even a 20-move solution at the cap above takes most of a second.
 */
export const MIN_PLAUSIBLE_DURATION_MS = 500;

/**
 * Slack between the server's clock and the client's. Covers request latency, a
 * client clock that runs slightly fast, and the gap between the last move and the
 * submission leaving the browser.
 */
export const CLOCK_SLACK_MS = 10_000;

/** An attempt not submitted within this window is dead. */
export const ATTEMPT_TTL_MS = 30 * 60 * 1000;

/** Bounds the work a single request can ask the replay engine to do. */
export const MAX_MOVES = 1000;

export interface SubmittedMove {
  move: string;
  /** Milliseconds from the first turn of the solve. */
  atMs: number;
}

export interface VerificationInput {
  /** The scramble the SERVER holds. Never the one the client says it used. */
  scramble: string;
  moves: readonly SubmittedMove[];
  durationMs: number;
  /**
   * Server time when the attempt was issued, or `null` when the scramble was not
   * issued to this player on demand.
   *
   * The daily is the `null` case: its scramble is the same for everybody and
   * published at midnight, so there is no "when did this player receive it"
   * moment to measure against. That genuinely weakens the claim, and the result
   * reports it as `timingBounded: false` rather than quietly presenting a daily
   * result as though it carried the same guarantee as a ranked one.
   */
  issuedAt: number | null;
  /** Server time now. */
  receivedAt: number;
}

export type VerificationResult =
  | {
      verified: true;
      moveCount: number;
      tps: number;
      /**
       * Whether the claimed duration was checked against the server's own clock.
       * False means the moves are proven but the time is self-reported.
       */
      timingBounded: boolean;
    }
  | { verified: false; reason: string };

function reject(reason: string): VerificationResult {
  return { verified: false, reason };
}

/**
 * Whole-cube rotations reorient the puzzle without turning a layer, so they are
 * replayed but excluded from move count and turn rate — the same rule the
 * recorder uses in the browser.
 */
const ROTATION_FAMILIES = new Set(["x", "y", "z"]);

function isRotation(move: string): boolean {
  const family = move.replace(/^\d*/, "").replace(/['2]+$/, "");
  return ROTATION_FAMILIES.has(family);
}

export async function verifySolve(
  input: VerificationInput,
): Promise<VerificationResult> {
  const { scramble, moves, durationMs, issuedAt, receivedAt } = input;

  // --- Shape ------------------------------------------------------------

  if (!Array.isArray(moves) || moves.length === 0) {
    return reject("no moves submitted");
  }
  if (moves.length > MAX_MOVES) {
    return reject("move stream too long");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return reject("duration is not a positive number");
  }

  for (const m of moves) {
    if (typeof m?.move !== "string" || !isValidMove(m.move)) {
      return reject("move stream contains an unrecognised move");
    }
    if (!Number.isFinite(m.atMs) || m.atMs < 0) {
      return reject("move stream contains an invalid timestamp");
    }
  }

  // --- Internal consistency of the clock --------------------------------

  // Time only moves forward. A stream that jumps backwards has been assembled
  // rather than recorded.
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].atMs < moves[i - 1].atMs) {
      return reject("move timestamps are not monotonic");
    }
  }

  // The solve ends on the move that solves the cube, so the last timestamp IS
  // the duration. A duration that disagrees with the moves is the signature of a
  // time edited after the fact.
  const lastAt = moves[moves.length - 1].atMs;
  if (Math.abs(lastAt - durationMs) > 250) {
    return reject("duration does not match the final move timestamp");
  }

  // --- Consistency with the server's own clock --------------------------

  const timingBounded = issuedAt !== null;

  if (issuedAt !== null) {
    if (receivedAt - issuedAt > ATTEMPT_TTL_MS) {
      return reject("attempt expired");
    }

    // A solve cannot have taken longer than the attempt has existed. This is the
    // one bound the client cannot argue with, because both ends come from the
    // server's clock.
    if (durationMs > receivedAt - issuedAt + CLOCK_SLACK_MS) {
      return reject("solve is longer than the attempt has been open");
    }
  }

  // --- Plausibility -----------------------------------------------------

  const turns = moves.filter((m) => !isRotation(m.move));
  if (turns.length === 0) {
    return reject("no layer turns in the solve");
  }

  if (durationMs < MIN_PLAUSIBLE_DURATION_MS) {
    return reject("solve is faster than physically possible");
  }

  const tps = turns.length / (durationMs / 1000);
  if (tps > MAX_PLAUSIBLE_TPS) {
    return reject("turn rate is beyond human");
  }

  // --- The actual proof -------------------------------------------------

  // Everything above is a filter. This is the part that decides: do these moves,
  // applied to the scramble the server issued, actually solve the cube.
  const solved = await replaySolves(
    scramble,
    moves.map((m) => m.move),
  );
  if (!solved) {
    return reject("the submitted moves do not solve the issued scramble");
  }

  return { verified: true, moveCount: turns.length, tps, timingBounded };
}
