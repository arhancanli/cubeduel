/**
 * Handles — the name in `/u/<handle>`, and the only thing most players will ever
 * see of another account.
 *
 * Kept pure and separate from the database layer because the rules are worth
 * testing on their own: a handle is a permanent, public, user-supplied identifier
 * that lands directly in a URL path, and every one of those words is a way to get
 * it wrong.
 */

export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 24;

/**
 * Must match the CHECK constraint on `profiles.handle` exactly. Two definitions
 * of "valid" that drift apart would show up as a confusing 500 on a name the UI
 * had already told the player was fine.
 */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/;

/**
 * Names that must never belong to a player.
 *
 * Two separate reasons, and both matter. Route names (`timer`, `leaderboard`)
 * would collide with real pages if the app ever serves profiles from the root.
 * The rest are impersonation: an account called `admin` or `support` can ask
 * other players for things, and nothing in the UI would contradict it.
 */
const RESERVED = new Set([
  // Routes that exist or plausibly will.
  "about",
  "account",
  "api",
  "daily",
  "duel",
  "duels",
  "help",
  "leaderboard",
  "leaderboards",
  "learn",
  "login",
  "logout",
  "play",
  "privacy",
  "profile",
  "progress",
  "ranked",
  "settings",
  "signin",
  "signout",
  "signup",
  "terms",
  "timer",
  "train",
  "u",
  // Authority.
  "admin",
  "administrator",
  "cubeduel",
  "mod",
  "moderator",
  "official",
  "root",
  "staff",
  "support",
  "system",
  "team",
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle.toLowerCase());
}

/** Whether a handle is one a player may actually hold. */
export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle) && !isReservedHandle(handle);
}

/**
 * Best-effort conversion of arbitrary text into a legal handle.
 *
 * Used to seed a handle from whatever Clerk knows about a new account, so nobody
 * is stopped at a naming form before they can do anything. Returns null when
 * there is nothing usable left, and the caller falls back to a generated name.
 */
export function sanitizeHandle(input: string): string | null {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so "Ünal" becomes "unal" rather than losing the letter.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    // Collapse and trim the separators the previous step can leave behind.
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, MAX_HANDLE_LENGTH)
    // Slicing can re-expose a trailing separator, which the pattern forbids.
    .replace(/[-_]+$/g, "");

  if (base.length < MIN_HANDLE_LENGTH) return null;
  return HANDLE_PATTERN.test(base) ? base : null;
}

/**
 * Why a handle was refused, phrased for the player rather than for the log.
 * Returns null when the handle is fine.
 */
export function handleRejectionReason(handle: string): string | null {
  const trimmed = handle.trim();
  if (trimmed.length < MIN_HANDLE_LENGTH) {
    return `Handles are at least ${MIN_HANDLE_LENGTH} characters.`;
  }
  if (trimmed.length > MAX_HANDLE_LENGTH) {
    return `Handles are at most ${MAX_HANDLE_LENGTH} characters.`;
  }
  if (trimmed !== trimmed.toLowerCase()) {
    return "Handles are lowercase.";
  }
  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    return "Handles use letters, numbers, hyphens and underscores only.";
  }
  if (!/^[a-z0-9]/.test(trimmed) || !/[a-z0-9]$/.test(trimmed)) {
    return "Handles start and end with a letter or number.";
  }
  if (isReservedHandle(trimmed)) {
    return "That handle is reserved.";
  }
  return null;
}

/**
 * Candidate handles to try in order, for seeding a new account.
 *
 * The suffix is numeric and short rather than random, because this name is
 * permanent and public — `alex-2` reads like a person, `alex-f3a9c1` reads like a
 * database row. The caller stops at the first one the database accepts.
 */
export function handleCandidates(base: string, count = 12): string[] {
  const root = base.slice(0, MAX_HANDLE_LENGTH - 4).replace(/[-_]+$/g, "");
  const out = [base];
  for (let i = 2; out.length < count; i++) {
    const candidate = `${root}-${i}`;
    if (HANDLE_PATTERN.test(candidate) && !isReservedHandle(candidate)) {
      out.push(candidate);
    }
    // Guard against a root so short that no suffix ever becomes legal.
    if (i > count * 4) break;
  }
  return out;
}

/**
 * A handle for an account we know nothing usable about. Deliberately readable —
 * this is a name a real person is going to be stuck with until they change it.
 */
export function fallbackHandle(seed: string): string {
  const suffix = seed.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "000000";
  return `cuber-${suffix}`.slice(0, MAX_HANDLE_LENGTH);
}
