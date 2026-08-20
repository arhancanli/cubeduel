"use client";

import { useEffect, useState } from "react";

/**
 * Whether anybody is signed in, for client components.
 *
 * The direct replacement for Clerk's `useAuth`, and shaped the same way on
 * purpose: `loaded` before `signedIn`, so a caller cannot accidentally treat
 * "we do not know yet" as "signed out" and flash a sign-in button at somebody
 * who is already signed in.
 *
 * ## Fetched once per page load, shared by every caller
 *
 * The header wants this, the history sync wants it, and any screen that shows
 * an account-only control wants it. Left naive, that is three requests to a
 * database in Tokyo for one answer.
 *
 * So the promise is memoised at module scope. The second and third callers
 * await the same request the first one started, and mounting ten components
 * costs exactly one round trip. This is the whole reason the hook exists rather
 * than each component calling `fetch` itself.
 */

export interface Session {
  signedIn: boolean;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
}

const SIGNED_OUT: Session = {
  signedIn: false,
  handle: null,
  displayName: null,
  email: null,
  emailVerified: false,
};

let pending: Promise<Session> | null = null;

async function load(): Promise<Session> {
  try {
    const response = await fetch("/api/auth/session", {
      // The browser cache must not answer this. A cached "signed in" survives
      // signing out, and on a shared machine it survives the person.
      cache: "no-store",
    });
    if (!response.ok) return SIGNED_OUT;

    const body = (await response.json()) as Partial<Session> & { signedIn?: boolean };
    if (!body.signedIn) return SIGNED_OUT;

    return {
      signedIn: true,
      handle: body.handle ?? null,
      displayName: body.displayName ?? null,
      email: body.email ?? null,
      emailVerified: Boolean(body.emailVerified),
    };
  } catch {
    // Offline, which this app is explicitly built to survive. Treated as signed
    // out, because that is the state in which everything still works — solving,
    // the timer, the trainer and local history need no account at all.
    return SIGNED_OUT;
  }
}

function sessionOnce(): Promise<Session> {
  pending ??= load();
  return pending;
}

/**
 * Throws away the cached answer.
 *
 * Called after signing in or out, so the next read reflects what just happened
 * rather than what was true when the page loaded. Without it, signing out
 * leaves a header that still shows an account until a full reload.
 */
export function forgetSession(): void {
  pending = null;
}

export interface SessionState {
  /** False until the answer has arrived. Never treat it as "signed out". */
  loaded: boolean;
  session: Session;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    loaded: false,
    session: SIGNED_OUT,
  });

  useEffect(() => {
    let live = true;
    void sessionOnce().then((session) => {
      // Guarded because a component can unmount while the request is in flight,
      // and setting state on an unmounted component is a warning at best and a
      // leak at worst.
      if (live) setState({ loaded: true, session });
    });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
