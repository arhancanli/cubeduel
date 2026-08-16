import dailies from "@/data/dailies.json";
import { dayNumber } from "@/lib/daily";
import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { db } from "@/lib/server/supabase";
import type { Penalty } from "@/lib/types";
import { MAX_MOVES, verifySolve, type SubmittedMove } from "@/lib/verifySolve";

/**
 * Records a result on the shared daily scramble.
 *
 * The one-attempt rule finally means something here. It used to live in
 * `localStorage`, where clearing storage reset it — honest enough for a solo
 * round, useless the moment results are ranked against other people. The primary
 * key on `(profile_id, day, event)` is what enforces it now, and a second
 * submission is refused by the database rather than by a promise.
 *
 * The daily's scramble is the same for everyone and published at midnight, so
 * unlike ranked there is no moment at which it was handed to a specific player.
 * The moves can still be proven against it; the clock cannot. The board labels
 * results accordingly rather than presenting the two as equivalent.
 */

interface Body {
  dayKey?: unknown;
  durationMs?: unknown;
  penalty?: unknown;
  source?: unknown;
  moves?: unknown;
}

const PENALTIES = new Set<Penalty>(["OK", "PLUS2", "DNF"]);

function parseMoves(value: unknown): SubmittedMove[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_MOVES) return null;

  const moves: SubmittedMove[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { move, atMs } = raw as { move?: unknown; atMs?: unknown };
    if (typeof move !== "string" || move.length > 8) return null;
    if (typeof atMs !== "number" || !Number.isFinite(atMs)) return null;
    moves.push({ move, atMs });
  }
  return moves;
}

export async function POST(request: Request) {
  const auth = await requireProfile();
  if (!auth.ok) return auth.response;

  const body = await readJson<Body>(request);
  if (!body) return jsonError("Malformed request.", 400);

  const { dayKey, durationMs, penalty } = body;

  if (typeof dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return jsonError("Unknown day.", 400);
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return jsonError("Missing duration.", 400);
  }
  if (typeof penalty !== "string" || !PENALTIES.has(penalty as Penalty)) {
    return jsonError("Unknown penalty.", 400);
  }

  const scrambles = dailies.scrambles as Record<string, string>;
  const scramble = scrambles[dayKey];
  if (!scramble) return jsonError("There is no daily for that date.", 400);

  // Only today's daily can be submitted. Without this a player could quietly
  // fill in every day they missed, and a streak would stop meaning anything.
  const today = new Date().toISOString().slice(0, 10);
  if (dayKey !== today) {
    return jsonError("That daily has closed.", 409);
  }

  const day = dayNumber(dailies.start, dayKey);
  const moves = parseMoves(body.moves);
  if (moves === null) return jsonError("Malformed move stream.", 400);

  let verified = false;
  if (penalty !== "DNF" && moves.length > 0) {
    const verdict = await verifySolve({
      scramble,
      moves,
      durationMs,
      // Published to everyone at once, so there is no issue time to bound against.
      issuedAt: null,
      receivedAt: Date.now(),
    });
    verified = verdict.verified;
  }

  const { error } = await db().from("daily_results").insert({
    profile_id: auth.profile.id,
    day,
    event: "333",
    duration_ms: Math.round(durationMs),
    penalty,
    verified,
  });

  if (error?.code === "23505") {
    return jsonError("You have already played today's daily.", 409);
  }
  if (error) return jsonError("Could not record that result.", 500);

  return Response.json({ recorded: true, day, verified });
}
