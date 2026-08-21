/**
 * Learning to solve a cube, layer by layer.
 *
 * This is the method almost everybody starts with, and the one this site owes
 * anybody who arrives unable to solve at all. The last-layer library at `/learn`
 * is useless to them: it assumes you already get that far.
 *
 * ## The claim that matters, and why it is checked
 *
 * The thing a beginner is actually afraid of is not forgetting an algorithm. It
 * is doing one and destroying the part they already finished — which is what
 * happens, over and over, and it is why people give up.
 *
 * So every step here states what its algorithms leave alone, and every one of
 * those statements is *derived from the puzzle* in `beginner.test.ts` rather than
 * asserted by whoever wrote the page. Applying an algorithm to a solved cube and
 * comparing orbit by orbit says exactly which slots it disturbs. If a promise
 * here and the algorithm beside it ever disagree, the build fails.
 *
 * That is not a small thing to be able to say. "This will not wreck your first
 * two layers" is the single most load-bearing sentence in any cube tutorial, and
 * on most of them it is simply folklore.
 *
 * ## Slot numbering
 *
 * Derived, not assumed. A U turn moves corners 0-3 and edges 0-3 and nothing
 * else, which is what makes those the last layer; the rest follows and is pinned
 * by a test.
 */

/** Corner slots in the bottom layer — the one a beginner builds first. */
export const FIRST_LAYER_CORNERS = [4, 5, 6, 7];
/** Edge slots in the bottom layer. */
export const FIRST_LAYER_EDGES = [4, 5, 6, 7];
/** The four edges between the layers. */
export const MIDDLE_EDGES = [8, 9, 10, 11];
/** The layer everything else is trying to get to. */
export const LAST_LAYER_CORNERS = [0, 1, 2, 3];
export const LAST_LAYER_EDGES = [0, 1, 2, 3];

/**
 * What a step promises not to disturb.
 *
 * Named regions rather than raw indices, because the promise is shown to a
 * person: "it will not touch your first two layers" is the sentence, and the
 * numbers are how it is checked.
 */
export type Region = "first-layer" | "middle-layer" | "first-two-layers";

export const REGION_LABEL: Record<Region, string> = {
  "first-layer": "the layer you have already built",
  "middle-layer": "the middle layer",
  "first-two-layers": "the two layers you have already built",
};

export function slotsIn(region: Region): {
  corners: number[];
  edges: number[];
} {
  switch (region) {
    case "first-layer":
      return { corners: FIRST_LAYER_CORNERS, edges: FIRST_LAYER_EDGES };
    case "middle-layer":
      return { corners: [], edges: MIDDLE_EDGES };
    case "first-two-layers":
      return {
        corners: FIRST_LAYER_CORNERS,
        edges: [...FIRST_LAYER_EDGES, ...MIDDLE_EDGES],
      };
  }
}

export interface StepAlgorithm {
  name: string;
  alg: string;
  /** When you use this one rather than the other. */
  when: string;
}

export interface SolveStep {
  slug: string;
  /** "1", "2"… shown as the step number. */
  number: number;
  title: string;
  /** What you are trying to end up with. */
  goal: string;
  /** The idea, in the words you would use explaining it to somebody. */
  idea: string[];
  algorithms: StepAlgorithm[];
  /**
   * What the algorithms in this step leave untouched. Null for the steps done
   * by looking rather than by algorithm — claiming a guarantee there would be
   * claiming one for moves nobody specified.
   */
  preserves: Region | null;
  /** The honest note about this step, where there is one. */
  note?: string;
}

