import "server-only";

import { SESSION_IDLE_MS, hashTokenForPostgrest } from "../auth/tokens";
import { currentSessionToken } from "./currentUser";
import { db } from "./supabase";

/**
 * Who is looking at the page, in one query.
 *
 * `sessionFromToken` answers "is this token valid and whose is it", which is the
 * right question for a write path. The header asks a different one — "what name
 * do I put in the corner" — and answering it by calling that and then reading
 * `profiles` is two round trips to the database on every single page load.
 *
 * So this does it as one embedded read. PostgREST follows the foreign keys:
 * session to user to profile. The saving is not theoretical — each round trip
 * from the function region is a few hundred milliseconds, and this runs before
 * anybody can see whether they are signed in.
 *
 * ## Why the header does not use a server component
 *
 * Reading the session in the root layout would make every page in the app
 * dynamic, including the six that are currently prerendered as static — the
 * timer, the trainer, and the marketing surfaces that must stay fast. Clerk had
 * the same constraint and solved it the same way: the shell renders immediately
 * and the identity arrives a beat later.
 */

export interface Viewer {
  userId: string;
  email: string;
  emailVerified: boolean;
  handle: string | null;
  displayName: string | null;
}

interface EmbeddedProfile {
  handle: string;
  display_name: string;
}

interface EmbeddedUser {
  id: string;
  email: string;
  email_verified_at: string | null;
  profiles: EmbeddedProfile | EmbeddedProfile[] | null;
}

/** Normalises PostgREST's one-to-one embeds, which type as possibly an array. */
function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function currentViewer(): Promise<Viewer | null> {
  const token = await currentSessionToken();
  if (!token) return null;

  const { data, error } = await db()
    .from("sessions")
    .select(
      "expires_at, last_seen_at, users(id, email, email_verified_at, profiles(handle, display_name))",
    )
    .eq("token_hash", hashTokenForPostgrest(token))
    .maybeSingle();

  if (error || !data) return null;

  // Both expiry rules, applied here as well as in `sessionFromToken`. Reading
  // the session by a shortcut must not be a way to skip them — a viewer whose
  // session has lapsed has to look signed out everywhere, not merely on the
  // paths that took the long way round.
  const now = Date.now();
  if (now >= new Date(data.expires_at).getTime()) return null;
  if (now - new Date(data.last_seen_at).getTime() >= SESSION_IDLE_MS) return null;

  const user = first(data.users as unknown as EmbeddedUser);
  if (!user) return null;

  const profile = first(user.profiles);

  return {
    userId: user.id,
    email: user.email,
    emailVerified: user.email_verified_at !== null,
    handle: profile?.handle ?? null,
    displayName: profile?.display_name ?? null,
  };
}
