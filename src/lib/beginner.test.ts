import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIRST_LAYER_CORNERS,
  FIRST_LAYER_EDGES,
  LAST_LAYER_CORNERS,
  LAST_LAYER_EDGES,
  MIDDLE_EDGES,
  SOLVE_STEPS,
  slotsIn,
  stepBySlug,
} from "./beginner";
import { loadKPuzzle, type Pattern } from "./cubeReplay";

/**
 * The promises this guide makes, checked against the puzzle.
 *
 * "This will not wreck your first two layers" is the single most load-bearing
 * sentence in any cube tutorial, and on most of them it is folklore. Here it is
 * derived: apply the algorithm to a solved cube, compare orbit by orbit, and the
 * slots that changed are exactly the slots it disturbs. A promise on the page
 * that the algorithm beside it does not keep fails the build.
 */

let kpuzzle: Awaited<ReturnType<typeof loadKPuzzle>>;

test("the puzzle engine loads", async () => {
  kpuzzle = await loadKPuzzle();
});

/** Which slots an algorithm changes, by piece or by orientation. */
function disturbs(alg: string): { corners: number[]; edges: number[] } {
  const solved = kpuzzle.defaultPattern();
  const after = solved.applyAlg(alg) as Pattern;
  const out = { corners: [] as number[], edges: [] as number[] };

  for (const [orbit, key] of [
    ["CORNERS", "corners"],
    ["EDGES", "edges"],
  ] as const) {
    const a = solved.patternData[orbit];
    const b = after.patternData[orbit];
    for (let i = 0; i < a.pieces.length; i++) {
      if (a.pieces[i] !== b.pieces[i] || a.orientation[i] !== b.orientation[i]) {
        out[key].push(i);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The slot numbering is derived, not assumed
// ---------------------------------------------------------------------------

test("the last layer is exactly what a U turn moves", () => {
  // Everything else in this file is expressed in these indices, so if this is
  // wrong then every promise below is checked against the wrong pieces.
  const moved = disturbs("U");
  assert.deepEqual(moved.corners, LAST_LAYER_CORNERS);
  assert.deepEqual(moved.edges, LAST_LAYER_EDGES);
});

test("the first layer and the middle layer are the rest", () => {
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual([...LAST_LAYER_CORNERS, ...FIRST_LAYER_CORNERS].sort((a, b) => a - b), all);

  const everyEdge = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(
    [...LAST_LAYER_EDGES, ...FIRST_LAYER_EDGES, ...MIDDLE_EDGES].sort((a, b) => a - b),
    everyEdge,
  );
});

test("a D turn moves the first layer and nothing else", () => {
  const moved = disturbs("D");
  assert.deepEqual(moved.corners, FIRST_LAYER_CORNERS);
  assert.deepEqual(moved.edges, FIRST_LAYER_EDGES);
});

// ---------------------------------------------------------------------------
// The guide is complete and coherent
// ---------------------------------------------------------------------------

test("the steps are numbered 1 to 7 in order", () => {
  assert.deepEqual(
    SOLVE_STEPS.map((s) => s.number),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

test("every step is addressable and unique", () => {
  assert.equal(new Set(SOLVE_STEPS.map((s) => s.slug)).size, SOLVE_STEPS.length);
  assert.equal(stepBySlug("yellow-cross")?.number, 4);
  assert.equal(stepBySlug("nope"), undefined);
});

test("every step explains itself before giving an algorithm", () => {
  // Structure, not length. The first version of this demanded twenty
  // characters, which failed the last step — whose goal is "A solved cube." and
  // could not be improved by making it longer.
  for (const step of SOLVE_STEPS) {
    assert.ok(step.goal.trim().endsWith("."), `${step.slug}: the goal is not a sentence`);
    assert.ok(step.idea.length >= 2, `${step.slug} is not explained`);
    for (const line of step.idea) {
      assert.ok(line.trim().endsWith("."), `${step.slug}: "${line.slice(0, 30)}…" is not a sentence`);
    }
  }
});

test("the last step ends with a solved cube", () => {
  assert.match(SOLVE_STEPS.at(-1)!.goal, /solved cube/i);
});

// ---------------------------------------------------------------------------
// Every algorithm is a real algorithm
// ---------------------------------------------------------------------------

test("every algorithm actually changes the cube", () => {
  for (const step of SOLVE_STEPS) {
    for (const a of step.algorithms) {
      const moved = disturbs(a.alg);
      assert.ok(
        moved.corners.length + moved.edges.length > 0,
        `${step.slug}: "${a.name}" does nothing at all`,
      );
    }
  }
});

test("no algorithm is long enough to be a mistake", () => {
  for (const step of SOLVE_STEPS) {
    for (const a of step.algorithms) {
      const moves = a.alg.split(/\s+/).filter(Boolean).length;
      assert.ok(moves >= 4 && moves <= 14, `${step.slug}: "${a.name}" is ${moves} moves`);
    }
  }
});

// ---------------------------------------------------------------------------
// The promises
// ---------------------------------------------------------------------------

test("every step that promises to preserve a region actually preserves it", () => {
  const broken: string[] = [];

  for (const step of SOLVE_STEPS) {
    if (!step.preserves) continue;
    const safe = slotsIn(step.preserves);

    for (const a of step.algorithms) {
      const moved = disturbs(a.alg);
      const hitCorners = moved.corners.filter((i) => safe.corners.includes(i));
      const hitEdges = moved.edges.filter((i) => safe.edges.includes(i));
      if (hitCorners.length || hitEdges.length) {
        broken.push(
          `${step.slug} "${a.name}" promises ${step.preserves} but moves corners [${hitCorners}] edges [${hitEdges}]`,
        );
      }
    }
  }

  assert.deepEqual(broken, [], broken.join("; "));
});

test("a step with no algorithms promises nothing", () => {
  // Otherwise the page would guarantee something about moves nobody specified.
  for (const step of SOLVE_STEPS) {
    if (step.algorithms.length === 0) {
      assert.equal(step.preserves, null, `${step.slug} guarantees something with no algorithm`);
    }
  }
});

test("the corner step really does move no edges", () => {
  // The page tells you your yellow cross is safe here. That is only true if the
  // algorithm touches no edge anywhere on the cube.
  const step = stepBySlug("last-corners")!;
  const moved = disturbs(step.algorithms[0].alg);
  assert.deepEqual(moved.edges, [], "it moves edges, so the cross is not safe");
  assert.ok(moved.corners.length > 0);
});

test("the edge step really does move no corners", () => {
  const step = stepBySlug("last-edges")!;
  const moved = disturbs(step.algorithms[0].alg);
  assert.deepEqual(moved.corners, [], "it moves corners, so the ones just placed are not safe");
  assert.ok(moved.edges.length > 0);
});

test("the two last-layer orientation steps touch only the last layer", () => {
  for (const slug of ["yellow-cross", "yellow-face"]) {
    const step = stepBySlug(slug)!;
    for (const a of step.algorithms) {
      const moved = disturbs(a.alg);
      assert.ok(
        moved.corners.every((i) => LAST_LAYER_CORNERS.includes(i)),
        `${slug} moves a corner below the last layer`,
      );
      assert.ok(
        moved.edges.every((i) => LAST_LAYER_EDGES.includes(i)),
        `${slug} moves an edge below the last layer`,
      );
    }
  }
});

test("the middle-layer algorithms leave the first layer alone but do reach the middle", () => {
  // Both halves matter. Preserving the first layer is the promise; reaching a
  // middle slot is the entire job, and an algorithm that did neither would pass
  // a preservation check while being useless.
  const step = stepBySlug("middle-layer")!;
  for (const a of step.algorithms) {
    const moved = disturbs(a.alg);
    assert.ok(
      !moved.corners.some((i) => FIRST_LAYER_CORNERS.includes(i)),
      `"${a.name}" disturbs a first-layer corner`,
    );
    assert.ok(
      !moved.edges.some((i) => FIRST_LAYER_EDGES.includes(i)),
      `"${a.name}" disturbs a first-layer edge`,
    );
    assert.ok(
      moved.edges.some((i) => MIDDLE_EDGES.includes(i)),
      `"${a.name}" never reaches the middle layer, so it cannot insert anything`,
    );
  }
});

test("the bottom-layer trigger never disturbs the cross", () => {
  // Step 2 makes no promise about bottom corners — taking one out is how the
  // next one gets in. It does promise the cross, which is the thing built first
  // and the thing whose loss sends people back to the start.
  const step = stepBySlug("first-layer")!;
  const moved = disturbs(step.algorithms[0].alg);
  assert.ok(
    !moved.edges.some((i) => FIRST_LAYER_EDGES.includes(i)),
    "the trigger breaks the white cross",
  );
});
