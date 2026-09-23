import assert from "node:assert/strict";
import { test } from "node:test";

import { Color } from "three";

import { paint } from "./applyCubeAppearance";

/**
 * cubing.js's renderer shows a material's stored colour on screen as it is, with
 * no conversion back from linear light. Three.js, handed a hex string, converts
 * it INTO linear light on the way in. Together they darkened every sticker:
 * Rubik's red #B71234 was drawn as #780104 and blue #0046AD as #00106B, so red
 * and orange looked alike. The colour must be stored as written.
 */
test("a sticker colour is stored exactly as written, not converted to linear light", () => {
  const c = new Color();
  paint(c, "#B71234");
  assert.equal(Math.round(c.r * 255), 0xb7);
  assert.equal(Math.round(c.g * 255), 0x12);
  assert.equal(Math.round(c.b * 255), 0x34);
});

test("the Rubik's blue keeps its green component — the one the conversion crushed", () => {
  const c = new Color();
  paint(c, "#0046AD");
  assert.ok(Math.abs(c.g / c.b - 0x46 / 0xad) < 0.01, `${c.g / c.b}`);
});

test("a colour object without setStyle is still painted, the plain way", () => {
  let got = "";
  paint({ set: (v: string) => void (got = v) }, "#FF5800");
  assert.equal(got, "#FF5800");
});
