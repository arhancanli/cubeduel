import {
  CORNER_COUNT,
  EDGE_COUNT,
  FACES,
  solvedCube,
  type CubieCube,
  type Face,
} from "./cube";

/**
 * The cube as a solid in space, so that symmetries can be derived rather than
 * typed in.
 *
 * `cube.ts` describes states as permutations of pieces; that is the right model
 * for searching and the wrong one for asking "what does this state look like
 * mirrored?". The answer needs geometry: which face becomes which, and what that
 * does to each piece's stickers.
 *
 * Everything below follows from two facts about the puzzle and nothing else:
 * where each face points, and which stickers each slot holds, in order. From
 * those, the six face turns come out as cubie states — and `geometry.test.ts`
 * checks them against the transcribed `BASE_MOVES`, and the rotation derived
 * here against the transcribed `URF3`. That is the point of doing it this way:
 * the symmetries this file exists to produce cannot be checked against anything
 * published, but they are built by the same code that reproduces two tables
 * which can.
 *
 * ## Mirrors, and why orientation grows three more values
 *
 * A reflection is not a turn. No sequence of moves mirrors a cube, so a mirrored
 * state is not a state of the puzzle at all — it is a description of one, and it
 * only ever appears here in the middle of a conjugation `S⁻¹ X S`, where the two
 * reflections cancel. While it exists, a corner's three stickers run the other
 * way round, and the usual "twisted a third clockwise" cannot say so. Kociemba's
 * convention, followed here, extends corner orientation to 0-5: 0-2 as always,
 * 3-5 for the same twist on a piece whose cycle has been reversed.
 * `multiplyFull` is ordinary composition on 0-2 and handles the rest; the search
 * never sees a value above 2.
 */

/** Where each face points. Right-handed: +x is R, +y is U, +z is F. */
const FACE_VECTORS: Record<Face, readonly [number, number, number]> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

/**
 * The three stickers of each corner slot, in the order Kociemba numbers them
 * (URF UFL ULB UBR DFR DLF DBL DRB), each slot listed **clockwise seen from
 * outside the cube** and starting with its U or D sticker.
 *
 * Both properties carry meaning. Starting at U/D is what makes orientation 0
 * mean "this corner's U/D sticker faces up or down", and a consistent clockwise
 * sense is what makes "orientation 1" mean the same twist at every corner.
 */
const CORNER_SLOTS: readonly (readonly Face[])[] = [
  ["U", "R", "F"],
  ["U", "F", "L"],
  ["U", "L", "B"],
  ["U", "B", "R"],
  ["D", "F", "R"],
  ["D", "L", "F"],
  ["D", "B", "L"],
  ["D", "R", "B"],
];

/**
 * The two stickers of each edge slot, in Kociemba's order
 * (UR UF UL UB DR DF DL DB FR FL BL BR).
 *
 * The first sticker of each pair is the one orientation is measured against: an
 * edge is unflipped when the sticker that started on the first face is still on
 * the first face of wherever it now sits. That is exactly the convention under
 * which U, D, R and L preserve orientation and F and B flip four edges each —
 * the structure the whole of phase one is built on — and the derived move tables
 * agreeing with `BASE_MOVES` is what confirms it.
 */
const EDGE_SLOTS: readonly (readonly Face[])[] = [
  ["U", "R"],
  ["U", "F"],
  ["U", "L"],
  ["U", "B"],
  ["D", "R"],
  ["D", "F"],
  ["D", "L"],
  ["D", "B"],
  ["F", "R"],
  ["F", "L"],
  ["B", "L"],
  ["B", "R"],
];

/** A rigid motion of the whole cube, as the face each face is carried to. */
export type FaceMap = Record<Face, Face>;

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function faceOfVector(v: readonly [number, number, number]): Face {
  const found = FACES.find((face) => {
    const w = FACE_VECTORS[face];
    return w[0] === v[0] && w[1] === v[1] && w[2] === v[2];
  });
  if (!found) throw new Error(`no face points along ${v.join(",")}`);
  return found;
}

/**
 * Whether a motion preserves handedness.
 *
 * The determinant of the matrix whose columns are the images of the three axes.
 * +1 is a rotation, -1 a reflection — derived, so that a face map cannot be
 * declared a rotation and behave like a mirror.
 */
function determinant(map: FaceMap): 1 | -1 {
  const [x, y, z] = [FACE_VECTORS[map.R], FACE_VECTORS[map.U], FACE_VECTORS[map.F]];
  const det = x[0] * (y[1] * z[2] - y[2] * z[1])
    - x[1] * (y[0] * z[2] - y[2] * z[0])
    + x[2] * (y[0] * z[1] - y[1] * z[0]);
  if (det !== 1 && det !== -1) throw new Error(`a face map that is not a rigid motion: ${det}`);
  return det;
}

/** The face map of turning `face` a quarter turn clockwise, seen from outside. */
export function faceMapOfTurn(face: Face): FaceMap {
  const axis = FACE_VECTORS[face];
  const map = {} as FaceMap;
  for (const other of FACES) {
    // The two faces on the axis stay; every other face vector, being at right
    // angles to the axis, goes to v × n — which is the clockwise quarter turn
    // seen from outside, the direction every notation in cubing means by `R`.
    if (other === face || FACE_VECTORS[other].every((c, i) => c === -axis[i])) {
      map[other] = other;
    } else {
      map[other] = faceOfVector(cross(FACE_VECTORS[other], axis));
    }
  }
  return map;
}

function slotOf(slots: readonly (readonly Face[])[], faces: Face[]): number {
  const wanted = [...faces].sort().join("");
  const index = slots.findIndex((slot) => [...slot].sort().join("") === wanted);
  if (index < 0) throw new Error(`no slot holds ${faces.join("")}`);
  return index;
}

