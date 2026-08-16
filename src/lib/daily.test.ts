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
