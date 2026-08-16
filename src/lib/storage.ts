"use client";

import type { Session, Solve } from "./types";

const STORAGE_KEY = "cubeduel.state.v1";

interface PersistedState {
  version: 1;
  sessions: Session[];
  activeSessionId: string;
}

export function createSession(name = "Session 1", event = "333"): Session {
  return {
    id: `sess_${Date.now().toString(36)}`,
    name,
    event,
    solves: [],
    createdAt: Date.now(),
  };
}

function freshState(): PersistedState {
  const session = createSession();
  return { version: 1, sessions: [session], activeSessionId: session.id };
}

/**
 * Storage must never be the reason a solve is lost or the timer white-screens,
 * so every read falls back to a usable empty state and every write is best-effort.
 */
export function loadState(): PersistedState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();

    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
      return freshState();
    }
    // A stale active id would leave the app with no session to render.
    const active = parsed.sessions.some((s) => s.id === parsed.activeSessionId)
      ? parsed.activeSessionId
      : parsed.sessions[0].id;
    return { ...parsed, activeSessionId: active };
  } catch {
    return freshState();
  }
}

export function saveState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Quota or private-mode failure — the in-memory session keeps working. */
  }
}

export function newSolve(ms: number, scramble: string, event: string): Solve {
  return {
    id: `solve_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ms,
    penalty: "OK",
    scramble,
    event,
    at: Date.now(),
  };
}

export type { PersistedState };
