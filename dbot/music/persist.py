"""重啟後接著播：存狀態與還原。"""

import asyncio
import discord
import json
import time
from .player import (get_player, players)
from .tracks import (RESUME_MAX_AGE, STATE_FILE, Track)
import logging
log = logging.getLogger("discord-ai-bot.music")

def _snapshot() -> dict:
    out = {}
    for gid, p in players.items():
        if not p.connected or not (p.current or p.queue):
            continue
        def tr(t: Track) -> dict:
            return {"title": t.title, "url": t.url, "duration": t.duration, "requester": t.requester}
        tracks = ([{**tr(p.current), "pos": p.elapsed()}] if p.current else []) + [tr(t) for t in p.queue[:100]]
        out[str(gid)] = {"channel": p.vc.channel.id, "text": getattr(p.text_channel, "id", None), "radio": p.radio,
                         "shuffle": p.shuffle_loop, "recent": p.recent[-10:], "saved": time.time(), "tracks": tracks}
    return out


async def _state_saver():
    last = None
    while True:
        await asyncio.sleep(5)
        try:
            snap = _snapshot()
            cmp = json.dumps({k: {**v, "saved": 0, "tracks": [{**t, "pos": 0} for t in v["tracks"]]} for k, v in snap.items()}, sort_keys=True)
            cur = json.dumps(snap, sort_keys=True)
            if not snap and last is None:
                continue
            # 進度每 5 秒都在變，所以有在播就一直寫；沒在播時只在「剛變空」那次清掉檔案
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(cur, encoding="utf-8")
            tmp.replace(STATE_FILE)
            last = cmp if snap else None
        except Exception:
            log.exception("存播放狀態失敗")


async def resume_all(client: discord.Client) -> None:
    """機器人啟動時：把重啟前正在播的歌接回去（回到原本的語音頻道，從差不多的進度繼續，佇列也回來）。"""
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    for gid, e in data.items():
        try:
            if time.time() - e.get("saved", 0) > RESUME_MAX_AGE:
                continue
            guild = client.get_guild(int(gid))
            ch = guild.get_channel(int(e["channel"])) if guild else None
            if not isinstance(ch, (discord.VoiceChannel, discord.StageChannel)):
                continue
            if not [m for m in ch.members if not m.bot]:
                log.info("重啟前在 %s 播歌，但現在頻道沒人，不接回", ch.name)
                continue
            p = get_player(guild)
            if p.connected or p.current or p.queue:
                continue
            tracks = []
            for i, t in enumerate(e.get("tracks", [])):
                tracks.append(Track(t["title"], t["url"], t.get("duration"), t.get("requester") or "（重啟前）"))
                if i == 0 and t.get("pos") is not None:
                    pos = int(t["pos"])
                    dur = t.get("duration")
                    if dur and pos >= int(dur) - 5:     # 快播完了，直接從下一首開始
                        tracks.pop()
                    else:
                        p.resume_offset = pos
            if not tracks and not e.get("radio") and not e.get("shuffle"):
                continue
            await p.connect(ch)
            p.queue = tracks
            p.radio, p.shuffle_loop = bool(e.get("radio")), bool(e.get("shuffle"))
            p.recent = list(e.get("recent") or [])
            tc = guild.get_channel(int(e["text"])) if e.get("text") else None
            p.text_channel = tc if isinstance(tc, discord.abc.Messageable) else None
            p.last_action = "🔄 剛重啟過，已接回原本的播放"
            p.ensure_loop()
            log.info("重啟後接回播放：%s（%d 首）", ch.name, len(tracks))
        except Exception:
            log.exception("接回播放失敗（伺服器 %s）", gid)
    try:
        STATE_FILE.unlink()   # 已處理過；有接回去的話，存檔迴圈幾秒內就會重新寫入
    except OSError:
        pass


_resume_started = False


async def start_resume(client: discord.Client) -> None:
    """on_ready 時呼叫一次：開始定期存檔，並把重啟前的播放接回去。"""
    global _resume_started
    if _resume_started:
        return
    _resume_started = True
    await resume_all(client)
    asyncio.create_task(_state_saver())
