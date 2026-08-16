import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildShareText,
  dayNumber,
  formatCountdown,
  msUntilNextUtcDay,
  speedTier,
  tierLabel,
  utcDayKey,
} from "./daily";

test("the day key is the UTC date, not the local one", () => {
  // 23:30 UTC on the 11th is already the 12th in Dubai, but the round is still
  // day 11 for everyone.
  assert.equal(utcDayKey(new Date("2026-08-11T23:30:00Z")), "2026-08-11");
  assert.equal(utcDayKey(new Date("2026-08-12T00:00:00Z")), "2026-08-12");
});

test("the countdown targets the next UTC midnight", () => {
  const ms = msUntilNextUtcDay(new Date("2026-08-11T23:00:00Z"));
  assert.equal(ms, 60 * 60 * 1000);
  assert.equal(msUntilNextUtcDay(new Date("2026-08-11T00:00:00Z")), 24 * 60 * 60 * 1000);
});

test("countdown formats as hours, minutes, seconds", () => {
  assert.equal(formatCountdown(3661000), "1h 01m 01s");
  assert.equal(formatCountdown(0), "0h 00m 00s");
});

test("day numbers are 1-indexed from the first daily", () => {
  assert.equal(dayNumber("2026-08-11", "2026-08-11"), 1);
  assert.equal(dayNumber("2026-08-11", "2026-08-12"), 2);
  assert.equal(dayNumber("2026-08-11", "2026-09-10"), 31);
});

test("tier thresholds are exclusive — 10.00 is not sub-10", () => {
  assert.equal(speedTier(9_999), 5);
  assert.equal(speedTier(10_000), 4);
  assert.equal(speedTier(14_999), 4);
  assert.equal(speedTier(19_999), 3);
  assert.equal(speedTier(29_999), 2);
  assert.equal(speedTier(59_999), 1);
  assert.equal(speedTier(60_000), 0);
  assert.equal(speedTier(null), 0);
});

test("tier labels use the community's own vocabulary", () => {
  assert.equal(tierLabel(9_000), "sub-10");
  assert.equal(tierLabel(18_000), "sub-20");
  assert.equal(tierLabel(90_000), "over a minute");
  assert.equal(tierLabel(null), "DNF");
});

test("the share text is spoiler-free and paste-safe", () => {
  const text = buildShareText(
    { dayKey: "2026-08-12", ms: 14_230, penalty: "OK" },
    "2026-08-11",
  );
  assert.equal(text, "cubeduel daily #2\n🟩🟩🟩🟩⬛ 14.23\ncubeduel.app/daily");
  // The scramble must never appear in the share.
  assert.ok(!text.includes("R U"));
});

test("a +2 shares at its penalised time and can drop a tier", () => {
  const text = buildShareText(
    { dayKey: "2026-08-11", ms: 14_500, penalty: "PLUS2" },
    "2026-08-11",
  );
  // 14.50 + 2 = 16.50, which is sub-20 rather than sub-15.
  assert.ok(text.includes("16.50"));
  assert.ok(text.includes("🟩🟩🟩⬛⬛"));
});

test("a DNF shares as an empty bar", () => {
  const text = buildShareText(
    { dayKey: "2026-08-11", ms: 12_000, penalty: "DNF" },
    "2026-08-11",
  );
  assert.ok(text.includes("⬛⬛⬛⬛⬛ DNF"));
});

test("a hand-timed result never shares as verified", () => {
  // The app cannot check a physical cube — an idle tab produces a convincing 4.00.
  // The share must not carry a mark that implies someone checked.
  const selfTimed = buildShareText(
    { dayKey: "2026-08-11", ms: 4_000, penalty: "OK" },
    "2026-08-11",
  );
  assert.ok(!selfTimed.includes("✓"), selfTimed);

  const watched = buildShareText(
    { dayKey: "2026-08-11", ms: 4_000, penalty: "OK", verified: true },
    "2026-08-11",
  );
  assert.ok(watched.includes("✓"), watched);
  // The mark is the only difference — the time and bar are identical either way.
  assert.equal(watched.replace(" ✓", ""), selfTimed);
});

// ---------------------------------------------------------------------------
// The shape share
// ---------------------------------------------------------------------------

import { SHAPE_WIDTH, buildDailyShare, buildShapeBar } from "./daily";

/** Counts code points, not UTF-16 units — every block here is a surrogate pair. */
const blocks = (bar: string) => [...bar].length;

