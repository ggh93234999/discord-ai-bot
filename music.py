"""
音樂播放：從 YouTube 搜尋／貼網址，在語音頻道播放。

- 播放面板：一則會自己更新的訊息，顯示正在播放（進度條）、接下來的歌、播完了沒，附控制按鈕
- 語音頻道狀態：播歌時自動把語音頻道狀態改成「🎶 歌名」，播完／離開時還原
- 斜線指令：/播放 /插播 /跳過 /暫停 /繼續 /停止 /佇列 /隨機 /移除 /清空佇列
- 播放紀錄：每首播過的歌記在 play_history.json；/歷史 看紀錄、/隨機循環 從紀錄隨機一直放
- AI 工具：music（讓 @機器人 放某某歌 也能用）

需要：伺服器裝 ffmpeg、node；Python 套件 discord.py[voice]、yt-dlp[default]
"""

import asyncio
import json
import logging
import random
import re
import time
from pathlib import Path
from dataclasses import dataclass, field

import discord
import yt_dlp
from discord import app_commands

import vstatus

log = logging.getLogger("discord-ai-bot.music")

IDLE_LEAVE_SECONDS = 180   # 佇列播完、沒人點歌，幾秒後離開
ALONE_LEAVE_SECONDS = 60   # 語音頻道只剩機器人，幾秒後離開
PANEL_REFRESH_SECONDS = 15  # 面板進度條多久更新一次
MAX_PLAYLIST = 50          # 貼播放清單時最多加入幾首
MAX_QUEUE = 200

YDL_BASE = {"quiet": True, "no_warnings": True, "js_runtimes": {"node": {}}, "socket_timeout": 15}
FFMPEG_BEFORE = "-reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 -reconnect_delay_max 5"
URL_RE = re.compile(r"https?://", re.I)
YT_ID_RE = re.compile(r"(?:v=|youtu\.be/|shorts/)([\w-]{11})")

HISTORY_FILE = Path(__file__).parent / "play_history.json"
SETTINGS_FILE = Path(__file__).parent / "music_settings.json"
STATE_FILE = Path(__file__).parent / "music_state.json"   # 正在播的歌與佇列（機器人重啟後靠它接回去）
RESUME_MAX_AGE = 30 * 60   # 重啟時，超過這麼久之前的紀錄就不接了
DEFAULT_VOLUME = 100       # 百分比
MAX_VOLUME = 150           # 超過 100 可能破音
VOLUME_STEP = 10           # 面板 🔉🔊 按鈕每次調多少
MAX_HISTORY = 300          # 每個伺服器最多記幾首
REFILL_COUNT = 5           # 隨機循環時，佇列空了一次補幾首
AVOID_RECENT = 10          # 隨機時避開最近播過的幾首

COLOR_PLAYING = 0x57F287
COLOR_PAUSED = 0xFEE75C
COLOR_DONE = 0x5865F2
COLOR_LEFT = 0x99AAB5


@dataclass
class Track:
    title: str
    url: str  # YouTube 網頁網址（播放時才去拿真正的音訊網址，因為那個會過期）
    duration: int | None
    requester: str
    added_at: float = field(default_factory=time.time)

    @property
    def thumbnail(self) -> str | None:
        m = YT_ID_RE.search(self.url)
        return f"https://i.ytimg.com/vi/{m.group(1)}/mqdefault.jpg" if m else None


# ---------------------------------------------------------------- 播放紀錄（存 play_history.json，每個伺服器各一份）

def _load_history() -> dict:
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


history: dict[str, list[dict]] = _load_history()


def record_history(guild_id: int, t: "Track") -> None:
    lst = history.setdefault(str(guild_id), [])
    now = time.time()
    for h in lst:
        if h["url"] == t.url:
            h["count"] = h.get("count", 1) + 1
            h["last"] = now
            h["title"] = t.title
            h["duration"] = t.duration
            break
    else:
        lst.append({"title": t.title, "url": t.url, "duration": t.duration, "count": 1, "last": now})
    if len(lst) > MAX_HISTORY:
        lst.sort(key=lambda h: h["last"], reverse=True)
        del lst[MAX_HISTORY:]
    try:
        tmp = HISTORY_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(history, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(HISTORY_FILE)
    except OSError as e:
        log.warning("存播放紀錄失敗：%r", e)


def pick_random(guild_id: int, n: int, avoid: list[str]) -> list["Track"]:
    """從播放紀錄隨機挑 n 首（避開最近播過的）。"""
    lst = history.get(str(guild_id), [])
    pool = [h for h in lst if h["url"] not in avoid] or lst
    picks = random.sample(pool, min(n, len(pool)))
    return [Track(h["title"], h["url"], h.get("duration"), "🎲 歷史隨機") for h in picks]


def _video_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def radio_tracks(seed_url: str, n: int, avoid: list[str]) -> list["Track"]:
    """無限電台：用 YouTube 的「合輯」（以這首為種子的推薦清單）挑 n 首沒放過的。"""
    vid = _video_id(seed_url)
    if not vid:
        return []
    with yt_dlp.YoutubeDL({**YDL_BASE, "extract_flat": True, "noplaylist": False, "playlistend": 40}) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}&list=RD{vid}", download=False)
    avoid_ids = {_video_id(u) for u in avoid}
    cands = []
    for e in (info or {}).get("entries") or []:
        if not e or not e.get("id") or e["id"] in avoid_ids or e["id"] == vid:
            continue
        # 太長的（合輯、直播、一小時串燒）不要
        if (e.get("duration") or 0) > 15 * 60:
            continue
        cands.append(Track(e.get("title") or e["id"], f"https://www.youtube.com/watch?v={e['id']}",
                           e.get("duration"), "📻 電台"))
    random.shuffle(cands)
    return cands[:n]


def history_text(guild_id: int, n: int = 20) -> str:
    lst = sorted(history.get(str(guild_id), []), key=lambda h: h["last"], reverse=True)
    if not lst:
        return "還沒有播放紀錄，先點幾首歌吧。"
    lines = [f"共 {len(lst)} 首紀錄，最近播的 {min(n, len(lst))} 首："]
    for i, h in enumerate(lst[:n], 1):
        lines.append(f"{i}. {short(h['title'], 50)}（{fmt_dur(h.get('duration'))}，播過 {h.get('count', 1)} 次）")
    return "\n".join(lines)


