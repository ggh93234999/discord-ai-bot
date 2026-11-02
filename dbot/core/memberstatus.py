"""讓 AI 知道伺服器成員的「公開狀態」：線上／離線、正在玩什麼、玩多久、聽什麼歌、自訂狀態、在哪個語音頻道。

只用 Discord 上本來就公開（同伺服器的人都看得到）的資料，需要開 Presence Intent 和 Server Members Intent。
玩了多久只有遊戲有回報開始時間時才知道（Discord 的「動態」顯示的那個時間），其他情況就老實說不知道。
"""
from datetime import datetime, timezone

import discord

STATUS_ZH = {
    discord.Status.online: "線上", discord.Status.idle: "閒置", discord.Status.dnd: "請勿打擾",
    discord.Status.offline: "離線（或隱形）", discord.Status.invisible: "離線（或隱形）",
}
MAX_LINES = 30

TOOL = {
    "type": "function",
    "function": {
        "name": "member_status",
        "description": (
            "查這個伺服器成員的公開狀態：現在是線上還是離線、正在玩什麼遊戲、玩多久了、在聽什麼歌、自訂狀態、在哪個語音頻道。"
            "使用者問「誰在線上」「大家在玩什麼」「某某在幹嘛／玩多久了」「誰在語音」時呼叫。name 填成員的名字（不填就列出目前不是離線的所有人）。"
            "資料都是 Discord 上本來就公開的動態，你照實轉述；工具沒回報的就說不知道（例如沒開始時間就不知道玩多久），"
            "不要猜、不要編，也不要推測對方的私事或評論別人玩多久。離線的人看不到他在玩什麼。"
        ),
        "parameters": {
            "type": "object",
            "properties": {"name": {"type": "string", "description": "要查的成員名字（可以是暱稱、使用者名稱的一部分，或 @提及）；不填＝列出所有非離線的人"}},
        },
    },
}


def _dur(start: datetime | None, now: datetime) -> str:
    if not start:
        return ""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    mins = int((now - start).total_seconds() // 60)
    if mins < 0:
        return ""
    if mins < 1:
        return "（剛開始）"
    h, m = divmod(mins, 60)
    return f"（已經 {h} 小時 {m} 分）" if h else f"（已經 {m} 分鐘）"


def _acts(member: discord.Member, now: datetime) -> list[str]:
    out = []
    for a in member.activities or []:
        if isinstance(a, discord.CustomActivity):
            txt = " ".join(x for x in (str(a.emoji) if a.emoji else "", a.name or "") if x).strip()
            if txt:
                out.append(f"自訂狀態：{txt}")
        elif isinstance(a, discord.Spotify):
            out.append(f"在聽 Spotify：{a.title} - {a.artist}")
        elif isinstance(a, discord.Streaming):
            out.append(f"直播中：{a.name}" + (f"（{a.game}）" if getattr(a, "game", None) else ""))
        elif a.type == discord.ActivityType.playing:
            d = _dur(getattr(a, "start", None), now)
            out.append(f"正在玩 {a.name}" + (d or "（沒有回報開始時間，不知道玩多久）"))
        elif a.type == discord.ActivityType.listening:
            out.append(f"在聽 {a.name}")
        elif a.type == discord.ActivityType.watching:
            out.append(f"在看 {a.name}")
        elif a.type == discord.ActivityType.competing:
            out.append(f"在參加 {a.name}")
        elif getattr(a, "name", None):
            out.append(str(a.name))
    return out


def _line(member: discord.Member, now: datetime) -> str:
    parts = [STATUS_ZH.get(member.status, str(member.status))]
    parts += _acts(member, now)
    if member.voice and member.voice.channel:
        parts.append(f"在語音頻道「{member.voice.channel.name}」")
    return f"{member.display_name}：" + "；".join(parts)


def _find(guild: discord.Guild, name: str) -> list[discord.Member]:
    q = name.strip().lstrip("@").strip()
    if q.startswith("<") and q.endswith(">"):
        q = "".join(ch for ch in q if ch.isdigit())
    if q.isdigit():
        m = guild.get_member(int(q))
        return [m] if m else []
    q = q.casefold()
    exact = [m for m in guild.members if q in (m.display_name.casefold(), m.name.casefold(), (m.global_name or "").casefold())]
    if exact:
        return exact
    return [m for m in guild.members if q and (q in m.display_name.casefold() or q in m.name.casefold() or q in (m.global_name or "").casefold())]


def run(guild: discord.Guild | None, args: dict) -> str:
    if guild is None:
        return "這裡不是伺服器，查不到成員狀態。"
    now = datetime.now(timezone.utc)
    name = str(args.get("name") or "").strip()
    if name:
        found = _find(guild, name)
        if not found:
            return f"找不到叫「{name}」的成員。"
        return "\n".join(_line(m, now) for m in found[:5])
    active = [m for m in guild.members if not m.bot and m.status != discord.Status.offline]
    if not active:
        return "現在沒有人在線上（或大家都隱形）。"
    active.sort(key=lambda m: (m.status != discord.Status.online, m.display_name.casefold()))
    lines = [_line(m, now) for m in active[:MAX_LINES]]
    if len(active) > MAX_LINES:
        lines.append(f"…還有 {len(active) - MAX_LINES} 人")
    return f"目前不是離線的有 {len(active)} 人：\n" + "\n".join(lines)
