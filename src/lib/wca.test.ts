import assert from "node:assert/strict";
import test from "node:test";

import { ratingForMs } from "./rating";
import {
  WCA_EVENT_IDS,
  centisecondsToMs,
  compare,
  isValidWcaId,
  normaliseWcaId,
  parseWcaPerson,
  ratingForWcaAverage,
} from "./wca";

/** A trimmed copy of a real response, so the parser is tested against the shape
 *  the WCA actually returns rather than one invented to suit it. */
const REAL = {
  person: {
    name: "Ron van Bruchem",
    wca_id: "2003BRUC01",
    country: { id: "Netherlands", name: "Netherlands", iso2: "NL" },
  },
  competition_count: 277,
  personal_records: {
    "222": { single: { best: 300 }, average: { best: 450 } },
    "333": {
      single: { best: 766, world_rank: 6258, country_rank: 65 },
      average: { best: 1191, world_rank: 19282, country_rank: 178 },
    },
    "333bf": { single: { best: 5000 } },
    "444": { single: { best: 4000 } },
  },
};

// --- ids -------------------------------------------------------------------

test("real WCA ids are accepted", () => {
  for (const id of ["2003BRUC01", "2016CANL01", "1982PETR01"]) {
    assert.equal(isValidWcaId(id), true, id);
  }
});

test("anything else is refused", () => {
  // These go straight into a URL on worldcubeassociation.org, so a malformed
  // one is a request that should never have been made.
  for (const id of [
    "", "2003BRUC0", "2003BRUC001", "03BRUC01", "2003BRU01",
    "2003bruc01x", "2003-BRUC-01", "../../etc/passwd", "2003BRUC0!",
  ]) {
    assert.equal(isValidWcaId(id), false, `should refuse: ${id}`);
  }
});

test("ids are read however somebody typed them", () => {
  assert.equal(normaliseWcaId("  2003bruc01 "), "2003BRUC01");
  assert.equal(normaliseWcaId("2003 BRUC 01"), "2003BRUC01");
  assert.equal(normaliseWcaId("nonsense"), null);
});

// --- units -----------------------------------------------------------------

test("WCA results are centiseconds, not milliseconds", () => {
  // Getting this wrong by a factor of ten would show a world-class average as
  // a beginner's, and nothing about the number would look obviously wrong.
  assert.equal(centisecondsToMs(1191), 11_910);
  assert.equal(centisecondsToMs(766), 7_660);
});

// --- parsing ---------------------------------------------------------------

test("a real response parses", () => {
  const profile = parseWcaPerson(REAL);
  assert.ok(profile);
  assert.equal(profile!.wcaId, "2003BRUC01");
  assert.equal(profile!.name, "Ron van Bruchem");
  assert.equal(profile!.country, "Netherlands");
  assert.equal(profile!.competitionCount, 277);
  assert.equal(profile!.records["333"]?.averageMs, 11_910);
  assert.equal(profile!.records["333"]?.singleMs, 7_660);
  assert.equal(profile!.records["333"]?.countryRank, 178);
});

test("only the events this app rates are kept", () => {
  const profile = parseWcaPerson(REAL);
  // 333bf is in the response and is not an event here.
  assert.deepEqual(Object.keys(profile!.records).sort(), ["222", "333", "444"]);
});

test("a single without an average is kept as exactly that", () => {
  // Somebody who never completed five solves at a competition has one result
  // and not the other. Recording a zero, or dropping the event, are both lies.
  const profile = parseWcaPerson(REAL);
  assert.equal(profile!.records["444"]?.singleMs, 40_000);
  assert.equal(profile!.records["444"]?.averageMs, null);
});

test("junk is refused rather than half-parsed", () => {
  for (const junk of [null, undefined, 42, "text", {}, { person: {} }, { person: { wca_id: "nope" } }]) {
    assert.equal(parseWcaPerson(junk), null, JSON.stringify(junk));
  }
});

test("every event this app rates has a WCA identifier", () => {
  // A missing entry would silently look up a record that does not exist.
  for (const [event, wcaId] of Object.entries(WCA_EVENT_IDS)) {
    assert.ok(wcaId.length > 0, event);
  }
  assert.equal(Object.keys(WCA_EVENT_IDS).length, 4);
});

// --- conversion ------------------------------------------------------------

test("an official average converts on the same scale as any other", () => {
  // The scale is a pure function of time, so there is nothing special about
  // where the average came from.
  assert.equal(ratingForWcaAverage(11_910), Math.round(ratingForMs(11_910)));
  assert.equal(ratingForWcaAverage(5_000), 3000);
});

test("a faster official average converts to a higher rating", () => {
  assert.ok(ratingForWcaAverage(8_000) > ratingForWcaAverage(15_000));
});

// --- the comparison, which is where the lying would happen ------------------

test("a smart-cube rating is called comparable", () => {
  const result = compare({
    event: "333",
    pool: "smartcube",
    cubeduelMs: 13_000,
    record: { singleMs: 7_660, averageMs: 11_910, worldRank: 1, countryRank: 1 },
  });
  assert.equal(result.kind, "comparable");
  assert.match(result.note, /real cube/);
});

test("a keyboard rating is never presented as comparable", () => {
  // The property this whole module exists to protect. A keyboard average and a
  // competition average differ mostly because one is typed and the other is
  // turned, and presenting a delta invites reading it as progress or decline.
  const result = compare({
    event: "333",
    pool: "keyboard",
    cubeduelMs: 20_000,
    record: { singleMs: 7_660, averageMs: 11_910, worldRank: 1, countryRank: 1 },
  });
  assert.equal(result.kind, "different-skills");
  assert.match(result.note, /different things/);
  assert.match(result.note, /not worth subtracting/);
});

test("the comparison never returns a delta", () => {
  // Asserted structurally: there is no field to hold one, so no caller can
  // render "+1.2s" without adding it here deliberately.
  const result = compare({
    event: "333",
    pool: "keyboard",
    cubeduelMs: 20_000,
    record: { singleMs: 7_660, averageMs: 11_910, worldRank: null, countryRank: null },
  });
  assert.ok(!("delta" in result), "a delta field would invite a false reading");
  assert.ok(!("difference" in result));
  assert.ok(!("improvement" in result));
});

test("a missing number on either side is incomplete, not zero", () => {
  const noWca = compare({ event: "333", pool: "keyboard", cubeduelMs: 20_000, record: undefined });
  assert.equal(noWca.kind, "incomplete");
  assert.equal(noWca.wcaMs, null);
  assert.match(noWca.note, /competition/);

  const noRating = compare({
    event: "333",
    pool: "keyboard",
    cubeduelMs: null,
    record: { singleMs: 7_660, averageMs: 11_910, worldRank: null, countryRank: null },
  });
  assert.equal(noRating.kind, "incomplete");
  assert.equal(noRating.cubeduelMs, null);
  assert.match(noRating.note, /20 verified solves/);
});

test("a WCA average with no rating here still converts, for context", () => {
  // Knowing what your competition average is worth on this scale is useful even
  // before you have earned anything here — it is the reason to start.
  const result = compare({
    event: "333",
    pool: "keyboard",
    cubeduelMs: null,
    record: { singleMs: 7_660, averageMs: 11_910, worldRank: null, countryRank: null },
  });
  assert.equal(result.wcaAsRating, ratingForWcaAverage(11_910));
});
