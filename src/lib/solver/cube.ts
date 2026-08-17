/**
 * The cube, at the level a solver needs.
 *
 * `cubing.js` already gives us a puzzle model, and the rest of this app uses it.
 * It is the wrong shape for search: it stores a general permutation of named
 * pieces and is built for correctness and display, not for being copied and
 * mutated a million times a second. A solver needs four small integer arrays and
 * nothing else.
 *
 * ## The model
 *
 * A cube state is where each piece sits and how it is twisted:
 *
 *   - `cp[i]` — which corner piece is in position `i`
 *   - `co[i]` — how that corner is twisted, 0/1/2 (clockwise thirds)
 *   - `ep[i]` — which edge piece is in position `i`
 *   - `eo[i]` — whether that edge is flipped, 0/1
 *
 * Two invariants hold for every state reachable by turning a real cube, and they
 * are what make the coordinates below work:
 *
 *   sum(co) ≡ 0 (mod 3)      you cannot twist one corner in isolation
 *   sum(eo) ≡ 0 (mod 2)      you cannot flip one edge in isolation
 *
 * ## Orientation conventions
 *
 * Corner orientation is measured against the U/D faces: 0 when the corner's
 * U-or-D sticker faces up or down.
 *
 * Edge orientation is measured against F/B: an edge is "good" (0) when it can be
 * placed without an F or B quarter turn. This specific convention is not
 * cosmetic — it is the reason `U D R L` and the double turns preserve edge
 * orientation while `F B` flip four edges each, which is exactly the structure
 * phase one exploits.
 *
 * Piece ordering follows Kociemba's, because every published table and every
 * reference implementation uses it and diverging would make this code impossible
 * to check against anything.
 */

// Corner slots, in order.  URF UFL ULB UBR DFR DLF DBL DRB
export const CORNER_COUNT = 8;
// Edge slots, in order.    UR UF UL UB DR DF DL DB FR FL BL BR
export const EDGE_COUNT = 12;

export interface CubieCube {
  cp: Uint8Array;
  co: Uint8Array;
  ep: Uint8Array;
  eo: Uint8Array;
}

export function solvedCube(): CubieCube {
  return {
    cp: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    co: new Uint8Array(CORNER_COUNT),
    ep: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    eo: new Uint8Array(EDGE_COUNT),
  };
}

export function cloneCube(cube: CubieCube): CubieCube {
  return {
    cp: cube.cp.slice(),
    co: cube.co.slice(),
    ep: cube.ep.slice(),
    eo: cube.eo.slice(),
  };
}

export function isSolved(cube: CubieCube): boolean {
  for (let i = 0; i < CORNER_COUNT; i++) {
    if (cube.cp[i] !== i || cube.co[i] !== 0) return false;
  }
  for (let i = 0; i < EDGE_COUNT; i++) {
    if (cube.ep[i] !== i || cube.eo[i] !== 0) return false;
  }
  return true;
}

/**
 * The six quarter turns, as the state each produces from solved.
 *
 * Transcribed from Kociemba's definitions. Transcription is exactly the kind of
 * thing that is silently wrong, so `cube.test.ts` regenerates all six from
 * cubing.js's own puzzle definition and asserts they match — the tables are
 * canonical AND checked against an independent implementation.
 */
export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];

