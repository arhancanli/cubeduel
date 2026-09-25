"""
The timer times 2x2 to 5x5, and a big-cube time never passes for a 3x3.

Driven the way a person does it: pick the puzzle, hold space, solve, and — on
a big cube with splits on — tap space as the centres, then the edges, are done.
Checks the scramble and the drawn cube are that puzzle's, that each puzzle
keeps its own session, that the review reads a 4x4 in its own phases against
4x4 solves only, and that a synced 4x4 solve reaches the account as a 4x4 —
the server used to store every synced solve as a 3x3.

    BASE=http://localhost:3000 python3 e2e/puzzles.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

sys.path.insert(0, os.path.dirname(__file__))
from account import probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def scramble_text(page):
    return " ".join(page.locator("section .font-mono span").all_inner_texts())


def wait_scramble(page, previous=""):
    for _ in range(60):
        text = scramble_text(page)
        if text and text != previous:
            return text
        page.wait_for_timeout(250)
    return scramble_text(page)


def time_solve(page, phase_ms):
    page.keyboard.down("Space")
    page.wait_for_timeout(450)
    page.keyboard.up("Space")
    for ms in phase_ms:
        page.wait_for_timeout(ms)
        page.keyboard.press("Space")
    page.wait_for_timeout(900)


def recent_count(page):
    return page.get_by_test_id("recent-solve").count()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/timer", wait_until="load")
    page.wait_for_timeout(1500)
    email = probe_email("puzzles")
    sign_up(page, email)
    page.goto(BASE + "/timer", wait_until="load")
    page.wait_for_timeout(1500)

    print("\n== a 3x3 first ==")
    first = wait_scramble(page)
    time_solve(page, [1200])
    check("a 3x3 solve is recorded", recent_count(page) == 1, str(recent_count(page)))

    print("\n== switching to 4x4 ==")
    page.get_by_role("radio", name="4×4").click()
    # Wait for a 4x4 scramble specifically: the 3x3 solve above brings a fresh
    # 3x3 scramble, and "anything but the first one" can catch that instead.
    four = ""
    for _ in range(80):
        four = scramble_text(page)
        if len(four.split()) >= 35:
            break
        page.wait_for_timeout(250)
    moves = four.split()
    check("a 4x4 scramble: long, with wide turns", len(moves) >= 35 and any("w" in m for m in moves),
          f"{len(moves)} moves")
    page.wait_for_timeout(1500)
    check("the cube drawn is a 4x4",
          page.locator("twisty-player").first.get_attribute("data-puzzle") == "4x4x4")
    check("the 4x4 session starts empty — no 3x3 time in its average", recent_count(page) == 0,
          str(recent_count(page)))

    print("\n== 4x4 phase splits ==")
    page.get_by_role("button", name="Record phase splits").click()
    page.wait_for_timeout(300)
    labels = page.locator("div.uppercase.tracking-widest span").all_inner_texts()
    check("the phases are a big cube's", [l.strip().lower() for l in labels] == ["centres", "edges", "3x3"],
          str(labels))
    # Real 4x4 times: anything under five seconds is refused as a mis-tap, since
    # no 4x4 has ever been solved that fast.
    for _ in range(5):
        time_solve(page, [2000, 1800, 1800])
    time_solve(page, [2000, 3900, 1800])
    check("six 4x4 solves in the 4x4 session", recent_count(page) == 6, str(recent_count(page)))

    page.get_by_role("link", name="review →").click()
    page.wait_for_selector("[data-testid=timer-phases]", timeout=15000)
    phases = [t.split("\n")[0].strip() for t in page.get_by_test_id("timer-phase").all_inner_texts()]
    check("the review reads it in its own phases", phases == ["Centres", "Edges", "3x3"], str(phases))
    summary = page.get_by_test_id("timer-phases-summary").inner_text()
    check("and names the slow one", summary.startswith("Edges cost you this solve"), summary)
    check("no 3x3 cross is offered for a 4x4", page.get_by_test_id("timer-cross").count() == 0)
    check("the page says which puzzle", "4×4" in page.inner_text("main"))

    print("\n== back to 3x3 ==")
    page.goto(BASE + "/timer", wait_until="load")
    page.wait_for_timeout(1500)
    check("the timer remembers the puzzle", page.get_by_role("radio", name="4×4").get_attribute("aria-checked") == "true")
    page.get_by_role("radio", name="3×3").click()
    page.wait_for_timeout(1000)
    check("the 3x3 session is as it was", recent_count(page) == 1, str(recent_count(page)))

    print("\n== 2x2 ==")
    page.get_by_role("radio", name="2×2").click()
    page.wait_for_timeout(2000)
    check("the cube drawn is a 2x2",
          page.locator("twisty-player").first.get_attribute("data-puzzle") == "2x2x2")
    check("no splits offered on a 2x2", page.get_by_role("button", name="Record phase splits").count() == 0
          and page.get_by_role("button", name="Phase splits on — space ends each phase").count() == 0)

    print("\n== the practice calendar counts every puzzle ==")
    page.goto(BASE + "/progress", wait_until="load")
    page.wait_for_selector("[data-testid=practice-calendar]", timeout=15000)
    summary = page.get_by_test_id("practice-summary").inner_text()
    check("seven solves on one day, 3x3 and 4x4 together", summary.startswith("1 day of practice · 7 solves"), summary)
    today = page.locator("[data-testid=practice-calendar] li.ring-1")
    check("today's square says so", today.count() == 1 and today.get_attribute("aria-label").endswith(": 7 solves"),
          today.get_attribute("aria-label") if today.count() else "none")
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("the calendar fits the page", overflow <= 1, f"{overflow}px")

    print("\n== synced to the account as a 4x4 ==")
    # Sync runs once a signed-in page has loaded; give it time to finish.
    page.goto(BASE + "/", wait_until="load")
    page.wait_for_timeout(6000)
    handle = page.evaluate("async () => (await (await fetch('/api/auth/session')).json()).handle")
    page.goto(f"{BASE}/u/{handle}", wait_until="load")
    page.wait_for_timeout(1000)
    body = page.inner_text("main")
    check("the profile lists 4x4 practice solves as 4x4", body.count("4×4 · practice") == 6,
          f"{body.count('4×4 · practice')} labelled")
    # Six 4x4 stopwatch solves of 5-10s: under the fastest 4x4 barrier as a
    # single and an ao5, and not enough for an ao12. The profile says so, and
    # says they are a stopwatch's word, not replayed.
    four = page.locator("[data-testid=profile-milestones] > div > div", has_text="4×4")
    single = four.locator("li[data-kind=single] a")
    check("the profile shows the 4x4's fastest barrier as a single", single.count() == 1 and "Sub-40" in single.inner_text(),
          single.inner_text().replace("\n", " ") if single.count() else "none")
    check("and as an ao5", four.locator("li[data-kind=ao5] a").count() == 1)
    check("no ao12 from six solves", "none yet" in four.locator("li[data-kind=ao12]").inner_text() if four.count() else False)
    check("a stopwatch time is labelled self-timed, not verified",
          single.count() == 1 and single.locator("[data-proof]").get_attribute("data-proof") == "self-timed")
    check("the milestone links to the solve that earned it",
          single.count() == 1 and (single.get_attribute("href") or "").startswith("/s/"))

    print("\n== console ==")
    check("no page errors", len(errors) == 0, "; ".join(errors[:2])[:200])
    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
