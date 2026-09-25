import type { Stage } from "./caseStats";

/**
 * The drill scheduler.
 *
 * Spaced repetition was designed for recall: did you remember the answer, yes or
 * no, and the interval grows on yes. Algorithm drilling is not that. A cuber
 * always "remembers" a T-perm — the thing being trained is how fast they
 * recognise it and how cleanly their hands execute it, and both are continuous.
 * So the signal here is **time**, not a self-reported yes/no, and the scheduler
 * has no buttons for the learner to lie to.
 *
 * Two consequences worth stating, because they are what make this different from
 * bolting SM-2 onto a cube:
 *
 * **The target is your own median, not an absolute.** "Fast enough" means "as
 * fast as you already are at most of your cases". A fixed threshold in seconds
 * would be wrong for everybody except the one person it was tuned on, and it
 * would tell a 40-second beginner they are failing at everything.
 *
 * **Intervals are counted in reps, not days.** The unit of a drill session is
 * "how many other cases come between this one and its next appearance". Days are
 * the right unit for vocabulary you meet once; they are useless inside a
 * twenty-minute session where a case can profitably return four times.
 */

export interface TrainingCard {
  caseId: string;
  stage: Stage;
  /** Algorithm that redraws the case from solved. Required — it IS the drill. */
  setupAlg: string;
  name: string | null;
  /** Times for this card, most recent last. Capped; see `RECENT_KEPT`. */
  times: number[];
  /**
   * Leitner level. Higher means seen less often. Starts at 0 for a card that has
   * never been attempted, so new material comes up immediately.
   */
  box: number;
  /** Rep counter at which this card is next due. */
  dueAt: number;
  /** Epoch ms, for the between-session decay. */
  lastSeenAt: number | null;
  /**
   * Added by choosing a set, not met in a solve. Such a card belongs to its
   * set, and stays out of "cases from my solves" until a solve brings it up.
   */
  fromSet?: boolean;
}

/**
 * Enough recent times to have an opinion, few enough that a card reflects how
 * you solve it *now*. A card you were slow at six months ago should not still be
 * dragging its own average down.
 */
export const RECENT_KEPT = 8;

/**
 * Reps to wait at each box level. Roughly Fibonacci: the early gaps are tight
 * because a case you just failed needs to come back while the correction is
 * still fresh, and the later ones open up fast so a mastered case stops eating
 * the session.
 */
export const INTERVALS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
export const MAX_BOX = INTERVALS.length - 1;

/** A card unseen for this long drops a box. Skills rust; the schedule should say so. */
export const DECAY_AFTER_MS = 7 * 86_400_000;

export function newCard(
  caseId: string,
  stage: Stage,
  setupAlg: string,
  name: string | null = null,
): TrainingCard {
  return {
    caseId,
    stage,
    setupAlg,
    name,
    times: [],
    box: 0,
    dueAt: 0,
    lastSeenAt: null,
  };
}

/** Mean of a card's recent times, or null when it has never been attempted. */
export function cardMean(card: TrainingCard): number | null {
  if (card.times.length === 0) return null;
  return card.times.reduce((a, b) => a + b, 0) / card.times.length;
}

export function cardBest(card: TrainingCard): number | null {
  return card.times.length === 0 ? null : Math.min(...card.times);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * The bar a rep has to clear, in ms: the median of this cuber's own case means.
 *
 * Null until enough cards have been attempted for a median to mean anything. A
 * target drawn from two cards would be an accident, and promoting cards against
 * an accident is worse than not promoting them at all.
 */
export const MIN_CARDS_FOR_TARGET = 4;

export function targetMs(cards: readonly TrainingCard[], stage: Stage): number | null {
  const means = cards
    .filter((c) => c.stage === stage)
    .map(cardMean)
    .filter((m): m is number => m !== null);

  if (means.length < MIN_CARDS_FOR_TARGET) return null;
  return median(means);
}

/**
 * The next card to drill.
 *
 * Anything overdue comes first, oldest debt first. With nothing due, the card
 * furthest from its target is chosen rather than simply the next in line — the
 * point of a session is to spend it on what is actually costing time.
 */
export function nextCard(
  cards: readonly TrainingCard[],
  position: number,
): TrainingCard | null {
  if (cards.length === 0) return null;

  const due = cards.filter((c) => c.dueAt <= position);
  if (due.length > 0) {
    // A never-attempted card is infinitely overdue: it is the only card we know
    // nothing about, and knowing nothing is the biggest gap there is.
    const unseen = due.filter((c) => c.times.length === 0);
    if (unseen.length > 0) return unseen[0];

    return due.reduce((worst, card) => (card.dueAt < worst.dueAt ? card : worst));
  }

  return cards.reduce((soonest, card) =>
    card.dueAt < soonest.dueAt ? card : soonest,
  );
}

export interface RepOutcome {
  card: TrainingCard;
  /** True when the rep cleared the target and the card was promoted. */
  promoted: boolean;
  /** Null while there is not yet enough data to set a target. */
  target: number | null;
}

/**
 * Records one rep and reschedules the card.
 *
 * Pure: returns a new card rather than mutating, so the queue can be recomputed
 * from a list of reps in a test without a browser.
 */
export function recordRep(
  card: TrainingCard,
  ms: number,
  cards: readonly TrainingCard[],
  position: number,
  now: number,
): RepOutcome {
  const times = [...card.times, ms].slice(-RECENT_KEPT);
  const target = targetMs(cards, card.stage);

  // With no target yet, every rep promotes. That is deliberate: the first
  // session should move through the material rather than grinding one case
  // against a bar that does not exist yet.
  const promoted = target === null || ms <= target;

  const box = promoted
    ? Math.min(MAX_BOX, card.box + 1)
    : // Demote rather than reset. One slow rep is a bad rep, not amnesia, and
      // sending a well-known case back to the start makes the session repetitive
      // enough that people stop trusting the schedule.
      Math.max(0, card.box - 1);

  return {
    card: {
      ...card,
      times,
      box,
      dueAt: position + INTERVALS[box],
      lastSeenAt: now,
    },
    promoted,
    target,
  };
}

/**
 * Applies between-session rust when a deck is loaded.
 *
 * Without this, a deck left for a month comes back claiming every case is
 * mastered and schedules none of them, which is exactly wrong — a month away is
 * when you most need the review.
 */
export function decayDeck(
  cards: readonly TrainingCard[],
  now: number,
): TrainingCard[] {
  return cards.map((card) => {
    if (card.lastSeenAt === null) return card;
    const elapsed = now - card.lastSeenAt;
    if (elapsed < DECAY_AFTER_MS) return card;

    const levels = Math.floor(elapsed / DECAY_AFTER_MS);
    return { ...card, box: Math.max(0, card.box - levels) };
  });
}

/** Rescales due positions so a resumed session starts from zero. */
export function resetPositions(cards: readonly TrainingCard[]): TrainingCard[] {
  return cards.map((card) => ({
    ...card,
    dueAt: Math.max(0, card.dueAt - Math.min(...cards.map((c) => c.dueAt))),
  }));
}

export interface DeckSummary {
  total: number;
  attempted: number;
  /** Cards at the top box — as learned as this scheduler can tell. */
  mastered: number;
  targetOll: number | null;
  targetPll: number | null;
}

export function summarise(cards: readonly TrainingCard[]): DeckSummary {
  return {
    total: cards.length,
    attempted: cards.filter((c) => c.times.length > 0).length,
    mastered: cards.filter((c) => c.box >= MAX_BOX).length,
    targetOll: targetMs(cards, "OLL"),
    targetPll: targetMs(cards, "PLL"),
  };
}
