"""
End-to-end checks for the timer and the daily round.

Run against a running server:
    BASE=http://localhost:3000 python3 e2e/timer.py

The timer is a state machine driven entirely by real key events, so it cannot be
covered by unit tests — a broken hold threshold or a swallowed keyup only shows up
in a browser. Run this against a production build before deploying, not just dev:
the scramble generator is a WASM worker and the two bundlers resolve it differently.
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")  # timer now lives at /timer
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def timer_el(page):
    return page.locator("div.tnum").first


def do_solve(page, hold_ms=400, run_ms=1200):
    """Drive one solve through the real key sequence: hold, arm, release, stop."""
    page.keyboard.down("Space")
    page.wait_for_timeout(hold_ms)
    armed = "text-ready" in timer_el(page).get_attribute("class")
    page.keyboard.up("Space")
    page.wait_for_timeout(run_ms)
    running_text = timer_el(page).inner_text().strip()
    page.keyboard.press("KeyJ")
    page.wait_for_timeout(120)
    return armed, running_text


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(BASE + "/timer", wait_until="networkidle")
    page.wait_for_timeout(2500)

    print("\n== scramble generation ==")
    scramble = page.locator("section div.font-mono").first.inner_text().strip()
    check("a scramble is generated in-browser", len(scramble.split()) >= 18,
          f"{len(scramble.split())} moves")

    print("\n== cube view ==")
    page.wait_for_selector("twisty-player", timeout=20000)
    cube = page.locator("twisty-player").first
    check("a 3D cube is rendered", cube.count() == 1)
    box = cube.bounding_box()
    check("the cube has real size on screen", box and box["width"] > 200 and box["height"] > 100,
          f"{box['width']:.0f}x{box['height']:.0f}" if box else "no box")

    setup_alg = cube.get_attribute("experimental-setup-alg")
    check("the cube shows the current scramble", setup_alg and setup_alg.split() == scramble.split(),
          f"{(setup_alg or '')[:30]}...")

    # Dragging the cube to inspect it must never arm the timer underneath.
    page.mouse.move(box["x"] + box["width"] / 4, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 4 + 40, box["y"] + box["height"] / 2, steps=6)
    page.wait_for_timeout(450)
    armed_by_drag = "text-holding" in timer_el(page).get_attribute("class") or \
                    "text-ready" in timer_el(page).get_attribute("class")
    page.mouse.up()
    page.wait_for_timeout(200)
    check("dragging the cube does not arm the timer", not armed_by_drag)
    check("dragging the cube does not start a solve",
          timer_el(page).inner_text().strip() == "0.00")

    print("\n== hold-to-arm state machine ==")
    page.keyboard.down("Space")
    page.wait_for_timeout(120)
    holding = "text-holding" in timer_el(page).get_attribute("class")
    page.keyboard.up("Space")
    page.wait_for_timeout(200)
    check("a short hold shows the not-ready colour", holding)
    check("a short hold does not start a solve", timer_el(page).inner_text().strip() == "0.00")

    print("\n== a full solve ==")
    armed, running_text = do_solve(page, hold_ms=400, run_ms=1200)
    check("holding past the threshold arms the timer", armed)
    check("the clock advances while running", running_text != "0.00", f"showed {running_text}")
    recorded = timer_el(page).inner_text().strip()
    check("the solve is recorded at the right time", 1.0 < float(recorded) < 1.6, recorded)

    print("\n== the cube follows the scramble ==")
    page.wait_for_timeout(1500)
    new_alg = page.locator("twisty-player").first.get_attribute("experimental-setup-alg")
    check("the cube restates after a solve", new_alg and new_alg != setup_alg)
    check("the same player element is reused, not rebuilt",
          page.locator("twisty-player").count() == 1)

    print("\n== stats ==")
    for run in (900, 1500, 1100, 1300):
        do_solve(page, hold_ms=400, run_ms=run)

    check("every solve is listed", page.locator("[data-testid=recent-time]").count() == 5)
    ao5_val = page.locator("div:has(> span:text-is('ao5')) > span").last.inner_text().strip()
    check("ao5 appears once five solves exist", ao5_val not in ("—", ""), f"ao5 = {ao5_val}")
    # Asserted against the solves actually recorded, not against a hardcoded
    # "0.90". The run length is driven by a wall-clock wait, so the recorded time
    # is 900ms plus whatever the scheduler adds — and truncated to hundredths,
    # 10ms of jitter is the difference between 0.90 and 0.91. That made this fail
    # about one run in three, which is worse than not having the check: a flaky
    # test is one people learn to re-run rather than read.
    listed = []
    for i in range(page.locator("[data-testid=recent-time]").count()):
        text = page.locator("[data-testid=recent-time]").nth(i).inner_text().strip().rstrip("+")
        try:
            listed.append(float(text))
        except ValueError:
            pass
    best_val = page.locator("div:has(> span:text-is('best')) > span").last.inner_text().strip()
    check(
        "best single is the fastest solve recorded",
        listed and abs(float(best_val) - min(listed)) < 0.005,
        f"best = {best_val}, solves = {sorted(listed)}",
    )

    print("\n== personal best ==")
    do_solve(page, hold_ms=400, run_ms=600)
    pb_badge = page.locator("span:text-is('PB')").first
    check("beating the best surfaces a PB badge", "opacity-100" in pb_badge.get_attribute("class"))

    print("\n== penalties ==")
    page.click("button:text-is('+2')")
    page.wait_for_timeout(150)
    plus2_display = timer_el(page).inner_text().strip()
    check("+2 adds two seconds to the clock", abs(float(plus2_display) - 2.60) < 0.15,
          plus2_display)
    check("+2 is marked in the list", "+" in page.locator("[data-testid=recent-solves]").inner_text())

    page.click("button:text-is('DNF')")
    page.wait_for_timeout(150)
    check("a DNF reads DNF on the clock, not 0.00",
          timer_el(page).inner_text().strip() == "DNF", timer_el(page).inner_text().strip())
    check("a DNF is marked in the list", "DNF" in page.locator("[data-testid=recent-solves]").inner_text())

    page.click("button:text-is('delete')")
    page.wait_for_timeout(150)
    check("deleting drops the solve", page.locator("[data-testid=recent-time]").count() == 5)

    print("\n== the longer view ==")
    longs = page.get_by_test_id("long-averages").inner_text()
    check("ao50, ao100 and the session mean are shown", "AO50" in longs.upper() and "MEAN" in longs.upper(), longs.replace("\n", " "))
    check("ao50 waits for fifty solves rather than guessing", "—" in longs, longs.replace("\n", " "))
    check("the session is drawn", page.get_by_test_id("session-chart").count() == 1)

    print("\n== a mis-tap is not a solve ==")
    # A thumb on the spacebar used to be saved as a 0.12 solve, and became the
    # personal best every real solve was then measured against.
    before = page.locator("[data-testid=recent-solve]").count()
    scramble_before = " ".join(page.locator("section .font-mono span").all_inner_texts())
    page.keyboard.down("Space")
    page.wait_for_timeout(400)
    page.keyboard.up("Space")
    page.wait_for_timeout(120)
    page.keyboard.press("KeyJ")
    page.wait_for_timeout(600)
    check("it is not saved", page.locator("[data-testid=recent-solve]").count() == before,
          f"{before} -> {page.locator('[data-testid=recent-solve]').count()}")
    hint = page.get_by_test_id("timer-hint").inner_text()
    check("and the page says why", "too quick to be a solve" in hint, hint)
    check("the scramble stays, since the cube still has it on",
          " ".join(page.locator("section .font-mono span").all_inner_texts()) == scramble_before)

    print("\n== persistence ==")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    check("solves survive a reload", page.locator("[data-testid=recent-time]").count() == 5)

    print("\n== daily ==")
    page.goto(BASE + "/daily", wait_until="networkidle")
    page.wait_for_timeout(1200)
    intro = page.inner_text("body")
    check("the daily is numbered", "daily #" in intro)
    check("the one-attempt rule is stated up front", "One attempt" in intro and "DNF" in intro)
    check("both attempt modes are offered",
          "Solve with my cube" in intro and "Solve on the keyboard" in intro)

    page.click("button:has-text('Solve with my cube')")
    page.wait_for_timeout(400)
    revealed = page.locator("div.font-mono").first.inner_text().strip()
    check("revealing shows the scramble", len(revealed.split()) >= 18)
    page.wait_for_timeout(4000)
    check("the daily renders its cube", page.locator("twisty-player").count() >= 1)

    do_solve(page, hold_ms=400, run_ms=1400)
    page.wait_for_timeout(400)
    done = page.inner_text("body")
    check("the result screen appears", "Share result" in done)
    check("a speed tier is shown", "sub-" in done.lower() or "over a minute" in done)
    # A stopwatch cannot verify a physical cube, and the result must say so.
    check("a hand-timed result is labelled self-timed", "Self-timed" in done)
    check("a hand-timed result is not marked verified", "Verified solve" not in done)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    check("the daily stays locked to one attempt", "Share result" in page.inner_text("body"))

    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
