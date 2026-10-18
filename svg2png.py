"""把 SVG 用無頭 Chromium 轉成 PNG（星盤圖用了 CSS 變數和中文字，cairosvg 畫不出來）。
用法：python3 svg2png.py 輸入.svg 輸出.png [寬度]
要用裝了 playwright 的 Python 執行（伺服器上的系統 python3）。"""
import asyncio, glob, os, sys
from playwright.async_api import async_playwright

async def main(src, dst, width):
    exe = glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=exe[0] if exe else None, args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": width, "height": 400}, device_scale_factor=1)
        svg = open(src, encoding="utf-8").read()
        await pg.set_content(f"<html><body style='margin:0;background:#1e1f22'><div id=c style='width:{width}px'>{svg}</div></body></html>")
        el = await pg.query_selector("#c svg")
        await pg.evaluate("""(w) => { const s = document.querySelector('#c svg'); const vb = s.viewBox.baseVal;
            if (vb && vb.width) { s.setAttribute('width', w); s.setAttribute('height', Math.round(w * vb.height / vb.width)); } }""", width)
        box = await el.bounding_box()
        await pg.set_viewport_size({"width": width, "height": int(box["height"]) + 2})
        await el.screenshot(path=dst)
        await b.close()

asyncio.run(main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1200))
