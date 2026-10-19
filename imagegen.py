"""畫圖：呼叫 LiteLLM（模型在另一台電腦上）的標準 OpenAI 圖片 API：POST /v1/images/generations。

重點（對方那台的限制）：
- 回傳是 base64（data[0].b64_json），沒有網址，要自己解碼成 PNG 再傳到 Discord。
- 一次只能畫一張，多的會排隊；一張要 30 秒～10 分鐘，所以這裡是「背景畫圖」：叫用的人馬上收到「排進去了」，
  畫好再自動貼一則回覆（頻道不會被卡住，也沒有 Discord 互動逾時的問題）。
- 那台沒有內容過濾，過濾在這裡做（check_prompt）。
- 對方在打遊戲等暫停服務時連不上或回錯誤：直接回「畫圖服務目前暫停中」，不重試。
設定（.env，都可省略）：IMAGE_GEN=on|off、IMAGE_BASE_URL、IMAGE_API_KEY（預設沿用 LLM_BASE_URL / LLM_API_KEY）、
IMAGE_MODEL_FAST / IMAGE_MODEL_CLEAN / IMAGE_MODEL_HIGH、IMAGE_DAILY_LIMIT（每人每天張數，預設 15）、IMAGE_MAX_QUEUE（最多排幾張，預設 4）。
"""
import asyncio
import base64
import io
import logging
import os
import re
import tempfile
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import aiohttp
import discord
from PIL import Image

log = logging.getLogger("bot")
TZ = ZoneInfo(os.getenv("TZ_NAME", "Asia/Taipei"))

PAUSED_REPLY = "🎨 畫圖服務目前暫停中，晚點再試。"
SIZES = {"square": "768x768", "landscape": "1344x768", "portrait": "768x1344"}
SIZE_NAMES = {"square": "正方形", "landscape": "橫式", "portrait": "直式"}
# 畫質 → (環境變數名, 預設模型, 預估秒數, HTTP 逾時秒數)
QUALITY = {
    "fast": ("IMAGE_MODEL_FAST", "draw-klein", 30, 900),
    "clean": ("IMAGE_MODEL_CLEAN", "draw-qwen-fast", 100, 900),
    "high": ("IMAGE_MODEL_HIGH", "draw-flux", 600, 1800),
}
QUALITY_NAMES = {"fast": "快速", "clean": "構圖與文字較乾淨", "high": "最高畫質"}
DISCORD_LIMIT = 7_800_000          # 一般伺服器單檔 8MB 上限，留一點空間

TOOL = {
    "type": "function",
    "function": {
        "name": "draw_image",
        "description": (
            "用畫圖模型畫一張圖（插畫、風景、物品、卡通角色、概念圖等）。使用者說「畫一張…」「幫我畫…」「生一張圖」時呼叫。"
            "畫一張要等 30 秒到幾分鐘，畫好後程式會自動貼出來，你呼叫後只要簡短回一句「在畫了」就好，不要說已經畫好、不要描述圖的內容。"
            "【不能畫】涉及未成年人的性暗示或色情內容（一律拒絕，不要呼叫工具、也不要偷偷改成類似的東西）；其他都可以畫。"
            "prompt 寫畫面描述：主體、動作、場景、風格、光線、構圖；quality 為 fast 或 high 時 prompt 請用英文寫（先把使用者的意思翻成英文再描述得具體一點），"
            "quality 為 clean 時可以直接用中文。"
            "quality：預設用 fast（約 30 秒）；畫面裡要有清楚的文字（招牌、標語、海報字）或複雜構圖用 clean（約 100 秒）；"
            "只有使用者明確說要「高畫質」「最高畫質」「畫質最好」才用 high（約 10 分鐘，很久）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "要畫的畫面描述"},
                "quality": {"type": "string", "enum": ["fast", "clean", "high"], "description": "畫質／速度，預設 fast"},
                "shape": {"type": "string", "enum": ["square", "landscape", "portrait"], "description": "square 正方形（預設）、landscape 橫式（風景、桌布）、portrait 直式（手機桌布、人物全身）"},
            },
            "required": ["prompt"],
        },
    },
}


def enabled() -> bool:
    return os.getenv("IMAGE_GEN", "on").strip().lower() not in ("off", "0", "false", "no")


