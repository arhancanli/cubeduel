import { test } from "node:test";
import assert from "node:assert/strict";

import { EVENTS, type EventId } from "./events";
import { isSolvedInPlace, loadKPuzzle, replaySolves } from "./cubeReplay";
import { verifySolve } from "./verifySolve";

/**
 * Multi-event verification, against real WCA-legal scrambles.
 *
 * Fixed rather than generated: `cubing/scramble` starts a worker that keeps the
 * process alive, so any test importing it never exits. `cubing/puzzles`, which
 * is what replaying actually needs, is plain JavaScript and is fine.
 */
const SCRAMBLES: Record<EventId, string> = {
  "222": "L' F U L U2 R2 U' F' U2 L' U'",
  "333": "F U R' B U D F D2 F2 D' F2 U' L2 F2 B2 D2 L2 B' U' R2",
  "444":
    "D' R' L2 D2 F' R' F D F L' F2 L D2 R' U2 D2 L' F2 B2 R2 D Uw2 F2 Rw2 U L2 R U L' B2 D' Fw2 L Fw' D L2 U' B' U Fw Uw' Rw2 Fw' U' B2 Uw",
  "555":
    "F2 D' Bw R2 Rw Uw2 L Bw2 D2 Lw' B' R2 Fw D Lw R B2 Rw Bw2 Lw F B Bw2 L' Bw2 D B' Bw L R' Uw2 B2 Rw' Uw Rw2 Fw Rw' Fw Uw' Lw Fw' L B2 Bw2 L2 F2 Dw Lw' B2 Bw2 R2 Uw Fw Rw Uw2 Rw2 Bw U Rw D2",
};

