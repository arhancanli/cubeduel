import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionChart } from "./sessionChart";

const solve = (ms: number | null, i: number) =>
  ({ id: String(i), ms: ms ?? 0, penalty: ms === null ? "DNF" : "OK", scramble: "", event: "333", at: i }) as never;

test("each solve is a point, oldest on the left, fastest at the bottom", () => {
  const c = sessionChart([12_000, 10_000, 14_000].map(solve), 200, 100)!;
  assert.equal(c.points.length, 3);
  assert.deepEqual(c.points.map((p) => p.x), [0, 100, 200]);
  const y = Object.fromEntries(c.points.map((p) => [p.ms, p.y]));
  assert.ok(y[10_000] > y[12_000] && y[12_000] > y[14_000], "slower is higher up");
  assert.equal(c.best?.ms, 10_000);
});

test("a DNF is marked, not plotted as a time", () => {
  const c = sessionChart([12_000, null, 11_000].map(solve), 200, 100)!;
  assert.equal(c.points.length, 2);
  assert.deepEqual(c.dnfs, [100]);
});

test("the ao5 line starts at the fifth solve", () => {
  const c = sessionChart([10, 11, 12, 13, 14, 15].map((s) => s * 1000).map(solve), 500, 100)!;
  assert.equal(c.ao5.length, 2);
  assert.equal(c.ao5[0].x, 400);
});

test("only the most recent 100 solves are drawn", () => {
  const c = sessionChart(Array.from({ length: 150 }, (_, i) => solve(10_000 + i, i)), 990, 100)!;
  assert.equal(c.points.length, 100);
  assert.equal(c.points[0].ms, 10_050);
});

test("fewer than two solves draw nothing", () => {
  assert.equal(sessionChart([solve(10_000, 0)], 200, 100), null);
});
