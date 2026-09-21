import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_SOLVES_TO_CLAIM,
  MIN_SOLVES_TO_PROJECT,
  headlineFor,
  summariseClaim,
} from "./claim";
import { ratingForMs } from "./rating";
import type { StoredSolve } from "./solveHistory";
import type { Penalty } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 5, 12, 0, 0);

function solve(
  ms: number,
  overrides: Partial<StoredSolve> = {},
): StoredSolve {
  return {
    id: `s${Math.round(ms)}-${overrides.at ?? 0}`,
    at: BASE,
    scramble: "R U R' U'",
    durationMs: ms,
    penalty: "OK" as Penalty,
    moveCount: 55,
    tps: 5,
    splits: [],
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "keyboard",
    ...overrides,
  };
}

/** A run of solves around a pace, deterministic so counts are exact. */
function run(count: number, ms: number): StoredSolve[] {
  return Array.from({ length: count }, (_, i) =>
    solve(ms + (i % 5) * 100, { at: BASE + i * 1000, id: `run-${i}` }),
  );
}

/**
 * A solve with real phase splits.
 *
 * `PhaseSplit` carries the window as well as the duration, so the parts are
 * built cumulatively rather than with a made-up shape — a cast would have let
 * the wrong field names through, and `groupSplits` reads `durationMs`, so a
 * split with the wrong key silently contributes nothing.
 */
const withSplits = (
  ms: number,
  cross: number,
  f2l: number,
  oll: number,
  pll: number,
  i = 0,
) => {
  let cursor = 0;
  const part = (phase: string, durationMs: number) => {
    const split = {
      phase,
      startMs: cursor,
      endMs: cursor + durationMs,
      durationMs,
      moveCount: 10,
      tps: 4,
    };
    cursor += durationMs;
    return split;
  };

  return solve(ms, {
    at: BASE + i * 1000,
    id: `sp-${i}`,
    splits: [
      part("Cross", cross),
      part("F2L", f2l),
      part("OLL", oll),
      part("PLL", pll),
    ],
  });
};

// ---------------------------------------------------------------------------

test("an empty history is not worth claiming", () => {
  const summary = summariseClaim([]);
  assert.equal(summary.worthClaiming, false);
  assert.equal(summary.solveCount, 0);
  assert.equal(summary.projectedRating, null);
  assert.equal(summary.bestSingle, null);
  assert.deepEqual(summary.shape, []);
});

test("too few solves is not worth claiming", () => {
  const summary = summariseClaim(run(MIN_SOLVES_TO_CLAIM - 1, 20_000));
  assert.equal(summary.worthClaiming, false);
});

test("enough solves is", () => {
  const summary = summariseClaim(run(MIN_SOLVES_TO_CLAIM, 20_000));
  assert.equal(summary.worthClaiming, true);
  assert.equal(summary.solveCount, MIN_SOLVES_TO_CLAIM);
});

test("a projection needs more than a claim does", () => {
  // The two thresholds are deliberately different: five solves is enough to say
  // "here is what you have", and nowhere near enough to name a rating.
  const claimable = summariseClaim(run(MIN_SOLVES_TO_PROJECT - 1, 20_000));
  assert.equal(claimable.worthClaiming, true);
  assert.equal(claimable.projectedRating, null, "must not project this early");

  const projectable = summariseClaim(run(MIN_SOLVES_TO_PROJECT, 20_000));
  assert.notEqual(projectable.projectedRating, null);
});

test("the projection comes from the average, never the single", () => {
  // A lucky single is the least representative thing a session contains, and
  // ranked rates averages — so projecting from a single would advertise a number
  // the ladder would never award, and it would flatter.
  const solves = [
    ...run(MIN_SOLVES_TO_PROJECT, 20_000),
    solve(4_000, { at: BASE + 999_000, id: "lucky" }),
  ];
  const summary = summariseClaim(solves);

  assert.equal(summary.bestSingle, 4_000, "the single is still reported");
  const fromSingle = ratingForMs(4_000);
  assert.notEqual(summary.projectedRating, fromSingle, "but it must not drive the rating");

  assert.equal(summary.bestAo5.kind, "value");
  if (summary.bestAo5.kind === "value") {
    assert.equal(summary.projectedRating, Math.round(ratingForMs(summary.bestAo5.ms)));
  }
});

test("a faster pace projects a higher rating", () => {
  const slow = summariseClaim(run(20, 30_000));
  const fast = summariseClaim(run(20, 10_000));
  assert.ok(slow.projectedRating !== null && fast.projectedRating !== null);
  assert.ok(fast.projectedRating! > slow.projectedRating!);
});

