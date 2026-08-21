/**
 * Every last-layer case, with the algorithm that solves it.
 *
 * 57 OLL and 21 PLL, which is the whole of the last layer as the community
 * counts it. This is the content a learning space is made of: you cannot teach a
 * case you cannot name, show, or set up.
 *
 * ## Nothing here is trusted
 *
 * An algorithm in a cubing app is a claim, and a wrong one costs somebody weeks —
 * they drill it, it half-works, and they cannot tell whether the algorithm or
 * their execution is at fault. So none of these are believed on sight. Every
 * single one is checked by `lastLayerCases.test.ts` against the puzzle engine:
 * the inverse of the algorithm is applied to a solved cube to *produce* the case,
 * the algorithm is then applied to that, and the cube must come back solved in
 * place. An algorithm that does not solve its own case fails the build.
 *
 * The case ids are derived the same way rather than written down. `ollCaseId` and
 * `pllCaseId` reduce a state to its canonical signature, so the id for each case
 * here is computed from the algorithm — which means a typo cannot produce a case
 * that merely *looks* right, and two cases that collide are caught by the
 * distinctness check rather than by a confused cuber.
 *
 * ## Numbering
 *
 * OLL numbers are the community's own 1–57, deliberately. `lastLayer.ts` warns
 * against inventing indices, because "OLL 37" must mean the same thing here as in
 * every tutorial a cuber can find — and the way to honour that is to use the
 * standard numbering, not to avoid numbering entirely.
 *
 * A working algorithm filed under the wrong number is the one error the solve
 * check cannot catch, so the numbering is pinned structurally instead. Edge
 * orientation is a property of the case, not of the label: the seven cases where
 * all four last-layer edges are already oriented are exactly 21–27, and the eight
 * where none is oriented are exactly the dots, 1–4 and 17–20. Both are asserted
 * by deriving orientation from the algorithm, so a case shelved under a
 * neighbour's number fails.
 */

export interface OllCase {
  /** Community numbering, 1–57. */
  number: number;
  /** The recognised name, where the community has one. */
  name: string | null;
  alg: string;
}

export interface PllCase {
  /** PLL cases are lettered rather than numbered. */
  name: string;
  alg: string;
}

/**
 * The eight dot cases: no last-layer edge is oriented.
 * Used to pin the numbering, not to drive behaviour.
 */
export const OLL_DOT_CASES = [1, 2, 3, 4, 17, 18, 19, 20] as const;

/** The seven cases that arrive with the cross already made. */
export const OLL_CROSS_CASES = [21, 22, 23, 24, 25, 26, 27] as const;

