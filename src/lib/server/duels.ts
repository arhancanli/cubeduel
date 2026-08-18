import "server-only";

import { buildBotSolve, botById, type BotProfile } from "../bot";
import { buildTables, solveScramble } from "../solver";
import type { Penalty } from "../types";
import { ATTEMPT_TTL_MS, verifySolve, type SubmittedMove } from "../verifySolve";
import { eventOf } from "../events";
import { db } from "./supabase";
import { raise } from "./schema";

/**
 * Racing a bot.
 *
 * The whole design turns on one decision: the opponent's trajectory is generated
 * and **stored before the player starts**. Every move it will make and the exact
 * millisecond it lands are in the database, timestamped, from before the race
 * began. The bot therefore cannot speed up when it is losing, which is the usual
 * way racing games lie to people, and this is checkable rather than promised.
 *
 * Two consequences fall out of that:
 *
 * - The trajectory can be handed to the client at the start, so the opponent's
 *   progress renders locally from the real move stream. No polling, no realtime
 *   channel, no new infrastructure — which is what makes this shippable here.
 * - Knowing the bot's finishing time in advance is fine. It is a target, not a
 *   secret, and the player still has to produce a solve the server will verify.
 *
 * ## Duels and the rating
 *
 * A duel result does **not** move your rating, and that is deliberate. The rating
 * measures how fast you solve, and you solve at the same speed whether or not
 * somebody is racing you — so counting duels as a second path to the same number
 * would double the ways to move it without adding any information about you.
 * Duels are recorded, verified, and kept as a win/loss record of their own.
 */

export interface DuelStart {
  duelId: string;
  scramble: string;
  bot: BotProfile;
  /** The opponent's committed race, for local rendering. */
  botMoves: { move: string; atMs: number }[];
  botDurationMs: number;
  expiresAt: string;
}

/** A duel left open is closed as a loss, the same rule ranked uses for attempts. */
async function closeOpenDuels(profileId: string): Promise<void> {
  const { error } = await db()
    .from("duels")
    .update({
      status: "abandoned",
      outcome: "loss",
      player_penalty: "DNF",
      player_duration_ms: 0,
      completed_at: new Date().toISOString(),
    })
    .eq("profile_id", profileId)
    .eq("status", "open");

  // Failing silently here would hand back the reroll this rule exists to close:
  // start a duel, see it going badly, start another.
  if (error) throw new Error(`Could not close the open duel: ${error.message}`);
}

export async function startDuel(
  profileId: string,
  botId: string,
  event = "333",
): Promise<DuelStart> {
  const bot = botById(botId);
  if (!bot) throw new Error("Unknown opponent.");

  await closeOpenDuels(profileId);

  const { randomScrambleForEvent } = await import("cubing/scramble");
  const scramble = (await randomScrambleForEvent(event)).toString();

  // The bot races the same cube the player does, on a solution to that exact
  // scramble — not a canned trajectory borrowed from somewhere else.
  buildTables();
  const solution = solveScramble(scramble);
  if (!solution) throw new Error("Could not prepare an opponent for that scramble.");

  const seed = Math.floor(Math.random() * 0x7fffffff);
  const botSolve = buildBotSolve(solution.moves, bot.rating, seed);

  const now = Date.now();
  const { data, error } = await db()
    .from("duels")
    .insert({
      profile_id: profileId,
      event,
      scramble,
      bot_id: bot.id,
      bot_rating: bot.rating,
      bot_duration_ms: botSolve.durationMs,
      bot_moves: botSolve.moves as never,
      seed,
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + ATTEMPT_TTL_MS).toISOString(),
    })
    .select("id, expires_at")
    .single();

  if (error || !data) {
    throw new Error(`Could not start the duel: ${error?.message ?? "no row"}`);
  }

  return {
    duelId: data.id,
    scramble,
    bot,
    botMoves: botSolve.moves,
    botDurationMs: botSolve.durationMs,
    expiresAt: data.expires_at,
  };
}

export interface DuelFinishInput {
  profileId: string;
  duelId: string;
  clientId: string;
  moves: SubmittedMove[];
  durationMs: number;
  penalty: Penalty;
  source: "keyboard" | "smartcube";
  splits?: unknown;
}

export type DuelResult =
  | {
      accepted: true;
      outcome: "win" | "loss";
      playerDurationMs: number;
      botDurationMs: number;
      marginMs: number;
    }
  | { accepted: false; reason: string };

