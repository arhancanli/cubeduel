import { test } from "node:test";
import assert from "node:assert/strict";

import { EVENTS, EVENT_IDS, eventOf, hasSolver, isEventId } from "./events";
import {
  ANCHOR_FAST_RATING,
  ANCHOR_MID_RATING,
  RATING_FLOOR,
  msForRating,
  ratingCeiling,
  ratingForMs,
} from "./rating";

test("every event's anchors land exactly on 3000 and 2000", () => {
  // This is the property the whole multi-event design rests on: a rating means
  // the same standard of play whichever puzzle earned it. If an anchor drifts,
  // a cross-event leaderboard silently starts comparing unlike things.
  for (const id of EVENT_IDS) {
    const def = EVENTS[id];
    assert.ok(
      Math.abs(ratingForMs(def.worldClassMs, id) - ANCHOR_FAST_RATING) < 1e-6,
      `${id} world-class anchor`,
    );
    assert.ok(
      Math.abs(ratingForMs(def.strongMs, id) - ANCHOR_MID_RATING) < 1e-6,
      `${id} strong anchor`,
    );
  }
});

test("rating and time round-trip on every event", () => {
  for (const id of EVENT_IDS) {
    for (const rating of [2900, 2500, 2000, 1500, 900]) {
      const ms = msForRating(rating, id);
      assert.ok(
        Math.abs(ratingForMs(ms, id) - rating) < 1e-6,
        `${id} at ${rating}`,
      );
    }
  }
});

test("3x3 is untouched by the move to per-event anchors", () => {
  // The scale that already exists in public, in the README, and in every stored
  // rating. Changing it silently would invalidate every result on the ladder.
  assert.equal(Math.round(ratingForMs(5000, "333")), 3000);
  assert.equal(Math.round(ratingForMs(15_000, "333")), 2000);
  assert.equal(Math.round(ratingForMs(5000)), 3000, "and the default is 3x3");
});

test("a faster time always rates higher, on every event", () => {
  for (const id of EVENT_IDS) {
    const def = EVENTS[id];
    let previous = Infinity;
    for (const ms of [def.worldClassMs, def.worldClassMs * 2, def.strongMs, def.strongMs * 3]) {
      const rating = ratingForMs(ms, id);
      assert.ok(rating < previous, `${id}: ${ms}ms should rate below the last`);
      previous = rating;
    }
  }
});

test("each event has a ceiling, and it is finite", () => {
  // The log runs to infinity as time approaches zero, so without this a single
  // corrupt record sits at the top of a board forever.
  for (const id of EVENT_IDS) {
    const ceiling = ratingCeiling(id);
    assert.ok(Number.isFinite(ceiling), id);
    assert.ok(ceiling > ANCHOR_FAST_RATING, `${id} ceiling should beat world class`);
    assert.equal(ratingForMs(0, id), ceiling, `${id}: an impossible 0ms clamps`);
    assert.equal(ratingForMs(-5, id), ceiling, `${id}: so does a negative`);
  }
});

test("nothing rates below the floor, however slow", () => {
  for (const id of EVENT_IDS) {
    assert.equal(ratingForMs(60 * 60 * 1000, id), RATING_FLOOR, id);
  }
});

test("the anchors are ordered and plausible for the puzzle", () => {
  for (const id of EVENT_IDS) {
    const def = EVENTS[id];
    assert.ok(def.worldClassMs < def.strongMs, `${id}: world class must be faster`);
    assert.ok(def.minPlausibleMs < def.worldClassMs, `${id}: floor below world class`);
  }
  // Bigger cubes take longer. A transposition here would be invisible in every
  // other test, because each event's scale is internally consistent either way.
  const order = EVENT_IDS.map((id) => EVENTS[id].worldClassMs);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "ordered by size");
});

test("an unknown event falls back rather than throwing", () => {
  assert.equal(eventOf("777").id, "333");
  assert.equal(eventOf(undefined).id, "333");
  assert.equal(eventOf("444").id, "444");
  assert.equal(isEventId("333"), true);
  assert.equal(isEventId("777"), false);
});

test("only 3x3 claims a solver", () => {
  // Kociemba is specific to 3x3. Claiming move efficiency on a 5x5 would be
  // claiming something the code cannot support.
  assert.equal(hasSolver("333"), true);
  for (const id of EVENT_IDS.filter((e) => e !== "333")) {
    assert.equal(hasSolver(id), false, id);
  }
});
