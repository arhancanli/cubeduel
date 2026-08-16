"""
End-to-end checks for keyboard cubing.

The real proof of the whole pipeline: read the scramble off the page, invert it,
type the inverse on the keyboard, and assert the clock stopped on its own. That
exercises input -> move stream -> state tracker -> solved detection -> timer in one
pass, and it is the only way to be sure the cube the player sees agrees with the
state the app is judging.

    BASE=http://localhost:3000 python3 e2e/play.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []

# Mirrors cubing.js's 3x3x3 layout. Asserting real moves come out of these keys is
# what stops the on-screen key hints from drifting into a lie.
KEY_FOR_MOVE = {
    "U": "KeyJ", "U'": "KeyF",
    "D": "KeyS", "D'": "KeyL",
    "R": "KeyI", "R'": "KeyK",
    "L": "KeyD", "L'": "KeyE",
    "F": "KeyH", "F'": "KeyG",
    "B": "KeyW", "B'": "KeyO",
}


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def invert(move):
    if move.endswith("2"):
        return move          # a half turn is its own inverse
    if move.endswith("'"):
        return move[:-1]
    return move + "'"


def keys_for(move):
    """A half turn is the same key twice; everything else is one press."""
    if move.endswith("2"):
        return [KEY_FOR_MOVE[move[:-1]]] * 2
    return [KEY_FOR_MOVE[move]]


def solve_by_keyboard(page, scramble):
    """Type the inverse of the scramble, which by definition solves the cube."""
    for move in reversed(scramble.split()):
        for key in keys_for(invert(move)):
            page.keyboard.press(key)
            page.wait_for_timeout(18)


def timer_text(page):
    return page.locator("div.tnum").first.inner_text().strip()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/play", wait_until="networkidle")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(4000)

    print("\n== setup ==")
    scramble = " ".join(
        s.strip() for s in page.locator("div.font-mono").first.inner_text().split()
    )
    check("a scramble is shown", len(scramble.split()) >= 18, f"{len(scramble.split())} moves")
    check("the input is connected", "Input:" in page.inner_text("body"),
          [l for l in page.inner_text("body").split("\n") if "Input" in l][:1])
    check("the keyboard layout is on screen", "→" in page.inner_text("body"))
    check("the clock starts at zero", timer_text(page) == "0.00")

    print("\n== rotations are free ==")
    page.keyboard.press("Semicolon")   # y
    page.keyboard.press("KeyA")        # y'
    page.wait_for_timeout(400)
    check("rotating does not start the clock", timer_text(page) == "0.00", timer_text(page))

    print("\n== a turn starts the clock ==")
    page.keyboard.press("KeyI")        # R
    page.wait_for_timeout(500)
    running = timer_text(page)
    check("the first layer turn starts the clock", running != "0.00", running)
    check("the move counter is live", "moves" in page.inner_text("body"))

    # Undo that turn so the inverse scramble still solves the cube.
    page.keyboard.press("KeyK")        # R'
    page.wait_for_timeout(150)

    print("\n== solving stops the clock by itself ==")
    solve_by_keyboard(page, scramble)
    page.wait_for_timeout(800)

    body = page.inner_text("body")
    check("the cube is detected as solved", "Solved" in body,
          body[:0] or timer_text(page))
    final = timer_text(page)
    check("a final time is shown", final not in ("0.00", ""), final)

    page.wait_for_timeout(600)
    check("the clock is stopped, not still running", timer_text(page) == final,
          f"{final} -> {timer_text(page)}")

    print("\n== the solve report ==")
    check("move count is reported", "MOVES" in body.upper())
    check("turn speed is reported", "TPS" in body.upper())
    check("pause time is reported", "PAUSED" in body.upper())
    check("longest pause is reported", "LONGEST PAUSE" in body.upper())

    print("\n== phase breakdown ==")
    page.wait_for_timeout(1500)
    body = page.inner_text("body")
    rows = page.locator("div:has(> span) >> text=/ mv$/")
    check("the solve is split into phases", rows.count() >= 1, f"{rows.count()} phases")
    check("each phase reports moves and turn rate", "mv" in body and "tps" in body)
    check("the costliest phase is named", "took the longest at" in body,
          [l for l in body.split("\n") if "took the longest" in l][:1])

    print("\n== next scramble resets everything ==")
    page.click("button:has-text('Next scramble')")
    page.wait_for_timeout(2500)
    check("the clock resets", timer_text(page) == "0.00", timer_text(page))
    new_scramble = " ".join(
        s.strip() for s in page.locator("div.font-mono").first.inner_text().split()
    )
    check("a new scramble is issued", new_scramble != scramble)
    check("the report is cleared", "TPS" not in page.inner_text("body").upper())
    check("the breakdown is cleared", "took the longest at" not in page.inner_text("body"))

    print("\n== the solve reaches history ==")
    page.goto(BASE + "/progress", wait_until="networkidle")
    page.wait_for_timeout(1200)
    prog = page.inner_text("body")
    check("the solve was recorded", "SOLVES" in prog.upper())
    check("phases are aggregated", "BY PHASE" in prog.upper())
    # The honesty property: one solve is not enough to name a weakness.
    check("no weakness is claimed from one solve", "Not enough solves" in prog,
          [l for l in prog.split("\n") if "enough" in l][:1])
    check("a trend is refused below the minimum", "at least 12 analysed solves" in prog)
    page.screenshot(path="/tmp/progress-thin.png", full_page=True)

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:160])

    page.screenshot(path="/tmp/play.png", full_page=True)
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