test("DNFs are excluded from the count rather than counted as slow", () => {
  const solves = [
    ...run(10, 20_000),
    ...Array.from({ length: 5 }, (_, i) =>
      solve(20_000, { at: BASE + (100 + i) * 1000, id: `dnf-${i}`, penalty: "DNF" }),
    ),
  ];
  const summary = summariseClaim(solves);
  assert.equal(summary.solveCount, 10, "DNFs are not solves you did");
});

test("a +2 counts against the time but not against the clock", () => {
  // The penalty changes what the solve is worth; it does not change how long
  // the person actually spent at the cube.
  const clean = summariseClaim([solve(10_000, { id: "a" })]);
  const penalised = summariseClaim([solve(10_000, { id: "b", penalty: "PLUS2" })]);

  assert.equal(clean.totalMs, penalised.totalMs, "time lived is the same");
  assert.equal(clean.bestSingle, 10_000);
  assert.equal(penalised.bestSingle, 12_000, "but the result is two seconds worse");
});

test("days are counted distinctly, not per solve", () => {
  const solves = [
    solve(20_000, { at: BASE, id: "d1a" }),
    solve(20_000, { at: BASE + 60_000, id: "d1b" }),
    solve(20_000, { at: BASE + DAY, id: "d2" }),
    solve(20_000, { at: BASE + 3 * DAY, id: "d4" }),
  ];
  const summary = summariseClaim(solves);
  assert.equal(summary.solveCount, 4);
  assert.equal(summary.dayCount, 3);
});

