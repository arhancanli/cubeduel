import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHALLENGE_TTL_MS,
  MAX_OPEN_PER_PLAYER,
  MAX_OUTGOING_PENDING,
  type ChallengeState,
  type OpenChallenge,
  type Side,
  acceptRefusalText,
  canAccept,
  decideWinner,
  effectiveMs,
  resolve,
  visibleTo,
} from "./challenge";

const ok = (ms: number): Side => ({ durationMs: ms, penalty: "OK" });
const plus2 = (ms: number): Side => ({ durationMs: ms, penalty: "PLUS2" });
const dnf = (): Side => ({ durationMs: 0, penalty: "DNF" });
const unsolved = (): Side => ({ durationMs: null, penalty: null });

const NOW = 1_700_000_000_000;

function state(over: Partial<ChallengeState> = {}): ChallengeState {
  return {
    status: "pending",
    challenger: unsolved(),
    opponent: unsolved(),
    createdAt: NOW,
    expiresAt: NOW + CHALLENGE_TTL_MS,
    ...over,
  };
}

test("a +2 is carried into the time it is judged on", () => {
  assert.equal(effectiveMs(ok(10_000)), 10_000);
  assert.equal(effectiveMs(plus2(10_000)), 12_000);
});

test("a DNF has no time rather than a very large one", () => {
  // Ranking a DNF as "slower than everything" would work until the day something
  // averaged it.
  assert.equal(effectiveMs(dnf()), null);
  assert.equal(effectiveMs(unsolved()), null);
});

test("the faster effective time wins", () => {
  assert.equal(decideWinner(ok(8000), ok(9000)), "challenger");
  assert.equal(decideWinner(ok(9000), ok(8000)), "opponent");
});

test("a +2 can lose a race the raw time won", () => {
  // 10.00 + 2 loses to 11.00, which is the entire point of a penalty.
  assert.equal(decideWinner(plus2(10_000), ok(11_000)), "opponent");
  assert.equal(decideWinner(plus2(10_000), ok(13_000)), "challenger");
});

test("a DNF loses to any finished solve", () => {
  assert.equal(decideWinner(dnf(), ok(60_000)), "opponent");
  assert.equal(decideWinner(ok(60_000), dnf()), "challenger");
});

test("two DNFs draw", () => {
  // Neither player demonstrated anything about the other.
  assert.equal(decideWinner(dnf(), dnf()), "draw");
});

test("identical times draw", () => {
  assert.equal(decideWinner(ok(9123), ok(9123)), "draw");
});

test("nothing settles while one side is still to solve", () => {
  const r = resolve(state({ challenger: ok(9000) }), NOW + 1000);
  assert.equal(r.settled, false);
});

test("both solving settles it immediately, long before expiry", () => {
  const r = resolve(state({ challenger: ok(9000), opponent: ok(11_000) }), NOW + 1000);
  assert.equal(r.settled, true);
  assert.ok(r.settled && r.status === "complete");
  assert.ok(r.settled && r.winner === "challenger");
});

test("letting a challenge lapse hands it to whoever turned up", () => {
  // Otherwise ignoring a challenge you are losing costs nothing, and every
  // inconvenient challenge quietly evaporates.
  const late = NOW + CHALLENGE_TTL_MS + 1;

  const a = resolve(state({ challenger: ok(9000) }), late);
  assert.ok(a.settled && a.winner === "challenger" && a.reason === "opponent let it lapse");

  const b = resolve(state({ opponent: ok(9000) }), late);
  assert.ok(b.settled && b.winner === "opponent" && b.reason === "challenger let it lapse");
});

test("a lapsed challenge nobody solved has no winner", () => {
  const r = resolve(state(), NOW + CHALLENGE_TTL_MS + 1);
  assert.ok(r.settled && r.status === "expired" && r.winner === null);
});

test("a DNF still counts as turning up", () => {
  // Failing the scramble is a result. It should beat not attempting it at all.
  const r = resolve(state({ challenger: dnf() }), NOW + CHALLENGE_TTL_MS + 1);
  assert.ok(r.settled && r.winner === "challenger");
});

