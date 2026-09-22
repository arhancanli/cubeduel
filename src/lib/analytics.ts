"use client";

/**
 * The measurements this product has never had.
 *
 * Every judgement about cubeduel so far — what to build, what was working,
 * what to fix — has been made without knowing whether anybody who lands here
 * completes a solve, comes back for a second session, or is here tomorrow.
 * This is the smallest thing that answers those three questions and nothing
 * else.
 *
 * ## What it deliberately does not do
 *
 * No third party is involved and no script is loaded from anywhere. There is no
 * page-view counter, no funnel builder, no session replay and no way to ask a
 * question that was not decided in advance — the event names are a fixed list
 * below, and adding one is a code change somebody reviews.
 *
 * That is a real constraint and it is the point. An analytics tool that can
 * answer any question later is one that must collect everything now.
 *
 * ## Privacy, as rules rather than as a promise
 *
 * - The identifier is a random value in `localStorage`. Not a cookie, not a
 *   fingerprint, not derived from anything about the person. Clearing site data
 *   clears it, and the next visit is a new visitor.
 * - **Do Not Track and Global Privacy Control are honoured.** A visitor who
 *   sets either is never given an identifier and never sends an event. Not
 *   sampled, not anonymised — nothing happens at all.
 * - No IP address is recorded. `events` has no column for one, which is a
 *   stronger guarantee than a policy.
 * - Nothing a person typed is ever a property. The values below are all fixed
 *   strings chosen at the call site.
 */

const VISITOR_KEY = "cubeduel.visitor.v1";
const SESSION_KEY = "cubeduel.session.v1";
const LAST_SEEN_KEY = "cubeduel.lastSeen.v1";

/**
 * How long a gap ends a session.
 *
 * Thirty minutes is the convention, and the reason it matters here is `run 2`:
 * the metric that decides whether this product works is whether somebody
 * *starts again*, and that is only meaningful if "again" is defined. Without a
 * boundary, one person cubing all afternoon and one person returning three
 * times look identical.
 */
const SESSION_GAP_MS = 30 * 60 * 1000;

// The list itself lives in `analyticsEvents.ts`, which carries no directive.
// A server module importing a `"use client"` module gets a client-reference
// proxy rather than the value, so the route that validates against this list
// threw on every request and the whole measurement layer silently recorded
// nothing. Re-exported here so call sites still have one import.
import type { EventName, EventProps } from "./analyticsEvents";

export { EVENTS, isKnownEvent, type EventName, type EventProps } from "./analyticsEvents";

/**
 * Whether this visitor has asked not to be measured.
 *
 * Checked before an identifier is even generated, so opting out means there is
 * nothing to opt out *of* rather than a flag on a record that exists anyway.
 */
function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;

  const nav = navigator as Navigator & {
    doNotTrack?: string | null;
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string | null;
  };
  const win = window as Window & { doNotTrack?: string | null };

  if (nav.globalPrivacyControl === true) return true;
  for (const signal of [nav.doNotTrack, win.doNotTrack, nav.msDoNotTrack]) {
    if (signal === "1" || signal === "yes") return true;
  }

  // A browser driven by software is not a visitor. The WebDriver standard makes
  // every automated browser say so — Playwright, Selenium, Puppeteer, and the
  // headless crawlers built on them — and without this, each run of this
  // project's own browser suites against production arrived as a handful of
  // new visitors who solved once and never came back: exactly the pattern the
  // retention numbers exist to detect, manufactured by the tests.
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver === true) return true;

  return false;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readOrCreate(key: string): string | null {
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 8) return existing;
    const fresh = randomId();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Storage can be unavailable — private browsing, a blocked origin, a full
    // quota. Measurement is never worth breaking a page for, so this is a
    // silent no-op and the visit simply goes uncounted.
    return null;
  }
}

interface Identity {
  visitor: string;
  session: string;
  /** True when this call started a new session rather than continuing one. */
  fresh: boolean;
}

function identify(): Identity | null {
  if (optedOut()) return null;

  const visitor = readOrCreate(VISITOR_KEY);
  if (!visitor) return null;

  let session: string | null = null;
  let fresh = false;
  try {
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) ?? 0);
    const stored = localStorage.getItem(SESSION_KEY);

    if (!stored || !Number.isFinite(lastSeen) || Date.now() - lastSeen > SESSION_GAP_MS) {
      session = randomId();
      localStorage.setItem(SESSION_KEY, session);
      fresh = true;
    } else {
      session = stored;
    }
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  } catch {
    return null;
  }

  return { visitor, session, fresh };
}

/**
 * Records an event. Never throws, never blocks, never delays anything.
 *
 * `keepalive` so the request survives the page being closed — the last event of
 * a visit is the one most likely to be lost, and it is often the interesting
 * one. Failures are swallowed entirely: an offline visitor still gets a working
 * app, which is the whole design of this product.
 */
export function track(name: EventName, props?: EventProps): void {
  if (typeof window === "undefined") return;

  const identity = identify();
  if (!identity) return;

  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        visitor: identity.visitor,
        session: identity.session,
        props,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing here is worth a broken page.
  }
}

/**
 * Records an event at most once per session.
 *
 * For anything reported from an effect rather than from a click. React invokes
 * effects twice in development, a remount invokes them again, and fast refresh
 * invokes them a third time — so `join_view` was landing in the database twice
 * per visit, which would have halved the measured conversion of the sign-up
 * screen and made the claim experiment unreadable.
 *
 * Verified by looking at the rows, not at the request count. The two disagree.
 *
 * Deduping per *session* rather than per mount is also the more honest
 * definition: somebody who opens the sign-up screen three times in one visit
 * saw it once for the purpose of asking whether it convinced them.
 *
 * `sessionStorage`, so it clears with the tab — a new visit must be able to
 * report the same event again.
 */
export function trackOnce(name: EventName, props?: EventProps): void {
  if (typeof window === "undefined") return;

  const key = `cubeduel.once.${name}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage unavailable. Recording twice is better than not at all, and the
    // alternative is dropping the event entirely for private-browsing visitors.
  }

  track(name, props);
}

/**
 * Starts a session, once per visit.
 *
 * Called from the root layout so every entry point counts, and guarded by the
 * session boundary rather than by a mount flag — a single-page navigation must
 * not look like a new visit, and a return three hours later must not look like
 * the same one.
 */
export function startSession(): void {
  if (typeof window === "undefined") return;

  const identity = identify();
  if (!identity || !identity.fresh) return;

  track("session_start");
}
