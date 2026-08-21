import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCES,
  DEFAULT_APPEARANCE_ID,
  DEFAULT_BODY_COLOUR,
  DEFAULT_FACE_COLOURS,
  appearanceById,
  repaintMap,
} from "./cubeAppearance";
import { deltaE, worstPair, type Deficiency } from "./colourVision";

const RED_GREEN: Deficiency[] = ["deuteranopia", "protanopia"];

/**
 * Below this, two faces are a decision rather than a glance.
 *
 * CIE76 ΔE of about 2.3 is the just-noticeable difference; 10 is roughly where
 * two colours stop being separable at a glance, which on a cube being solved
 * against a clock is the same as being wrong.
 */
const CONFUSABLE = 10;

function facesOf(id: string): string[] {
  return Object.values(appearanceById(id).faces);
}

function withBody(id: string): string[] {
  const a = appearanceById(id);
  return [...Object.values(a.faces), a.finish.body];
}

test("every appearance has six distinct faces", () => {
  for (const appearance of APPEARANCES) {
    const faces = Object.values(appearance.faces);
    assert.equal(faces.length, 6, appearance.id);
    assert.equal(new Set(faces).size, 6, `${appearance.id} repeats a colour`);
  }
});

test("no face is confusable with another, for normal vision", () => {
  for (const appearance of APPEARANCES) {
    const faces = Object.values(appearance.faces);
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const distance = deltaE(faces[i], faces[j]);
        assert.ok(
          distance > CONFUSABLE,
          `${appearance.id}: ${faces[i]} and ${faces[j]} are ΔE ${distance.toFixed(1)} apart`,
        );
      }
    }
  }
});

test("no face disappears into its own cube body", () => {
  // A face that matches the plastic is as unreadable as two faces that match
  // each other, and it is the failure a palette designed on white paper makes.
  for (const appearance of APPEARANCES) {
    for (const [face, colour] of Object.entries(appearance.faces)) {
      const distance = deltaE(colour, appearance.finish.body);
      assert.ok(
        distance > CONFUSABLE,
        `${appearance.id}: face ${face} (${colour}) is ΔE ${distance.toFixed(1)} from the body`,
      );
    }
  }
});

test("the high-contrast scheme is genuinely better for red-green deficiency", () => {
  // The property the scheme exists for, and the one it FAILED when its palette
  // was chosen by eye: the first version measured ΔE 9.9 under deuteranopia
  // against classic's 12.8 — worse than the default it was meant to improve on,
  // because magenta desaturates toward grey exactly when the red-green cones
  // are missing. It would have shipped as an accessibility feature that made
  // things harder for the people it named.
  for (const deficiency of RED_GREEN) {
    const contrast = worstPair(withBody("contrast"), deficiency).distance;
    const classic = worstPair(withBody("classic"), deficiency).distance;

    assert.ok(
      contrast > classic,
      `contrast (${contrast.toFixed(1)}) must beat classic (${classic.toFixed(1)}) under ${deficiency}`,
    );
    assert.ok(
      contrast > 25,
      `contrast under ${deficiency} is only ΔE ${contrast.toFixed(1)}`,
    );
  }
});

test("the high-contrast scheme survives blue-yellow deficiency too", () => {
  // Rarer, and no reason to trade it away while fixing the common case.
  const distance = worstPair(withBody("contrast"), "tritanopia").distance;
  assert.ok(distance > CONFUSABLE, `ΔE ${distance.toFixed(1)}`);
});

test("only the schemes that move colours are marked functional", () => {
  // The flag drives what the picker tells somebody, and mislabelling it is how
  // a person ends up verifying a scramble against the wrong cube.
  const functional = APPEARANCES.filter((a) => a.functional).map((a) => a.id).sort();
  assert.deepEqual(functional, ["contrast", "japanese"]);

  // A scheme is functional exactly when a face carries a different colour from
  // the default scheme's — asserted structurally rather than by trusting the
  // flag, so the two cannot drift apart.
  const classic = appearanceById("classic").faces;
  for (const appearance of APPEARANCES) {
    if (appearance.id === "classic") continue;

    const sameLayout = Object.keys(classic).every((face) => {
      const key = face as keyof typeof classic;
      // Compare position, not exact pigment: Carbon is the same layout in
      // deeper paint, and must not count as functional.
      const nearest = (colour: string) =>
        Object.entries(classic).sort(
          (a, b) => deltaE(colour, a[1]) - deltaE(colour, b[1]),
        )[0][0];
      return nearest(appearance.faces[key]) === face;
    });

    assert.equal(
      appearance.functional,
      !sameLayout,
      `${appearance.id} is marked functional=${appearance.functional} but its layout says otherwise`,
    );
  }
});

test("the repaint map covers every default colour", () => {
  // A colour missing from the map is a face that keeps cubing.js's web primary
  // while the other five change — worse than not repainting at all.
  for (const appearance of APPEARANCES) {
    const map = repaintMap(appearance);
    for (const from of Object.values(DEFAULT_FACE_COLOURS)) {
      assert.ok(map.has(from.toLowerCase()), `${appearance.id} misses ${from}`);
    }
    assert.ok(map.has(DEFAULT_BODY_COLOUR.toLowerCase()), `${appearance.id} misses the body`);
    assert.equal(map.size, 7, `${appearance.id} maps ${map.size} colours, expected 7`);
  }
});

test("an unknown id falls back to the default rather than throwing", () => {
  assert.equal(appearanceById("nonsense").id, DEFAULT_APPEARANCE_ID);
  assert.equal(appearanceById(null).id, DEFAULT_APPEARANCE_ID);
  assert.equal(appearanceById(undefined).id, DEFAULT_APPEARANCE_ID);
});

test("the default is a real appearance", () => {
  assert.ok(APPEARANCES.some((a) => a.id === DEFAULT_APPEARANCE_ID));
});

test("no finish is glossy or metallic", () => {
  // A cube is matte ABS. Gloss is the single thing that most makes a rendered
  // cube read as plastic-coloured glass.
  for (const appearance of APPEARANCES) {
    assert.ok(appearance.finish.roughness >= 0.4, `${appearance.id} is too glossy`);
    assert.equal(appearance.finish.metalness, 0, `${appearance.id} is metallic`);
  }
});

test("the default pigments are not cubing.js's web primaries", () => {
  // The whole reason this module exists. If these ever match again, somebody
  // has reverted the correction.
  const faces = facesOf("classic");
  for (const primary of Object.values(DEFAULT_FACE_COLOURS)) {
    assert.ok(
      !faces.map((f) => f.toLowerCase()).includes(primary.toLowerCase()),
      `classic still uses the raw ${primary}`,
    );
  }
});
