"""Connecting a physical cube, and the step everybody skips.

    python3 e2e/cubelink.py

There is no smart cube in continuous integration, so what is exercised here is
everything that is not the radio — through the same `ConnectedPuzzle` interface
the Bluetooth path uses, driven by a simulated cube.

The check that matters is the calibration gate. A smart cube reports moves and
never state, so between connecting and mirroring there has to be a moment where
the person says "my cube is solved". Skip it and the app is guessing: the mirror
shows a puzzle that is not the one in your hands, solve detection never fires,
and nothing errors anywhere. Moves arriving before that moment must be dropped,
not displayed.
"""
import hashlib
import os
import sys

from playwright.sync_api import sync_playwright

import settle  # noqa: F401 — every page load waits for streamed pages to arrive

BASE = os.environ.get("BASE", "http://localhost:3000")

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


def status(page):
    return page.locator("p[role='status']").first.inner_text()


def cube_hash(page):
    """The pixels of the cube itself.

    The status line is not enough. It is produced by the state machine, so a
    check reading it only ever tests the state machine — and the symptom that
    actually matters is visual: a cube on screen animating a puzzle that is not
    the one in your hands. That has to be caught by looking at the cube.
    """
    page.locator("div.cube-stage").first.screenshot(path="/tmp/_cubelink_frame.png")
    with open("/tmp/_cubelink_frame.png", "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/cube", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(3500)

    print("\n== nothing is connected ==")
    check("it says so plainly", "No cube connected" in page.inner_text("body"))
    check("and offers a way to see it work",
          page.locator("button:has-text('Show me how it works')").count() == 1)

    print("\n== connected, but not yet trusted ==")
    page.locator("button:has-text('Show me how it works')").click()
    page.wait_for_timeout(1200)

    body = page.inner_text("body")
    check("the connection is labelled simulated", "simulated" in body)
    check("it does NOT claim to be live", "Live." not in status(page), status(page))
    check("it asks you to solve the cube first",
          "solve your cube" in status(page).lower(), status(page))
    check("and offers the confirmation", page.locator("button:has-text('My cube is solved')").count() == 1)

    # Nothing should be turning yet: the demo drives moves only once calibrated,
    # and any move arriving before that must be dropped rather than shown.
    # Wait for the picture to stop changing on its own before using it as a
    # baseline. The cube fades in and is repainted to the chosen appearance after
    # mount, so a hash taken too early differs from the next one for reasons that
    # have nothing to do with anybody turning anything.
    before = None
    for _ in range(12):
        page.wait_for_timeout(500)
        current = cube_hash(page)
        if current == before:
            break
        before = current
    check("the cube settles into a still picture", before == cube_hash(page),
          "still animating after 6s")

    page.wait_for_timeout(2500)
    check("no turns are counted before calibration", "turn" not in status(page).lower(),
          status(page))
    check("AND THE CUBE DOES NOT MOVE before calibration", cube_hash(page) == before,
          "the cube animated a state nobody confirmed")

    print("\n== calibrated ==")
    page.locator("button:has-text('My cube is solved')").click()
    page.wait_for_timeout(1500)
    check("it goes live", "Live" in status(page), status(page))

    page.wait_for_timeout(3000)
    after = status(page)
    check("turns arrive and are counted", "turn" in after.lower(), after)
    check("and the cube on screen actually turns", cube_hash(page) != before,
          "the cube never moved, so the mirror is not mirroring")

    check("it explains where the moves now go", "/learn" in page.content())
    page.screenshot(path="/tmp/cube_live.png")

    print("\n== honest about hardware ==")
    body = page.inner_text("body")
    check("it does not claim to be proven on real cubes",
          "unproven" in body.lower() or "never been held up" in body.lower())
    check("smart cube solves are said to be rated separately",
          "own pool" in body.lower() or "separately" in body.lower())

    print("\n== disconnecting ==")
    page.locator("button:has-text('Disconnect')").click()
    page.wait_for_timeout(800)
    check("disconnecting is distinct from never connecting",
          "Disconnected" in status(page), status(page))
    check("and offers to reconnect", page.locator("button:has-text('Reconnect')").count() == 1)

    check("no page errors", not errors, str(errors[:2]))
    browser.close()

print("\nAll checks passed." if fails == 0 else f"\n{fails} check(s) failed.")
sys.exit(0 if fails == 0 else 1)
