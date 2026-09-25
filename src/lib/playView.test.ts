import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PLAY_VIEW, parsePlayView, TURN_SPEEDS, turnMs } from "./playView";

test("the default turn is fast — a real fast turn, not half a second", () => {
  assert.equal(DEFAULT_PLAY_VIEW.speed, "fast");
  assert.ok(turnMs("fast") <= 150, String(turnMs("fast")));
});

test("the speeds run from smooth to instant", () => {
  const ms = TURN_SPEEDS.map((s) => turnMs(s.id));
  assert.deepEqual([...ms].sort((a, b) => b - a), ms, "ordered slowest first");
  assert.ok(turnMs("instant") <= 20);
  assert.ok(turnMs("smooth") >= 300);
});

test("a stored view is read back, and anything unreadable falls back to the default", () => {
  assert.deepEqual(parsePlayView(JSON.stringify({ speed: "instant", showBack: true })), { speed: "instant", showBack: true });
  assert.deepEqual(parsePlayView(null), DEFAULT_PLAY_VIEW);
  assert.deepEqual(parsePlayView("{not json"), DEFAULT_PLAY_VIEW);
  assert.deepEqual(parsePlayView(JSON.stringify({ speed: "warp", showBack: "yes" })), DEFAULT_PLAY_VIEW);
  assert.deepEqual(parsePlayView(JSON.stringify({ speed: "smooth" })), { ...DEFAULT_PLAY_VIEW, speed: "smooth" });
});
