import "server-only";

import {
  fallbackHandle,
  handleCandidates,
  isValidHandle,
  sanitizeHandle,
} from "../handle";
import { db } from "./supabase";
import type { Row } from "./database.types";

export type Profile = Row<"profiles">;

/**
 * Creating and finding profiles, with no idea who is signed in.
 *
 * Split out from `profiles.ts` specifically so it can be tested. The Clerk layer
 * imports `@clerk/nextjs/server`, which drags in Next's client runtime and
 * cannot be loaded outside a request — so as long as the creation logic lived
 * next to it, the only way to exercise it was through a browser, and the thing
 * that most needed exercising was a concurrency bug that a browser reproduces
 * about one run in three.
 *
 * `scripts/integration-profile-race.mts` now hammers this directly.
 */

/** The profile for a Clerk user id, or null. Never creates one. */
export async function profileFor(userId: string): Promise<Profile | null> {
  const { data, error } = await db()
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  // A read failure here is not "no profile" — it would send an existing player
  // down the creation path and straight into a unique violation.
  if (error) throw new Error(`Could not read profile: ${error.message}`);
  return data ?? null;
}

/**
 * Finds or creates the profile for a Clerk user id.
 *
 * ## The race this is built around
 *
 * A signed-in page tree calls this from more than one place, so a first visit
 * fires several of them at once for someone who has no profile yet. They all
 * miss, they all insert, one wins, and the losers hit a unique index. Every
 * loser must end up returning the winner's row.
 *
 * There are two different unique indexes to lose on, and they mean opposite
 * things:
 *
 *   `clerk_user_id` — another request for *this same player* won. Its profile is
 *   the correct answer and this call should return it.
 *
 *   `handle` — a *different* player already has that name. This call should try
 *   the next candidate.
 *
 * Postgres reports both as 23505 but names the constraint it violated, so the
 * two are told apart by reading it rather than by guessing from a follow-up
 * lookup. That distinction matters for speed as well as correctness: a player
 * whose display name is already taken walks the whole candidate list, and
 * pausing to re-check for their own profile after each one would add seconds to
 * a first load for no reason — the conflict was never about them.
 *
 * When it *is* the id index, the lookup is retried briefly. The losing insert
 * learns about the conflict the moment the winner commits, and there is no
 * guarantee the row is visible to the very next statement on a pooled
 * connection. A few milliseconds on a path that runs once per account is a
 * cheap price for not showing a new player an error page.
 */
export async function createProfileFor(
  userId: string,
  displayName: string,
  usernameSeed: string | null = null,
): Promise<Profile> {
  const existing = await profileFor(userId);
  if (existing) return existing;

  const seed =
    sanitizeHandle(usernameSeed ?? "") ??
    sanitizeHandle(displayName) ??
    fallbackHandle(userId);

  for (const handle of handleCandidates(seed)) {
    if (!isValidHandle(handle)) continue;

    const { data, error } = await db()
      .from("profiles")
      .insert({ clerk_user_id: userId, handle, display_name: displayName })
      .select("*")
      .single();

    if (data) return data;

    if (isDuplicate(error, "clerk_user_id")) {
      const raced = await waitForProfile(userId);
      if (raced) return raced;
    }
    if (isDuplicate(error, "handle")) {
      continue; // Somebody else has that name; try the next candidate.
    }

    if (error) throw new Error(`Could not create profile: ${error.message}`);
  }

  // Every candidate collided, which for a numbered sequence means we are racing
  // rather than unlucky. Fall back to a name derived from the id itself, which
  // no other player can generate.
  const unique = fallbackHandle(userId);
  const { data, error } = await db()
    .from("profiles")
    .insert({ clerk_user_id: userId, handle: unique, display_name: displayName })
    .select("*")
    .single();

  if (data) return data;

  // This path used to throw straight through the race, which is how a new
  // account's first page load could render "Something broke". It is reached
  // whenever every candidate handle is taken — which is not exotic: a popular
  // display name gets there routinely, and then two concurrent first visits for
  // the same player both arrive here holding the same fallback handle.
  if (isDuplicate(error, "clerk_user_id")) {
    const raced = await waitForProfile(userId);
    if (raced) return raced;
  }

  throw new Error(`Could not create profile: ${error?.message ?? "no row returned"}`);
}

/**
 * Whether a failed write was a unique violation on a particular column.
 *
 * Postgres puts the constraint name in the message, and this app's indexes are
 * named after their columns, so `profiles_clerk_user_id_key` and
 * `profiles_handle_key` are distinguishable. Falls back to matching the bare
 * column name so a renamed index degrades to a coarser match rather than to
 * silently answering "no".
 */
function isDuplicate(
  error: { code?: string; message?: string } | null,
  column: string,
): boolean {
  if (error?.code !== "23505") return false;
  return (error.message ?? "").includes(column);
}

/**
 * Looks for the profile a moment after a conflict said it must exist.
 *
 * Bounded and short. If it is still missing after this, something other than the
 * race is wrong and the caller should fail loudly rather than loop.
 */
async function waitForProfile(userId: string, attempts = 4): Promise<Profile | null> {
  for (let i = 0; i < attempts; i++) {
    const found = await profileFor(userId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25 * (i + 1)));
  }
  return null;
}
