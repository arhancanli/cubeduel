"""The case library, and a cube you can turn.

    python3 e2e/learn.py

Two things are worth checking in a real browser and nowhere else.

That the diagrams actually appear. All 78 are drawn by the puzzle engine and
mounted only as they scroll into view, which is the difference between a page
that opens instantly and one that builds 78 WebGL contexts first. Lazy mounting
is exactly the kind of optimisation that works until it silently shows nothing,
so the check is: few players on arrival, more after scrolling, and never zero.

And that the algorithm really runs on the cube. The studio rewrites the cube's
state as `setup + the moves so far`, so the cube, the highlighted move and the
counter are three views of one number. If they can disagree, they will.
"""
import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== every case is there ==")
    page.goto(BASE + "/learn", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(3500)

    # OLL and PLL cases only: the page also links to the F2L cases, which live
    # on their own page and are counted by e2e/lessons.py.
    cards = page.locator("a[href^='/learn/oll-'], a[href^='/learn/pll-']")
    check("all 78 cases are listed", cards.count() == 78, f"{cards.count()} cards")

    body = page.inner_text("body")
    for shape in ["Cross", "Line", "L-shape", "Dot", "PLL"]:
        check(f"the {shape} group is shown", shape in body)

    on_arrival = page.locator("twisty-player").count()
    check("diagrams are not all built up front", on_arrival < 78, f"{on_arrival} mounted")
    check("but some are drawn immediately", on_arrival > 0, f"{on_arrival} mounted")

    page.mouse.wheel(0, 6000)
    page.wait_for_timeout(2500)
    after = page.locator("twisty-player").count()
    check("more are drawn on scroll", after > on_arrival, f"{on_arrival} -> {after}")

    print("\n== one case, on a cube ==")
    page.goto(BASE + "/learn/oll-27", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4500)

    body = page.inner_text("body")
    check("the case is named", "OLL 27" in body and "Sune" in body)
    check("its shape is stated", "Cross" in body)

    chips = page.locator("div.flex.flex-wrap.gap-1\\.5 button")
    check("the algorithm is one chip per move", chips.count() == 7, f"{chips.count()}")

    counter = page.locator("p.font-mono.text-xs").first
    check("nothing is turned before you press play",
          counter.inner_text().startswith("0 of"), counter.inner_text())

    page.locator("button:has-text('Play')").first.click()
    page.wait_for_timeout(1400)
    check("playing turns the cube", not counter.inner_text().startswith("0 of"),
          counter.inner_text())

    page.wait_for_timeout(4500)
    check("it runs to the last move", counter.inner_text().startswith("7 of"),
          counter.inner_text())
    check("and offers it again", page.locator("button:has-text('Again')").count() == 1)

    page.locator("button[aria-label='Back one move']").click()
    page.wait_for_timeout(300)
    check("stepping back is possible", counter.inner_text().startswith("6 of"),
          counter.inner_text())

    # Clicking a move chip jumps the cube to that point.
    chips.nth(2).click()
    page.wait_for_timeout(300)
    check("clicking a move jumps to it", counter.inner_text().startswith("3 of"),
          counter.inner_text())

    print("\n== recognition, and your own cube ==")
    siblings = page.locator("section a[href^='/learn/oll-']")
    check("the cases it is confused with are shown", siblings.count() == 6,
          f"{siblings.count()} siblings")

    page.locator("button:has-text('Try it')").click()
    page.wait_for_timeout(4000)
    body = page.inner_text("body")
    check("a physical cube is offered, or explained away",
          "smart cube" in body.lower() or "Bluetooth" in body, "")
    check("the algorithm is still available if you get stuck", "R U R'" in body)

    check("no page errors", not errors, str(errors[:2]))
    browser.close()

print("\nAll checks passed." if fails == 0 else f"\n{fails} check(s) failed.")
sys.exit(0 if fails == 0 else 1)
