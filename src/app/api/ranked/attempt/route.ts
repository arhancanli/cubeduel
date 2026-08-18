import { DEFAULT_EVENT, isEventId } from "@/lib/events";
import { poolForSource } from "@/lib/rating";
import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { issueAttempt } from "@/lib/server/ranked";
import { db } from "@/lib/server/supabase";

/**
 * Hands out a ranked scramble.
 *
 * Note what is NOT in the request: the scramble. The client asks for an attempt
 * and is told what to solve, which is the whole reason ranked results here mean
 * anything.
 */

interface Body {
  event?: string;
  source?: string;
}



/**
 * Issuing a scramble costs a random-state generation, and an attempt left open
 * is recorded as a DNF — so spamming this is both expensive for us and ruinous
 * for the spammer. The cap is here to stop the expensive half.
 */
const MAX_ATTEMPTS_PER_MINUTE = 20;

export async function POST(request: Request) {
  const auth = await requireProfile();
  if (!auth.ok) return auth.response;

  const body = (await readJson<Body>(request)) ?? {};
  const pool = poolForSource(body.source ?? "keyboard");

  // Validated against the event list rather than defaulted, so an unrecognised
  // event is refused instead of quietly becoming a 3x3 attempt — a player who
  // asked for 4x4 and was handed a 3x3 scramble would have no idea why their
  // solve failed to verify.
  if (body.event !== undefined && !isEventId(body.event)) {
    return jsonError("Unknown event.", 400);
  }
  const event = body.event ?? DEFAULT_EVENT;
  if (!pool) {
    return jsonError("Only solves with a move stream can be ranked.", 400);
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countError } = await db()
    .from("ranked_attempts")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", auth.profile.id)
    .gte("issued_at", since);

  // Failing open here would remove the only thing stopping a script from
  // burning random-state generations, for as long as the database is unhappy.
  if (countError || count === null) {
    return jsonError("Could not start a ranked attempt.", 503);
  }

  if (count >= MAX_ATTEMPTS_PER_MINUTE) {
    return jsonError("Slow down a moment.", 429);
  }

  try {
    const attempt = await issueAttempt(auth.profile.id, event, pool);
    return Response.json(attempt);
  } catch {
    return jsonError("Could not start a ranked attempt.", 500);
  }
}
