"""
End-to-end check for the case trainer.

The trainer's whole claim is that it schedules on measured time rather than a
self-reported guess, and there are two ways for that to be silently false: the
clock never starts, or the rep never ends. Both leave a page that looks fine.

So this drives a real browser, types a real algorithm on the keyboard, and asserts
the drill actually completed and the deck advanced.

    BASE=http://localhost:3000 python3 e2e/train.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []

# Mirrors cubing.js's 3x3x3 layout, same table the /play check uses.
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
        return move
    if move.endswith("'"):
        return move[:-1]
    return move + "'"


def keys_for(move):
    if move.endswith("2"):
        return [KEY_FOR_MOVE[move[:-1]]] * 2
    return [KEY_FOR_MOVE[move]]


def type_alg(page, alg):
    """Types an algorithm move by move."""
    for move in alg.split():
        for key in keys_for(move):
            page.keyboard.press(key)
            page.wait_for_timeout(20)


def timer_text(page):
    return page.locator("div.tnum").first.inner_text().strip()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/train", wait_until="networkidle")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(4000)

    print("\n== the deck builds ==")
    body = page.inner_text("body")
    check("a deck was built from the starter set", "Building your deck" not in body, body[:80])
    check("a case is on screen", "OLL" in body or "PLL" in body)
    check("the clock starts at zero", timer_text(page) == "0.00")

    # The setup alg is the inverse of the case's algorithm, so typing the setup's
    # own inverse solves the case. Read it off the rendered cube attribute rather
    # than guessing which case came up.
    setup = page.locator("twisty-player").first.get_attribute("experimental-setup-alg")
    check("the case has a setup algorithm", bool(setup and setup.strip()), str(setup))
    # Cases are held yellow-up (z2) as they are met in a solve; the hold is not
    # part of the case, so the answer is the rest of the setup, undone.
    check("the case is held yellow-up", (setup or "").split()[:1] == ["z2"], str(setup))
    setup = " ".join((setup or "").split()[1:])

    solution = " ".join(invert(m) for m in reversed(setup.split()))

    print("\n== a rep runs and ends by itself ==")
    type_alg(page, solution)
    page.wait_for_timeout(900)

    body = page.inner_text("body")
    check("the rep completed", "Oriented" in body or "Solved" in body,
          [l for l in body.split("\n") if l.strip()][:6])
    final = timer_text(page)
    check("a time was recorded", final not in ("0.00", ""), final)

    page.wait_for_timeout(700)
    check("the clock stopped, not still running", timer_text(page) == final,
          f"{final} -> {timer_text(page)}")

    print("\n== the schedule responds ==")
    check("the rep was judged against a stated target",
          "target" in body.lower() or "median" in body.lower() or "moving forward" in body.lower(),
          [l for l in body.split("\n") if "median" in l or "target" in l][:1])
    check("a next case is offered", page.locator("button:has-text('Next case')").count() == 1)

    print("\n== advancing keeps the session going ==")
    page.click("button:has-text('Next case')")
    page.wait_for_timeout(2500)
    check("the clock reset for the next case", timer_text(page) == "0.00", timer_text(page))
    check("the result panel cleared", "Best yet" not in page.inner_text("body"))
    next_setup = page.locator("twisty-player").first.get_attribute("experimental-setup-alg")
    check("another case is set up", bool(next_setup and next_setup.strip()), str(next_setup))

    print("\n== progress survives a reload ==")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(3500)
    reloaded = page.inner_text("body")
    progress = page.get_by_test_id("train-progress").inner_text()
    check("the deck remembers reps already done", progress.startswith("1 of"), progress)

    print("\n== choosing what to drill ==")
    # It used to drill only the cases met in your solves, plus six starters. The
    # Algorithms pages verify every case against the puzzle, so a learner can
    # now pick the set they are studying.
    page.get_by_role("radio", name="All 21 PLL").click()
    page.wait_for_timeout(2500)
    progress = page.get_by_test_id("train-progress").inner_text()
    check("all of PLL is in play", progress.endswith("of 21 drilled"), progress)
    check("and the case on the cube is a PLL", "PLL ·" in page.inner_text("main"))
    setup = " ".join((page.locator("twisty-player").first.get_attribute("experimental-setup-alg") or "").split()[1:])
    page.get_by_role("button", name="Show the algorithm").click()
    page.wait_for_timeout(200)
    shown = page.get_by_test_id("train-algorithm").inner_text().split()
    check("the algorithm shown is the one that solves this case",
          shown == [invert(m) for m in reversed(setup.split())], " ".join(shown))
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(3500)
    check("the chosen set is remembered",
          page.get_by_role("radio", name="All 21 PLL").get_attribute("aria-checked") == "true")
    page.get_by_role("radio", name="OLL · dot").click()
    page.wait_for_timeout(2500)
    progress = page.get_by_test_id("train-progress").inner_text()
    check("OLL one shape at a time: the eight dot cases", progress.endswith("of 8 drilled"), progress)

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    page.screenshot(path="/tmp/train.png", full_page=True)
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
