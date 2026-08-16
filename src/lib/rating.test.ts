import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANCHOR_FAST_RATING,
  ANCHOR_FAST_SECONDS,
  ANCHOR_MID_RATING,
  ANCHOR_MID_SECONDS,
  ESTABLISHED_DEVIATION,
  MIN_DEVIATION,
  RATING_CEILING,
  RATING_FLOOR,
  UNRATED,
  applyWindow,
  isEstablished,
  msForRating,
  observationNoise,
  poolForSource,
  ratingForMs,
  type RatingState,
} from "./rating";
import type { Timed } from "./stats";

const at = (ms: number): Timed => ({ ms, penalty: "OK" });
const dnf = (): Timed => ({ ms: 0, penalty: "DNF" });
const plus2 = (ms: number): Timed => ({ ms, penalty: "PLUS2" });

/** Five identical attempts — the simplest window with a known ao5. */
const flat = (ms: number): Timed[] => Array.from({ length: 5 }, () => at(ms));

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

test("the anchors are exactly where they are documented", () => {
  // These two numbers are quoted to players ("2000 is sub-15"). If the scale
  // drifts off them the whole rating stops being interpretable.
  assert.equal(
    Math.round(ratingForMs(ANCHOR_FAST_SECONDS * 1000)),
    ANCHOR_FAST_RATING,
  );
  assert.equal(
    Math.round(ratingForMs(ANCHOR_MID_SECONDS * 1000)),
    ANCHOR_MID_RATING,
  );
});

test("the scale is strictly decreasing in time", () => {
  let previous = Infinity;
  for (const seconds of [3, 5, 8, 10, 12, 15, 20, 30, 45, 60, 90]) {
    const rating = ratingForMs(seconds * 1000);
    assert.ok(rating < previous, `${seconds}s should rate below the time before it`);
    previous = rating;
  }
});

test("equal ratios of time are equal steps of rating", () => {
  // The whole reason for a log scale: 30s to 20s must be worth the same as
  // 15s to 10s, because they are the same achievement.
  const stepA = ratingForMs(20_000) - ratingForMs(30_000);
  const stepB = ratingForMs(10_000) - ratingForMs(15_000);
  assert.ok(Math.abs(stepA - stepB) < 1e-6, `${stepA} vs ${stepB}`);
});

test("rating and time round-trip", () => {
  for (const seconds of [4, 7, 12, 15, 25, 40, 70]) {
    const ms = seconds * 1000;
    assert.ok(Math.abs(msForRating(ratingForMs(ms)) - ms) < 1e-6);
  }
});

test("the floor holds and does not go negative", () => {
  // A three-minute solve is a real thing a beginner does on day one.
  assert.equal(ratingForMs(180_000), RATING_FLOOR);
  assert.equal(ratingForMs(600_000), RATING_FLOOR);
});

test("a corrupt duration cannot rate its way to the top of the board", () => {
  // The log runs to infinity as time approaches zero. Without a ceiling a single
  // 0ms record outranks every real player, permanently.
  for (const ms of [0, -5, 1, 250, 999]) {
    const rating = ratingForMs(ms);
    assert.ok(Number.isFinite(rating), `${ms}ms produced ${rating}`);
    assert.equal(rating, RATING_CEILING, `${ms}ms should clamp to the ceiling`);
  }
  assert.ok(
    RATING_CEILING > ratingForMs(3000),
    "the ceiling must still sit above any real human result",
  );
});

