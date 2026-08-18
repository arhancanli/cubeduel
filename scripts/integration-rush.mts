/**
 * Rush against the real database.
 *
 * The unit tests cover the tightening curve and the scoring. This covers the
 * part that decides whether a score means anything: that every solve is verified
 * against a scramble the server issued, and that the run's total is replayed
 * from what was stored rather than believed from the request.
 *
 *   npm run integration:rush
 *
 * It cleans up after itself.
 */
import { OPENING_SLACK, RUSH_LIVES } from "../src/lib/rush";
import { startRun, submitRushSolve, bestRun } from "../src/lib/server/rush";
import { db } from "../src/lib/server/supabase";

const HANDLE = "rush-probe";
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
  await db().from("profiles").delete().in("handle", [HANDLE, "rush-probe-b"]);
}

/** Solves the issued scramble honestly, pacing it to land on `durationMs`. */
async function solve(profileId: string, runId: string, scramble: string, durationMs: number) {
  const solution = solutionFor(scramble);
  const gap = Math.round(durationMs / Math.max(1, solution.length - 1));
  const moves = solution.map((move, i) => ({ move, atMs: i * gap }));
  const claimed = moves[moves.length - 1].atMs;

  // The server refuses a solve that took less wall-clock time than it claims.
  await new Promise((r) => setTimeout(r, claimed + 150));

  return submitRushSolve({
    profileId,
    runId,
    clientId: `rush_${Date.now()}_${Math.round(claimed)}`,
    moves,
    durationMs: claimed,
    penalty: "OK",
    source: "keyboard",
  });
}

