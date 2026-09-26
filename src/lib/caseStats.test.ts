import { test } from "node:test";
import assert from "node:assert/strict";

import { MIN_OCCURRENCES, aggregateCases, buildNameTable } from "./caseStats";
import type { PhaseSplit } from "./cfop";
import type { StoredSolve } from "./solveHistory";
import type { Penalty } from "./types";

let seq = 0;

function solve(
  ollCase: string | null,
  ollMs: number,
  { penalty = "OK" as Penalty }: { penalty?: Penalty } = {},
): StoredSolve {
  seq += 1;
  const splits: PhaseSplit[] = [
    { phase: "Cross", startMs: 0, endMs: 1000, durationMs: 1000, moveCount: 6, tps: 6 },
    {
      phase: "OLL",
      startMs: 1000,
      endMs: 1000 + ollMs,
      durationMs: ollMs,
      moveCount: 9,
      tps: 9,
    },
  ];
  return {
    id: `c${seq}`,
    at: seq,
    scramble: "R U R'",
    durationMs: 1000 + ollMs,
    penalty,
    moveCount: 40,
    tps: 5,
    splits,
    ollCase,
    pllCase: null,
    ollSetup: ollCase ? `setup-${ollCase}` : null,
    pllSetup: null,
    source: "keyboard",
  };
}

/** n sightings of one case, all at the same time. */
function repeat(caseId: string, ms: number, times: number): StoredSolve[] {
  return Array.from({ length: times }, () => solve(caseId, ms));
}

test("a case seen too few times is not ranked at all", () => {
  const solves = repeat("rare", 9000, MIN_OCCURRENCES - 1);
  assert.deepEqual(aggregateCases(solves, "OLL"), []);
});

test("cases are ranked by recoverable time, not by raw slowness", () => {
  const solves = [
    // Disaster, but you barely ever see it: 3 x 3s over the median.
    ...repeat("rare-disaster", 6000, 3),
    // Only slightly slow, but constant: 20 x 1s over the median.
    ...repeat("common-drag", 4000, 20),
    // Two ordinary cases to set the reference.
    ...repeat("fine-a", 3000, 5),
    ...repeat("fine-b", 3000, 5),
  ];
  const ranked = aggregateCases(solves, "OLL");
  assert.equal(
    ranked[0].caseId,
    "common-drag",
    `ranked ${ranked.map((r) => `${r.caseId}:${Math.round(r.excessMs)}`).join(", ")}`,
  );
  assert.ok(ranked[0].excessMs > ranked[1].excessMs);
});

test("a case at or below the reference has no recoverable time", () => {
  const solves = [...repeat("fast", 2000, 5), ...repeat("slow", 8000, 5)];
  const fast = aggregateCases(solves, "OLL").find((c) => c.caseId === "fast")!;
  assert.equal(fast.excessMs, 0, "never negative");
});

test("counts, means and bests are per case", () => {
  const solves = [...repeat("a", 4000, 3), solve("a", 2000), ...repeat("b", 3000, 3)];
  const a = aggregateCases(solves, "OLL").find((c) => c.caseId === "a")!;
  assert.equal(a.n, 4);
  assert.equal(a.meanMs, 3500);
  assert.equal(a.bestMs, 2000);
});

test("a setup for redrawing the case is carried through", () => {
  const a = aggregateCases(repeat("a", 4000, 3), "OLL")[0];
  assert.equal(a.setupAlg, "setup-a");
});

test("DNFs and solves with no detected case are skipped", () => {
  const solves = [
    ...repeat("a", 4000, 3),
    ...Array.from({ length: 5 }, () => solve("a", 99000, { penalty: "DNF" })),
    ...Array.from({ length: 5 }, () => solve(null, 4000)),
  ];
  const a = aggregateCases(solves, "OLL").find((c) => c.caseId === "a")!;
  assert.equal(a.n, 3, "only the clean, identified solves count");
});

test("a stage that was never reached produces nothing rather than zeros", () => {
  assert.deepEqual(aggregateCases(repeat("a", 4000, 5), "PLL"), []);
});

test("names are generated from algorithms and attach to the right cases", async () => {
  const table = await buildNameTable();
  const names = [...table.values()];
  assert.ok(names.includes("Sune"));
  assert.ok(names.includes("T-perm"));
  // Every signature maps to exactly one name — no case wearing two labels.
  assert.equal(new Set(table.keys()).size, table.size);
});

test("a skip is not a case to drill, and does not drag the typical case down", async () => {
  const { OLL_SKIP } = await import("./lastLayer");
  // Three real cases at 2.0, 2.2 and 2.4s, and a skip seen often at ~0.1s.
  const solves = [...repeat("a", 2000, 3), ...repeat("b", 2200, 3), ...repeat("c", 2400, 3), ...repeat(OLL_SKIP, 100, 6)];
  const cases = aggregateCases(solves, "OLL");
  assert.ok(!cases.some((c) => c.caseId === OLL_SKIP), "the skip is listed");
  // With the skip in the reference, the median fell to 2.1s and "b" looked slow.
  assert.equal(cases.find((c) => c.caseId === "b")?.excessMs, 0);
  assert.equal(cases.find((c) => c.caseId === "c")?.excessMs, 600);
});
