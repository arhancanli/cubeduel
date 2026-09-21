/**
 * Practice sync, against the real database.
 *
 *   npm run integration:sync
 *
 * Practice solves are the most common kind there is, and until this suite
 * existed they reached the server as a time and a list of phase totals — the
 * move stream was dropped on the way, and the breakdown stored beside it was
 * whatever the browser said it was. So what is checked here is what the stored
 * row actually holds when a client tells the truth, when it lies, and when it
 * sends something that contradicts itself:
 *
 *   - the stream is kept, and the breakdown is DERIVED from it — a fabricated
 *     breakdown, case or move count in the request changes nothing stored
 *   - recognition is measured on the way in, from the stream
 *   - a stopwatch solve keeps its hand-marked laps and gains no stream
 *   - a stream that ends after the clock stopped is dropped, not stored
 *   - junk in the splits field never reaches the column
 *   - nothing arriving here is ever verified, and re-sending is a no-op
 *
 * It cleans up after itself.
 */

import { encodeMoveStream } from "../src/lib/moveStream";
import { storePracticeSolves } from "../src/lib/server/practiceSync";
import { db } from "../src/lib/server/supabase";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

/** A CFOP solve where every step completes exactly one milestone (see cfop.test.ts). */
const STEPS = [
  "D2 R' D'",
  "U R U' R'",
  "U R' U' R",
  "U L U' L'",
  "U L' U' L",
  "R U R' U R U2 R'",
  "R U R' U' R' F R2 U' R' U' R U R' F'",
];
const SOLUTION = STEPS.join(" ").split(" ");
const SCRAMBLE = [...SOLUTION]
  .reverse()
  .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
  .join(" ");

/** 150ms per turn, and a 600ms look before every step after the cross. */
function streamWithPauses() {
  const moves: { move: string; atMs: number }[] = [];
  let clock = 0;
  STEPS.forEach((step, s) => {
    step.split(" ").forEach((move, i) => {
      if (moves.length > 0) clock += 150;
      if (i === 0 && s > 0) clock += 600;
      moves.push({ move, atMs: clock });
    });
  });
  return moves;
}

