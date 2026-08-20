import assert from "node:assert/strict";
import test from "node:test";

import { decodeCbor, decodeCborPrefix, type CborValue } from "./cbor";

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const decode = (s: string) => decodeCbor(hex(s));

/**
 * The vectors below are from RFC 8949 Appendix A — the specification's own
 * examples, transcribed rather than invented.
 *
 * That matters more than the count. A decoder tested only against output from
 * itself, or from the same author's encoder, agrees with itself perfectly and
 * can still be wrong about the format; the only test that means anything is one
 * against bytes somebody else says are correct.
 */

test("unsigned integers, including every argument width", () => {
  assert.equal(decode("00"), 0);
  assert.equal(decode("01"), 1);
  assert.equal(decode("0a"), 10);
  assert.equal(decode("17"), 23, "the largest value packed into the initial byte");
  assert.equal(decode("1818"), 24, "the first that needs a following byte");
  assert.equal(decode("1819"), 25);
  assert.equal(decode("1864"), 100);
  assert.equal(decode("1903e8"), 1000, "two-byte argument");
  assert.equal(decode("1a000f4240"), 1000000, "four-byte argument");
  assert.equal(decode("1b000000e8d4a51000"), 1000000000000, "eight-byte argument");
});

test("negative integers", () => {
  assert.equal(decode("20"), -1);
  assert.equal(decode("29"), -10);
  assert.equal(decode("3863"), -100);
  assert.equal(decode("3903e7"), -1000);
});

test("integers beyond safe range arrive as bigint, not rounded", () => {
  // 2^64 - 1. Returning a number here would silently round, and a rounded map
  // key is quietly not the key that was sent.
  const value = decode("1bffffffffffffffff");
  assert.equal(typeof value, "bigint");
  assert.equal(value, BigInt("18446744073709551615"));
});

test("byte strings", () => {
  assert.deepEqual(decode("40"), new Uint8Array());
  assert.deepEqual(decode("4401020304"), Uint8Array.from([1, 2, 3, 4]));
});

test("text strings", () => {
  assert.equal(decode("60"), "");
  assert.equal(decode("6161"), "a");
  assert.equal(decode("6449455446"), "IETF");
  assert.equal(decode("62225c"), '"\\');
  assert.equal(decode("62c3bc"), "ü");
  assert.equal(decode("63e6b0b4"), "水");
});

test("arrays, including nested ones", () => {
  assert.deepEqual(decode("80"), []);
  assert.deepEqual(decode("83010203"), [1, 2, 3]);
  assert.deepEqual(decode("8301820203820405"), [1, [2, 3], [4, 5]]);
});

test("maps, including nested and mixed values", () => {
  assert.deepEqual(decode("a0"), new Map());
  assert.deepEqual(decode("a201020304"), new Map<CborValue, CborValue>([[1, 2], [3, 4]]));
  assert.deepEqual(
    decode("a26161016162820203"),
    new Map<CborValue, CborValue>([["a", 1], ["b", [2, 3]]]),
  );
  assert.deepEqual(decode("826161a161626163"), ["a", new Map([["b", "c"]])]);
});

test("negative integer keys stay integers", () => {
  // The reason maps decode to Map and not to a plain object. A COSE key is
  // keyed by -1 (curve), -2 (x) and -3 (y); an object turns those into the
  // strings "-1", "-2", "-3" and loses the distinction from real text keys.
  const map = decode("a220012142ff00");
  assert.ok(map instanceof Map);
  assert.equal((map as Map<unknown, unknown>).has(-1), true, "integer key -1");
  assert.equal((map as Map<unknown, unknown>).has("-1"), false, "not the string");
});

test("simple values", () => {
  assert.equal(decode("f4"), false);
  assert.equal(decode("f5"), true);
  assert.equal(decode("f6"), null);
  assert.equal(decode("f7"), undefined);
});