test("the first solve is the earliest, not the first in the array", () => {
  const summary = summariseClaim([
    solve(20_000, { at: BASE + DAY, id: "later" }),
    solve(20_000, { at: BASE, id: "earlier" }),
  ]);
  assert.equal(summary.firstSolveAt, BASE);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("the shape divides a solve into proportions that sum to one", () => {
  const summary = summariseClaim([
    withSplits(20_000, 2_000, 10_000, 4_000, 4_000, 0),
    withSplits(20_000, 2_000, 10_000, 4_000, 4_000, 1),
  ]);

  assert.equal(summary.shape.length, 4);
  const total = summary.shape.reduce((sum, part) => sum + part.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares summed to ${total}`);

  const f2l = summary.shape.find((part) => part.phase === "F2L");
  assert.ok(f2l);
  assert.ok(Math.abs(f2l!.share - 0.5) < 1e-9, "F2L was half the solve");
});

test("solves with no splits are skipped, not counted as zero", () => {
  // A stopwatch user has no phases. Counting them as zero would draw a picture
  // that is not merely incomplete but wrong — it would halve every share.
  const summary = summariseClaim([
    withSplits(20_000, 2_000, 10_000, 4_000, 4_000, 0),
    solve(20_000, { at: BASE + 5000, id: "stopwatch" }),
  ]);

  const f2l = summary.shape.find((part) => part.phase === "F2L");
  assert.ok(Math.abs(f2l!.share - 0.5) < 1e-9, "the stopwatch solve must not dilute it");
  assert.ok(Math.abs(f2l!.ms - 10_000) < 1e-9, "nor drag the mean toward zero");
});

test("a history with no splittable solves has no shape at all", () => {
  const summary = summariseClaim(run(20, 20_000));
  assert.deepEqual(summary.shape, [], "empty, rather than four zeroes");
});

test("the shape is a mean, so one long solve does not decide it", () => {
  const summary = summariseClaim([
    withSplits(20_000, 2_000, 10_000, 4_000, 4_000, 0),
    withSplits(20_000, 2_000, 10_000, 4_000, 4_000, 1),
    // One disaster where PLL went badly wrong.
    withSplits(60_000, 2_000, 10_000, 4_000, 44_000, 2),
  ]);

  const pll = summary.shape.find((part) => part.phase === "PLL");
  assert.ok(pll);
  // Mean of 4s, 4s, 44s is ~17.3s — high, but nowhere near the 44s the outlier
  // alone would suggest if it dominated.
  assert.ok(pll!.ms > 10_000 && pll!.ms < 20_000, `${pll!.ms}ms`);
});

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

const format = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

test("nothing worth claiming has no headline", () => {
  assert.equal(headlineFor(summariseClaim([]), format), null);
  assert.equal(headlineFor(summariseClaim(run(2, 20_000)), format), null);
});

test("with enough solves the headline is the projected rating", () => {
  const summary = summariseClaim(run(20, 15_000));
  const headline = headlineFor(summary, format);
  assert.equal(headline?.label, "projected rating");
  assert.equal(headline?.value, String(summary.projectedRating));
});

test("without a projection it leads with the best average instead", () => {
  // Somebody with eight solves has no projection, and an empty slot where a
  // number should be is worse than leading with what they do have.
  const summary = summariseClaim(run(8, 15_000));
  const headline = headlineFor(summary, format);
  assert.equal(summary.projectedRating, null);
  assert.equal(headline?.label, "best average of 5");
});

test("the headline never invents a number it does not have", () => {
  for (const count of [5, 8, 12, 20, 100]) {
    const summary = summariseClaim(run(count, 15_000));
    const headline = headlineFor(summary, format);
    assert.ok(headline, `${count} solves should have a headline`);
    assert.ok(headline!.value.length > 0);
    assert.notEqual(headline!.value, "null");
    assert.notEqual(headline!.value, "undefined");
    assert.notEqual(headline!.value, "NaN");

    // The bug this line exists for: `ratingForMs` returns a raw logarithm, and
    // the screen showed "1990.942818539531" as a projected rating until
    // somebody looked at the rendered page.
    //
    // Scoped to the rating headline specifically. A first version asserted "no
    // decimal point anywhere" and failed on "15.20s", which is a correctly
    // formatted time — a check aimed at the wrong thing, which is how a guard
    // ends up either useless or wrong.
    if (headline!.label === "projected rating") {
      assert.ok(
        /^\d+$/.test(headline!.value),
        `a projected rating must be a whole number, got ${headline!.value}`,
      );
    }
  }
});

test("a projected rating is a whole number", () => {
  for (const ms of [8_123, 12_456, 17_777, 31_002]) {
    const summary = summariseClaim(run(20, ms));
    assert.ok(summary.projectedRating !== null);
    assert.equal(
      summary.projectedRating,
      Math.round(summary.projectedRating!),
      `${summary.projectedRating} is not whole`,
    );
  }
});

test("a projected rating is never presented as an established one", () => {
  // The property that matters most in this file, pinned so it cannot be
  // loosened by accident. A projection comes from unverified practice solves;
  // presenting it as a rating is exactly the lie the ladder's verification
  // exists to prevent.
  const summary = summariseClaim(run(50, 12_000));
  const headline = headlineFor(summary, format);
  assert.equal(headline?.label, "projected rating");
  assert.ok(
    headline!.label.includes("projected"),
    "the word 'projected' is load-bearing and must survive any rewording",
  );
});

test("a projection onto the ladder is drawn only from solves turned here", () => {
  // Twelve keyboard solves at 20s, and a hundred stopwatch or imported csTimer
  // times at 11s from a real cube. The ladder is the keyboard; the 11s belong to
  // a different sport and must not set the projection.
  const turned = run(MIN_SOLVES_TO_PROJECT, 20_000);
  const byHand = Array.from({ length: 100 }, (_, i) =>
    solve(11_000, { id: `hand-${i}`, at: BASE + 500_000 + i, source: "manual", moveCount: 0 }),
  );
  const summary = summariseClaim([...turned, ...byHand]);
  assert.ok(summariseClaim(turned).projectedRating !== null);
  assert.equal(summary.projectedRating, summariseClaim(turned).projectedRating);
  assert.equal(summary.solveCount, MIN_SOLVES_TO_PROJECT + 100, "they still count as solves");
  assert.equal(summary.bestSingle, 11_000, "and their best is still their best");
});

test("stopwatch solves from before `manual` existed are told apart by having no turns", () => {
  const oldStopwatch = Array.from({ length: 50 }, (_, i) =>
    solve(9_000, { id: `old-${i}`, at: BASE + i, source: "keyboard", moveCount: 0 }),
  );
  assert.equal(summariseClaim(oldStopwatch).projectedRating, null);
});

test("the count toward a projection is of turned solves, so it can never go negative", () => {
  const byHand = Array.from({ length: 30 }, (_, i) =>
    solve(11_000, { id: `hand-${i}`, at: BASE + i, source: "manual", moveCount: 0 }),
  );
  const summary = summariseClaim([...byHand, ...run(3, 20_000)]);
  assert.equal(summary.solveCount, 33);
  assert.equal(summary.turnedCount, 3);
  assert.ok(MIN_SOLVES_TO_PROJECT - summary.turnedCount > 0);
});