# ---------------------------------------------------------------- 內容過濾（那台沒有過濾；依主人要求，只擋涉及未成年人的性內容）
_SEX = re.compile(
    r"裸|露點|露奶|乳頭|乳暈|胸部走光|陰莖|陰道|陰部|生殖器|性交|做愛|交配|口交|自慰|強暴|性愛|性感內衣|情趣|色情|成人向|限制級|18禁|"
    r"nsfw|nude|naked|topless|porn|hentai|erotic|sex|genital|nipple|penis|vagina|lingerie|fetish|bdsm|explicit|lewd|ecchi|cum\b|orgasm", re.I)
_MINOR = re.compile(
    r"未成年|小孩|孩子|兒童|幼童|幼女|幼兒|少女|少年|小學生|國中生|高中生|蘿莉|正太|學生妹|女童|男童|嬰兒|"
    r"\b(child|children|kid|kids|minor|underage|loli|lolita|shota|toddler|teen|teenager|schoolgirl|schoolboy|young girl|young boy|preteen)\b", re.I)
_REAL = re.compile(
    r"換臉|deepfake|真人照|真人肖像|本人照片|的肖像|長得像|看起來像.{0,6}(本人|真人|明星)|"
    r"\b(photo of|portrait of|picture of|photograph of|looks? like|likeness of|face of|deepfake)\b.{0,40}\b(president|prime minister|minister|senator|celebrity|actor|actress|singer|politician)\b|"
    r"習近平|川普|拜登|普丁|蔡英文|賴清德|柯文哲|韓國瑜|金正恩|馬斯克|"
    r"\b(trump|biden|putin|xi jinping|obama|musk|zelensky|taylor swift|elon)\b", re.I)
_GORE = re.compile(r"斷頭|肢解|分屍|開膛|血腥屍體|屍體特寫|真實.{0,4}(車禍|命案)|\b(gore|dismember|decapitat|mutilat|real corpse)\b", re.I)


def check_prompt(*texts: str) -> str | None:
    """回傳拒絕原因（要直接講給使用者聽的話）；沒問題回傳 None。只靠關鍵字，擋不了所有情況，模型那邊也有被告知不能畫這些。"""
    t = " ".join(x for x in texts if x)
    if _SEX.search(t) and _MINOR.search(t):
        return "這個我不能畫（涉及未成年人的不當內容）。"
    return None


# ---------------------------------------------------------------- 排隊與限額
_lock = asyncio.Lock()                      # 對方一次只畫一張，這邊也一張一張送
_waiting = 0                                # 目前在排隊（含正在畫）的張數
_busy_users: set[int] = set()
_daily: dict[tuple[int, str], int] = {}
_tasks: set[asyncio.Task] = set()


def _limits() -> tuple[int, int]:
    return int(os.getenv("IMAGE_DAILY_LIMIT", "15") or 15), int(os.getenv("IMAGE_MAX_QUEUE", "4") or 4)


