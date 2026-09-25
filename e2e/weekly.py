"""
The weekly competition, end to end, on the keyboard.

Signed out, the page states the rules and shows the board, and asks for an
account to enter. Signed in, nothing is opened by visiting. Each of the five is
opened, its scramble shown only then, and solved by typing the inverse — and
each time lands in its slot. After the fifth, the average is on screen and the
player is on the board. Meanwhile none of it is public: the profile lists none
of those solves, and the week's own results page does not exist until it closes.

    BASE=http://localhost:3000 python3 e2e/weekly.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import probe_email, sign_up  # noqa: E402

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


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def invert(move):
    if move.endswith("2"):
        return move
    return move[:-1] if move.endswith("'") else move + "'"


def solve_scramble(page, scramble, pace_ms=45):
    for move in [invert(m) for m in reversed(scramble.split())]:
        keys = [KEY_FOR_MOVE[move[:-1]]] * 2 if move.endswith("2") else [KEY_FOR_MOVE[move]]
        for key in keys:
            page.keyboard.press(key)
            page.wait_for_timeout(pace_ms)


def scramble_text(page):
    return " ".join(page.locator("div.font-mono").first.inner_text().split())


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    print("\n== signed out ==")
    anon = browser.new_page(viewport={"width": 1440, "height": 1000})
    anon.on("pageerror", lambda e: errors.append(str(e)))
    anon.goto(BASE + "/weekly", wait_until="networkidle")
    body = anon.inner_text("body")
    check("the rules are stated", "same five scrambles" in body and "WCA average of five" in body and "DNF" in body)
    check("entering needs an account", anon.locator("a:has-text('Sign in to enter')").count() == 1)
    check("the board is there for anyone", "This week" in body)
    anon.close()

    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/", wait_until="load")
    sign_up(page, probe_email("weekly"))
    page.goto(BASE + "/settings", wait_until="load")
    page.wait_for_timeout(1500)
    handle = page.evaluate("async () => (await (await fetch('/api/auth/session')).json()).handle")

    print("\n== nothing opens by visiting ==")
    page.goto(BASE + "/weekly", wait_until="networkidle")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(1500)
    check("no scramble is shown before an attempt is opened", scramble_text(page) == "")
    check("the button says which of the five", page.locator("button:has-text('Open attempt 1 of 5')").count() == 1)

    seen = []
    for n in range(1, 6):
        print(f"\n== attempt {n} ==")
        page.locator(f"button:has-text('Open attempt {n} of 5')").click()
        page.wait_for_function(
            "() => { const el = document.querySelector('div.font-mono'); return !!el && el.innerText.trim().length > 40; }",
            timeout=45000,
        )
        page.wait_for_timeout(1200)
        scramble = scramble_text(page)
        check(f"scramble {n} is shown now, and is new", len(scramble.split()) >= 15 and scramble not in seen, scramble[:40])
        seen.append(scramble)
        solve_scramble(page, scramble)
        page.wait_for_function(
            f"() => document.querySelectorAll('[data-testid=weekly-attempts] li')[{n - 1}]?.innerText.includes('.')",
            timeout=20000,
        )
        slot = page.locator("[data-testid=weekly-attempts] li").nth(n - 1).inner_text().replace("\n", " ")
        check(f"attempt {n}'s time is in its slot, not a DNF", "DNF" not in slot, slot)

    print("\n== finished ==")
    page.wait_for_selector("[data-testid=weekly-finished]", timeout=15000)
    page.wait_for_timeout(2500)
    finished = page.locator("[data-testid=weekly-finished]").inner_text()
    check("the average is on screen", "your average" in finished.lower())
    check("and her place: the only finisher this week is first of one", "1st of 1 so far" in finished, finished.replace("\n", " "))
    mine = page.locator("[data-testid=weekly-board] li[data-you]")
    check("the board lists her as you", mine.count() == 1 and "you" in mine.inner_text(), mine.inner_text().replace("\n", " ") if mine.count() else "none")
    check("no sixth attempt is offered", page.locator("button:has-text('Open attempt')").count() == 0)

    print("\n== none of it is public yet ==")
    page.goto(f"{BASE}/u/{handle}", wait_until="networkidle")
    check("her profile lists none of those solves", page.locator("ol li a[href^='/s/']").count() == 0)
    week = page.evaluate(
        """() => { const d = new Date(); const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
           const wd = (new Date(day).getUTCDay() + 6) % 7; const th = day - wd * 864e5 + 3 * 864e5;
           const y = new Date(th).getUTCFullYear(); const j4 = Date.UTC(y, 0, 4); const m1 = j4 - ((new Date(j4).getUTCDay() + 6) % 7) * 864e5;
           return `${y}-W${String(Math.floor((th - 3 * 864e5 - m1) / 6048e5) + 1).padStart(2, '0')}`; }"""
    )
    page.goto(f"{BASE}/weekly/{week}", wait_until="load")
    check("this week's results page does not exist until it closes, and shows no scrambles",
          "nothing at this address" in page.inner_text("body") and page.locator("[data-testid=weekly-scrambles]").count() == 0
          and not any(s in page.content() for s in seen), week)

    print("\n== a phone ==")
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/weekly", wait_until="networkidle")
    width = page.evaluate("() => document.documentElement.scrollWidth")
    check("the weekly fits a phone", width <= 390, str(width))

    check("no page errors", not errors, "; ".join(errors[:2]))
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
