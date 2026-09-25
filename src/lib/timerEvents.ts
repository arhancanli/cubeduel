import { EVENTS, EVENT_IDS, type EventId } from "./events";
import type { StoredSolve } from "./solveHistory";
import { createSession, type PersistedState } from "./storage";

/**
 * The puzzles the timer times, and what "a phase" means on each.
 *
 * The timer used to be 3x3 only, while Ranked already rated 2x2, 4x4 and 5x5 —
 * so somebody practising a big cube had nowhere on the site to do it.
 */

export const TIMER_EVENTS = EVENT_IDS.map((id) => ({
  id,
  label: EVENTS[id].name.replace("x", "×"),
  puzzle: EVENTS[id].puzzle,
}));

const SPLITS: Record<EventId, readonly string[]> = {
  "222": [],
  "333": ["Cross", "F2L", "OLL", "PLL"],
  // Reduction, the way nearly everybody solves a big cube: centres, then edge
  // pairs, then the whole thing as a 3x3 (parity included).
  "444": ["Centres", "Edges", "3x3"],
  "555": ["Centres", "Edges", "3x3"],
};

/** "4×4", as people write it. */
export function eventLabel(event: EventId): string {
  return EVENTS[event].name.replace("x", "×");
}

/** The laps somebody marks with space during a solve; empty where splits make no sense. */
export function splitLabelsFor(event: EventId): readonly string[] {
  return SPLITS[event];
}

/**
 * A stop too fast to be a solve on this puzzle — a thumb on the spacebar, not a
 * 0.12 world record. The floor sits below every world-record single, so no
 * real solve is ever refused. Such a stop used to be saved, and became the
 * personal best that every later solve was measured against.
 */
export function isMisfire(ms: number, event: EventId): boolean {
  return ms < EVENTS[event].minSolveMs;
}

/**
 * Whether a solve timed on a real cube has a review. A 2x2 has no phases worth
 * splitting and no cross to find, so its review would be its time again.
 */
export function hasTimerReview(event: EventId): boolean {
  return event !== "222";
}

/** Every solve recorded before the timer kept an event was a 3x3 solve. */
export function eventOf(solve: Pick<StoredSolve, "event">): EventId {
  return solve.event ?? "333";
}

export function forEvent<T extends Pick<StoredSolve, "event">>(solves: readonly T[], event: EventId): T[] {
  return solves.filter((s) => eventOf(s) === event);
}

/**
 * The timer's state with a session for `event` active — the first one that
 * exists, or a new one. Averages are per session, so a session must never mix
 * puzzles: an ao5 across a 3x3 and a 5x5 is not a number about anything.
 */
export function sessionFor(state: PersistedState, event: EventId): PersistedState {
  const active = state.sessions.find((s) => s.id === state.activeSessionId);
  if (active && (active.event ?? "333") === event) return state;
  const existing = state.sessions.find((s) => (s.event ?? "333") === event);
  if (existing) return { ...state, activeSessionId: existing.id };
  const made = { ...createSession(EVENTS[event].name.replace("x", "×"), event), id: `sess_${event}_${Date.now().toString(36)}` };
  return { ...state, sessions: [...state.sessions, made], activeSessionId: made.id };
}

