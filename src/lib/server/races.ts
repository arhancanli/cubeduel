import "server-only";

import { eventOf } from "../events";
import { humannessOf } from "../humanness";
import { combinePenalties, judgeInspection } from "../inspection";
import {
  RACE_COUNTDOWN_MS,
  RACE_LOBBY_TTL_MS,
  isRaceCode,
  phaseOf,
  raceCode,
  readyToStart,
  resolveRace,
  sanitizeProgress,
  scrambleVisible,
  type RacePhase,
  type RaceProgress,
  type RaceSeat,
  type RaceState,
  type RaceStatus,
  type RaceWinner,
} from "../race";
import type { Penalty } from "../types";
import { verifySolve, type SubmittedMove } from "../verifySolve";
import type { Row } from "./database.types";
import { analysisFromStream } from "./solveAnalysis";
import { db } from "./supabase";

/**
 * Live races, against the database. The rules are in `src/lib/race.ts`; this
 * applies them, and every write that could race another is a conditional update
 * guarded on the state it expects — two players press ready in the same
 * instant, two tabs submit the same seat, two readers settle the same race.
 */

type RaceRow = Row<"races">;

/** How many unfinished races one person may have open as host at once. */
const MAX_OPEN_HOSTED = 5;

async function freshScramble(event: string): Promise<string> {
  const { randomScrambleForEvent } = await import("cubing/scramble");
  const alg = await randomScrambleForEvent(event);
  return alg.toString();
}

function time(value: string | null): number | null {
  return value === null ? null : new Date(value).getTime();
}

function stateOf(row: RaceRow): RaceState {
  return {
    status: row.status as RaceState["status"],
    guestPresent: row.guest_id !== null,
    hostReady: row.host_ready,
    guestReady: row.guest_ready,
    startAt: time(row.start_at),
    expiresAt: time(row.expires_at)!,
    host: { durationMs: row.host_duration_ms, penalty: row.host_penalty as Penalty | null },
    guest: { durationMs: row.guest_duration_ms, penalty: row.guest_penalty as Penalty | null },
  };
}

function seatOf(row: RaceRow, profileId: string | null): RaceSeat | null {
  if (!profileId) return null;
  if (row.host_id === profileId) return "host";
  if (row.guest_id === profileId) return "guest";
  return null;
}

async function load(code: string): Promise<RaceRow | null> {
  if (!isRaceCode(code)) return null;
  const { data, error } = await db().from("races").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(`Could not read the race: ${error.message}`);
  return (data as RaceRow | null) ?? null;
}

/**
 * Writes down what the rules say a race has become. Called on every read, and
 * guarded on the status it read, so two readers cannot both settle it and the
 * second cannot overwrite the first.
 */
