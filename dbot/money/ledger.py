"""帳本：轉帳紀錄、帳本頻道發文、賭博彙整。"""

import asyncio
import discord
import json
import paths
import time
from . import account
from .account import (HOUSE_NAME, log)

# ---------------------------------------------------------------- 轉帳紀錄（大笨bot 查帳用）
LEDGER_FILE = paths.logfile("transfers.json")
LEDGER_KEEP = 12000
NO_HOUSE_WHY = ("鍛造", "種菜", "抽卡")      # 不是賭博的玩法：錢不經過大笨bot 的帳戶，也不記帳本
GAME_KINDS = ("遊戲結算", "遊戲派彩")      # 機器人當莊家的輸贏；查帳預設不列，避免蓋掉真正的轉帳
QUIET_KINDS = GAME_KINDS + ("自動還款",)      # 這些不逐筆發帳本頻道（自動還款改成每日催債時一起報）


def _ledger() -> list:
    try:
        return json.loads(LEDGER_FILE.read_text(encoding="utf-8")).get("items", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def record(gid: int, kind: str, frm: tuple, to: tuple, amount: int, note: str = "") -> None:
    """記一筆錢的移動。frm / to 是 (id, 名字)。kind：轉帳／發錢／借款／還款／大笨bot送錢。"""
    try:
        items = _ledger()
        items.append({"t": time.time(), "gid": gid, "kind": kind, "from": [str(frm[0]), frm[1]], "to": [str(to[0]), to[1]], "amount": int(amount), "note": note[:100]})
        tmp = LEDGER_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"items": items[-LEDGER_KEEP:]}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(LEDGER_FILE)
    except OSError as e:
        log.warning("記轉帳紀錄失敗：%r", e)
    if kind not in QUIET_KINDS:
        _post_ledger(gid, kind, frm, to, amount, note)


LEDGER_CHANNEL_FILE = paths.record("ledger_channels.json")   # {伺服器ID: 頻道ID}；沒設定的伺服器就不寫帳本


def _channel_cfg() -> dict:
    try:
        return json.loads(LEDGER_CHANNEL_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def set_ledger_channel(gid: int, channel_id: int | None) -> None:
    """設定（或用 None 關閉）這個伺服器的帳本頻道。"""
    cfg = _channel_cfg()
    if channel_id is None:
        cfg.pop(str(gid), None)
    else:
        cfg[str(gid)] = int(channel_id)
    LEDGER_CHANNEL_FILE.write_text(json.dumps(cfg), encoding="utf-8")


def ledger_channel(guild):
    """這個伺服器設定的帳本頻道；沒設定、頻道被刪就回 None（不寫帳本）。"""
    cid = _channel_cfg().get(str(guild.id))
    return guild.get_channel(int(cid)) if cid else None


def _post_ledger(gid: int, kind: str, frm: tuple, to: tuple, amount: int, note: str) -> None:
    """把這筆轉帳也發到伺服器的「大笨bot的帳本」文字頻道（找不到頻道、沒權限就算了，不影響轉帳）。遊戲輸贏太多，不發。"""
    try:
        guild = account._client.get_guild(int(gid)) if account._client else None
        if guild is None:
            return
        ch = ledger_channel(guild)
        if ch is None:
            return
        icon = {"轉帳": "💸", "發錢": "🎁", "借款": "🦈", "還款": "💰", "大笨bot送錢": "🎀"}.get(kind, "🪙")
        text = f"{icon} **{kind}**　{frm[1]} → {to[1]}　🪙{int(amount):,}" + (f"\n> {note}" if note else "")
        loop = asyncio.get_running_loop()
        loop.create_task(_send_ledger(ch, text))
    except Exception as ex:                              # 帳本頻道的問題不能拖累轉帳
        log.warning("發帳本頻道失敗：%r", ex)


GAME_DIGEST_EVERY = 10 * 60            # 賭博類每隔多久彙整一次發到帳本頻道
GAME_DIGEST_FILE = paths.record("game_digest.json")


def _digest_state() -> dict:
    try:
        return json.loads(GAME_DIGEST_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def build_game_digest(gid: int, since: float, until: float) -> str | None:
    """把這段時間的遊戲輸贏（老虎機、抽卡、賭局…）彙整成一則訊息；沒有就回 None。"""
    nets: dict[str, list] = {}
    bot_net = 0
    for x in _ledger():
        if x["gid"] != gid or x["kind"] not in GAME_KINDS or not (since < x["t"] <= until):
            continue
        if x["kind"] == "遊戲結算" and x["to"][1] == HOUSE_NAME:       # 玩家 → 莊家
            who, d = x["from"], -x["amount"]
        elif x["from"][1] == HOUSE_NAME:                               # 莊家 → 玩家
            who, d = x["to"], x["amount"]
        else:
            continue
        # 用使用者 ID 分組：同一個人在 Discord 和 Activity 的顯示名字可能不同
        r = nets.setdefault(str(who[0]), [0, 0, who[1]])
        r[0] += d
        r[1] += 1
        r[2] = who[1]
        bot_net -= d
    if not nets:
        return None
    from datetime import datetime
    from zoneinfo import ZoneInfo
    f = lambda t: datetime.fromtimestamp(t, ZoneInfo("Asia/Taipei")).strftime("%m-%d %H:%M")
    rows = sorted(nets.items(), key=lambda kv: -abs(kv[1][0]))
    lines = [f"{'🔺' if n > 0 else '🔻' if n < 0 else '➖'} {nm}　{n:+,}　（{c} 筆）" for _, (n, c, nm) in rows[:15]]
    if len(rows) > 15:
        lines.append(f"…還有 {len(rows) - 15} 人")
    return (f"🎰 **賭博／遊戲彙整**　{f(since) if since else '起'} ~ {f(until)}\n" + "\n".join(lines)
            + f"\n大笨bot 這段時間 **{bot_net:+,}**（玩家 🔺 贏、🔻 輸）")


async def game_digest_loop(client) -> None:
    await client.wait_until_ready()
    while not client.is_closed():
        await asyncio.sleep(600)
        try:
            state, now, changed = _digest_state(), time.time(), False
            for guild in client.guilds:
                last = float(state.get(str(guild.id), 0))
                if last and now - last < GAME_DIGEST_EVERY - 30:
                    continue
                if not last:                                   # 第一次：從現有的遊戲紀錄開始算，並等滿一個週期再發
                    gt = [x["t"] for x in _ledger() if x["gid"] == guild.id and x["kind"] in GAME_KINDS]
                    if not gt or now - min(gt) < GAME_DIGEST_EVERY:
                        continue
                text = build_game_digest(guild.id, last, now)
                state[str(guild.id)] = now
                changed = True
                ch = ledger_channel(guild)
                if text and ch:
                    await ch.send(text[:1990], allowed_mentions=discord.AllowedMentions.none())
            if changed:
                GAME_DIGEST_FILE.write_text(json.dumps(state), encoding="utf-8")
        except Exception:
            log.exception("賭博彙整迴圈出錯")


async def _send_ledger(ch, text: str) -> None:
    try:
        await ch.send(text, allowed_mentions=discord.AllowedMentions.none())
    except Exception as ex:
        log.warning("帳本頻道送出失敗：%r", ex)


def _bot_party() -> tuple:
    return (account._client.user.id if account._client and account._client.user else 0, HOUSE_NAME)
