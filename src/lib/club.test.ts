import assert from "node:assert/strict";
import test from "node:test";

import {
  JOIN_CODE_LENGTH,
  MAX_SLUG_LENGTH,
  generateJoinCode,
  isReservedSlug,
  isValidSlug,
  nameRejectionReason,
  normaliseJoinCode,
  orderStandings,
  ratedCount,
  slugFromName,
  slugRejectionReason,
  type ClubMemberStanding,
} from "./club";

const member = (
  handle: string,
  rating: number | null,
  solveCount = 0,
): ClubMemberStanding => ({
  handle,
  displayName: handle,
  role: "member",
  rating,
  deviation: rating === null ? null : 50,
  solveCount,
});

// --- slugs -----------------------------------------------------------------

test("valid slugs are accepted", () => {
  for (const slug of ["kings-cubing", "mit_cube", "cube3", "a1b", "x".repeat(MAX_SLUG_LENGTH)]) {
    assert.equal(isValidSlug(slug), true, slug);
  }
});

test("malformed slugs are refused", () => {
  for (const slug of [
    "", "ab", "-leading", "trailing-", "_under", "under_",
    "Upper", "has space", "has.dot", "x".repeat(MAX_SLUG_LENGTH + 1), "emoji🧩",
  ]) {
    assert.equal(isValidSlug(slug), false, `should refuse: ${slug}`);
  }
});

test("route names and authority words are reserved", () => {
  // `/c/new` would collide with a create page; `official` and `wca` can tell
  // people things nothing in the interface would contradict.
  for (const slug of ["new", "join", "admin", "official", "wca", "cubeduel"]) {
    assert.equal(isReservedSlug(slug), true, slug);
    assert.equal(isValidSlug(slug), false, slug);
  }
});

test("a refusal explains what to do", () => {
  assert.match(slugRejectionReason("ab") ?? "", /at least/);
  assert.match(slugRejectionReason("Upper") ?? "", /lowercase/);
  assert.match(slugRejectionReason("has space") ?? "", /letters, numbers/);
  assert.match(slugRejectionReason("-lead") ?? "", /start and end/);
  assert.match(slugRejectionReason("admin") ?? "", /reserved/);
  assert.equal(slugRejectionReason("kings-cubing"), null);
});

test("the rejection reason and the validator agree", () => {
  // Two definitions of "valid" that drift apart show up as a confusing failure
  // on a name the form already said was fine.
  for (const slug of ["ok-club", "ab", "Upper", "admin", "-lead", "fine_one", "has space"]) {
    assert.equal(
      slugRejectionReason(slug) === null,
      isValidSlug(slug),
      `disagreement on ${slug}`,
    );
  }
});

test("a slug can be derived from a name", () => {
  assert.equal(slugFromName("King's Cubing Club"), "king-s-cubing-club");
  assert.equal(slugFromName("MIT Cube"), "mit-cube");
  assert.equal(slugFromName("Münster Speedcubing"), "munster-speedcubing");
  assert.equal(slugFromName("  spaced  out  "), "spaced-out");
});

test("a derived slug never ends up malformed", () => {
  for (const name of ["!!!", "a", "🧩🧩🧩", "-", "admin", "x".repeat(200)]) {
    const slug = slugFromName(name);
    // Either usable or null — never something the database will reject.
    assert.ok(slug === null || isValidSlug(slug), `${name} -> ${slug}`);
  }
});

test("names are bounded at both ends", () => {
  assert.match(nameRejectionReason("") ?? "", /Give the club a name/);
  assert.match(nameRejectionReason("x".repeat(61)) ?? "", /at most/);
  assert.equal(nameRejectionReason("Kings Cubing"), null);
});

// --- join codes ------------------------------------------------------------

test("join codes avoid characters that cannot be dictated", () => {
  // These get read aloud across a room and copied off a whiteboard. i/l/o/0/1
  // are the pairs that get mistyped.
  const codes = Array.from({ length: 300 }, () => generateJoinCode());
  for (const code of codes) {
    assert.equal(code.length, JOIN_CODE_LENGTH);
    assert.doesNotMatch(code, /[ilo01]/, `ambiguous character in ${code}`);
    assert.match(code, /^[a-z0-9]+$/);
  }
});

test("join codes do not repeat in practice", () => {
  const seen = new Set(Array.from({ length: 2000 }, () => generateJoinCode()));
  assert.ok(seen.size > 1990, `${seen.size} distinct out of 2000`);
});

test("a code is read however somebody typed it", () => {
  // People paste the whole link, capitalise, and hyphenate in groups.
  const expected = "abcd2345";
  for (const input of [
    "abcd2345",
    "ABCD2345",
    "  abcd2345  ",
    "abcd-2345",
    "ABCD 2345",
    "https://cubeduel.app/c/join/abcd2345",
    "https://cubeduel.app/c/join/abcd2345?from=chat",
  ]) {
    assert.equal(normaliseJoinCode(input), expected, `failed on: ${input}`);
  }
});

test("nonsense is refused rather than coerced", () => {
  for (const input of ["", "abc", "!!!", "x".repeat(40)]) {
    assert.equal(normaliseJoinCode(input), null, `should refuse: ${input}`);
  }
});

// --- standings -------------------------------------------------------------

test("rated members come first, best first", () => {
  const ordered = orderStandings([
    member("c", 1500),
    member("a", null),
    member("b", 2100),
  ]);
  assert.deepEqual(ordered.map((m) => m.handle), ["b", "c", "a"]);
});

test("unrated members are listed, never ranked as zero", () => {
  // The failure this prevents: sorting by `rating ?? 0` puts every unrated
  // member below the worst rated one AND implies they were measured at the
  // bottom. They were not measured at all.
  const ordered = orderStandings([member("unrated", null, 4), member("rated", 300)]);
  assert.deepEqual(ordered.map((m) => m.handle), ["rated", "unrated"]);
  assert.equal(ordered[1].rating, null);
});

test("unrated members are ordered by how close they are to being rated", () => {
  // On a small board the live question is "how far am I from appearing",
  // which alphabetical order answers not at all.
  const ordered = orderStandings([
    member("barely", null, 2),
    member("nearly", null, 18),
    member("halfway", null, 9),
  ]);
  assert.deepEqual(ordered.map((m) => m.handle), ["nearly", "halfway", "barely"]);
});

test("ordering does not mutate its input", () => {
  const input = [member("a", 100), member("b", 200)];
  const before = input.map((m) => m.handle).join(",");
  orderStandings(input);
  assert.equal(input.map((m) => m.handle).join(","), before);
});

test("the rated count is the number the ladder would publish", () => {
  assert.equal(ratedCount([member("a", 1500), member("b", null), member("c", 900)]), 2);
  assert.equal(ratedCount([member("a", null)]), 0);
  assert.equal(ratedCount([]), 0);
});
