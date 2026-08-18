import { jsonError } from "@/lib/server/apiAuth";
import { optimalCross, summariseScramble } from "@/lib/server/solveService";

/**
 * How many moves a scramble actually needs.
 *
 * Deliberately open to signed-out visitors. Practice mode works with no account
 * and offline, and move efficiency is one of the most useful things the app can
 * tell a beginner — gating it behind a sign-up would be exactly the friction the
 * rest of the product refuses.
 *
 * Being open means it has to be cheap to abuse. A solve costs about 100ms of
 * CPU, so: the scramble is validated against a strict allowlist before anything
 * happens, results are cached by scramble, and there is a per-instance rate
 * limit. The expensive case — a stream of distinct valid scrambles — is the only
 * one that costs anything, and it is bounded.
 */

export const dynamic = "force-dynamic";

/** Generous for a person, tight enough that a script gains little. */
const MAX_PER_MINUTE = 30;
const WINDOW_MS = 60_000;

const hits: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  while (hits.length > 0 && now - hits[0] > WINDOW_MS) hits.shift();
  if (hits.length >= MAX_PER_MINUTE) return true;
  hits.push(now);
  return false;
}

export async function POST(request: Request) {
  let body: { scramble?: unknown; crossFace?: unknown } | null = null;
  try {
    body = (await request.json()) as { scramble?: unknown; crossFace?: unknown };
  } catch {
    return jsonError("Malformed request.", 400);
  }

  const scramble = body?.scramble;
  // Length is capped before the allowlist runs: this string is headed for a
  // parser, and an unbounded one is a denial of service with good manners.
  if (typeof scramble !== "string" || scramble.length > 512) {
    return jsonError("Missing scramble.", 400);
  }

  if (rateLimited()) return jsonError("Too many solves. Try again shortly.", 429);

  const summary = summariseScramble(scramble);
  if (!summary) {
    return jsonError("That is not a scramble this engine can solve.", 422);
  }

  // Answered in the same round trip when the caller says which face they built
  // on, because the two numbers are read together and a second request would
  // just be a second cold start.
  const face = typeof body.crossFace === "string" ? body.crossFace : null;
  const optimalCrossMoves = face ? await optimalCross(scramble, face) : null;

  return Response.json({ ...summary, optimalCrossMoves, crossFace: face }, {
    headers: {
      // The answer for a scramble is a mathematical fact and never changes, so
      // it can be cached hard by anything between here and the browser.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
