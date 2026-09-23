/**
 * The six faces.
 *
 * Every competitive mode owns one sticker colour, and the assignment is not a
 * palette someone picked: it is the standard Western colour scheme laid out as a
 * cube net. White on top, yellow underneath, green facing you, red to the right,
 * orange to the left, blue at the back. The home page draws exactly that net, so
 * a colour always means the same place — the sidebar swatch, the tile, the
 * accent on the mode's own page.
 *
 * Solve sits on the front face because it is the one you look at first. It is
 * also why the primary button everywhere is green.
 *
 * No directive on this module: it is read by server pages and client components
 * alike, and a "use client" constant imported by a server module is a reference
 * proxy, not the value.
 */

export type FaceKey = "daily" | "race" | "solve" | "ranked" | "duel" | "rush";

export type Sticker = "white" | "orange" | "green" | "red" | "blue" | "yellow";

export interface Face {
  key: FaceKey;
  label: string;
  href: string;
  /** The cube face this mode occupies in the net. */
  face: "U" | "L" | "F" | "R" | "B" | "D";
  sticker: Sticker;
  /** Net position, column then row, on a 4×3 grid. */
  cell: [number, number];
  /** One line, written as what you do there. */
  blurb: string;
  /**
   * A 3×3 pictogram, read row by row. "1" is a sticker in the face colour, "0"
   * an unlit one. Each is drawn to say something about the mode rather than to
   * look busy: Daily is a whole solved face, Rush a shape that narrows.
   */
  glyph: string;
}

export const FACES: readonly Face[] = [
  {
    key: "daily",
    label: "Daily",
    href: "/daily",
    face: "U",
    sticker: "white",
    cell: [1, 0],
    blurb: "One scramble for everyone. One attempt.",
    glyph: "111111111",
  },
  {
    key: "race",
    label: "Race",
    href: "/race",
    face: "L",
    sticker: "orange",
    cell: [0, 1],
    blurb: "Send a link. Solve the same cube at once.",
    glyph: "110110000",
  },
  {
    key: "solve",
    label: "Solve",
    href: "/timer",
    face: "F",
    sticker: "green",
    cell: [1, 1],
    blurb: "Timer, keyboard or smart cube. No account.",
    glyph: "010111010",
  },
  {
    key: "ranked",
    label: "Ranked",
    href: "/ranked",
    face: "R",
    sticker: "red",
    cell: [2, 1],
    blurb: "A rating you can read back as seconds.",
    glyph: "001011111",
  },
  {
    key: "duel",
    label: "Duel",
    href: "/duel",
    face: "B",
    sticker: "blue",
    cell: [3, 1],
    blurb: "Five solves against one opponent.",
    glyph: "101000101",
  },
  {
    key: "rush",
    label: "Rush",
    href: "/rush",
    face: "D",
    sticker: "yellow",
    cell: [1, 2],
    blurb: "Beat a target that tightens every time.",
    glyph: "111011001",
  },
] as const;

export function faceFor(key: FaceKey): Face {
  const face = FACES.find((f) => f.key === key);
  if (!face) throw new Error(`no face for ${key}`);
  return face;
}

/** The CSS custom property holding a sticker's colour. */
export function stickerVar(sticker: Sticker): string {
  return `var(--sticker-${sticker})`;
}
