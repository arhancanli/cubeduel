import type { Penalty } from "./types";

/**
 * Head-to-head challenges.
 *
 * A player picks somebody and both solve the same scramble. It is asynchronous
 * by design rather than by compromise: a live race needs two people online in
 * the same second, and a ladder that only works at peak concurrency does not
 * work at all for the person who shows up at 2am. A challenge sitting in your
 * inbox is also the strongest reason an asynchronous game has to bring anyone
 * back — chess.com's daily games long outlived every real-time lobby that has
 * come and gone around them.
 *
 * Everything below is the part that has to be right regardless of storage, so
 * it lives here with no database in sight and is tested directly.
 *
 * ## The two rules that make it fair
 *
 * **Neither player sees the scramble until their own attempt opens.** The
 * challenger picks an opponent, not a scramble — the server generates it and
 * keeps it. If the challenger could see it at creation they could study it, and
 * if the opponent could see it while it sat in their inbox they could study it
 * for a day. Both would be solving a different problem than the other.
 *
 * **Neither time is shown until both have solved.** Going second is otherwise a
 * real advantage: knowing you need 12.40 tells you exactly how much risk to
 * take, and a solve attempted at a known target is not the same event as a solve
 * attempted blind. Hiding it costs a little drama and buys a result that means
 * something.
 */

/** How long a challenge waits for its opponent before it lapses. */
export const CHALLENGE_TTL_MS = 48 * 60 * 60 * 1000;

/** Outstanding challenges one player may have waiting at once. */
export const MAX_OUTGOING_PENDING = 10;

export type ChallengeStatus = "pending" | "complete" | "expired" | "declined";

export type Winner = "challenger" | "opponent" | "draw";

/** One player's half of a challenge. Null duration means they have not solved. */
export interface Side {
  durationMs: number | null;
  penalty: Penalty | null;
}

/**
 * The time a side is judged on, or null if they have no result yet.
 *
 * A DNF is deliberately not a very large number. Ranking it as "slower than
 * everything" would be a lie of the kind that quietly becomes load-bearing, so
 * it stays absent and the comparison below handles it explicitly.
 */
export function effectiveMs(side: Side): number | null {
  if (side.durationMs === null || side.penalty === null) return null;
  if (side.penalty === "DNF") return null;
  return side.durationMs + (side.penalty === "PLUS2" ? 2000 : 0);
}

/** Whether a side has finished, successfully or not. */
export function hasSolved(side: Side): boolean {
  return side.penalty !== null;
}

/**
 * Who won, once both sides are in.
 *
 * A DNF loses to any completed solve and draws with another DNF: both players
 * failed the same scramble and neither demonstrated anything about the other.
 * Identical times draw too — rare on a millisecond clock, but a rule that cannot
 * express a tie will eventually have to invent a winner.
 */
export function decideWinner(challenger: Side, opponent: Side): Winner {
  const a = effectiveMs(challenger);
  const b = effectiveMs(opponent);

  if (a === null && b === null) return "draw";
  if (a === null) return "opponent";
  if (b === null) return "challenger";
  if (a === b) return "draw";
  return a < b ? "challenger" : "opponent";
}

export interface ChallengeState {
  status: ChallengeStatus;
  challenger: Side;
  opponent: Side;
  createdAt: number;
  expiresAt: number;
}

export type Resolution =
  | { settled: false }
  | { settled: true; status: "complete"; winner: Winner; reason: "both solved" }
  | {
      settled: true;
      status: "complete";
      winner: Winner;
      reason: "opponent let it lapse" | "challenger let it lapse";
    }
  | { settled: true; status: "expired"; winner: null; reason: "nobody solved" };

/**
 * Decides what a challenge should become, given where it stands right now.
 *
 * Expiry is judged here rather than by a scheduled job. There is no cron in this
 * app, and a status column that is only correct when something remembered to run
 * is worse than no column: it would show stale "pending" challenges indefinitely
 * and every read would have to second-guess it. Reads settle it instead, which
 * means the answer is right the moment anyone looks.
 *
 * A challenge that ran out with exactly one side solved is a win for the player
 * who turned up. That is not a technicality — the alternative is that ignoring a
 * challenge you are losing costs nothing, which would make every inconvenient
 * challenge disappear.
 */
export function resolve(state: ChallengeState, now: number): Resolution {
  if (state.status !== "pending") return { settled: false };

  const challengerIn = hasSolved(state.challenger);
  const opponentIn = hasSolved(state.opponent);

  if (challengerIn && opponentIn) {
    return {
      settled: true,
      status: "complete",
      winner: decideWinner(state.challenger, state.opponent),
      reason: "both solved",
    };
  }

  // Strictly past the deadline, matching `verifySolve`'s attempt TTL and the
  // inspection thresholds: everywhere in this app, reaching a limit is free and
  // only exceeding it costs anything. One convention, applied the same way, is
  // worth more than each boundary being argued on its own merits.
  if (now <= state.expiresAt) return { settled: false };

  if (challengerIn) {
    return {
      settled: true,
      status: "complete",
      winner: "challenger",
      reason: "opponent let it lapse",
    };
  }
  if (opponentIn) {
    return {
      settled: true,
      status: "complete",
      winner: "opponent",
      reason: "challenger let it lapse",
    };
  }

  return { settled: true, status: "expired", winner: null, reason: "nobody solved" };
}

/**
 * What a given viewer is allowed to know.
 *
 * Written as a function rather than left to each caller because it is the whole
 * fairness guarantee, and a guarantee enforced separately in four route handlers
 * is enforced in three of them. Every read goes through here.
 */
export interface VisibleChallenge {
  /** The scramble, once this viewer has opened their own attempt. */
  scramble: string | null;
  /** This viewer's own result, which they may always see. */
  own: Side;
  /** The other player's result, only once the challenge is settled. */
  theirs: Side | null;
  /** Whether it is this viewer's turn to do something. */
  awaitingYou: boolean;
}

export function visibleTo(
  viewer: "challenger" | "opponent",
  state: ChallengeState,
  scramble: string,
  viewerStarted: boolean,
): VisibleChallenge {
  const own = viewer === "challenger" ? state.challenger : state.opponent;
  const theirs = viewer === "challenger" ? state.opponent : state.challenger;
  const settled = state.status !== "pending";

  return {
    // Revealed by opening an attempt, never by receiving a challenge. A
    // scramble sitting readable in an inbox for two days is a scramble that has
    // been studied for two days.
    scramble: viewerStarted ? scramble : null,
    own,
    theirs: settled ? theirs : null,
    awaitingYou: state.status === "pending" && !hasSolved(own),
  };
}
