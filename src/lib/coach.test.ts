import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_GOAL_MS,
  MIN_SOLVES_FOR_PLAN,
  RECENT_WINDOW,
  buildPlan,
  currentAverage,
  evaluateGoal,
  type Goal,
} from "./coach";
import type { StoredSolve } from "./solveHistory";
import type { PhaseSplit } from "./cfop";

let counter = 0;

function solve(
  durationMs: number,
  options: Partial<StoredSolve> = {},
): StoredSolve {
  counter++;
  return {
    id: `s${counter}`,
    at: counter * 1000,
    scramble: "R U R'",
    durationMs,
    penalty: "OK",
    moveCount: 50,
    tps: 3,
    splits: [],
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "keyboard",
    ...options,
  };
}

/**
 * A run of solves at a steady time, with a little noise.
 *
 * The noise alternates sign so the two halves of the run have the same mean —
 * otherwise "steady" data carries a systematic drift and the trend test
 * correctly reports a change that the test did not intend. And `jitter: 0` must
 * mean no noise rather than `x % 0`, which is NaN and silently removes every
 * solve from the sample.
 */
function steady(ms: number, count: number, jitter = 200): StoredSolve[] {
  return Array.from({ length: count }, (_, i) => {
    const offset = jitter === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * (i % (jitter + 1));
    return solve(ms + offset);
  });
}

const goal = (targetMs: number, baselineMs: number): Goal => ({
  targetMs,
  baselineMs,
  setAt: 0,
});

// ---------------------------------------------------------------------------
// Refusing to claim
// ---------------------------------------------------------------------------

test("no goal means no claims", () => {
  const progress = evaluateGoal(null, steady(20_000, 30));
  assert.equal(progress.status, "no-goal");
  assert.equal(progress.solvesRemaining, null);
});

test("a thin history gets no projection and says why", () => {
  const progress = evaluateGoal(goal(18_000, 22_000), steady(21_000, 5));
  assert.equal(progress.status, "insufficient");
  assert.equal(progress.solvesRemaining, null);
  assert.match(progress.explanation, /at least \d+ analysed solves/);
  assert.match(progress.explanation, /you have 5/);
});

test("flat times get NO date, however many solves there are", () => {
  // The claim every other timer makes and cannot support. A cuber told they are
  // "on track" by a line fitted through noise learns the wrong lesson.
  const progress = evaluateGoal(goal(18_000, 22_000), steady(21_000, 80));
  assert.equal(progress.status, "no-clear-change");
  assert.equal(progress.solvesRemaining, null, "no date may be invented");
  assert.match(progress.explanation, /normal variation/);
  assert.match(progress.explanation, /not the same as no progress/);
});

test("getting slower is reported, not smoothed over", () => {
  const solves = [...steady(18_000, 20), ...steady(24_000, 20)];
  const progress = evaluateGoal(goal(15_000, 19_000), solves);
  assert.equal(progress.status, "worsening");
  assert.equal(progress.solvesRemaining, null);
});

// ---------------------------------------------------------------------------
// When a claim IS supported
// ---------------------------------------------------------------------------

test("a clear improvement earns a projection", () => {
  const solves = [...steady(30_000, 20), ...steady(24_000, 20)];
  const progress = evaluateGoal(goal(20_000, 30_000), solves);
  assert.equal(progress.status, "improving");
  assert.ok(progress.solvesRemaining !== null && progress.solvesRemaining > 0);
  // The projection must state its own fragility.
  assert.match(progress.explanation, /assumes the rate holds/);
});

test("a reached goal is reported as reached", () => {
  const progress = evaluateGoal(goal(25_000, 30_000), steady(22_000, 30));
  assert.equal(progress.status, "reached");
  assert.equal(progress.closed, 1);
  assert.equal(progress.solvesRemaining, 0);
});

test("progress toward the goal is measured against where you started", () => {
  // Baseline 30s, target 20s, now 25s: exactly half the gap closed.
  const progress = evaluateGoal(goal(20_000, 30_000), steady(25_000, 30, 0));
  assert.ok(progress.closed !== null);
  assert.ok(
    Math.abs(progress.closed - 0.5) < 0.05,
    `closed ${progress.closed}, expected about 0.5`,
  );
});

test("progress never reads below zero or above one", () => {
  // Slower than the day you started, and faster than the goal.
  const behind = evaluateGoal(goal(20_000, 30_000), steady(40_000, 30, 0));
  assert.ok(behind.closed === null || behind.closed >= 0);

  const ahead = evaluateGoal(goal(20_000, 30_000), steady(15_000, 30, 0));
  assert.ok(ahead.closed === null || ahead.closed <= 1);
});

