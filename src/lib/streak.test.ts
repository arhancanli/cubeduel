import assert from "node:assert/strict";
import { test } from "node:test";

import { localDayKey, solvingStreak } from "./streak";

/** Noon local time on a given day, so no test sits on a midnight boundary. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = new Date(2026, 8, 23, 18); // 23 Sep 2026, 6pm local

test("no solves is no streak", () => {
  const s = solvingStreak([], NOW);
  assert.equal(s.current, 0);
  assert.equal(s.best, 0);
  assert.equal(s.today, false);
});

test("solving today and the two days before is three", () => {
  const s = solvingStreak([at(2026, 9, 21), at(2026, 9, 22), at(2026, 9, 23)], NOW);
  assert.equal(s.current, 3);
  assert.equal(s.today, true);
});

test("today not played yet does not break it — the day is still young", () => {
  const s = solvingStreak([at(2026, 9, 21), at(2026, 9, 22)], NOW);
  assert.equal(s.current, 2);
  assert.equal(s.today, false);
});

test("a whole missed day breaks it", () => {
  const s = solvingStreak([at(2026, 9, 20), at(2026, 9, 21)], NOW);
  assert.equal(s.current, 0);
  assert.equal(s.best, 2);
});

test("many solves on one day count as one day", () => {
  const s = solvingStreak([at(2026, 9, 23, 9), at(2026, 9, 23, 10), at(2026, 9, 23, 11)], NOW);
  assert.equal(s.current, 1);
});

test("the best streak survives a break", () => {
  const days = [1, 2, 3, 4, 5, 8, 9].map((d) => at(2026, 9, d));
  const s = solvingStreak([...days, at(2026, 9, 23)], NOW);
  assert.equal(s.best, 5);
  assert.equal(s.current, 1);
});

test("days are the player's own, not UTC", () => {
  // 23:30 and 00:30 local are two different days wherever the test runs.
  const late = new Date(2026, 8, 22, 23, 30).getTime();
  const early = new Date(2026, 8, 23, 0, 30).getTime();
  assert.notEqual(localDayKey(late), localDayKey(early));
  assert.equal(solvingStreak([late, early], NOW).current, 2);
});

test("the last fourteen days are reported oldest first, today last", () => {
  // 11 Sep is 12 days before the 23rd: second slot, and nowhere near the end,
  // so a reversed list cannot pass.
  const s = solvingStreak([at(2026, 9, 23), at(2026, 9, 11)], NOW);
  assert.equal(s.recent.length, 14);
  assert.equal(s.recent[13], true);
  assert.equal(s.recent[1], true);
  assert.equal(s.recent[12], false);
  assert.equal(s.recent.filter(Boolean).length, 2);
});

test("a month boundary does not break it", () => {
  const s = solvingStreak([at(2026, 8, 31), at(2026, 9, 1)], new Date(2026, 8, 1, 20));
  assert.equal(s.current, 2);
});
