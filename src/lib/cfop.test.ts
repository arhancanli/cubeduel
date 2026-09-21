import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeSolve, type TimedMove } from "./cfop";
import { buildNameTable } from "./caseStats";

/** These tests are about phase splitting; case ids are covered in lastLayer.test.ts. */
const splitsOf = async (scramble: string, moves: TimedMove[]) =>
  (await analyzeSolve(scramble, moves)).splits;

/** Turns an algorithm into timed moves at a fixed cadence. */
function timed(alg: string, msPerMove = 100): TimedMove[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((move, i) => ({ move, atMs: (i + 1) * msPerMove }));
}

function invert(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
    .join(" ");
}

const names = (splits: { phase: string }[]) => splits.map((s) => s.phase);

test("a scramble that only permutes the last layer is a pure PLL solve", async () => {
  // A single U turn leaves the cross, every F2L pair and last-layer orientation
  // intact — nothing but permutation is wrong.
  const splits = await splitsOf("U", timed("U'"));
  assert.deepEqual(names(splits), ["PLL"]);
  assert.equal(splits[0].moveCount, 1);
});

test("last-layer algs do not get their F2L churn credited as F2L phases", async () => {
  // A T-perm rips the front-right pair out and puts it back mid-algorithm. Scanning
  // for the last moment each pair was solved would report four F2L phases here.
  const tPerm = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const splits = await splitsOf(invert(tPerm), timed(tPerm));
  assert.deepEqual(names(splits), ["PLL"], `got ${names(splits).join(", ")}`);
});

test("a PLL skip is reported as no PLL phase, not a zero-length one", async () => {
  // Sune here both orients and finishes the cube, so permutation was already
  // correct — a PLL skip. Real, common, and it must not show up as a phantom
  // 0.00s PLL.
  const sune = "R U R' U R U2 R'";
  const splits = await splitsOf(invert(sune), timed(sune));
  assert.deepEqual(names(splits), ["OLL"], `got ${names(splits).join(", ")}`);
  assert.ok(splits.every((s) => s.durationMs > 0), "no zero-length phases");
});

/**
 * A CFOP solve in which every step completes exactly one milestone and nothing
 * else, so each phase must end on its step's last move.
 *
 * Found by search rather than written by hand. The previous fixture was
 * described as exactly this and was not: its third step finished two pairs and
 * its fifth finished none, which nothing noticed because the test only checked
 * the phase NAMES — right names, wrong boundaries. Each pair step here is a
 * setup-first commutator on its own slot, so the insertion is the final move and
 * no other slot is disturbed.
 */
const CLEAN_SOLVE = [
  "D2 R' D'", // cross
  "U R U' R'", // pair 1
  "U R' U' R", // pair 2
  "U L U' L'", // pair 3
  "U L' U' L", // pair 4
  "R U R' U R U2 R'", // OLL (sune)
  "R U R' U' R' F R2 U' R' U' R U R' F'", // PLL (T-perm)
];

test("a full solve reports cross, four F2L pairs, OLL and PLL in order", async () => {
  const solution = CLEAN_SOLVE.join(" ");
  const moves = timed(solution);
  const splits = await splitsOf(invert(solution), moves);
  assert.deepEqual(
    names(splits),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
    `got ${names(splits).join(", ")}`,
  );

  // Each phase ends on the last move of its own step — the names alone can be
  // right while every boundary is wrong.
  let index = 0;
  CLEAN_SOLVE.forEach((step, i) => {
    index += step.split(" ").length;
    assert.equal(splits[i].endMs, moves[index - 1].atMs, `${splits[i].phase} ends on its step`);
  });

  // Phases must tile the solve exactly: no gaps, no overlap, nothing lost.
  const totalTurns = moves.filter((m) => !/^[xyz]/.test(m.move)).length;
  assert.equal(
    splits.reduce((a, s) => a + s.moveCount, 0),
    totalTurns,
    "every turn belongs to exactly one phase",
  );
  assert.equal(splits[0].startMs, 0);
  assert.equal(splits.at(-1)!.endMs, moves.at(-1)!.atMs);
  for (let i = 1; i < splits.length; i++) {
    assert.equal(splits[i].startMs, splits[i - 1].endMs, "phases are contiguous");
  }
});

test("phase detection survives cube rotations mid-solve", async () => {
  // The same solve, with the cube turned in the hands partway through. Cubers rotate
  // constantly during F2L; if rotations were not cancelled, "the cross edges" would
  // stop referring to the pieces actually solved.
  const plain = "D2 R' D' R U R' U' L' U L";
  const rotated = "D2 R' D' y R U R' y' U' L' U L";

  const a = await splitsOf(invert(plain), timed(plain));
  const b = await splitsOf(invert(rotated), timed(rotated));

  assert.deepEqual(names(a), names(b), `${names(a)} vs ${names(b)}`);
  assert.ok(names(a).includes("Cross"));
  // Rotations are not turns, so they never inflate a phase's move count.
  assert.equal(
    a.reduce((s, p) => s + p.moveCount, 0),
    b.reduce((s, p) => s + p.moveCount, 0),
  );
});

