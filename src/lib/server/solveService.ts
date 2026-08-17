import "server-only";

import { isValidScramble } from "../scrambleParam";
import { buildTables, solveScramble, type SolveResult } from "../solver";

/**
 * The solving engine, as a server-side service.
 *
 * Two reasons it lives on the server rather than in the browser. The pruning
 * tables are about 8MB and take ~750ms to build, which is a poor thing to hand
 * every visitor on a page whose whole promise is being interactive immediately.
 * And the answer for a given scramble never changes, so computing it once for
 * everybody is strictly better than computing it once per person.
 */

export interface SolveSummary {
  /** Moves in the half-turn metric, where R2 counts as one. */
  optimalMoves: number;
  solution: string[];
  /** Whether this came from the cache rather than a fresh search. */
  cached: boolean;
  computeMs: number;
}

/**
 * Scrambles seen recently, with their answers.
 *
 * Bounded because this is a long-lived process and an unbounded map keyed by
 * user-supplied strings is a memory leak with a friendly name. Insertion-ordered
 * eviction is enough: the daily and any shared challenge link are hit repeatedly
 * within a short window, which is exactly the traffic worth caching.
 */
const CACHE_LIMIT = 500;
const cache = new Map<string, SolveResult>();

function remember(scramble: string, result: SolveResult): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(scramble, result);
}

/**
 * How many moves this scramble actually needs.
 *
 * Returns null for anything that is not a scramble this engine understands,
 * rather than throwing: the caller is an HTTP handler and a malformed input is a
 * rejection, not a fault.
 */
export function summariseScramble(scramble: string): SolveSummary | null {
  const normalised = scramble.trim().replace(/\s+/g, " ");
  if (!isValidScramble(normalised)) return null;

  const hit = cache.get(normalised);
  if (hit) {
    return {
      optimalMoves: hit.length,
      solution: hit.moves,
      cached: true,
      computeMs: 0,
    };
  }

  // The tables are built once per process. Doing it here rather than at module
  // load keeps the cost on the first request that actually needs a solve instead
  // of on every cold start, including the ones that only serve pages.
  buildTables();

  let result: SolveResult | null;
  try {
    result = solveScramble(normalised, {
      // Far more generous than the client-side defaults, deliberately. The answer
      // for a scramble is a mathematical fact that never changes, so it is
      // computed once per scramble for everybody and then cached — which makes
      // quality worth much more than latency here. At the default 250ms a slower
      // serverless CPU was returning 22 moves where a second returns 20.
      targetLength: 20,
      timeBudgetMs: 1500,
    });
  } catch {
    // `solveScramble` throws only for states no cube can reach. A scramble that
    // parses cannot produce one, but a scramble containing wide or slice moves
    // reaches the parser and is not something this engine models.
    return null;
  }
  if (!result) return null;

  remember(normalised, result);
  return {
    optimalMoves: result.length,
    solution: result.moves,
    cached: false,
    computeMs: result.elapsedMs,
  };
}
