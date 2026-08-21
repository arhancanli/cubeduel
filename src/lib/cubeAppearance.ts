/**
 * How the cube looks.
 *
 * cubing.js renders with pure web primaries — `#00ff00`, `#ff0000`, `#ffff00`,
 * `#0000ff`-ish. Those are not what a cube looks like. Real sticker pigment and
 * real speedcube plastic are deeper and slightly desaturated: Rubik's own red is
 * `#B71234`, not `#FF0000`, and the difference between the two is the whole gap
 * between "a diagram of a cube" and "a cube".
 *
 * So the default here is not a skin. It is a correction.
 *
 * ## Two axes, and only one of them is decoration
 *
 * **The colour scheme is functional.** On the timer the render exists so a cuber
 * can check the scramble they just applied to a physical puzzle actually matches
 * — which means the colours have to match *their* cube. Cubers really do use
 * different schemes: the Japanese scheme puts blue opposite white where the
 * Western one puts yellow, and somebody with a Japanese cube reading a Western
 * render is being shown the wrong answer. Support for it is a feature, not a
 * theme.
 *
 * The same reasoning makes the high-contrast scheme a genuine accessibility
 * feature rather than a nicety. Standard cubes put red next to orange and green
 * next to blue, which are exactly the pairs that red-green colour blindness —
 * around one man in twelve — cannot separate.
 *
 * **The finish is decoration**, and is treated as such: it changes plastic
 * colour and how light behaves on it, never which colour is on which face.
 *
 * ## Nothing here is ever earned, sold, or locked
 *
 * Every appearance is available to everybody from the first second, signed out.
 * Gating any of it behind a rating would turn a skill ladder into a paywall with
 * extra steps, and gating the *functional* axis behind anything at all would
 * mean charging a colourblind cuber to be able to read the cube.
 */

/** The colours cubing.js paints by default, which is what we map away from. */
export const DEFAULT_FACE_COLOURS = {
  U: "#ffffff",
  D: "#ffff00",
  F: "#00ff00",
  B: "#66aaff",
  R: "#ff0000",
  L: "#ffcb00",
} as const;

/** The body plastic, which cubing.js paints black. */
export const DEFAULT_BODY_COLOUR = "#000000";

export type Face = keyof typeof DEFAULT_FACE_COLOURS;

export interface CubeFinish {
  /** The plastic between the stickers. */
  body: string;
  /**
   * 0 is a mirror, 1 is chalk. Speedcube plastic is not glossy — it is a matte
   * ABS that scatters most of what hits it, and rendering it shiny is the single
   * thing that most makes a virtual cube look like plastic-coloured glass.
   */
  roughness: number;
  /**
   * Almost always zero. A cube is not metal, and even a little metalness makes
   * the stickers read as foil.
   */
  metalness: number;
}

export interface CubeAppearance {
  id: string;
  name: string;
  /** One line, shown under the name in the picker. Says what it is *for*. */
  note: string;
  /** True when the scheme changes which colour is on which face. */
  functional: boolean;
  faces: Record<Face, string>;
  finish: CubeFinish;
}

/**
 * The pigments an actual Rubik's-standard cube uses.
 *
 * Not invented and not tuned by eye: these are the published scheme colours.
 * White is very slightly warm because a white sticker under any light is, and a
 * pure `#FFFFFF` face next to five pigments reads as a hole in the cube.
 */
const CLASSIC = {
  U: "#F7F7F4",
  D: "#FFD500",
  F: "#009B48",
  B: "#0046AD",
  R: "#B71234",
  L: "#FF5800",
} as const;

/**
 * Modern stickerless plastic, which is what most competitive cubers now hold.
 *
 * Brighter and cleaner than sticker pigment because the colour is the plastic
 * rather than a vinyl layer over it — there is no adhesive to dull it.
 */
const STICKERLESS = {
  U: "#FCFCFA",
  D: "#FFE03D",
  F: "#00B85C",
  B: "#0F5FD6",
  R: "#E0273E",
  L: "#FF7A29",
} as const;

