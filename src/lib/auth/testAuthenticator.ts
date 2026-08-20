import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";

/**
 * A working WebAuthn authenticator, in software, for tests.
 *
 * It holds a real P-256 key pair, assembles real authenticator data, and
 * produces real signatures over the real signed payload. Nothing here is a stub
 * that returns a canned answer.
 *
 * That is the point. A verifier tested against fixtures produced by the same
 * verifier's assumptions will agree with itself no matter how wrong it is; the
 * only way to know `verifyAuthentication` accepts a genuine passkey is to make
 * one and see. And because this authenticator is *programmable* — it can be told
 * to sign the wrong challenge, report the wrong origin, withhold user presence,
 * or wind its counter backwards — every rejection path can be exercised too,
 * which is the half of a security check that normally goes untested.
 *
 * Only ever imported by tests. It is deliberately not in a `__tests__`
 * directory because the integration harness uses it too.
 */

// ---------------------------------------------------------------------------
// Just enough CBOR encoding for an attestation object.
// ---------------------------------------------------------------------------

function encodeHead(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 256) return [(major << 5) | 24, length];
  if (length < 65536) return [(major << 5) | 25, (length >> 8) & 0xff, length & 0xff];
  throw new Error("test encoder does not handle items this large");
}

function encodeInt(value: number): number[] {
  if (value >= 0) return encodeHead(0, value);
  return encodeHead(1, -1 - value);
}

const encodeBytes = (bytes: Uint8Array) => [...encodeHead(2, bytes.length), ...bytes];

const encodeText = (text: string) => {
  const bytes = Buffer.from(text, "utf8");
  return [...encodeHead(3, bytes.length), ...bytes];
};

type Encodable = number | string | Uint8Array | Map<number | string, Encodable>;

