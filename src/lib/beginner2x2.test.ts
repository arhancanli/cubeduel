import assert from "node:assert/strict";
import { test } from "node:test";

import { SOLVE_2X2_STEPS } from "./beginner2x2";
import { compose, cubeFromAlg, solvedCube, type CubieCube } from "./solver/cube";
import { cubeToFacelets } from "./solver/facelets";

/**
 * The 2×2 guide's instructions, followed to the letter.
 *
 * A 2×2 is a 3×3's corners, so it is modelled here by the site's own cube,
 * with edges ignored. The top face is U and the bottom D, as the guide is held.
 * Every top layer a real solve can reach — generated from the moves the guide
 * uses, not listed by hand — is put through the rules exactly as a beginner
 * would read them, and must end solved within the number of algorithms the
 * guide promises.
 */

const alg = (name: string) => {
  for (const step of SOLVE_2X2_STEPS) for (const a of step.algorithms) if (a.name === name) return a.alg;
  throw new Error(name);
};
const SUNE = alg("Sune");
const TPERM = alg("T-perm");
const YPERM = alg("Y-perm");
const U = ["", "U", "U2", "U'"].map((a) => (a ? cubeFromAlg(a) : solvedCube()));

const apply = (cube: CubieCube, a: string) => compose(cube, cubeFromAlg(a));
const bottomIntact = (c: CubieCube) => [4, 5, 6, 7].every((i) => c.cp[i] === i && c.co[i] === 0);
const topOriented = (c: CubieCube) => [0, 1, 2, 3].every((i) => c.co[i] === 0);
const solvedUpToTop = (c: CubieCube) =>
  U.some((u) => {
    const t = compose(c, u);
    return [0, 1, 2, 3, 4, 5, 6, 7].every((i) => t.cp[i] === i && t.co[i] === 0);
  });

const key = (c: CubieCube) => `${[...c.cp.slice(0, 4)]}|${[...c.co.slice(0, 4)]}`;

/** Every corner state with the bottom layer done, reached by the guide's own moves. */
function reachable(): CubieCube[] {
  const seen = new Map<string, CubieCube>();
  let frontier = [solvedCube()];
  seen.set(key(frontier[0]), frontier[0]);
  const moves = ["U", SUNE, TPERM, YPERM];
  while (frontier.length) {
    const next: CubieCube[] = [];
    for (const c of frontier) {
      for (const m of moves) {
        const n = apply(c, m);
        if (!seen.has(key(n))) {
          seen.set(key(n), n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

const STATES = reachable();

test("the reachable top layers are all of them: 4! placements × 27 twists", () => {
  // Corner twists must sum to zero, so 3^4 / 3 = 27 twist patterns, times 24
  // arrangements of the four top corners.
  assert.equal(STATES.length, 24 * 27);
  assert.ok(STATES.every(bottomIntact));
});

test("step 2, as written, turns every top face yellow in at most three Sunes", () => {
  for (const start of STATES) {
    let cube = start;
    let sunes = 0;
    while (!topOriented(cube)) {
      assert.ok(sunes < 3, "more than three Sunes");
      const onTop = [0, 1, 2, 3].filter((i) => cube.co[i] === 0).length;
      // Turn the top as the text says, trying each of the four turns in order.
      const turned = U.map((u) => compose(cube, u)).find((c) => {
        const s = cubeToFacelets(c);
        // One yellow on top: that corner at the front-left (sticker U7).
        if (onTop === 1) return s[6] === "U";
        // None or two: the front-left corner's yellow sticker facing left (L3).
        return s[38] === "U";
      });
      assert.ok(turned, `no turn fits the rule for ${cubeToFacelets(cube)}`);
      cube = apply(turned!, SUNE);
      sunes++;
    }
    assert.ok(bottomIntact(cube));
  }
});

test("step 3, as written, solves every oriented top with one algorithm and a turn of the top", () => {
  const oriented = STATES.filter(topOriented);
  assert.equal(oriented.length, 24);
  for (const start of oriented) {
    let cube = start;
    let used = 0;
    while (!solvedUpToTop(cube)) {
      assert.ok(used < 1, "more than one algorithm");
      // Headlights on the left: the two top stickers of the left face (L1, L3)
      // match. Otherwise no side has them, which turning the top will show.
      const withHeadlightsLeft = U.map((u) => compose(cube, u)).find((c) => {
        const s = cubeToFacelets(c);
        return s[36] === s[38];
      });
      cube = withHeadlightsLeft ? apply(withHeadlightsLeft, TPERM) : apply(cube, YPERM);
      used++;
    }
    assert.ok(bottomIntact(cube));
  }
});

test("the algorithms that promise to leave the bottom layer alone do", () => {
  for (const a of [SUNE, TPERM, YPERM]) {
    assert.ok(bottomIntact(cubeFromAlg(a)), a);
  }
});

test("the steps are numbered in order and addressable", () => {
  assert.deepEqual(SOLVE_2X2_STEPS.map((s) => s.number), [1, 2, 3]);
  assert.equal(new Set(SOLVE_2X2_STEPS.map((s) => s.slug)).size, 3);
});
