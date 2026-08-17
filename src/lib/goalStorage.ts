"use client";

import { MAX_GOAL_MS, MIN_GOAL_MS, type Goal } from "./coach";

/**
 * Where a goal lives.
 *
 * Local, like everything else a signed-out player owns. A goal is a private
 * commitment rather than a public claim, and nothing about it needs a server —
 * it syncs the day the rest of history does, or it does not, and either way the
 * feature works on the first visit with no account.
 */

const GOAL_KEY = "cubeduel.goal.v1";

function isUsable(value: unknown): value is Goal {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Partial<Goal>;
  return (
    typeof g.targetMs === "number" &&
    Number.isFinite(g.targetMs) &&
    g.targetMs >= MIN_GOAL_MS &&
    g.targetMs <= MAX_GOAL_MS &&
    typeof g.baselineMs === "number" &&
    Number.isFinite(g.baselineMs) &&
    typeof g.setAt === "number"
  );
}

export function loadGoal(): Goal | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GOAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // A malformed goal is dropped rather than allowed to take the page down —
    // the same rule history follows, for the same reason.
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGoal(goal: Goal): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GOAL_KEY, JSON.stringify(goal));
  } catch {
    /* Quota or private mode. The goal simply does not persist. */
  }
}

export function clearGoal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GOAL_KEY);
  } catch {
    /* Nothing more to do. */
  }
}
