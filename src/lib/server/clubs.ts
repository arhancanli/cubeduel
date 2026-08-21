import "server-only";

import {
  MAX_CLUBS_PER_PERSON,
  MAX_MEMBERS,
  generateJoinCode,
  isValidSlug,
  nameRejectionReason,
  normaliseJoinCode,
  orderStandings,
  slugRejectionReason,
  type ClubMemberStanding,
  type ClubRole,
} from "../club";
import { ESTABLISHED_DEVIATION } from "../rating";
import { db } from "./supabase";

/**
 * Clubs, against the database.
 *
 * The rules a club obeys live in `club.ts`, which knows nothing about Postgres
 * and can be tested without it. This is the half where the races are.
 *
 * ## The board reads the real ratings, and only the real ratings
 *
 * `standingsFor` queries the same `ratings` rows, with the same
 * `ESTABLISHED_DEVIATION` threshold, that the global leaderboard uses. There is
 * no club-local scoring and no way to appear on a club board on anything the
 * main ladder would refuse.
 *
 * The temptation to soften it is real — a private board with friendlier numbers
 * is more flattering — and it is exactly the thing that would make the feature
 * worthless. The whole claim of this product is that a rating means something.
 * A rating that means something different depending on who is looking does not.
 */

export interface Club {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  joinCode: string;
  createdAt: string;
  memberCount: number;
}

export type ClubOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

interface ClubRow {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  join_code: string;
  created_at: string;
}

function shape(row: ClubRow, memberCount: number): Club {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    bio: row.bio,
    joinCode: row.join_code,
    createdAt: row.created_at,
    memberCount,
  };
}

