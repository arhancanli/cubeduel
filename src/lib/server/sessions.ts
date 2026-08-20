import "server-only";

import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  hashTokenForPostgrest,
  newToken,
} from "../auth/tokens";
import { db } from "./supabase";

/**
 * Sessions, as rows.
 *
 * This module deliberately knows nothing about cookies, requests or Next.js. It
 * takes a token and gives back a user, or takes a user and gives back a token.
 * Reading the cookie is `currentUser.ts`'s job.
 *
 * That split is not tidiness, it is the same lesson `profileStore.ts` was
 * carved out for. Anything importing `next/headers` cannot be called outside a
 * request, which means it cannot be exercised by an integration script, which
 * means the only way to test it is to drive a browser — and the concurrency bug
 * that broke every new account's first page load was invisible until the logic
 * could be called directly. Session creation has exactly that shape, so it lives
 * exactly here.
 */

export interface SessionUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  hasPassword: boolean;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface SessionContext {
  user: SessionUser;
  session: ActiveSession;
}

export interface NewSession {
  /** The value that goes in the cookie. Never stored; only its hash is. */
  token: string;
  expiresAt: Date;
}

/**
 * How stale `last_seen_at` is allowed to get before a read bothers to write.
 *
 * Idle expiry needs `last_seen_at` to be roughly current, and the obvious
 * implementation updates it on every authenticated request — which turns every
 * page load into a database write, on the hot path, for a column whose value
 * only matters to the hour.
 *
 * So it is written at most once every fifteen minutes per session. The idle
 * window is seven days; being up to fifteen minutes optimistic about when
 * somebody was last seen costs nothing and removes almost all of the writes.
 */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Starts a session and returns the token for it.
 *
 * The token is generated here and returned once. It is never read back out of
 * the database, because it is not in the database — the column holds its
 * SHA-256. If the caller loses it, the session is unreachable and the correct
 * response is to make another one.
 */
export async function createSession(
  userId: string,
  context: { userAgent?: string | null; ip?: string | null } = {},
): Promise<NewSession | null> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);

  const { error } = await db()
    .from("sessions")
    .insert({
      user_id: userId,
      token_hash: hashTokenForPostgrest(token),
      expires_at: expiresAt.toISOString(),
      // Truncated because a user agent is attacker-controlled text of unbounded
      // length, and this column is only ever shown back to the person it
      // describes.
      user_agent: context.userAgent?.slice(0, 400) ?? null,
      ip: context.ip ?? null,
    });

  // Checked, not discarded. A swallowed error here hands back a token that
  // authenticates nothing, and the person sees a sign-in that appeared to work
  // and then silently did not — the single most confusing failure this system
  // can have. Returning null lets the caller say so.
  if (error) return null;

  return { token, expiresAt };
}

/**
 * Resolves a token to the person holding it, or null.
 *
 * Both expiry rules are enforced here rather than trusted to a sweep. A row that
 * has passed either one is treated as gone whether or not anything has deleted
 * it yet — because a cleanup job that fails silently must not quietly extend
 * everybody's sessions, and there is no cleanup job on this deployment at all.
 */
export async function sessionFromToken(token: string): Promise<SessionContext | null> {
  if (!token) return null;

  const { data, error } = await db()
    .from("sessions")
    .select(
      "id, user_id, created_at, last_seen_at, expires_at, user_agent, users(id, email, email_verified_at, password_hash)",
    )
    .eq("token_hash", hashTokenForPostgrest(token))
    .maybeSingle();

  // A read failure is not "signed out" — but it has to be treated as such,
  // because the alternative is letting somebody through unauthenticated. What
  // matters is that it is not treated as *proof* of anything: nothing downstream
  // deletes a session or a profile on the strength of this returning null.
  if (error || !data) return null;

  const now = Date.now();
  const expiresAt = new Date(data.expires_at).getTime();
  const lastSeenAt = new Date(data.last_seen_at).getTime();

  if (now >= expiresAt) return null;
  if (now - lastSeenAt >= SESSION_IDLE_MS) return null;

  // PostgREST returns an embedded one-to-one as an object, but its generated
  // types describe it as possibly an array. Normalising here keeps the cast in
  // one place instead of at every call site.
  const embedded = data.users as unknown;
  const user = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | {
        id: string;
        email: string;
        email_verified_at: string | null;
        password_hash: string | null;
      }
    | null
    | undefined;

  // A session whose user is gone. The foreign key cascades on delete so this
  // should be unreachable, and it is still checked — an unreachable state that
  // is nonetheless reached is exactly how a null lands in a template.
  if (!user) return null;

  if (now - lastSeenAt >= TOUCH_INTERVAL_MS) {
    // Deliberately not awaited-on for correctness: the session is already known
    // to be valid, and a failed touch costs a slightly stale timestamp, not
    // access. Awaiting it would put a write on the critical path of every page
    // load that happens to cross the interval.
    void db()
      .from("sessions")
      .update({ last_seen_at: new Date(now).toISOString() })
      .eq("id", data.id)
      .then(() => undefined);
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.email_verified_at,
      hasPassword: Boolean(user.password_hash),
    },
    session: {
      id: data.id,
      createdAt: data.created_at,
      lastSeenAt: data.last_seen_at,
      expiresAt: data.expires_at,
      userAgent: data.user_agent,
    },
  };
}

/**
 * Ends one session.
 *
 * Deleting rather than marking revoked. There is nothing to learn from a
 * tombstone here, and a row that still exists is a row some future query
 * forgets to filter.
 */
export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await db().from("sessions").delete().eq("token_hash", hashTokenForPostgrest(token));
}

/** Ends one session by its id — what the device list's "sign out" acts on. */
export async function revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
  const { error, count } = await db()
    .from("sessions")
    .delete({ count: "exact" })
    .eq("id", sessionId)
    // Scoped to the owner, so a guessed id from another account deletes nothing.
    // Without this the endpoint is a way to sign out any user on the site.
    .eq("user_id", userId);

  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * Ends every session for a user, optionally sparing the one making the request.
 *
 * This is what makes "sign out everywhere" true rather than decorative, and it
 * is the reason sessions are rows at all. It runs after a password change,
 * because a password change that leaves an attacker's existing session alive has
 * not actually taken the account back.
 */
export async function revokeAllSessions(
  userId: string,
  exceptToken?: string,
): Promise<void> {
  const query = db().from("sessions").delete().eq("user_id", userId);
  if (exceptToken) {
    await query.neq("token_hash", hashTokenForPostgrest(exceptToken));
    return;
  }
  await query;
}

/** The signed-in devices, newest activity first, for the settings page. */
export async function listSessions(userId: string): Promise<ActiveSession[]> {
  const { data, error } = await db()
    .from("sessions")
    .select("id, created_at, last_seen_at, expires_at, user_agent")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(50);

  // Returning an empty list on a read failure would tell somebody checking for
  // an intruder that there are no other sessions. That is the one answer this
  // function must never invent, so the failure is thrown to the caller instead.
  if (error) throw new Error(`Could not list sessions: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
  }));
}

/**
 * Deletes rows that can no longer authenticate anybody.
 *
 * Nothing depends on this having run — `sessionFromToken` refuses expired rows
 * on its own. This exists so the table does not grow forever, and it is safe to
 * call from anywhere at any time.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const idleCutoff = new Date(Date.now() - SESSION_IDLE_MS).toISOString();
  const { count, error } = await db()
    .from("sessions")
    .delete({ count: "exact" })
    .or(`expires_at.lte.${new Date().toISOString()},last_seen_at.lte.${idleCutoff}`);

  if (error) return 0;
  return count ?? 0;
}
