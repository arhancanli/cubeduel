import { DEFAULT_EVENT, EVENTS, type EventId } from "./events";
/**
 * Replaying a move stream against a scramble, on either side of the wire.
 *
 * `cubeState.ts` does this in the browser to detect the end of a solve. The server
 * needs the identical calculation to decide whether a submitted solve is real, and
 * "identical" has to mean the same code rather than the same intent — two
 * implementations of cube arithmetic that agree today will disagree eventually,
 * and the disagreement would show up as honest players being rejected.
 *
 * So the puzzle definition and the replay live here, with no `"use client"`, and
 * both sides import them. cubing.js's KPuzzle is pure JavaScript with no WASM and
 * no DOM, and loads in single-digit milliseconds under Node.
 */

const SOLVED_OPTIONS = {
  ignorePuzzleOrientation: true,
  ignoreCenterOrientation: true,
};

export interface Pattern {
  applyMove(move: string): Pattern;
  applyAlg(alg: string): Pattern;
  experimentalIsSolved(options: typeof SOLVED_OPTIONS): boolean;
  /**
   * Raw orbit data. The trainer needs it to ask a narrower question than "is the
   * cube solved" — an OLL drill finishes the moment the last layer is *oriented*,
   * which is several moves before the puzzle is done.
   */
  patternData: Record<string, { pieces: number[]; orientation: number[] }>;
}

interface KPuzzleLike {
  defaultPattern(): Pattern;
}

const kpuzzlePromises = new Map<EventId, Promise<KPuzzleLike>>();

/**
 * The puzzle definition for an event, cached for the lifetime of the process.
 *
 * One cache per event rather than one shared promise. The shared version was
 * correct while 3x3 was the only event and would have been a nasty bug the
 * moment it was not: whichever event asked first would have been handed to every
 * other, so a 4x4 solve would have been replayed against a 3x3 and rejected —
 * or, far worse, a 2x2 scramble replayed on a 3x3 and *accepted* as solved
 * because the extra pieces were never disturbed.
 */
export function loadKPuzzle(event: EventId = DEFAULT_EVENT): Promise<KPuzzleLike> {
  const existing = kpuzzlePromises.get(event);
  if (existing) return existing;

  const created = import("cubing/puzzles").then(
    (m) => m.puzzles[EVENTS[event].puzzle].kpuzzle() as unknown as Promise<KPuzzleLike>,
  );
  kpuzzlePromises.set(event, created);
  return created;
}

/**
 * The 24 ways a cube can be sitting on the table.
 *
 * A solve that ends with the cube rotated is still a solve — players rotate
 * constantly, and finishing with green on top instead of white is not a failure.
 * cubing.js handles this for the puzzles it supports via `ignorePuzzleOrientation`;
 * for the ones it does not, this reproduces it by trying every orientation.
 *
 * Six faces can be on top, and each of those has four positions.
 */
const ORIENTATIONS: string[] = ["", "x", "x2", "x'", "z", "z'"].flatMap((toTop) =>
  ["", "y", "y2", "y'"].map((spin) => [toTop, spin].filter(Boolean).join(" ")),
);

/**
 * Whether a pattern is solved.
 *
 * cubing.js can answer this for 2x2 and 3x3 and throws for 4x4 and 5x5 —
 * `experimentalIsPatternSolved() is not supported for this puzzle at the
 * moment`. So big cubes get the check written out here, and the two are pinned
 * against each other on the puzzles where both work, rather than left to drift.
 *
 * The subtlety that makes a naive version wrong: **centre pieces of the same
 * colour are interchangeable.** A 4x4 has four centres per face and they are
 * physically identical, so a correctly solved cube almost never has them in
 * their original slots. Demanding exact positions would reject nearly every
 * genuine big-cube solve — and it would do it to honest players only, since
 * anyone cheating submits whatever passes.
 */
export function isSolvedPattern(pattern: Pattern, event: EventId = DEFAULT_EVENT): boolean {
  if (SUPPORTED_BY_CUBING_JS.has(event)) {
    return pattern.experimentalIsSolved(SOLVED_OPTIONS);
  }
  return ORIENTATIONS.some((rotation) =>
    isSolvedInPlace(rotation ? pattern.applyAlg(rotation) : pattern),
  );
}

/** Events whose solved-check cubing.js implements, and which therefore use it. */
const SUPPORTED_BY_CUBING_JS = new Set<EventId>(["222", "333"]);

/**
 * Solved with the cube in this exact orientation.
 *
 * Exported for the test that pins it against cubing.js on 2x2 and 3x3.
 */
export function isSolvedInPlace(pattern: Pattern): boolean {
  for (const [orbit, state] of Object.entries(pattern.patternData)) {
    const { pieces, orientation } = state;

    // Centre orbits carry a single orientation and six identical groups — one
    // per face. Membership of the right group is what "solved" means for them.
    const identicalWithinFace = orientation.every((o) => o === 0) && pieces.length % 6 === 0
      ? pieces.length / 6
      : 1;

    if (identicalWithinFace > 1 && isCentreOrbit(orbit)) {
      for (let i = 0; i < pieces.length; i++) {
        if (Math.floor(pieces[i] / identicalWithinFace) !== Math.floor(i / identicalWithinFace)) {
          return false;
        }
      }
      continue;
    }

    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i] !== i) return false;
      // Centre orientation is ignored throughout this app, matching
      // `ignoreCenterOrientation` — a solved cube with a rotated centre sticker
      // is solved to everyone except a supercube solver.
      if (!isCentreOrbit(orbit) && orientation[i] !== 0) return false;
    }
  }
  return true;
}

function isCentreOrbit(orbit: string): boolean {
  return orbit.toUpperCase().startsWith("CENTER") || orbit.toUpperCase().startsWith("CENTRE");
}

/**
 * A single move: optional layer count, a face or rotation, optional wide marker,
 * optional double or prime. Deliberately the same shape as the scramble-link
 * allowlist in `scrambleParam.ts` — both guard the same algorithm parser against
 * the same untrusted input.
 */
export const MOVE_PATTERN = /^(\d+)?([UDFBLRMESudfblrxyz])(w)?(['2]|2'|'2)?$/;

export function isValidMove(move: string): boolean {
  return MOVE_PATTERN.test(move);
}

/**
 * Applies a scramble and then a solution, and reports whether the cube ends
 * solved. Throws nothing: an unparseable move is a `false`, because this sits
 * behind an HTTP handler and a malformed submission is a rejection, not a 500.
 */
export async function replaySolves(
  scramble: string,
  moves: readonly string[],
  event: EventId = DEFAULT_EVENT,
): Promise<boolean> {
  const kpuzzle = await loadKPuzzle(event);
  try {
    let pattern = kpuzzle.defaultPattern().applyAlg(scramble);
    for (const move of moves) {
      if (!isValidMove(move)) return false;
      pattern = pattern.applyMove(move);
    }
    return isSolvedPattern(pattern, event);
  } catch {
    return false;
  }
}
