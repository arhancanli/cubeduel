/**
 * Precomputes the solves the landing page demonstrates.
 *
 *   npm run demo:build            verifies the shipped fixture
 *   npm run demo:build -- --force generates a new one
 *
 * The demo has to be instant. Solving live on the server is 1.1-1.9s including
 * the round trip, which is fine for a feature somebody asked for and far too
 * slow for the first thing a visitor sees — a landing page that makes you wait
 * two seconds to see the point has already lost most of them.
 *
 * So these are solved ahead of time, with a generous search budget, and shipped.
 * The numbers printed on the page are the ones measured when they were found:
 * real scrambles, real solutions from this engine, real timings. Nothing on that
 * page is a stand-in.
 *
 * ## Why this does not regenerate on every build
 *
 * It used to, and that was wrong in three ways.
 *
 * The scrambles are random, so every `npm run build` rewrote a tracked file with
 * twelve entirely different solves. A working tree that is dirty after every
 * build is a tree where `git status` stops meaning anything — and the whole
 * point of that signal is to tell you when you are about to lose something.
 *
 * The timings are measured on whatever machine is building. Committing numbers
 * from a laptop and then shipping numbers from a build container means the page
 * printed one thing and the repository claimed another.
 *
 * And it meant the committed fixture was never what production served, because
 * the deploy regenerated it too. Reading this file told you nothing about what a
 * visitor actually sees.
 *
 * So the fixture is the artifact. This script verifies it by default — replaying
 * every shipped solution against its scramble and refusing a build if any of
 * them does not solve — and only generates when asked. Changing what the landing
 * page demonstrates is then a deliberate act that shows up in a diff.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTables, cubeFromAlg, isSolved, solveScramble } from "../src/lib/solver";

const COUNT = 12;
const force = process.argv.includes("--force");
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "data", "demo-solves.json");

interface Demo {
  scramble: string;
  solution: string[];
  moves: number;
  ms: number;
}

/**
 * Replays a shipped solve and says whether it actually solves the cube.
 *
 * The landing page calls this the one claim a visitor can check for themselves,
 * which only holds if somebody checks it here first.
 */
function solves(demo: Demo): boolean {
  try {
    return isSolved(cubeFromAlg([demo.scramble, ...demo.solution].join(" ")));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verify what is already shipped
// ---------------------------------------------------------------------------

if (!force && existsSync(out)) {
  let shipped: Demo[];
  try {
    shipped = JSON.parse(readFileSync(out, "utf8")) as Demo[];
  } catch {
    console.error("demo-solves.json is not valid JSON. Run with --force to rebuild.");
    process.exit(1);
  }

  const broken = shipped.filter((demo) => !solves(demo));

  if (shipped.length === 0 || broken.length > 0) {
    console.error(
      `demo-solves.json is not usable: ${shipped.length} demos, ${broken.length} that do not solve.`,
    );
    console.error("Run `npm run demo:build -- --force` to rebuild it.");
    process.exit(1);
  }

  const mean = shipped.reduce((a, d) => a + d.moves, 0) / shipped.length;
  console.log(
    `demo-solves.json: ${shipped.length} demos, all solve, mean ${mean.toFixed(2)} moves.`,
  );
  console.log("  (npm run demo:build -- --force to generate new ones)");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const { randomScrambleForEvent } = await import("cubing/scramble");

console.log("Building solver tables…");
const tables = buildTables();
console.log(`  ready in ${tables.buildMs}ms (0 = loaded from the precomputed file)\n`);

const demos: Demo[] = [];
for (let i = 0; i < COUNT; i++) {
  const scramble = (await randomScrambleForEvent("333")).toString();

  const started = performance.now();
  const result = solveScramble(scramble, { targetLength: 19, timeBudgetMs: 1000 });
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

// Refuse to ship a solve that does not solve, however it got here.
const broken = demos.filter((demo) => !solves(demo));
if (broken.length > 0) {
  console.error(`\n  ${broken.length} generated solutions do not solve. Not writing.`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(demos, null, 2)}\n`);

const mean = demos.reduce((a, d) => a + d.moves, 0) / demos.length;
const meanMs = demos.reduce((a, d) => a + d.ms, 0) / demos.length;
console.log(`\n  ${demos.length} demos, mean ${mean.toFixed(2)} moves, mean ${Math.round(meanMs)}ms`);
console.log(`  wrote src/data/demo-solves.json`);
process.exit(0);
