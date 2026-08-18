import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { TOLERANCE_MS, verifySvixSignature } from "./webhookSignature";

const SECRET = `whsec_${Buffer.from("a-signing-secret-of-some-length").toString("base64")}`;
const NOW = 1_700_000_000_000;
const BODY = '{"type":"user.deleted","data":{"id":"user_123"}}';

function sign(body: string, id: string, timestamp: string, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

const headers = (over: Partial<{ id: string; timestamp: string; signature: string }> = {}) => {
  const id = over.id ?? "msg_1";
  const timestamp = over.timestamp ?? String(NOW / 1000);
  return {
    id,
    timestamp,
    signature: over.signature ?? sign(BODY, id, timestamp),
  };
};

test("a genuine signature passes", () => {
  assert.deepEqual(verifySvixSignature(BODY, headers(), SECRET, NOW), { ok: true });
});

test("a tampered body fails", () => {
  // The whole point: this endpoint deletes accounts, so a body that was not
  // signed must not be acted on.
  const tampered = BODY.replace("user_123", "user_456");
  const result = verifySvixSignature(tampered, headers(), SECRET, NOW);
  assert.equal(result.ok, false);
});

test("a signature from a different secret fails", () => {
  const other = `whsec_${Buffer.from("a-completely-different-secret!!").toString("base64")}`;
  const result = verifySvixSignature(BODY, headers({ signature: sign(BODY, "msg_1", String(NOW / 1000), other) }), SECRET, NOW);
  assert.equal(result.ok, false);
});

test("missing headers fail rather than throw", () => {
  for (const missing of ["id", "timestamp", "signature"] as const) {
    const h = { ...headers(), [missing]: null };
    const result = verifySvixSignature(BODY, h, SECRET, NOW);
    assert.equal(result.ok, false, missing);
    assert.match((result as { reason: string }).reason, /Missing signature headers/);
  }
});

test("an old request is refused", () => {
  // A signature stays valid forever, so without this a captured request could be
  // replayed indefinitely.
  const old = String((NOW - TOLERANCE_MS - 1000) / 1000);
  const result = verifySvixSignature(BODY, headers({ timestamp: old }), SECRET, NOW);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /Timestamp/);
});

test("a request from the future is refused too", () => {
  const ahead = String((NOW + TOLERANCE_MS + 1000) / 1000);
  const result = verifySvixSignature(BODY, headers({ timestamp: ahead }), SECRET, NOW);
  assert.equal(result.ok, false);
});

test("the tolerance boundary is inclusive", () => {
  const edge = String((NOW - TOLERANCE_MS) / 1000);
  assert.equal(verifySvixSignature(BODY, headers({ timestamp: edge }), SECRET, NOW).ok, true);
});

test("a malformed timestamp is refused", () => {
  const result = verifySvixSignature(BODY, headers({ timestamp: "not-a-number" }), SECRET, NOW);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /Malformed timestamp/);
});

test("several signatures are accepted, as during a secret rotation", () => {
  const ts = String(NOW / 1000);
  const wrong = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const good = sign(BODY, "msg_1", ts);
  assert.equal(
    verifySvixSignature(BODY, headers({ timestamp: ts, signature: `${wrong} ${good}` }), SECRET, NOW).ok,
    true,
  );
});

test("an unknown signature version is ignored, not trusted", () => {
  const ts = String(NOW / 1000);
  const value = sign(BODY, "msg_1", ts).split(",")[1];
  const result = verifySvixSignature(BODY, headers({ timestamp: ts, signature: `v2,${value}` }), SECRET, NOW);
  assert.equal(result.ok, false);
});

test("an empty signing secret cannot accidentally verify", () => {
  // A missing environment variable must never become a permanently open door.
  const result = verifySvixSignature(BODY, headers(), "whsec_", NOW);
  assert.equal(result.ok, false);
});

test("a signature of the wrong length fails without throwing", () => {
  // `timingSafeEqual` throws on mismatched lengths, and an exception here would
  // be a 500 rather than a clean rejection.
  const result = verifySvixSignature(BODY, headers({ signature: "v1,short" }), SECRET, NOW);
  assert.equal(result.ok, false);
});
