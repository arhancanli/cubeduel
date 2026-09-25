import assert from "node:assert/strict";
import { test } from "node:test";

import { engineComparison } from "./engineCompare";

test("your turns are set against the engine's, as a plain ratio", () => {
  assert.equal(engineComparison(19, 57), "You used 57 turns — 3.0 times the engine's 19.");
  assert.equal(engineComparison(20, 45), "You used 45 turns — 2.3 times the engine's 20.");
});

test("a solve as short as the engine's is said so, not as '1.0 times'", () => {
  assert.equal(engineComparison(19, 19), "You matched the engine: 19 turns.");
  assert.equal(engineComparison(19, 17), "You beat the engine's route: 17 turns to its 19.");
});

test("with no turns recorded — a solve timed on a real cube — there is nothing to compare", () => {
  assert.equal(engineComparison(19, null), null);
});