# ---------------------------------------------------------------- 音量（每個伺服器各記一個，存 music_settings.json）

def _load_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


settings: dict = _load_settings()


def get_volume(guild_id: int) -> int:
    return int(settings.get("volume", {}).get(str(guild_id), DEFAULT_VOLUME))


def save_volume(guild_id: int, pct: int) -> None:
    settings.setdefault("volume", {})[str(guild_id)] = pct
    try:
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(settings, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(SETTINGS_FILE)
    except OSError as e:
        log.warning("存音量設定失敗：%r", e)


def fmt_dur(sec) -> str:
    if not sec:
        return "直播/未知"
    sec = int(sec)
    h, m, s = sec // 3600, sec // 60 % 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fmt_pos(sec) -> str:
    """播放進度用：0 秒也顯示 0:00（fmt_dur 的 0 代表「長度未知」）。"""
    sec = max(0, int(sec or 0))
    h, m, s = sec // 3600, sec // 60 % 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def short(text: str, n: int = 55) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def progress_bar(elapsed: int, total: int | None, width: int = 10) -> str:
    """短版進度條（不用 emoji，手機上才不會折成兩行）。"""
    if not total:
        return "🔴 直播"
    filled = max(0, min(width, round(elapsed / total * width)))
    return "▰" * filled + "▱" * (width - filled)


# ---------------------------------------------------------------- yt-dlp（同步，丟到 thread 跑）

def _resolve(query: str, requester: str) -> tuple[list[Track], str | None]:
    """把使用者輸入變成歌曲清單。回傳 (歌曲們, 播放清單名稱或 None)。"""
    q = query.strip()
    is_url = bool(URL_RE.match(q))
    is_playlist = is_url and "list=" in q and ("/playlist" in q or "watch?v=" not in q)
    opts = {**YDL_BASE, "extract_flat": "in_playlist" if is_playlist else True, "noplaylist": not is_playlist}
    if is_playlist:
        opts["playlistend"] = MAX_PLAYLIST
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(q if is_url else f"ytsearch1:{q}", download=False)
    if not info:
        return [], None
    entries = info.get("entries")
    playlist_title = info.get("title") if is_playlist else None
    if entries is None:
        entries = [info]
    tracks = []
    for e in entries:
        if not e:
            continue
        url = e.get("webpage_url") or e.get("url")
        if url and not url.startswith("http"):
            url = f"https://www.youtube.com/watch?v={url}"
        if not url:
            continue
        tracks.append(Track(e.get("title") or url, url, e.get("duration"), requester))
    return tracks[:MAX_PLAYLIST], playlist_title


def _search(query: str, requester: str, n: int = 5) -> list[Track]:
    """搜 YouTube，回前 n 筆讓使用者自己選。"""
    with yt_dlp.YoutubeDL({**YDL_BASE, "extract_flat": True, "noplaylist": True}) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query.strip()}", download=False)
    tracks = []
    for e in (info or {}).get("entries") or []:
        if not e:
            continue
        url = e.get("webpage_url") or e.get("url")
        if url and not url.startswith("http"):
            url = f"https://www.youtube.com/watch?v={url}"
        if url:
            tracks.append(Track(e.get("title") or url, url, e.get("duration"), requester))
    return tracks[:n]


# 備援用的 YouTube 用戶端：預設的 client 對部分影片會給出「播的時候 403」的網址，換 web_embedded 就能播
_YT_FALLBACK_CLIENTS = ("web_embedded", "mweb")


def _playable(info: dict) -> bool:
    """先用 1 byte 的 Range 請求試一下串流網址，403／401 代表 ffmpeg 一定打不開。"""
    import urllib.error
    import urllib.request
    try:
        req = urllib.request.Request(info["url"], headers={**(info.get("http_headers") or {}), "Range": "bytes=0-1"})
        urllib.request.urlopen(req, timeout=10).close()
        return True
    except urllib.error.HTTPError as e:
        return e.code not in (401, 403)
    except Exception:
        return True            # 網路抖動等不確定的情況：照原本的流程走


def _wait_available(info: dict, cap: float = 15.0) -> None:
    """yt-dlp 2026.10.21 起，格式帶 available_at：串流網址在那個時間之前會回 403，要等到才給 ffmpeg 讀。"""
    times = [info.get("available_at")] + [f.get("available_at") for f in (info.get("requested_formats") or [])]
    t = max([x for x in times if isinstance(x, (int, float))], default=0)
    wait = t - time.time()
    if 0 < wait:
        log.info("串流網址 %.1f 秒後才生效，先等一下：%s", wait, info.get("title"))
        time.sleep(min(wait + 0.5, cap))


def _stream_info(url: str) -> dict:
    first = None
    for client in (None, *_YT_FALLBACK_CLIENTS):
        opts = {**YDL_BASE, "format": "bestaudio/best", "noplaylist": True}
        if client:
            opts["extractor_args"] = {"youtube": {"player_client": [client]}}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception:
            if client is None:
                raise
            continue
        if first is None:
            first = info
        _wait_available(info)
        if not info.get("url") or _playable(info):
            if client:
                log.info("串流網址改用 %s 才能播：%s", client, info.get("title"))
            return info
    return first


# ---------------------------------------------------------------- 面板按鈕

