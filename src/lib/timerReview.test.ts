import assert from "node:assert/strict";
import { test } from "node:test";

import type { PhaseSplit } from "./cfop";
import type { StoredSolve } from "./solveHistory";
import { crossOptions, MIN_OTHERS, reviewSplits, turnOver } from "./timerReview";

let n = 0;
function solve(cross: number, f2l: number, oll: number, pll: number, extra: Partial<StoredSolve> = {}): StoredSolve {
  n += 1;
  const splits: PhaseSplit[] = [
    { phase: "Cross", durationMs: cross },
    { phase: "F2L", durationMs: f2l },
    { phase: "OLL", durationMs: oll },
    { phase: "PLL", durationMs: pll },
  ] as PhaseSplit[];
  return {
    id: `s${n}`,
    at: n * 1000,
    scramble: "R U",
    durationMs: cross + f2l + oll + pll,
    penalty: null,
    moveCount: 0,
    tps: 0,
    splits,
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "manual",
    ...extra,
  } as StoredSolve;
}

// Five earlier solves with a little spread in every phase.
const usual = () => [
  solve(2000, 9000, 3000, 3000),
  solve(2200, 9400, 3100, 2900),
  solve(1800, 8600, 2900, 3100),
  solve(2100, 9200, 3050, 2950),
  solve(1900, 8800, 2950, 3050),
];

test("a phase well outside your usual spread is called out, the rest are not", () => {
  const history = usual();
  const now = solve(2000, 13000, 3000, 3000);
  const r = reviewSplits(now, [...history, now])!;
  const byPhase = Object.fromEntries(r.phases.map((p) => [p.phase, p.verdict]));
  assert.deepEqual(byPhase, { Cross: "usual", F2L: "slower", OLL: "usual", PLL: "usual" });
  assert.equal(r.costliest, "F2L");
  assert.equal(r.sample, 5);
});

test("a faster phase is credited", () => {
  const history = usual();
  const now = solve(1000, 9000, 3000, 3000);
  const r = reviewSplits(now, [...history, now])!;
  assert.equal(r.phases.find((p) => p.phase === "Cross")!.verdict, "faster");
  assert.equal(r.costliest, null);
});

test("your usual is your average, excluding the solve being reviewed", () => {
  const history = usual();
  const now = solve(9000, 9000, 3000, 3000);
  const r = reviewSplits(now, [...history, now])!;
  assert.equal(r.phases.find((p) => p.phase === "Cross")!.usualMs, 2000);
});

test("below the minimum sample nothing is judged, but the times are still shown", () => {
  const few = usual().slice(0, MIN_OTHERS - 1);
  const now = solve(2000, 13000, 3000, 3000);
  const r = reviewSplits(now, [...few, now])!;
  assert.ok(r.phases.every((p) => p.verdict === "unknown" && p.usualMs === null));
  assert.equal(r.phases.find((p) => p.phase === "F2L")!.ms, 13000);
  assert.equal(r.costliest, null);
});

test("solves without every phase, and DNFs, are not part of your usual", () => {
  const history = [
    ...usual().slice(0, 4),
    solve(90000, 9000, 3000, 3000, { penalty: "DNF" }),
    { ...solve(90000, 9000, 3000, 3000), splits: [] },
  ];
  const now = solve(2000, 9000, 3000, 3000);
  const r = reviewSplits(now, [...history, now])!;
  assert.equal(r.sample, 4);
  assert.ok(r.phases.every((p) => p.verdict === "unknown"));
});

test("a stopwatch time with no splits has no phase review", () => {
  assert.equal(reviewSplits({ ...solve(1, 1, 1, 1), splits: [] }, []), null);
});

test("the cross in every colour, shortest first", async () => {
  // F turns the four edges around the front face: every cross that uses one
  // of them is one turn away; the back cross is untouched.
  const options = await crossOptions("F");
  const moves = Object.fromEntries(options.map((o) => [o.face, o.moves]));
  assert.deepEqual(moves, { U: 1, D: 1, R: 1, L: 1, F: 1, B: 0 });
  assert.equal(options[0].face, "B");
  for (let i = 1; i < options.length; i++) assert.ok(options[i - 1].moves <= options[i].moves);
});

