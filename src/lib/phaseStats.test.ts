import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePhases,
  diagnose,
  groupOf,
  groupSplits,
  lookAndTurn,
  totalTimeTrend,
  MIN_SOLVES_FOR_DIAGNOSIS,
  type PhaseGroup,
} from "./phaseStats";
import type { PhaseSplit } from "./cfop";
import type { StoredSolve } from "./solveHistory";
import type { Penalty } from "./types";

let seq = 0;

function split(phase: string, durationMs: number): PhaseSplit {
  return { phase, startMs: 0, endMs: durationMs, durationMs, moveCount: 5, tps: 5 };
}

function solve(
  phases: Partial<Record<PhaseGroup, number>>,
  { penalty = "OK" as Penalty, durationMs }: { penalty?: Penalty; durationMs?: number } = {},
): StoredSolve {
  seq += 1;
  const splits: PhaseSplit[] = [];
  if (phases.Cross !== undefined) splits.push(split("Cross", phases.Cross));
  if (phases.F2L !== undefined) {
    // Split the F2L total across four pairs, as a real solve would.
    for (let i = 1; i <= 4; i++) splits.push(split(`F2L ${i}`, phases.F2L / 4));
  }
  if (phases.OLL !== undefined) splits.push(split("OLL", phases.OLL));
  if (phases.PLL !== undefined) splits.push(split("PLL", phases.PLL));

  const total = splits.reduce((a, s) => a + s.durationMs, 0);
  return {
    id: `s${seq}`,
    at: seq,
    scramble: "R U R'",
    durationMs: durationMs ?? total,
    penalty,
    moveCount: 50,
    tps: 5,
    splits,
    ollCase: null,
    ollSetup: null,
    pllCase: null,
    pllSetup: null,
    source: "keyboard",
  };
}

function noSplits(durationMs: number): StoredSolve {
  seq += 1;
  return {
    id: `n${seq}`,
    at: seq,
    scramble: "R U R'",
    durationMs,
    penalty: "OK",
    moveCount: 50,
    tps: 5,
    splits: [],
    ollCase: null,
    ollSetup: null,
    pllCase: null,
    pllSetup: null,
    source: "keyboard",
  };
}

test("F2L pair numbers collapse into one stage, unfinished contributes nothing", () => {
  assert.equal(groupOf("Cross"), "Cross");
  assert.equal(groupOf("F2L 1"), "F2L");
  assert.equal(groupOf("F2L 4"), "F2L");
  assert.equal(groupOf("OLL"), "OLL");
  assert.equal(groupOf("PLL"), "PLL");
  assert.equal(groupOf("Unfinished"), null);
});

test("the four F2L pairs sum into one F2L total", () => {
  const totals = groupSplits([
    split("Cross", 1000),
    split("F2L 1", 500),
    split("F2L 2", 700),
    split("F2L 3", 300),
    split("F2L 4", 500),
    split("Unfinished", 9999),
  ]);
  assert.equal(totals.get("Cross"), 1000);
  assert.equal(totals.get("F2L"), 2000);
  assert.equal(totals.has("OLL"), false);
});

test("aggregates report n, mean, extremes and shares that sum to one", () => {
  const solves = [
    solve({ Cross: 1000, F2L: 8000, OLL: 3000, PLL: 2000 }),
    solve({ Cross: 2000, F2L: 10000, OLL: 3000, PLL: 2000 }),
  ];
  const byPhase = new Map(aggregatePhases(solves).map((a) => [a.phase, a]));

  const cross = byPhase.get("Cross")!;
  assert.equal(cross.n, 2);
  assert.equal(cross.meanMs, 1500);
  assert.equal(cross.bestMs, 1000);
  assert.equal(cross.worstMs, 2000);
  assert.equal(byPhase.get("F2L")!.meanMs, 9000);

  const shareSum = aggregatePhases(solves).reduce((a, p) => a + p.shareOfSolve, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9, `shares summed to ${shareSum}`);
});

test("standard deviation is undefined for a single solve rather than zero", () => {
  const [only] = aggregatePhases([solve({ Cross: 1000, OLL: 2000 })]);
  assert.equal(only.n, 1);
  assert.equal(only.sdMs, null);
  assert.equal(only.cv, null);
});

test("DNFs and unsplit solves are excluded from the analysis", () => {
  const solves = [
    solve({ Cross: 1000, OLL: 2000 }),
    solve({ Cross: 9000, OLL: 9000 }, { penalty: "DNF" }),
    noSplits(30000),
  ];
  const cross = aggregatePhases(solves).find((a) => a.phase === "Cross")!;
  assert.equal(cross.n, 1, "only the one clean, split solve counts");
  assert.equal(cross.meanMs, 1000);
});

test("nothing is claimed below the minimum sample", () => {
  const few = Array.from({ length: MIN_SOLVES_FOR_DIAGNOSIS - 1 }, () =>
    solve({ Cross: 1000, F2L: 8000, OLL: 3000, PLL: 2000 }),
  );
  const d = diagnose(few);
  assert.equal(d.kind, "insufficient");
  assert.equal(d.phase, null);
  assert.match(d.interpretation, /more solve/);
});

