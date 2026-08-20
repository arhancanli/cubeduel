import assert from "node:assert/strict";
import test from "node:test";

import {
  FLAG_ATTESTED_CREDENTIAL_DATA,
  FLAG_BACKED_UP,
  FLAG_BACKUP_ELIGIBLE,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  TestAuthenticator,
  testChallenge,
} from "./testAuthenticator";
import {
  WebAuthnError,
  parseAuthenticatorData,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn";

/**
 * Every test here drives a real software authenticator holding a real P-256 key
 * and producing real signatures. See `testAuthenticator.ts` for why that matters
 * more than the number of assertions.
 */

const RP_ID = "cubeduel.test";
const ORIGIN = `https://${RP_ID}`;

const expectations = (challenge: string, overrides: Partial<{
  origin: string;
  rpId: string;
  requireUserVerification: boolean;
}> = {}) => ({
  challenge,
  origin: overrides.origin ?? ORIGIN,
  rpId: overrides.rpId ?? RP_ID,
  requireUserVerification: overrides.requireUserVerification ?? false,
});

// ---------------------------------------------------------------------------
// The happy paths, first — a check that only ever rejects is not a check.
// ---------------------------------------------------------------------------

test("a genuine registration is accepted", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const challenge = testChallenge();

  const result = verifyRegistration({
    ...authenticator.register(challenge),
    expected: expectations(challenge),
  });

  assert.deepEqual(result.credentialId, authenticator.credentialId);
  assert.deepEqual(result.publicKey, authenticator.cosePublicKey());
  assert.equal(result.algorithm, -7, "ES256");
  assert.equal(result.backedUp, true);
});

test("a fresh credential starts with the counter the authenticator reported", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const challenge = testChallenge();
  const result = verifyRegistration({
    ...authenticator.register(challenge),
    expected: expectations(challenge),
  });

  assert.equal(result.signCount, 0);
  assert.equal(result.transports.length, 0, "none were reported");
  assert.equal(result.aaguid?.length, 16);
});

test("registration then sign-in works end to end", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });

  const registrationChallenge = testChallenge();
  const credential = verifyRegistration({
    ...authenticator.register(registrationChallenge),
    expected: expectations(registrationChallenge),
  });

  const signInChallenge = testChallenge();
  const result = verifyAuthentication({
    ...authenticator.authenticate(signInChallenge),
    storedPublicKey: credential.publicKey,
    storedSignCount: credential.signCount,
    expected: expectations(signInChallenge),
  });

  assert.equal(result.clonedWarning, false);
  assert.equal(result.userVerified, true);
  assert.ok(result.signCount > 0);
});

// ---------------------------------------------------------------------------
// Rejections. Each one is a property somebody could otherwise exploit.
// ---------------------------------------------------------------------------

test("a signature over a different challenge is refused", () => {
  // The single most important check in the file: without it, one captured
  // assertion signs in forever.
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);

  const response = authenticator.authenticate(testChallenge());
  assert.throws(
    () =>
      verifyAuthentication({
        ...response,
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(testChallenge()), // a *different* challenge
      }),
    /challenge does not match/,
  );
});

test("an assertion from another origin is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, { origin: "https://evil.example" }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /is not https:\/\/cubeduel\.test/,
  );
});

test("an origin that merely starts with ours is refused", () => {
  // The `startsWith` reflex is a real vulnerability, so it gets its own test.
  // "https://cubeduel.test.attacker.com" begins with the expected origin.
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, {
          origin: `${ORIGIN}.attacker.com`,
        }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /is not/,
  );
});

test("a credential registered to another site is refused", () => {
  // The rp id hash is what stops a passkey made for someone else's domain being
  // presented here.
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, { rpId: "someone-else.test" }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /belongs to a different site/,
  );
});

test("a registration response replayed as a sign-in is refused", () => {
  // The two ceremonies sign structurally similar things; the type field is what
  // keeps them apart.
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, { type: "webauthn.create" }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /expected a webauthn\.get ceremony/,
  );
});

test("a sign-in response replayed as a registration is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyRegistration({
        ...authenticator.register(challenge, { type: "webauthn.get" }),
        expected: expectations(challenge),
      }),
    /expected a webauthn\.create ceremony/,
  );
});

test("a signature that does not verify is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, { corruptSignature: true }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /does not verify/,
  );
});

test("an assertion signed by a different key is refused", () => {
  // Proves the stored public key is actually consulted, rather than the
  // signature being checked against whatever produced it.
  const mine = new TestAuthenticator({ rpId: RP_ID });
  const theirs = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(mine);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...theirs.authenticate(challenge),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /does not verify/,
  );
});

test("an assertion with no user present is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, { flags: 0 }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /did not report a user present/,
  );
});

test("user verification is enforced only when asked for", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);

  const lenient = testChallenge();
  assert.doesNotThrow(() =>
    verifyAuthentication({
      ...authenticator.authenticate(lenient, { flags: FLAG_USER_PRESENT }),
      storedPublicKey: credential.publicKey,
      storedSignCount: 0,
      expected: expectations(lenient, { requireUserVerification: false }),
    }),
  );

  const strict = testChallenge();
  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(strict, { flags: FLAG_USER_PRESENT }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(strict, { requireUserVerification: true }),
      }),
    /requires the authenticator to verify you/,
  );
});

