"""
The lessons: all 41 F2L cases, and cube notation.

F2L: the page lists every case, each opens onto a cube held white-cross-down,
and the cube is set up in exactly the case the algorithm is for.
Notation: pressing a move starts from a solved cube and plays that move, so
the move is seen happening rather than undone.

    BASE=http://localhost:3000 python3 e2e/lessons.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def invert(alg):
    out = []
    for m in reversed(alg.split()):
        out.append(m if m.endswith("2") else (m[:-1] if m.endswith("'") else m + "'"))
    return " ".join(out)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== F2L ==")
    page.goto(BASE + "/learn/f2l", wait_until="load")
    page.wait_for_timeout(1000)
    cases = page.locator("[data-testid=f2l-case]")
    check("all 41 cases are listed", cases.count() == 41, str(cases.count()))
    check("no cube is loaded until one is asked for", page.locator("twisty-player").count() == 0)
    alg = " ".join(cases.nth(6).locator("p.font-mono").inner_text().split())
    cases.nth(6).get_by_role("button", name="Show on a cube").click()
    page.wait_for_selector("twisty-player", timeout=30000)
    setup = page.locator("twisty-player").first.get_attribute("experimental-setup-alg") or ""
    check("the cube is held with the cross underneath", setup.startswith("z2"), setup)
    check("and set up in exactly the case the algorithm solves", setup == f"z2 {invert(alg)}", f"{setup} vs {alg}")

    print("\n== notation ==")
    page.goto(BASE + "/notation", wait_until="load")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.get_by_role("button", name="R'", exact=True).click()
    page.wait_for_timeout(800)
    says = page.get_by_test_id("notation-says").inner_text()
    check("the move is explained in words", "anticlockwise" in says, says)
    setup = page.locator("twisty-player").first.get_attribute("experimental-setup-alg") or ""
    check("the cube starts solved, so the move is seen happening", setup.split() == ["R'", "R"], setup)

    print("\n== on a phone ==")
    phone = browser.new_page(viewport={"width": 390, "height": 844})
    for path in ["/learn/f2l", "/notation"]:
        phone.goto(BASE + path, wait_until="load")
        phone.wait_for_timeout(1000)
        overflow = phone.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{path}: no horizontal scroll", overflow <= 1, f"{overflow}px")

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
