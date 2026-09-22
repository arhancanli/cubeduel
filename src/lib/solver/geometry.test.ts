import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_MOVES, CORNER_COUNT, EDGE_COUNT, FACES, cubeFromAlg, solvedCube, multiply, type CubieCube } from "./cube";
import {
  UD_SYMMETRY_MAPS,
  cubeOfMotion,
  cubeOfTurn,
  faceMapOfTurn,
  invertFaceMap,
  multiplyFull,
  type FaceMap,
} from "./geometry";
import { isInG1 } from "./coords";
import { URF3 } from "./symmetry";

function same(a: CubieCube, b: CubieCube): boolean {
  for (let i = 0; i < CORNER_COUNT; i++) if (a.cp[i] !== b.cp[i] || a.co[i] !== b.co[i]) return false;
  for (let i = 0; i < EDGE_COUNT; i++) if (a.ep[i] !== b.ep[i] || a.eo[i] !== b.eo[i]) return false;
  return true;
}

function compose2(first: FaceMap, second: FaceMap): FaceMap {
  const out = {} as FaceMap;
  for (const face of FACES) out[face] = second[first[face]];
  return out;
}

const ALGS = [
  "R U R' U'",
  "F2 D L2 B R' U2 F",
  "L D' B2 R2 U F' L2 D R",
  "B' L F2 U R' D L2 F'",
];

/**
 * The check the rest of this file rests on.
 *
 * `geometry.ts` exists to produce symmetries, and a symmetry cannot be compared
 * against anything already in this repository — so the same code is asked to
 * produce the six face turns, which can. They were transcribed from Kociemba
 * and are themselves checked against cubing.js in `cube.test.ts`. Two
 * independent routes to the same twenty-four numbers per move is what makes the
 * symmetries trustworthy, orientation conventions and all.
 */
test("the six turns derived from the cube's shape are the transcribed ones", () => {
  for (const face of FACES) {
    assert.ok(same(cubeOfTurn(face), BASE_MOVES[face]), `${face} differs`);
  }
});

test("the rotation about the URF-DBL diagonal is derived the same way", () => {
  // `symmetry.ts` writes this one out; here it falls out of the geometry.
  const urf: FaceMap = { U: "R", R: "F", F: "U", D: "L", L: "B", B: "D" };
  assert.ok(same(cubeOfMotion(urf), URF3));
});

test("a turn's face map is a quarter turn: four of them is none", () => {
  for (const face of FACES) {
    const quarter = faceMapOfTurn(face);
    let map = quarter;
    for (let i = 0; i < 3; i++) map = compose2(map, quarter);
    for (const f of FACES) assert.equal(map[f], f, `${face} four times moved ${f}`);
    // And one of them is not the identity.
    assert.ok(FACES.some((f) => quarter[f] !== f));
  }
});

test("there are sixteen U-D symmetries, all distinct, and they keep the axis", () => {
  const seen = new Set(UD_SYMMETRY_MAPS.map((m) => FACES.map((f) => m[f]).join("")));
  assert.equal(UD_SYMMETRY_MAPS.length, 16);
  assert.equal(seen.size, 16);

  for (const map of UD_SYMMETRY_MAPS) {
    // U and D may swap with each other and with nothing else: that is what
    // "leaves the U-D axis alone" means, and it is the whole reason these
    // sixteen preserve phase one's goal.
    assert.ok(map.U === "U" || map.U === "D");
    assert.ok(map.D === "D" || map.D === "U");
    assert.notEqual(map.U, map.D);
  }
});

test("the sixteen are a group: every product of two is one of them", () => {
  const key = (m: FaceMap) => FACES.map((f) => m[f]).join("");
  const members = new Set(UD_SYMMETRY_MAPS.map(key));
  for (const a of UD_SYMMETRY_MAPS) {
    assert.ok(members.has(key(invertFaceMap(a))), "an inverse is missing");
    for (const b of UD_SYMMETRY_MAPS) {
      assert.ok(members.has(key(compose2(a, b))), "a product is missing");
    }
  }
});

test("half of them are mirrors, and only those carry mirrored orientations", () => {
  let mirrors = 0;
  for (const map of UD_SYMMETRY_MAPS) {
    const cube = cubeOfMotion(map);
    const mirrored = [...cube.co].some((o) => o >= 3);
    if (mirrored) {
      mirrors++;
      // Mirroring is a property of the whole state, not of one corner.
      assert.ok([...cube.co].every((o) => o >= 3));
    }
  }
  assert.equal(mirrors, 8);
});

test("conjugating a G1 move by any of them gives a G1 move", () => {
  // The property phase one depends on. If it failed for even one symmetry, that
  // symmetry would relate positions with different phase-one distances and the
  // table built on it would be wrong — in the direction that loses solutions.
  const g1 = ["U", "U2", "U'", "D", "D2", "D'", "R2", "L2", "F2", "B2"];
  const out = solvedCube();
  const scratch = solvedCube();

  for (const map of UD_SYMMETRY_MAPS) {
    const sym = cubeOfMotion(map);
    const back = cubeOfMotion(invertFaceMap(map));
    for (const move of g1) {
      multiplyFull(back, cubeFromAlg(move), scratch);
      multiplyFull(scratch, sym, out);
      assert.ok(isInG1(out), `${move} left G1 under ${FACES.map((f) => map[f]).join("")}`);
    }
  }
});

test("on ordinary states, the mirror-aware product is the ordinary one", () => {
  const plain = solvedCube();
  const full = solvedCube();
  for (const a of ALGS) {
    for (const b of ALGS) {
      multiply(cubeFromAlg(a), cubeFromAlg(b), plain);
      multiplyFull(cubeFromAlg(a), cubeFromAlg(b), full);
      assert.ok(same(plain, full), `${a} then ${b}`);
    }
  }
});

test("conjugating by a symmetry and back returns the state unchanged", () => {
  const scratch = solvedCube();
  const there = solvedCube();
  const back = solvedCube();
  const home = solvedCube();

  for (const alg of ALGS) {
    const cube = cubeFromAlg(alg);
    for (const map of UD_SYMMETRY_MAPS) {
      const sym = cubeOfMotion(map);
      const inverse = cubeOfMotion(invertFaceMap(map));

      multiplyFull(inverse, cube, scratch);
      multiplyFull(scratch, sym, there);
      // A conjugate of a real state is a real state: no mirrored orientation
      // survives, because the two reflections cancel.
      assert.ok([...there.co].every((o) => o < 3), `${alg} stayed mirrored`);

      multiplyFull(sym, there, scratch);
      multiplyFull(scratch, inverse, back);
      assert.ok(same(back, cube), `${alg} did not come home`);
    }
  }
  assert.ok(same(home, solvedCube()));
});
