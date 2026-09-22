import { CORNER_COUNT, EDGE_COUNT, solvedCube, type CubieCube } from "./cube";
import { FLIP_COUNT, SLICE_COUNT, TWIST_COUNT, getFlip, getSlice, getTwist, setFlip, setSlice, setTwist } from "./coords";
import { UD_SYMMETRY_MAPS, cubeOfMotion, invertFaceMap, multiplyFull } from "./geometry";

/**
 * The exact phase-one distance, for every phase-one position.
 *
 * ## Why this exists
 *
 * The pair tables in `tables.ts` are projections: each knows two of phase one's
 * three coordinates and is blind to the third, so each underestimates, and the
 * deeper the search the more it underestimates. Measured on the server's
 * settings, 86% of the time went to phase one — 773 million search nodes across
 * sixty cubes against 38 million in phase two. The bound was the bottleneck, not
 * the code.
 *
 * This table knows all three at once, so its number is not a bound but the
 * answer: exactly how many moves that position needs to reach G1. A branch is
 * cut the moment it cannot finish, and nothing is explored that could not have
 * led anywhere.
 *
 * ## Why it fits
 *
 * All three coordinates together are 2,187 × 2,048 × 495 ≈ 2.2 billion
 * positions, which is too many. But the cube does not care which way up it is:
 * sixteen symmetries leave the U-D axis — and therefore phase one's goal —
 * alone, and positions related by one of them need the same number of moves. So
 * only one position per symmetry class is stored. The 1,013,760 (flip, slice)
 * pairs fall into **64,430** classes, and 64,430 × 2,187 ≈ 141 million entries
 * fit in 67MB at four bits each.
 *
 * Every lookup is then two steps: which class this position's (flip, slice)
 * belongs to and which symmetry takes it there, then the corner twist seen
 * through that same symmetry.
 *
 * The symmetries themselves come from `geometry.ts`, derived from the shape of
 * the cube rather than transcribed — including the mirror, which is what makes
 * sixteen classes instead of eight and halves this table.
 */

/** (flip, slice) pairs: the phase-one edge state, before symmetry. */
export const FLIPSLICE_COUNT = FLIP_COUNT * SLICE_COUNT;

/** How many symmetries leave the U-D axis alone. */
export const UD_SYMMETRY_COUNT = 16;

/**
 * Symmetry classes of (flip, slice). Not a number anyone should type in: the
 * builder counts them and this is what it must find, which `phase1Table.test.ts`
 * checks. Kociemba's published figure for the same quotient is the same 64,430.
 */
export const PHASE1_CLASS_COUNT = 64430;

export const PHASE1_TABLE_SIZE = PHASE1_CLASS_COUNT * TWIST_COUNT;

/** Value of an entry the fill has not reached. Four bits, so 15 is free. */
const UNKNOWN = 15;

export interface Phase1Symmetry {
  /** For each (flip, slice) pair, which symmetry class it belongs to. */
  classIndex: Uint16Array;
  /** For each pair, a symmetry carrying it to that class's representative. */
  classSym: Uint8Array;
  /** Each class's representative, as a (flip, slice) pair. */
  classRep: Int32Array;
  /**
   * For each class, the symmetries that fix its representative, as a bit per
   * symmetry.
   *
   * Most classes have only the identity. The ones that do not are why filling
   * this table is not quite a plain breadth-first search: for a representative
   * fixed by some symmetry, two different corner twists describe the same
   * position, and a fill that set only one of them would leave the other
   * looking unreachable — which, being a *lower* bound read as truth, would
   * make the search prune away real solutions.
   */
  classStabilizers: Uint16Array;
  /** Corner twist seen through each symmetry: `twistConj[twist * 16 + sym]`. */
  twistConj: Uint16Array;
}

/**
 * What a lookup needs: the class of each (flip, slice) pair, the symmetry that
 * takes it there, the corner twist through each symmetry, and the distances.
 *
 * A subset of what building the table produces — the representatives and their
 * stabilisers are needed only to fill it, so they are not carried around after.
 */
export interface Phase1Lookup {
  classIndex: Uint16Array;
  classSym: Uint8Array;
  twistConj: Uint16Array;
  /** Two entries per byte, low nibble first. Read with `phase1DistanceAt`. */
  distances: Uint8Array;
}

/**
 * How many moves this phase-one position needs to reach G1. Exactly, not at
 * least: the whole point of the table.
 */
export function phase1Distance(
  lookup: Phase1Lookup,
  twist: number,
  flip: number,
  slice: number,
): number {
  const pair = slice * FLIP_COUNT + flip;
  const index = lookup.classIndex[pair] * TWIST_COUNT
    + lookup.twistConj[twist * UD_SYMMETRY_COUNT + lookup.classSym[pair]];
  const byte = lookup.distances[index >> 1];
  return index & 1 ? byte >> 4 : byte & 15;
}

