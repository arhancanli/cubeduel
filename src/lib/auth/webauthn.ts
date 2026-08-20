import { createHash, timingSafeEqual } from "node:crypto";

import { asBytes, asCborMap, decodeCbor, decodeCborPrefix } from "./cbor";
import { parseCosePublicKey, verifyCoseSignature, type SupportedAlgorithm } from "./cose";

/**
 * The two WebAuthn ceremonies: registering a passkey, and signing in with one.
 *
 * This module is pure. It is handed bytes and the things it should expect, and
 * it answers whether they agree — no database, no cookies, no network. That is
 * what makes the interesting cases testable: every check below can be made to
 * fail on purpose from a unit test, which is the only way to know a check works.
 * Storing credentials and issuing challenges is `server/passkeys.ts`'s job.
 *
 * ## What is verified, and what is deliberately not
 *
 * Verified: that the client signed the challenge this server issued, for this
 * origin, for this relying party, with the key registered to this account, and
 * that the person was present at the authenticator.
 *
 * **Not** verified: the attestation statement — the authenticator's claim about
 * what make and model of hardware it is. Checking that means shipping and
 * maintaining a set of vendor root certificates, and what it buys is the ability
 * to say "only these approved devices". An enterprise wants that. A cubing
 * ladder does not: it would mean refusing somebody's perfectly good phone
 * because its manufacturer is not on a list, in exchange for a guarantee that
 * matters only if the threat model includes counterfeit authenticators.
 *
 * So registration requests `attestation: "none"` and this code ignores the
 * statement. It is written down here rather than left as a silence, because
 * "we verify the attestation object" and "we verify attestation" sound alike and
 * are very different claims.
 */

export class WebAuthnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnError";
  }
}

/** Flags packed into byte 32 of authenticator data. */
export interface AuthenticatorFlags {
  /** User present — somebody physically touched the authenticator. */
  userPresent: boolean;
  /** User verified — a PIN, fingerprint or face, not just a touch. */
  userVerified: boolean;
  /** The credential is eligible to be backed up (synced between devices). */
  backupEligible: boolean;
  /** The credential currently is backed up. */
  backedUp: boolean;
  /** Attested credential data follows — present at registration only. */
  attestedCredentialData: boolean;
  /** Extension output follows. */
  extensionData: boolean;
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: AuthenticatorFlags;
  signCount: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  credentialPublicKey?: Uint8Array;
}

/**
 * Splits authenticator data into its fixed-layout pieces.
 *
 * The layout is 32 bytes of RP ID hash, one byte of flags, four bytes of signature
 * counter, and then optionally attested credential data and extensions. It is
 * not self-describing, so every length below is checked before it is used —
 * a truncated buffer must be an error, not a read past the end that returns
 * whatever happened to be in memory.
 */
export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37) {
    throw new WebAuthnError(`authenticator data is ${bytes.length} bytes, needs at least 37`);
  }

  const rpIdHash = bytes.slice(0, 32);
  const flagBits = bytes[32];
  const view = new DataView(bytes.buffer, bytes.byteOffset + 33, 4);
  const signCount = view.getUint32(0, false);

  const flags: AuthenticatorFlags = {
    userPresent: (flagBits & 0x01) !== 0,
    userVerified: (flagBits & 0x04) !== 0,
    backupEligible: (flagBits & 0x08) !== 0,
    backedUp: (flagBits & 0x10) !== 0,
    attestedCredentialData: (flagBits & 0x40) !== 0,
    extensionData: (flagBits & 0x80) !== 0,
  };

  const result: AuthenticatorData = { rpIdHash, flags, signCount };
  if (!flags.attestedCredentialData) return result;

  // Attested credential data: 16 bytes of AAGUID, a two-byte big-endian
  // credential id length, the id, then the COSE public key.
  if (bytes.length < 55) {
    throw new WebAuthnError("attested credential data is truncated");
  }
  result.aaguid = bytes.slice(37, 53);
  const idLength = (bytes[53] << 8) | bytes[54];

  // The spec caps credential ids at 1023 bytes. Checked because the length is
  // attacker-supplied and the alternative is a slice that silently comes back
  // short.
  if (idLength > 1023) {
    throw new WebAuthnError(`credential id claims ${idLength} bytes, over the 1023 limit`);
  }
  if (bytes.length < 55 + idLength) {
    throw new WebAuthnError("credential id runs past the end of the buffer");
  }
  result.credentialId = bytes.slice(55, 55 + idLength);

  // The public key's length is stated nowhere: the only way to find its end is
  // to decode it. This is the sole reason `decodeCborPrefix` exists.
  const rest = bytes.subarray(55 + idLength);
  const { bytesRead } = decodeCborPrefix(rest);
  result.credentialPublicKey = rest.slice(0, bytesRead);

  return result;
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function parseClientData(clientDataJSON: Uint8Array): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clientDataJSON));
  } catch {
    throw new WebAuthnError("client data is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new WebAuthnError("client data is not an object");
  }
  const data = parsed as Record<string, unknown>;
  if (typeof data.type !== "string") throw new WebAuthnError("client data has no type");
  if (typeof data.challenge !== "string") {
    throw new WebAuthnError("client data has no challenge");
  }
  if (typeof data.origin !== "string") throw new WebAuthnError("client data has no origin");

  return {
    type: data.type,
    challenge: data.challenge,
    origin: data.origin,
    crossOrigin: typeof data.crossOrigin === "boolean" ? data.crossOrigin : undefined,
  };
}