function encode(value: Encodable): number[] {
  if (typeof value === "number") return encodeInt(value);
  if (typeof value === "string") return encodeText(value);
  if (value instanceof Uint8Array) return encodeBytes(value);

  const out = encodeHead(5, value.size);
  for (const [key, item] of value) {
    out.push(...(typeof key === "number" ? encodeInt(key) : encodeText(key)));
    out.push(...encode(item));
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Flag bits in byte 32 of authenticator data. */
export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_BACKUP_ELIGIBLE = 0x08;
export const FLAG_BACKED_UP = 0x10;
export const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

export interface AuthenticatorOptions {
  rpId?: string;
  origin?: string;
  /** Overrides the rp id actually hashed into authenticator data. */
  signingRpId?: string;
}

export class TestAuthenticator {
  readonly rpId: string;
  readonly origin: string;
  readonly credentialId: Uint8Array;

  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  /** Bumped on every assertion, like a real hardware key's counter. */
  signCount = 0;

  constructor(options: AuthenticatorOptions = {}) {
    this.rpId = options.rpId ?? "cubeduel.test";
    this.origin = options.origin ?? `https://${this.rpId}`;
    // `Uint8Array.from` rather than the Buffer randomBytes returns: a real
    // authenticator's bytes arrive as a plain Uint8Array, and a fake that hands
    // back Buffers makes tests pass or fail on a distinction production never
    // sees.
    this.credentialId = Uint8Array.from(randomBytes(32));

    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  /** The COSE_Key an authenticator would hand over for this key pair. */
  cosePublicKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: "jwk" });
    const map = new Map<number | string, Encodable>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Uint8Array.from(Buffer.from(jwk.x as string, "base64url"))],
      [-3, Uint8Array.from(Buffer.from(jwk.y as string, "base64url"))],
    ]);
    return Uint8Array.from(encode(map));
  }

  clientDataJSON(
    type: "webauthn.create" | "webauthn.get",
    challenge: string,
    overrides: { origin?: string; crossOrigin?: boolean } = {},
  ): Uint8Array {
    const clientData: Record<string, unknown> = {
      type,
      challenge,
      origin: overrides.origin ?? this.origin,
    };
    if (overrides.crossOrigin !== undefined) clientData.crossOrigin = overrides.crossOrigin;
    return Uint8Array.from(Buffer.from(JSON.stringify(clientData), "utf8"));
  }

  authenticatorData(options: {
    flags?: number;
    signCount?: number;
    includeCredential?: boolean;
    rpId?: string;
  } = {}): Uint8Array {
    const rpIdHash = createHash("sha256")
      .update(options.rpId ?? this.rpId)
      .digest();

    const flags = options.flags ?? FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
    const count = options.signCount ?? this.signCount;

    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(count, 0);

    const parts: Buffer[] = [rpIdHash, Buffer.from([flags]), counter];

    if (options.includeCredential) {
      const cose = this.cosePublicKey();
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(this.credentialId.length, 0);
      parts.push(
        Buffer.alloc(16), // AAGUID, all zeroes as a synced passkey reports
        idLength,
        Buffer.from(this.credentialId),
        Buffer.from(cose),
      );
    }

    return Uint8Array.from(Buffer.concat(parts));
  }

  /** A registration response, as `navigator.credentials.create()` would produce. */
  register(
    challenge: string,
    overrides: {
      flags?: number;
      origin?: string;
      crossOrigin?: boolean;
      rpId?: string;
      type?: "webauthn.create" | "webauthn.get";
    } = {},
  ): { attestationObject: Uint8Array; clientDataJSON: Uint8Array } {
    const authData = this.authenticatorData({
      flags:
        overrides.flags ??
        (FLAG_USER_PRESENT |
          FLAG_USER_VERIFIED |
          FLAG_ATTESTED_CREDENTIAL_DATA |
          FLAG_BACKUP_ELIGIBLE |
          FLAG_BACKED_UP),
      includeCredential: true,
      rpId: overrides.rpId,
      signCount: 0,
    });

    const attestationObject = Uint8Array.from(
      encode(
        new Map<number | string, Encodable>([
          // "none" attestation: the authenticator makes no claim about what it
          // is. This is what a browser returns when asked for attestation:
          // "none", which is what this application asks for.
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      ),
    );

    return {
      attestationObject,
      clientDataJSON: this.clientDataJSON(overrides.type ?? "webauthn.create", challenge, {
        origin: overrides.origin,
        crossOrigin: overrides.crossOrigin,
      }),
    };
  }

  /** An assertion, as `navigator.credentials.get()` would produce. */
  authenticate(
    challenge: string,
    overrides: {
      flags?: number;
      origin?: string;
      crossOrigin?: boolean;
      rpId?: string;
      signCount?: number;
      type?: "webauthn.create" | "webauthn.get";
      /** Signs something other than the real payload, to prove the check bites. */
      corruptSignature?: boolean;
    } = {},
  ): {
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
  } {
    this.signCount += 1;

    const authenticatorData = this.authenticatorData({
      flags: overrides.flags,
      signCount: overrides.signCount ?? this.signCount,
      rpId: overrides.rpId,
    });

    const clientDataJSON = this.clientDataJSON(
      overrides.type ?? "webauthn.get",
      challenge,
      { origin: overrides.origin, crossOrigin: overrides.crossOrigin },
    );

    const clientDataHash = createHash("sha256").update(clientDataJSON).digest();
    const signedData = Buffer.concat([
      Buffer.from(overrides.corruptSignature ? new Uint8Array(37) : authenticatorData),
      clientDataHash,
    ]);

    const signature = cryptoSign("sha256", signedData, {
      key: this.privateKey,
      dsaEncoding: "der",
    });

    return { authenticatorData, clientDataJSON, signature: Uint8Array.from(signature) };
  }
}

/** A fresh base64url challenge, the same shape the server issues. */
export function testChallenge(): string {
  return randomBytes(32).toString("base64url");
}
