import { CORNER_COUNT, EDGE_COUNT, solvedCube, validate, type CubieCube } from "./cube";

/**
 * A cube as its 54 stickers, and back.
 *
 * The facelet string is Kociemba's: nine letters per face in the order
 * U R F D L B, each face read row by row as it appears in the usual net —
 * U above F, L F R B across the middle, D below F. A letter names the face
 * whose centre has that colour, so "U" is whatever colour sits in the middle of
 * the top face; a cube in any colour scheme converts the same way.
 *
 * This is what lets a person type in the cube in their hands. Every other way
 * in — a scramble, a move stream — already knows how the cube got there; a
 * photograph of the stickers does not, and has to be read piece by piece.
 */

export const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

const U = 0, R = 9, F = 18, D = 27, L = 36, B = 45;

/** Sticker indices of each corner slot, U/D sticker first, then clockwise. */
const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [U + 8, R + 0, F + 2], // URF
  [U + 6, F + 0, L + 2], // UFL
  [U + 0, L + 0, B + 2], // ULB
  [U + 2, B + 0, R + 2], // UBR
  [D + 2, F + 8, R + 6], // DFR
  [D + 0, L + 8, F + 6], // DLF
  [D + 6, B + 8, L + 6], // DBL
  [D + 8, R + 8, B + 6], // DRB
];

/** Sticker indices of each edge slot, the U/D (or F/B) sticker first. */
const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [U + 5, R + 1], // UR
  [U + 7, F + 1], // UF
  [U + 3, L + 1], // UL
  [U + 1, B + 1], // UB
  [D + 5, R + 7], // DR
  [D + 1, F + 7], // DF
  [D + 3, L + 7], // DL
  [D + 7, B + 7], // DB
  [F + 5, R + 3], // FR
  [F + 3, L + 5], // FL
  [B + 5, L + 3], // BL
  [B + 3, R + 5], // BR
];

const CORNER_COLOURS = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
const EDGE_COLOURS = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"];

const COLOUR_NAME: Record<string, string> = {
  U: "white",
  R: "red",
  F: "green",
  D: "yellow",
  L: "orange",
  B: "blue",
};

export function cubeToFacelets(cube: CubieCube): string {
  const out = SOLVED_FACELETS.split("");
  for (let i = 0; i < CORNER_COUNT; i++) {
    const piece = CORNER_COLOURS[cube.cp[i]];
    for (let n = 0; n < 3; n++) {
      out[CORNER_FACELETS[i][(n + cube.co[i]) % 3]] = piece[n];
    }
  }
  for (let i = 0; i < EDGE_COUNT; i++) {
    const piece = EDGE_COLOURS[cube.ep[i]];
    for (let n = 0; n < 2; n++) {
      out[EDGE_FACELETS[i][(n + cube.eo[i]) % 2]] = piece[n];
    }
  }
  return out.join("");
}

export type FaceletResult = { ok: true; cube: CubieCube } | { ok: false; error: string };

/**
 * Reads 54 stickers into pieces, or says in plain words why a real cube could
 * not look like that. Any six distinct letters are accepted: the centres say
 * which letter is which face.
 */
export function faceletsToCube(input: string): FaceletResult {
  const stickers = input.replace(/\s+/g, "");
  if (stickers.length !== 54) return { ok: false, error: `A cube has 54 stickers; this has ${stickers.length}.` };

  // The centres fix the scheme.
  const centres = [U, R, F, D, L, B].map((start) => stickers[start + 4]);
  if (new Set(centres).size !== 6) {
    return { ok: false, error: "Two centres are the same colour. Each face's middle sticker is a different colour on a real cube." };
  }
  const faceOf = new Map(centres.map((c, i) => [c, "URFDLB"[i]]));
  const named = (face: string) => COLOUR_NAME[face] ?? face;

  const counts = new Map<string, number>();
  for (const c of stickers) {
    if (!faceOf.has(c)) return { ok: false, error: `"${c}" is not the colour of any centre.` };
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const wrong = [...counts.entries()].filter(([, n]) => n !== 9);
  const missing = centres.filter((c) => !counts.has(c));
  if (wrong.length > 0 || missing.length > 0) {
    const parts = wrong.map(([c, n]) => `${n} ${named(faceOf.get(c)!)}`);
    return {
      ok: false,
      error: `Every colour appears nine times on a real cube. This has ${parts.join(", ")}.`,
    };
  }

  const f = stickers.split("").map((c) => faceOf.get(c)!);
  const cube = solvedCube();

  for (let i = 0; i < CORNER_COUNT; i++) {
    const slot = CORNER_FACELETS[i];
    let ori = 0;
    while (ori < 3 && f[slot[ori]] !== "U" && f[slot[ori]] !== "D") ori++;
    if (ori === 3) return { ok: false, error: "A corner has no white or yellow sticker — every corner has exactly one." };
    const c1 = f[slot[(ori + 1) % 3]];
    const c2 = f[slot[(ori + 2) % 3]];
    const piece = CORNER_COLOURS.findIndex((p) => p[1] === c1 && p[2] === c2 && p[0] === f[slot[ori]]);
    if (piece < 0) return { ok: false, error: "One corner's three colours don't match any real corner — two of its stickers may be swapped." };
    cube.cp[i] = piece;
    cube.co[i] = ori % 3;
  }

  for (let i = 0; i < EDGE_COUNT; i++) {
    const [a, b] = EDGE_FACELETS[i];
    const straight = EDGE_COLOURS.indexOf(f[a] + f[b]);
    const flipped = EDGE_COLOURS.indexOf(f[b] + f[a]);
    if (straight >= 0) {
      cube.ep[i] = straight;
      cube.eo[i] = 0;
    } else if (flipped >= 0) {
      cube.ep[i] = flipped;
      cube.eo[i] = 1;
    } else {
      return { ok: false, error: "One edge's two colours don't match any real edge — those colours are opposite each other on a cube." };
    }
  }

  const problem = validate(cube);
  if (problem) return { ok: false, error: humanise(problem) };
  return { ok: true, cube };
}

/** The solver's reasons, in the words somebody holding the cube would use. */
function humanise(problem: string): string {
  if (/duplicated|missing/.test(problem)) return "The same piece appears twice. Check for a sticker entered on the wrong face.";
  if (/twist/.test(problem)) return "One corner is twisted in place — a cube can't get like that by turning. Recheck that corner's stickers, or the cube has been taken apart.";
  if (/flip/.test(problem)) return "One edge is flipped in place — a cube can't get like that by turning. Recheck that edge's stickers.";
  if (/parity/.test(problem)) return "Two pieces look swapped — a cube can't get like that by turning. Recheck two pieces of the same kind.";
  return "A real cube can't look like this. Recheck the stickers.";
}
