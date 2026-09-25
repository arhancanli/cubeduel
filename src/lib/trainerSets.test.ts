import assert from "node:assert/strict";
import { test } from "node:test";

import { learnCases } from "./learn";
import { newCard } from "./trainer";
import { addSet, cardsInSet, setCases, TRAIN_SETS } from "./trainerSets";

test("the sets are the ones learners study: PLL, OLL, and OLL by shape", async () => {
  const cases = await learnCases();
  const count = (id: (typeof TRAIN_SETS)[number]["id"]) => setCases(id, cases).length;
  assert.equal(count("pll"), 21);
  assert.equal(count("oll"), 57);
  const shapes = count("oll-cross") + count("oll-line") + count("oll-l") + count("oll-dot");
  assert.equal(shapes, 57, "every OLL is in exactly one shape");
  assert.equal(count("oll-cross"), 7);
  assert.equal(count("yours"), 0, "your own cases come from your solves, not from a list");
  for (const c of setCases("oll-dot", cases)) assert.equal(c.shape, "Dot");
});

test("adding a set adds only what is missing, and keeps every schedule", async () => {
  const cases = await learnCases();
  const sune = setCases("oll-cross", cases).find((c) => c.name === "Sune")!;
  const practised = { ...newCard(sune.caseId, "OLL", sune.setup, "Sune"), times: [1800, 1500], box: 3, dueAt: 12 };
  const deck = addSet([practised], setCases("oll-cross", cases));
  assert.equal(deck.length, 7);
  assert.deepEqual(deck.find((c) => c.caseId === sune.caseId), practised);
  const added = deck.filter((c) => c.caseId !== sune.caseId);
  assert.ok(added.every((c) => c.times.length === 0 && c.fromSet === true && c.name));
});

test("a set shows its own cases; 'your cases' keeps to what came from your solves", async () => {
  const cases = await learnCases();
  const mine = { ...newCard("from-a-solve", "PLL", "R U R'", "T"), times: [2100] };
  const deck = addSet([mine], setCases("pll", cases));
  assert.equal(cardsInSet(deck, "pll", cases).length, 21);
  assert.deepEqual(cardsInSet(deck, "yours", cases).map((c) => c.caseId), ["from-a-solve"]);
});
