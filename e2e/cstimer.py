"""
Bringing a csTimer history across, through the real page with a real file.

The fixture was written by csTimer itself (see src/lib/cstimerImport.test.ts):
one 3x3 session with an OK, a +2 and a DNF, and a 2x2 session. What this checks
is everything the unit tests cannot see — the file picker, the preview that says
what is and is not coming across BEFORE anything is written, the confirmation
surviving the page changing from empty to full, and what actually lands in
storage.

    BASE=http://localhost:3000 python3 e2e/cstimer.py
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "cstimer-export.txt")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def history(page):
    raw = page.evaluate("() => localStorage.getItem('cubeduel.history.v1')")
    return json.loads(raw)["solves"] if raw else []


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== an empty history offers the import ==")
    page.goto(BASE + "/progress", wait_until="networkidle")
    page.wait_for_timeout(800)
    section = page.locator("[data-testid=cstimer-import]")
    check("the import is on the empty page", section.count() == 1 and "No solves recorded yet" in page.inner_text("body"))

    print("\n== the preview comes before anything is written ==")
    page.set_input_files("input[type=file]", FIXTURE)
    page.wait_for_timeout(600)
    text = section.inner_text()
    check("the 3x3 session is listed with its three solves", "Session 1" in text and "3 solves" in text,
          text[:200].replace("\n", " | "))
    check("the 2x2 session is named and left out, not hidden", "left out: not 3x3 (222so)" in text)
    check("nothing is stored until it is confirmed", history(page) == [])

    print("\n== importing ==")
    page.click("button:has-text('Import 3 solves')")
    page.wait_for_timeout(1000)
    status = section.inner_text()
    check("the confirmation survives the page filling in", "Added 3 solves from csTimer" in status, status[:120])
    body = page.inner_text("body")
    check("the page is no longer empty", "No solves recorded yet" not in body)
    imported = page.locator("[data-testid=imported-count]")
    check("it says how many came from csTimer", imported.count() == 1 and "3 of these came from csTimer" in imported.inner_text())

    solves = history(page)
    check("three solves are stored", len(solves) == 3, str(len(solves)))
    check("as csTimer times: manual, not turned here",
          all(s.get("source") == "manual" and s.get("origin") == "cstimer" for s in solves))
    check("penalties come across as csTimer had them",
          [s["penalty"] for s in solves] == ["OK", "PLUS2", "DNF"], str([s["penalty"] for s in solves]))
    check("in time order", [s["at"] for s in solves] == sorted(s["at"] for s in solves))

    print("\n== the same file again ==")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    page.set_input_files("input[type=file]", FIXTURE)
    page.wait_for_timeout(600)
    page.click("button:has-text('Import 3 solves')")
    page.wait_for_timeout(800)
    again = page.locator("[data-testid=cstimer-import]").inner_text()
    check("nothing is added twice", "Nothing new" in again and len(history(page)) == 3, again[:120])

    print("\n== a file that is not an export ==")
    check("another file can be chosen without reloading",
          page.locator("button:has-text('Import another file')").count() == 1)
    page.set_input_files("input[type=file]", {"name": "notes.txt", "mimeType": "text/plain", "buffer": b"my best is 9.8"})
    page.wait_for_timeout(500)
    # Scoped to the import: Next.js's route announcer is also role=alert, so a
    # page-wide count is two even when this works.
    alert = page.locator("[data-testid=cstimer-import] [role=alert]")
    check("it is refused, and says why", alert.count() == 1 and "not a csTimer export" in alert.inner_text())
    check("and nothing is written", len(history(page)) == 3)

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:160])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
