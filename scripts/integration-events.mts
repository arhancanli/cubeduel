/**
 * Every event's ranked path, against the real database.
 *
 * The unit tests prove the maths and the replay. This proves the seam nothing
 * else touches: a server-issued scramble for a 4x4, solved, verified against a
 * 4x4 and stored — with the rating landing where that event's scale says it
 * should rather than on 3x3's.
 *
 *   npm run integration:events
 *
 * It cleans up after itself.
 */
import { EVENTS, EVENT_IDS } from "../src/lib/events";
import { ratingForMs } from "../src/lib/rating";
import { issueAttempt, submitAttempt } from "../src/lib/server/ranked";
import { db } from "../src/lib/server/supabase";
import { makeProbeProfile, cleanupProbes } from "./probeAccount.mjs";

const HANDLE = "events-probe";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

function solutionFor(scramble: string): string[] {
  return scramble
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`));
}

async function cleanup() {
  await db().from("profiles").delete().eq("handle", HANDLE);
  // The probe accounts too, not only the profiles. `users` cascades to
  // profiles, so deleting the profile alone leaves the account behind — and
  // those accumulate silently, because nothing in the app ever lists them.
  await cleanupProbes();
}

async function main() {
  console.log("\n== setup ==");
  await cleanup();
  let profile;
  try {
    ({ profile } = await makeProbeProfile("events", HANDLE, "Events Probe"));
  } catch (cause) {
    check("a profile exists", false, String(cause));
    return;
  }
  check("a profile exists", Boolean(profile));

  for (const id of EVENT_IDS) {
    const def = EVENTS[id];
    console.log(`\n== ${def.longName} ==`);

    const attempt = await issueAttempt(profile.id, id, "keyboard");
    const moveCount = attempt.scramble.split(/\s+/).filter(Boolean).length;
    check("a scramble was issued", moveCount > 0, `${moveCount} moves`);

    // Big-cube scrambles carry wide moves; small ones must not.
    const hasWide = /\bw|[a-z]w/.test(attempt.scramble) || /w/.test(attempt.scramble);
    check(
      "the scramble suits the puzzle",
      id === "222" || id === "333" ? !hasWide : hasWide,
      hasWide ? "has wide moves" : "outer layers only",
    );

    const solution = solutionFor(attempt.scramble);
    // Paced to clear this event's floor and stay under the turn-rate cap.
    const durationMs = Math.max(def.minSolveMs + 800, solution.length * 200);
    const gap = Math.round(durationMs / Math.max(1, solution.length - 1));
    const moves = solution.map((move, i) => ({ move, atMs: i * gap }));
    const claimed = moves[moves.length - 1].atMs;

    await new Promise((r) => setTimeout(r, claimed + 200));

    const result = await submitAttempt({
      profileId: profile.id,
      attemptId: attempt.attemptId,
      clientId: `events_${id}_${Date.now()}`,
      moves,
      durationMs: claimed,
      penalty: "OK",
      source: "keyboard",
    });

    check("the solve verified", result.accepted, result.accepted ? "" : result.reason);

    if (result.accepted) {
      const { data: solve } = await db()
        .from("solves")
        .select("event, verified, duration_ms")
        .eq("profile_id", profile.id)
        .eq("event", id)
        .maybeSingle();
      check("it was stored against the right event", solve?.event === id, String(solve?.event));
      check("and marked verified", solve?.verified === true);
    }
  }

  console.log("\n== the scales really are different ==");
  {
    // The same time is worth very different ratings depending on the puzzle,
    // which is the entire reason the anchors are per event. A 25 second average
    // is world class on 4x4 and nowhere near it on 3x3.
    const at25s3 = ratingForMs(25_000, "333");
    const at25s4 = ratingForMs(25_000, "444");
    check("25s rates world class on 4x4", Math.round(at25s4) === 3000, String(Math.round(at25s4)));
    check("and well below that on 3x3", at25s3 < 2000, String(Math.round(at25s3)));
    check("a shared scale would have made these equal", Math.abs(at25s4 - at25s3) > 800,
      `${Math.round(at25s3)} vs ${Math.round(at25s4)}`);
  }

  console.log("\n== cleanup ==");
  await cleanup();
  const { count } = await db()
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("handle", HANDLE);
  check("the probe removed itself", (count ?? 0) === 0, `${count ?? 0} left`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    console.log("\n" + "=".repeat(52));
    console.log(failures === 0 ? "All checks passed." : `FAILURES: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
  });
