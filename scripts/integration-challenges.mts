/**
 * Head-to-head challenges against the real database.
 *
 * Two profiles, one scramble, both sides solved, and the result settled — with
 * the two fairness rules checked as facts rather than as intentions:
 *
 *   The scramble is not readable by a player who has not opened their own half.
 *   The opponent's time is not readable until both are in.
 *
 * Both are the sort of thing that is obviously true when you write it and
 * quietly false two refactors later, because nothing in a normal test run ever
 * looks. So each is asserted from the same call the UI would make.
 *
 *   npm run integration:challenges
 *
 * It cleans up after itself.
 */

import { CHALLENGE_TTL_MS } from "../src/lib/challenge";
import {
  createChallenge,
  listChallenges,
  startSide,
  submitSide,
} from "../src/lib/server/challenges";
import { db } from "../src/lib/server/supabase";

const HANDLES = ["challenge-probe-a", "challenge-probe-b"] as const;

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

function solutionFor(scramble: string): string[] {
  return scramble
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`));
}

async function cleanup() {
  for (const handle of HANDLES) {
    await db().from("profiles").delete().eq("handle", handle);
  }
}

/** Opens a side, waits out a believable solve, and submits it honestly. */
async function solveSide(profileId: string, challengeId: string, solveMs: number) {
  const opened = await startSide(profileId, challengeId);
  if (!opened.ok) throw new Error(`could not open: ${opened.reason}`);

  const solution = solutionFor(opened.scramble);
  const gap = Math.round(solveMs / Math.max(1, solution.length - 1));
  const moves = solution.map((move, i) => ({ move, atMs: i * gap }));
  const durationMs = moves[moves.length - 1].atMs;

  // The server refuses a solve that took less wall-clock time than it claims,
  // because that is what a replayed cheat looks like. An honest client is slow
  // because the human is slow.
  await new Promise((r) => setTimeout(r, durationMs + 150));

  return submitSide({
    profileId,
    challengeId,
    clientId: `probe_${profileId.slice(0, 8)}_${Date.now()}`,
    moves,
    durationMs,
    penalty: "OK",
    source: "keyboard",
  });
}

async function main() {
  console.log("\n== setup ==");
  await cleanup();

  const profiles: { id: string; handle: string }[] = [];
  for (const handle of HANDLES) {
    const { data, error } = await db()
      .from("profiles")
      .insert({
        clerk_user_id: `challenge_${handle}_${Date.now()}`,
        handle,
        display_name: handle,
      })
      .select("id, handle")
      .single();
    if (error || !data) {
      check(`profile ${handle} created`, false, error?.message ?? "no row");
      return;
    }
    profiles.push(data);
  }
  const [alice, bob] = profiles;
  check("two players exist", profiles.length === 2);

  console.log("\n== opening a challenge ==");
  const created = await createChallenge(alice.id, bob.handle);
  check("the challenge was created", created.ok, created.ok ? "" : created.reason);
  if (!created.ok) return;
  const id = created.challengeId;

  const selfChallenge = await createChallenge(alice.id, alice.handle);
  check("you cannot challenge yourself", !selfChallenge.ok,
    selfChallenge.ok ? "it allowed it" : selfChallenge.reason);

  const duplicate = await createChallenge(alice.id, bob.handle);
  check("a second challenge to the same player is refused", !duplicate.ok,
    duplicate.ok ? "it allowed a duplicate" : duplicate.reason);

  const unknown = await createChallenge(alice.id, "nobody-by-that-name");
  check("challenging a handle that does not exist is refused", !unknown.ok);

  console.log("\n== the scramble is not readable before you open your half ==");
  {
    const forAlice = (await listChallenges(alice.id)).find((c) => c.id === id);
    const forBob = (await listChallenges(bob.id)).find((c) => c.id === id);

    check("the challenger sees the challenge", forAlice !== undefined);
    check("the opponent sees the challenge", forBob !== undefined);
    check("neither has been given the scramble",
      forAlice?.scramble === null && forBob?.scramble === null,
      `challenger=${forAlice?.scramble ?? "null"} opponent=${forBob?.scramble ?? "null"}`);
    check("both are told it is their turn",
      forAlice?.awaitingYou === true && forBob?.awaitingYou === true);
    check("the opponent is named", forBob?.them.handle === alice.handle,
      forBob?.them.handle ?? "none");
  }

  console.log("\n== the challenger solves ==");
  const aliceResult = await solveSide(alice.id, id, 5000);
  check("the challenger's solve was accepted", aliceResult.accepted,
    aliceResult.accepted ? "" : aliceResult.reason);
  check("it did not settle the challenge on its own",
    aliceResult.accepted && aliceResult.settled === false);
  check("no outcome is claimed yet",
    aliceResult.accepted && aliceResult.outcome === null);

  console.log("\n== the opponent still cannot see the time to beat ==");
  {
    const forBob = (await listChallenges(bob.id)).find((c) => c.id === id);
    check("the challenger's time is hidden", forBob?.theirs === null,
      forBob?.theirs ? JSON.stringify(forBob.theirs) : "hidden");
    check("it is still the opponent's turn", forBob?.awaitingYou === true);

    const forAlice = (await listChallenges(alice.id)).find((c) => c.id === id);
    check("the challenger sees their own time", forAlice?.own.durationMs !== null,
      String(forAlice?.own.durationMs));
    check("but not the opponent's", forAlice?.theirs === null);
    check("and is no longer waited on", forAlice?.awaitingYou === false);
  }

  console.log("\n== opening your half releases the scramble, and only yours ==");
  {
    const opened = await startSide(bob.id, id);
    check("the opponent can open their half", opened.ok, opened.ok ? "" : opened.reason);

    const forBob = (await listChallenges(bob.id)).find((c) => c.id === id);
    // Length is not pinned: a random-state scramble is whatever the generator
    // needs to reach a random position, and pinning 18 failed legitimately on a
    // 17-move one. What matters is that a field which was null now is not.
    const moves = (forBob?.scramble ?? "").split(" ").filter(Boolean).length;
    check("now the opponent has the scramble", forBob?.scramble != null && moves >= 12,
      `${moves} moves`);
    check("it is the same scramble both are solving",
      opened.ok && forBob?.scramble === opened.scramble);
  }

  console.log("\n== the opponent solves, slower ==");
  const bobResult = await solveSide(bob.id, id, 8000);
  check("the opponent's solve was accepted", bobResult.accepted,
    bobResult.accepted ? "" : bobResult.reason);
  check("that settled it", bobResult.accepted && bobResult.settled === true);
  check("the slower player lost", bobResult.accepted && bobResult.outcome === "loss",
    bobResult.accepted ? String(bobResult.outcome) : "");
  check("and only now is the other time revealed",
    bobResult.accepted && bobResult.theirs?.durationMs != null,
    bobResult.accepted ? JSON.stringify(bobResult.theirs) : "");

  console.log("\n== both sides agree on the result ==");
  {
    const forAlice = (await listChallenges(alice.id)).find((c) => c.id === id);
    const forBob = (await listChallenges(bob.id)).find((c) => c.id === id);
    check("the challenger won", forAlice?.outcome === "win", String(forAlice?.outcome));
    check("the opponent lost", forBob?.outcome === "loss", String(forBob?.outcome));
    check("the challenge is complete", forAlice?.status === "complete");
    check("each side now sees both times",
      forAlice?.theirs?.durationMs != null && forBob?.theirs?.durationMs != null);
    check("the faster time really was the winner's",
      (forAlice?.own.durationMs ?? 0) < (forBob?.own.durationMs ?? 0),
      `${forAlice?.own.durationMs}ms vs ${forBob?.own.durationMs}ms`);
  }

  console.log("\n== a settled challenge cannot be solved again ==");
  {
    const again = await submitSide({
      profileId: bob.id,
      challengeId: id,
      clientId: "probe_replay",
      moves: [{ move: "R", atMs: 0 }],
      durationMs: 1000,
      penalty: "OK",
      source: "keyboard",
    });
    check("a second submission is refused", !again.accepted,
      again.accepted ? "it accepted a replay" : again.reason);
  }

  console.log("\n== a stranger cannot touch it ==");
  {
    const { data: stranger } = await db()
      .from("profiles")
      .insert({
        clerk_user_id: `challenge_stranger_${Date.now()}`,
        handle: "challenge-probe-c",
        display_name: "Stranger",
      })
      .select("id")
      .single();

    if (stranger) {
      const peek = await startSide(stranger.id, id);
      check("a third party cannot open somebody else's challenge", !peek.ok,
        peek.ok ? `LEAKED: ${peek.scramble.slice(0, 30)}` : peek.reason);
      check("and is told it does not exist rather than that it is forbidden",
        !peek.ok && peek.reason === "No such challenge.",
        peek.ok ? "" : peek.reason);

      const list = await listChallenges(stranger.id);
      check("it does not appear in a stranger's list",
        !list.some((c) => c.id === id), `${list.length} rows`);

      await db().from("profiles").delete().eq("id", stranger.id);
    }
  }

  console.log("\n== a lapsed challenge goes to whoever turned up ==");
  {
    const lapsed = await createChallenge(bob.id, alice.handle);
    if (lapsed.ok) {
      await solveSide(bob.id, lapsed.challengeId, 4000);

      // Backdate it past the deadline. Expiry is judged on read, so this is the
      // whole mechanism — no job has to have run.
      const past = new Date(Date.now() - CHALLENGE_TTL_MS).toISOString();
      await db().from("challenges").update({ expires_at: past }).eq("id", lapsed.challengeId);

      const forBob = (await listChallenges(bob.id)).find((c) => c.id === lapsed.challengeId);
      check("the player who solved it wins by default", forBob?.outcome === "win",
        String(forBob?.outcome));
      check("and it is recorded as complete, not expired", forBob?.status === "complete",
        String(forBob?.status));

      const forAlice = (await listChallenges(alice.id)).find((c) => c.id === lapsed.challengeId);
      check("the player who ignored it lost", forAlice?.outcome === "loss",
        String(forAlice?.outcome));
      check("it is no longer waiting on them", forAlice?.awaitingYou === false);
    } else {
      check("a second challenge in the other direction is allowed", false, lapsed.reason);
    }
  }

  console.log("\n== a challenge nobody solved just expires ==");
  {
    const ignored = await createChallenge(alice.id, bob.handle);
    if (ignored.ok) {
      const past = new Date(Date.now() - CHALLENGE_TTL_MS).toISOString();
      await db().from("challenges").update({ expires_at: past }).eq("id", ignored.challengeId);

      const view = (await listChallenges(alice.id)).find((c) => c.id === ignored.challengeId);
      check("it expires with no winner", view?.status === "expired", String(view?.status));
      check("and claims no outcome for either side", view?.outcome === null,
        String(view?.outcome));
    }
  }

  console.log("\n== cleanup ==");
  await cleanup();
  const { count } = await db()
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .in("handle", [...HANDLES]);
  check("the probe removed itself", (count ?? 0) === 0, `${count ?? 0} left`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    failures++;
  })
  .finally(async () => {
    console.log("\n" + "=".repeat(52));
    console.log(failures === 0 ? "All checks passed." : `FAILURES: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
  });
