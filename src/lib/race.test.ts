import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RACE_SOLVE_WINDOW_MS,
  isRaceCode,
  phaseOf,
  raceCode,
  readyToStart,
  resolveRace,
  sanitizeProgress,
  scrambleVisible,
  type RaceState,
} from "./race";

const T = 1_700_000_000_000;

function state(overrides: Partial<RaceState> = {}): RaceState {
  return {
    status: "lobby",
    guestPresent: false,
    hostReady: false,
    guestReady: false,
    startAt: null,
    expiresAt: T + 60_000,
    host: { durationMs: null, penalty: null },
    guest: { durationMs: null, penalty: null },
    ...overrides,
  };
}

const started = (overrides: Partial<RaceState> = {}) =>
  state({ status: "started", guestPresent: true, hostReady: true, guestReady: true, startAt: T + 5000, ...overrides });

test("a race goes lobby → countdown → racing on the server's clock", () => {
  assert.equal(phaseOf(state(), T), "lobby");
  assert.equal(phaseOf(started(), T), "countdown");
  assert.equal(phaseOf(started(), T + 4999), "countdown");
  assert.equal(phaseOf(started(), T + 5000), "racing");
});

test("an unstarted race lapses; a started one does not lapse with it", () => {
  assert.equal(phaseOf(state(), T + 60_001), "abandoned");
  assert.equal(phaseOf(state(), T + 60_000), "lobby", "reaching the limit is free");
  assert.equal(phaseOf(started({ expiresAt: T }), T + 999_999), "racing");
});

test("the countdown starts only with both seats filled and both ready", () => {
  assert.equal(readyToStart(state({ hostReady: true })), false);
  assert.equal(readyToStart(state({ guestPresent: true, hostReady: true })), false);
  assert.equal(readyToStart(state({ guestPresent: true, hostReady: true, guestReady: true })), true);
  assert.equal(readyToStart(started()), false, "and only once");
});

test("the scramble is never sent during the countdown", () => {
  assert.equal(scrambleVisible(state(), T), false);
  assert.equal(scrambleVisible(started(), T + 4999), false);
  assert.equal(scrambleVisible(started(), T + 5000), true);
});

test("both finished: the faster valid solve wins, a DNF loses, two DNFs draw", () => {
  const both = (host: RaceState["host"], guest: RaceState["guest"]) =>
    resolveRace(started({ host, guest }), T + 20_000);
  const a = both({ durationMs: 12000, penalty: "OK" }, { durationMs: 11000, penalty: "OK" });
  assert.ok(a.settled && a.status === "finished" && a.winner === "guest");
  const b = both({ durationMs: 12000, penalty: "OK" }, { durationMs: 11000, penalty: "PLUS2" });
  assert.ok(b.settled && b.status === "finished" && b.winner === "host", "+2 counts");
  const c = both({ durationMs: 30000, penalty: "OK" }, { durationMs: 9000, penalty: "DNF" });
  assert.ok(c.settled && c.status === "finished" && c.winner === "host");
  const d = both({ durationMs: 0, penalty: "DNF" }, { durationMs: 0, penalty: "DNF" });
  assert.ok(d.settled && d.status === "finished" && d.winner === "draw");
});

test("one player still solving keeps the race open, until the window closes", () => {
  const halfway = started({ host: { durationMs: 12000, penalty: "OK" } });
  assert.deepEqual(resolveRace(halfway, T + 5000 + RACE_SOLVE_WINDOW_MS), { settled: false });
  const lapsed = resolveRace(halfway, T + 5000 + RACE_SOLVE_WINDOW_MS + 1);
  assert.ok(lapsed.settled && lapsed.status === "finished");
  if (lapsed.settled && lapsed.status === "finished") {
    assert.equal(lapsed.winner, "host", "walking away is a DNF, not a way to deny the result");
    assert.equal(lapsed.guest.penalty, "DNF");
  }
});

test("a lobby nobody started is abandoned, not finished", () => {
  const r = resolveRace(state(), T + 60_001);
  assert.ok(r.settled && r.status === "abandoned");
});

test("progress is bounded, not believed", () => {
  assert.deepEqual(sanitizeProgress({ stage: 3, turns: 22 }), { stage: 3, turns: 22 });
  for (const bad of [null, "3", { stage: 8, turns: 1 }, { stage: -1, turns: 1 }, { stage: 2.5, turns: 1 }, { stage: 1, turns: 5000 }]) {
    assert.equal(sanitizeProgress(bad), null, JSON.stringify(bad));
  }
});

test("race codes avoid characters that cannot be read aloud", () => {
  for (let i = 0; i < 200; i++) {
    const code = raceCode();
    assert.ok(isRaceCode(code), code);
    assert.ok(!/[ilo01]/.test(code), code);
  }
  assert.equal(isRaceCode("abc"), false);
  assert.equal(isRaceCode("ABCDEFGH"), false);
});
