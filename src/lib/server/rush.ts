import "server-only";

import { DEFAULT_EVENT, EVENTS, eventOf, type EventId } from "../events";
import { msForRating, poolForSource, type RatingPool } from "../rating";
import {
  applySolve,
  referencePace,
  replayRush,
  startRush,
  type RushSolve,
  type RushState,
} from "../rush";
import type { Penalty } from "../types";
import { verifySolve, type SubmittedMove } from "../verifySolve";
import { currentRating } from "./ranked";
import { raise } from "./schema";
import { db } from "./supabase";

/**
 * Rush, server side.
 *
 * The rules are in `../rush.ts` and are tested without a database. This is the
 * part that issues scrambles, checks solves, and keeps the score — and the point
 * of it is that the score is never taken from the client. Each solve is replayed
 * against the scramble the server issued, and the run's totals are recomputed
 * from the recorded solves by the same pure function the browser runs. A number
 * only the client can produce is not a score.
 */

/** A run cannot stay open forever; an abandoned one would block the next. */
const RUN_TTL_MS = 30 * 60 * 1000;

type RunRow = {
  id: string;
  profile_id: string;
  event: string;
  source: string;
  pace_ms: number;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  status: string;
  current_scramble: string | null;
  current_issued_at: string | null;
  score: number;
  misses: number;
  best_streak: number;
};

async function freshScramble(event: string): Promise<string> {
  const { randomScrambleForEvent } = await import("cubing/scramble");
  return (await randomScrambleForEvent(event)).toString();
}

/**
 * The pace a run is built from.
 *
 * An established ranked rating converts exactly back to the average that earned
 * it, so that is the honest reference. Without one there is nothing measured to
 * build on, and the event's "strong club cuber" mark is used instead — a soft
 * start, because opening too easy and letting the tightening find someone is far
 * better than opening too hard and having them bounce.
 */
async function paceFor(
  profileId: string,
  event: EventId,
  pool: RatingPool,
): Promise<number> {
  const state = await currentRating(profileId, event, pool);
  if (state.rating === null) return EVENTS[event].strongMs;
  return referencePace(msForRating(state.rating, event), event);
}

export interface RushStart {
  runId: string;
  scramble: string;
  targetMs: number;
  paceMs: number;
  state: RushState;
}