class PanelView(discord.ui.View):
    def __init__(self, player: "GuildPlayer"):
        super().__init__(timeout=None)
        self.player = player

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        err = _need_same_channel(interaction.user)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return False
        return True

    async def _done(self, interaction: discord.Interaction, action_text: str):
        self.player.last_action = f"{action_text}（{interaction.user.display_name}）"
        await interaction.response.defer()
        await self.player.refresh_panel()

    @discord.ui.button(emoji="⏯️", style=discord.ButtonStyle.secondary)
    async def toggle(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        if p.pause():
            await self._done(interaction, "⏸️ 暫停")
        elif p.resume():
            await self._done(interaction, "▶️ 繼續")
        else:
            await interaction.response.send_message("現在沒有在播放。", ephemeral=True)

    @discord.ui.button(emoji="⏭️", style=discord.ButtonStyle.secondary)
    async def skip(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        title = p.current.title if p.current else ""
        if p.skip():
            await self._done(interaction, f"⏭️ 跳過了「{short(title, 30)}」")
        else:
            await interaction.response.send_message("現在沒有歌可以跳。", ephemeral=True)

    @discord.ui.button(emoji="🔀", style=discord.ButtonStyle.secondary)
    async def shuffle(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        if len(p.queue) < 2:
            await interaction.response.send_message("接下來的歌不到 2 首，不用打亂。", ephemeral=True)
            return
        random.shuffle(p.queue)
        await self._done(interaction, "🔀 打亂佇列")

    @discord.ui.button(emoji="🔉", style=discord.ButtonStyle.secondary, row=1)
    async def vol_down(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._vol(interaction, -VOLUME_STEP)

    @discord.ui.button(emoji="🔊", style=discord.ButtonStyle.secondary, row=1)
    async def vol_up(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._vol(interaction, VOLUME_STEP)

    async def _vol(self, interaction: discord.Interaction, delta: int):
        p = self.player
        new = max(1, min(MAX_VOLUME, p.volume + delta))
        p.set_volume(new)
        await self._done(interaction, f"🔊 音量 {new}%")

    @discord.ui.button(emoji="⏹️", style=discord.ButtonStyle.danger)
    async def stop_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.player.last_action = f"⏹️ {interaction.user.display_name} 停止播放"
        await interaction.response.defer()
        await self.player.stop()


# ---------------------------------------------------------------- 每個伺服器一個播放器

class GuildPlayer:
    def __init__(self, guild: discord.Guild):
        self.guild = guild
        self.queue: list[Track] = []
        self.current: Track | None = None
        self.started_at = 0.0
        self.paused_at = 0.0
        self.text_channel: discord.abc.Messageable | None = None
        self.panel: discord.Message | None = None
        self.view = PanelView(self)
        self.last_action: str | None = None
        self.finished_at: float | None = None
        self.radio = False  # 無限電台：佇列空了就用最後一首當種子，從 YouTube 推薦補歌
        self.shuffle_loop = False  # 隨機循環：佇列空了就從播放紀錄補歌
        self.recent: list[str] = []
        self.resume_offset = 0   # 重啟後接回去時，第一首要從第幾秒開始
        self._next = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._alone_task: asyncio.Task | None = None
        self._ticker: asyncio.Task | None = None
        # 語音頻道狀態：放歌前原本的狀態，播完要還原
        self._status_channel: discord.VoiceChannel | None = None
        self._saved_status: str | None = None
        self._status_saved = False

    @property
    def vc(self) -> discord.VoiceClient | None:
        return self.guild.voice_client

    @property
    def volume(self) -> int:
        return get_volume(self.guild.id)

    def set_volume(self, pct: int) -> None:
        """設定音量（百分比）。正在放的歌馬上生效，之後的歌也套用。"""
        pct = max(1, min(MAX_VOLUME, int(pct)))
        save_volume(self.guild.id, pct)
        src = self.vc.source if self.vc else None
        if isinstance(src, discord.PCMVolumeTransformer):
            src.volume = pct / 100

    @property
    def connected(self) -> bool:
        return bool(self.vc and self.vc.is_connected())

    def elapsed(self) -> int:
        if not self.current:
            return 0
        end = self.paused_at or time.time()
        return int(end - self.started_at)

    def remaining_total(self) -> tuple[int, bool]:
        """接下來佇列總長（秒）、是否有長度未知的（直播）。"""
        total, unknown = 0, False
        for t in self.queue:
            if t.duration:
                total += int(t.duration)
            else:
                unknown = True
        return total, unknown

    async def connect(self, channel: discord.VoiceChannel):
        if self.connected:
            if self.vc.channel.id != channel.id:
                await self.restore_status()
                await self.vc.move_to(channel)
        else:
            await channel.connect(self_deaf=True)

    def ensure_loop(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def announce(self, text: str):
        if self.text_channel:
            try:
                await self.text_channel.send(text, allowed_mentions=discord.AllowedMentions.none())
            except discord.HTTPException:
                pass

    # --- 語音頻道狀態 ---
    async def apply_status(self, text: str):
        ch = self.vc.channel if self.connected else None
        if not isinstance(ch, discord.VoiceChannel) or ch.id in vstatus.manual:
            return
        if not self._status_saved:
            self._saved_status = vstatus.known.get(ch.id)
            self._status_saved = True
            self._status_channel = ch
        err = await vstatus.set_status(ch, text, reason="大笨bot 播放中")
        if err:
            log.info("設定語音狀態失敗：%s", err)

    async def restore_status(self):
        ch = self._status_channel
        if self._status_saved and ch is not None and ch.id not in vstatus.manual:
            await vstatus.set_status(ch, self._saved_status, reason="大笨bot 停止播放，還原狀態")
        self._status_saved = False
        self._status_channel = None

    # --- 面板 ---
    def build_embed(self, left: bool = False, max_list: int = 8) -> discord.Embed:
        if left:
            e = discord.Embed(title="👋 已離開語音頻道", color=COLOR_LEFT,
                              description="要聽歌再用 `/播放` 或直接叫我放～")
            if self.last_action:
                e.set_footer(text=self.last_action)
            return e

        if self.current:
            paused = bool(self.vc and self.vc.is_paused())
            t = self.current
            e = discord.Embed(
                title="⏸️ 暫停中" if paused else "🎶 正在播放",
                color=COLOR_PAUSED if paused else COLOR_PLAYING,
                description=(f"**[{short(t.title, 60)}]({t.url})**\n"
                             f"{progress_bar(self.elapsed(), t.duration)}\n`{fmt_pos(min(self.elapsed(), t.duration or 10**9))}/{fmt_dur(t.duration)}`\n"
                             f"點歌：{t.requester}"),
            )
            if t.thumbnail:
                e.set_thumbnail(url=t.thumbnail)
        else:
            left_sec = IDLE_LEAVE_SECONDS - int(time.time() - (self.finished_at or time.time()))
            e = discord.Embed(
                title="✅ 歌單播完了",
                color=COLOR_DONE,
                description=(f"佇列已經空了。約 {max(1, round(left_sec / 60))} 分鐘內沒有點歌，我就會離開語音頻道。\n"
                             "用 `/播放` 或直接叫我放歌就能繼續。"),
            )

        if self.queue:
            total, unknown = self.remaining_total()
            lines = [f"`{i}.` {short(q.title)}（{fmt_dur(q.duration)}）· {q.requester}"
                     for i, q in enumerate(self.queue[:max_list], 1)]
            if len(self.queue) > max_list:
                lines.append(f"…還有 {len(self.queue) - max_list} 首")
            name = f"接下來（共 {len(self.queue)} 首，約 {fmt_dur(total) if total else '?'}{' + 直播' if unknown else ''}）"
            e.add_field(name=name, value="\n".join(lines)[:1024], inline=False)
        elif self.current:
            e.add_field(name="接下來", value="沒有了，這是最後一首。用 `/播放` 繼續點歌。", inline=False)

        foot = self.last_action or "⏯️ 暫停/繼續　⏭️ 跳過　🔀 隨機　⏹️ 停止"
        if self.radio:
            foot = "📻 無限電台中（/電台 關 可關閉）· " + foot
        if self.shuffle_loop:
            foot = "🎲 隨機循環中（/隨機循環 關 可關閉）· " + foot
        if self.volume != DEFAULT_VOLUME:
            foot = f"🔊 {self.volume}% · " + foot
        e.set_footer(text=foot)
        return e

    def _panel_buried(self) -> bool:
        """面板上面已經有別的新訊息了（被洗上去），就重新貼到最下面。"""
        if self.panel is None or self.text_channel is None:
            return True
        return getattr(self.text_channel, "last_message_id", None) != self.panel.id

    async def show_panel(self, repost: bool = False, left: bool = False):
        if self.text_channel is None:
            return
        embed = self.build_embed(left=left)
        view = None if left else self.view
        if self.panel is not None and not repost:
            try:
                await self.panel.edit(embed=embed, view=view)
                return
            except discord.NotFound:
                self.panel = None
            except discord.HTTPException as e:
                log.info("更新面板失敗：%r", e)
                return
        if self.panel is not None and repost:
            try:
                await self.panel.delete()
            except discord.HTTPException:
                pass
            self.panel = None
        try:
            self.panel = await self.text_channel.send(embed=embed, view=view)
        except discord.HTTPException as e:
            log.info("貼面板失敗：%r", e)

    async def refresh_panel(self):
        if self.panel is not None:
            await self.show_panel()

    async def _tick(self):
        while True:
            await asyncio.sleep(PANEL_REFRESH_SECONDS)
            if self.current and self.vc and self.vc.is_playing():
                await self.refresh_panel()

    # --- 播放迴圈 ---
    async def _loop(self):
        self._ticker = asyncio.create_task(self._tick())
        try:
            while True:
                if not self.queue and self.radio and self.connected:
                    seed = self.recent[-1] if self.recent else (self.current.url if self.current else None)
                    try:
                        picks = await asyncio.to_thread(radio_tracks, seed, REFILL_COUNT, self.recent[-AVOID_RECENT:]) if seed else []
                    except Exception as e:
                        log.warning("電台補歌失敗：%r", e)
                        picks = []
                    if not picks and len(self.recent) > 1:  # 推薦抓不到，換更早的一首當種子
                        try:
                            picks = await asyncio.to_thread(radio_tracks, self.recent[-2], REFILL_COUNT, self.recent[-AVOID_RECENT:])
                        except Exception:
                            picks = []
                    if picks:
                        self.queue.extend(picks)
                    else:
                        self.radio = False
                        if self.text_channel:
                            try:
                                await self.text_channel.send("📻 電台找不到可接的歌，已關閉無限播放。")
                            except discord.HTTPException:
                                pass
                if not self.queue and self.shuffle_loop and self.connected:
                    picks = pick_random(self.guild.id, REFILL_COUNT, self.recent[-AVOID_RECENT:])
                    if picks:
                        self.queue.extend(picks)
                    else:
                        self.shuffle_loop = False
                if not self.queue:
                    # 播完了：還原狀態、面板顯示「播完了」，等一陣子沒人點歌就離開
                    self.current = None
                    self.finished_at = time.time()
                    await self.restore_status()
                    await self.refresh_panel()
                    deadline = time.time() + IDLE_LEAVE_SECONDS
                    last_minute_refresh = time.time()
                    while not self.queue:
                        if time.time() > deadline or not self.connected:
                            if self.connected:
                                await self.vc.disconnect()
                            if not self.last_action or "停止" not in self.last_action:
                                self.last_action = "沒有新的歌，我先離開了"
                            await self.show_panel(left=True)
                            return
                        if time.time() - last_minute_refresh > 60:  # 倒數分鐘數更新
                            last_minute_refresh = time.time()
                            await self.refresh_panel()
                        await asyncio.sleep(2)

                track = self.queue.pop(0)
                self.current = track
                try:
                    info = await asyncio.to_thread(_stream_info, track.url)
                    headers = "".join(f"{k}: {v}\r\n" for k, v in (info.get("http_headers") or {}).items())
                    offset, self.resume_offset = self.resume_offset, 0
                    before = (f"-ss {int(offset)} " if offset > 5 else "") + FFMPEG_BEFORE + (f' -headers "{headers}"' if headers else "")
                    base = await asyncio.to_thread(discord.FFmpegPCMAudio, info["url"], before_options=before, options="-vn")
                    source = discord.PCMVolumeTransformer(base, volume=get_volume(self.guild.id) / 100)  # 這樣才能即時調音量
                except Exception as e:
                    log.warning("無法播放 %s：%r", track.url, e)
                    await self.announce(f"⚠️ 這首放不了，跳過：**{track.title}**（{str(e)[:120]}）")
                    self.current = None
                    continue

                if not self.connected:
                    self.current = None
                    continue  # 回到上面，會走「離開」流程
                self._next.clear()
                loop = asyncio.get_running_loop()

                def after(err):
                    if err:
                        log.warning("播放中斷：%r", err)
                    loop.call_soon_threadsafe(self._next.set)

                self.started_at, self.paused_at = time.time() - (offset if offset > 5 else 0), 0.0
                self.vc.play(source, after=after)
                record_history(self.guild.id, track)
                self.recent = (self.recent + [track.url])[-30:]
                await self.apply_status(f"🎶 {track.title}")
                await self.show_panel(repost=self._panel_buried())
                self.last_action = None
                await self._next.wait()
                self.current = None
        finally:
            if self._ticker:
                self._ticker.cancel()

    # --- 控制 ---
    def skip(self) -> bool:
        if self.vc and (self.vc.is_playing() or self.vc.is_paused()):
            self.vc.stop()  # 觸發 after → 下一首
            return True
        return False

    def pause(self) -> bool:
        if self.vc and self.vc.is_playing():
            self.vc.pause()
            self.paused_at = time.time()
            return True
        return False

    def resume(self) -> bool:
        if self.vc and self.vc.is_paused():
            self.vc.resume()
            self.started_at += time.time() - self.paused_at
            self.paused_at = 0.0
            return True
        return False

    async def stop(self):
        self.shuffle_loop = False
        self.radio = False
        self.queue.clear()
        await self.restore_status()
        if self.vc:
            self.vc.stop()
            await self.vc.disconnect()
        self.current = None
        if self._task is None or self._task.done():  # 迴圈沒在跑就自己把面板改成「已離開」
            await self.show_panel(left=True)

    def remove(self, index: int | None = None, query: str | None = None) -> tuple[list[Track], str | None]:
        """移除佇列裡的歌。index 從 1 開始（跟面板的編號一樣）；query 用歌名關鍵字比對。"""
        if not self.queue:
            return [], "佇列是空的，沒有歌可以移除。"
        if index is not None:
            if not 1 <= index <= len(self.queue):
                return [], f"佇列只有 {len(self.queue)} 首，沒有第 {index} 首。"
            return [self.queue.pop(index - 1)], None
        q = (query or "").strip().lower()
        if not q:
            return [], "要移除第幾首，或是哪首歌？"
        hits = [t for t in self.queue if q in t.title.lower()]
        if not hits:
            words = q.split()
            hits = [t for t in self.queue if words and all(w in t.title.lower() for w in words)]
        if not hits:
            return [], f"佇列裡找不到「{query}」。"
        t = hits[0]
        self.queue.remove(t)
        return [t], None

    def clear(self) -> int:
        n = len(self.queue)
        self.queue.clear()
        return n

    def queue_text(self) -> str:
        """給 AI 看的純文字版（面板是給人看的）。"""
        if not self.connected:
            return "目前沒有在放歌，也不在語音頻道。"
        lines = [f"🔊 音量 {self.volume}%"]
        if self.radio:
            lines.append("📻 無限電台開啟中（佇列空了會自動接相似的歌）。")
        if self.shuffle_loop:
            lines.append("🎲 隨機循環開啟中（佇列空了會自動從播放紀錄補歌）。")
        if self.current:
            state = "⏸️ 暫停中" if self.vc.is_paused() else "▶️ 正在播放"
            lines.append(f"{state}：{self.current.title}（{fmt_pos(self.elapsed())} / {fmt_dur(self.current.duration)}）"
                         f"｜點歌：{self.current.requester}")
        else:
            lines.append("✅ 歌單已經播完了，正在等人點歌（沒人點的話幾分鐘後會離開）。")
        if self.queue:
            total, unknown = self.remaining_total()
            lines.append(f"接下來共 {len(self.queue)} 首，約 {fmt_dur(total) if total else '?'}{' + 直播' if unknown else ''}：")
            for i, t in enumerate(self.queue[:15], 1):
                lines.append(f"{i}. {t.title}（{fmt_dur(t.duration)}）｜{t.requester}")
            if len(self.queue) > 15:
                lines.append(f"…還有 {len(self.queue) - 15} 首")
        elif self.current:
            lines.append("接下來沒有歌了，這是最後一首。")
        return "\n".join(lines)


players: dict[int, GuildPlayer] = {}
_client: discord.Client | None = None


def get_player(guild: discord.Guild) -> GuildPlayer:
    if guild.id not in players:
        players[guild.id] = GuildPlayer(guild)
    return players[guild.id]


# ---------------------------------------------------------------- 重啟後接回去（把播放狀態存檔）

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


# ---------------------------------------------------------------- 共用的動作（指令和 AI 工具都用這些）

async def do_play(member: discord.Member, text_channel, query: str, position: str = "end") -> str:
    """position：end＝排到最後；next＝插到下一首；now＝插隊並立刻播（現在這首被跳過）。"""
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    player = get_player(member.guild)
    if len(player.queue) >= MAX_QUEUE:
        return f"佇列已經有 {MAX_QUEUE} 首了，先聽完一些吧。"
    try:
        tracks, pl_title = await asyncio.to_thread(_resolve, query, member.display_name)
    except Exception as e:
        log.warning("搜尋失敗 %s：%r", query, e)
        return f"找不到或抓不到：{str(e)[:150]}"
    if not tracks:
        return f"YouTube 上找不到「{query}」。"
    return await enqueue_tracks(member, text_channel, tracks, pl_title, position)


async def enqueue_tracks(member: discord.Member, text_channel, tracks: list[Track], pl_title: str | None,
                         position: str = "end") -> str:
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    player = get_player(member.guild)
    if len(player.queue) >= MAX_QUEUE:
        return f"佇列已經有 {MAX_QUEUE} 首了，先聽完一些吧。"
    try:
        await player.connect(member.voice.channel)
    except Exception as e:
        log.exception("連語音頻道失敗")
        return f"進不了語音頻道（{e}），檢查一下我有沒有「連線」和「說話」權限。"
    player.text_channel = text_channel
    was_idle = player.current is None and not player.queue
    room = tracks[: MAX_QUEUE - len(player.queue)]
    if position in ("next", "now") and not was_idle:
        player.queue[0:0] = room  # 插到最前面（整串播放清單也一起插進去，順序不變）
    else:
        player.queue.extend(room)
    skipped = None
    if position == "now" and player.current:
        skipped = player.current.title
        player.last_action = f"⏩ {member.display_name} 插播：{short(room[0].title, 30)}" if room else None
        player.skip()
    player.ensure_loop()
    if player.current:  # 正在放歌：面板的「接下來」馬上更新
        asyncio.create_task(player.refresh_panel())
    where = {"next": "插到下一首", "now": "插播，馬上播"}.get(position, "加入佇列")
    if pl_title or len(tracks) > 1:
        if position in ("next", "now") and not was_idle:
            return f"📃 {where}：播放清單「{pl_title or ''}」共 {len(room)} 首。" + (f"（跳過了「{skipped}」）" if skipped else "")
        return f"📃 加入播放清單「{pl_title or ''}」共 {len(tracks)} 首。"
    t = tracks[0]
    if was_idle:
        return f"▶️ 準備播放：**{t.title}**（{fmt_dur(t.duration)}）"
    if position == "now":
        return f"⏩ 插播：**{t.title}**（{fmt_dur(t.duration)}）" + (f"　（跳過了「{skipped}」）" if skipped else "")
    if position == "next":
        return f"⤴️ 插到下一首：**{t.title}**（{fmt_dur(t.duration)}）"
    return f"➕ 已加入佇列第 {len(player.queue)} 首：**{t.title}**（{fmt_dur(t.duration)}）"


class SearchView(discord.ui.View):
    """搜尋結果：先從選單選一首，再按按鈕決定怎麼放（加到最後／插到下一首／立刻播）。"""

    def __init__(self, owner_id: int, text_channel, tracks: list[Track]):
        super().__init__(timeout=120)
        self.owner_id, self.text_channel, self.tracks = owner_id, text_channel, tracks
        self.chosen: int | None = None
        self.message: discord.Message | None = None
        self.select = discord.ui.Select(
            placeholder="先選一首歌…",
            options=[discord.SelectOption(label=short(t.title, 95), description=fmt_dur(t.duration), value=str(i))
                     for i, t in enumerate(tracks)],
        )
        self.select.callback = self.on_select
        self.add_item(self.select)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message("這是別人的搜尋結果，你可以自己用 `/搜尋`。", ephemeral=True)
            return False
        return True

    async def on_select(self, interaction: discord.Interaction):
        self.chosen = int(self.select.values[0])
        for o in self.select.options:
            o.default = o.value == str(self.chosen)
        await interaction.response.edit_message(view=self)

    async def _go(self, interaction: discord.Interaction, position: str):
        if self.chosen is None:
            await interaction.response.send_message("先從上面的選單選一首。", ephemeral=True)
            return
        await interaction.response.defer()
        text = await enqueue_tracks(interaction.user, self.text_channel, [self.tracks[self.chosen]], None, position)
        self.stop()
        await interaction.edit_original_response(content=text, embed=None, view=None)

    @discord.ui.button(label="加到最後", emoji="➕", style=discord.ButtonStyle.primary, row=1)
    async def b_end(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._go(interaction, "end")

    @discord.ui.button(label="插到下一首", emoji="⤴️", style=discord.ButtonStyle.secondary, row=1)
    async def b_next(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._go(interaction, "next")

    @discord.ui.button(label="立刻播", emoji="⏩", style=discord.ButtonStyle.secondary, row=1)
    async def b_now(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._go(interaction, "now")

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(content="⌛ 搜尋結果過期了，要的話再 `/搜尋` 一次。", embed=None, view=None)
            except discord.HTTPException:
                pass


async def do_volume(member: discord.Member, level: int | None) -> str:
    gid = member.guild.id
    if level is None:
        return f"🔊 目前音量 {get_volume(gid)}%（範圍 1~{MAX_VOLUME}，預設 {DEFAULT_VOLUME}）。"
    level = max(1, min(MAX_VOLUME, int(level)))
    p = players.get(gid)
    if p and p.connected:
        err = _need_same_channel(member)
        if err:
            return err
        p.set_volume(level)
        p.last_action = f"🔊 {member.display_name} 把音量調到 {level}%"
        asyncio.create_task(p.refresh_panel())
        warn = "（超過 100% 可能會破音）" if level > 100 else ""
        return f"🔊 音量 {level}%{warn}"
    save_volume(gid, level)
    return f"🔊 音量先設成 {level}%，下次放歌就會套用。"


def _need_same_channel(member) -> str | None:
    p = players.get(member.guild.id) if getattr(member, "guild", None) else None
    if not p or not p.connected:
        return "我現在沒有在放歌。"
    if not member.voice or member.voice.channel != p.vc.channel:
        return "要跟我在同一個語音頻道才能控制喔。"
    return None


async def do_remove(member: discord.Member, target: str | int | None) -> str:
    err = _need_same_channel(member)
    if err:
        return err
    p = players[member.guild.id]
    index, query = None, None
    if isinstance(target, int):
        index = target
    elif target is not None:
        t = str(target).strip().lstrip("#第").rstrip("首")
        if t.isdigit():
            index = int(t)
        else:
            query = str(target)
    if index is None and query and p.current and query.strip().lower() in p.current.title.lower() \
            and not any(query.strip().lower() in t.title.lower() for t in p.queue):
        return f"「{p.current.title}」是現在正在放的，要跳過請用 /跳過。"
    removed, err = p.remove(index, query)
    if err:
        return err
    p.last_action = f"🗑️ {member.display_name} 移除了「{short(removed[0].title, 30)}」"
    asyncio.create_task(p.refresh_panel())
    return f"🗑️ 從佇列移除：**{removed[0].title}**（剩 {len(p.queue)} 首）"


RADIO_SEEDS = ["周杰倫 晴天", "五月天 倔強", "告五人 披星戴月的想你", "田馥甄 小幸運", "蔡依林 日不落", "Ed Sheeran Shape of You",
               "YOASOBI アイドル", "Official髭男dism Pretender", "Bruno Mars Uptown Funk", "Taylor Swift Shake It Off"]


async def do_radio(member: discord.Member, text_channel, on: bool, seed: str | None = None) -> str:
    """無限電台：不用選歌，一直自動接相似的歌。有給 seed 就先放那首當起點。"""
    if not on:
        p = players.get(member.guild.id)
        if not p or not p.radio:
            return "電台本來就沒開。"
        p.radio = False
        p.last_action = f"📻 {member.display_name} 關閉電台"
        asyncio.create_task(p.refresh_panel())
        return "📻 關閉電台，現有佇列放完就結束。"
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    player = get_player(member.guild)
    msg = ""
    if seed:
        msg = await do_play(member, text_channel, seed, "end")
        if not player.connected:
            return msg
    else:
        try:
            await player.connect(member.voice.channel)
        except Exception as e:
            return f"進不了語音頻道（{e}）。"
        if player.current is None and not player.queue and not player.recent:
            # 沒指定起點、也沒在放歌：直接隨機一首當起點（有播放紀錄就從紀錄挑，沒有就從內建熱門歌挑）
            h = history.get(str(member.guild.id))
            if h:
                player.recent.append(random.choice(h)["url"])
            else:
                msg = await do_play(member, text_channel, random.choice(RADIO_SEEDS), "end")
                if not player.connected:
                    return msg
    player.text_channel = text_channel
    player.radio = True
    player.shuffle_loop = False
    player.last_action = f"📻 {member.display_name} 開啟無限電台"
    player.ensure_loop()
    if player.current:
        asyncio.create_task(player.refresh_panel())
    return ((msg + "\n") if msg else "") + "📻 無限電台開啟：佇列空了會自動接相似的歌，一直放下去。要停就 `/停止` 或 `/電台 關`。"


async def do_random(member: discord.Member, text_channel, on: bool) -> str:
    if not on:
        p = players.get(member.guild.id)
        if not p or not p.shuffle_loop:
            return "隨機循環本來就沒開。"
        p.shuffle_loop = False
        p.last_action = f"🎲 {member.display_name} 關閉隨機循環"
        asyncio.create_task(p.refresh_panel())
        return "🎲 關閉隨機循環，現有佇列放完就結束。"
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    if not history.get(str(member.guild.id)):
        return "還沒有播放紀錄可以隨機，先點幾首歌吧。"
    player = get_player(member.guild)
    try:
        await player.connect(member.voice.channel)
    except Exception as e:
        log.exception("連語音頻道失敗")
        return f"進不了語音頻道（{e}），檢查一下我有沒有「連線」和「說話」權限。"
    player.text_channel = text_channel
    player.shuffle_loop = True
    player.last_action = f"🎲 {member.display_name} 開啟隨機循環"
    if not player.queue and player.current is None:
        player.queue.extend(pick_random(member.guild.id, REFILL_COUNT, player.recent[-AVOID_RECENT:]))
    player.ensure_loop()
    if player.current:
        asyncio.create_task(player.refresh_panel())
    return "🎲 開啟隨機循環：會從播放紀錄隨機挑歌一直放，佇列空了自動補。要停就 `/停止` 或 `/隨機循環 關`。"


async def do_control(member: discord.Member, action: str) -> str:
    if action == "history":
        return history_text(member.guild.id)
    if action == "queue":
        p = players.get(member.guild.id)
        return p.queue_text() if p else "目前沒有在放歌，佇列也是空的。"
    err = _need_same_channel(member)
    if err:
        return err
    p = players[member.guild.id]
    name = member.display_name
    if action == "skip":
        title = p.current.title if p.current else ""
        if not p.skip():
            return "現在沒有歌可以跳。"
        p.last_action = f"⏭️ {name} 跳過了「{short(title, 30)}」"
        return f"⏭️ 跳過：**{title}**"
    if action == "pause":
        if not p.pause():
            return "現在沒有在播放。"
        p.last_action = f"⏸️ {name} 暫停"
        asyncio.create_task(p.refresh_panel())
        return "⏸️ 暫停。"
    if action == "resume":
        if not p.resume():
            return "現在沒有暫停。"
        p.last_action = f"▶️ {name} 繼續播放"
        asyncio.create_task(p.refresh_panel())
        return "▶️ 繼續播放。"
    if action == "stop":
        p.last_action = f"⏹️ {name} 停止播放"
        await p.stop()
        return "⏹️ 停止播放、清空佇列，我離開語音頻道了。"
    if action == "clear":
        n = p.clear()
        if not n:
            return "佇列本來就是空的。"
        p.last_action = f"🧹 {name} 清空了佇列"
        asyncio.create_task(p.refresh_panel())
        return f"🧹 清空佇列，拿掉 {n} 首（現在這首會放完）。"
    if action == "shuffle":
        random.shuffle(p.queue)
        p.last_action = f"🔀 {name} 打亂了佇列"
        asyncio.create_task(p.refresh_panel())
        return f"🔀 把接下來的 {len(p.queue)} 首打亂了。"
    return f"不認識的動作：{action}"


# ---------------------------------------------------------------- AI 工具

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


# ---------------------------------------------------------------- 斜線指令 & 事件

def setup(client: discord.Client, tree: app_commands.CommandTree):
    global _client
    _client = client

    @tree.command(name="播放", description="從 YouTube 放歌（歌名、YouTube 網址或播放清單網址）")
    @app_commands.describe(歌曲="歌名（可加歌手）或 YouTube 網址")
    @app_commands.guild_only()
    async def cmd_play(interaction: discord.Interaction, 歌曲: str):
        await interaction.response.defer(thinking=True)
        await interaction.followup.send(await do_play(interaction.user, interaction.channel, 歌曲))

    @tree.command(name="插播", description="插歌：插到下一首播，或立刻播（跳過現在這首）")
    @app_commands.describe(歌曲="歌名（可加歌手）或 YouTube 網址", 立刻播="開＝馬上播並跳過現在這首；不開＝插到下一首")
    @app_commands.guild_only()
    async def cmd_playnext(interaction: discord.Interaction, 歌曲: str, 立刻播: bool = False):
        await interaction.response.defer(thinking=True)
        await interaction.followup.send(await do_play(interaction.user, interaction.channel, 歌曲, "now" if 立刻播 else "next"))

    @tree.command(name="音量", description="看或調整音量（1~150%，100 是正常；不填就是看現在多少）")
    @app_commands.describe(音量="音量百分比，1~150")
    @app_commands.guild_only()
    async def cmd_volume(interaction: discord.Interaction, 音量: app_commands.Range[int, 1, MAX_VOLUME] = None):
        await interaction.response.send_message(await do_volume(interaction.user, 音量))

    @tree.command(name="搜尋", description="搜 YouTube 列出前 5 首，自己選一首，再決定加到最後／插到下一首／立刻播")
    @app_commands.describe(關鍵字="歌名或關鍵字")
    @app_commands.guild_only()
    async def cmd_search(interaction: discord.Interaction, 關鍵字: str):
        if not interaction.user.voice or not interaction.user.voice.channel:
            await interaction.response.send_message("要先進一個語音頻道，我才知道要去哪裡放。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        try:
            tracks = await asyncio.to_thread(_search, 關鍵字, interaction.user.display_name)
        except Exception as e:
            log.warning("搜尋失敗 %s：%r", 關鍵字, e)
            await interaction.followup.send(f"搜尋失敗：{str(e)[:150]}")
            return
        if not tracks:
            await interaction.followup.send(f"YouTube 上找不到「{關鍵字}」。")
            return
        lines = [f"`{i}.` {short(t.title, 70)}（{fmt_dur(t.duration)}）" for i, t in enumerate(tracks, 1)]
        e = discord.Embed(title=f"🔎 「{short(關鍵字, 40)}」的搜尋結果", description="\n".join(lines), color=COLOR_DONE)
        e.set_footer(text="用下面的選單選一首，再按按鈕決定怎麼放")
        view = SearchView(interaction.user.id, interaction.channel, tracks)
        view.message = await interaction.followup.send(embed=e, view=view, wait=True)

    @tree.command(name="佇列", description="把播放面板叫到最下面：正在放什麼、接下來的歌、播完了沒")
    @app_commands.guild_only()
    async def cmd_queue(interaction: discord.Interaction):
        p = players.get(interaction.guild_id)
        if not p or not p.connected:
            await interaction.response.send_message("目前沒有在放歌，也不在語音頻道。用 `/播放` 開始點歌。", ephemeral=True)
            return
        await interaction.response.send_message("📋 播放面板在下面 👇", ephemeral=True)
        if p.text_channel is None or p.text_channel.id != interaction.channel_id:
            if p.panel is not None:  # 換到這個頻道顯示
                try:
                    await p.panel.edit(view=None)
                except discord.HTTPException:
                    pass
                p.panel = None
            p.text_channel = interaction.channel
        await p.show_panel(repost=True)

    def simple(name, action, desc):
        @tree.command(name=name, description=desc)
        @app_commands.guild_only()
        async def _cmd(interaction: discord.Interaction):
            await interaction.response.send_message(await do_control(interaction.user, action))
        return _cmd

    simple("跳過", "skip", "跳過現在這首")
    simple("暫停", "pause", "暫停播放")
    simple("繼續", "resume", "繼續播放")
    simple("停止", "stop", "停止播放、清空佇列並離開語音頻道")
    simple("隨機", "shuffle", "把佇列裡接下來的歌打亂")
    simple("清空佇列", "clear", "把接下來的歌全部拿掉（現在這首會放完）")

    @tree.command(name="歷史", description="看播放紀錄（最近播過的歌）")
    @app_commands.guild_only()
    async def cmd_history(interaction: discord.Interaction):
        await interaction.response.send_message(history_text(interaction.guild_id), ephemeral=True)

    @tree.command(name="電台", description="無限隨便放：不用選歌，自動接相似的歌一直放（可給起點歌）")
    @app_commands.describe(開關="開 或 關", 起點="從哪首歌開始（不填就接目前這首）")
    @app_commands.choices(開關=[app_commands.Choice(name="開", value="on"), app_commands.Choice(name="關", value="off")])
    @app_commands.guild_only()
    async def cmd_radio(interaction: discord.Interaction, 開關: app_commands.Choice[str] = None, 起點: str = None):
        await interaction.response.defer(thinking=True)
        on = (開關.value if 開關 else "on") == "on"
        await interaction.followup.send(await do_radio(interaction.user, interaction.channel, on, 起點))

    @tree.command(name="隨機循環", description="懶得選歌？從播放紀錄隨機一直放，佇列空了自動補")
    @app_commands.describe(開關="開 或 關")
    @app_commands.choices(開關=[app_commands.Choice(name="開", value="on"), app_commands.Choice(name="關", value="off")])
    @app_commands.guild_only()
    async def cmd_random(interaction: discord.Interaction, 開關: app_commands.Choice[str] = None):
        await interaction.response.defer(thinking=True)
        on = (開關.value if 開關 else "on") == "on"
        await interaction.followup.send(await do_random(interaction.user, interaction.channel, on))

    @tree.command(name="移除", description="從佇列移除某一首歌（編號看播放面板）")
    @app_commands.describe(歌曲="佇列編號（例如 3）或歌名關鍵字")
    @app_commands.guild_only()
    async def cmd_remove(interaction: discord.Interaction, 歌曲: str):
        await interaction.response.send_message(await do_remove(interaction.user, 歌曲))


async def on_voice_state_update(member: discord.Member, before, after):
    client = _client
    p = players.get(member.guild.id)
    if not p:
        return
    if member.id == client.user.id and after.channel is None:
        # 被踢出或斷線：清掉佇列，迴圈會把面板改成「已離開」
        p.queue.clear()
        if p.vc:
            p.vc.stop()
        p._next.set()  # 保險：叫醒卡在「等這首播完」的迴圈
        return
    if not p.connected:
        return
    humans = [uid for uid in p.vc.channel.voice_states if uid != client.user.id]
    if not humans and (p._alone_task is None or p._alone_task.done()):
        async def leave_if_still_alone():
            await asyncio.sleep(ALONE_LEAVE_SECONDS)
            if p.connected and not [u for u in p.vc.channel.voice_states if u != client.user.id]:
                p.last_action = "語音頻道沒人了，我先離開"
                await p.stop()
        p._alone_task = asyncio.create_task(leave_if_still_alone())
