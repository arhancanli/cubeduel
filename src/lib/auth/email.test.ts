import assert from "node:assert/strict";
import test from "node:test";

import { isPlausibleEmail, maskEmail, normaliseEmail } from "./email";

test("addresses are lowercased and trimmed", () => {
  assert.equal(normaliseEmail("  Someone@Example.COM  "), "someone@example.com");
  assert.equal(normaliseEmail("already@normal.com"), "already@normal.com");
});

test("normalisation is idempotent", () => {
  // The column carries `check (email = lower(email))`, so a value that changes
  // on a second pass would be a row Postgres rejects at insert time.
  const once = normaliseEmail("  MiXeD@Case.Org ");
  assert.equal(normaliseEmail(once), once);
});

test("plus tags are preserved", () => {
  // Deliberate restraint, asserted so nobody "fixes" it. Stripping tags is a
  // popular trick for stopping duplicate accounts and it breaks a feature
  // people rely on to filter their mail and to find out who sold their address.
  assert.equal(normaliseEmail("someone+cubing@example.com"), "someone+cubing@example.com");
});

test("dots in the local part are preserved", () => {
  // a.b@gmail.com and ab@gmail.com are the same mailbox at Google and different
  // mailboxes almost everywhere else. Collapsing them merges strangers.
  assert.equal(normaliseEmail("first.last@example.com"), "first.last@example.com");
});

test("plausible addresses are accepted", () => {
  for (const good of [
    "someone@example.com",
    "someone+tag@example.co.uk",
    "first.last@sub.domain.org",
    "a@b.co",
    "arhan@cubeduel.dev",
    "x_y-z@example-domain.com",
  ]) {
    assert.equal(isPlausibleEmail(good), true, `should accept: ${good}`);
  }
});

test("implausible addresses are refused", () => {
  for (const bad of [
    "",
    "a",
    "@example.com",
    "someone@",
    "someone",
    "someone@@example.com",
    "some one@example.com",
    "someone@example",
    "someone@.com",
    "someone@com.",
    "someone@ex..ample.com",
    "someone@-example.com",
    "someone@example.com-",
    "someone\t@example.com",
    "someone@exam ple.com",
  ]) {
    assert.equal(isPlausibleEmail(bad), false, `should refuse: ${bad}`);
  }
});

test("absurd lengths are refused", () => {
  assert.equal(isPlausibleEmail(`${"a".repeat(65)}@example.com`), false, "local part cap");
  assert.equal(isPlausibleEmail(`a@${"b".repeat(250)}.com`), false, "domain cap");
  assert.equal(isPlausibleEmail(`${"a".repeat(64)}@example.com`), true, "at the cap");
});

test("masking keeps enough to recognise and hides enough to matter", () => {
  const masked = maskEmail("somebody@example.com");
  assert.ok(masked.startsWith("so"), "keeps who");
  assert.ok(masked.endsWith("@example.com"), "keeps where");
  assert.ok(!masked.includes("somebody"), "hides the rest");
});

test("masking survives very short local parts", () => {
  // The obvious slice-based implementation produces a negative repeat count
  // here and throws, on the shortest addresses only.
  assert.doesNotThrow(() => maskEmail("a@b.co"));
  assert.doesNotThrow(() => maskEmail("ab@b.co"));
  assert.ok(maskEmail("a@b.co").endsWith("@b.co"));
});

test("masking leaves something that is not an address alone", () => {
  assert.equal(maskEmail("not-an-address"), "not-an-address");
});
