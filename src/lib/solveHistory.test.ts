import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * These run in Node, where `window` is undefined, so the module's storage guards are
 * exercised directly. A fake localStorage is installed to test the parsing path.
 */
function withStorage(raw: string | null, fn: () => void) {
  const store = new Map<string, string>();
  if (raw !== null) store.set("cubeduel.history.v1", raw);
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  try {
    fn();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

const good = {
  id: "a",
  at: 1,
  scramble: "R U R'",
  durationMs: 12000,
  penalty: "OK",
  moveCount: 40,
  tps: 4,
  splits: [{ phase: "Cross", startMs: 0, endMs: 1000, durationMs: 1000, moveCount: 6, tps: 6 }],
  ollCase: null,
  pllCase: null,
  ollSetup: null,
  pllSetup: null,
  source: "keyboard",
};

test("a malformed record is dropped instead of taking the page down", async () => {
  const { loadHistory } = await import("./solveHistory");
  const payload = JSON.stringify({
    version: 1,
    solves: [
      good,
      { ...good, id: "b", durationMs: "twelve" },
      { ...good, id: "c", splits: "not-an-array" },
      { ...good, id: "d", penalty: "MAYBE" },
      { ...good, id: "e", splits: [{ phase: "Cross", durationMs: NaN }] },
      null,
      { ...good, id: "f" },
    ],
  });
  withStorage(payload, () => {
    const solves = loadHistory();
    assert.deepEqual(
      solves.map((s) => s.id),
      ["a", "f"],
      "every good record survives, every bad one is dropped",
    );
  });
});

test("corrupt JSON yields an empty history rather than throwing", async () => {
  const { loadHistory } = await import("./solveHistory");
  withStorage("{ not json", () => assert.deepEqual(loadHistory(), []));
  withStorage(JSON.stringify({ version: 99, solves: [] }), () =>
    assert.deepEqual(loadHistory(), []),
  );
  withStorage(null, () => assert.deepEqual(loadHistory(), []));
});

// ---------------------------------------------------------------------------
// Move streams, and running out of room for them
// ---------------------------------------------------------------------------

test("a record carrying a move stream loads; one with a malformed stream field does not", async () => {
  const { loadHistory } = await import("./solveHistory");
  const payload = JSON.stringify({
    version: 1,
    solves: [
      { ...good, id: "with", moves: "R.0 U.3c" },
      { ...good, id: "without" },
      { ...good, id: "broken", moves: ["R", "U"] },
    ],
  });
  withStorage(payload, () => {
    assert.deepEqual(
      loadHistory().map((s) => s.id),
      ["with", "without"],
    );
  });
});

test("shedding removes the oldest streams first and never a solve", async () => {
  const { shedOldestStreams } = await import("./solveHistory");
  const solves = ["a", "b", "c", "d", "e"].map((id) => ({ ...good, id, moves: "R.0" })) as never[];
  const once = shedOldestStreams(solves)!;
  assert.equal(once.length, 5);
  // A quarter at a time (rounded up), oldest first.
  assert.deepEqual(
    once.map((s: { moves?: string }) => s.moves !== undefined),
    [false, false, true, true, true],
  );
  const twice = shedOldestStreams(once)!;
  assert.deepEqual(
    twice.map((s: { moves?: string }) => s.moves !== undefined),
    [false, false, false, true, true],
  );
  let rest = twice;
  while (rest.some((s: { moves?: string }) => s.moves !== undefined)) rest = shedOldestStreams(rest)!;
  assert.equal(shedOldestStreams(rest), null, "nothing left to shed");
});

test("a full quota costs old replays, not solves", async () => {
  const { recordSolve, loadHistory } = await import("./solveHistory");
  const store = new Map<string, string>();
  const QUOTA = 6000;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > QUOTA) throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    },
  };
  try {
    const stream = Array.from({ length: 60 }, (_, i) => `R.${(i * 7).toString(36)}`).join(" ");
    for (let i = 0; i < 12; i++) {
      recordSolve({ ...(good as object), id: `s${i}`, moves: stream } as never);
    }
    const solves = loadHistory();
    assert.equal(solves.length, 12, "every solve was kept");
    assert.ok(solves.at(-1)!.moves, "the newest solve keeps its replay");
    assert.ok(!solves[0].moves, "the oldest gave its replay up");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("an import into nearly full storage takes fewer solves, never a replay already here", async () => {
  const { importSolves, loadHistory, recordSolve } = await import("./solveHistory");
  const store = new Map<string, string>();
  const QUOTA = 9000;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > QUOTA) throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    },
  };
  try {
    const stream = Array.from({ length: 60 }, (_, i) => `R.${(i * 7).toString(36)}`).join(" ");
    for (let i = 0; i < 6; i++) recordSolve({ ...(good as object), id: `own${i}`, moves: stream } as never);
    const before = loadHistory();
    assert.ok(before.every((s) => s.moves), "every solve here starts with its replay");

    const imported = Array.from({ length: 200 }, (_, i) => ({
      ...(good as object),
      id: `cst${i}`,
      at: 1_600_000_000_000 + i,
      splits: [],
      source: "manual",
      origin: "cstimer",
    })) as never[];
    const result = importSolves(imported);

    const after = loadHistory();
    assert.ok(result.saved);
    assert.ok(result.storageFull, "it says storage, not the 2,000 cap, is what stopped it");
    assert.ok(result.added > 0 && result.added < 200, `${result.added} added`);
    assert.equal(result.added + result.leftOut, 200);
    assert.ok(
      after.filter((s) => s.id.startsWith("own")).every((s) => s.moves === stream),
      "no replay already here was given up",
    );
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