test("solves with no move data are not counted toward a threshold they can never reach", () => {
  // A hand-timed solve has no turns to split. Telling someone "5 more solves"
  // beside a counter reading 14 is the app contradicting itself, and it was the
  // most common reason testers gave up on the page.
  const solves = Array.from({ length: 14 }, () => noSplits(20000));
  const d = diagnose(solves);
  assert.equal(d.kind, "insufficient");
  assert.match(d.fact, /14 solves recorded, none with move data/);
  assert.doesNotMatch(d.interpretation, /\d+ more/, "must not imply they are nearly there");
  assert.match(d.interpretation, /never unlock it/);
});

test("an empty history says so instead of dividing by zero", () => {
  const d = diagnose([]);
  assert.equal(d.kind, "insufficient");
  assert.equal(d.sampleSize, 0);
  assert.deepEqual(aggregatePhases([]), []);
});

test("the bottleneck is the phase with the largest share of the solve", () => {
  const solves = Array.from({ length: 8 }, (_, i) =>
    solve({ Cross: 1000 + i * 10, F2L: 12000 + i * 20, OLL: 3000 + i * 10, PLL: 2000 + i * 10 }),
  );
  const d = diagnose(solves);
  assert.equal(d.phase, "F2L");
  assert.match(d.fact, /F2L is \d+% of your solve across 8 solves/);
});

test("a reliably slow phase reads as execution, not recognition", () => {
  // OLL dominates but barely moves; the other phases wobble as much as it does.
  const ollTimes = [6000, 6100, 5900, 6050, 5950, 6000, 6100, 5900];
  const solves = ollTimes.map((oll, i) =>
    solve({
      Cross: 1000 + (i % 3) * 120,
      F2L: 4000 + (i % 4) * 400,
      OLL: oll,
      PLL: 1500 + (i % 3) * 150,
    }),
  );
  const d = diagnose(solves);
  assert.equal(d.phase, "OLL");
  assert.equal(d.kind, "execution");
  assert.match(d.interpretation, /execution/);
});

test("a phase that swings reads as recognition", () => {
  // Same OLL mean, but sometimes instant and sometimes a long stall.
  const ollTimes = [1500, 11000, 2000, 10500, 1800, 11500, 1600, 10000];
  const solves = ollTimes.map((oll, i) =>
    solve({
      Cross: 1000 + (i % 3) * 60,
      F2L: 4000 + (i % 4) * 200,
      OLL: oll,
      PLL: 1500 + (i % 3) * 70,
    }),
  );
  const d = diagnose(solves);
  assert.equal(d.phase, "OLL");
  assert.equal(d.kind, "recognition");
  assert.match(d.fact, /× your fastest/);
});

test("a trend is not claimed below the minimum sample", () => {
  const solves = Array.from({ length: 6 }, () => solve({ Cross: 1000, OLL: 2000 }));
  assert.equal(totalTimeTrend(solves).kind, "insufficient");
});

test("a small change against a noisy baseline is reported as unclear, not progress", () => {
  // Recent half is 0.5s faster on average, but the spread is several seconds wide.
  const earlier = [17000, 23000, 19000, 24000, 16000, 22000];
  const recent = [18000, 22000, 16500, 23500, 17000, 20000];
  const solves = [...earlier, ...recent].map((ms) =>
    solve({ Cross: 1000, F2L: 8000, OLL: 3000, PLL: 2000 }, { durationMs: ms }),
  );
  const trend = totalTimeTrend(solves);
  assert.equal(trend.kind, "unclear", `delta was ${trend.deltaMs}ms`);
  assert.ok(trend.deltaMs < 0, "it did get faster on average — it just isn't distinguishable");
});

test("a large, consistent change is reported as improvement", () => {
  const earlier = [25000, 25200, 24800, 25100, 24900, 25000];
  const recent = [18000, 18200, 17800, 18100, 17900, 18000];
  const solves = [...earlier, ...recent].map((ms) =>
    solve({ Cross: 1000, F2L: 8000, OLL: 3000, PLL: 2000 }, { durationMs: ms }),
  );
  const trend = totalTimeTrend(solves);
  assert.equal(trend.kind, "improving");
  assert.ok(Math.abs(trend.deltaMs + 7000) < 100, `delta was ${trend.deltaMs}`);
});

// ---------------------------------------------------------------------------
// Looking and turning, measured from the stream
// ---------------------------------------------------------------------------

/**
 * A solve whose phases carry measured recognition. F2L's look and turn are
 * spread over four pairs, as a real solve's would be.
 */
