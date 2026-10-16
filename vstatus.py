"""
語音頻道狀態（語音頻道名稱底下那行小字）。

- 追蹤每個語音頻道目前的狀態（從 Discord 推送的 VOICE_CHANNEL_STATUS_UPDATE 事件得知）
- manual：用 /頻道狀態 或 AI 手動設定的狀態；有手動狀態時，放歌不會蓋掉它
"""

import json
import logging

import discord

log = logging.getLogger("discord-ai-bot.vstatus")

MAX_LEN = 500
known: dict[int, str | None] = {}   # 頻道 ID → 目前狀態（機器人啟動後看到的）
manual: dict[int, str] = {}         # 頻道 ID → 手動設定的狀態


def on_socket_raw(msg) -> None:
    """從 gateway 原始事件抓語音頻道狀態變化（discord.py 沒有幫忙記）。"""
    if not isinstance(msg, str) or "VOICE_CHANNEL_STATUS_UPDATE" not in msg:
        return
    try:
        data = json.loads(msg)
    except json.JSONDecodeError:
        return
    if data.get("t") != "VOICE_CHANNEL_STATUS_UPDATE":
        return
    d = data.get("d") or {}
    try:
        known[int(d["id"])] = d.get("status") or None
    except (KeyError, ValueError):
        pass


async def set_status(channel: discord.VoiceChannel, text: str | None, reason: str | None = None) -> str | None:
    """設定狀態；成功回 None，失敗回錯誤訊息。"""
    text = (text or "").strip()[:MAX_LEN] or None
    try:
        await channel.edit(status=text, reason=reason)
    except discord.Forbidden:
        return "我沒有「設定語音頻道狀態」權限。"
    except discord.HTTPException as e:
        return f"改狀態失敗：{e.text or e}"
    known[channel.id] = text
    return None
