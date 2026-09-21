import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeImported, parseCsTimerExport } from "./cstimerImport";
import type { StoredSolve } from "./solveHistory";

const T0 = Date.UTC(2025, 5, 1) / 1000;

/** A solve as csTimer stores it: [[penalty, ms], scramble, comment, unixSeconds]. */
const record = (penalty: number, ms: number, offset: number, scramble = "R U R' U'") => [
  [penalty, ms],
  scramble,
  "",
  T0 + offset,
];

function exportOf(sessions: Record<number, unknown[]>, sessionData?: unknown) {
  const file: Record<string, unknown> = {};
  for (const [index, solves] of Object.entries(sessions)) file[`session${index}`] = solves;
  if (sessionData !== undefined) file.properties = { sessionData };
  return JSON.stringify(file);
}

test("times, penalties and dates come across as csTimer meant them", () => {
  const parsed = parseCsTimerExport(
    exportOf({ 1: [record(0, 12345, 0), record(2000, 11000, 60), record(-1, 15000, 120)] }),
  );
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.solves.map((s) => [s.durationMs, s.penalty]),
    [
      [12345, "OK"],
      // The raw time, with the +2 held separately — as csTimer does, and as
      // history here does. Folding it in would count it twice.
      [11000, "PLUS2"],
      [15000, "DNF"],
    ],
  );
  assert.equal(parsed.solves[0].at, T0 * 1000);
  assert.ok(parsed.solves.every((s) => s.source === "manual" && s.origin === "cstimer"));
  assert.ok(parsed.solves.every((s) => s.moveCount === 0 && s.splits.length === 0));
});

test("only 3x3 sessions are brought across, and the others are named, not hidden", () => {
  const parsed = parseCsTimerExport(
    exportOf(
      { 1: [record(0, 12000, 0)], 2: [record(0, 2500, 10)], 3: [record(0, 13000, 20)] },
      // As csTimer writes it: a JSON string, not an object.
      JSON.stringify({ 1: { name: "main", opt: {} }, 2: { name: "2x2", opt: { scrType: "222so" } }, 3: { name: 3, scr: "333o" } }),
    ),
  );
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.sessions.map((s) => [s.name, s.usable, s.skippedBecause]),
    [
      ["main", 1, null],
      ["2x2", 0, "not 3x3 (222so)"],
      ["3", 1, null],
    ],
  );
  assert.deepEqual(parsed.solves.map((s) => s.durationMs), [12000, 13000], "the 2.5s 2x2 solve is not averaged with 3x3");
});

test("a session with no scramble type is csTimer's default, which is 3x3", () => {
  const parsed = parseCsTimerExport(exportOf({ 1: [record(0, 12000, 0)] }));
  assert.ok(parsed.ok && parsed.solves.length === 1);
});

test("older exports that store a session as a JSON string still read", () => {
  const parsed = parseCsTimerExport(JSON.stringify({ session1: JSON.stringify([record(0, 9000, 0)]) }));
  assert.ok(parsed.ok && parsed.solves.length === 1);
});

test("records that are not solves are counted as unreadable, never guessed at", () => {
  const parsed = parseCsTimerExport(
    exportOf({
      1: [
        record(0, 12000, 0),
        record(1500, 12000, 1), // a penalty csTimer does not write
        record(0, -5, 2),
        record(0, 12000, -T0 + 100), // 1970
        [[0, 12000], "R", ""], // no timestamp
        "garbage",
      ],
    }),
  );
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.solves.length, 1);
  assert.equal(parsed.unreadable, 5);
});

test("files that are not csTimer exports say so", () => {
  const notJson = parseCsTimerExport("<html>");
  assert.ok(!notJson.ok && /not JSON/.test(notJson.error));
  const noSessions = parseCsTimerExport(JSON.stringify({ hello: 1 }));
  assert.ok(!noSessions.ok && /No sessions/.test(noSessions.error));
});

test("the same file imported twice adds nothing the second time", () => {
  const parsed = parseCsTimerExport(exportOf({ 1: [record(0, 12000, 0), record(0, 13000, 60)] }));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const once = mergeImported([], parsed.solves, 2000);
  const twice = mergeImported(once.solves, parsed.solves, 2000);
  assert.equal(once.added, 2);
  assert.equal(twice.added, 0);
  assert.equal(twice.alreadyHad, 2);
  assert.equal(twice.solves.length, 2);
});

function local(id: string, at: number): StoredSolve {
  return {
    id,
    at,
    scramble: "",
    durationMs: 14000,
    penalty: "OK",
    moveCount: 60,
    tps: 4,
    splits: [],
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "keyboard",
    moves: "R.0",
  };
}

test("an import never pushes out a solve already here, however recent the imported ones are", () => {
  const existing = [local("a", T0 * 1000 - 10_000), local("b", T0 * 1000 - 5_000)];
  const parsed = parseCsTimerExport(
    exportOf({ 1: Array.from({ length: 10 }, (_, i) => record(0, 12000 + i, 100 + i)) }),
  );
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const merged = mergeImported(existing, parsed.solves, 5);
  assert.ok(merged.solves.some((s) => s.id === "a") && merged.solves.some((s) => s.id === "b"));
  assert.equal(merged.added, 3, "only the room that was left");
  assert.equal(merged.leftOut, 7);
  // The newest imported solves fill the room — the analysis reads recent windows.
  assert.deepEqual(merged.solves.slice(-3).map((s) => s.durationMs), [12007, 12008, 12009]);
});

test("merged history is in time order, so a trend does not read old times as new", () => {
  const existing = [local("today", T0 * 1000 + 1_000_000)];
  const parsed = parseCsTimerExport(exportOf({ 1: [record(0, 12000, 0), record(0, 11000, 10)] }));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const merged = mergeImported(existing, parsed.solves, 2000);
  const ats = merged.solves.map((s) => s.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
  assert.equal(merged.solves.at(-1)!.id, "today");
});

test("a real csTimer export reads as csTimer wrote it", async () => {
  // Written by csTimer itself (cstimer.net, September 2026): three solves pushed
  // through its own timer signal — OK, +2, DNF — then a second session switched
  // to 2x2 through its session selector, and the file produced by its own export
  // routine. Only the fields this importer reads were kept, so the fixture holds
  // none of the site's other settings. Everything above is hand-built from
  // reading csTimer's source; this is the check that the reading was right.
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("../../e2e/fixtures/cstimer-export.txt", import.meta.url), "utf8");
  const parsed = parseCsTimerExport(text);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  if (!parsed.ok) return;

  assert.deepEqual(
    parsed.solves.map((s) => [s.durationMs, s.penalty]),
    [
      [12345, "OK"],
      [11000, "PLUS2"],
      [15000, "DNF"],
    ],
  );
  assert.deepEqual(
    parsed.sessions.map((s) => [s.index, s.usable, s.skippedBecause]),
    [
      [1, 3, null],
      [2, 0, "not 3x3 (222so)"],
    ],
    "empty sessions are not listed; the 2x2 one is named and left out",
  );
  assert.equal(parsed.solves[0].scramble, "R U R' U' F2 D L2 B R' U2");
  assert.equal(parsed.unreadable, 0);
});
