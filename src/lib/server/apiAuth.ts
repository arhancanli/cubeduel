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

export async function requireProfile(): Promise<AuthedResult> {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      response: jsonError("Ranked play is not available right now.", 503),
    };
  }

  let profile: Profile | null;
  try {
    profile = await ensureProfile();
  } catch {
    return { ok: false, response: jsonError("Could not load your profile.", 500) };
  }

  if (!profile) {
    return { ok: false, response: jsonError("Sign in to play ranked.", 401) };
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
