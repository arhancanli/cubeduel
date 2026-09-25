import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeMac, readRememberedMacs, rememberMac } from "./ganMac";

test("a MAC address is accepted however it was copied", () => {
  for (const typed of ["AB:12:CD:34:EF:56", "ab:12:cd:34:ef:56", "AB-12-CD-34-EF-56", "ab12cd34ef56", " AB:12:CD:34:EF:56 "]) {
    assert.equal(normalizeMac(typed), "AB:12:CD:34:EF:56", typed);
  }
});

test("anything that is not six bytes is refused rather than guessed", () => {
  for (const typed of ["", "AB:12:CD:34:EF", "AB:12:CD:34:EF:56:78", "GG:12:CD:34:EF:56", "hello", "AB:12:CD:34:EF:5"]) {
    assert.equal(normalizeMac(typed), null, typed);
  }
});

test("a cube's address is remembered by its name, so it is asked for once", () => {
  let stored = rememberMac(null, "GANi3_1234", "AB:12:CD:34:EF:56");
  stored = rememberMac(stored, "MG_5678", "11:22:33:44:55:66");
  assert.deepEqual(readRememberedMacs(stored), { GANi3_1234: "AB:12:CD:34:EF:56", MG_5678: "11:22:33:44:55:66" });
});

test("an unreadable store is an empty one", () => {
  assert.deepEqual(readRememberedMacs("{broken"), {});
  assert.deepEqual(readRememberedMacs(null), {});
  assert.deepEqual(readRememberedMacs(JSON.stringify({ a: "not a mac" })), {});
});
