import "server-only";

import { combinePenalties, judgeInspection } from "../inspection";
import { eventOf } from "../events";
import { humannessOf } from "../humanness";
import type { Penalty } from "../types";
import { verifySolve, type SubmittedMove } from "../verifySolve";
import { db } from "./supabase";
import { analysisFromStream } from "./solveAnalysis";

/**
 * The part of a server-issued attempt that is the same wherever it was issued:
 * prove the moves solve the stored scramble inside the time since it was sent,
 * judge inspection from the server's clock, and store the solve as verified.
 *
 * Ranked and the weekly both call this, so a rule tightened here tightens both
 * — there is one verifier, not one per mode that could drift apart.
 */

export interface VerifiedInput {
  profileId: string;
  clientId: string;
  /** From the stored attempt, never the request. */
  event: string;
  scramble: string;
  issuedAt: number;
  receivedAt: number;
  moves: SubmittedMove[];
  durationMs: number;
  penalty: Penalty;
  source: "keyboard" | "smartcube";
  mode: "ranked" | "weekly";
}

export type VerifiedOutcome =
  | {
      verified: true;
      solveId: string | null;
      penalty: Penalty;
      moveCount: number;
      tps: number;
      inspectionMs: number;
      inspectionReason: string;
    }
  | { verified: false; reason: string };

export async function verifyAndStore(input: VerifiedInput): Promise<VerifiedOutcome> {
  // The scramble compared against is the one from the database, never one the
  // client sent along. That single choice is what every result rests on.
  const verdict = await verifySolve({
    scramble: input.scramble,
    moves: input.moves,
    durationMs: input.durationMs,
    issuedAt: input.issuedAt,
    receivedAt: input.receivedAt,
    // The event decides which puzzle the moves are replayed against; letting
    // the submitter pick it would let them choose the puzzle their solution
    // happens to solve.
    event: eventOf(input.event).id,
  });
  if (!verdict.verified) return { verified: false, reason: verdict.reason };

  // Inspection, measured from the server's own clock.
  //
  // The scramble was sent at `issuedAt` and the first turn happened
  // `durationMs` before the submission arrived, so the gap between them is how
  // long the player looked at the cube. That is the WCA rule stated faithfully —
  // inspection begins the moment you are allowed to see it — and it is the only
  // version that can be enforced, since the penalty only ever hurts and a
  // client-reported figure would always be under-reported.
  const inspection = judgeInspection(input.receivedAt - input.durationMs - input.issuedAt);
  const penalty = combinePenalties(input.penalty, inspection.penalty);

  const analysis = await analysisFromStream(input.event, input.scramble, input.moves);
  const { data: solve, error } = await db()
    .from("solves")
    .insert({
      profile_id: input.profileId,
      client_id: input.clientId,
      event: input.event,
      scramble: input.scramble,
      duration_ms: input.durationMs,
      penalty,
      move_count: verdict.moveCount,
      tps: verdict.tps,
      source: input.source,
      mode: input.mode,
      verified: true,
      // Advisory only, and never consulted here. Verification says the moves
      // solve the scramble; this says whether they arrived the way a person's
      // moves arrive. Stored for review rather than acted on, because a missed
      // cheat costs one result and a wrongly flagged player costs the belief the
      // whole site runs on.
      humanness: humannessOf(input.moves, input.durationMs),
      moves: input.moves as never,
      // Derived from the verified stream, never taken from the request.
      splits: analysis.splits as never,
      oll_case: analysis.ollCase,
      pll_case: analysis.pllCase,
      solved_at: new Date(input.receivedAt).toISOString(),
    })
    .select("id")
    .single();

  // The attempt is about to be marked complete against this solve. Completing it
  // with no solve stored would leave a result nobody can inspect.
  if (error) throw new Error(`Could not store the verified solve: ${error.message}`);

  return {
    verified: true,
    solveId: solve?.id ?? null,
    penalty,
    moveCount: verdict.moveCount,
    tps: verdict.tps,
    inspectionMs: inspection.inspectionMs,
    inspectionReason: inspection.reason,
  };
}
