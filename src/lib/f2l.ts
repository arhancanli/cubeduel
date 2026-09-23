import { compose, cubeFromAlg, solvedCube, type CubieCube } from "./solver/cube";

/**
 * The first two layers, one pair at a time — the cases, derived rather than
 * copied.
 *
 * An F2L case is where the front-right pair sits when the cross and the other
 * three pairs are already done: its corner is in one of the four top corners
 * (three twists each) or in its own slot (three twists), and its edge is on one
 * of the four top edges (two flips each) or in its slot (two flips). That is
 * 15 × 10 = 150 placements. Turning the top face does not change the case, so
 * placements that differ only by U turns are one case; counted that way there
 * are exactly 41, plus the one where the pair is already solved.
 *
 * This module says which case a cube is in. The algorithms themselves are
 * found by search (`scripts/build-f2l.mts`) and checked here: each must insert
 * its pair without touching the cross or the other pairs, and together they
 * must cover all 41 cases. Nothing is typed in by hand, so nothing can be
 * misremembered.
 *
 * Piece numbering is Kociemba's, as in `solver/cube.ts`.
 */

/** The front-right pair: the DFR corner and the FR edge. */
export const PAIR_CORNER = 4;
export const PAIR_EDGE = 8;

/** Everything that must be left alone: the cross edges and the other three pairs. */
const KEPT_EDGES = [4, 5, 6, 7, 9, 10, 11];
const KEPT_CORNERS = [5, 6, 7];

const U_LAYER_CORNERS = [0, 1, 2, 3];
const U_LAYER_EDGES = [0, 1, 2, 3];

export function restIntact(cube: CubieCube): boolean {
  return (
    KEPT_EDGES.every((i) => cube.ep[i] === i && cube.eo[i] === 0) &&
    KEPT_CORNERS.every((i) => cube.cp[i] === i && cube.co[i] === 0)
  );
}

export function pairSolved(cube: CubieCube): boolean {
  return (
    cube.cp[PAIR_CORNER] === PAIR_CORNER &&
    cube.co[PAIR_CORNER] === 0 &&
    cube.ep[PAIR_EDGE] === PAIR_EDGE &&
    cube.eo[PAIR_EDGE] === 0
  );
}

/** True when the first two layers are complete: cross and all four pairs. */
export function f2lSolved(cube: CubieCube): boolean {
  return restIntact(cube) && pairSolved(cube);
}

/** Where the pair's two pieces are, as a short key. */
function placement(cube: CubieCube): string {
  const cornerAt = cube.cp.indexOf(PAIR_CORNER);
  const edgeAt = cube.ep.indexOf(PAIR_EDGE);
  return `c${cornerAt}.${cube.co[cornerAt]}/e${edgeAt}.${cube.eo[edgeAt]}`;
}

const U_TURNS = ["", "U", "U2", "U'"].map((alg) => (alg ? cubeFromAlg(alg) : solvedCube()));

/**
 * The case a cube is in, the same for every turn of the top face: the smallest
 * of the four placement keys reached by turning U. Null when the rest of the
 * first two layers is not intact, because then it is not an F2L case at all.
 */
export function caseKey(cube: CubieCube): string | null {
  if (!restIntact(cube)) return null;
  return U_TURNS.map((u) => placement(compose(cube, u))).sort()[0];
}

/** How a case is grouped for learning: by where the two pieces start. */
export type F2LGroup = "Both on top" | "Corner on top, edge in slot" | "Edge on top, corner in slot" | "Both in slot";

export function groupOf(cube: CubieCube): F2LGroup {
  const cornerOnTop = U_LAYER_CORNERS.includes(cube.cp.indexOf(PAIR_CORNER));
  const edgeOnTop = U_LAYER_EDGES.includes(cube.ep.indexOf(PAIR_EDGE));
  if (cornerOnTop && edgeOnTop) return "Both on top";
  if (cornerOnTop) return "Corner on top, edge in slot";
  if (edgeOnTop) return "Edge on top, corner in slot";
  return "Both in slot";
}

export const GROUP_ORDER: F2LGroup[] = [
  "Both on top",
  "Corner on top, edge in slot",
  "Edge on top, corner in slot",
  "Both in slot",
];

export function invert(alg: string): string {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
    .join(" ");
}

/** The state an algorithm is for: a solved cube with the algorithm undone. */
export function setupOf(alg: string): CubieCube {
  return cubeFromAlg(invert(alg));
}
