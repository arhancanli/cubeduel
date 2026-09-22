import { test } from "node:test";
import assert from "node:assert/strict";

import { safeNext } from "./nextPath";

test("a path on this site is followed", () => {
  for (const path of ["/race/abcd2345", "/c/school-club", "/progress", "/u/some_one"]) {
    assert.equal(safeNext(path), path);
  }
});

test("anything that could leave the site is refused", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/race//x",
    "race/abcd2345",
    "/progress?x=https://evil.example",
    "/" + "a".repeat(200),
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeNext(value as string | null | undefined), null, String(value));
  }
});
