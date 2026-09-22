/**
 * Checks the generated phase-one table against an independent search.
 *
 *   npm run tables:build && npm run verify:tables
 *
 * The table says how many moves every phase-one position needs to reach G1, and
 * the search believes it completely: a number one too high makes the search cut
 * the branch holding the shortest solution, and nothing anywhere reports it. The
 * cube still gets solved, in more moves, by a solver that looks like it is
 * working.
 *
 * So the table is not trusted here. Its answers are compared against the same
 * question asked the slow way — iterative deepening under the old pair bounds,
 * which are built by different code from different coordinates — and against
 * itself under every symmetry it claims to be invariant under.
 *
 * It lives in a script rather than the unit tests because building the table
 * takes eleven seconds and 67MB, which does not belong in a suite that runs on
 * every save. CI runs it right after generating the tables.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  buildTables,
  compose,
  isSolved,
  solve,
  solvedCube,
  validate,
  type CubieCube,
} from "../src/lib/solver";
import { multiplyFull } from "../src/lib/solver/geometry";
import { PHASE1_CACHE_PATH } from "../src/lib/solver/cache";
import { FLIP_COUNT, SLICE_COUNT, getFlip, getSlice, getTwist } from "../src/lib/solver/coords";
import { MOVES, MOVE_COUNT, MOVE_CUBES } from "../src/lib/solver/tables";
import {
  PHASE1_TABLE_SIZE,
  UD_SYMMETRY_COUNT,
  buildPhase1Symmetry,
  phase1Distance,
  phase1DistanceAt,
  udSymmetryCubes,
} from "../src/lib/solver/phase1Table";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

if (!existsSync(join(process.cwd(), PHASE1_CACHE_PATH))) {
  console.error(`${PHASE1_CACHE_PATH} is missing. Run \`npm run tables:build\` first.`);
  process.exit(1);
}

const t = buildTables();
if (!t.phase1) {
  console.error(
    `${PHASE1_CACHE_PATH} exists but was refused by the loader — its version or its\n` +
      "declared lengths do not match this build. Regenerate it with `npm run tables:build`.",
  );
  process.exit(1);
}
const phase1 = t.phase1;

/** Deterministic, so a failure is reproducible from the seed alone. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function shuffle(values: number[], rand: () => number): number[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function parity(perm: number[]): number {
  let swaps = 0;
  const work = [...perm];
  for (let i = 0; i < work.length; i++) {
    while (work[i] !== i) {
      const j = work[i];
      [work[i], work[j]] = [work[j], work[i]];
      swaps++;
    }
  }
  return swaps & 1;
}

function randomState(rand: () => number): CubieCube {
  const cube = solvedCube();
  const cp = shuffle([0, 1, 2, 3, 4, 5, 6, 7], rand);
  const ep = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], rand);
  if (parity(cp) !== parity(ep)) [ep[0], ep[1]] = [ep[1], ep[0]];
  cube.cp.set(cp);
  cube.ep.set(ep);

  let twist = 0;
  for (let i = 0; i < 7; i++) {
    cube.co[i] = Math.floor(rand() * 3);
    twist += cube.co[i];
  }
  cube.co[7] = (3 - (twist % 3)) % 3;

  let flip = 0;
  for (let i = 0; i < 11; i++) {
    cube.eo[i] = Math.floor(rand() * 2);
    flip += cube.eo[i];
  }
  cube.eo[11] = flip % 2;
  return cube;
}

/**
 * The same question the table answers, asked without the table: the shortest
 * sequence that reaches G1, found by iterative deepening under the pair bounds.
 *
 * Slow — seconds for the deepest positions — and that is the point. It shares no
 * code with the table beyond the move tables themselves.
 */
