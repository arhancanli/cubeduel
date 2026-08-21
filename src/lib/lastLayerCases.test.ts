import assert from "node:assert/strict";
import { test } from "node:test";

import { isSolvedInPlace, loadKPuzzle, type Pattern } from "./cubeReplay";
import { LL_SLOTS, OLL_SKIP, ollCaseId, pllCaseId } from "./lastLayer";
import {
  OLL_CASES,
  OLL_CROSS_CASES,
  OLL_DOT_CASES,
  PLL_CASES,
  PLL_CORNERS_ONLY,
  PLL_EDGES_ONLY,
} from "./lastLayerCases";

/**
 * Every algorithm proves itself.
 *
 * An algorithm in a cubing app is a claim, and a wrong one costs somebody weeks:
 * they drill it, it half-works, and they cannot tell whether the algorithm or
 * their own hands are at fault. So none of these are believed on sight.
 *
 * The obvious check is a trap, and this file shipped it for one commit. Applying
 * the inverse of an algorithm to a solved cube produces a state, and applying the
 * algorithm to that state returns to solved — *always*, for any sequence of moves
 * whatsoever. It reads like verification and is arithmetic: inverse(A) then A is
 * the identity. Mutating a move inside Sune left it passing. A check that cannot
 * fail is worse than no check, because it also stops anybody looking.
 *
 * What breaks the circle is a ground truth these algorithms had no hand in.
 * `lastLayer.test.ts` enumerates every reachable last-layer state from first
 * principles — corner twists summing to zero mod 3, edge flips summing to zero
 * mod 2 — and finds exactly 58 orientation classes and 22 permutation classes.
 * Those numbers come from the arithmetic of the puzzle, not from anybody's
 * algorithm sheet.
 *
 * So the real check is coverage. The 57 OLL algorithms must produce exactly the
 * 57 non-skip orientation classes: every class hit, none twice, none left over. A
 * wrong algorithm produces the wrong class, which shows up as a class nobody
 * covers. Add to that the property every last-layer algorithm has by definition —
 * it leaves the two layers below it untouched — and a mistyped move has nowhere
 * left to hide.
 */

let kpuzzle: Awaited<ReturnType<typeof loadKPuzzle>>;

test("the puzzle engine loads", async () => {
  kpuzzle = await loadKPuzzle();
});

function invert(alg: string): string {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((move) => {
      if (move.endsWith("2")) return move;
      return move.endsWith("'") ? move.slice(0, -1) : `${move}'`;
    })
    .join(" ");
}

/** The state a cuber faces when this case comes up. */
function setUp(alg: string): Pattern {
  return kpuzzle.defaultPattern().applyAlg(invert(alg)) as Pattern;
}

/**
 * Whether everything below the last layer is untouched.
 *
 * This is what makes an algorithm a *last-layer* algorithm rather than merely a
 * sequence of moves. The last layer occupies slots 0-3 in both orbits; every
 * other piece must be home and oriented.
 */
function belowIsIntact(pattern: Pattern): boolean {
  const orbits = pattern.patternData;
  for (const orbit of ["CORNERS", "EDGES"] as const) {
    const { pieces, orientation } = orbits[orbit];
    for (let i = 0; i < pieces.length; i++) {
      if (LL_SLOTS.includes(i as (typeof LL_SLOTS)[number])) continue;
      if (pieces[i] !== i || orientation[i] !== 0) return false;
    }
  }
  return true;
}

/** All 58 orientation classes, derived from the puzzle's arithmetic alone. */
function everyOllClass(): Set<string> {
  const classes = new Set<string>();
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++)
        for (let d = 0; d < 3; d++) {
          if ((a + b + c + d) % 3 !== 0) continue;
          for (let e = 0; e < 2; e++)
            for (let f = 0; f < 2; f++)
              for (let g = 0; g < 2; g++)
                for (let h = 0; h < 2; h++) {
                  if ((e + f + g + h) % 2 !== 0) continue;
                  classes.add(
                    ollCaseId({
                      patternData: {
                        CORNERS: { pieces: [0, 1, 2, 3], orientation: [a, b, c, d] },
                        EDGES: { pieces: [0, 1, 2, 3], orientation: [e, f, g, h] },
                      },
                    }),
                  );
                }
        }
  return classes;
}

/** How many last-layer edges arrive already oriented. */
function orientedEdges(pattern: Pattern): number {
  return LL_SLOTS.filter((i) => pattern.patternData.EDGES.orientation[i] === 0).length;
}

// ---------------------------------------------------------------------------
// The library is complete
// ---------------------------------------------------------------------------

test("there are exactly 57 OLL cases", () => {
  assert.equal(OLL_CASES.length, 57);
});

test("they are numbered 1 to 57, once each", () => {
  const numbers = OLL_CASES.map((c) => c.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 57 }, (_, i) => i + 1));
});

test("there are exactly 21 PLL cases", () => {
  assert.equal(PLL_CASES.length, 21);
});

test("every PLL letter appears once", () => {
  assert.equal(new Set(PLL_CASES.map((c) => c.name)).size, 21);
});

// ---------------------------------------------------------------------------
// Every algorithm solves its own case
// ---------------------------------------------------------------------------

test("every OLL algorithm leaves the first two layers alone", () => {
  const broken = OLL_CASES.filter((c) => !belowIsIntact(setUp(c.alg))).map(
    (c) => `OLL ${c.number} (${c.name ?? "unnamed"})`,
  );
  assert.deepEqual(broken, [], `these disturb F2L: ${broken.join(", ")}`);
});

