"""Throwaway accounts for the browser suites.

Replaces about a hundred and fifty lines of Clerk machinery that every
signed-in suite carried a copy of: fetching a testing token so a headless
browser could get past Cloudflare Turnstile, creating a user through the
Backend API because the sign-up widget could not be driven, signing in through
the real widget anyway so the session was genuine, and typing the fixed
verification code 424242 into an emailed-device-check step that fired on every
run.

None of that is needed now. Signing up is one POST to this application's own
endpoint, and the session cookie comes back on the response. The suites got
shorter and, more importantly, they no longer depend on a third party's bot
protection continuing to behave the way it did the day they were written —
which it did not: the widget stopped being drivable headlessly partway through
a session, and it read exactly like the app being broken.

Addresses end in `@cubeduel.test`, a reserved TLD that cannot resolve, so
nothing here can mail a real person however wrong the configuration is.
"""

import os
import time
import urllib.parse
import urllib.request

PROBE_DOMAIN = "cubeduel.test"


def env(name):
    """Reads a key out of .env.local so the suites need no extra setup."""
    if os.environ.get(name):
        return os.environ[name]
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        with open(path) as handle:
            for line in handle:
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        return None
    return None


def probe_email(label):
    return f"{label}-{int(time.time() * 1000)}@{PROBE_DOMAIN}"


def sign_up(page, email, password=None):
    """Creates an account and leaves the browser signed in.

    Runs the fetch inside the page rather than from Python, because the point is
    for the browser to hold the session cookie afterwards. A request made from
    the test process would create the account and leave the browser signed out —
    which is a mistake that reads as the endpoint being broken.
    """
    body = {"email": email}
    if password:
        body["password"] = password

    result = page.evaluate(
        """async (body) => {
            const response = await fetch('/api/auth/sign-up', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.text() };
        }""",
        body,
    )
    if result["status"] != 200:
        raise RuntimeError(f"sign-up failed ({result['status']}): {result['body'][:200]}")
    return email


def sign_out(page):
    page.evaluate(
        "async () => { await fetch('/api/auth/sign-out', { method: 'POST' }) }"
    )


def delete_account(email):
    """Removes an account and, by cascade, everything hanging off it.

    One statement. `users` cascades to profiles, and profiles to solves, ratings,
    duels, challenges and rush runs — so deleting the profile instead would
    leave the account behind, and those accumulate where nothing shows them.
    """
    url = env("NEXT_PUBLIC_SUPABASE_URL")
    key = env("SUPABASE_SECRET_KEY")
    if not url or not key:
        return False

    request = urllib.request.Request(
        f"{url}/rest/v1/users?email=eq.{urllib.parse.quote(email)}",
        method="DELETE",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            # Cloudflare 403s urllib's default agent, which looks exactly like a
            # bad key if you do not know to expect it.
            "User-Agent": "Mozilla/5.0",
        },
    )
    try:
        urllib.request.urlopen(request)
        return True
    except Exception:  # noqa: BLE001 - cleanup must never fail a run
        return False


def delete_all_probes():
    """Removes every probe account, for suites that made several."""
    url = env("NEXT_PUBLIC_SUPABASE_URL")
    key = env("SUPABASE_SECRET_KEY")
    if not url or not key:
        return False

    request = urllib.request.Request(
        f"{url}/rest/v1/users?email=like.*%40{PROBE_DOMAIN}",
        method="DELETE",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "User-Agent": "Mozilla/5.0",
        },
    )
    try:
        urllib.request.urlopen(request)
        return True
    except Exception:  # noqa: BLE001
        return False