export const APPEARANCES: CubeAppearance[] = [
  {
    id: "classic",
    name: "Classic",
    note: "Rubik's standard pigments. Matches a stickered cube.",
    functional: false,
    faces: { ...CLASSIC },
    finish: { body: "#101014", roughness: 0.62, metalness: 0 },
  },
  {
    id: "stickerless",
    name: "Stickerless",
    note: "Modern speedcube plastic — brighter, no vinyl to dull it.",
    functional: false,
    faces: { ...STICKERLESS },
    // A stickerless cube has no black body: the plastic IS the colour, so the
    // gaps read as shadow rather than as a frame. Near-black rather than a mid
    // grey, which would look like a stickered cube with grey stickers.
    finish: { body: "#0B0B0D", roughness: 0.55, metalness: 0 },
  },
  {
    id: "carbon",
    name: "Carbon",
    note: "Deeper pigments on a matte black body. Easiest on the eyes at night.",
    functional: false,
    faces: {
      U: "#E8E8E4",
      D: "#E5C22E",
      F: "#0E8A4A",
      B: "#12509E",
      R: "#A81B31",
      L: "#DE5C1C",
    },
    // The most matte of the set. This is the one that reads as an expensive
    // cube rather than a rendered one, and roughness is why.
    finish: { body: "#070709", roughness: 0.78, metalness: 0 },
  },
  {
    id: "pearl",
    name: "Pearl",
    note: "A white-bodied cube. Softer, and the classic look before black plastic.",
    functional: false,
    faces: { ...CLASSIC, U: "#FFFFFF" },
    // The body is a full step darker than it looks like it should be, because
    // a white face on white plastic is the one combination that genuinely
    // disappears — the test measured the first attempt at ΔE 8.1, which is
    // below the threshold at which two colours stop being separable at a
    // glance. Real white cubes have exactly this problem, which is most of why
    // black plastic won; here it is simply fixed.
    finish: { body: "#D2D2CD", roughness: 0.5, metalness: 0 },
  },
  {
    id: "japanese",
    name: "Japanese",
    note: "Blue opposite white, yellow opposite green. Match it to your cube.",
    // The one that changes where colours sit. Somebody with a Japanese-scheme
    // cube reading a Western render is being shown a different puzzle.
    functional: true,
    faces: {
      U: "#F7F7F4",
      D: "#0046AD",
      F: "#009B48",
      B: "#FFD500",
      R: "#B71234",
      L: "#FF5800",
    },
    finish: { body: "#101014", roughness: 0.62, metalness: 0 },
  },
  {
    id: "contrast",
    name: "High contrast",
    note: "Built for red-green colour blindness, and measured rather than claimed.",
    functional: true,
    // ## Derived, not designed by eye
    //
    // A standard cube is close to worst-case for the commonest colour vision
    // deficiency: it puts red beside orange and green beside blue, and
    // red-green deficiency cannot separate either pair.
    //
    // The first attempt at this scheme was chosen by eye — near-white, gold,
    // cyan, navy, magenta, grey — and measuring it showed it was WORSE than the
    // default it was meant to improve on: ΔE 9.9 under deuteranopia against
    // classic's 12.8, because magenta desaturates toward grey exactly when the
    // red-green cones are missing. It would have shipped as an accessibility
    // feature that made things harder for the people it named.
    //
    // These six were searched for instead, maximising the smallest gap between
    // any two faces AND between any face and the plastic — a face that vanishes
    // into the body is as unreadable as two faces that match. `colourVision.ts`
    // does the simulation and `cubeAppearance.test.ts` holds the result to it.
    //
    // Measured separation between faces (CIE76 ΔE; under about 10 is trouble):
    //   normal 63.5 · deuteranopia 34.2 · protanopia 38.5 · tritanopia 20.9
    // against classic's 47.8 / 12.8 / 23.4 / 21.8.
    //
    // Counting the body as a seventh colour the weakest gap is 30.6, which is
    // the number the test enforces — a face that disappears into the plastic is
    // exactly as unreadable as two faces that match.
    faces: {
      U: "#FFFFFF",
      D: "#F2DC2E",
      F: "#5BE88F",
      B: "#1157E0",
      R: "#E01B1B",
      L: "#E01BB8",
    },
    // Mid grey, so both the near-white and the darker faces read against it. A
    // black body would swallow the blue.
    finish: { body: "#55555A", roughness: 0.6, metalness: 0 },
  },
];

export const DEFAULT_APPEARANCE_ID = "classic";

export function appearanceById(id: string | null | undefined): CubeAppearance {
  return (
    APPEARANCES.find((a) => a.id === id) ??
    APPEARANCES.find((a) => a.id === DEFAULT_APPEARANCE_ID)!
  );
}

/**
 * What to repaint, as a map from the colour cubing.js used to the one we want.
 *
 * Built by matching on the *existing* colour rather than by walking the puzzle's
 * structure, because the structure is an experimental API and the colours are
 * observable fact. A mesh whose colour is not in this map is left exactly as it
 * was — so if cubing.js ever changes its palette, the cube renders in its own
 * colours rather than in a half-repainted mess.
 */
export function repaintMap(appearance: CubeAppearance): Map<string, string> {
  const map = new Map<string, string>();
  for (const [face, from] of Object.entries(DEFAULT_FACE_COLOURS)) {
    map.set(from.toLowerCase(), appearance.faces[face as Face]);
  }
  map.set(DEFAULT_BODY_COLOUR.toLowerCase(), appearance.finish.body);
  return map;
}

const STORAGE_KEY = "cubeduel.cube.v1";

/** The chosen appearance, or the default. Never throws. */
export function loadAppearanceId(): string {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE_ID;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return appearanceById(stored).id;
  } catch {
    return DEFAULT_APPEARANCE_ID;
  }
}

export function saveAppearanceId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, appearanceById(id).id);
    // Same-tab listeners: `storage` only fires in OTHER tabs, so a cube on the
    // page that chose the appearance would be the one thing that did not update.
    window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGED));
  } catch {
    // A preference that cannot be saved is not worth breaking a page for.
  }
}

export const APPEARANCE_CHANGED = "cubeduel:appearance-changed";
