"use client";

import { loadHistory } from "./solveHistory";
import type { Penalty } from "./types";

/**
 * Pushing local history up to the account, so solves follow a player between
 * devices.
 *
 * The app is offline-first and always has been: everything works signed out, and
 * `localStorage` stays the source of truth for the local session. Sync is
 * additive on top of that, never the other way round — the server copy is a
 * backup and a public record, not the working set. That ordering is what keeps
 * the promise that you can land on the timer and solve within a second.
 */

const WATERMARK_KEY = "cubeduel.sync.v1";
/**
 * The server accepts 250 per request and replays every solve that carries a
 * move stream, so smaller batches keep each request quick and let a long history
 * land in steps that each survive on their own.
 */
const BATCH = 100;

function watermark(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(WATERMARK_KEY);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function setWatermark(at: number): void {
  try {
    window.localStorage.setItem(WATERMARK_KEY, String(at));
  } catch {
    /* Private mode. Sync just repeats next time, which the server dedupes. */
  }
}

const REWIND_KEY = "cubeduel.sync.rewind.v1";

/**
 * `<timestamp>|<token>`. The token makes every rewind distinct, so a sync can
 * tell "the rewind I started from" from "a new one set to the same moment".
 */
function rewind(): { at: number; raw: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(REWIND_KEY);
  const at = raw === null ? NaN : Number(raw.split("|")[0]);
  return raw !== null && Number.isFinite(at) ? { at, raw } : null;
}

/**
 * Makes the next sync start from `at` again.
 *
 * Sync sends only what is newer than the last solve uploaded, which is exact
 * while history only ever grows at the recent end. An import breaks that: it
 * adds solves from months ago, all older than the watermark, and without this
 * they would never leave the browser. Rewinding re-sends everything since, and
 * the server stores each solve once however many times it arrives.
 *
 * Kept as its own marker rather than by moving the watermark back. A sync can
 * already be running when somebody imports — the first sync of a long history
 * is twenty requests — and it advances the watermark after every batch, so a
 * rewound watermark would be moved straight past the imported solves by the
 * very next batch. The marker is cleared only by a sync that STARTED after it
 * was set and finished.
 */
export function resyncFrom(at: number): void {
  if (typeof window === "undefined") return;
  const pending = rewind();
  const from = pending === null ? at : Math.min(pending.at, at);
  try {
    window.localStorage.setItem(REWIND_KEY, `${from}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  } catch {
    /* Private mode: nothing is synced from here anyway. */
  }
}

/**
 * Clears the rewind this sync started from — unless another was set while it
 * ran, in which case that one still has solves nobody has sent.
 */
function clearRewind(startedFrom: { raw: string } | null): void {
  if (startedFrom === null || rewind()?.raw !== startedFrom.raw) return;
  try {
    window.localStorage.removeItem(REWIND_KEY);
  } catch {
    /* Nothing to clear in private mode. */
  }
}

export interface SyncOutcome {
  stored: number;
  skipped: number;
}

/**
 * Uploads everything recorded since the last successful sync.
 *
 * Only newer solves are sent, using the timestamp of the last one uploaded.
 * History is append-only and ordered by time, so this is exact for new solves —
 * with one known consequence: a penalty applied to an *old* solve after it has
 * synced will not be pushed again. That is the right trade for now, because the
 * alternative is re-uploading a year of history on every page load to catch an
 * edit that almost never happens.
 */
export async function syncLocalHistory(): Promise<SyncOutcome | null> {
  if (typeof window === "undefined") return null;

  const rewoundTo = rewind();
  const since = rewoundTo === null ? watermark() : Math.min(watermark(), rewoundTo.at - 1);
  const pending = loadHistory().filter((solve) => solve.at > since);
  if (pending.length === 0) {
    clearRewind(rewoundTo);
    return { stored: 0, skipped: 0 };
  }

  let stored = 0;
  let skipped = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);

    let response: Response;
    try {
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          solves: batch.map((solve) => ({
            id: solve.id,
            at: solve.at,
            scramble: solve.scramble,
            durationMs: solve.durationMs,
            penalty: solve.penalty,
            moveCount: solve.moveCount,
            tps: solve.tps,
            splits: solve.splits,
            ollCase: solve.ollCase,
            pllCase: solve.pllCase,
            source: solve.source,
            // Without it the server takes a solve to be a 3x3 — right for
            // everything recorded before other puzzles, wrong for a 5x5.
            event: solve.event,
            moves: solve.moves,
          })),
        }),
      });
    } catch {
      // Offline, or the request was cut short. Stop here and keep the watermark
      // where it is so the next attempt resumes from the same place.
      return stored > 0 ? { stored, skipped } : null;
    }

    if (!response.ok) return stored > 0 ? { stored, skipped } : null;

    const result = (await response.json().catch(() => null)) as SyncOutcome | null;
    stored += result?.stored ?? 0;
    skipped += result?.skipped ?? 0;

    // Advanced per batch rather than at the end, so a failure halfway through a
    // year of history does not re-send the half that already landed.
    setWatermark(batch[batch.length - 1].at);
  }

  clearRewind(rewoundTo);
  return { stored, skipped };
}

export interface DailySubmission {
  dayKey: string;
  durationMs: number;
  penalty: Penalty;
  moves?: { move: string; atMs: number }[];
}

/**
 * Posts a daily result so it appears on the shared board.
 *
 * Failure is deliberately quiet at the call site: the local round has already
 * been recorded and the player has already seen their time. A network problem
 * should not turn a completed daily into an error message about something they
 * cannot act on.
 */
export async function submitDailyResult(
  submission: DailySubmission,
): Promise<{ recorded: boolean; verified: boolean } | null> {
  try {
    const response = await fetch("/api/daily", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!response.ok) return null;
    return (await response.json()) as { recorded: boolean; verified: boolean };
  } catch {
    return null;
  }
}