async function countMembers(clubId: string): Promise<number | null> {
  const { count, error } = await db()
    .from("club_members")
    .select("profile_id", { count: "exact", head: true })
    .eq("club_id", clubId);

  // Null means "could not tell", and every caller treats that as a refusal
  // rather than as zero. `count ?? 0` would read as "empty club", which is the
  // one answer that makes both the member cap and the ownership check fail open.
  if (error) return null;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/**
 * Creates a club and puts its creator in it as owner.
 *
 * Two writes, and the second one matters: a club whose creator is not a member
 * is a club nobody can administer, and it would be created by any failure
 * between the two statements. So a failed membership insert deletes the club
 * rather than leaving it stranded — the closest thing to a transaction that
 * PostgREST allows, and the failure it prevents is unrecoverable without
 * database access.
 */
export async function createClub(
  profileId: string,
  input: { name: string; slug: string; bio?: string },
): Promise<ClubOutcome<Club>> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();

  const nameProblem = nameRejectionReason(name);
  if (nameProblem) return { ok: false, error: nameProblem };

  const slugProblem = slugRejectionReason(slug);
  if (slugProblem) return { ok: false, error: slugProblem };
  if (!isValidSlug(slug)) return { ok: false, error: "That address is not usable." };

  // The cap, and it fails closed: if the count cannot be read we refuse rather
  // than allow, because the alternative turns a database blip into an open
  // create endpoint.
  const { count, error: countError } = await db()
    .from("clubs")
    .select("id", { count: "exact", head: true })
    .eq("created_by", profileId);

  if (countError) return { ok: false, error: "Could not create that club. Try again." };
  if ((count ?? 0) >= MAX_CLUBS_PER_PERSON) {
    return {
      ok: false,
      error: `You can create ${MAX_CLUBS_PER_PERSON} clubs. Leave or delete one first.`,
    };
  }

  const { data, error } = await db()
    .from("clubs")
    .insert({
      slug,
      name,
      bio: input.bio?.trim() || null,
      created_by: profileId,
      join_code: generateJoinCode(),
    })
    .select("id, slug, name, bio, join_code, created_at")
    .single();

  if (error) {
    // Told apart by constraint name, because the two mean opposite things to
    // the person: one is "pick another address", the other is "try again".
    if (error.code === "23505" && error.message.includes("slug")) {
      return { ok: false, error: "That address is taken." };
    }
    if (error.code === "23505") {
      // A join-code collision, which is a one-in-a-trillion retry rather than
      // anything the person did.
      return { ok: false, error: "Could not create that club. Try again." };
    }
    return { ok: false, error: "Could not create that club. Try again." };
  }

  const { error: memberError } = await db()
    .from("club_members")
    .insert({ club_id: data.id, profile_id: profileId, role: "owner" });

  if (memberError) {
    // Undone rather than left behind. A club with no owner cannot be renamed,
    // its code cannot be rolled, and its address is taken forever.
    await db().from("clubs").delete().eq("id", data.id);
    return { ok: false, error: "Could not create that club. Try again." };
  }

  return { ok: true, value: shape(data, 1) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function clubBySlug(slug: string): Promise<Club | null> {
  const normalised = slug.trim().toLowerCase();
  if (!isValidSlug(normalised)) return null;

  const { data, error } = await db()
    .from("clubs")
    .select("id, slug, name, bio, join_code, created_at")
    .eq("slug", normalised)
    .maybeSingle();

  if (error || !data) return null;

  const members = await countMembers(data.id);
  if (members === null) return null;
  return shape(data, members);
}

/**
 * The club board.
 *
 * One query per concern rather than one clever join: members, then their
 * ratings. PostgREST cannot express "left join ratings filtered by event and
 * pool" without dropping the members who have none — and those are precisely
 * the people a club exists to include. A club that silently hides its unrated
 * members shows a beginner an empty board on the day they join.
 */
export async function standingsFor(
  clubId: string,
  event: string,
  pool: "keyboard" | "smartcube",
): Promise<ClubMemberStanding[]> {
  const { data: members, error: memberError } = await db()
    .from("club_members")
    .select("profile_id, role, profiles!inner(handle, display_name)")
    .eq("club_id", clubId)
    .limit(MAX_MEMBERS);

  // Thrown rather than degraded to an empty list, for the same reason the
  // global board throws: "this club has no members" and "the database is
  // unreachable" are opposite facts, and rendering the first when the second is
  // true is the most misleading thing this page can do.
  if (memberError) throw new Error(`Could not load the club: ${memberError.message}`);
  if (!members || members.length === 0) return [];

  const ids = members.map((m) => m.profile_id);

  const { data: ratings, error: ratingError } = await db()
    .from("ratings")
    .select("profile_id, rating, deviation, solve_count")
    .in("profile_id", ids)
    .eq("event", event)
    .eq("pool", pool);

  if (ratingError) throw new Error(`Could not load ratings: ${ratingError.message}`);

  const byProfile = new Map(
    (ratings ?? []).map((r) => [r.profile_id, r]),
  );

  const standings: ClubMemberStanding[] = members.map((row) => {
    const embedded = row.profiles as unknown;
    const profile = (Array.isArray(embedded) ? embedded[0] : embedded) as {
      handle: string;
      display_name: string;
    };
    const rating = byProfile.get(row.profile_id);

    // The same threshold the global board applies, and applied here rather than
    // in the query so that a member with a rating that is not yet precise
    // enough is still LISTED — just without a number. Filtering them out in SQL
    // would hide the person, which is the opposite of what a club is for.
    const established =
      rating?.rating != null && rating.deviation <= ESTABLISHED_DEVIATION;

    return {
      handle: profile.handle,
      displayName: profile.display_name,
      role: row.role as ClubRole,
      rating: established ? Math.round(rating.rating as number) : null,
      deviation: rating ? Math.round(rating.deviation) : null,
      solveCount: rating?.solve_count ?? 0,
    };
  });

  return orderStandings(standings);
}

/** The clubs somebody belongs to, for the nav and their profile. */
export async function clubsFor(profileId: string): Promise<Club[]> {
  const { data, error } = await db()
    .from("club_members")
    .select("role, clubs!inner(id, slug, name, bio, join_code, created_at)")
    .eq("profile_id", profileId)
    .order("joined_at", { ascending: true });

  if (error) throw new Error(`Could not load your clubs: ${error.message}`);

  const clubs: Club[] = [];
  for (const row of data ?? []) {
    const embedded = row.clubs as unknown;
    const club = (Array.isArray(embedded) ? embedded[0] : embedded) as ClubRow | undefined;
    if (!club) continue;

    const members = await countMembers(club.id);
    clubs.push(shape(club, members ?? 0));
  }
  return clubs;
}

export async function roleIn(clubId: string, profileId: string): Promise<ClubRole | null> {
  const { data, error } = await db()
    .from("club_members")
    .select("role")
    .eq("club_id", clubId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;
  return data.role as ClubRole;
}

// ---------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------

export async function joinByCode(
  profileId: string,
  rawCode: string,
): Promise<ClubOutcome<Club>> {
  const code = normaliseJoinCode(rawCode);
  if (!code) return { ok: false, error: "That does not look like an invite code." };

  const { data: club, error } = await db()
    .from("clubs")
    .select("id, slug, name, bio, join_code, created_at")
    .eq("join_code", code)
    .maybeSingle();

  if (error || !club) return { ok: false, error: "No club has that code." };

  const members = await countMembers(club.id);
  if (members === null) return { ok: false, error: "Could not join right now. Try again." };
  if (members >= MAX_MEMBERS) {
    return { ok: false, error: "That club is full." };
  }

  const { error: joinError } = await db()
    .from("club_members")
    .insert({ club_id: club.id, profile_id: profileId, role: "member" });

  if (joinError) {
    // The primary key means a second join is a duplicate rather than a second
    // row — which is the point. Somebody who opens an invite twice, or has it
    // in two tabs, is already in and should be told so warmly.
    if (joinError.code === "23505") {
      return { ok: true, value: shape(club, members) };
    }
    return { ok: false, error: "Could not join right now. Try again." };
  }

  return { ok: true, value: shape(club, members + 1) };
}

/**
 * Leaves a club.
 *
 * The last owner cannot leave, for the same reason the last passkey cannot be
 * removed: it produces a state nobody can recover from without database access.
 * A club with members and no owner cannot be renamed, its code cannot be
 * rolled, and nobody can be removed from it.
 */
export async function leaveClub(
  profileId: string,
  clubId: string,
): Promise<ClubOutcome<null>> {
  const role = await roleIn(clubId, profileId);
  if (!role) return { ok: false, error: "You are not in that club." };

  if (role === "owner") {
    const { count, error } = await db()
      .from("club_members")
      .select("profile_id", { count: "exact", head: true })
      .eq("club_id", clubId)
      .eq("role", "owner");

    // Fails closed: if we cannot count the owners we must not remove one.
    if (error) return { ok: false, error: "Could not leave right now. Try again." };
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error: "You are the only owner. Make somebody else an owner first, or delete the club.",
      };
    }
  }

  const { error } = await db()
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("profile_id", profileId);

  if (error) return { ok: false, error: "Could not leave right now. Try again." };
  return { ok: true, value: null };
}

/**
 * Issues a new invite code, invalidating the old one.
 *
 * The reason this exists: an invite code is meant to be pasted into a group
 * chat, so it will eventually end up somewhere its owner did not intend. Being
 * able to replace it is what makes sharing it freely a reasonable thing to do.
 */
export async function rollJoinCode(
  clubId: string,
  profileId: string,
): Promise<ClubOutcome<string>> {
  const role = await roleIn(clubId, profileId);
  if (role !== "owner") return { ok: false, error: "Only an owner can do that." };

  const code = generateJoinCode();
  const { error } = await db()
    .from("clubs")
    .update({ join_code: code, updated_at: new Date().toISOString() })
    .eq("id", clubId);

  if (error) return { ok: false, error: "Could not change the code. Try again." };
  return { ok: true, value: code };
}
