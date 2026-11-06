"""聊天時標記（通知）成員：只能標個人，不能標身分組、@everyone、@here。

流程：模型呼叫 mention_members 找人 → 工具回傳要寫進回覆的 <@id> → 回覆送出時，
只有這一輪找到的人會真的被通知（機器人預設是任何標記都不通知）。
"""

import re
import time

import discord

MAX_PEOPLE = 10
_ALLOWED: dict[int, tuple[float, list[int]]] = {}   # 使用者訊息 id → (時間, 可以通知的成員 id)

TOOL = {
    "type": "function",
    "function": {
        "name": "mention_members",
        "description": "標記（@、通知）伺服器裡的成員，可以一次標好幾個人。只有使用者明確要你標記、點名、叫某些人來時才用；"
                       "只能標個人，不能標身分組、@everyone、@here。呼叫後會回傳每個人的標記文字（<@數字>），"
                       "請把它原樣寫進你的回覆裡，人才會被通知。",
        "parameters": {
            "type": "object",
            "properties": {
                "users": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": f"要標記的成員：顯示名稱、帳號名稱、ID 或使用者訊息裡的 <@數字>，最多 {MAX_PEOPLE} 個",
                },
            },
            "required": ["users"],
        },
    },
}


def _find(guild: discord.Guild, text: str):
    """回傳 (成員, 錯誤)。完全相符優先；只有一人部分符合才算，多人符合要使用者說清楚。"""
    n = text.strip()
    m = re.fullmatch(r"<@!?(\d+)>|(\d{15,25})", n)
    if m:
        member = guild.get_member(int(m.group(1) or m.group(2)))
        return (member, None) if member else (None, f"找不到 ID「{n}」的成員")
    n = n.lstrip("@").strip()
    low = n.lower()
    if not low:
        return None, "名字是空的"
    names = lambda x: (x.display_name.lower(), x.name.lower(), (x.global_name or "").lower())
    exact = [x for x in guild.members if low in names(x)]
    if len(exact) == 1:
        return exact[0], None
    if len(exact) > 1:
        return None, f"「{n}」有 {len(exact)} 個人叫這個名字（{'、'.join(x.display_name for x in exact[:4])}…），請說清楚是誰"
    part = [x for x in guild.members if any(low in v for v in names(x))]
    if len(part) == 1:
        return part[0], None
    if not part:
        return None, f"找不到叫「{n}」的成員"
    return None, f"「{n}」符合好幾個人（{'、'.join(x.display_name for x in part[:4])}…），請說清楚是誰"


async def run(msg: discord.Message | None, args: dict) -> str:
    if msg is None or msg.guild is None:
        return "只有在伺服器裡才能標記人。"
    raw = args.get("users") or []
    if isinstance(raw, str):
        raw = [x for x in re.split(r"[,，、;；\s]+", raw) if x]
    raw = [str(x) for x in raw if str(x).strip()]
    if not raw:
        return "沒有指定要標記誰。"
    if len(raw) > MAX_PEOPLE:
        return f"一次最多標 {MAX_PEOPLE} 個人，你給了 {len(raw)} 個。"
    ok: list[discord.Member] = []
    bad: list[str] = []
    for t in raw:
        member, err = _find(msg.guild, t)
        if member is None:
            bad.append(err)
        elif member.id not in [x.id for x in ok]:
            ok.append(member)
    now = time.time()
    for k in [k for k, (t, _) in _ALLOWED.items() if now - t > 600]:
        _ALLOWED.pop(k, None)
    if ok:
        _ALLOWED[msg.id] = (now, [x.id for x in ok])
    out = []
    if ok:
        out.append("可以標記，請把這些原樣寫進回覆：" + " ".join(x.mention for x in ok))
    if bad:
        out.append("沒標到：" + "；".join(bad) + "。請在回覆裡告訴使用者。")
    return "\n".join(out)


def take(msg_id: int) -> list[int]:
    """送出回覆時取走這一輪可以通知的成員 id。"""
    item = _ALLOWED.pop(msg_id, None)
    return list(item[1]) if item else []
