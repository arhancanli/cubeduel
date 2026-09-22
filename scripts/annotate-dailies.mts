/**
 * Records how short each daily scramble can be solved, once, into the data file.
 *
 *   npm run dailies:annotate
 *
 * The alternative was solving it on the page, which is what the first version
 * did — and it added five and a half seconds to a cold load of `/daily`, because
 * the first visitor of the day paid for the pruning tables and the search. The
 * dailies are pre-generated precisely so nothing has to be computed at request
 * time; the optimal length belongs in the same file for the same reason.
 *
 * Run this after `npm run dailies`. It is additive: existing fields are kept, so
 * re-running it only refreshes the annotation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTables, solveScramble } from "../src/lib/solver";

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, "..", "src", "data", "dailies.json");

interface Dailies {
  event: string;
  start: string;
  days: number;
  scrambles: Record<string, string>;
  difficulty?: Record<string, { cross: number; faces: string[] }>;
  optimal?: Record<string, number>;
}

const data = JSON.parse(readFileSync(path, "utf8")) as Dailies;
const days = Object.keys(data.scrambles);

console.log(`Building solver tables…`);
const tables = buildTables();
console.log(`  ready in ${tables.buildMs}ms\n`);

const optimal: Record<string, number> = {};
const lengths: number[] = [];
let failed = 0;
const started = Date.now();

for (const [index, day] of days.entries()) {
  // Worth the extra time here: this runs once and the answer ships to everyone,
  // so a shorter solution is strictly better and costs nobody anything.
  const result = solveScramble(data.scrambles[day], {
    // Offline and once, so it can afford to aim near the true minimum: a
    // random cube needs 17 or 18 moves about 95% of the time. With the exact
    // phase-one table the same budget reaches deeper, so the target is the true
    // minimum and the budget is what actually stops it.
    targetLength: 17,
    timeBudgetMs: 2500,
  });

  if (!result) {
    failed++;
    continue;
  }
  optimal[day] = result.length;
  lengths.push(result.length);

  if ((index + 1) % 50 === 0) {
    console.log(`  ${index + 1}/${days.length} …`);
  }
}

data.optimal = optimal;
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
console.log(`\nAnnotated ${lengths.length}/${days.length} dailies in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed > 0) console.log(`  ${failed} could not be solved within the budget`);
console.log(`  mean ${mean.toFixed(2)} moves, range ${Math.min(...lengths)}–${Math.max(...lengths)}`);

process.exit(0);
