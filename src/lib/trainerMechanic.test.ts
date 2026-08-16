import { test } from "node:test";
import assert from "node:assert/strict";

import { KNOWN_OLL, KNOWN_PLL, OLL_SKIP, PLL_SKIP, ollCaseId, pllCaseId } from "./lastLayer";

/**
 * The drill mechanic itself, checked against the cube rather than reasoned about.
 *
 * A trainer has exactly two ways to be silently, ruinously wrong, and neither
 * shows up as an error:
 *
 * 1. **The setup draws the wrong case.** You practise something, and it is not
 *    the case the app says it is. You then build a finger trick against the wrong
 *    picture, which is worse than not drilling at all.
 * 2. **The rep ends at the wrong moment.** An OLL drill that waits for a full
 *    solve records OLL+PLL time against the OLL case, so every schedule decision
 *    after that is made on a number that measures the wrong thing.
 *
 * Both are checked here by actually turning a cube.
 */

const SOLVED_OPTIONS = {
  ignorePuzzleOrientation: true,
  ignoreCenterOrientation: true,
};

function invert(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
    .join(" ");
}

async function kpuzzle() {
  const { puzzles } = await import("cubing/puzzles");
  return puzzles["3x3x3"].kpuzzle();
}

test("every starter OLL setup draws a case that its own algorithm then orients", async () => {
  const kp = await kpuzzle();
  const solved = kp.defaultPattern();

  for (const known of KNOWN_OLL) {
    if (!known.alg) continue;

    const setup = invert(known.alg);
    const scrambled = solved.applyAlg(setup);

    // The setup must actually disturb the last layer, or the drill is a no-op
    // that the learner completes by pressing nothing.
    assert.notEqual(
      ollCaseId(scrambled),
      OLL_SKIP,
      `${known.name}: the setup left the last layer already oriented`,
    );

    // And the algorithm must resolve exactly what the setup created.
    const after = scrambled.applyAlg(known.alg);
    assert.equal(
      ollCaseId(after),
      OLL_SKIP,
      `${known.name}: its own algorithm did not orient the case its setup drew`,
    );
  }
});

test("an OLL rep ends the moment the layer is oriented, with PLL still to do", async () => {
  // The whole reason the drill uses an orientation check rather than a solved
  // check.
  //
  // A starter setup is the exact inverse of its own algorithm, so running that
  // algorithm returns the cube to solved and the two checks happen to agree.
  // Real solves do not look like that: you orient, and a PLL is left. Built here
  // by stacking Sune's setup on top of a T-perm, so orienting with Sune lands on
  // a genuine unsolved-but-oriented state — which is what a real OLL rep ends on.
  const kp = await kpuzzle();
  const solved = kp.defaultPattern();

  const sune = KNOWN_OLL.find((c) => c.name === "Sune");
  const tperm = KNOWN_PLL.find((c) => c.name === "T-perm");
  assert.ok(sune && tperm, "Sune and T-perm must be in the starter set");

  const caseState = solved.applyAlg(invert(tperm.alg)).applyAlg(invert(sune.alg));

  assert.notEqual(ollCaseId(caseState), OLL_SKIP, "precondition: an OLL to do");

  const afterOll = caseState.applyAlg(sune.alg);

  assert.equal(ollCaseId(afterOll), OLL_SKIP, "the last layer is now oriented");
  assert.equal(
    afterOll.experimentalIsSolved(SOLVED_OPTIONS),
    false,
    "but the cube is NOT solved — a solved-check would leave the clock running " +
      "through the PLL and record it against the OLL case",
  );

  // And the leftover really is the T-perm, so the drill stopped exactly at the
  // boundary between the two stages rather than somewhere arbitrary.
  assert.equal(pllCaseId(afterOll), pllCaseId(solved.applyAlg(invert(tperm.alg))));
});

test("every starter PLL setup draws a case that its own algorithm then solves", async () => {
  const kp = await kpuzzle();
  const solved = kp.defaultPattern();

  for (const known of KNOWN_PLL) {
    if (!known.alg) continue;

    const setup = invert(known.alg);
    const scrambled = solved.applyAlg(setup);

    assert.notEqual(
      pllCaseId(scrambled),
      PLL_SKIP,
      `${known.name}: the setup left the last layer already permuted`,
    );

    const after = scrambled.applyAlg(known.alg);
    assert.equal(
      after.experimentalIsSolved(SOLVED_OPTIONS),
      true,
      `${known.name}: its own algorithm did not solve the case its setup drew`,
    );
  }
});

test("a PLL setup leaves the last layer already oriented", async () => {
  // PLL only ever happens on an oriented last layer. If a starter PLL setup
  // disturbed orientation too, the drill would be asking for OLL+PLL under a
  // PLL label and the case times would not be comparable to anything.
  const kp = await kpuzzle();
  const solved = kp.defaultPattern();

  for (const known of KNOWN_PLL) {
    if (!known.alg) continue;
    const scrambled = solved.applyAlg(invert(known.alg));
    assert.equal(
      ollCaseId(scrambled),
      OLL_SKIP,
      `${known.name}: setup disturbed orientation, so this is not a pure PLL`,
    );
  }
});

test("starter cases are distinct from one another", async () => {
  // Two cards with the same signature would be the same drill twice, and the
  // scheduler would treat them as independent evidence about different skills.
  const kp = await kpuzzle();
  const solved = kp.defaultPattern();

  const ollIds = KNOWN_OLL.filter((c) => c.alg).map((c) =>
    ollCaseId(solved.applyAlg(invert(c.alg))),
  );
  assert.equal(new Set(ollIds).size, ollIds.length, "duplicate OLL cases");

  const pllIds = KNOWN_PLL.filter((c) => c.alg).map((c) =>
    pllCaseId(solved.applyAlg(invert(c.alg))),
  );
  assert.equal(new Set(pllIds).size, pllIds.length, "duplicate PLL cases");
});