/** Closes any run left open, so one player never holds two. */
async function closeOpenRuns(profileId: string): Promise<void> {
  const { error } = await db()
    .from("rush_runs")
    .update({ status: "abandoned", ended_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("status", "open");

  // If this fails and we open anyway, the unique index rejects the insert and
  // the player is stuck behind a run they cannot see. Loud is the right answer.
  if (error) throw new Error(`Could not close the open run: ${error.message}`);
}

export async function startRun(
  profileId: string,
  eventInput: string,
  source: "keyboard" | "smartcube",
): Promise<RushStart> {
  const event = eventOf(eventInput).id;
  const pool = poolForSource(source) ?? "keyboard";

  await closeOpenRuns(profileId);

  const paceMs = await paceFor(profileId, event, pool);
  const state = startRush(paceMs, event);
  const scramble = await freshScramble(event);
  const now = Date.now();

  const { data, error } = await db()
    .from("rush_runs")
    .insert({
      profile_id: profileId,
      event,
      source,
      pace_ms: Math.round(paceMs),
      expires_at: new Date(now + RUN_TTL_MS).toISOString(),
      current_scramble: scramble,
      current_issued_at: new Date(now).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not start a run: ${error?.message ?? "no row"}`);

  return {
    runId: data.id,
    scramble,
    targetMs: state.targetMs,
    paceMs: Math.round(paceMs),
    state,
  };
}

export interface RushSubmitInput {
  profileId: string;
  runId: string;
  clientId: string;
  moves: SubmittedMove[];
  durationMs: number;
  penalty: Penalty;
  source: "keyboard" | "smartcube";
  splits?: unknown;
}

export type RushSubmitResult =
  | {
      accepted: true;
      cleared: boolean;
      targetMs: number;
      effectiveMs: number | null;
      state: RushState;
      /** The next scramble, or null when the run has ended. */
      scramble: string | null;
      nextTargetMs: number | null;
    }
  | { accepted: false; reason: string; state?: RushState };

/** Every solve recorded for a run, oldest first. */
async function solvesFor(runId: string): Promise<RushSolve[]> {
  const { data, error } = await db()
    .from("rush_solves")
    .select("duration_ms, penalty")
    .eq("run_id", runId)
    .order("position", { ascending: true });

  if (error) raise(error, "rush_solves", "Could not read the run");
  return (data ?? []).map((r) => ({
    durationMs: r.duration_ms,
    penalty: r.penalty as Penalty,
  }));
}

export async function submitRushSolve(input: RushSubmitInput): Promise<RushSubmitResult> {
  const { data: raw, error: readError } = await db()
    .from("rush_runs")
    .select("*")
    .eq("id", input.runId)
    .maybeSingle();

  if (readError) raise(readError, "rush_runs", "Could not read the run");
  const run = raw as RunRow | null;

  // A run belonging to somebody else does not exist, as far as this player is
  // concerned — distinguishing the two leaks whether an id is real.
  if (!run || run.profile_id !== input.profileId) {
    return { accepted: false, reason: "No such run." };
  }
  if (run.status !== "open") return { accepted: false, reason: "That run is over." };
  if (!run.current_scramble || !run.current_issued_at) {
    return { accepted: false, reason: "No scramble is waiting on this run." };
  }
  if (Date.now() > new Date(run.expires_at).getTime()) {
    await endRun(run.id, await stateOf(run));
    return { accepted: false, reason: "That run timed out." };
  }

  const event = eventOf(run.event).id;
  const receivedAt = Date.now();
  const issuedAt = new Date(run.current_issued_at).getTime();
  const durationMs = Math.round(input.durationMs);

  // The state before this solve, replayed from what is stored rather than taken
  // from the row's counters — the counters are a cache of this.
  const before = await stateOf(run);

  let penalty: Penalty = input.penalty;
  let solveId: string | null = null;

  if (penalty !== "DNF") {
    const verdict = await verifySolve({
      scramble: run.current_scramble,
      moves: input.moves,
      durationMs,
      issuedAt,
      receivedAt,
      event,
    });

    if (!verdict.verified) {
      // Recorded as a miss rather than refused outright. Rush is a run, not a
      // single attempt: dropping the solve would let a player retry a scramble
      // they fumbled, and rejecting the whole run would punish a network blip
      // far more harshly than a slow solve.
      penalty = "DNF";
    } else {
      const { data: solve, error: solveError } = await db()
        .from("solves")
        .insert({
          profile_id: input.profileId,
          client_id: input.clientId,
          event,
          scramble: run.current_scramble,
          duration_ms: durationMs,
          penalty: input.penalty,
          move_count: verdict.moveCount,
          tps: verdict.tps,
          source: input.source,
          mode: "rush",
          verified: true,
          moves: input.moves as never,
          splits: (input.splits ?? []) as never,
          solved_at: new Date(receivedAt).toISOString(),
        })
        .select("id")
        .single();

      // A cleared solve recorded with no stored solve behind it is a score with
      // no evidence — the exact failure that hid in challenges for the whole
      // life of that feature.
      if (solveError) {
        throw new Error(`Could not store the verified solve: ${solveError.message}`);
      }
      solveId = solve?.id ?? null;
    }
  }

  const solve: RushSolve = { durationMs: penalty === "DNF" ? 0 : durationMs, penalty };
  const after = applySolve(before, solve, run.pace_ms, event);
  const position = (await solvesFor(run.id)).length;

  const { error: recordError } = await db().from("rush_solves").insert({
    run_id: run.id,
    position,
    solve_id: solveId,
    duration_ms: solve.durationMs,
    penalty,
    target_ms: before.targetMs,
    cleared: after.score > before.score,
  });

  // The primary key is (run_id, position), so a duplicate is a double
  // submission rather than a failure — the first one already counted.
  if (recordError) {
    if (recordError.code === "23505") {
      return { accepted: false, reason: "That solve was already recorded.", state: before };
    }
    throw new Error(`Could not record the solve: ${recordError.message}`);
  }

  if (after.over) {
    await endRun(run.id, after);
    return {
      accepted: true,
      cleared: after.score > before.score,
      targetMs: before.targetMs,
      effectiveMs: penalty === "DNF" ? null : durationMs + (penalty === "PLUS2" ? 2000 : 0),
      state: after,
      scramble: null,
      nextTargetMs: null,
    };
  }

  const scramble = await freshScramble(event);
  const { error: advanceError } = await db()
    .from("rush_runs")
    .update({
      current_scramble: scramble,
      current_issued_at: new Date().toISOString(),
      score: after.score,
      misses: after.misses,
      best_streak: after.bestStreak,
    })
    .eq("id", run.id)
    .eq("status", "open");

  if (advanceError) throw new Error(`Could not advance the run: ${advanceError.message}`);

  return {
    accepted: true,
    cleared: after.score > before.score,
    targetMs: before.targetMs,
    effectiveMs: penalty === "DNF" ? null : durationMs + (penalty === "PLUS2" ? 2000 : 0),
    state: after,
    scramble,
    nextTargetMs: after.targetMs,
  };
}

/** Replays a run from its stored solves. This is the authoritative score. */
async function stateOf(run: RunRow): Promise<RushState> {
  return replayRush(await solvesFor(run.id), run.pace_ms, eventOf(run.event).id);
}

async function endRun(runId: string, state: RushState): Promise<void> {
  const { error } = await db()
    .from("rush_runs")
    .update({
      status: "finished",
      ended_at: new Date().toISOString(),
      current_scramble: null,
      current_issued_at: null,
      score: state.score,
      misses: state.misses,
      best_streak: state.bestStreak,
    })
    .eq("id", runId)
    .eq("status", "open");

  if (error) throw new Error(`Could not close the run: ${error.message}`);
}

export interface RushBest {
  score: number;
  bestStreak: number;
  at: string;
}

/** This player's best finished run on an event, or null. */
export async function bestRun(
  profileId: string,
  event: EventId = DEFAULT_EVENT,
): Promise<RushBest | null> {
  const { data, error } = await db()
    .from("rush_runs")
    .select("score, best_streak, ended_at")
    .eq("profile_id", profileId)
    .eq("event", event)
    .eq("status", "finished")
    .order("score", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) raise(error, "rush_runs", "Could not read your best run");
  if (!data) return null;
  return {
    score: data.score,
    bestStreak: data.best_streak,
    at: data.ended_at ?? "",
  };
}
