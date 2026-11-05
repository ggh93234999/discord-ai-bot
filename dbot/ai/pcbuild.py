"""幫忙配電腦：問 Activity 後端的 /api/pc/*（原價屋＋欣亞的價格、相容性檢查、依預算推薦、價格走勢）。
只在使用者提到配電腦、組裝、預算、零件、原價屋、欣亞等字時才放進工具清單（見 bot.py 的 PC_RE）。"""
import os

import aiohttp

BASE = os.getenv("ACTIVITY_API", "http://127.0.0.1:3101").rstrip("/") + "/api/pc/"

TOOL = {
    "type": "function",
    "function": {
        "name": "pc_build",
        "description": (
            "配電腦／查零件價格工具：資料來自原價屋與欣亞，每 4 小時更新，同款零件已自動配對兩家價格。"
            "action=recommend：依預算（台幣）和用途自動配一整台（CPU、主機板、顯卡、記憶體、SSD、電源、機殼、散熱器），附兩家合計與相容性檢查；"
            "action=search：用關鍵字找零件（例如「RTX 5060 Ti」「B650M」「DDR5 6000」），可指定 category；"
            "action=trend：看某個零件的價格走勢（要用 search 結果裡的 id）。"
            "價格、型號一定要用工具結果，不要自己編；回答時列出每個零件和兩家價格，說明哪家便宜，並提醒下單前自己確認顯卡長度與散熱器高度。"
            "recommend 結果有「配單代碼」，一定要告訴使用者：到 Activity →「🧰 實用工具」→「配電腦」，在「配單代碼」欄輸入代碼按載入，就能打開這份配單並自己更換零件（30 天內有效）。使用者想保留某些零件時，先用 search 查到 id，再用 recommend 的 keep 帶入。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["recommend", "search", "trend"], "description": "預設 recommend"},
                "budget": {"type": "integer", "description": "recommend：總預算（新台幣）"},
                "use": {"type": "string", "enum": ["game", "office", "create"], "description": "recommend：用途，game 遊戲（預設）、office 文書上網、create 剪片繪圖"},
                "store": {"type": "string", "enum": ["both", "coolpc", "sinya"], "description": "recommend：both 兩家混搭最省（預設）、coolpc 只買原價屋、sinya 只買欣亞"},
                "keep": {"type": "string", "description": "recommend：使用者已經選好、要保留的零件 id（先用 search 查到），用逗號隔開，剩下的由工具配"},
                "query": {"type": "string", "description": "search：關鍵字，空白分隔，全部都要符合"},
                "category": {"type": "string", "enum": ["cpu", "mb", "ram", "ssd", "gpu", "case", "psu", "cooler"], "description": "search：限定分類"},
                "id": {"type": "string", "description": "trend：零件 id"},
            },
        },
    },
}

_MODE = {"both": "min", "coolpc": "c", "sinya": "s"}


async def run(args: dict) -> str:
    action = args.get("action") or "recommend"
    if action == "recommend":
        try:
            budget = int(args.get("budget") or 0)
        except (TypeError, ValueError):
            budget = 0
        if budget < 10000:
            return "預算要先告訴我（新台幣，至少 1 萬），我才配得出來。"
        params = {"budget": budget, "use": args.get("use") or "game", "mode": _MODE.get(args.get("store") or "both", "min")}
        if args.get("keep"):
            params["keep"] = str(args["keep"])
        path = "rec"
    elif action == "search":
        if not (args.get("query") or "").strip():
            return "要搜尋什麼零件？給我型號或關鍵字。"
        params = {"q": args["query"], "cat": args.get("category") or ""}
        path = "search"
    elif action == "trend":
        if not args.get("id"):
            return "要看哪個零件的走勢？先用 search 找出零件 id。"
        params = {"id": args["id"]}
        path = "trend"
    else:
        return "不支援的動作。"
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
            async with s.get(BASE + path, params=params) as r:
                text = await r.text()
                if r.status >= 500 or r.status == 404:
                    return f"配電腦資料暫時不能用：{text[:200]}"
                return text[:6000]
    except Exception as e:  # noqa: BLE001
        return f"連不到配電腦的價格資料：{type(e).__name__}"
