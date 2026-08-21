/**
 * Clubs against the real database.
 *
 *   npm run integration:clubs
 *
 * The checks that matter are the ones about who is on the board and what number
 * is beside them. A club leaderboard is only worth anything if it reads the SAME
 * verified ratings the global one does — a private board with friendlier numbers
 * is more flattering and completely worthless — and it must LIST members who
 * have no rating yet, because a beginner who joins and sees an empty board has
 * been told the club is not for them.
 *
 * It cleans up after itself.
 */
import { ESTABLISHED_DEVIATION } from "../src/lib/rating";
import { MAX_CLUBS_PER_PERSON } from "../src/lib/club";
import {
  clubBySlug,
  clubsFor,
  createClub,
  joinByCode,
  leaveClub,
  roleIn,
  rollJoinCode,
  standingsFor,
} from "../src/lib/server/clubs";
import { db } from "../src/lib/server/supabase";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

const SLUG = `probe-club-${Date.now().toString(36)}`;
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

async function cleanup() {
  await db().from("clubs").delete().like("slug", "probe-club-%");
  await cleanupProbes();
}

async function main() {
  console.log(`\n== setup ==`);
  await cleanup();

  const captain = await makeProbeProfile("club-captain", `capt-${Date.now().toString(36)}`, "Captain");
  const rated = await makeProbeProfile("club-rated", `rated-${Date.now().toString(36)}`, "Rated Member");
  const beginner = await makeProbeProfile("club-new", `newbie-${Date.now().toString(36)}`, "Beginner");
  check("three probe profiles exist", Boolean(captain && rated && beginner));

  // A published rating for one member, and a rating too imprecise to publish for
  // another — the two states the board has to tell apart.
  await db().from("ratings").insert([
    {
      profile_id: rated.profile.id, event: "333", pool: "keyboard",
      rating: 1850, deviation: ESTABLISHED_DEVIATION - 10, solve_count: 40,
    },
    {
      profile_id: beginner.profile.id, event: "333", pool: "keyboard",
      rating: 1200, deviation: ESTABLISHED_DEVIATION + 80, solve_count: 6,
    },
  ]);

  // -------------------------------------------------------------------------
  console.log("\n== creating a club ==");

  const created = await createClub(captain.profile.id, {
    name: "Probe Cubing Club",
    slug: SLUG,
  });
  check("the club was created", created.ok, created.ok ? "" : created.error);
  if (!created.ok) return;
  const club = created.value;

  check("the creator is its owner", (await roleIn(club.id, captain.profile.id)) === "owner");
  check("it has one member", club.memberCount === 1, String(club.memberCount));
  check("it has an invite code", /^[a-z0-9]{6,12}$/.test(club.joinCode), club.joinCode);
  check("the code avoids characters nobody can dictate", !/[ilo01]/.test(club.joinCode), club.joinCode);

  // -------------------------------------------------------------------------
  console.log("\n== the address is claimed exactly once ==");

  const duplicate = await createClub(captain.profile.id, { name: "Another", slug: SLUG });
  check("a taken address is refused", !duplicate.ok && duplicate.error.includes("taken"),
    duplicate.ok ? "created twice" : duplicate.error);

  const reserved = await createClub(captain.profile.id, { name: "Official", slug: "official" });
  check("a reserved address is refused", !reserved.ok);

  // -------------------------------------------------------------------------
  console.log("\n== joining by code ==");

  for (const member of [rated, beginner]) {
    const joined = await joinByCode(member.profile.id, club.joinCode);
    check(`${member.profile.handle} joined`, joined.ok, joined.ok ? "" : joined.error);
  }

  // Somebody who opens the invite twice is already in, and should be told so
  // warmly rather than shown an error.
  const again = await joinByCode(rated.profile.id, club.joinCode);
  check("joining twice is a success, not a duplicate", again.ok);

  const { count } = await db()
    .from("club_members")
    .select("profile_id", { count: "exact", head: true })
    .eq("club_id", club.id);
  check("...and it really did not create a second row", count === 3, `${count} members`);

  // The forms people actually paste.
  const messy = await joinByCode(beginner.profile.id, `  https://cubeduel.app/c/join/${club.joinCode.toUpperCase()}?from=chat  `);
  check("a pasted invite URL works", messy.ok, messy.ok ? "" : messy.error);

  // -------------------------------------------------------------------------
  console.log("\n== the board reads the real ratings ==");

  const standings = await standingsFor(club.id, "333", "keyboard");
  check("every member is listed", standings.length === 3, `${standings.length} listed`);

  const ratedRow = standings.find((s) => s.handle === rated.profile.handle);
  const beginnerRow = standings.find((s) => s.handle === beginner.profile.handle);
  const captainRow = standings.find((s) => s.handle === captain.profile.handle);

  check("the rated member shows their real rating", ratedRow?.rating === 1850, String(ratedRow?.rating));
  check(
    "a rating too imprecise to publish is shown as unrated, not as a number",
    beginnerRow?.rating === null,
    String(beginnerRow?.rating),
  );
  check(
    "...and they are still LISTED, which is the point of a club",
    Boolean(beginnerRow),
  );
  check("a member with no rating row at all is unrated, not zero", captainRow?.rating === null,
    String(captainRow?.rating));

  check("rated members sort above unrated ones", standings[0].handle === rated.profile.handle,
    standings.map((s) => s.handle).join(", "));

  // -------------------------------------------------------------------------
  console.log("\n== rolling the invite code ==");

  const oldCode = club.joinCode;
  const rolled = await rollJoinCode(club.id, captain.profile.id);
  check("an owner can roll the code", rolled.ok, rolled.ok ? "" : rolled.error);
  check("the new code is different", rolled.ok && rolled.value !== oldCode);

  const stale = await joinByCode(rated.profile.id, oldCode);
  check("the old code stops working", !stale.ok, stale.ok ? "still worked" : stale.error);

  const notOwner = await rollJoinCode(club.id, rated.profile.id);
  check("a member cannot roll the code", !notOwner.ok, notOwner.ok ? "allowed" : notOwner.error);

  // -------------------------------------------------------------------------
  console.log("\n== leaving ==");

  const left = await leaveClub(beginner.profile.id, club.id);
  check("a member can leave", left.ok, left.ok ? "" : left.error);
  check("...and is gone from the board",
    !(await standingsFor(club.id, "333", "keyboard")).some((s) => s.handle === beginner.profile.handle));

  const lastOwner = await leaveClub(captain.profile.id, club.id);
  check("the only owner cannot leave", !lastOwner.ok, lastOwner.ok ? "allowed" : lastOwner.error);
  check("...and is still an owner", (await roleIn(club.id, captain.profile.id)) === "owner");

  // -------------------------------------------------------------------------
  console.log("\n== the creation cap ==");

  {
    let made = 1; // the club above
    for (let i = 0; i < MAX_CLUBS_PER_PERSON + 2; i++) {
      const extra = await createClub(captain.profile.id, {
        name: `Extra ${i}`,
        slug: `probe-club-x${i}-${Date.now().toString(36)}`,
      });
      if (extra.ok) made++;
    }
    check("club creation is capped", made === MAX_CLUBS_PER_PERSON, `${made} created`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== lookups ==");

  const found = await clubBySlug(SLUG.toUpperCase());
  check("the address is case-insensitive", found?.id === club.id);
  check("an unknown address is null, not an error", (await clubBySlug("no-such-club-here")) === null);
  check("a malformed address is null", (await clubBySlug("!!!")) === null);

  const mine = await clubsFor(captain.profile.id);
  check("the captain's clubs are listed", mine.length === MAX_CLUBS_PER_PERSON, `${mine.length}`);

  console.log("\n== cleanup ==");
  await cleanup();
}

main()
  .catch(async (error) => {
    console.error("\nUNCAUGHT:", error);
    failures++;
    await cleanup().catch(() => {});
  })
  .finally(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\nFAILURES: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
  });
