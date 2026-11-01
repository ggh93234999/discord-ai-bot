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