/**
 * The cubie state of a rigid motion of the whole cube.
 *
 * Piece `j` starts in slot `j` with its stickers on that slot's faces. The
 * motion carries it to the slot holding the images of those faces, and its
 * orientation is read off directly: where the sticker that measures orientation
 * — the U/D one for a corner, the first for an edge — has landed.
 */
export function cubeOfMotion(map: FaceMap): CubieCube {
  const det = determinant(map);
  const cube = solvedCube();

  for (let piece = 0; piece < CORNER_COUNT; piece++) {
    const slot = CORNER_SLOTS[piece];
    const image = slot.map((face) => map[face]);
    const target = slotOf(CORNER_SLOTS, image);
    const twist = CORNER_SLOTS[target].indexOf(image[0]);
    cube.cp[target] = piece;
    // A mirrored corner's stickers run anticlockwise, which 0-2 cannot express.
    cube.co[target] = det === 1 ? twist : twist + 3;
  }

  for (let piece = 0; piece < EDGE_COUNT; piece++) {
    const slot = EDGE_SLOTS[piece];
    const image = slot.map((face) => map[face]);
    const target = slotOf(EDGE_SLOTS, image);
    cube.ep[target] = piece;
    cube.eo[target] = EDGE_SLOTS[target][0] === image[0] ? 0 : 1;
  }

  return cube;
}

/**
 * The cubie state of turning one face, derived the same way as a symmetry.
 *
 * Only the four corners and four edges touching the face move; everything else
 * stays where it is. Exists to be compared against the transcribed `BASE_MOVES`
 * — if the geometry above were wrong, they would not agree.
 */
export function cubeOfTurn(face: Face): CubieCube {
  const map = faceMapOfTurn(face);
  const cube = solvedCube();

  for (let piece = 0; piece < CORNER_COUNT; piece++) {
    const slot = CORNER_SLOTS[piece];
    if (!slot.includes(face)) continue;
    const image = slot.map((f) => map[f]);
    const target = slotOf(CORNER_SLOTS, image);
    cube.cp[target] = piece;
    cube.co[target] = CORNER_SLOTS[target].indexOf(image[0]);
  }

  for (let piece = 0; piece < EDGE_COUNT; piece++) {
    const slot = EDGE_SLOTS[piece];
    if (!slot.includes(face)) continue;
    const image = slot.map((f) => map[f]);
    const target = slotOf(EDGE_SLOTS, image);
    cube.ep[target] = piece;
    cube.eo[target] = EDGE_SLOTS[target][0] === image[0] ? 0 : 1;
  }

  return cube;
}

/**
 * Composition that survives mirrored states: applies `b` after `a` into `out`.
 *
 * On corner orientations 0-2 this is `cube.ts`'s `multiply` exactly. The other
 * cases are what a mirror costs: twists add on a piece whose sticker cycle runs
 * the usual way and subtract on one whose cycle has been reversed, and the
 * result is mirrored only when exactly one of the two states is.
 */
export function multiplyFull(a: CubieCube, b: CubieCube, out: CubieCube): void {
  for (let i = 0; i < CORNER_COUNT; i++) {
    const from = b.cp[i];
    const oriA = a.co[from];
    const oriB = b.co[i];
    let ori: number;

    if (oriA < 3) {
      ori = oriB < 3 ? (oriA + oriB) % 3 : ((oriA + oriB - 3) % 3) + 3;
    } else {
      ori = oriB < 3 ? ((oriA - oriB + 3) % 3) + 3 : (oriA - oriB + 3) % 3;
    }

    out.cp[i] = a.cp[from];
    out.co[i] = ori;
  }

  for (let i = 0; i < EDGE_COUNT; i++) {
    const from = b.ep[i];
    out.ep[i] = a.ep[from];
    out.eo[i] = (a.eo[from] + b.eo[i]) % 2;
  }
}

/** The motion that undoes `map`. */
export function invertFaceMap(map: FaceMap): FaceMap {
  const out = {} as FaceMap;
  for (const face of FACES) out[map[face]] = face;
  return out;
}

/**
 * The face maps of the sixteen symmetries that leave the U-D axis alone: the
 * four turns about it, each with and without a half turn about F-B, each with
 * and without the mirror through the R-L plane.
 *
 * Only these matter for phase one. Its goal — every corner untwisted, every edge
 * unflipped, the middle-slice edges in the middle slice — is stated entirely in
 * terms of that axis, so a symmetry that tilts the axis does not preserve it,
 * and there are exactly sixteen that do. They are generated below rather than
 * listed, so the set cannot be short by one.
 */
export const UD_SYMMETRY_MAPS: FaceMap[] = (() => {
  const identity: FaceMap = { U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" };
  const quarter = faceMapOfTurn("U");
  const halfAboutF: FaceMap = { U: "D", R: "L", F: "F", D: "U", L: "R", B: "B" };
  const mirrorLR: FaceMap = { U: "U", R: "L", F: "F", D: "D", L: "R", B: "B" };

  const compose2 = (first: FaceMap, second: FaceMap): FaceMap => {
    const out = {} as FaceMap;
    for (const face of FACES) out[face] = second[first[face]];
    return out;
  };

  const out: FaceMap[] = [];
  let turned = identity;
  for (let quarters = 0; quarters < 4; quarters++) {
    for (const flipped of [identity, halfAboutF]) {
      for (const mirrored of [identity, mirrorLR]) {
        out.push(compose2(compose2(turned, flipped), mirrored));
      }
    }
    turned = compose2(turned, quarter);
  }
  return out;
})();
