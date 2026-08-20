import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IMPLAUSIBLY_SHORT_MOVES,
  REVIEW_THRESHOLD,
  assessHumanness,
  needsReview,
} from "./humanness";
import type { SubmittedMove } from "./verifySolve";

/** A deterministic generator, so a failure is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * A move stream shaped like a person solving.
 *
 * About 55 turns, quick bursts, and recognition pauses several times longer than
 * the turning — which is what a real solve looks like when you plot it: the
 * cross flows, then a stop to find the first pair, then a burst, and a long stop
 * before the last layer.
 */
function humanSolve(count = 55, seed = 7): SubmittedMove[] {
  const rand = rng(seed);
  const moves: SubmittedMove[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    // Roughly five turns a second, wandering.
    let gap = 140 + rand() * 120;
    // A recognition pause every so often.
    if (i > 0 && i % 9 === 0) gap += 400 + rand() * 700;
    at += Math.round(gap);
    moves.push({ move: "R", atMs: at });
  }
  return moves;
}

/** What replaying an engine's answer looks like: short, and evenly spaced. */
function replayedSolve(count = 20, gap = 90): SubmittedMove[] {
  return Array.from({ length: count }, (_, i) => ({ move: "R", atMs: i * gap }));
}

test("an ordinary human solve is not flagged", () => {
  const moves = humanSolve();
  const duration = moves[moves.length - 1].atMs;
  const report = assessHumanness(moves, duration);

  assert.equal(report.inconclusive, false);
  assert.ok(
    !needsReview(report),
    `scored ${report.score.toFixed(2)}: ${report.reasons.join("; ")}`,
  );
});

test("human solves across a range of speeds are not flagged", () => {
  // A six-second solver and a forty-second one must both read as human. This is
  // why the spread is measured relative to each solver's own pace rather than in
  // milliseconds.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const count of [48, 55, 62, 70]) {
      const moves = humanSolve(count, seed);
      const duration = moves[moves.length - 1].atMs;
      const report = assessHumanness(moves, duration);
      assert.ok(
        !needsReview(report),
        `seed ${seed}, ${count} moves scored ${report.score.toFixed(2)}: ${report.reasons.join("; ")}`,
      );
    }
  }
});

test("a replayed engine solution is flagged", () => {
  // The obvious cheat: solve it with a program and play the answer back. Twenty
  // moves is what this repository's own solver returns.
  const moves = replayedSolve(20, 90);
  const report = assessHumanness(moves, moves[moves.length - 1].atMs);

  assert.ok(needsReview(report), `scored ${report.score.toFixed(2)}`);
  assert.ok(report.reasons.length > 0, "a flag must come with reasons");
});

test("the move count alone is enough to flag", () => {
  // Even with convincing human pacing, twenty moves is a search rather than a
  // person. Averaging the signals would let good pacing hide it, which is why
  // the score takes the worst.
  const human = humanSolve(20, 3);
  const report = assessHumanness(human, human[human.length - 1].atMs);
  assert.ok(needsReview(report), `scored ${report.score.toFixed(2)}`);
  assert.ok(report.reasons.some((r) => r.includes("turns")));
});

test("perfectly even turning is flagged even at a full move count", () => {
  // A metronome is the cheapest cheat to write, so a 55-move stream with no
  // variation at all must not pass just because the length is ordinary.
  const metronome = replayedSolve(55, 160);
  const report = assessHumanness(metronome, metronome[metronome.length - 1].atMs);
  assert.ok(needsReview(report), `scored ${report.score.toFixed(2)}`);
});

test("the integration harness's own solves are flagged", () => {
  // The test suites in this repository pace solves evenly by inverting the
  // scramble — which is exactly the shape a replayed solution has. If the
  // detector could not see that, it could not see the real thing either.
  const scrambleLength = 20;
  const durationMs = 5000;
  const gap = Math.round(durationMs / (scrambleLength - 1));
  const harness = Array.from({ length: scrambleLength }, (_, i) => ({
    move: "R",
    atMs: i * gap,
  }));

  const report = assessHumanness(harness, durationMs);
  assert.ok(needsReview(report), `scored ${report.score.toFixed(2)}`);
});

test("a short stream says so rather than guessing", () => {
  const report = assessHumanness(replayedSolve(4), 400);
  assert.equal(report.inconclusive, true);
  assert.equal(needsReview(report), false, "inconclusive must never flag");
  assert.equal(report.reasons.length, 0);
});

test("rotations are not counted as turns", () => {
  // A cuber rotating the whole cube has not turned a layer, and counting those
  // would make an efficient solve look longer than it was.
  const withRotations: SubmittedMove[] = [];
  let at = 0;
  for (let i = 0; i < 30; i++) {
    withRotations.push({ move: i % 3 === 0 ? "y" : "R", atMs: (at += 150) });
  }
  const report = assessHumanness(withRotations, at);
  assert.ok(
    report.signals.find((s) => s.key === "moveCount")!.detail.startsWith("20 turns"),
    report.signals.find((s) => s.key === "moveCount")!.detail,
  );
});

test("a broken clock does not crash the analysis", () => {
  // Non-monotonic timestamps are a broken client, not evidence of cheating.
  const jumbled: SubmittedMove[] = [
    { move: "R", atMs: 0 },
    { move: "U", atMs: 500 },
    { move: "F", atMs: 200 },
    { move: "D", atMs: 900 },
    { move: "L", atMs: 1200 },
    { move: "B", atMs: 1500 },
    { move: "R", atMs: 1800 },
    { move: "U", atMs: 2100 },
    { move: "F", atMs: 2400 },
    { move: "D", atMs: 2700 },
  ];
  const report = assessHumanness(jumbled, 2700);
  assert.ok(Number.isFinite(report.score));
  assert.ok(report.score >= 0 && report.score <= 1);
});

test("the threshold leaves ordinary play alone", () => {
  // The cost of being wrong is asymmetric: a missed cheat costs one rating, a
  // wrongly flagged player costs the belief the ladder runs on.
  assert.ok(REVIEW_THRESHOLD >= 0.75, "the bar must be high");
  assert.ok(IMPLAUSIBLY_SHORT_MOVES < 40, "and the move-count line below real solves");
});

test("the score never leaves 0..1", () => {
  for (const moves of [replayedSolve(20, 1), replayedSolve(80, 5000), humanSolve(120, 11)]) {
    const report = assessHumanness(moves, Math.max(1, moves[moves.length - 1].atMs));
    assert.ok(report.score >= 0 && report.score <= 1, String(report.score));
  }
});
