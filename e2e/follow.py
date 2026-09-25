"""
Following another player, end to end, with two real accounts.

Bea posts today's daily. Ada finds her profile, follows her, and the count and
the button say so — and still do after a reload, because they came from the
server. Ada's leaderboard now has a section with the two of them. Ada plays the
daily and, on her result, sees Bea's time beside her own. Then she unfollows,
and all of it goes away again.

    BASE=http://localhost:3000 python3 e2e/follow.py
"""

import os
import re
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def handle_of(page):
    return page.evaluate("async () => (await (await fetch('/api/auth/session')).json()).handle")


def play_daily_by_hand(page, run_ms):
    page.goto(BASE + "/daily", wait_until="networkidle")
    page.wait_for_timeout(1200)
    page.click("button:has-text('Solve with my cube')")
    page.wait_for_timeout(4000)
    page.keyboard.down("Space")
    page.wait_for_timeout(450)
    page.keyboard.up("Space")
    page.wait_for_timeout(run_ms)
    page.keyboard.press("KeyJ")
    page.wait_for_timeout(2500)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    bea_ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
    bea = bea_ctx.new_page()
    bea.on("pageerror", lambda e: errors.append(str(e)))
    bea.goto(BASE + "/", wait_until="load")
    sign_up(bea, probe_email("follow-bea"))
    bea.goto(BASE + "/settings", wait_until="load")
    bea.wait_for_timeout(1500)
    bea_handle = handle_of(bea)
    check("Bea has a handle", bool(bea_handle), str(bea_handle))

    print("\n== Bea plays today's daily ==")
    play_daily_by_hand(bea, 1800)
    check("her result is on screen", "Share result" in bea.inner_text("body"))
    check("she follows nobody, so there is no following panel",
          bea.locator("[data-testid=following-daily]").count() == 0)

    ada_ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
    ada = ada_ctx.new_page()
    ada.on("pageerror", lambda e: errors.append(str(e)))
    ada.goto(BASE + "/", wait_until="load")
    sign_up(ada, probe_email("follow-ada"))
    ada.goto(BASE + "/settings", wait_until="load")
    ada.wait_for_timeout(1500)
    ada_handle = handle_of(ada)

    print("\n== a signed-out visitor ==")
    anon = browser.new_page()
    anon.goto(f"{BASE}/u/{bea_handle}", wait_until="networkidle")
    follow_link = anon.locator("[data-testid=follow] a:has-text('Follow')")
    check("sees Follow, and it asks them to sign in first",
          follow_link.count() == 1 and follow_link.get_attribute("href") == f"/sign-in?next=/u/{bea_handle}")
    anon.close()

    print("\n== Ada follows Bea ==")
    ada.goto(f"{BASE}/u/{bea_handle}", wait_until="networkidle")
    button = ada.locator("[data-testid=follow] button")
    followers = ada.locator("[data-testid=followers]")
    check("a Follow button, and no followers yet", button.inner_text() == "Follow" and followers.inner_text() == "0")
    button.click()
    ada.wait_for_timeout(1200)
    check("after the tap it says Following, and one follower",
          button.inner_text() == "Following" and button.get_attribute("aria-pressed") == "true" and followers.inner_text() == "1",
          f"{button.inner_text()} / {followers.inner_text()}")
    ada.reload(wait_until="networkidle")
    check("and so it does after a reload — it came from the server",
          ada.locator("[data-testid=follow] button").inner_text() == "Following"
          and ada.locator("[data-testid=followers]").inner_text() == "1")

    ada.goto(f"{BASE}/u/{ada_handle}", wait_until="networkidle")
    own = ada.inner_text("main")
    check("her own profile has no Follow button, and says she follows one",
          ada.locator("[data-testid=follow]").count() == 0 and re.search(r"0\s+followers\s*·\s*1\s+following", own) is not None)

    print("\n== the leaderboard ==")
    ada.goto(BASE + "/leaderboard", wait_until="networkidle")
    circle = ada.locator("[data-testid=following-board]")
    check("a section for her and who she follows", circle.count() == 1)
    rows = circle.locator("li").all_inner_texts() if circle.count() else []
    check("both of them, Ada marked as you", len(rows) == 2 and any("you" in r for r in rows) and any(bea_handle in r for r in rows),
          " | ".join(r.replace("\n", " ") for r in rows))
    check("with no ratings yet, both say unrated", all("unrated" in r for r in rows))

    print("\n== Ada plays the daily ==")
    play_daily_by_hand(ada, 2600)
    panel = ada.locator("[data-testid=following-daily]")
    panel.wait_for(timeout=10000)
    items = panel.locator("li").all_inner_texts()
    check("her result shows the people she follows who played", len(items) == 2, " | ".join(i.replace("\n", " ") for i in items))
    check("Bea's quicker time first, then hers as You",
          len(items) == 2 and bea_handle not in items[1] and "You" in items[1],
          " | ".join(i.replace("\n", " ") for i in items))
    check("hand-timed results say so", all("self-timed" in i for i in items))

    print("\n== Ada unfollows ==")
    ada.goto(f"{BASE}/u/{bea_handle}", wait_until="networkidle")
    ada.locator("[data-testid=follow] button").click()
    ada.wait_for_timeout(1200)
    check("back to Follow, no followers",
          ada.locator("[data-testid=follow] button").inner_text() == "Follow"
          and ada.locator("[data-testid=followers]").inner_text() == "0")
    ada.goto(BASE + "/leaderboard", wait_until="networkidle")
    check("the section is gone, and a line says how to fill it",
          ada.locator("[data-testid=following-board]").count() == 0 and ada.locator("[data-testid=follow-hint]").count() == 1)
    ada.goto(BASE + "/daily", wait_until="networkidle")
    ada.wait_for_timeout(2500)
    check("and her daily result no longer lists anybody", ada.locator("[data-testid=following-daily]").count() == 0)

    print("\n== a phone ==")
    ada.set_viewport_size({"width": 390, "height": 844})
    ada.goto(f"{BASE}/u/{bea_handle}", wait_until="networkidle")
    width = ada.evaluate("() => document.documentElement.scrollWidth")
    check("the profile with its Follow button fits a phone", width <= 390, str(width))

    check("no page errors", not errors, "; ".join(errors[:2]))
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
