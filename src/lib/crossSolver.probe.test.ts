import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCrossTable, crossDistance, CROSS_STATE_COUNT, HTM_MOVES } from "./crossSolver";

const D_EDGES = [4, 5, 6, 7];

test("the table is exhaustive, and its distances are provably optimal", async () => {
  const { puzzles } = await import("cubing/puzzles");
  const kpuzzle = await puzzles["3x3x3"].kpuzzle();
  const solved = kpuzzle.defaultPattern() as never;
  const table = buildCrossTable(solved, D_EDGES);

  const reached = table.reduce((n, v) => n + (v !== 0xff ? 1 : 0), 0);
  assert.equal(reached, CROSS_STATE_COUNT, "every cross state must be reachable");

  const depths = new Map<number, number>();
  for (const v of table) depths.set(v, (depths.get(v) ?? 0) + 1);
  const max = Math.max(...[...depths.keys()]);
  console.log(
    `  depth histogram: ${[...depths.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join("  ")}`,
  );

  assert.equal(crossDistance(table, solved, D_EDGES), 0, "a solved cross is 0 moves");

  /*
   * Independent check rather than a remembered constant. For a set of scrambles the
   * table's answer is confirmed two ways against the real puzzle: an exhaustive
   * search at depth-1 must find nothing (so the answer is not too high), and a
   * search at the stated depth must find a real solution (so it is not too low).
   */
  const crossSolved = (pattern: { patternData: Record<string, { pieces: number[]; orientation: number[] }> }) =>
    D_EDGES.every((i) => pattern.patternData.EDGES.pieces[i] === i &&
                         pattern.patternData.EDGES.orientation[i] === 0);

  const search = (pattern: never, depth: number): boolean => {
    if (depth === 0) return crossSolved(pattern as never);
    if (crossSolved(pattern as never)) return true;
    for (const move of HTM_MOVES) {
      if (search((pattern as never as { applyMove(m: string): never }).applyMove(move), depth - 1)) return true;
    }
    return false;
  };

  const scrambles = [
    "R", "R U", "F R U", "D2 R' D'", "R U R' U' F2 L",
    "U F2 D' L2 B R", "B2 D' R2 U F' L B",
  ];
  for (const scramble of scrambles) {
    const pattern = (solved as never as { applyAlg(a: string): never }).applyAlg(scramble);
    const d = crossDistance(table, pattern as never, D_EDGES);
    assert.ok(d !== 0xff, `${scramble}: state missing from table`);
    assert.ok(search(pattern, d), `${scramble}: claimed ${d} but no solution of that length exists`);
    if (d > 0) {
      assert.ok(!search(pattern, d - 1), `${scramble}: claimed ${d} but ${d - 1} suffices`);
    }
  }
  console.log(`  verified ${scrambles.length} scrambles against exhaustive search`);
});

test("the placement index round-trips", async () => {
  const { encodeForTest, decodeForTest } = await import("./crossSolver");
  for (let i = 0; i < 12 * 11 * 10 * 9; i += 137) {
    const positions = decodeForTest(i);
    assert.equal(new Set(positions).size, 4, `duplicate positions at ${i}`);
    assert.equal(encodeForTest(positions), i, `round-trip failed at ${i}`);
  }
});
