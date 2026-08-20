import { createHash, randomBytes } from "node:crypto";

/**
 * The random secrets handed to clients: session cookies and the tokens inside
 * email links.
 *
 * These are a different problem from passwords and are treated differently.
 * A password is short, chosen by a person, and guessable, so it needs a slow
 * hash to make guessing expensive. A token here is 256 bits from the operating
 * system's CSPRNG — there is nothing to guess, and no amount of computing power
 * gets an attacker meaningfully closer.
 *
 * So the entire threat these defend against is a *stolen database*, and a fast
 * hash defeats that completely: the column holds SHA-256 of the token, a lookup
 * hashes what arrived and matches on that, and a dump of the table lets nobody
 * sign in as anybody.
 *
 * Using scrypt here instead would be a hundred milliseconds of pointless work on
 * every single request that carries a cookie.
 */

/**
 * 32 bytes. Not a round-number-because-it-looks-serious 32: below about 16 the
 * birthday bound on collisions starts to matter for a table that will hold
 * millions of rows over time, and above 32 is free entropy nobody can use.
 */
const TOKEN_BYTES = 32;

/**
 * A fresh secret, base64url encoded.
 *
 * base64url rather than hex because these travel in cookies and URLs, and
 * rather than plain base64 because `+`, `/` and `=` all have to be escaped
 * there — and a token that survives one round of encoding but not two is a bug
 * that shows up only for the unlucky fraction of users whose random bytes
 * happened to contain one.
 */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What gets stored: SHA-256 of the token, as raw bytes for a `bytea` column.
 *
 * Note there is no salt, and that is correct rather than an oversight. A salt
 * defends against precomputation, and precomputing a table against 256-bit
 * random values is not a thing that can be done. Salting each row would also
 * make the lookup impossible — the server has to find the row *by* the token,
 * and a per-row salt cannot be applied before the row is found.
 */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/**
 * The same digest as a hex string, for the places that talk to PostgREST rather
 * than to Postgres directly.
 *
 * Supabase's REST layer takes `bytea` as a hex string with a `\x` prefix. This
 * is that encoding, kept in one place so the prefix is never half-remembered at
 * a call site — a missing `\x` does not error, it silently matches nothing,
 * which surfaces as "signed in users are randomly signed out" rather than as a
 * type error.
 */
export function hashTokenForPostgrest(token: string): string {
  return `\\x${hashToken(token).toString("hex")}`;
}

/**
 * Encodes raw bytes the same way, for the columns that store binary the client
 * never sees — a passkey's credential id and public key.
 */
export function bytesForPostgrest(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

/** Reads that encoding back. Tolerates a missing prefix rather than throwing. */
export function bytesFromPostgrest(value: string): Buffer {
  return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
}

/**
 * How long each kind of secret lives.
 *
 * Sessions get thirty days absolute and seven days idle, and both are enforced:
 * a session in daily use should not be cut off for being old, and a session last
 * touched two months ago should not survive because it was created recently.
 *
 * Email links get an hour. Long enough to walk away from the computer and come
 * back, short enough that a link sitting in an unattended inbox, or in a mail
 * archive, or in a forwarded thread, has stopped working. Reset links are the
 * more dangerous of the two — anyone holding one owns the account — so they get
 * the shorter life.
 */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const VERIFY_TOKEN_MS = 60 * 60 * 1000;
export const RESET_TOKEN_MS = 30 * 60 * 1000;

/**
 * The name of the session cookie.
 *
 * The `__Host-` prefix is not decoration. A browser refuses to accept a cookie
 * with that prefix unless it is `Secure`, has no `Domain` attribute, and is
 * pathed at `/` — which means a cookie that arrives with this name provably was
 * not set by a subdomain. Without it, anything that can run on any subdomain of
 * the site can plant a session cookie on the main one and fix a victim's
 * session to an account it controls.
 *
 * The cost is that it cannot work over plain HTTP, so local development uses the
 * unprefixed name. That fallback is chosen from the deployment's own protocol,
 * never from anything in the request — a header-driven choice would let an
 * attacker ask for the weaker cookie.
 */
export const SESSION_COOKIE_SECURE = "__Host-cubeduel_session";
export const SESSION_COOKIE_INSECURE = "cubeduel_session";
