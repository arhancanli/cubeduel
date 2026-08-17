import { msForRating } from "./rating";

/**
 * Bot opponents.
 *
 * A bot that counts down to a chosen time and then declares itself finished is a
 * fake opponent with a number attached. You cannot watch it, you cannot check it,
 * and losing to it means nothing. So a bot here does what a player does: it
 * replays a **real solution to the actual scramble**, move by move, on a clock.
 * Its finishing time is not chosen — it falls out of the trajectory, the same way
 * yours falls out of your hands.
 *
 * That makes its progress visible during the race and its technique inspectable
 * afterwards. Every move it plays can be applied to the cube and checked, and its
 * move stream passes the same verifier that judges human solves — which is the
 * test that keeps this honest rather than merely plausible.
 *
 * ## What a bot is not
 *
 * It is not a simulated human. The solution comes from the two-phase engine, so
 * it is around 20 moves where a person using CFOP would take 50 or 60. To hit a
 * given time in 20 moves, a bot turns much more slowly than a person would. Its
 * **time is honest and its technique is not human**, and the UI says so rather
 * than letting anyone believe they were out-turned.
 *
 * Modelling a human method properly means a CFOP solver — cross, then pairs, then
 * the last layer — which is a different and much larger piece of work. Until that
 * exists, this is the honest version of the thing rather than a pretend one.
 */

export interface BotProfile {
  id: string;
  name: string;
  /** On the same scale as a human rating, so the match-up means something. */
  rating: number;
  blurb: string;
}

/**
 * A small ladder of opponents, spaced by the rating scale's own landmarks rather
 * than by invented difficulty tiers. Their names say what they are — nothing here
 * pretends to be a person.
 */
export const BOTS: BotProfile[] = [
  {
    id: "bot-drill",
    name: "Drill",
    rating: 1000,
    blurb: "About 30 seconds. Somewhere to start.",
  },
  {
    id: "bot-metro",
    name: "Metronome",
    rating: 1400,
    blurb: "Sub-30. Steady, never rushes, never fumbles.",
  },
  {
    id: "bot-tempo",
    name: "Tempo",
    rating: 1750,
    blurb: "Sub-20. The pace most cubers are chasing.",
  },
  {
    id: "bot-sharp",
    name: "Sharp",
    rating: 2000,
    blurb: "Sub-15. Quick enough to punish a slow cross.",
  },
  {
    id: "bot-blitz",
    name: "Blitz",
    rating: 2370,
    blurb: "Sub-10. You will need a good solve.",
  },
];

export function botById(id: string): BotProfile | null {
  return BOTS.find((b) => b.id === id) ?? null;
}

export interface BotMove {
  move: string;
  atMs: number;
}

export interface BotSolve {
  moves: BotMove[];
  durationMs: number;
  /** Turns per second across the whole solve. */
  tps: number;
}

/**
 * Share of the solve spent not turning.
 *
 * Real solves are not metronomic — a cuber pauses to recognise what to do next,
 * and those pauses are most of what separates a 20-second solve from a 15-second
 * one. A bot that turned at a perfectly even rate would look obviously mechanical
 * next to the move stream of a person.
 */
const PAUSE_FRACTION = 0.28;

/** How many recognition pauses a solve contains. Roughly one per stage. */
const PAUSE_COUNT = 4;

/** Deterministic RNG: the same duel always replays identically. */
function rng(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Lays a solution out on a clock so that it finishes at the time a player of
 * `rating` would take.
 *
 * The target comes from `msForRating`, the same scale human ratings use, so
 * "Tempo is rated 1750" and "Tempo finishes in about 19 seconds" are the same
 * statement rather than two numbers that have to be kept in agreement.
 */
export function buildBotSolve(
  solution: readonly string[],
  rating: number,
  seed: number,
): BotSolve {
  const target = msForRating(rating);
  const count = solution.length;

  if (count === 0) {
    return { moves: [], durationMs: 0, tps: 0 };
  }
  if (count === 1) {
    return {
      moves: [{ move: solution[0], atMs: 0 }],
      durationMs: Math.round(target),
      tps: 1 / (target / 1000),
    };
  }

  const next = rng(seed);

  // Pauses land at interior moves, never the first: nothing is being recognised
  // before the solve has started.
  const pauseAt = new Set<number>();
  const usablePauses = Math.min(PAUSE_COUNT, count - 1);
  while (pauseAt.size < usablePauses) {
    pauseAt.add(1 + Math.floor(next() * (count - 1)));
  }

  const pauseBudget = target * PAUSE_FRACTION;
  const turnBudget = target - pauseBudget;

  // Weights rather than a flat rate, so the gaps vary the way a hand does.
  const weights: number[] = [];
  let totalWeight = 0;
  for (let i = 1; i < count; i++) {
    const jitter = 0.75 + next() * 0.5;
    weights.push(jitter);
    totalWeight += jitter;
  }

  const pauseShare = usablePauses > 0 ? pauseBudget / usablePauses : 0;

  const moves: BotMove[] = [{ move: solution[0], atMs: 0 }];
  let clock = 0;
  for (let i = 1; i < count; i++) {
    clock += (weights[i - 1] / totalWeight) * turnBudget;
    if (pauseAt.has(i)) clock += pauseShare;
    moves.push({ move: solution[i], atMs: Math.round(clock) });
  }

  const durationMs = moves[moves.length - 1].atMs;
  return {
    moves,
    durationMs,
    tps: durationMs > 0 ? count / (durationMs / 1000) : 0,
  };
}

/**
 * Where the bot is at a given moment, as a move index.
 *
 * Drives the opponent's progress bar during a race. Deliberately derived from
 * the trajectory rather than from a separate progress model, so what is shown is
 * exactly what the bot is doing.
 */
export function botProgressAt(solve: BotSolve, elapsedMs: number): number {
  if (solve.moves.length === 0) return 0;
  let index = 0;
  while (index < solve.moves.length && solve.moves[index].atMs <= elapsedMs) {
    index++;
  }
  return index;
}
