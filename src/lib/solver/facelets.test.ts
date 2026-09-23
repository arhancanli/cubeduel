import assert from "node:assert/strict";
import { test } from "node:test";

import { cubeFromAlg, solvedCube, validate } from "./cube";
import { SOLVED_FACELETS, faceletsToCube, cubeToFacelets } from "./facelets";

const FACE_ORDER = "URFDLB";
/** The nine stickers of one face, 1-indexed as a cuber reads them. */
const face = (s: string, f: string) => s.slice(FACE_ORDER.indexOf(f) * 9, FACE_ORDER.indexOf(f) * 9 + 9);

test("solved is nine of each, in face order", () => {
  assert.equal(SOLVED_FACELETS, "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");
  assert.equal(cubeToFacelets(solvedCube()), SOLVED_FACELETS);
});

// Known sticker positions after single turns, written out by hand from a real
// cube — an oracle independent of the tables being tested.
test("after R, the right column of U shows the front colour", () => {
  const s = cubeToFacelets(cubeFromAlg("R"));
  assert.equal(face(s, "U"), "UUFUUFUUF");
  assert.equal(face(s, "F"), "FFDFFDFFD");
  assert.equal(face(s, "R"), "RRRRRRRRR");
  assert.equal(face(s, "B"), "UBBUBBUBB");
});

test("after U, the top row of F shows the right colour", () => {
  const s = cubeToFacelets(cubeFromAlg("U"));
  assert.equal(face(s, "F"), "RRRFFFFFF");
  assert.equal(face(s, "L"), "FFFLLLLLL");
  assert.equal(face(s, "U"), "UUUUUUUUU");
});

test("after F, the bottom row of U shows the left colour", () => {
  const s = cubeToFacelets(cubeFromAlg("F"));
  assert.equal(face(s, "U"), "UUUUUULLL");
  assert.equal(face(s, "R"), "URRURRURR");
});

test("stickers to pieces and back is exact for real scrambles", () => {
  for (const alg of [
    "R U R' U'",
    "F2 D' B R2 L' U2 F' D B2 L R' U F2 D2 B' L2",
    "R2 D' B' L2 F2 U' B2 U R2 U2 F2 L' B' D2 F' U' R' B",
  ]) {
    const cube = cubeFromAlg(alg);
    const back = faceletsToCube(cubeToFacelets(cube));
    assert.ok(back.ok, alg);
    if (!back.ok) continue;
    assert.deepEqual([...back.cube.cp], [...cube.cp], `${alg} corners`);
    assert.deepEqual([...back.cube.co], [...cube.co], `${alg} twist`);
    assert.deepEqual([...back.cube.ep], [...cube.ep], `${alg} edges`);
    assert.deepEqual([...back.cube.eo], [...cube.eo], `${alg} flip`);
    assert.equal(validate(back.cube), null);
  }
});

test("the wrong number of one colour is refused, saying which", () => {
  const s = "R" + SOLVED_FACELETS.slice(1);
  const result = faceletsToCube(s);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /10 red|8 white/i);
});

test("a corner with two of its stickers swapped is refused", () => {
  // Swap the U and R stickers of the URF corner. Every colour still appears
  // nine times, so only reading the corners can catch it: that piece is the
  // mirror image of any real corner.
  const arr = SOLVED_FACELETS.split("");
  [arr[8], arr[9]] = [arr[9], arr[8]];
  const result = faceletsToCube(arr.join(""));
  assert.equal(result.ok, false);
});

test("a single twisted corner is refused as a real-cube impossibility", () => {
  // Rotate the URF corner's three stickers in place.
  const arr = SOLVED_FACELETS.split("");
  const [a, b, c] = [8, 9, 20];
  [arr[a], arr[b], arr[c]] = [arr[c], arr[a], arr[b]];
  const result = faceletsToCube(arr.join(""));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /twist|rotated/i);
});

test("a single flipped edge is refused", () => {
  const arr = SOLVED_FACELETS.split("");
  [arr[5], arr[10]] = [arr[10], arr[5]]; // UR edge flipped
  const result = faceletsToCube(arr.join(""));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /flip/i);
});

test("two swapped edges alone are refused", () => {
  // Swap the UR and UF edges' stickers: a lone swap, parity broken.
  const arr = SOLVED_FACELETS.split("");
  [arr[5], arr[7]] = [arr[7], arr[5]];
  [arr[10], arr[19]] = [arr[19], arr[10]];
  const result = faceletsToCube(arr.join(""));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /swapped|parity/i);
});

test("the centres decide the colour scheme, so any scheme works", () => {
  // Rename every colour; the cube is still the R U scramble.
  const map: Record<string, string> = { U: "Y", R: "O", F: "B", D: "W", L: "R", B: "G" };
  const renamed = cubeToFacelets(cubeFromAlg("R U")).split("").map((c) => map[c]).join("");
  const result = faceletsToCube(renamed);
  assert.ok(result.ok);
});

test("a cube typed in as stickers is solved by the engine", async () => {
  const { solve } = await import("./search");
  const { buildTables } = await import("./tables");
  const { compose, isSolved } = await import("./cube");
  buildTables();
  const scramble = "F2 D' B R2 L' U2 F' D B2 L R' U F2 D2 B' L2";
  const read = faceletsToCube(cubeToFacelets(cubeFromAlg(scramble)));
  assert.ok(read.ok);
  if (!read.ok) return;
  const result = solve(read.cube, { targetLength: 21, timeBudgetMs: 2000 });
  assert.ok(result, "a solution is found");
  // Applying the answer to the typed-in cube must leave it solved.
  const after = compose(read.cube, cubeFromAlg(result!.moves.join(" ")));
  assert.ok(isSolved(after), result!.moves.join(" "));
  assert.ok(result!.length <= 21);
});
