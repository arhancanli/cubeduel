"""The picture a link shows when somebody pastes it.

    python3 e2e/share_cards.py

A link to this site is usually seen before the site is: in a group chat, a
Discord server, a reply. For a race that preview *is* the invitation. So the
cards are rendered here the way a chat app fetches them — a plain request to the
image route — against real rows rather than fixtures, because what breaks these
is never the copy. It is the renderer: the cards are drawn by Satori, which is
not a browser, and a container with two children and no explicit display fails
at request time with a 500 and a preview that silently shows nothing.

What is checked: every card is a real PNG of the right size, the pages advertise
them, and a card drawn from real data is not the same picture as the one drawn
when the thing does not exist. That last one is the check that catches a card
rendering its empty state for a race that is perfectly fine.

The words on each card are decided by pure functions and tested in
`src/lib/shareCards.test.ts`, including the rule that no card may ever mention
the scramble.
"""

import os
import re
import struct
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []
EMAILS = []

KEY_FOR_MOVE = {
    "U": "KeyJ", "U'": "KeyF",
    "D": "KeyS", "D'": "KeyL",
    "R": "KeyI", "R'": "KeyK",
    "L": "KeyD", "L'": "KeyE",
    "F": "KeyH", "F'": "KeyG",
    "B": "KeyW", "B'": "KeyO",
}


def check(label, ok, detail=""):
    if not ok:
        FAILS.append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def invert(move):
    if move.endswith("2"):
        return move
    if move.endswith("'"):
        return move[:-1]
    return move + "'"


def keys_for(move):
    return [KEY_FOR_MOVE[move[:-1]]] * 2 if move.endswith("2") else [KEY_FOR_MOVE[move]]


