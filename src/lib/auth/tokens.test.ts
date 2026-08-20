import assert from "node:assert/strict";
import test from "node:test";

import {
  RESET_TOKEN_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE_INSECURE,
  SESSION_COOKIE_SECURE,
  SESSION_IDLE_MS,
  VERIFY_TOKEN_MS,
  bytesForPostgrest,
  bytesFromPostgrest,
  hashToken,
  hashTokenForPostgrest,
  newToken,
} from "./tokens";

test("a token carries 256 bits of randomness", () => {
  const token = newToken();
  assert.equal(Buffer.from(token, "base64url").length, 32);
});

test("tokens are url and cookie safe", () => {
  // base64url has no +, / or =, all of which need escaping in a URL or a
  // cookie. A token that survives one round of encoding but not two fails only
  // for the fraction of users whose random bytes happened to contain one, which
  // is the worst kind of bug to find in production.
  for (let i = 0; i < 500; i++) {
    assert.match(newToken(), /^[A-Za-z0-9_-]+$/);
  }
});

test("tokens do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(newToken());
  assert.equal(seen.size, 2000);
});

test("hashing is deterministic and one-way in shape", () => {
  const token = newToken();
  assert.deepEqual(hashToken(token), hashToken(token));
  assert.equal(hashToken(token).length, 32);
  assert.notEqual(hashToken(token).toString("hex"), Buffer.from(token).toString("hex"));
});

test("different tokens hash differently", () => {
  const a = newToken();
  const b = newToken();
  assert.notDeepEqual(hashToken(a), hashToken(b));
});

test("the postgrest encoding carries the bytea prefix", () => {
  // A missing `\x` does not error — it silently matches no rows, which surfaces
  // as "signed-in users are randomly signed out" rather than as a type error.
  const token = newToken();
  const encoded = hashTokenForPostgrest(token);
  assert.ok(encoded.startsWith("\\x"), "must carry the bytea prefix");
  assert.equal(encoded.slice(2), hashToken(token).toString("hex"));
  assert.equal(encoded.length, 2 + 64);
});

test("raw bytes round-trip through the postgrest encoding", () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
  const encoded = bytesForPostgrest(bytes);
  assert.equal(encoded, "\\x00017f80ff2a");
  assert.deepEqual(Uint8Array.from(bytesFromPostgrest(encoded)), bytes);
});

test("decoding tolerates a missing prefix", () => {
  assert.deepEqual(bytesFromPostgrest("00ff"), Buffer.from([0, 255]));
  assert.deepEqual(bytesFromPostgrest("\\x00ff"), Buffer.from([0, 255]));
});

test("an empty byte array encodes without losing the prefix", () => {
  assert.equal(bytesForPostgrest(new Uint8Array()), "\\x");
  assert.equal(bytesFromPostgrest("\\x").length, 0);
});

test("the idle window is shorter than the absolute one", () => {
  // If these ever cross, idle expiry becomes unreachable and sessions silently
  // live the full thirty days no matter how long they sit untouched.
  assert.ok(SESSION_IDLE_MS < SESSION_ABSOLUTE_MS);
});

test("reset links expire faster than verification links", () => {
  // Anyone holding a reset link owns the account; a verification link only
  // confirms an address. The more dangerous one gets the shorter life.
  assert.ok(RESET_TOKEN_MS < VERIFY_TOKEN_MS);
});

test("the secure cookie name carries the __Host- prefix", () => {
  // The prefix is a promise the browser enforces: it refuses the cookie unless
  // it is Secure, has no Domain, and is pathed at /. Losing the prefix loses
  // that guarantee silently.
  assert.ok(SESSION_COOKIE_SECURE.startsWith("__Host-"));
  assert.ok(!SESSION_COOKIE_INSECURE.startsWith("__Host-"));
});
