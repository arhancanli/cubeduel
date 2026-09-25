import "server-only";

import { ESTABLISHED_DEVIATION } from "../rating";
import { db } from "./supabase";

/**
 * Following: one-way, public, and only ever about what the follower sees.
 * Why it is shaped this way is in `supabase/migrations/0016_follows.sql`.
 */

/** Enough for every club-mate and rival anybody has; a bound so nobody can follow everyone. */
export const MAX_FOLLOWING = 500;

export type FollowResult =
  | { ok: true; following: boolean; followers: number }
  | { ok: false; status: number; error: string };

async function profileIdFor(handle: string): Promise<string | null> {
  const { data } = await db().from("profiles").select("id").eq("handle", handle.toLowerCase()).maybeSingle();
  return data?.id ?? null;
}

export async function followerCount(profileId: string): Promise<number> {
  const { count, error } = await db()
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("followee_id", profileId);
  if (error) throw new Error(`Could not count followers: ${error.message}`);
  return count ?? 0;
}

export async function followingCount(profileId: string): Promise<number> {
  const { count, error } = await db()
    .from("follows")
    .select("followee_id", { count: "exact", head: true })
    .eq("follower_id", profileId);
  if (error) throw new Error(`Could not count follows: ${error.message}`);
  return count ?? 0;
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const { data } = await db()
    .from("follows")
    .select("followee_id")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  return data !== null;
}

/**
 * Follow or unfollow by handle. Idempotent both ways: following somebody you
 * already follow, or unfollowing somebody you do not, is a success that
 * changes nothing — a double-tap must not become an error message.
 */
export async function setFollowing(followerId: string, handle: string, follow: boolean): Promise<FollowResult> {
  const followeeId = await profileIdFor(handle);
  if (followeeId === null) return { ok: false, status: 404, error: "There is no player with that handle." };
  if (followeeId === followerId) return { ok: false, status: 400, error: "You can't follow yourself." };

  if (follow) {
    if (!(await isFollowing(followerId, followeeId)) && (await followingCount(followerId)) >= MAX_FOLLOWING) {
      return { ok: false, status: 409, error: `You can follow up to ${MAX_FOLLOWING} players.` };
    }
    const { error } = await db()
      .from("follows")
      .upsert({ follower_id: followerId, followee_id: followeeId }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true });
    if (error) return { ok: false, status: 500, error: "Could not follow them." };
  } else {
    const { error } = await db().from("follows").delete().eq("follower_id", followerId).eq("followee_id", followeeId);
    if (error) return { ok: false, status: 500, error: "Could not unfollow them." };
  }

  return { ok: true, following: follow, followers: await followerCount(followeeId) };
}

export interface CircleEntry {
  handle: string;
  displayName: string;
  /** Null for somebody with no rating yet — still listed, below everyone rated. */
  rating: number | null;
  deviation: number | null;
  established: boolean;
  isYou: boolean;
}

/**
 * You and everyone you follow, on the same 3x3 keyboard ratings as the global
 * board. Nothing is re-scored for the smaller circle; the only difference is
 * that a provisional rating is shown — marked as one — because among people
 * you know, "roughly 1600, still settling" is worth seeing where on the global
 * board it would only be noise.
 */
export async function followingBoard(profileId: string): Promise<CircleEntry[]> {
  const { data, error } = await db().rpc("circle_board", { p_profile: profileId });
  if (error) throw new Error(`Could not load the circle: ${error.message}`);

  const entries = (data ?? []).map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
    rating: row.rating,
    deviation: row.rating === null ? null : row.deviation,
    established: row.rating !== null && row.deviation !== null && row.deviation <= ESTABLISHED_DEVIATION,
    isYou: row.is_you,
  }));
  entries.sort((a, b) => {
    if (a.rating === null || b.rating === null) {
      if (a.rating !== b.rating) return a.rating === null ? 1 : -1;
      return a.handle.localeCompare(b.handle);
    }
    return b.rating - a.rating;
  });
  return entries;
}

export interface CircleDaily {
  handle: string;
  displayName: string;
  durationMs: number;
  penalty: string;
  verified: boolean;
  isYou: boolean;
}

/** Today's daily for you and the people you follow, fastest first, DNFs last. */
export async function followingDaily(profileId: string, day: number): Promise<CircleDaily[]> {
  const { data, error } = await db().rpc("circle_daily", { p_profile: profileId, p_day: day });
  if (error) throw new Error(`Could not load the circle's daily: ${error.message}`);

  const rows = (data ?? []).map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
    durationMs: row.duration_ms,
    penalty: row.penalty,
    verified: row.verified,
    isYou: row.is_you,
  }));
  const effective = (r: CircleDaily) =>
    r.penalty === "DNF" ? Infinity : r.durationMs + (r.penalty === "PLUS2" ? 2000 : 0);
  // Two DNFs compare as NaN, which the sort treats as a tie — as it should.
  return rows.sort((a, b) => effective(a) - effective(b));
}
