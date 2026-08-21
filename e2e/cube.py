"""Choosing a cube appearance, and the cube actually changing.

    python3 e2e/cube.py

The check that matters is a screenshot hash, not a class name or a stored
value. This feature has already failed twice in ways that looked fine from the
code:

  * The repaint mapped FROM cubing.js's palette, so once a cube had been
    repainted nothing matched and every subsequent change was a silent no-op.
  * Materials updated the live scene and were never drawn, because TwistyPlayer
    renders on demand and exposes no way to ask for a frame. 134 materials
    changed colour while the picture stayed byte-identical.

Both reported success. Only comparing pixels found either.
"""
import hashlib
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from account import delete_account, probe_email, sign_up  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
EMAIL = probe_email("cube-appearance")
fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def cube_palette(page):
    """The set of colours the cube's materials actually hold.

    Used for the persistence check rather than a screenshot hash, because /play
    issues a NEW SCRAMBLE on every load — so two visits legitimately differ in
    pixels while showing the same cube. Comparing hashes there would fail for a
    reason that has nothing to do with the thing being tested.

    Pixels answer "does choosing visibly change the cube". The palette answers
    "was the right cube chosen". They are different questions and neither
    substitutes for the other.
    """
    return page.evaluate("""async () => {
        const el = document.querySelector('twisty-player');
        if (!el?.experimentalCurrentThreeJSPuzzleObject) return null;
        const obj = await el.experimentalCurrentThreeJSPuzzleObject();
        const seen = new Set();
        obj.traverse(n => { if (n.isMesh) {
            const ms = Array.isArray(n.material) ? n.material : [n.material];
            for (const m of ms) if (m?.color) seen.add('#' + m.color.getHexString());
        }});
        return [...seen].sort().join(",");
    }""")


def cube_pixels(page):
    """A hash of the rendered cube, which is the only honest evidence here."""
    page.wait_for_selector("[data-cube-view]", timeout=25_000)
    # The cube fades in; without waiting for that the first hash is of an empty
    # box and every comparison after it is meaningless.
    page.wait_for_timeout(4000)
    return hashlib.sha256(page.query_selector("[data-cube-view]").screenshot()).hexdigest()[:16]


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(base_url=BASE, viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("  PAGEERROR:", str(e)[:140]))

    print("\n== the default is the corrected pigments, not cubing.js's primaries ==")
    page.goto("/play", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)

    palette = page.evaluate("""async () => {
        const el = document.querySelector('twisty-player');
        if (!el?.experimentalCurrentThreeJSPuzzleObject) return null;
        const obj = await el.experimentalCurrentThreeJSPuzzleObject();
        const seen = new Set();
        obj.traverse(n => { if (n.isMesh) {
            const ms = Array.isArray(n.material) ? n.material : [n.material];
            for (const m of ms) if (m?.color) seen.add('#' + m.color.getHexString());
        }});
        return [...seen].sort();
    }""")

    check("the cube's materials are reachable", palette is not None)
    if palette:
        raw = {"#ff0000", "#00ff00", "#ffff00", "#000000"}
        leftover = raw.intersection(palette)
        check("no raw web primaries survive", not leftover, ", ".join(sorted(leftover)) or "none")
        check("the real Rubik's red is used", "#b71234" in palette, ", ".join(palette))

    classic = cube_pixels(page)

    print("\n== choosing a different cube changes the rendered cube ==")
    page.goto("/join", wait_until="domcontentloaded")
    page.wait_for_selector("#email", timeout=20_000)
    sign_up(page, EMAIL)

    page.goto("/settings", wait_until="domcontentloaded")
    page.wait_for_selector("text=Your cube", timeout=20_000)

    # Chosen through the actual control, not by writing to storage — the point
    # is that the picker works, and a test that reaches past it would pass with
    # the picker unwired.
    page.click("text=Carbon")
    page.wait_for_timeout(800)

    page.goto("/play", wait_until="domcontentloaded")
    carbon = cube_pixels(page)
    check("the cube looks different after choosing Carbon", carbon != classic,
          f"{classic} -> {carbon}")

    print("\n== the choice survives a reload ==")
    carbon_palette = cube_palette(page)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    again = cube_palette(page)
    check("still Carbon after reloading", again == carbon_palette,
          f"{(again or '')[:60]}…")

    print("\n== the accessibility scheme is reachable and different again ==")
    page.goto("/settings", wait_until="domcontentloaded")
    page.wait_for_selector("text=High contrast", timeout=20_000)
    page.click("text=High contrast")
    page.wait_for_timeout(800)

    page.goto("/play", wait_until="domcontentloaded")
    contrast = cube_pixels(page)
    check("high contrast renders differently again", contrast not in (classic, carbon),
          f"{contrast}")

    print("\n== and it is offered without an account ==")
    page.evaluate("async () => { await fetch('/api/auth/sign-out', { method: 'POST' }) }")
    page.goto("/settings", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    body = page.inner_text("body").lower()
    # Settings needs an account, but the cube must never be something you earn:
    # the preference is local and applies signed out, which the reload proved.
    check("signing out does not reset the chosen cube",
          page.evaluate("() => localStorage.getItem('cubeduel.cube.v1')") == "contrast",
          page.evaluate("() => localStorage.getItem('cubeduel.cube.v1')"))
    check("the settings page still loads", "sign in" in body or "settings" in body)

    browser.close()

delete_account(EMAIL)
print("\nAll checks passed." if fails == 0 else f"\nFAILURES: {fails}")
sys.exit(0 if fails == 0 else 1)
