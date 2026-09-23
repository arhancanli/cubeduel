import assert from "node:assert/strict";
import { test } from "node:test";

import type { PhaseSplit, TimedMove } from "./cfop";
import { reviewMoves, type ReviewInput } from "./moveReview";

/** Moves at a steady 200ms apart, starting at `from`. */
function steady(alg: string, from = 0, gap = 200): TimedMove[] {
  return alg
    .split(" ")
    .filter(Boolean)
    .map((move, i) => ({ move, atMs: from + i * gap }));
}

function split(phase: string, moves: TimedMove[], startMs: number): PhaseSplit {
  const endMs = moves[moves.length - 1].atMs;
  return {
    phase,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    moveCount: moves.length,
    tps: moves.length / ((endMs - startMs) / 1000 || 1),
  };
}

/** A plain solve: cross, four pairs, OLL, PLL, every turn 200ms apart. */
function plainSolve(): ReviewInput {
  const cross = steady("D R' F D2 B L", 0);
  const f1 = steady("U R U' R' U R U'", 1200);
  const f2 = steady("U' L' U L U' L' U", 2600);
  const f3 = steady("U R' U R U' R' U", 4000);
  const f4 = steady("U L U' L' U L U'", 5400);
  const oll = steady("R U R' U R U2 R'", 6800);
  // Opens with a U2: the OLL ends on R', and R' R would be a real undo.
  const pll = steady("U2 R U R' U' R' F R2 U' R' U' R U R' F'", 8200);
  const phases: [string, TimedMove[]][] = [
    ["Cross", cross],
    ["F2L 1", f1],
    ["F2L 2", f2],
    ["F2L 3", f3],
    ["F2L 4", f4],
    ["OLL", oll],
    ["PLL", pll],
  ];
  const splits: PhaseSplit[] = [];
  let start = 0;
  for (const [phase, moves] of phases) {
    const s = split(phase, moves, start);
    splits.push(s);
    start = s.endMs;
  }
  const moves = phases.flatMap(([, m]) => m);
  return { moves, splits, durationMs: moves[moves.length - 1].atMs };
}

/**
 * Holds everything from `fromMs` onward back by `ms` — turns and phase edges
 * alike, since in a real solve the phases are read from the same turns.
 */
function delay(input: ReviewInput, fromMs: number, ms: number): ReviewInput {
  const shift = (t: number) => (t >= fromMs ? t + ms : t);
  return {
    ...input,
    moves: input.moves.map((m) => ({ ...m, atMs: shift(m.atMs) })),
    splits: input.splits.map((s) => {
      const startMs = shift(s.startMs);
      const endMs = shift(s.endMs);
      return { ...s, startMs, endMs, durationMs: endMs - startMs };
    }),
    durationMs: shift(input.durationMs),
  };
}

test("a clean, steady solve has nothing to report against it", () => {
  const review = reviewMoves(plainSolve());
  assert.equal(review.moments.filter((m) => m.tone === "cost").length, 0);
  assert.equal(review.recoverableMs, 0);
});

test("the typical gap is the ordinary time between turns", () => {
  assert.equal(reviewMoves(plainSolve()).typicalGapMs, 200);
});

test("a long pause inside a phase is found, and costs only the excess", () => {
  // Hold the 4th F2L-2 turn back by 1.5s.
  const input = delay(plainSolve(), 2600 + 3 * 200, 1500);
  const pause = reviewMoves(input).moments.find((m) => m.kind === "pause");
  assert.ok(pause, "the pause is reported");
  assert.equal(pause.costMs, 1500);
  assert.equal(pause.atMs, 2600 + 2 * 200);
});

test("a pause before a phase's first turn is named as looking for it", () => {
  const input = delay(plainSolve(), 4000, 2000);
  const pause = reviewMoves(input).moments.find((m) => m.kind === "pause");
  assert.ok(pause);
  assert.match(pause.title, /before F2L 3/);
});

