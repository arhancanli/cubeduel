/**
 * The rules a club has to obey, kept away from the database so they can be
 * tested on their own.
 *
 * A club slug is a permanent, public, user-supplied identifier that lands
 * directly in a URL path — every one of those words is a way to get it wrong,
 * which is the same reasoning `handle.ts` was split out for. The two share a
 * character set on purpose: they are the only user-chosen strings in this
 * product that become URLs, and one set of rules is easier to hold to than two
 * that quietly drift apart.
 */

export const MIN_SLUG_LENGTH = 3;
export const MAX_SLUG_LENGTH = 32;
export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 60;
export const MAX_BIO_LENGTH = 280;

/**
 * How many clubs one account may create.
 *
 * Not a monetisation lever and not a guess at what anybody needs — it is the
 * cheapest thing standing between an open create endpoint and somebody
 * squatting every plausible school name in an afternoon. Five is far past what
 * a person running real clubs requires.
 */
export const MAX_CLUBS_PER_PERSON = 5;

/**
 * How many people a club may hold.
 *
 * Past a few hundred the thing being described is not a club, and the board
 * stops being a list somebody can find themselves on — which is the entire
 * reason it works as a reason to come back.
 */
export const MAX_MEMBERS = 500;

/** Must match the CHECK constraint on `clubs.slug` exactly. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])$/;

/**
 * Slugs that must never belong to a club.
 *
 * Route names first, because `/c/<slug>` and a future `/c/new` would collide.
 * Then impersonation: a club called `official` or `wca` can tell people things,
 * and nothing in the interface would contradict it.
 */
const RESERVED = new Set([
  "new",
  "create",
  "join",
  "edit",
  "settings",
  "admin",
  "api",
  "official",
  "cubeduel",
  "staff",
  "support",
  "wca",
  "worldcubeassociation",
  "moderator",
  "mod",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !isReservedSlug(slug);
}

/**
 * Why a slug was refused, phrased for the person rather than for the log.
 * Returns null when it is fine.
 */
export function slugRejectionReason(slug: string): string | null {
  const trimmed = slug.trim();
  if (trimmed.length < MIN_SLUG_LENGTH) {
    return `Club addresses are at least ${MIN_SLUG_LENGTH} characters.`;
  }
  if (trimmed.length > MAX_SLUG_LENGTH) {
    return `Club addresses are at most ${MAX_SLUG_LENGTH} characters.`;
  }
  if (trimmed !== trimmed.toLowerCase()) {
    return "Club addresses are lowercase.";
  }
  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    return "Club addresses use letters, numbers, hyphens and underscores only.";
  }
  if (!/^[a-z0-9]/.test(trimmed) || !/[a-z0-9]$/.test(trimmed)) {
    return "Club addresses start and end with a letter or number.";
  }
  if (isReservedSlug(trimmed)) {
    return "That address is reserved.";
  }
  return null;
}

export function nameRejectionReason(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH) return "Give the club a name.";
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Club names are at most ${MAX_NAME_LENGTH} characters.`;
  }
  return null;
}

/**
 * Turns a club name into a usable address.
 *
 * Best effort, and the caller falls back to asking. Nobody should be stopped at
 * a form inventing a URL for something they have already named.
 */
export function slugFromName(name: string): string | null {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so "Münster" becomes "munster" rather than losing
    // the letter entirely.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // Slicing can re-expose a trailing separator, which the pattern forbids.
    .replace(/[-_]+$/g, "");

  return isValidSlug(base) ? base : null;
}

/**
 * A join code: short, lowercase, and unambiguous when read aloud.
 *
 * The alphabet deliberately omits `i`, `l`, `o`, `0` and `1`. These get typed
 * off a whiteboard and repeated across a room, and a code nobody can dictate is
 * a code that does not spread — which is the only thing it is for.
 */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const JOIN_CODE_LENGTH = 8;

export function generateJoinCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Reads a code somebody typed, however they typed it.
 *
 * People paste the whole invite URL, add spaces, capitalise, and hyphenate in
 * groups of four. All of that is the same code, and refusing it teaches them
 * the product is fussy rather than that they made a mistake.
 */
export function normaliseJoinCode(input: string): string | null {
  const fromUrl = input.trim().split(/[?#]/)[0].split("/").pop() ?? "";
  const cleaned = fromUrl.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.length < 6 || cleaned.length > 12) return null;
  return cleaned;
}

export type ClubRole = "owner" | "member";

export interface ClubMemberStanding {
  handle: string;
  displayName: string;
  role: ClubRole;
  /** Null until the ladder will publish one. Never a zero. */
  rating: number | null;
  deviation: number | null;
  solveCount: number;
}

/**
 * Orders a club board.
 *
 * Rated members first, best rating first. Unrated members follow, ordered by
 * how close they are to being rated — because on a small board the interesting
 * question for most people is not "who is best" but "how far am I from
 * appearing at all", and sorting them alphabetically answers nothing.
 *
 * An unrated member is never given a position number. They are listed, which is
 * the point of a club, but a rank implies a comparison the ladder has refused
 * to make.
 */
export function orderStandings(members: ClubMemberStanding[]): ClubMemberStanding[] {
  return [...members].sort((a, b) => {
    if (a.rating !== null && b.rating !== null) return b.rating - a.rating;
    if (a.rating !== null) return -1;
    if (b.rating !== null) return 1;
    // Both unrated: closest to being rated first.
    if (b.solveCount !== a.solveCount) return b.solveCount - a.solveCount;
    return a.handle.localeCompare(b.handle);
  });
}

/** How many of a club's members the ladder will actually publish a rating for. */
export function ratedCount(members: ClubMemberStanding[]): number {
  return members.filter((m) => m.rating !== null).length;
}
