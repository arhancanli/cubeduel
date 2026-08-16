import "server-only";

import {
  UNRATED,
  isEstablished,
  applyWindow,
  WINDOW_SIZE,
  type RatingPool,
  type RatingState,
} from "../rating";
import type { Timed } from "../stats";
import type { Penalty } from "../types";
import { ATTEMPT_TTL_MS, verifySolve, type SubmittedMove } from "../verifySolve";
import { db } from "./supabase";
import type { Row } from "./database.types";

/**
 * The ranked loop.
 *
 * The shape is: the server issues a scramble nobody has seen, the player solves
 * it, the server proves the solution is real, and every fifth result the rating
 * moves. Each of those steps exists because the obvious cheaper version of it is
 * exploitable, and the comments say which exploit.
 */

export interface IssuedAttempt {
  attemptId: string;
  scramble: string;
  expiresAt: string;
}

/**
 * Generating the scramble here rather than shipping a pool is what makes the
 * ladder worth having. A fixed pool baked into the bundle can be solved offline
 * at leisure, once, and then replayed forever at whatever time the cheat likes.
 * A freshly generated random-state scramble has never existed before the request.
 */
async function freshScramble(event: string): Promise<string> {
  const { randomScrambleForEvent } = await import("cubing/scramble");
  const alg = await randomScrambleForEvent(event);
  return alg.toString();
}

/**
 * Closes any attempt the player left open, recording it as a DNF.
 *
 * This is the reroll defence. Without it: start an attempt, and the moment the
 * solve goes wrong, ask for a new scramble and pretend the last one never
 * happened. Results would then be a filtered highlight reel rather than a record.
 */
async function closeOpenAttempts(profileId: string): Promise<void> {
  const { error } = await db()
    .from("ranked_attempts")
    .update({
      status: "expired",
      penalty: "DNF",
      duration_ms: 0,
      completed_at: new Date().toISOString(),
    })
    .eq("profile_id", profileId)
    .eq("status", "issued");

  // If this fails and we issue anyway, the abandoned attempt stays open and the
  // reroll defence is gone — which is the exact exploit it exists to close.
  if (error) {
    throw new Error(`Could not close the open attempt: ${error.message}`);
  }
}

export async function issueAttempt(
  profileId: string,
  event: string,
  pool: RatingPool,
): Promise<IssuedAttempt> {
  await closeOpenAttempts(profileId);

  const now = Date.now();
  const scramble = await freshScramble(event);
  const expiresAt = new Date(now + ATTEMPT_TTL_MS).toISOString();

  const { data, error } = await db()
    .from("ranked_attempts")
    .insert({
      profile_id: profileId,
      event,
      pool,
      scramble,
      issued_at: new Date(now).toISOString(),
      expires_at: expiresAt,
    })
    .select("id, scramble, expires_at")
    .single();

  if (error || !data) {
    throw new Error(`Could not issue attempt: ${error?.message ?? "no row"}`);
  }

  return {
    attemptId: data.id,
    scramble: data.scramble,
    expiresAt: data.expires_at,
  };
}

export interface SubmissionInput {
  profileId: string;
  attemptId: string;
  clientId: string;
  moves: SubmittedMove[];
  durationMs: number;
  penalty: Penalty;
  splits?: unknown;
  ollCase?: string | null;
  pllCase?: string | null;
  source: "keyboard" | "smartcube";
}

export type SubmissionResult =
  | {
      accepted: true;
      durationMs: number;
      moveCount: number;
      tps: number;
      /** Present only on the fifth attempt, when a window closed. */
      rating: RatingResult | null;
      attemptsUntilRating: number;
    }
  | { accepted: false; reason: string };

export interface RatingResult {
  before: number | null;
  after: number | null;
  deviation: number;
  averageMs: number | null;
  failed: boolean;
  established: boolean;
}

