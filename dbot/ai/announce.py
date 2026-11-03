"""用大笨bot 發公告：對 bot 說「幫我在 #公告 發公告…」，可以 @everyone／@身分組，也可以排程定時發。

安全：只有「伺服器管理員（管理員或管理伺服器權限）」或機器人擁有者能發、能取消排程，這個檢查在程式裡做，不交給 AI 判斷。
排程存在 state["announcements"]，bot 重啟後還在；每 20 秒檢查一次有沒有到時間的。
"""
import asyncio
import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import discord

from dbot.core import models

log = logging.getLogger("discord-ai-bot.announce")
TZ = timezone(timedelta(hours=8))          # 台北時間
_state: dict = {}
_save = lambda: None  # noqa: E731
_client: discord.Client | None = None
_started = False
GOLD = 0xE0B84B

TOOL = {
    "type": "function",
    "function": {
        "name": "announce",
        "description": (
            "用大笨bot 的名義在某個文字頻道發公告（漂亮的卡片），可 @everyone／@here／@某身分組，也可以排程定時發。"
            "只有伺服器管理員能用，權限由程式檢查。"
            "action=send 發公告（預設；有 when 或 delay_minutes 就是排程）；action=list 列出還沒發的排程；action=cancel 用 id 取消排程。"
            "發之前如果使用者沒給標題或內容，先問清楚；內容照使用者的原意，不要自己加料或改寫。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["send", "list", "cancel"], "description": "預設 send"},
                "channel": {"type": "string", "description": "要發到哪個文字頻道（名稱）；省略就是目前這個頻道"},
                "title": {"type": "string", "description": "公告標題（可省略）"},
                "content": {"type": "string", "description": "公告內容，照使用者的原話"},
                "mention": {"type": "string", "description": "要提及誰：none（預設）、everyone、here、身分組名稱、成員名稱（或使用者訊息裡的 <@ID>）；可以多個，用逗號隔開，例如「小明, 小華, 管理組」"},
                "when": {"type": "string", "description": "排程時間，台北時間，格式 YYYY-MM-DD HH:MM；不排程就省略"},
                "delay_minutes": {"type": "integer", "description": "幾分鐘後發（和 when 擇一）"},
                "id": {"type": "string", "description": "cancel 用：排程的 id"},
            },
        },
    },
}


def setup(client: discord.Client, state: dict, save) -> None:
    global _client, _state, _save
    _client, _state, _save = client, state, save


def _list() -> list[dict]:
    return _state.setdefault("announcements", [])


async def _allowed(msg: discord.Message) -> bool:
    if await models.is_admin(msg.author.id):
        return True
    m = msg.author if isinstance(msg.author, discord.Member) else (msg.guild.get_member(msg.author.id) if msg.guild else None)
    return bool(m and (m.guild_permissions.administrator or m.guild_permissions.manage_guild))


def _find_channel(guild: discord.Guild, name: str | None, fallback):
    if not name:
        return fallback
    n = name.strip().lstrip("#").lower()
    for c in guild.text_channels:
        if c.name.lower() == n or str(c.id) == n:
            return c
    for c in guild.text_channels:
        if n in c.name.lower():
            return c
    return None


def _role(guild: discord.Guild, name: str):
    n = name.strip().lstrip("@").lower()
    return next((r for r in guild.roles if r.name.lower() == n), None) or next((r for r in guild.roles if n and n in r.name.lower()), None)


def _member(guild: discord.Guild, name: str):
    n = name.strip().lstrip("@")
    digits = "".join(ch for ch in n if ch.isdigit())
    if digits and (n.startswith("<") or n.isdigit()):
        return guild.get_member(int(digits))
    low = n.lower()
    for m in guild.members:
        if low in (m.display_name.lower(), m.name.lower(), (m.global_name or "").lower()):
            return m
    return next((m for m in guild.members if low and low in m.display_name.lower()), None)


def _mention_parts(guild: discord.Guild, mention: str | None):
    """mention 可以是多個，用逗號或頓號隔開：everyone、here、身分組名稱、成員名稱／@成員／ID。回傳 (文字, AllowedMentions, 錯誤)"""
    items = [x.strip() for x in re.split(r"[,，、;；\n]+", mention or "") if x.strip()]
    items = [x for x in items if x.lower() not in ("none", "無", "不用", "不提及")]
    if not items:
        return "", discord.AllowedMentions.none(), None
    texts, roles, users, every = [], [], [], False
    need_everyone = "我沒有「提及 @everyone、@here 和所有身分組」權限，請到 伺服器設定 → 身分組 → 大笨bot 打開。"
    for it in items:
        low = it.lower().lstrip("@")
        if low in ("everyone", "全體", "所有人", "here"):
            if not guild.me.guild_permissions.mention_everyone:
                return "", None, need_everyone
            texts.append("@here" if low == "here" else "@everyone"); every = True
            continue
        r = _role(guild, it)
        if r is not None:
            if not (r.mentionable or guild.me.guild_permissions.mention_everyone):
                return "", None, f"身分組「{r.name}」不允許被提及，我也沒有「提及全部身分組」的權限。"
            texts.append(r.mention); roles.append(r)
            continue
        m = _member(guild, it)
        if m is None:
            return "", None, f"找不到叫「{it}」的身分組或成員。"
        texts.append(m.mention); users.append(m)
    return " ".join(texts), discord.AllowedMentions(everyone=every, roles=roles, users=users), None


