import { CORNER_COUNT, EDGE_COUNT, type CubieCube } from "./cube";

/**
 * Coordinates: the compression that makes searching a 4.3×10^19 state space
 * finish in milliseconds.
 *
 * The cube has about 43 quintillion states, so nothing can be searched directly.
 * The two-phase method works by throwing information away — twice, in a specific
 * order.
 *
 * **Phase one** only cares whether the cube has reached the subgroup
 * G1 = ⟨U, D, R2, L2, F2, B2⟩: every corner untwisted, every edge unflipped, and
 * the four middle-slice edges somewhere in the middle slice. Nothing else about
 * the position matters yet. That is three small numbers instead of a cube:
 *
 *     corner orientation   3^7  = 2,187      (the eighth follows: they sum to 0 mod 3)
 *     edge orientation     2^11 = 2,048      (the twelfth follows: they sum to 0 mod 2)
 *     middle-slice edges   C(12,4) = 495     (which slots, not which order)
 *
 * **Phase two** may then only use G1 moves, which cannot break what phase one
 * achieved. Inside that subgroup the remaining freedom is again three numbers:
 *
 *     corner permutation   8!  = 40,320
 *     U/D edge permutation 8!  = 40,320
 *     slice permutation    4!  = 24
 *
 * The essential property of a coordinate is that a move takes it to a new value
 * that depends **only on the old value and the move** — never on the discarded
 * information. That is what lets a move become a table lookup, and it is worth
 * checking rather than assuming: `coords.test.ts` asserts it directly for every
 * coordinate and every move.
 */

export const TWIST_COUNT = 2187; // 3^7
export const FLIP_COUNT = 2048; // 2^11
export const SLICE_COUNT = 495; // C(12,4)
export const CORNER_PERM_COUNT = 40320; // 8!
export const EDGE8_PERM_COUNT = 40320; // 8!
export const SLICE_PERM_COUNT = 24; // 4!

/** Edge slots 8..11 hold the middle-slice edges FR, FL, BL, BR when solved. */
const SLICE_START = 8;

const BINOMIAL: number[][] = (() => {
  const table: number[][] = [];
  for (let n = 0; n <= 12; n++) {
    table[n] = [];
    for (let k = 0; k <= 4; k++) {
      table[n][k] = k === 0 ? 1 : n === 0 ? 0 : table[n - 1][k - 1] + table[n - 1][k];
    }
  }
  return table;
})();

function choose(n: number, k: number): number {
  if (k < 0 || k > 4 || n < 0 || n > 12) return 0;
  return BINOMIAL[n][k];
}

// ---------------------------------------------------------------------------
// Corner orientation
// ---------------------------------------------------------------------------

export function getTwist(cube: CubieCube): number {
  let n = 0;
  // Only seven are stored. The eighth is forced by the invariant, so including
  // it would double the table for no information.
  for (let i = 0; i < CORNER_COUNT - 1; i++) n = n * 3 + cube.co[i];
  return n;
}

export function setTwist(cube: CubieCube, index: number): void {
  let total = 0;
  for (let i = CORNER_COUNT - 2; i >= 0; i--) {
    const digit = index % 3;
    index = (index - digit) / 3;
    cube.co[i] = digit;
    total += digit;
  }
  cube.co[CORNER_COUNT - 1] = (3 - (total % 3)) % 3;
}

// ---------------------------------------------------------------------------
// Edge orientation
// ---------------------------------------------------------------------------

export function getFlip(cube: CubieCube): number {
  let n = 0;
  for (let i = 0; i < EDGE_COUNT - 1; i++) n = n * 2 + cube.eo[i];
  return n;
}

export function setFlip(cube: CubieCube, index: number): void {
  let total = 0;
  for (let i = EDGE_COUNT - 2; i >= 0; i--) {
    const digit = index % 2;
    index = (index - digit) / 2;
    cube.eo[i] = digit;
    total += digit;
  }
  cube.eo[EDGE_COUNT - 1] = total % 2;
}

// ---------------------------------------------------------------------------
// Middle-slice edge positions (unordered)
// ---------------------------------------------------------------------------

/**
 * Which four slots hold the middle-slice edges, ignoring their order.
 *
 * Order is deliberately discarded: phase one's goal is to get those edges *into*
 * the slice, and sorting them out is phase two's job. Tracking order here would
 * multiply the table by 24 for information phase one never uses.
 */
