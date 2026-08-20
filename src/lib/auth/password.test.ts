import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  checkPassword,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordOrBurn,
} from "./password";

test("a password verifies against its own hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
});

test("a different password does not", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password hashes differently every time", async () => {
  // If this fails the salt is not doing its job, and one precomputed table
  // attacks every row at once.
  const a = await hashPassword("the same password");
  const b = await hashPassword("the same password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("the same password", a), true);
  assert.equal(await verifyPassword("the same password", b), true);
});

test("the stored format names its algorithm and parameters", async () => {
  const hash = await hashPassword("whatever it is");
  const [algorithm, n, r, p] = hash.split("$");
  assert.equal(algorithm, "scrypt");
  assert.equal(Number(n), SCRYPT_N);
  assert.equal(Number(r), SCRYPT_R);
  assert.equal(Number(p), SCRYPT_P);
});

test("parameters are read back from the hash, not assumed", async () => {
  // A hash made at a lower cost must still verify, or raising the cost locks
  // out everybody who has not signed in since.
  // Built for real at the old parameters rather than hand-writing a digest.
  const { scrypt } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const derive = promisify(scrypt) as (
    pw: string,
    salt: Buffer,
    len: number,
    opts: { N: number; r: number; p: number; maxmem: number },
  ) => Promise<Buffer>;
  const salt = Buffer.from("saltysalty1234567");
  const key = await derive("old cost password", salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const stored = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

  assert.equal(await verifyPassword("old cost password", stored), true);
  assert.equal(await verifyPassword("wrong", stored), false);
  // And it is flagged for upgrade on the next successful sign-in.
  assert.equal(needsRehash(stored), true);
});

test("a hash at the current parameters is not flagged for rehash", async () => {
  assert.equal(needsRehash(await hashPassword("current parameters")), false);
});

test("malformed stored hashes fail rather than throw", async () => {
  // A corrupt column is an authentication failure, not a 500.
  for (const bad of [
    "",
    "garbage",
    "scrypt$",
    "scrypt$a$b$c$d$e",
    "scrypt$32768$8$3$onlyfiveparts",
    "bcrypt$32768$8$3$c2FsdA==$aGFzaA==",
    "scrypt$32768$8$3$$aGFzaA==",
    "scrypt$32768$8$3$c2FsdA==$",
    "scrypt$0$0$0$c2FsdA==$aGFzaA==",
  ]) {
    assert.equal(await verifyPassword("anything", bad), false, `should reject: ${bad}`);
  }
});

test("a null hash fails rather than throws", async () => {
  assert.equal(await verifyPassword("anything", null), false);
});

test("absurd cost parameters in a stored row are refused, not attempted", async () => {
  // Otherwise a value read out of the database is a denial of service against
  // ourselves: 128 * 2^30 * 8 asks for a terabyte.
  const stored = `scrypt$${2 ** 30}$8$1$c2FsdA==$aGFzaA==`;
  const started = performance.now();
  assert.equal(await verifyPassword("anything", stored), false);
  assert.ok(performance.now() - started < 1000, "should refuse immediately");
});

test("unicode passwords verify across normalisation forms", async () => {
  // "café" typed with a combining accent and with a precomposed é are the same
  // password to a person and different bytes to a computer. Without NFKC the
  // second one simply stops working, on some keyboards only.
  // Written as escapes, because the two forms are visually identical in a
  // source file and a test comparing two identical literals asserts nothing.
  const composed = "caf\u00e9 pa55word";      // é as one codepoint
  const decomposed = "cafe\u0301 pa55word";   // e + combining acute
  assert.notEqual(composed, decomposed, "the two forms must differ as bytes");

  const hash = await hashPassword(composed);
  assert.equal(await verifyPassword(decomposed, hash), true);
});

test("verifying against a missing hash still spends the work", async () => {
  // The property that stops account enumeration: "no such user" must not be
  // measurably faster than "wrong password". Asserted as a floor rather than a
  // comparison, because comparing two timings on a busy machine flakes.
  const started = performance.now();
  const result = await verifyPasswordOrBurn("anything at all", null);
  const elapsed = performance.now() - started;

  assert.equal(result, false);
  assert.ok(
    elapsed > 20,
    `expected the burn path to do real work, took ${elapsed.toFixed(1)}ms`,
  );
});

test("verifying against a real hash still works through the burn wrapper", async () => {
  const hash = await hashPassword("a real password here");
  assert.equal(await verifyPasswordOrBurn("a real password here", hash), true);
  assert.equal(await verifyPasswordOrBurn("not that password", hash), false);
});

test("passwords that are too short, too long, or too common are refused", () => {
  assert.equal(checkPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  assert.equal(checkPassword("a".repeat(MIN_PASSWORD_LENGTH)).ok, true);
  assert.equal(checkPassword("a".repeat(MAX_PASSWORD_LENGTH)).ok, true);
  assert.equal(checkPassword("a".repeat(MAX_PASSWORD_LENGTH + 1)).ok, false);

  assert.equal(checkPassword("password123").ok, false);
  assert.equal(checkPassword("PASSWORD123").ok, false, "the list is case-insensitive");
  assert.equal(checkPassword("speedcube").ok, false, "this being a cubing site matters");
  assert.equal(checkPassword("correct horse battery staple").ok, true);
});

test("no composition rules are imposed", () => {
  // Explicitly asserted because it is a deliberate decision that looks like an
  // omission, and someone will otherwise "fix" it.
  assert.equal(checkPassword("alllowercaseletters").ok, true);
  assert.equal(checkPassword("1234567890123456").ok, true);
});

test("a refusal explains itself", () => {
  const result = checkPassword("short");
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.reason.length > 10);
});