function emptyCube(): CubieCube {
  return {
    cp: new Uint8Array(CORNER_COUNT),
    co: new Uint8Array(CORNER_COUNT),
    ep: new Uint8Array(EDGE_COUNT),
    eo: new Uint8Array(EDGE_COUNT),
  };
}

/** The sixteen symmetries as cubie states, with their inverses beside them. */
export function udSymmetryCubes(): { cubes: CubieCube[]; inverses: CubieCube[]; inverseIndex: number[] } {
  const cubes = UD_SYMMETRY_MAPS.map(cubeOfMotion);
  const inverses = UD_SYMMETRY_MAPS.map((map) => cubeOfMotion(invertFaceMap(map)));
  const key = (c: CubieCube) => `${c.cp}|${c.co}|${c.ep}|${c.eo}`;
  const byKey = new Map(cubes.map((c, i) => [key(c), i]));
  const inverseIndex = inverses.map((c) => {
    const found = byKey.get(key(c));
    if (found === undefined) throw new Error("the U-D symmetries are not closed under inverses");
    return found;
  });
  return { cubes, inverses, inverseIndex };
}

/**
 * Works out the symmetry classes.
 *
 * One pass over every (flip, slice) pair: the first pair not yet in a class
 * becomes a new class's representative, and every symmetry of it that lands on a
 * pair with no class yet puts that pair in this one, remembering the symmetry
 * that goes back.
 */
export function buildPhase1Symmetry(): Phase1Symmetry {
  const { cubes, inverses, inverseIndex } = udSymmetryCubes();

  const classIndex = new Uint16Array(FLIPSLICE_COUNT);
  const classSym = new Uint8Array(FLIPSLICE_COUNT);
  const classRep = new Int32Array(PHASE1_CLASS_COUNT);
  const classStabilizers = new Uint16Array(PHASE1_CLASS_COUNT);
  const assigned = new Uint8Array(FLIPSLICE_COUNT);

  const state = emptyCube();
  const scratch = emptyCube();
  const conjugated = emptyCube();

  /** `sym⁻¹ · cube · sym`, written into `conjugated`. */
  const conjugate = (cube: CubieCube, sym: number) => {
    multiplyFull(inverses[sym], cube, scratch);
    multiplyFull(scratch, cubes[sym], conjugated);
  };

  let classes = 0;
  for (let pair = 0; pair < FLIPSLICE_COUNT; pair++) {
    if (assigned[pair]) continue;

    const index = classes++;
    if (index >= PHASE1_CLASS_COUNT) {
      throw new Error(`more than ${PHASE1_CLASS_COUNT} symmetry classes`);
    }
    classRep[index] = pair;

    // A representative is built as a cube whose flip and slice are this pair's
    // and whose everything else is arbitrary — exactly what the coordinates say
    // is irrelevant. The corner part is untouched: only edges matter here.
    setFlip(state, pair % FLIP_COUNT);
    setSlice(state, (pair / FLIP_COUNT) | 0);

    let stabilizer = 0;
    for (let sym = 0; sym < UD_SYMMETRY_COUNT; sym++) {
      conjugate(state, sym);
      const image = getSlice(conjugated) * FLIP_COUNT + getFlip(conjugated);

      if (image === pair) stabilizer |= 1 << sym;
      if (assigned[image]) continue;

      assigned[image] = 1;
      classIndex[image] = index;
      // The symmetry that carries the image BACK to the representative.
      classSym[image] = inverseIndex[sym];
    }
    classStabilizers[index] = stabilizer;
  }

  if (classes !== PHASE1_CLASS_COUNT) {
    throw new Error(`expected ${PHASE1_CLASS_COUNT} symmetry classes, found ${classes}`);
  }

  const twistConj = new Uint16Array(TWIST_COUNT * UD_SYMMETRY_COUNT);
  const corners = emptyCube();
  for (let twist = 0; twist < TWIST_COUNT; twist++) {
    // Same idea: a cube that has this twist and nothing else meaningful.
    corners.cp.set(solvedCube().cp);
    corners.ep.set(solvedCube().ep);
    corners.eo.fill(0);
    setTwist(corners, twist);
    for (let sym = 0; sym < UD_SYMMETRY_COUNT; sym++) {
      conjugate(corners, sym);
      twistConj[twist * UD_SYMMETRY_COUNT + sym] = getTwist(conjugated);
    }
  }

  return { classIndex, classSym, classRep, classStabilizers, twistConj };
}

/** Reads entry `index` out of the packed four-bit table. */
export function phase1DistanceAt(table: Uint8Array, index: number): number {
  const byte = table[index >> 1];
  return index & 1 ? byte >> 4 : byte & 15;
}

function setDistance(table: Uint8Array, index: number, value: number): void {
  const at = index >> 1;
  table[at] = index & 1 ? (table[at] & 0x0f) | (value << 4) : (table[at] & 0xf0) | value;
}

export interface Phase1MoveTables {
  twistMove: Int32Array;
  flipMove: Int32Array;
  sliceMove: Int32Array;
  moveCount: number;
}

