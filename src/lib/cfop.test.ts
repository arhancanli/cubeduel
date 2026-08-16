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

test("a full solve reports cross, four F2L pairs, OLL and PLL in order", async () => {
  // Built backwards from solved so every phase is genuinely present.
  // Built backwards from solved, and each step verified to complete exactly one
  // milestone while preserving every earlier one — which is what makes it a real
  // CFOP solve rather than just a sequence that happens to end solved.
  const solution = [
    "D2 R' D'", // cross
    "U R U' R'", // pair 1, front-right slot
    "U' L' U L", // pair 2, front-left slot
    "U' R' U R", // pair 3, back-right slot
    "U L U' L'", // pair 4, back-left slot
    "R U R' U R U2 R'", // OLL (sune)
    "R U R' U' R' F R2 U' R' U' R U R' F'", // PLL (T-perm)
  ].join(" ");

  const splits = await splitsOf(invert(solution), timed(solution));
  assert.deepEqual(
    names(splits),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
    `got ${names(splits).join(", ")}`,
  );

  // Phases must tile the solve exactly: no gaps, no overlap, nothing lost.
  const moves = timed(solution);
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
