"""代幣帳戶核心：錢包存取、格式化、莊家（大笨bot）帳戶。"""

import json
import logging
import paths
import random

log = logging.getLogger("discord-ai-bot.economy")

WALLET_FILE = paths.record("wallet.json")
EARN_AMOUNT = 10          # 每次賺多少
EARN_INTERVAL = 60        # 至少間隔幾秒才能再賺一次
START_COINS = 200         # 新玩家起始代幣
COIN = "🪙"
RNG = random.SystemRandom()   # 賭博用真亂數


wallet: dict = {}


def _load() -> dict:
    try:
        return json.loads(WALLET_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save() -> None:
    try:
        tmp = WALLET_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(wallet, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(WALLET_FILE)
    except OSError as e:
        log.warning("存錢包失敗：%r", e)


wallet = _load()


def _acct(gid: int, uid: int, name: str | None = None) -> dict:
    a = wallet.setdefault(str(gid), {}).setdefault(str(uid), {"coins": START_COINS, "last": 0.0, "name": name or str(uid)})
    if name:
        a["name"] = name
    return a


def balance(gid: int, uid: int) -> int:
    return int(wallet.get(str(gid), {}).get(str(uid), {}).get("coins", START_COINS))


def add(gid: int, uid: int, delta: int, name: str | None = None) -> int:
    a = _acct(gid, uid, name)
    a["coins"] = max(0, int(a["coins"]) + int(delta))
    _save()
    return a["coins"]



def fmt(n: int) -> str:
    return f"{COIN}{n:,}"


# ---- 大笨bot 自己的帳戶（莊家）：Activity 裡玩家輸的錢進它的口袋、贏的從它的口袋出；錢不夠付時帳戶歸零（玩家的彩金照付）。
HOUSE_START = 1_000_000
HOUSE_NAME = "大笨bot"
_client = None


def _house(gid: int):
    if _client is None or _client.user is None:
        return None
    return wallet.setdefault(str(gid), {}).setdefault(str(_client.user.id), {"coins": HOUSE_START, "last": 0.0, "name": HOUSE_NAME, "house": True})


def house_balance(gid: int) -> int | None:
    a = _house(gid)
    return None if a is None else int(a["coins"])


def house_add(gid: int, delta: int) -> int | None:
    a = _house(gid)
    if a is None:
        return None
    a["coins"] = max(0, int(a["coins"]) + int(delta))
    _save()
    return a["coins"]
