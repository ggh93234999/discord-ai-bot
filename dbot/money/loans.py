"""借貸、還款、欠債自動扣款與催債、賺錢（try_earn）。"""

import asyncio
import discord
import json
import paths
import time
from . import account
from .account import (EARN_AMOUNT, EARN_INTERVAL, _acct, _save, balance, fmt, house_add, house_balance, log, wallet)
from .ledger import (GAME_KINDS, QUIET_KINDS, ledger_channel, _bot_party, _ledger, record)

# ---------------------------------------------------------------- 大笨bot 放貸：利率超高
LOAN_RATE = 0.5        # 每天利息 50%，複利（按經過的時間連續算）
LOAN_BASE = 100_000     # 一般最多借多少
LOAN_MAX = 500_000      # 絕對上限：手上錢越多，可借的越多（可借 = 手上的錢，但至少 LOAN_BASE、最多 LOAN_MAX）
LOAN_CAP_MULT = 10     # 欠款最多滾到本金的幾倍就不再增加


def debt_of(gid: int, uid: int) -> int:
    ln = wallet.get(str(gid), {}).get(str(uid), {}).get("loan")
    if not ln:
        return 0
    days = max(0.0, (time.time() - float(ln["t"])) / 86400)
    return min(int(ln["p"] * LOAN_CAP_MULT), int(ln["p"] * (1 + LOAN_RATE) ** days))


def loan_limit(gid: int, uid: int) -> int:
    return min(LOAN_MAX, max(LOAN_BASE, balance(gid, uid)))


def check_borrow(gid: int, uid: int, amount: int) -> str | None:
    """能不能借（不含大笨bot 自己的意願）：不能就回原因。"""
    a = _acct(gid, uid)
    if a.get("loan"):
        return f"你還欠著 {fmt(debt_of(gid, uid))}，先還清才能再借。"
    lim = loan_limit(gid, uid)
    if amount > lim:
        return f"你現在最多只能借 {fmt(lim)}（一般最多 {fmt(LOAN_BASE)}，手上的錢越多可借越多，上限 {fmt(LOAN_MAX)}）。"
    h = house_balance(gid)
    if h is None or h < amount:
        return f"大笨bot 手頭不夠（現在只有 {fmt(h or 0)}），借不出這麼多。"
    return None


loan_judge = None       # bot.py 設定：async (name, amount, coins, bot_coins, reason) -> (同意與否, 大笨bot 的回話)
_loan_ask: dict = {}    # 同一個人 60 秒內只能求一次


def borrow(gid: int, uid: int, name: str, amount: int) -> str | None:
    """成功回 None，失敗回原因。錢從大笨bot 的帳戶出。"""
    err = check_borrow(gid, uid, amount)
    if err:
        return err
    a = _acct(gid, uid, name)
    house_add(gid, -amount)
    a["coins"] = int(a["coins"]) + amount
    a["loan"] = {"p": amount, "t": time.time()}
    _save()
    record(gid, "借款", _bot_party(), (uid, name), amount)
    _schedule_role_sync(gid, uid)
    return None


def repay(gid: int, uid: int, amount: int | None, kind: str = "還款") -> tuple[int, int]:
    """還錢給大笨bot。回傳 (實際還了多少, 還剩多少債)。amount=None 就是盡量還（還清或用光手上的錢）。"""
    a = _acct(gid, uid)
    d = debt_of(gid, uid)
    if not d:
        return 0, 0
    pay = min(d, int(a["coins"]), amount if amount is not None else d)
    if pay <= 0:
        return 0, d
    a["coins"] = int(a["coins"]) - pay
    house_add(gid, pay)
    record(gid, kind, (uid, a.get("name") or str(uid)), _bot_party(), pay)
    left = d - pay
    if left <= 0:
        a.pop("loan", None)
    else:
        a["loan"] = {"p": left, "t": time.time()}      # 剩下的重新從現在起算
    _save()
    _schedule_role_sync(gid, uid)
    return pay, max(0, left)


DEBT_CUT = 0.5                    # 有欠債時，賺到的錢（掛語音、遊戲贏的）先扣這個比例還債
DEBT_ROLE = "欠債人"               # 只要有欠債就掛，還清就拿掉
DEBT_REMIND_HOUR = 20             # 每天幾點（台北時間）在帳本頻道催債
DEBT_REMIND_FILE = paths.record("debt_remind.json")


def deduct_debt(gid: int, uid: int, income: int) -> int:
    """賺到 income 之後，如果有欠債，先扣一部分還債。回傳實際扣了多少（呼叫的人要把餘額減掉這個數）。"""
    if income <= 0 or not debt_of(gid, uid):
        return 0
    cut = int(income * DEBT_CUT)
    if cut <= 0:
        return 0
    pay, _ = repay(gid, uid, cut, kind="自動還款")
    return pay


