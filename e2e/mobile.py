"""
The app on a phone, driven only by touch.

This exists because of a specific failure it would have caught. `/play` and
`/ranked` had a touch pad; the daily, duels and the trainer did not, and the
daily's only button read "Solve on the keyboard" — on a device that has none.
Nothing failed, nothing errored, and every other suite passed: the modes were
simply unplayable for most of the traffic a cubing site gets.

So this drives real solves with taps and no keyboard at all. A pad that renders
but does not turn the cube would pass a screenshot review and fail here.

    BASE=https://cubeduel.vercel.app python3 e2e/mobile.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


# The pad labels its buttons for screen readers ("Right anticlockwise"), which
# is also the most robust way to address them here: the visible text is a bare
# letter and a prime, and a prime is a quote character that no CSS selector
# survives.
FACE_NAMES = {"U": "Up", "L": "Left", "F": "Front", "R": "Right", "B": "Back", "D": "Down"}


def pad_button(page, move):
    face = move[0]
    direction = "anticlockwise" if move.endswith("'") else "clockwise"
    return page.get_by_role("button", name=f"{FACE_NAMES[face]} {direction}", exact=True).last


def invert(move):
    if move.endswith("2"):
        return move
    return move[:-1] if move.endswith("'") else move + "'"


def tap_solution(page, scramble):
    """
    Solves by tapping the pad, exactly as a phone user would.

    The pad carries face turns only, so a double is two taps on the same button
    and there are no rotations to worry about.
    """
    taps = 0
    for move in [invert(m) for m in reversed(scramble.split())]:
        base = move[:-1] if move.endswith("2") else move
        for _ in range(2 if move.endswith("2") else 1):
            pad_button(page, base).tap()
            page.wait_for_timeout(70)
            taps += 1
    return taps


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=3,
        user_agent=IPHONE,
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== nothing overflows sideways ==")
    for path in ["/", "/play", "/daily", "/train", "/timer", "/leaderboard"]:
        page.goto(BASE + path, wait_until="load")
        page.wait_for_timeout(3500)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        # A phone user should never have to scroll right to read the page.
        check(f"{path}: no horizontal scroll", overflow <= 1, f"{overflow}px")

    print("\n== the daily is solvable by touch ==")
    page.goto(BASE + "/daily", wait_until="load")
    page.wait_for_timeout(5000)
    body = page.inner_text("body")
    check("the solve button is not named after a keyboard",
          "Solve on the keyboard" not in body,
          [l for l in body.split("\n") if "keyboard" in l.lower()][:1])

    page.locator("button:has-text('Solve here')").first.tap()
    pad_button(page, "R'").wait_for(timeout=30000)
    page.wait_for_timeout(2500)

    scramble = page.evaluate(
        """() => { const els = [...document.querySelectorAll('div')]
            .filter(d => /font-mono/.test(d.className) && d.innerText.trim().split(/\\s+/).length >= 18);
            return els.length ? els[0].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""
    )
    check("a scramble is shown", len(scramble.split()) >= 18, f"{len(scramble.split())} moves")

    pad = page.get_by_role("button", name="Right anticlockwise", exact=True).count()
    check("a touch pad is rendered", pad >= 1, f"{pad} R' buttons")

    if scramble and pad:
        taps = tap_solution(page, scramble)
        page.wait_for_timeout(4000)
        after = page.inner_text("body")
        # The clock only stops when the cube is genuinely solved, so a finished
        # round is proof the taps actually turned it.
        check("tapping the pad solved the cube",
              "Solve here" not in after and "Hold space" not in after,
              f"{taps} taps; page now: " + " | ".join(after.split("\n")[:3])[:120])

    print("\n== the trainer takes touch ==")
    page.goto(BASE + "/train", wait_until="load")
    page.wait_for_timeout(6000)
    body = page.inner_text("body")
    check("it no longer says drilling needs a keyboard",
          "needs a keyboard" not in body,
          [l for l in body.split("\n") if "keyboard" in l.lower()][:1])
    check("a touch pad is rendered on the trainer",
          page.get_by_role("button", name="Right anticlockwise", exact=True).count() >= 1)

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    page.screenshot(path="/tmp/mobile.png", full_page=True)
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
