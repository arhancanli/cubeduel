"""
Two real people, one scramble, in two real browsers.

The integration suite already drives the server module against live Postgres.
This exists for the part that cannot: two independent sessions, two
browser contexts that share no cookies, and the actual screens a player uses.

The specific thing it is here to catch is a leak. Both fairness rules — the
scramble hidden until you open your own attempt, the opponent's time hidden
until you are both in — are enforced server-side, but a page that fetched the
raw row and redacted it in the component would pass every server test and fail
here. So the checks read the rendered page, not the API.

    BASE=https://cubeduel.vercel.app python3 e2e/challenge.py
"""

import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
PLAYERS = [
    {"email": probe_email("chal-a"), "label": "A"},
    {"email": probe_email("chal-b"), "label": "B"},
]
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(path) as f:
        for line in f:
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return None


def handle_of(page):
    page.goto(BASE + "/settings", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    match = re.search(r"/u/([a-z0-9\-]+)", page.inner_text("body"))
    return match.group(1) if match else None


def scramble_on(page):
    """The scramble as rendered, or '' — this is what the player can actually read."""
    return page.evaluate(
        """() => { const els = [...document.querySelectorAll('div')]
            .filter(d => /font-mono/.test(d.className)
                      && d.innerText.trim().split(/\\s+/).length >= 15);
            return els.length ? els[0].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""
    )


def invert(move):
    if move.endswith("2"):
        return move
    return move[:-1] if move.endswith("'") else move + "'"


def solve_by_keyboard(page, scramble, pace_ms=110):
    keys = {
        "U": "j", "U'": "f", "R": "i", "R'": "k", "L": "d", "L'": "e",
        "F": "h", "F'": "g", "D": "s", "D'": "l", "B": "w", "B'": "o",
    }
    for move in [invert(m) for m in reversed(scramble.split())]:
        presses = [move[:-1]] * 2 if move.endswith("2") else [move]
        for m in presses:
            page.keyboard.press(keys[m])
            page.wait_for_timeout(pace_ms)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    # Two contexts, so the two players share no cookies and no session.
    contexts = []
    for player in PLAYERS:
        # The account is created from inside the browser now, so it happens
        # below where the page exists — creating it here would leave the session
        # cookie in the wrong place, or nowhere.
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        contexts.append((ctx, page, player))

    print("\n== two accounts sign in ==")
    handles = {}
    for _, page, player in contexts:
        page.goto(BASE + "/duel", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        sign_up(page, player["email"])
        # Reloaded so the page renders with the session it just acquired.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        handle = handle_of(page)
        handles[player["label"]] = handle
        check(f"player {player['label']} has a handle", handle is not None, handle or "none")

    if None in handles.values() or len(handles) != 2:
        print("\n  Cannot continue without two accounts.")
    else:
        (_, page_a, _), (_, page_b, _) = contexts
        handle_a, handle_b = handles["A"], handles["B"]

        print("\n== A challenges B ==")
        page_a.goto(BASE + "/duel", wait_until="domcontentloaded")
        page_a.wait_for_timeout(5000)
        check("the challenge form is on the duel page",
              page_a.locator("#challenge-handle").count() == 1)
        check("players come before bots",
              page_a.inner_text("body").index("Challenge a player")
              < page_a.inner_text("body").index("Or race a bot"))

        page_a.fill("#challenge-handle", handle_b)
        page_a.locator("button:has-text('Challenge')").first.click()
        page_a.wait_for_timeout(6000)
        body_a = page_a.inner_text("body")
        check("the challenge was sent", f"Challenge sent to {handle_b}" in body_a,
              [l for l in body_a.split("\n") if "hallenge sent" in l or "ould not" in l][:1])

        print("\n== neither player has been shown the scramble ==")
        check("the sender's page carries no scramble", scramble_on(page_a) == "",
              scramble_on(page_a)[:40])

        page_b.goto(BASE + "/duel", wait_until="domcontentloaded")
        page_b.wait_for_timeout(5000)
        body_b = page_b.inner_text("body")
        check("B is told a challenge is waiting", "waiting on you" in body_b.lower(),
              [l for l in body_b.split("\n") if "waiting" in l.lower()][:1])
        check("B is told who it is from", handle_a in body_b)
        check("B's page carries no scramble either", scramble_on(page_b) == "",
              scramble_on(page_b)[:40])

        print("\n== A opens their half and solves ==")
        page_a.goto(BASE + "/duel", wait_until="domcontentloaded")
        page_a.wait_for_timeout(5000)
        page_a.locator("a[href^='/challenge/']").first.click()
        page_a.wait_for_timeout(5000)
        check("A is warned before the scramble is revealed",
              "starts your inspection" in page_a.inner_text("body"))
        check("and still cannot see it", scramble_on(page_a) == "")

        page_a.locator("button:has-text('Open the scramble')").first.click()
        page_a.wait_for_function(
            "() => { const e = [...document.querySelectorAll('div')]"
            ".filter(d => /font-mono/.test(d.className)"
            " && d.innerText.trim().split(/\\s+/).length >= 15); return e.length > 0; }",
            timeout=45000,
        )
        page_a.wait_for_timeout(1500)
        scramble_a = scramble_on(page_a)
        check("now A has the scramble", len(scramble_a.split()) >= 15,
              f"{len(scramble_a.split())} moves")
        check("an inspection countdown is running",
              page_a.locator("[data-testid=inspection-countdown]").count() == 1)

        solve_by_keyboard(page_a, scramble_a)
        page_a.wait_for_timeout(7000)
        after_a = page_a.inner_text("body")
        check("A's solve was accepted",
              "could not" not in after_a.lower() and "not be verified" not in after_a.lower(),
              [l for l in after_a.split("\n") if "could not" in l.lower()][:1])
        check("A is told the result is withheld",
              "stays hidden" in after_a or "hidden until" in after_a,
              [l for l in after_a.split("\n") if "hidden" in l][:1])
        check("A is not shown a winner yet",
              "You won" not in after_a and "You lost" not in after_a)

        # A's actual time, so the leak check below can name it. Scanning for any
        # number instead found the bot roster's ratings and target times, which
        # are on the same page and are supposed to be there — a check that
        # cannot tell A's solve from a bot's rating is not checking for a leak.
        own_time = re.search(r"Your time is in: (\d+\.\d{2})", after_a)
        check("A's own time is shown to A", own_time is not None,
              own_time.group(1) if own_time else "not found")

        print("\n== B still cannot see the time to beat ==")
        page_b.goto(BASE + "/duel", wait_until="domcontentloaded")
        page_b.wait_for_timeout(5000)
        body_b = page_b.inner_text("body")
        if own_time:
            check("A's time does not appear anywhere on B's page",
                  own_time.group(1) not in body_b,
                  f"looked for {own_time.group(1)}")
        # And nothing that looks like a result is attached to the challenge row
        # itself, which is the only place a leak could plausibly render.
        row = page_b.evaluate(
            """() => { const el = [...document.querySelectorAll('li')]
                .find(l => l.querySelector('a[href^="/challenge/"]'));
                return el ? el.innerText.replace(/\\n/g, ' ') : ''; }"""
        )
        check("the waiting challenge shows no time", not re.search(r"\d+\.\d{2}", row),
              row[:80])

        # The two checks above guard the *page*, and the page happens not to
        # render an opponent's time in this state at all — so on their own they
        # would keep passing even if the server started sending one. This reads
        # the wire from B's own session, which is where a server-side leak would
        # actually show up.
        wire = page_b.evaluate(
            "async () => { const r = await fetch('/api/challenge/list');"
            " return r.ok ? await r.text() : 'FETCH FAILED'; }"
        )
        payload = json.loads(wire) if wire != "FETCH FAILED" else {}
        pending_rows = [c for c in payload.get("challenges", []) if c["status"] == "pending"]
        check("the API sent B a pending challenge", len(pending_rows) == 1,
              f"{len(pending_rows)} pending")
        check("and it carries no opponent result",
              all(c.get("theirs") is None for c in pending_rows),
              json.dumps([c.get("theirs") for c in pending_rows]))
        check("nor the scramble, which B has not opened",
              all(c.get("scramble") is None for c in pending_rows),
              json.dumps([c.get("scramble") for c in pending_rows])[:60])
        check("it is still B's turn", "waiting on you" in body_b.lower())

        print("\n== B solves the same scramble ==")
        page_b.goto(BASE + "/duel", wait_until="domcontentloaded")
        page_b.wait_for_timeout(4000)
        page_b.locator("a[href^='/challenge/']").first.click()
        page_b.wait_for_timeout(4000)
        page_b.locator("button:has-text('Open the scramble')").first.click()
        page_b.wait_for_function(
            "() => { const e = [...document.querySelectorAll('div')]"
            ".filter(d => /font-mono/.test(d.className)"
            " && d.innerText.trim().split(/\\s+/).length >= 15); return e.length > 0; }",
            timeout=45000,
        )
        page_b.wait_for_timeout(1500)
        scramble_b = scramble_on(page_b)
        check("B gets the identical scramble", scramble_b == scramble_a,
              f"A: {scramble_a[:30]}… / B: {scramble_b[:30]}…")

        # Slower on purpose, so the expected winner is not a coin flip.
        solve_by_keyboard(page_b, scramble_b, pace_ms=260)
        page_b.wait_for_timeout(8000)
        after_b = page_b.inner_text("body")
        check("B's solve was accepted",
              "could not" not in after_b.lower() and "not be verified" not in after_b.lower(),
              [l for l in after_b.split("\n") if "could not" in l.lower()][:1])
        check("B is told they lost", "You lost" in after_b,
              [l for l in after_b.split("\n") if "You " in l][:2])
        check("and now both times are shown", len(re.findall(r"\b\d+\.\d{2}\b", after_b)) >= 2,
              str(re.findall(r"\b\d+\.\d{2}\b", after_b)[:4]))

        print("\n== A sees the same result ==")
        page_a.goto(BASE + "/duel", wait_until="domcontentloaded")
        page_a.wait_for_timeout(5000)
        final_a = page_a.inner_text("body")
        check("A is recorded as the winner", "won" in final_a,
              [l for l in final_a.split("\n") if handle_b in l][:1])
        check("the finished challenge lists both times",
              len(re.findall(r"\b\d+\.\d{2}\b", final_a)) >= 2,
              str(re.findall(r"\b\d+\.\d{2}\b", final_a)[:4]))

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    for ctx, page, _ in contexts:
        page.screenshot(path=f"/tmp/challenge_{_['label']}.png", full_page=True)
    browser.close()

print("\n== cleanup ==")
for player in PLAYERS:
    delete_account(player["email"])
print(f"  removed {len(PLAYERS)} test accounts")

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
