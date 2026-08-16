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

/** Events the ladder actually knows how to rate. */
const EVENTS = new Set(["333"]);

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
  const event = body.event ?? "333";
  const pool = poolForSource(body.source ?? "keyboard");

  if (!EVENTS.has(event)) return jsonError("Unknown event.", 400);
  if (!pool) {
    return jsonError("Only solves with a move stream can be ranked.", 400);
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db()
    .from("ranked_attempts")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", auth.profile.id)
    .gte("issued_at", since);

  if ((count ?? 0) >= MAX_ATTEMPTS_PER_MINUTE) {
    return jsonError("Slow down a moment.", 429);
  }

  try {
    const attempt = await issueAttempt(auth.profile.id, event, pool);
    return Response.json(attempt);
  } catch {
    return jsonError("Could not start a ranked attempt.", 500);
  }
}
