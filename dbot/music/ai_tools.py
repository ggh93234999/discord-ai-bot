"""給 AI 呼叫的音樂工具定義與執行。"""

import discord
from .actions import (do_control, do_play, do_radio, do_random, do_remove, do_volume)
from .player import (players)

TOOL = {
    "type": "function",
    "function": {
        "name": "music",
        "description": (
            "在使用者所在的 Discord 語音頻道放 YouTube 音樂或控制播放。"
            "使用者叫你放歌、點歌、換歌、插歌（插播）、調音量（大聲／小聲）、跳過、暫停、停止、看現在放什麼、問歌放完了沒時使用。"
            "點多首歌時，每一首都要各呼叫一次 play（一次一首），沒呼叫的就是沒點。"
            "使用者沒指定歌而是描述心情或風格（例如「放點輕鬆的」）時，自己挑一首具體的歌名加歌手當 query。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["play", "skip", "pause", "resume", "stop", "queue", "shuffle", "remove", "clear", "history", "random_on", "random_off", "volume", "radio_on", "radio_off"],
                    "description": ("play=點歌加入佇列；skip=跳過現在這首；pause=暫停；resume=繼續；stop=停止並離開；"
                                    "queue=看正在放什麼、接下來的歌、播完了沒；shuffle=打亂佇列；"
                                    "remove=從佇列移除某一首（用 index 或 query 指定）；clear=清空佇列（現在這首放完）；"
                                    "history=看播放紀錄；random_on=使用者懶得選歌／說『隨便放』『從紀錄隨機循環』時，開啟從播放紀錄隨機一直放；random_off=關閉隨機循環；radio_on=使用者要『無限放歌』『一直隨便放』『電台』『自動接歌』時，開啟無限電台（可用 query 給起點歌，不給就接目前這首），不限於播放紀錄、會自動接相似的新歌；radio_off=關閉電台；volume=調音量（用 level，1~150 的百分比，100 是正常；不給 level 就是查現在音量）"),
                },
                "position": {"type": "string", "enum": ["end", "next", "now"], "description": "action=play 時：end=排到最後（預設）；next=插到下一首（使用者說『插歌』『下一首放』『插隊』）；now=立刻播、跳過現在這首（使用者說『現在就放』『馬上播』）"},
                "level": {"type": "integer", "description": "action=volume 時：音量百分比，1~150，100 是正常大小。使用者說『大聲一點』就比現在大一些，『小聲一點』就小一些（先用 music_status 或 volume 不帶 level 查現在多少）"},
                "query": {"type": "string", "description": "action=play 時：歌名（建議含歌手）或 YouTube 網址／播放清單網址；action=remove 時：要移除的歌名關鍵字"},
                "index": {"type": "integer", "description": "action=remove 時：要移除佇列裡的第幾首（跟佇列顯示的編號一樣，從 1 開始）"},
            },
            "required": ["action"],
        },
    },
}


STATUS_TOOL = {
    "type": "function",
    "function": {
        "name": "music_status",
        "description": (
            "查詢『現在真實的』播放狀態：有沒有在語音頻道、有沒有在播、放哪首、暫停了嗎、佇列幾首、是不是播完了。"
            "只要使用者問有沒有在播歌、放到哪、放完了沒、佇列有什麼，或你自己想說『正在播／佇列裡有』之前，一定要先呼叫這個確認，不准用猜的或看歷史訊息回答。"
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def real_state(guild: discord.Guild | None) -> str:
    """目前真實狀態（程式直接讀播放器，不是模型記憶）。"""
    if guild is None:
        return "（不在伺服器）"
    p = players.get(guild.id)
    if p is None or not p.connected:
        return "【真實狀態】機器人現在沒有在播歌，也不在任何語音頻道，佇列是空的。"
    return "【真實狀態】\n" + p.queue_text()


def is_playing(guild: discord.Guild | None) -> bool:
    p = players.get(guild.id) if guild else None
    return bool(p and p.connected and p.current)


async def run_tool(msg: discord.Message, args: dict) -> str:
    if not msg.guild:
        return "私訊裡不能放音樂，要在伺服器裡用。"
    member = msg.author if isinstance(msg.author, discord.Member) else msg.guild.get_member(msg.author.id)
    action = (args.get("action") or "").strip()
    if action == "play":
        q = (args.get("query") or "").strip()
        if not q:
            return "要放什麼歌？"
        pos = args.get("position") if args.get("position") in ("end", "next", "now") else "end"
        return await do_play(member, msg.channel, q, pos)
    if action == "volume":
        lv = args.get("level")
        return await do_volume(member, int(lv) if lv is not None else None)
    if action in ("radio_on", "radio_off"):
        return await do_radio(member, msg.channel, action == "radio_on", (args.get("query") or "").strip() or None)
    if action in ("random_on", "random_off"):
        return await do_random(member, msg.channel, action == "random_on")
    if action == "remove":
        target = args.get("index") if args.get("index") is not None else args.get("query")
        return await do_remove(member, target)
    return await do_control(member, action)


def tool_status(args: dict) -> str:
    a = args.get("action")
    return f"🎵 點歌：{args.get('query', '')}" if a == "play" else f"🎵 {a}"
