/**
 * What counts as an acceptable password — the rules, with none of the crypto.
 *
 * This is split out from `password.ts` for a reason that cost a broken page:
 * that module imports `node:crypto` and `node:util`, and a client component
 * importing a single constant from it drags the whole thing into the browser
 * bundle. `promisify(scrypt)` then runs against a shim, throws
 * `The "original" argument must be of type Function`, and the page crashes on
 * load. `/reset` never rendered its form at all — the one page somebody reaches
 * when they have already lost access to their account.
 *
 * So the rules live here, with no imports of any kind, and both sides use them.
 * `password.ts` re-exports them so nothing that already worked has to change.
 *
 * The client can now check the same rules the server enforces, which is a real
 * gain rather than a consolation: a length refused after a round trip is worse
 * than one refused as it is typed, and both are now guaranteed to agree because
 * there is one definition.
 */

/**
 * The shortest password accepted.
 *
 * Eight, and no composition rules — no required symbol, no forced digit, no
 * mixed case. This follows NIST 800-63B, which dropped those after the evidence
 * came in: they push people toward `Password1!` and toward writing it down, and
 * they buy almost nothing against an attacker guessing from a leaked list
 * rather than from an alphabet.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * An upper bound, because scrypt will happily chew on a megabyte.
 *
 * A denial-of-service guard rather than a security rule: without it, a request
 * body full of text becomes minutes of CPU. 200 covers every passphrase a
 * person will genuinely use.
 */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Passwords common enough that allowing them is the same as allowing none.
 *
 * Deliberately short. A real breach-corpus check means shipping tens of
 * megabytes or sending a hash prefix to a third party on every sign-up, and
 * neither is worth it here — but the top of the list is where the overwhelming
 * majority of real guesses land. Cubing words are in it because this is a
 * cubing site and `speedcube` would otherwise be this site's `password1`.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyui", "qwerty123", "iloveyou", "sunshine", "princess", "football",
  "baseball", "welcome1", "admin123", "letmein1", "trustno1", "starwars",
  "abc12345", "monkey12", "dragon123", "superman", "michael1", "shadow12",
  "master12", "jennifer", "hello123", "freedom1", "whatever", "computer",
  "cubeduel", "speedcube", "rubikscube", "rubiks123", "cubing123",
]);

export type PasswordProblem = { ok: true } | { ok: false; reason: string };

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
