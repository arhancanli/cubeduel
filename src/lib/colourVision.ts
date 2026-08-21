/**
 * Simulating how a colour is seen by an eye missing one kind of cone, so that
 * "high contrast" can be a measurement rather than a claim.
 *
 * The high-contrast cube exists because a standard cube is close to worst-case
 * for the commonest form of colour blindness: it puts red beside orange and
 * green beside blue, and red-green deficiency — around one man in twelve —
 * cannot separate either pair. Offering a scheme and *asserting* it is better
 * would be exactly the sort of decoration this project refuses. So the palette
 * is checked.
 *
 * ## The method
 *
 * Viénot, Brettel and Mollon (1999), which is the standard linear
 * approximation: convert to a cone response space, collapse the missing cone
 * onto the plane the remaining two can represent, and convert back. It is an
 * approximation — real dichromacy varies between people and anomalous
 * trichromacy is commoner than true dichromacy — so the numbers here are a
 * floor, not a diagnosis. A palette that survives this survives the hard case.
 *
 * Distances are CIE76 ΔE in Lab. ΔE of about 2.3 is the "just noticeable
 * difference"; anything under about 10 is two colours somebody has to think
 * about, which on a cube being solved against a clock is the same as wrong.
 */

export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

function multiply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** sRGB is gamma-encoded; every transform below needs light, not signal. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const c = Math.max(0, Math.min(1, value));
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

export function hexToRgb(hex: string): Vec3 {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

// Linear sRGB to LMS cone responses, and back.
const RGB_TO_LMS: Mat3 = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
];

const LMS_TO_RGB: Mat3 = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
];

/**
 * The collapse for each deficiency.
 *
 * Each replaces the missing cone's response with the best linear estimate the
 * other two allow — which is exactly what makes the confusing pairs collapse
 * onto each other.
 */
const SIMULATE: Record<Deficiency, Mat3> = {
  protanopia: [
    [0, 1.05118294, -0.05116099],
    [0, 1, 0],
    [0, 0, 1],
  ],
  deuteranopia: [
    [1, 0, 0],
    [0.9513092, 0, 0.04866992],
    [0, 0, 1],
  ],
  tritanopia: [
    [1, 0, 0],
    [0, 1, 0],
    [-0.86744736, 1.86727089, 0],
  ],
};

/** How a colour appears to an eye with the given deficiency. */
export function simulate(hex: string, deficiency: Deficiency): string {
  const rgb = hexToRgb(hex);
  const linear: Vec3 = [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];
  const lms = multiply(RGB_TO_LMS, linear);
  const collapsed = multiply(SIMULATE[deficiency], lms);
  const back = multiply(LMS_TO_RGB, collapsed);
  return `#${back.map((c) => fromLinear(c).toString(16).padStart(2, "0")).join("")}`;
}

// --- Lab, for a distance that means something perceptually -----------------

const D65: Vec3 = [0.95047, 1.0, 1.08883];

function toXyz(hex: string): Vec3 {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Vec3;
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  ];
}

function toLab(hex: string): Vec3 {
  const xyz = toXyz(hex);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(xyz[0] / D65[0]), f(xyz[1] / D65[1]), f(xyz[2] / D65[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE. Crude next to CIEDE2000 and more than good enough for "are these two the same colour". */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/**
 * The closest two colours in a palette, once the given deficiency is applied.
 *
 * The worst pair is the whole story: a palette is only as readable as its most
 * confusable pair, and averaging would let five good separations hide one that
 * makes a cube unsolvable.
 */
export function worstPair(
  colours: string[],
  deficiency: Deficiency,
): { a: string; b: string; distance: number } {
  const seen = colours.map((c) => ({ original: c, simulated: simulate(c, deficiency) }));

  let worst = { a: colours[0], b: colours[1] ?? colours[0], distance: Infinity };
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const distance = deltaE(seen[i].simulated, seen[j].simulated);
      if (distance < worst.distance) {
        worst = { a: seen[i].original, b: seen[j].original, distance };
      }
    }
  }
  return worst;
}
