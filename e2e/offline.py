"""
cubeduel installs like an app and opens with no connection.

The manifest and its icons must load, and once the timer has been visited
the service worker must bring it — and the keyboard cube — back with the
network switched off, with a scramble to solve. The home page said "it works
offline" for months before anything made that true.

    BASE=http://localhost:3000 python3 e2e/offline.py
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


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()

    print("\n== installable ==")
    manifest = page.request.get(BASE + "/manifest.webmanifest")
    check("the manifest is served", manifest.ok, str(manifest.status))
    m = manifest.json() if manifest.ok else {}
    check("it opens standalone, on the timer", m.get("display") == "standalone" and m.get("start_url") == "/timer", str(m.get("start_url")))
    icons = m.get("icons", [])
    check("192 and 512 icons, and a maskable one", {i.get("sizes") for i in icons} >= {"192x192", "512x512"}
          and any(i.get("purpose") == "maskable" for i in icons), str(icons))
    for icon in icons:
        r = page.request.get(BASE + icon["src"])
        check(f"{icon['src']} loads", r.ok and r.headers.get("content-type", "").startswith("image/png"), str(r.status))
    page.goto(BASE + "/timer", wait_until="load")
    check("the page links the manifest", page.locator("link[rel=manifest]").count() == 1)

    print("\n== offline ==")
    ready = page.evaluate("""async () => {
        if (!('serviceWorker' in navigator)) return 'unsupported';
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 15000))]);
        return reg ? 'ready' : 'timeout';
    }""")
    check("the service worker installs", ready == "ready", ready)
    # A second visit, now controlled by the worker, saves the page and its code.
    page.reload(wait_until="load")
    page.wait_for_timeout(4000)
    page.goto(BASE + "/play", wait_until="load")
    page.wait_for_timeout(4000)

    ctx.set_offline(True)
    page.goto(BASE + "/timer", wait_until="load")
    page.wait_for_timeout(3000)
    check("the timer opens with no connection", page.locator("h1").inner_text().strip() == "Speedcubing timer",
          page.inner_text("body")[:80].replace("\n", " "))
    scramble = " ".join(page.locator("section .font-mono span").all_inner_texts())
    check("with a scramble to solve", len(scramble.split()) >= 15, scramble[:60])
    page.goto(BASE + "/play", wait_until="load")
    page.wait_for_timeout(3000)
    check("the keyboard cube opens too", page.locator("h1").inner_text().strip() == "Keyboard cubing")
    ctx.set_offline(False)
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