export const OLL_CASES: OllCase[] = [
  { number: 1, name: "Runway", alg: "R U2 R2 F R F' U2 R' F R F'" },
  { number: 2, name: "Zamboni", alg: "F R U R' U' F' f R U R' U' f'" },
  { number: 3, name: "Anti-Nazi", alg: "f R U R' U' f' U' F R U R' U' F'" },
  { number: 4, name: "Nazi", alg: "f R U R' U' f' U F R U R' U' F'" },
  { number: 5, name: "Wario", alg: "r' U2 R U R' U r" },
  { number: 6, name: "Mario", alg: "r U2 R' U' R U' r'" },
  { number: 7, name: "Lightning", alg: "r U R' U R U2 r'" },
  { number: 8, name: "Reverse Lightning", alg: "r' U' R U' R' U2 r" },
  { number: 9, name: "Kite", alg: "R U R' U' R' F R2 U R' U' F'" },
  { number: 10, name: "Anti-Kite", alg: "R U R' U R' F R F' R U2 R'" },
  { number: 11, name: "Downstairs", alg: "r U R' U R' F R F' R U2 r'" },
  { number: 12, name: "Upstairs", alg: "M' R' U' R U' R' U2 R U' R r'" },
  { number: 13, name: "Gun", alg: "F U R U' R2 F' R U R U' R'" },
  { number: 14, name: "Anti-Gun", alg: "R' F R U R' F' R F U' F'" },
  { number: 15, name: "Squeegee", alg: "l' U' l L' U' L U l' U l" },
  { number: 16, name: "Anti-Squeegee", alg: "r U r' R U R' U' r U' r'" },
  { number: 17, name: "Slash", alg: "R U R' U R' F R F' U2 R' F R F'" },
  { number: 18, name: "Crown", alg: "r U R' U R U2 r2 U' R U' R' U2 r" },
  { number: 19, name: "Bunny", alg: "M U R U R' U' M' R' F R F'" },
  { number: 20, name: "Checkers", alg: "r U R' U' M2 U R U' R' U' M'" },
  { number: 21, name: "Double Sune", alg: "R U2 R' U' R U R' U' R U' R'" },
  { number: 22, name: "Pi", alg: "R U2 R2 U' R2 U' R2 U2 R" },
  { number: 23, name: "Headlights", alg: "R2 D' R U2 R' D R U2 R" },
  { number: 24, name: "Chameleon", alg: "r U R' U' r' F R F'" },
  { number: 25, name: "Bowtie", alg: "F' r U R' U' r' F R" },
  { number: 26, name: "Anti-Sune", alg: "R U2 R' U' R U' R'" },
  { number: 27, name: "Sune", alg: "R U R' U R U2 R'" },
  { number: 28, name: "Stealth", alg: "r U R' U' r' R U R U' R'" },
  { number: 29, name: "Awkward Fish", alg: "R U R' U' R U' R' F' U' F R U R'" },
  { number: 30, name: "Anti-Awkward Fish", alg: "F R' F R2 U' R' U' R U R' F2" },
  { number: 31, name: "Couch", alg: "R' U' F U R U' R' F' R" },
  { number: 32, name: "Anti-Couch", alg: "L U F' U' L' U L F L'" },
  { number: 33, name: "Key", alg: "R U R' U' R' F R F'" },
  { number: 34, name: "City", alg: "R U R2 U' R' F R U R U' F'" },
  { number: 35, name: "Fish Salad", alg: "R U2 R2 F R F' R U2 R'" },
  { number: 36, name: "Anti-Mounted Fish", alg: "L' U' L U' L' U L U L F' L' F" },
  { number: 37, name: "Mounted Fish", alg: "F R' F' R U R U' R'" },
  { number: 38, name: "Mario Bros", alg: "R U R' U R U' R' U' R' F R F'" },
  { number: 39, name: "Big Lightning", alg: "L F' L' U' L U F U' L'" },
  { number: 40, name: "Anti-Big Lightning", alg: "R' F R U R' U' F' U R" },
  { number: 41, name: "Awkward Shape", alg: "R U R' U R U2 R' F R U R' U' F'" },
  { number: 42, name: "Anti-Awkward Shape", alg: "R' U' R U' R' U2 R F R U R' U' F'" },
  { number: 43, name: "Anti-Fung", alg: "F' U' L' U L F" },
  { number: 44, name: "Fung", alg: "F U R U' R' F'" },
  { number: 45, name: "Suit Up", alg: "F R U R' U' F'" },
  { number: 46, name: "Seein' Headlights", alg: "R' U' R' F R F' U R" },
  { number: 47, name: "Breakneck", alg: "R' U' R' F R F' R' F R F' U R" },
  { number: 48, name: "Right Back Squeezy", alg: "F R U R' U' R U R' U' F'" },
  { number: 49, name: "Right Front Squeezy", alg: "r U' r2 U r2 U r2 U' r" },
  { number: 50, name: "Left Back Squeezy", alg: "r' U r2 U' r2 U' r2 U r'" },
  { number: 51, name: "Bottlecap", alg: "F U R U' R' U R U' R' F'" },
  { number: 52, name: "Rice Cooker", alg: "R U R' U R U' B U' B' R'" },
  { number: 53, name: "Frying Pan", alg: "r' U' R U' R' U R U' R' U2 r" },
  { number: 54, name: "Anti-Frying Pan", alg: "r U R' U R U' R' U R U2 r'" },
  { number: 55, name: "Highway", alg: "R U2 R2 U' R U' R' U2 F R F'" },
  { number: 56, name: "Streetlights", alg: "r U r' U R U' R' U R U' R' r U' r'" },
  { number: 57, name: "Mummy", alg: "R U R' U' M' U R U' r'" },
];

/**
 * PLL cases where only the corners move, only the edges move, or both.
 * These pin the letters the same way edge orientation pins the OLL numbers.
 */
export const PLL_CORNERS_ONLY = ["Aa", "Ab", "E"] as const;
export const PLL_EDGES_ONLY = ["Ua", "Ub", "H", "Z"] as const;

export const PLL_CASES: PllCase[] = [
  { name: "Aa", alg: "x L2 D2 L' U' L D2 L' U L' x'" },
  // The inverse of Aa, which is what Ab is. Derived rather than retyped: the
  // first version here had the rotation the wrong way round and quietly moved
  // an F2L pair.
  { name: "Ab", alg: "x L U' L D2 L' U L D2 L2 x'" },
  { name: "E", alg: "x' L' U L D' L' U' L D L' U' L D' L' U L D x" },
  { name: "F", alg: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R" },
  { name: "Ga", alg: "R2 U R' U R' U' R U' R2 U' D R' U R D'" },
  { name: "Gb", alg: "R' U' R U D' R2 U R' U R U' R U' R2 D" },
  { name: "Gc", alg: "R2 U' R U' R U R' U R2 U D' R U' R' D" },
  { name: "Gd", alg: "R U R' U' D R2 U' R U' R' U R' U R2 D'" },
  { name: "H", alg: "M2 U M2 U2 M2 U M2" },
  { name: "Ja", alg: "x R2 F R F' R U2 r' U r U2 x'" },
  { name: "Jb", alg: "R U R' F' R U R' U' R' F R2 U' R' U'" },
  { name: "Na", alg: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'" },
  { name: "Nb", alg: "R' U R U' R' F' U' F R U R' F R' F' R U' R" },
  { name: "Ra", alg: "R U' R' U' R U R D R' U' R D' R' U2 R' U'" },
  { name: "Rb", alg: "R' U2 R U2 R' F R U R' U' R' F' R2 U'" },
  { name: "T", alg: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { name: "Ua", alg: "R U' R U R U R U' R' U' R2" },
  { name: "Ub", alg: "R2 U R U R' U' R' U' R' U R'" },
  { name: "V", alg: "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2" },
  { name: "Y", alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
  { name: "Z", alg: "M2 U M2 U M' U2 M2 U2 M' U2" },
];