function optimalPhase1(twist0: number, flip0: number, slice0: number): number {
  for (let limit = 0; limit <= 13; limit++) {
    if (descend(limit, twist0, flip0, slice0, -1)) return limit;
  }
  throw new Error("no phase-one solution within thirteen moves");

  function descend(left: number, twist: number, flip: number, slice: number, lastFace: number): boolean {
    if (left === 0) return twist === 0 && flip === 0 && slice === 0;
    const lower = Math.max(
      t.twistFlipPrune[twist * FLIP_COUNT + flip],
      t.twistSlicePrune[twist * SLICE_COUNT + slice],
      t.flipSlicePrune[flip * SLICE_COUNT + slice],
    );
    if (lower > left) return false;

    for (let m = 0; m < MOVE_COUNT; m++) {
      const face = (m / 3) | 0;
      if (face === lastFace) continue;
      if (lastFace >= 3 && face === lastFace - 3) continue;
      if (
        descend(
          left - 1,
          t.twistMove[twist * MOVE_COUNT + m],
          t.flipMove[flip * MOVE_COUNT + m],
          t.sliceMove[slice * MOVE_COUNT + m],
          face,
        )
      ) {
        return true;
      }
    }
    return false;
  }
}

console.log("The exact phase-one table\n");

// ---------------------------------------------------------------------------
console.log("== the table as a whole ==");
{
  const histogram = new Array<number>(16).fill(0);
  for (let i = 0; i < PHASE1_TABLE_SIZE; i++) histogram[phase1DistanceAt(phase1.distances, i)]++;

  check("every position was reached", histogram[15] === 0, `${histogram[15]} unreached`);
  check("solved is zero moves away", phase1Distance(phase1, 0, 0, 0) === 0);
  check("only solved is", histogram[0] === 1, `${histogram[0]} entries at zero`);

  const deepest = histogram.findLastIndex((n, d) => n > 0 && d < 15);
  // Kociemba's figure for the hardest phase one, and a strong check on the
  // fill: a table that stopped early would show a shallower maximum, and one
  // that overshot would show a deeper one.
  check("the hardest position needs twelve moves", deepest === 12, `deepest ${deepest}`);
  check(
    "most positions need nine or ten",
    (histogram[9] + histogram[10]) / PHASE1_TABLE_SIZE > 0.9,
    `${(((histogram[9] + histogram[10]) / PHASE1_TABLE_SIZE) * 100).toFixed(1)}%`,
  );
  console.log(`         ${histogram.map((n, d) => (n && d < 15 ? `${d}:${n}` : "")).filter(Boolean).join("  ")}`);
}

// ---------------------------------------------------------------------------
console.log("\n== against an independent search ==");
{
  const rand = rng(20260922);
  let agreed = 0;
  let deepest = 0;
  let disagreement = "";

  for (let i = 0; i < 40; i++) {
    const cube = randomState(rand);
    const twist = getTwist(cube);
    const flip = getFlip(cube);
    const slice = getSlice(cube);

    const fromTable = phase1Distance(phase1, twist, flip, slice);
    const optimal = optimalPhase1(twist, flip, slice);
    if (fromTable === optimal) agreed++;
    else if (!disagreement) disagreement = `table ${fromTable}, really ${optimal}`;
    deepest = Math.max(deepest, optimal);
  }

  check("the table's distance is the true shortest", agreed === 40, disagreement || `${agreed}/40`);
  // If every sampled position were shallow the comparison would be weak, since
  // the pair bounds are nearly exact near the goal.
  check("the sample reached deep positions", deepest >= 10, `deepest ${deepest}`);
}

// ---------------------------------------------------------------------------
console.log("\n== the symmetry it is built on ==");
{
  const rand = rng(11);
  const { cubes, inverses } = udSymmetryCubes();
  let invariant = 0;
  let atLeastPairs = 0;
  let mismatch = "";

  const scratch = solvedCube();
  const conjugated = solvedCube();

  for (let i = 0; i < 300; i++) {
    const cube = randomState(rand);
    const twist = getTwist(cube);
    const flip = getFlip(cube);
    const slice = getSlice(cube);
    const distance = phase1Distance(phase1, twist, flip, slice);

    // The same cube, turned or mirrored, is the same distance from G1 — that is
    // the claim that lets one entry stand for sixteen positions. Checked on the
    // cube itself rather than through the class arrays, so a wrong `classSym`
    // or `twistConj` has nowhere to hide.
    let same = true;
    for (let sym = 0; sym < UD_SYMMETRY_COUNT; sym++) {
      multiplyFull(inverses[sym], cube, scratch);
      multiplyFull(scratch, cubes[sym], conjugated);
      const seen = phase1Distance(
        phase1,
        getTwist(conjugated),
        getFlip(conjugated),
        getSlice(conjugated),
      );
      if (seen !== distance) {
        same = false;
        if (!mismatch) mismatch = `symmetry ${sym}: ${seen} against ${distance}`;
      }
    }
    if (same) invariant++;

    const pairs = Math.max(
      t.twistFlipPrune[twist * FLIP_COUNT + flip],
      t.twistSlicePrune[twist * SLICE_COUNT + slice],
      t.flipSlicePrune[flip * SLICE_COUNT + slice],
    );
    if (distance >= pairs) atLeastPairs++;
  }

  check("every symmetric view of a position is the same distance away", invariant === 300, mismatch || `${invariant}/300`);
  check("the exact distance is never below the pair bounds", atLeastPairs === 300, `${atLeastPairs}/300`);
}

