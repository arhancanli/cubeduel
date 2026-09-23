"""The keyboard layout on screen, against the moves that actually come out.

    python3 e2e/keymap.py

`src/lib/keyMap.ts` is a table this app draws on screen. It is NOT the table
that decides anything: cubing.js owns the real bindings, and the app only uses
its own copy to highlight whichever key was pressed. So the two can disagree,
and if they ever do, the app teaches a beginner the wrong keys with total
confidence — which is worse than showing nothing at all.

Its docblock claimed a test like this already existed. None did.

The method takes nothing on trust. For each binding, the cube's actual pattern
is read before and after the key is pressed, and then every candidate move is
applied to the "before" pattern to see which one reproduces the "after". The
move is identified by the puzzle, not by any table in this repository.
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
HERE = os.path.dirname(os.path.abspath(__file__))
KEYMAP = os.path.join(HERE, "..", "src", "lib", "keyMap.ts")

FACES = ["U", "D", "R", "L", "F", "B"]
WIDE = ["u", "d", "r", "l", "f", "b"]
SLICES = ["M", "E", "S"]
ROTATIONS = ["x", "y", "z"]

CANDIDATES = []
for base in FACES + WIDE + SLICES + ROTATIONS:
    CANDIDATES += [base, f"{base}'", f"{base}2"]

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def displayed_bindings():
    """Read the table straight out of the source it is drawn from."""
    src = open(KEYMAP).read()
    found = re.findall(r'\{ code: "(\w+)", label: "([^"]+)", move: "([^"]+)" \}', src)
    return [{"code": c, "label": l, "move": m} for c, l, m in found]


READ_PATTERN = """async () => {
    const m = document.querySelector('twisty-player').experimentalModel;
    const p = await m.currentPattern.get();
    return JSON.stringify(p.patternData);
}"""

IDENTIFY = """async ([beforeJson, candidates]) => {
    const m = document.querySelector('twisty-player').experimentalModel;
    const after = await m.currentPattern.get();
    const afterJson = JSON.stringify(after.patternData);
    if (afterJson === beforeJson) return { move: null, afterJson };

    const kpuzzle = await m.kpuzzle.get();
    // Rebuild the "before" pattern inside the puzzle so candidates can be
    // applied to it. Comparing serialised orbit data is exact.
    const before = new after.constructor(kpuzzle, JSON.parse(beforeJson));
    const matches = [];
    for (const move of candidates) {
        try {
            if (JSON.stringify(before.applyMove(move).patternData) === afterJson) {
                matches.push(move);
            }
        } catch (e) { /* not a legal move on this puzzle */ }
    }
    return { move: matches[0] ?? null, matches, afterJson };
}"""


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/play", wait_until="networkidle", timeout=90000)
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(5000)

    bindings = displayed_bindings()
    check("the layout on screen has bindings to check", len(bindings) > 0, f"{len(bindings)}")

    print(f"\n== {len(bindings)} bindings, each identified by the puzzle ==")
    wrong = []
    dead = []

    for b in bindings:
        before_json = page.evaluate(READ_PATTERN)
        page.keyboard.press(b["code"])
        page.wait_for_timeout(260)
        result = page.evaluate(IDENTIFY, [before_json, CANDIDATES])
        actual = result.get("move")

        if actual is None:
            dead.append(b)
        elif actual != b["move"]:
            wrong.append((b, actual))

        flag = "ok" if actual == b["move"] else "MISMATCH" if actual else "NOTHING"
        print(f"    {b['label']:>3}  shown as {b['move']:<3}  produces {str(actual):<4} {flag}")

    print()
    check("every key on screen actually turns the cube", not dead,
          ", ".join(f"{b['label']} ({b['move']})" for b in dead))
    check("every key produces the move printed beside it", not wrong,
          "; ".join(f"{b['label']} shows {b['move']} but does {a}" for b, a in wrong))

    check("no page errors", not errors, str(errors[:2]))
    browser.close()

print("\nAll checks passed." if fails == 0 else f"\n{fails} check(s) failed.")
sys.exit(0 if fails == 0 else 1)
