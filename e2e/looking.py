"""
Looking and turning, measured through the real pipeline.

Every other check of recognition runs on hand-made timestamps. This one types a
CFOP solve on the keyboard, stops for a measured beat before one F2L pair, and
asserts that the pause lands in exactly that pair's "looking" — keyboard, then
recorder, then analysis, then the bar on screen. A pause credited to the wrong
pair, or to turning, is the failure this exists to catch, and nothing short of
real keypresses with real waits can show it.

It also checks the stream is KEPT — the local history used to store a practice
solve's phase totals and throw its turns away — and that /progress refuses to
tabulate looking and turning until five solves have measured it.

    BASE=http://localhost:3000 python3 e2e/looking.py
"""

import json
import os
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []

KEY_FOR_MOVE = {
    "U": "KeyJ", "U'": "KeyF",
    "D": "KeyS", "D'": "KeyL",
    "R": "KeyI", "R'": "KeyK",
    "L": "KeyD", "L'": "KeyE",
    "F": "KeyH", "F'": "KeyG",
    "B": "KeyW", "B'": "KeyO",
}

# A CFOP solve in which every step completes exactly one milestone, so each phase
# ends on its step's last move (see src/lib/cfop.test.ts, where it was found).
STEPS = [
    "D2 R' D'",
    "U R U' R'",
    "U R' U' R",
    "U L U' L'",
    "U L' U' L",
    "R U R' U R U2 R'",
    "R U R' U' R' F R2 U' R' U' R U R' F'",
]
PAUSE_BEFORE_PAIR_2_MS = 1200
GAP_MS = 60


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def invert(move):
    if move.endswith("2"):
        return move
    if move.endswith("'"):
        return move[:-1]
    return move + "'"


def keys_for(move):
    if move.endswith("2"):
        return [KEY_FOR_MOVE[move[:-1]]] * 2
    return [KEY_FOR_MOVE[move]]


SOLUTION = " ".join(STEPS).split()
SCRAMBLE = " ".join(invert(m) for m in reversed(SOLUTION))
URL = BASE + "/play?scramble=" + urllib.parse.quote(SCRAMBLE)


def play_once(page, pause_ms):
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(2500)
    for s, step in enumerate(STEPS):
        if s == 2:
            page.wait_for_timeout(pause_ms)
        for move in step.split():
            for key in keys_for(move):
                page.keyboard.press(key)
                page.wait_for_timeout(GAP_MS)
    page.wait_for_timeout(2500)


def history(page):
    raw = page.evaluate("() => localStorage.getItem('cubeduel.history.v1')")
    return json.loads(raw)["solves"] if raw else []


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== a pause before pair 2 ==")
    play_once(page, PAUSE_BEFORE_PAIR_2_MS)
    body = page.inner_text("body")
    check("the cube is solved", "Solved" in body)

    looks = {}
    for el in page.locator("[data-look-ms]").all():
        label = el.get_attribute("aria-label") or ""
        looks[label.split(":")[0]] = int(el.get_attribute("data-look-ms"))
    check("every phase after the cross has a looking segment",
          sorted(looks) == sorted(["F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"]), str(sorted(looks)))

    pair2 = looks.get("F2L 2", -1)
    # Looking is the pause less one ordinary turn, so it lands on the pause
    # itself give or take the browser's own timing — 1199ms against production,
    # which a floor of exactly the pause called a failure.
    check("the pause lands in pair 2's looking",
          PAUSE_BEFORE_PAIR_2_MS - 100 <= pair2 <= PAUSE_BEFORE_PAIR_2_MS + 300, f"{pair2}ms")
    others = {k: v for k, v in looks.items() if k != "F2L 2"}
    check("and nowhere else", all(v < 400 for v in others.values()), str(others))

    total = page.locator("[data-testid=total-looking]")
    check("the total looking time is stated", total.count() == 1 and "spent looking" in total.inner_text(),
          total.inner_text() if total.count() else "missing")
    summary = [l for l in body.split("\n") if "took the longest" in l]
    check("the costliest phase is named with its looking", summary and "before its first turn" in summary[0],
          summary[:1])

    print("\n== the stream is kept ==")
    solves = history(page)
    last = solves[-1] if solves else {}
    tokens = (last.get("moves") or "").split()
    presses = sum(len(keys_for(m)) for m in SOLUTION)
    check("the solve keeps every turn", len(tokens) == presses, f"{len(tokens)} of {presses}")
    check("its splits carry recognition",
          all("recognitionMs" in s for s in last.get("splits", [])), str(last.get("splits", [])[:1])[:120])
    check("a keyboard solve is recorded as keyboard", last.get("source") == "keyboard")

    print("\n== /progress waits for five ==")
    page.goto(BASE + "/progress", wait_until="networkidle")
    page.wait_for_timeout(1200)
    check("no table from one solve", page.locator("[data-testid=look-turn]").count() == 0)
    check("it says what it needs", "Needs five solves" in page.inner_text("body"))

    for _ in range(4):
        play_once(page, PAUSE_BEFORE_PAIR_2_MS)

    page.goto(BASE + "/progress", wait_until="networkidle")
    page.wait_for_timeout(1500)
    table = page.locator("[data-testid=look-turn]")
    check("the table appears at five", table.count() == 1)
    if table.count() == 1:
        text = table.inner_text()
        f2l = [l for l in text.split("\n") if l.strip() == "F2L"]
        check("F2L is tabulated", len(f2l) >= 1, text[:160].replace("\n", " | "))

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:160])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
