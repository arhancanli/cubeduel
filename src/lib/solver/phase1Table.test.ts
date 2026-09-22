import { test } from "node:test";
import assert from "node:assert/strict";

import { FLIP_COUNT, TWIST_COUNT, getFlip, getSlice, getTwist, setFlip, setSlice, setTwist } from "./coords";
import { solvedCube, type CubieCube } from "./cube";
import { multiplyFull } from "./geometry";
import {
  FLIPSLICE_COUNT,
  PHASE1_CLASS_COUNT,
  UD_SYMMETRY_COUNT,
  buildPhase1Symmetry,
  udSymmetryCubes,
} from "./phase1Table";

/**
 * The classes, not the distances.
 *
 * Working out which positions are the same up to symmetry takes about a second;
 * filling in how far each one is from G1 takes eleven, and is checked by
 * `scripts/verify-solver-tables.mts` against an independent search. What is here
 * is what the fill is built on — get a class or a symmetry wrong and the
 * distances are wrong in a way that quietly loses solutions.
 */
const symmetry = buildPhase1Symmetry();
const { cubes, inverses } = udSymmetryCubes();

function conjugate(cube: CubieCube, sym: number): CubieCube {
  const scratch = solvedCube();
  const out = solvedCube();
  multiplyFull(inverses[sym], cube, scratch);
  multiplyFull(scratch, cubes[sym], out);
  return out;
}

function edgesOf(pair: number): CubieCube {
  const cube = solvedCube();
  setFlip(cube, pair % FLIP_COUNT);
  setSlice(cube, (pair / FLIP_COUNT) | 0);
  return cube;
}

function pairOf(cube: CubieCube): number {
  return getSlice(cube) * FLIP_COUNT + getFlip(cube);
}

// Spread across the range rather than the first few thousand, which are all
// low-slice positions and not representative.
const SAMPLE = Array.from({ length: 400 }, (_, i) => (i * 2531) % FLIPSLICE_COUNT);

test("every position has a class, and there are 64,430 of them", () => {
  assert.equal(symmetry.classIndex.length, FLIPSLICE_COUNT);
  assert.equal(symmetry.classRep.length, PHASE1_CLASS_COUNT);
  for (const pair of SAMPLE) {
    assert.ok(symmetry.classIndex[pair] < PHASE1_CLASS_COUNT);
  }
  // Each class is represented by a position that belongs to it.
  for (let index = 0; index < PHASE1_CLASS_COUNT; index += 97) {
    assert.equal(symmetry.classIndex[symmetry.classRep[index]], index);
  }
});

test("a position's symmetry carries it to its class's representative", () => {
  // The claim the whole lookup rests on: `classSym` is not a label, it is the
  // symmetry that has to be applied to the corner twist as well.
  for (const pair of SAMPLE) {
    const image = pairOf(conjugate(edgesOf(pair), symmetry.classSym[pair]));
    assert.equal(image, symmetry.classRep[symmetry.classIndex[pair]], `pair ${pair}`);
  }
});

test("the representative of a class is fixed by exactly its stabiliser", () => {
  let withExtra = 0;
  for (let index = 0; index < PHASE1_CLASS_COUNT; index += 31) {
    const pair = symmetry.classRep[index];
    const cube = edgesOf(pair);
    let found = 0;
    for (let sym = 0; sym < UD_SYMMETRY_COUNT; sym++) {
      if (pairOf(conjugate(cube, sym)) === pair) found |= 1 << sym;
    }
    assert.equal(found, symmetry.classStabilizers[index], `class ${index}`);
    if (found !== 1) withExtra++;
  }
  // Some classes really do have extra symmetry — if none did, the twin rule in
  // the fill would never run and this check would prove nothing.
  assert.ok(withExtra > 0);
});

test("the twist seen through a symmetry, and back, is the twist", () => {
  const { twistConj } = symmetry;
  const { inverseIndex } = udSymmetryCubes();
  for (let twist = 0; twist < TWIST_COUNT; twist += 37) {
    // The identity is the first symmetry and changes nothing.
    assert.equal(twistConj[twist * UD_SYMMETRY_COUNT], twist);
    for (let sym = 0; sym < UD_SYMMETRY_COUNT; sym++) {
      const there = twistConj[twist * UD_SYMMETRY_COUNT + sym];
      const back = twistConj[there * UD_SYMMETRY_COUNT + inverseIndex[sym]];
      assert.equal(back, twist, `twist ${twist} through symmetry ${sym}`);
    }
  }
});

test("the twist table agrees with conjugating the cube itself", () => {
  const cube = solvedCube();
  for (let twist = 0; twist < TWIST_COUNT; twist += 53) {
    setTwist(cube, twist);
    for (let sym = 0; sym < UD_SYMMETRY_COUNT; sym++) {
      assert.equal(
        symmetry.twistConj[twist * UD_SYMMETRY_COUNT + sym],
        getTwist(conjugate(cube, sym)),
        `twist ${twist}, symmetry ${sym}`,
      );
    }
  }
});

test("the solved position is its own class, at index zero", () => {
  const solved = solvedCube();
  const pair = pairOf(solved);
  assert.equal(pair, 0);
  assert.equal(symmetry.classIndex[0], 0);
  assert.equal(symmetry.classRep[0], 0);
  // Solved is fixed by every symmetry — the most symmetric position there is.
  assert.equal(symmetry.classStabilizers[0], 0xffff);
});
