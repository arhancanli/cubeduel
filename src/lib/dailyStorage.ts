"use client";

import type { Penalty } from "./types";

const DAILY_KEY = "cubeduel.daily.v1";

export type DailyEntry =
  | { status: "started"; startedAt: number }
  | {
      status: "done";
      ms: number;
      penalty: Penalty;
      at: number;
      /**
       * True only when the app watched the cube reach a solved state. A hand-timed
       * result is self-reported — an idle tab produces a convincing 4.00 — and a
       * share that does not say so is claiming a check nobody performed.
       */
      verified: boolean;
    };

interface DailyStore {
  version: 1;
  entries: Record<string, DailyEntry>;
}

function emptyStore(): DailyStore {
  return { version: 1, entries: {} };
}

export function loadDailyStore(): DailyStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(DAILY_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as DailyStore;
    if (parsed?.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

function save(store: DailyStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DAILY_KEY, JSON.stringify(store));
  } catch {
    /* Best effort — a storage failure must not block the round. */
  }
}

/**
 * Written the instant the timer starts, before any result exists. If the player
 * reloads or navigates away mid-solve they come back to a started-but-unfinished
 * round, which resolves as a DNF. One attempt has to mean one attempt, or the
 * daily is not a competition — you could otherwise reroll until you liked the time.
 */
export function markStarted(dayKey: string): void {
  const store = loadDailyStore();
  if (store.entries[dayKey]) return;
  store.entries[dayKey] = { status: "started", startedAt: Date.now() };
  save(store);
}

export function recordResult(
  dayKey: string,
  ms: number,
  penalty: Penalty = "OK",
  verified = false,
): void {
  const store = loadDailyStore();
  const existing = store.entries[dayKey];
  if (existing?.status === "done") return;
  store.entries[dayKey] = { status: "done", ms, penalty, at: Date.now(), verified };
  save(store);
}

/** Resolves an abandoned attempt into a recorded DNF. */
export function abandonToDnf(dayKey: string): void {
  const store = loadDailyStore();
  if (store.entries[dayKey]?.status !== "started") return;
  store.entries[dayKey] = { status: "done", ms: 0, penalty: "DNF", at: Date.now(), verified: false };
  save(store);
}

export function getEntry(dayKey: string): DailyEntry | null {
  return loadDailyStore().entries[dayKey] ?? null;
}
