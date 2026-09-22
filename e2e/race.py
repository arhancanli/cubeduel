"""
A live race between two real browsers.

Two separate browser contexts — no shared cookies, no shared session — go
through everything a race is: one creates it and reads the link, the other
opens the link and takes the seat, both press ready, both screens count down
from the server's clock and show the same scramble at the same moment, both
solve it on the keyboard, each sees the other's progress and then their time,
and the server names the same winner on both screens. Then a rematch lands them
both in one new race.

    BASE=http://localhost:3000 python3 e2e/race.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []

KEY_FOR_MOVE = {
    "U": "KeyJ", "U'": "KeyF",
    "D": "KeyS", "D'": "KeyL",
    "R": "KeyI", "R'": "KeyK",
    "L": "KeyD", "L'": "KeyE",
    "F": "KeyH", "F'": "KeyG",
    "B": "KeyW", "B'": "KeyO",
}


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


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


def solve(page, scramble, gap_ms):
    for move in reversed(scramble.split()):
        for key in keys_for(invert(move)):
            page.keyboard.press(key)
            page.wait_for_timeout(gap_ms)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 900})
    guest_ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 900})
    host = host_ctx.new_page()
    guest = guest_ctx.new_page()
    errors = []
    for page in (host, guest):
        page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n== the host creates a race ==")
    host.goto("/join", wait_until="domcontentloaded")
    host.wait_for_selector("#email", timeout=20_000)
    sign_up(host, probe_email("race-host"))
    host.goto("/race", wait_until="networkidle")
    host.click("[data-testid=race-create]")
    host.wait_for_url("**/race/*", timeout=20_000)
    link = host.locator("[data-testid=race-link]")
    link.wait_for(timeout=20_000)
    url = link.input_value()
    check("the host is given a link to send", "/race/" in url, url)
    code = url.rsplit("/", 1)[-1]

    print("\n== the guest opens it ==")
    guest.goto("/join", wait_until="domcontentloaded")
    guest.wait_for_selector("#email", timeout=20_000)
    sign_up(guest, probe_email("race-guest"))
    guest.goto(f"/race/{code}", wait_until="networkidle")
    guest.click("button:has-text('Take the seat')")
    guest.locator("[data-testid=race-ready]").wait_for(timeout=20_000)
    host.locator("[data-testid=race-ready]").wait_for(timeout=20_000)
    check("both are seated and can press ready", True)
    check("there is no scramble in the lobby", guest.locator("[data-testid=race-scramble]").count() == 0)

    print("\n== ready, countdown, go ==")
    host.click("[data-testid=race-ready]")
    guest.click("[data-testid=race-ready]")
    host.locator("[data-testid=race-countdown]").wait_for(timeout=20_000)
    guest.locator("[data-testid=race-countdown]").wait_for(timeout=20_000)
    check("both screens count down", True)
    check("and neither shows a scramble yet",
          host.locator("[data-testid=race-scramble]").count() == 0
          and guest.locator("[data-testid=race-scramble]").count() == 0)

    host.locator("[data-testid=race-scramble]").wait_for(timeout=20_000)
    guest.locator("[data-testid=race-scramble]").wait_for(timeout=20_000)
    host_scramble = " ".join(host.locator("[data-testid=race-scramble]").inner_text().split())
    guest_scramble = " ".join(guest.locator("[data-testid=race-scramble]").inner_text().split())
    check("the same scramble appears on both screens", host_scramble == guest_scramble and len(host_scramble.split()) >= 15,
          host_scramble[:40])
    host.wait_for_timeout(1500)

    print("\n== racing ==")
    # The host turns half of the solution, then stops: the guest's screen must
    # show them turning.
    moves = list(reversed(host_scramble.split()))
    half = moves[: len(moves) // 2]
    for move in half:
        for key in keys_for(invert(move)):
            host.keyboard.press(key)
            host.wait_for_timeout(25)
    host.wait_for_timeout(2500)
    seen = guest.locator("[data-testid=seat-host] >> text=/turns/").first
    check("the guest sees the host turning, live", seen.count() == 1 and " 0 turns" not in seen.inner_text(),
          seen.inner_text() if seen.count() else "nothing")

    rest = moves[len(moves) // 2:]
    for move in rest:
        for key in keys_for(invert(move)):
            host.keyboard.press(key)
            host.wait_for_timeout(25)
    host.wait_for_timeout(2500)
    host_seat_on_guest = guest.locator("[data-testid=seat-host]").inner_text()
    check("the guest sees the host's time the moment it is in",
          any(ch.isdigit() for ch in host_seat_on_guest) and "." in host_seat_on_guest, host_seat_on_guest.replace("\n", " | "))

    # Slower on purpose. A race is decided by SOLVE time — inspection is not
    # counted, as in competition — so finishing first on the screen is not the
    # same as winning, and the first version of this suite assumed it was: the
    # guest started later, solved faster than the host's paused solve, and won.
    solve(guest, guest_scramble, 220)
    guest.locator("[data-testid=race-result]").wait_for(timeout=30_000)
    host.locator("[data-testid=race-result]").wait_for(timeout=30_000)
    host_says = host.locator("[data-testid=race-result]").inner_text()
    guest_says = guest.locator("[data-testid=race-result]").inner_text()
    check("the faster solver is told they won", "You won" in host_says, host_says.split("\n")[0])
    check("and the other that they lost", "You lost" in guest_says, guest_says.split("\n")[0])

    print("\n== rematch ==")
    guest.click("[data-testid=race-result] >> button")
    guest.wait_for_url(lambda u: code not in u and "/race/" in u, timeout=20_000)
    new_code = guest.url.rsplit("/", 1)[-1]
    host.locator("button:has-text('Join the rematch')").wait_for(timeout=20_000)
    host.click("button:has-text('Join the rematch')")
    host.wait_for_url(f"**/race/{new_code}", timeout=20_000)
    check("both players land in the same new race", host.url.endswith(new_code) and guest.url.endswith(new_code), new_code)
    host.locator("[data-testid=race-ready]").wait_for(timeout=20_000)
    check("already seated, no link to send", host.locator("[data-testid=race-link]").count() == 0)

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:160])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
