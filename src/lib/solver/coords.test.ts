import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BASE_MOVES,
  FACES,
  compose,
  cubeFromAlg,
  solvedCube,
  type CubieCube,
} from "./cube";
import {
  CORNER_PERM_COUNT,
  EDGE8_PERM_COUNT,
  FLIP_COUNT,
  SLICE_COUNT,
  SLICE_PERM_COUNT,
  TWIST_COUNT,
  getCornerPerm,
  getEdge8Perm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
  isInG1,
  setCornerPerm,
  setEdge8Perm,
  setFlip,
  setSlice,
  setSlicePerm,
  setTwist,
} from "./coords";

/** Deterministic pseudo-random cube, so a failure is reproducible. */
function randomCube(seed: number, moves = 30): CubieCube {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff);
  let cube = solvedCube();
  for (let i = 0; i < moves; i++) {
    cube = compose(cube, BASE_MOVES[FACES[next() % 6]]);
  }
  return cube;
}

// ---------------------------------------------------------------------------
// Round trips — a coordinate that cannot be inverted cannot build a move table
// ---------------------------------------------------------------------------

test("every corner-orientation value round-trips", () => {
  for (let i = 0; i < TWIST_COUNT; i++) {
    const cube = solvedCube();
    setTwist(cube, i);
    assert.equal(getTwist(cube), i);
    // The invariant must hold for every representative the solver constructs.
    assert.equal(Array.from(cube.co).reduce((a, b) => a + b, 0) % 3, 0);
  }
});

test("every edge-orientation value round-trips", () => {
  for (let i = 0; i < FLIP_COUNT; i++) {
    const cube = solvedCube();
    setFlip(cube, i);
    assert.equal(getFlip(cube), i);
    assert.equal(Array.from(cube.eo).reduce((a, b) => a + b, 0) % 2, 0);
  }
});

test("every slice-position value round-trips and places four edges", () => {
  for (let i = 0; i < SLICE_COUNT; i++) {
    const cube = solvedCube();
    setSlice(cube, i);
    assert.equal(getSlice(cube), i);
    const inSlice = Array.from(cube.ep).filter((p) => p >= 8).length;
    assert.equal(inSlice, 4, `index ${i} placed ${inSlice} slice edges`);
    assert.equal(new Set(cube.ep).size, 12, `index ${i} duplicated an edge`);
  }
});

test("every permutation value round-trips", () => {
  // Sampled rather than exhaustive for the two 40,320-value coordinates: the
  // Lehmer code is either right everywhere or wrong everywhere, and the slice
  // permutation below is checked exhaustively as the canary.
  for (let i = 0; i < CORNER_PERM_COUNT; i += 37) {
    const cube = solvedCube();
    setCornerPerm(cube, i);
    assert.equal(getCornerPerm(cube), i);
    assert.equal(new Set(cube.cp).size, 8);
  }
  for (let i = 0; i < EDGE8_PERM_COUNT; i += 37) {
    const cube = solvedCube();
    setEdge8Perm(cube, i);
    assert.equal(getEdge8Perm(cube), i);
  }
  for (let i = 0; i < SLICE_PERM_COUNT; i++) {
    const cube = solvedCube();
    setSlicePerm(cube, i);
    assert.equal(getSlicePerm(cube), i);
  }
});

test("a solved cube sits at the origin of every coordinate", () => {
  const cube = solvedCube();
  assert.equal(getTwist(cube), 0);
  assert.equal(getFlip(cube), 0);
  assert.equal(getSlice(cube), 0);
  assert.equal(getCornerPerm(cube), 0);
  assert.equal(getEdge8Perm(cube), 0);
  assert.equal(getSlicePerm(cube), 0);
  assert.ok(isInG1(cube));
});

// ---------------------------------------------------------------------------
// The property the whole method rests on
// ---------------------------------------------------------------------------

