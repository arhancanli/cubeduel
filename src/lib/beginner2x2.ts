import type { SolveStep } from "./beginner";

/**
 * The 2×2, in three steps.
 *
 * A 2×2 is a 3×3 with only its corners, so the method is the 3×3 beginner
 * method with everything about edges taken away: build one layer, turn the
 * other face to one colour, then put its corners in their places. Three
 * algorithms in total, two of which a 3×3 solver already knows.
 *
 * The instructions — not just the algorithms — are checked in
 * beginner2x2.test.ts: every top layer a real solve can reach is followed
 * through the rules exactly as written, and must come out solved.
 */
export const SOLVE_2X2_STEPS: SolveStep[] = [
  {
    slug: "first-layer",
    number: 1,
    title: "The white layer",
    goal: "All four white stickers on the bottom face, and the two colours on each side of the bottom row matching.",
    idea: [
      "Hold white on the bottom. A 2×2 has no centres to tell you which colour goes where, so the rule is simpler: the four white corners go on the bottom, and the side colours of neighbouring corners must match.",
      "Build it one corner at a time. Find a white corner in the top layer, turn the top until it sits above a place where it fits next to the corners already done, then repeat the trigger until it drops in white-side-down.",
      "The first corner can go anywhere. Every corner after it has only one right place.",
    ],
    algorithms: [
      {
        name: "The trigger",
        alg: "R U R' U'",
        when: "Repeat until the corner above the front-right drops in with white on the bottom. One, three or five goes.",
      },
    ],
    preserves: null,
    note: "This is the 3×3 trigger, used exactly the same way. It briefly lifts a bottom corner out — that is how the new one gets in — so it makes no promise about the rest of the layer.",
  },
  {
    slug: "top-face",
    number: 2,
    title: "The yellow face",
    goal: "The whole top face yellow. The sides can still be mixed up.",
    idea: [
      "Count the yellow stickers on top. If exactly one corner is yellow on top, turn the top so it is at the front-left, and do the algorithm.",
      "If none or two are yellow on top, turn the top until the front-left corner has a yellow sticker facing left, and do the algorithm.",
      "Then look again and repeat. It never takes more than three.",
    ],
    algorithms: [
      {
        name: "Sune",
        alg: "R U R' U R U2 R'",
        when: "Every time, with the top turned as described above.",
      },
    ],
    preserves: "first-layer",
  },
  {
    slug: "top-corners",
    number: 3,
    title: "The top corners",
    goal: "A solved cube.",
    idea: [
      "Look at the sides of the top layer. A side where both top corners show the same colour is called headlights.",
      "If you have headlights, turn the top so they are on the left, and do the first algorithm. If no side has them, do the second.",
      "Then turn the top until everything lines up. One algorithm is always enough.",
    ],
    algorithms: [
      {
        name: "T-perm",
        alg: "R U R' U' R' F R2 U' R' U' R U R' F'",
        when: "Headlights on one side: hold them on the left.",
      },
      {
        name: "Y-perm",
        alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
        when: "No side has headlights.",
      },
    ],
    preserves: "first-layer",
  },
];
