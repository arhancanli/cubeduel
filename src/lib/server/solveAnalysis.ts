import "server-only";

import { analyzeSolve, type PhaseSplit, type TimedMove } from "../cfop";
import type { EventId } from "../events";

/**
 * The phase breakdown of a stored solve, worked out here rather than believed.
 *
 * Every route that stores a solve used to write the `splits`, `oll_case` and
 * `pll_case` the browser sent, unexamined — including ranked, where the move
 * stream beside them had just been replayed and verified. So a verified solve's
 * public page could say "verified" above a breakdown the server had never
 * checked, and the field accepted any JSON a client cared to put in it. The
 * whole proposition of this site is that the numbers on a solve are ones the
 * server can stand behind; that has to include where the time went.
 *
 * The analysis is the same function the browser runs, on the same stream, so an
 * honest client loses nothing — the result is identical. It is 3x3 only, because
 * CFOP is: a 2x2 or 4x4 solve replayed as if it were a 3x3 produces phases that
 * look like analysis and mean nothing, so those store no breakdown at all.
 */
export interface StoredAnalysis {
  splits: PhaseSplit[];
  ollCase: string | null;
  pllCase: string | null;
}

const NONE: StoredAnalysis = { splits: [], ollCase: null, pllCase: null };

export async function analysisFromStream(
  event: EventId | string,
  scramble: string,
  moves: readonly TimedMove[],
): Promise<StoredAnalysis> {
  if (event !== "333" || moves.length === 0) return NONE;
  try {
    const analysis = await analyzeSolve(scramble, moves);
    return { splits: analysis.splits, ollCase: analysis.ollCase, pllCase: analysis.pllCase };
  } catch {
    // A stream that cannot be split is still a solve; it just has no breakdown.
    return NONE;
  }
}
