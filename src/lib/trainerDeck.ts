"use client";

import { aggregateCases, buildNameTable } from "./caseStats";
import { KNOWN_OLL, KNOWN_PLL } from "./lastLayer";
import { loadHistory } from "./solveHistory";
import { decayDeck, newCard, type TrainingCard } from "./trainer";

/**
 * Building and keeping the drill deck.
 *
 * The deck is assembled from **the cases this cuber has actually met**, using the
 * setup algorithms already recorded alongside every solve. That is a deliberate
 * choice over shipping a canned list of all 57 OLL and 21 PLL cases:
 *
 * - It cannot be wrong. Every card is a case that genuinely came out of one of
 *   their solves, with a setup that provably redraws it, so there is no table of
 *   hand-entered algorithms waiting to teach somebody the wrong thing.
 * - It is better practice. Drilling the cases you meet, ordered by the time they
 *   actually cost you, beats grinding a fixed list in numerical order.
 *
 * The cost is a thin first session, so a small starter set of cases whose
 * algorithms are verified in `lastLayer.ts` seeds a deck with no history behind
 * it. It grows on its own from there.
 */

const DECK_KEY = "cubeduel.trainer.v1";

interface DeckStore {
  version: 1;
  cards: TrainingCard[];
  /** Reps completed, which is the clock the scheduler runs on. */
  position: number;
}

function empty(): DeckStore {
  return { version: 1, cards: [], position: 0 };
}

function isUsable(value: unknown): value is TrainingCard {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<TrainingCard>;
  return (
    typeof c.caseId === "string" &&
    (c.stage === "OLL" || c.stage === "PLL") &&
    typeof c.setupAlg === "string" &&
    c.setupAlg.length > 0 &&
    Array.isArray(c.times) &&
    c.times.every((t) => typeof t === "number" && Number.isFinite(t)) &&
    typeof c.box === "number" &&
    typeof c.dueAt === "number"
  );
}

export function loadDeck(): DeckStore {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(DECK_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as DeckStore;
    if (parsed?.version !== 1 || !Array.isArray(parsed.cards)) return empty();
    return {
      version: 1,
      // One malformed card must not cost the whole deck. Same rule as history:
      // losing a card silently beats losing the page.
      cards: parsed.cards.filter(isUsable),
      position: Number.isFinite(parsed.position) ? parsed.position : 0,
    };
  } catch {
    return empty();
  }
}

export function saveDeck(store: DeckStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DECK_KEY, JSON.stringify(store));
  } catch {
    /* Quota or private mode — the session keeps working, progress stops saving. */
  }
}

/**
 * The starter deck, for someone who has not analysed any solves yet.
 *
 * Only cases whose algorithms are verified by generating their own signature —
 * the same table the coach uses to name cases. A trainer that opens with a
 * mistyped algorithm has taught a cuber something they will have to unlearn with
 * their hands, which is far more expensive than a thin first session.
 */
async function starterCards(): Promise<TrainingCard[]> {
  const names = await buildNameTable();
  const [{ puzzles }, { ollCaseId, pllCaseId }] = await Promise.all([
    import("cubing/puzzles"),
    import("./lastLayer"),
  ]);
  const kpuzzle = await puzzles["3x3x3"].kpuzzle();
  const solved = kpuzzle.defaultPattern();

  const invert = (alg: string) =>
    alg
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .reverse()
      .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
      .join(" ");

  const cards: TrainingCard[] = [];

  for (const known of KNOWN_OLL) {
    // The solved state is not a case to drill.
    if (!known.alg) continue;
    const setup = invert(known.alg);
    const id = ollCaseId(solved.applyAlg(setup));
    cards.push(newCard(id, "OLL", setup, names.get(id) ?? known.name));
  }
  for (const known of KNOWN_PLL) {
    if (!known.alg) continue;
    const setup = invert(known.alg);
    const id = pllCaseId(solved.applyAlg(setup));
    cards.push(newCard(id, "PLL", setup, names.get(id) ?? known.name));
  }

  return cards;
}

/**
 * Merges cards discovered from solve history into the stored deck.
 *
 * Existing cards keep their schedule — the whole value of the deck is the history
 * of how you have done on each case, and rebuilding it from scratch on every
 * visit would throw that away. Only genuinely new cases are appended, and they
 * arrive at box 0 so they come up straight away.
 */
export async function buildDeck(): Promise<DeckStore> {
  const stored = loadDeck();
  const known = new Map(stored.cards.map((c) => [c.caseId, c]));

  const names = await buildNameTable().catch(() => new Map<string, string>());
  const solves = loadHistory();

  for (const stage of ["OLL", "PLL"] as const) {
    for (const aggregate of aggregateCases(solves, stage, names)) {
      // A case with no recorded setup cannot be drawn, so it cannot be drilled.
      if (!aggregate.setupAlg) continue;

      const existing = known.get(aggregate.caseId);
      if (existing) {
        // Refresh the label if the name table learned it since.
        if (!existing.name && aggregate.name) existing.name = aggregate.name;
        continue;
      }
      known.set(
        aggregate.caseId,
        newCard(aggregate.caseId, stage, aggregate.setupAlg, aggregate.name),
      );
    }
  }

  if (known.size === 0) {
    for (const card of await starterCards().catch(() => [])) {
      known.set(card.caseId, card);
    }
  }

  const cards = decayDeck([...known.values()], Date.now());
  const store: DeckStore = { version: 1, cards, position: stored.position };
  saveDeck(store);
  return store;
}

export type { DeckStore };
