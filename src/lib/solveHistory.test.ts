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
