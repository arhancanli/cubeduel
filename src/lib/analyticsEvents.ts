/**
 * The list of events that exist, in a module both sides can actually read.
 *
 * This lived in `analytics.ts` until the route handler that validates against
 * it started throwing `EVENTS.includes is not a function` on every request.
 * `analytics.ts` carries `"use client"`, and a server module importing one gets
 * a **client-reference proxy** rather than the value — the import resolves, the
 * type checks, and the thing that arrives at runtime is not an array.
 *
 * The consequences were worse than a broken endpoint. The allowlist is the only
 * control stopping a public, unauthenticated write path from being a free-text
 * store anybody can fill, and it never ran. And because the route then returned
 * 500 rather than recording, the entire measurement layer wrote nothing at all
 * while every screen dutifully reported events — visible only by looking at the
 * table and finding it empty.
 *
 * So the list lives here, with no directive, and both sides import it. Nothing
 * in this file may ever reference the DOM or the database.
 */

export const EVENTS = [
  /** A session started. The denominator for everything else. */
  "session_start",
  /** A solve was completed anywhere in the app. */
  "solve",
  /** The sign-up screen was seen. */
  "join_view",
  /** An account was created. */
  "signup",
  /** A passkey was registered. */
  "passkey_added",
  /** Somebody signed in. */
  "signin",
  /** A ranked attempt was issued — the moment somebody plays for the record. */
  "ranked_attempt",
  /** A rush run was started. */
  "rush_start",
] as const;

export type EventName = (typeof EVENTS)[number];

/** Bounded, non-identifying context. Fixed strings only, never user input. */
export type EventProps = Record<string, string | number | boolean>;

/**
 * Whether a name is one this application actually sends.
 *
 * A function rather than a bare `includes` at the call site, so the narrowing
 * is expressed once and the server cannot accidentally check a different thing
 * from the client.
 */
export function isKnownEvent(name: unknown): name is EventName {
  return typeof name === "string" && (EVENTS as readonly string[]).includes(name);
}
