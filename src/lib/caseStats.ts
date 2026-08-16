import { KNOWN_OLL, KNOWN_PLL } from "./lastLayer";
import { groupSplits } from "./phaseStats";
import type { StoredSolve } from "./solveHistory";

/**
 * Which specific last-layer cases to drill.
 *
 * The ranking is deliberately *not* "slowest case". A case you meet once a month
 * and fumble for four seconds costs you less than one you meet every third solve
 * and are half a second slow on. What matters is recoverable time: how often the
 * case comes up, multiplied by how much slower it is than your own typical case at
 * that stage.
 *
 * The reference point is the median of that cuber's own case means, so the target
 * is "be as good at this as you already are at most things" rather than a speed
 * pulled out of the air.
 */

export type Stage = "OLL" | "PLL";

/** Below this many sightings, a case's mean is one bad solve wearing a disguise. */
export const MIN_OCCURRENCES = 3;

export interface CaseAggregate {
  caseId: string;
  stage: Stage;
  n: number;
  meanMs: number;
  bestMs: number;
  /** Estimated time recoverable across the sample, in ms. Never negative. */
  excessMs: number;
  /** An algorithm that reproduces the case, for drawing it. */
  setupAlg: string | null;
  name: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface Sighting {
  ms: number;
  setup: string | null;
}

/**
 * Time spent on a stage within one solve, or null when that stage was not reached
 * or not measured.
 */
function stageDuration(solve: StoredSolve, stage: Stage): number | null {
  const totals = groupSplits(solve.splits);
  return totals.get(stage) ?? null;
}

export function aggregateCases(
  solves: readonly StoredSolve[],
  stage: Stage,
  nameTable: ReadonlyMap<string, string> = new Map(),
): CaseAggregate[] {
  const byCase = new Map<string, Sighting[]>();

  for (const solve of solves) {
    if (solve.penalty === "DNF") continue;
    const caseId = stage === "OLL" ? solve.ollCase : solve.pllCase;
    const setup = stage === "OLL" ? solve.ollSetup : solve.pllSetup;
    if (!caseId) continue;
    const ms = stageDuration(solve, stage);
    if (ms === null) continue;

    const list = byCase.get(caseId) ?? [];
    list.push({ ms, setup });
    byCase.set(caseId, list);
  }

  const entries = [...byCase.entries()]
    .map(([caseId, sightings]) => {
      const times = sightings.map((s) => s.ms);
      const meanMs = times.reduce((a, b) => a + b, 0) / times.length;
      return {
        caseId,
        stage,
        n: times.length,
        meanMs,
        bestMs: Math.min(...times),
        excessMs: 0,
        setupAlg: sightings.find((s) => s.setup)?.setup ?? null,
        name: nameTable.get(caseId) ?? null,
      } satisfies CaseAggregate;
    })
    .filter((c) => c.n >= MIN_OCCURRENCES);

  // The reference is drawn only from cases that cleared the sighting threshold, so
  // one lucky single-sample case cannot drag it down and inflate everything else.
  const reference = median(entries.map((c) => c.meanMs));
  for (const entry of entries) {
    entry.excessMs = Math.max(0, (entry.meanMs - reference) * entry.n);
  }

  return entries.sort((a, b) => b.excessMs - a.excessMs);
}

/**
 * Signature → name, generated from the algorithms rather than hand-written, so a
 * name can only ever attach to the case its own algorithm solves.
 */
export async function buildNameTable(): Promise<Map<string, string>> {
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

  const table = new Map<string, string>();
  for (const known of KNOWN_OLL) {
    const pattern = known.alg ? solved.applyAlg(invert(known.alg)) : solved;
    table.set(ollCaseId(pattern), known.name);
  }
  for (const known of KNOWN_PLL) {
    const pattern = known.alg ? solved.applyAlg(invert(known.alg)) : solved;
    table.set(pllCaseId(pattern), known.name);
  }
  return table;
}
