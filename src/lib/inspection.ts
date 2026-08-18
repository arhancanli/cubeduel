import type { Penalty } from "./types";

/**
 * WCA inspection.
 *
 * A competitor gets fifteen seconds to look at the cube before starting. Go over
 * and it costs two seconds; go well over and the attempt is a DNF. The exact
 * thresholds are Regulation A4b1 and A4b2, and every serious cuber knows them
 * cold — which is why a platform issuing WCA-legal scrambles and calling itself
 * ranked looks unserious without them.
 *
 *     0.00 – 15.00   no penalty
 *    15.00 – 17.00   +2 seconds
 *          > 17.00   DNF
 *
 * There are also spoken warnings at 8 and 12 seconds, which this reproduces
 * visually. They are not decoration: a cuber who has competed is used to hearing
 * them and paces the last third of inspection around them.
 *
 * ## Why the server measures it
 *
 * Inspection has to be judged by the server, and that constrains the design more
 * than it first appears.
 *
 * A client-reported figure cannot work. The penalty only ever hurts, so there is
 * a standing incentive to under-report, and nothing in the move stream reveals
 * how long somebody stared at the cube beforehand.
 *
 * What the server does know is when it issued the scramble, and — from the move
 * timestamps — when the first turn happened. Inspection is the gap between them.
 * That makes it measurable from the server's own clock, and it makes the rule
 * faithful to the real one at the same time: in competition, inspection starts
 * the moment you are allowed to look at the cube, which here is the moment the
 * scramble is sent.
 */

/** Milliseconds of inspection allowed before any penalty. */
export const INSPECTION_LIMIT_MS = 15_000;

/** Past this, the attempt is a DNF rather than a +2. */
export const INSPECTION_DNF_MS = 17_000;

/** The spoken warnings, reproduced on screen. */
export const INSPECTION_WARNINGS_MS = [8000, 12_000] as const;

/**
 * Time allowed for the scramble to travel and paint before the clock is
 * considered fair.
 *
 * The server starts counting when it sends the scramble, but the player cannot
 * begin looking until it arrives and renders. That gap is not theirs, and on a
 * slow connection it is most of a second. Being generous here is deliberate:
 * a +2 nobody earned is far worse than a +2 somebody escaped, because the first
 * makes the whole ladder feel arbitrary and the second costs almost nothing.
 */
export const NETWORK_ALLOWANCE_MS = 1500;

export type InspectionVerdict = {
  /** Inspection actually used, after the network allowance. */
  inspectionMs: number;
  penalty: Penalty;
  /** Written for the player, empty when there is nothing to explain. */
  reason: string;
};

/**
 * Judges a single inspection.
 *
 * Takes the raw measured gap and returns what it costs. Nothing is rounded down
 * to be kind beyond the fixed allowance — the whole point of a rule is that it
 * applies the same way every time.
 */
export function judgeInspection(rawMs: number): InspectionVerdict {
  // A negative gap means the first turn arrived before the scramble did, which
  // is a clock disagreement rather than time travel. Treated as no inspection.
  const inspectionMs = Math.max(0, rawMs - NETWORK_ALLOWANCE_MS);

  if (inspectionMs > INSPECTION_DNF_MS) {
    return {
      inspectionMs,
      penalty: "DNF",
      reason: `Inspection ran to ${(inspectionMs / 1000).toFixed(2)}s. Over ${
        INSPECTION_DNF_MS / 1000
      } seconds is a DNF under WCA A4b2.`,
    };
  }

  if (inspectionMs > INSPECTION_LIMIT_MS) {
    return {
      inspectionMs,
      penalty: "PLUS2",
      reason: `Inspection ran to ${(inspectionMs / 1000).toFixed(2)}s. Over ${
        INSPECTION_LIMIT_MS / 1000
      } seconds is +2 under WCA A4b1.`,
    };
  }

  return { inspectionMs, penalty: "OK", reason: "" };
}

/**
 * Combines an inspection penalty with one the solve already carried.
 *
 * The two are independent — you can exceed inspection *and* pop the cube — and
 * the worse outcome governs. Two +2s do not become a +4: WCA penalties of the
 * same kind from different causes each apply, but this app only ever has one
 * source of each, so taking the more severe is both correct and simpler than
 * pretending to sum them.
 */
export function combinePenalties(solve: Penalty, inspection: Penalty): Penalty {
  if (solve === "DNF" || inspection === "DNF") return "DNF";
  if (solve === "PLUS2" || inspection === "PLUS2") return "PLUS2";
  return "OK";
}

/**
 * What to show during inspection: remaining time and which warnings have passed.
 *
 * Returned rather than rendered so the countdown can be tested without a browser
 * and so the same logic drives every screen that ever runs inspection.
 */
export interface InspectionState {
  remainingMs: number;
  /** 0 before eight seconds, 1 after, 2 after twelve. */
  warningsPassed: number;
  /** What this inspection would cost if the solve started now. */
  pendingPenalty: Penalty;
}

export function inspectionStateAt(elapsedMs: number): InspectionState {
  const warningsPassed = INSPECTION_WARNINGS_MS.filter((w) => elapsedMs >= w).length;
  const { penalty } = judgeInspection(elapsedMs + NETWORK_ALLOWANCE_MS);
  return {
    remainingMs: Math.max(0, INSPECTION_LIMIT_MS - elapsedMs),
    warningsPassed,
    pendingPenalty: penalty,
  };
}
