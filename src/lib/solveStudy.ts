import { analyzeSolve, derivePieceGroups, type SolveAnalysis, type TimedMove } from "./cfop";
import { buildCrossTable, crossRoute } from "./crossSolver";
import { loadKPuzzle, type Pattern } from "./cubeReplay";
import { isSkip } from "./lastLayer";
import { learnCases } from "./learn";
import { reviewMoves, type CaseReference, type CrossReference, type MoveReview } from "./moveReview";

/**
 * Everything a solve review needs, worked out from the turns alone.
 *
 * The analysis is re-run here rather than read from storage: a stored solve
 * keeps its splits but not which face the cross was built on, and the cross
 * comparison is only fair on that face. Running the same `analyzeSolve` the
 * server uses means the review and the ladder read a solve the same way.
 *
 * All of it runs in the browser. The cross table is 190,080 bytes built in a
 * few milliseconds, so a review needs no account, no network and no server.
 */

export interface SolveStudy {
  analysis: SolveAnalysis;
  review: MoveReview;
  cross: CrossReference | null;
}

const FACE_COLOUR: Record<string, string> = {
  U: "white",
  D: "yellow",
  F: "green",
  B: "blue",
  R: "red",
  L: "orange",
};

/** "yellow cross (on D)", as a cuber would say it. */
export function crossFaceLabel(face: string): string {
  const colour = FACE_COLOUR[face];
  return colour ? `${colour} cross (on ${face})` : `cross on ${face}`;
}

const tables = new Map<string, { table: Uint8Array; slots: number[] }>();

async function shortestCross(scramble: string, face: string): Promise<CrossReference | null> {
  const kpuzzle = await loadKPuzzle();
  const solved = kpuzzle.defaultPattern() as Pattern;
  let entry = tables.get(face);
  if (!entry) {
    const slots = derivePieceGroups(solved as never, face).crossEdges;
    entry = { table: buildCrossTable(solved as never, slots), slots };
    tables.set(face, entry);
  }
  const start = (scramble ? solved.applyAlg(scramble) : solved) as never;
  const route = crossRoute(entry.table, start, entry.slots);
  return { moves: route.length, solution: route.join(" "), face };
}

async function caseReference(stage: "OLL" | "PLL", caseId: string | null): Promise<CaseReference | null> {
  if (!caseId || isSkip(caseId)) return null;
  const match = (await learnCases()).find((c) => c.stage === stage && c.caseId === caseId);
  if (!match) return null;
  return {
    stage,
    label: match.label,
    name: match.name,
    slug: match.slug,
    moveCount: match.moveCount,
  };
}

export async function studySolve(
  scramble: string,
  moves: TimedMove[],
  durationMs: number,
): Promise<SolveStudy> {
  const analysis = await analyzeSolve(scramble, moves);
  const [cross, oll, pll] = await Promise.all([
    analysis.crossFace ? shortestCross(scramble, analysis.crossFace) : Promise.resolve(null),
    caseReference("OLL", analysis.ollCase),
    caseReference("PLL", analysis.pllCase),
  ]);
  const review = reviewMoves({ moves, splits: analysis.splits, durationMs, cross, oll, pll });
  return { analysis, review, cross };
}
