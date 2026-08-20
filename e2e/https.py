"""The https-only half of authentication, which plain http can never reach.

    npm run e2e:https

Two things exist only over TLS, and both fail SILENTLY when they are wrong:

  * **The `__Host-` cookie prefix.** A browser refuses the cookie outright
    unless it is Secure, carries no Domain, and is pathed at `/`. A refused
    cookie is not an error anywhere — the response simply arrives with no
    session, so every visitor appears signed out forever and nothing in any log
    says why.

    This is not hypothetical. Changing the path to `/settings` and rebuilding
    makes the browser discard the cookie entirely: this suite goes from twelve
    passes to reporting no cookies at all. That is the mutation that earns the
    suite its place.

  * **The relying party id.** Over http it is always `localhost`, so nothing
    can catch a value that wrongly carries a scheme or a port — which produces
    passkeys that no ceremony can ever verify, on real hardware only.

The certificate is self-signed and the browser is told to ignore the trust
error. The origin is still https, so the page is a secure context and every
cookie rule applies exactly as it would in production.
"""
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email  # noqa: E402

BASE = os.environ.get("TLS_BASE", "https://localhost:3443")
EMAIL = probe_email("tls-probe")
fails = 0

def check(label, ok, detail=""):
    global fails
    if not ok: fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # The cert is self-signed; the origin is still https, so the page is a
    # secure context and cookie rules apply exactly as in production.
    ctx = browser.new_context(base_url=BASE, ignore_https_errors=True)
    page = ctx.new_page()

    client = ctx.new_cdp_session(page)
    client.send("WebAuthn.enable")
    auth_id = client.send("WebAuthn.addVirtualAuthenticator", {"options": {
        "protocol": "ctap2", "transport": "internal", "hasResidentKey": True,
        "hasUserVerification": True, "isUserVerified": True,
        "automaticPresenceSimulation": True}})["authenticatorId"]

    print("\n== the __Host- cookie the browser actually kept ==")
    page.goto("/join", wait_until="domcontentloaded")
    page.wait_for_selector("#email", timeout=20_000)
    page.fill("#email", EMAIL)
    page.click("button[type=submit]")
    page.wait_for_selector("text=Add a passkey", timeout=25_000)

    names = {c["name"]: c for c in ctx.cookies()}
    check("a session cookie survived", any("cubeduel_session" in n for n in names), ", ".join(names) or "none")

    host_cookie = names.get("__Host-cubeduel_session")
    check("it carries the __Host- prefix over https", host_cookie is not None,
          "got: " + (", ".join(names) or "no cookies"))
    check("the insecure name is NOT used here", "cubeduel_session" not in names)

    if host_cookie:
        # The three rules the browser enforces for the prefix. If our code broke
        # any of them the cookie would simply not be in this list at all, so
        # these are belt and braces on top of the check above.
        check("...Secure", host_cookie.get("secure") is True)
        check("...pathed at /", host_cookie.get("path") == "/", str(host_cookie.get("path")))
        check("...httpOnly", host_cookie.get("httpOnly") is True)
        check("...and script cannot see it",
              "cubeduel_session" not in page.evaluate("() => document.cookie"))

    print("\n== a passkey bound to an https origin ==")
    page.click("text=Add a passkey")
    page.wait_for_url("**/progress", timeout=25_000)
    creds = client.send("WebAuthn.getCredentials", {"authenticatorId": auth_id})["credentials"]
    check("the passkey registered", len(creds) == 1, f"{len(creds)}")
    check("...bound to this host, not to a URL", creds and creds[0]["rpId"] == "localhost",
          creds[0]["rpId"] if creds else "none")

    print("\n== and it signs back in ==")
    page.evaluate("async () => { await fetch('/api/auth/sign-out', {method:'POST'}) }")
    # `domcontentloaded`, not `networkidle`: through a self-signed TLS proxy the
    # idle heuristic never settles even though every request fires exactly once
    # (checked, rather than assumed).
    page.goto("/sign-in", wait_until="domcontentloaded")
    page.wait_for_selector("text=Sign in with a passkey", timeout=20_000)
    page.click("text=Sign in with a passkey")
    try:
        page.wait_for_url("**/progress", timeout=25_000)
    except Exception:
        pass
    check("signed in over https with nothing typed", "/progress" in page.url, page.url)

    after = {c["name"] for c in ctx.cookies()}
    check("the new session is also a __Host- cookie", "__Host-cubeduel_session" in after,
          ", ".join(after) or "none")

    browser.close()

delete_account(EMAIL)
print("\nAll checks passed." if fails == 0 else f"\nFAILURES: {fails}")
sys.exit(0 if fails == 0 else 1)
