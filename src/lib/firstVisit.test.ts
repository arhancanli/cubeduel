import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { HISTORY_KEY, RETURNING_ATTR, WELCOMED_ATTR, WELCOMED_KEY, welcomedScript } from "./firstVisit";

/** Runs the head script against a fake page; the attributes it set. */
function attributes(storage: Record<string, string> | "blocked"): Set<string> {
  const attrs = new Set<string>();
  const localStorage =
    storage === "blocked"
      ? undefined
      : { getItem: (k: string) => (k in storage ? storage[k] : null) };
  const window = {
    get localStorage() {
      if (!localStorage) throw new Error("SecurityError");
      return localStorage;
    },
  };
  const document = { documentElement: { setAttribute: (name: string) => attrs.add(name) } };
  runInNewContext(welcomedScript, { window, document, JSON });
  return attrs;
}

const marks = (storage: Record<string, string> | "blocked") => attributes(storage).has(WELCOMED_ATTR);
const returning = (storage: Record<string, string> | "blocked") => attributes(storage).has(RETURNING_ATTR);

test("somebody with solves is marked returning, so the home page can hold room for their stats", () => {
  assert.equal(returning({ [HISTORY_KEY]: JSON.stringify({ version: 1, solves: [{ ms: 12000 }] }) }), true);
});

test("dismissing the welcome, or blocked storage, is not having solves", () => {
  assert.equal(returning({ [WELCOMED_KEY]: "1" }), false);
  assert.equal(returning("blocked"), false);
  assert.equal(returning({}), false);
  assert.equal(returning({ [HISTORY_KEY]: JSON.stringify({ version: 1, solves: [] }) }), false);
});

test("somebody new is welcomed", () => {
  assert.equal(marks({}), false);
});

test("somebody who dismissed the welcome is not welcomed again", () => {
  assert.equal(marks({ [WELCOMED_KEY]: "1" }), true);
});

test("somebody with solves is not welcomed", () => {
  assert.equal(marks({ [HISTORY_KEY]: JSON.stringify({ version: 1, solves: [{ ms: 12000 }] }) }), true);
});

test("an empty history is still somebody new", () => {
  assert.equal(marks({ [HISTORY_KEY]: JSON.stringify({ version: 1, solves: [] }) }), false);
});

test("blocked storage skips the welcome rather than showing it every visit", () => {
  assert.equal(marks("blocked"), true);
});

test("a corrupt history does not break the page", () => {
  assert.equal(marks({ [HISTORY_KEY]: "{not json" }), true);
});