async function settle(row: RaceRow, now: number): Promise<RaceRow> {
  const decision = resolveRace(stateOf(row), now);
  if (!decision.settled) return row;

  const update: Partial<RaceRow> =
    decision.status === "abandoned"
      ? { status: "abandoned", finished_at: new Date(now).toISOString() }
      : {
          status: "finished",
          winner: decision.winner,
          finished_at: new Date(now).toISOString(),
          // A seat that ran out of time is written down as the DNF it became.
          host_penalty: decision.host.penalty,
          host_duration_ms: decision.host.durationMs,
          guest_penalty: decision.guest.penalty,
          guest_duration_ms: decision.guest.durationMs,
        };

  const { data, error } = await db()
    .from("races")
    .update(update)
    .eq("id", row.id)
    .eq("status", row.status)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Could not settle the race: ${error.message}`);
  // Matching nothing means somebody else settled it first — from the same pure
  // function over the same row, so their answer is ours.
  return (data as RaceRow | null) ?? ((await load(row.code)) ?? row);
}

// ---------------------------------------------------------------------------

export type CreateRaceResult = { ok: true; code: string } | { ok: false; reason: string };

export async function createRace(profileId: string, event: string): Promise<CreateRaceResult> {
  const eventId = eventOf(event).id;

  const { count, error: countError } = await db()
    .from("races")
    .select("id", { count: "exact", head: true })
    .eq("host_id", profileId)
    .in("status", ["lobby", "started"])
    .gt("expires_at", new Date().toISOString());
  // Failing closed: a cap that cannot count is a cap that is not there.
  if (countError) return { ok: false, reason: "Could not check your open races." };
  if ((count ?? 0) >= MAX_OPEN_HOSTED) {
    return { ok: false, reason: `You already have ${MAX_OPEN_HOSTED} races waiting. Finish or let one lapse first.` };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = raceCode();
    const { error } = await db()
      .from("races")
      .insert({
        code,
        event: eventId,
        host_id: profileId,
        expires_at: new Date(Date.now() + RACE_LOBBY_TTL_MS).toISOString(),
      });
    if (!error) return { ok: true, code };
    // A code that already exists is the only failure worth another try.
    if (error.code !== "23505") return { ok: false, reason: "Could not create the race." };
  }
  return { ok: false, reason: "Could not create the race." };
}

export type JoinResult = { ok: true; seat: RaceSeat } | { ok: false; reason: string };

/** Takes the empty seat. Somebody already seated is told which seat is theirs. */
export async function joinRace(profileId: string, code: string): Promise<JoinResult> {
  const row = await load(code);
  if (!row) return { ok: false, reason: "No such race." };
  const seat = seatOf(row, profileId);
  if (seat) return { ok: true, seat };
  if (row.guest_id !== null) return { ok: false, reason: "Both seats are taken." };
  if (phaseOf(stateOf(row), Date.now()) !== "lobby") return { ok: false, reason: "That race is over." };

  // Guarded on the seat still being empty: two people opening the link at once
  // cannot both take it.
  const { data, error } = await db()
    .from("races")
    .update({ guest_id: profileId })
    .eq("id", row.id)
    .is("guest_id", null)
    .eq("status", "lobby")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: "Could not join the race." };
  if (!data) return { ok: false, reason: "Somebody took that seat first." };
  return { ok: true, seat: "guest" };
}

/**
 * Marks a seat ready or not. When that leaves both ready, starts the race:
 * a scramble generated now, and a start time a countdown away.
 */
export async function setReady(
  profileId: string,
  code: string,
  ready: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await load(code);
  if (!row) return { ok: false, reason: "No such race." };
  const seat = seatOf(row, profileId);
  if (!seat) return { ok: false, reason: "You are not in this race." };
  if (phaseOf(stateOf(row), Date.now()) !== "lobby") return { ok: false, reason: "That race has already started." };

  const { data: updated, error } = await db()
    .from("races")
    .update(seat === "host" ? { host_ready: ready } : { guest_ready: ready })
    .eq("id", row.id)
    .eq("status", "lobby")
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, reason: "Could not update the race." };
  if (!updated) return { ok: false, reason: "That race has already started." };

  const fresh = updated as RaceRow;
  if (readyToStart(stateOf(fresh))) {
    const scramble = await freshScramble(fresh.event);
    // Guarded on everything that made it ready: whichever of the two ready
    // presses gets here second finds the status already 'started' and changes
    // nothing — one scramble, one start time.
    const { error: startError } = await db()
      .from("races")
      .update({
        status: "started",
        scramble,
        start_at: new Date(Date.now() + RACE_COUNTDOWN_MS).toISOString(),
      })
      .eq("id", fresh.id)
      .eq("status", "lobby")
      .eq("host_ready", true)
      .eq("guest_ready", true)
      .not("guest_id", "is", null);
    // Both players see "ready" and nothing happens: that is what a discarded
    // error here would look like, so it is reported instead.
    if (startError) return { ok: false, reason: "Could not start the race." };
  }
  return { ok: true };
}

/** Records how far through the solve a player says they are. Display only. */
export async function reportProgress(profileId: string, code: string, raw: unknown): Promise<boolean> {
  const progress = sanitizeProgress(raw);
  if (!progress) return false;
  const row = await load(code);
  if (!row) return false;
  const seat = seatOf(row, profileId);
  if (!seat || phaseOf(stateOf(row), Date.now()) !== "racing") return false;

  const { error } = await db()
    .from("races")
    .update(seat === "host" ? { host_progress: progress as never } : { guest_progress: progress as never })
    .eq("id", row.id)
    .eq("status", "started")
    .is(seat === "host" ? "host_penalty" : "guest_penalty", null);
  return !error;
}

export interface RaceSubmit {
  profileId: string;
  code: string;
  clientId: string;
  moves: SubmittedMove[];
  durationMs: number;
  penalty: Penalty;
  source: "keyboard" | "smartcube";
}

export type RaceSubmitResult =
  | { accepted: true; durationMs: number; penalty: Penalty; inspectionReason: string }
  | { accepted: false; reason: string };

export async function submitRace(input: RaceSubmit): Promise<RaceSubmitResult> {
  const loaded = await load(input.code);
  if (!loaded) return { accepted: false, reason: "No such race." };
  const receivedAt = Date.now();
  const row = await settle(loaded, receivedAt);

  const seat = seatOf(row, input.profileId);
  if (!seat) return { accepted: false, reason: "You are not in this race." };
  if (row.status !== "started" || !row.scramble || !row.start_at) {
    return { accepted: false, reason: "That race is not running." };
  }
  const startAt = new Date(row.start_at).getTime();
  if (receivedAt < startAt) return { accepted: false, reason: "The race has not started." };
  if ((seat === "host" ? row.host_penalty : row.guest_penalty) !== null) {
    return { accepted: false, reason: "You have already finished this race." };
  }

  const durationMs = Math.round(input.durationMs);
  let result: { durationMs: number; penalty: Penalty; solveId: string | null; inspectionReason: string };

  if (input.penalty === "DNF") {
    // A declared DNF needs no proof — nobody fakes failing.
    result = { durationMs: 0, penalty: "DNF", solveId: null, inspectionReason: "" };
  } else {
    const verdict = await verifySolve({
      scramble: row.scramble,
      moves: input.moves,
      durationMs,
      // The scramble became visible at the start, so that is where the clock
      // the verifier checks against — and inspection — began.
      issuedAt: startAt,
      receivedAt,
      event: eventOf(row.event).id,
    });
    if (!verdict.verified) {
      // Spent either way, so a player cannot probe the verifier until
      // something passes.
      await writeSeat(row, seat, { durationMs, penalty: "DNF", solveId: null });
      await settle((await load(row.code)) ?? row, Date.now());
      return { accepted: false, reason: verdict.reason };
    }

    const inspection = judgeInspection(receivedAt - durationMs - startAt);
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
        mode: "race",
        verified: true,
        humanness: humannessOf(input.moves, durationMs),
        moves: input.moves as never,
        splits: analysis.splits as never,
        oll_case: analysis.ollCase,
        pll_case: analysis.pllCase,
        solved_at: new Date(receivedAt).toISOString(),
      })
      .select("id")
      .single();
    // A result with no solve behind it is a win nobody can inspect.
    if (solveError) throw new Error(`Could not store the race solve: ${solveError.message}`);
    result = { durationMs, penalty, solveId: solve?.id ?? null, inspectionReason: inspection.reason };
  }

  const written = await writeSeat(row, seat, result);
  if (!written) return { accepted: false, reason: "You have already finished this race." };
  await settle((await load(row.code)) ?? row, Date.now());
  return {
    accepted: true,
    durationMs: result.durationMs,
    penalty: result.penalty,
    inspectionReason: result.inspectionReason,
  };
}

/** Writes one seat's result, once: guarded on the seat still being empty. */
async function writeSeat(
  row: RaceRow,
  seat: RaceSeat,
  result: { durationMs: number; penalty: Penalty; solveId: string | null },
): Promise<boolean> {
  const update =
    seat === "host"
      ? { host_duration_ms: result.durationMs, host_penalty: result.penalty, host_solve_id: result.solveId }
      : { guest_duration_ms: result.durationMs, guest_penalty: result.penalty, guest_solve_id: result.solveId };
  const { data, error } = await db()
    .from("races")
    .update(update)
    .eq("id", row.id)
    .eq("status", "started")
    .is(seat === "host" ? "host_penalty" : "guest_penalty", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not record the race result: ${error.message}`);
  return data !== null;
}