/** Constant-time string comparison, for the values an attacker gets to iterate on. */
function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface CeremonyExpectations {
  /** The exact challenge this server issued, base64url encoded. */
  challenge: string;
  /**
   * The exact origin, scheme and all: `https://cubeduel.vercel.app`.
   *
   * Compared for equality and never with `startsWith`. That reflex is a real
   * vulnerability here — `"https://cubeduel.vercel.app.attacker.com"` starts
   * with the expected origin, and a passkey that can be used from an attacker's
   * page is not a passkey.
   */
  origin: string;
  /** The relying party id — the registrable domain, with no scheme or port. */
  rpId: string;
  /**
   * Whether a PIN, fingerprint or face is required, as opposed to a mere touch.
   *
   * Left to the caller because it is a product decision rather than a security
   * absolute: requiring it makes a passkey a genuine second factor, and also
   * makes some hardware keys unusable.
   */
  requireUserVerification: boolean;
}

function checkClientData(
  clientDataJSON: Uint8Array,
  expected: CeremonyExpectations,
  expectedType: "webauthn.create" | "webauthn.get",
): void {
  const clientData = parseClientData(clientDataJSON);

  // The type separates the two ceremonies. Without this check, a signature
  // collected during registration could be replayed as a sign-in, and vice
  // versa — the ceremonies sign structurally similar things.
  if (clientData.type !== expectedType) {
    throw new WebAuthnError(
      `expected a ${expectedType} ceremony, got ${clientData.type}`,
    );
  }

  if (!sameString(clientData.challenge, expected.challenge)) {
    throw new WebAuthnError("the challenge does not match the one issued");
  }

  if (!sameString(clientData.origin, expected.origin)) {
    throw new WebAuthnError(
      `origin ${clientData.origin} is not ${expected.origin}`,
    );
  }

  // A ceremony run from inside a cross-origin iframe. Refused: the person may
  // have no idea which site they are authorising, which is exactly the
  // confusion a passkey is supposed to remove.
  if (clientData.crossOrigin === true) {
    throw new WebAuthnError("cross-origin ceremonies are not accepted");
  }
}

function checkAuthenticatorData(
  authData: AuthenticatorData,
  expected: CeremonyExpectations,
): void {
  const expectedHash = createHash("sha256").update(expected.rpId).digest();
  if (!sameBytes(authData.rpIdHash, expectedHash)) {
    throw new WebAuthnError("this credential belongs to a different site");
  }

  // User presence is not optional in either ceremony. A signature produced
  // without anybody touching anything is a signature malware can produce.
  if (!authData.flags.userPresent) {
    throw new WebAuthnError("the authenticator did not report a user present");
  }

  if (expected.requireUserVerification && !authData.flags.userVerified) {
    throw new WebAuthnError("this account requires the authenticator to verify you");
  }
}

