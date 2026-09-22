import { test } from "node:test";
import assert from "node:assert/strict";

import {
  profileCardContent,
  raceCardContent,
  solveCardContent,
  type RaceCardInput,
} from "./shareCards";

const race: RaceCardInput = {
  event: "333",
  status: "lobby",
  hostName: "Arhan",
  guestName: null,
  winner: null,
  hostResult: null,
  guestResult: null,
};

test("an open race asks, and says what winning means", () => {
  const card = raceCardContent(race);
  assert.match(card.headline, /Arhan wants to race/);
  // The rule people get wrong, on the card they read before pressing ready.
  assert.match(card.subheading ?? "", /faster solve wins/);
  assert.match(card.footnote ?? "", /3x3/);
});

test("a race in progress names both players and neither time", () => {
  const card = raceCardContent({ ...race, status: "started", guestName: "Sam" });
  assert.equal(card.headline, "Arhan v Sam");
  assert.equal(card.figures.length, 0);
});

test("a finished race says who won, with both times", () => {
  const card = raceCardContent({
    ...race,
    status: "finished",
    guestName: "Sam",
    winner: "guest",
    hostResult: { durationMs: 14_230, penalty: "OK" },
    guestResult: { durationMs: 12_480, penalty: "OK" },
  });
  assert.equal(card.headline, "Sam won");
  assert.deepEqual(card.figures.map((f) => f.value), ["14.23", "12.48"]);
});

test("a two-second penalty is shown as the time it cost", () => {
  const card = raceCardContent({
    ...race,
    status: "finished",
    guestName: "Sam",
    winner: "host",
    hostResult: { durationMs: 12_000, penalty: "OK" },
    guestResult: { durationMs: 11_000, penalty: "PLUS2" },
  });
  // 11.00 plus the penalty is 13.00, which is why the 12.00 won. A card showing
  // the raw time would make the result look wrong to everybody who read it.
  assert.deepEqual(card.figures.map((f) => f.value), ["12.00", "13.00"]);
});

test("a DNF is a DNF, not a time", () => {
  const card = raceCardContent({
    ...race,
    status: "finished",
    guestName: "Sam",
    winner: "host",
    hostResult: { durationMs: 12_000, penalty: "OK" },
    guestResult: { durationMs: 40_000, penalty: "DNF" },
  });
  assert.deepEqual(card.figures.map((f) => f.value), ["12.00", "DNF"]);
});

test("a race nobody joined says so rather than pretending", () => {
  const card = raceCardContent({ ...race, status: "abandoned" });
  assert.match(card.headline, /never happened/);
  assert.match(card.footnote ?? "", /Arhan/);
});

test("a race that no longer exists is not a blank card", () => {
  const card = raceCardContent(null);
  assert.match(card.headline, /gone/);
  assert.equal(card.figures.length, 0);
});

test("no card of a live race mentions the scramble", () => {
  // The whole point of the rule: a preview is read by everybody in the chat
  // before anybody opens the link.
  const scramble = "R U R' U' F2 D L2 B R'";
  for (const status of ["lobby", "started", "finished"] as const) {
    const card = raceCardContent({ ...race, status, guestName: "Sam", winner: "host" });
    const text = [card.kind, card.headline, card.subheading, card.footnote, ...card.figures.map((f) => `${f.value} ${f.label}`)].join(" ");
    for (const move of scramble.split(" ")) {
      assert.ok(!text.includes(` ${move} `), `a card said ${move}`);
    }
    assert.ok(!/scramble:/i.test(text));
  }
});

test("a solve card carries the time, the moves and whether it was verified", () => {
  const card = solveCardContent({
    event: "333",
    durationMs: 12_480,
    penalty: "OK",
    displayName: "Arhan",
    handle: "arhan",
    moveCount: 52,
    tps: 4.1666,
    verified: true,
    mode: "ranked",
  });
  assert.equal(card.headline, "12.48");
  assert.match(card.subheading ?? "", /@arhan/);
  assert.match(card.subheading ?? "", /ranked solve/);
  assert.deepEqual(card.figures.map((f) => f.value), ["52", "4.2", "verified"]);
});

test("a solve that was not verified says so on the card", () => {
  const card = solveCardContent({
    event: "333",
    durationMs: 9_000,
    penalty: "OK",
    displayName: "Arhan",
    handle: "arhan",
    moveCount: 40,
    tps: 4.4,
    verified: false,
    mode: "practice",
  });
  const verified = card.figures.at(-1);
  assert.equal(verified?.value, "unverified");
  assert.match(verified?.label ?? "", /no move stream/);
});

test("an unrated player is not given a rating", () => {
  const card = profileCardContent({
    displayName: "Arhan",
    handle: "arhan",
    event: "333",
    rating: 812,
    deviation: 140,
    established: false,
    rank: null,
    rankedSolves: 3,
    bestSingleMs: 18_400,
  });
  assert.equal(card.figures[0].value, "unrated");
  // And the figure that exists is still shown.
  assert.equal(card.figures[1].value, "18.40");
});

test("an established rating carries its uncertainty and its rank", () => {
  const card = profileCardContent({
    displayName: "Arhan",
    handle: "arhan",
    event: "333",
    rating: 1240,
    deviation: 62.4,
    established: true,
    rank: 3,
    rankedSolves: 40,
    bestSingleMs: null,
  });
  assert.equal(card.figures[0].value, "1240 ±62");
  assert.match(card.figures[0].label, /rank 3/);
  assert.equal(card.figures[1].value, "—", "no best single is not zero");
});

test("a long name is trimmed rather than pushing the card off its own edges", () => {
  const card = raceCardContent({ ...race, hostName: "Bartholomew Cubington III" });
  assert.match(card.headline, /…/);
  assert.ok(card.headline.length <= 36, card.headline);
  // Short names are untouched.
  assert.equal(raceCardContent({ ...race, hostName: "Sam" }).headline, "Sam wants to race");
});

test("a name that is only the handle is not printed twice", () => {
  const card = solveCardContent({
    event: "333",
    durationMs: 12_000,
    penalty: "OK",
    displayName: "arhan",
    handle: "arhan",
    moveCount: 50,
    tps: 4,
    verified: true,
    mode: "ranked",
  });
  assert.equal(card.subheading, "@arhan on 3x3, in a ranked solve.");

  const profile = profileCardContent({
    displayName: "arhan",
    handle: "arhan",
    event: "333",
    rating: null,
    deviation: 0,
    established: false,
    rank: null,
    rankedSolves: 0,
    bestSingleMs: null,
  });
  assert.equal(profile.headline, "arhan");
  assert.equal(profile.subheading, null);
});
