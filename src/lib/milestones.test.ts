import assert from "node:assert/strict";
import { test } from "node:test";

import { TRACKS, barrierPhrase, earnedBy, milestones, rungName, tally, trackProgress, type MilestoneSolve } from "./milestones";
import type { Penalty } from "./types";

const CUBE_333 = TRACKS.find((t) => t.key === "333-cube")!;
const DAY = 86_400_000;

/** Solves on a real 3x3, one a day, in the order given. */
function run(seconds: readonly (number | "DNF")[], hand: "cube" | "keyboard" = "cube"): MilestoneSolve[] {
  return seconds.map((t, i) => ({
    id: `s${i}`,
    at: (i + 1) * DAY,
    ms: t === "DNF" ? 30_000 : Math.round(t * 1000),
    penalty: (t === "DNF" ? "DNF" : "OK") as Penalty,
    event: "333",
    hand,
  }));
}

test("names barriers the way cubers say them", () => {
  assert.equal(rungName(20_000), "Sub-20");
  assert.equal(rungName(60_000), "Sub-1 minute");
  assert.equal(rungName(120_000), "Sub-2 minutes");
  assert.equal(rungName(90_000), "Sub-1:30");
  assert.equal(rungName(150_000), "Sub-2:30");
  assert.equal(barrierPhrase(20_000), "20 seconds");
  assert.equal(barrierPhrase(60_000), "1 minute");
  assert.equal(barrierPhrase(90_000), "1:30");
});

test("a first solve of 25s breaks every slower barrier at once, and the news is the fastest", () => {
  const progress = trackProgress(CUBE_333, run([25.4]));
  const broken = progress.rungs.filter((r) => r.single).map((r) => r.underMs / 1000);
  assert.deepEqual(broken, [120, 60, 45, 30]);
  const news = earnedBy([progress], "s0");
  assert.equal(news.length, 1);
  assert.equal(news[0].kind, "single");
  assert.equal(news[0].underMs, 30_000);
  assert.equal(news[0].track.key, "333-cube");
});

test("a barrier is strictly under: exactly 20.00 is not sub-20, 19.999 is (it records as 19.99)", () => {
  assert.equal(trackProgress(CUBE_333, run([20.0])).rungs.find((r) => r.underMs === 20_000)!.single, null);
  assert.equal(trackProgress(CUBE_333, run([20.009])).rungs.find((r) => r.underMs === 20_000)!.single, null);
  const earned = trackProgress(CUBE_333, run([19.999])).rungs.find((r) => r.underMs === 20_000)!.single;
  assert.equal(earned?.resultMs, 19_990);
});

test("a +2 counts: 18.5 with a penalty is a 20.50, not a sub-20", () => {
  const solves = run([18.5]);
  solves[0].penalty = "PLUS2";
  assert.equal(trackProgress(CUBE_333, solves).rungs.find((r) => r.underMs === 20_000)!.single, null);
});

test("an average is earned by the solve that completes the window, with WCA trimming", () => {
  // ao5 of 19,19,19,30,DNF: drop 19 and the DNF → mean of 19,19,30 = 22.67. Not sub-20.
  // One more 19: window 19,19,30,DNF,19 → still 22.67. Then 19 again: 19,30,DNF,19,19 → 22.67.
  // Then 19: 30,DNF,19,19,19 → drop 19 & DNF → 19,19,30 → 22.67. Then 19: DNF,19,19,19,19 → 19.00.
  const progress = trackProgress(CUBE_333, run([19, 19, 19, 30, "DNF", 19, 19, 19, 19]));
  const sub20 = progress.rungs.find((r) => r.underMs === 20_000)!;
  assert.equal(sub20.ao5?.solveId, "s8");
  assert.equal(sub20.ao5?.resultMs, 19_000);
  assert.equal(sub20.single?.solveId, "s0");
});

test("two DNFs in five is a DNF average and earns nothing", () => {
  const progress = trackProgress(CUBE_333, run([10, 10, 10, "DNF", "DNF"]));
  assert.equal(progress.best.ao5, null);
  assert.ok(progress.rungs.every((r) => r.ao5 === null));
});

test("an ao12 needs twelve solves", () => {
  const eleven = trackProgress(CUBE_333, run(Array(11).fill(15)));
  assert.equal(eleven.best.ao12, null);
  const twelve = trackProgress(CUBE_333, run(Array(12).fill(15)));
  assert.equal(twelve.best.ao12, 15_000);
  assert.equal(twelve.rungs.find((r) => r.underMs === 17_000)!.ao12?.solveId, "s11");
});

test("solves are read in time order whatever order they arrive in", () => {
  const solves = run([40, 25]);
  const reversed = [...solves].reverse();
  const progress = trackProgress(CUBE_333, reversed);
  assert.equal(progress.rungs.find((r) => r.underMs === 45_000)!.single?.solveId, "s0");
  assert.equal(progress.rungs.find((r) => r.underMs === 30_000)!.single?.solveId, "s1");
});

test("the next target is the fastest barrier not yet broken, and how far the best is from it", () => {
  const progress = trackProgress(CUBE_333, run([27.5, 22.34, 26, 24, 25]));
  assert.equal(progress.next.single?.underMs, 20_000);
  assert.equal(progress.next.single?.gapMs, 2_340);
  // ao5 = mean of 24, 25, 26 = 25.00, so sub-25 is not yet broken
  assert.equal(progress.best.ao5, 25_000);
  assert.equal(progress.next.ao5?.underMs, 25_000);
  assert.equal(progress.next.ao5?.gapMs, 0);
  assert.equal(progress.next.ao12?.underMs, 120_000);
  assert.equal(progress.next.ao12?.gapMs, null);
});

test("a finished ladder has no next target", () => {
  const progress = trackProgress(CUBE_333, run(Array(12).fill(9)));
  assert.equal(progress.next.single, null);
  assert.equal(progress.next.ao12, null);
  assert.deepEqual(tally(progress), { earned: 30, total: 30 });
});

test("keyboard and real-cube times are separate ladders", () => {
  const all = [...run([15], "keyboard"), ...run([40], "cube").map((s) => ({ ...s, id: "c" }))];
  const [cube, keyboard] = milestones(all);
  assert.equal(cube.track.key, "333-cube");
  assert.equal(cube.best.single, 40_000);
  assert.equal(keyboard.track.key, "333-keyboard");
  assert.equal(keyboard.best.single, 15_000);
});

test("a puzzle nobody has solved has no ladder shown", () => {
  assert.deepEqual(milestones(run([30])).map((p) => p.track.key), ["333-cube"]);
  assert.deepEqual(milestones([]), []);
});

test("a later slower solve earns nothing, and a penalty added later takes the milestone back", () => {
  const solves = run([19, 21]);
  assert.deepEqual(earnedBy(milestones(solves), "s1"), []);
  solves[0].penalty = "DNF";
  const progress = milestones(solves);
  assert.equal(progress[0].rungs.find((r) => r.underMs === 20_000)!.single, null);
  assert.equal(earnedBy(progress, "s1")[0].underMs, 25_000);
});

test("every ladder runs slowest to fastest with no repeats", () => {
  for (const track of TRACKS) {
    for (let i = 1; i < track.rungs.length; i++) assert.ok(track.rungs[i] < track.rungs[i - 1], track.key);
  }
});
