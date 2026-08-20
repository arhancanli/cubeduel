"""
The full stack, with a real signed-in user.

Everything else is verified in pieces: the rating maths and verifier by unit
tests, the server modules against the live database by `npm run integration`,
and the signed-out browser flows by the other e2e suites.

This covers the one seam none of those touch — a real session cookie travelling
from the browser into a route handler and out to Postgres. It is worth its own
suite because of a specific failure that would otherwise ship silently: an
anonymous request gets a 401 whether authentication is working or missing
entirely, so every check that only pokes the routes anonymously still passes
when signed-in requests are broken too.

    BASE=http://localhost:3210 python3 e2e/ranked.py
"""

import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
EMAIL = probe_email("ranked")
FAILS = []


def env(name):
    """Reads a key out of .env.local so the suite needs no extra setup."""
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(path) as f:
        for line in f:
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return None


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


def solve_scramble(page, scramble, pace_ms):
    """Types the inverse of the scramble, pacing it like a human solve."""
    moves = [invert(m) for m in reversed(scramble.split())]
    for move in moves:
        for key in keys_for(move):
            page.keyboard.press(key)
            page.wait_for_timeout(pace_ms)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== signed out ==")
    page.goto(BASE + "/ranked", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    check("ranked is gated behind an account", "Sign in to play ranked" in page.inner_text("body"))

    print("\n== signing in ==")
    # Creating the account and being signed in are one request now. The page
    # must already be loaded so the fetch is same-origin and the cookie lands
    # in this browser.
    sign_up(page, EMAIL)
    page.goto(BASE + "/ranked", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    body = page.inner_text("body")
    signed_in = "Sign in to play ranked" not in body
    check("the session reaches a server component", signed_in,
          "still gated" if not signed_in else "")

    if not signed_in:
        print("\n  Cannot continue without a session.")
    else:
        print("\n== nothing is issued until the player asks ==")
        page.wait_for_selector("twisty-player", timeout=30000)
        page.wait_for_timeout(2500)
        pre = " ".join(page.locator("div.font-mono").first.inner_text().split())
        check("no attempt is opened just by visiting", pre == "",
              f"scramble already showing: {pre[:40]}")
        check("the page says nothing is counted yet",
              "Nothing is counted until you start" in page.inner_text("body"))

        print("\n== the server issues a scramble ==")
        page.locator("button:has-text('Start a ranked attempt')").first.click()
        # The container renders before the API answers, so wait for it to have a
        # scramble in it rather than for it to exist.
        page.wait_for_function(
            "() => { const el = document.querySelector('div.font-mono');"
            " return !!el && el.innerText.trim().length > 40; }",
            timeout=45000,
        )
        scramble = " ".join(page.locator("div.font-mono").first.inner_text().split())
        check("a ranked scramble was issued by the API", len(scramble.split()) >= 18,
              f"{len(scramble.split())} moves")
        check("the rating panel is shown", "rating" in page.inner_text("body").lower())
        check("the DNF rule is stated before solving",
              "DNF" in page.inner_text("body"))

        print("\n== inspection is running ==")
        # The countdown is the only part of inspection the player can see. The
        # penalty is judged server-side and covered by the integration suite;
        # what this proves is that the clock on screen is actually moving, which
        # no server test can tell you.
        # Read the countdown element itself. An earlier version of this check
        # matched a bare number anywhere in the page text and "passed" by
        # picking up an unrelated figure — a check that cannot tell the
        # countdown from the rating is not checking the countdown.
        read = (
            "() => { const el = document.querySelector('[data-testid=inspection-countdown]');"
            " return el ? parseFloat(el.innerText) : null; }"
        )
        first = page.evaluate(read)
        check("an inspection countdown is on screen", first is not None,
              f"{first}s" if first is not None else "no countdown element")
        check("it starts at the WCA fifteen seconds",
              first is not None and 14.0 <= first <= 15.0, f"{first}s")

        page.wait_for_timeout(1500)
        second = page.evaluate(read)
        # Must fall by roughly the time that passed: a clock that jumps to zero
        # is as wrong as one that never moves.
        dropped = (first - second) if (first is not None and second is not None) else None
        check("it counts down in real time",
              dropped is not None and 1.0 <= dropped <= 2.5,
              f"{first}s then {second}s (dropped {dropped}s)" if dropped is not None else "no reading")

        print("\n== solving it for real ==")
        # Paced so the elapsed wall-clock time is consistent with the reported
        # duration; the server refuses a solve longer than the attempt has been open.
        solve_scramble(page, scramble, 120)
        page.wait_for_timeout(6000)

        body = page.inner_text("body")
        check("the solve was accepted by the server",
              "could not" not in body.lower() and "not be verified" not in body.lower(),
              [l for l in body.split("\n") if "verif" in l.lower() or "could not" in l.lower()][:2])

        # The real proof the server counted it: the gathered-attempts counter
        # moved off 0. Absence of an error message is not evidence of success.
        counter = re.search(r"(\d+)\s*/\s*5", body)
        check("the server recorded the attempt", counter is not None and counter.group(1) != "0",
              counter.group(0) if counter else "no counter on screen")

        print("\n== the account is real ==")
        page.goto(BASE + "/settings", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        settings = page.inner_text("body")
        check("a profile was created with a handle", "/u/" in settings,
              [l for l in settings.split("\n") if "/u/" in l][:1])

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    page.screenshot(path="/tmp/ranked.png", full_page=True)
    browser.close()

print("\n== cleanup ==")
# One statement: `users` cascades to the profile, its solves, its ranked
# attempts and its rating. Deleting the profile alone would strand the account.
check("the test account was removed", delete_account(EMAIL))

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
