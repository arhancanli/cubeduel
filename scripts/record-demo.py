"""
Records the README's demo: a keyboard solve at real speed, then its review.

A frame after every turn, then the review page, stitched into one GIF with
Pillow — no video tools needed. Runs in its own browser, so nobody's own
history is touched.

    BASE=http://localhost:3000 python3 scripts/record-demo.py
    → docs/screens/demo.gif
"""

import io
import os
import sys
from urllib.parse import quote

from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "e2e"))
import settle  # noqa: F401,E402

BASE = os.environ.get("BASE", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "screens", "demo.gif")

KEY_FOR_MOVE = {
    "U": "KeyJ", "U'": "KeyF", "D": "KeyS", "D'": "KeyL", "R": "KeyI", "R'": "KeyK",
    "L": "KeyD", "L'": "KeyE", "F": "KeyH", "F'": "KeyG", "B": "KeyW", "B'": "KeyO",
}
# A real CFOP solve: cross, four pairs, OLL, PLL.
STEPS = [
    "D2 R' D'", "U R U' R'", "U' L' U L", "U' R' U R", "U L U' L'",
    "R U R' U R U2 R'", "R U R' U' R' F R2 U' R' U' R U R' F'",
]


def invert(move):
    return move if move.endswith("2") else (move[:-1] if move.endswith("'") else move + "'")


SCRAMBLE = " ".join(invert(m) for m in reversed(" ".join(STEPS).split()))
WIDTH = 760


def frame(page, clip):
    image = Image.open(io.BytesIO(page.screenshot(clip=clip))).convert("RGB")
    scale = WIDTH / image.width
    return image.resize((WIDTH, round(image.height * scale)), Image.LANCZOS)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 860}, device_scale_factor=1)
    page.goto(f"{BASE}/play?scramble={quote(SCRAMBLE)}", wait_until="load")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(3500)

    # The solving column: scramble, cube, clock.
    column = page.locator("main > div > div").first.bounding_box()
    clip = {"x": column["x"], "y": 0, "width": column["width"], "height": 700}

    frames, durations = [], []
    frames.append(frame(page, clip))
    durations.append(1400)
    for step in STEPS:
        for move in step.split():
            for key in [KEY_FOR_MOVE[move[:-1]]] * 2 if move.endswith("2") else [KEY_FOR_MOVE[move]]:
                page.keyboard.press(key)
            page.wait_for_timeout(90)
            frames.append(frame(page, clip))
            durations.append(110)
        page.wait_for_timeout(250)
    page.wait_for_timeout(1200)
    frames.append(frame(page, clip))
    durations.append(1500)

    page.get_by_role("link", name="Review this solve").click()
    page.wait_for_selector("[data-testid=review-moments]", timeout=30000)
    # The review is wider than the solving column, so it is shown in the same
    # proportions from a taller window — every frame the same shape, no gaps.
    aspect = clip["height"] / clip["width"]
    main = page.locator("main").bounding_box()
    review_w = min(main["width"] - 48, 1000)
    review_h = round(review_w * aspect)
    page.set_viewport_size({"width": 1280, "height": review_h + 400})
    page.wait_for_timeout(2500)
    main = page.locator("main").bounding_box()
    review = {"x": main["x"] + 24, "y": 0, "width": review_w, "height": review_h}
    frames.append(frame(page, review))
    durations.append(5200)
    browser.close()

# One shared palette keeps the file small and the colours steady between
# frames. Taken from solve and review frames together: from a solve frame alone,
# the review's orange had no near match and came out yellow.
sample = [frames[0], frames[len(frames) // 2], frames[-2], frames[-1]]
sheet = Image.new("RGB", (WIDTH, sum(f.height for f in sample)))
y = 0
for f in sample:
    sheet.paste(f, (0, y))
    y += f.height
palette = sheet.quantize(colors=128, method=Image.MEDIANCUT)
quantized = [f.resize((WIDTH, round(f.height * WIDTH / f.width))).quantize(palette=palette, dither=Image.NONE) for f in frames]
quantized[0].save(OUT, save_all=True, append_images=quantized[1:], duration=durations, loop=0, optimize=True, disposal=2)
print(f"{len(frames)} frames -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