test("a move's effect on a coordinate depends only on that coordinate", () => {
  // This is what makes a move a table lookup instead of a cube operation. If it
  // were false the tables would be silently wrong for some states — the search
  // would still run, and would return solutions that do not solve.
  //
  // Checked by taking a real scrambled cube and a synthetic cube built from just
  // its coordinate, which agree on nothing else, and confirming that any move
  // leaves them still agreeing.
  const coordinates = [
    { name: "twist", get: getTwist, set: setTwist },
    { name: "flip", get: getFlip, set: setFlip },
    { name: "slice", get: getSlice, set: setSlice },
    { name: "cornerPerm", get: getCornerPerm, set: setCornerPerm },
  ];

  for (let seed = 1; seed <= 25; seed++) {
    const real = randomCube(seed);
    for (const coord of coordinates) {
      const synthetic = solvedCube();
      coord.set(synthetic, coord.get(real));
      assert.equal(coord.get(synthetic), coord.get(real), `${coord.name}: setup`);

      for (const face of FACES) {
        const movedReal = compose(real, BASE_MOVES[face]);
        const movedSynthetic = compose(synthetic, BASE_MOVES[face]);
        assert.equal(
          coord.get(movedSynthetic),
          coord.get(movedReal),
          `${coord.name} diverged after ${face} (seed ${seed})`,
        );
      }
    }
  }
});

test("the G1 edge coordinates depend only on themselves, under G1 moves", () => {
  // The U/D-edge and slice permutations are only well defined inside G1, so they
  // are checked against the moves phase two is actually allowed to use.
  const g1 = ["U", "D", "R2", "L2", "F2", "B2"];

  for (let seed = 1; seed <= 25; seed++) {
    // A cube reachable from solved using only G1 moves.
    let real = solvedCube();
    let state = seed * 7919;
    const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 25; i++) {
      real = compose(real, cubeFromAlg(g1[next() % g1.length]));
    }

    for (const coord of [
      { name: "edge8Perm", get: getEdge8Perm, set: setEdge8Perm },
      { name: "slicePerm", get: getSlicePerm, set: setSlicePerm },
    ]) {
      const synthetic = solvedCube();
      coord.set(synthetic, coord.get(real));

      for (const move of g1) {
        const m = cubeFromAlg(move);
        assert.equal(
          coord.get(compose(synthetic, m)),
          coord.get(compose(real, m)),
          `${coord.name} diverged after ${move} (seed ${seed})`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// G1 itself
// ---------------------------------------------------------------------------

test("G1 moves cannot leave G1", () => {
  // The reason phase two can never undo phase one's work.
  const g1 = ["U", "U'", "U2", "D", "D'", "D2", "R2", "L2", "F2", "B2"];
  let cube = solvedCube();
  let state = 31337;
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff);

  for (let i = 0; i < 500; i++) {
    cube = compose(cube, cubeFromAlg(g1[next() % g1.length]));
    assert.ok(isInG1(cube), `left G1 after ${i} moves`);
  }
});

test("a quarter turn of F, B, R or L leaves G1", () => {
  // If any of these stayed inside G1, phase one would have nothing to do.
  for (const move of ["F", "B", "R", "L"]) {
    assert.ok(!isInG1(cubeFromAlg(move)), `${move} unexpectedly stayed in G1`);
  }
});

test("coordinates stay inside their declared ranges", () => {
  // An out-of-range coordinate is an out-of-bounds table read, which in a typed
  // array is `undefined` rather than a crash — the search would silently treat
  // it as a wall.
  for (let seed = 1; seed <= 50; seed++) {
    const cube = randomCube(seed, 40);
    assert.ok(getTwist(cube) < TWIST_COUNT && getTwist(cube) >= 0);
    assert.ok(getFlip(cube) < FLIP_COUNT && getFlip(cube) >= 0);
    assert.ok(getSlice(cube) < SLICE_COUNT && getSlice(cube) >= 0);
    assert.ok(getCornerPerm(cube) < CORNER_PERM_COUNT && getCornerPerm(cube) >= 0);
  }
});