test("every PLL algorithm leaves the first two layers alone", () => {
  const broken = PLL_CASES.filter((c) => !belowIsIntact(setUp(c.alg))).map((c) => c.name);
  assert.deepEqual(broken, [], `these disturb F2L: ${broken.join(", ")}`);
});

test("the 57 OLL algorithms cover every case there is", () => {
  // The ground truth this cannot fake: 58 classes exist because of how the cube
  // is built. Take away the skip and 57 remain, and these are supposed to be
  // them. A mistyped move lands on the wrong class and leaves a real one
  // uncovered.
  const all = everyOllClass();
  assert.equal(all.size, 58, "the enumeration itself is wrong");

  const covered = new Set(OLL_CASES.map((c) => ollCaseId(setUp(c.alg))));
  const missing = [...all].filter((id) => id !== OLL_SKIP && !covered.has(id));

  assert.equal(covered.has(OLL_SKIP), false, "a case is filed as the solved cube");
  assert.deepEqual(missing, [], `${missing.length} real OLL cases have no algorithm`);
  assert.equal(covered.size, 57);
});

test("every PLL algorithm really is a permutation", () => {
  // A PLL case arrives with the last layer already oriented — that is what makes
  // it a permutation case. Anything else filed here is not a PLL algorithm.
  const broken = PLL_CASES.filter((c) => ollCaseId(setUp(c.alg)) !== OLL_SKIP).map(
    (c) => c.name,
  );
  assert.deepEqual(broken, [], `these leave pieces misoriented: ${broken.join(", ")}`);
});

// ---------------------------------------------------------------------------
// No two cases are the same case
// ---------------------------------------------------------------------------

test("the 57 OLL cases are 57 distinct cases", () => {
  const ids = new Map<string, number[]>();
  for (const c of OLL_CASES) {
    const id = ollCaseId(setUp(c.alg));
    ids.set(id, [...(ids.get(id) ?? []), c.number]);
  }
  const collisions = [...ids.values()].filter((numbers) => numbers.length > 1);
  assert.deepEqual(collisions, [], `these are the same case: ${JSON.stringify(collisions)}`);
  assert.equal(ids.size, 57);
});

test("the 21 PLL cases are 21 distinct cases", () => {
  const ids = new Map<string, string[]>();
  for (const c of PLL_CASES) {
    const id = pllCaseId(setUp(c.alg));
    ids.set(id, [...(ids.get(id) ?? []), c.name]);
  }
  const collisions = [...ids.values()].filter((names) => names.length > 1);
  assert.deepEqual(collisions, [], `these are the same case: ${JSON.stringify(collisions)}`);
  assert.equal(ids.size, 21);
});

test("no OLL case is the solved cube", () => {
  for (const c of OLL_CASES) {
    assert.ok(!isSolvedInPlace(setUp(c.alg)), `OLL ${c.number} sets up a solved cube`);
  }
});

// ---------------------------------------------------------------------------
// The numbering is pinned to the case, not to the label
// ---------------------------------------------------------------------------
//
// A working algorithm filed under the wrong number is the one error the solve
// check above cannot catch. Edge orientation is a property of the case itself, so
// deriving it from the algorithm and checking it against the standard grouping
// catches a case shelved under its neighbour's number.

test("the dot cases are exactly 1-4 and 17-20", () => {
  const dots = OLL_CASES.filter((c) => orientedEdges(setUp(c.alg)) === 0)
    .map((c) => c.number)
    .sort((a, b) => a - b);
  assert.deepEqual(dots, [...OLL_DOT_CASES]);
});

test("the cases that arrive with the cross made are exactly 21-27", () => {
  const cross = OLL_CASES.filter((c) => orientedEdges(setUp(c.alg)) === 4)
    .map((c) => c.number)
    .sort((a, b) => a - b);
  assert.deepEqual(cross, [...OLL_CROSS_CASES]);
});

test("every other OLL case has exactly two edges oriented", () => {
  const wrong = OLL_CASES.filter((c) => {
    const n = orientedEdges(setUp(c.alg));
    return n !== 0 && n !== 4 && n !== 2;
  }).map((c) => c.number);
  assert.deepEqual(wrong, []);
});

test("the corner-only PLLs leave every edge home", () => {
  for (const name of PLL_CORNERS_ONLY) {
    const c = PLL_CASES.find((x) => x.name === name)!;
    const p = setUp(c.alg);
    const edgesHome = LL_SLOTS.every((i) => p.patternData.EDGES.pieces[i] % 4 === i);
    assert.ok(edgesHome, `${name} moves edges, so it is not a corner permutation`);
  }
});

test("the edge-only PLLs leave every corner home", () => {
  for (const name of PLL_EDGES_ONLY) {
    const c = PLL_CASES.find((x) => x.name === name)!;
    const p = setUp(c.alg);
    const cornersHome = LL_SLOTS.every((i) => p.patternData.CORNERS.pieces[i] % 4 === i);
    assert.ok(cornersHome, `${name} moves corners, so it is not an edge permutation`);
  }
});

test("every other PLL moves both corners and edges", () => {
  const single = new Set<string>([...PLL_CORNERS_ONLY, ...PLL_EDGES_ONLY]);
  for (const c of PLL_CASES) {
    if (single.has(c.name)) continue;
    const p = setUp(c.alg);
    const edgesHome = LL_SLOTS.every((i) => p.patternData.EDGES.pieces[i] % 4 === i);
    const cornersHome = LL_SLOTS.every((i) => p.patternData.CORNERS.pieces[i] % 4 === i);
    assert.ok(!edgesHome && !cornersHome, `${c.name} only moves one orbit`);
  }
});
