import "server-only";

import { isValidScramble } from "../scrambleParam";
import { buildTables, solveScramble, type SolveResult } from "../solver";
import { buildCrossTable, crossDistance } from "../crossSolver";
import { derivePieceGroups } from "../cfop";

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
/**
 * How long the tables took on this instance: 0 when they were loaded from the
 * precomputed file, and over a second when they had to be computed.
 */
let lastTableBuildMs: number | null = null;

export function tableBuildMs(): number | null {
  return lastTableBuildMs;
}

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
  // Reported in the response so a regression here is visible rather than
  // inferred from latency. Loading the precomputed tables is ~30ms; computing
  // them is 1.2-2.7s, and the difference is the whole cold-start story.
  const tables = buildTables();
  lastTableBuildMs = tables.buildMs;

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

// ---------------------------------------------------------------------------
// Cross efficiency
// ---------------------------------------------------------------------------

/**
 * Optimal cross tables, one per face, built on first use.
 *
 * A table is 186KB and takes about 1.7 seconds to build locally, so this cannot
 * happen in the browser and cannot happen per request. Six faces is 1.1MB if a
 * process ever sees all of them, which it will not — almost every cuber builds
 * on the same face every solve.
 *
 * The honest cost: measured on the deployment, a cold function answering its
 * first cross query takes about 11 seconds — serverless cold start, plus the
 * solver's own pruning tables, plus this. Warm it is 600ms. That is acceptable
 * only because the caller is fire-and-forget: the solve report is already on
 * screen and complete, and this line appears when it appears. It would not be
 * acceptable for anything a player waits on, and if it ever becomes so the fix
 * is to pre-generate these the way the dailies are.
 */
const crossTables = new Map<string, Uint8Array>();
const crossSlots = new Map<string, number[]>();

async function crossTableFor(face: string): Promise<{ table: Uint8Array; slots: number[] }> {
  const cached = crossTables.get(face);
  const slots = crossSlots.get(face);
  if (cached && slots) return { table: cached, slots };

  const { puzzles } = await import("cubing/puzzles");
  const kpuzzle = await puzzles["3x3x3"].kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const groups = derivePieceGroups(solved as never, face);

  const table = buildCrossTable(solved as never, groups.crossEdges);
  crossTables.set(face, table);
  crossSlots.set(face, groups.crossEdges);
  return { table, slots: groups.crossEdges };
}

/**
 * The shortest cross available on the face the solver actually used.
 *
 * Deliberately that face and not the best of the six. Comparing a white-cross
 * solver against the easiest cross on any face measures their colour neutrality,
 * which is a different skill and not the one the number is claiming to describe.
 */
export async function optimalCross(
  scramble: string,
  face: string,
): Promise<number | null> {
  const normalised = scramble.trim().replace(/\s+/g, " ");
  if (!isValidScramble(normalised)) return null;
  if (!/^[UDLRFB]$/.test(face)) return null;

  try {
    const { table, slots } = await crossTableFor(face);
    const { puzzles } = await import("cubing/puzzles");
    const kpuzzle = await puzzles["3x3x3"].kpuzzle();
    const pattern = kpuzzle.defaultPattern().applyAlg(normalised);
    return crossDistance(table, pattern as never, slots);
  } catch {
    return null;
  }
}