export async function submitAttempt(
  input: SubmissionInput,
): Promise<SubmissionResult> {
  const { data: attempt } = await db()
    .from("ranked_attempts")
    .select("*")
    .eq("id", input.attemptId)
    .maybeSingle();

  if (!attempt) return { accepted: false, reason: "No such attempt." };

  // An attempt belongs to the player it was issued to. Without this check any
  // signed-in account could submit against anyone else's open attempt.
  if (attempt.profile_id !== input.profileId) {
    return { accepted: false, reason: "No such attempt." };
  }

  // Single-use. Otherwise one verified solution could be resubmitted forever.
  if (attempt.status !== "issued") {
    return { accepted: false, reason: "That attempt is already finished." };
  }

  const receivedAt = Date.now();
  const issuedAt = new Date(attempt.issued_at).getTime();

  // A DNF the player declares themselves needs no verification — they are
  // reporting a failure, and failures are never worth faking.
  if (input.penalty === "DNF") {
    await recordResult(attempt, {
      solveId: null,
      durationMs: input.durationMs,
      penalty: "DNF",
    });
    const rating = await rateReadyWindows(
      attempt.profile_id,
      attempt.event,
      attempt.pool as RatingPool,
    );
    return {
      accepted: true,
      durationMs: input.durationMs,
      moveCount: 0,
      tps: 0,
      rating,
      attemptsUntilRating: await countUntilRating(attempt),
    };
  }

  // The scramble compared against is the one from the database, never one the
  // client sent along. That single choice is what the whole ladder rests on.
  const verdict = await verifySolve({
    scramble: attempt.scramble,
    moves: input.moves,
    durationMs: input.durationMs,
    issuedAt,
    receivedAt,
  });

  if (!verdict.verified) {
    // The attempt is still consumed. A rejected submission that left the attempt
    // open would let a cheat probe the verifier until something passed.
    await recordResult(attempt, {
      solveId: null,
      durationMs: input.durationMs,
      penalty: "DNF",
    });
    return { accepted: false, reason: verdict.reason };
  }

  const solvedAt = new Date(receivedAt).toISOString();
  const { data: solve, error: solveError } = await db()
    .from("solves")
    .insert({
      profile_id: attempt.profile_id,
      client_id: input.clientId,
      event: attempt.event,
      scramble: attempt.scramble,
      duration_ms: input.durationMs,
      penalty: input.penalty,
      move_count: verdict.moveCount,
      tps: verdict.tps,
      source: input.source,
      mode: "ranked",
      verified: true,
      moves: input.moves as never,
      splits: (input.splits ?? []) as never,
      oll_case: input.ollCase ?? null,
      pll_case: input.pllCase ?? null,
      solved_at: solvedAt,
    })
    .select("id")
    .single();

  // The attempt is about to be marked complete against this solve. Completing it
  // with no solve stored would leave a rated result nobody can inspect.
  if (solveError) {
    throw new Error(`Could not store the verified solve: ${solveError.message}`);
  }

  await recordResult(attempt, {
    solveId: solve?.id ?? null,
    durationMs: input.durationMs,
    penalty: input.penalty,
  });

  const rating = await rateReadyWindows(
    attempt.profile_id,
    attempt.event,
    attempt.pool as RatingPool,
  );

  return {
    accepted: true,
    durationMs: input.durationMs,
    moveCount: verdict.moveCount,
    tps: verdict.tps,
    rating,
    attemptsUntilRating: await countUntilRating(attempt),
  };
}

