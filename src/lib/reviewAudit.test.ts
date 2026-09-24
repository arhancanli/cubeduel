import assert from "node:assert/strict";
import { test } from "node:test";

import { auditReview } from "./reviewAudit";

/**
 * The review reads solves whose true phases are known, and must read every
 * one exactly. At scale (1,200 solves, 8,400 phase ends) it is 100%; this is
 * the same measurement, small enough to run on every build. An analyser that
 * ends phases one turn late scores 14% here.
 */
test("the review reads every phase end and every last-layer case exactly", async () => {
  const a = await auditReview(40, 5);
  assert.deepEqual(a.misreads, []);
  assert.equal(a.boundariesRight, a.boundaries);
  assert.equal(a.phasesInOrder, 40);
  assert.equal(a.ollRight, 40);
  assert.equal(a.pllRight, 40);
});
