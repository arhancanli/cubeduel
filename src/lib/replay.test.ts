import assert from "node:assert/strict";
import { test } from "node:test";

import type { PhaseSplit, TimedMove } from "./cfop";
import { movesPlayedBy, phaseAt, replayLengthMs } from "./replay";

const moves: TimedMove[] = [
  { move: "R", atMs: 0 },
  { move: "U", atMs: 250 },
  { move: "R'", atMs: 500 },
];

const splits: PhaseSplit[] = [
  { phase: "Cross", startMs: 0, endMs: 300, durationMs: 300, moveCount: 2, tps: 6.6 },
  { phase: "F2L", startMs: 300, endMs: 600, durationMs: 300, moveCount: 1, tps: 3.3 },
];

test("at the very start, nothing has been turned", () => {
  // The bug this pins: the first move is stamped at 0, so an inclusive
  // comparison turned it before the viewer had seen the scramble.
  assert.equal(movesPlayedBy(moves, 0), 0);
});

test("a move counts only once the clock is past it", () => {
  assert.equal(movesPlayedBy(moves, 250), 1);
  assert.equal(movesPlayedBy(moves, 251), 2);
});

test("past the end, every move has been played", () => {
  assert.equal(movesPlayedBy(moves, 10_000), moves.length);
});

test("an empty stream plays nothing at any moment", () => {
  assert.equal(movesPlayedBy([], 0), 0);
  assert.equal(movesPlayedBy([], 99_999), 0);
});

test("the replay is long enough to reach the final move", () => {
  // A solve whose last turn lands exactly on the buzzer.
  const flush: TimedMove[] = [{ move: "R", atMs: 5000 }];
  const length = replayLengthMs(flush, 5000);
  assert.ok(length > 5000, `length ${length} cannot reach a move at 5000`);
  assert.equal(movesPlayedBy(flush, length), 1);
});

test("the replay is never shorter than the recorded time", () => {
  // The timer stops when the solver stops it, not when the cube is solved.
  assert.equal(replayLengthMs(moves, 9000), 9000);
});

test("a solve with no moves still has a clock", () => {
  assert.ok(replayLengthMs([], 0) >= 1);
});

test("the playhead knows which phase it is in", () => {
  assert.equal(phaseAt(splits, 0)?.phase, "Cross");
  assert.equal(phaseAt(splits, 299)?.phase, "Cross");
  assert.equal(phaseAt(splits, 300)?.phase, "F2L");
});

test("past the last split, the last phase still owns the playhead", () => {
  // Otherwise every solve ends with a dash where a phase name should be.
  assert.equal(phaseAt(splits, 5000)?.phase, "F2L");
});

test("a solve with no splits has no phase rather than a wrong one", () => {
  assert.equal(phaseAt([], 100), undefined);
});
