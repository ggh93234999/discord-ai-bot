#!/usr/bin/env python3
"""檢查每個 Activity 畫面在「Discord 手機版」會不會被上方的 Discord 標題列擋到。

Discord 手機版會在 Activity 最上面蓋一條約 58px 的列（大笨bot／退出）。這支腳本用 ?dcm=1 模擬，
把選單和 main.js 裡登記的每個遊戲都打開一次，檢查最上面 58px 內有沒有任何內容（按鈕、文字、圖、畫布），
以及有沒有 JS 錯誤。改過前端（尤其是新增畫面、彈窗、position:fixed 的東西）之後都要跑一次。

用法：先 npm run build，然後  python3 tools/dcm_audit.py  [遊戲代號…]
會自己開一個只讀的靜態伺服器（dist/），不會動到正式服務。回傳碼 0 = 全部通過。
"""
import glob, http.server, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOP = 58
JS = r"""
(top) => {
  const leaf = (e) => e && e !== document.documentElement && e !== document.body && e.id !== "dcwrap" && e.id !== "app" &&
    (e.children.length === 0 || /^(BUTTON|CANVAS|IMG|INPUT|SELECT|TEXTAREA|H1|H2|H3|A|VIDEO|IFRAME)$/.test(e.tagName)) &&
    getComputedStyle(e).pointerEvents !== "none";
  const hit = new Set();
  for (let x = 12; x < innerWidth; x += 30) for (const y of [4, 16, 28, 40, top - 6]) {
    const e = document.elementFromPoint(x, y);
    if (leaf(e)) hit.add((e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "")).slice(0, 60));
  }
  const app = document.getElementById("app");
  const wrapped = !!document.getElementById("dcwrap");
  const over = wrapped ? app.scrollHeight - app.clientHeight : document.documentElement.scrollHeight - innerHeight;
  return { hit: [...hit].slice(0, 4), over: Math.max(0, Math.round(over)), text: document.body.innerText.length };
}
"""

def game_ids():
    src = open(os.path.join(ROOT, "src", "main.js"), encoding="utf8").read()
    return re.findall(r'^\s*\{ id: "(\w+)", cat: "\w+".*mount', src, re.M)

def serve():
    dist = os.path.realpath(os.path.join(ROOT, "dist"))
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=dist, **k)
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]

def main():
    ids = sys.argv[1:] or ["(選單)"] + game_ids()
    exe = sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")))
    srv, port = serve()
    bad = 0
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=exe[-1]) if exe else pw.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        for i in ids:
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e, errs=errs: errs.append(str(e)[:90]))
            url = f"http://127.0.0.1:{port}/?dcm=1" + ("" if i == "(選單)" else f"&g={i}")
            try:
                pg.goto(url, timeout=15000); pg.wait_for_timeout(1500)
                r = pg.evaluate(JS, TOP)
            except Exception as e:
                r = {"hit": [], "over": 0, "text": 0}; errs.append(str(e)[:90])
            ok = not r["hit"] and not errs and r["text"] > 10
            bad += not ok
            print(("OK  " if ok else "FAIL"), f"{i:12s} 可捲動 {r['over']:5d}px", ("｜擋到：" + "、".join(r["hit"])) if r["hit"] else "", ("｜錯誤：" + errs[0]) if errs else "", flush=True)
            pg.close()
        b.close()
    srv.shutdown()
    print("全部通過" if not bad else f"有 {bad} 個畫面沒過")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
