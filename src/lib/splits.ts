import type { PhaseSplit } from "./cfop";

/**
 * Validation for phase splits that arrive from a browser.
 *
 * Kept out of `server/` so it can be unit tested: anything importing
 * `server-only` refuses to load outside a server bundle. It holds nothing
 * secret — it is the definition of what a split may look like.
 */

/**
 * Phase names this app writes: the analysis numbers its F2L pairs, and the
 * stopwatch's hand-marked laps call the whole stage "F2L". Anything else was not
 * written by either.
 */
const PHASE = /^(Cross|F2L(?: [1-4])?|OLL|PLL|Unfinished)$/;

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Splits that arrived with no stream to derive them from — hand-marked laps on
 * the stopwatch — reduced to the fields and ranges a real split can have.
 *
 * All or nothing. Keeping the valid half of a malformed list would store a
 * breakdown whose phases no longer add up to the solve.
 */
export function sanitizeSplits(value: unknown): PhaseSplit[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return [];
  const out: PhaseSplit[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return [];
    const s = raw as Record<string, unknown>;
    if (typeof s.phase !== "string" || !PHASE.test(s.phase)) return [];
    if (
      !finiteNonNegative(s.startMs) ||
      !finiteNonNegative(s.endMs) ||
      !finiteNonNegative(s.durationMs) ||
      !finiteNonNegative(s.moveCount) ||
      !finiteNonNegative(s.tps)
    ) {
      return [];
    }
    const split: PhaseSplit = {
      phase: s.phase,
      startMs: s.startMs,
      endMs: s.endMs,
      durationMs: s.durationMs,
      moveCount: Math.round(s.moveCount),
      tps: s.tps,
    };
    // Recognition is only meaningful from a stream, and a hand-marked lap has
    // none. Accepted when present and consistent; never invented when absent.
    if (finiteNonNegative(s.recognitionMs) && s.recognitionMs <= s.durationMs) {
      split.recognitionMs = s.recognitionMs;
    }
    out.push(split);
  }
  return out;
}