/** Inverting a scramble solves it, which gives every event an honest solution. */
function solutionFor(scramble: string): string[] {
  return scramble
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`));
}

const EVENT_IDS = Object.keys(SCRAMBLES) as EventId[];

test("a correct solution solves the cube, on every event", async () => {
  for (const id of EVENT_IDS) {
    const solved = await replaySolves(SCRAMBLES[id], solutionFor(SCRAMBLES[id]), id);
    assert.equal(solved, true, id);
  }
});

test("a wrong solution does not, on every event", async () => {
  for (const id of EVENT_IDS) {
    const wrong = solutionFor(SCRAMBLES[id]).slice(0, -1);
    assert.equal(await replaySolves(SCRAMBLES[id], wrong, id), false, id);
  }
});

test("each event replays against its own puzzle, with no shared cache", async () => {
  // The original version of this test asserted that a scramble replayed under
  // the wrong event fails. It does not, and the reason is worth writing down:
  // applying a scramble and then its exact inverse returns ANY puzzle to solved,
  // because the two cancel move for move. So that pair cannot detect a wrong
  // puzzle, and a test built on it was asserting something false.
  //
  // What can go wrong is the cache: one shared promise would hand whichever
  // puzzle loaded first to every event thereafter. This checks the puzzles are
  // genuinely distinct, by a property only the right one has.
  const sizes: Record<string, number> = {};
  for (const id of EVENT_IDS) {
    const kpuzzle = await loadKPuzzle(id);
    const orbits = Object.keys(kpuzzle.defaultPattern().patternData).sort();
    sizes[id] = Object.values(kpuzzle.defaultPattern().patternData).reduce(
      (n, o) => n + o.pieces.length,
      0,
    );
    assert.ok(orbits.length > 0, id);
  }
  // A bigger cube has more pieces. If the cache were shared these would be equal.
  assert.ok(sizes["222"] < sizes["333"], `2x2 ${sizes["222"]} vs 3x3 ${sizes["333"]}`);
  assert.ok(sizes["333"] < sizes["444"], `3x3 ${sizes["333"]} vs 4x4 ${sizes["444"]}`);
  assert.ok(sizes["444"] < sizes["555"], `4x4 ${sizes["444"]} vs 5x5 ${sizes["555"]}`);
});

test("a big-cube solve that only fixes the outer layers is refused", async () => {
  // The failure that matters on a 4x4: a solution that would satisfy a 3x3 —
  // corners and edges in place — while the centres and wings are still wrong.
  // Dropping the wide moves from a correct solution produces exactly that.
  const full = solutionFor(SCRAMBLES["444"]);
  const outerOnly = full.filter((m) => !/w/i.test(m));
  assert.ok(outerOnly.length < full.length, "the scramble must contain wide moves");

  assert.equal(await replaySolves(SCRAMBLES["444"], outerOnly, "444"), false);
});

test("centres may be permuted within a face, but not across faces", async () => {
  // Four centres per face are physically identical, so a genuine 4x4 solve
  // almost never returns them to their original slots. Demanding exact positions
  // would reject nearly every honest solve — and only honest ones, since anyone
  // cheating submits whatever passes.
  //
  // Tested on the pattern directly rather than through a move sequence: the
  // point is what "solved" means, and routing it through an algorithm would be
  // testing the algorithm.
  const kpuzzle = await loadKPuzzle("444");
  const solved = kpuzzle.defaultPattern();

  const clone = () =>
    Object.fromEntries(
      Object.entries(solved.patternData).map(([k, v]) => [
        k,
        { pieces: [...v.pieces], orientation: [...v.orientation] },
      ]),
    );

  assert.equal(isSolvedInPlace({ patternData: clone() } as unknown as typeof solved), true,
    "the default pattern is solved");

  // 24 centres, four per face: 0-3 are one face, 4-7 the next.
  const withinFace = clone();
  [withinFace.CENTERS.pieces[0], withinFace.CENTERS.pieces[1]] =
    [withinFace.CENTERS.pieces[1], withinFace.CENTERS.pieces[0]];
  assert.equal(
    isSolvedInPlace({ patternData: withinFace } as unknown as typeof solved),
    true,
    "two identical centres swapped within a face is still a solved cube",
  );

  const acrossFaces = clone();
  [acrossFaces.CENTERS.pieces[0], acrossFaces.CENTERS.pieces[4]] =
    [acrossFaces.CENTERS.pieces[4], acrossFaces.CENTERS.pieces[0]];
  assert.equal(
    isSolvedInPlace({ patternData: acrossFaces } as unknown as typeof solved),
    false,
    "a centre on the wrong face is not solved",
  );

  // Corners are distinguishable, so the same leniency must not apply to them.
  const corners = clone();
  [corners.CORNERS.pieces[0], corners.CORNERS.pieces[1]] =
    [corners.CORNERS.pieces[1], corners.CORNERS.pieces[0]];
  assert.equal(
    isSolvedInPlace({ patternData: corners } as unknown as typeof solved),
    false,
    "swapped corners are not solved",
  );
});

test("a full submission verifies on every event", async () => {
  for (const id of EVENT_IDS) {
    const solution = solutionFor(SCRAMBLES[id]);
    // Paced so the turn rate is human and the duration clears the event's floor.
    const durationMs = Math.max(EVENTS[id].minSolveMs + 500, solution.length * 180);
    const gap = durationMs / Math.max(1, solution.length - 1);
    const moves = solution.map((move, i) => ({ move, atMs: Math.round(i * gap) }));

    const verdict = await verifySolve({
      scramble: SCRAMBLES[id],
      moves,
      durationMs,
      issuedAt: 0,
      receivedAt: durationMs + 200,
      event: id,
    });

    assert.equal(verdict.verified, true, `${id}: ${verdict.verified ? "" : verdict.reason}`);
  }
});

test("a world-record 2x2 single is not refused as impossible", async () => {
  // The 2x2 record single is 0.39s. The old fixed 500ms floor — correct and
  // unarguable for a 3x3 — would have rejected it as cheating.
  assert.ok(EVENTS["222"].minSolveMs < 390, "2x2 floor must sit below the world record");

  const solution = solutionFor(SCRAMBLES["222"]);
  const durationMs = 390;
  const gap = durationMs / Math.max(1, solution.length - 1);
  const moves = solution.map((move, i) => ({ move, atMs: Math.round(i * gap) }));

  const verdict = await verifySolve({
    scramble: SCRAMBLES["222"],
    moves,
    durationMs,
    issuedAt: 0,
    receivedAt: durationMs + 100,
    event: "222",
  });

  // It may still fail the turn-rate check, which is a separate and legitimate
  // question — what must not happen is a rejection for being "faster than
  // physically possible" when a human demonstrably did it.
  if (!verdict.verified) {
    assert.ok(
      !/faster than physically possible/.test(verdict.reason),
      `rejected as impossible: ${verdict.reason}`,
    );
  }
});

test("the hand-written solved check agrees with cubing.js where both work", async () => {
  // Two implementations of the same question will drift unless something pins
  // them together. cubing.js answers for 2x2 and 3x3; this app's own version
  // answers for all four. Where they overlap they must never disagree — and if
  // they ever do, the one to trust is the library.
  //
  // `isSolvedInPlace` is the orientation-fixed half, so the comparison uses a
  // pattern that has not been rotated.
  for (const id of ["222", "333"] as const) {
    const kpuzzle = await loadKPuzzle(id);
    const scramble = SCRAMBLES[id];
    const solution = solutionFor(scramble);

    let pattern = kpuzzle.defaultPattern().applyAlg(scramble);

    // Step through the whole solve, comparing at every single position rather
    // than only at the end — the interesting disagreements are near-solved
    // states, not obviously-scrambled ones.
    for (let i = 0; i <= solution.length; i++) {
      const mine = isSolvedInPlace(pattern);
      const theirs = pattern.experimentalIsSolved({
        ignorePuzzleOrientation: false,
        ignoreCenterOrientation: true,
      });
      assert.equal(mine, theirs, `${id}: disagreement after ${i} moves of the solution`);
      if (i < solution.length) pattern = pattern.applyMove(solution[i]);
    }
  }
});
