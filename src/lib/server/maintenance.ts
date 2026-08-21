import "server-only";

import { sweepEmailTokens } from "./emailTokens";
import { sweepExpiredChallenges } from "./passkeys";
import { sweepExpiredSessions } from "./sessions";
import { db } from "./supabase";

/**
 * Removing what can no longer do anything.
 *
 * Five tables here accumulate rows that stop being useful: expired sessions,
 * spent WebAuthn challenges, redeemed email links, sign-in attempts old enough
 * to be outside every rate-limit window, and events old enough that no
 * retention question reaches them.
 *
 * Until this existed, **none of them were ever cleaned in production.** Three
 * sweep functions had been written and were called only by integration suites;
 * `auth_attempts` had no sweep at all. Nothing was broken, which is exactly why
 * it would have gone unnoticed — a table that grows slowly is invisible until
 * it is not.
 *
 * ## Nothing here is load-bearing, deliberately
 *
 * Every one of these is enforced on READ as well. An expired session is refused
 * because `sessionFromToken` checks the timestamps, not because a sweep removed
 * it; a spent challenge is gone because redeeming deletes it. So this can fail,
 * be misconfigured, or never run at all, and the only consequence is bigger
 * tables.
 *
 * That ordering is on purpose. The previous incarnation of scheduled work in
 * this project was a webhook that was live, correct, tested, and refusing every
 * request because a secret was never set — and the feature it implemented
 * existed nowhere else. Nothing here repeats that: `npm run sweep` works today
 * with no configuration, and the cron is an automation of it rather than the
 * only path.
 */

/**
 * Sign-in attempts older than any window that counts them.
 *
 * A day, not the fifteen-minute rate window: the rows are small and the extra
 * day is worth having when somebody asks why an account was locked out.
 */
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Events are kept for a year.
 *
 * Long enough for a year-over-year question, and a bound rather than "forever"
 * because the honest position on data you have stopped using is to delete it.
 */
const EVENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

async function deleteOlderThan(
  table: "auth_attempts" | "events",
  column: "created_at" | "at",
  ms: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - ms).toISOString();
  const { count, error } = await db()
    .from(table)
    .delete({ count: "exact" })
    .lte(column, cutoff);

  // Reported as zero rather than thrown. One table failing to sweep must not
  // stop the other four.
  if (error) return 0;
  return count ?? 0;
}

export interface SweepResult {
  sessions: number;
  challenges: number;
  emailTokens: number;
  authAttempts: number;
  events: number;
}

export async function sweepAll(): Promise<SweepResult> {
  // Sequential rather than parallel. This runs at most once a day against a
  // database that is also serving people, and five concurrent deletes to save
  // two seconds on a job nobody is waiting for is the wrong trade.
  return {
    sessions: await sweepExpiredSessions(),
    challenges: await sweepExpiredChallenges(),
    emailTokens: await sweepEmailTokens(),
    authAttempts: await deleteOlderThan("auth_attempts", "created_at", ATTEMPT_RETENTION_MS),
    events: await deleteOlderThan("events", "at", EVENT_RETENTION_MS),
  };
}
