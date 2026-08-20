import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

import { asBytes, asCborMap, decodeCbor, type CborMap } from "./cbor";

/**
 * COSE public keys, and verifying signatures made with them.
 *
 * An authenticator hands over its public key as a COSE_Key (RFC 8152): a CBOR
 * map keyed by small integers. This turns one of those into something
 * `node:crypto` can verify with, and then verifies with it.
 *
 * As in `password.ts`, nothing cryptographic is implemented here. The curve
 * arithmetic and the signature checks are Node's, via OpenSSL. What this file
 * does is *translation* — and translation is where the interesting bugs are,
 * because a key that decodes to the wrong thing verifies the wrong signature
 * without any error being raised anywhere.
 *
 * ## The attack this file exists to prevent
 *
 * The algorithm is stored at registration and used at every assertion
 * afterwards. It is never read from the assertion itself.
 *
 * That is not a detail. If the verifier took the algorithm from the message it
 * is verifying, an attacker would simply say which algorithm to use — the same
 * shape as the `alg: "none"` family of JSON Web Token bypasses, which broke a
 * long list of libraries that all looked correct. Here the credential row is the
 * authority: this key is an ES256 key, so an ES256 signature is what will be
 * checked, and an assertion claiming otherwise is refused rather than
 * accommodated.
 */

/** COSE key type (label 1). */
const KTY_OKP = 1;
const KTY_EC2 = 2;
const KTY_RSA = 3;

/**
 * The algorithms accepted, by COSE identifier.
 *
 * ES256 and RS256 because WebAuthn requires every authenticator to support one
 * of them, and Ed25519 because a growing number offer it and it is the best of
 * the three. Everything else is refused — an allowlist rather than a blocklist,
 * so an algorithm nobody here has thought about cannot arrive and be honoured.
 */
export const ES256 = -7;
export const EDDSA = -8;
export const RS256 = -257;

export const SUPPORTED_ALGORITHMS = [ES256, RS256, EDDSA] as const;
export type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

/** COSE elliptic curve identifiers (label -1 on an EC2 or OKP key). */
const CRV_P256 = 1;
const CRV_ED25519 = 6;

export class CoseError extends Error {
  constructor(message: string) {
    super(`COSE: ${message}`);
    this.name = "CoseError";
  }
}

export interface CosePublicKey {
  key: KeyObject;
  algorithm: SupportedAlgorithm;
}

function integer(map: CborMap, label: number, what: string): number {
  const value = map.get(label);
  if (typeof value !== "number") throw new CoseError(`${what} is missing or not an integer`);
  return value;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/**
 * Reads a COSE_Key into a verifiable public key.
 *
 * The route in is JSON Web Key rather than hand-built DER. Both are ways of
 * describing the same key to OpenSSL, and JWK is the one where the fields are
 * named — `x` and `y` are coordinates, not offsets into a byte string that has
 * to be assembled in the right order with the right prefixes. Hand-building an
 * SPKI here would be about sixty lines of length-prefixed structure with
 * algorithm identifiers embedded as raw object identifiers, and every one of
 * those bytes is a chance to produce a key that parses and is not the key that
 * was sent.
 */
export function parseCosePublicKey(cose: Uint8Array): CosePublicKey {
  const map = asCborMap(decodeCbor(cose));

  const kty = integer(map, 1, "key type");
  const algorithm = integer(map, 3, "algorithm");

  if (!SUPPORTED_ALGORITHMS.includes(algorithm as SupportedAlgorithm)) {
    throw new CoseError(`unsupported algorithm ${algorithm}`);
  }

  if (kty === KTY_EC2) {
    if (algorithm !== ES256) {
      throw new CoseError(`EC2 key declared algorithm ${algorithm}, expected ES256`);
    }
    const curve = integer(map, -1, "curve");
    if (curve !== CRV_P256) throw new CoseError(`unsupported curve ${curve}`);

    const x = asBytes(map.get(-2), "the x coordinate");
    const y = asBytes(map.get(-3), "the y coordinate");
    // P-256 coordinates are exactly 32 bytes. A short one would be accepted by
    // some parsers as a left-padded value, which is a different point.
    if (x.length !== 32 || y.length !== 32) {
      throw new CoseError(`P-256 coordinates must be 32 bytes, got ${x.length}/${y.length}`);
    }

    return {
      algorithm: ES256,
      key: createPublicKey({
        format: "jwk",
        key: { kty: "EC", crv: "P-256", x: base64url(x), y: base64url(y) },
      }),
    };
  }

  if (kty === KTY_RSA) {
    if (algorithm !== RS256) {
      throw new CoseError(`RSA key declared algorithm ${algorithm}, expected RS256`);
    }
    const n = asBytes(map.get(-1), "the modulus");
    const e = asBytes(map.get(-2), "the exponent");

    // 2048 bits is the floor. Anything shorter is a key that can be factored,
    // and accepting it means an authenticator can choose to be forgeable.
    if (n.length < 256) throw new CoseError(`RSA modulus is only ${n.length * 8} bits`);

    return {
      algorithm: RS256,
      key: createPublicKey({
        format: "jwk",
        key: { kty: "RSA", n: base64url(n), e: base64url(e) },
      }),
    };
  }

  if (kty === KTY_OKP) {
    if (algorithm !== EDDSA) {
      throw new CoseError(`OKP key declared algorithm ${algorithm}, expected EdDSA`);
    }
    const curve = integer(map, -1, "curve");
    if (curve !== CRV_ED25519) throw new CoseError(`unsupported OKP curve ${curve}`);

    const x = asBytes(map.get(-2), "the public key");
    if (x.length !== 32) throw new CoseError(`Ed25519 keys are 32 bytes, got ${x.length}`);

    return {
      algorithm: EDDSA,
      key: createPublicKey({
        format: "jwk",
        key: { kty: "OKP", crv: "Ed25519", x: base64url(x) },
      }),
    };
  }

  throw new CoseError(`unsupported key type ${kty}`);
}

/**
 * Checks a signature against a parsed key.
 *
 * Note what is *not* a parameter: the algorithm. It comes from the key, which
 * came from the credential row, which was written at registration. See the note
 * at the top of this file.
 *
 * Returns false rather than throwing on a malformed signature. A signature is
 * attacker-supplied by definition, and every way it can be wrong — wrong length,
 * not valid DER, simply incorrect — is the same answer: no.
 */
export function verifyCoseSignature(
  parsed: CosePublicKey,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    if (parsed.algorithm === EDDSA) {
      // Ed25519 hashes internally, so the digest argument must be null. Passing
      // "sha256" here does not fail loudly — it throws, which is at least
      // honest, but the shape of the mistake is worth naming.
      return cryptoVerify(null, data, parsed.key, signature);
    }

    if (parsed.algorithm === ES256) {
      // WebAuthn ECDSA signatures are DER-encoded, which is Node's default for
      // an EC key. Named anyway: the alternative encoding is a raw 64-byte pair,
      // and a mismatch here rejects every genuine signature while accepting
      // none — a failure that reads exactly like "passkeys are broken".
      return cryptoVerify("sha256", data, { key: parsed.key, dsaEncoding: "der" }, signature);
    }

    return cryptoVerify("sha256", data, parsed.key, signature);
  } catch {
    return false;
  }
}
