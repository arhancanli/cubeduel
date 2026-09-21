import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_STREAM_MOVES,
  SolveRecorder,
  computeStats,
  countMoves,
  decodeMoveStream,
  encodeMoveStream,
  isRotation,
  type RecordedMove,
} from "./moveStream";

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

// ---------------------------------------------------------------------------
// encodeMoveStream / decodeMoveStream
// ---------------------------------------------------------------------------

test("a move stream survives the round trip with its timing intact", () => {
  const moves = [
    { move: "R", atMs: 0 },
    { move: "U", atMs: 120.4 },
    { move: "R'", atMs: 239.6 },
    { move: "y", atMs: 1450 },
    { move: "F2", atMs: 1612 },
    { move: "3Rw'", atMs: 99_999 },
  ];
  const decoded = decodeMoveStream(encodeMoveStream(moves));
  assert.deepEqual(decoded, [
    { move: "R", atMs: 0 },
    { move: "U", atMs: 120 },
    { move: "R'", atMs: 240 },
    { move: "y", atMs: 1450 },
    { move: "F2", atMs: 1612 },
    { move: "3Rw'", atMs: 99_999 },
  ]);
});

test("rounding does not accumulate over a long solve", () => {
  // 500 moves each 100.4ms apart. Rounding every GAP would lose 0.4ms a move and
  // end 200ms early; rounding each absolute time ends where the solve ended.
  const moves = Array.from({ length: 500 }, (_, i) => ({ move: "R", atMs: i * 100.4 }));
  const decoded = decodeMoveStream(encodeMoveStream(moves))!;
  assert.equal(decoded.at(-1)!.atMs, Math.round(499 * 100.4));
});

test("an encoded solve is several times smaller than the same moves as JSON", () => {
  const moves = Array.from({ length: 60 }, (_, i) => ({ move: i % 2 ? "U'" : "R2", atMs: i * 173 }));
  const encoded = encodeMoveStream(moves);
  assert.ok(encoded.length * 4 < JSON.stringify(moves).length, `${encoded.length} vs ${JSON.stringify(moves).length}`);
});

test("a corrupt stream is refused whole, never half-read", () => {
  assert.equal(decodeMoveStream("R.0 U.3c <script>.1"), null);
  assert.equal(decodeMoveStream("R.0 U"), null, "a token with no time");
  assert.equal(decodeMoveStream("R.0 U.-5"), null, "a negative gap");
  assert.equal(decodeMoveStream(".5"), null, "a time with no move");
  assert.equal(decodeMoveStream(Array(MAX_STREAM_MOVES + 1).fill("R.1").join(" ")), null);
  assert.deepEqual(decodeMoveStream(""), []);
});

test("times never run backwards even if the recorder's clock does", () => {
  const decoded = decodeMoveStream(
    encodeMoveStream([
      { move: "R", atMs: 100 },
      { move: "U", atMs: 90 },
    ]),
  )!;
  assert.ok(decoded[1].atMs >= decoded[0].atMs);
});

// ---------------------------------------------------------------------------
// countMoves
// ---------------------------------------------------------------------------

test("a half turn typed as two quarter turns is one move", () => {
  assert.equal(countMoves(["R", "R"]), 1);
  assert.equal(countMoves(["R2"]), 1);
  assert.equal(countMoves(["D", "D", "R'", "D'"]), 3, "the cross D2 R' D' as the keyboard types it");
});

test("turns that cancel are no moves at all", () => {
  assert.equal(countMoves(["R", "R'"]), 0);
  assert.equal(countMoves(["U", "R", "R", "R", "R", "U'"]), 2);
  assert.equal(countMoves(["R", "R", "R"]), 1, "three quarters is R'");
});

test("rotations are not moves, and the same letter either side of one is two layers", () => {
  // After y, "R" is the face that used to be in front. Merging across the
  // rotation would count two different layers as one move.
  assert.equal(countMoves(["R", "y", "R"]), 2);
  assert.equal(countMoves(["R", "y", "R'"]), 2, "and they certainly do not cancel");
  assert.equal(countMoves(["x", "y2", "z'"]), 0);
});

test("different layers never merge, including opposite faces and wide turns", () => {
  assert.equal(countMoves(["R", "L", "R"]), 3);
  assert.equal(countMoves(["R", "Rw", "r"]), 3);
  assert.equal(countMoves(["2R", "2R"]), 1);
});

test("a middle-slice turn counts as the two face turns it is", () => {
  // M is R L' with the cube turned. Every solver here counts face turns, so a
  // cross built with slices must not come out shorter than the shortest.
  assert.equal(countMoves(["M"]), 2);
  assert.equal(countMoves(["M", "M"]), 2, "M2 is still two face turns");
  assert.equal(countMoves(["M", "M'"]), 0);
  assert.equal(countMoves(["E", "S'"]), 4);
  assert.equal(countMoves(["r"]), 1, "a wide turn is one face turn and a rotation");
});