/**
 * Fills the table: how many moves each position needs to reach G1.
 *
 * Breadth-first from the solved position, but scanned rather than queued — a
 * queue of 141 million indices would cost more memory than the table it fills.
 * Each pass walks the whole table once. While the frontier is the smaller side
 * it expands forwards, from known positions to their neighbours; once most of
 * the table is known it turns around and asks each unknown position whether any
 * neighbour is one move nearer, which at the last depths is far less work.
 *
 * Distances are the same in both directions here, because every move has an
 * inverse that is also a move.
 */
export function buildPhase1Distances(
  moves: Phase1MoveTables,
  symmetry: Phase1Symmetry,
  onProgress?: (depth: number, filled: number) => void,
): Uint8Array {
  const { classIndex, classSym, classRep, classStabilizers, twistConj } = symmetry;
  const { twistMove, flipMove, sliceMove, moveCount } = moves;

  const table = new Uint8Array(PHASE1_TABLE_SIZE >> 1).fill(0xff);

  // Where each class's representative sits and where each move takes it: the
  // class it lands in, and the symmetry that takes it back to that class's own
  // representative. Precomputed per class so the inner loop over 2,187 twists
  // does not repeat it.
  const moveClass = new Uint16Array(PHASE1_CLASS_COUNT * moveCount);
  const moveSym = new Uint8Array(PHASE1_CLASS_COUNT * moveCount);
  for (let index = 0; index < PHASE1_CLASS_COUNT; index++) {
    const pair = classRep[index];
    const flip = pair % FLIP_COUNT;
    const slice = (pair / FLIP_COUNT) | 0;
    for (let m = 0; m < moveCount; m++) {
      const image = sliceMove[slice * moveCount + m] * FLIP_COUNT + flipMove[flip * moveCount + m];
      moveClass[index * moveCount + m] = classIndex[image];
      moveSym[index * moveCount + m] = classSym[image];
    }
  }

  setDistance(table, 0, 0);
  let filled = 1;
  let frontier = 1;

  for (let depth = 0; filled < PHASE1_TABLE_SIZE; depth++) {
    const forward = frontier < PHASE1_TABLE_SIZE - filled;
    let added = 0;

    for (let cls = 0; cls < PHASE1_CLASS_COUNT; cls++) {
      const base = cls * TWIST_COUNT;
      const moveBase = cls * moveCount;
      const stabilizer = classStabilizers[cls];

      for (let twist = 0; twist < TWIST_COUNT; twist++) {
        const index = base + twist;
        const here = phase1DistanceAt(table, index);

        if (forward) {
          if (here !== depth) continue;
        } else if (here !== UNKNOWN) {
          continue;
        }

        const twistRow = twist * moveCount;
        for (let m = 0; m < moveCount; m++) {
          const neighbourClass = moveClass[moveBase + m];
          const neighbourTwist =
            twistConj[twistMove[twistRow + m] * UD_SYMMETRY_COUNT + moveSym[moveBase + m]];
          const neighbour = neighbourClass * TWIST_COUNT + neighbourTwist;

          if (forward) {
            if (phase1DistanceAt(table, neighbour) !== UNKNOWN) continue;
            setDistance(table, neighbour, depth + 1);
            added++;

            // A representative fixed by a symmetry is the same position under
            // more than one twist. Every one of them is this far away.
            const fixes = classStabilizers[neighbourClass];
            if (fixes !== 1) {
              for (let sym = 1; sym < UD_SYMMETRY_COUNT; sym++) {
                if (!(fixes & (1 << sym))) continue;
                const twin = neighbourClass * TWIST_COUNT
                  + twistConj[neighbourTwist * UD_SYMMETRY_COUNT + sym];
                if (phase1DistanceAt(table, twin) !== UNKNOWN) continue;
                setDistance(table, twin, depth + 1);
                added++;
              }
            }
          } else if (phase1DistanceAt(table, neighbour) === depth) {
            setDistance(table, index, depth + 1);
            added++;
            // The same twin rule, from this side: fixing one entry fixes each
            // twist the representative's own symmetries make equal to it.
            if (stabilizer !== 1) {
              for (let sym = 1; sym < UD_SYMMETRY_COUNT; sym++) {
                if (!(stabilizer & (1 << sym))) continue;
                const twin = base + twistConj[twist * UD_SYMMETRY_COUNT + sym];
                if (phase1DistanceAt(table, twin) !== UNKNOWN) continue;
                setDistance(table, twin, depth + 1);
                added++;
              }
            }
            break;
          }
        }
      }
    }

    filled += added;
    frontier = added;
    onProgress?.(depth + 1, filled);

    // Nothing new at this depth and entries still unknown means the fill cannot
    // finish — a wrong move or symmetry table, not a cube that takes longer.
    if (added === 0) {
      throw new Error(`phase-one fill stalled at depth ${depth + 1} with ${PHASE1_TABLE_SIZE - filled} unreached`);
    }
  }

  return table;
}
