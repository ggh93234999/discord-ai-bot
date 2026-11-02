"""歌曲資料：常數、Track、播放紀錄、設定、搜尋與解析（yt-dlp）、響度測量。"""

from dataclasses import dataclass, field
import asyncio
import json
import os
import paths
import random
import re
import time
import yt_dlp
import logging
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

HISTORY_FILE = paths.logfile("play_history.json")
SETTINGS_FILE = paths.record("music_settings.json")
STATE_FILE = paths.record("music_state.json")   # 正在播的歌與佇列（機器人重啟後靠它接回去）
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


# ---------------------------------------------------------------- 音量平衡
# 每首歌開播前先量一小段的響度（LUFS），算出要加減多少 dB 讓大家差不多大聲。
NORMALIZE = os.getenv("MUSIC_NORMALIZE", "1") != "0"
TARGET_LUFS = float(os.getenv("MUSIC_TARGET_LUFS", "-16"))
_gain_cache: dict[str, float] = {}


async def measure_gain(url: str, stream_url: str, headers: str, duration) -> float | None:
    """回傳要加的 dB（可為負）；量不到就回 None（照原音量播）。"""
    if not NORMALIZE:
        return None
    if url in _gain_cache:
        return _gain_cache[url]
    seek = ["-ss", "20"] if duration and duration >= 120 else []
    cmd = ["ffmpeg", "-hide_banner", "-nostats", *seek, "-t", "40"]
    if headers:
        cmd += ["-headers", headers]
    cmd += ["-i", stream_url, "-vn", "-af", "ebur128", "-f", "null", "-"]
    try:
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        _, err = await asyncio.wait_for(proc.communicate(), timeout=20)
    except Exception as e:
        log.info("量音量失敗，照原音量播：%r", e)
        try:
            proc.kill()
        except Exception:
            pass
        return None
    m = re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", err.decode("utf-8", "ignore"))
    if not m:
        return None
    gain = max(-12.0, min(9.0, TARGET_LUFS - float(m[-1])))
    _gain_cache[url] = gain
    if len(_gain_cache) > 500:
        _gain_cache.pop(next(iter(_gain_cache)))
    log.info("音量平衡：%s 響度 %s LUFS → 調整 %+.1f dB", url[-24:], m[-1], gain)
    return gain