async function row(profileId: string, clientId: string) {
  const { data, error } = await db()
    .from("solves")
    .select("moves, splits, oll_case, pll_case, move_count, tps, source, verified, mode")
    .eq("profile_id", profileId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  console.log("Practice sync\n");
  const { profile } = await makeProbeProfile("sync", "probe-sync", "Probe Sync");

  const stream = streamWithPauses();
  const durationMs = stream.at(-1)!.atMs;

  const result = await storePracticeSolves(profile.id, [
    {
      // An honest stream wrapped in a dishonest request.
      id: "streamed",
      at: Date.now(),
      scramble: SCRAMBLE,
      durationMs,
      penalty: "OK",
      moveCount: 3,
      tps: 99,
      splits: [{ phase: "PLL", startMs: 0, endMs: 100, durationMs: 100, moveCount: 1, tps: 10 }],
      ollCase: "made-up",
      pllCase: "made-up",
      source: "keyboard",
      moves: encodeMoveStream(stream),
    },
    {
      // A stopwatch solve with laps marked by hand.
      id: "stopwatch",
      at: Date.now(),
      scramble: SCRAMBLE,
      durationMs: 14_000,
      penalty: "OK",
      moveCount: 0,
      tps: 0,
      splits: [
        { phase: "Cross", startMs: 0, endMs: 2000, durationMs: 2000, moveCount: 0, tps: 0 },
        { phase: "F2L", startMs: 2000, endMs: 9000, durationMs: 7000, moveCount: 0, tps: 0 },
        { phase: "OLL", startMs: 9000, endMs: 11500, durationMs: 2500, moveCount: 0, tps: 0 },
        { phase: "PLL", startMs: 11500, endMs: 14000, durationMs: 2500, moveCount: 0, tps: 0 },
      ],
      source: "manual",
    },
    {
      // A stream whose last turn lands two seconds after the clock stopped —
      // sent with the splits and case a client would have worked out from it.
      id: "contradicts",
      at: Date.now(),
      scramble: SCRAMBLE,
      durationMs: durationMs - 2000,
      penalty: "OK",
      moveCount: 40,
      tps: 4,
      splits: [{ phase: "Cross", startMs: 0, endMs: 450, durationMs: 450, moveCount: 3, tps: 6.7 }],
      ollCase: "0222|0000",
      source: "keyboard",
      moves: encodeMoveStream(stream),
    },
    {
      // Junk where the splits go, and no stream to replace it with.
      id: "junk",
      at: Date.now(),
      scramble: SCRAMBLE,
      durationMs: 9000,
      penalty: "OK",
      moveCount: 0,
      tps: 0,
      splits: [{ phase: "<script>", startMs: -1 }, { note: "x".repeat(10_000) }],
      source: "keyboard",
    },
  ]);

  check("all four are stored", result.stored === 4, JSON.stringify(result));

  // -------------------------------------------------------------------------
  console.log("\n== an honest stream in a dishonest request ==");
  const streamed = await row(profile.id, "streamed");
  const splits = (streamed?.splits ?? []) as { phase: string; recognitionMs?: number }[];
  check("the move stream is stored", Array.isArray(streamed?.moves) && (streamed!.moves as unknown[]).length === SOLUTION.length);
  check(
    "the breakdown is derived from it, not copied from the request",
    splits.map((s) => s.phase).join(",") === "Cross,F2L 1,F2L 2,F2L 3,F2L 4,OLL,PLL",
    splits.map((s) => s.phase).join(","),
  );
  check(
    "recognition is measured on the way in — the 600ms look, less the ordinary turn",
    splits.slice(1).every((s) => s.recognitionMs === 600),
    splits.map((s) => s.recognitionMs).join(","),
  );
  check("the cross has no recognition inside the clock", splits[0]?.recognitionMs === 0);
  check("a made-up OLL case is not stored", streamed?.oll_case !== "made-up", String(streamed?.oll_case));
  check("a made-up PLL case is not stored", streamed?.pll_case !== "made-up", String(streamed?.pll_case));
  check(
    "the move count is read off the stream",
    streamed?.move_count === SOLUTION.length,
    `${streamed?.move_count} vs ${SOLUTION.length}`,
  );
  check("the turn rate is not the 99 the request claimed", (streamed?.tps ?? 99) < 20, String(streamed?.tps));
  check("it is practice, and not verified", streamed?.mode === "practice" && streamed?.verified === false);

  // -------------------------------------------------------------------------
  console.log("\n== a stopwatch solve ==");
  const stopwatch = await row(profile.id, "stopwatch");
  check("it is stored as manual, not keyboard", stopwatch?.source === "manual", String(stopwatch?.source));
  check("it has no stream", stopwatch?.moves === null);
  check(
    "its hand-marked laps are kept",
    ((stopwatch?.splits ?? []) as { phase: string }[]).map((s) => s.phase).join(",") === "Cross,F2L,OLL,PLL",
  );

  // -------------------------------------------------------------------------
  console.log("\n== what should not be believed ==");
  const contradicts = await row(profile.id, "contradicts");
  check("a stream longer than its own solve is dropped", contradicts?.moves === null);
  check(
    "and nothing derived from it is kept",
    Array.isArray(contradicts?.splits) &&
      (contradicts!.splits as unknown[]).length === 0 &&
      contradicts?.move_count === 0 &&
      contradicts?.oll_case === null,
    `${JSON.stringify(contradicts?.splits).slice(0, 60)} · ${contradicts?.move_count}`,
  );
  const junk = await row(profile.id, "junk");
  check("junk never reaches the splits column", Array.isArray(junk?.splits) && (junk!.splits as unknown[]).length === 0, JSON.stringify(junk?.splits).slice(0, 80));

  // -------------------------------------------------------------------------
  console.log("\n== streams no human made, and more than one request may ask for ==");
  const now = Date.now();
  const inhuman = await storePracticeSolves(profile.id, [
    {
      id: "inhuman",
      at: now,
      scramble: SCRAMBLE,
      durationMs: 400,
      penalty: "OK",
      moveCount: 40,
      tps: 100,
      splits: [],
      source: "keyboard",
      // The whole solution in four tenths of a second: 100 turns a second.
      moves: encodeMoveStream(SOLUTION.map((move, i) => ({ move, atMs: i * 10 }))),
    },
  ]);
  const fast = await row(profile.id, "inhuman");
  check("a stream faster than a human turns is not kept", inhuman.stored === 1 && fast?.moves === null);
  check("and the turn rate the request claimed is not stored either", fast?.tps === 0, String(fast?.tps));

  // Forty solves each carrying a 1,000-move stream is 40,000 moves of replay,
  // over the 30,000 one request may ask for. The first thirty fit.
  const long = Array.from({ length: 1000 }, (_, i) => ({ move: i % 2 ? "R'" : "R", atMs: i * 100 }));
  const flood = await storePracticeSolves(
    profile.id,
    Array.from({ length: 40 }, (_, i) => ({
      id: `flood-${i}`,
      at: now + i,
      scramble: "R U",
      durationMs: 100_000,
      penalty: "OK",
      moveCount: 0,
      tps: 0,
      splits: [],
      source: "keyboard",
      moves: encodeMoveStream(long),
    })),
  );
  const { data: flooded } = await db()
    .from("solves")
    .select("client_id, moves")
    .eq("profile_id", profile.id)
    .like("client_id", "flood-%");
  const kept = (flooded ?? []).filter((r) => r.moves !== null).length;
  check("every solve in the flood is stored", flood.stored === 40, JSON.stringify(flood));
  check("but only the streams inside the replay budget are kept", kept === 30, `${kept} of 40`);

  // -------------------------------------------------------------------------
  console.log("\n== a solve with no stream at all ==");
  await storePracticeSolves(profile.id, [
    {
      id: "legacy",
      at: now,
      scramble: SCRAMBLE,
      durationMs: 14_000,
      penalty: "OK",
      moveCount: 55,
      tps: 3.9,
      splits: [{ phase: "Cross", startMs: 0, endMs: 2000, durationMs: 2000, moveCount: 7, tps: 3.5 }],
      ollCase: "0222|0000",
      pllCase: "<b>T</b>",
      source: "keyboard",
    },
  ]);
  const legacy = await row(profile.id, "legacy");
  check(
    "keeps what it recorded, which is all anybody can know about it",
    legacy?.move_count === 55 && (legacy?.splits as unknown[]).length === 1 && legacy?.oll_case === "0222|0000",
  );
  check("but not a case id this app could not have written", legacy?.pll_case === null, String(legacy?.pll_case));

  // -------------------------------------------------------------------------
  console.log("\n== sending it again ==");
  const again = await storePracticeSolves(profile.id, [
    {
      id: "streamed",
      at: Date.now(),
      scramble: SCRAMBLE,
      durationMs: 1,
      penalty: "DNF",
      moveCount: 0,
      tps: 0,
      splits: [],
      source: "keyboard",
    },
  ]);
  check("a re-sent solve stores nothing", again.stored === 0, JSON.stringify(again));
  const still = await row(profile.id, "streamed");
  check("and does not overwrite the stored one", (still?.moves as unknown[] | null)?.length === SOLUTION.length);

  await cleanupProbes();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanupProbes().catch(() => {});
  process.exit(1);
});