async def _post(guild: discord.Guild, ch, title: str, content: str, mention: str, by: str) -> str | None:
    text, am, err = _mention_parts(guild, mention)
    if err:
        return err
    perms = ch.permissions_for(guild.me)
    if not (perms.view_channel and perms.send_messages and perms.embed_links):
        return f"我在 {ch.mention} 沒有發言或嵌入連結的權限。"
    emb = discord.Embed(title=("📢 " + title) if title else "📢 公告", description=content, color=GOLD, timestamp=datetime.now(timezone.utc))
    emb.set_footer(text=f"由 {by} 發布")
    try:
        await ch.send(content=text or None, embed=emb, allowed_mentions=am)
    except discord.HTTPException as e:
        return f"發送失敗：{str(e)[:120]}"
    return None


def _when(args: dict) -> float | None | str:
    """回傳排程的時間戳；沒排程回 None；格式錯回錯誤字串"""
    if args.get("delay_minutes"):
        try:
            return time.time() + max(1, int(args["delay_minutes"])) * 60
        except (TypeError, ValueError):
            return "delay_minutes 要是數字。"
    w = (args.get("when") or "").strip()
    if not w:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(w, fmt).replace(tzinfo=TZ).timestamp()
        except ValueError:
            pass
    return "時間格式要是 YYYY-MM-DD HH:MM（台北時間）。"


def _fmt(ts: float) -> str:
    return datetime.fromtimestamp(ts, TZ).strftime("%m/%d %H:%M")


async def run(msg: discord.Message, args: dict) -> str:
    if msg is None or not msg.guild:
        return "公告只能在伺服器裡發。"
    if not await _allowed(msg):
        return "只有伺服器管理員（有「管理員」或「管理伺服器」權限）能發公告。"
    guild, act = msg.guild, args.get("action") or "send"
    mine = [a for a in _list() if a["gid"] == guild.id]
    if act == "list":
        if not mine:
            return "目前沒有排程中的公告。"
        return "排程中的公告：\n" + "\n".join(f"- `{a['id']}` {_fmt(a['at'])} → <#{a['ch']}> @{a['mention']}｜{a['title'] or a['content'][:20]}" for a in sorted(mine, key=lambda a: a["at"]))
    if act == "cancel":
        a = next((x for x in mine if x["id"] == (args.get("id") or "").strip()), None)
        if not a:
            return "找不到這個 id 的排程（先用 list 看）。"
        _list().remove(a); _save()
        return f"已取消排程：{a['title'] or a['content'][:20]}"
    content = (args.get("content") or "").strip()
    if not content:
        return "公告內容是空的，請使用者給內容。"
    if len(content) > 3800:
        return "公告太長了（上限約 3800 字）。"
    ch = _find_channel(guild, args.get("channel"), msg.channel)
    if ch is None or not isinstance(ch, discord.abc.Messageable):
        return f"找不到叫「{args.get('channel')}」的文字頻道。"
    title = (args.get("title") or "").strip()[:200]
    mention = (args.get("mention") or "none").strip()
    _, _, err = _mention_parts(guild, mention)
    if err:
        return err
    at = _when(args)
    if isinstance(at, str):
        return at
    by = msg.author.display_name
    if at is None:
        err = await _post(guild, ch, title, content, mention, by)
        return err or f"✅ 已在 {ch.mention} 發出公告。"
    if at < time.time() + 30:
        return "排程時間要在 30 秒之後。"
    a = {"id": uuid.uuid4().hex[:6], "gid": guild.id, "ch": ch.id, "title": title, "content": content, "mention": mention, "at": at, "by": by, "uid": msg.author.id}
    _list().append(a); _save()
    return f"⏰ 已排程：{_fmt(at)}（台北時間）在 {ch.mention} 發公告，id `{a['id']}`（要取消就說這個 id）。"


async def _loop() -> None:
    while True:
        await asyncio.sleep(20)
        try:
            now = time.time()
            for a in [x for x in _list() if x["at"] <= now]:
                _list().remove(a); _save()                        # 先移除再發，避免重複發
                g = _client.get_guild(a["gid"])
                ch = g.get_channel(a["ch"]) if g else None
                if ch is None:
                    log.warning("排程公告 %s 的頻道不見了，丟掉", a["id"])
                    continue
                err = await _post(g, ch, a["title"], a["content"], a["mention"], a["by"])
                if err:
                    log.warning("排程公告 %s 發不出去：%s", a["id"], err)
                    try:
                        u = await _client.fetch_user(a["uid"])
                        await u.send(f"你排程的公告（{a['title'] or a['content'][:20]}）發不出去：{err}")
                    except Exception:
                        pass
        except Exception:
            log.exception("排程公告檢查失敗")


def start() -> None:
    global _started
    if _started or _client is None:
        return
    _started = True
    _client.loop.create_task(_loop())
