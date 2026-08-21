import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calibrated,
  connected,
  connecting,
  describe as describeLink,
  failed,
  IDLE,
  isTrustworthy,
  lost,
  moved,
  simulatedCube,
} from "./cubeLink";

/**
 * The rule this file exists to enforce: a connected cube is not a trusted cube.
 *
 * A Bluetooth cube reports moves, never state, so the app has to assume where it
 * started. Assume "solved" and connect a scrambled cube and everything downstream
 * is confidently wrong — the mirror shows the wrong puzzle, solve detection never
 * fires, the case being drilled is not the case in your hands, and nothing
 * errors anywhere. These tests pin the one thing that prevents it.
 */

test("a fresh link trusts nothing", () => {
  assert.equal(isTrustworthy(IDLE), false);
});

test("connecting is not trusting", () => {
  assert.equal(isTrustworthy(connecting(IDLE)), false);
});

test("a connected cube is STILL not trusted", () => {
  // The whole point. Connection says the radio works, not that the app knows
  // which way up the cube is.
  const state = connected("GAN 356 i");
  assert.equal(state.status, "needs-calibration");
  assert.equal(isTrustworthy(state), false);
});

test("only the person confirming it makes moves trustworthy", () => {
  const state = calibrated(connected("GAN 356 i"));
  assert.equal(state.status, "live");
  assert.equal(isTrustworthy(state), true);
});

test("calibrating cannot be skipped from idle", () => {
  // Otherwise a caller could reach `live` without a cube ever being connected.
  assert.equal(calibrated(IDLE).status, "idle");
  assert.equal(isTrustworthy(calibrated(IDLE)), false);
});

test("calibrating clears anything turned beforehand", () => {
  let state = calibrated(connected("cube"));
  state = moved(moved(moved(state)));
  assert.equal(state.moveCount, 3);

  // Those turns happened against a state the app was guessing at.
  assert.equal(calibrated(state).moveCount, 0);
});

test("moves before calibration are not counted at all", () => {
  const state = moved(moved(connected("cube")));
  assert.equal(state.moveCount, 0);
});

test("losing the cube is distinct from never having one", () => {
  const state = lost(calibrated(connected("GAN 356 i")));
  assert.equal(state.status, "lost");
  assert.equal(isTrustworthy(state), false);
  assert.match(state.error ?? "", /disconnect/i);
  // The name is kept: "your GAN disconnected" beats "a cube disconnected".
  assert.equal(state.name, "GAN 356 i");
});

test("a cancelled picker is not an error", () => {
  // Somebody who changed their mind has not hit a problem, and telling them they
  // have is how an app teaches people to distrust its messages.
  const state = failed(IDLE, new Error("User cancelled the requestDevice() chooser."));
  assert.equal(state.error, null);
  assert.equal(state.status, "idle");
});

test("a real failure says what happened", () => {
  const state = failed(IDLE, new Error("Bluetooth adapter not available."));
  assert.match(state.error ?? "", /adapter/i);
});

test("a failure after connecting falls back to needing calibration, not to idle", () => {
  const state = failed(connected("cube"), new Error("something went wrong"));
  assert.equal(state.status, "needs-calibration");
});

test("the status line says what to do next", () => {
  assert.match(describeLink(connected("cube")), /solve your cube/i);
  assert.match(describeLink(calibrated(connected("cube"))), /turn your cube/i);
  assert.match(describeLink(moved(calibrated(connected("cube")))), /1 turn\b/);
  assert.match(describeLink(moved(moved(calibrated(connected("cube"))))), /2 turns/);
});

// ---------------------------------------------------------------------------
// The simulated cube
// ---------------------------------------------------------------------------

test("a simulated cube delivers moves like a real one", () => {
  const cube = simulatedCube();
  const seen: string[] = [];
  cube.onMove((move) => seen.push(move));

  cube.turn("R");
  cube.turn("U'");
  assert.deepEqual(seen, ["R", "U'"]);
});

test("unsubscribing stops delivery", () => {
  const cube = simulatedCube();
  const seen: string[] = [];
  const off = cube.onMove((move) => seen.push(move));
  cube.turn("R");
  off();
  cube.turn("U");
  assert.deepEqual(seen, ["R"]);
});

test("a dropped cube goes quiet", () => {
  // What a real cube does when it sleeps or leaves range: it stops, it does not
  // announce anything.
  const cube = simulatedCube();
  const seen: string[] = [];
  cube.onMove((move) => seen.push(move));
  cube.turn("R");
  cube.drop();
  cube.turn("U");
  assert.deepEqual(seen, ["R"]);
});

test("a simulated cube presents itself as a smart cube", () => {
  // It has to travel the same code path as hardware, or it tests a path nothing
  // else uses.
  const cube = simulatedCube("Test cube");
  assert.equal(cube.kind, "smartcube");
  assert.equal(cube.name, "Test cube");
});
