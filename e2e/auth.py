"""Sign-up, passkey registration and passkey sign-in, in a real browser.

    python3 e2e/auth.py

Drives Chromium's WebAuthn virtual authenticator over CDP, which is the same
mechanism Chrome's own tests use. That matters more than it sounds: every other
way of testing this stubs something out, and the parts that break in production
are the parts between the stub and the browser — the ArrayBuffer that
JSON.stringify turns into `{}`, the relying party id that carries a port it
should not, the origin that gains a trailing slash. A virtual authenticator
exercises all of them for real.

The unit tests already cover whether a ceremony verifies, against a software
authenticator of our own. This covers whether the *browser* can complete one
against this server.

Requires the dev server on :3000 and migrations 0007 and 0008. Cleans up the
account it creates.
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email  # noqa: E402

# BASE like every other suite. The default matters more here than anywhere: a
# passkey is bound to the origin the server was BUILT for (NEXT_PUBLIC_SITE_URL,
# http://localhost:3000 when unset), so this suite only passes against a server
# on that origin. CUBEDUEL_BASE is still read, for anything that set it.
BASE = os.environ.get("BASE") or os.environ.get("CUBEDUEL_BASE", "http://localhost:3000")
EMAIL = probe_email("e2e-passkey")

failures = 0


def check(label, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{f'  -> {detail}' if detail else ''}")


def cleanup():
    """Removes the account, using the shared reader that also looks in .env.local.

    This used to read `os.environ` alone and silently print "skipping cleanup"
    whenever the suite was run without the file sourced — which is how it is
    normally run. The accounts it left behind were invisible until somebody
    counted rows.
    """
    if not delete_account(EMAIL):
        print("  (cleanup failed)")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(base_url=BASE)
        page = context.new_page()

        # A virtual authenticator, configured the way a phone or a laptop's
        # secure enclave reports itself: resident keys (so the credential is
        # discoverable and sign-in needs no address) and user verification
        # already performed.
        client = context.new_cdp_session(page)
        client.send("WebAuthn.enable")
        authenticator = client.send(
            "WebAuthn.addVirtualAuthenticator",
            {
                "options": {
                    "protocol": "ctap2",
                    "transport": "internal",
                    "hasResidentKey": True,
                    "hasUserVerification": True,
                    "isUserVerified": True,
                    "automaticPresenceSimulation": True,
                }
            },
        )["authenticatorId"]

        print("\n== the claim screen ==")
        page.goto("/join")
        page.wait_for_load_state("networkidle")

        body = page.inner_text("body").lower()
        check("the page renders", "make an account" in body or "keep this" in body)
        check("it does not gate solving", "start cubing" in body or "you do not need" in body)

        print("\n== creating an account ==")
        page.fill("#email", EMAIL)
        page.click("button[type=submit]")

        # Waited for as a condition, never as a fixed delay. Sign-up makes four
        # round trips to a remote database, so any constant chosen here is
        # either too short on a bad connection or wasted time on a good one —
        # and a suite that flakes on latency gets its failures ignored.
        try:
            page.wait_for_selector("text=Add a passkey", timeout=20_000)
            appeared = True
        except Exception:  # noqa: BLE001
            appeared = False

        check(
            "the passkey step appears once the account exists",
            appeared,
            "" if appeared else page.inner_text("body")[:160],
        )

        print("\n== registering a passkey ==")
        page.click("text=Add a passkey")
        page.wait_for_url("**/progress", timeout=20_000)

        credentials = client.send(
            "WebAuthn.getCredentials", {"authenticatorId": authenticator}
        )["credentials"]
        check("the authenticator now holds a credential", len(credentials) == 1, f"{len(credentials)}")
        check(
            "...and it is discoverable, so sign-in needs no address",
            bool(credentials and credentials[0].get("isResidentCredential")),
        )
        check("the browser was sent to a signed-in page", "/progress" in page.url, page.url)

        print("\n== the session is real ==")
        cookies = {c["name"]: c for c in context.cookies()}
        session_cookie = cookies.get("cubeduel_session") or cookies.get("__Host-cubeduel_session")
        check("a session cookie was set", session_cookie is not None)
        if session_cookie:
            check("...and script cannot read it", session_cookie.get("httpOnly") is True)
            check("...and it is not sent cross-site on sub-requests", session_cookie.get("sameSite") == "Lax", str(session_cookie.get("sameSite")))
            check(
                "...and the token itself is not exposed to the page",
                page.evaluate("() => document.cookie").find("cubeduel_session") == -1,
            )

        print("\n== signing out ==")
        page.evaluate("async () => { await fetch('/api/auth/sign-out', { method: 'POST' }) }")
        page.goto("/sign-in")
        page.wait_for_load_state("networkidle")
        check("the sign-in page offers a passkey first", "passkey" in page.inner_text("body").lower())

        print("\n== signing back in with nothing typed ==")
        page.click("text=Sign in with a passkey")
        try:
            page.wait_for_url("**/progress", timeout=20_000)
        except Exception:  # noqa: BLE001
            pass
        check("the passkey signed us back in", "/progress" in page.url, page.url)

        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as cause:  # noqa: BLE001
        print(f"\nUNCAUGHT: {cause}")
        failures += 1
    finally:
        cleanup()
        print("\nAll checks passed." if failures == 0 else f"\nFAILURES: {failures}")
        sys.exit(0 if failures == 0 else 1)
