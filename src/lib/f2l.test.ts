import assert from "node:assert/strict";
import { test } from "node:test";

import cases from "../data/f2l.json";
import { caseKey, f2lSolved, groupOf, pairSolved, restIntact, setupOf } from "./f2l";
import { compose, cubeFromAlg, solvedCube } from "./solver/cube";

test("there are exactly 41 cases, all different", () => {
  assert.equal(cases.length, 41);
  const keys = new Set(cases.map((c) => caseKey(setupOf(c.alg))));
  assert.equal(keys.size, 41);
});

test("every case's picture is a real F2L case: the rest done, the pair not", () => {
  for (const c of cases) {
    const setup = setupOf(c.alg);
    assert.ok(restIntact(setup), `#${c.number} ${c.alg} disturbs the cross or another pair`);
    assert.ok(!pairSolved(setup), `#${c.number} ${c.alg} starts solved`);
  }
});

test("every algorithm finishes the first two layers from its own case", () => {
  for (const c of cases) {
    const after = compose(setupOf(c.alg), cubeFromAlg(c.alg));
    assert.ok(f2lSolved(after), `#${c.number} ${c.alg}`);
  }
});

test("the stored key and group are the ones the cube itself gives", () => {
  for (const c of cases) {
    const setup = setupOf(c.alg);
    assert.equal(c.key, caseKey(setup), `#${c.number}`);
    assert.equal(c.group, groupOf(setup), `#${c.number}`);
  }
});

test("the groups have the sizes the arithmetic says they must", () => {
  // Corner on top (12 placements) × edge on top (8) ÷ 4 turns of U = 24;
  // one piece on top and one in its slot: 12 × 2 ÷ 4 = 6 each way;
  // both in the slot: 3 × 2 = 6, less the solved one = 5.
  const count = (g: string) => cases.filter((c) => c.group === g).length;
  assert.equal(count("Both on top"), 24);
  assert.equal(count("Corner on top, edge in slot"), 6);
  assert.equal(count("Edge on top, corner in slot"), 6);
  assert.equal(count("Both in slot"), 5);
});

test("a case is the same case however the top is turned", () => {
  for (const c of cases.slice(0, 10)) {
    const setup = setupOf(c.alg);
    for (const u of ["U", "U2", "U'"]) {
      assert.equal(caseKey(compose(setup, cubeFromAlg(u))), c.key, `#${c.number} after ${u}`);
    }
  }
});

test("a cube with a broken cross is not an F2L case at all", () => {
  assert.equal(caseKey(cubeFromAlg("D")), null);
  assert.equal(caseKey(solvedCube()) !== null, true);
});

test("disturbing any other pair means it is not a front-right case", () => {
  // Each takes one of the other three pairs out of its slot and leaves the
  // cross alone: R' U R the back-right, L U L' the front-left, L' U L the
  // back-left.
  for (const alg of ["R' U R", "L U L'", "L' U L", "B U B'"]) {
    assert.equal(caseKey(cubeFromAlg(alg)), null, alg);
  }
});

test("every piece of the rest is checked on its own", () => {
  // Built directly rather than by turning, so exactly one piece is out of
  // place — turns always move a corner and an edge together, which let a check
  // that forgot one kind of piece pass unnoticed.
  for (const edge of [4, 5, 6, 7, 9, 10, 11]) {
    const cube = solvedCube();
    cube.ep[edge] = 0;
    cube.ep[0] = edge;
    assert.equal(restIntact(cube), false, `edge ${edge} swapped out`);
  }
  for (const corner of [5, 6, 7]) {
    const cube = solvedCube();
    cube.cp[corner] = 0;
    cube.cp[0] = corner;
    assert.equal(restIntact(cube), false, `corner ${corner} swapped out`);
    const twisted = solvedCube();
    twisted.co[corner] = 1;
    assert.equal(restIntact(twisted), false, `corner ${corner} twisted`);
  }
});
