import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Sync against a fake network and a fake localStorage, in Node.
 *
 * The case that matters is a race: somebody imports a csTimer history while a
 * sync is already partway through a long history. The sync advances its
 * watermark after every batch, so an import that simply moved the watermark
 * back had it moved straight forward again by the next batch — and the imported
 * solves, all older than it, were never sent.
 */

const HISTORY_KEY = "cubeduel.history.v1";

function solve(id: string, at: number) {
  return {
    id,
    at,
    scramble: "R U",
    durationMs: 12000,
    penalty: "OK",
    moveCount: 0,
    tps: 0,
    splits: [],
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "manual",
  };
}

function install(solves: ReturnType<typeof solve>[]) {
  const store = new Map<string, string>([[HISTORY_KEY, JSON.stringify({ version: 1, solves })]]);
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return store;
}

test("solves imported while a sync is running are still sent by the next one", async () => {
  const { syncLocalHistory, resyncFrom } = await import("./sync");

  // 250 recent solves: three batches of 100.
  const recent = Array.from({ length: 250 }, (_, i) => solve(`r${i}`, 1_700_000_000_000 + i));
  const store = install(recent);
  const imported = Array.from({ length: 5 }, (_, i) => solve(`cst${i}`, 1_600_000_000_000 + i));

  const sent: string[] = [];
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    calls += 1;
    const body = JSON.parse(init.body) as { solves: { id: string }[] };
    sent.push(...body.solves.map((s) => s.id));
    if (calls === 1) {
      // The import lands between the first and second batch.
      const history = JSON.parse(store.get(HISTORY_KEY)!);
      history.solves = [...imported, ...history.solves];
      store.set(HISTORY_KEY, JSON.stringify(history));
      resyncFrom(imported[0].at);
    }
    return { ok: true, json: async () => ({ stored: body.solves.length, skipped: 0 }) };
  }) as never;

  try {
    await syncLocalHistory();
    assert.ok(!sent.some((id) => id.startsWith("cst")), "the running sync never saw them");
    await syncLocalHistory();
    assert.deepEqual(
      imported.map((s) => sent.includes(s.id)),
      [true, true, true, true, true],
      "the next sync sends every imported solve",
    );
    const before = sent.length;
    await syncLocalHistory();
    assert.equal(sent.length, before, "and once they are sent, the rewind is spent");
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { window?: unknown }).window;
  }
});