test("the current average uses a window a cuber recognises", () => {
  // Old slow solves must not drag the current figure; "where I am now" is recent.
  const solves = [...steady(60_000, 50, 0), ...steady(15_000, RECENT_WINDOW, 0)];
  const current = currentAverage(solves);
  assert.ok(current !== null && Math.abs(current - 15_000) < 500, `${current}`);
});

test("DNFs are excluded from the average rather than counted as zero", () => {
  const solves = [...steady(20_000, 20, 0), solve(0, { penalty: "DNF" })];
  const current = currentAverage(solves);
  assert.ok(current !== null && Math.abs(current - 20_000) < 500, `${current}`);
});

test("an empty history has no average rather than a zero", () => {
  assert.equal(currentAverage([]), null);
  assert.ok(MIN_GOAL_MS > 0);
});

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

const split = (phase: string, durationMs: number): PhaseSplit =>
  ({ phase, durationMs }) as PhaseSplit;

/** Solves where one OLL case is consistently slow. */
function withCases(count: number): StoredSolve[] {
  return Array.from({ length: count }, (_, i) => {
    const slow = i % 3 === 0;
    return solve(20_000, {
      ollCase: slow ? "slow-case" : `ok-case-${i % 4}`,
      ollSetup: "R U R' U R U2 R'",
      splits: [
        split("cross", 2000),
        split("F2L", 9000),
        split("OLL", slow ? 6000 : 1500),
        split("PLL", 2500),
      ],
    });
  });
}

test("a plan is refused on thin evidence", () => {
  const plan = buildPlan(steady(20_000, 4), null);
  assert.deepEqual(plan.items, []);
  assert.match(plan.verdict, new RegExp(`${MIN_SOLVES_FOR_PLAN} analysed solves`));
});

test("the plan names the case that actually costs time", () => {
  const plan = buildPlan(withCases(30), null);
  assert.ok(plan.items.length > 0, "expected at least one recommendation");
  assert.equal(plan.items[0].caseId, "slow-case");
  assert.ok(plan.items[0].occurrences >= 3);
});

test("savings are quoted per solve, not per sample", () => {
  // `excessMs` from caseStats is the total across every solve analysed. Quoting
  // it directly would overstate the benefit by the size of the sample — which
  // for 30 solves is a factor of thirty.
  const plan = buildPlan(withCases(30), null);
  const top = plan.items[0];
  // The slow case appears in a third of solves and costs ~4.5s more each time,
  // so the per-solve figure must be a fraction of a single solve's total.
  assert.ok(top.perSolveMs > 0, "should be worth something");
  assert.ok(
    top.perSolveMs < 20_000,
    `per-solve saving of ${top.perSolveMs}ms exceeds a whole solve`,
  );
});

test("the plan says when it cannot get you to your goal", () => {
  // Honest, and the more common case: algorithms are rarely the whole gap.
  const solves = withCases(30);
  const plan = buildPlan(solves, goal(5000, 20_000));
  assert.ok(plan.coversGapFraction !== null);
  assert.ok(plan.coversGapFraction < 1);
  assert.match(plan.verdict, /turning faster or pausing less/);
});

test("the plan says when it IS enough", () => {
  const solves = withCases(30);
  const current = currentAverage(solves)!;
  // A goal just under the current average, so a small saving covers it.
  const plan = buildPlan(solves, goal(current - 100, current));
  assert.ok(plan.coversGapFraction !== null && plan.coversGapFraction >= 1);
  assert.match(plan.verdict, /covers the/);
});

test("nothing is recommended when no case stands out", () => {
  // Every case equally costly means the gain is elsewhere, and saying so is more
  // useful than naming an arbitrary one.
  const flat = Array.from({ length: 30 }, (_, i) =>
    solve(20_000, {
      ollCase: `case-${i % 5}`,
      ollSetup: "R U R'",
      splits: [split("cross", 2000), split("F2L", 9000), split("OLL", 3000), split("PLL", 2500)],
    }),
  );
  const plan = buildPlan(flat, null);
  assert.equal(plan.items.length, 0);
  assert.match(plan.verdict, /No case stands out/);
});

test("the plan is capped so it stays actionable", () => {
  const plan = buildPlan(withCases(60), null, new Map(), 3);
  assert.ok(plan.items.length <= 3, "a list of twenty things is not a plan");
});
