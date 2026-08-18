/**
 * Precomputes the solves the landing page demonstrates.
 *
 *   npm run demo:build     (runs before every build)
 *
 * The demo has to be instant. Solving live on the server is 1.1-1.9s including
 * the round trip, which is fine for a feature somebody asked for and far too
 * slow for the first thing a visitor sees — a landing page that makes you wait
 * two seconds to see the point has already lost most of them.
 *
 * So these are solved here, with a generous search budget, and shipped. The
 * numbers printed on the page are the ones measured during this run: real
 * scrambles, real solutions from this engine, real timings. Nothing on that page
 * is a stand-in.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTables, solveScramble } from "../src/lib/solver";

const COUNT = 12;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "data", "demo-solves.json");

const { randomScrambleForEvent } = await import("cubing/scramble");

console.log("Building solver tables…");
const tables = buildTables();
console.log(`  ready in ${tables.buildMs}ms (0 = loaded from the precomputed file)\n`);

interface Demo {
  scramble: string;
  solution: string[];
  moves: number;
  ms: number;
}

const demos: Demo[] = [];
for (let i = 0; i < COUNT; i++) {
  const scramble = (await randomScrambleForEvent("333")).toString();

  const started = performance.now();
  const result = solveScramble(scramble, { targetLength: 20, timeBudgetMs: 1500 });
  const ms = performance.now() - started;

  if (!result) {
    console.log(`  ${i + 1}: no solution within budget — skipped`);
    continue;
  }

  demos.push({
    scramble,
    solution: result.moves,
    moves: result.length,
    ms: Math.round(ms),
  });
  console.log(`  ${i + 1}: ${result.length} moves in ${Math.round(ms)}ms`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(demos, null, 2)}\n`);

const mean = demos.reduce((a, d) => a + d.moves, 0) / demos.length;
const meanMs = demos.reduce((a, d) => a + d.ms, 0) / demos.length;
console.log(`\n  ${demos.length} demos, mean ${mean.toFixed(2)} moves, mean ${Math.round(meanMs)}ms`);
console.log(`  wrote src/data/demo-solves.json`);
process.exit(0);
