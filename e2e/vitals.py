"""
Nothing moves while a page loads.

Layout shift is measured the way Chrome measures it for search ranking — the
browser's own layout-shift entries — on a phone, for somebody new (empty
storage) and for somebody returning. Google's line for "good" is 0.1.

The network is slowed the way a phone's is, so the web fonts arrive after the
first paint, as they do on the live site. On a fast local server they arrived
first, and a scramble that re-wrapped when its font swapped in jumped the
timer by 0.10 in production while this suite read 0.

A phone-sized touch window, not Chrome's full mobile emulation: under that
emulation the timer's shift of 0.15 read as 0 here, while Lighthouse — and a
plain touch window — both saw it. A check that cannot see the bug it guards is
not a check.

The timer used to fail this for exactly the people it most needs to impress:
the welcome row for first-timers was added once the page had started, and the
scramble box grew to a second line, and the clock jumped down twice.

    BASE=http://localhost:3000 python3 e2e/vitals.py
"""

import json
import os
import sys
import time

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


def slow_network(page):
    cdp = page.context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {
        "offline": False, "latency": 150,
        "downloadThroughput": 1.6 * 1024 * 1024 / 8, "uploadThroughput": 750 * 1024 / 8,
    })


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
        slow_network(page)
        page.goto(BASE + path, wait_until="load")
        page.wait_for_timeout(4000)
        cls = page.evaluate(CLS)
        check(f"{path}: layout shift under 0.1", cls < 0.1, str(cls))
        if path == "/timer":
            check("/timer: the welcome is shown to somebody new", page.get_by_test_id("first-visit").is_visible())
        ctx.close()

    print("\n== the home page for somebody who has solved here ==")
    # Their numbers replace the pitch once the page can read them; room is held
    # for them before the first paint. Swapping them in afterwards used to shift
    # the page by 0.10 — past Google's line — on phone and desktop alike.
    HISTORY = json.dumps({"version": 1, "solves": [
        {"id": f"h{i}", "at": time.time() * 1000 - i * 3600e3, "scramble": "R U", "durationMs": 20000 + i * 300,
         "penalty": "OK", "moveCount": 0, "tps": 0, "splits": [], "ollCase": None, "pllCase": None,
         "ollSetup": None, "pllSetup": None, "source": "manual"} for i in range(12)]})
    for width, height in [(390, 844), (500, 900), (768, 1000), (1024, 900), (1180, 900), (1280, 900), (1440, 1000)]:
        ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=width < 800)
        ctx.add_init_script(f"localStorage.setItem('cubeduel.history.v1', {json.dumps(HISTORY)})")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="load")
        page.wait_for_timeout(3000)
        cls = page.evaluate(CLS)
        check(f"/ at {width}px, returning: layout shift under 0.1", cls < 0.1, str(cls))
        ctx.close()

    print("\n== somebody returning ==")
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    ctx.add_init_script("window.localStorage.setItem('cubeduel:welcomed', '1')")
    page = ctx.new_page()
    slow_network(page)
    page.goto(BASE + "/timer", wait_until="load")
    page.wait_for_timeout(4000)
    check("/timer: no welcome for somebody who has been here", page.get_by_test_id("first-visit").count() == 0
          or not page.get_by_test_id("first-visit").is_visible())
    cls = page.evaluate(CLS)
    check("/timer: and nothing moved while it went", cls < 0.1, str(cls))
    ctx.close()

    # The layout must not depend on which font is showing. On the live site the
    # scramble's monospace font arrives after the first paint; the wider
    # fallback wrapped a 21-move scramble to three lines, the real font to two,
    # and the clock jumped as it swapped. Timing is not reproducible here, so
    # the invariant is checked directly: with the web fonts blocked and with
    # them loaded, every scramble fits the height held for it.
    print("\n== the scramble fits its space in either font ==")
    FITS = """() => {
        const el = document.querySelector('section .font-mono');
        if (!el || !el.textContent.trim()) return null;
        return [el.scrollHeight, parseFloat(getComputedStyle(el).minHeight)];
    }"""
    for path, (width, height), fonts in [
        (p_, (w, h), f) for p_ in ["/timer", "/play"] for w, h in [(390, 844), (1440, 1000)] for f in ["blocked", "loaded"]
    ]:
        worst = 0
        for _ in range(4):
            ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=width < 800)
            ctx.add_init_script("window.localStorage.setItem('cubeduel:welcomed', '1')")
            if fonts == "blocked":
                ctx.route("**/*.woff2", lambda route: route.abort())
            page = ctx.new_page()
            page.goto(BASE + path, wait_until="load")
            page.wait_for_timeout(1500)
            fit = page.evaluate(FITS)
            if fit:
                worst = max(worst, fit[0] - fit[1])
            ctx.close()
        check(f"{path} {width}px, fonts {fonts}: the scramble never outgrows its space", worst <= 1, f"worst overflow {worst:.0f}px")

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