test("a scramble that leaves the cross standing does not bill it as a cross phase", async () => {
  // U-layer-only scramble: the cross is already there before the solver touches it.
  const splits = await splitsOf("U R U' R'", timed("R U R' U'"));
  assert.ok(!names(splits).includes("Cross"), `got ${names(splits).join(", ")}`);
});

test("an abandoned solve is reported as unfinished, not as a PLL", async () => {
  const splits = await splitsOf("R U R' U' F' U F", timed("F' U' F"));
  assert.equal(splits.at(-1)!.phase, "Unfinished");
});

test("no moves means no analysis rather than a crash", async () => {
  assert.deepEqual(await splitsOf("R U R'", []), []);
});

test("per-phase turn speed is derived from that phase alone", async () => {
  const sune = "R U R' U R U2 R'";
  const splits = await splitsOf(invert(sune), timed(sune, 100));
  const oll = splits.find((s) => s.phase === "OLL")!;
  // Seven moves at one per 100ms is 10 turns per second.
  assert.equal(oll.moveCount, 7);
  assert.ok(Math.abs(oll.tps - 10) < 0.001, `tps was ${oll.tps}`);
});

test("the last-layer case is read at true F2L completion, not mid-insertion", async () => {
  // The pair-crediting loop can credit a slot the instant it first looks solved,
  // which may fall inside an insertion while another pair is momentarily out.
  // Reading orientation there yields a corner-twist sum no real cube can have.
  const solution = [
    "D2 R' D'",
    "U R U' R'",
    "U' L' U L",
    "U' R' U R",
    "U L U' L'",
    "R U R' U R U2 R'", // sune
    "R U R' U' R' F R2 U' R' U' R U R' F'", // T-perm
  ].join(" ");

  const { ollCase, pllCase } = await analyzeSolve(invert(solution), timed(solution));
  assert.ok(ollCase, "an OLL case must be identified");
  assert.ok(pllCase, "a PLL case must be identified");

  // Corner orientations of a legal cube always sum to 0 mod 3.
  const twist = ollCase!
    .split("|")[0]
    .split("")
    .reduce((a, d) => a + Number(d), 0);
  assert.equal(twist % 3, 0, `corner twist sum ${twist} is impossible on a real cube`);

  // And it must be the case the solve actually had: sune, finished by a T-perm.
  const names = await buildNameTable();
  assert.equal(names.get(ollCase!), "Sune");
  assert.equal(names.get(pllCase!), "T-perm");
});

test("a cross built on any face is analysed, not just a D-face cross", async () => {
  // Cubers do not all build on the same face, and colour-neutral solvers pick per
  // scramble. This is the same verified CFOP solve rotated by x2, so the cross now
  // sits on U. Anchoring the analysis to D reported the whole thing as one "Cross"
  // phase covering 100% of the solve — confidently wrong, and invisible.
  const X2: Record<string, string> = { U: "D", D: "U", F: "B", B: "F", R: "R", L: "L" };
  const rotate = (alg: string) =>
    alg
      .split(/\s+/)
      .map((m) => X2[m[0]] + m.slice(1))
      .join(" ");

  const dCross = [
    "D2 R' D'",
    "U R U' R'",
    "U' L' U L",
    "U' R' U R",
    "U L U' L'",
    "R U R' U R U2 R'",
    "R U R' U' R' F R2 U' R' U' R U R' F'",
  ].join(" ");
  const uCross = rotate(dCross);

  const splits = await splitsOf(invert(uCross), timed(uCross));
  assert.deepEqual(
    names(splits),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
    `got ${names(splits).join(", ")}`,
  );

  // And it must not collapse into one phase swallowing the whole solve.
  assert.ok(splits[0].durationMs < splits.reduce((a, s) => a + s.durationMs, 0) * 0.5);
});

// ---------------------------------------------------------------------------
// Recognition: the time before a phase's first turn
// ---------------------------------------------------------------------------

/**
 * A solve at a steady 100ms per move, with a stated pause before each step's
 * first move. The first move lands at 0 because that is where the recorder
 * starts the clock — inspection is never inside a solve.
 */
function paced(steps: { alg: string; pauseBefore: number }[], msPerMove = 100): TimedMove[] {
  const out: TimedMove[] = [];
  let clock = 0;
  for (const { alg, pauseBefore } of steps) {
    alg
      .trim()
      .split(/\s+/)
      .forEach((move, i) => {
        if (out.length > 0) clock += msPerMove;
        if (i === 0 && out.length > 0) clock += pauseBefore;
        out.push({ move, atMs: clock });
      });
  }
  return out;
}


