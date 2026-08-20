import assert from "node:assert/strict";
import test from "node:test";

import { deriveRelyingParty } from "./relyingParty";

/**
 * The id and the origin are different strings, and swapping them produces
 * credentials that nothing can verify — on real hardware only, which means the
 * test suite is the last chance to catch it.
 */

test("production: the id is the bare domain, the origin carries the scheme", () => {
  const rp = deriveRelyingParty("https://cubeduel.vercel.app");
  assert.equal(rp.id, "cubeduel.vercel.app");
  assert.equal(rp.origin, "https://cubeduel.vercel.app");
  assert.equal(rp.usable, true);
});

test("the id never carries a scheme", () => {
  // The single most damaging way to get this wrong.
  for (const url of ["https://cubeduel.vercel.app", "http://localhost:3000"]) {
    const rp = deriveRelyingParty(url);
    assert.ok(!rp.id.includes("://"), `id should be bare, got ${rp.id}`);
    assert.ok(!rp.id.startsWith("http"), `id should be bare, got ${rp.id}`);
  }
});

test("the id never carries a port, but the origin does", () => {
  // `localhost:3000` is not a valid relying party id; `localhost` is. Getting
  // this wrong breaks passkeys in development only, which is the version of the
  // bug most likely to be dismissed as "works in production".
  const rp = deriveRelyingParty("http://localhost:3000");
  assert.equal(rp.id, "localhost");
  assert.equal(rp.origin, "http://localhost:3000");
});

test("a trailing slash does not leak into the origin", () => {
  // The comparison downstream is an equality check against what the browser
  // sends, and a browser never sends a trailing slash. Without normalising,
  // every passkey fails with a complaint about an origin that is correct.
  const withSlash = deriveRelyingParty("https://cubeduel.vercel.app/");
  const without = deriveRelyingParty("https://cubeduel.vercel.app");
  assert.equal(withSlash.origin, without.origin);
  assert.equal(withSlash.origin, "https://cubeduel.vercel.app");
});

test("a path in the site url does not leak into either value", () => {
  const rp = deriveRelyingParty("https://cubeduel.vercel.app/some/path?x=1#y");
  assert.equal(rp.id, "cubeduel.vercel.app");
  assert.equal(rp.origin, "https://cubeduel.vercel.app");
});

test("the default https port is not repeated in the origin", () => {
  // A browser reports "https://example.com", never "https://example.com:443".
  assert.equal(deriveRelyingParty("https://example.com:443").origin, "https://example.com");
  assert.equal(deriveRelyingParty("http://example.com:80").origin, "http://example.com");
});

test("a non-default port is kept in the origin", () => {
  const rp = deriveRelyingParty("https://example.com:8443");
  assert.equal(rp.origin, "https://example.com:8443");
  assert.equal(rp.id, "example.com");
});

test("subdomains stay distinct", () => {
  // A passkey registered for a preview deployment must not be presentable at
  // production, and the id is what enforces that.
  assert.notEqual(
    deriveRelyingParty("https://preview.cubeduel.vercel.app").id,
    deriveRelyingParty("https://cubeduel.vercel.app").id,
  );
});

test("localhost is usable over plain http, other hosts are not", () => {
  // Browsers make exactly this exception so that WebAuthn is developable.
  assert.equal(deriveRelyingParty("http://localhost:3000").usable, true);
  assert.equal(deriveRelyingParty("http://127.0.0.1:3000").usable, true);
  assert.equal(deriveRelyingParty("http://192.168.1.50:3000").usable, false);
  assert.equal(deriveRelyingParty("http://cubeduel.test").usable, false);
  assert.equal(deriveRelyingParty("https://cubeduel.test").usable, true);
});

test("a malformed site url fails loudly rather than defaulting", () => {
  // Defaulting here would issue credentials bound to a domain nobody meant.
  for (const bad of ["", "not a url", "cubeduel.vercel.app", "//cubeduel.vercel.app"]) {
    assert.throws(() => deriveRelyingParty(bad), /not a valid URL/, `should refuse: ${bad}`);
  }
});

test("non-http schemes are refused", () => {
  for (const bad of ["ftp://cubeduel.test", "file:///tmp/x", "javascript:alert(1)"]) {
    assert.throws(() => deriveRelyingParty(bad), /must be http or https/, `should refuse: ${bad}`);
  }
});
