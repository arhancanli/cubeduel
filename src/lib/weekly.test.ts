import assert from "node:assert/strict";
import { test } from "node:test";

import { isWeekKey, previousWeek, rankWeekly, weekEnd, weekKey, weekLabel, weekStart, type Competitor } from "./weekly";

const utc = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);

test("weeks are ISO weeks in UTC", () => {
  assert.equal(weekKey(utc(2026, 9, 25)), "2026-W39"); // a Friday
  assert.equal(weekKey(utc(2026, 9, 21, 0)), "2026-W39"); // Monday 00:00 starts it
  assert.equal(weekKey(Date.UTC(2026, 8, 20, 23, 59, 59)), "2026-W38"); // Sunday night is last week
  // A week belongs to the year of its Thursday.
  assert.equal(weekKey(utc(2021, 1, 3)), "2020-W53");
  assert.equal(weekKey(utc(2024, 12, 30)), "2025-W01");
  assert.equal(weekKey(utc(2026, 1, 1)), "2026-W01");
});

test("a week's bounds are Monday to Monday", () => {
  assert.equal(weekStart("2026-W39"), Date.UTC(2026, 8, 21));
  assert.equal(weekEnd("2026-W39"), Date.UTC(2026, 8, 28));
  assert.equal(weekStart("2020-W53"), Date.UTC(2020, 11, 28));
  // Round trip across a whole decade: every Monday names its own week.
  for (let t = Date.UTC(2020, 0, 6); t < Date.UTC(2031, 0, 1); t += 7 * 86_400_000) {
    assert.equal(weekStart(weekKey(t)), t);
  }
});

test("only real weeks are week keys", () => {
  assert.ok(isWeekKey("2026-W39"));
  assert.ok(isWeekKey("2020-W53"));
  assert.ok(isWeekKey("2026-W53")); // 2026 starts on a Thursday, so it has 53
  assert.ok(!isWeekKey("2025-W53")); // 2025 has 52
  assert.ok(!isWeekKey("2026-W00"));
  assert.ok(!isWeekKey("2026-39"));
  assert.ok(!isWeekKey("../2026-W39"));
});

test("the week before, and a readable label", () => {
  assert.equal(previousWeek("2026-W01"), "2025-W52");
  assert.equal(previousWeek("2021-W01"), "2020-W53");
  assert.equal(weekLabel("2026-W39"), "21–27 Sept 2026");
  assert.equal(weekLabel("2026-W40"), "28 Sept–4 Oct 2026");
});

const s = (seconds: number | "DNF") => (seconds === "DNF" ? { ms: 30_000, penalty: "DNF" as const } : { ms: seconds * 1000, penalty: "OK" as const });
const c = (handle: string, times: (number | "DNF")[]): Competitor => ({ handle, displayName: handle, results: times.map(s) });

test("ranked by the WCA average of five; somebody unfinished is not ranked", () => {
  const placed = rankWeekly([
    c("slow", [20, 20, 20, 20, 20]),
    c("fast", [15, 16, 17, 9, 30]), // drop 9 and 30 → 16.00
    c("partway", [5, 5, 5]),
  ]);
  assert.deepEqual(placed.map((p) => [p.handle, p.place, p.averageMs]), [
    ["fast", 1, 16_000],
    ["slow", 2, 20_000],
  ]);
  assert.equal(placed[0].bestMs, 9_000);
});

test("one DNF is dropped; two make a DNF average, placed after every real one", () => {
  const placed = rankWeekly([
    c("twodnf", [8, 8, 8, "DNF", "DNF"]),
    c("onednf", [30, 30, 30, 30, "DNF"]),
  ]);
  assert.deepEqual(placed.map((p) => [p.handle, p.averageMs]), [
    ["onednf", 30_000],
    ["twodnf", null],
  ]);
  assert.equal(placed[1].bestMs, 8_000);
});

test("a tie on average goes to the better single; a tie on both is shared", () => {
  const placed = rankWeekly([
    c("a", [10, 20, 20, 20, 30]),
    c("b", [19, 20, 20, 20, 21]),
    c("c", [10, 20, 20, 20, 25]),
  ]);
  assert.deepEqual(placed.map((p) => [p.handle, p.place]), [
    ["a", 1],
    ["c", 1],
    ["b", 3],
  ]);
});

test("DNF averages are ordered by their best single too", () => {
  const placed = rankWeekly([c("x", [12, "DNF", "DNF", 40, 40]), c("y", [11, "DNF", "DNF", 40, 40])]);
  assert.deepEqual(placed.map((p) => p.handle), ["y", "x"]);
});

test("a +2 counts in the average and the single", () => {
  const plus = c("p", [10, 10, 10, 10, 10]);
  plus.results[0] = { ms: 7_000, penalty: "PLUS2" };
  const [placed] = rankWeekly([plus]);
  assert.equal(placed.bestMs, 9_000);
  assert.equal(placed.averageMs, 10_000);
});
