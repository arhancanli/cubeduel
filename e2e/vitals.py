"""
Nothing moves while a page loads.

Layout shift is measured the way Chrome measures it for search ranking — the
browser's own layout-shift entries — on a phone, for somebody new (empty
storage) and for somebody returning. Google's line for "good" is 0.1.

A phone-sized touch window, not Chrome's full mobile emulation: under that
emulation the timer's shift of 0.15 read as 0 here, while Lighthouse — and a
plain touch window — both saw it. A check that cannot see the bug it guards is
not a check.

The timer used to fail this for exactly the people it most needs to impress:
the welcome row for first-timers was added once the page had started, and the
scramble box grew to a second line, and the clock jumped down twice.

    BASE=http://localhost:3000 python3 e2e/vitals.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []
PAGES = ["/", "/timer", "/play", "/solve", "/solver", "/learn", "/review"]
CLS = """() => new Promise(done => {
    let total = 0;
    new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => done(Math.round(total * 1000) / 1000), 300);
})"""


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    print("\n== somebody new, on a phone ==")
    for path in PAGES:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + path, wait_until="load")
        page.wait_for_timeout(2500)
        cls = page.evaluate(CLS)
        check(f"{path}: layout shift under 0.1", cls < 0.1, str(cls))
        if path == "/timer":
            check("/timer: the welcome is shown to somebody new", page.get_by_test_id("first-visit").is_visible())
        ctx.close()

    print("\n== somebody returning ==")
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    ctx.add_init_script("window.localStorage.setItem('cubeduel:welcomed', '1')")
    page = ctx.new_page()
    page.goto(BASE + "/timer", wait_until="load")
    page.wait_for_timeout(2500)
    check("/timer: no welcome for somebody who has been here", page.get_by_test_id("first-visit").count() == 0
          or not page.get_by_test_id("first-visit").is_visible())
    cls = page.evaluate(CLS)
    check("/timer: and nothing moved while it went", cls < 0.1, str(cls))
    ctx.close()

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
