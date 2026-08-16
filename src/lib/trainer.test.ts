import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DECAY_AFTER_MS,
  INTERVALS,
  MAX_BOX,
  MIN_CARDS_FOR_TARGET,
  RECENT_KEPT,
  cardBest,
  cardMean,
  decayDeck,
  newCard,
  nextCard,
  recordRep,
  summarise,
  targetMs,
  type TrainingCard,
} from "./trainer";

const card = (id: string, times: number[] = [], box = 0): TrainingCard => ({
  ...newCard(id, "OLL", "R U R' U R U2 R'", null),
  times,
  box,
});

/** A deck with enough attempted cards for a target to exist. */
function deckWithTarget(): TrainingCard[] {
  return [
    card("a", [1000]),
    card("b", [2000]),
    card("c", [3000]),
    card("d", [4000]),
  ];
}

// ---------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------

test("no target is claimed from too few cards", () => {
  // A median of two cards is an accident, and promoting against an accident is
  // worse than not promoting at all.
  for (let n = 0; n < MIN_CARDS_FOR_TARGET; n++) {
    const cards = Array.from({ length: n }, (_, i) => card(String(i), [1000 * (i + 1)]));
    assert.equal(targetMs(cards, "OLL"), null, `${n} cards should give no target`);
  }
});

test("the target is the cuber's own median", () => {
  // Not an absolute threshold — a 40-second beginner must not be told they are
  // failing at every case they own.
  assert.equal(targetMs(deckWithTarget(), "OLL"), 2500);
});

test("the target ignores cards that have never been attempted", () => {
  const cards = [...deckWithTarget(), card("e"), card("f")];
  assert.equal(targetMs(cards, "OLL"), 2500);
});

