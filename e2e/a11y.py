"""
Accessibility checks across every page.

Not a substitute for a real audit, and it does not pretend to be — it checks the
structural things that are cheap to get right, easy to break silently, and that
no visual review catches: an icon button with no accessible name, an input with
no label, a heading order that jumps.

This app has a specific reason to care beyond the usual. The entire product is
driven from the keyboard, and its users are people who care a great deal about
whether a control responds the instant they press a key.

    BASE=http://localhost:3000 python3 e2e/a11y.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")
PAGES = ["/", "/play", "/daily", "/train", "/timer", "/progress", "/review", "/solver", "/learn/f2l", "/notation", "/leaderboard", "/ranked", "/duel"]
FAILS = []


def check(label, cond, detail=""):
    if not cond:
        FAILS.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})

    print("\n== document level ==")
    page.goto(BASE + "/", wait_until="load")
    page.wait_for_timeout(2000)
    check("the document declares a language", page.get_attribute("html", "lang") == "en")
    check("there is a main landmark", page.locator("main").count() >= 1)

    for path in PAGES:
        print(f"\n== {path} ==")
        page.goto(BASE + path, wait_until="load")
        page.wait_for_timeout(2500)

        # Exactly one, not "at most one". The first version of this check allowed
        # zero and passed on six pages that had no heading at all — a page with
        # no h1 leaves assistive tech with no title for it.
        h1s = page.locator("h1").count()
        check(f"{path}: exactly one h1", h1s == 1, f"{h1s} found")

        # Every interactive control needs a name. An icon-only button is
        # invisible to anyone not looking at it.
        unnamed = page.evaluate(
            """() => {
                const out = [];
                for (const el of document.querySelectorAll('button, a[href]')) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width === 0 && rect.height === 0) continue;
                  // Inside a closed <details> (and not its summary) a control is
                  // not on screen: Chrome keeps its box but innerText reads "",
                  // so it would look nameless while being unreachable anyway.
                  const shut = el.closest('details:not([open])');
                  if (shut && !el.closest('summary')) continue;
                  const name = (el.innerText || '').trim()
                    || el.getAttribute('aria-label')
                    || el.getAttribute('title')
                    || (el.querySelector('img') && el.querySelector('img').getAttribute('alt'))
                    || '';
                  if (!name) out.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40));
                }
                return out;
            }"""
        )
        check(f"{path}: every control has a name", len(unnamed) == 0, "; ".join(unnamed[:3]))

        # A positive tabindex reorders the whole page and is almost never right.
        positive = page.evaluate(
            "() => [...document.querySelectorAll('[tabindex]')]"
            ".filter(e => Number(e.getAttribute('tabindex')) > 0).length"
        )
        check(f"{path}: no positive tabindex", positive == 0, str(positive))

        # Inputs need a programmatic label, not just a visual one.
        unlabelled = page.evaluate(
            """() => {
                const out = [];
                for (const el of document.querySelectorAll('input, select, textarea')) {
                  if (el.type === 'hidden') continue;
                  const id = el.getAttribute('id');
                  const labelled = (id && document.querySelector(`label[for="${id}"]`))
                    || el.getAttribute('aria-label')
                    || el.closest('label');
                  if (!labelled) out.push(el.name || el.type);
                }
                return out;
            }"""
        )
        check(f"{path}: every input is labelled", len(unlabelled) == 0, "; ".join(unlabelled[:3]))

        # Meaningful graphics need a text alternative. The cube is decorative
        # next to a scramble that is already written out, but a chart is not.
        graphics = page.evaluate(
            """() => {
                const out = [];
                for (const el of document.querySelectorAll('svg[role="img"]')) {
                  if (!el.getAttribute('aria-label') && !el.querySelector('title')) {
                    out.push('svg without a label');
                  }
                }
                for (const el of document.querySelectorAll('img')) {
                  if (el.getAttribute('alt') === null) out.push('img without alt: ' + el.src.slice(-40));
                }
                return out;
            }"""
        )
        check(f"{path}: graphics carry text alternatives", len(graphics) == 0, "; ".join(graphics[:3]))

    print("\n== the nav separates competing from practising ==")
    page.goto(BASE + "/", wait_until="load")
    page.wait_for_timeout(3000)
    groups = page.evaluate(
        "() => [...document.querySelectorAll('nav [role=group]')].map(g => g.getAttribute('aria-label'))"
    )
    # Two different activities: one puts something on the record, the other does
    # not. A screen reader should hear that structure, not eight links in a row.
    check("the nav is grouped", groups == ["Solve", "Compete", "Improve", "Community"], str(groups))

    labelled = page.evaluate(
        """() => {
            const out = {};
            for (const g of document.querySelectorAll('nav [role=group]')) {
              out[g.getAttribute('aria-label')] =
                [...g.querySelectorAll('a, span[aria-current]')].map(a => a.innerText.trim());
            }
            return out;
        }"""
    )
    # The three ways to solve, named by what is in your hands — the old nav
    # called the keyboard "Play" and nobody could tell.
    check("the three ways to solve sit together",
          labelled.get("Solve") == ["Timer", "Keyboard", "Smart cube"], str(labelled.get("Solve")))
    check("ranked, races, duels, the daily and rush are the competitive half",
          set(labelled.get("Compete", [])) == {"Ranked", "Race", "Duel", "Daily", "Rush"},
          str(labelled.get("Compete")))
    check("everything that looks back at your solves is under Improve",
          set(labelled.get("Improve", []))
          == {"Review", "Progress", "Train", "Algorithms", "Cube solver", "Beginner guide"},
          str(labelled.get("Improve")))
    check("other people are under Community",
          set(labelled.get("Community", [])) == {"Leaderboard", "Clubs"},
          str(labelled.get("Community")))

    print("\n== the landing page demonstrates the solver ==")
    players = page.locator("twisty-player").count()
    check("a cube is on the landing page", players >= 1, f"{players} players")
    import hashlib
    el = page.locator("twisty-player").first
    frames = []
    for _ in range(3):
        frames.append(hashlib.sha1(el.screenshot()).hexdigest()[:10])
        page.wait_for_timeout(800)
    # A still cube proves nothing. The claim is that the engine solves it.
    check("and it is actually solving, not sitting there", len(set(frames)) > 1, str(frames))
    body_now = page.inner_text("body")
    check("the move count and search time are stated",
          "moves" in body_now and "ms to find" in body_now)

    print("\n== keyboard ==")
    page.goto(BASE + "/", wait_until="load")
    page.wait_for_timeout(2000)
    page.keyboard.press("Tab")
    focused = page.evaluate(
        "() => { const el = document.activeElement;"
        " return el ? el.tagName + ':' + (el.innerText || '').trim().slice(0, 30) : 'none'; }"
    )
    check("tab reaches a control", focused != "none" and focused != "BODY:", focused)

    # Focus must be visible. Tailwind's reset removes the default outline, so
    # this is a real risk rather than a theoretical one.
    outline = page.evaluate(
        """() => {
            const el = document.activeElement;
            if (!el) return 'none';
            const s = getComputedStyle(el);
            return [s.outlineStyle, s.outlineWidth, s.boxShadow].join(' | ');
        }"""
    )
    check(
        "focus is visible",
        "none" not in outline.split(" | ")[0] or outline.split(" | ")[2] != "none",
        outline,
    )

    browser.close()

print("\n" + "=" * 52)
print(f"{'FAILURES: ' + str(len(FAILS)) if FAILS else 'All checks passed.'}")
for f in FAILS:
    print(" -", f)
sys.exit(1 if FAILS else 0)
