import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifying a Clerk webhook, which is a Svix webhook.
 *
 * Written out rather than pulling in the `svix` package. The algorithm is forty
 * lines of HMAC and this repository is meant to be read: a dependency here would
 * hide the one part anybody auditing the project actually wants to check, and
 * would do it for a saving of forty lines.
 *
 * The endpoint this guards deletes accounts. An unverified request to it is an
 * anonymous delete-anything button, so all three of the usual mistakes matter:
 *
 *   **The signed payload is the raw body**, not a re-serialised object. Parsing
 *   and re-stringifying changes key order and whitespace, and the signature is
 *   then computed over something the sender never sent.
 *
 *   **Comparison is timing-safe.** A byte-by-byte early return leaks how much of
 *   a guess was right, which is enough to construct a valid signature given
 *   enough attempts.
 *
 *   **Old requests are rejected.** A signature stays valid forever, so without a
 *   timestamp check a captured request can be replayed indefinitely.
 */

/** How far out of date a request may be. Svix's own recommendation. */
export const TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Checks a Svix signature over a raw request body.
 *
 * `secret` is the `whsec_…` value from the Clerk dashboard. Everything after the
 * prefix is base64 — the signature is computed over the decoded bytes, and using
 * the string as-is silently produces a valid-looking HMAC that never matches.
 */
export function verifySvixSignature(
  body: string,
  headers: SvixHeaders,
  secret: string,
  now: number,
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "Missing signature headers." };
  }

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "Malformed timestamp." };
  }
  // Both directions: a request from the future is as suspicious as an old one,
  // and clock skew large enough to matter is itself a reason to refuse.
  if (Math.abs(now - sentAt) > TOLERANCE_MS) {
    return { ok: false, reason: "Timestamp outside the tolerance window." };
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return { ok: false, reason: "Empty signing secret." };

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  // The header carries a space-separated list of `v1,<signature>` pairs, because
  // a secret being rotated means two are briefly valid at once. Any match is a
  // pass, and every candidate is compared even after one succeeds so the number
  // of comparisons does not depend on which one matched.
  let matched = false;
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    if (equalConstantTime(value, expected)) matched = true;
  }

  return matched ? { ok: true } : { ok: false, reason: "Signature did not match." };
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, and the throw is itself a
 * timing signal, so lengths are checked first and the comparison is only run on
 * equal-length buffers. A different length is a wrong answer regardless.
 */
function equalConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
