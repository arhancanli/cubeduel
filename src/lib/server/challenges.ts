import "server-only";

import {
  CHALLENGE_TTL_MS,
  MAX_OUTGOING_PENDING,
  type ChallengeState,
  type Side,
  type Winner,
  resolve,
  visibleTo,
} from "../challenge";
import { combinePenalties, judgeInspection } from "../inspection";
import type { Penalty } from "../types";
import { verifySolve, type SubmittedMove } from "../verifySolve";
import { db } from "./supabase";
import { raise } from "./schema";

/**
 * Head-to-head challenges, against a person rather than a bot.
 *
 * The rules live in `../challenge.ts` and are tested without a database. This
 * file is the part that touches storage, and its job is mostly to refuse: it
 * decides what a given player is allowed to be told, and every read goes through
 * `visibleTo` rather than selecting the row and trusting the caller to redact
 * it. A fairness rule enforced separately in four route handlers is enforced in
 * three of them.
 */

type ChallengeRow = {
  id: string;
  challenger_id: string;
  opponent_id: string;
  event: string;
  source: string;
  scramble: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "complete" | "expired" | "declined";
  challenger_started_at: string | null;
  challenger_duration_ms: number | null;
  challenger_penalty: Penalty | null;
  opponent_started_at: string | null;
  opponent_duration_ms: number | null;
  opponent_penalty: Penalty | null;
  winner: Winner | null;
  resolved_at: string | null;
};

/** Which half of a challenge a given player is. */
export type Seat = "challenger" | "opponent";

function seatOf(row: ChallengeRow, profileId: string): Seat | null {
  if (row.challenger_id === profileId) return "challenger";
  if (row.opponent_id === profileId) return "opponent";
  return null;
}

function sideOf(row: ChallengeRow, seat: Seat): Side {
  return seat === "challenger"
    ? { durationMs: row.challenger_duration_ms, penalty: row.challenger_penalty }
    : { durationMs: row.opponent_duration_ms, penalty: row.opponent_penalty };
}

