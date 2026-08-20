import "server-only";

import { headers } from "next/headers";

import { db } from "./supabase";

/**
 * The shared preamble for the authentication routes.
 *
 * Kept apart from `apiAuth.ts` because that module's `requireProfile` is about
 * a player who is already signed in. These are the routes that get somebody
 * there, and they run for people who by definition have no session yet.
 */

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The caller's address, for rate limiting and for the device list.
 *
 * Only ever the FIRST entry of `x-forwarded-for`. The header is a comma-joined
 * chain that anything upstream may append to, and a client can send one of its
 * own — so taking the last entry, or the whole string, lets somebody choose
 * what they are rate limited as. On Vercel the leftmost entry is the one the
 * platform stamps.
 *
 * Never used to authenticate anything. It is a hint for counting, and a hint a
 * client can influence must not be load-bearing.
 */
export async function callerIp(): Promise<string | null> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first && first.length > 0 && first.length < 64 ? first : null;
}

export async function callerUserAgent(): Promise<string | null> {
  const store = await headers();
  // Truncated because a user agent is attacker-controlled text of unbounded
  // length, and this is only ever shown back to the person it describes.
  return store.get("user-agent")?.slice(0, 400) ?? null;
}

/**
 * Records that a sign-in was attempted, and how it went.
 *
 * Successes are recorded as well as failures, and that is the point rather than
 * completeness for its own sake. Counting only failures sounds tidier and
 * quietly breaks the defence: somebody spraying one common password across many
 * accounts fails at most once per account and never trips a per-account failure
 * counter — which is precisely the attack that works at scale.
 */
export async function recordAttempt(
  email: string | null,
  ip: string | null,
  succeeded: boolean,
): Promise<void> {
  await db()
    .from("auth_attempts")
    .insert({ email, ip, succeeded })
    // Ignored deliberately. A failure to write an audit row must not fail the
    // sign-in it was auditing; the rate limit degrades, the person gets in.
    .then(() => undefined);
}

/**
 * How many attempts have been made recently against an address, or from an
 * address.
 *
 * Returns null when it cannot tell, and every caller treats null as "over the
 * limit". `count ?? 0` here would read as "nothing yet" and turn a database
 * blip into no rate limit at all — the failing-open bug this codebase has
 * already shipped once.
 */
export const MAX_ATTEMPTS_PER_EMAIL = 10;
export const MAX_ATTEMPTS_PER_IP = 30;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export async function attemptsRecently(
  column: "email" | "ip",
  value: string,
): Promise<number | null> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const { count, error } = await db()
    .from("auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .gte("created_at", since);

  if (error) return null;
  return count ?? 0;
}

/**
 * Whether this caller has tried too often.
 *
 * Both dimensions are checked. Per-address alone lets one machine work through
 * a list of addresses; per-address-of-origin alone lets a botnet grind one
 * account. Neither is sufficient and together they are awkward to route around.
 */
export async function tooManyAttempts(
  email: string | null,
  ip: string | null,
): Promise<boolean> {
  if (email) {
    const byEmail = await attemptsRecently("email", email);
    if (byEmail === null || byEmail >= MAX_ATTEMPTS_PER_EMAIL) return true;
  }
  if (ip) {
    const byIp = await attemptsRecently("ip", ip);
    if (byIp === null || byIp >= MAX_ATTEMPTS_PER_IP) return true;
  }
  return false;
}

/**
 * The one message every failed sign-in returns.
 *
 * Identical for a wrong password, an unknown address, and an account that has
 * only a passkey. Anything more specific answers "does this person have an
 * account here?" to whoever asks, which turns a leaked address list into a list
 * of this site's users.
 */
export const SIGN_IN_REFUSAL = "That email and password do not match.";
