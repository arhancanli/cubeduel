import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * Passwords, hashed with scrypt.
 *
 * The one rule this file exists to obey: nothing here is invented. scrypt is a
 * published, analysed key-derivation function and it ships in Node's standard
 * library; every primitive below comes from `node:crypto`. Writing an
 * authentication layer by hand is a reasonable thing to do and this repository
 * does it deliberately — writing a *hashing scheme* by hand is not, and the
 * distinction is the whole reason this module is four functions long and boring.
 *
 * ## Why scrypt and not bcrypt or argon2
 *
 * Both are defensible and argon2id is the current recommendation, but both are
 * native dependencies that have to compile on every machine that builds this
 * repository. scrypt is already here, has been in Node since v10, and is memory-
 * hard — which is the property that matters, because it is what stops an
 * attacker with a GPU or an ASIC from being a thousand times faster at guessing
 * than the server was at hashing.
 *
 * The stored format names its own algorithm and parameters, so the day argon2id
 * is worth a native dependency, old rows stay readable and get upgraded on next
 * sign-in rather than being stranded.
 *
 * ## The parameters, and why these
 *
 * `N = 32768, r = 8, p = 3`. This is one of the configurations OWASP lists for
 * scrypt, and specifically the one chosen for environments that are short on
 * memory rather than short on CPU.
 *
 * That is this environment. Memory here is `128 * N * r`, and it is spent *per
 * concurrent hash* — on a serverless function serving a burst of sign-ins,
 * OWASP's headline `N = 2^17, r = 8, p = 1` would ask for 128 MiB each and run
 * the function out of memory long before it ran out of time. Raising `p`
 * instead buys the same resistance out of repeated passes over a smaller
 * buffer: the work goes up, the footprint does not.
 *
 * Measured on this machine, not estimated:
 *
 * | parameters          | time     | memory  |
 * |---------------------|----------|---------|
 * | 2^15, r 8, p 1      |  37.5 ms |  32 MiB |
 * | 2^15, r 8, p 3      | 107.1 ms |  32 MiB |  <- chosen
 * | 2^16, r 8, p 2      | 146.9 ms |  64 MiB |
 * | 2^17, r 8, p 1      | 150.9 ms | 128 MiB |
 *
 * A hundred milliseconds is invisible to somebody signing in and ruinous to
 * somebody working through a leaked password list.
 *
 * `maxmem` has to be raised explicitly because Node's default ceiling is 32 MiB
 * and these parameters sit exactly on it — without this, scrypt fails at runtime
 * with an error about memory that reads nothing like "your cost parameters are
 * one notch too high".
 */

// `promisify` resolves to the three-argument overload, which drops the options
// object that carries the cost parameters. Naming the signature keeps them.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 3;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEM = 64 * 1024 * 1024;

/**
 * The shortest password accepted.
 *
 * Eight, and no composition rules — no required symbol, no forced digit, no
 * mixed case. This follows NIST 800-63B, which dropped those rules after the
 * evidence came in: they push people toward `Password1!` and toward writing it
 * down, and they buy almost nothing against an attacker who is guessing from a
 * leaked list rather than from an alphabet.
 *
 * Length is the property that actually helps, so length is what is asked for,
 * and the far more useful check is the one below against passwords that are
 * already known.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * An upper bound, because scrypt will happily chew on a megabyte.
 *
 * This is a denial-of-service guard, not a security rule: without it, a request
 * body full of text becomes minutes of CPU. 200 covers every passphrase a person
 * will genuinely use.
 */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Passwords common enough that allowing them is the same as allowing no
 * password.
 *
 * Deliberately short. A real breach-corpus check means shipping tens of
 * megabytes or sending a hash prefix to a third party on every sign-up, and
 * neither is worth it here — but the top of the list is where the overwhelming
 * majority of real guesses land, so a small list stops most of the damage for no
 * cost. Cubing words are in it because this is a cubing site and `speedcube`
 * would otherwise be this site's `password1`.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyui", "qwerty123", "iloveyou", "sunshine", "princess", "football",
  "baseball", "welcome1", "admin123", "letmein1", "trustno1", "starwars",
  "abc12345", "monkey12", "dragon123", "superman", "michael1", "shadow12",
  "master12", "jennifer", "hello123", "freedom1", "whatever", "computer",
  "cubeduel", "speedcube", "rubikscube", "rubiks123", "cubing123",
]);