test("each route solves its cross, in exactly the stated number of turns", async () => {
  const scramble = "D2 F' L2 U R' B2 D' F R2 U2 L' B D2 R U' F2";
  const options = await crossOptions(scramble);
  assert.equal(options.length, 6);
  for (const o of options) {
    assert.equal(o.solution.split(" ").filter(Boolean).length, o.moves, o.face);
    const after = await crossOptions(`${scramble} ${o.solution}`);
    assert.equal(after.find((a) => a.face === o.face)!.moves, 0, `${o.face}: ${o.solution}`);
  }
});

test("each cross is named by its colour", async () => {
  const options = await crossOptions("");
  assert.equal(options.find((o) => o.face === "U")!.colour, "white");
  assert.equal(options.find((o) => o.face === "D")!.colour, "yellow");
});

test("a phase a little off your mean, inside your normal spread, is not called out", () => {
  // Cross over the five: mean 2000, standard deviation about 158.
  const history = usual();
  const slower = solve(2150, 9000, 3000, 3000);
  const faster = solve(1850, 9000, 3000, 3000);
  assert.equal(reviewSplits(slower, [...history, slower])!.phases[0].verdict, "usual");
  assert.equal(reviewSplits(faster, [...history, faster])!.phases[0].verdict, "usual");
});

test("a solve split only part of the way is not part of your usual", () => {
  const partial = { ...solve(90000, 9000, 3000, 3000) };
  partial.splits = partial.splits.slice(0, 2);
  const now = solve(2000, 9000, 3000, 3000);
  const r = reviewSplits(now, [...usual().slice(0, 4), partial, now])!;
  assert.equal(r.sample, 4);
});

test("when two phases are slow, the one that cost more is named", () => {
  const history = usual();
  // OLL +2000 over its usual, F2L +4000 over its.
  const now = solve(2000, 13000, 5000, 3000);
  assert.equal(reviewSplits(now, [...history, now])!.costliest, "F2L");
  const other = solve(2000, 10000, 7000, 3000);
  assert.equal(reviewSplits(other, [...history, other])!.costliest, "OLL");
});

test("a route turned over (white down, green still in front) does the same thing", async () => {
  const { loadKPuzzle } = await import("./cubeReplay");
  const kpuzzle = await loadKPuzzle();
  const solved = kpuzzle.defaultPattern();
  const scramble = "D2 F' L2 U R' B2 D' F R2 U2 L' B D2 R U' F2";
  for (const route of ["R U' F2 D L'", "U2 D' R2 L B F'", "F R' U L2 D B2"]) {
    const direct = solved.applyAlg(`${scramble} ${route}`) as unknown as { isIdentical(o: unknown): boolean };
    const flipped = solved.applyAlg(`${scramble} z2 ${turnOver(route)} z2`);
    assert.ok(direct.isIdentical(flipped), `${route} -> ${turnOver(route)}`);
  }
  assert.equal(turnOver("U R' D2 L F B'"), "D L' U2 R F B'");
});

test("a tiny difference is not called out, however steady your other solves were", () => {
  // Five identical solves: no spread at all. A hundredth of a second is still nothing.
  const steady = Array.from({ length: 5 }, () => solve(2000, 9000, 3000, 3000));
  const now = solve(2010, 8990, 3000, 3000);
  const r = reviewSplits(now, [...steady, now])!;
  assert.ok(r.phases.every((p) => p.verdict === "usual"), JSON.stringify(r.phases.map((p) => p.verdict)));
  // But a real difference against a steady usual still is.
  const slow = solve(2600, 9000, 3000, 3000);
  assert.equal(reviewSplits(slow, [...steady, slow])!.phases[0].verdict, "slower");
});
