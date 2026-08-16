import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ao5,
  ao12,
  mo3,
  bestSingle,
  bestTrimmedAverage,
  effectiveMs,
  sessionMean,
  trimmedAverage,
} from "./stats";
import { formatAverage, formatMs, formatSolve } from "./format";
import type { Penalty, Solve } from "./types";

let counter = 0;
function solve(seconds: number, penalty: Penalty = "OK"): Solve {
  counter += 1;
  return {
    id: `s${counter}`,
    ms: Math.round(seconds * 1000),
    penalty,
    scramble: "R U R' U'",
    event: "333",
    at: counter,
  };
}

function list(...seconds: number[]): Solve[] {
  return seconds.map((s) => solve(s));
}

test("effectiveMs applies penalties", () => {
  assert.equal(effectiveMs(solve(10)), 10000);
  assert.equal(effectiveMs(solve(10, "PLUS2")), 12000);
  assert.equal(effectiveMs(solve(10, "DNF")), null);
});

test("ao5 trims the single best and single worst", () => {
  // 10 and 18 are trimmed; mean of 12, 14, 16 is 14.00
  const result = ao5(list(10, 12, 14, 16, 18));
  assert.deepEqual(result, { kind: "value", ms: 14000 });
});

test("ao5 survives exactly one DNF by trimming it as the worst", () => {
  const solves = [...list(10, 12, 14, 16), solve(99, "DNF")];
  // DNF is the worst and is trimmed, 10 is the best and is trimmed.
  assert.deepEqual(ao5(solves), { kind: "value", ms: 14000 });
});

test("ao5 is a DNF once two solves are DNF", () => {
  const solves = [...list(10, 12, 14), solve(99, "DNF"), solve(99, "DNF")];
  assert.deepEqual(ao5(solves), { kind: "dnf" });
});

test("ao5 counts a +2 at its penalised time", () => {
  const solves = [solve(10), solve(12, "PLUS2"), solve(14), solve(16), solve(18)];
  // Effective: 10, 14, 14, 16, 18 -> trim 10 and 18 -> mean(14, 14, 16) = 14.666...
  assert.deepEqual(ao5(solves), { kind: "value", ms: 14670 });
});

test("averages round to the nearest centisecond, not millisecond", () => {
  const solves = list(10, 10.001, 10.002, 10.003, 10.004);
  const result = ao5(solves);
  assert.equal(result.kind, "value");
  assert.equal((result as { ms: number }).ms % 10, 0);
});

test("an average uses the most recent solves, not the first", () => {
  // Last five are 20..24; first two are fast and must not be counted.
  const solves = list(1, 2, 20, 21, 22, 23, 24);
  assert.deepEqual(ao5(solves), { kind: "value", ms: 22000 });
});

test("an average is unavailable until enough solves exist", () => {
  assert.deepEqual(ao5(list(10, 12, 14, 16)), { kind: "none" });
  assert.deepEqual(ao12(list(10, 12, 14, 16, 18)), { kind: "none" });
});

test("ao12 trims one best and one worst from twelve", () => {
  const solves = list(1, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100);
  // 1 and 100 are trimmed, leaving ten 10s.
  assert.deepEqual(ao12(solves), { kind: "value", ms: 10000 });
});

test("mo3 is untrimmed and any DNF poisons it", () => {
  assert.deepEqual(mo3(list(10, 11, 12)), { kind: "value", ms: 11000 });
  assert.deepEqual(mo3([...list(10, 11), solve(12, "DNF")]), { kind: "dnf" });
});

test("bestSingle ignores DNFs and respects +2", () => {
  assert.equal(bestSingle([solve(9, "DNF"), ...list(15, 20)]), 15000);
  // The 14 becomes 16 with the penalty, so the clean 15 is the real best.
  assert.equal(bestSingle([solve(14, "PLUS2"), solve(15)]), 15000);
  assert.equal(bestSingle([solve(10, "DNF")]), null);
});

test("bestTrimmedAverage scans every window, not just the last", () => {
  // The fast ao5 sits at the start of the session.
  const solves = list(10, 10, 10, 10, 10, 30, 30, 30, 30, 30);
  assert.deepEqual(bestTrimmedAverage(solves, 5), { kind: "value", ms: 10000 });
  assert.deepEqual(bestTrimmedAverage(list(10, 12), 5), { kind: "none" });
});

test("sessionMean skips DNFs entirely", () => {
  assert.deepEqual(sessionMean([...list(10, 20), solve(99, "DNF")]), {
    kind: "value",
    ms: 15000,
  });
});

test("trimmedAverage handles a window exactly at the size boundary", () => {
  assert.deepEqual(trimmedAverage(list(10, 12, 14), 3), { kind: "value", ms: 12000 });
});

test("single times truncate to hundredths", () => {
  assert.equal(formatMs(12999), "12.99");
  assert.equal(formatMs(9040), "9.04");
  assert.equal(formatMs(0), "0.00");
});

test("times past a minute and an hour format with separators", () => {
  assert.equal(formatMs(61000), "1:01.00");
  assert.equal(formatMs(600000), "10:00.00");
  assert.equal(formatMs(3661000), "1:01:01.00");
});

test("averages format rounded while singles format truncated", () => {
  assert.equal(formatAverage({ kind: "value", ms: 14666 }), "14.67");
  assert.equal(formatAverage({ kind: "dnf" }), "DNF");
  assert.equal(formatAverage({ kind: "none" }), "—");
});

test("a penalised solve is never displayed as a clean one", () => {
  assert.equal(formatSolve(solve(14, "PLUS2")), "16.00+");
  assert.equal(formatSolve(solve(14, "DNF")), "DNF");
  assert.equal(formatSolve(solve(14)), "14.00");
});

test("averages are built from truncated results, as the WCA defines them", () => {
  // Five solves of 10.009. Each is the *result* 10.00 — the spare milliseconds do
  // not exist. Averaging raw milliseconds instead gives 10.01 and puts every one of
  // our averages a hundredth off the figure the same solves produce anywhere else.
  const solves = [
    solve(10.009),
    solve(10.009),
    solve(10.009),
    solve(10.009),
    solve(10.009),
  ];
  assert.deepEqual(ao5(solves), { kind: "value", ms: 10000 });
});

test("truncation applies after a penalty, not before", () => {
  // 12.999 + 2 = 14.999, recorded as the result 14.99.
  const solves = [solve(12.999, "PLUS2"), solve(20), solve(20), solve(20), solve(1)];
  const result = ao5(solves);
  assert.equal(result.kind, "value");
  assert.equal((result as { ms: number }).ms % 10, 0);
  assert.ok(formatSolve(solve(12.999, "PLUS2")).startsWith("14.99"));
});