test("each phase's recognition is the pause before its first turn, measured not inferred", async () => {
  const pauses = [0, 900, 400, 1300, 250, 700, 1100];
  const moves = paced(CLEAN_SOLVE.map((alg, i) => ({ alg, pauseBefore: pauses[i] })));
  const splits = await splitsOf(invert(CLEAN_SOLVE.join(" ")), moves);

  assert.deepEqual(names(splits), ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"]);
  // The cross starts at the clock's zero, which is its first turn: nothing to see.
  assert.equal(splits[0].recognitionMs, 0);
  // Every later phase: exactly the stated pause. The gap before a phase's first
  // turn is the pause PLUS the ordinary 100ms it takes to make that turn, and
  // the turn is the hands' time, not the eyes'.
  splits.slice(1).forEach((split, i) => {
    assert.equal(split.recognitionMs, pauses[i + 1], `${split.phase}`);
  });
});

test("recognition and execution partition the phase exactly", async () => {
  const moves = paced(CLEAN_SOLVE.map((alg, i) => ({ alg, pauseBefore: 300 * i })));
  const splits = await splitsOf(invert(CLEAN_SOLVE.join(" ")), moves);
  for (const split of splits) {
    const recognition = split.recognitionMs!;
    assert.ok(recognition >= 0, `${split.phase} recognition ${recognition}`);
    assert.ok(recognition <= split.durationMs, `${split.phase} recognition exceeds its phase`);
  }
});

test("a rotation to look at the next pair is recognition, not execution", async () => {
  // Turning the cube in the hands to bring a pair round is part of seeing what to
  // do. Here the solver rotates away and back during the pause before pair 2 —
  // the cube state is unchanged, so the only question is whether the rotation
  // ended the pause. It must not: only the first TURN ends recognition.
  const pauses = [0, 400, 1200, 400, 400, 400, 400];
  const plain = paced(CLEAN_SOLVE.map((alg, i) => ({ alg, pauseBefore: pauses[i] })));

  const pair2Start = CLEAN_SOLVE.slice(0, 2).join(" ").split(" ").length;
  const firstTurnAt = plain[pair2Start].atMs;
  const looked: TimedMove[] = [
    ...plain.slice(0, pair2Start),
    { move: "y", atMs: firstTurnAt - 900 },
    { move: "y'", atMs: firstTurnAt - 500 },
    ...plain.slice(pair2Start),
  ];

  const scramble = invert(CLEAN_SOLVE.join(" "));
  const a = await splitsOf(scramble, plain);
  const b = await splitsOf(scramble, looked);
  const pair2 = (splits: typeof a) => splits.find((s) => s.phase === "F2L 2")!;

  assert.deepEqual(names(a), names(b));
  assert.equal(pair2(a).recognitionMs, 1200);
  assert.equal(pair2(b).recognitionMs, 1200, "the rotation did not end the pause");
  assert.equal(pair2(b).moveCount, pair2(a).moveCount, "rotations are not turns");
});

test("steady turning reads as its real speed once the looking is taken out", async () => {
  // 10 turns a second throughout, with half-second looks between steps. The
  // hands never changed speed, so every phase's turning must come out at 10.
  const moves = paced(CLEAN_SOLVE.map((alg, i) => ({ alg, pauseBefore: i === 0 ? 0 : 500 })));
  const splits = await splitsOf(invert(CLEAN_SOLVE.join(" ")), moves);
  for (const split of splits.slice(1)) {
    const turningSeconds = (split.durationMs - split.recognitionMs!) / 1000;
    assert.ok(
      Math.abs(split.moveCount / turningSeconds - 10) < 1e-9,
      `${split.phase}: ${split.moveCount} turns in ${turningSeconds}s`,
    );
  }
});

test("a stream padded with rotations costs time in proportion to its length", async () => {
  // Undoing every rotation so far on every move made this quadratic, and the
  // server analyses streams it is sent. A ratio rather than a time limit, so the
  // check means the same thing on a slow machine: four times the rotations must
  // cost about four times as much (linear), not sixteen (quadratic).
  const solution = CLEAN_SOLVE.join(" ").split(" ");
  const cost = async (pairs: number) => {
    const padded: TimedMove[] = [];
    let t = 0;
    for (let i = 0; i < pairs; i++) {
      padded.push({ move: "x", atMs: (t += 10) }, { move: "x'", atMs: (t += 10) });
    }
    for (const move of solution) padded.push({ move, atMs: (t += 100) });
    const started = performance.now();
    const splits = await splitsOf(invert(solution.join(" ")), padded);
    assert.deepEqual(names(splits), ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"]);
    return performance.now() - started;
  };
  await cost(20);
  const ratio = (await cost(1600)) / (await cost(400));
  assert.ok(ratio < 8, `4x the rotations cost ${ratio.toFixed(1)}x the time`);
});

test("split times are whole milliseconds, however fractional the clock", async () => {
  const moves = timed(CLEAN_SOLVE.join(" "), 173.299999952316);
  const splits = await splitsOf(invert(CLEAN_SOLVE.join(" ")), moves);
  for (const split of splits) {
    for (const value of [split.startMs, split.endMs, split.durationMs, split.recognitionMs!]) {
      assert.ok(Number.isInteger(value), `${split.phase}: ${value}`);
    }
  }
});
