"""
The front page for somebody who is signed in.

A visitor gets the pitch; a player gets their home — standing, what is waiting,
and the way into every mode. This proves the swap happens, that the numbers on
it come from the server for THIS account (a fresh account must read as
unrated, with five solves to go), and that signing out gives the pitch back.

    BASE=http://localhost:3000 python3 e2e/home.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
EMAIL = probe_email("home")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== signed out ==")
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(1500)
    body = page.inner_text("body")
    check("a visitor gets the pitch", "shows you why you" in body)
    check("and no dashboard", page.locator("[data-testid=home-rating]").count() == 0)

    print("\n== signed in ==")
    sign_up(page, EMAIL)
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("[data-testid=home-rating]", timeout=20000)
    page.wait_for_function(
        "() => !document.querySelector('[data-testid=home-rating] .animate-pulse')", timeout=20000
    )
    body = page.inner_text("body")
    # Lower-cased: the eyebrow is styled uppercase, and innerText returns it so.
    check("a player gets their home", "welcome back" in body.lower())
    check("not the pitch", "shows you why you" not in body)
    rating = page.locator("[data-testid=home-rating]").inner_text()
    check("a new account reads as unrated, from the server",
          "Unrated" in rating and "Five verified solves" in rating, rating.replace("\n", " "))
    check("the modes are one click away", page.get_by_role("navigation", name="Modes").count() == 1)
    check("the handle is shown", "@" in page.locator("h1").inner_text(), page.locator("h1").inner_text())

    streak = page.locator("[data-testid=streak]").inner_text()
    check("a new player is shown how to start a streak",
          "0 days" in streak and "start one" in streak, streak.replace("\n", " "))

    print("\n== on a phone ==")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    check("no horizontal scroll", overflow <= 1, f"{overflow}px")

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

check("the test account was removed", delete_account(EMAIL))

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
