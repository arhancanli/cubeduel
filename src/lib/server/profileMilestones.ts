import "server-only";

import { parseSyncedEvent } from "../events";
import { milestones, type MilestoneSolve, type TrackProgress } from "../milestones";
import { isSealed } from "../weekly";
import type { Penalty } from "../types";
import { db } from "./supabase";

/**
 * A player's milestones, read from every solve their account holds.
 *
 * The same derivation as the ladder on /progress, so a profile and its owner's
 * own page can never disagree about what was broken. What the profile adds is
 * proof: each milestone links to the solve that earned it, and says whether
 * the server replayed that solve's turns itself. A practice solve synced from
 * a browser is the player's word; a ranked or daily solve is checked.
 *
 * A solve the server refused — its turns did not solve its scramble — earns
 * nothing.
 */

/**
 * What stands behind a solve: the server replayed its turns; it was turned on
 * this site but only practice, so never replayed; or it is a stopwatch time.
 */
export type Proof = "verified" | "practice" | "self-timed";

export interface ProfileMilestones {
  ladders: TrackProgress[];
  proof: Map<string, Proof>;
  /** Solves from this week's competition: counted, but not linked until it closes. */
  sealed: Set<string>;
}

/** PostgREST returns at most a thousand rows a request. */
const PAGE = 1000;
/** Far past any real history; a bound so one profile view cannot read forever. */
const MAX_ROWS = 20_000;

export async function profileMilestones(profileId: string): Promise<ProfileMilestones> {
  const solves: MilestoneSolve[] = [];
  const proof = new Map<string, Proof>();
  const sealed = new Set<string>();
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db()
      .from("solves")
      .select("id, event, source, duration_ms, penalty, solved_at, verified, mode")
      .eq("profile_id", profileId)
      .is("reject_reason", null)
      .order("solved_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const event = parseSyncedEvent(row.event);
      if (event === null) continue;
      solves.push({
        id: row.id,
        at: new Date(row.solved_at).getTime(),
        ms: row.duration_ms,
        penalty: row.penalty as Penalty,
        event,
        hand: row.source === "keyboard" ? "keyboard" : "cube",
      });
      if (isSealed(row.mode, Date.parse(row.solved_at))) sealed.add(row.id);
      proof.set(row.id, row.verified ? "verified" : row.source === "manual" ? "self-timed" : "practice");
    }
    if (!data || data.length < PAGE) break;
  }
  return { ladders: milestones(solves), proof, sealed };
}
