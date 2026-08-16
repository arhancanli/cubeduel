import { test } from "node:test";
import assert from "node:assert/strict";

import { SolveRecorder, computeStats, isRotation, type RecordedMove } from "./moveStream";

test("rotations are distinguished from layer turns", () => {
  for (const m of ["x", "y", "z", "x'", "y2", "z'", "y2'"]) {
    assert.equal(isRotation(m), true, `${m} should be a rotation`);
  }
  // Wide turns and slice moves turn layers — they are not rotations.
  for (const m of ["R", "U'", "F2", "M", "M'", "r", "Rw", "d", "2R"]) {
    assert.equal(isRotation(m), false, `${m} should not be a rotation`);
  }
});

test("the clock does not start until the first layer turn", () => {
  const started: number[] = [];
  const r = new SolveRecorder({ onStart: (t) => started.push(t) });
  r.arm();

  // Reorienting to look at the cube is free, exactly like inspection.
  r.handleMove("y", 1000, false);
  r.handleMove("x'", 1200, false);
  assert.equal(r.getPhase(), "armed");
  assert.equal(started.length, 0);
  assert.equal(r.getMoves().length, 0);

  r.handleMove("R", 2000, false);
  assert.equal(r.getPhase(), "running");
  assert.deepEqual(started, [2000]);
  assert.equal(r.getMoves()[0].atMs, 0);
});

test("moves are timed relative to the first turn", () => {
  const r = new SolveRecorder();
  r.arm();
  r.handleMove("R", 5000, false);
  r.handleMove("U", 5300, false);
  r.handleMove("F", 6000, false);

  const moves = r.getMoves();
  assert.deepEqual(
    moves.map((m) => [m.atMs, m.sincePrevMs]),
    [
      [0, 0],
      [300, 300],
      [1000, 700],
    ],
  );
});

test("the solve ends the moment the puzzle reports solved", () => {
  const done: number[] = [];
  const r = new SolveRecorder({ onSolved: (rec) => done.push(rec.durationMs) });
  r.arm();
  r.handleMove("R", 1000, false);
  r.handleMove("U", 2000, false);
  r.handleMove("R'", 3500, true);

  assert.equal(r.getPhase(), "solved");
  assert.deepEqual(done, [2500]);
  assert.equal(r.getRecording().solved, true);
  assert.equal(r.getRecording().durationMs, 2500);
});

test("moves after the solve are ignored", () => {
  const r = new SolveRecorder();
  r.arm();
  r.handleMove("R", 1000, false);
  r.handleMove("R'", 2000, true);
  r.handleMove("U", 3000, false);
  assert.equal(r.getMoves().length, 2);
  assert.equal(r.getRecording().durationMs, 1000);
});

test("an unarmed recorder ignores everything", () => {
  const r = new SolveRecorder();
  r.handleMove("R", 1000, false);
  assert.equal(r.getPhase(), "idle");
  assert.equal(r.getMoves().length, 0);
});

test("arming again clears the previous solve", () => {
  const r = new SolveRecorder();
  r.arm();
  r.handleMove("R", 1000, false);
  r.handleMove("R'", 2000, true);
  r.arm();
  assert.equal(r.getPhase(), "armed");
  assert.equal(r.getMoves().length, 0);
  assert.equal(r.getRecording().durationMs, 0);
});

test("elapsed time tracks the running solve and freezes when solved", () => {
  const r = new SolveRecorder();
  r.arm();
  assert.equal(r.elapsedAt(500), 0, "armed but not started");
  r.handleMove("R", 1000, false);
  assert.equal(r.elapsedAt(3000), 2000);
  r.handleMove("R'", 4000, true);
  assert.equal(r.elapsedAt(9999), 3000, "frozen at the solved time");
});

function m(move: string, atMs: number, sincePrevMs: number, rotation = false): RecordedMove {
  return { move, atMs, sincePrevMs, rotation };
}

test("move count and TPS exclude rotations", () => {
  const moves = [
    m("R", 0, 0),
    m("y", 100, 100, true),
    m("U", 200, 100),
    m("F", 1000, 800),
  ];
  const stats = computeStats(moves, 1000);
  assert.equal(stats.moveCount, 3, "the rotation is not a turn");
  assert.equal(stats.tps, 3, "3 turns in 1.0s");
});

test("the longest pause is found and located", () => {
  const moves = [m("R", 0, 0), m("U", 200, 200), m("F", 1400, 1200), m("D", 1500, 100)];
  const stats = computeStats(moves, 1500);
  assert.equal(stats.longestPauseMs, 1200);
  assert.equal(stats.longestPauseAtIndex, 2, "the move that ended the pause");
});

test("paused fraction counts only gaps past the threshold", () => {
  // One 800ms pause inside a 2000ms solve; the 100ms gaps are execution.
  const moves = [m("R", 0, 0), m("U", 100, 100), m("F", 900, 800), m("D", 1000, 100)];
  const stats = computeStats(moves, 2000, 350);
  assert.equal(stats.pausedFraction, 0.4);
});

test("stats are safe on an empty or zero-length solve", () => {
  const stats = computeStats([], 0);
  assert.equal(stats.moveCount, 0);
  assert.equal(stats.tps, 0);
  assert.equal(stats.pausedFraction, 0);
  assert.equal(stats.longestPauseAtIndex, -1);
});
