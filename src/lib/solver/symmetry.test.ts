import { test } from "node:test";
import assert from "node:assert/strict";

import { compose, cubeFromAlg, isSolved, solvedCube, type CubieCube } from "./cube";
import { solve } from "./search";
import { FACE_MAP_BACK, URF3, directionsOf, inverse, rotate } from "./symmetry";
import { MOVE_CUBES, MOVES } from "./tables";

function apply(cube: CubieCube, moves: readonly string[]): CubieCube {
  let state = cube;
  for (const name of moves) {
    const index = MOVES.findIndex((m) => m.name === name);
    state = compose(state, MOVE_CUBES[index]);
  }
  return state;
}

const SCRAMBLES = [
  "R U R' U' F2 D L2 B R' U2 F L D' B2 R2 U F' L2 D R",
  "D2 B' L F2 U R' D L2 F' B U2 R D' L' F2 B2 U' R2 D",
  "F U' R2 B D' L F2 R U D2 B' L2 U F' R' D B2 L' U2",
  "L2 D' R F' U2 B L' D2 R2 F U' B2 R' D F2 L U B' R2",
  "B R2 U' F L' D2 B2 R U F2 L D' R' B U2 F' L2 D B'",
];

test("three turns about the diagonal are no turn at all", () => {
  assert.ok(isSolved(compose(compose(URF3, URF3), URF3)));
  assert.ok(!isSolved(URF3), "and one is not");
});

test("each derived face map is a permutation of the six faces", () => {
  assert.deepEqual([...FACE_MAP_BACK[0]], [0, 1, 2, 3, 4, 5], "no rotation maps every face to itself");
  for (const map of FACE_MAP_BACK) {
    assert.deepEqual([...map].sort(), [0, 1, 2, 3, 4, 5]);
  }
  // A third of a turn about URF-DBL carries three faces round and leaves no
  // face where it was.
  assert.ok(FACE_MAP_BACK[1].every((to, from) => to !== from));
});

test("an inverse undoes its cube from either side", () => {
  for (const scramble of SCRAMBLES) {
    const cube = cubeFromAlg(scramble);
    assert.ok(isSolved(compose(cube, inverse(cube))));
    assert.ok(isSolved(compose(inverse(cube), cube)));
  }
});

test("rotating a solved cube leaves it solved, and a rotation is undone by the other two", () => {
  assert.ok(isSolved(rotate(solvedCube(), 1)));
  for (const scramble of SCRAMBLES) {
    const cube = cubeFromAlg(scramble);
    const back = rotate(rotate(cube, 1), 2);
    assert.ok(isSolved(compose(back, inverse(cube))));
  }
});

test("a solution found from any of the six views solves the original cube", () => {
  for (const scramble of SCRAMBLES) {
    const cube = cubeFromAlg(scramble);
    const views = directionsOf(cube, 6);
    assert.equal(views.length, 6);
    for (const view of views) {
      // Solve the view on its own, then translate the answer back.
      const result = solve(view.cube, { directions: 1, targetLength: 22, timeBudgetMs: 100 });
      assert.ok(result, `no solution for view ${view.rotation}/${view.inverted}`);
      const indices = result.moves.map((name) => MOVES.findIndex((m) => m.name === name));
      const translated = view.toOriginal(indices).map((i) => MOVES[i].name);
      assert.ok(
        isSolved(apply(cube, translated)),
        `view rotation ${view.rotation}, inverted ${view.inverted}: ${translated.join(" ")}`,
      );
    }
  }
});

test("a multi-view solution solves the cube it was given", () => {
  for (const scramble of SCRAMBLES) {
    const cube = cubeFromAlg(scramble);
    const result = solve(cube, { targetLength: 20, timeBudgetMs: 300 });
    assert.ok(result);
    assert.ok(isSolved(apply(cube, result.moves)), `${scramble} -> ${result.moves.join(" ")}`);
  }
});
