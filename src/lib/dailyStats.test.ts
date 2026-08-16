import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDailyStats, wasAttempted } from "./dailyStats";
import type { DailyEntry } from "./dailyStorage";

const done = (ms: number, verified = false): DailyEntry => ({
  status: "done",
  ms,
  penalty: "OK",
  at: 0,
  verified,
});

const dnf = (): DailyEntry => ({ status: "done", ms: 0, penalty: "DNF", at: 0, verified: false });

const entries = (map: Record<string, DailyEntry>) => map;

test("an unplayed today does not break the streak", () => {
  // Opening the page in the morning must not report the streak as lost.
  const stats = computeDailyStats(
    entries({ "2026-08-09": done(20000), "2026-08-10": done(19000), "2026-08-11": done(18000) }),
    "2026-08-12",
  );
  assert.equal(stats.currentStreak, 3);
});

test("the streak breaks only after a whole day is missed", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-09": done(20000), "2026-08-10": done(19000) }),
    "2026-08-12",
  );
  assert.equal(stats.currentStreak, 0, "the 11th was missed entirely");
});

test("today counts the moment it is played", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-11": done(18000), "2026-08-12": done(17000) }),
    "2026-08-12",
  );
  assert.equal(stats.currentStreak, 2);
});

test("a DNF still counts as a day played — you turned up", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-10": done(20000), "2026-08-11": dnf(), "2026-08-12": done(19000) }),
    "2026-08-12",
  );
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.played, 3);
  assert.equal(stats.bestMs, 19000, "a DNF has no time and cannot be a personal best");
});

test("the best streak survives a later break", () => {
  const stats = computeDailyStats(
    entries({
      "2026-08-01": done(20000),
      "2026-08-02": done(20000),
      "2026-08-03": done(20000),
      "2026-08-04": done(20000),
      // gap
      "2026-08-11": done(20000),
      "2026-08-12": done(20000),
    }),
    "2026-08-12",
  );
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.bestStreak, 4);
});

test("the personal best is the fastest finished daily", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-10": done(22000), "2026-08-11": done(15500), "2026-08-12": done(19000) }),
    "2026-08-12",
  );
  assert.equal(stats.bestMs, 15500);
});

test("the previous result is the last day before today, not today", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-10": done(22000), "2026-08-12": done(19000) }),
    "2026-08-12",
  );
  assert.equal(stats.previous?.dayKey, "2026-08-10");
  assert.equal(stats.previous?.ms, 22000);
});

test("the recent strip includes days that were never attempted", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-12": done(19000) }),
    "2026-08-12",
    5,
  );
  assert.equal(stats.recent.length, 5);
  assert.equal(stats.recent.at(-1)!.dayKey, "2026-08-12", "oldest first, today last");
  assert.equal(stats.recent.filter(wasAttempted).length, 1);
});

test("an empty history is all zeroes rather than a crash", () => {
  const stats = computeDailyStats({}, "2026-08-12");
  assert.equal(stats.played, 0);
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.bestStreak, 0);
  assert.equal(stats.bestMs, null);
  assert.equal(stats.previous, null);
  assert.equal(stats.recent.length, 14);
});

test("an abandoned attempt still in progress is not counted as played", () => {
  const stats = computeDailyStats(
    entries({ "2026-08-12": { status: "started", startedAt: 0 } }),
    "2026-08-12",
  );
  assert.equal(stats.played, 0);
  assert.equal(stats.currentStreak, 0);
});