def _today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def _endpoint() -> tuple[str, dict]:
    base = (os.getenv("IMAGE_BASE_URL") or os.getenv("LLM_BASE_URL") or "http://localhost:4000/v1").strip().rstrip("/")
    key = (os.getenv("IMAGE_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    return base + "/images/generations", ({"Authorization": f"Bearer {key}"} if key else {})


class Paused(Exception):
    """畫圖服務暫停或連不上"""


async def generate(session: aiohttp.ClientSession, model: str, prompt: str, size: str, timeout: int) -> bytes:
    """回傳 PNG／JPEG 位元組。連不上、逾時、伺服器錯誤一律丟 Paused（不重試）。"""
    url, headers = _endpoint()
    body = {"model": model, "prompt": prompt, "size": size, "n": 1}
    try:
        async with session.post(url, json=body, headers=headers,
                                timeout=aiohttp.ClientTimeout(total=timeout, connect=15, sock_connect=15)) as resp:
            data = await resp.json(content_type=None)
            if resp.status >= 500 or resp.status in (404, 408, 429):
                raise Paused(f"HTTP {resp.status}：{str(data)[:200]}")
            if resp.status != 200:
                raise RuntimeError(f"HTTP {resp.status}：{str(data)[:300]}")
    except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as e:
        raise Paused(repr(e)) from e
    item = (data.get("data") or [{}])[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):                       # 規格說只有 base64，這裡保險一下
        async with session.get(item["url"], timeout=aiohttp.ClientTimeout(total=120)) as r:
            return await r.read()
    raise RuntimeError("回傳裡沒有圖片：" + str(data)[:200])


def _to_file(raw: bytes) -> str:
    """驗證是圖片；太大就轉成 JPEG（Discord 單檔有上限）。回傳暫存檔路徑。"""
    img = Image.open(io.BytesIO(raw))
    img.load()
    ext, out = ".png", raw
    if len(raw) > DISCORD_LIMIT:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=90, optimize=True)
        ext, out = ".jpg", buf.getvalue()
    f = tempfile.NamedTemporaryFile(prefix="draw_", suffix=ext, delete=False)
    f.write(out)
    f.close()
    return f.name


# ---------------------------------------------------------------- 對外
def say_for_message(msg: discord.Message):
    """畫好後回覆在原訊息下面（原訊息被刪了就直接發在頻道）。"""
    async def say(text: str, path: str | None = None):
        files = [discord.File(path)] if path else []
        try:
            await msg.reply(text, files=files, mention_author=False)
        except discord.HTTPException:
            await msg.channel.send(text, files=files)
    return say


def say_for_interaction(interaction: discord.Interaction):
    async def say(text: str, path: str | None = None):
        files = [discord.File(path)] if path else []
        await interaction.channel.send(f"{interaction.user.mention} {text}", files=files)
    return say


def tool_status(args: dict) -> str:
    q = args.get("quality") if args.get("quality") in QUALITY else "fast"
    return f"🎨 排進畫圖佇列（約 {QUALITY[q][2] if q != 'high' else 10} {'秒' if q != 'high' else '分鐘'}）"


async def submit(session: aiohttp.ClientSession, args: dict, user_id: int, say, source_text: str = "") -> str:
    """排一張圖。立刻回傳要給模型／使用者看的一句話；圖在背景畫，畫好後呼叫 say(text, path) 貼出。"""
    global _waiting
    if not enabled():
        return "畫圖功能目前沒開。"
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        return "沒有說要畫什麼。"
    prompt = prompt[:1200]
    why = check_prompt(prompt, source_text)
    if why:
        log.info("畫圖被擋：%s｜%s", why, prompt[:80])
        return why + "（這張沒有畫）"
    quality = args.get("quality") if args.get("quality") in QUALITY else "fast"
    shape = args.get("shape") if args.get("shape") in SIZES else "square"
    env_name, default_model, eta, timeout = QUALITY[quality]
    model = os.getenv(env_name, default_model).strip() or default_model
    daily, max_queue = _limits()
    day = (user_id, _today())
    if user_id in _busy_users:
        return "你上一張還在畫，等它畫好再要下一張。"
    if _daily.get(day, 0) >= daily:
        return f"你今天已經畫了 {daily} 張，明天再來吧。"
    if _waiting >= max_queue:
        return "畫圖排隊的人太多了（目前滿了），晚點再試。"
    ahead = _waiting
    _waiting += 1
    _busy_users.add(user_id)
    _daily[day] = _daily.get(day, 0) + 1
    task = asyncio.create_task(_job(session, user_id, day, model, prompt, SIZES[shape], timeout, quality, shape, say))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    wait = (ahead * 40) + (eta if quality != "high" else eta)
    when = f"前面還有 {ahead} 張，" if ahead else ""
    return (f"🎨 排進畫圖了（{QUALITY_NAMES[quality]}，{SIZE_NAMES[shape]}）：{when}預計約 "
            f"{max(1, round(wait / 60))} 分鐘，畫好會自動貼在這則下面。")


async def _job(session, user_id, day, model, prompt, size, timeout, quality, shape, say):
    global _waiting
    path = None
    try:
        async with _lock:
            t0 = time.time()
            raw = await generate(session, model, prompt, size, timeout)
            path = await asyncio.to_thread(_to_file, raw)
            took = round(time.time() - t0)
        log.info("畫好了：%s %s %ds", model, size, took)
        await say(f"🖼️ 畫好了（{QUALITY_NAMES[quality]}・{size.replace('x', '×')}・{took} 秒）", path)
    except Paused as e:
        log.warning("畫圖服務暫停或連不上：%s", e)
        _daily[day] = max(0, _daily.get(day, 1) - 1)          # 沒畫成不算額度
        try:
            await say(PAUSED_REPLY)
        except Exception:
            pass
    except Exception as e:
        log.exception("畫圖失敗")
        _daily[day] = max(0, _daily.get(day, 1) - 1)
        try:
            await say("🎨 這張畫失敗了，換個說法再試一次。")
        except Exception:
            pass
    finally:
        _waiting = max(0, _waiting - 1)
        _busy_users.discard(user_id)
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
