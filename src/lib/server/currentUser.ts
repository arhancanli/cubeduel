import "server-only";

import { cookies } from "next/headers";

import {
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE_INSECURE,
  SESSION_COOKIE_SECURE,
} from "../auth/tokens";
import { SITE_URL } from "../site";
import { sessionFromToken, type SessionContext } from "./sessions";

/**
 * The cookie half of authentication — and the direct replacement for Clerk's
 * `auth()`.
 *
 * Everything that touches `next/headers` lives here and nowhere else, so that
 * `sessions.ts` underneath stays callable from a plain script. See the note at
 * the top of that file for why that boundary is worth keeping.
 */

/**
 * Whether this deployment can set a `Secure` cookie.
 *
 * Derived from `SITE_URL` — that is, from how the deployment was configured —
 * and deliberately never from the incoming request. `X-Forwarded-Proto` is a
 * header, headers are attacker-supplied, and a cookie whose security attributes
 * are chosen by the client is a cookie with no security attributes.
 */
const isSecure = SITE_URL.startsWith("https://");

/**
 * The cookie name in use.
 *
 * `__Host-` in production, plain over http locally. The prefix is a promise the
 * *browser* enforces: it refuses the cookie unless it is `Secure`, has no
 * `Domain`, and is pathed at `/`. That last pair is what makes it useful here —
 * it means a cookie arriving under this name cannot have been set by a
 * subdomain, which shuts down session fixation from anything sharing the
 * registrable domain.
 */
export function sessionCookieName(): string {
  return isSecure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_INSECURE;
}

/** The signed-in user and their session, or null. Never creates anything. */
export async function currentSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token) return null;
  return sessionFromToken(token);
}

/** Just the user id, for the many callers that want nothing else. */
export async function currentUserId(): Promise<string | null> {
  const context = await currentSession();
  return context?.user.id ?? null;
}

/** The raw token, for the paths that revoke or exempt the current session. */
export async function currentSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
}

/**
 * Attaches a session to the response.
 *
 * The attributes, and why each one:
 *
 * **`httpOnly`** — script cannot read it. This is what stops one cross-site
 * scripting bug anywhere on the site from becoming every visitor's account.
 *
 * **`secure`** — https only, so the token never crosses a network in the clear.
 *
 * **`sameSite: "lax"`** rather than `"strict"`. Strict is the reflex and it is
 * wrong here: it withholds the cookie on top-level navigations that originate
 * elsewhere, which means arriving from a verification email, or from a shared
 * challenge link, lands the person on a page that believes they are signed out.
 * They then sign in again, and the link they followed has lost its context. Lax
 * still withholds the cookie on cross-site *sub*-requests and form posts, which
 * is where the actual cross-site request forgery risk lives.
 *
 * **`path: "/"`** — required by the `__Host-` prefix, and correct regardless.
 *
 * **`maxAge`** matching the row's absolute expiry, so the browser discards a
 * cookie the server would refuse anyway. The server is still the authority; this
 * only saves a pointless round trip.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  });
}

/**
 * Removes the session cookie.
 *
 * Set to empty with `maxAge: 0` rather than deleted by name, because a delete
 * has to match the original attributes to take effect and getting that subtly
 * wrong leaves the old cookie in place — a sign-out that visibly succeeds and
 * actually did nothing.
 *
 * The row is deleted separately by `revokeSession`. Clearing the cookie alone
 * would leave a token that still authenticates anybody who kept a copy.
 */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
