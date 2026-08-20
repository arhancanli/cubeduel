/**
 * Just enough CBOR to read what an authenticator sends.
 *
 * WebAuthn's attestation object and its public keys are CBOR (RFC 8949), so
 * something has to decode it. The options were a dependency or about two hundred
 * lines, and two hundred lines won for one reason: this is a repository meant to
 * be read, and the parser standing between an attacker's bytes and a public key
 * is exactly the part an auditor wants to see.
 *
 * ## Deliberately partial
 *
 * This decodes the six major types WebAuthn actually uses — unsigned integers,
 * negative integers, byte strings, text strings, arrays and maps — plus the
 * three simple values. It does not do tags, indefinite-length items, floats,
 * or bignums, and it **refuses** them rather than skipping them.
 *
 * Refusing is the whole point. A parser that quietly ignores what it does not
 * understand is how a byte string gets read as something else, and a decoder
 * that silently returns a partial structure is worse than one that throws: the
 * caller carries on and verifies a signature over the wrong thing.
 *
 * ## Every failure is an exception, and callers are expected to catch
 *
 * Input here is attacker-controlled by definition. Truncation, absurd lengths,
 * trailing bytes and duplicate map keys are all errors, and all of them are
 * things a hostile client will send. The rule this file follows is that it
 * either returns a value that fully and exactly accounts for every byte it was
 * given, or it throws.
 */

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | boolean
  | null
  | undefined
  | CborValue[]
  | CborMap;

/**
 * A CBOR map.
 *
 * A `Map` rather than a plain object because COSE keys are keyed by *negative
 * integers* (`-1` is the curve, `-2` is the x coordinate), and a plain object
 * would stringify those into `"-1"` and quietly lose the distinction between the
 * integer key -1 and the text key "-1". They mean different things.
 */
export type CborMap = Map<number | bigint | string, CborValue>;

class CborError extends Error {
  constructor(message: string) {
    super(`CBOR: ${message}`);
    this.name = "CborError";
  }
}

/**
 * An upper bound on any single length read out of the input.
 *
 * Without it, four bytes of header can ask for a four-gigabyte allocation, and
 * a request body of eight bytes becomes an out-of-memory crash. The bound is far
 * above anything WebAuthn produces — attestation objects run to a few kilobytes.
 */
const MAX_LENGTH = 1 << 20;

/**
 * How deep nesting may go.
 *
 * CBOR is recursive and so is this decoder, so a few hundred bytes of nothing
 * but "start an array" is a stack overflow. That crashes the process rather than
 * failing the request, which makes it a denial of service written in eight
 * bytes.
 */
const MAX_DEPTH = 16;

interface Reader {
  readonly bytes: Uint8Array;
  offset: number;
}

function need(reader: Reader, count: number): void {
  if (reader.offset + count > reader.bytes.length) {
    throw new CborError(
      `truncated: wanted ${count} bytes at ${reader.offset}, have ${
        reader.bytes.length - reader.offset
      }`,
    );
  }
}

function readUint8(reader: Reader): number {
  need(reader, 1);
  return reader.bytes[reader.offset++];
}

/**
 * Reads the argument that follows a major type's initial byte.
 *
 * The low five bits either *are* the value (0–23), or say how many bytes follow
 * (24, 25, 26, 27 for 1, 2, 4, 8). 28–30 are reserved and 31 means indefinite
 * length; both are refused here.
 *
 * Eight-byte arguments come back as `bigint`, because a CBOR integer can exceed
 * what a JavaScript number represents exactly. Returning a `number` there would
 * silently round — and a rounded length or a rounded key is a value that is
 * quietly not the one that was sent.
 */
