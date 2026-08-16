import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KNOWN_OLL,
  KNOWN_PLL,
  OLL_SKIP,
  PLL_SKIP,
  ollCaseId,
  pllCaseId,
  type PatternLike,
} from "./lastLayer";

function orientationPattern(co: number[], eo: number[]): PatternLike {
  return {
    patternData: {
      CORNERS: { pieces: [0, 1, 2, 3], orientation: co },
      EDGES: { pieces: [0, 1, 2, 3], orientation: eo },
    },
  };
}

function permutationPattern(cp: number[], ep: number[]): PatternLike {
  return {
    patternData: {
      CORNERS: { pieces: cp, orientation: [0, 0, 0, 0] },
      EDGES: { pieces: ep, orientation: [0, 0, 0, 0] },
    },
  };
}

function permutationsOf4(): number[][] {
  const out: number[][] = [];
  const walk = (rest: number[], acc: number[]) => {
    if (rest.length === 0) return void out.push(acc);
    rest.forEach((v, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, v]));
  };
  walk([0, 1, 2, 3], []);
  return out;
}

const parity = (p: number[]) => {
  let swaps = 0;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) swaps++;
  }
  return swaps % 2;
};

/**
 * The load-bearing test. Speedcubing has a known answer here: 57 OLL cases plus
 * the skip. If canonicalisation were too loose it would merge distinct cases and
 * come in under 58; too strict and it would split one case into several and come
 * in over. Either way a cuber would be told to drill a case they don't have.
 */
test("every valid OLL orientation collapses to exactly 58 classes", () => {
  const classes = new Set<string>();
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++)
        for (let d = 0; d < 3; d++) {
          if ((a + b + c + d) % 3 !== 0) continue; // corner twist must cancel
          for (let e = 0; e < 2; e++)
            for (let f = 0; f < 2; f++)
              for (let g = 0; g < 2; g++)
                for (let h = 0; h < 2; h++) {
                  if ((e + f + g + h) % 2 !== 0) continue; // edge flip must cancel
                  classes.add(ollCaseId(orientationPattern([a, b, c, d], [e, f, g, h])));
                }
        }
  assert.equal(classes.size, 58, "57 OLL cases plus the skip");
  assert.ok(classes.has(OLL_SKIP));
});

test("every valid PLL permutation collapses to exactly 22 classes", () => {
  const perms = permutationsOf4();
  const classes = new Set<string>();
  for (const cp of perms) {
    for (const ep of perms) {
      if ((parity(cp) + parity(ep)) % 2 !== 0) continue; // unreachable otherwise
      classes.add(pllCaseId(permutationPattern(cp, ep)));
    }
  }
  assert.equal(classes.size, 22, "21 PLL cases plus the skip");
  assert.ok(classes.has(PLL_SKIP));
});

test("a solved last layer is the skip in both stages", () => {
  assert.equal(ollCaseId(orientationPattern([0, 0, 0, 0], [0, 0, 0, 0])), OLL_SKIP);
  assert.equal(pllCaseId(permutationPattern([0, 1, 2, 3], [0, 1, 2, 3])), PLL_SKIP);
});

test("the same OLL case is recognised from any angle", () => {
  // One case, viewed from four cube rotations — all must be the same case.
  const co = [1, 0, 2, 0];
  const eo = [1, 1, 0, 0];
  const ids = [0, 1, 2, 3].map((k) => {
    const rot = <T>(v: T[]) => v.map((_, i) => v[(i + k) % 4]);
    return ollCaseId(orientationPattern(rot(co), rot(eo)));
  });
  assert.equal(new Set(ids).size, 1, `got ${[...new Set(ids)].join(" / ")}`);
});

test("the same PLL case is recognised through any AUF", () => {
  const cp = [1, 0, 3, 2];
  const ep = [0, 1, 2, 3];
  const ids: string[] = [];
  for (let k = 0; k < 4; k++) {
    for (let m = 0; m < 4; m++) {
      const rot = <T>(v: T[]) => v.map((_, i) => v[(i + k) % 4]);
      ids.push(
        pllCaseId(
          permutationPattern(
            rot(cp).map((v) => (v + m) % 4),
            rot(ep).map((v) => (v + m) % 4),
          ),
        ),
      );
    }
  }
  assert.equal(new Set(ids).size, 1, "rotation and AUF must not change the case");
});

test("distinct cases stay distinct", () => {
  // A sune-shaped orientation and an anti-sune-shaped one are different cases.
  const sune = ollCaseId(orientationPattern([1, 0, 1, 1], [0, 0, 0, 0]));
  const anti = ollCaseId(orientationPattern([2, 0, 2, 2], [0, 0, 0, 0]));
  assert.notEqual(sune, anti);
  assert.notEqual(sune, OLL_SKIP);
});

test("every named case is unique and really is its own case", async () => {
  const { puzzles } = await import("cubing/puzzles");
  const kpuzzle = await puzzles["3x3x3"].kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const invert = (alg: string) =>
    alg
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .reverse()
      .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
      .join(" ");

  const ollIds = KNOWN_OLL.map((c) =>
    ollCaseId(c.alg ? solved.applyAlg(invert(c.alg)) : solved),
  );
  assert.equal(new Set(ollIds).size, KNOWN_OLL.length, "named OLL cases must be distinct");

  const pllIds = KNOWN_PLL.map((c) =>
    pllCaseId(c.alg ? solved.applyAlg(invert(c.alg)) : solved),
  );
  assert.equal(new Set(pllIds).size, KNOWN_PLL.length, "named PLL cases must be distinct");

  // Applying the algorithm to its own case must actually solve that stage.
  for (const named of KNOWN_PLL) {
    if (!named.alg) continue;
    const scrambled = solved.applyAlg(invert(named.alg));
    const fixed = scrambled.applyAlg(named.alg);
    assert.equal(pllCaseId(fixed), PLL_SKIP, `${named.name} should solve its own case`);
  }
  for (const named of KNOWN_OLL) {
    if (!named.alg) continue;
    const scrambled = solved.applyAlg(invert(named.alg));
    const fixed = scrambled.applyAlg(named.alg);
    assert.equal(ollCaseId(fixed), OLL_SKIP, `${named.name} should orient its own case`);
  }
});
