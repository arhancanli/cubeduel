"use client";

import { track } from "./analytics";
import type { EventId } from "./events";
import { forEvent } from "./timerEvents";
import { HISTORY_KEY } from "./firstVisit";
import type { PhaseSplit } from "./cfop";
import { mergeImported, type Merge } from "./cstimerImport";
import type { Penalty } from "./types";

/**
 * Persistent record of solves, with their phase splits.
 *
 * A single solve's breakdown is interesting; the aggregate is what actually drives
 * practice. "OLL was slow that time" is noise — "OLL is 31% of your solve across
 * your last 60" is a training plan. Nothing above this layer can say anything
 * useful until the splits are being kept.
 */



/**
 * Capped so a heavy user cannot fill their storage quota and start losing solves
 * silently. Roughly a year of daily practice, and every statistic here uses a
 * recent window well inside it.
 */
const MAX_SOLVES = 2000;

export interface StoredSolve {
  id: string;
  at: number;
  scramble: string;
  durationMs: number;
  penalty: Penalty;
  moveCount: number;
  tps: number;
  /** Empty when the solve could not be split — an unfinished or non-CFOP solve. */
  splits: PhaseSplit[];
  /**
   * Which last-layer case the solver faced. Null when the stage was never reached.
   * This is what turns "OLL is slow" into "these OLL cases are slow".
   */
  ollCase: string | null;
  pllCase: string | null;
  /** Algorithms that redraw those cases, so the coach can show them. */
  ollSetup: string | null;
  pllSetup: string | null;
  /**
   * `manual` is a stopwatch time: the player turned a real cube and pressed a
   * key. It has a time and nothing else, and it used to be recorded as
   * `keyboard` — which told the server, and the solve's public page, that it had
   * been solved on the keyboard when it had not.
   */
  source: "keyboard" | "smartcube" | "manual";
  /**
   * Which puzzle. Absent on everything recorded before the timer timed more
   * than a 3x3 — which is exactly what those solves were.
   */
  event?: EventId;
  /**
   * Every turn and when it happened, as `encodeMoveStream` writes it. Absent on a
   * stopwatch solve, on solves recorded before streams were kept, and on the
   * oldest solves once storage runs short — see `save`.
   */
  moves?: string;
  /**
   * Where a solve came from when it was not recorded here. Only csTimer so far
   * (see `cstimerImport.ts`); absent on everything recorded on this site.
   */
  origin?: "cstimer";
}

interface HistoryStore {
  version: 1;
  solves: StoredSolve[];
}

function emptyStore(): HistoryStore {
  return { version: 1, solves: [] };
}

/**
 * A record is only usable if every field the analysis touches is the right shape.
 *
 * One malformed entry used to take the whole page down permanently: the crash
 * happened during render, the reload re-read the same bad record and crashed again,
 * and the "clear history" control never got far enough to be clickable. Dropping bad
 * records keeps every good one — losing one solve silently beats losing the page.
 */
function isUsable(value: unknown): value is StoredSolve {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<StoredSolve>;
  return (
    typeof s.id === "string" &&
    typeof s.at === "number" &&
    typeof s.durationMs === "number" &&
    Number.isFinite(s.durationMs) &&
    (s.penalty === "OK" || s.penalty === "PLUS2" || s.penalty === "DNF") &&
    typeof s.moveCount === "number" &&
    (s.moves === undefined || typeof s.moves === "string") &&
    Array.isArray(s.splits) &&
    s.splits.every(
      (split) =>
        typeof split?.phase === "string" &&
        typeof split?.durationMs === "number" &&
        Number.isFinite(split.durationMs),
    )
  );
}

/**
 * Every solve on this device, or — given an event — that puzzle's only. Anything
 * that reads times as a 3x3 (bests, phase analysis, the case coach) must ask for
 * "333": a 5x5 time among them would be the slowest 3x3 anybody ever did.
 */
export function loadHistory(event?: EventId): StoredSolve[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryStore;
    if (parsed?.version !== 1 || !Array.isArray(parsed.solves)) return [];
    const usable = parsed.solves.filter(isUsable);
    return event ? forEvent(usable, event) : usable;
  } catch {
    return [];
  }
}