// ---------------------------------------------------------------------------

export interface RacePlayer {
  handle: string;
  displayName: string;
  ready: boolean;
  progress: RaceProgress | null;
  /** Their result, once they have one. Shown live — the race is not blind. */
  result: { durationMs: number; penalty: Penalty } | null;
}

export interface RaceView {
  code: string;
  event: string;
  phase: RacePhase;
  /** The server's clock, so a screen can place the countdown on it. */
  serverNow: number;
  startAt: number | null;
  /** Only once it is showing on both screens. */
  scramble: string | null;
  you: RaceSeat | null;
  host: RacePlayer;
  guest: RacePlayer | null;
  winner: RaceWinner | null;
  rematchCode: string | null;
}

/** Everything one viewer may know about a race, settled first. */
export async function raceView(code: string, viewerId: string | null): Promise<RaceView | null> {
  const loaded = await load(code);
  if (!loaded) return null;
  const now = Date.now();
  const row = await settle(loaded, now);
  const state = stateOf(row);

  const ids = [row.host_id, row.guest_id].filter((id): id is string => id !== null);
  const { data: profiles, error } = await db()
    .from("profiles")
    .select("id, handle, display_name")
    .in("id", ids);
  if (error) throw new Error(`Could not read the players: ${error.message}`);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const player = (seat: RaceSeat): RacePlayer | null => {
    const id = seat === "host" ? row.host_id : row.guest_id;
    if (!id) return null;
    const profile = byId.get(id);
    const penalty = (seat === "host" ? row.host_penalty : row.guest_penalty) as Penalty | null;
    const durationMs = seat === "host" ? row.host_duration_ms : row.guest_duration_ms;
    return {
      handle: profile?.handle ?? "",
      displayName: profile?.display_name ?? profile?.handle ?? "",
      ready: seat === "host" ? row.host_ready : row.guest_ready,
      progress: sanitizeProgress(seat === "host" ? row.host_progress : row.guest_progress),
      result: penalty !== null && durationMs !== null ? { durationMs, penalty } : null,
    };
  };

  return {
    code: row.code,
    event: row.event,
    phase: phaseOf(state, now),
    serverNow: now,
    startAt: state.startAt,
    scramble: scrambleVisible(state, now) ? row.scramble : null,
    you: seatOf(row, viewerId),
    host: player("host")!,
    guest: player("guest"),
    winner: (row.winner as RaceWinner | null) ?? null,
    rematchCode: row.rematch_code,
  };
}

