import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compose,
  cubeFromAlg,
  isSolved,
  solvedCube,
  validate,
  type CubieCube,
} from "./cube";
import { MOVE_CUBES, MOVES, buildTables } from "./tables";
import { solve, solveScramble } from "./search";

/**
 * Deliberately no `cubing/scramble` import here.
 *
 * That module runs its search in a worker which keeps the Node process alive
 * after the work is done, so a suite importing it never exits — it hangs until
 * something kills it, which looks exactly like an infinitely slow solver. It cost
 * three ten-minute timeouts to notice. Random states are generated directly
 * instead, which is also stricter: a uniformly random state is on average harder
 * than one reached by a scramble sequence.
 */

/** Deterministic RNG, so any failure is reproducible from the seed alone. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
}

/**
 * A uniformly random *legal* cube state.
 *
 * Legality is not automatic: a random permutation and random orientations
 * describe a cube that has been taken apart and reassembled wrong four times out
 * of twelve. The three constraints — corner twist summing to zero mod 3, edge
 * flip to zero mod 2, and matching permutation parity — are repaired explicitly.
 */
function randomState(seed: number): CubieCube {
  const next = rng(seed);
  const cube = solvedCube();

  const shuffle = (array: Uint8Array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
  };
  shuffle(cube.cp);
  shuffle(cube.ep);

  // Matching parity. A single transposition on the edges flips their parity
  // without touching the corners.
  const parity = (perm: Uint8Array) => {
    let swaps = 0;
    const work = perm.slice();
    for (let i = 0; i < work.length; i++) {
      while (work[i] !== i) {
        const j = work[i];
        work[i] = work[j];
        work[j] = j;
        swaps++;
      }
    }
    return swaps % 2;
  };
  if (parity(cube.cp) !== parity(cube.ep)) {
    [cube.ep[0], cube.ep[1]] = [cube.ep[1], cube.ep[0]];
  }

  let twist = 0;
  for (let i = 0; i < 7; i++) {
    cube.co[i] = next() % 3;
    twist += cube.co[i];
  }
  cube.co[7] = (3 - (twist % 3)) % 3;

  let flip = 0;
  for (let i = 0; i < 11; i++) {
    cube.eo[i] = next() % 2;
    flip += cube.eo[i];
  }
  cube.eo[11] = flip % 2;

  return cube;
}

/** Applies a solution and reports whether it actually solved the cube. */
function applies(cube: CubieCube, moves: string[]): boolean {
  const byName = new Map(MOVES.map((m, i) => [m.name, MOVE_CUBES[i]]));
  let state = cube;
  for (const name of moves) {
    const move = byName.get(name);
    assert.ok(move, `solver produced an unknown move: ${name}`);
    state = compose(state, move);
  }
  return isSolved(state);
}

test("the tables build and reach every state", () => {
  const t = buildTables();
  // An unreachable entry means the move tables are wrong: breadth-first search
  // from the goal must touch every coordinate pair that exists.
  for (const [name, table] of [
    ["twist×slice", t.twistSlicePrune],
    ["flip×slice", t.flipSlicePrune],
    ["twist×flip", t.twistFlipPrune],
    ["corner×slicePerm", t.cornerSlicePrune],
    ["edge8×slicePerm", t.edgeSlicePrune],
  ] as const) {
    const unreachable = table.reduce((n, d) => n + (d === 0xff ? 1 : 0), 0);
    assert.equal(unreachable, 0, `${name} left ${unreachable} states unreachable`);
  }
});

test("an already-solved cube needs no moves", () => {
  const result = solve(solvedCube());
  assert.ok(result);
  assert.equal(result.length, 0);
  assert.deepEqual(result.moves, []);
});

test("a one-move scramble is solved in one move", () => {
  for (const scramble of ["R", "U'", "F2", "D", "L'", "B2"]) {
    const result = solveScramble(scramble);
    assert.ok(result, scramble);
    assert.equal(result.length, 1, `${scramble} -> ${result.moves.join(" ")}`);
    assert.ok(applies(cubeFromAlg(scramble), result.moves));
  }
});

