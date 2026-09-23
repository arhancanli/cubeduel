"""
The cube solver page: stickers in, a solution out.

Three things a person typing in the cube in their hands can meet, each driven
through the page the way they would drive it:

- a real cube: filled from a scramble, solved, and the answer is short and is
  shown on a 3D cube to step through;
- a colour used ten times: refused before anything is solved, naming the colours;
- a corner with two stickers swapped — every colour still appears nine times,
  so only reading the pieces can catch it — refused, saying to check a corner.

    BASE=http://localhost:3000 python3 e2e/solver.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []
SCRAMBLE = "F2 D' B R2 L' U2 F' D B2 L R' U F2 D2 B' L2"


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def sticker(page, face, row, col):
    return page.get_by_role("button", name=f"{face} face, row {row}, column {col}:", exact=False)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/solver", wait_until="load")
    page.wait_for_timeout(1500)

    print("\n== the page ==")
    check("one h1 naming the tool", page.locator("h1").inner_text().strip() == "Rubik's Cube Solver")
    net = page.locator("[data-testid=solver-net] button")
    check("54 stickers", net.count() == 54, str(net.count()))
    check("the six centres are fixed", page.locator("[data-testid=solver-net] button[disabled]").count() == 6)
    ld = page.locator("script[type='application/ld+json']").inner_text()
    check("it declares itself to search engines", "WebApplication" in ld and "FAQPage" in ld)

    print("\n== an empty cube ==")
    page.get_by_test_id("solver-solve").click()
    page.wait_for_timeout(300)
    check("an unfinished cube is not sent", "Fill in every sticker" in page.get_by_test_id("solver-error").inner_text())

    print("\n== a real cube ==")
    page.get_by_text("Have a scramble instead?").click()
    page.fill("#scramble-input", SCRAMBLE)
    page.get_by_role("button", name="Fill the net").click()
    page.wait_for_timeout(300)
    check("the scramble fills every sticker",
          page.locator("[data-testid=solver-net] button[aria-label$=': empty']").count() == 0)
    page.get_by_test_id("solver-solve").click()
    page.wait_for_selector("[data-testid=solver-answer]", timeout=30000)
    moves = page.locator("[data-testid=solver-moves] span").count()
    check("a short solution comes back", 10 <= moves <= 22, f"{moves} moves")
    check("it can be followed on a cube", page.locator("[data-testid=solver-answer] twisty-player").count() == 1)

    print("\n== a colour used ten times ==")
    page.get_by_role("button", name="Start from solved").click()
    page.get_by_role("radio", name="Red").click()
    sticker(page, "Top", 1, 1).click()
    page.get_by_test_id("solver-solve").click()
    page.wait_for_selector("[data-testid=solver-error]", timeout=15000)
    message = page.get_by_test_id("solver-error").inner_text()
    check("it says which colours are off", "10 red" in message and "8 white" in message, message)

    print("\n== a corner that cannot exist ==")
    page.get_by_role("button", name="Start from solved").click()
    # Swap the top and right stickers of the top-front-right corner.
    page.get_by_role("radio", name="Red").click()
    sticker(page, "Top", 3, 3).click()
    page.get_by_role("radio", name="White").click()
    sticker(page, "Right", 1, 1).click()
    page.get_by_test_id("solver-solve").click()
    page.wait_for_selector("[data-testid=solver-error]", timeout=15000)
    message = page.get_by_test_id("solver-error").inner_text()
    check("it points at a corner", "corner" in message.lower(), message)

    print("\n== on a phone ==")
    phone = browser.new_page(viewport={"width": 390, "height": 844})
    phone.goto(BASE + "/solver", wait_until="load")
    phone.wait_for_timeout(1500)
    overflow = phone.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("no horizontal scroll", overflow <= 1, f"{overflow}px")

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
