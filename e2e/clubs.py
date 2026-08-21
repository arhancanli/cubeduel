"""Starting a club, sharing the code, and the board two people end up on.

    python3 e2e/clubs.py

This is the one feature where one person joining brings twenty, so the check
that matters is the whole loop through two independent browser sessions: a
captain creates a club and gets a code, a second cuber pastes that code, and
both then see the same board.

The board itself has one rule worth more than the rest: a member with no
established rating is LISTED, without a number and without a position. A board
that showed only the rated would greet a beginner on the day they join with a
list they are not on, which is exactly the person a club exists to keep.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
CAPTAIN = probe_email("club-captain")
MEMBER = probe_email("club-member")
SLUG = f"e2e-club-{os.getpid()}"

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # Two contexts, so the two cubers share no cookies and no session.
    captain_ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 900})
    member_ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 900})
    captain = captain_ctx.new_page()
    member = member_ctx.new_page()
    for page in (captain, member):
        page.on("pageerror", lambda e: print("  PAGEERROR:", str(e)[:140]))

    print("\n== the clubs page works signed out ==")
    captain.goto("/clubs", wait_until="domcontentloaded")
    captain.wait_for_timeout(2500)
    body = captain.inner_text("body").lower()
    check("it explains what a club is without demanding an account",
          "club" in body and ("account" in body or "sign" in body))
    check("it does not promise club-only scoring",
          "same verified solves" in body or "same ladder" in body, body[:100])

    print("\n== a captain starts a club ==")
    captain.goto("/join", wait_until="domcontentloaded")
    captain.wait_for_selector("#email", timeout=20_000)
    sign_up(captain, CAPTAIN)

    captain.goto("/clubs", wait_until="domcontentloaded")
    captain.wait_for_selector("#club-name", timeout=20_000)
    captain.fill("#club-name", "E2E Cubing Club")

    derived = captain.input_value("#club-slug")
    check("an address is suggested from the name", derived == "e2e-cubing-club", derived)

    # Overridden, because the suggestion must be editable — it is permanent.
    captain.fill("#club-slug", SLUG)
    captain.click('button:has-text("Create club")')
    captain.wait_for_url(f"**/c/{SLUG}", timeout=20_000)
    check("the captain lands on the club page", SLUG in captain.url, captain.url)

    page_text = captain.inner_text("body")
    check("the club is named on it", "E2E Cubing Club" in page_text)
    check("the captain is shown as owner", "owner" in page_text.lower())

    code_match = re.search(r"\b[a-hjkmnp-z2-9]{8}\b", page_text)
    check("an invite code is shown to a member", bool(code_match),
          code_match.group(0) if code_match else page_text[:120])
    code = code_match.group(0) if code_match else None

    print("\n== the page is public, and the code is not ==")
    stranger = browser.new_context(base_url=BASE)
    stranger_page = stranger.new_page()
    stranger_page.goto(f"/c/{SLUG}", wait_until="domcontentloaded")
    stranger_page.wait_for_timeout(2500)
    stranger_text = stranger_page.inner_text("body")
    check("a signed-out visitor can read the board", "E2E Cubing Club" in stranger_text)
    check("...and is not shown the invite code",
          code is None or code not in stranger_text,
          "code leaked to a non-member" if code and code in stranger_text else "")
    stranger.close()

    print("\n== a second cuber joins with the code ==")
    if code:
        member.goto("/join", wait_until="domcontentloaded")
        member.wait_for_selector("#email", timeout=20_000)
        sign_up(member, MEMBER)

        member.goto("/clubs", wait_until="domcontentloaded")
        member.wait_for_selector("#code", timeout=20_000)
        # Typed the way somebody actually pastes it, out of a group chat.
        member.fill("#code", f"  {code.upper()}  ")
        # Scoped to the button. `text=Join` also matches the "Join with a code"
        # heading — which Tailwind renders uppercase, so it does not even look
        # like a match when reading the source.
        member.click('button:has-text("Join")')
        member.wait_for_url(f"**/c/{SLUG}", timeout=20_000)
        check("the second cuber lands on the same club", SLUG in member.url, member.url)

        print("\n== both are on the same board ==")
        captain.reload(wait_until="domcontentloaded")
        captain.wait_for_timeout(3000)
        after = captain.inner_text("body")
        check("the board now says two members", "2 member" in after, after[:0] or "")
        check("both cubers are listed even though neither is rated",
              after.lower().count("not rated yet") > 0)
        check("...and nobody is shown a rating of zero", " 0\n" not in after and "0\n0" not in after)

    print("\n== the club appears in the captain's list ==")
    captain.goto("/clubs", wait_until="domcontentloaded")
    captain.wait_for_timeout(2500)
    mine = captain.inner_text("body")
    check("their club is listed", "E2E Cubing Club" in mine)

    browser.close()

for email in (CAPTAIN, MEMBER):
    delete_account(email)

print("\nAll checks passed." if fails == 0 else f"\nFAILURES: {fails}")
sys.exit(0 if fails == 0 else 1)