test("the landmark times land where the docs claim", () => {
  // Spot-checks so a change to the anchors surfaces as a failing expectation
  // rather than as a silently different ladder.
  assert.equal(Math.round(ratingForMs(10_000)), 2369);
  assert.equal(Math.round(ratingForMs(20_000)), 1738);
  assert.equal(Math.round(ratingForMs(30_000)), 1369);
  assert.equal(Math.round(ratingForMs(60_000)), 738);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

test("the first window sets the rating to what was actually solved", () => {
  // A sub-10 cuber must not start at a fictional 1500 and grind toward the truth.
  const { state, observedRating } = applyWindow(UNRATED, flat(10_000), 0);
  assert.ok(state.rating !== null);
  assert.ok(
    Math.abs(state.rating - ratingForMs(10_000)) < 1,
    `seeded at ${state.rating}, expected about ${ratingForMs(10_000)}`,
  );
  assert.equal(Math.round(observedRating ?? 0), Math.round(ratingForMs(10_000)));
});

test("one window is not enough to be established", () => {
  const { state } = applyWindow(UNRATED, flat(15_000), 0);
  assert.equal(isEstablished(state), false, "five solves should not rank you");
});

test("about four clean windows establishes a rating", () => {
  let state = UNRATED;
  for (let i = 0; i < 4; i++) {
    state = applyWindow(state, flat(15_000), i * 1000).state;
  }
  assert.equal(isEstablished(state), true, `deviation was ${state.deviation}`);
});

test("a short window is ignored rather than rated as an ao5", () => {
  const short = [at(12_000), at(12_000), at(12_000), at(12_000)];
  const { state, averageMs } = applyWindow(UNRATED, short, 0);
  assert.equal(state, UNRATED, "state must be untouched");
  assert.equal(averageMs, null);
});

// ---------------------------------------------------------------------------
// Convergence and confidence
// ---------------------------------------------------------------------------

test("confidence grows with windows and never claims false precision", () => {
  let state = UNRATED;
  let previous = Infinity;
  for (let i = 0; i < 30; i++) {
    state = applyWindow(state, flat(15_000), i * 1000).state;
    assert.ok(state.deviation <= previous + 1e-9, "deviation must not grow while active");
    previous = state.deviation;
  }
  assert.ok(state.deviation >= MIN_DEVIATION, "must never claim better than the floor");
});

test("an established rating moves less on one window than a fresh one does", () => {
  // The core property of the filter. A veteran having one great session is not
  // suddenly world class; a newcomer's second window still counts for a lot.
  const fresh = applyWindow(UNRATED, flat(20_000), 0).state;
  const freshJump =
    applyWindow(fresh, flat(10_000), 1000).state.rating! - fresh.rating!;

  let veteran = UNRATED;
  for (let i = 0; i < 40; i++) {
    veteran = applyWindow(veteran, flat(20_000), i * 1000).state;
  }
  const veteranJump =
    applyWindow(veteran, flat(10_000), 41_000).state.rating! - veteran.rating!;

  assert.ok(
    veteranJump < freshJump,
    `veteran moved ${veteranJump}, newcomer moved ${freshJump}`,
  );
});

test("a streaky cuber earns a wider deviation than a metronomic one", () => {
  // Estimating noise from the player's own solves rather than assuming a
  // constant is what makes this true.
  const steady = applyWindow(UNRATED, flat(20_000), 0).state;
  const streaky = applyWindow(
    UNRATED,
    [at(12_000), at(28_000), at(15_000), at(31_000), at(19_000)],
    0,
  ).state;
  assert.ok(
    streaky.deviation > steady.deviation,
    `streaky ${streaky.deviation} vs steady ${steady.deviation}`,
  );
});

test("sustained improvement is tracked", () => {
  let state = UNRATED;
  for (let i = 0; i < 10; i++) state = applyWindow(state, flat(25_000), i * 1000).state;
  const before = state.rating!;
  for (let i = 0; i < 25; i++) {
    state = applyWindow(state, flat(15_000), (11 + i) * 1000).state;
  }
  assert.ok(state.rating! > before + 400, `moved from ${before} to ${state.rating}`);
  assert.ok(
    Math.abs(state.rating! - ratingForMs(15_000)) < 40,
    `should converge near ${ratingForMs(15_000)}, got ${state.rating}`,
  );
});

// ---------------------------------------------------------------------------
// DNFs — the anti-farming rule
// ---------------------------------------------------------------------------

test("one DNF in five is survivable, exactly as the WCA trims it", () => {
  const { state, failed, averageMs } = applyWindow(
    UNRATED,
    [at(15_000), at(15_000), at(15_000), at(15_000), dnf()],
    0,
  );
  assert.equal(failed, false);
  assert.ok(averageMs !== null, "a single DNF is trimmed away as the worst");
  assert.ok(state.rating !== null);
});

test("a failed window invents no time and leaves the rating alone", () => {
  const established = (() => {
    let s: RatingState = UNRATED;
    for (let i = 0; i < 6; i++) s = applyWindow(s, flat(15_000), i * 1000).state;
    return s;
  })();

  const after = applyWindow(
    established,
    [at(15_000), at(15_000), at(15_000), dnf(), dnf()],
    7000,
  );

  assert.equal(after.failed, true);
  assert.equal(after.observedRating, null, "no fabricated time may enter the filter");
  assert.equal(after.state.rating, established.rating, "rating must be untouched");
  assert.ok(
    after.state.deviation > established.deviation,
    "a failed window must cost confidence",
  );
});

test("abandoning attempts can never raise a rating", () => {
  // The exploit this rule exists to close: bail out of every bad solve and rate
  // only the good ones.
  let state = UNRATED;
  for (let i = 0; i < 6; i++) state = applyWindow(state, flat(20_000), i * 1000).state;
  const before = state.rating!;

  for (let i = 0; i < 20; i++) {
    state = applyWindow(state, [at(9000), dnf(), dnf(), dnf(), dnf()], (7 + i) * 1000)
      .state;
    assert.ok(
      state.rating! <= before + 1e-9,
      `farming DNFs moved the rating to ${state.rating}`,
    );
  }
});

test("repeated failure eventually drops a player off the leaderboard", () => {
  let state = UNRATED;
  for (let i = 0; i < 8; i++) state = applyWindow(state, flat(15_000), i * 1000).state;
  assert.equal(isEstablished(state), true, "precondition: ranked to begin with");

  for (let i = 0; i < 10; i++) {
    state = applyWindow(state, [dnf(), dnf(), dnf(), dnf(), dnf()], (9 + i) * 1000)
      .state;
  }
  assert.equal(
    isEstablished(state),
    false,
    `still ranked at deviation ${state.deviation} after ten failed windows`,
  );
});

test("a +2 is rated as the time it actually cost", () => {
  const clean = applyWindow(UNRATED, flat(15_000), 0).state.rating!;
  const penalised = applyWindow(
    UNRATED,
    [plus2(15_000), plus2(15_000), plus2(15_000), plus2(15_000), plus2(15_000)],
    0,
  ).state.rating!;
  assert.ok(penalised < clean, "two seconds must show up in the rating");
  assert.ok(
    Math.abs(penalised - ratingForMs(17_000)) < 1,
    `expected about ${ratingForMs(17_000)}, got ${penalised}`,
  );
});

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

test("time away widens the deviation", () => {
  let state = UNRATED;
  for (let i = 0; i < 10; i++) state = applyWindow(state, flat(15_000), i * 1000).state;
  const sharp = state.deviation;

  // Same window again, but ninety days later.
  const stale = applyWindow(state, flat(15_000), 10_000 + 90 * DAY).state;
  const immediate = applyWindow(state, flat(15_000), 11_000).state;

  assert.ok(
    stale.deviation > immediate.deviation,
    `stale ${stale.deviation} vs immediate ${immediate.deviation} (was ${sharp})`,
  );
});

test("a long absence un-establishes a rating before the next window", () => {
  let state = UNRATED;
  for (let i = 0; i < 10; i++) state = applyWindow(state, flat(15_000), i * 1000).state;
  // Drift is applied inside the update, so check it via a failed window, which
  // is the one path that reports the drifted deviation without also shrinking it.
  const after = applyWindow(state, [dnf(), dnf(), dnf(), dnf(), dnf()], 10_000 + 365 * DAY);
  assert.ok(
    after.state.deviation > ESTABLISHED_DEVIATION,
    `a year away still left deviation at ${after.state.deviation}`,
  );
});

// ---------------------------------------------------------------------------
// Peak
// ---------------------------------------------------------------------------

test("a provisional fluke never becomes a permanent peak", () => {
  // One extraordinary first window, then a long truthful history. The profile
  // must not carry a peak the player never demonstrated.
  const fluke = applyWindow(UNRATED, flat(4000), 0);
  assert.equal(fluke.state.peak, null, "unestablished ratings cannot set a peak");

  let state = fluke.state;
  for (let i = 0; i < 20; i++) {
    state = applyWindow(state, flat(25_000), (i + 1) * 1000).state;
  }
  assert.ok(state.peak !== null, "an established rating does set a peak");
  assert.ok(
    state.peak! < ratingForMs(9000),
    `peak of ${state.peak} was never actually achieved`,
  );
});

test("peak keeps the best established rating, not the latest", () => {
  let state = UNRATED;
  for (let i = 0; i < 12; i++) state = applyWindow(state, flat(12_000), i * 1000).state;
  const high = state.rating!;
  assert.ok(state.peak !== null);

  for (let i = 0; i < 12; i++) {
    state = applyWindow(state, flat(30_000), (13 + i) * 1000).state;
  }
  assert.ok(state.rating! < high, "precondition: the player got slower");
  assert.ok(
    Math.abs(state.peak! - high) < 1,
    `peak slid from ${high} down to ${state.peak}`,
  );
});

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

test("stopwatch times are unrankable", () => {
  // No move stream, so nothing can be verified, so it cannot enter a ladder.
  assert.equal(poolForSource("manual"), null);
  assert.equal(poolForSource("keyboard"), "keyboard");
  assert.equal(poolForSource("smartcube"), "smartcube");
});

test("observation noise never collapses to zero on an identical window", () => {
  // Five byte-identical times are a suspiciously tidy sample, not proof of
  // infinite precision. Without the floor this would divide by ~0.
  const noise = observationNoise(flat(15_000));
  assert.ok(Number.isFinite(noise) && noise > 0, `noise was ${noise}`);
});
