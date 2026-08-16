/**
 * Identifying *which* last-layer case a cuber faced.
 *
 * "OLL is slow" is a stage. "These four OLL cases are slow" is a practice session.
 * Getting from one to the other means recognising the specific case at the moment
 * the phase began.
 *
 * The equivalence relations here are not guessed — they are pinned to a known
 * ground truth. Canonicalising OLL under U rotation alone must yield exactly 58
 * classes (the 57 cases plus the skip); canonicalising PLL under rotation *and*
 * AUF must yield exactly 22 (21 plus the skip). Both counts are asserted by
 * enumeration in the tests, so a wrong relation fails loudly instead of silently
 * merging or splitting cases.
 *
 * Cases are deliberately NOT numbered. The community's OLL numbering is a fixed
 * convention, and inventing our own indices would show a cuber "OLL 37" meaning
 * something different from the OLL 37 in every tutorial they can find. Cases are
 * identified by signature, shown visually, and named only where the name is certain.
 */

/** The four last-layer slots, in both orbits, as derived from the puzzle. */
export const LL_SLOTS = [0, 1, 2, 3] as const;

interface OrbitData {
  pieces: number[];
  orientation: number[];
}

export interface PatternLike {
  patternData: Record<string, OrbitData>;
}

function rotate<T>(values: T[], by: number): T[] {
  return values.map((_, i) => values[(i + by) % values.length]);
}

/**
 * A U turn cycles the last-layer slots without changing any piece's orientation
 * value, so rotating the frame is exactly a cyclic shift of these arrays.
 */
function canonicalOrientation(co: number[], eo: number[]): string {
  let best: string | null = null;
  for (let k = 0; k < 4; k++) {
    const candidate = `${rotate(co, k).join("")}|${rotate(eo, k).join("")}`;
    if (best === null || candidate < best) best = candidate;
  }
  return best!;
}

/**
 * PLL additionally quotients by AUF: turning the U layer before or after the
 * algorithm does not change which case it is. Rotating the frame shifts the slots;
 * an AUF shifts which piece counts as "home", which is the `+ m` here.
 */
function canonicalPermutation(cp: number[], ep: number[]): string {
  let best: string | null = null;
  for (let k = 0; k < 4; k++) {
    for (let m = 0; m < 4; m++) {
      const corners = rotate(cp, k).map((v) => (v + m) % 4);
      const edges = rotate(ep, k).map((v) => (v + m) % 4);
      const candidate = `${corners.join("")}|${edges.join("")}`;
      if (best === null || candidate < best) best = candidate;
    }
  }
  return best!;
}

/** Orientation signature of the last layer — the OLL case. */
export function ollCaseId(pattern: PatternLike): string {
  const co = LL_SLOTS.map((i) => pattern.patternData.CORNERS.orientation[i]);
  const eo = LL_SLOTS.map((i) => pattern.patternData.EDGES.orientation[i]);
  return canonicalOrientation(co, eo);
}

/**
 * Permutation signature of the last layer — the PLL case.
 *
 * Piece numbers are normalised so a solved last layer reads as `0123|0123`
 * regardless of which physical pieces sit in it, which is what makes the same case
 * from two different solves compare equal.
 */
export function pllCaseId(pattern: PatternLike): string {
  const cp = LL_SLOTS.map((i) => pattern.patternData.CORNERS.pieces[i] % 4);
  const ep = LL_SLOTS.map((i) => pattern.patternData.EDGES.pieces[i] % 4);
  return canonicalPermutation(cp, ep);
}

/** Canonical id of an already-solved last layer, i.e. a skip. */
export const OLL_SKIP = canonicalOrientation([0, 0, 0, 0], [0, 0, 0, 0]);
export const PLL_SKIP = canonicalPermutation([0, 1, 2, 3], [0, 1, 2, 3]);

export function isSkip(caseId: string): boolean {
  return caseId === OLL_SKIP || caseId === PLL_SKIP;
}

/**
 * Names only where they are certain.
 *
 * A coach that confidently mislabels a case is worse than one that shows the case
 * and says nothing — the cuber goes and learns the wrong algorithm. These are
 * generated from their algorithms and checked in the tests; every other case is
 * shown visually and left unnamed.
 */
export interface NamedCase {
  name: string;
  /** Algorithm that solves the case, used to generate and verify its signature. */
  alg: string;
}

export const KNOWN_OLL: NamedCase[] = [
  { name: "Sune", alg: "R U R' U R U2 R'" },
  { name: "Anti-Sune", alg: "R U2 R' U' R U' R'" },
  { name: "Cross (solved)", alg: "" },
];

export const KNOWN_PLL: NamedCase[] = [
  { name: "T-perm", alg: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { name: "Y-perm", alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
  { name: "Ua-perm", alg: "R U' R U R U R U' R' U' R2" },
  { name: "H-perm", alg: "M2 U M2 U2 M2 U M2" },
  { name: "Solved", alg: "" },
];

/**
 * Human label for a case, or null when it is not one of the certain ones.
 * `nameTable` is built at runtime from the algorithms above.
 */
export function caseName(
  caseId: string,
  nameTable: ReadonlyMap<string, string>,
): string | null {
  return nameTable.get(caseId) ?? null;
}
