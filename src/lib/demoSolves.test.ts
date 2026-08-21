import assert from "node:assert/strict";
import { test } from "node:test";

import demos from "../data/demo-solves.json";
import { buildTables, cubeFromAlg, isSolved } from "./solver";

/**
 * The landing page's one checkable claim.
 *
 * `SolverDemo` says these are real scrambles solved by this engine, and prints
 * the move count underneath. That is the only assertion on the page a visitor
 * could falsify, which makes it the one most worth pinning: a fixture is a file,
 * and a file can be edited by anybody who wants a smaller number under the
 * heading.
 *
 * So every shipped solve is replayed here. Scramble plus solution, applied to a
 * solved cube, must return a solved cube — and the printed move count must be
 * the length of the solution actually shown.
 *
 * These run in `npm test`, not only in the build, because the build regenerates
 * on `--force` and the point is to catch a fixture that arrived some other way.
 */

buildTables();

test("every demo on the landing page actually solves", () => {
  assert.ok(demos.length > 0, "no demos shipped");

  for (const demo of demos) {
    const cube = cubeFromAlg([demo.scramble, ...demo.solution].join(" "));
    assert.ok(
      isSolved(cube),
      `demo "${demo.scramble}" does not solve with the solution shipped beside it`,
    );
  }
});

test("the move count printed is the length of the solution shown", () => {
  for (const demo of demos) {
    assert.equal(
      demo.moves,
      demo.solution.length,
      `demo "${demo.scramble}" prints ${demo.moves} moves but ships ${demo.solution.length}`,
    );
  }
});

test("the timings shipped are plausible measurements, not placeholders", () => {
  for (const demo of demos) {
    // A solve this engine found took some measurable time and finished inside
    // the search budget. Zero would mean nobody measured; above the budget would
    // mean the number came from somewhere other than this run.
    assert.ok(
      demo.ms > 0 && demo.ms < 5000,
      `demo "${demo.scramble}" reports ${demo.ms}ms, which no run of this solver produced`,
    );
  }
});
