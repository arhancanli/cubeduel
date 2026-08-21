"""The step-by-step guide, and whether its demonstrations demonstrate anything.

    python3 e2e/howto.py

`beginner.test.ts` already proves that each algorithm leaves alone what the page
says it leaves alone. That is the promise, and it is checked without a browser.

What cannot be checked without one is whether the thing on screen actually
shows it. Each demonstration starts the cube in the position the algorithm is
for and should end solved — so playing one to the end and finding a scrambled
cube means the page is showing a person something that does not work, however
correct the underlying data is.

The cube is read through the puzzle engine's own current pattern, not by
looking at pixels, so "solved" here means solved rather than "looks right from
this angle".
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")

fails = 0


def check(label, ok, detail=""):
    global fails
    if not ok:
        fails += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail else ""))


SOLVED = """async (index) => {
    const players = document.querySelectorAll('twisty-player');
    const p = await players[index].experimentalModel.currentPattern.get();
    const kpuzzle = await players[index].experimentalModel.kpuzzle.get();
    const solved = kpuzzle.defaultPattern();
    // Compare orbit by orbit. A whole-cube rotation still counts as solved,
    // which matters because these demos are held white-down via z2.
    return p.experimentalIsSolved
        ? p.experimentalIsSolved({ ignorePuzzleOrientation: true })
        : JSON.stringify(p.patternData) === JSON.stringify(solved.patternData);
}"""


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1200, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/solve", wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(4000)

    print("\n== the guide is complete ==")
    steps = page.locator("ol > li")
    check("seven steps, each a real list item", steps.count() == 7, f"{steps.count()}")

    body = page.inner_text("body")
    for title in ["The white cross", "The middle layer", "The yellow cross",
                  "The whole yellow face"]:
        check(f"step present: {title}", title in body)

    check("it says which way up to hold the cube", "white on the bottom" in body.lower())
    check("it explains the notation before using it", "R prime" in body or "prime" in body)

    print("\n== the promises are shown, and marked as checked ==")
    promises = page.locator("text=Checked against the puzzle")
    check("promises appear on the steps that make them", promises.count() == 5,
          f"{promises.count()} shown")

    print("\n== every demonstration actually solves the cube ==")
    # Scroll everything into view so all the players have mounted.
    for _ in range(6):
        page.mouse.wheel(0, 1200)
        page.wait_for_timeout(500)
    page.wait_for_timeout(2500)

    # Scrolled to explicitly rather than by a fixed number of wheel ticks. These
    # sections reveal on scroll and `inner_text` returns only visible text, so a
    # guess at the page height tests the scrolling rather than the content —
    # which is how the first version of this check failed while all 29 keys were
    # sitting in the DOM.
    page.locator("kbd").first.scroll_into_view_if_needed()
    page.wait_for_timeout(1200)
    # Lower-cased before comparing. These headings are uppercased in CSS, and
    # `inner_text` returns what is rendered — so a check for "Faces" looks for a
    # string the browser never produces, and fails on a page that is correct.
    revealed = page.inner_text("body").lower()
    check("the keyboard layout is shown", "faces" in revealed and "rotations" in revealed)
    check("every binding is listed", page.locator("kbd").count() == 29,
          f"{page.locator('kbd').count()} keys")
    check("it points at the next thing to learn", "/learn" in page.content())

    total = page.locator("twisty-player").count()
    check("every algorithm has a cube", total == 7, f"{total} cubes")

    buttons = page.locator("button:has-text('Watch it')")
    check("every cube can be played", buttons.count() == 7, f"{buttons.count()} buttons")

    # What this can and cannot check is worth being exact about.
    #
    # It cannot check that an algorithm is correct. The demo builds its starting
    # position by running the algorithm backwards, so performing it forwards
    # returns to solved for ANY sequence of moves — I mutated the yellow-cross
    # algorithm and this stayed green. Algorithm correctness lives in
    # beginner.test.ts, which derives what each one disturbs from the puzzle.
    #
    # What it does check is that the demonstration demonstrates. A cube that
    # starts already solved shows a beginner nothing, and a cube that does not
    # change when you step through it means the player is broken — both are
    # failures of this page rather than of the data behind it.
    started_solved = []
    never_finished = []

    for i in range(buttons.count()):
        if page.evaluate(SOLVED, i):
            started_solved.append(i)

        # Stepped rather than played out: the forward button applies one move at
        # a time, so this is not a timing race.
        forward = page.locator("button[aria-label$='forward one move']").nth(i)
        for _ in range(14):
            forward.click()
            page.wait_for_timeout(60)
        page.wait_for_timeout(700)

        if not page.evaluate(SOLVED, i):
            never_finished.append(i)

    check("no demonstration starts on a cube that is already solved",
          not started_solved, f"cubes {started_solved} had nothing to show")
    check("stepping through a demonstration reaches the end state",
          not never_finished, f"cubes {never_finished} never got there")

    check("no page errors", not errors, str(errors[:2]))
    browser.close()

print("\nAll checks passed." if fails == 0 else f"\n{fails} check(s) failed.")
sys.exit(0 if fails == 0 else 1)
