/**
 * Finds an algorithm for every F2L case and writes src/data/f2l.json.
 *
 * The search is over the moves a cuber actually uses to insert a pair: turns
 * of the top face, and the six "triggers" that take the pair out of or into
 * the front-right slot — R U R', R U' R', R U2 R', and their mirror on the
 * front face, F' U F, F' U' F, F' U2 F. Each trigger leaves the cross and the
 * other three slots where they were, so any sequence of them does too.
 *
 * Sequences are tried shortest first, counted in face turns; the first one
 * whose undoing produces a case not yet seen becomes that case's algorithm.
 * The search stops when all 41 are found. A sequence never starts or ends with
 * a top-face turn: the case is the same whichever way the top is turned, so a
 * leading turn only moves the pieces and a trailing one does nothing useful.
 *
 *     npx tsx scripts/build-f2l.mts
 */
import { writeFileSync } from "node:fs";

import { caseKey, f2lSolved, groupOf, pairSolved, setupOf, GROUP_ORDER } from "../src/lib/f2l";
import { compose, cubeFromAlg } from "../src/lib/solver/cube";

const U_MOVES = ["U", "U'", "U2"];
const TRIGGERS = ["R U R'", "R U' R'", "R U2 R'", "F' U F", "F' U' F", "F' U2 F"];
const SYMBOLS = [...U_MOVES, ...TRIGGERS];

const turns = (alg: string) => alg.split(" ").filter(Boolean).length;

interface Found {
  key: string;
  alg: string;
  moves: number;
}

const found = new Map<string, Found>();
const MAX_SYMBOLS = 9;

// Iterative deepening on the number of symbols, collecting every candidate at
// each depth, then keeping the shortest in face turns per case.
function extend(seq: string[], depth: number, out: string[][]): void {
  if (seq.length === depth) {
    out.push(seq);
    return;
  }
  for (const s of SYMBOLS) {
    const last = seq[seq.length - 1];
    // Two top-face turns in a row are one turn; never write them separately.
    if (last && U_MOVES.includes(last) && U_MOVES.includes(s)) continue;
    // Never start with a top-face turn.
    if (seq.length === 0 && U_MOVES.includes(s)) continue;
    extend([...seq, s], depth, out);
  }
}

for (let depth = 1; depth <= MAX_SYMBOLS && found.size < 41; depth++) {
  const candidates: string[][] = [];
  extend([], depth, candidates);
  const scored = candidates
    .filter((seq) => !U_MOVES.includes(seq[seq.length - 1]))
    .map((seq) => {
      const alg = seq.join(" ");
      return { alg, moves: turns(alg), rTriggers: seq.filter((s) => s.startsWith("R")).length };
    })
    // Fewest turns first; among equals, prefer R triggers, which most cubers
    // execute faster than F ones.
    .sort((a, b) => a.moves - b.moves || b.rTriggers - a.rTriggers || a.alg.localeCompare(b.alg));
  for (const { alg, moves } of scored) {
    const setup = setupOf(alg);
    if (pairSolved(setup)) continue;
    const key = caseKey(setup);
    if (!key || found.has(key)) continue;
    // The algorithm must finish the job from its own setup.
    if (!f2lSolved(compose(setup, cubeFromAlg(alg)))) continue;
    found.set(key, { key, alg, moves });
  }
  console.log(`depth ${depth}: ${found.size} cases`);
}

if (found.size !== 41) {
  console.error(`only ${found.size} of 41 cases found — raise MAX_SYMBOLS`);
  process.exit(1);
}

const cases = [...found.values()]
  .map((f) => ({ ...f, group: groupOf(setupOf(f.alg)) }))
  .sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.moves - b.moves || a.alg.localeCompare(b.alg),
  )
  .map((c, i) => ({ number: i + 1, group: c.group, alg: c.alg, moves: c.moves, key: c.key }));

writeFileSync("src/data/f2l.json", JSON.stringify(cases, null, 2) + "\n");
console.log(`wrote ${cases.length} cases`);