export function getSlice(cube: CubieCube): number {
  let index = 0;
  let seen = 0;
  for (let j = EDGE_COUNT - 1; j >= 0; j--) {
    if (cube.ep[j] >= SLICE_START) {
      index += choose(EDGE_COUNT - 1 - j, seen + 1);
      seen++;
    }
  }
  return index;
}

export function setSlice(cube: CubieCube, index: number): void {
  // Reconstruct which four slots are occupied, then fill: slice edges into those
  // slots, the rest anywhere. Only occupancy affects the coordinate, so any
  // consistent filling is a valid representative of this class.
  const occupied = new Array<boolean>(EDGE_COUNT).fill(false);
  let remaining = 4;
  let value = index;

  // Ascending, with the binomial term shrinking as slots are claimed.
  //
  // `getSlice` scans downward and weights the n-th slice edge it meets by
  // C(11-j, n). Inverting that means meeting them in the opposite order, so the
  // largest term comes first — a descending scan here looks symmetrical and is
  // simply not the inverse, which showed up as a coordinate that would not
  // round-trip.
  for (let j = 0; j < EDGE_COUNT && remaining > 0; j++) {
    const c = choose(EDGE_COUNT - 1 - j, remaining);
    if (value >= c) {
      value -= c;
      occupied[j] = true;
      remaining--;
    }
  }

  let sliceEdge = SLICE_START;
  let otherEdge = 0;
  for (let j = 0; j < EDGE_COUNT; j++) {
    if (occupied[j]) {
      cube.ep[j] = sliceEdge++;
    } else {
      cube.ep[j] = otherEdge++;
    }
  }
}

// ---------------------------------------------------------------------------
// Permutations, by Lehmer code
// ---------------------------------------------------------------------------

/**
 * `index` and `fromIndex` are exact inverses, which is the only property that
 * matters — the particular numbering scheme is arbitrary as long as it is
 * consistent, and the tests check the round trip over every value.
 */
function permutationIndex(perm: number[]): number {
  const n = perm.length;
  let index = 0;
  for (let i = 0; i < n - 1; i++) {
    index *= n - i;
    for (let j = i + 1; j < n; j++) if (perm[j] < perm[i]) index++;
  }
  return index;
}

function permutationFromIndex(index: number, n: number): number[] {
  const digits = new Array<number>(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    digits[i] = index % (n - i);
    index = (index - digits[i]) / (n - i);
  }
  const available = Array.from({ length: n }, (_, i) => i);
  return digits.map((d) => available.splice(d, 1)[0]);
}

export function getCornerPerm(cube: CubieCube): number {
  return permutationIndex(Array.from(cube.cp));
}

export function setCornerPerm(cube: CubieCube, index: number): void {
  const perm = permutationFromIndex(index, CORNER_COUNT);
  for (let i = 0; i < CORNER_COUNT; i++) cube.cp[i] = perm[i];
}

/**
 * The eight U- and D-layer edges.
 *
 * Well defined only inside G1, and that is exactly where it is used: the G1
 * moves (U, D and the four double turns) never move a U/D edge into the middle
 * slice or the reverse, so the two groups of edges stay separate and each has a
 * permutation of its own.
 */
export function getEdge8Perm(cube: CubieCube): number {
  return permutationIndex(Array.from(cube.ep.slice(0, 8)));
}

export function setEdge8Perm(cube: CubieCube, index: number): void {
  const perm = permutationFromIndex(index, 8);
  for (let i = 0; i < 8; i++) cube.ep[i] = perm[i];
}

export function getSlicePerm(cube: CubieCube): number {
  const perm = Array.from(cube.ep.slice(SLICE_START, EDGE_COUNT)).map(
    (piece) => piece - SLICE_START,
  );
  return permutationIndex(perm);
}

export function setSlicePerm(cube: CubieCube, index: number): void {
  const perm = permutationFromIndex(index, 4);
  for (let i = 0; i < 4; i++) cube.ep[SLICE_START + i] = perm[i] + SLICE_START;
}

/** True when the cube is in G1 — the state phase one is trying to reach. */
export function isInG1(cube: CubieCube): boolean {
  return getTwist(cube) === 0 && getFlip(cube) === 0 && getSlice(cube) === 0;
}
