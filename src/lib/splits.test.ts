import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeSolve } from "./cfop";
import { sanitizeSplits } from "./splits";

const lap = (phase: string, startMs: number, endMs: number) => ({
  phase,
  startMs,
  endMs,
  durationMs: endMs - startMs,
  moveCount: 0,
  tps: 0,
});

test("the stopwatch's hand-marked laps survive — they call the whole stage F2L", () => {
  const laps = [lap("Cross", 0, 1800), lap("F2L", 1800, 9000), lap("OLL", 9000, 11000), lap("PLL", 11000, 13000)];
  assert.deepEqual(sanitizeSplits(laps), laps);
});

test("splits the analysis writes survive unchanged, recognition included", async () => {
  const solution =
    "D2 R' D' U R U' R' U R' U' R U L U' L' U L' U' L R U R' U R U2 R' " +
    "R U R' U' R' F R2 U' R' U' R U R' F'";
  const inverse = solution
    .split(" ")
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
    .join(" ");
  const moves = solution.split(" ").map((move, i) => ({ move, atMs: i * 150 + (i > 2 ? 400 : 0) }));
  const { splits } = await analyzeSolve(inverse, moves);
  assert.equal(splits.length, 7);
  assert.ok(splits.some((s) => (s.recognitionMs ?? 0) > 0), "the fixture exercises recognition");
  assert.deepEqual(sanitizeSplits(JSON.parse(JSON.stringify(splits))), splits);
});

test("anything a client could put in the column instead is refused whole", () => {
  const good = [lap("Cross", 0, 1000), lap("PLL", 1000, 3000)];
  const cases: [string, unknown][] = [
    ["not a list", { phase: "Cross" }],
    ["an invented phase", [lap("Cross", 0, 1000), lap("Blindfolded", 1000, 2000)]],
    ["a negative duration", [{ ...lap("Cross", 0, 1000), durationMs: -5 }]],
    ["a string where a number goes", [{ ...lap("Cross", 0, 1000), tps: "fast" }]],
    ["infinity", [{ ...lap("Cross", 0, 1000), endMs: Infinity }]],
    ["a null entry", [null, ...good]],
    ["far too many phases", Array.from({ length: 9 }, (_, i) => lap("PLL", i, i + 1))],
  ];
  for (const [label, value] of cases) {
    assert.deepEqual(sanitizeSplits(value), [], label);
  }
});

test("extra fields are dropped, so the column holds only what a split is", () => {
  const [kept] = sanitizeSplits([{ ...lap("Cross", 0, 1000), note: "<img src=x>", recognitionMs: 200 }]);
  assert.deepEqual(Object.keys(kept).sort(), [
    "durationMs",
    "endMs",
    "moveCount",
    "phase",
    "recognitionMs",
    "startMs",
    "tps",
  ]);
});

test("a recognition longer than its own phase is not kept", () => {
  const [kept] = sanitizeSplits([{ ...lap("OLL", 0, 1000), recognitionMs: 5000 }]);
  assert.equal(kept.recognitionMs, undefined);
});
