/**
 * End-to-end check of the ranked spine against the real database.
 *
 * The unit tests cover the rating maths and the verifier; the e2e suites cover
 * the browser. This covers the seam between them — the part that had never once
 * executed until the schema existed: issue a server-side scramble, solve it,
 * have the server replay and verify it, and watch a rating actually appear.
 *
 * Everything except Clerk is real: real Supabase, real random-state scrambles,
 * real KPuzzle replay, real atomic rating window. Clerk is skipped by inserting
 * the profile row directly, which is all `ensureProfile` would have done.
 *
 *   npm run integration
 *
 * Two things it deliberately does the slow way, because both were bugs the fast
 * way hid:
 *
 *   - It WAITS the length of each solve. Submitting instantly is what a cheat
 *     does, and the server refuses it. An honest client is slow because the
 *     human is slow.
 *   - It lets the rejected attempts land in the first rating window, so the
 *     first window FAILS. That path is what proved a failed first window was
 *     storing a rating of 0 — a number below the floor that nobody earned.
 *
 * It cleans up after itself.
 */

import {
  ANCHOR_FAST_RATING,
  ESTABLISHED_DEVIATION,
  WINDOW_SIZE,
  ratingForMs,
} from "../src/lib/rating";
import { ratingBoard, profileStats } from "../src/lib/server/boards";
import {
  currentRating,
  issueAttempt,
  submitAttempt,
} from "../src/lib/server/ranked";
import { db } from "../src/lib/server/supabase";

const HANDLE = "integration-probe";
/** A fast but entirely human solve. The script waits this long for each one. */
const SOLVE_MS = 5000;

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

