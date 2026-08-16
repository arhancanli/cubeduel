import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

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

  const { data } = await db()
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  return data ?? null;
}

/**
 * The signed-in player's profile, creating it on first sight.
 *
 * Nobody is stopped at a naming form. The app's whole stance is that an account
 * earns itself after someone already cares, so a handle is seeded from whatever
 * Clerk knows and can be changed later in settings. Being made to invent a
 * permanent public name before seeing a single screen is exactly the friction
 * that kills conversion.
 */
export async function ensureProfile(): Promise<Profile | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await currentProfile();
  if (existing) return existing;

  // Only now is a Clerk Backend API call worth making — it is rate-limited and
  // the session already told us the id, which is all the common path needs.
  const user = await currentUser();
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.username ||
    "Cuber";

  const seed =
    sanitizeHandle(user?.username ?? "") ??
    sanitizeHandle(displayName) ??
    fallbackHandle(userId);

  // First-come-first-served on the name itself, then numbered variants. Trying
  // them one at a time and letting the unique index arbitrate is what makes this
  // correct under concurrency — a "is it taken?" check followed by an insert is
  // a race, and handles are permanent enough that losing one hurts.
  for (const handle of handleCandidates(seed)) {
    if (!isValidHandle(handle)) continue;

    const { data, error } = await db()
      .from("profiles")
      .insert({ clerk_user_id: userId, handle, display_name: displayName })
      .select("*")
      .single();

    if (data) return data;

    // 23505 is a unique violation. On `clerk_user_id` it means another request
    // for this same player won the race, and its profile is the right answer.
    if (error?.code === "23505") {
      const raced = await currentProfile();
      if (raced) return raced;
      continue; // The handle was taken by someone else; try the next one.
    }

    if (error) throw new Error(`Could not create profile: ${error.message}`);
  }

  // Every candidate collided, which for a numbered sequence means something is
  // badly wrong rather than unlucky. Fall back to a name that cannot collide.
  const unique = fallbackHandle(userId);
  const { data, error } = await db()
    .from("profiles")
    .insert({ clerk_user_id: userId, handle: unique, display_name: displayName })
    .select("*")
    .single();

  if (error) throw new Error(`Could not create profile: ${error.message}`);
  return data;
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
