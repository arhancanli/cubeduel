import assert from "node:assert/strict";
import { test } from "node:test";

import { invertAlg, learnCase, learnCases, SHAPE_ORDER, turnCount } from "./learn";

test("inverting an algorithm undoes it, move for move", () => {
  assert.equal(invertAlg("R U R' U R U2 R'"), "R U2 R' U' R U' R'");
  assert.equal(invertAlg("M2 U M2 U2 M2 U M2"), "M2 U' M2 U2 M2 U' M2");
});

test("inverting twice is the original", () => {
  const alg = "R U R' U' R' F R2 U' R' U' R U R' F'";
  assert.equal(invertAlg(invertAlg(alg)), alg);
});

test("cube rotations are not turns", () => {
  // An algorithm written with a rotation is not longer for it — nothing on the
  // cube moves, so counting them would make one algorithm look worse than an
  // identical one written another way.
  assert.equal(turnCount("x R2 F R F' x'"), 4);
  assert.equal(turnCount("R U R'"), 3);
});

test("every case is present and addressable", async () => {
  const cases = await learnCases();
  assert.equal(cases.length, 78);
  assert.equal(cases.filter((c) => c.stage === "OLL").length, 57);
  assert.equal(cases.filter((c) => c.stage === "PLL").length, 21);
  assert.equal(new Set(cases.map((c) => c.slug)).size, 78, "slugs collide");
});

test("slugs are URL-safe", async () => {
  for (const c of await learnCases()) {
    assert.match(c.slug, /^[a-z]+-[a-z0-9]+$/, c.slug);
  }
});

test("a case can be found by its slug", async () => {
  const sune = await learnCase("oll-27");
  assert.equal(sune?.name, "Sune");
  assert.equal(sune?.alg, "R U R' U R U2 R'");
  assert.equal(await learnCase("oll-99"), null);
});

test("the setup really produces the case the algorithm solves", async () => {
  // The setup is what a trainer applies to a solved cube. If it did not put the
  // cube into this case, every drill would practise something else.
  const { loadKPuzzle } = await import("./cubeReplay");
  const { ollCaseId, pllCaseId } = await import("./lastLayer");
  const kpuzzle = await loadKPuzzle();

  for (const c of await learnCases()) {
    const pattern = kpuzzle.defaultPattern().applyAlg(c.setup);
    const id = c.stage === "OLL" ? ollCaseId(pattern) : pllCaseId(pattern);
    assert.equal(id, c.caseId, `${c.label} sets up a different case`);
  }
});

test("the shape is only claimed for OLL", async () => {
  for (const c of await learnCases()) {
    if (c.stage === "OLL") {
      assert.ok(SHAPE_ORDER.includes(c.shape!), `${c.label} has shape ${c.shape}`);
    } else {
      // A PLL case is fully oriented by definition, so "shape" would be the same
      // word for all 21 and would tell a learner nothing.
      assert.equal(c.shape, null, `${c.label} claims a shape`);
    }
  }
});

test("the shapes divide OLL the way the cube does", async () => {
  const oll = (await learnCases()).filter((c) => c.stage === "OLL");
  const count = (s: string) => oll.filter((c) => c.shape === s).length;

  // Not arbitrary buckets: these follow from edge flips having to cancel.
  assert.equal(count("Cross"), 7, "the seven cases that arrive with the cross made");
  assert.equal(count("Dot"), 8, "the eight dot cases");
  assert.equal(count("Line") + count("L-shape"), 42);
  assert.equal(count("Cross") + count("Dot") + count("Line") + count("L-shape"), 57);
});

test("no algorithm is absurdly long", async () => {
  for (const c of await learnCases()) {
    assert.ok(c.moveCount > 0 && c.moveCount <= 25, `${c.label} is ${c.moveCount} moves`);
  }
});
