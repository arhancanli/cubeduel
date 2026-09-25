/**
 * The weekly competition, against the real database.
 *
 *   npm run integration:weekly
 *
 * Every rule the page states is held here as a fact about rows: the five are
 * the same for everybody however many ask at once; each is shown only when
 * opened; opening the next closes the last as a DNF; a sixth is refused; a
 * solve is verified against the stored scramble or spent as a DNF; nobody
 * submits another player's attempt; an attempt's deadline holds; the board is
 * the WCA average; and this week's solves, with their scrambles, stay out of
 * every public page until the week closes.
 *
 * It cleans up after itself.
 */
import { solvePage } from "../src/lib/server/solvePage";
import { profileStats } from "../src/lib/server/boards";
import { db } from "../src/lib/server/supabase";
import {
  closedScrambles,
  ensureRound,
  issueWeeklyAttempt,
  standing,
  submitWeeklyAttempt,
  weeklyBoard,
} from "../src/lib/server/weekly";
import { previousWeek, weekKey } from "../src/lib/weekly";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

/** The inverse of a scramble solves it. */
function solutionFor(scramble: string): string[] {
  return scramble
    .trim()
    .split(/\s+/)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`));
}

/** A solve of the scramble taking about `seconds`. */
function solve(scramble: string, seconds: number) {
  const moves = solutionFor(scramble);
  // The last turn lands exactly at `seconds`, so a "12" is a 12.00.
  const gap = (seconds * 1000) / (moves.length - 1);
  const stream = moves.map((move, i) => ({ move, atMs: Math.round(i * gap) }));
  return { moves: stream, durationMs: stream[stream.length - 1].atMs };
}

/**
 * As though the attempt had been opened `seconds` (plus a moment's inspection)
 * ago. The verifier refuses a solve longer than the time since its scramble was
 * sent, so a test that submits straight away must move the clock, not the rule.
 */
async function openedAgo(attemptId: string, seconds: number) {
  const { error } = await db()
    .from("weekly_attempts")
    .update({ issued_at: new Date(Date.now() - (seconds + 2) * 1000).toISOString() })
    .eq("id", attemptId);
  if (error) throw new Error(error.message);
}

async function play(profileId: string, seconds: number | "DNF", label: string) {
  const issued = await issueWeeklyAttempt(profileId, "keyboard");
  if (!issued.ok) throw new Error(`${label}: could not open an attempt: ${issued.error}`);
  if (seconds !== "DNF") await openedAgo(issued.attemptId, seconds);
  if (seconds === "DNF") {
    return submitWeeklyAttempt({ profileId, attemptId: issued.attemptId, clientId: `${label}-${issued.idx}`, moves: [], durationMs: 0, penalty: "DNF", source: "keyboard" });
  }
  const { moves, durationMs } = solve(issued.scramble, seconds);
  return submitWeeklyAttempt({ profileId, attemptId: issued.attemptId, clientId: `${label}-${issued.idx}`, moves, durationMs, penalty: "OK", source: "keyboard" });
}

async function main() {
  console.log("The weekly competition\n");
  const week = weekKey(Date.now());
  await db().from("weekly_rounds").delete().eq("week", week);

  const { profile: ada } = await makeProbeProfile("weekly-ada", "probe-weekly-ada", "Probe Ada");
  const { profile: bea } = await makeProbeProfile("weekly-bea", "probe-weekly-bea", "Probe Bea");
  const { profile: cy } = await makeProbeProfile("weekly-cy", "probe-weekly-cy", "Probe Cy");

  console.log("== one set of five ==");
  const rounds = await Promise.all([ensureRound(week), ensureRound(week), ensureRound(week)]);
  check("three at once get the same five", rounds.every((r) => JSON.stringify(r.scrambles) === JSON.stringify(rounds[0].scrambles)));
  check("five distinct 3x3 scrambles", new Set(rounds[0].scrambles).size === 5 && rounds[0].scrambles.every((s) => s.split(" ").length >= 15));
  const { count: rows } = await db().from("weekly_rounds").select("week", { count: "exact", head: true }).eq("week", week);
  check("stored once", rows === 1, String(rows));
  const five = rounds[0].scrambles;

  console.log("\n== opening, and the reroll defence ==");
  const first = await issueWeeklyAttempt(ada.id, "keyboard");
  check("the first attempt is scramble 1", first.ok && first.idx === 0 && first.scramble === five[0]);
  const second = await issueWeeklyAttempt(ada.id, "keyboard");
  check("asking again moves on to scramble 2 — not a fresh look at 1", second.ok && second.idx === 1 && second.scramble === five[1]);
  const afterReroll = await standing(ada.id, week, "keyboard");
  check("and the abandoned first is a DNF", afterReroll.results.length === 1 && afterReroll.results[0].penalty === "DNF");
  check("the second is shown as open", afterReroll.open?.idx === 1);

  console.log("\n== submitting ==");
  if (!second.ok) throw new Error("no second attempt");
  const stolen = await submitWeeklyAttempt({ profileId: bea.id, attemptId: second.attemptId, clientId: "steal", ...solve(second.scramble, 12), penalty: "OK", source: "keyboard" });
  check("nobody else can submit your attempt", !stolen.accepted && stolen.reason === "No such attempt.");
  await openedAgo(second.attemptId, 12);
  const wrong = solve(five[0], 12);
  const bad = await submitWeeklyAttempt({ profileId: ada.id, attemptId: second.attemptId, clientId: "bad", ...wrong, penalty: "OK", source: "keyboard" });
  check("a solution to a different scramble is refused, for that reason",
    !bad.accepted && /solve|scramble/i.test(bad.reason) && !/longer than/.test(bad.reason), bad.accepted ? "" : bad.reason);
  const spent = await submitWeeklyAttempt({ profileId: ada.id, attemptId: second.attemptId, clientId: "late", ...solve(second.scramble, 12), penalty: "OK", source: "keyboard" });
  check("and the attempt is spent — the right answer afterwards is too late", !spent.accepted && spent.reason === "That attempt is already finished.");

  // Ada: DNF, DNF (refused), then 12, 11, 13 → two DNFs, a DNF average.
  for (const t of [12, 11, 13]) await play(ada.id, t, "ada");
  const sixth = await issueWeeklyAttempt(ada.id, "keyboard");
  check("a sixth attempt is refused", !sixth.ok && sixth.status === 409, sixth.ok ? "" : sixth.error);

  // Bea: 10, 12, 11, 30, 9 → drop 9 and 30 → 11.00.
  for (const t of [10, 12, 11, 30, 9]) await play(bea.id, t, "bea");
  // Cy: 20, DNF, 20, 20, 20 → drop 20 and the DNF → 20.00. Then only three of the next.
  for (const t of [20, "DNF", 20, 20, 20] as const) await play(cy.id, t, "cy");
  const { profile: dee } = await makeProbeProfile("weekly-dee", "probe-weekly-dee", "Probe Dee");
  for (const t of [8, 8]) await play(dee.id, t, "dee");

  // Eve does four, opens the fifth, and walks away: nothing ever closes it.
  // Once its time is up it is a DNF on the board, not a missing result.
  const { profile: eve } = await makeProbeProfile("weekly-eve", "probe-weekly-eve", "Probe Eve");
  for (const t of [15, 15, 15, 15]) await play(eve.id, t, "eve");
  const walked = await issueWeeklyAttempt(eve.id, "keyboard");
  if (!walked.ok) throw new Error("no fifth for Eve");
  await db().from("weekly_attempts").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", walked.attemptId);

  console.log("\n== the board ==");
  const board = await weeklyBoard(week);
  const rows2 = board.placed.map((p) => `${p.handle}:${p.place}:${p.averageMs}`);
  check("Bea 11.00, Eve 15.00 with her walked-away fifth as a DNF, Cy 20.00, Ada's DNF average last",
    JSON.stringify(board.placed.map((p) => [p.handle, p.place, p.averageMs])) ===
      JSON.stringify([["probe-weekly-bea", 1, 11_000], ["probe-weekly-eve", 2, 15_000], ["probe-weekly-cy", 3, 20_000], ["probe-weekly-ada", 4, null]]),
    rows2.join(", "));
  check("Dee, two in, is still competing — not ranked on a partial average", board.competing === 1 && !board.placed.some((p) => p.handle === "probe-weekly-dee"));

  console.log("\n== a deadline ==");
  const open = await issueWeeklyAttempt(dee.id, "keyboard");
  if (!open.ok) throw new Error("no attempt for the deadline test");
  await openedAgo(open.attemptId, 8);
  await db().from("weekly_attempts").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", open.attemptId);
  const late = await submitWeeklyAttempt({ profileId: dee.id, attemptId: open.attemptId, clientId: "dee-late", ...solve(open.scramble, 8), penalty: "OK", source: "keyboard" });
  check("a solve arriving after the attempt's deadline is refused, for that reason",
    !late.accepted && late.reason.includes("time ran out"), late.accepted ? "" : late.reason);

  console.log("\n== sealed until the week closes ==");
  const { data: beaSolve } = await db().from("solves").select("id, scramble").eq("profile_id", bea.id).eq("mode", "weekly").limit(1).single();
  check("the solve was stored, verified, as a weekly solve", beaSolve !== null);
  check("its page does not exist yet", (await solvePage(beaSolve!.id)) === null);
  const stats = await profileStats(bea.id);
  check("her profile's recent solves leave it out", !stats.recent.some((r) => r.id === beaSolve!.id), `${stats.recent.length} shown`);
  check("the five are not published yet", (await closedScrambles(week)) === null);

  // Last week, as if it had run: its five are published, and its solves are open.
  const last = previousWeek(week);
  await db().from("weekly_rounds").upsert({ week: last, event: "333", scrambles: ["R", "U", "F", "L", "D"].map((m) => `${m} R U`) });
  check("a closed week's five are published", JSON.stringify(await closedScrambles(last)) === JSON.stringify(["R R U", "U R U", "F R U", "L R U", "D R U"]));
  const lastWeekDay = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await db().from("solves").update({ solved_at: lastWeekDay }).eq("id", beaSolve!.id);
  check("and a solve from a closed week has its page again", (await solvePage(beaSolve!.id)) !== null);

  await db().from("weekly_rounds").delete().in("week", [week, last]);
  await cleanupProbes();
  console.log(failures === 0 ? "\nAll checks passed." : `\nFAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanupProbes().catch(() => {});
  process.exit(1);
});