export interface RegistrationResult {
  credentialId: Uint8Array;
  /** COSE-encoded, exactly as the authenticator produced it. */
  publicKey: Uint8Array;
  signCount: number;
  algorithm: SupportedAlgorithm;
  aaguid: Uint8Array | undefined;
  /** True when the credential syncs between the person's devices. */
  backedUp: boolean;
  transports: string[];
}

/**
 * Verifies a newly created passkey and returns what should be stored.
 *
 * The public key is checked by actually parsing it, not by trusting that
 * anything CBOR-shaped is a key. A credential row holding bytes that turn out
 * not to be a usable key is an account that cannot ever sign in, discovered at
 * the worst possible moment — and it costs one function call to find out now.
 */
export function verifyRegistration(input: {
  attestationObject: Uint8Array;
  clientDataJSON: Uint8Array;
  transports?: string[];
  expected: CeremonyExpectations;
}): RegistrationResult {
  checkClientData(input.clientDataJSON, input.expected, "webauthn.create");

  const attestation = asCborMap(decodeCbor(input.attestationObject));
  const authData = parseAuthenticatorData(asBytes(attestation.get("authData"), "authData"));

  checkAuthenticatorData(authData, input.expected);

  if (!authData.flags.attestedCredentialData || !authData.credentialId || !authData.credentialPublicKey) {
    throw new WebAuthnError("the authenticator returned no credential to register");
  }
  if (authData.credentialId.length === 0) {
    throw new WebAuthnError("the authenticator returned an empty credential id");
  }

  // Parsed now so that an unusable key is refused at registration rather than
  // discovered at sign-in.
  const parsed = parseCosePublicKey(authData.credentialPublicKey);

  return {
    credentialId: authData.credentialId,
    publicKey: authData.credentialPublicKey,
    signCount: authData.signCount,
    algorithm: parsed.algorithm,
    aaguid: authData.aaguid,
    backedUp: authData.flags.backedUp,
    transports: input.transports ?? [],
  };
}

export interface AuthenticationResult {
  /** What to write back to `credentials.sign_count`. */
  signCount: number;
  /**
   * True when the counter went backwards, which means two authenticators are
   * presenting the same credential.
   *
   * Reported rather than thrown, because the right response is a product
   * decision — and because most platform authenticators (iCloud Keychain,
   * Windows Hello, every synced passkey) do not implement counters at all and
   * always send zero. Treating zero as a clone would lock out the majority of
   * real users. See `server/passkeys.ts` for what is done with it.
   */
  clonedWarning: boolean;
  userVerified: boolean;
}

/**
 * Verifies a sign-in assertion against a stored credential.
 *
 * The signature covers the authenticator data concatenated with the SHA-256 of
 * the client data — the client data itself is *not* signed directly. Getting
 * that wrong is the classic implementation bug: hashing the wrong thing, or
 * concatenating in the wrong order, rejects every genuine signature, which
 * reads as "passkeys are broken" rather than as a bug in the verifier.
 */
export function verifyAuthentication(input: {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  storedPublicKey: Uint8Array;
  storedSignCount: number;
  expected: CeremonyExpectations;
}): AuthenticationResult {
  checkClientData(input.clientDataJSON, input.expected, "webauthn.get");

  const authData = parseAuthenticatorData(input.authenticatorData);
  checkAuthenticatorData(authData, input.expected);

  const parsed = parseCosePublicKey(input.storedPublicKey);

  const clientDataHash = createHash("sha256").update(input.clientDataJSON).digest();
  const signedData = Buffer.concat([
    Buffer.from(input.authenticatorData),
    clientDataHash,
  ]);

  if (!verifyCoseSignature(parsed, signedData, input.signature)) {
    throw new WebAuthnError("the signature does not verify against this credential");
  }

  // A counter of zero on either side means the authenticator does not keep one.
  // Only a genuine decrease between two non-zero values says anything.
  const clonedWarning =
    input.storedSignCount > 0 &&
    authData.signCount > 0 &&
    authData.signCount <= input.storedSignCount;

  return {
    signCount: Math.max(authData.signCount, input.storedSignCount),
    clonedWarning,
    userVerified: authData.flags.userVerified,
  };
}