export type PasswordProblem =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether a password is allowed, and if not, what to tell the person.
 *
 * Returns the message rather than a code because every failure here is
 * something a human reads while mildly annoyed, and the message should say what
 * to do instead of naming a rule.
 */
export function checkPassword(password: string): PasswordProblem {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Passwords can be at most ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      reason: "That password is one of the most commonly used ones. Pick another.",
    };
  }
  return { ok: true };
}

/**
 * Hashes a password for storage.
 *
 * The salt is fresh per password and stored beside the hash in the clear, which
 * is what a salt is for: it is not a secret, it exists so that two people who
 * chose the same password do not get the same hash, and so that one precomputed
 * table cannot attack every row at once.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Checks a password against a stored hash.
 *
 * Three things this does that a naive version does not:
 *
 * **It reads the parameters back out of the stored string** rather than assuming
 * the current ones. A row hashed before the cost was raised still verifies;
 * without this, raising the cost would lock out everybody who had not signed in
 * since.
 *
 * **It compares in constant time.** A `===` on the two hashes leaks, through how
 * long it takes to fail, how many leading bytes were correct — which turns
 * guessing the hash from impossible into a few thousand requests. This is the
 * one place where the obvious code is genuinely, exploitably wrong.
 *
 * **It returns false instead of throwing on anything malformed.** A corrupt or
 * truncated hash column is an authentication failure, not a 500. Throwing here
 * would turn one bad row into an error page that reveals a bad row exists.
 *
 * ## What the tests do not cover, stated rather than implied
 *
 * The constant-time comparison is the one property in this file that the test
 * suite cannot check. Replacing `timingSafeEqual` with `derived.equals(expected)`
 * was tried deliberately: all thirty-seven tests still pass, because both return
 * the same boolean and the difference is measured in nanoseconds on a machine
 * that is also doing other things.
 *
 * Writing a timing test anyway would produce a check that fails on a loaded CI
 * runner and passes when the bug is present — worse than no check, because it
 * would be believed. So the guard here is review, not a test, and this paragraph
 * exists so that the next person to touch this line knows the suite will not
 * catch them.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 2 || r < 1 || p < 1) return false;

  // A stored row could in principle name parameters far beyond what this process
  // will spend. Refusing is correct: attempting them is a denial of service
  // against ourselves, triggered by a value read out of the database.
  if (128 * N * r > MAX_MEM) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }

  // `timingSafeEqual` throws rather than returning false when the lengths differ,
  // so the length is checked first — but note that `derived` was asked for
  // exactly `expected.length` bytes, so this can only differ if scrypt returned
  // something unexpected.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A hash of nothing in particular, for accounts that do not exist.
 *
 * Sign-in must take the same time whether the address is unknown, the account
 * is passkey-only, or the password is simply wrong. Skipping the hash when there
 * is no password to check makes "no such user" measurably faster than "wrong
 * password", and that difference is a working account-enumeration oracle: an
 * attacker learns which addresses are registered without ever guessing a
 * password.
 *
 * So the caller hashes against this instead of returning early. It is generated
 * once at module load with the current parameters, so it stays honest if the
 * cost changes.
 *
 * See `verifyPasswordOrBurn`.
 */
let dummyHash: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64"));
  return dummyHash;
}

/**
 * Verifies a password, spending the same work when there is nothing to verify.
 *
 * This is the function sign-in should call. `verifyPassword` returns false
 * immediately on a null hash, which is right for its own contract and wrong for
 * a sign-in path, where returning immediately is the leak.
 */
export async function verifyPasswordOrBurn(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (stored) return verifyPassword(password, stored);
  await verifyPassword(password, await getDummyHash());
  return false;
}

/**
 * Whether a stored hash was made with parameters this module has since moved on
 * from.
 *
 * Sign-in is the only moment the plaintext is available, so it is the only
 * moment an upgrade is possible. A caller that sees true here re-hashes and
 * stores the result — which is how the whole table migrates to stronger
 * parameters without anybody being asked to do anything, and without a flag day.
 */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return (
    Number(parts[1]) !== SCRYPT_N ||
    Number(parts[2]) !== SCRYPT_R ||
    Number(parts[3]) !== SCRYPT_P
  );
}