/**
 * True when the history was written, false when storage refused it.
 *
 * `shed` decides what may give way when storage is full. For a solve just
 * recorded it is the oldest solves' move streams: a stream is the one part of a
 * solve that can go without losing the solve, and before streams were kept,
 * this is where history silently stopped growing. For an import it is nothing
 * — an import must never cost what is already here, so it takes fewer solves
 * instead (see `importSolves`).
 */
function save(store: HistoryStore, shed = true): boolean {
  if (typeof window === "undefined") return false;
  let solves = store.solves;
  for (;;) {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...store, solves }));
      return true;
    } catch {
      // Out of quota, most likely. The oldest quarter of the solves that still
      // carry a stream lose it, and the save is tried again. Private mode fails
      // every attempt and ends here once nothing is left to shed.
      const next = shed ? shedOldestStreams(solves) : null;
      if (next === null) return false;
      solves = next;
    }
  }
}

/**
 * The same solves with the oldest quarter of the remaining move streams removed,
 * or null once there are none left to remove. A quarter rather than all of them
 * at once, so a history that is only just over the quota keeps most replays.
 */
export function shedOldestStreams(solves: readonly StoredSolve[]): StoredSolve[] | null {
  const carrying = solves.filter((s) => s.moves !== undefined).length;
  if (carrying === 0) return null;
  let toShed = Math.ceil(carrying / 4);
  return solves.map((solve) => {
    if (toShed === 0 || solve.moves === undefined) return solve;
    toShed--;
    const shed = { ...solve };
    delete shed.moves;
    return shed;
  });
}

/**
 * Appends a solve and returns the updated list, oldest trimmed first.
 *
 * Every route that produces a solve calls this — the timer, the daily and /play.
 * They were separate stores once, and because only /play wrote here, doing forty
 * solves on the front door left the analysis page saying "no solves recorded yet".
 * Callers may pass their own `id` so a solve they also hold in session state can be
 * amended here later when a penalty is applied.
 */
export function recordSolve(
  solve: Omit<StoredSolve, "id" | "at"> & { id?: string },
): StoredSolve[] {
  const existing = loadHistory();
  const entry: StoredSolve = {
    ...solve,
    id: solve.id ?? `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
  };
  const solves = [...existing, entry].slice(-MAX_SOLVES);
  save({ version: 1, solves });

  // Measured here rather than at the three screens that call this, for the same
  // reason this function exists at all: every route that produces a solve comes
  // through it, so no screen can forget. "Did somebody who landed here actually
  // solve a cube" is the activation question, and it was unanswerable until now.
  track("solve");

  return solves;
}

/**
 * Brings imported solves into history — see `cstimerImport.ts` for what they
 * are and the rules they are merged by.
 *
 * Storage can hold fewer than 2,000 solves' worth when the ones already here
 * carry replays. When it is full, this takes fewer imported solves — the newest
 * — rather than strip anything already here to make room, and `storageFull`
 * says so. `saved` is false only when storage refused every attempt (private
 * browsing, most often), so the screen can say the import did not happen
 * instead of reporting solves that are not there.
 */
export function importSolves(
  imported: readonly StoredSolve[],
): Merge & { saved: boolean; storageFull: boolean } {
  const existing = loadHistory();
  const wanted = mergeImported(existing, imported, MAX_SOLVES);
  if (wanted.added === 0) return { ...wanted, saved: true, storageFull: false };

  for (let limit = wanted.added; limit > 0; limit = Math.floor(limit / 2)) {
    const merged = mergeImported(existing, imported, MAX_SOLVES, limit);
    if (save({ version: 1, solves: merged.solves }, false)) {
      return { ...merged, saved: true, storageFull: limit < wanted.added };
    }
  }
  return { ...wanted, added: 0, saved: false, storageFull: false };
}

/** Applies a penalty decided after the solve was recorded. */
export function updateSolvePenalty(id: string, penalty: Penalty): void {
  const solves = loadHistory();
  const index = solves.findIndex((s) => s.id === id);
  if (index === -1) return;
  solves[index] = { ...solves[index], penalty };
  save({ version: 1, solves });
}

/** Removes a solve the user deleted, so history matches what they see. */
export function removeSolve(id: string): void {
  const solves = loadHistory().filter((s) => s.id !== id);
  save({ version: 1, solves });
}

export function clearHistory(): void {
  save(emptyStore());
}
