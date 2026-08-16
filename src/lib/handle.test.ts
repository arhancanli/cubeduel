import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_HANDLE_LENGTH,
  fallbackHandle,
  handleCandidates,
  handleRejectionReason,
  isValidHandle,
  sanitizeHandle,
} from "./handle";

test("ordinary handles are accepted", () => {
  for (const handle of ["alex", "sub-15", "jperm_2", "a1b", "x".repeat(24)]) {
    assert.equal(isValidHandle(handle), true, handle);
  }
});

test("handles that would break a URL or a layout are refused", () => {
  const bad = [
    "ab", // too short
    "x".repeat(25), // too long
    "-alex", // leading separator
    "alex-", // trailing separator
    "Alex", // uppercase would make /u/Alex and /u/alex different people
    "al ex",
    "al/ex",
    "al.ex",
    "ålex",
    "",
  ];
  for (const handle of bad) {
    assert.equal(isValidHandle(handle), false, handle);
  }
});

test("names that could be used to impersonate the site are reserved", () => {
  // An account called "support" can ask other players for things and nothing in
  // the UI would contradict it.
  for (const handle of ["admin", "support", "staff", "cubeduel", "official"]) {
    assert.equal(isValidHandle(handle), false, handle);
  }
});

test("route names cannot be taken as handles", () => {
  for (const handle of ["timer", "daily", "play", "leaderboard", "settings"]) {
    assert.equal(isValidHandle(handle), false, handle);
  }
});

test("every rejection can be explained to the player", () => {
  // A form that says "invalid" and nothing else is a form people abandon.
  const bad = ["ab", "x".repeat(25), "Alex", "al ex", "-alex", "alex-", "admin"];
  for (const handle of bad) {
    const reason = handleRejectionReason(handle);
    assert.ok(reason, `no reason given for ${handle}`);
    assert.ok(reason!.length > 10, `unhelpful reason for ${handle}: ${reason}`);
  }
  assert.equal(handleRejectionReason("alex"), null);
});

test("sanitizing produces something legal or nothing at all", () => {
  const cases: [string, string | null][] = [
    ["Alex Cubes", "alex-cubes"],
    ["  spaced  out  ", "spaced-out"],
    ["j-perm", "j-perm"],
    ["!!!", null],
    ["a", null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(sanitizeHandle(input), expected, input);
  }
});

test("sanitizing keeps accented letters as letters", () => {
  // Dropping them turns "Ünal" into "nal", which is a worse name than "unal"
  // and looks like a bug to the person it belongs to.
  assert.equal(sanitizeHandle("Ünal"), "unal");
  assert.equal(sanitizeHandle("José García"), "jose-garcia");
});

test("anything sanitizing returns is actually valid", () => {
  // The property that matters: sanitize must never hand back a name the
  // database will then reject.
  const inputs = [
    "Alex Cubes",
    "----hello----",
    "x".repeat(80),
    "a_b_c",
    "9lives",
    "__leading",
    "trailing__",
    "Ünal Çelik",
    "🎲🎲🎲 cuber 🎲🎲🎲",
    "a".repeat(23) + " b",
  ];
  for (const input of inputs) {
    const handle = sanitizeHandle(input);
    if (handle !== null) {
      assert.equal(isValidHandle(handle), true, `${input} -> ${handle}`);
      assert.ok(handle.length <= MAX_HANDLE_LENGTH, `${handle} is too long`);
    }
  }
});

test("candidate handles are all valid and all distinct", () => {
  const candidates = handleCandidates("alex");
  assert.equal(new Set(candidates).size, candidates.length, "duplicates offered");
  assert.equal(candidates[0], "alex", "the requested name must be tried first");
  for (const candidate of candidates) {
    assert.equal(isValidHandle(candidate), true, candidate);
  }
});

test("candidates stay legal even from a maximum-length base", () => {
  // Naively appending "-2" to a 24-character handle produces an illegal 26.
  const base = "a".repeat(MAX_HANDLE_LENGTH);
  for (const candidate of handleCandidates(base).slice(1)) {
    assert.ok(candidate.length <= MAX_HANDLE_LENGTH, candidate);
    assert.equal(isValidHandle(candidate), true, candidate);
  }
});

test("candidate generation terminates on a hostile base", () => {
  // A base that can never form a legal suffixed handle must not spin forever.
  const candidates = handleCandidates("-");
  assert.ok(Array.isArray(candidates));
});

test("the fallback handle is always valid and readable", () => {
  for (const seed of ["user_2abcDEF123", "", "!!!", "x"]) {
    const handle = fallbackHandle(seed);
    assert.equal(isValidHandle(handle), true, `${seed} -> ${handle}`);
  }
});
