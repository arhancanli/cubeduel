/**
 * How often the solve review reads a solve correctly — measured, not assumed.
 *
 * Builds CFOP solves whose true phases are known exactly: a solution is put
 * together from parts that each complete one milestone — cross turns, four F2L
 * inserts from the verified 41 cases (turned to each slot), an OLL and a PLL
 * from the site's case lists, with random turns of the top between — and the
 * scramble is its inverse. Every later part preserves what the earlier ones
 * built, so where each phase ends, and which last-layer cases came up, is
 * known to the move. Each solve is read by the same `analyzeSolve` the review
 * uses, and every boundary and case is compared.
 *
 * Run at scale by `scripts/audit-review.mts`; a smaller run is a unit test.
 */
import f2lCases from "../data/f2l.json";
import { analyzeSolve } from "./cfop";
import { HTM_MOVES } from "./crossSolver";
import { learnCases } from "./learn";
import { cubeFromAlg } from "./solver/cube";

/** The bottom cross, checked on the cubie model — independently of the analyser. */
const crossDone = (alg: string) => {
  const c = cubeFromAlg(alg);
  return [4, 5, 6, 7].every((i) => c.ep[i] === i && c.eo[i] === 0);
};

const invert = (alg: string) =>
  alg.split(/\s+/).filter(Boolean).reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`)).join(" ");

// Turning the whole cube about U carries the front-right slot to each of the
// others; relabelling the side faces does the same to an algorithm.
const SIDES = ["F", "R", "B", "L"];
const shift = (alg: string, k: number) =>
  alg.split(/\s+/).filter(Boolean).map((m) => {
    const i = SIDES.indexOf(m[0]);
    return (i < 0 ? m[0] : SIDES[(i + k) % 4]) + m.slice(1);
  }).join(" ");

const AUF = ["", "U", "U'", "U2"];

export interface ReviewAudit {
  solves: number;
  phasesInOrder: number;
  boundaries: number;
  boundariesRight: number;
  ollRight: number;
  pllRight: number;
  misreads: string[];
}

export async function auditReview(count: number, startSeed = 1): Promise<ReviewAudit> {
  let seed = startSeed;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const cases = await learnCases();
  const olls = cases.filter((c) => c.stage === "OLL");
  const plls = cases.filter((c) => c.stage === "PLL");

  const audit: ReviewAudit = { solves: 0, phasesInOrder: 0, boundaries: 0, boundariesRight: 0, ollRight: 0, pllRight: 0, misreads: [] };
  const miss = (line: string) => audit.misreads.length < 12 && audit.misreads.push(line);

  for (let n = 0; n < count; n++) {
    const cross: string[] = [];
    while (cross.length < 7) {
      const m = pick(HTM_MOVES);
      if (cross.length && cross[cross.length - 1][0] === m[0]) continue;
      cross.push(m);
    }
    const slots = [0, 1, 2, 3].sort(() => rand() - 0.5);
    const steps = [{ phase: "Cross", alg: cross.join(" ") }];
    for (const [i, slot] of slots.entries()) {
      const c = pick(f2lCases as { alg: string }[]);
      steps.push({ phase: `F2L ${i + 1}`, alg: [pick(AUF), shift(c.alg, slot)].join(" ").trim() });
    }
    const oll = pick(olls);
    const pll = pick(plls);
    steps.push({ phase: "OLL", alg: [pick(AUF), oll.alg].join(" ").trim() });
    steps.push({ phase: "PLL", alg: [pick(AUF), pll.alg, pick(AUF)].join(" ").trim() });

    const scramble = invert(steps.map((s) => s.alg).join(" "));
    // 150ms a turn, and a pause at every phase change — recognition.
    const timed: { move: string; atMs: number }[] = [];
    const truth: { phase: string; endMs: number }[] = [];
    let t = 0;
    for (const s of steps) {
      t += 600;
      for (const m of s.alg.split(/\s+/).filter(Boolean)) {
        t += 150;
        timed.push({ move: m, atMs: t });
      }
      truth.push({ phase: s.phase, endMs: t });
    }
    // The cross ends the first time it is complete. Random turns can finish it
    // early and then wander — a trigger, or D2 U2 D2 — without changing it.
    // Everything after the cross preserves it, so it is complete after turn i
    // exactly when the cross turns still to come leave a solved cross alone:
    // face turns only, which the cubie model answers without touching the
    // rotations and wide turns in the last-layer algorithms.
    for (let i = 1; i <= cross.length; i++) {
      const rest = cross.slice(i).join(" ");
      if (rest === "" || crossDone(invert(rest))) {
        truth[0].endMs = timed[i - 1].atMs;
        break;
      }
    }

    const a = await analyzeSolve(scramble, timed);
    audit.solves++;
    const read = a.splits.map((s) => ({ phase: s.phase, endMs: s.endMs }));
    const order = read.map((r) => r.phase).join(",");
    if (order === truth.map((r) => r.phase).join(",")) audit.phasesInOrder++;
    for (const want of truth) {
      audit.boundaries++;
      const got = read.find((r) => r.phase === want.phase);
      if (got && got.endMs === want.endMs) audit.boundariesRight++;
      else miss(`#${n} ${want.phase}: truth ${want.endMs}, read ${got ? got.endMs : "missing"} | ${order}`);
    }
    if (a.ollCase === oll.caseId) audit.ollRight++;
    else miss(`#${n} OLL: truth ${oll.caseId}, read ${a.ollCase}`);
    if (a.pllCase === pll.caseId) audit.pllRight++;
    else miss(`#${n} PLL: truth ${pll.caseId}, read ${a.pllCase}`);
  }
  return audit;
}
