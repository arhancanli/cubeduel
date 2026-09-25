import type { LearnCase } from "./learn";
import { newCard, type TrainingCard } from "./trainer";

/**
 * What the trainer drills.
 *
 * It began with only the cases met in your own solves, because a hand-typed
 * list of algorithms could teach something wrong. The Algorithms pages have
 * since built all 57 OLL and 21 PLL cases by running each algorithm backwards
 * from solved, so a list can no longer be wrong — and a learner can pick what
 * they are actually studying: all of PLL, or OLL one shape at a time.
 *
 * Every set shares one deck, keyed by case. Sune drilled in "cross OLLs" is
 * the same card in "all OLL": nothing practised is ever lost by switching.
 */

export const TRAIN_SETS = [
  { id: "yours", label: "Cases from my solves" },
  { id: "pll", label: "All 21 PLL" },
  { id: "oll-cross", label: "OLL · cross on top" },
  { id: "oll-line", label: "OLL · line" },
  { id: "oll-l", label: "OLL · L-shape" },
  { id: "oll-dot", label: "OLL · dot" },
  { id: "oll", label: "All 57 OLL" },
] as const;

export type TrainSetId = (typeof TRAIN_SETS)[number]["id"];

export const TRAIN_SET_KEY = "cubeduel.trainerSet.v1";

const SHAPE: Partial<Record<TrainSetId, LearnCase["shape"]>> = {
  "oll-cross": "Cross",
  "oll-line": "Line",
  "oll-l": "L-shape",
  "oll-dot": "Dot",
};

/** The verified cases in a set. "yours" has none: it is built from your solves. */
export function setCases(id: TrainSetId, cases: readonly LearnCase[]): LearnCase[] {
  if (id === "yours") return [];
  if (id === "pll") return cases.filter((c) => c.stage === "PLL");
  if (id === "oll") return cases.filter((c) => c.stage === "OLL");
  return cases.filter((c) => c.stage === "OLL" && c.shape === SHAPE[id]);
}

/** The deck with any of these cases it did not have yet; every existing card untouched. */
export function addSet(deck: readonly TrainingCard[], cases: readonly LearnCase[]): TrainingCard[] {
  const have = new Set(deck.map((c) => c.caseId));
  const added = cases
    .filter((c) => !have.has(c.caseId))
    .map((c) => ({ ...newCard(c.caseId, c.stage, c.setup, c.name ?? c.label), fromSet: true }));
  return [...deck, ...added];
}

/** The cards a set drills. */
export function cardsInSet(deck: readonly TrainingCard[], id: TrainSetId, cases: readonly LearnCase[]): TrainingCard[] {
  if (id === "yours") return deck.filter((c) => !c.fromSet);
  const ids = new Set(setCases(id, cases).map((c) => c.caseId));
  return deck.filter((c) => ids.has(c.caseId));
}
