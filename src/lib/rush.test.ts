import { test } from "node:test";
import assert from "node:assert/strict";

import { EVENTS } from "./events";
import {
  OPENING_SLACK,
  RUSH_LIVES,
  TIGHTEST,
  applySolve,
  nextTarget,
  referencePace,
  replayRush,
  startRush,
  type RushSolve,
} from "./rush";

const PACE = 12_000;
const ok = (ms: number): RushSolve => ({ durationMs: ms, penalty: "OK" });
const plus2 = (ms: number): RushSolve => ({ durationMs: ms, penalty: "PLUS2" });
const dnf = (): RushSolve => ({ durationMs: 0, penalty: "DNF" });

test("a run opens with slack over your own pace", () => {
  // The first solve is where people are still settling. An opening target that
  // catches somebody mid-breath teaches them the mode is unfair, not hard.
  const state = startRush(PACE, "333");
  assert.equal(state.targetMs, Math.round(PACE * OPENING_SLACK));
  assert.ok(state.targetMs > PACE);
});

test("the target tightens as you clear solves", () => {
  let state = startRush(PACE, "333");
  const opening = state.targetMs;
  for (let i = 0; i < 5; i++) state = applySolve(state, ok(1000), PACE, "333");
  assert.ok(state.targetMs < opening, `${state.targetMs} should be under ${opening}`);
  assert.equal(state.score, 5);
});

test("it never tightens past the floor", () => {
  // Without a floor the target converges on zero and every run ends on an
  // impossible number rather than a real limit — measuring arithmetic, not cubing.
  const far = nextTarget(500, PACE, "333");
  assert.equal(far, Math.round(PACE * TIGHTEST));
});

test("a miss does not tighten the target", () => {
  // Tightening after a miss compounds one bad solve into an impossible next one,
  // and runs end in a spiral instead of at a limit.
  let state = startRush(PACE, "333");
  const before = state.targetMs;
  state = applySolve(state, ok(60_000), PACE, "333");
  assert.equal(state.misses, 1);
  assert.equal(state.targetMs, before);
});

test("three misses ends the run", () => {
  let state = startRush(PACE, "333");
  for (let i = 0; i < RUSH_LIVES; i++) {
    assert.equal(state.over, false, `should still be live after ${i} misses`);
    state = applySolve(state, ok(90_000), PACE, "333");
  }
  assert.equal(state.over, true);
  assert.equal(state.misses, RUSH_LIVES);
});

test("nothing counts after the run is over", () => {
  let state = startRush(PACE, "333");
  for (let i = 0; i < RUSH_LIVES; i++) state = applySolve(state, ok(90_000), PACE, "333");
  const ended = state;
  state = applySolve(state, ok(1), PACE, "333");
  assert.deepEqual(state, ended, "a solve after the end must change nothing");
});

test("a DNF is a miss however fast the clock said", () => {
  let state = startRush(PACE, "333");
  state = applySolve(state, { durationMs: 1, penalty: "DNF" }, PACE, "333");
  assert.equal(state.misses, 1);
  assert.equal(state.score, 0);
});

test("a +2 is charged before the target is judged", () => {
  // 11.00 clears a 12.00 target; 11.00 with a +2 does not. Judging the raw time
  // would make the penalty free in the one mode where it bites hardest.
  const state = startRush(12_000 / OPENING_SLACK, "333");
  const target = state.targetMs;

  const raw = applySolve(state, ok(target - 500), target / OPENING_SLACK, "333");
  assert.equal(raw.score, 1);

  const penalised = applySolve(state, plus2(target - 500), target / OPENING_SLACK, "333");
  assert.equal(penalised.score, 0, "the +2 should push it past the target");
});

test("clearing exactly the target counts", () => {
  const state = startRush(PACE, "333");
  const exact = applySolve(state, ok(state.targetMs), PACE, "333");
  assert.equal(exact.score, 1, "reaching the target is clearing it");

  const over = applySolve(state, ok(state.targetMs + 1), PACE, "333");
  assert.equal(over.score, 0);
});

test("the streak resets on a miss but the best is kept", () => {
  let state = startRush(PACE, "333");
  for (let i = 0; i < 4; i++) state = applySolve(state, ok(100), PACE, "333");
  assert.equal(state.streak, 4);
  state = applySolve(state, dnf(), PACE, "333");
  assert.equal(state.streak, 0);
  assert.equal(state.bestStreak, 4);
});

test("replaying a run reproduces it exactly", () => {
  // This is what makes a score checkable. The client shows a running total for
  // feel; the record comes from replaying the stored solves, and a score the
  // server cannot reproduce is not a score but a claim.
  const solves = [ok(100), ok(200), dnf(), ok(150), ok(90_000), ok(120), dnf()];
  const replayed = replayRush(solves, PACE, "333");

  let stepped = startRush(PACE, "333");
  for (const s of solves) stepped = applySolve(stepped, s, PACE, "333");

  assert.deepEqual(replayed, stepped);
});

test("targets do not drift when recomputed", () => {
  // Derived from the cleared count rather than by shrinking the last value, so
  // there is no accumulated floating-point drift between a live run and a replay.
  for (let cleared = 0; cleared < 40; cleared++) {
    assert.equal(nextTarget(cleared, PACE, "333"), nextTarget(cleared, PACE, "333"));
  }
});

test("an unrated or corrupt pace cannot break a run", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const pace = referencePace(bad, "333");
    assert.equal(pace, EVENTS["333"].strongMs, String(bad));
    const state = startRush(bad, "333");
    assert.ok(Number.isFinite(state.targetMs) && state.targetMs > 0, String(bad));
  }
});

test("an absurdly fast pace is clamped to something a human could hold", () => {
  const pace = referencePace(1, "333");
  assert.equal(pace, EVENTS["333"].minSolveMs);
});

test("the mode is equally hard on every event", () => {
  // A world-class 5x5 solver and a world-class 3x3 solver should both find the
  // opening target 25% off their own pace — that is what makes one leaderboard
  // across events mean anything.
  for (const id of ["222", "333", "444", "555"] as const) {
    const def = EVENTS[id];
    const state = startRush(def.worldClassMs, id);
    assert.equal(state.targetMs, Math.round(def.worldClassMs * OPENING_SLACK), id);
  }
});
