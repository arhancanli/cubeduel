import { test } from "node:test";
import assert from "node:assert/strict";

import { isValidScramble, parseScrambleParam } from "./scrambleParam";

test("real scrambles are accepted", () => {
  assert.ok(isValidScramble("R U R' U'"));
  assert.ok(isValidScramble("F2 U2 B' L2 B' R2 F' U2 F2 R2 U2 F R' D' L F R B' F2 R2 D'"));
  assert.ok(isValidScramble("Rw U 3Fw' M' x y2 z'"));
});

test("anything that is not a move is rejected", () => {
  for (const bad of [
    "",
    "   ",
    "R U <script>",
    "R; DROP TABLE",
    "R U R' U' // comment",
    "Q W E",
    "R2222",
    "R'''",
  ]) {
    assert.equal(isValidScramble(bad), false, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("an absurdly long input is rejected rather than parsed", () => {
  assert.equal(isValidScramble("R ".repeat(400).trim()), false);
  // A case setup is long but legitimate.
  assert.ok(isValidScramble("R ".repeat(120).trim()));
});

test("the param is normalised and non-strings are ignored", () => {
  assert.equal(parseScrambleParam("  R   U    R'  "), "R U R'");
  assert.equal(parseScrambleParam(["R U"]), null);
  assert.equal(parseScrambleParam(undefined), null);
  assert.equal(parseScrambleParam("not a scramble"), null);
});
