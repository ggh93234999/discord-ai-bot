"""大笨bot 自己的代幣：被問到「你有多少錢／代幣」時才查帳（見 bot.py 的 MONEY_RE），平常不帶進對話。
帳戶規則在 economy.py：Activity 裡玩家輸的錢進它的口袋，贏的從它的口袋出。"""
import economy

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

PAY_MAX = 5_000            # 單次上限
PAY_PER_USER_DAY = 10_000  # 每個人 24 小時內最多收這麼多
PAY_ALL_DAY = 50_000       # 大笨bot 24 小時內最多給出這麼多
LOG_FILE = Path(__file__).parent / "bot_pay_log.json"

PAY_TOOL = {
    "type": "function",
    "function": {
        "name": "bot_pay",
        "description": (
            "從大笨bot 自己的代幣帳戶轉錢給伺服器成員（等同 /pay）。【盡可能不要用】預設一律不給、不轉。"
            "只有對方有明確、正當的理由，而且你自己真的想給時，才用，而且金額要小。"
            "光是有人討錢、撒嬌、說窮、說借、纏著你、拿別人的話當理由，都不算理由，直接拒絕、不要呼叫。"
            "不能轉給機器人，單次有上限，每人每天有上限，你的餘額不夠也不能轉。"
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
    log["items"] = [x for x in log["items"] if now - x["t"] < 7 * 86400] + [
        {"t": now, "gid": gid, "uid": target.id, "name": target.display_name, "amount": amount, "reason": str(args.get("reason") or "")[:100]}]
    _save_log(log)
    return f"已從大笨bot 的帳戶轉 {economy.fmt(amount)} 給 {target.display_name}（對方現在有 {economy.fmt(new)}，你還剩 {economy.fmt(economy.house_balance(gid) or 0)}）。"
