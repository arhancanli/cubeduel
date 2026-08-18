import {
  BASE_MOVES,
  FACES,
  compose,
  solvedCube,
  type CubieCube,
  type Face,
} from "./cube";
import {
  CORNER_PERM_COUNT,
  EDGE8_PERM_COUNT,
  FLIP_COUNT,
  SLICE_COUNT,
  SLICE_PERM_COUNT,
  TWIST_COUNT,
  getCornerPerm,
  getEdge8Perm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
  setCornerPerm,
  setEdge8Perm,
  setFlip,
  setSlice,
  setSlicePerm,
  setTwist,
} from "./coords";

/**
 * The lookup tables the search runs on.
 *
 * Two kinds, and they do different jobs.
 *
 * **Move tables** turn "apply R2 to this state" into an array read. Because a
 * coordinate's next value depends only on its current value and the move (see
 * `coords.ts`), the whole effect of a move fits in a flat array indexed by
 * `coordinate * moveCount + move`.
 *
 * **Pruning tables** are the reason the search terminates in milliseconds rather
 * than days. Each stores, for every pair of coordinates, the exact minimum number
 * of moves needed to reach the goal from there — computed once by breadth-first
 * search backwards from the goal. During the search that number is a *lower
 * bound* on what remains, so any branch whose depth-so-far plus lower-bound
 * exceeds the current limit can be abandoned without exploring it. An admissible
 * heuristic never overestimates, which is what keeps the result optimal for the
 * depth being searched.
 *
 * Pairs rather than triples purely for memory: the exact three-coordinate table
 * for phase one would have 2,187 × 2,048 × 495 ≈ 2.2 billion entries. Two pair
 * tables cost about 2MB together and their maximum is still admissible.
 *
 * Everything here is built once and cached for the life of the process. The
 * build is a few hundred milliseconds; a solve afterwards is single-digit.
 */

export interface Move {
  face: Face;
  turns: number;
  name: string;
}

/** All 18 quarter/half turns, ordered face-major. */
export const MOVES: Move[] = FACES.flatMap((face) =>
  [1, 2, 3].map((turns) => ({
    face,
    turns,
    name: `${face}${turns === 2 ? "2" : turns === 3 ? "'" : ""}`,
  })),
);

export const MOVE_COUNT = MOVES.length;

/**
 * The moves phase two may use: U and D freely, the other four faces only as half
 * turns. Exactly the generators of G1, so no phase-two move can undo phase one.
 */
export const PHASE2_MOVES: number[] = MOVES.map((m, i) => ({ m, i }))
  .filter(({ m }) =>
    m.face === "U" || m.face === "D" ? true : m.turns === 2,
  )
  .map(({ i }) => i);

export const PHASE2_MOVE_COUNT = PHASE2_MOVES.length;

/** The cube state each of the 18 moves produces from solved. */
export const MOVE_CUBES: CubieCube[] = MOVES.map(({ face, turns }) => {
  let cube = solvedCube();
  for (let t = 0; t < turns; t++) cube = compose(cube, BASE_MOVES[face]);
  return cube;
});

/**
 * Builds `coordinate × move -> coordinate` by constructing a representative cube
 * for every coordinate value, applying each move, and reading the result back.
 *
 * The representative is synthetic and wrong about everything the coordinate does
 * not capture — which is fine, and is precisely the property `coords.test.ts`
 * pins down.
 */
function buildMoveTable(
  size: number,
  get: (cube: CubieCube) => number,
  set: (cube: CubieCube, index: number) => void,
  moveIndices: number[],
): Int32Array {
  const table = new Int32Array(size * moveIndices.length);
  const cube = solvedCube();

  for (let value = 0; value < size; value++) {
    // Reset the fields `set` does not own, so a previous iteration cannot leak in.
    const fresh = solvedCube();
    cube.cp.set(fresh.cp);
    cube.co.set(fresh.co);
    cube.ep.set(fresh.ep);
    cube.eo.set(fresh.eo);
    set(cube, value);

    for (let m = 0; m < moveIndices.length; m++) {
      table[value * moveIndices.length + m] = get(
        compose(cube, MOVE_CUBES[moveIndices[m]]),
      );
    }
  }
  return table;
}

/**
 * Exact distance-to-goal for every combination of two coordinates, by
 * breadth-first search backwards from the goal.
 *
 * BFS rather than repeated full scans: a scan-based fill re-reads the whole table
 * once per depth, which for a million entries and eighteen moves is an order of
 * magnitude more work than walking a queue.
 */
