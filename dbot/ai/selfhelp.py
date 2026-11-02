"""讓大笨bot 知道自己有什麼功能、有哪些 Activity 小遊戲：查 GUIDE.md（功能手冊）。
手冊每個「## 主題」有「關鍵字：」「一句話：」等欄位；這裡用關鍵字比對找最相關的幾段，不用向量庫。"""
import re
from pathlib import Path

GUIDE = Path(__file__).resolve().parents[2] / "GUIDE.md"
SKIP = ("目錄",)
MAX_CHARS = 3500
MAX_SECTIONS = 3

TOOL = {
    "type": "function",
    "function": {
        "name": "bot_help",
        "description": (
            "查「大笨bot 自己」有什麼功能、有哪些指令、Discord Activity 裡有哪些小遊戲、各遊戲怎麼玩、借錢／帳本等規則。"
            "有人問你會什麼、能做什麼、有什麼指令、有什麼遊戲／活動、某個遊戲或功能怎麼玩時呼叫。"
            "topic 填關鍵字（例如「麻將」「借錢」「音樂」「種菜」「有什麼遊戲」）；不填就回傳所有主題清單。回答一定要用工具結果，不要自己編。"
        ),
        "parameters": {
            "type": "object",
            "properties": {"topic": {"type": "string", "description": "想查的功能或遊戲關鍵字；不填列出全部主題"}},
        },
    },
}


def _sections() -> list[dict]:
    """切成 [{title, keywords, brief, body}]。"""
    try:
        text = GUIDE.read_text(encoding="utf-8")
    except OSError:
        return []
    out = []
    for part in re.split(r"(?m)^## ", text)[1:]:
        title, _, body = part.partition("\n")
        title, body = title.strip(), body.strip().rstrip("-").strip()
        if title in SKIP:
            continue
        kw = re.search(r"關鍵字：(.+)", body)
        brief = re.search(r"一句話：(.+)", body)
        out.append({
            "title": title,
            "keywords": [k.strip().lower() for k in re.split(r"[、,，]", kw.group(1)) if k.strip()] if kw else [],
            "brief": brief.group(1).strip() if brief else "",
            "body": body,
        })
    return out


def _terms(q: str) -> list[str]:
    q = q.lower()
    ts = re.findall(r"[a-z0-9]+", q)
    for run in re.findall(r"[一-鿿]+", q):
        ts += [run] if len(run) <= 2 else [run[i:i + 2] for i in range(len(run) - 1)] + [run]
    return [t for t in dict.fromkeys(ts) if t]


def run(args: dict) -> str:
    secs = _sections()
    if not secs:
        return "功能手冊暫時讀不到。"
    topic = str((args or {}).get("topic") or "").strip()
    if not topic or re.fullmatch(r".{0,6}(會什麼|能做什麼|會做什麼|有什麼功能|所有功能|全部功能|功能列表|功能|指令列表).{0,4}", topic):
        return "我的功能主題（再用 topic 指定想查哪一個）：\n" + "\n".join(f"- {s['title']}：{s['brief']}" for s in secs)
    ts = _terms(topic)
    scored = []
    for s in secs:
        title, body = s["title"].lower(), s["body"].lower()
        score = 0
        for t in ts:
            if t in title:
                score += 6
            score += sum(5 for k in s["keywords"] if t in k or (len(k) >= 2 and k in topic.lower()))
            score += min(body.count(t), 3)
        if score:
            scored.append((score, s))
    if not scored:
        return f"手冊裡找不到「{topic}」。不確定就老實說，或不帶 topic 再查一次看主題清單。\n主題：" + "、".join(s["title"] for s in secs)
    scored.sort(key=lambda z: -z[0])
    out, left = [], MAX_CHARS
    for _, s in scored[:MAX_SECTIONS]:
        chunk = f"【{s['title']}】\n{s['body']}"[:left]
        out.append(chunk)
        left -= len(chunk)
        if left < 300:
            break
    return "\n\n".join(out)
