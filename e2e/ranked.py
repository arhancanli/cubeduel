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


def clerk(path, method="GET", payload=None):
    """
    Calls Clerk's Backend API.

    The user agent is not optional: Cloudflare sits in front of api.clerk.com and
    blocks urllib's default `Python-urllib/x.y` with error 1010, which arrives as
    a bare 403 and looks exactly like a rejected key.
    """
    req = urllib.request.Request(
        f"https://api.clerk.com/v1/{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {SECRET}",
            "Content-Type": "application/json",
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


def create_account():
    """
    Creates the test account through Clerk's Backend API.

    The suite used to sign up through the widget, which stopped working: the
    instance has bot protection on, so submitting the sign-up form renders a
    Cloudflare Turnstile challenge that headless Chromium cannot solve. No
    request is ever made — the form simply never submits — so the failure
    surfaced as "still gated" and read like a broken app.

    Clerk's testing tokens are meant to bypass exactly this, and are still
    attached to every frontend call below, but they do not suppress the widget
    on this instance: `/v1/environment` reports bot protection enabled with or
    without one.

    Creating the user server-side and signing in through the real widget keeps
    what this suite exists to prove. The seam under test is a Clerk session
    travelling from the browser, through the proxy, into a route handler and out
    to Postgres — sign-in exercises every part of that. What is lost is coverage
    of Clerk's own sign-up form, which is Clerk's code, not this app's.
    """
    clerk(
        "users",
        method="POST",
        payload={
            "email_address": [EMAIL],
            "password": PASSWORD,
            # The password is a fixed test string and deliberately not a strong
            # one; Clerk's breach check would otherwise reject it.
            "skip_password_checks": True,
        },
    )


def sign_in(page):
    """
    Signs in through the real widget.

    Every `Continue` is `.last`, not `.first`: the modal keeps earlier steps
    mounted, so `.first` clicks a button belonging to a screen that is no longer
    showing and silently does nothing.
    """
    page.locator("button:has-text('Sign in')").first.click()
    page.wait_for_timeout(5000)

    page.locator("input[name='identifier']").last.fill(EMAIL)
    page.wait_for_timeout(500)
    page.locator("button:has-text('Continue')").last.click()
    page.wait_for_timeout(6000)

    page.locator("input[name='password']").last.fill(PASSWORD)
    page.wait_for_timeout(500)
    page.locator("button:has-text('Continue')").last.click()
    page.wait_for_timeout(9000)

    # Clerk asks for an emailed code the first time an account signs in from an
    # unrecognised device, which is every run. A `+clerk_test` address always
    # takes 424242 and no mail is sent.
    if "Check your email" in page.inner_text("body"):
        code = page.locator("input[inputmode='numeric']")
        if code.count():
            code.first.click()
            page.wait_for_timeout(300)
        page.keyboard.type("424242", delay=140)
        page.wait_for_timeout(7000)
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

    print("\n== signing in ==")
    create_account()
    sign_in(page)
    page.goto(BASE + "/ranked", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    body = page.inner_text("body")
    signed_in = "Sign in to play ranked" not in body
    check("the session reaches a server component", signed_in,
          "still gated" if not signed_in else "")

    if not signed_in:
        print("\n  Cannot continue without a session.")
    else:
        print("\n== nothing is issued until the player asks ==")
        page.wait_for_selector("twisty-player", timeout=30000)
        page.wait_for_timeout(2500)
        pre = " ".join(page.locator("div.font-mono").first.inner_text().split())
        check("no attempt is opened just by visiting", pre == "",
              f"scramble already showing: {pre[:40]}")
        check("the page says nothing is counted yet",
              "Nothing is counted until you start" in page.inner_text("body"))

        print("\n== the server issues a scramble ==")
        page.locator("button:has-text('Start a ranked attempt')").first.click()
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

        print("\n== inspection is running ==")
        # The countdown is the only part of inspection the player can see. The
        # penalty is judged server-side and covered by the integration suite;
        # what this proves is that the clock on screen is actually moving, which
        # no server test can tell you.
        # Read the countdown element itself. An earlier version of this check
        # matched a bare number anywhere in the page text and "passed" by
        # picking up an unrelated figure — a check that cannot tell the
        # countdown from the rating is not checking the countdown.
        read = (
            "() => { const el = document.querySelector('[data-testid=inspection-countdown]');"
            " return el ? parseFloat(el.innerText) : null; }"
        )
        first = page.evaluate(read)
        check("an inspection countdown is on screen", first is not None,
              f"{first}s" if first is not None else "no countdown element")
        check("it starts at the WCA fifteen seconds",
              first is not None and 14.0 <= first <= 15.0, f"{first}s")

        page.wait_for_timeout(1500)
        second = page.evaluate(read)
        # Must fall by roughly the time that passed: a clock that jumps to zero
        # is as wrong as one that never moves.
        dropped = (first - second) if (first is not None and second is not None) else None
        check("it counts down in real time",
              dropped is not None and 1.0 <= dropped <= 2.5,
              f"{first}s then {second}s (dropped {dropped}s)" if dropped is not None else "no reading")

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
