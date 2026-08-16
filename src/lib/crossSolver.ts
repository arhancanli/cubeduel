/**
 * How hard is this scramble?
 *
 * Chess.com runs a full competitive ladder with no opponent in it by rating the
 * *puzzle*: you are scored against a calibrated task rather than against a person.
 * The cubing translation is rating the *scramble* — which means the app needs an
 * objective measure of scramble difficulty, computed locally, with no population.
 *
 * The measure used here is the optimal cross length: the fewest quarter/half turns
 * that solve the four cross edges. It is the standard thing cubers mean by an "easy
 * scramble", it is what a colour-neutral solver scans for, and unlike total solution
 * length it is cheap to compute exactly.
 *
 * Exactly, not approximately: the four cross edges have only 12·11·10·9 placements
 * and 2^4 orientations — 190,080 states — so the whole space is breadth-first
 * searched once from solved and the answer for any scramble is a table lookup. No
 * heuristic, no search at request time, no possibility of an over-estimate.
 */

const EDGE_COUNT = 12;
const CROSS_EDGES = 4;
const ORIENTATIONS = 1 << CROSS_EDGES;
/** 12·11·10·9 ordered placements of four distinct edges. */
const PLACEMENTS = 12 * 11 * 10 * 9;
export const CROSS_STATE_COUNT = PLACEMENTS * ORIENTATIONS;

/** The six faces, each turnable three ways. */
export const HTM_MOVES = [
  "U", "U'", "U2",
  "D", "D'", "D2",
  "R", "R'", "R2",
  "L", "L'", "L2",
  "F", "F'", "F2",
  "B", "B'", "B2",
];

interface EdgeMove {
  /** `from[i]` is the position whose piece ends up at position i. */
  from: number[];
  /** Orientation flip applied at position i. */
  flip: number[];
}

interface OrbitData {
  pieces: number[];
  orientation: number[];
}

interface Pattern {
  patternData: Record<string, OrbitData>;
  applyMove(move: string): Pattern;
  applyAlg(alg: string): Pattern;
}

/** Encodes four distinct positions in 0..11 as a single ordered index. */
function placementIndex(positions: number[]): number {
  // Lehmer-style ranking over the remaining choices, so every distinct placement
  // maps to exactly one index and the table has no holes.
  const remaining = Array.from({ length: EDGE_COUNT }, (_, i) => i);
  let index = 0;
  for (let slot = 0; slot < CROSS_EDGES; slot++) {
    const at = remaining.indexOf(positions[slot]);
    index = index * (EDGE_COUNT - slot) + at;
    remaining.splice(at, 1);
  }
  return index;
}

function stateIndex(positions: number[], orientations: number[]): number {
  let bits = 0;
  for (let i = 0; i < CROSS_EDGES; i++) bits |= orientations[i] << i;
  return placementIndex(positions) * ORIENTATIONS + bits;
}

function decodePlacement(index: number): number[] {
  /*
   * The ranks come out of the index back-to-front, but they must be *consumed*
   * front-to-back — each rank was measured against the list with all earlier
   * choices already removed. Decoding in reverse order removes the wrong entries
   * and silently yields a different placement, which turns the breadth-first search
   * into a walk over a scrambled neighbour graph and inflates distances.
   */
  const ranks: number[] = [];
  let rest = index;
  for (let slot = CROSS_EDGES - 1; slot >= 0; slot--) {
    const base = EDGE_COUNT - slot;
    ranks[slot] = rest % base;
    rest = Math.floor(rest / base);
  }

  const remaining = Array.from({ length: EDGE_COUNT }, (_, i) => i);
  return ranks.map((rank) => remaining.splice(rank, 1)[0]);
}

/** Move tables read off the puzzle definition rather than hardcoded. */
function buildMoveTable(solved: Pattern): EdgeMove[] {
  return HTM_MOVES.map((move) => {
    const after = solved.applyMove(move).patternData.EDGES;
    const from = after.pieces.slice(0, EDGE_COUNT);
    const flip = after.orientation.slice(0, EDGE_COUNT);
    return { from, flip };
  });
}

/**
 * Distances from solved for every cross state, one byte each.
 *
 * Built once and reused. The search runs forwards from the solved cross, so a
 * scramble's distance is read directly — the distance to solve a state equals the
 * distance from solved to its inverse, and a breadth-first layer ordering makes
 * every entry optimal by construction.
 */
export function buildCrossTable(
  solved: Pattern,
  crossEdgeSlots: readonly number[],
): Uint8Array {
  const moves = buildMoveTable(solved);
  const table = new Uint8Array(CROSS_STATE_COUNT).fill(0xff);

  // Solved means the four cross pieces sitting in their own slots, which differ per
  // face — so a table belongs to one cross face and the caller says which.
  const start = stateIndex([...crossEdgeSlots], [0, 0, 0, 0]);
  table[start] = 0;

  let frontier = [start];
  let depth = 0;

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const index of frontier) {
      const positions = decodePlacement(Math.floor(index / ORIENTATIONS));
      const bits = index % ORIENTATIONS;

      for (const { from, flip } of moves) {
        // `from[q] === p` means the piece at p moves to q.
        const movedPositions = new Array<number>(CROSS_EDGES);
        const movedBits = [0, 0, 0, 0];
        for (let slot = 0; slot < CROSS_EDGES; slot++) {
          const p = positions[slot];
          const q = from.indexOf(p);
          movedPositions[slot] = q;
          movedBits[slot] = (((bits >> slot) & 1) + flip[q]) % 2;
        }
        const neighbour = stateIndex(movedPositions, movedBits);
        if (table[neighbour] === 0xff) {
          table[neighbour] = depth + 1;
          next.push(neighbour);
        }
      }
    }
    frontier = next;
    depth += 1;
  }

  return table;
}

/**
 * Optimal cross length for `pattern` with the cross built on the face whose four
 * edges are `crossEdgeSlots`.
 */
export function crossDistance(
  table: Uint8Array,
  pattern: Pattern,
  crossEdgeSlots: readonly number[],
): number {
  const edges = pattern.patternData.EDGES;
  const positions: number[] = [];
  const orientations: number[] = [];

  for (const slot of crossEdgeSlots) {
    // Where did the piece belonging in `slot` actually end up?
    const at = edges.pieces.indexOf(slot);
    positions.push(at);
    orientations.push(edges.orientation[at] % 2);
  }

  return table[stateIndex(positions, orientations)];
}

/** Exposed for tests: the encoding must round-trip or the search walks a wrong graph. */
export const encodeForTest = placementIndex;
export const decodeForTest = decodePlacement;
