import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { HISTORY_KEY, WELCOMED_ATTR, WELCOMED_KEY, welcomedScript } from "./firstVisit";

/** Runs the head script against a fake page; true if it marked the page. */
function marks(storage: Record<string, string> | "blocked"): boolean {
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
  return attrs.has(WELCOMED_ATTR);
}

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