function stateOf(row: ChallengeRow): ChallengeState {
  return {
    status: row.status,
    challenger: sideOf(row, "challenger"),
    opponent: sideOf(row, "opponent"),
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

async function freshScramble(event: string): Promise<string> {
  const { randomScrambleForEvent } = await import("cubing/scramble");
  const alg = await randomScrambleForEvent(event);
  return alg.toString();
}

/**
 * Writes down a settlement the rules have already decided.
 *
 * Called from reads as well as writes, because expiry is judged on the way past
 * rather than by a scheduled job — there is no cron here, and a status column
 * that is only correct when something remembered to run is worse than no column.
 * Guarded on `status = 'pending'` so two concurrent readers cannot both settle
 * it and the second cannot overwrite the first.
 */
async function settle(row: ChallengeRow, now: number): Promise<ChallengeRow> {
  const decision = resolve(stateOf(row), now);
  if (!decision.settled) return row;

  const { data, error } = await db()
    .from("challenges")
    .update({
      status: decision.status,
      winner: decision.winner,
      resolved_at: new Date(now).toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  // A failed write here used to fall through to the line below, which hands back
  // a row claiming a settlement that was never stored — so both players would be
  // shown a winner the database has no record of, and the next read would
  // contradict it.
  if (error) throw new Error(`Could not settle the challenge: ${error.message}`);

  // Matching nothing is different: somebody else settled it first, which is a
  // correct outcome rather than a failure. Their answer and ours agree, because
  // both came from the same pure function over the same row.
  return (data as ChallengeRow | null) ?? { ...row, status: decision.status, winner: decision.winner };
}

export type CreateResult =
  | { ok: true; challengeId: string }
  | { ok: false; reason: string };

/**
 * Opens a challenge against another player.
 *
 * The scramble is generated now and shown to nobody. The challenger picked an
 * opponent, not a scramble; letting them see it here would let them study it
 * before deciding when to start.
 */
export async function createChallenge(
  challengerId: string,
  opponentHandle: string,
  event = "333",
): Promise<CreateResult> {
  const { data: opponent } = await db()
    .from("profiles")
    .select("id, handle")
    .eq("handle", opponentHandle.toLowerCase())
    .maybeSingle();

  if (!opponent) return { ok: false, reason: "No player with that handle." };
  if (opponent.id === challengerId) {
    return { ok: false, reason: "You cannot challenge yourself." };
  }

  const now = Date.now();

  // Cheap and honest rate limit. Not about load — an inbox that can be used as a
  // weapon is a feature people turn off, and the cap is what stops one player
  // burying another.
  const { count, error: countError } = await db()
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("challenger_id", challengerId)
    .eq("status", "pending");

  // This one failed open. An error left `count` null, `?? 0` read that as "none
  // pending", and the cap that stops one player burying another simply stopped
  // existing — for exactly as long as the database was unhappy.
  if (countError || count === null) {
    return { ok: false, reason: "Could not check your open challenges. Try again." };
  }

  if (count >= MAX_OUTGOING_PENDING) {
    return {
      ok: false,
      reason: `You already have ${MAX_OUTGOING_PENDING} challenges waiting. Finish some first.`,
    };
  }

  const { data, error } = await db()
    .from("challenges")
    .insert({
      challenger_id: challengerId,
      opponent_id: opponent.id,
      event,
      scramble: await freshScramble(event),
      expires_at: new Date(now + CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    // The unique partial index is the authority on "one at a time per
    // direction", so a duplicate arrives here as a constraint violation rather
    // than being pre-checked in a race-prone read.
    if (error?.code === "23505") {
      return { ok: false, reason: "You already have a challenge waiting with that player." };
    }
    return { ok: false, reason: "Could not create the challenge." };
  }

  return { ok: true, challengeId: data.id };
}

export interface ChallengeView {
  id: string;
  seat: Seat;
  event: string;
  /** The other player, who is always safe to name. */
  them: { handle: string; displayName: string | null };
  status: "pending" | "complete" | "expired" | "declined";
  createdAt: string;
  expiresAt: string;
  /** Only once this player has opened their own attempt. */
  scramble: string | null;
  own: Side;
  /** Only once the challenge is settled. */
  theirs: Side | null;
  awaitingYou: boolean;
  /** From this player's point of view, once settled. */
  outcome: "win" | "loss" | "draw" | null;
}

function outcomeFor(seat: Seat, winner: Winner | null): "win" | "loss" | "draw" | null {
  if (winner === null) return null;
  if (winner === "draw") return "draw";
  return winner === seat ? "win" : "loss";
}

async function toView(row: ChallengeRow, profileId: string): Promise<ChallengeView | null> {
  const seat = seatOf(row, profileId);
  if (!seat) return null;

  const otherId = seat === "challenger" ? row.opponent_id : row.challenger_id;
  const { data: other } = await db()
    .from("profiles")
    .select("handle, display_name")
    .eq("id", otherId)
    .maybeSingle();

  const started =
    seat === "challenger" ? row.challenger_started_at !== null : row.opponent_started_at !== null;
  const view = visibleTo(seat, stateOf(row), row.scramble, started);

  return {
    id: row.id,
    seat,
    event: row.event,
    them: {
      handle: other?.handle ?? "unknown",
      displayName: other?.display_name ?? null,
    },
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    scramble: view.scramble,
    own: view.own,
    theirs: view.theirs,
    awaitingYou: view.awaitingYou,
    outcome: outcomeFor(seat, row.winner),
  };
}

/**
 * Everything this player is involved in, newest first.
 *
 * Settles anything that lapsed on the way past, so the list is correct at the
 * moment it is read rather than at the moment a job last ran.
 */
export async function listChallenges(profileId: string, limit = 20): Promise<ChallengeView[]> {
  const { data, error } = await db()
    .from("challenges")
    .select("*")
    .or(`challenger_id.eq.${profileId},opponent_id.eq.${profileId}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  // An outage that renders as "you have no challenges" is the worst failure this
  // list has: it is indistinguishable from the truth and nobody investigates it.
  if (error) raise(error, "challenges", "Could not load challenges");

  const now = Date.now();
  const rows = await Promise.all((data as ChallengeRow[]).map((row) => settle(row, now)));
  const views = await Promise.all(rows.map((row) => toView(row, profileId)));
  return views.filter((v): v is ChallengeView => v !== null);
}

export type StartResult =
  | { ok: true; scramble: string; startedAt: string }
  | { ok: false; reason: string };

/**
 * Opens this player's half and hands over the scramble.
 *
 * `started_at` is stamped once and never moved. That single fact is what stops
 * the obvious cheat: open the challenge, study the scramble, close the tab, come
 * back composed and start a fresh fifteen seconds. Because the stamp survives,
 * inspection keeps running while they are away and the penalty follows them
 * back. The UI says so before they open it, because a rule that costs somebody a
 * result should never be a surprise.
 */
export async function startSide(profileId: string, challengeId: string): Promise<StartResult> {
  const { data: raw } = await db()
    .from("challenges")
    .select("*")
    .eq("id", challengeId)
    .maybeSingle();

  if (!raw) return { ok: false, reason: "No such challenge." };
  const row = await settle(raw as ChallengeRow, Date.now());

  const seat = seatOf(row, profileId);
  // Not "forbidden" — a challenge you are not part of should not be
  // distinguishable from one that does not exist.
  if (!seat) return { ok: false, reason: "No such challenge." };

  if (row.status !== "pending") return { ok: false, reason: "That challenge is over." };
  if (sideOf(row, seat).penalty !== null) {
    return { ok: false, reason: "You have already solved this one." };
  }

  const existing = seat === "challenger" ? row.challenger_started_at : row.opponent_started_at;
  if (existing) return { ok: true, scramble: row.scramble, startedAt: existing };

  const startedAt = new Date().toISOString();

  // Spelled out per seat rather than built from a computed key: a `{ [col]: v }`
  // object types as a bare string index and silently opts the whole update out
  // of the schema's column checking, which is most of what these types are for.
  const query = db().from("challenges").update(
    seat === "challenger"
      ? { challenger_started_at: startedAt }
      : { opponent_started_at: startedAt },
  );

  const { error } =
    seat === "challenger"
      ? await query.eq("id", row.id).is("challenger_started_at", null)
      : await query.eq("id", row.id).is("opponent_started_at", null);

  if (error) return { ok: false, reason: "Could not open the challenge." };

  return { ok: true, scramble: row.scramble, startedAt };
}

export interface SubmitInput {
  profileId: string;
  challengeId: string;
  clientId: string;
  moves: SubmittedMove[];
  durationMs: number;
  penalty: Penalty;
  source: "keyboard" | "smartcube";
  splits?: unknown;
}

export type SubmitResult =
  | {
      accepted: true;
      penalty: Penalty;
      inspectionMs: number;
      inspectionReason: string;
      /** Present only once both players are in. */
      settled: boolean;
      outcome: "win" | "loss" | "draw" | null;
      own: Side;
      theirs: Side | null;
    }
  | { accepted: false; reason: string };

export async function submitSide(input: SubmitInput): Promise<SubmitResult> {
  const { data: raw } = await db()
    .from("challenges")
    .select("*")
    .eq("id", input.challengeId)
    .maybeSingle();

  if (!raw) return { accepted: false, reason: "No such challenge." };
  const row = await settle(raw as ChallengeRow, Date.now());

  const seat = seatOf(row, input.profileId);
  if (!seat) return { accepted: false, reason: "No such challenge." };
  if (row.status !== "pending") return { accepted: false, reason: "That challenge is over." };
  if (sideOf(row, seat).penalty !== null) {
    return { accepted: false, reason: "You have already solved this one." };
  }

  const startedAtRaw =
    seat === "challenger" ? row.challenger_started_at : row.opponent_started_at;
  if (!startedAtRaw) {
    return { accepted: false, reason: "Open the challenge before solving it." };
  }

  const receivedAt = Date.now();
  const startedAt = new Date(startedAtRaw).getTime();
  const durationMs = Math.round(input.durationMs);

  const prefix = seat === "challenger" ? "challenger" : "opponent";

  // A declared DNF needs no proof — nobody fakes failing.
  if (input.penalty === "DNF") {
    return finish(row, seat, prefix, { durationMs: 0, penalty: "DNF", solveId: null }, {
      inspectionMs: 0,
      inspectionReason: "",
    });
  }

  const verdict = await verifySolve({
    scramble: row.scramble,
    moves: input.moves,
    durationMs,
    issuedAt: startedAt,
    receivedAt,
  });

  if (!verdict.verified) {
    // Spent either way. Leaving the side open would let a player probe the
    // verifier until something passed, which is the same reason a failed ranked
    // attempt is consumed rather than returned.
    await finish(row, seat, prefix, { durationMs, penalty: "DNF", solveId: null }, {
      inspectionMs: 0,
      inspectionReason: "",
    });
    return { accepted: false, reason: verdict.reason };
  }

  // Inspection is measured from when this player opened their own half, which is
  // the moment the scramble became visible to them — exactly where the real rule
  // starts counting.
  const inspection = judgeInspection(receivedAt - durationMs - startedAt);
  const penalty = combinePenalties(input.penalty, inspection.penalty);

  const { data: solve, error: solveError } = await db()
    .from("solves")
    .insert({
      profile_id: input.profileId,
      client_id: input.clientId,
      event: row.event,
      scramble: row.scramble,
      duration_ms: durationMs,
      penalty,
      move_count: verdict.moveCount,
      tps: verdict.tps,
      source: input.source,
      mode: "challenge",
      verified: true,
      moves: input.moves as never,
      splits: (input.splits ?? []) as never,
      solved_at: new Date(receivedAt).toISOString(),
    })
    .select("id")
    .single();

  // The result is about to be written against this solve. Recording it with no
  // solve stored would produce a head-to-head win nobody can inspect — and a
  // result whose evidence does not exist is exactly what this app claims cannot
  // happen. The ranked path has always refused here; this one used to discard
  // the error and record the win anyway.
  if (solveError) {
    throw new Error(`Could not store the verified solve: ${solveError.message}`);
  }

  return finish(
    row,
    seat,
    prefix,
    { durationMs, penalty, solveId: solve?.id ?? null },
    { inspectionMs: inspection.inspectionMs, inspectionReason: inspection.reason },
  );
}

/** Writes one player's result, then settles the challenge if that completed it. */
async function finish(
  row: ChallengeRow,
  seat: Seat,
  prefix: "challenger" | "opponent",
  result: { durationMs: number; penalty: Penalty; solveId: string | null },
  inspection: { inspectionMs: number; inspectionReason: string },
): Promise<SubmitResult> {
  // Written out per seat for the same reason as `startSide`: a computed key
  // types as a bare string index and takes the update outside the schema's
  // checking altogether.
  const patch =
    prefix === "challenger"
      ? {
          challenger_duration_ms: result.durationMs,
          challenger_penalty: result.penalty,
          challenger_solve_id: result.solveId,
        }
      : {
          opponent_duration_ms: result.durationMs,
          opponent_penalty: result.penalty,
          opponent_solve_id: result.solveId,
        };

  const query = db().from("challenges").update(patch).eq("id", row.id);

  // The guard is what makes a double submission safe: whoever writes second
  // matches nothing rather than overwriting the first result.
  const { data: updated, error } =
    prefix === "challenger"
      ? await query.is("challenger_penalty", null).select("*").maybeSingle()
      : await query.is("opponent_penalty", null).select("*").maybeSingle();

  if (error) return { accepted: false, reason: "Could not record the result." };
  if (!updated) {
    // The guard matched nothing, so a result was already recorded for this seat.
    return { accepted: false, reason: "You have already solved this one." };
  }

  const settled = await settle(updated as ChallengeRow, Date.now());
  const state = stateOf(settled);
  const view = visibleTo(seat, state, settled.scramble, true);

  return {
    accepted: true,
    penalty: result.penalty,
    inspectionMs: inspection.inspectionMs,
    inspectionReason: inspection.inspectionReason,
    settled: settled.status !== "pending",
    outcome: outcomeFor(seat, settled.winner),
    own: view.own,
    theirs: view.theirs,
  };
}

export interface ChallengeRecord {
  wins: number;
  losses: number;
  draws: number;
  awaitingYou: number;
}

/** The counts a header badge needs, in one query rather than a list. */
export async function challengeRecord(profileId: string): Promise<ChallengeRecord> {
  const views = await listChallenges(profileId, 200);
  return {
    wins: views.filter((v) => v.outcome === "win").length,
    losses: views.filter((v) => v.outcome === "loss").length,
    draws: views.filter((v) => v.outcome === "draw").length,
    awaitingYou: views.filter((v) => v.awaitingYou).length,
  };
}
