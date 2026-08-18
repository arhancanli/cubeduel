import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

import { isValidHandle } from "../handle";
import { db } from "./supabase";
import { createProfileFor, profileFor, type Profile } from "./profileStore";

export type { Profile };

/**
 * Clerk owns who someone is; this table owns who they are *here* — the handle,
 * the public page, and the rows every rating and solve hang off.
 *
 * The two are joined on `clerk_user_id` rather than by copying Clerk's id into a
 * primary key, so a future move off Clerk changes one column instead of every
 * foreign key in the schema.
 */

/** The signed-in player's profile, or null. Never creates one. */
export async function currentProfile(): Promise<Profile | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return profileFor(userId);
}

/**
 * The signed-in player's profile, creating it on first sight.
 *
 * Nobody is stopped at a naming form. The app's whole stance is that an account
 * earns itself after someone already cares, so a handle is seeded from whatever
 * Clerk knows and can be changed later in settings. Being made to invent a
 * permanent public name before seeing a single screen is exactly the friction
 * that kills conversion.
 *
 * The creation itself — and the concurrency it has to survive — lives in
 * `profileStore.ts`, which knows nothing about Clerk and can therefore be tested
 * without a browser.
 */
export async function ensureProfile(): Promise<Profile | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await profileFor(userId);
  if (existing) return existing;

  // Only now is a Clerk Backend API call worth making — it is rate-limited and
  // the session already told us the id, which is all the common path needs.
  const user = await currentUser();
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.username ||
    "Cuber";

  return createProfileFor(userId, displayName, user?.username ?? null);
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
