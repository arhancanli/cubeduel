"""
Milestones: the sub-X barriers, earned by the solves themselves.

Two real paths in. The timer, driven by the space bar, where a first solve
breaks a barrier and says so under the time — and a DNF added afterwards takes
it back. And a csTimer export imported on /progress, whose ladder must read
exactly what an independent WCA average of the same times says.

    BASE=http://localhost:3000 python3 e2e/milestones.py
"""

import json
import math
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "cstimer-export.txt")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def timer_el(page):
    return page.locator("div.tnum").first


def do_solve(page, run_ms):
    page.keyboard.down("Space")
    page.wait_for_timeout(450)
    page.keyboard.up("Space")
    page.wait_for_timeout(run_ms)
    page.keyboard.press("KeyJ")
    page.wait_for_timeout(300)


def moment(page):
    m = page.locator("[data-testid=milestone-moment]")
    return m.inner_text().replace("\n", " | ") if m.count() == 1 and m.is_visible() else None


# An independent WCA average: truncate each result to centiseconds, DNF worst,
# drop one each end, mean, round to centiseconds.
def wca_avg(window):
    results = [None if t is None else math.floor(t * 100) / 100 for t in window]
    if results.count(None) > 1:
        return None
    ordered = sorted(results, key=lambda r: math.inf if r is None else r)
    kept = ordered[1:-1]
    return round(sum(kept) / len(kept) + 1e-9, 2)


def best_avg(times, size):
    values = [wca_avg(times[i - size:i]) for i in range(size, len(times) + 1)]
    values = [v for v in values if v is not None]
    return min(values) if values else None


def fmt(seconds):
    return f"{seconds:.2f}"


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    print("\n== the timer: a barrier broken, said under the time ==")
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/timer", wait_until="networkidle")
    page.wait_for_timeout(2500)
    do_solve(page, 2200)
    first = moment(page)
    check("a first solve of a couple of seconds breaks sub-10 and says so", first is not None and "Sub-10 single" in first, str(first))
    check("in words, with the time and the puzzle", first is not None and "your first solve under 10 seconds on a 3×3" in first, str(first))
    check("only the fastest barrier it broke is announced", first is not None and "Sub-2 minutes" not in first and "Sub-30" not in first)
    page.click("button:has-text('DNF')")
    page.wait_for_timeout(300)
    check("a DNF added afterwards takes it back", moment(page) is None, str(moment(page)))
    page.click("button:has-text('DNF')")
    page.wait_for_timeout(300)
    check("and removing the DNF gives it back", moment(page) is not None and "Sub-10 single" in (moment(page) or ""))

    do_solve(page, 2600)
    check("a second, slower solve breaks nothing new", moment(page) is None, str(moment(page)))
    for _ in range(3):
        do_solve(page, 2400)
    fifth = moment(page)
    check("the fifth solve completes the first ao5, and that is the news", fifth is not None and "Sub-10 average of 5" in fifth, str(fifth))
    page.click("text=Your milestones →")
    page.wait_for_url("**/progress#milestones", timeout=10000)
    page.wait_for_selector("[data-testid=milestones]", timeout=10000)
    card = page.locator("[data-testid=milestones]").inner_text()
    check("the link lands on the ladder, which knows an ao12 needs 7 more",
          "Next: your first average of 12" in card and "7 more solves and it counts." in card, card[:120].replace("\n", " | "))
    check("no page errors on the timer path", not errors, "; ".join(errors[:2]))
    page.close()

    print("\n== an imported history, read against an independent average ==")
    times = [24.1, 22.8, 19.62, 23.5, 21.9, 22.4, 21.0, 20.7, 23.3, 21.8, 22.2, 20.9, 21.5, 22.0, None]
    with open(FIXTURE) as f:
        export = json.load(f)
    start = 1790011548
    export["session1"] = [
        [[-1 if t is None else 0, 30000 if t is None else round(t * 1000)], "R U R' U' F2 D L2 B R' U2", "", start + i * 600]
        for i, t in enumerate(times)
    ]
    tmp = os.path.join(tempfile.mkdtemp(), "cstimer.txt")
    with open(tmp, "w") as f:
        json.dump(export, f)

    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    page.goto(BASE + "/progress", wait_until="networkidle")
    page.wait_for_timeout(800)
    check("no ladder before there is anything to read", page.locator("[data-testid=milestones]").count() == 0)
    page.set_input_files("input[type=file]", tmp)
    page.wait_for_timeout(600)
    page.click(f"button:has-text('Import {len(times)} solves')")
    page.wait_for_timeout(800)
    page.reload(wait_until="networkidle")
    page.wait_for_selector("[data-testid=milestones]", timeout=10000)
    card = page.locator("[data-testid=milestones]")
    text = card.inner_text()

    ao12 = best_avg(times, 12)
    ao5 = best_avg(times, 5)
    check("the averages cross the right barriers", ao12 is not None and 20 < ao12 < 25 and ao5 is not None and 20 < ao5 < 25, f"ao5 {ao5} ao12 {ao12}")
    check("it leads with the ao12's next barrier", "Next: Sub-20 average of 12" in text, text[:160].replace("\n", " | "))
    gap = round(ao12 - 20, 2)
    check("with the best ao12 and the distance, as an independent WCA average says",
          f"Your best ao12 is {fmt(ao12)} — {fmt(gap)} to go." in text, f"expected {fmt(ao12)} / {fmt(gap)}")

    def sticker(name):
        s = card.locator(f"[role=img][aria-label^='{name}:']")
        return s.get_attribute("aria-label") if s.count() == 1 else None

    check("the 19.62 single lit sub-20", (sticker("Sub-20 single") or "").startswith("Sub-20 single: 19.62"), str(sticker("Sub-20 single")))
    check("sub-20 by average is not lit", (sticker("Sub-20 average of 5") or "").endswith("not yet") and (sticker("Sub-20 average of 12") or "").endswith("not yet"))
    check("sub-25 is lit all three ways", all(card.locator(f"[role=img][aria-label^='Sub-25 {k}:'][data-earned]").count() == 1 for k in ["single", "average of 5", "average of 12"]))
    rungs = [r.split("\n")[0].strip() for r in card.locator("[data-testid=rung]").all_inner_texts()]
    check("fastest at the top, down to the fastest barrier broken all three ways",
          rungs == ["Sub-15", "Sub-17", "Sub-20", "Sub-25"], str(rungs))
    folded = card.locator("[data-testid=rungs-folded]")
    check("the long-broken barriers fold into one line",
          folded.count() == 1 and "Sub-30, sub-45, sub-1 minute and sub-2 minutes: all broken" in folded.inner_text(),
          folded.inner_text() if folded.count() else "")
    check("the next barrier is marked on its rung", card.locator("[data-testid=rung][data-next]").inner_text().startswith("Sub-20"))
    check("barriers far above fold into a count", "more above, up to sub-10" in text)
    check("counted: every rung to sub-25 three ways, plus the sub-20 single",
          "milestones · 16 of 30" in text.lower(), text[:40])

    print("\n== a phone ==")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(300)
    width = page.evaluate("() => document.documentElement.scrollWidth")
    check("the ladder fits a phone with no sideways scroll", width <= 390, str(width))
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
