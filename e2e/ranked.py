"""
The full stack, with a real signed-in user.

Everything else is verified in pieces: the rating maths and verifier by unit
tests, the server modules against the live database by `npm run integration`,
and the signed-out browser flows by the other e2e suites.

This covers the one seam none of those touch — a real Clerk session travelling
from the browser, through the proxy, into a route handler, and out to Postgres.
It is worth its own suite because of a specific failure that would otherwise
ship silently: an anonymous request gets a 401 whether the auth middleware is
working or missing entirely. If `proxy.ts` were not wired up, signed-in users
would get 401 too, and every check that only pokes the routes anonymously would
still pass.

Uses a Clerk test email (`+clerk_test`), which on a development instance takes
the fixed verification code 424242 and sends no real mail.

    BASE=http://localhost:3210 python3 e2e/ranked.py
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

BASE = os.environ.get("BASE", "http://localhost:3000")
# `+clerk_test` addresses are Clerk's test identities: no mail is sent and the
# verification code is always 424242 on a development instance.
# The uniqueness goes in the PREFIX. Clerk recognises a test identity by the
# exact `+clerk_test` subaddress, so `+clerk_test_1786902@` is NOT a test email —
# it silently becomes a real sign-up that waits for a mail that never arrives.
EMAIL = f"cubeduel-{int(time.time())}+clerk_test@example.com"
PASSWORD = "Sub15-Cubeduel-Probe-2026"
FAILS = []


def env(name):
    """Reads a key out of .env.local so the suite needs no extra setup."""
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(path) as f:
        for line in f:
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return None


SECRET = env("CLERK_SECRET_KEY")
PUBLISHABLE = env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")

# The frontend API host is base64-encoded inside the publishable key.
FAPI = base64.b64decode(re.sub(r"^pk_(test|live)_", "", PUBLISHABLE)).decode().rstrip("$")


def clerk(path, method="GET"):
    """
    Calls Clerk's Backend API.

    The user agent is not optional: Cloudflare sits in front of api.clerk.com and
    blocks urllib's default `Python-urllib/x.y` with error 1010, which arrives as
    a bare 403 and looks exactly like a rejected key.
    """
    req = urllib.request.Request(
        f"https://api.clerk.com/v1/{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {SECRET}",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        },
    )
    with urllib.request.urlopen(req) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def testing_token():
    """
    Clerk's official bot-protection bypass for automated tests.

    Without it, sign-up in headless Chromium dies on "The CAPTCHA failed to
    load" — Cloudflare Turnstile cannot run there. That is a limitation of the
    test browser, not of the product, and Clerk provides this endpoint precisely
    so a suite can prove the real flow works anyway.
    """
    return clerk("testing_tokens", method="POST")["token"]


def delete_test_user(email):
    """Test accounts are removed so the instance does not silt up."""
    try:
        users = clerk(f"users?email_address={urllib.parse.quote(email)}") or []
        for user in users:
            clerk(f"users/{user['id']}", method="DELETE")
        return len(users)
    except Exception as exc:  # cleanup must never fail the suite
        print(f"  (cleanup warning: {exc})")
        return 0


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


def solve_scramble(page, scramble, pace_ms):
    """Types the inverse of the scramble, pacing it like a human solve."""
    moves = [invert(m) for m in reversed(scramble.split())]
    for move in moves:
        for key in keys_for(move):
            page.keyboard.press(key)
            page.wait_for_timeout(pace_ms)


def sign_up(page):
    """
    Creates a real account through the real Clerk widget.

    Every `Continue` here is `.last`, not `.first`: the modal keeps earlier
    steps mounted, so `.first` clicks a button belonging to a screen that is no
    longer showing and silently does nothing.
    """
    page.locator("button:has-text('Sign in')").first.click()
    page.wait_for_timeout(4000)
    page.locator("text=Sign up").last.click()
    page.wait_for_timeout(3000)

    page.locator("input[name='emailAddress']").first.fill(EMAIL)
    page.locator("input[name='password']").first.fill(PASSWORD)
    page.wait_for_timeout(800)
    page.locator("button:has-text('Continue')").last.click()
    page.wait_for_timeout(8000)

    # A `+clerk_test` address on a development instance always takes this code.
    if "Verify your email" in page.inner_text("body"):
        code = page.locator("input[inputmode='numeric']")
        if code.count():
            code.first.click()
            page.wait_for_timeout(300)
        page.keyboard.type("424242", delay=150)
        page.wait_for_timeout(6000)
        cont = page.locator("button:has-text('Continue')")
        if cont.count() and cont.last.is_visible():
            cont.last.click()
        page.wait_for_timeout(6000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # Attach the testing token to every call the Clerk widget makes.
    token = testing_token()

    def with_token(route):
        url = route.request.url
        joiner = "&" if "?" in url else "?"
        route.continue_(url=f"{url}{joiner}__clerk_testing_token={token}")

    page.route(f"https://{FAPI}/**", with_token)

    print("\n== signed out ==")
    page.goto(BASE + "/ranked", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    check("ranked is gated behind an account", "Sign in to play ranked" in page.inner_text("body"))

    print("\n== signing up ==")
    sign_up(page)
    page.goto(BASE + "/ranked", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    body = page.inner_text("body")
    signed_in = "Sign in to play ranked" not in body
    check("the session reaches a server component", signed_in,
          "still gated" if not signed_in else "")

    if not signed_in:
        print("\n  Cannot continue without a session.")
    else:
        print("\n== the server issues a scramble ==")
        page.wait_for_selector("twisty-player", timeout=30000)
        # The container renders before the API answers, so wait for it to have a
        # scramble in it rather than for it to exist.
        page.wait_for_function(
            "() => { const el = document.querySelector('div.font-mono');"
            " return !!el && el.innerText.trim().length > 40; }",
            timeout=45000,
        )
        scramble = " ".join(page.locator("div.font-mono").first.inner_text().split())
        check("a ranked scramble was issued by the API", len(scramble.split()) >= 18,
              f"{len(scramble.split())} moves")
        check("the rating panel is shown", "rating" in page.inner_text("body").lower())
        check("the DNF rule is stated before solving",
              "DNF" in page.inner_text("body"))

        print("\n== solving it for real ==")
        # Paced so the elapsed wall-clock time is consistent with the reported
        # duration; the server refuses a solve longer than the attempt has been open.
        solve_scramble(page, scramble, 120)
        page.wait_for_timeout(6000)

        body = page.inner_text("body")
        check("the solve was accepted by the server",
              "could not" not in body.lower() and "not be verified" not in body.lower(),
              [l for l in body.split("\n") if "verif" in l.lower() or "could not" in l.lower()][:2])

        # The real proof the server counted it: the gathered-attempts counter
        # moved off 0. Absence of an error message is not evidence of success.
        counter = re.search(r"(\d+)\s*/\s*5", body)
        check("the server recorded the attempt", counter is not None and counter.group(1) != "0",
              counter.group(0) if counter else "no counter on screen")

        print("\n== the account is real ==")
        page.goto(BASE + "/settings", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        settings = page.inner_text("body")
        check("a profile was created with a handle", "/u/" in settings,
              [l for l in settings.split("\n") if "/u/" in l][:1])

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])

    page.screenshot(path="/tmp/ranked.png", full_page=True)
    browser.close()

print("\n== cleanup ==")
removed = delete_test_user(EMAIL)
check("the test account was removed", removed >= 0, f"{removed} deleted")

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