test("indefinite-length items are refused, not skipped", () => {
  // A decoder that quietly ignores what it does not understand is how a byte
  // string gets read as something else.
  for (const encoded of ["5f42010243030405ff", "7f61616161ff", "9fff", "bfff"]) {
    assert.throws(() => decode(encoded), /indefinite/, `should refuse ${encoded}`);
  }
});

test("tags are refused", () => {
  assert.throws(() => decode("c074323031332d30332d32315432303a30343a30305a"), /major type 6/);
});

test("floats are refused", () => {
  for (const encoded of ["f90000", "fa47c35000", "fb3ff199999999999a"]) {
    assert.throws(() => decode(encoded), /simple value or float/, `should refuse ${encoded}`);
  }
});

test("reserved argument encodings are refused", () => {
  for (const encoded of ["1c", "1d", "1e"]) {
    assert.throws(() => decode(encoded), /reserved/, `should refuse ${encoded}`);
  }
});

test("truncated input throws rather than returning a partial value", () => {
  for (const encoded of ["", "18", "1903", "4401", "8301", "a201", "6161616161"]) {
    assert.throws(() => decode(encoded), /truncated|CBOR/, `should refuse ${encoded}`);
  }
});

test("trailing bytes are an error", () => {
  // Tolerating a tail is how two implementations end up disagreeing about what
  // they just verified.
  assert.throws(() => decode("0000"), /trailing/);
  assert.throws(() => decode("83010203ff"), /trailing/);
});

test("duplicate map keys are refused", () => {
  // Whichever one a decoder picks, an attacker picks the other. A map carrying
  // two -2 entries shows one public key to the validator and another to
  // whatever consumes the result.
  assert.throws(() => decode("a201020103"), /duplicate/);
  assert.throws(() => decode("a2216141216142"), /duplicate/);
});

test("non-integer, non-string map keys are refused", () => {
  assert.throws(() => decode("a18001"), /map keys/);
});

test("an absurd declared length is refused before it is allocated", () => {
  // Four bytes of header asking for four gigabytes. Without the bound this is
  // an out-of-memory crash written in five bytes.
  assert.throws(() => decode("5affffffff"), /limit/);
  assert.throws(() => decode("7affffffff"), /limit/);
  // And an array header claiming more items than could possibly follow fails on
  // truncation rather than by pre-allocating.
  assert.throws(() => decode("9affffffff"), /limit/);
});

test("deep nesting is refused rather than overflowing the stack", () => {
  // 9f is indefinite; 81 is a one-item array. Twenty of them nests twenty deep.
  const nested = "81".repeat(20) + "00";
  assert.throws(() => decode(nested), /nested deeper/);
  // And just inside the limit still works.
  assert.doesNotThrow(() => decode("81".repeat(15) + "00"));
});

test("invalid UTF-8 in a text string throws", () => {
  // Replacement characters would mean a string that silently changed — and a
  // string that changed no longer matches what was signed.
  assert.throws(() => decode("62ff00"));
});

test("byte strings are copied, not aliased into the input buffer", () => {
  // A subarray shares the caller's memory, so anything that later reuses that
  // buffer mutates a public key that has already been read. Only shows up under
  // load, which is the worst time to find it.
  const input = hex("4401020304");
  const value = decode("4401020304") as Uint8Array;
  input.fill(0xff);
  assert.deepEqual(value, Uint8Array.from([1, 2, 3, 4]));
});

test("the prefix decoder reports where the item ended", () => {
  // This is what finds the end of a COSE key inside attested credential data,
  // where nothing states the key's length.
  const { value, bytesRead } = decodeCborPrefix(hex("a201020304" + "deadbeef"));
  assert.deepEqual(value, new Map<CborValue, CborValue>([[1, 2], [3, 4]]));
  assert.equal(bytesRead, 5);
});

test("the prefix decoder still refuses malformed items", () => {
  assert.throws(() => decodeCborPrefix(hex("a2010203")), /truncated/);
});
