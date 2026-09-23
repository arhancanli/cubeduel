"use client";

import { appearanceById, repaintMap, type CubeAppearance } from "./cubeAppearance";

/**
 * Repaints a rendered cube.
 *
 * cubing.js exposes no way to choose sticker colours — its `colorScheme` option
 * is a light/dark theme for the surrounding UI, not the puzzle. What it does
 * expose is the Three.js object, so the colours are changed where they actually
 * live: on the materials.
 *
 * ## Everything here is written to fail into "unchanged"
 *
 * `experimentalCurrentThreeJSPuzzleObject` is, as the name says, experimental.
 * If it disappears, throws, or hands back something with a different shape, the
 * cube keeps cubing.js's own colours — which are correct, just harsher. A cube
 * that renders plainly is a fine outcome; a half-repainted one, or a page that
 * crashed trying, is not.
 *
 * Materials are matched by the colour they already are rather than by walking
 * the puzzle's structure. The structure is the experimental part; the colours
 * are observable fact, and a mesh whose colour is not recognised is left alone.
 *
 * ## The original colour is remembered, and it has to be
 *
 * The map goes FROM cubing.js's palette, so once a material has been repainted
 * it no longer matches anything and a second repaint does nothing at all. That
 * is not theoretical — it is what the first version of this did: the default
 * pigments applied correctly, and then every other appearance was silently a
 * no-op. The material inspection said "repainted: 0" and the page looked fine,
 * which is why the check that found it compares SCREENSHOT HASHES rather than
 * asking the code what it thinks it did.
 *
 * So the colour a material was born with is stashed in `userData` the first
 * time it is seen, and every repaint after that maps from there.
 */

/** Where the birth colour is kept. Namespaced so nothing else collides with it. */
const ORIGINAL_KEY = "cubeduelOriginalColour";

interface ThreeColour {
  getHexString?(): string;
  set(value: string): void;
  setStyle?(value: string, colorSpace?: string): void;
}

/**
 * Paints a colour so it appears on screen as written.
 *
 * Three.js takes a hex string to be sRGB and converts it to linear light for
 * lighting maths, expecting the renderer to convert back on output. cubing.js's
 * renderer does not convert back — so every repainted sticker came out darker,
 * mid-tones worst: Rubik's red #B71234 was drawn as #780104, blue #0046AD as
 * #00106B, and red and orange were hard to tell apart on the very cube a cuber
 * checks their scramble against. Declaring the value already linear stores it
 * untouched, which is what this renderer shows.
 */
export function paint(colour: ThreeColour, hex: string): void {
  if (typeof colour.setStyle === "function") {
    colour.setStyle(hex, "srgb-linear");
  } else {
    colour.set(hex);
  }
}

interface ThreeMaterial {
  color?: ThreeColour;
  roughness?: number;
  metalness?: number;
  needsUpdate?: boolean;
  /** Three.js's per-object scratch space, which is where the original goes. */
  userData?: Record<string, unknown>;
}

interface ThreeObject {
  traverse(visit: (node: ThreeNode) => void): void;
}

interface ThreeNode {
  isMesh?: boolean;
  material?: ThreeMaterial | ThreeMaterial[];
}

type Repaintable = HTMLElement & {
  experimentalCurrentThreeJSPuzzleObject?: (
    scheduled?: () => void,
  ) => Promise<ThreeObject>;
};

/**
 * The attribute the scramble travels on, re-set to nudge a redraw.
 *
 * TwistyPlayer draws on demand rather than every frame, and changing a material
 * does not tell it anything has changed — so a repaint after the first frame
 * updates every material and leaves the picture exactly as it was. That is not
 * a guess: the repaint reported 134 materials changed while a screenshot hash
 * stayed byte-identical, which is the only reason it was caught.
 *
 * Re-setting an attribute to the value it already holds is the smallest thing
 * that makes the player schedule a frame. It is a nudge rather than a real
 * state change, so nothing about the cube's position moves.
 */
const REDRAW_NUDGE_ATTR = "experimental-setup-alg";

export interface RepaintResult {
  /** How many materials were recognised and changed. */
  repainted: number;
  /** How many were left alone because their colour was not recognised. */
  skipped: number;
}

/**
 * Applies an appearance to a live player. Resolves to null when it could not.
 *
 * The count is returned rather than a boolean because "it ran" and "it changed
 * something" are different claims, and only the second one is worth making. A
 * repaint that touched zero materials means the palette stopped matching, and
 * the e2e suite asserts a non-zero count for exactly that reason.
 */
export async function applyAppearance(
  player: HTMLElement | null,
  appearanceOrId: CubeAppearance | string,
): Promise<RepaintResult | null> {
  if (!player) return null;

  const target = player as Repaintable;
  if (typeof target.experimentalCurrentThreeJSPuzzleObject !== "function") return null;

  const appearance =
    typeof appearanceOrId === "string" ? appearanceById(appearanceOrId) : appearanceOrId;
  const wanted = repaintMap(appearance);

  let object: ThreeObject;
  try {
    object = await target.experimentalCurrentThreeJSPuzzleObject();
  } catch {
    return null;
  }

  let repainted = 0;
  let skipped = 0;

  try {
    object.traverse((node) => {
      if (!node.isMesh || !node.material) return;

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material?.color) continue;

        // The colour this material started with, which is what the map is
        // keyed on. Recorded once, on first sight, before anything changes it.
        material.userData ??= {};
        if (typeof material.userData[ORIGINAL_KEY] !== "string") {
          material.userData[ORIGINAL_KEY] = `#${material.color.getHexString?.() ?? ""}`.toLowerCase();
        }
        const original = material.userData[ORIGINAL_KEY] as string;

        const next = wanted.get(original);
        if (!next) {
          skipped++;
          continue;
        }

        paint(material.color, next);

        // The finish is what separates a rendered cube from a photographed one.
        // Speedcube ABS scatters most of the light that hits it; leaving the
        // default gloss makes every face read as wet plastic.
        if (typeof material.roughness === "number") {
          material.roughness = appearance.finish.roughness;
        }
        if (typeof material.metalness === "number") {
          material.metalness = appearance.finish.metalness;
        }

        material.needsUpdate = true;
        repainted++;
      }
    });
  } catch {
    // Partway through is the one state worth avoiding, and it is also
    // unavoidable — so it is reported rather than hidden, and the caller can
    // decide. In practice a traversal that throws means the object shape
    // changed, which is the case the whole module is written to survive.
    nudgeRedraw(target);
    return { repainted, skipped };
  }

  nudgeRedraw(target);
  return { repainted, skipped };
}

/** Asks the player for a frame, without changing anything it renders. */
function nudgeRedraw(player: HTMLElement): void {
  try {
    const current = player.getAttribute(REDRAW_NUDGE_ATTR);
    if (current === null) return;
    // Cleared and restored rather than set to the same value: setting an
    // attribute to what it already is does not always count as a change.
    player.removeAttribute(REDRAW_NUDGE_ATTR);
    player.setAttribute(REDRAW_NUDGE_ATTR, current);
  } catch {
    // A cube that did not redraw is a cube in the old colours, which is a
    // cosmetic disappointment and nothing more.
  }
}
