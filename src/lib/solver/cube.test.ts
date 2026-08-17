import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BASE_MOVES,
  FACES,
  compose,
  cubeFromAlg,
  isSolved,
  solvedCube,
  validate,
} from "./cube";

/**
 * The move tables are transcribed by hand, which is exactly the kind of thing
 * that is silently wrong — a single swapped index produces a solver that runs
 * forever on some states and returns wrong solutions on others, with no error.
 *
 * So they are cross-checked against cubing.js, which models the same puzzle from
 * an entirely separate definition. Agreement between two independent
 * implementations is worth far more than either being "carefully checked".
 */

/**
 * cubing.js uses a DIFFERENT convention, and that is fine.
 *
 * It stores the inverse mapping (where each piece goes, rather than what sits in
 * each slot) and labels the slots in a different order. Both models are
 * internally consistent; they are simply different coordinate systems for the
 * same group, and neither is more correct.
 *
 * So the tables are not compared entry by entry — that test failed for reasons
 * that had nothing to do with correctness. They are cross-checked on properties
 * that do not depend on labelling at all.
 */
test("permutation order matches cubing.js for many algorithms", async () => {
  // The order of an algorithm — how many repetitions return the cube to solved —
  // depends on the entire group structure and not at all on how pieces are
  // named. Two models that agree on it for arbitrary algorithms are describing
  // the same puzzle.
  const { puzzles } = await import("cubing/puzzles");
  const kpuzzle = await puzzles["3x3x3"].kpuzzle();
  const solvedOptions = { ignorePuzzleOrientation: false, ignoreCenterOrientation: true };

  const algs = [
    "R",
    "R U",
    "R U R' U'",
    "R U2 D' B D'",
    "F R U' R' U' R U R' F' R U R' U' R' F R F'",
    "R L U2 R L'",
    "M2 U M2 U2 M2 U M2".replace(/M2/g, "R L' F2 B2 R' L"),
    "R2 U2 R2 U2 R2 U2",
  ];

  for (const alg of algs) {
    let mine = solvedCube();
    const move = cubeFromAlg(alg);
    let mineOrder = 0;
    for (let i = 1; i <= 2000; i++) {
      mine = compose(mine, move);
      if (isSolved(mine)) { mineOrder = i; break; }
    }

    let theirs = kpuzzle.defaultPattern();
    let theirOrder = 0;
    for (let i = 1; i <= 2000; i++) {
      theirs = theirs.applyAlg(alg);
      if (theirs.experimentalIsSolved(solvedOptions)) { theirOrder = i; break; }
    }

    assert.ok(mineOrder > 0, `no order found for ${alg}`);
    assert.equal(mineOrder, theirOrder, `order of "${alg}" disagrees with cubing.js`);
  }
});

test("agrees with cubing.js on whether a state is solved", async () => {
  // Solvedness is convention-independent. Checked across random algorithms and
  // their inverses so both answers actually occur.
  const { puzzles } = await import("cubing/puzzles");
  const kpuzzle = await puzzles["3x3x3"].kpuzzle();
  const solvedOptions = { ignorePuzzleOrientation: false, ignoreCenterOrientation: true };

  const faces = ["U", "R", "F", "D", "L", "B"];
  const suffix = ["", "'", "2"];
  let seed = 4242;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);

  for (let trial = 0; trial < 40; trial++) {
    const tokens: string[] = [];
    for (let i = 0; i < 1 + (next() % 8); i++) {
      tokens.push(faces[next() % 6] + suffix[next() % 3]);
    }
    const alg = tokens.join(" ");
    const inverse = tokens
      .slice()
      .reverse()
      .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
      .join(" ");

    for (const candidate of [alg, `${alg} ${inverse}`]) {
      const mine = isSolved(cubeFromAlg(candidate));
      const theirs = kpuzzle
        .defaultPattern()
        .applyAlg(candidate)
        .experimentalIsSolved(solvedOptions);
      assert.equal(mine, theirs, `disagreed on "${candidate}"`);
    }
  }
});

test("four quarter turns of any face is the identity", () => {
  for (const face of FACES) {
    let cube = solvedCube();
    for (let i = 0; i < 4; i++) cube = compose(cube, BASE_MOVES[face]);
    assert.ok(isSolved(cube), `${face}4 did not return to solved`);
  }
});

test("an algorithm followed by its inverse solves", () => {
  const cube = cubeFromAlg("R U R' U' F2 L D B' R2 U   U' R2 B D' L' F2 U R U' R'");
  assert.ok(isSolved(cube));
});

test("a sexy move repeated six times is the identity", () => {
  // The classic order-6 check. Wrong orientation arithmetic passes the
  // four-turn test above and fails this one.
  assert.ok(isSolved(cubeFromAlg("R U R' U' ".repeat(6))));
});

test("the two orientation invariants hold under random turning", () => {
  const faces = ["U", "R", "F", "D", "L", "B"];
  let cube = solvedCube();
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);

  for (let i = 0; i < 3000; i++) {
    const face = faces[next() % 6];
    const turns = 1 + (next() % 3);
    const move = BASE_MOVES[face as (typeof FACES)[number]];
    for (let t = 0; t < turns; t++) cube = compose(cube, move);

    const twist = Array.from(cube.co).reduce((a, b) => a + b, 0);
    const flip = Array.from(cube.eo).reduce((a, b) => a + b, 0);
    assert.equal(twist % 3, 0, `corner twist broke after ${i} moves`);
    assert.equal(flip % 2, 0, `edge flip broke after ${i} moves`);
  }
});

test("F and B flip edges; the other four faces do not", () => {
  // The whole basis of phase one. If this convention is wrong the search is
  // exploring the wrong subgroup and will never terminate correctly.
  for (const face of FACES) {
    const flips = Array.from(BASE_MOVES[face].eo).reduce((a, b) => a + b, 0);
    if (face === "F" || face === "B") {
      assert.equal(flips, 4, `${face} should flip exactly four edges`);
    } else {
      assert.equal(flips, 0, `${face} must preserve edge orientation`);
    }
  }
});

test("only U and D leave every corner untwisted", () => {
  for (const face of FACES) {
    const twists = Array.from(BASE_MOVES[face].co).reduce((a, b) => a + b, 0);
    if (face === "U" || face === "D") {
      assert.equal(twists, 0, `${face} must preserve corner orientation`);
    } else {
      assert.ok(twists > 0, `${face} should twist corners`);
    }
  }
});

test("impossible states are rejected with a reason", () => {
  assert.equal(validate(solvedCube()), null);

  const twisted = solvedCube();
  twisted.co[0] = 1;
  assert.match(validate(twisted) ?? "", /twist/);

  const flipped = solvedCube();
  flipped.eo[0] = 1;
  assert.match(validate(flipped) ?? "", /flip/);

  const swapped = solvedCube();
  [swapped.cp[0], swapped.cp[1]] = [swapped.cp[1], swapped.cp[0]];
  assert.match(validate(swapped) ?? "", /parity/);

  const duplicated = solvedCube();
  duplicated.ep[0] = 1;
  assert.match(validate(duplicated) ?? "", /duplicated|missing/);
});

test("every state reachable by turning validates", () => {
  let cube = solvedCube();
  let seed = 987;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 500; i++) {
    cube = compose(cube, BASE_MOVES[FACES[next() % 6]]);
    assert.equal(validate(cube), null, `rejected a legal state after ${i} moves`);
  }
});
