import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_REVIEWED, insightsFrom, type ReviewedSolve } from "./habits";
import type { Moment } from "./moveReview";

function moment(partial: Partial<Moment> & Pick<Moment, "kind">): Moment {
  return {
    tone: "cost",
    phase: "F2L 1",
    atMs: 0,
    costMs: 0,
    title: "",
    detail: "",
    ...partial,
  };
}

function solve(moments: Moment[], durationMs = 20_000): ReviewedSolve {
  const recoverableMs = moments.reduce((sum, m) => sum + (m.tone === "cost" ? m.costMs : 0), 0);
  return { durationMs, review: { turns: 60, typicalGapMs: 150, moments, recoverableMs } };
}

const clean = () => solve([moment({ kind: "cross-clean", tone: "good", phase: "Cross", extraTurns: 0 })]);

test("below the minimum sample there is nothing to say", () => {
  const result = insightsFrom(Array.from({ length: MIN_REVIEWED - 1 }, clean));
  assert.equal(result.kind, "insufficient");
});

test("clean solves produce no habits", () => {
  const result = insightsFrom(Array.from({ length: 8 }, clean));
  assert.equal(result.kind, "insights");
  assert.equal(result.kind === "insights" && result.habits.length, 0);
});

test("the costliest habit per solve comes first", () => {
  const solves = Array.from({ length: 10 }, (_, i) =>
    solve([
      moment({ kind: "pause", subject: "F2L 3", opensPhase: true, costMs: 1200 }),
      ...(i < 5 ? [moment({ kind: "undo", costMs: 300 })] : []),
    ]),
  );
  const result = insightsFrom(solves);
  assert.equal(result.kind, "insights");
  if (result.kind !== "insights") return;
  assert.deepEqual(
    result.habits.map((h) => h.kind),
    ["pauses", "undo"],
  );
  assert.equal(result.habits[0].perSolveMs, 1200);
  assert.equal(result.habits[1].perSolveMs, 150);
  assert.equal(result.habits[1].share, 0.5);
});

test("pauses name the place they happen most", () => {
  const solves = Array.from({ length: 10 }, (_, i) =>
    solve([
      // The rarer place comes first, so "first seen" cannot pass for "most common".
      moment({ kind: "pause", subject: i < 3 ? "OLL" : "F2L 3", opensPhase: true, costMs: 900 }),
    ]),
  );
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  const pauses = result.habits.find((h) => h.kind === "pauses");
  assert.ok(pauses);
  assert.match(pauses.title, /before F2L 3/);
  assert.match(pauses.evidence, /7 of 10/);
});

test("the cross habit reports the average turns over the shortest", () => {
  const solves = [
    ...Array.from({ length: 6 }, (_, i) =>
      solve([
        i < 4
          ? moment({ kind: "cross-route", phase: "Cross", extraTurns: 3, costMs: 600 })
          : moment({ kind: "cross-clean", tone: "good", phase: "Cross", extraTurns: 0 }),
      ]),
    ),
    // Two solves where the cross could not be judged: they must not drag the
    // average down as if they had been perfect.
    solve([]),
    solve([]),
  ];
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  const cross = result.habits.find((h) => h.kind === "cross");
  assert.ok(cross);
  // (3·4 + 0·2) / 6 solves with a known shortest cross = 2.0.
  assert.match(cross.evidence, /2\.0 turns/);
});

test("two-look cases are listed by how often they come up, with the commonest linked", () => {
  const twoLook = (subject: string, slug: string) =>
    moment({ kind: "two-look", phase: "OLL", subject, href: `/learn/${slug}`, costMs: 800 });
  const solves = [
    solve([twoLook("OLL 45", "oll-45")]),
    solve([twoLook("OLL 45", "oll-45")]),
    solve([twoLook("OLL 45", "oll-45")]),
    solve([twoLook("OLL 33", "oll-33")]),
    solve([]),
    solve([]),
  ];
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  const habit = result.habits.find((h) => h.kind === "two-look");
  assert.ok(habit);
  assert.equal(habit.href, "/learn/oll-45");
  assert.match(habit.evidence, /OLL 45 \(3×\)/);
});

test("a habit costing almost nothing and seen rarely is left out", () => {
  const solves = Array.from({ length: 10 }, (_, i) =>
    solve(i === 0 ? [moment({ kind: "long-way", costMs: 200 })] : []),
  );
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  assert.equal(result.habits.length, 0);
});

test("recoverable per solve is the mean over every reviewed solve", () => {
  const solves = [
    ...Array.from({ length: 4 }, () => solve([moment({ kind: "undo", costMs: 500 })])),
    ...Array.from({ length: 6 }, clean),
  ];
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  assert.equal(result.recoverablePerSolveMs, 200);
});

test("seams between algorithms are their own habit, not undone turns", () => {
  const solves = Array.from({ length: 6 }, () => solve([moment({ kind: "cancel", phase: "OLL", costMs: 250 })]));
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  assert.deepEqual(result.habits.map((h) => h.kind), ["cancel"]);
  assert.doesNotMatch(result.habits[0].advice, /misread/);
});

test("each habit points at the solve where it cost the most", () => {
  const solves = [300, 900, 400, 1500, 200, 600].map((ms) =>
    solve([moment({ kind: "pause", subject: "OLL", opensPhase: true, costMs: ms })]),
  );
  const result = insightsFrom(solves);
  if (result.kind !== "insights") throw new Error("expected insights");
  assert.equal(result.habits[0].worst, 3);
});
