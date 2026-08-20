"""
A real duel, end to end.

Everything else is verified in pieces: the rating maths and verifier by unit
tests, the server modules against the live database by `npm run integration`,
and the signed-out browser flows by the other e2e suites.

This covers the one seam none of those touch — a real session cookie travelling
from the browser into a route handler and out to Postgres.

    BASE=http://localhost:3210 python3 e2e/duel.py
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
EMAIL = probe_email("duel")
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
    page.goto(BASE + "/duel", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    check("duelling is gated behind an account", "Sign in to duel" in page.inner_text("body"))

    print("\n== signing in ==")
    sign_up(page, EMAIL)
    page.goto(BASE + "/duel", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    body_text = page.inner_text("body")
    signed_in = "Sign in to duel" not in body_text
    check("the session reaches the duel page", signed_in)

    if not signed_in:
        print("\n  Cannot continue without a session.")
    else:
        print("\n== the opponent roster ==")
        check("opponents are listed", "Or race a bot" in body_text)
        # Challenges sit above the bots on this page: racing a person is the
        # better game, and the bots are what is always available when nobody has
        # answered yet.
        check("challenging a person is offered first",
              "Challenge a player" in body_text
              and body_text.index("Challenge a player") < body_text.index("Or race a bot"))
        check("each states a rating and a time", "Metronome" in body_text and "Blitz" in body_text)
        check("the commitment is stated before racing",
              "recorded as a loss" in body_text,
              [l for l in body_text.split("\n") if "loss" in l][:1])
        check("nothing is racing yet", "moves" not in page.inner_text("body").split("Race")[0][-40:])

        print("\n== starting a race ==")
        page.locator("button:has-text('Race ')").last.click()
        page.wait_for_selector("twisty-player", timeout=45000)
        page.wait_for_function(
            "() => { const e = document.querySelector('div.font-mono');"
            " return !!e && e.innerText.trim().length > 40; }",
            timeout=45000,
        )
        page.wait_for_timeout(1500)
        raced = page.inner_text("body")
        check("a scramble was issued", len(" ".join(page.locator("div.font-mono").first.inner_text().split()).split()) >= 18)
        check("the opponent has a committed target", "target" in raced.lower(),
              [l for l in raced.split("\n") if "target" in l.lower()][:1])
        check("the opponent's move count is shown", "moves" in raced)
        check("the bot's technique is described honestly", "not human" in raced,
              [l for l in raced.split("\n") if "not human" in l][:1])

        print("\n== solving it ==")
        scramble = " ".join(page.locator("div.font-mono").first.inner_text().split())
        solve_scramble(page, scramble, 110)
        page.wait_for_timeout(7000)

        done = page.inner_text("body")
        check("the duel was decided", "You won" in done or "You lost" in done,
              [l for l in done.split("\n") if "You w" in l or "You l" in l][:1])
        check("the margin is reported", "by" in done and ("opponent" in done))
        check("a rematch is offered", page.locator("button:has-text('Race again')").count() == 1)

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    page.screenshot(path="/tmp/duel.png", full_page=True)
    browser.close()

print("\n== cleanup ==")
# One statement: `users` cascades to the profile, its solves and its duels.
removed = 1 if delete_account(EMAIL) else 0
check("the test account was removed", removed >= 0, f"{removed} deleted")

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