test("a cross-origin ceremony is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyAuthentication({
        ...authenticator.authenticate(challenge, { crossOrigin: true }),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /cross-origin/,
  );
});

// ---------------------------------------------------------------------------
// The signature counter.
// ---------------------------------------------------------------------------

test("a counter that goes backwards is flagged, not thrown", () => {
  // Reported rather than fatal, because the right response is a product
  // decision made where the credential is stored.
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  const result = verifyAuthentication({
    ...authenticator.authenticate(challenge, { signCount: 5 }),
    storedPublicKey: credential.publicKey,
    storedSignCount: 99,
    expected: expectations(challenge),
  });

  assert.equal(result.clonedWarning, true);
  assert.equal(result.signCount, 99, "the counter never moves backwards in storage");
});

test("an authenticator that keeps no counter is not treated as cloned", () => {
  // Every synced passkey — iCloud Keychain, Windows Hello, Google Password
  // Manager — always reports zero. Treating that as a clone locks out the
  // majority of real users, which is why the check requires both sides non-zero.
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);

  for (let i = 0; i < 3; i++) {
    const challenge = testChallenge();
    const result = verifyAuthentication({
      ...authenticator.authenticate(challenge, { signCount: 0 }),
      storedPublicKey: credential.publicKey,
      storedSignCount: 0,
      expected: expectations(challenge),
    });
    assert.equal(result.clonedWarning, false, `sign-in ${i + 1} must not be flagged`);
  }
});

test("a counter moving forward is fine", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();

  const result = verifyAuthentication({
    ...authenticator.authenticate(challenge, { signCount: 100 }),
    storedPublicKey: credential.publicKey,
    storedSignCount: 99,
    expected: expectations(challenge),
  });

  assert.equal(result.clonedWarning, false);
  assert.equal(result.signCount, 100);
});

// ---------------------------------------------------------------------------
// Parsing, including the malformed input a hostile client will actually send.
// ---------------------------------------------------------------------------

test("authenticator data shorter than its fixed header is refused", () => {
  for (const length of [0, 1, 32, 36]) {
    assert.throws(
      () => parseAuthenticatorData(new Uint8Array(length)),
      WebAuthnError,
      `should refuse ${length} bytes`,
    );
  }
  assert.doesNotThrow(() => parseAuthenticatorData(new Uint8Array(37)));
});

test("flags are decoded from the right bit positions", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const data = parseAuthenticatorData(
    authenticator.authenticatorData({
      flags: FLAG_USER_PRESENT | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP,
    }),
  );

  assert.equal(data.flags.userPresent, true);
  assert.equal(data.flags.userVerified, false);
  assert.equal(data.flags.backupEligible, true);
  assert.equal(data.flags.backedUp, true);
  assert.equal(data.flags.attestedCredentialData, false);
});

test("a truncated credential id is refused rather than read past the end", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const full = authenticator.authenticatorData({
    flags: FLAG_USER_PRESENT | FLAG_ATTESTED_CREDENTIAL_DATA,
    includeCredential: true,
  });

  assert.throws(() => parseAuthenticatorData(full.slice(0, 60)), WebAuthnError);
  assert.throws(() => parseAuthenticatorData(full.slice(0, 54)), WebAuthnError);
});

test("a credential id claiming an absurd length is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const data = authenticator.authenticatorData({
    flags: FLAG_USER_PRESENT | FLAG_ATTESTED_CREDENTIAL_DATA,
    includeCredential: true,
  });
  // Overwrite the two-byte credential id length with 0xffff.
  data[53] = 0xff;
  data[54] = 0xff;

  assert.throws(() => parseAuthenticatorData(data), /over the 1023 limit/);
});

test("registration without attested credential data is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const challenge = testChallenge();

  assert.throws(
    () =>
      verifyRegistration({
        ...authenticator.register(challenge, {
          flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
        }),
        expected: expectations(challenge),
      }),
    /no credential to register/,
  );
});

test("client data that is not JSON is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();
  const response = authenticator.authenticate(challenge);

  assert.throws(
    () =>
      verifyAuthentication({
        ...response,
        clientDataJSON: Uint8Array.from(Buffer.from("not json at all")),
        storedPublicKey: credential.publicKey,
        storedSignCount: 0,
        expected: expectations(challenge),
      }),
    /not valid JSON/,
  );
});

test("client data missing required fields is refused", () => {
  const authenticator = new TestAuthenticator({ rpId: RP_ID });
  const credential = registerFor(authenticator);
  const challenge = testChallenge();
  const response = authenticator.authenticate(challenge);

  for (const body of ['{"type":"webauthn.get"}', '{"challenge":"x","origin":"y"}', "null", "[]"]) {
    assert.throws(
      () =>
        verifyAuthentication({
          ...response,
          clientDataJSON: Uint8Array.from(Buffer.from(body)),
          storedPublicKey: credential.publicKey,
          storedSignCount: 0,
          expected: expectations(challenge),
        }),
      WebAuthnError,
      `should refuse: ${body}`,
    );
  }
});

// ---------------------------------------------------------------------------

function registerFor(authenticator: TestAuthenticator) {
  const challenge = testChallenge();
  return verifyRegistration({
    ...authenticator.register(challenge),
    expected: expectations(challenge),
  });
}
