import assert from "node:assert/strict";
import { test } from "node:test";

import { mayHideOnStart } from "./reveal";

test("a block on the first screen is never hidden", () => {
  assert.equal(mayHideOnStart(0, 800), false);
  assert.equal(mayHideOnStart(799, 800), false);
});

test("a block starting below the first screen may fade in later", () => {
  assert.equal(mayHideOnStart(800, 800), true);
  assert.equal(mayHideOnStart(2400, 800), true);
});

test("a block above the screen (page restored mid-scroll) stays visible", () => {
  assert.equal(mayHideOnStart(-500, 800), false);
});
