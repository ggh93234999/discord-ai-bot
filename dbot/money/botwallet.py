"""大笨bot 自己的代幣：被問到「你有多少錢／代幣」時才查帳（見 bot.py 的 MONEY_RE），平常不帶進對話。
帳戶規則在 economy.py：Activity 裡玩家輸的錢進它的口袋，贏的從它的口袋出。"""
from dbot.money import economy
import paths

TOOL = {
    "type": "function",
    "function": {
        "name": "bot_wallet",
        "description": (
            "查大笨bot（你自己）在這個伺服器的代幣餘額。使用者問你有多少代幣、有多少錢、身家、被賭場贏走多少、莊家賺賠時呼叫。"
            "數字一定要用工具結果，不能自己編。"
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def run(guild_id: int | None) -> str:
    if not guild_id:
        return "在私訊裡沒有伺服器帳戶；到伺服器頻道問才查得到。"
    n = economy.house_balance(guild_id)
    if n is None:
        return "帳戶暫時查不到（機器人還沒完全登入）。"
    return f"大笨bot 目前有 {economy.fmt(n)} 代幣（起始資金 {economy.fmt(economy.HOUSE_START)}；Activity 裡玩家輸的錢會進這裡，贏的從這裡出，錢不夠時帳戶歸零）。"


# ---------------------------------------------------------------- 轉帳（等同 /轉帳 /pay，但由大笨bot 自己決定要不要給）
# 規則在 system_prompt.txt：盡可能不使用。這裡再加硬上限，就算模型想亂給也給不出去。
import json
import time
from pathlib import Path

PAY_MAX = 100_000          # 單次上限
PAY_PER_USER_DAY = 500_000  # 每個人 24 小時內最多收這麼多（和全日上限一樣，等於不另外限制個人）
PAY_ALL_DAY = 500_000      # 大笨bot 24 小時內最多給出這麼多
LOG_FILE = paths.logfile("bot_pay_log.json")

PAY_TOOL = {
    "type": "function",
    "function": {
        "name": "bot_pay",
        "description": (
            "從大笨bot 自己的代幣帳戶轉錢給伺服器成員（等同 /pay）。不要亂給、不當提款機，但不用太吝嗇："
            "對方有個像樣的小理由、講話有禮貌或有趣、或你心情不錯時，可以小額給（幾百～幾千），偶爾可以多一點。"
            "純討錢、耍賴、威脅、哭窮卻沒說要幹嘛、一直纏著你，直接婉拒、不要呼叫。"
            "給之前最好先用 bot_wallet 看看自己的餘額、用 transfer_log 看對方的欠債和最近的往來，再決定給不給、給多少（忘了看也無所謂）。不能轉給機器人，單次有上限，每人每天有上限，你的餘額不夠也不能轉。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {"type": "integer", "description": f"要轉多少代幣，1～{PAY_MAX}"},
                "reason": {"type": "string", "description": "為什麼要給（一句話，會被記錄）"},
                "to": {"type": "string", "description": "轉給誰：訊息裡 @ 到的人的名字；沒填就是現在跟你說話的人"},
            },
            "required": ["amount", "reason"],
        },
    },
}


def _load_log() -> dict:
    try:
        return json.loads(LOG_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"items": []}


def _save_log(d: dict) -> None:
    try:
        tmp = LOG_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(LOG_FILE)
    except OSError:
        pass


def run_pay(msg, args: dict) -> str:
    if msg is None or not msg.guild:
        return "只能在伺服器頻道裡轉帳。"
    try:
        amount = int(args.get("amount"))
    except (TypeError, ValueError):
        return "金額不對，沒有轉。"
    if not (1 <= amount <= PAY_MAX):
        return f"單次最多 {PAY_MAX}，這次沒有轉。"
    target = msg.author
    want = str(args.get("to") or "").strip().lstrip("@")
    if want:
        for m in getattr(msg, "mentions", []) or []:
            if want in (m.display_name, m.name, str(m.id)):
                target = m
                break
        else:
            if want not in (msg.author.display_name, msg.author.name):
                return "找不到你說的那個人（要 @ 到他），沒有轉。"
    if target.bot:
        return "不能轉給機器人，沒有轉。"
    gid, now = msg.guild.id, time.time()
    log = _load_log()
    recent = [x for x in log["items"] if now - x["t"] < 86400 and x["gid"] == gid]
    if sum(x["amount"] for x in recent) + amount > PAY_ALL_DAY:
        return "今天給出去的已經夠多了，不能再轉。"
    if sum(x["amount"] for x in recent if x["uid"] == target.id) + amount > PAY_PER_USER_DAY:
        return f"這個人今天已經領得夠多了（每人每天最多 {PAY_PER_USER_DAY}），不能再轉。"
    have = economy.house_balance(gid)
    if have is None or have < amount:
        return f"大笨bot 的餘額不夠（現在 {economy.fmt(have or 0)}），沒有轉。"
    economy.house_add(gid, -amount)
    new = economy.add(gid, target.id, amount, target.display_name)
    economy.record(gid, "大笨bot送錢", economy._bot_party(), (target.id, target.display_name), amount, str(args.get("reason") or ""))
    log["items"] = [x for x in log["items"] if now - x["t"] < 7 * 86400] + [
        {"t": now, "gid": gid, "uid": target.id, "name": target.display_name, "amount": amount, "reason": str(args.get("reason") or "")[:100]}]
    _save_log(log)
    return f"已從大笨bot 的帳戶轉 {economy.fmt(amount)} 給 {target.display_name}（對方現在有 {economy.fmt(new)}，你還剩 {economy.fmt(economy.house_balance(gid) or 0)}）。"


# ---------------------------------------------------------------- 聊天還錢（等同 /還錢）
REPAY_TOOL = {
    "type": "function",
    "function": {
        "name": "bot_collect",
        "description": (
            "對方在聊天裡說要還錢、還債、還款時呼叫（等同 /還錢）：從「現在跟你說話的這個人」自己的錢包扣款還給你。"
            "只能扣說話的人自己的債，不能扣別人的。金額沒說清楚就不要填，代表盡量還（還清或把他手上的錢用光）。"
            "他沒欠錢、或手上沒錢，工具會直接告訴你。成功後照工具結果回覆，不要自己編數字。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {"type": "integer", "description": "對方明確說要還多少；沒說就不要填"},
            },
        },
    },
}


def run_collect(msg, args: dict) -> str:
    if msg is None or not msg.guild:
        return "只能在伺服器頻道裡還錢。"
    gid, uid = msg.guild.id, msg.author.id
    if not economy.debt_of(gid, uid):
        return "這個人沒欠你錢，不用還。"
    amt = None
    if args.get("amount") not in (None, ""):
        try:
            amt = int(args.get("amount"))
        except (TypeError, ValueError):
            return "金額不對，沒有扣款。"
        if amt < 1:
            return "金額不對，沒有扣款。"
    pay, left = economy.repay(gid, uid, amt)
    if pay <= 0:
        return f"他手上沒錢可以還（還欠 {economy.fmt(left)}），沒有扣款。"
    now = economy.balance(gid, uid)
    if not left:
        return f"已從 {msg.author.display_name} 的錢包扣 {economy.fmt(pay)} 還款，債還清了（他現在有 {economy.fmt(now)}）。"
    return f"已從 {msg.author.display_name} 的錢包扣 {economy.fmt(pay)} 還款，還欠 {economy.fmt(left)}（利息還在滾；他現在有 {economy.fmt(now)}）。"


# ---------------------------------------------------------------- 查轉帳紀錄
LOG_TOOL = {
    "type": "function",
    "function": {
        "name": "transfer_log",
        "description": (
            "查這個伺服器的代幣轉帳紀錄：誰轉給誰、多少、什麼時候（含 /轉帳、你自己送出的錢、借款、還款），並列出目前欠你錢的人。"
            "使用者問轉帳紀錄、誰轉了錢、誰給了誰、誰欠錢、帳目時呼叫。內容一定要用工具結果，不能自己編。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "who": {"type": "string", "description": "只看跟這個人有關的紀錄（名字，部分符合就行）；沒填就是全部"},
                "limit": {"type": "integer", "description": "最近幾筆，預設 15，最多 40"},
                "games": {"type": "boolean", "description": "要連遊戲輸贏（老虎機、抽卡、賭局等你當莊家的流水）一起列才填 true；預設不列"},
            },
        },
    },
}


