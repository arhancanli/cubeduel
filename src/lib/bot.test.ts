import { test } from "node:test";
import assert from "node:assert/strict";

import { BOTS, botById, botProgressAt, buildBotSolve } from "./bot";
import { msForRating, ratingForMs } from "./rating";
import { cubeFromAlg, compose, isSolved } from "./solver/cube";
import { buildTables } from "./solver/tables";
import { solveScramble } from "./solver/search";
import { verifySolve } from "./verifySolve";

const SCRAMBLE = "R U R' U' F2 L D B' R2 U D' L' B U2 F R2 D2 L2 F'";

/** A real solution to a real scramble, from the engine. */
function realSolution(): string[] {
  buildTables();
  const result = solveScramble(SCRAMBLE);
  assert.ok(result, "the engine failed to solve the fixture scramble");
  return result.moves;
}

test("a bot finishes at the time its rating claims", () => {
  // The rating and the finishing time are the same statement, not two numbers
  // that have to be kept in agreement by hand.
  for (const bot of BOTS) {
    const solve = buildBotSolve(realSolution(), bot.rating, 1);
    const target = msForRating(bot.rating);
    const drift = Math.abs(solve.durationMs - target) / target;
    assert.ok(drift < 0.02, `${bot.name}: finished ${solve.durationMs}ms, wanted ${target}ms`);
  }
});

test("the finishing time reads back as the rating it came from", () => {
  // Round-tripping through the rating scale: a 1750 bot must look like a 1750
  // player to the same function that rates people.
  for (const bot of BOTS) {
    const solve = buildBotSolve(realSolution(), bot.rating, 7);
    const implied = ratingForMs(solve.durationMs);
    assert.ok(
      Math.abs(implied - bot.rating) < 25,
      `${bot.name}: rated ${bot.rating} but its time implies ${Math.round(implied)}`,
    );
  }
});

test("a bot's move stream passes the verifier that judges people", async () => {
  // The test that keeps this honest rather than merely plausible. If the bot's
  // solve cannot survive the same scrutiny as a human one, it is a puppet.
  const solution = realSolution();

  for (const bot of BOTS) {
    const solve = buildBotSolve(solution, bot.rating, 99);
    const verdict = await verifySolve({
      scramble: SCRAMBLE,
      moves: solve.moves,
      durationMs: solve.durationMs,
      issuedAt: 0,
      receivedAt: solve.durationMs + 2000,
    });
    assert.equal(
      verdict.verified,
      true,
      `${bot.name} produced a solve the server would reject: ${
        verdict.verified ? "" : verdict.reason
      }`,
    );
  }
});

test("a bot's moves actually solve the cube", () => {
  const solution = realSolution();
  const solve = buildBotSolve(solution, 1750, 3);
  let cube = cubeFromAlg(SCRAMBLE);
  for (const { move } of solve.moves) cube = compose(cube, cubeFromAlg(move));
  assert.ok(isSolved(cube), "the bot did not solve the cube it was racing on");
});

test("time only moves forward, starting at zero", () => {
  const solve = buildBotSolve(realSolution(), 1400, 11);
  assert.equal(solve.moves[0].atMs, 0, "the first turn starts the clock");
  for (let i = 1; i < solve.moves.length; i++) {
    assert.ok(
      solve.moves[i].atMs >= solve.moves[i - 1].atMs,
      `timestamps went backwards at move ${i}`,
    );
  }
});

test("the same duel replays identically", () => {
  // A race that changed between replays could not be reviewed afterwards.
  const solution = realSolution();
  const a = buildBotSolve(solution, 1750, 424242);
  const b = buildBotSolve(solution, 1750, 424242);
  assert.deepEqual(a.moves, b.moves);
});

test("different duels are not the same race twice", () => {
  const solution = realSolution();
  const a = buildBotSolve(solution, 1750, 1);
  const b = buildBotSolve(solution, 1750, 2);
  assert.notDeepEqual(a.moves, b.moves);
  // But they still finish at the same time — the rating is the promise.
  assert.ok(Math.abs(a.durationMs - b.durationMs) / a.durationMs < 0.02);
});

test("a bot pauses to think, rather than turning like a metronome", () => {
  // A perfectly even trajectory would read as obviously mechanical next to a
  // person's move stream, and would also make the phase splits meaningless.
  const solve = buildBotSolve(realSolution(), 1750, 5);
  const gaps: number[] = [];
  for (let i = 1; i < solve.moves.length; i++) {
    gaps.push(solve.moves[i].atMs - solve.moves[i - 1].atMs);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const longest = Math.max(...gaps);
  assert.ok(longest > mean * 1.8, `longest gap ${longest}ms vs mean ${mean.toFixed(0)}ms`);
});

test("degenerate solutions do not produce nonsense", () => {
  // A scramble already solved, or one move from it.
  const empty = buildBotSolve([], 1750, 1);
  assert.deepEqual(empty.moves, []);
  assert.equal(empty.durationMs, 0);

  const single = buildBotSolve(["R"], 1750, 1);
  assert.equal(single.moves.length, 1);
  assert.equal(single.moves[0].atMs, 0);
  assert.ok(single.durationMs > 0, "a one-move solve still takes time");
});

test("progress tracks the trajectory and nothing else", () => {
  const solve = buildBotSolve(realSolution(), 1750, 13);
  assert.equal(botProgressAt(solve, -1), 0);
  assert.equal(botProgressAt(solve, 0), 1, "the first move lands at zero");
  assert.equal(
    botProgressAt(solve, solve.durationMs),
    solve.moves.length,
    "by the finish every move has been played",
  );

  // Monotonic: an opponent's progress bar must never go backwards.
  let previous = 0;
  for (let ms = 0; ms <= solve.durationMs; ms += 100) {
    const at = botProgressAt(solve, ms);
    assert.ok(at >= previous, `progress went backwards at ${ms}ms`);
    previous = at;
  }
});

test("the roster spans the range players actually sit in", () => {
  const ratings = BOTS.map((b) => b.rating);
  assert.ok(Math.min(...ratings) <= 1000, "there must be an opponent for a beginner");
  assert.ok(Math.max(...ratings) >= 2300, "and one nobody beats casually");
  assert.equal(new Set(BOTS.map((b) => b.id)).size, BOTS.length, "duplicate bot id");

  // Sorted, so the UI can present them as a ladder without re-deriving it.
  for (let i = 1; i < BOTS.length; i++) {
    assert.ok(BOTS[i].rating > BOTS[i - 1].rating, "roster must ascend by rating");
  }
});

test("bots are looked up by id, and unknown ids are refused", () => {
  assert.equal(botById("bot-tempo")?.name, "Tempo");
  assert.equal(botById("nonsense"), null);
});
