/**
 * Live races, against the real database.
 *
 *   npm run integration:race
 *
 * Two players through a whole race, and every guarantee a race makes asserted as
 * a fact about the rows rather than about the screen:
 *
 *   - the second seat can be taken once, and never by a third person
 *   - nothing starts until both are ready, and both pressing ready at the same
 *     instant starts it exactly once
 *   - the scramble exists during the countdown and is still not sent — to either
 *     player — until the race starts
 *   - a solve submitted before the start is refused
 *   - progress is shown to the other player, and a malformed report is refused
 *   - a real solve is verified and stored; a forged one becomes a DNF
 *   - the winner is the server's, and a rematch puts both players in one new race
 *
 * It waits out a real countdown and real solve durations, because the verifier
 * refuses a solve that took longer than the race has been running — which is
 * what a faster-than-possible submission looks like.
 *
 * It cleans up after itself.
 */

import { RACE_COUNTDOWN_MS } from "../src/lib/race";
import { joinRace, createRace, raceView, rematch, reportProgress, setReady, submitRace } from "../src/lib/server/races";
import { db } from "../src/lib/server/supabase";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("Live races\n");
  const stamp = Date.now().toString(36).slice(-6);
  const { profile: host } = await makeProbeProfile("race-host", `race-host-${stamp}`, "Race Host");
  const { profile: guest } = await makeProbeProfile("race-guest", `race-guest-${stamp}`, "Race Guest");
  const { profile: stranger } = await makeProbeProfile("race-x", `race-x-${stamp}`, "Race Stranger");

  // -------------------------------------------------------------------------
  console.log("== the lobby ==");
  const created = await createRace(host.id, "333");
  check("a race is created with a code", created.ok);
  if (!created.ok) return finish();
  const code = created.code;

  let view = await raceView(code, host.id);
  check("it starts in the lobby with one seat filled", view?.phase === "lobby" && view.guest === null);
  check("there is no scramble in the lobby", view?.scramble === null);

  check("the second seat can be taken", (await joinRace(guest.id, code)).ok);
  const third = await joinRace(stranger.id, code);
  check("and not by a third person", !third.ok, third.ok ? "joined" : third.reason);
  const again = await joinRace(host.id, code);
  check("joining your own race again changes nothing", again.ok && again.seat === "host");

  // -------------------------------------------------------------------------
  console.log("\n== ready, and the countdown ==");
  await setReady(host.id, code, true);
  view = await raceView(code, guest.id);
  check("one player ready is not a start", view?.phase === "lobby");

  await setReady(guest.id, code, true);
  view = await raceView(code, guest.id);
  const { data: rowDuring } = await db().from("races").select("scramble, start_at").eq("code", code).single();
  check("both ready starts the countdown", view?.phase === "countdown", view?.phase);
  check("the scramble already exists on the server", Boolean(rowDuring?.scramble));
  check(
    "and is sent to neither player during the countdown",
    view?.scramble === null && (await raceView(code, host.id))?.scramble === null,
  );

  const early = await submitRace({
    profileId: host.id,
    code,
    clientId: `race-early-${stamp}`,
    moves: [{ move: "R", atMs: 0 }],
    durationMs: 100,
    penalty: "OK",
    source: "keyboard",
  });
  check("a solve before the start is refused", !early.accepted, early.accepted ? "accepted" : early.reason);

  await sleep(RACE_COUNTDOWN_MS + 300);
  view = await raceView(code, host.id);
  const scramble = view?.scramble ?? "";
  check("at the start the race is running and the scramble is sent", view?.phase === "racing" && scramble.length > 0);
  check("it is the scramble the server generated", scramble === rowDuring?.scramble);

  // -------------------------------------------------------------------------
  console.log("\n== progress ==");
  check("a progress report is accepted", await reportProgress(host.id, code, { stage: 3, turns: 21 }));
  check("a malformed one is refused", !(await reportProgress(host.id, code, { stage: 99, turns: 21 })));
  const seen = await raceView(code, guest.id);
  check(
    "the other player sees it",
    seen?.host.progress?.stage === 3 && seen.host.progress.turns === 21,
    JSON.stringify(seen?.host.progress),
  );

  // -------------------------------------------------------------------------
  console.log("\n== finishing ==");
  const solution = solutionFor(scramble);
  const SOLVE_MS = 3000;
  const moves = solution.map((move, i) => ({ move, atMs: (SOLVE_MS / (solution.length - 1)) * i }));
  await sleep(SOLVE_MS);
  const hostResult = await submitRace({
    profileId: host.id,
    code,
    clientId: `race-host-${stamp}`,
    moves,
    durationMs: SOLVE_MS + 0.4,
    penalty: "OK",
    source: "keyboard",
  });
  check("a real solve is accepted", hostResult.accepted, hostResult.accepted ? "" : hostResult.reason);
  view = await raceView(code, guest.id);
  check("one player finished leaves the race running", view?.phase === "racing");
  check("and their time is shown to the other", view?.host.result?.durationMs === SOLVE_MS);

  const forged = await submitRace({
    profileId: guest.id,
    code,
    clientId: `race-guest-${stamp}`,
    moves: [
      { move: "R", atMs: 0 },
      { move: "U", atMs: 400 },
    ],
    durationMs: 800,
    penalty: "OK",
    source: "keyboard",
  });
  check("moves that do not solve it are refused", !forged.accepted);

  view = await raceView(code, guest.id);
  check("the refused solve became a DNF and the race is over", view?.phase === "finished" && view.guest?.result?.penalty === "DNF");
  check("the real solve won", view?.winner === "host", String(view?.winner));

  const resubmit = await submitRace({
    profileId: host.id,
    code,
    clientId: `race-host2-${stamp}`,
    moves,
    durationMs: SOLVE_MS,
    penalty: "OK",
    source: "keyboard",
  });
  check("a finished seat cannot submit again", !resubmit.accepted);

  const { data: solves } = await db().from("solves").select("mode, verified").eq("profile_id", host.id);
  check(
    "the winning solve is stored as a verified race solve",
    (solves ?? []).some((s) => s.mode === "race" && s.verified),
    JSON.stringify(solves),
  );

  // -------------------------------------------------------------------------
  console.log("\n== rematch, and a simultaneous start ==");
  const [a, b] = await Promise.all([rematch(guest.id, code), rematch(host.id, code)]);
  check("both players asking for a rematch land in the same race", a.ok && b.ok && a.code === b.code);
  if (!a.ok) return finish();
  const next = await raceView(a.code, host.id);
  // Whichever request landed first hosts the new race, so either seat is right —
  // what matters is that both players are in it and neither has to be invited.
  const other = await raceView(a.code, guest.id);
  check(
    "both are already seated in it",
    next?.guest !== null && next?.you !== null && other?.you !== null && next?.you !== other?.you && next?.phase === "lobby",
    `${next?.you} / ${other?.you}`,
  );

  await Promise.all([setReady(host.id, a.code, true), setReady(guest.id, a.code, true)]);
  const { data: started } = await db().from("races").select("status, scramble, start_at").eq("code", a.code).single();
  check("both pressing ready at once starts it", started?.status === "started", started?.status);
  await sleep(200);
  const { data: steady } = await db().from("races").select("scramble, start_at").eq("code", a.code).single();
  check(
    "exactly once — one scramble, one start time",
    steady?.scramble === started?.scramble && steady?.start_at === started?.start_at,
  );

  return finish();
}

async function finish() {
  await cleanupProbes();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanupProbes().catch(() => {});
  process.exit(1);
});
