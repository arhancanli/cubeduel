/**
 * The solve permalink, against the real database.
 *
 *   npm run integration:solve
 *
 * The interesting property is not that the page loads. It is that the verdict it
 * prints does not move.
 *
 * `reviewSolve` compares a solve against what that cuber usually takes, and on
 * the timer "usually" means everything up to now. A permalink is read again
 * later, by other people, so if par were drawn from the solver's whole history
 * the page would silently rewrite itself as they improved: a link shared today
 * saying "F2L cost you three seconds" becomes "F2L was fine" a fortnight later,
 * the number moving because the reader arrived late rather than because anything
 * about the solve changed.
 *
 * So the check that matters here is the one that adds faster solves *after* the
 * one under review and asserts the page says exactly what it said before.
 *
 * It cleans up after itself.
 */
import type { PhaseSplit } from "../src/lib/cfop";
import { solvePage } from "../src/lib/server/solvePage";
import { db } from "../src/lib/server/supabase";
import { reviewSolve } from "../src/lib/solveReview";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

/** Splits that add up, so the review has something real to work with. */
function splitsFor(crossMs: number, f2lMs: number, ollMs: number, pllMs: number): PhaseSplit[] {
  const at = [0, crossMs, crossMs + f2lMs, crossMs + f2lMs + ollMs];
  const spec: [string, number, number][] = [
    ["Cross", at[0], crossMs],
    ["F2L", at[1], f2lMs],
    ["OLL", at[2], ollMs],
    ["PLL", at[3], pllMs],
  ];
  return spec.map(([phase, startMs, durationMs]) => ({
    phase,
    startMs,
    endMs: startMs + durationMs,
    durationMs,
    moveCount: 8,
    tps: 8000 / durationMs,
  }));
}

async function insertSolve(
  profileId: string,
  clientId: string,
  solvedAt: Date,
  splits: PhaseSplit[],
  durationMs: number,
) {
  const moves = Array.from({ length: 20 }, (_, i) => ({
    move: "R",
    atMs: (durationMs / 20) * i,
  }));

  const { data, error } = await db()
    .from("solves")
    .insert({
      profile_id: profileId,
      client_id: clientId,
      event: "333",
      scramble: "R U R' U' F2 L D B' R2 U",
      duration_ms: durationMs,
      penalty: "OK",
      move_count: 20,
      tps: 20 / (durationMs / 1000),
      source: "keyboard",
      mode: "practice",
      verified: true,
      moves: moves as never,
      splits: splits as never,
      solved_at: solvedAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`insert failed: ${error?.message}`);
  return data.id;
}

async function main() {
  console.log("The solve permalink\n");

  const { profile } = await makeProbeProfile("solvepage", "probe-solvepage", "Probe SolvePage");

  const base = new Date("2026-01-01T12:00:00Z");
  const day = (n: number) => new Date(base.getTime() + n * 86_400_000);

  // Six earlier solves, all with the same shape: a 4s F2L is normal for them.
  for (let i = 0; i < 6; i++) {
    await insertSolve(profile.id, `past-${i}`, day(i), splitsFor(1000, 4000, 1000, 1000), 7000);
  }

  // The solve under review: F2L blew out to 9s. Everything else is normal.
  const subjectId = await insertSolve(
    profile.id,
    "subject",
    day(10),
    splitsFor(1000, 9000, 1000, 1000),
    12000,
  );

  // ---------------------------------------------------------------------
  const page = await solvePage(subjectId);
  check("the solve is found", page !== null);
  if (!page) {
    await cleanupProbes();
    process.exit(1);
  }

  check("it is attributed to its owner", page.handle === "probe-solvepage", page.handle);
  check("the move stream survives the round trip", page.moves.length === 20, `${page.moves.length}`);
  check("moves carry timestamps", typeof page.moves[0]?.atMs === "number");
  check("splits survive", page.splits.length === 4, `${page.splits.length}`);
  check("history holds the six earlier solves", page.history.length === 6, `${page.history.length}`);
  check(
    "history never contains the solve under review",
    !page.history.some((h) => h.id === subjectId),
  );

  const before = reviewSolve(page.splits, page.durationMs, page.history);
  check("a par exists", before.kind === "reviewed", before.kind);
  check("F2L is named as the culprit", before.culprit?.phase === "F2L", String(before.culprit?.phase));
  check(
    "the gap is the ~5s it actually lost",
    before.culprit !== null && Math.abs(before.culprit.gapMs - 5000) < 50,
    `${Math.round(before.culprit?.gapMs ?? 0)}ms`,
  );

  // ---------------------------------------------------------------------
  // The property this page exists on: later solves must not move the verdict.
  // ---------------------------------------------------------------------
  for (let i = 0; i < 8; i++) {
    // Much faster F2L, all *after* the solve under review.
    await insertSolve(profile.id, `later-${i}`, day(20 + i), splitsFor(800, 1500, 700, 700), 3700);
  }

  const again = await solvePage(subjectId);
  const after = reviewSolve(again!.splits, again!.durationMs, again!.history);

  check("history still holds only the earlier six", again!.history.length === 6, `${again!.history.length}`);
  check(
    "the culprit is unchanged",
    after.culprit?.phase === before.culprit?.phase,
    `${before.culprit?.phase} -> ${after.culprit?.phase}`,
  );
  check(
    "the gap is unchanged after eight faster solves",
    Math.abs((after.culprit?.gapMs ?? 0) - (before.culprit?.gapMs ?? 0)) < 1,
    `${Math.round(before.culprit?.gapMs ?? 0)}ms -> ${Math.round(after.culprit?.gapMs ?? 0)}ms`,
  );
  check(
    "the sample size is unchanged",
    after.sampleSize === before.sampleSize,
    `${before.sampleSize} -> ${after.sampleSize}`,
  );

  // ---------------------------------------------------------------------
  check("a malformed id is refused without touching the database",
    (await solvePage("not-a-uuid")) === null);
  check("an unknown id is a miss",
    (await solvePage("00000000-0000-0000-0000-000000000000")) === null);

  await cleanupProbes();
  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanupProbes();
  process.exit(1);
});