/** The inverse of a scramble solves it, which gives every test an honest solution. */
function solutionFor(scramble: string): string[] {
  return scramble
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`));
}

function stream(moves: string[], gapMs: number) {
  return moves.map((move, i) => ({ move, atMs: i * gapMs }));
}

async function cleanup() {
  await db().from("profiles").delete().eq("handle", HANDLE);
}

const seen = new Set<string>();

/** Issues an attempt, waits out a believable solve, and submits it honestly. */
async function honestSolve(profileId: string, label: string) {
  const attempt = await issueAttempt(profileId, "333", "keyboard");
  seen.add(attempt.scramble);

  const solution = solutionFor(attempt.scramble);
  const gap = Math.round(SOLVE_MS / Math.max(1, solution.length - 1));
  const moves = stream(solution, gap);
  // Fractional on purpose. A real browser measures with `performance.now()` and
  // reports 3184.699999988079, never 3184 — and an integer column rejected that
  // outright, surfacing as a bare 500 with no hint at the cause. Whole numbers
  // here hid the bug completely.
  const durationMs = moves[moves.length - 1].atMs + 0.699999988079;

  await new Promise((resolve) => setTimeout(resolve, durationMs));

  const result = await submitAttempt({
    profileId,
    attemptId: attempt.attemptId,
    clientId: `probe_${label}_${Date.now()}`,
    moves,
    durationMs,
    penalty: "OK",
    source: "keyboard",
  });

  check(
    `${label} verified`,
    result.accepted,
    result.accepted
      ? `${(durationMs / 1000).toFixed(2)}s, ${result.moveCount} moves, ${result.tps.toFixed(1)} tps`
      : result.reason,
  );
  return result;
}

async function main() {
  console.log("\n== setup ==");
  await cleanup();

  const { data: profile, error } = await db()
    .from("profiles")
    .insert({
      clerk_user_id: `integration_${Date.now()}`,
      handle: HANDLE,
      display_name: "Integration Probe",
    })
    .select("*")
    .single();

  check("a profile can be created", Boolean(profile) && !error, error?.message ?? "");
  if (!profile) return;

  console.log("\n== the server issues the puzzle ==");
  const first = await issueAttempt(profile.id, "333", "keyboard");
  seen.add(first.scramble);
  check("an attempt is issued", Boolean(first.attemptId && first.scramble));
  check(
    "it is a full WCA scramble",
    first.scramble.split(/\s+/).length >= 18,
    `${first.scramble.split(/\s+/).length} moves`,
  );

  console.log("\n== forgery is refused ==");
  const bogus = await submitAttempt({
    profileId: profile.id,
    attemptId: first.attemptId,
    clientId: `probe_bogus_${Date.now()}`,
    moves: stream(["R", "U", "R'", "U'"], 400),
    durationMs: 1200,
    penalty: "OK",
    source: "keyboard",
  });
  check("moves that do not solve it are refused", !bogus.accepted,
    bogus.accepted ? "ACCEPTED" : bogus.reason);

  const replay = await submitAttempt({
    profileId: profile.id,
    attemptId: first.attemptId,
    clientId: `probe_replay_${Date.now()}`,
    moves: stream(solutionFor(first.scramble), 400),
    durationMs: (solutionFor(first.scramble).length - 1) * 400,
    penalty: "OK",
    source: "keyboard",
  });
  check("a spent attempt cannot be reused", !replay.accepted);

  {
    const attempt = await issueAttempt(profile.id, "333", "keyboard");
    seen.add(attempt.scramble);
    const moves = stream(solutionFor(attempt.scramble), 900);
    const instant = await submitAttempt({
      profileId: profile.id,
      attemptId: attempt.attemptId,
      clientId: `probe_instant_${Date.now()}`,
      moves,
      durationMs: moves[moves.length - 1].atMs,
      penalty: "OK",
      source: "keyboard",
    });
    check("a solve longer than the attempt has been open is refused", !instant.accepted,
      instant.accepted ? "ACCEPTED" : instant.reason);
  }

  // Those two refusals were recorded as DNFs, so the first window will contain
  // two of them and must fail.
  console.log("\n== window 1: two refusals and three real solves ==");
  let lastResult: Awaited<ReturnType<typeof submitAttempt>> | null = null;
  for (let i = 1; i <= WINDOW_SIZE - 2; i++) {
    lastResult = await honestSolve(profile.id, `solve ${i}`);
  }

  const failedWindow = lastResult?.accepted ? lastResult.rating : null;
  check("the window closed", failedWindow !== null && failedWindow !== undefined);
  check("it is reported as a failed average", failedWindow?.failed === true);
  check("no rating was invented from it", failedWindow?.after === null,
    failedWindow?.after === null ? "" : String(failedWindow?.after));

  const afterFailure = await currentRating(profile.id, "333", "keyboard");
  check(
    "the player is still UNRATED, not rated 0",
    afterFailure.rating === null,
    afterFailure.rating === null ? "null" : `stored ${afterFailure.rating}`,
  );

  console.log("\n== window 2: five clean solves ==");
  for (let i = 1; i <= WINDOW_SIZE; i++) {
    lastResult = await honestSolve(profile.id, `solve ${i}`);
  }

  const cleanWindow = lastResult?.accepted ? lastResult.rating : null;
  check("a rating window closed", cleanWindow !== null && cleanWindow !== undefined);
  check("it is not reported as failed", cleanWindow?.failed === false);
  check("an average was rated", (cleanWindow?.averageMs ?? null) !== null,
    cleanWindow?.averageMs ? `${(cleanWindow.averageMs / 1000).toFixed(2)}s` : "");
  check("a rating was produced", (cleanWindow?.after ?? null) !== null,
    String(Math.round(cleanWindow?.after ?? 0)));

  const expected = cleanWindow?.averageMs ? ratingForMs(cleanWindow.averageMs) : null;
  check(
    "the stored rating is what the rating function says",
    expected !== null &&
      cleanWindow?.after != null &&
      Math.abs(cleanWindow.after - expected) < 1,
    `stored ${Math.round(cleanWindow?.after ?? 0)} vs function ${Math.round(expected ?? 0)}`,
  );

  const stored = await currentRating(profile.id, "333", "keyboard");
  check("the rating persisted", stored.rating !== null,
    stored.rating ? `${Math.round(stored.rating)} ±${Math.round(stored.deviation)}` : "none");

  // Two rejection probes, then (WINDOW_SIZE - 2) + WINDOW_SIZE honest solves.
  const issued = 2 + (WINDOW_SIZE - 2) + WINDOW_SIZE;
  check("every issued scramble was unique", seen.size === issued,
    `${seen.size} distinct of ${issued}`);

  // The point of the log-time scale is that it is exact and readable, so a
  // roughly-5-second average must land on the documented world-class anchor.
  // The tolerance is real: scramble lengths vary, so the paced solves come out
  // a few milliseconds either side of 5.000s and the average moves with them.
  // Pinning an exact 3000 would be pinning the scramble generator, not the scale.
  const anchorGap = Math.abs((stored.rating ?? 0) - ANCHOR_FAST_RATING);
  check(
    "a ~5 second average lands on the world-class anchor",
    anchorGap < 15,
    `${Math.round(stored.rating ?? 0)} vs anchor ${ANCHOR_FAST_RATING} (gap ${anchorGap.toFixed(1)})`,
  );

  console.log("\n== the window really was atomic ==");
  const events = await db()
    .from("rating_events")
    .select("window_index, rating_after")
    .eq("profile_id", profile.id)
    .order("window_index", { ascending: true });
  check("one event per window, no more", events.data?.length === 2,
    `${events.data?.length ?? 0} events`);
  check("the failed window recorded no rating", events.data?.[0]?.rating_after === null);
  check(
    "the clean window's event agrees with the stored rating",
    events.data?.[1] != null &&
      stored.rating !== null &&
      Math.abs((events.data[1].rating_after ?? NaN) - stored.rating) < 0.01,
  );

  const consumed = await db()
    .from("ranked_attempts")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profile.id)
    .not("window_index", "is", null);
  check("all ten results were consumed", consumed.count === WINDOW_SIZE * 2,
    `${consumed.count} consumed`);

  console.log("\n== how it surfaces ==");
  const board = await ratingBoard("333", "keyboard");
  const onBoard = board.some((e) => e.handle === HANDLE);
  check(
    "two windows is not yet established, so not on the leaderboard",
    !onBoard,
    `±${Math.round(stored.deviation)} vs threshold ±${ESTABLISHED_DEVIATION}`,
  );

  const stats = await profileStats(profile.id);
  check("the profile shows the rating", stats.rating !== null,
    stats.rating ? String(Math.round(stats.rating)) : "none");
  check("the profile marks it provisional", stats.established === false);
  check("the rating chart plots only real ratings", stats.history.length === 1,
    `${stats.history.length} points (the failed window contributes none)`);
  check("the best single is recorded", stats.bestSingleMs !== null,
    stats.bestSingleMs ? `${(stats.bestSingleMs / 1000).toFixed(2)}s` : "none");

  console.log("\n== cleanup ==");
  await cleanup();
  const gone = await db().from("profiles").select("id").eq("handle", HANDLE);
  check("the probe removed itself", (gone.data?.length ?? 0) === 0);
}

main()
  .catch((error) => {
    console.error("\nFATAL:", error instanceof Error ? error.message : error);
    failures++;
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log("\n" + "=".repeat(52));
    console.log(failures === 0 ? "All checks passed." : `FAILURES: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
  });
