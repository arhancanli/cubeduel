import "server-only";

import {
  CHALLENGE_TTL_MS,
  MAX_OPEN_PER_PLAYER,
  MAX_OUTGOING_PENDING,
  type AcceptRefusal,
  type ChallengeState,
  type ChallengeStatus,
  type Side,
  type Winner,
  acceptRefusalText,
  canAccept,
  resolve,
  visibleTo,
} from "../challenge";
import { eventOf } from "../events";
import { combinePenalties, judgeInspection } from "../inspection";
import { humannessOf } from "../humanness";
import type { Penalty } from "../types";
import { verifySolve, type SubmittedMove } from "../verifySolve";
import { db } from "./supabase";
import { analysisFromStream } from "./solveAnalysis";
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
  /** Null while an open challenge is still waiting for somebody to take it. */
  opponent_id: string | null;
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
  /** Still on the board, waiting for anybody to take the second seat. */
  open: boolean;
}

function outcomeFor(seat: Seat, winner: Winner | null): "win" | "loss" | "draw" | null {
  if (winner === null) return null;
  if (winner === "draw") return "draw";
  return winner === seat ? "win" : "loss";
}

async function toView(row: ChallengeRow, profileId: string): Promise<ChallengeView | null> {
  const seat = seatOf(row, profileId);
  if (!seat) return null;

  // An open challenge has nobody on the other side yet, and the panel says so
  // rather than naming a player who does not exist.
  const otherId = seat === "challenger" ? row.opponent_id : row.challenger_id;
  const { data: other } = otherId
    ? await db().from("profiles").select("handle, display_name").eq("id", otherId).maybeSingle()
    : { data: null };

  const started =
    seat === "challenger" ? row.challenger_started_at !== null : row.opponent_started_at !== null;
  const view = visibleTo(seat, stateOf(row), row.scramble, started);

  return {
    id: row.id,
    seat,
    event: row.event,
    them: {
      handle: other?.handle ?? (otherId === null ? "" : "unknown"),
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
    open: row.opponent_id === null,
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

/**
 * Leaves a challenge on the board for anybody to take.
 *
 * The same row as a named challenge with the opponent left empty, and
 * deliberately so: the accept fills the seat and every rule after that — the
 * scramble hidden until each side opens their attempt, neither time shown until
 * both have solved, the lapse that hands the win to whoever did solve — is the
 * code that was already there and already tested.
 */
export async function createOpenChallenge(
  challengerId: string,
  event = "333",
): Promise<CreateResult> {
  const now = Date.now();

  // Counted rather than trusted: this is a public board, and ten offers from
  // one player is not a busy player but a wall. The same read failed open once
  // in the named path — an error left `count` null and `?? 0` read that as
  // "none" — so an unreadable count is a refusal here too.
  const { count, error: countError } = await db()
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("challenger_id", challengerId)
    .eq("status", "pending")
    .is("opponent_id", null);

  if (countError || count === null) {
    return { ok: false, reason: "Could not check your open challenges. Try again." };
  }
  if (count >= MAX_OPEN_PER_PLAYER) {
    return {
      ok: false,
      reason: `You already have ${MAX_OPEN_PER_PLAYER} challenges on the board. Wait for somebody to take one.`,
    };
  }

  const { data, error } = await db()
    .from("challenges")
    .insert({
      challenger_id: challengerId,
      opponent_id: null,
      event,
      scramble: await freshScramble(event),
      expires_at: new Date(now + CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, reason: "Could not create the challenge." };
  return { ok: true, challengeId: data.id };
}

/** One offer on the board, as everybody but its author sees it. */
export interface OpenChallengeView {
  id: string;
  event: string;
  createdAt: string;
  expiresAt: string;
  by: { handle: string; displayName: string | null };
  /** Whether its author has already taken their own attempt. */
  authorSolved: boolean;
}

/**
 * The board: offers nobody has taken yet, newest first.
 *
 * Excludes your own, because the one thing you cannot do with an offer is take
 * it, and a board where half the rows refuse you is a worse board. Your own
 * offers appear in your challenge list, marked as waiting.
 */
export async function listOpenChallenges(
  viewerId: string | null,
  limit = 20,
): Promise<OpenChallengeView[]> {
  const query = db()
    .from("challenges")
    .select("*")
    .is("opponent_id", null)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error } = viewerId ? await query.neq("challenger_id", viewerId) : await query;
  if (error) raise(error, "challenges", "Could not load the open challenges");

  const rows = data as ChallengeRow[];
  if (rows.length === 0) return [];

  const { data: profiles } = await db()
    .from("profiles")
    .select("id, handle, display_name")
    .in("id", [...new Set(rows.map((row) => row.challenger_id))]);
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    by: {
      handle: byId.get(row.challenger_id)?.handle ?? "unknown",
      displayName: byId.get(row.challenger_id)?.display_name ?? null,
    },
    // Worth knowing before you take it: a time you cannot see has already been
    // set, and the challenge will settle as soon as you solve.
    authorSolved: row.challenger_penalty !== null,
  }));
}

export type AcceptResult =
  | { ok: true; challengeId: string }
  | { ok: false; reason: string; refusal: AcceptRefusal | "missing" };

/**
 * Takes the second seat of an open challenge.
 *
 * Two people pressing accept in the same second is the ordinary case on a public
 * board, so the seat is filled by a write guarded on the row it read — `is
 * opponent_id null` — rather than by checking first and writing after. The
 * checks above it exist to give the reason in words; this is what makes only one
 * of them land.
 */
export async function acceptChallenge(profileId: string, id: string): Promise<AcceptResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, reason: "No such challenge.", refusal: "missing" };
  }

  const { data: row, error } = await db()
    .from("challenges")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) raise(error, "challenges", "Could not read the challenge");
  if (!row) return { ok: false, reason: "No such challenge.", refusal: "missing" };

  const challenge = row as ChallengeRow;
  const verdict = canAccept(
    {
      challengerId: challenge.challenger_id,
      opponentId: challenge.opponent_id,
      status: challenge.status,
      expiresAt: Date.parse(challenge.expires_at),
    },
    profileId,
    Date.now(),
  );
  if (!verdict.ok) {
    return { ok: false, reason: acceptRefusalText(verdict.reason), refusal: verdict.reason };
  }

  const { data: taken, error: takeError } = await db()
    .from("challenges")
    .update({ opponent_id: profileId })
    .eq("id", id)
    .eq("status", "pending")
    .is("opponent_id", null)
    .select("id")
    .maybeSingle();

  if (takeError) raise(takeError, "challenges", "Could not take the challenge");
  if (!taken) {
    return { ok: false, reason: acceptRefusalText("already taken"), refusal: "already taken" };
  }

  return { ok: true, challengeId: id };
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
    // From the stored challenge, never the client.
    event: eventOf(row.event).id,
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

  const analysis = await analysisFromStream(row.event, row.scramble, input.moves);
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
      // Advisory only, and never consulted here. Verification says the moves
      // solve the scramble; this says whether they arrived the way a person's
      // moves arrive. Stored for review rather than acted on, because a missed
      // cheat costs one rating and a wrongly flagged player costs the belief the
      // ladder runs on.
      humanness: humannessOf(input.moves, durationMs),
      moves: input.moves as never,
      // Derived from the verified stream, never taken from the request.
      splits: analysis.splits as never,
      oll_case: analysis.ollCase,
      pll_case: analysis.pllCase,
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

/**
 * What a link preview may say about a challenge.
 *
 * Narrower than the board's view on purpose. Anybody with the id can ask for
 * this, so it names only the player who created the challenge — who published
 * the link by sending it — and never the opponent, whose involvement is between
 * the two of them. No scramble, for the reason every other card here has none:
 * a preview that showed the cube would let a group chat study it.
 *
 * Reads without settling, like the race card: a robot fetching a preview should
 * not be able to expire somebody's challenge by looking at it.
 */
export interface ChallengeCard {
  event: string;
  status: ChallengeStatus;
  open: boolean;
  by: string;
  expiresAt: string;
}

export async function challengeCard(id: string): Promise<ChallengeCard | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const { data } = await db().from("challenges").select("*").eq("id", id).maybeSingle();
  if (!data) return null;

  const row = data as ChallengeRow;
  const { data: author } = await db()
    .from("profiles")
    .select("handle, display_name")
    .eq("id", row.challenger_id)
    .maybeSingle();

  return {
    event: row.event,
    status: row.status,
    open: row.opponent_id === null,
    by: author?.display_name ?? author?.handle ?? "A cuber",
    expiresAt: row.expires_at,
  };
}