/**
 * A new race between the same two players, both seated and neither ready.
 * Asked for once: the second player to ask is handed the code the first made,
 * so both screens end up in the same race.
 */
export async function rematch(profileId: string, code: string): Promise<CreateRaceResult> {
  const row = await load(code);
  if (!row) return { ok: false, reason: "No such race." };
  const seat = seatOf(row, profileId);
  if (!seat || !row.guest_id) return { ok: false, reason: "You are not in this race." };
  if (row.status !== "finished") return { ok: false, reason: "Finish this race first." };
  if (row.rematch_code) return { ok: true, code: row.rematch_code };

  const opponent = seat === "host" ? row.guest_id : row.host_id;
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = raceCode();
    const { error } = await db()
      .from("races")
      .insert({
        code: next,
        event: row.event,
        host_id: profileId,
        guest_id: opponent,
        expires_at: new Date(Date.now() + RACE_LOBBY_TTL_MS).toISOString(),
      });
    if (error?.code === "23505") continue;
    if (error) return { ok: false, reason: "Could not start a rematch." };

    // Only the first rematch sticks; a simultaneous second one is left unused
    // and lapses, and both players are pointed at the first.
    const { data } = await db()
      .from("races")
      .update({ rematch_code: next })
      .eq("id", row.id)
      .is("rematch_code", null)
      .select("rematch_code")
      .maybeSingle();
    if (data?.rematch_code) return { ok: true, code: data.rematch_code };
    const winner = await load(row.code);
    return winner?.rematch_code ? { ok: true, code: winner.rematch_code } : { ok: true, code: next };
  }
  return { ok: false, reason: "Could not start a rematch." };
}

/**
 * What a link preview may say about a race, for the card a chat app renders.
 *
 * Three rules shape it. It never touches the scramble — the same rule the
 * daily's card follows, and it matters more here: a preview that leaked the
 * cube would let the person who opened the link first study it before pressing
 * ready. It does not settle the race, unlike every other read, because a link
 * preview is a robot looking at a message and not a player looking at a race,
 * and a robot should not be able to declare somebody's race abandoned. And it
 * says nothing a player has not already shared by sending the link.
 */
export interface RaceCard {
  event: string;
  status: RaceStatus;
  hostName: string;
  guestName: string | null;
  winner: RaceWinner | null;
  hostResult: { durationMs: number; penalty: Penalty } | null;
  guestResult: { durationMs: number; penalty: Penalty } | null;
}

export async function raceCard(code: string): Promise<RaceCard | null> {
  const row = await load(code);
  if (!row) return null;

  const ids = [row.host_id, row.guest_id].filter((id): id is string => id !== null);
  const { data: profiles } = await db()
    .from("profiles")
    .select("id, handle, display_name")
    .in("id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const name = (id: string | null) => {
    if (!id) return null;
    const profile = byId.get(id);
    return profile?.display_name ?? profile?.handle ?? null;
  };

  const result = (seat: RaceSeat) => {
    const durationMs = seat === "host" ? row.host_duration_ms : row.guest_duration_ms;
    const penalty = (seat === "host" ? row.host_penalty : row.guest_penalty) as Penalty | null;
    return durationMs !== null && penalty !== null ? { durationMs, penalty } : null;
  };

  return {
    event: row.event,
    status: row.status as RaceStatus,
    hostName: name(row.host_id) ?? "A cuber",
    guestName: name(row.guest_id),
    winner: (row.winner as RaceWinner | null) ?? null,
    hostResult: result("host"),
    guestResult: result("guest"),
  };
}
