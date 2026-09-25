import assert from "node:assert/strict";
import { test } from "node:test";

import type { StoredSolve } from "./solveHistory";
import type { PersistedState } from "./storage";
import { parseSyncedEvent } from "./events";
import { eventOf, forEvent, hasTimerReview, isMisfire, sessionFor, splitLabelsFor, TIMER_EVENTS } from "./timerEvents";

test("the timer offers 2x2 to 5x5, each drawn as its own puzzle", () => {
  assert.deepEqual(
    TIMER_EVENTS.map((e) => [e.id, e.puzzle]),
    [["222", "2x2x2"], ["333", "3x3x3"], ["444", "4x4x4"], ["555", "5x5x5"]],
  );
});

test("each puzzle splits into its own phases", () => {
  assert.deepEqual(splitLabelsFor("333"), ["Cross", "F2L", "OLL", "PLL"]);
  // Reduction: build the centres, pair the edges, then solve it as a 3x3.
  assert.deepEqual(splitLabelsFor("444"), ["Centres", "Edges", "3x3"]);
  assert.deepEqual(splitLabelsFor("555"), ["Centres", "Edges", "3x3"]);
  // A 2x2 solve is too short to split by hand.
  assert.deepEqual(splitLabelsFor("222"), []);
});

test("a solve recorded before events were kept is a 3x3 solve", () => {
  assert.equal(eventOf({} as StoredSolve), "333");
  assert.equal(eventOf({ event: "555" } as StoredSolve), "555");
});

test("history is read one puzzle at a time", () => {
  const solves = [{ id: "a" }, { id: "b", event: "444" }, { id: "c", event: "333" }] as StoredSolve[];
  assert.deepEqual(forEvent(solves, "333").map((s) => s.id), ["a", "c"]);
  assert.deepEqual(forEvent(solves, "444").map((s) => s.id), ["b"]);
});

function state(): PersistedState {
  return {
    version: 1,
    activeSessionId: "s1",
    sessions: [
      { id: "s1", name: "Session 1", event: "333", solves: [], createdAt: 1 },
      { id: "s2", name: "4×4", event: "444", solves: [], createdAt: 2 },
    ],
  };
}

test("switching puzzle moves to that puzzle's session", () => {
  const next = sessionFor(state(), "444");
  assert.equal(next.activeSessionId, "s2");
  assert.equal(next.sessions.length, 2);
});

test("a puzzle with no session gets one, and the others are left alone", () => {
  const before = state();
  const next = sessionFor(before, "555");
  const made = next.sessions.find((s) => s.id === next.activeSessionId)!;
  assert.equal(made.event, "555");
  assert.equal(made.name, "5×5");
  assert.equal(next.sessions.length, 3);
  assert.deepEqual(next.sessions.slice(0, 2), before.sessions);
});

test("staying on the same puzzle changes nothing", () => {
  const before = state();
  assert.equal(sessionFor(before, "333"), before);
});

test("a synced solve's puzzle: absent means 3x3, anything unknown is refused", () => {
  assert.equal(parseSyncedEvent(undefined), "333");
  assert.equal(parseSyncedEvent("444"), "444");
  assert.equal(parseSyncedEvent("777"), null);
  assert.equal(parseSyncedEvent(333), null);
});

test("every timed puzzle but the 2x2 has a review", () => {
  assert.deepEqual(TIMER_EVENTS.filter((e) => hasTimerReview(e.id)).map((e) => e.id), ["333", "444", "555"]);
});

test("a stop faster than the puzzle allows is a mis-tap, not a solve", () => {
  // Below every world-record single: a 3x3 cannot be solved in half a second.
  assert.equal(isMisfire(120, "333"), true);
  assert.equal(isMisfire(499, "333"), true);
  assert.equal(isMisfire(500, "333"), false);
  assert.equal(isMisfire(9000, "333"), false);
  // Each puzzle has its own floor: 0.3s is a mis-tap on a 3x3 but a 2x2 can go below it.
  assert.equal(isMisfire(300, "222"), false);
  assert.equal(isMisfire(3000, "444"), true);
});