const split = (phase: string, durationMs: number) => ({ phase, durationMs });

test("the shape bar is always exactly the same width", () => {
  // The entire value of the artifact is that two people can lay theirs side by
  // side. A bar whose length changes with the solve is not comparable, and
  // rounding each phase independently produces exactly that.
  const cases = [
    [split("cross", 1000), split("F2L", 8000), split("OLL", 2000), split("PLL", 2000)],
    [split("cross", 500), split("F2L", 20000), split("OLL", 300), split("PLL", 400)],
    [split("cross", 1), split("F2L", 1), split("OLL", 1), split("PLL", 1)],
    [split("cross", 9999), split("F2L", 1), split("OLL", 1), split("PLL", 1)],
    [split("cross", 3333), split("F2L", 3333), split("OLL", 3333), split("PLL", 1)],
  ];
  for (const splits of cases) {
    assert.equal(blocks(buildShapeBar(splits)), SHAPE_WIDTH, JSON.stringify(splits));
  }
});

test("a phase that happened is never invisible", () => {
  // A 0.2s PLL inside a 40s solve rounds to nothing. Showing that solve as having
  // no PLL is a lie in the one place people look closely.
  const bar = buildShapeBar([
    split("cross", 2000),
    split("F2L", 38000),
    split("OLL", 3000),
    split("PLL", 200),
  ]);
  assert.equal(blocks(bar), SHAPE_WIDTH);
  assert.ok(bar.includes("\u{1F7EA}"), "PLL must still appear");
});

test("phases appear in solve order", () => {
  const bar = buildShapeBar([
    split("cross", 1000),
    split("F2L", 5000),
    split("OLL", 2000),
    split("PLL", 2000),
  ]);
  const order = [...bar];
  const firstOf = (block: string) => order.indexOf(block);
  assert.ok(firstOf("\u{1F7E6}") < firstOf("\u{1F7E8}"), "cross before F2L");
  assert.ok(firstOf("\u{1F7E8}") < firstOf("\u{1F7E9}"), "F2L before OLL");
  assert.ok(firstOf("\u{1F7E9}") < firstOf("\u{1F7EA}"), "OLL before PLL");
});

test("a solve with no usable splits produces no bar", () => {
  assert.equal(buildShapeBar([]), "");
  assert.equal(buildShapeBar([split("cross", 0), split("F2L", 0)]), "");
  assert.equal(buildShapeBar([split("nonsense", 5000)]), "");
});

test("a hand-timed daily falls back to the speed bar", () => {
  // No move stream means no splits. The share must still work, and must not
  // pretend to know where the time went.
  const text = buildDailyShare(
    { dayKey: "2026-08-16", ms: 18420, penalty: "OK", verified: false },
    "2026-08-01",
    [],
  );
  assert.ok(text.includes("18.42"));
  assert.ok(!text.includes("cross"), "must not claim a breakdown it does not have");
});

test("a verified daily shares where the time went", () => {
  const text = buildDailyShare(
    { dayKey: "2026-08-16", ms: 18420, penalty: "OK", verified: true },
    "2026-08-01",
    [split("cross", 2000), split("F2L", 9000), split("OLL", 4000), split("PLL", 3420)],
  );
  assert.ok(text.includes("daily #16"), text);
  assert.ok(text.includes("18.42"));
  assert.ok(text.includes("✓"), "a verified solve is marked");
  assert.ok(text.includes("cross · F2L · OLL · PLL"), "the legend explains the colours");
});

test("a DNF never gets a shape", () => {
  // There is no breakdown of a solve that did not finish.
  const text = buildDailyShare(
    { dayKey: "2026-08-16", ms: 0, penalty: "DNF", verified: true },
    "2026-08-01",
    [split("cross", 2000), split("F2L", 9000)],
  );
  assert.ok(text.includes("DNF"));
  assert.ok(!text.includes("cross"));
});

test("the share stays short enough to paste anywhere", () => {
  const text = buildDailyShare(
    { dayKey: "2026-08-16", ms: 18420, penalty: "OK", verified: true },
    "2026-08-01",
    [split("cross", 2000), split("F2L", 9000), split("OLL", 4000), split("PLL", 3420)],
  );
  // Comfortably inside a post limit, and no line long enough to wrap on a phone.
  assert.ok(text.length < 200, `${text.length} chars`);
  for (const line of text.split("\n")) {
    assert.ok([...line].length <= 32, `line too long: ${line}`);
  }
});
