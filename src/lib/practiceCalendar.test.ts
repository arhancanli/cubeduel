import assert from "node:assert/strict";
import { test } from "node:test";

import { levelFor, practiceCalendar } from "./practiceCalendar";

// Thursday 24 September 2026, mid-afternoon, local time.
const NOW = new Date(2026, 8, 24, 15, 0, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

test("weeks run Monday to Sunday, the last one holding today", () => {
  const cal = practiceCalendar([], NOW, 4);
  assert.equal(cal.weeks.length, 4);
  assert.ok(cal.weeks.every((w) => w.length === 7));
  const last = cal.weeks[3];
  assert.equal(last[0].key, "2026-09-21"); // Monday
  assert.equal(last[3].key, "2026-09-24"); // today is the Thursday
  assert.equal(last[3].today, true);
  assert.deepEqual(last.map((d) => d.future), [false, false, false, false, true, true, true]);
  assert.equal(cal.weeks[0][0].key, "2026-08-31");
});

test("solves are counted on the solver's own days", () => {
  const cal = practiceCalendar(
    [at(2026, 9, 22, 23), at(2026, 9, 23, 0), at(2026, 9, 23, 1), at(2026, 9, 23, 22)],
    NOW,
    2,
  );
  const byKey = Object.fromEntries(cal.weeks.flat().map((d) => [d.key, d.count]));
  assert.equal(byKey["2026-09-22"], 1);
  assert.equal(byKey["2026-09-23"], 3);
  assert.equal(cal.days, 2);
  assert.equal(cal.solves, 4);
});

test("solves outside the window are not counted", () => {
  const cal = practiceCalendar([at(2025, 1, 1)], NOW, 26);
  assert.equal(cal.solves, 0);
  assert.equal(cal.days, 0);
});

test("a month is labelled at the first week that contains its first day", () => {
  const cal = practiceCalendar([], NOW, 9);
  const labels = cal.months.map((m) => [m.label, m.week]);
  // Weeks start 27 Jul, 3 Aug … 21 Sep. 1 Aug falls in the first week, 1 Sep in the week of 31 Aug.
  assert.deepEqual(labels, [["Aug", 0], ["Sep", 5]]);
});

test("a week across a clock change is still seven distinct days", () => {
  // Europe and America change clocks in late October / early November.
  const cal = practiceCalendar([], new Date(2026, 10, 10, 12), 6);
  const keys = cal.weeks.flat().map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("how dark a day is: fixed steps, so a square means the same thing every month", () => {
  assert.deepEqual([0, 1, 4, 5, 14, 15, 29, 30, 200].map(levelFor), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test("a solve stamped later this week (a clock set wrong) is not counted", () => {
  const cal = practiceCalendar([at(2026, 9, 26)], NOW, 2);
  assert.equal(cal.solves, 0);
});

test("the days stay right across a clock change, just after midnight", () => {
  const saved = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // Clocks go back at 2am on Sunday 1 November 2026. Looking from 00:30 on
    // the Monday after, every day key must still be a distinct calendar day,
    // and the Monday must be the 2nd.
    const cal = practiceCalendar([], new Date(2026, 10, 2, 0, 30), 3);
    const keys = cal.weeks.flat().map((d) => d.key);
    assert.equal(new Set(keys).size, 21);
    assert.equal(cal.weeks[2][0].key, "2026-11-02");
    assert.equal(cal.weeks[1][6].key, "2026-11-01");
  } finally {
    process.env.TZ = saved;
  }
});

test("a month starting on a Sunday is labelled at that week, not the next", () => {
  // 1 November 2026 is a Sunday: it belongs to the week of 26 October.
  const cal = practiceCalendar([], new Date(2026, 10, 10, 12), 3);
  assert.deepEqual(cal.months, [{ label: "Nov", week: 0 }]);
});
