"""讓大笨bot 知道「這個伺服器的人現在在 Activity 裡玩什麼」。
Activity 後端（node，127.0.0.1:3101）記著每個玩家的瀏覽器回報的目前遊戲；這裡用內部金鑰去問，
而且只問這個伺服器（gid）自己的人，不會看到別的伺服器。"""
import json
import logging
from collections import defaultdict
from pathlib import Path

import aiohttp

log = logging.getLogger("discord-ai-bot.actstatus")
KEY_FILE = Path(__file__).parent / "activity" / "server" / "internal.key"
URL = "http://127.0.0.1:3101/api/internal/presence"

NAMES = {
    "menu": "停在遊戲選單", "gomoku": "五子棋", "c4": "四連棋", "rv": "黑白棋", "chess": "西洋棋", "xq": "象棋",
    "down": "小朋友下樓梯", "pinball": "彈珠台", "pika2": "皮卡丘排球 2P", "lf2": "小朋友齊打交",
    "slots": "老虎機", "poker": "德州撲克", "mjtw": "台灣麻將", "mjjp": "日本麻將", "bridge": "橋牌", "bigtwo": "大老二",
    "avalon": "阿瓦隆", "stone": "賭石", "bj": "21 點", "horse": "賽馬", "dice": "骰子", "coin": "擲硬幣",
    "spectate": "旁觀大廳", "theater": "一起看影片", "gallery": "圖創區", "farm": "種菜", "forge": "鍛造", "forgeboard": "神兵榜",
}

TOOL = {
    "type": "function",
    "function": {
        "name": "activity_status",
        "description": (
            "查看這個伺服器的人現在在 Discord Activity（遊戲間）裡玩什麼、誰在玩哪個遊戲、玩了多久。"
            "有人問「大家在玩什麼」「有人在玩遊戲嗎」「誰在打麻將」「Activity 現在有人嗎」時呼叫。只看得到這個伺服器自己的人。"
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def _dur(sec: int) -> str:
    return "剛進來" if sec < 60 else f"約 {sec // 60} 分鐘" if sec < 3600 else f"約 {sec // 3600} 小時"


async def run(guild_id: int | None) -> str:
    if not guild_id:
        return "這裡不是伺服器，看不到 Activity 的人。"
    try:
        key = KEY_FILE.read_text().strip()
    except OSError:
        return "Activity 沒有開，查不到。"
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as s:
            async with s.get(URL, params={"gid": str(guild_id)}, headers={"X-Key": key}) as r:
                if r.status != 200:
                    return f"查詢失敗（{r.status}）。"
                data = await r.json()
    except Exception as e:
        log.warning("查 Activity 狀態失敗：%r", e)
        return "Activity 目前連不上，查不到。"
    players = data.get("players") or []
    if not players:
        return "現在沒有人開著 Activity（遊戲間）。"
    by = defaultdict(list)
    for p in players:
        by[p.get("game") or "menu"].append(p)
    lines = []
    for game, ps in sorted(by.items(), key=lambda kv: (kv[0] == "menu", -len(kv[1]))):
        names = "、".join(f"{p.get('name') or '（沒設名稱）'}（{_dur(int(p.get('sec') or 0))}）" for p in ps)
        lines.append(f"{NAMES.get(game, game)}：{len(ps)} 人 — {names}")
    return f"Activity 目前共 {len(players)} 人：\n" + "\n".join(lines)
