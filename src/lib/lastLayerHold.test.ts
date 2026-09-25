import assert from "node:assert/strict";
import { test } from "node:test";

import { isSolvedPattern, loadKPuzzle } from "./cubeReplay";
import { holdForLastLayer, learnCases } from "./learn";
import { OLL_SKIP, ollCaseId } from "./lastLayer";

/**
 * Held with yellow on top, every case must still be the same case — the same
 * id, finished by the same algorithm — or the trainer would call a correct
 * solve wrong and the pictures would stop matching the names.
 */
test("held yellow-up, every case reads the same and its algorithm still finishes it", async () => {
  const kpuzzle = await loadKPuzzle();
  const solved = kpuzzle.defaultPattern();
  for (const c of await learnCases()) {
    const flat = solved.applyAlg(c.setup);
    const held = solved.applyAlg(holdForLastLayer(c.setup));
    if (c.stage === "OLL") {
      assert.equal(ollCaseId(held), ollCaseId(flat), c.label);
      assert.equal(ollCaseId(held.applyAlg(c.alg)), OLL_SKIP, `${c.label}: its algorithm orients the yellow face`);
    } else {
      // Not compared by id: seen from above, the bottom pieces run the other way
      // round, so a held case's permutation id comes out mirrored. Nothing reads
      // an id off a held cube — ids come from the unheld case — so what matters
      // is that the case's own algorithm still solves it.
      assert.ok(isSolvedPattern(held.applyAlg(c.alg)), `${c.label}: its algorithm solves the cube`);
      assert.ok(!isSolvedPattern(held), `${c.label}: and it was not already solved`);
    }
  }
});

test("the face on top is yellow: the pieces there are the ones that started on the bottom", async () => {
  const kpuzzle = await loadKPuzzle();
  const held = kpuzzle.defaultPattern().applyAlg(holdForLastLayer(""));
  // Kociemba corner order URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB: the top four
  // slots now hold pieces 4–7, the bottom (yellow) ones.
  const top = held.patternData.CORNERS.pieces.slice(0, 4).sort();
  assert.deepEqual(top, [4, 5, 6, 7]);
  // Turned over, not flipped front to back: green is still facing you, so the
  // algorithms' F and B mean what the Algorithms pages say they mean.
  const centres = held.patternData.CENTERS.pieces;
  const faces = ["U", "L", "F", "R", "B", "D"];
  assert.equal(faces[centres[faces.indexOf("F")]], "F");
  assert.equal(faces[centres[faces.indexOf("U")]], "D");
});
