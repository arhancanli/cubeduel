import "server-only";

import { currentSession } from "./currentUser";

import { isValidHandle } from "../handle";
import { db } from "./supabase";
import { createProfileFor, profileFor, type Profile } from "./profileStore";

export type { Profile };

/**
 * `users` owns who someone is; this table owns who they are *here* — the handle,
 * the public page, and the rows every rating and solve hang off.
 *
 * The two are joined on `profiles.user_id` rather than by making the account id
 * the profile's primary key. That was true when identity came from Clerk and it
 * stays true now: the account is the thing that can be deleted, replaced, or
 * migrated again, and none of that should reach a foreign key on a solve.
 *
 * The move off Clerk cost exactly the one column the original comment here
 * promised it would.
 */

/** The signed-in player's profile, or null. Never creates one. */
export async function currentProfile(): Promise<Profile | null> {
  const session = await currentSession();
  if (!session) return null;
  return profileFor(session.user.id);
}

/**
 * The signed-in player's profile, creating it on first sight.
 *
 * Nobody is stopped at a naming form. The app's whole stance is that an account
 * earns itself after someone already cares, so a handle is seeded from the
 * address and can be changed later in settings. Being made to invent a
 * permanent public name before seeing a single screen is exactly the friction
 * that kills conversion.
 *
 * The creation itself — and the concurrency it has to survive — lives in
 * `profileStore.ts`, which knows nothing about Clerk and can therefore be tested
 * without a browser.
 */
export async function ensureProfile(): Promise<Profile | null> {
  const session = await currentSession();
  if (!session) return null;

  const existing = await profileFor(session.user.id);
  if (existing) return existing;

  // Seeded from the local part of the address. It used to come from Clerk's
  // profile — a first name, a last name, a username — which meant a round trip
  // to a rate-limited third-party API on somebody's very first page load.
  //
  // The address is already in hand, and a handle derived from it is no worse:
  // both are a starting point nobody chose, and both are changed in settings.
  // What matters is that nobody is stopped at a naming form before they have
  // seen the product.
  const local = session.user.email.split("@")[0] ?? "";
  const displayName = local.trim() || "Cuber";

  return createProfileFor(session.user.id, displayName, local || null);
}

/** Public lookup for `/u/<handle>`. Case-insensitive, since URLs get retyped. */
export async function profileByHandle(handle: string): Promise<Profile | null> {
  const normalised = handle.trim().toLowerCase();
  if (!isValidHandle(normalised)) return null;

  const { data } = await db()
    .from("profiles")
    .select("*")
    .eq("handle", normalised)
    .maybeSingle();

  return data ?? null;
}

/**
 * Renames a profile. Returns an error message rather than throwing, because
 * every failure here is something the player needs to read.
 */
export async function updateHandle(
  profileId: string,
  handle: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalised = handle.trim().toLowerCase();
  if (!isValidHandle(normalised)) {
    return { ok: false, error: "That handle isn't available." };
  }

  const { error } = await db()
    .from("profiles")
    .update({ handle: normalised, updated_at: new Date().toISOString() })
    .eq("id", profileId);

  if (error?.code === "23505") {
    return { ok: false, error: "That handle is already taken." };
  }
  if (error) return { ok: false, error: "Could not save that. Try again." };
  return { ok: true };
}
