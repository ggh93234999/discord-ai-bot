"""讓大笨bot 知道自己有什麼功能、有哪些 Activity 小遊戲：直接查 README 的功能章節（不用向量庫，關鍵字比對就夠）。"""
import re
from pathlib import Path

README = Path(__file__).resolve().parents[2] / "README.md"
TOP = ("什麼時候會回", "功能", "常用指令", "代幣系統", "Discord Activity")     # 只收這幾章（架設、檔案說明那些不是給使用者的）
MAX_CHARS = 3000

TOOL = {
    "type": "function",
    "function": {
        "name": "bot_help",
        "description": (
            "查「大笨bot 自己」有什麼功能、有哪些指令、Discord Activity 裡有哪些小遊戲、各遊戲怎麼玩。"
            "有人問你會什麼、能做什麼、有什麼指令、有什麼遊戲／活動、某個遊戲怎麼玩、某功能怎麼用時呼叫。"
            "topic 填關鍵字（例如「麻將」「借錢」「音樂」「種菜」）；不填就回傳所有主題清單。回答一定要用工具結果，不要自己編。"
        ),
        "parameters": {
            "type": "object",
            "properties": {"topic": {"type": "string", "description": "想查的功能或遊戲關鍵字；不填列出全部主題"}},
        },
    },
}


def _sections() -> list[tuple[str, str]]:
    """切成 (標題, 內文)；只保留 TOP 那幾章底下的 ## / ### 段落。"""
    try:
        lines = README.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out, cur, body, keep = [], None, [], False
    for ln in lines + ["## __end__"]:
        m = re.match(r"(#{2,3}) (.+)", ln)
        if m:
            if cur and keep:
                out.append((cur, "\n".join(body).strip()))
            cur, body = m.group(2).strip(), []
            if len(m.group(1)) == 2:
                keep = any(cur.startswith(t) for t in TOP)
            elif cur.startswith("部署"):
                keep = False
            continue
        body.append(ln)
    return out


def _terms(q: str) -> list[str]:
    q = q.lower()
    ts = re.findall(r"[a-z0-9]+", q)
    for run in re.findall(r"[一-鿿]+", q):
        ts += [run] if len(run) <= 2 else [run[i:i + 2] for i in range(len(run) - 1)]
    return [t for t in ts if t]


def run(args: dict) -> str:
    secs = _sections()
    if not secs:
        return "功能說明暫時讀不到。"
    topic = str((args or {}).get("topic") or "").strip()
    if not topic:
        return "我的功能主題（再用 topic 指定想查哪一個）：\n" + "\n".join(f"- {h}" for h, _ in secs)
    ts = _terms(topic)
    scored = []
    for h, b in secs:
        hl, bl = h.lower(), b.lower()
        s = sum(5 for t in ts if t in hl) + sum(min(bl.count(t), 5) for t in ts)
        if s:
            scored.append((s, h, b))
    if not scored:
        return f"說明裡找不到「{topic}」。可以不帶 topic 再查一次看主題清單；真的沒有就老實說你不確定。\n主題：" + "、".join(h for h, _ in secs)
    scored.sort(key=lambda z: -z[0])
    out, left = [], MAX_CHARS
    for _, h, b in scored[:3]:
        chunk = f"【{h}】\n{b}"[:left]
        out.append(chunk)
        left -= len(chunk)
        if left < 200:
            break
    return "\n\n".join(out)