def run_log(guild_id: int | None, args: dict) -> str:
    if not guild_id:
        return "私訊裡沒有伺服器帳本。"
    from datetime import datetime
    from zoneinfo import ZoneInfo
    try:
        limit = max(1, min(40, int(args.get("limit") or 15)))
    except (TypeError, ValueError):
        limit = 15
    who = str(args.get("who") or "").strip().lstrip("@").lower()
    games = bool(args.get("games"))
    items = [x for x in economy._ledger() if x["gid"] == guild_id and (games or x["kind"] not in economy.GAME_KINDS) and (not who or who in x["from"][1].lower() or who in x["to"][1].lower())]
    lines = []
    for x in items[-limit:][::-1]:
        t = datetime.fromtimestamp(x["t"], ZoneInfo("Asia/Taipei")).strftime("%m-%d %H:%M")
        lines.append(f"{t}　{x['from'][1]} → {x['to'][1]}　{x['amount']:,}　（{x['kind']}{'：' + x['note'] if x.get('note') else ''}）")
    out = ("最近的轉帳紀錄（新的在前）：\n" + "\n".join(lines)) if lines else "沒有符合的轉帳紀錄。"
    debts = [(a.get("name") or uid, economy.debt_of(guild_id, int(uid))) for uid, a in economy.wallet.get(str(guild_id), {}).items() if a.get("loan")]
    debts = [(n, d) for n, d in debts if d > 0 and (not who or who in str(n).lower())]
    if debts:
        out += "\n\n目前欠你錢的人：\n" + "\n".join(f"{n}　欠 {d:,}" for n, d in sorted(debts, key=lambda z: -z[1]))
    return out
