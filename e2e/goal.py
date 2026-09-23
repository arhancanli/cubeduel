"""
Goals, and the refusal that makes them worth anything.

Every timer app offers a projection; almost none can justify one. This suite
exists to pin the behaviour that is easy to quietly lose: with too little
evidence the app must say so and name no date, however much a confident line
would look better on the screen.

    BASE=http://localhost:3000 python3 e2e/goal.py
"""

import sys
from playwright.sync_api import sync_playwright
import os
BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []
def check(label, cond, detail=""):
    if not cond: FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))

KEY = {"U":"KeyJ","U'":"KeyF","D":"KeyS","D'":"KeyL","R":"KeyI","R'":"KeyK",
       "L":"KeyD","L'":"KeyE","F":"KeyH","F'":"KeyG","B":"KeyW","B'":"KeyO"}
def inv(m): return m if m.endswith("2") else (m[:-1] if m.endswith("'") else m+"'")
def keys(m): return [KEY[m[:-1]]]*2 if m.endswith("2") else [KEY[m]]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width":1440,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== a goal can be set with no solves ==")
    page.goto(BASE + "/progress", wait_until="domcontentloaded"); page.wait_for_timeout(2500)
    body = page.inner_text("body")
    check("the empty state offers solving", "starts filling in" in body and "Solve on the keyboard" in body)

    print("\n== record some solves ==")
    for i in range(3):
        page.goto(BASE + "/play", wait_until="domcontentloaded")
        page.wait_for_selector("twisty-player", timeout=30000)
        page.wait_for_function("() => { const e=document.querySelector('div.font-mono'); return !!e && e.innerText.trim().length>40; }", timeout=30000)
        page.wait_for_timeout(1200)
        scr = " ".join(page.locator("div.font-mono").first.inner_text().split())
        for m in reversed(scr.split()):
            for k in keys(inv(m)):
                page.keyboard.press(k); page.wait_for_timeout(15)
        page.wait_for_timeout(900)
    print("  recorded 3 solves")

    print("\n== the goal panel ==")
    page.goto(BASE + "/progress", wait_until="domcontentloaded"); page.wait_for_timeout(3000)
    body = page.inner_text("body")
    check("a goal can be chosen", "sub-20" in body and "GOAL" in body.upper())
    check("the offer is honest about refusing", "cannot yet say" in body, [l for l in body.split("\n") if "cannot yet" in l][:1])

    page.locator("button:has-text('sub-20')").first.click()
    page.wait_for_timeout(1500)
    body = page.inner_text("body")
    check("the goal is now tracked", "target" in body.lower() and "started at" in body.lower())
    check("it refuses to project from 3 solves", "Not enough solves" in body,
          [l for l in body.split("\n") if "enough" in l][:1])
    check("no invented date appears", "March" not in body and "weeks" not in body)
    check("the goal can be changed", page.locator("button:has-text('Change goal')").count() == 1)

    print("\n== it survives a reload ==")
    page.reload(wait_until="domcontentloaded"); page.wait_for_timeout(2500)
    check("the goal persisted", "started at" in page.inner_text("body").lower())

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    page.screenshot(path="/tmp/goal.png", full_page=True)
    b.close()

print("\n" + "="*52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS: print(" -", f)
sys.exit(1 if FAILS else 0)
