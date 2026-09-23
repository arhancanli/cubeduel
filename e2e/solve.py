"""A solve, watched back.

    python3 e2e/solve.py

The move stream is the one thing this site has that a stopwatch does not, and a
permalink is the only form in which that is worth anything — a replay you can
watch for four seconds after stopping the clock is a flourish, not evidence.

So this drives the whole loop rather than the page in isolation: sign up, solve
a real cube on /play so a genuine move stream is recorded and verified, find
that solve on the public profile, follow the link, and watch it back.

The checks that matter are the two ends of the playhead, because both have been
wrong. At 0.00 nothing may be turned — the first move is stamped at 0, so an
inclusive comparison silently skips the scrambled state, which is the one thing
you want to look at before pressing play. And at the end every move must have
been played, including a final turn that lands on the buzzer.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
EMAIL = probe_email("solve-page")

KEY_FOR_MOVE = {
    "U": "KeyJ", "U'": "KeyF",
    "D": "KeyS", "D'": "KeyL",
    "R": "KeyI", "R'": "KeyK",
    "L": "KeyD", "L'": "KeyE",
    "F": "KeyH", "F'": "KeyG",
    "B": "KeyW", "B'": "KeyO",
}

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


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


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    try:
        page.goto(BASE + "/rush", wait_until="networkidle")
        sign_up(page, EMAIL)

        # ------------------------------------------------------------------
        # Rush rather than practice, and the reason is worth stating: a practice
        # solve is local-first by design — it works offline and signed out — so
        # it syncs as a time with no move stream and nothing to replay. Only the
        # competitive modes send the turns for the server to verify, which is
        # exactly the set of solves a permalink is worth having.
        print("\n== a real solve, with a real move stream ==")
        page.goto(BASE + "/rush", wait_until="networkidle")
        page.locator("button:has-text('Start a run')").first.click()
        page.wait_for_function(
            "() => { const e = [...document.querySelectorAll('div')]"
            ".filter(d => /font-mono/.test(d.className)"
            " && d.innerText.trim().split(/\\s+/).length >= 15); return e.length > 0; }",
            timeout=45000,
        )
        page.wait_for_timeout(1500)

        scramble = page.evaluate(
            """() => { const els = [...document.querySelectorAll('div')]
                .filter(d => /font-mono/.test(d.className)
                          && d.innerText.trim().split(/\\s+/).length >= 15);
                return els.length ? els[0].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""
        )
        check("a scramble was issued", len(scramble.split()) >= 15,
              f"{len(scramble.split())} moves")

        # Typing the inverse of the scramble solves the cube by definition, and
        # produces a stream the server can verify against the scramble it issued.
        for move in reversed(scramble.split()):
            for key in keys_for(invert(move)):
                page.keyboard.press(key)
                page.wait_for_timeout(60)

        page.wait_for_timeout(6000)

        # ------------------------------------------------------------------
        print("\n== finding it again ==")
        page.goto(BASE + "/settings", wait_until="load")
        page.wait_for_timeout(4000)
        match = re.search(r"/u/([a-z0-9\-]+)", page.inner_text("body"))
        handle = match.group(1) if match else None
        check("the account has a handle", bool(handle), handle or "none")
        if not handle:
            raise RuntimeError("no handle; cannot reach the profile")

        page.goto(f"{BASE}/u/{handle}", wait_until="networkidle")
        page.wait_for_timeout(1500)
        rows = page.locator("ol li a[href^='/s/']")
        check("the solve is listed on the profile", rows.count() >= 1, f"{rows.count()} rows")
        check("each row links to the solve itself", rows.count() >= 1)

        rows.first.click()
        page.wait_for_url("**/s/**", timeout=20000)
        page.wait_for_timeout(4000)
        check("following the row reaches a solve page", "/s/" in page.url, page.url)

        # ------------------------------------------------------------------
        print("\n== watching it back ==")
        head = page.locator("div.tnum.flex span").first
        status = page.locator("text=/move \\d+ of \\d+/").first

        check("the replay starts at zero", head.inner_text() == "0.00", head.inner_text())
        check("nothing is turned before play is pressed",
              "move 0 of" in status.inner_text(), status.inner_text())

        play = page.locator("button[aria-label='Play']")
        check("there is a play button", play.count() == 1)
        play.click()
        page.wait_for_timeout(900)
        check("playing advances the clock", head.inner_text() != "0.00", head.inner_text())

        page.locator("button[aria-label='Pause']").click()
        page.wait_for_timeout(250)
        held = head.inner_text()
        page.wait_for_timeout(700)
        check("pausing holds it", head.inner_text() == held, held)

        slider = page.locator("input[aria-label='Position in the solve']")
        slider.fill(slider.get_attribute("max"))
        page.wait_for_timeout(500)
        total = status.inner_text().split("of")[-1].strip()
        check("scrubbing to the end plays every move",
              f"move {total} of {total}" in status.inner_text(), status.inner_text())

        check("the scramble is shown", page.locator("text=SCRAMBLE").count() >= 1)
        check("the solve is marked verified", page.locator("text=verified").count() >= 1)

        check("no page errors", not errors, str(errors[:2]))

    finally:
        try:
            delete_account(EMAIL)
        except Exception as exc:  # noqa: BLE001
            print(f"  cleanup: {exc}")
        browser.close()

print("\nAll checks passed." if fails == 0 else f"\n{fails} check(s) failed.")
sys.exit(0 if fails == 0 else 1)
