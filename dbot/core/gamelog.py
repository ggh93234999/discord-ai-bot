"""遊戲遊玩紀錄：記下成員每天玩了哪些遊戲、各玩多久。.env 的 GAMELOG_USER_ID 填 all＝所有成員（不含機器人），或填使用者 ID（可用逗號放多個）只記這幾個人。

- 只記 Discord 狀態裡「正在玩（Playing）」的項目；音樂（Spotify）、直播、自訂狀態、聆聽、觀看都忽略。
- 靠 on_presence_update 即時記；另外每 60 秒用目前的 presence 校正一次，並寫一次「心跳」，
  漏掉事件或 bot 重啟時才知道最後確定還活著是什麼時候。
- 重啟：沒結束的紀錄，如果距離最後心跳不到 5 分鐘、而且現在還在玩同一個遊戲，就接續；否則用最後心跳時間補結束。
- 同時玩多個遊戲分別記；短於 60 秒的紀錄不留（避免狀態抖動）。
- 存 SQLite（data/records/gamelog.db），時間用 Asia/Taipei。沒設 GAMELOG_USER_ID 就不啟用。

資料表 game_sessions：id、user_id、user_name（記錄當下的暱稱）、game（遊戲名稱）、start、end（還在玩是 NULL）、seconds。
查詢範例：sqlite3 data/records/gamelog.db "select game, round(sum(seconds)/3600.0,1) from game_sessions where start >= date('now','localtime','start of day') group by game"
"""
import asyncio
import logging
import os
import sqlite3
from datetime import datetime

import discord

import paths
from dbot.core.config import TZ

log = logging.getLogger("discord-ai-bot.gamelog")
DB = paths.RECORDS / "gamelog.db"
MIN_SECONDS = 60
HEARTBEAT = 60                 # 秒
RESUME_GAP = 5 * 60            # 重啟後最多隔多久還算「接續同一場」

_RAW = os.getenv("GAMELOG_USER_ID", "").replace(" ", "").lower()
ALL = _RAW in ("all", "*", "everyone")
USERS = {int(x) for x in _RAW.split(",") if x.isdigit()}
_client: discord.Client | None = None
_db: sqlite3.Connection | None = None
_started = False


def enabled() -> bool:
    return ALL or bool(USERS)


def tracked(m: discord.Member) -> bool:
    return not m.bot and (ALL or m.id in USERS)


def _now() -> datetime:
    return datetime.now(TZ).replace(microsecond=0)


def _conn() -> sqlite3.Connection:
    global _db
    if _db is None:
        DB.parent.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(DB)
        _db.executescript("""
            CREATE TABLE IF NOT EXISTS game_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                user_name TEXT,
                game TEXT NOT NULL,
                start TEXT NOT NULL,
                "end" TEXT,
                seconds INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_gs_start ON game_sessions(start);
            CREATE INDEX IF NOT EXISTS idx_gs_open ON game_sessions(user_id) WHERE "end" IS NULL;
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        """)
        if "user_name" not in {r[1] for r in _db.execute("PRAGMA table_info(game_sessions)")}:      # 舊表補欄位
            _db.execute("ALTER TABLE game_sessions ADD COLUMN user_name TEXT")
        _db.commit()
    return _db


def games_of(member: discord.Member | None) -> set[str]:
    """這個成員現在正在玩的遊戲名稱（只看 Playing；離線就是空的）"""
    if member is None or member.status == discord.Status.offline:
        return set()
    out = set()
    for a in member.activities or []:
        if getattr(a, "type", None) == discord.ActivityType.playing and getattr(a, "name", None):
            out.add(a.name.strip())
    return out


def _open_rows(uid: int) -> dict[str, tuple[int, str]]:
    return {g: (i, s) for i, g, s in _conn().execute('SELECT id, game, start FROM game_sessions WHERE user_id=? AND "end" IS NULL', (uid,))}


def _all_open() -> dict[int, dict[str, tuple[int, str]]]:
    out: dict[int, dict[str, tuple[int, str]]] = {}
    for rid, uid, g, s in _conn().execute('SELECT id, user_id, game, start FROM game_sessions WHERE "end" IS NULL'):
        out.setdefault(uid, {})[g] = (rid, s)
    return out


