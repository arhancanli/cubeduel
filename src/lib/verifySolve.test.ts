import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTEMPT_TTL_MS,
  MAX_MOVES,
  MIN_PLAUSIBLE_DURATION_MS,
  verifySolve,
  type SubmittedMove,
  type VerificationInput,
} from "./verifySolve";

/**
 * The inverse of an algorithm solves whatever it scrambled, which gives every
 * test a known-honest solution without hardcoding one.
 */
function inverse(alg: string): string[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((move) => {
      if (move.endsWith("2")) return move;
      if (move.endsWith("'")) return move.slice(0, -1);
      return `${move}'`;
    });
}

/** Lays moves out at a steady, human turn rate. */
function stream(moves: string[], gapMs = 400): SubmittedMove[] {
  return moves.map((move, i) => ({ move, atMs: i * gapMs }));
}

const SCRAMBLE = "R U R' U' F2 L D B' R2 U";
/** Fixed so tests can reason about the wall clock without re-narrowing it. */
const ISSUED_AT = 1_000_000;

function honest(overrides: Partial<VerificationInput> = {}): VerificationInput {
  const moves = stream(inverse(SCRAMBLE));
  const durationMs = moves[moves.length - 1].atMs;
  const issuedAt = ISSUED_AT;
  return {
    scramble: SCRAMBLE,
    moves,
    durationMs,
    issuedAt,
    receivedAt: issuedAt + durationMs + 1500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The honest path — these must never break
// ---------------------------------------------------------------------------

test("a genuine solve verifies", async () => {
  const result = await verifySolve(honest());
  assert.equal(result.verified, true, JSON.stringify(result));
  if (result.verified) {
    assert.equal(result.moveCount, 10);
    assert.ok(result.tps > 0 && result.tps < 25);
  }
});

test("rotations mid-solve do not break verification", async () => {
  // Cubers rotate constantly. A verifier that rejected honest solves for it
  // would be worse than no verifier at all.
  //
  // A rotation reorients the puzzle, so the moves after it must be expressed in
  // the rotated frame. `y` maps the old R face onto the new F, so the tail of
  // the solution is rewritten accordingly and the cube still ends solved.
  const solution = inverse("R U R'");
  //          original: R U' R'   ->   after a y: F U' F'
  const rotated = ["y", "F", "U'", "F'"];
  const moves = stream(rotated, 600);
  const durationMs = moves[moves.length - 1].atMs;

  const result = await verifySolve({
    scramble: "R U R'",
    moves,
    durationMs,
    issuedAt: 0,
    receivedAt: durationMs + 1000,
  });

  assert.equal(result.verified, true, JSON.stringify({ result, solution }));
  if (result.verified) {
    assert.equal(result.moveCount, 3, "the rotation must not count as a turn");
  }
});

test("a slow but genuine solve verifies", async () => {
  // A beginner taking two minutes is the most common honest case there is.
  const moves = stream(inverse(SCRAMBLE), 12_000);
  const durationMs = moves[moves.length - 1].atMs;
  const result = await verifySolve({
    scramble: SCRAMBLE,
    moves,
    durationMs,
    issuedAt: 0,
    receivedAt: durationMs + 2000,
  });
  assert.equal(result.verified, true, JSON.stringify(result));
});

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

test("moves that do not solve the scramble are rejected", async () => {
  // Sexy-move sextupled: a well-formed, plausibly-timed stream that returns the
  // cube to where it started rather than solving it. The duration is kept
  // consistent with the stream so this reaches the replay rather than being
  // caught earlier by a timing check.
  const moves = stream(["R", "U", "R'", "U'", "R", "U", "R'", "U'"]);
  const result = await verifySolve(
    honest({ moves, durationMs: moves[moves.length - 1].atMs }),
  );
  assert.equal(result.verified, false);
  if (!result.verified) assert.match(result.reason, /do not solve/);
});

test("a solution to a different scramble is rejected", async () => {
  // The attack this closes: solve an easy scramble at leisure, then submit it
  // against whatever the server issued.
  const result = await verifySolve(honest({ scramble: "F R U' B2 D L2 F' U" }));
  assert.equal(result.verified, false);
  if (!result.verified) assert.match(result.reason, /do not solve/);
});

test("a solve one move short of finished is rejected", async () => {
  const full = inverse(SCRAMBLE);
  const result = await verifySolve(honest({ moves: stream(full.slice(0, -1)) }));
  assert.equal(result.verified, false);
});

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

test("a duration that disagrees with the moves is rejected", async () => {
  // Recording an honest solve and then editing the number down is the simplest
  // possible cheat, and the move stream is what catches it.
  const base = honest();
  const result = await verifySolve({ ...base, durationMs: 4200 });
  assert.equal(result.verified, false);
  if (!result.verified) assert.match(result.reason, /final move timestamp/);
});

test("timestamps that run backwards are rejected", async () => {
  const moves = stream(inverse(SCRAMBLE));
  const tampered = moves.map((m, i) => (i === 4 ? { ...m, atMs: 50 } : m));
  const result = await verifySolve(honest({ moves: tampered }));
  assert.equal(result.verified, false);
  if (!result.verified) assert.match(result.reason, /monotonic/);
});

test("a solve longer than the attempt has been open is rejected", async () => {
  // Both ends of this comparison come from the server's clock, so it is the one
  // timing bound the client cannot talk its way around. The gap has to clear the
  // latency slack to be a real disagreement rather than a rounding argument.
  const moves = stream(inverse(SCRAMBLE), 12_000); // a two-minute solve
  const durationMs = moves[moves.length - 1].atMs;
  const result = await verifySolve(
    honest({ moves, durationMs, receivedAt: 1_000_000 + 500 }),
  );
  assert.equal(result.verified, false);
  if (!result.verified) assert.match(result.reason, /longer than the attempt/);
});

test("an expired attempt is rejected even if the solve is real", async () => {
  const base = honest();
  const result = await verifySolve({
    ...base,
    receivedAt: ISSUED_AT + ATTEMPT_TTL_MS + 1,
  });
  assert.equal(result.verified, false);
  if (!result.verified) assert.match(result.reason, /expired/);
});

test("network latency does not reject an honest solve", async () => {
  // The slack exists for this. A solve that finishes right as the attempt
  // window closes must still count.
  const base = honest();
  const result = await verifySolve({
    ...base,
    receivedAt: ISSUED_AT + base.durationMs + 2,
  });
  assert.equal(result.verified, true, JSON.stringify(result));
});

// ---------------------------------------------------------------------------
// Plausibility
// ---------------------------------------------------------------------------

test("a superhuman turn rate is rejected", async () => {
  const moves = stream(inverse(SCRAMBLE), 20); // 10 moves in 180ms
  const result = await verifySolve(
    honest({ moves, durationMs: moves[moves.length - 1].atMs }),
  );
  assert.equal(result.verified, false);
  // Caught by the duration floor or the turn-rate cap; both are correct here.
  if (!result.verified) assert.match(result.reason, /physically possible|beyond human/);
});

test("a solve faster than the duration floor is rejected", async () => {
  const moves = stream(inverse(SCRAMBLE), 30);
  const durationMs = moves[moves.length - 1].atMs;
  assert.ok(durationMs < MIN_PLAUSIBLE_DURATION_MS, "precondition");
  const result = await verifySolve(honest({ moves, durationMs }));
  assert.equal(result.verified, false);
});

test("a world-record turn rate still verifies", async () => {
  // 11 TPS is roughly the fastest any human has ever sustained over a solve. The
  // cap must sit above the best players alive, or it becomes a bug that only
  // ever hurts the people whose results matter most.
  const moves = stream(inverse(SCRAMBLE), Math.round(1000 / 11));
  const durationMs = moves[moves.length - 1].atMs;
  assert.ok(
    durationMs > MIN_PLAUSIBLE_DURATION_MS,
    `precondition: ${durationMs}ms must clear the duration floor`,
  );

  const result = await verifySolve({
    scramble: SCRAMBLE,
    moves,
    durationMs,
    issuedAt: 0,
    receivedAt: durationMs + 1000,
  });

  assert.equal(result.verified, true, JSON.stringify(result));
  if (result.verified) {
    assert.ok(result.tps > 10, `measured ${result.tps} TPS`);
  }
});

// ---------------------------------------------------------------------------
// Malformed input — this sits behind an HTTP handler
// ---------------------------------------------------------------------------

test("garbage never throws, it rejects", async () => {
  const base = honest();
  const cases: VerificationInput[] = [
    { ...base, moves: [] },
    { ...base, moves: stream(["R", "NOPE", "U"]) },
    { ...base, durationMs: -1 },
    { ...base, durationMs: NaN },
    { ...base, moves: [{ move: "R", atMs: NaN }] },
    { ...base, moves: [{ move: "R", atMs: -5 }] },
    { ...base, moves: stream(Array.from({ length: MAX_MOVES + 1 }, () => "R")) },
    { ...base, moves: stream(["x", "y", "z"]) },
    // A hostile string aimed at the algorithm parser.
    { ...base, moves: [{ move: "R'; DROP TABLE solves", atMs: 0 }] },
  ];

  for (const input of cases) {
    const result = await verifySolve(input);
    assert.equal(
      result.verified,
      false,
      `should have rejected: ${JSON.stringify(input.moves).slice(0, 80)}`,
    );
  }
});

test("an unparseable scramble is a rejection, not a crash", async () => {
  const result = await verifySolve(honest({ scramble: "not a scramble at all" }));
  assert.equal(result.verified, false);
});

// ---------------------------------------------------------------------------
// The daily: proven moves, unbounded timing
// ---------------------------------------------------------------------------

test("a daily solve verifies its moves but reports the timing as unbounded", async () => {
  // The daily scramble is published to everyone at midnight, so there is no
  // moment at which it was handed to this player. The moves can still be proven;
  // the clock cannot. Saying so is the whole point of the flag.
  const base = honest();
  const result = await verifySolve({ ...base, issuedAt: null });

  assert.equal(result.verified, true, JSON.stringify(result));
  if (result.verified) {
    assert.equal(result.timingBounded, false);
  }
});

test("a ranked solve reports its timing as bounded", async () => {
  const result = await verifySolve(honest());
  assert.equal(result.verified, true);
  if (result.verified) assert.equal(result.timingBounded, true);
});

test("an unbounded solve still cannot claim an impossible time", async () => {
  // Dropping the wall-clock bound must not drop the plausibility floor with it.
  const moves = stream(inverse(SCRAMBLE), 20);
  const result = await verifySolve({
    ...honest(),
    issuedAt: null,
    moves,
    durationMs: moves[moves.length - 1].atMs,
  });
  assert.equal(result.verified, false);
});

test("an unbounded solve must still actually solve the cube", async () => {
  const moves = stream(["R", "U", "R'", "U'"]);
  const result = await verifySolve({
    ...honest(),
    issuedAt: null,
    moves,
    durationMs: moves[moves.length - 1].atMs,
  });
  assert.equal(result.verified, false);
});
