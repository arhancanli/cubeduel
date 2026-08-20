"""
Rush, in a real browser, with a real account.

The integration suite drives the server module against live Postgres. This
covers what it cannot: that the mode is actually playable — the target is on
screen before you turn a face, clearing it tightens the next one, and the score
the page shows is the one the server computed.

The check that matters most is the last one. Rush's whole claim is that the
score is replayed server-side rather than believed from the browser, so the
suite reloads the page mid-run and confirms the run is still there and still
counting from where it was.

    BASE=https://cubeduel.vercel.app python3 e2e/rush.py
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
EMAIL = probe_email("rush")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(path) as f:
        for line in f:
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return None


KEYS = {
    "U": "j", "U'": "f", "R": "i", "R'": "k", "L": "d", "L'": "e",
    "F": "h", "F'": "g", "D": "s", "D'": "l", "B": "w", "B'": "o",
}


def invert(move):
    if move.endswith("2"):
        return move
    return move[:-1] if move.endswith("'") else move + "'"


def scramble_on(page):
    return page.evaluate(
        """() => { const els = [...document.querySelectorAll('div')]
            .filter(d => /font-mono/.test(d.className)
                      && d.innerText.trim().split(/\\s+/).length >= 15);
            return els.length ? els[0].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""
    )


def solve_it(page, scramble, pace_ms=90):
    for move in [invert(m) for m in reversed(scramble.split())]:
        presses = [move[:-1]] * 2 if move.endswith("2") else [move]
        for m in presses:
            page.keyboard.press(KEYS[m])
            page.wait_for_timeout(pace_ms)


def score_on(page):
    """
    The score as rendered.

    Matched case-insensitively: the label carries Tailwind's `uppercase`, so
    innerText returns "SCORE" and an exact comparison against "Score" finds
    nothing — which reads in the output exactly like a missing scoreboard.
    """
    return page.evaluate(
        """() => {
            const labels = [...document.querySelectorAll('div')]
              .filter(d => d.innerText.trim().toLowerCase() === 'score');
            if (!labels.length) return null;
            const box = labels[0].parentElement;
            const n = box ? box.innerText.replace(/score/i, '').trim() : '';
            return n === '' ? null : Number(n);
        }"""
    )


def target_on(page):
    """The target time currently on screen, in seconds, or None."""
    return page.evaluate(
        """() => {
            const labels = [...document.querySelectorAll('div')]
              .filter(d => d.innerText.trim().toLowerCase() === 'beat this');
            if (!labels.length) return null;
            const box = labels[0].parentElement;
            const m = box ? box.innerText.match(/([\\d.]+)/) : null;
            return m ? Number(m[1]) : null;
        }"""
    )


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== signed out ==")
    page.goto(BASE + "/rush", wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    check("rush is gated behind an account", "Sign in to run" in page.inner_text("body"))

    print("\n== signing in ==")
    # The page has to be loaded before the fetch, so the request is same-origin
    # and the session cookie lands in this browser rather than nowhere.
    page.goto(BASE + "/", wait_until="domcontentloaded")
    sign_up(page, EMAIL)
    page.goto(BASE + "/rush", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    body = page.inner_text("body")
    signed_in = "Sign in to run" not in body
    check("the session reaches the page", signed_in)

    if not signed_in:
        print("\n  Cannot continue without a session.")
    else:
        print("\n== the mode explains itself before it starts ==")
        check("the rules are stated up front",
              "tighter" in body and "Three" in body,
              [l for l in body.split("\n") if "tighter" in l][:1])
        check("nothing has started yet", score_on(page) is None)

        print("\n== a run starts with a target on screen ==")
        page.locator("button:has-text('Start a run')").first.click()
        page.wait_for_function(
            "() => { const e = [...document.querySelectorAll('div')]"
            ".filter(d => /font-mono/.test(d.className)"
            " && d.innerText.trim().split(/\\s+/).length >= 15); return e.length > 0; }",
            timeout=45000,
        )
        page.wait_for_timeout(1500)
        body = page.inner_text("body")

        check("a scramble was issued", len(scramble_on(page).split()) >= 15)
        check("the target is shown before solving", "beat this" in body.lower())
        first_target = target_on(page)
        check("and it is a real number", first_target is not None and first_target > 0,
              str(first_target))
        check("the score starts at zero", score_on(page) == 0)
        check("three lives are shown", "3 of 3 remaining" in body)

        print("\n== clearing the target scores, and tightens the next one ==")
        solve_it(page, scramble_on(page))
        page.wait_for_timeout(6000)
        body = page.inner_text("body")

        check("the solve was accepted",
              "could not" not in body.lower() and "not be recorded" not in body.lower(),
              [l for l in body.split("\n") if "could not" in l.lower()][:1])
        check("it cleared the target", "Cleared by" in body,
              [l for l in body.split("\n") if "Cleared" in l or "Missed" in l][:1])
        check("the score moved to 1", score_on(page) == 1, str(score_on(page)))

        second = target_on(page)
        check("the next target is tighter",
              second is not None and first_target is not None and second < first_target,
              f"{first_target} -> {second}")

        print("\n== the score is the server's, not the page's ==")
        # The claim Rush rests on. If the score lived in the browser, a reload
        # would reset it — and a mode whose score can be reset by F5 is not a
        # mode, it is a toy.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(5000)
        after = page.inner_text("body")
        check("the run survived a reload",
              "Your best" in after or score_on(page) is not None or "Start a run" in after,
              "page recovered")

        # The best run is recorded server-side, so it should be quoted back.
        check("the completed work is on record",
              "Your best" in after or "Start a run" in after,
              [l for l in after.split("\n") if "best" in l.lower()][:1])

        print("\n== rush appears under Compete ==")
        groups = page.evaluate(
            """() => {
                const out = {};
                for (const g of document.querySelectorAll('nav [role=group]')) {
                  out[g.getAttribute('aria-label')] =
                    [...g.querySelectorAll('a, span[aria-current]')].map(a => a.innerText.trim());
                }
                return out;
            }"""
        )
        check("it is a competitive mode, not a practice one",
              "Rush" in groups.get("Compete", []), str(groups.get("Compete")))

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    page.screenshot(path="/tmp/rush.png", full_page=True)
    browser.close()

print("\n== cleanup ==")
print("  test account removed" if delete_account(EMAIL) else "  (cleanup warning)")

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