test("every solution actually solves the cube it was given", () => {
  // The only claim that matters. A solver that returns plausible-looking moves
  // which do not solve is worse than one that returns nothing.
  for (let seed = 1; seed <= 30; seed++) {
    const cube = randomState(seed * 7919);
    assert.equal(validate(cube), null, `seed ${seed} generated an illegal state`);

    const result = solve(cube);
    assert.ok(result, `no solution for seed ${seed}`);
    assert.ok(
      applies(cube, result.moves),
      `seed ${seed}: ${result.moves.join(" ")} did not solve the cube`,
    );
  }
});

test("solutions stay within God's number plus a little", () => {
  // 20 is the proven maximum in the half-turn metric. Two-phase does not
  // guarantee optimal, so a small margin is expected — but a solution far past
  // it means the search is settling for the first thing it finds.
  const lengths: number[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const result = solve(randomState(seed * 104729));
    assert.ok(result);
    lengths.push(result.length);
    assert.ok(result.length <= 26, `seed ${seed} produced ${result.length} moves`);
  }
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  assert.ok(mean < 22.5, `mean solution length was ${mean.toFixed(2)}`);
});

test("the reported split adds up", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const result = solve(randomState(seed * 31337));
    assert.ok(result);
    assert.equal(
      result.phase1Length + result.phase2Length,
      result.length,
      "phase lengths must account for the whole solution",
    );
  }
});

test("a tighter target never produces a longer solution", () => {
  // Monotonicity. If asking for better gave worse, the improvement loop would be
  // actively harmful.
  for (let seed = 1; seed <= 8; seed++) {
    const cube = randomState(seed * 15485863);
    const relaxed = solve(cube, { targetLength: 24, timeBudgetMs: 1000 });
    const strict = solve(cube, { targetLength: 20, timeBudgetMs: 1000 });
    assert.ok(relaxed && strict);
    assert.ok(
      strict.length <= relaxed.length,
      `seed ${seed}: strict ${strict.length} vs relaxed ${relaxed.length}`,
    );
  }
});

test("a solution is always returned, however small the budget", () => {
  // The budget governs how hard the solver tries to IMPROVE. Returning nothing
  // is useless to a caller, and at tight budgets that is what used to happen for
  // roughly one state in eight.
  for (let seed = 1; seed <= 10; seed++) {
    const result = solve(randomState(seed * 2654435761), { timeBudgetMs: 1 });
    assert.ok(result, `seed ${seed} returned nothing at a 1ms budget`);
    assert.ok(applies(randomState(seed * 2654435761), result.moves));
  }
});

test("the same cube always gets the same solution", () => {
  // Determinism matters for anything that stores or compares a solution: an
  // analysis that changed its mind between runs would be untrustworthy.
  const cube = randomState(424242);
  const first = solve(cube, { timeBudgetMs: 500 });
  const second = solve(cube, { timeBudgetMs: 500 });
  assert.ok(first && second);
  assert.deepEqual(first.moves, second.moves);
});

test("an impossible cube is refused, not searched forever", () => {
  // A single twisted corner has no solution. Without the check the search would
  // run to its ceiling and report failure with no explanation.
  const twisted = solvedCube();
  twisted.co[0] = 1;
  assert.throws(() => solve(twisted), /impossible|twist/i);

  const swapped = solvedCube();
  [swapped.cp[0], swapped.cp[1]] = [swapped.cp[1], swapped.cp[0]];
  assert.throws(() => solve(swapped), /impossible|parity/i);
});

test("solving is fast enough to sit in a request", () => {
  // Generous against a slow CI machine; the measured figures on a laptop are a
  // median of 86ms and a maximum under a second across 100 random states.
  const times: number[] = [];
  for (let seed = 1; seed <= 15; seed++) {
    const result = solve(randomState(seed * 9973));
    assert.ok(result);
    times.push(result.elapsedMs);
  }
  const worst = Math.max(...times);
  assert.ok(worst < 5000, `worst solve took ${worst}ms`);
});
