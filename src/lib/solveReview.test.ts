import { test } from "node:test";
import assert from "node:assert/strict";

import { reviewSolve } from "./solveReview";
import type { PhaseSplit } from "./cfop";
import type { StoredSolve } from "./solveHistory";

let seq = 0;

function splits(cross: number, f2l: number, oll: number, pll: number): PhaseSplit[] {
  const mk = (phase: string, durationMs: number): PhaseSplit => ({
    phase,
    startMs: 0,
    endMs: durationMs,
    durationMs,
    moveCount: 8,
    tps: 5,
  });
  return [mk("Cross", cross), mk("F2L 1", f2l / 2), mk("F2L 2", f2l / 2), mk("OLL", oll), mk("PLL", pll)];
}

function past(cross: number, f2l: number, oll: number, pll: number): StoredSolve {
  seq += 1;
  const s = splits(cross, f2l, oll, pll);
  return {
    id: `p${seq}`,
    at: seq,
    scramble: "R U R'",
    durationMs: cross + f2l + oll + pll,
    penalty: "OK",
    moveCount: 45,
    tps: 5,
    splits: s,
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "keyboard",
  };
}

const history = Array.from({ length: 6 }, () => past(2000, 9000, 3000, 2000));

test("with no splits there is nothing to review", () => {
  const r = reviewSolve([], 20000, history);
  assert.equal(r.kind, "no-splits");
  assert.equal(r.culprit, null);
});

test("with too little history no par is claimed", () => {
  const r = reviewSolve(splits(2000, 9000, 3000, 2000), 16000, history.slice(0, 3));
  assert.equal(r.kind, "no-par");
  assert.equal(r.parMs, null);
  assert.equal(r.sampleSize, 3);
});

test("the culprit is the phase that lost the most time against par", () => {
  // OLL is 4s over; F2L is only 0.5s over.
  const r = reviewSolve(splits(2000, 9500, 7000, 2000), 20500, history);
  assert.equal(r.kind, "reviewed");
  assert.equal(r.culprit?.phase, "OLL");
  assert.equal(r.culprit?.gapMs, 4000);
  assert.ok(r.culpritShare > 0.85, `share was ${r.culpritShare}`);
});

test("a phase faster than par cannot be the culprit", () => {
  // Everything faster except a small F2L overrun.
  const r = reviewSolve(splits(1500, 9500, 2000, 1500), 14500, history);
  assert.equal(r.culprit?.phase, "F2L");
  assert.ok(r.culprit!.gapMs > 0);
});

test("a solve better than par everywhere names no culprit", () => {
  const r = reviewSolve(splits(1500, 8000, 2500, 1500), 13500, history);
  assert.equal(r.kind, "reviewed");
  assert.equal(r.culprit, null, "nothing was slower than usual");
  assert.ok(r.gapMs! < 0, "and the solve was faster overall");
});

test("par is the solver's own average, and the gap sums across phases", () => {
  const r = reviewSolve(splits(3000, 9000, 3000, 2000), 17000, history);
  assert.equal(r.parMs, 16000, "2 + 9 + 3 + 2");
  assert.equal(r.gapMs, 1000);
  assert.equal(r.gaps.find((g) => g.phase === "Cross")!.parMs, 2000);
});

test("DNFs in history never set par", () => {
  const poisoned = [...history, { ...past(9000, 9000, 9000, 9000), penalty: "DNF" as const }];
  const r = reviewSolve(splits(2000, 9000, 3000, 2000), 16000, poisoned);
  assert.equal(r.parMs, 16000, "the DNF is excluded");
  assert.equal(r.sampleSize, 6);
});