def png_size(body):
    """Width and height out of the IHDR chunk, or None if this is not a PNG."""
    if body[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", body[16:24])


def card(page, path):
    """One card, fetched the way a chat app fetches it."""
    response = page.request.get(BASE + path)
    body = response.body() if response.ok else b""
    return response.status, response.headers.get("content-type", ""), body


def check_card(page, label, path):
    status, content_type, body = card(page, path)
    size = png_size(body)
    check(
        f"{label} renders a card",
        status == 200 and content_type.startswith("image/png") and size == (1200, 630),
        f"{status} {content_type} {size} {len(body)}B",
    )
    return body


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 1000})
    guest_ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 1000})
    host = host_ctx.new_page()
    guest = guest_ctx.new_page()
    errors = []
    for page in (host, guest):
        page.on("pageerror", lambda e: errors.append(str(e)))

    try:
        print("\n== the cards for things that do not exist ==")
        # Drawn first, on purpose: every later card is compared against these,
        # and a card that matches one of them is showing an empty state.
        missing_race = check_card(host, "a race that has gone", "/race/zzzzzzzz/opengraph-image")
        missing_player = check_card(host, "an unknown player", "/u/nobodyhere/opengraph-image")
        missing_solve = check_card(
            host, "a solve that never existed", "/s/00000000-0000-0000-0000-000000000000/opengraph-image"
        )
        missing_challenge = check_card(
            host,
            "a challenge that never existed",
            "/challenge/00000000-0000-0000-0000-000000000000/opengraph-image",
        )

        print("\n== a real race ==")
        host_email = probe_email("card-host")
        guest_email = probe_email("card-guest")
        EMAILS += [host_email, guest_email]

        host.goto("/join", wait_until="load")
        host.wait_for_selector("#email", timeout=20_000)
        sign_up(host, host_email)
        host.goto("/race", wait_until="networkidle")
        host.click("[data-testid=race-create]")
        host.wait_for_url("**/race/*", timeout=20_000)
        code = host.url.rsplit("/", 1)[-1]

        open_race = check_card(host, "a race waiting for somebody", f"/race/{code}/opengraph-image")
        check(
            "it is not the card for a race that has gone",
            open_race != missing_race and len(open_race) > 0,
            f"{len(open_race)}B against {len(missing_race)}B",
        )

        # The page has to point at it, or nothing ever fetches it.
        meta = host.locator('meta[property="og:image"]').first
        content = meta.get_attribute("content") if meta.count() else ""
        check("the race page advertises its card", bool(content) and "opengraph-image" in (content or ""), content or "no meta")

        print("\n== once both are in it ==")
        guest.goto("/join", wait_until="load")
        guest.wait_for_selector("#email", timeout=20_000)
        sign_up(guest, guest_email)
        guest.goto(f"/race/{code}", wait_until="networkidle")
        guest.click("button:has-text('Take the seat')")
        guest.locator("[data-testid=race-ready]").wait_for(timeout=20_000)

        both_in = check_card(host, "a race with both players", f"/race/{code}/opengraph-image")
        check(
            "the card changed when the second player arrived",
            both_in != open_race,
            f"{len(both_in)}B against {len(open_race)}B",
        )

        # A preview must not settle anything. Fetching the card is a robot
        # reading a message, and the race it is describing has to survive it.
        state = host.request.get(f"{BASE}/api/race/state?code={code}")
        body = state.json() if state.ok else {}
        check(
            "fetching the card did not end the race",
            body.get("phase") in ("lobby", "countdown", "racing"),
            str(body.get("phase")),
        )

        print("\n== a real solve, and a real player ==")
        host.goto("/rush", wait_until="networkidle")
        host.locator("button:has-text('Start a run')").first.click()
        host.wait_for_function(
            "() => [...document.querySelectorAll('div')].some(d => /font-mono/.test(d.className)"
            " && d.innerText.trim().split(/\\s+/).length >= 15)",
            timeout=45_000,
        )
        host.wait_for_timeout(1500)
        scramble = host.evaluate(
            """() => { const els = [...document.querySelectorAll('div')]
                .filter(d => /font-mono/.test(d.className)
                          && d.innerText.trim().split(/\\s+/).length >= 15);
                return els.length ? els[0].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""
        )
        for move in reversed(scramble.split()):
            for key in keys_for(invert(move)):
                host.keyboard.press(key)
                host.wait_for_timeout(60)
        host.wait_for_timeout(6000)

        host.goto("/settings", wait_until="load")
        host.wait_for_timeout(4000)
        match = re.search(r"/u/([a-z0-9\-]+)", host.inner_text("body"))
        handle = match.group(1) if match else None
        check("the account has a handle", bool(handle), handle or "none")

        if handle:
            player = check_card(host, "a player", f"/u/{handle}/opengraph-image")
            check("it is not the unknown-player card", player != missing_player)

            host.goto(f"/u/{handle}", wait_until="networkidle")
            host.wait_for_timeout(1500)
            rows = host.locator("ol li a[href^='/s/']")
            if rows.count() >= 1:
                solve_path = rows.first.get_attribute("href")
                solve = check_card(host, "a solve", f"{solve_path}/opengraph-image")
                check("it is not the missing-solve card", solve != missing_solve)
            else:
                check("the solve is on the profile to draw a card for", False, "no rows")

        print("\n== an open challenge, which is a link worth posting ==")
        host.goto("/duel", wait_until="networkidle")
        host.wait_for_timeout(3000)
        if host.locator("[data-testid=challenge-open]").count() == 1:
            host.locator("[data-testid=challenge-open]").first.click()
            host.wait_for_timeout(5000)
            host.goto("/duel", wait_until="networkidle")
            host.wait_for_timeout(2000)
            link = host.locator("a[href^='/challenge/']").first
            if link.count() == 1:
                path = link.get_attribute("href")
                offer = check_card(host, "an open challenge", f"{path}/opengraph-image")
                check("it is not the missing-challenge card", offer != missing_challenge)
            else:
                check("the open challenge is linked from the page", False, "no link")
        else:
            check("the duel page offers to leave a challenge open", False, "no button")

        print("\n== console ==")
        check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:160])
    finally:
        for email in EMAILS:
            try:
                delete_account(email)
            except Exception as exit_error:  # noqa: BLE001 - cleanup must not mask a failure
                print(f"  (cleanup: {exit_error})")
        browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