function readArgument(reader: Reader, info: number): number | bigint {
  if (info < 24) return info;
  if (info === 24) return readUint8(reader);
  if (info === 25) {
    need(reader, 2);
    const value = (reader.bytes[reader.offset] << 8) | reader.bytes[reader.offset + 1];
    reader.offset += 2;
    return value;
  }
  if (info === 26) {
    need(reader, 4);
    const view = new DataView(
      reader.bytes.buffer,
      reader.bytes.byteOffset + reader.offset,
      4,
    );
    const value = view.getUint32(0, false);
    reader.offset += 4;
    return value;
  }
  if (info === 27) {
    need(reader, 8);
    const view = new DataView(
      reader.bytes.buffer,
      reader.bytes.byteOffset + reader.offset,
      8,
    );
    const value = view.getBigUint64(0, false);
    reader.offset += 8;
    // Narrowed to a number when it fits exactly, so that ordinary small values
    // do not arrive as bigint and surprise every comparison downstream.
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
  if (info === 31) {
    throw new CborError("indefinite-length items are not supported");
  }
  throw new CborError(`reserved additional information ${info}`);
}

function asLength(argument: number | bigint): number {
  if (typeof argument === "bigint" || argument > MAX_LENGTH) {
    throw new CborError(`length ${argument} exceeds the ${MAX_LENGTH}-byte limit`);
  }
  return argument;
}

function decodeItem(reader: Reader, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new CborError(`nested deeper than ${MAX_DEPTH}`);

  const initial = readUint8(reader);
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    // 0: unsigned integer.
    case 0:
      return readArgument(reader, info);

    // 1: negative integer, encoded as -1 - n.
    case 1: {
      const argument = readArgument(reader, info);
      // `BigInt(-1)` rather than the `-1n` literal: this project targets ES2017,
      // where the literal syntax does not exist. The call is a lib feature and
      // works at any target.
      return typeof argument === "bigint" ? BigInt(-1) - argument : -1 - argument;
    }

    // 2: byte string.
    case 2: {
      const length = asLength(readArgument(reader, info));
      need(reader, length);
      // Copied rather than subarray'd. A view shares the caller's buffer, so
      // anything that later reuses that buffer mutates a public key that has
      // already been "read" — a bug that only appears under load.
      const value = reader.bytes.slice(reader.offset, reader.offset + length);
      reader.offset += length;
      return value;
    }

    // 3: text string.
    case 3: {
      const length = asLength(readArgument(reader, info));
      need(reader, length);
      const slice = reader.bytes.subarray(reader.offset, reader.offset + length);
      reader.offset += length;
      // `fatal` so that invalid UTF-8 throws instead of becoming replacement
      // characters. A string that silently changed is a string that no longer
      // matches what was signed.
      return new TextDecoder("utf-8", { fatal: true }).decode(slice);
    }

    // 4: array.
    case 4: {
      const count = asLength(readArgument(reader, info));
      const items: CborValue[] = [];
      for (let i = 0; i < count; i++) items.push(decodeItem(reader, depth + 1));
      return items;
    }

    // 5: map.
    case 5: {
      const count = asLength(readArgument(reader, info));
      const map: CborMap = new Map();
      for (let i = 0; i < count; i++) {
        const key = decodeItem(reader, depth + 1);
        if (
          typeof key !== "number" &&
          typeof key !== "bigint" &&
          typeof key !== "string"
        ) {
          throw new CborError("map keys must be integers or strings");
        }
        // Duplicates are rejected rather than last-wins. Whichever one a decoder
        // picks, an attacker picks the other: a map carrying two `-2` entries is
        // a way to show one public key to a validator and another to whatever
        // uses the result.
        if (map.has(key)) throw new CborError(`duplicate map key ${String(key)}`);
        map.set(key, decodeItem(reader, depth + 1));
      }
      return map;
    }

    // 7: simple values and floats.
    case 7: {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      throw new CborError(`unsupported simple value or float (info ${info})`);
    }

    // 6: tags.
    default:
      throw new CborError(`unsupported major type ${major}`);
  }
}

/**
 * Decodes one CBOR item, which must account for the entire input.
 *
 * Trailing bytes are an error. WebAuthn's own verification steps require that
 * the attestation object parse exactly, and tolerating a tail is how two
 * implementations end up disagreeing about what they just verified — the
 * classic shape of a signature-bypass bug.
 */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const reader: Reader = { bytes, offset: 0 };
  const value = decodeItem(reader, 0);
  if (reader.offset !== bytes.length) {
    throw new CborError(
      `${bytes.length - reader.offset} trailing byte(s) after the top-level item`,
    );
  }
  return value;
}

/**
 * Decodes one item and reports where it ended, for the one place that needs it.
 *
 * An authenticator's attested credential data puts the COSE public key last, in
 * a structure whose length is not stated anywhere — the only way to know where
 * the key ends is to decode it and see. That is the sole reason this exists;
 * everything else should use `decodeCbor` and get the trailing-byte check.
 */
export function decodeCborPrefix(bytes: Uint8Array): {
  value: CborValue;
  bytesRead: number;
} {
  const reader: Reader = { bytes, offset: 0 };
  const value = decodeItem(reader, 0);
  return { value, bytesRead: reader.offset };
}

/** Narrowing helper, so call sites read as checks rather than as casts. */
export function asCborMap(value: CborValue): CborMap {
  if (!(value instanceof Map)) throw new CborError("expected a map");
  return value;
}

/** Narrowing helper for the byte strings that carry keys and signatures. */
export function asBytes(value: CborValue | undefined, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new CborError(`expected ${what} to be bytes`);
  return value;
}