test("the deadline itself is not yet expired", () => {
  assert.equal(resolve(state({ challenger: ok(9000) }), NOW + CHALLENGE_TTL_MS).settled, false);
  assert.equal(
    resolve(state({ challenger: ok(9000) }), NOW + CHALLENGE_TTL_MS + 1).settled,
    true,
  );
});

test("an already-settled challenge is never re-decided", () => {
  const done = state({ status: "complete", challenger: ok(9000), opponent: ok(11_000) });
  assert.equal(resolve(done, NOW + CHALLENGE_TTL_MS * 10).settled, false);
});

test("the scramble is hidden until the viewer opens their own attempt", () => {
  const s = state();
  assert.equal(visibleTo("opponent", s, "R U R'", false).scramble, null,
    "a scramble readable in an inbox has been studied for two days");
  assert.equal(visibleTo("opponent", s, "R U R'", true).scramble, "R U R'");
});

test("the other player's time is hidden until the challenge is settled", () => {
  // Going second is otherwise a real advantage: knowing the target tells you
  // exactly how much risk to take.
  const pending = state({ challenger: ok(9000) });
  assert.equal(visibleTo("opponent", pending, "R U R'", true).theirs, null);

  const settled = state({ status: "complete", challenger: ok(9000), opponent: ok(11_000) });
  assert.deepEqual(visibleTo("opponent", settled, "R U R'", true).theirs, ok(9000));
});

test("a viewer always sees their own result", () => {
  const pending = state({ opponent: ok(11_000) });
  const view = visibleTo("opponent", pending, "R U R'", true);
  assert.deepEqual(view.own, ok(11_000));
  assert.equal(view.theirs, null, "still hidden, even though they have finished");
});

test("it says whose turn it is", () => {
  const fresh = state();
  assert.equal(visibleTo("opponent", fresh, "s", false).awaitingYou, true);
  assert.equal(visibleTo("challenger", fresh, "s", false).awaitingYou, true);

  const halfDone = state({ challenger: ok(9000) });
  assert.equal(visibleTo("challenger", halfDone, "s", true).awaitingYou, false);
  assert.equal(visibleTo("opponent", halfDone, "s", false).awaitingYou, true);

  const settled = state({ status: "complete", challenger: ok(9000), opponent: ok(11_000) });
  assert.equal(visibleTo("opponent", settled, "s", true).awaitingYou, false);
});

// ---------------------------------------------------------------------------
// Open challenges: the second seat is empty and anybody may take it.
// ---------------------------------------------------------------------------

const open: OpenChallenge = {
  challengerId: "poster",
  opponentId: null,
  status: "pending",
  expiresAt: 2_000,
};

test("anybody but the poster may take an open challenge", () => {
  assert.deepEqual(canAccept(open, "somebody", 1_000), { ok: true });
});

test("you cannot accept your own offer", () => {
  // The same reason a challenge cannot name yourself: it would be a free win
  // against a real record.
  assert.deepEqual(canAccept(open, "poster", 1_000), { ok: false, reason: "your own" });
});

test("the second person to accept is told somebody got there first", () => {
  const taken = { ...open, opponentId: "first" };
  const refusal = canAccept(taken, "second", 1_000);
  assert.deepEqual(refusal, { ok: false, reason: "already taken" });
  assert.match(acceptRefusalText("already taken"), /first/);
});

test("a lapsed offer cannot be taken, and the boundary is the moment it lapses", () => {
  assert.deepEqual(canAccept(open, "somebody", 1_999), { ok: true });
  assert.deepEqual(canAccept(open, "somebody", 2_000), { ok: false, reason: "expired" });
});

test("an offer that is no longer pending is not open, whatever its seat says", () => {
  for (const status of ["complete", "expired", "declined"] as const) {
    assert.deepEqual(canAccept({ ...open, status }, "somebody", 1_000), {
      ok: false,
      reason: "not open",
    });
  }
});

test("every refusal has words for it", () => {
  for (const reason of ["your own", "already taken", "not open", "expired"] as const) {
    assert.ok(acceptRefusalText(reason).length > 10);
  }
});

test("the open board cap is tighter than the inbox cap", () => {
  // One offer lands in one inbox; an open one sits on a page everybody sees.
  assert.ok(MAX_OPEN_PER_PLAYER < MAX_OUTGOING_PENDING);
});
