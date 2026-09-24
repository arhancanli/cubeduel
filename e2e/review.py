"""
End-to-end checks for solve review.

Solves a KNOWN cube by keyboard, with a real CFOP solution — cross, four pairs,
OLL, PLL — plus two deliberate faults: a turn undone during the first pair and a
long stop before the third. Then it follows "Review this solve" and asserts the
review found both faults, credited the cross, and can play the replay from a
moment. A review that found nothing on a solve built to contain two faults is a
review that is not reading the solve.

    BASE=http://localhost:3000 python3 e2e/review.py
"""

import os
import sys
from urllib.parse import quote

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

# The same solve src/lib/solveStudy.test.ts reads: each step completes one milestone.
STEPS = [
    "D2 R' D'",
    "U R U' R'",
    "U' L' U L",
    "U' R' U R",
    "U L U' L'",
    "R U R' U R U2 R'",
    "R U R' U' R' F R2 U' R' U' R U R' F'",
]


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


def press(page, move, gap=110):
    keys = [KEY_FOR_MOVE[move[:-1]]] * 2 if move.endswith("2") else [KEY_FOR_MOVE[move]]
    for key in keys:
        page.keyboard.press(key)
        page.wait_for_timeout(gap)


SCRAMBLE = " ".join(invert(m) for m in reversed(" ".join(STEPS).split()))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # One context for every page, because the solves live in its storage.
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{BASE}/play?scramble={quote(SCRAMBLE)}", wait_until="networkidle")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(4000)

    print("\n== a solve with two faults in it ==")
    for i, step in enumerate(STEPS):
        if i == 3:
            page.wait_for_timeout(2600)  # a long stop before the third pair
        for j, move in enumerate(step.split()):
            press(page, move)
            if i == 1 and j == 1:
                press(page, "U")          # ...a turn...
                press(page, "U'")         # ...undone at once
    page.wait_for_timeout(2500)

    review_link = page.get_by_role("link", name="Review this solve")
    check("the review is offered after the solve", review_link.count() == 1)
    if review_link.count() == 0:
        print("  page now:", page.inner_text("body")[:300])
    else:
        review_link.click()
        page.wait_for_url("**/review?id=*", timeout=15000)
        page.wait_for_selector("[data-testid=review-moments]", timeout=30000)
        page.wait_for_timeout(1000)

        print("\n== what it found ==")
        moments = page.locator("[data-testid=review-moments] > li").all_inner_texts()
        joined = " | ".join(m.replace("\n", " ") for m in moments)
        check("the stop before the third pair is found",
              any("before F2L 3" in m for m in moments), joined[:300])
        check("the undone turn is found",
              any("U then U'" in m and "undone" in m for m in moments), joined[:300])
        check("the three-turn cross is credited, not charged",
              any(m.startswith("Cross in 3") for m in moments), joined[:300])
        heading = page.locator("#review-heading").inner_text()
        check("the heading counts the moments worth a look", "moment" in heading.lower(), heading)
        recoverable = page.locator("dt", has_text="Recoverable").locator("xpath=..").inner_text()
        check("recoverable time is stated", "~" in recoverable, recoverable.replace("\n", " "))

        print("\n== watching a moment ==")
        play = page.get_by_role("button", name="Play", exact=True)
        check("the replay starts paused", play.count() == 1)
        page.get_by_role("button", name="Watch it").first.click()
        page.wait_for_timeout(400)
        check("choosing a moment plays the replay",
              page.get_by_role("button", name="Pause", exact=True).count() == 1)

        print("\n== five more solves, the same habit each time ==")
        # Insights needs five solves before it says anything. Each is solved for
        # real, through /play, with the same stop before the third pair and no
        # undo: across six solves that stop is a habit and the undo is not.
        for _ in range(5):
            page.goto(f"{BASE}/play?scramble={quote(SCRAMBLE)}", wait_until="networkidle")
            page.wait_for_selector("twisty-player", timeout=30000)
            page.wait_for_timeout(2500)
            for i, step in enumerate(STEPS):
                if i == 3:
                    page.wait_for_timeout(2200)
                for move in step.split():
                    press(page, move)
            page.wait_for_timeout(1500)
            check("each solve finishes", page.get_by_role("link", name="Review this solve").count() == 1)

        print("\n== insights ==")
        page.goto(BASE + "/review", wait_until="networkidle")
        page.wait_for_selector("[data-testid=habit-first]", timeout=60000)
        first = page.locator("[data-testid=habit-first]").inner_text()
        check("the habit to fix first is the stop before the third pair",
              "before F2L 3" in first, first.replace("\n", " ")[:200])
        check("it states the sample", "6 of 6 solves" in first, first.replace("\n", " ")[:200])
        heading = page.locator("#insights-heading").inner_text()
        check("it says how many solves it read", "6 solves" in heading, heading)
        panel = page.locator("[data-testid=insights]").inner_text()
        check("the one-off undo is not promoted to a habit", "You undo turns" not in panel)
        # The solve's OLL ends on R' and its PLL starts on R — in all six. That is
        # a seam between algorithms, and it must be named as one, not as a misread.
        check("the seam between OLL and PLL is its own habit",
              "undo each other at the seams" in panel and "misread" not in panel)

        worst = page.locator("[data-testid=habit-first]").get_by_role("link", name="Watch the worst one")
        check("the habit links to the solve where it cost most", worst.count() == 1)
        if worst.count() == 1:
            worst.click()
            page.wait_for_url("**/review?id=*", timeout=15000)
            page.wait_for_selector("[data-testid=review-moments]", timeout=30000)
            check("and that solve's review shows the same stop",
                  any("before F2L 3" in m for m in page.locator("[data-testid=review-moments] > li").all_inner_texts()))

        print("\n== the streak ==")
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector("[data-testid=streak]", timeout=15000)
        streak = page.locator("[data-testid=streak]").inner_text()
        check("solving today makes a one-day streak", "1 day" in streak and "Today counts" in streak,
              streak.replace("\n", " "))
        check("today is lit in the strip",
              page.locator("[data-testid=streak] li").last.get_attribute("aria-label") == "Today: solved")

        print("\n== the list ==")
        page.goto(BASE + "/review", wait_until="networkidle")
        page.wait_for_timeout(1500)
        rows = page.get_by_role("link", name="Review →").count()
        check("the solve is listed for review", rows >= 1, f"{rows} rows")
        check("the nav marks where you are",
              page.locator("nav [aria-current=page]", has_text="Review").count() >= 1)

        print("\n== on a phone ==")
        phone = ctx.new_page()
        phone.set_viewport_size({"width": 390, "height": 844})
        # Same context, same storage: the solve is there.
        target = page.get_by_role("link", name="Review →").first.get_attribute("href")
        phone.goto(BASE + target, wait_until="networkidle")
        phone.wait_for_selector("[data-testid=review-moments]", timeout=30000)
        overflow = phone.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        check("no horizontal scroll", overflow <= 1, f"{overflow}px")
        phone.close()

    print("\n== a solve that is not here ==")
    page.goto(BASE + "/review?id=sv_nothing", wait_until="networkidle")
    page.wait_for_timeout(1200)
    check("a missing solve says so", "not on this device" in page.inner_text("body"))

    # ---------------------------------------------------------------------
    # A solve timed on a real cube. No turns to read, but a scramble whose
    # best cross can be worked out, and — with splits — phases that can be
    # set against the solver's own usual. Timed through the real timer, the
    # way a person with a cube in their hands does it.
    print("\n== a solve timed on a real cube ==")
    tctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    timer = tctx.new_page()
    timer.on("pageerror", lambda e: errors.append(str(e)))
    timer.goto(BASE + "/timer", wait_until="load")
    timer.wait_for_timeout(2500)

    def time_solve(phase_ms):
        timer.keyboard.down("Space")
        timer.wait_for_timeout(450)
        timer.keyboard.up("Space")
        for ms in phase_ms:
            timer.wait_for_timeout(ms)
            timer.keyboard.press("Space")
        timer.wait_for_timeout(900)

    # One without splits, then five at a steady pace, then one with a slow F2L.
    time_solve([1500])
    timer.get_by_role("button", name="Record phase splits").click()
    timer.wait_for_timeout(300)
    for _ in range(5):
        time_solve([300, 600, 300, 300])
    time_solve([300, 2200, 300, 300])

    # Straight from the timer, the way somebody finds it.
    timer.get_by_role("link", name="review →").click()
    timer.wait_for_url("**/review?id=**")
    timer.wait_for_selector("[data-testid=timer-phases]", timeout=15000)
    timer.goto(BASE + "/review", wait_until="load")
    timer.wait_for_timeout(1500)
    rows = timer.locator("main ul li a")
    body = timer.inner_text("main")
    check("timer solves are listed for review", "timed, phases split" in body and "timed" in body)

    rows.first.click()
    timer.wait_for_selector("[data-testid=timer-phases]", timeout=15000)
    summary = timer.get_by_test_id("timer-phases-summary").inner_text()
    check("the slow phase is named", summary.startswith("F2L cost you this solve"), summary)
    timer.wait_for_selector("[data-testid=timer-cross]", timeout=30000)
    options = timer.get_by_test_id("timer-cross-option")
    check("the cross in all six colours", options.count() == 6, str(options.count()))
    turns = [int(options.nth(i).inner_text().split("turn")[0].split()[-1]) for i in range(options.count())]
    check("shortest first", turns == sorted(turns), str(turns))
    cross_summary = timer.get_by_test_id("timer-cross-summary").inner_text()
    check("the white cross is stated", "shortest white cross was" in cross_summary, cross_summary)
    scramble = timer.locator("main p.font-mono").first.inner_text().strip()
    setup = timer.locator("[data-testid=timer-cross] twisty-player").first.get_attribute("experimental-setup-alg") or ""
    check("the cube starts from this scramble, turned over", setup.split() == scramble.split() + ["z2"], setup[:80])

    # The first solve had no splits: it still gets the cross, and is told how
    # to get the rest.
    timer.goto(BASE + "/review", wait_until="load")
    timer.wait_for_timeout(1500)
    timer.locator("main ul li a").last.click()
    timer.wait_for_selector("[data-testid=timer-cross]", timeout=30000)
    check("a solve without splits says how to get them", "Which phase cost you?" in timer.inner_text("main"))
    tctx.close()

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