async function main() {
  console.log("\n== setup ==");
  await cleanup();
  const { data: profile } = await db()
    .from("profiles")
    .insert({ clerk_user_id: `rush_${Date.now()}`, handle: HANDLE, display_name: "Rush Probe" })
    .select("*")
    .single();
  check("a profile exists", Boolean(profile));
  if (!profile) return;

  console.log("\n== a run opens ==");
  const run = await startRun(profile.id, "333", "keyboard");
  check("a scramble was issued", run.scramble.split(/\s+/).length >= 15);
  check("an opening target was set", run.targetMs > 0, `${(run.targetMs / 1000).toFixed(2)}s`);
  check("the target has slack over the pace",
    Math.abs(run.targetMs - run.paceMs * OPENING_SLACK) < 2,
    `${run.targetMs} vs pace ${run.paceMs}`);
  check("the run starts at zero", run.state.score === 0 && run.state.misses === 0);

  console.log("\n== clearing solves tightens the target ==");
  let scramble = run.scramble;
  let target = run.targetMs;
  const targets: number[] = [target];

  for (let i = 0; i < 3; i++) {
    // Comfortably inside the target, and comfortably above the verifier's floor.
    const result = await solve(profile.id, run.runId, scramble, Math.round(target * 0.5));
    if (!result.accepted) {
      check(`solve ${i + 1} accepted`, false, result.reason);
      break;
    }
    check(`solve ${i + 1} cleared its target`, result.cleared,
      `${result.effectiveMs}ms vs ${result.targetMs}ms`);
    check(`the score moved to ${i + 1}`, result.state.score === i + 1, String(result.state.score));
    scramble = result.scramble ?? "";
    target = result.nextTargetMs ?? target;
    targets.push(target);
  }

  check("each target was tighter than the last",
    targets.every((t, i) => i === 0 || t < targets[i - 1]),
    targets.map((t) => Math.round(t)).join(" > "));

  console.log("\n== the score is replayed, not believed ==");
  {
    const { data: solves } = await db()
      .from("rush_solves")
      .select("position, cleared, target_ms, penalty, solve_id")
      .eq("run_id", run.runId)
      .order("position", { ascending: true });

    check("every solve was recorded", (solves?.length ?? 0) === 3, `${solves?.length ?? 0}`);
    check("each has a stored solve behind it",
      (solves ?? []).every((s) => s.solve_id !== null),
      (solves ?? []).map((s) => (s.solve_id ? "y" : "NULL")).join(""));
    check("the target it was judged against was stored",
      (solves ?? []).every((s) => s.target_ms > 0));

    const { data: stored } = await db()
      .from("solves")
      .select("mode, verified")
      .eq("profile_id", profile.id);
    check("the solves are stored as rush solves",
      (stored ?? []).length === 3 && (stored ?? []).every((s) => s.mode === "rush"),
      `${(stored ?? []).length} rows`);
    check("and marked verified", (stored ?? []).every((s) => s.verified === true));
  }

  console.log("\n== a solve that misses the target costs a life ==");
  {
    // Slower than the target, but a real, verified solve.
    const result = await solve(profile.id, run.runId, scramble, Math.round(target * 1.6));
    check("it was accepted", result.accepted, result.accepted ? "" : result.reason);
    if (result.accepted) {
      check("but did not clear", !result.cleared,
        `${result.effectiveMs}ms vs ${result.targetMs}ms`);
      check("a life was spent", result.state.misses === 1, String(result.state.misses));
      check("the score did not move", result.state.score === 3, String(result.state.score));
      check("and the target did not tighten after a miss",
        result.nextTargetMs === target, `${result.nextTargetMs} vs ${target}`);
      scramble = result.scramble ?? "";
    }
  }

  console.log("\n== a forged solve cannot score ==");
  {
    // Moves that do not solve the issued scramble. The engine must not take the
    // client's word for it, and the run must continue rather than break.
    const result = await submitRushSolve({
      profileId: profile.id,
      runId: run.runId,
      clientId: `rush_forged_${Date.now()}`,
      moves: [
        { move: "R", atMs: 0 },
        { move: "U", atMs: 400 },
        { move: "R'", atMs: 800 },
      ],
      durationMs: 900,
      penalty: "OK",
      source: "keyboard",
    });

    check("it was not counted as a clear", result.accepted && !result.cleared,
      result.accepted ? `cleared=${result.cleared}` : result.reason);
    if (result.accepted) {
      check("it cost a life instead", result.state.misses === 2, String(result.state.misses));
      check("the score is untouched", result.state.score === 3, String(result.state.score));
      scramble = result.scramble ?? "";
    }

    const { data: forged } = await db()
      .from("rush_solves")
      .select("solve_id, penalty")
      .eq("run_id", run.runId)
      .eq("position", 4)
      .maybeSingle();
    check("no solve row was stored for it", forged?.solve_id === null, String(forged?.solve_id));
    check("and it is recorded as a DNF", forged?.penalty === "DNF", String(forged?.penalty));
  }

  console.log("\n== the third miss ends the run ==");
  {
    const result = await solve(profile.id, run.runId, scramble, Math.round(target * 1.8));
    check("the run is over", result.accepted && result.state.over,
      result.accepted ? String(result.state.over) : result.reason);
    check("no further scramble was issued", result.accepted && result.scramble === null);
    check(`it took ${RUSH_LIVES} misses`, result.accepted && result.state.misses === RUSH_LIVES,
      result.accepted ? String(result.state.misses) : "");

    const after = await submitRushSolve({
      profileId: profile.id,
      runId: run.runId,
      clientId: "rush_after_end",
      moves: [{ move: "R", atMs: 0 }],
      durationMs: 5000,
      penalty: "OK",
      source: "keyboard",
    });
    check("nothing can be submitted afterwards", !after.accepted,
      after.accepted ? "it accepted a solve after the end" : after.reason);
  }

  console.log("\n== the run is on record ==");
  {
    const best = await bestRun(profile.id, "333");
    check("a best run exists", best !== null);
    check("with the score the server computed", best?.score === 3, String(best?.score));
    check("and the best streak", best?.bestStreak === 3, String(best?.bestStreak));

    const { data: row } = await db()
      .from("rush_runs")
      .select("status, score, misses")
      .eq("id", run.runId)
      .single();
    check("the run is marked finished", row?.status === "finished", String(row?.status));
    check("its stored score matches the replay", row?.score === 3, String(row?.score));
  }

  console.log("\n== only one run at a time ==");
  {
    const first = await startRun(profile.id, "333", "keyboard");
    const second = await startRun(profile.id, "333", "keyboard");
    check("starting a second run closes the first", first.runId !== second.runId);

    const stale = await submitRushSolve({
      profileId: profile.id,
      runId: first.runId,
      clientId: "rush_stale",
      moves: [{ move: "R", atMs: 0 }],
      durationMs: 5000,
      penalty: "OK",
      source: "keyboard",
    });
    check("the abandoned run refuses solves", !stale.accepted,
      stale.accepted ? "it accepted one" : stale.reason);
  }

  console.log("\n== somebody else's run is invisible ==");
  {
    const { data: stranger } = await db()
      .from("profiles")
      .insert({
        clerk_user_id: `rush_stranger_${Date.now()}`,
        handle: "rush-probe-b",
        display_name: "Stranger",
      })
      .select("id")
      .single();

    // Asserted rather than assumed: the first version of this guarded the whole
    // section on `if (stranger)`, the insert failed on a missing column, and the
    // checks below simply never ran — a skipped check reads exactly like a
    // passing one in the output.
    check("a stranger profile exists to test with", Boolean(stranger));
    if (stranger) {
      const mine = await startRun(profile.id, "333", "keyboard");
      const theft = await submitRushSolve({
        profileId: stranger.id,
        runId: mine.runId,
        clientId: "rush_theft",
        moves: [{ move: "R", atMs: 0 }],
        durationMs: 5000,
        penalty: "OK",
        source: "keyboard",
      });
      check("a stranger cannot submit into it", !theft.accepted,
        theft.accepted ? "LEAK" : theft.reason);
      check("and is told it does not exist",
        !theft.accepted && theft.reason === "No such run.",
        theft.accepted ? "" : theft.reason);
      await db().from("profiles").delete().eq("id", stranger.id);
    }
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
