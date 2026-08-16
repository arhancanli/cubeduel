/**
 * Validation for a scramble arriving from a URL.
 *
 * `/play?scramble=...` is how one player hands another the exact puzzle they just
 * solved — the challenge link, and the cheapest growth mechanic this app has. It
 * also means untrusted text reaches an algorithm parser, so it is validated against
 * a strict token allowlist first rather than being passed through and hoped about.
 */

/**
 * A single move: optional layer count, a face or rotation, optional wide marker,
 * optional double or prime. Covers `R`, `U'`, `F2`, `Rw`, `3Fw'`, `M`, `x'`.
 */
const MOVE = /^(\d+)?([UDFBLRMESudfblrxyz])(w)?(['2]|2'|'2)?$/;

/*
 * Generous enough for a case setup, which is a scramble plus the moves that led to
 * the phase — routinely past 60. Still a hard bound: this is untrusted input headed
 * for an algorithm parser, and an unbounded string is a denial-of-service waiting to
 * happen.
 */
const MAX_MOVES = 150;

export function isValidScramble(input: string): boolean {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_MOVES) return false;
  return tokens.every((t) => MOVE.test(t));
}

/** Returns the normalised scramble, or null if it isn't one. */
export function parseScrambleParam(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return isValidScramble(cleaned) ? cleaned : null;
}
