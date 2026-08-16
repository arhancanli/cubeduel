/**
 * Rates every pre-generated daily scramble by how hard its cross is.
 *
 * Run after `npm run dailies`:
 *   npx tsx scripts/rate-dailies.ts
 *
 * Difficulty is the optimal cross length, minimised over all six faces — because a
 * colour-neutral solver picks whichever cross is easiest, and that is the honest
 * measure of how kind a scramble is. Computed here rather than in the browser: each
 * face needs a ~2s breadth-first search over 190,080 states, and there is no reason
 * to make a phone do that for a scramble that was fixed months ago.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCrossTable, crossDistance } from "../src/lib/crossSolver";

const here = dirname(fileURLToPath(import.meta.url));
const dailiesPath = join(here, "..", "src", "data", "dailies.json");

async function main() {
const realLog = console.log;
console.log = () => {};
const { puzzles } = await import("cubing/puzzles");
console.log = realLog;

const kpuzzle = await puzzles["3x3x3"].kpuzzle();
const solved = kpuzzle.defaultPattern();

/** Edge slots disturbed by a face turn are exactly that face's four edges. */
function edgesOf(face: string): number[] {
  const after = solved.applyMove(face).patternData.EDGES;
  const before = solved.patternData.EDGES;
  const out: number[] = [];
  for (let i = 0; i < before.pieces.length; i++) {
    if (before.pieces[i] !== after.pieces[i] || before.orientation[i] !== after.orientation[i]) {
      out.push(i);
    }
  }
  return out;
}

const FACES = ["U", "D", "R", "L", "F", "B"];

console.log("Building cross tables (one per face)…");
const tables = FACES.map((face) => {
  const started = Date.now();
  const slots = edgesOf(face);
  const table = buildCrossTable(solved as never, slots);
  console.log(`  ${face}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { face, slots, table };
});

const data = JSON.parse(readFileSync(dailiesPath, "utf8"));
const scrambles: Record<string, string> = data.scrambles;

/*
 * Every face achieving the minimum is recorded, not just the first one found.
 * Scanning in a fixed order and keeping the first winner silently biased the result
 * toward whichever face was checked first — U took 151 of 400 when an even split is
 * ~67. The move count was never affected, but a stored "easiest face" that is really
 * "first face in my loop" is the kind of wrong data that gets trusted later.
 */
const rated: Record<string, { cross: number; faces: string[] }> = {};
const histogram = new Map<number, number>();

for (const [dayKey, scramble] of Object.entries(scrambles)) {
  const pattern = solved.applyAlg(scramble);
  const distances = tables.map(({ face, slots, table }) => ({
    face,
    d: crossDistance(table, pattern as never, slots),
  }));
  const cross = Math.min(...distances.map((x) => x.d));
  rated[dayKey] = { cross, faces: distances.filter((x) => x.d === cross).map((x) => x.face) };
  histogram.set(cross, (histogram.get(cross) ?? 0) + 1);
}

data.difficulty = rated;
writeFileSync(dailiesPath, `${JSON.stringify(data)}\n`);

const total = Object.keys(rated).length;
console.log(`\nRated ${total} daily scrambles.`);
console.log(
  "Easiest-cross distribution: " +
    [...histogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([moves, n]) => `${moves}mv:${n}`)
      .join("  "),
);
const faceWins = new Map<string, number>();
for (const { faces } of Object.values(rated)) {
  for (const face of faces) faceWins.set(face, (faceWins.get(face) ?? 0) + 1);
}
console.log(
  "Faces achieving the minimum: " +
    [...faceWins.entries()].sort().map(([f, n]) => `${f}:${n}`).join("  "),
);
const mean =
  [...histogram.entries()].reduce((a, [moves, n]) => a + moves * n, 0) / total;
console.log(`Mean easiest cross: ${mean.toFixed(2)} moves`);
}

// Wrapped rather than using top-level await: tsx's transform emits CJS here, which
// cannot require an async module.
main().then(() => process.exit(0));
