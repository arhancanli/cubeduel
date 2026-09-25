import { loadKPuzzle, type Pattern } from "./cubeReplay";
import { LL_SLOTS, ollCaseId, pllCaseId } from "./lastLayer";
import { OLL_CASES, PLL_CASES } from "./lastLayerCases";

/**
 * The last layer, arranged for learning rather than for measurement.
 *
 * `lastLayer.ts` answers "which case was that?" for a solve that already
 * happened. This answers the question a learner asks: *show me the cases, tell me
 * which ones look alike, and set one up so I can try it.*
 *
 * ## Shape is derived, never written down
 *
 * Cubers sort OLL by the shape the oriented edges make — dot, L, line, cross —
 * because that is the thing you actually see when the last layer arrives. That
 * shape is a fact about the case, computable from its algorithm, so it is
 * computed. A grouping typed in by hand is a grouping that drifts from the
 * algorithms beside it, and the first anybody knows about it is a learner drilling
 * a case filed under the wrong shape.
 */

export type OllShape = "Dot" | "L-shape" | "Line" | "Cross";

export interface LearnCase {
  /** Stable, human-readable, and safe in a URL: "oll-27", "pll-t". */
  slug: string;
  stage: "OLL" | "PLL";
  /** "OLL 27" or "PLL T". */
  label: string;
  name: string | null;
  alg: string;
  /**
   * The moves that put a solved cube into this case — the algorithm's inverse.
   * This is what a trainer applies, and what a diagram is drawn from.
   */
  setup: string;
  /** Canonical signature, so a solve can be matched back to what was practised. */
  caseId: string;
  /** OLL only. The shape the oriented edges make. */
  shape: OllShape | null;
  moveCount: number;
}

/**
 * How the cube is held to show or drill a last-layer case: turned over, yellow
 * on top and green still in front — the way nearly everybody meets these cases,
 * with the white cross underneath. Every case is built with white on top, so
 * the hold goes first and the case is set up on the yellow face.
 */
export const LAST_LAYER_HOLD = "z2";

export function holdForLastLayer(setup: string): string {
  return setup ? `${LAST_LAYER_HOLD} ${setup}` : LAST_LAYER_HOLD;
}

export function invertAlg(alg: string): string {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((move) =>
      move.endsWith("2") ? move : move.endsWith("'") ? move.slice(0, -1) : `${move}'`,
    )
    .join(" ");
}

/** How many turns the algorithm is, ignoring cube rotations — those are free. */
export function turnCount(alg: string): number {
  return alg.split(/\s+/).filter((m) => m && !/^[xyz]/.test(m)).length;
}

function slugify(stage: "OLL" | "PLL", key: string): string {
  return `${stage.toLowerCase()}-${key.toLowerCase()}`;
}

/**
 * The shape the oriented edges make, as a cuber sees it.
 *
 * Two oriented edges opposite each other is a line; two beside each other is an
 * L. That is the whole of the first-glance classification, and it falls straight
 * out of which slots are oriented.
 */
function shapeOf(pattern: Pattern): OllShape {
  const oriented = LL_SLOTS.filter(
    (i) => pattern.patternData.EDGES.orientation[i] === 0,
  );
  if (oriented.length === 4) return "Cross";
  if (oriented.length === 0) return "Dot";
  // Exactly two, by the arithmetic of the cube: flips must cancel.
  const gap = Math.abs(oriented[0] - oriented[1]);
  return gap === 2 ? "Line" : "L-shape";
}

let cache: LearnCase[] | null = null;

/**
 * Every case, with everything a lesson needs. Computed once.
 *
 * Async because it needs the puzzle engine to derive the case states, and cached
 * because that derivation is the same 78 answers every time.
 */
export async function learnCases(): Promise<LearnCase[]> {
  if (cache) return cache;

  const kpuzzle = await loadKPuzzle();
  const built: LearnCase[] = [];

  for (const c of OLL_CASES) {
    const setup = invertAlg(c.alg);
    const pattern = kpuzzle.defaultPattern().applyAlg(setup) as Pattern;
    built.push({
      slug: slugify("OLL", String(c.number)),
      stage: "OLL",
      label: `OLL ${c.number}`,
      name: c.name,
      alg: c.alg,
      setup,
      caseId: ollCaseId(pattern),
      shape: shapeOf(pattern),
      moveCount: turnCount(c.alg),
    });
  }

  for (const c of PLL_CASES) {
    const setup = invertAlg(c.alg);
    const pattern = kpuzzle.defaultPattern().applyAlg(setup) as Pattern;
    built.push({
      slug: slugify("PLL", c.name),
      stage: "PLL",
      label: `PLL ${c.name}`,
      name: c.name,
      alg: c.alg,
      setup,
      caseId: pllCaseId(pattern),
      shape: null,
      moveCount: turnCount(c.alg),
    });
  }

  cache = built;
  return built;
}

export async function learnCase(slug: string): Promise<LearnCase | null> {
  const all = await learnCases();
  return all.find((c) => c.slug === slug) ?? null;
}

/** OLL grouped by what a learner sees first: the shape on top. */
export const SHAPE_ORDER: OllShape[] = ["Cross", "Line", "L-shape", "Dot"];