// ---------------------------------------------------------------------------
console.log("\n== the classes, rebuilt ==");
{
  // The file on disk carries the classes it was built with. Recomputing them
  // here and comparing catches a file written by older code whose lengths
  // happen to match — the version check cannot see that.
  const fresh = buildPhase1Symmetry();
  let sameClass = 0;
  let sameSym = 0;
  const step = 977;
  let sampled = 0;
  for (let pair = 0; pair < fresh.classIndex.length; pair += step) {
    sampled++;
    if (fresh.classIndex[pair] === phase1.classIndex[pair]) sameClass++;
    if (fresh.classSym[pair] === phase1.classSym[pair]) sameSym++;
  }
  check("the stored classes are the ones this build computes", sameClass === sampled, `${sameClass}/${sampled}`);
  check("and so are the stored symmetries", sameSym === sampled, `${sameSym}/${sampled}`);
}

// ---------------------------------------------------------------------------
console.log("\n== solving with it ==");
{
  const rand = rng(4242);
  let solved = 0;
  let exactNodes = 0;
  let pairNodes = 0;
  let longest = 0;
  let exactTotal = 0;
  let pairTotal = 0;

  for (let i = 0; i < 25; i++) {
    const cube = randomState(rand);
    if (validate(cube)) throw new Error("generated an illegal state");

    // A generous budget, and both arms get the same one on the same machine.
    // The server runs 450ms because it caches the answer; a check that used
    // that number would be measuring the runner's CPU, which is how this
    // asserted "no solution longer than 20" and passed on a laptop for a day
    // before a slower machine found a 21 — a length two-phase search has never
    // promised.
    const withTable = solve(cube, { targetLength: 19, timeBudgetMs: 1500 });
    const without = solve(cube, { targetLength: 19, timeBudgetMs: 1500, exactTable: false });
    if (!withTable || !without) continue;
    exactTotal += withTable.length;
    pairTotal += without.length;

    // Replayed, not assumed: the only claim that matters about a solver.
    let state = cube;
    for (const name of withTable.moves) {
      const index = MOVES.findIndex((m) => m.name === name);
      state = compose(state, MOVE_CUBES[index]);
    }
    if (isSolved(state)) solved++;
    longest = Math.max(longest, withTable.length);
    exactNodes += withTable.nodes;
    pairNodes += without.nodes;
  }

  check("every solution solves the cube", solved === 25, `${solved}/25`);
  // What the solver actually promises, rather than what a fast machine happens
  // to manage: nothing longer than the ceiling it was given.
  check("no solution exceeds the length the search was allowed", longest <= 26, `longest ${longest}`);
  // The tripwire that a wrong table would trip. It is relative — the same
  // machine, the same budget, the weaker bound as the control — so it says
  // something about the table rather than about the hardware. A table whose
  // distances are too high loses shortest solutions, and that shows up here as
  // answers no better than the bound it was supposed to beat.
  check(
    "the exact table's answers are at least as short as the pair bounds'",
    exactTotal <= pairTotal,
    `${exactTotal} moves against ${pairTotal}`,
  );
  check(
    "the table is worth its size: fewer nodes than the pair bounds",
    exactNodes * 2 < pairNodes,
    `${(exactNodes / 1e6).toFixed(1)}M against ${(pairNodes / 1e6).toFixed(1)}M`,
  );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
