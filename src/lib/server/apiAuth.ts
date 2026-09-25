import "server-only";

import { ensureProfile, type Profile } from "./profiles";
import { isDatabaseConfigured } from "./supabase";

/**
 * The preamble every write route needs: is the database even configured, is
 * someone signed in, and do they have a profile yet.
 *
 * Returned as a value rather than thrown so each route decides its own response
 * shape, and so the "no database configured" case degrades into a plain message
 * instead of a stack trace — the app is designed to work signed-out and offline,
 * and a missing backend should look like a missing feature, not a broken site.
 */
export type AuthedResult =
  | { ok: true; profile: Profile }
  | { ok: false; response: Response };

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * What the caller was trying to do, so the refusal can say something true.
 *
 * Every route used to answer "Sign in to play ranked", including the ones that
 * have nothing to do with ranked — syncing your practice history, or posting a
 * daily. A message that names the wrong feature is worse than a bare 401: it
 * sends people looking for a problem that is not there.
 */
export type ProtectedAction = "ranked" | "sync" | "daily" | "race" | "follow";

const SIGNED_OUT: Record<ProtectedAction, string> = {
  ranked: "Sign in to play ranked.",
  sync: "Sign in to sync your solves.",
  daily: "Sign in to post a daily result.",
  race: "Sign in to race.",
  follow: "Sign in to follow players.",
};

const UNAVAILABLE: Record<ProtectedAction, string> = {
  ranked: "Ranked play is not available right now.",
  sync: "Syncing is not available right now.",
  daily: "The daily board is not available right now.",
  race: "Racing is not available right now.",
  follow: "Following is not available right now.",
};

export async function requireProfile(
  action: ProtectedAction = "ranked",
): Promise<AuthedResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, response: jsonError(UNAVAILABLE[action], 503) };
  }

  let profile: Profile | null;
  try {
    profile = await ensureProfile();
  } catch {
    return { ok: false, response: jsonError("Could not load your profile.", 500) };
  }

  if (!profile) {
    return { ok: false, response: jsonError(SIGNED_OUT[action], 401) };
  }

  return { ok: true, profile };
}

/** Parses a JSON body without letting a malformed one become a 500. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