def _tracked_members() -> dict[int, discord.Member]:
    """所有要記的成員（多個伺服器重複的只留一個；已經有「正在玩」資料的那份優先）"""
    out: dict[int, discord.Member] = {}
    if _client is None:
        return out
    for g in _client.guilds:
        for m in g.members:
            if tracked(m) and (m.id not in out or (not games_of(out[m.id]) and games_of(m))):
                out[m.id] = m
    return out


def _close(row_id: int, start_iso: str, end: datetime) -> None:
    start = datetime.fromisoformat(start_iso)
    secs = max(0, int((end - start).total_seconds()))
    db = _conn()
    if secs < MIN_SECONDS:
        db.execute("DELETE FROM game_sessions WHERE id=?", (row_id,))
    else:
        db.execute('UPDATE game_sessions SET "end"=?, seconds=? WHERE id=?', (end.isoformat(), secs, row_id))
    db.commit()


def sync(uid: int, playing: set[str], now: datetime | None = None, name: str = "", opened: dict | None = None) -> None:
    """把資料庫裡「還開著」的紀錄對齊到現在正在玩的遊戲：新的開始、不玩的結束。可重複呼叫（冪等）。opened 可先批次查好傳進來。"""
    now = now or _now()
    if opened is None:
        opened = _open_rows(uid)
    for game, (rid, start) in opened.items():
        if game not in playing:
            _close(rid, start, now)
    for game in playing - set(opened):
        _conn().execute("INSERT INTO game_sessions (user_id, user_name, game, start) VALUES (?,?,?,?)", (uid, name, game, now.isoformat()))
        _conn().commit()
        log.info("開始玩 %s（%s）", game, name or uid)
        _heartbeat(now)                                         # 開新紀錄就馬上寫心跳，bot 在 60 秒內掛掉也有依據


def _heartbeat(now: datetime) -> None:
    _conn().execute("INSERT INTO meta (key, value) VALUES ('heartbeat', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (now.isoformat(),))
    _conn().commit()


def _last_heartbeat() -> datetime | None:
    row = _conn().execute("SELECT value FROM meta WHERE key='heartbeat'").fetchone()
    try:
        return datetime.fromisoformat(row[0]) if row else None
    except ValueError:
        return None


def recover(now: datetime | None = None) -> None:
    """bot 啟動時：處理上次沒結束的紀錄，再依現在的 presence 接續或開新的。"""
    now = now or _now()
    hb = _last_heartbeat()
    members = _tracked_members()
    opened_all = _all_open()
    for uid in set(members) | set(opened_all):
        m = members.get(uid)
        playing = games_of(m)
        opened = opened_all.get(uid, {})
        for game, (rid, start) in list(opened.items()):
            s = datetime.fromisoformat(start)
            alive = hb is not None and hb >= s and (now - hb).total_seconds() <= RESUME_GAP
            if alive and game in playing:
                log.info("重啟後接續 %s（%s）", game, m.display_name if m else uid)
                continue
            end = hb if (hb is not None and hb >= s) else now          # 沒有心跳：用現在補
            _close(rid, start, min(end, now))
            opened.pop(game)
        if playing or opened:
            sync(uid, playing, now, m.display_name if m else "", opened)


def on_presence(after: discord.Member) -> None:
    if tracked(after):
        sync(after.id, games_of(after), name=after.display_name)


async def _loop() -> None:
    while True:
        await asyncio.sleep(HEARTBEAT)
        try:
            now = _now()
            opened_all = _all_open()
            for uid, m in _tracked_members().items():
                playing = games_of(m)
                opened = opened_all.get(uid, {})
                if playing or opened:                              # 沒在玩、也沒有開著的紀錄就不用動
                    sync(uid, playing, now, m.display_name, opened)
            members = _tracked_members()
            for uid, opened in opened_all.items():                 # 紀錄還開著、但人已經不在任何伺服器了：結束掉
                if uid not in members:
                    sync(uid, set(), now, "", opened)
            if _conn().execute('SELECT 1 FROM game_sessions WHERE "end" IS NULL LIMIT 1').fetchone():
                _heartbeat(now)                                    # 有紀錄開著才寫心跳，沒人在玩就不寫
        except Exception:
            log.exception("遊戲紀錄校正失敗")


def start(client: discord.Client) -> None:
    global _client, _started
    if _started or not enabled():
        return
    _client, _started = client, True
    try:
        recover()
    except Exception:
        log.exception("遊戲紀錄：重啟接續失敗")
    client.loop.create_task(_loop())
    log.info("遊戲遊玩紀錄已啟用（%s）", "所有成員" if ALL else f"{len(USERS)} 位使用者")
