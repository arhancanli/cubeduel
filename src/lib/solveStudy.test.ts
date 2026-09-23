import assert from "node:assert/strict";
import { test } from "node:test";

import { countMoves } from "./moveStream";
import { studySolve } from "./solveStudy";

/**
 * A real CFOP solve: each step completes exactly one milestone. The scramble is
 * the whole solution inverted, so the solve is known to finish.
 */
const STEPS = [
  "D2 R' D'",
  "U R U' R'",
  "U' L' U L",
  "U' R' U R",
  "U L U' L'",
  "R U R' U R U2 R'",
  "R U R' U' R' F R2 U' R' U' R U R' F'",
];

function invert(alg: string): string {
  return alg
    .split(" ")
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
    .join(" ");
}

const SCRAMBLE = invert(STEPS.join(" "));

test("a real solve is read into phases, and the review prices it", async () => {
  const moves = STEPS.join(" ")
    .split(" ")
    .map((move, i) => ({ move, atMs: i * 180 }));
  const study = await studySolve(SCRAMBLE, moves, moves[moves.length - 1].atMs);

  assert.deepEqual(
    study.analysis.splits.map((s) => s.phase),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
  );
  assert.ok(study.cross, "the shortest cross is found");
  assert.equal(study.cross.face, study.analysis.crossFace);
  // The solve's own cross is three turns; nothing shorter than optimal exists.
  assert.ok(study.cross.moves <= 3);
  // Counted by the same rule the rest of the site uses, not typed in.
  assert.equal(study.review.turns, countMoves(moves.map((m) => m.move)));
});

test("the last-layer cases are matched to the library", async () => {
  // Pad the OLL with a detour before the algorithm, so the two-look check has
  // something to find. It must come BEFORE: once the algorithm lands the last
  // layer is oriented, and anything after it is PLL's.
  const detour = "F R U R' U' F' F R U R' U' F'";
  const withDetour = [...STEPS.slice(0, 5), `${detour} ${invert(detour)} ${STEPS[5]}`, STEPS[6]];
  const moves = withDetour
    .join(" ")
    .split(" ")
    .map((move, i) => ({ move, atMs: i * 180 }));
  const study = await studySolve(SCRAMBLE, moves, moves[moves.length - 1].atMs);
  const twoLook = study.review.moments.find((m) => m.kind === "two-look" && m.phase === "OLL");
  assert.ok(twoLook, "the long OLL is reported against the case's own algorithm");
  assert.match(twoLook.href ?? "", /^\/learn\/oll-/);
});
