"""
Renders docs/social-preview.png (1280×640), the picture shown when the
repository link is shared. GitHub only takes it by upload: Settings → General →
Social preview.

The cube is captured from the running site, in its real colours.

    BASE=http://localhost:3000 python3 scripts/social-preview.py
"""

import base64
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "social-preview.png")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    # A scrambled cube reads as "a puzzle"; a solved one reads as a logo.
    page.goto(f"{BASE}/play?scramble=R%20U%20R%27%20U%27%20F2%20D%20L2%20B%27", wait_until="load")
    page.wait_for_selector("twisty-player", timeout=30000)
    page.wait_for_timeout(3500)
    cube = base64.b64encode(page.locator("[data-cube-view]").first.screenshot()).decode()

    html = f"""<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,700..900&family=Figtree:wght@400;600&display=block" rel="stylesheet">
<style>
  body {{ margin:0; width:1280px; height:640px; background:#0e1320; color:#f2f2ec; font-family:Figtree,sans-serif;
         display:grid; grid-template-columns: 1fr 520px; align-items:center; overflow:hidden; }}
  .left {{ padding: 0 0 0 88px; }}
  .mark {{ display:flex; gap:14px; align-items:center; font-family:Archivo; font-weight:900; font-size:40px; letter-spacing:-0.02em; }}
  .glyph {{ display:grid; grid-template-columns:repeat(2,20px); gap:4px; }}
  .glyph i {{ width:20px; height:20px; border-radius:5px; display:block; }}
  h1 {{ font-family:Archivo; font-stretch:108%; font-weight:900; font-size:60px; line-height:1.02; margin:34px 0 26px; letter-spacing:-0.02em; }}
  .chips {{ display:flex; gap:10px; }}
  .chips span {{ font-size:19px; font-weight:600; padding:9px 16px; border-radius:999px; background:#1e2638; color:#a1aabb; }}
  img {{ width:520px; }}
</style></head><body>
<div class="left">
  <div class="mark"><div class="glyph"><i style="background:#2bc46a"></i><i style="background:#ef4b4f"></i><i style="background:#f2f2ec"></i><i style="background:#3e7bfa"></i></div>cubeduel</div>
  <h1>The speedcubing site that shows you why you're slow.</h1>
  <div class="chips"><span>Free</span><span>Open source</span><span>No ads</span><span>cubeduel.vercel.app</span></div>
</div>
<img src="data:image/png;base64,{cube}">
</body></html>"""
    card = browser.new_page(viewport={"width": 1280, "height": 640})
    card.set_content(html, wait_until="networkidle")
    card.wait_for_timeout(800)
    card.screenshot(path=OUT)
    browser.close()
print(f"-> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