test("OLL and PLL have separate targets", () => {
  // They are different amounts of work; one shared bar would make PLL look easy
  // and OLL look impossible, or the reverse.
  const cards: TrainingCard[] = [
    ...deckWithTarget(),
    ...["p", "q", "r", "s"].map((id, i) => ({
      ...newCard(id, "PLL" as const, "R U R'", null),
      times: [10_000 * (i + 1)],
    })),
  ];
  assert.equal(targetMs(cards, "OLL"), 2500);
  assert.equal(targetMs(cards, "PLL"), 25_000);
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

test("a fast rep pushes the card further out", () => {
  const cards = deckWithTarget();
  const outcome = recordRep(cards[0], 1200, cards, 10, 0);
  assert.equal(outcome.promoted, true, "1200ms is under the 2500ms target");
  assert.equal(outcome.card.box, 1);
  assert.equal(outcome.card.dueAt, 10 + INTERVALS[1]);
});

test("a slow rep brings the card back sooner", () => {
  const cards = deckWithTarget();
  const outcome = recordRep({ ...cards[0], box: 4 }, 9000, cards, 10, 0);
  assert.equal(outcome.promoted, false);
  assert.equal(outcome.card.box, 3, "demoted one level");
  assert.equal(outcome.card.dueAt, 10 + INTERVALS[3]);
});

test("one bad rep does not wipe out a well-known case", () => {
  // Resetting to zero makes the session grindingly repetitive, and people stop
  // trusting a schedule that overreacts.
  const cards = deckWithTarget();
  const outcome = recordRep({ ...cards[0], box: MAX_BOX }, 30_000, cards, 0, 0);
  assert.equal(outcome.card.box, MAX_BOX - 1);
});

test("the first session promotes freely, before any target exists", () => {
  // Nothing to measure against yet, so the session should move through the
  // material rather than grind one case against a bar that does not exist.
  const sparse = [card("a"), card("b")];
  const outcome = recordRep(sparse[0], 45_000, sparse, 0, 0);
  assert.equal(outcome.target, null);
  assert.equal(outcome.promoted, true);
});

test("boxes never run past the interval table", () => {
  const cards = deckWithTarget();
  let current = card("a", [500], MAX_BOX);
  for (let i = 0; i < 10; i++) {
    current = recordRep(current, 100, cards, i, 0).card;
    assert.ok(current.box <= MAX_BOX, `box ran to ${current.box}`);
    assert.ok(
      INTERVALS[current.box] !== undefined,
      `no interval defined for box ${current.box}`,
    );
  }
});

test("only the most recent times are kept", () => {
  // A card you were slow at months ago must not keep dragging its own average
  // down after you have fixed it.
  const cards = deckWithTarget();
  let current = card("a");
  for (let i = 0; i < RECENT_KEPT + 5; i++) {
    current = recordRep(current, 1000 + i, cards, i, 0).card;
  }
  assert.equal(current.times.length, RECENT_KEPT);
  assert.equal(current.times.at(-1), 1000 + RECENT_KEPT + 4, "newest kept");
  assert.ok(!current.times.includes(1000), "oldest dropped");
});

test("recording a rep does not mutate the card it was given", () => {
  const original = card("a", [1000], 2);
  const snapshot = JSON.stringify(original);
  recordRep(original, 500, deckWithTarget(), 5, 0);
  assert.equal(JSON.stringify(original), snapshot);
});

// ---------------------------------------------------------------------------
// Queue order
// ---------------------------------------------------------------------------

test("an empty deck has nothing to drill", () => {
  assert.equal(nextCard([], 0), null);
});

test("cards never attempted come first", () => {
  // The only card we know nothing about is the biggest gap in the deck.
  const cards = [card("known", [1000], 3), card("new")];
  assert.equal(nextCard(cards, 5)?.caseId, "new");
});

test("the most overdue card is picked first", () => {
  const cards = [
    { ...card("a", [1000]), dueAt: 8 },
    { ...card("b", [1000]), dueAt: 3 },
    { ...card("c", [1000]), dueAt: 6 },
  ];
  assert.equal(nextCard(cards, 10)?.caseId, "b");
});

test("with nothing due, the soonest card still comes up", () => {
  // A session must never stall waiting for a schedule to catch up.
  const cards = [
    { ...card("a", [1000]), dueAt: 40 },
    { ...card("b", [1000]), dueAt: 25 },
  ];
  assert.equal(nextCard(cards, 0)?.caseId, "b");
});

test("a drill session keeps returning to the slow case", () => {
  // The property that makes this a trainer rather than a shuffle: over a
  // session, time goes to what is actually costing time.
  const deck: TrainingCard[] = [
    card("slow", [5000]),
    card("fastA", [1000]),
    card("fastB", [1100]),
    card("fastC", [1200]),
  ];

  let cards = deck;
  const seen = new Map<string, number>();

  for (let position = 0; position < 40; position++) {
    const next = nextCard(cards, position);
    assert.ok(next, "the session must never stall");
    seen.set(next.caseId, (seen.get(next.caseId) ?? 0) + 1);

    // The slow case stays slow; the others stay fast.
    const ms = next.caseId === "slow" ? 5000 : 1000;
    const outcome = recordRep(next, ms, cards, position, 0);
    cards = cards.map((c) => (c.caseId === next.caseId ? outcome.card : c));
  }

  const slowReps = seen.get("slow") ?? 0;
  const fastReps = Math.max(
    seen.get("fastA") ?? 0,
    seen.get("fastB") ?? 0,
    seen.get("fastC") ?? 0,
  );
  assert.ok(
    slowReps > fastReps,
    `slow case got ${slowReps} reps, fastest-mastered got ${fastReps}`,
  );
});

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

test("a deck left alone loses ground", () => {
  const now = 10 * DECAY_AFTER_MS;
  const stale = [{ ...card("a", [1000], 5), lastSeenAt: now - DECAY_AFTER_MS * 2 }];
  assert.equal(decayDeck(stale, now)[0].box, 3);
});

test("a deck used yesterday is untouched", () => {
  const now = 10 * DECAY_AFTER_MS;
  const fresh = [{ ...card("a", [1000], 5), lastSeenAt: now - 86_400_000 }];
  assert.equal(decayDeck(fresh, now)[0].box, 5);
});

test("decay cannot push a card below the first box", () => {
  const now = 500 * DECAY_AFTER_MS;
  const ancient = [{ ...card("a", [1000], 2), lastSeenAt: 0 }];
  assert.equal(decayDeck(ancient, now)[0].box, 0);
});

test("a never-attempted card is not decayed", () => {
  const fresh = [card("a")];
  assert.deepEqual(decayDeck(fresh, Date.now()), fresh);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test("the summary counts what it says it counts", () => {
  const cards = [
    card("a", [1000], MAX_BOX),
    card("b", [2000], 1),
    card("c"),
    card("d", [3000], MAX_BOX),
    card("e", [4000], 0),
  ];
  const summary = summarise(cards);
  assert.equal(summary.total, 5);
  assert.equal(summary.attempted, 4);
  assert.equal(summary.mastered, 2);
});

test("card statistics handle the never-attempted case", () => {
  assert.equal(cardMean(card("a")), null);
  assert.equal(cardBest(card("a")), null);
  assert.equal(cardMean(card("a", [1000, 2000])), 1500);
  assert.equal(cardBest(card("a", [1000, 2000])), 1000);
});