export async function finishDuel(input: DuelFinishInput): Promise<DuelResult> {
  const { data: duel } = await db()
    .from("duels")
    .select("*")
    .eq("id", input.duelId)
    .maybeSingle();

  if (!duel) return { accepted: false, reason: "No such duel." };
  // A duel belongs to the player it was started by.
  if (duel.profile_id !== input.profileId) {
    return { accepted: false, reason: "No such duel." };
  }
  if (duel.status !== "open") {
    return { accepted: false, reason: "That duel is already finished." };
  }

  const receivedAt = Date.now();
  const issuedAt = new Date(duel.issued_at).getTime();
  const durationMs = Math.round(input.durationMs);

  // A declared DNF is a loss and needs no proof — nobody fakes losing.
  if (input.penalty === "DNF") {
    await recordOutcome(duel.id, "loss", { durationMs: 0, penalty: "DNF", solveId: null });
    return {
      accepted: true,
      outcome: "loss",
      playerDurationMs: 0,
      botDurationMs: duel.bot_duration_ms,
      marginMs: 0,
    };
  }

  // Verified against the scramble the SERVER issued for this duel, exactly as a
  // ranked solve is. A duel win is worth nothing if the solve behind it is not.
  const verdict = await verifySolve({
    scramble: duel.scramble,
    moves: input.moves,
    durationMs,
    issuedAt,
    receivedAt,
    event: eventOf(duel.event).id,
  });

  if (!verdict.verified) {
    // The duel is spent either way: leaving it open would let a player probe the
    // verifier until something passed.
    await recordOutcome(duel.id, "loss", {
      durationMs,
      penalty: "DNF",
      solveId: null,
    });
    return { accepted: false, reason: verdict.reason };
  }

  const effective = durationMs + (input.penalty === "PLUS2" ? 2000 : 0);
  const outcome: "win" | "loss" = effective < duel.bot_duration_ms ? "win" : "loss";

  const { data: solve, error: solveError } = await db()
    .from("solves")
    .insert({
      profile_id: duel.profile_id,
      client_id: input.clientId,
      event: duel.event,
      scramble: duel.scramble,
      duration_ms: durationMs,
      penalty: input.penalty,
      move_count: verdict.moveCount,
      tps: verdict.tps,
      source: input.source,
      mode: "duel",
      verified: true,
      moves: input.moves as never,
      splits: (input.splits ?? []) as never,
      solved_at: new Date(receivedAt).toISOString(),
    })
    .select("id")
    .single();

  // Same rule as ranked: an outcome recorded against a solve that was never
  // stored is a win with no evidence behind it.
  if (solveError) {
    throw new Error(`Could not store the verified solve: ${solveError.message}`);
  }

  await recordOutcome(duel.id, outcome, {
    durationMs,
    penalty: input.penalty,
    solveId: solve?.id ?? null,
  });

  return {
    accepted: true,
    outcome,
    playerDurationMs: effective,
    botDurationMs: duel.bot_duration_ms,
    marginMs: Math.abs(duel.bot_duration_ms - effective),
  };
}

async function recordOutcome(
  duelId: string,
  outcome: "win" | "loss",
  result: { durationMs: number; penalty: Penalty; solveId: string | null },
): Promise<void> {
  const { error } = await db()
    .from("duels")
    .update({
      status: "finished",
      outcome,
      player_duration_ms: result.durationMs,
      player_penalty: result.penalty,
      solve_id: result.solveId,
      completed_at: new Date().toISOString(),
    })
    .eq("id", duelId)
    // Only an open duel may be finished, so two submissions racing cannot both
    // write a result.
    .eq("status", "open");

  if (error) throw new Error(`Could not record the duel result: ${error.message}`);
}

export interface DuelRecord {
  wins: number;
  losses: number;
  lastOutcome: "win" | "loss" | null;
}

export async function duelRecord(profileId: string): Promise<DuelRecord> {
  const { data, error } = await db()
    .from("duels")
    .select("outcome, completed_at")
    .eq("profile_id", profileId)
    .not("outcome", "is", null)
    .order("completed_at", { ascending: false })
    .limit(200);

  // Discarding this error rendered a record of `0W · 0L` during an outage, which
  // is indistinguishable from a real new player and so gets investigated by
  // nobody. A missing table is reported separately, because that one is a setup
  // step rather than a failure.
  if (error) raise(error, "duels", "Could not load your duel record");

  const rows = data ?? [];
  return {
    wins: rows.filter((r) => r.outcome === "win").length,
    losses: rows.filter((r) => r.outcome === "loss").length,
    lastOutcome: (rows[0]?.outcome as "win" | "loss" | undefined) ?? null,
  };
}