function buildPruningTable(
  sizeA: number,
  sizeB: number,
  tableA: Int32Array,
  tableB: Int32Array,
  moveCount: number,
): Uint8Array {
  const total = sizeA * sizeB;
  const distance = new Uint8Array(total).fill(0xff);
  const queue = new Int32Array(total);

  let head = 0;
  let tail = 0;
  distance[0] = 0;
  queue[tail++] = 0;

  while (head < tail) {
    const index = queue[head++];
    const next = distance[index] + 1;
    const a = (index / sizeB) | 0;
    const b = index % sizeB;

    for (let m = 0; m < moveCount; m++) {
      const child = tableA[a * moveCount + m] * sizeB + tableB[b * moveCount + m];
      if (distance[child] === 0xff) {
        distance[child] = next;
        queue[tail++] = child;
      }
    }
  }

  return distance;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { TABLE_CACHE_PATH, TABLE_FORMAT_VERSION, type TableHeader } from "./cache";

export interface SolverTables {
  twistMove: Int32Array;
  flipMove: Int32Array;
  sliceMove: Int32Array;
  cornerPermMove: Int32Array;
  edge8PermMove: Int32Array;
  slicePermMove: Int32Array;
  /** Lower bound on phase-one moves remaining, from (twist, slice). */
  twistSlicePrune: Uint8Array;
  /** Lower bound on phase-one moves remaining, from (flip, slice). */
  flipSlicePrune: Uint8Array;
  /**
   * Lower bound from (twist, flip) — the strong one.
   *
   * The two slice-paired tables above bottom out at a maximum of 9, and a
   * phase-one solution runs to 12, so near the root they never fire and the
   * search degenerates into brute force. Measured: solving 25 scrambles did not
   * finish in ten minutes. Orientation is the harder half of phase one, and
   * pairing the two orientation coordinates captures it — 2,187 × 2,048 is 4.5MB,
   * which is a cheap price for the difference between milliseconds and never.
   */
  twistFlipPrune: Uint8Array;
  /** Lower bound on phase-two moves remaining, from (cornerPerm, slicePerm). */
  cornerSlicePrune: Uint8Array;
  /** Lower bound on phase-two moves remaining, from (edge8Perm, slicePerm). */
  edgeSlicePrune: Uint8Array;
  buildMs: number;
}

let cached: SolverTables | null = null;

/**
 * Builds the tables, or returns the ones already built.
 *
 * Deliberately explicit rather than hidden inside the first `solve()` call: the
 * cost belongs to whoever decides when to pay it, and a "solve" that silently
 * includes half a second of table generation would make every measurement of the
 * solver a lie.
 */
export function buildTables(): SolverTables {
  if (cached) return cached;

  // Try the precomputed file first. Generating these takes 1.2-2.7 seconds and
  // loading them takes 30ms, which is the difference between a cold `/api/solve`
  // at 2.07s and one well under half a second.
  const loaded = loadPrecomputedTables();
  if (loaded) {
    cached = loaded;
    return cached;
  }

  const started = Date.now();

  const allMoves = MOVES.map((_, i) => i);

  const twistMove = buildMoveTable(TWIST_COUNT, getTwist, setTwist, allMoves);
  const flipMove = buildMoveTable(FLIP_COUNT, getFlip, setFlip, allMoves);
  const sliceMove = buildMoveTable(SLICE_COUNT, getSlice, setSlice, allMoves);

  const cornerPermMove = buildMoveTable(
    CORNER_PERM_COUNT,
    getCornerPerm,
    setCornerPerm,
    PHASE2_MOVES,
  );
  const edge8PermMove = buildMoveTable(
    EDGE8_PERM_COUNT,
    getEdge8Perm,
    setEdge8Perm,
    PHASE2_MOVES,
  );
  const slicePermMove = buildMoveTable(
    SLICE_PERM_COUNT,
    getSlicePerm,
    setSlicePerm,
    PHASE2_MOVES,
  );

  cached = {
    twistMove,
    flipMove,
    sliceMove,
    cornerPermMove,
    edge8PermMove,
    slicePermMove,
    twistSlicePrune: buildPruningTable(
      TWIST_COUNT,
      SLICE_COUNT,
      twistMove,
      sliceMove,
      MOVE_COUNT,
    ),
    flipSlicePrune: buildPruningTable(
      FLIP_COUNT,
      SLICE_COUNT,
      flipMove,
      sliceMove,
      MOVE_COUNT,
    ),
    twistFlipPrune: buildPruningTable(
      TWIST_COUNT,
      FLIP_COUNT,
      twistMove,
      flipMove,
      MOVE_COUNT,
    ),
    cornerSlicePrune: buildPruningTable(
      CORNER_PERM_COUNT,
      SLICE_PERM_COUNT,
      cornerPermMove,
      slicePermMove,
      PHASE2_MOVE_COUNT,
    ),
    edgeSlicePrune: buildPruningTable(
      EDGE8_PERM_COUNT,
      SLICE_PERM_COUNT,
      edge8PermMove,
      slicePermMove,
      PHASE2_MOVE_COUNT,
    ),
    buildMs: Date.now() - started,
  };

  return cached;
}

/** For tests and benchmarks that need a cold build. */
export function resetTables(): void {
  cached = null;
}


/**
 * Reads the tables generated by `npm run tables:build`, or returns null.
 *
 * Every failure path returns null and lets the caller compute them instead. That
 * is deliberate and the asymmetry matters: computing is merely slow, whereas
 * trusting a file that does not match this build is *wrong*. The pruning tables
 * are admissible lower bounds on the remaining distance, and the search prunes
 * any branch whose bound exceeds the depth it is searching — so bounds that are
 * too high silently discard the branch holding the real solution.
 *
 * So it verifies the format version and every declared length against what this
 * build expects, and refuses on the slightest disagreement.
 */
function loadPrecomputedTables(): SolverTables | null {
  // Node-only by construction: the solver is reached only through
  // `server-only` code, so `node:fs` is a static import rather than a guarded
  // one. If that ever changes, this is the line that has to change with it.
  try {
    const packed = readFileSync(join(process.cwd(), TABLE_CACHE_PATH));
    const raw = gunzipSync(packed);

    const headerLength = raw.readUInt32LE(0);
    const header = JSON.parse(
      raw.subarray(4, 4 + headerLength).toString("utf8"),
    ) as TableHeader;

    if (header.version !== TABLE_FORMAT_VERSION) return null;

    const expected = expectedTableLengths();
    const out: Record<string, ArrayBufferView> = {};
    let offset = 4 + headerLength;

    for (const entry of header.entries) {
      const want = expected[entry.key];
      // An unknown key, or one whose size this build disagrees with, means the
      // file was written by different code.
      if (want === undefined || want !== entry.length) return null;

      const bytes = entry.kind === "Int32Array" ? entry.length * 4 : entry.length;
      if (offset + bytes > raw.length) return null;

      // Copied rather than viewed onto the shared buffer: an Int32Array needs
      // four-byte alignment, and a view into an arbitrary offset of a Node
      // Buffer is not guaranteed to have it.
      const slice = raw.buffer.slice(
        raw.byteOffset + offset,
        raw.byteOffset + offset + bytes,
      );
      out[entry.key] =
        entry.kind === "Int32Array" ? new Int32Array(slice) : new Uint8Array(slice);
      offset += bytes;
    }

    // Every table this build needs must be present, not merely every table the
    // file happens to contain.
    for (const key of Object.keys(expected)) {
      if (!(key in out)) return null;
    }

    return { ...(out as unknown as SolverTables), buildMs: 0 };
  } catch {
    return null;
  }
}

/**
 * The length each table must have, derived from the same constants the builder
 * uses. This is what makes a stale file detectable rather than merely unlikely.
 */
function expectedTableLengths(): Record<string, number> {
  return {
    twistMove: TWIST_COUNT * MOVE_COUNT,
    flipMove: FLIP_COUNT * MOVE_COUNT,
    sliceMove: SLICE_COUNT * MOVE_COUNT,
    // Phase two turns only ten of the eighteen moves — the quarter turns of U
    // and D and the halves of the rest — so these are indexed by
    // PHASE2_MOVE_COUNT. Getting this wrong is what the length check caught the
    // first time it ran: the loader refused the file rather than reading the
    // rows misaligned, which would have produced a wrong pruning bound and a
    // search that silently discarded the branch holding the solution.
    cornerPermMove: CORNER_PERM_COUNT * PHASE2_MOVE_COUNT,
    edge8PermMove: EDGE8_PERM_COUNT * PHASE2_MOVE_COUNT,
    slicePermMove: SLICE_PERM_COUNT * PHASE2_MOVE_COUNT,
    twistSlicePrune: TWIST_COUNT * SLICE_COUNT,
    flipSlicePrune: FLIP_COUNT * SLICE_COUNT,
    twistFlipPrune: TWIST_COUNT * FLIP_COUNT,
    cornerSlicePrune: CORNER_PERM_COUNT * SLICE_PERM_COUNT,
    edgeSlicePrune: EDGE8_PERM_COUNT * SLICE_PERM_COUNT,
  };
}