export const SOLVE_STEPS: SolveStep[] = [
  {
    slug: "cross",
    number: 1,
    title: "The white cross",
    goal: "Four white edges around the white centre, each matching the colour of the side it sits on.",
    idea: [
      "Pick white and keep it on the bottom for the whole solve. Every instruction after this assumes you did.",
      "Find a white edge, bring it to the top layer, turn the top until it sits above the centre matching its other colour, then turn that face twice to drop it into place.",
      "The second colour is the part people skip. An edge that is white-side-down but sitting over the wrong centre is not solved — it is in the way, and you will pay for it in the next step.",
    ],
    algorithms: [],
    preserves: null,
    note:
      "There is no algorithm here on purpose. The cross is where you learn to look at the cube instead of following instructions, and it is the one part of the solve every good cuber does entirely by eye.",
  },
  {
    slug: "first-layer",
    number: 2,
    title: "The rest of the bottom layer",
    goal: "The whole white face done, and the first row of every side matching its centre.",
    idea: [
      "Find a corner with white on it that is still in the top layer, and turn the top until it is directly above the gap it belongs in.",
      "Then repeat the trigger below until it drops in the right way up. It takes one, three, or five goes depending on how the corner is facing.",
      "If a white corner is stuck in the bottom layer facing the wrong way, do the trigger once to pop it out, then treat it like any other.",
    ],
    algorithms: [
      {
        name: "The trigger",
        alg: "R U R' U'",
        when: "Repeat until the corner goes in the right way up. Four of these and you are back where you started, so you cannot break anything permanently.",
      },
    ],
    preserves: null,
    note:
      "This one deliberately makes no promise about the rest of the bottom layer, because it does briefly take a corner out of it — that is how the corner gets in. What it never touches is your cross.",
  },
  {
    slug: "middle-layer",
    number: 3,
    title: "The middle layer",
    goal: "Two full layers. Only the top face is left.",
    idea: [
      "Look for a top-layer edge with no yellow on it. It belongs between two centres in the middle.",
      "Turn the top until its front colour matches the centre it is in front of — it will look like an upside-down T.",
      "Then send it right or left, depending on which way it needs to go.",
    ],
    algorithms: [
      {
        name: "Send it right",
        alg: "U R U' R' U' F' U F",
        when: "The edge needs to go into the slot on your right.",
      },
      {
        name: "Send it left",
        alg: "U' L' U L U F U' F'",
        when: "The edge needs to go into the slot on your left.",
      },
    ],
    preserves: "first-layer",
    note:
      "If every middle edge is already in place but one is flipped, use either algorithm on it to kick it out, then put it back properly.",
  },
  {
    slug: "yellow-cross",
    number: 4,
    title: "The yellow cross",
    goal: "A yellow cross on top. The corners can still be anything.",
    idea: [
      "Look only at the yellow edges. You will see a dot, an L, a line, or the cross already made.",
      "Do the algorithm with a line lying left-to-right, or with an L in the top-left corner.",
      "A dot needs it three times, an L twice, a line once. It is the same algorithm every time.",
    ],
    algorithms: [
      {
        name: "Make the cross",
        alg: "F R U R' U' F'",
        when: "Every time. Only the way you hold the cube changes.",
      },
    ],
    preserves: "first-two-layers",
  },
  {
    slug: "yellow-face",
    number: 5,
    title: "The whole yellow face",
    goal: "The top face entirely yellow. The sides will still be a mess.",
    idea: [
      "Hold the cube so a yellow corner that is NOT yet facing up sits at your front-left.",
      "Do the algorithm. It will look like you have destroyed the cube. You have not — keep going.",
      "Turn only the top layer to bring the next unsolved corner to front-left, and repeat. Never turn anything else between goes.",
    ],
    algorithms: [
      {
        name: "Turn a corner up",
        alg: "R U R' U R U2 R'",
        when: "Repeat with a different corner at front-left until the whole face is yellow.",
      },
    ],
    preserves: "first-two-layers",
    note:
      "This is the step where people panic and start over. Trust it: as long as you only turn the top face between repetitions, the two layers underneath come back.",
  },
  {
    slug: "last-corners",
    number: 6,
    title: "Put the corners where they belong",
    goal: "Every corner in the right place, even if the sides are not yet matching.",
    idea: [
      "Find a corner already between the two centres whose colours it has. It might not be turned the right way — that is fine, it just has to be in the right corner.",
      "Hold that one at your front-right and do the algorithm. It cycles the other three.",
      "If no corner is in the right place, do it once from anywhere and one will be.",
    ],
    algorithms: [
      {
        name: "Cycle three corners",
        alg: "U R U' L' U R' U' L",
        when: "Repeat until all four corners are in the right places.",
      },
    ],
    preserves: "first-two-layers",
    note: "This one moves no edges at all, so your yellow cross cannot be disturbed by it.",
  },
  {
    slug: "last-edges",
    number: 7,
    title: "Put the last edges where they belong",
    goal: "A solved cube.",
    idea: [
      "If one side is already fully finished, hold it at the back. If none is, do the algorithm once from anywhere and one will be.",
      "Then do the algorithm until it is solved.",
    ],
    algorithms: [
      {
        name: "Cycle three edges",
        alg: "R U' R U R U R U' R' U' R2",
        when: "With the finished side at the back.",
      },
    ],
    preserves: "first-two-layers",
    note: "This one moves no corners at all — the corners you just placed are safe.",
  },
];

export function stepBySlug(slug: string): SolveStep | undefined {
  return SOLVE_STEPS.find((s) => s.slug === slug);
}