test("only the three costliest pauses are kept", () => {
  let input = plainSolve();
  // Five pauses of different lengths, each inside a phase. Applied latest first
  // so each hold-back is measured from the original times.
  for (const [at, ms] of [
    [9000, 1500],
    [7200, 1300],
    [5800, 1100],
    [3200, 1700],
    [1600, 900],
  ] as const) {
    input = delay(input, at, ms);
  }
  const pauses = reviewMoves(input).moments.filter((m) => m.kind === "pause");
  assert.equal(pauses.length, 3);
  assert.deepEqual(
    pauses.map((p) => p.costMs).sort((a, b) => b - a),
    [1700, 1500, 1300],
  );
});

test("a turn immediately undone is reported", () => {
  const input = plainSolve();
  input.moves = [
    ...input.moves.slice(0, 2),
    { move: "U", atMs: 250 },
    { move: "U'", atMs: 300 },
    ...input.moves.slice(2),
  ];
  const undo = reviewMoves(input).moments.find((m) => m.kind === "undo");
  assert.ok(undo);
  assert.match(undo.title, /U then U'/);
});

test("R R is how a keyboard makes R2, so it is not an undo or a detour", () => {
  const input = plainSolve();
  input.moves = [...input.moves.slice(0, 2), { move: "U", atMs: 250 }, { move: "U", atMs: 300 }, ...input.moves.slice(2)];
  const kinds = reviewMoves(input).moments.map((m) => m.kind);
  assert.ok(!kinds.includes("undo"));
  assert.ok(!kinds.includes("long-way"));
});

test("three quarter turns the same way is the long way round", () => {
  const input = plainSolve();
  input.moves = [
    ...input.moves.slice(0, 2),
    { move: "U", atMs: 250 },
    { move: "U", atMs: 300 },
    { move: "U", atMs: 350 },
    ...input.moves.slice(2),
  ];
  const detour = reviewMoves(input).moments.find((m) => m.kind === "long-way");
  assert.ok(detour);
  assert.match(detour.title, /U' is one turn/);
});

test("a rotation between two turns breaks an undo — they are different layers", () => {
  const input = plainSolve();
  input.moves = [
    ...input.moves.slice(0, 2),
    { move: "U", atMs: 250 },
    { move: "y", atMs: 270 },
    { move: "U'", atMs: 300 },
    ...input.moves.slice(2),
  ];
  assert.ok(!reviewMoves(input).moments.some((m) => m.kind === "undo"));
});

test("rotations during F2L are counted once, not reported one by one", () => {
  const input = plainSolve();
  input.moves = input.moves.flatMap((m) =>
    m.atMs === 1400 || m.atMs === 2800 || m.atMs === 4200 ? [{ move: "y", atMs: m.atMs - 50 }, m] : [m],
  );
  const rotations = reviewMoves(input).moments.filter((m) => m.kind === "rotations");
  assert.equal(rotations.length, 1);
  assert.match(rotations[0].title, /3 rotations during F2L/);
});

test("a single rotation in F2L is not worth mentioning", () => {
  const input = plainSolve();
  input.moves = input.moves.flatMap((m) => (m.atMs === 1400 ? [{ move: "y", atMs: 1350 }, m] : [m]));
  assert.ok(!reviewMoves(input).moments.some((m) => m.kind === "rotations"));
});

test("a cross two or more moves longer than the shortest is a cost, with the route", () => {
  const input = { ...plainSolve(), cross: { moves: 4, solution: "D R' F D2", face: "D" } };
  const cross = reviewMoves(input).moments.find((m) => m.kind === "cross-route");
  assert.ok(cross);
  assert.equal(cross.tone, "cost");
  assert.equal(cross.alg, "D R' F D2");
  // Six turns over 1000ms of cross = 166.7ms each; two extra.
  assert.equal(Math.round(cross.costMs), 333);
});

test("a cross within one of the shortest is credited", () => {
  const input = { ...plainSolve(), cross: { moves: 5, solution: "D R' F D2 B", face: "D" } };
  const cross = reviewMoves(input).moments.find((m) => m.kind === "cross-clean");
  assert.ok(cross);
  assert.equal(cross.tone, "good");
  assert.equal(cross.costMs, 0);
});

test("an OLL far longer than the case's algorithm reads as two-look, and links the case", () => {
  const input = plainSolve();
  // Two extra triggers after the algorithm, finished before PLL begins.
  const extra = steady("F R U R' U' F' F R U R' U' F'", 8010, 10);
  input.moves = [...input.moves.filter((m) => m.atMs < 8200), ...extra, ...input.moves.filter((m) => m.atMs >= 8200)];
  input.splits = input.splits.map((s) =>
    s.phase === "OLL" ? { ...s, endMs: 8120, durationMs: 8120 - s.startMs } : s.phase === "PLL" ? { ...s, startMs: 8120 } : s,
  );
  input.oll = { stage: "OLL", label: "OLL 27", name: "Sune", slug: "oll-27", moveCount: 7 };
  const twoLook = reviewMoves(input).moments.find((m) => m.kind === "two-look");
  assert.ok(twoLook);
  assert.equal(twoLook.href, "/learn/oll-27");
  assert.match(twoLook.title, /OLL 27/);
});

test("an OLL close to its algorithm's length is not called two-look", () => {
  const input = { ...plainSolve(), oll: { stage: "OLL" as const, label: "OLL 27", name: "Sune", slug: "oll-27", moveCount: 7 } };
  assert.ok(!reviewMoves(input).moments.some((m) => m.kind === "two-look"));
});

test("no OLL phase after four pairs is an OLL skip, credited", () => {
  const input = plainSolve();
  input.splits = input.splits.filter((s) => s.phase !== "OLL");
  const skip = reviewMoves(input).moments.find((m) => m.kind === "skip");
  assert.ok(skip);
  assert.match(skip.title, /OLL skip/);
});

test("recoverable time never exceeds the solve", () => {
  // Three real pauses, 4.5s of cost, against a solve said to last 1s: the cap
  // has to engage for this to pass.
  let input = plainSolve();
  for (const [at, ms] of [
    [9000, 1500],
    [7200, 1300],
    [3200, 1700],
  ] as const) {
    input = delay(input, at, ms);
  }
  input.durationMs = 1000;
  assert.equal(reviewMoves(input).recoverableMs, 1000);
});

test("moments come back in the order they happened", () => {
  const input = { ...plainSolve(), cross: { moves: 3, solution: "D R' F", face: "D" } };
  input.moves = input.moves.map((m, i) => (i >= 20 ? { ...m, atMs: m.atMs + 2000 } : m));
  const times = reviewMoves(input).moments.map((m) => m.atMs);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("an empty stream reviews to nothing rather than throwing", () => {
  const review = reviewMoves({ moves: [], splits: [], durationMs: 0 });
  assert.equal(review.moments.length, 0);
  assert.equal(review.turns, 0);
});

test("a rotation and its inverse is not a turn undone — rotations are counted elsewhere", () => {
  const input = plainSolve();
  input.moves = [
    ...input.moves.slice(0, 2),
    { move: "y", atMs: 250 },
    { move: "y'", atMs: 300 },
    ...input.moves.slice(2),
  ];
  assert.ok(!reviewMoves(input).moments.some((m) => m.kind === "undo"));
});

test("an undo across a phase boundary is named as two algorithms cancelling", () => {
  const input = plainSolve();
  // OLL ends on R'; start PLL on R instead of the U2.
  input.moves = input.moves.map((m) => (m.atMs === 8200 ? { ...m, move: "R" } : m));
  const seam = reviewMoves(input).moments.find((m) => m.kind === "undo");
  assert.ok(seam);
  assert.match(seam.title, /OLL and PLL cancel/);
  assert.match(seam.detail, /cancelling into/);
});
