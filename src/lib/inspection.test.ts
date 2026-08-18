import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INSPECTION_DNF_MS,
  INSPECTION_LIMIT_MS,
  NETWORK_ALLOWANCE_MS,
  combinePenalties,
  inspectionStateAt,
  judgeInspection,
} from "./inspection";

/** Raw gap that produces exactly `used` milliseconds of judged inspection. */
const raw = (used: number) => used + NETWORK_ALLOWANCE_MS;

test("inspection inside fifteen seconds is free", () => {
  for (const used of [0, 1000, 8000, 12_000, 14_999, INSPECTION_LIMIT_MS]) {
    assert.equal(judgeInspection(raw(used)).penalty, "OK", `${used}ms`);
  }
});

test("over fifteen seconds is +2", () => {
  // A4b1. The boundary itself is free — the regulation penalises *exceeding*
  // fifteen seconds, not reaching it.
  for (const used of [15_001, 16_000, INSPECTION_DNF_MS]) {
    assert.equal(judgeInspection(raw(used)).penalty, "PLUS2", `${used}ms`);
  }
});

test("over seventeen seconds is a DNF", () => {
  for (const used of [17_001, 20_000, 60_000]) {
    assert.equal(judgeInspection(raw(used)).penalty, "DNF", `${used}ms`);
  }
});

test("each boundary is exact", () => {
  // The value of a rule is that it applies identically every time, so the two
  // thresholds are pinned to the millisecond either side.
  assert.equal(judgeInspection(raw(INSPECTION_LIMIT_MS)).penalty, "OK");
  assert.equal(judgeInspection(raw(INSPECTION_LIMIT_MS + 1)).penalty, "PLUS2");
  assert.equal(judgeInspection(raw(INSPECTION_DNF_MS)).penalty, "PLUS2");
  assert.equal(judgeInspection(raw(INSPECTION_DNF_MS + 1)).penalty, "DNF");
});

test("the network allowance is given to the player, not taken from them", () => {
  // The server starts counting when it sends the scramble; the player cannot
  // look until it arrives. That gap is not theirs.
  const verdict = judgeInspection(INSPECTION_LIMIT_MS + 1000);
  assert.equal(verdict.penalty, "OK", "a slow connection must not cost a +2");
  assert.ok(verdict.inspectionMs < INSPECTION_LIMIT_MS);
});

test("a clock disagreement cannot produce negative inspection", () => {
  // The first turn appearing to precede the scramble is skew, not time travel.
  for (const rawMs of [0, -500, -60_000]) {
    const verdict = judgeInspection(rawMs);
    assert.equal(verdict.inspectionMs, 0);
    assert.equal(verdict.penalty, "OK");
  }
});

test("a penalty explains itself and cites the regulation", () => {
  // Somebody who has just lost two seconds is owed the reason.
  const plus2 = judgeInspection(raw(16_000));
  assert.match(plus2.reason, /A4b1/);
  assert.match(plus2.reason, /16\.00s/);

  const dnf = judgeInspection(raw(18_000));
  assert.match(dnf.reason, /A4b2/);

  assert.equal(judgeInspection(raw(5000)).reason, "", "no penalty needs no explanation");
});

test("the worse of the two penalties governs", () => {
  assert.equal(combinePenalties("OK", "OK"), "OK");
  assert.equal(combinePenalties("OK", "PLUS2"), "PLUS2");
  assert.equal(combinePenalties("PLUS2", "OK"), "PLUS2");
  assert.equal(combinePenalties("PLUS2", "PLUS2"), "PLUS2", "two +2s are not a +4");
  assert.equal(combinePenalties("DNF", "OK"), "DNF");
  assert.equal(combinePenalties("OK", "DNF"), "DNF");
  assert.equal(combinePenalties("PLUS2", "DNF"), "DNF");
});

test("the countdown runs down and stops at zero", () => {
  assert.equal(inspectionStateAt(0).remainingMs, INSPECTION_LIMIT_MS);
  assert.equal(inspectionStateAt(5000).remainingMs, INSPECTION_LIMIT_MS - 5000);
  assert.equal(inspectionStateAt(INSPECTION_LIMIT_MS).remainingMs, 0);
  assert.equal(inspectionStateAt(60_000).remainingMs, 0, "never negative");
});

test("the eight and twelve second warnings fire when they should", () => {
  // Cubers who have competed pace the last third of inspection around hearing
  // these, so they must land on the same moments the judge would call them.
  assert.equal(inspectionStateAt(7999).warningsPassed, 0);
  assert.equal(inspectionStateAt(8000).warningsPassed, 1);
  assert.equal(inspectionStateAt(11_999).warningsPassed, 1);
  assert.equal(inspectionStateAt(12_000).warningsPassed, 2);
  assert.equal(inspectionStateAt(20_000).warningsPassed, 2);
});

test("the live countdown agrees with the final verdict", () => {
  // The pending penalty shown during inspection must be the one actually
  // applied — a countdown that says "+2" and then does not charge it, or the
  // reverse, is worse than showing nothing.
  for (const elapsed of [0, 8000, 14_999, 15_001, 17_000, 17_001, 25_000]) {
    const live = inspectionStateAt(elapsed).pendingPenalty;
    const final = judgeInspection(elapsed + NETWORK_ALLOWANCE_MS).penalty;
    assert.equal(live, final, `disagreed at ${elapsed}ms`);
  }
});