async function recordResult(
  attempt: Row<"ranked_attempts">,
  result: { solveId: string | null; durationMs: number; penalty: Penalty },
): Promise<void> {
  const { error } = await db()
    .from("ranked_attempts")
    .update({
      status: "completed",
      solve_id: result.solveId,
      duration_ms: result.durationMs,
      penalty: result.penalty,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    // Only an attempt still open may be completed, so two submissions racing
    // cannot both write a result.
    .eq("status", "issued");

  // Losing this write drops the attempt out of every future rating window
  // without a trace, so the player quietly never reaches five.
  if (error) {
    throw new Error(`Could not record the attempt result: ${error.message}`);
  }
}

/**
 * Results gathered toward the next rating window. Drives the "3/5" on screen, so
 * nobody has to guess when their rating will move.
 */
export async function pendingResultCount(
  profileId: string,
  event: string,
  pool: RatingPool,
): Promise<number> {
  const { count } = await db()
    .from("ranked_attempts")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("event", event)
    .eq("pool", pool)
    .is("window_index", null)
    .not("completed_at", "is", null);

  return count ?? 0;
}

async function countUntilRating(
  attempt: Row<"ranked_attempts">,
): Promise<number> {
  const gathered = await pendingResultCount(
    attempt.profile_id,
    attempt.event,
    attempt.pool as RatingPool,
  );
  return Math.max(0, WINDOW_SIZE - gathered);
}

export async function currentRating(
  profileId: string,
  event: string,
  pool: RatingPool,
): Promise<RatingState> {
  const { data } = await db()
    .from("ratings")
    .select("*")
    .eq("profile_id", profileId)
    .eq("event", event)
    .eq("pool", pool)
    .maybeSingle();

  if (!data) return UNRATED;

  return {
    rating: data.rating,
    deviation: data.deviation,
    windowCount: Math.floor(data.solve_count / WINDOW_SIZE),
    peak: data.peak_rating,
    lastRatedAt: data.last_solve_at
      ? new Date(data.last_solve_at).getTime()
      : null,
  };
}

/**
 * Consumes every complete window of results that is waiting, oldest first.
 *
 * A loop rather than a single step because results can arrive faster than they
 * are rated — a retry, two tabs, a burst of submissions — and leaving a window
 * unconsumed would silently stall someone's rating.
 */
export async function rateReadyWindows(
  profileId: string,
  event: string,
  pool: RatingPool,
): Promise<RatingResult | null> {
  let latest: RatingResult | null = null;

  // Bounded so a bug upstream cannot turn one request into an unbounded loop.
  for (let guard = 0; guard < 50; guard++) {
    const { data: pending } = await db()
      .from("ranked_attempts")
      .select("id, duration_ms, penalty, completed_at")
      .eq("profile_id", profileId)
      .eq("event", event)
      .eq("pool", pool)
      .is("window_index", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: true })
      .limit(WINDOW_SIZE);

    if (!pending || pending.length < WINDOW_SIZE) break;

    const state = await currentRating(profileId, event, pool);
    const attempts: Timed[] = pending.map((a) => ({
      ms: a.duration_ms ?? 0,
      penalty: (a.penalty ?? "DNF") as Penalty,
    }));

    const now = Date.now();
    const outcome = applyWindow(state, attempts, now);
    const windowIndex = state.windowCount;

    // All three writes — claim the window, move the rating, consume the five
    // attempts — happen inside one Postgres function, so they are one
    // transaction.
    //
    // Issued separately they were not atomic, and the failure was silent and
    // permanent: the claim would land, the rating upsert would fail, and because
    // the claim is UNIQUE the window could never be retried. The audit trail
    // said the rating moved, the rating had not, and nothing reported it.
    const { error: applyError } = await db().rpc("apply_rating_window", {
      p_profile_id: profileId,
      p_event: event,
      p_pool: pool,
      p_window_index: windowIndex,
      p_rating_before: state.rating ?? outcome.state.rating ?? 0,
      p_deviation_before: state.deviation,
      p_rating_after: outcome.state.rating ?? 0,
      p_deviation_after: outcome.state.deviation,
      p_solve_count: (windowIndex + 1) * WINDOW_SIZE,
      p_peak_rating: outcome.state.peak,
      p_at: new Date(now).toISOString(),
      p_attempt_ids: pending.map((a) => a.id),
    });

    if (applyError) {
      // A unique violation means another request rated this window between our
      // read and our write; their result is as valid as ours, so stop rather
      // than racing. Anything else is a real fault and must not be swallowed —
      // the caller has just told a player their solve counted.
      if (applyError.code === "23505") break;
      throw new Error(`Could not apply the rating window: ${applyError.message}`);
    }

    latest = {
      before: state.rating,
      after: outcome.state.rating,
      deviation: outcome.state.deviation,
      averageMs: outcome.averageMs,
      failed: outcome.failed,
      established: isEstablished(outcome.state),
    };
  }

  return latest;
}