export const BASE_MOVES: Record<Face, CubieCube> = {
  U: {
    cp: Uint8Array.from([3, 0, 1, 2, 4, 5, 6, 7]),
    co: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
    ep: Uint8Array.from([3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]),
    eo: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  R: {
    cp: Uint8Array.from([4, 1, 2, 0, 7, 5, 6, 3]),
    co: Uint8Array.from([2, 0, 0, 1, 1, 0, 0, 2]),
    ep: Uint8Array.from([8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0]),
    eo: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  F: {
    cp: Uint8Array.from([1, 5, 2, 3, 0, 4, 6, 7]),
    co: Uint8Array.from([1, 2, 0, 0, 2, 1, 0, 0]),
    ep: Uint8Array.from([0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11]),
    eo: Uint8Array.from([0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]),
  },
  D: {
    cp: Uint8Array.from([0, 1, 2, 3, 5, 6, 7, 4]),
    co: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
    ep: Uint8Array.from([0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11]),
    eo: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  L: {
    cp: Uint8Array.from([0, 2, 6, 3, 4, 1, 5, 7]),
    co: Uint8Array.from([0, 1, 2, 0, 0, 2, 1, 0]),
    ep: Uint8Array.from([0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11]),
    eo: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  B: {
    cp: Uint8Array.from([0, 1, 3, 7, 4, 5, 2, 6]),
    co: Uint8Array.from([0, 0, 1, 2, 0, 0, 2, 1]),
    ep: Uint8Array.from([0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7]),
    eo: Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1]),
  },
};

/**
 * Applies `b` after `a`, writing into `out`.
 *
 * Composition of permutations-with-orientation. The orientation of the piece
 * that ends up in slot `i` is the sum of how it was already twisted and how the
 * new move twists the slot it came from — mod 3 for corners, mod 2 for edges.
 *
 * `out` may alias neither input.
 */
export function multiply(a: CubieCube, b: CubieCube, out: CubieCube): void {
  for (let i = 0; i < CORNER_COUNT; i++) {
    const from = b.cp[i];
    out.cp[i] = a.cp[from];
    out.co[i] = (a.co[from] + b.co[i]) % 3;
  }
  for (let i = 0; i < EDGE_COUNT; i++) {
    const from = b.ep[i];
    out.ep[i] = a.ep[from];
    out.eo[i] = (a.eo[from] + b.eo[i]) % 2;
  }
}

/** Convenience wrapper that allocates. Not for use inside search. */
export function compose(a: CubieCube, b: CubieCube): CubieCube {
  const out = solvedCube();
  multiply(a, b, out);
  return out;
}

/** Parses standard notation into (face, quarter-turn count) pairs. */
export function parseMoves(alg: string): { face: Face; turns: number }[] {
  const out: { face: Face; turns: number }[] = [];
  for (const token of alg.trim().split(/\s+/).filter(Boolean)) {
    const match = /^([URFDLB])(2|')?$/.exec(token);
    if (!match) throw new Error(`Unsupported move for the solver: ${token}`);
    const face = match[1] as Face;
    const turns = match[2] === "2" ? 2 : match[2] === "'" ? 3 : 1;
    out.push({ face, turns });
  }
  return out;
}

/** The state produced by applying an algorithm to a solved cube. */
export function cubeFromAlg(alg: string): CubieCube {
  let cube = solvedCube();
  for (const { face, turns } of parseMoves(alg)) {
    for (let t = 0; t < turns; t++) cube = compose(cube, BASE_MOVES[face]);
  }
  return cube;
}

/**
 * Whether a state could exist on a real cube.
 *
 * Three conditions, and a search fed a state failing any of them will simply run
 * forever rather than report a problem — so this is checked at the door.
 */
export function validate(cube: CubieCube): string | null {
  const cornerSeen = new Set<number>();
  let twist = 0;
  for (let i = 0; i < CORNER_COUNT; i++) {
    if (cube.cp[i] >= CORNER_COUNT) return `corner slot ${i} holds an unknown piece`;
    cornerSeen.add(cube.cp[i]);
    if (cube.co[i] > 2) return `corner slot ${i} has an impossible twist`;
    twist += cube.co[i];
  }
  if (cornerSeen.size !== CORNER_COUNT) return "a corner piece is duplicated or missing";
  if (twist % 3 !== 0) return "corner twist does not sum to zero — one corner is rotated";

  const edgeSeen = new Set<number>();
  let flip = 0;
  for (let i = 0; i < EDGE_COUNT; i++) {
    if (cube.ep[i] >= EDGE_COUNT) return `edge slot ${i} holds an unknown piece`;
    edgeSeen.add(cube.ep[i]);
    if (cube.eo[i] > 1) return `edge slot ${i} has an impossible flip`;
    flip += cube.eo[i];
  }
  if (edgeSeen.size !== EDGE_COUNT) return "an edge piece is duplicated or missing";
  if (flip % 2 !== 0) return "edge flip does not sum to zero — one edge is flipped";

  // Corner and edge permutations must have the same parity: a single face turn
  // is a 4-cycle on both, so their parities always move together.
  if (permutationParity(cube.cp) !== permutationParity(cube.ep)) {
    return "corner and edge permutation parity disagree — two pieces are swapped";
  }

  return null;
}

function permutationParity(perm: Uint8Array): number {
  let swaps = 0;
  const work = perm.slice();
  for (let i = 0; i < work.length; i++) {
    while (work[i] !== i) {
      const j = work[i];
      work[i] = work[j];
      work[j] = j;
      swaps++;
    }
  }
  return swaps % 2;
}