def _schedule_role_sync(gid: int, uid: int) -> None:
    try:
        guild = account._client.get_guild(int(gid)) if account._client else None
        if guild is not None:
            asyncio.get_running_loop().create_task(_sync_debt_role(guild, int(uid)))
    except RuntimeError:                     # 不在事件迴圈裡（測試時），之後的定時同步會補上
        pass


async def _sync_debt_role(guild, uid: int) -> None:
    try:
        has = debt_of(guild.id, uid) > 0
        role = discord.utils.get(guild.roles, name=DEBT_ROLE)
        if role is None:
            if not has:
                return
            role = await guild.create_role(name=DEBT_ROLE, colour=discord.Colour.dark_red(), reason="有欠大笨bot 的債")
        m = guild.get_member(uid)
        if m is None:
            m = await guild.fetch_member(uid)
        if has and role not in m.roles:
            await m.add_roles(role, reason="欠大笨bot 的債")
        elif not has and role in m.roles:
            await m.remove_roles(role, reason="債還清了")
    except discord.Forbidden:
        log.warning("沒有管理身分組的權限（或「%s」身分組比機器人的身分組高），無法同步欠債身分組", DEBT_ROLE)
    except discord.NotFound:
        pass
    except Exception as ex:
        log.warning("同步欠債身分組失敗：%r", ex)


async def sync_all_debt_roles(guild) -> None:
    debtors = {int(u) for u, a in wallet.get(str(guild.id), {}).items() if a.get("loan") and debt_of(guild.id, int(u)) > 0}
    for uid in debtors:
        await _sync_debt_role(guild, uid)
    role = discord.utils.get(guild.roles, name=DEBT_ROLE)
    if role:
        for m in list(role.members):
            if m.id not in debtors:
                await _sync_debt_role(guild, m.id)


def build_debt_reminder(gid: int) -> str | None:
    now = time.time()
    taken: dict[str, int] = {}
    for x in _ledger():
        if x["gid"] == gid and x["kind"] == "自動還款" and now - x["t"] < 86400:
            taken[x["from"][0]] = taken.get(x["from"][0], 0) + x["amount"]
    rows = []
    for uid, a in wallet.get(str(gid), {}).items():
        ln = a.get("loan")
        d = debt_of(gid, int(uid)) if ln else 0
        if d > 0:
            rows.append((d, uid, ln, taken.get(str(uid), 0)))
    if not rows:
        return None
    rows.sort(reverse=True)
    lines = []
    for d, uid, ln, t in rows[:20]:
        days = max(0.0, (now - float(ln["t"])) / 86400)
        lines.append(f"<@{uid}>　現在欠 **{fmt(d)}**（本金 {fmt(ln['p'])}、滾了 {days:.1f} 天）　今天已自動扣走 **{fmt(t)}**")
    return ("📣 **大笨bot 每日催債**\n" + "\n".join(lines)
            + f"\n\n利息每天 +{int(LOAN_RATE * 100)}%。你們賺的錢（掛語音、遊戲贏的）會先被扣 {int(DEBT_CUT * 100)}% 還債；"
            "想一次還清就用 `/還錢`，或直接跟我說要還錢。還清之前不能借、不能轉帳。")


async def debt_loop(client) -> None:
    await client.wait_until_ready()
    from datetime import datetime
    from zoneinfo import ZoneInfo
    while not client.is_closed():
        try:
            try:
                state = json.loads(DEBT_REMIND_FILE.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError):
                state = {}
            tp = datetime.now(ZoneInfo("Asia/Taipei"))
            today, changed = tp.strftime("%Y-%m-%d"), False
            for guild in client.guilds:
                await sync_all_debt_roles(guild)
                if tp.hour >= DEBT_REMIND_HOUR and state.get(str(guild.id)) != today:
                    text = build_debt_reminder(guild.id)
                    ch = ledger_channel(guild)
                    if text and ch:
                        await ch.send(text[:1990], allowed_mentions=discord.AllowedMentions(users=True))
                        state[str(guild.id)] = today
                        changed = True
            if changed:
                DEBT_REMIND_FILE.write_text(json.dumps(state), encoding="utf-8")
        except Exception:
            log.exception("催債迴圈出錯")
        await asyncio.sleep(600)



def try_earn(gid: int, uid: int, name: str) -> bool:
    a = _acct(gid, uid, name)
    now = time.time()
    if now - a["last"] < EARN_INTERVAL - 1:
        return False
    a["last"] = now
    a["coins"] = int(a["coins"]) + EARN_AMOUNT
    _save()
    deduct_debt(gid, uid, EARN_AMOUNT)
    return True
