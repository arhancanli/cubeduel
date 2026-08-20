"""Losing your password and getting back in, through the real pages.

    python3 e2e/recovery.py

The server side of this was written and integration-tested days before any of
it was reachable: `/forgot`, `/reset` and `/verify` did not exist, so every
verification email sent people to a 404 and password reset was a feature that
existed only in a test. This suite is the check that the flow is *reachable*,
not merely correct.

The link is recovered the way a person would receive it — from what `email.ts`
logs when RESEND_API_KEY is unset — so the whole chain runs: issue the token,
store its hash, compose the message, put a working link in it, click it.
"""
import os
import re
import subprocess
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
EMAIL = probe_email("recovery")
FIRST = "the first fine password"
SECOND = "a different fine password"
DEV_LOG = os.environ.get("DEV_LOG", "/tmp/dev.log")

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def link_from_log(kind):
    """Pulls the newest /verify or /reset link out of the server log.

    Unconfigured mail writes the message to the log instead of sending it, which
    is what makes this flow walkable with no mail provider at all — and is why
    `email.ts` reports which of the two happened rather than returning a silent
    success.
    """
    try:
        text = open(DEV_LOG, encoding="utf-8", errors="ignore").read()
    except OSError:
        return None
    found = re.findall(rf"{re.escape(BASE)}/{kind}\?token=([A-Za-z0-9_-]+)", text)
    return found[-1] if found else None


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(base_url=BASE)
    page = ctx.new_page()

    print("\n== an account with a password ==")
    page.goto("/join", wait_until="domcontentloaded")
    page.wait_for_selector("#email", timeout=20_000)
    sign_up(page, EMAIL, FIRST)
    check("the account was created", True)

    print("\n== the verification link works ==")
    page.wait_for_timeout(3000)
    token = link_from_log("verify")
    check("a verification link was produced", bool(token))
    if token:
        page.goto(f"/verify?token={token}", wait_until="domcontentloaded")
        body = page.inner_text("body").lower()
        check("the address is confirmed", "confirmed" in body, body[:100])

        # The case a mail scanner causes on every real send.
        page.goto(f"/verify?token={token}", wait_until="domcontentloaded")
        again = page.inner_text("body").lower()
        check(
            "clicking a spent link still says confirmed, not 'invalid'",
            "confirmed" in again and "did not work" not in again,
            again[:100],
        )

    print("\n== asking for a reset ==")
    page.goto("/forgot", wait_until="domcontentloaded")
    page.fill("#email", EMAIL)
    page.click("button[type=submit]")
    page.wait_for_selector("text=Check your inbox", timeout=20_000)
    body = page.inner_text("body").lower()
    check("the confirmation is conditional, so it reveals nothing",
          "if that address has an account" in body, body[:120])

    page.wait_for_timeout(3000)
    reset = link_from_log("reset")
    check("a reset link was produced", bool(reset))

    print("\n== setting a new password ==")
    if reset:
        page.goto(f"/reset?token={reset}", wait_until="domcontentloaded")
        page.wait_for_selector("#password", timeout=20_000)

        # Refused before the token is spent, so a bad choice does not cost the link.
        page.fill("#password", "short")
        page.evaluate("() => document.querySelector('#password').setAttribute('minlength','1')")
        page.click("button[type=submit]")
        page.wait_for_timeout(2500)
        check("a weak password is refused", "role=alert" in page.content() or "characters" in page.inner_text("body").lower())

        page.fill("#password", SECOND)
        page.click("button[type=submit]")
        page.wait_for_selector("text=Password changed", timeout=20_000)
        check("the password was changed", True)

        print("\n== the new one works and the old one does not ==")
        for label, pw, expected in (("new", SECOND, 200), ("old", FIRST, 401)):
            status = page.evaluate(
                """async ([pw]) => {
                    const r = await fetch('/api/auth/sign-in', {
                        method: 'POST', headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ email: %r, password: pw }),
                    });
                    return r.status;
                }""" % EMAIL,
                [pw],
            )
            check(f"the {label} password returns {expected}", status == expected, str(status))

        print("\n== the link cannot be used twice ==")
        page.goto(f"/reset?token={reset}", wait_until="domcontentloaded")
        page.wait_for_selector("#password", timeout=20_000)
        page.fill("#password", "yet another fine password")
        page.click("button[type=submit]")
        page.wait_for_timeout(2500)
        text = page.inner_text("body").lower()
        check("a spent reset link is refused", "already been used" in text, text[:120])

    browser.close()

delete_account(EMAIL)
print("\nAll checks passed." if fails == 0 else f"\nFAILURES: {fails}")
sys.exit(0 if fails == 0 else 1)