function measured(
  phases: Partial<Record<Exclude<PhaseGroup, "Cross">, { look: number; turn: number }>>,
  cross = 1500,
): StoredSolve {
  seq += 1;
  const splits: PhaseSplit[] = [
    { phase: "Cross", startMs: 0, endMs: cross, durationMs: cross, moveCount: 7, tps: 5, recognitionMs: 0 },
  ];
  const push = (phase: string, look: number, turn: number, moves: number) =>
    splits.push({
      phase,
      startMs: 0,
      endMs: look + turn,
      durationMs: look + turn,
      moveCount: moves,
      tps: 0,
      recognitionMs: look,
    });
  if (phases.F2L) {
    for (let i = 1; i <= 4; i++) push(`F2L ${i}`, phases.F2L.look / 4, phases.F2L.turn / 4, 7);
  }
  if (phases.OLL) push("OLL", phases.OLL.look, phases.OLL.turn, 9);
  if (phases.PLL) push("PLL", phases.PLL.look, phases.PLL.turn, 13);
  const total = splits.reduce((a, s) => a + s.durationMs, 0);
  return {
    id: `m${seq}`,
    at: seq,
    scramble: "",
    durationMs: total,
    penalty: "OK",
    moveCount: 60,
    tps: 3,
    splits,
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "keyboard",
  };
}

/** Twenty solves in which F2L is the bottleneck, with fast and slow halves. */
function f2lSolves(slow: { look: number; turn: number }, fast: { look: number; turn: number }) {
  return Array.from({ length: 20 }, (_, i) =>
    measured({
      F2L: i % 2 ? slow : fast,
      OLL: { look: 600, turn: 1400 },
      PLL: { look: 500, turn: 1500 },
    }),
  );
}

test("slow solves that lose their time looking are called recognition — measured, not inferred", () => {
  const d = diagnose(f2lSolves({ look: 5000, turn: 5000 }, { look: 2000, turn: 4600 }));
  assert.equal(d.phase, "F2L");
  assert.equal(d.kind, "recognition");
  assert.match(d.measured ?? "", /3\.4s longer: 3\.0s more between pairs, 0\.4s more turning/);
  assert.match(d.fact, /3\.5s between pairs and 4\.8s turning/);
});

test("slow solves that lose their time turning are called execution", () => {
  const d = diagnose(f2lSolves({ look: 2200, turn: 8000 }, { look: 2000, turn: 4000 }));
  assert.equal(d.kind, "execution");
  assert.match(d.measured ?? "", /0\.2s more between pairs, 4\.0s more turning/);
});

test("the call is made by comparing slow solves to fast ones, not looking to turning", () => {
  // Turning is the larger part of every solve here, as it is for almost every
  // cuber. Comparing the two parts directly would call this execution; it is the
  // looking that makes the slow ones slow.
  const d = diagnose(f2lSolves({ look: 4000, turn: 6100 }, { look: 1000, turn: 6000 }));
  assert.equal(d.kind, "recognition");
});

test("slow solves that look LESS are described as less, never as a negative more", () => {
  const d = diagnose(f2lSolves({ look: 1500, turn: 9000 }, { look: 2000, turn: 4000 }));
  assert.match(d.measured ?? "", /0\.5s less between pairs, 5\.0s more turning/);
});

test("below ten measured solves the old heuristic answers, and says nothing measured", () => {
  const few = f2lSolves({ look: 5000, turn: 5000 }, { look: 2000, turn: 4600 }).slice(0, 9);
  const d = diagnose(few);
  assert.equal(d.phase, "F2L");
  assert.equal(d.measured, null);
});

test("a phase with any unmeasured pair is not counted as measured", () => {
  const solves = f2lSolves({ look: 5000, turn: 5000 }, { look: 2000, turn: 4600 }).map((s) => ({
    ...s,
    // One pair recorded before recognition existed. Treating it as all turning
    // would pour its looking into the wrong column.
    splits: s.splits.map((p) => (p.phase === "F2L 3" ? { ...p, recognitionMs: undefined } : p)),
  }));
  assert.equal(diagnose(solves).measured, null);
  assert.ok(!lookAndTurn(solves).some((l) => l.phase === "F2L"));
});

test("looking and turning per phase, with turning speed free of the pauses", () => {
  const solves = Array.from({ length: 6 }, () =>
    measured({ F2L: { look: 4000, turn: 7000 }, OLL: { look: 900, turn: 1800 }, PLL: { look: 600, turn: 2600 } }),
  );
  const table = lookAndTurn(solves);
  assert.deepEqual(
    table.map((t) => t.phase),
    ["F2L", "OLL", "PLL"],
    "the cross is left out: its looking is inspection, outside the clock",
  );
  const f2l = table.find((t) => t.phase === "F2L")!;
  assert.equal(f2l.n, 6);
  assert.equal(f2l.lookMs, 4000);
  assert.equal(f2l.turnMs, 7000);
  // 28 turns in 7 seconds of turning is 4 TPS — the 4 seconds of looking do not dilute it.
  assert.ok(Math.abs(f2l.turningTps - 4) < 1e-9, String(f2l.turningTps));
});

test("looking and turning is not reported below the diagnosis sample size", () => {
  const solves = Array.from({ length: MIN_SOLVES_FOR_DIAGNOSIS - 1 }, () =>
    measured({ F2L: { look: 4000, turn: 7000 } }),
  );
  assert.deepEqual(lookAndTurn(solves), []);
});
