"""畫圖：呼叫 LiteLLM（模型在另一台電腦上）的標準 OpenAI 圖片 API：POST /v1/images/generations。

重點（對方那台的限制）：
- 回傳是 base64（data[0].b64_json），沒有網址，要自己解碼成 PNG 再傳到 Discord。
- 一次只能畫一張，多的會排隊；一張要 30 秒～10 分鐘，所以這裡是「背景畫圖」：叫用的人馬上收到「排進去了」，
  畫好再自動貼一則回覆（頻道不會被卡住，也沒有 Discord 互動逾時的問題）。
- 那台沒有內容過濾，過濾在這裡做（check_prompt）。
- 對方在打遊戲等暫停服務時連不上或回錯誤：直接回「畫圖服務目前暫停中」，不重試。
設定（.env，都可省略）：IMAGE_GEN=on|off、IMAGE_BASE_URL、IMAGE_API_KEY（預設沿用 LLM_BASE_URL / LLM_API_KEY）、
IMAGE_MAX_QUEUE（最多排幾張，預設 4）。畫圖／改圖用哪些模型寫在專案根目錄的 image_models.json（見 imagemodels.py）。
"""
import asyncio
import base64
import io
import logging
import os
import re
import tempfile
import time

import aiohttp
import discord
from PIL import Image

from dbot.ai import imagemodels

log = logging.getLogger("bot")

PAUSED_REPLY = "🎨 畫圖服務目前暫停中，晚點再試。"
SIZES = {"square": "768x768", "landscape": "1344x768", "portrait": "768x1344"}
SIZE_NAMES = {"square": "正方形", "landscape": "橫式", "portrait": "直式"}
# 大小：一般（預設）；使用者有特別提到要大張／高解析度才用 large／huge（只有「快速」畫質支援，會比較久）。長寬都要是 16 的倍數。
BIG_SIZES = {
    "large": {"square": "1280x1280", "landscape": "1920x1088", "portrait": "1088x1920"},
    "huge": {"square": "2048x2048", "landscape": "2048x1152", "portrait": "1152x2048"},
}
SCALE_NAMES = {"normal": "一般", "large": "大圖", "huge": "超大圖"}
SCALE_EXTRA_ETA = {"normal": 0, "large": 20, "huge": 70}      # 比一般多等幾秒（實測 2048×2048 約 60 秒）
# 畫質／模型清單來自 image_models.json（選單順序＝檔案順序，第一個是預設）
_CFG = imagemodels.load()
GEN = _CFG["generate"]
EDITS = _CFG["edit"]
QUALITY = GEN
QUALITY_NAMES = {k: v["label"] for k, v in GEN.items()}
HUMAN_ONLY = {k for k, v in GEN.items() if v["human_only"]}      # 只給人在斜線指令選，AI 工具不會用（AI 傳來也會被改回預設）
AI_QUALITIES = [k for k in GEN if k not in HUMAN_ONLY] or list(GEN)
AI_DEFAULT = AI_QUALITIES[0]
DEFAULT_EDIT = next(iter(EDITS))
GALLERY_QUALITIES = _CFG["gallery"]


def _eta_text(eta: int) -> str:
    return f"{round(eta / 60)} 分鐘" if eta >= 300 else f"{eta} 秒"


def gen_choices() -> list[tuple[str, str]]:
    """/畫圖、/智慧畫圖 的畫質選單：[(顯示名稱, 值)]。"""
    return [(f"{v['label']}（約{_eta_text(v['eta']).replace(' ', '')}" + (f"，{v['note']}" if v["note"] else "") + "）", k) for k, v in GEN.items()]


def edit_choices() -> list[tuple[str, str]]:
    return [(f"{v['label']}（約{_eta_text(v['eta']).replace(' ', '')}" + (f"，{v['note']}" if v["note"] else "") + "）", k) for k, v in EDITS.items()]


def edit_key(q) -> str:
    return q if q in EDITS else DEFAULT_EDIT


def _big_quality() -> str | None:
    """支援大圖的畫質（優先 AI 預設那個）。"""
    if GEN[AI_DEFAULT]["big_sizes"]:
        return AI_DEFAULT
    return next((k for k in AI_QUALITIES if GEN[k]["big_sizes"]), None)


def _gen_tool_text() -> str:
    en = [k for k in AI_QUALITIES if GEN[k]["prompt_lang"] != "zh"]
    zh = [k for k in AI_QUALITIES if GEN[k]["prompt_lang"] == "zh"]
    s = "prompt 寫畫面描述：主體、動作、場景、風格、光線、構圖；"
    if en:
        s += f"quality 為 {'、'.join(en)} 時 prompt 請用英文寫（先把使用者的意思翻成英文再描述得具體一點）"
    if zh:
        s += ("；" if en else "") + f"quality 為 {'、'.join(zh)} 時可以直接用中文"
    s += "。quality：預設用 " + AI_DEFAULT + "；" + "；".join(
        f"{k}（{GEN[k]['label']}，約 {_eta_text(GEN[k]['eta'])}）" + (f"：{GEN[k]['hint']}" if GEN[k]["hint"] else "") for k in AI_QUALITIES) + "。"
    return s


def _edit_tool_text() -> str:
    return "edit_quality：" + "；".join(
        f"{k}（{EDITS[k]['label']}，約 {_eta_text(EDITS[k]['eta'])}）" + (f"：{EDITS[k]['hint']}" if EDITS[k]["hint"] else "") for k in EDITS) + f"。預設 {DEFAULT_EDIT}。"


DISCORD_LIMIT = 7_800_000          # 一般伺服器單檔 8MB 上限，留一點空間

TOOL = {
    "type": "function",
    "function": {
        "name": "draw_image",
        "description": (
            "用畫圖模型畫一張圖（插畫、風景、物品、卡通角色、概念圖等）。使用者說「畫一張…」「幫我畫…」「生一張圖」時呼叫。"
            "畫一張要等 30 秒到幾分鐘，畫好後程式會自動貼出來，你呼叫後只要簡短回一句「在畫了」就好，不要說已經畫好、不要描述圖的內容。"
            "【只能在年齡限制（NSFW）頻道使用，在其他頻道呼叫會被程式擋下並回覆說明，你照轉述即可】【不能畫】涉及未成年人的性暗示或色情內容（一律拒絕，不要呼叫工具、也不要偷偷改成類似的東西）；其他都可以畫（任何膚色、種族、國籍、外貌、性別、文化的人物都可以，不要自己加限制或拒絕）。"
            + _gen_tool_text()
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "要畫的畫面描述"},
                "quality": {"type": "string", "enum": AI_QUALITIES, "description": f"畫質／速度，預設 {AI_DEFAULT}"},
                "scale": {"type": "string", "enum": ["normal", "large", "huge"], "description": "圖片大小，預設 normal。只有使用者特別提到要大張／高解析度／高清／2K／4K／壁紙級時才用：large（長邊約 1900 像素）或 huge（長邊 2048 像素，API 上限），會比較久，而且只支援 fast 畫質"},
                "shape": {"type": "string", "enum": ["square", "landscape", "portrait"], "description": "square 正方形（預設）、landscape 橫式（風景、桌布）、portrait 直式（手機桌布、人物全身）"},
            },
            "required": ["prompt"],
        },
    },
}


NSFW_ONLY_REPLY = "🔞 畫圖和改圖只能在「年齡限制（NSFW）」頻道使用，請到 NSFW 頻道再試。"


def nsfw_only() -> bool:
    return os.getenv("IMAGE_NSFW_ONLY", "on").strip().lower() not in ("off", "0", "false", "no")


def channel_ok(channel) -> bool:
    """畫圖／改圖只允許在年齡限制（NSFW）頻道（討論串看上層頻道）。私訊不是 NSFW 頻道，所以也不行。可用 .env 的 IMAGE_NSFW_ONLY=off 關掉這個限制。"""
    if not nsfw_only():
        return True
    try:
        return bool(channel is not None and channel.is_nsfw())
    except Exception:
        return False


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
_busy_users: dict[int, int] = {}          # 每個人目前排著（含正在畫）的張數


def _user_max() -> int:
    return max(1, int(os.getenv("IMAGE_USER_MAX", "3") or 3))
_tasks: set[asyncio.Task] = set()


def _max_queue() -> int:
    return int(os.getenv("IMAGE_MAX_QUEUE", "4") or 4)


def _endpoint(path: str = "generations") -> tuple[str, dict]:
    base = (os.getenv("IMAGE_BASE_URL") or os.getenv("LLM_BASE_URL") or "http://localhost:4000/v1").strip().rstrip("/")
    key = (os.getenv("IMAGE_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    return base + "/images/" + path, ({"Authorization": f"Bearer {key}"} if key else {})


class Paused(Exception):
    """畫圖服務暫停或連不上"""


async def _post(session: aiohttp.ClientSession, path: str, timeout: int, *, json=None, data=None) -> bytes:
    """POST 到圖片 API，回傳圖片位元組。連不上、逾時、伺服器錯誤一律丟 Paused（不重試）。"""
    url, headers = _endpoint(path)
    try:
        async with session.post(url, json=json, data=data, headers=headers,
                                timeout=aiohttp.ClientTimeout(total=timeout, connect=15, sock_connect=15)) as resp:
            body = await resp.json(content_type=None)
            if resp.status >= 500 or resp.status in (404, 408, 429):
                raise Paused(f"HTTP {resp.status}：{str(body)[:200]}")
            if resp.status != 200:
                raise RuntimeError(f"HTTP {resp.status}：{str(body)[:300]}")
    except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as e:
        raise Paused(repr(e)) from e
    item = (body.get("data") or [{}])[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):                       # 規格說只有 base64，這裡保險一下
        async with session.get(item["url"], timeout=aiohttp.ClientTimeout(total=120)) as r:
            return await r.read()
    raise RuntimeError("回傳裡沒有圖片：" + str(body)[:200])


async def generate(session, model: str, prompt: str, size: str, timeout: int) -> bytes:
    return await _post(session, "generations", timeout, json={"model": model, "prompt": prompt, "size": size, "n": 1})


async def edit(session, model: str, prompt: str, images: list[tuple[bytes, str, str]], timeout: int = 900) -> bytes:
    """改圖：POST /images/edits（multipart）。images = [(位元組, 檔名, content_type)]，第一張是主要要改的。size 不填，依第一張的比例。"""
    form = aiohttp.FormData()
    form.add_field("model", model)
    form.add_field("prompt", prompt)
    form.add_field("n", "1")
    for raw, name, ctype in images[:3]:
        form.add_field("image", raw, filename=name, content_type=ctype)
    return await _post(session, "edits", timeout, data=form)


def _to_file(raw: bytes) -> str:
    """驗證是圖片；太大就轉成 JPEG（Discord 單檔有上限）。回傳暫存檔路徑。"""
    img = Image.open(io.BytesIO(raw))
    img.load()
    ext, out = ".png", raw
    if len(raw) > DISCORD_LIMIT:
        rgb, ext = img.convert("RGB"), ".jpg"
        for scale_down, quality in ((1.0, 92), (1.0, 85), (0.8, 85), (0.65, 80), (0.5, 80)):
            im = rgb if scale_down == 1.0 else rgb.resize((int(rgb.width * scale_down), int(rgb.height * scale_down)), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=quality, optimize=True)
            out = buf.getvalue()
            if len(out) <= DISCORD_LIMIT:
                break
    f = tempfile.NamedTemporaryFile(prefix="draw_", suffix=ext, delete=False)
    f.write(out)
    f.close()
    return f.name


# ---------------------------------------------------------------- 對外
def say_for_message(msg: discord.Message):
    """畫好後回覆在原訊息下面（原訊息被刪了就直接發在頻道）。圖片單獨一則訊息，文字另外一則。"""
    async def say(text: str, path: str | None = None):
        first = True
        for kw in ([{"files": [discord.File(path)]}] if path else []) + ([{"content": text}] if text else []):
            try:
                if first:
                    await msg.reply(mention_author=False, **kw)
                else:
                    await msg.channel.send(**kw)
            except discord.HTTPException:
                await msg.channel.send(**kw)
            first = False
    return say


def say_for_interaction(interaction: discord.Interaction):
    async def say(text: str, path: str | None = None):
        if path:
            await interaction.channel.send(file=discord.File(path))
        if text:
            await interaction.channel.send(f"{interaction.user.mention} {text}")
    return say


def tool_status(args: dict) -> str:
    if "quality" not in args and "shape" not in args:
        return f"🎨 排進改圖佇列（約 {EDITS[edit_key(args.get('edit_quality'))]['eta']} 秒）"
    q = args.get("quality") if args.get("quality") in GEN and args.get("quality") not in HUMAN_ONLY else AI_DEFAULT
    sc = args.get("scale") if args.get("scale") in BIG_SIZES else "normal"
    if sc != "normal" and not GEN[q]["big_sizes"]:
        q = _big_quality() or q
    eta = GEN[q]["eta"] + (SCALE_EXTRA_ETA[sc] if GEN[q]["big_sizes"] else 0)
    return f"🎨 排進畫圖佇列（{GEN[q]['label']}，約 {_eta_text(eta)}）" if eta >= 300 else f"🎨 排進畫圖佇列（約 {eta} 秒）"


def prompt_model() -> str:
    """擴寫提示詞用的模型：預設是 LiteLLM 上的 prompt-writer（本機小模型，已內建系統提示詞，跑在 CPU 約 10～30 秒）；image_models.json 的 prompt_writer 可換。"""
    return _CFG["prompt_writer"]


async def expand_prompt(session: aiohttp.ClientSession, idea: str, quality: str = "fast", fallback_model: str = "", lang: str = "en") -> str | None:
    """把一句話擴寫成一段完整的英文畫圖提示詞。prompt-writer 已內建系統提示詞，只要把想法當 user 訊息傳進去。
    失敗（連不上、逾時、回空的）回傳 None，由呼叫的人改用原句。"""
    base = (os.getenv("IMAGE_BASE_URL") or os.getenv("LLM_BASE_URL") or "http://localhost:4000/v1").strip().rstrip("/")
    key = (os.getenv("IMAGE_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    body = {"model": prompt_model(), "max_tokens": 500, "messages": [{"role": "user", "content": idea + ("\n\n（請用繁體中文寫出完整的畫圖提示詞，不要用英文。）" if lang == "zh" else "")}]}
    try:
        async with session.post(base + "/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"} if key else {},
                                timeout=aiohttp.ClientTimeout(total=180, connect=10)) as r:
            data = await r.json(content_type=None)
            if r.status != 200:
                log.warning("擴寫提示詞失敗 HTTP %s：%s", r.status, str(data)[:200])
                return None
        text = (data["choices"][0]["message"].get("content") or "").strip()
    except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, IndexError, ValueError) as e:
        log.warning("擴寫提示詞失敗：%r", e)
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip().strip('"“”').strip()
    return text[:1200] or None


def _enqueue(session, user_id: int, make, label: str, ready: str, eta: int, say, extra: str = "") -> str:
    """共用排隊：make() 回傳要執行的 coroutine（呼叫模型），畫好後 say 貼出。"""
    global _waiting
    if _busy_users.get(user_id, 0) >= _user_max():
        return f"你已經排了 {_user_max()} 張還在處理，等有一張好了再要下一張。"
    if _waiting >= _max_queue():
        return "畫圖排隊的人太多了（目前滿了），晚點再試。"
    ahead = _waiting
    _waiting += 1
    _busy_users[user_id] = _busy_users.get(user_id, 0) + 1
    task = asyncio.create_task(_job(user_id, make, label, say, extra))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    wait = ahead * 40 + eta
    when = f"前面還有 {ahead} 張，" if ahead else ""
    return f"🎨 {ready}：{when}預計約 {max(1, round(wait / 60))} 分鐘，好了會自動貼在這則下面。"


async def submit(session: aiohttp.ClientSession, args: dict, user_id: int, say, source_text: str = "", extra: str = "") -> str:
    """排一張圖。立刻回傳要給模型／使用者看的一句話；圖在背景畫，畫好後呼叫 say(text, path) 貼出。"""
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
    quality = args.get("quality") if args.get("quality") in GEN else AI_DEFAULT
    if quality in HUMAN_ONLY and not args.get("human"):       # 只有斜線指令（人）會帶 human=True
        quality = AI_DEFAULT
    shape = args.get("shape") if args.get("shape") in SIZES else "square"
    scale = args.get("scale") if args.get("scale") in BIG_SIZES else "normal"
    if scale != "normal" and not GEN[quality]["big_sizes"]:      # 這個模型不支援大尺寸：換成支援的畫質，都沒有就用一般大小
        alt = _big_quality()
        if alt:
            quality = alt
        else:
            scale = "normal"
    cfg = GEN[quality]
    model, eta, timeout = cfg["model"], cfg["eta"], cfg["timeout"]
    size = BIG_SIZES[scale][shape] if scale != "normal" else SIZES[shape]
    eta += SCALE_EXTRA_ETA[scale]
    big = "" if scale == "normal" else f"，{SCALE_NAMES[scale]}"
    return _enqueue(session, user_id, lambda: generate(session, model, prompt, size, timeout),
                    f"{QUALITY_NAMES[quality]}・{size.replace('x', '×')}", f"排進畫圖了（{QUALITY_NAMES[quality]}，{SIZE_NAMES[shape]}{big}）", eta, say, extra)


EDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_image",
        "description": (
            "修改使用者給的圖片（改天氣／時間／顏色、加或移除物件、換風格等）。使用者傳了圖片（或回覆一則有圖的訊息）並說「改成…」「把…換成…」「幫我修圖」時呼叫；"
            "要改的圖由程式自動從這則訊息（或被回覆的訊息）的附件取得，你不用處理圖片。畫好要等約 20 秒，你呼叫後只要簡短回一句「在改了」就好。"
            "如果要改的是剛才用 web_image 上網找到的圖（不是使用者傳的附件），use_found 設 true。"
            "prompt 寫「改什麼」，中英文都可以：使用者用中文講就直接用中文（不用翻譯），英文通常更穩定；可加上 \"Keep everything else the same.\"（其他部分維持不變）。" 
            "圖中要加字或改字（招牌、標語、海報字）時，快速模式容易亂碼，這種情況請依 edit_quality 的說明選適合文字的那一種；即使如此也不要保證每個字都完全正確。涉及未成年人的性暗示或色情內容一律拒絕、不呼叫。"
        ),
        "parameters": {
            "type": "object",
            "properties": {"prompt": {"type": "string", "description": "修改指令（中英文皆可）"},
                           "use_found": {"type": "boolean", "description": "true＝改剛才用 web_image 找到的圖，而不是這則訊息的附件"},
                           "edit_quality": {"type": "string", "enum": list(EDITS), "description": _edit_tool_text()}},
            "required": ["prompt"],
        },
    },
}


async def collect_images(msg: discord.Message) -> list[tuple[bytes, str, str]]:
    """取要改的圖：先看這則訊息的附件，沒有就看被回覆的那則（例如回覆機器人剛畫好的圖）。最多 3 張。"""
    atts = [a for a in msg.attachments if (a.content_type or "").startswith("image/")]
    if not atts and msg.reference is not None:
        ref = msg.reference.resolved
        if ref is None and msg.reference.message_id:
            try:
                ref = await msg.channel.fetch_message(msg.reference.message_id)
            except discord.HTTPException:
                ref = None
        if isinstance(ref, discord.Message):
            atts = [a for a in ref.attachments if (a.content_type or "").startswith("image/")]
    out = []
    for a in atts[:3]:
        if a.size and a.size > 20_000_000:
            continue
        out.append((await a.read(), a.filename or "image.png", (a.content_type or "image/png").split(";")[0]))
    return out


async def images_of(m: discord.Message) -> list[tuple[bytes, str, str]]:
    out = []
    for a in [a for a in m.attachments if (a.content_type or "").startswith("image/")][:3]:
        if a.size and a.size > 20_000_000:
            continue
        out.append((await a.read(), a.filename or "image.png", (a.content_type or "image/png").split(";")[0]))
    return out


_LINK_RE = re.compile(r"(?:channels/(?:\d+|@me)/(\d+)/)?(\d{15,25})\s*$")


async def find_images(client: discord.Client, channel, ref: str | None = None, scan: int = 40):
    """/改圖 沒附圖時用：有給訊息連結／ID 就取那則的圖，否則往前找最近一則有圖的訊息（任何人或機器人的都算）。
    回傳 (圖片列表, 說明文字)；找不到時圖片列表是空的。"""
    if ref:
        m = _LINK_RE.search(ref.strip())
        if not m:
            return [], "看不懂這個訊息連結，請在那則訊息上按右鍵／長按 →「複製訊息連結」再貼上。"
        ch = client.get_channel(int(m.group(1))) if m.group(1) else channel
        try:
            msg = await (ch or channel).fetch_message(int(m.group(2)))
        except discord.HTTPException:
            return [], "找不到那則訊息（可能已被刪除，或我看不到那個頻道）。"
        imgs = await images_of(msg)
        return imgs, ("" if imgs else "那則訊息沒有圖片。")
    async for msg in channel.history(limit=scan):
        imgs = await images_of(msg)
        if imgs:
            return imgs, "（用的是頻道裡最近的一張圖）"
    return [], f"最近 {scan} 則訊息裡找不到圖片，請附上圖片，或用 `訊息` 欄位貼那則訊息的連結。"


async def submit_edit(session, prompt: str, images: list, user_id: int, say, source_text: str = "", quality: str = "fast") -> str:
    if not enabled():
        return "畫圖功能目前沒開。"
    prompt = (prompt or "").strip()[:1200]
    if not prompt:
        return "沒有說要怎麼改。"
    if not images:
        return "沒有找到要改的圖片，請把圖片傳上來，或回覆一則有圖的訊息再說要怎麼改。"
    why = check_prompt(prompt, source_text)
    if why:
        log.info("改圖被擋：%s｜%s", why, prompt[:80])
        return why + "（這張沒有改）"
    quality = edit_key(quality)
    cfg = EDITS[quality]
    model = cfg["model"]
    label = "改圖" if quality == DEFAULT_EDIT else f"改圖・{cfg['label']}"
    ref = f"{len(images)} 張參考圖" if len(images) > 1 else ""
    note = "、".join(x for x in (ref, cfg["label"] if quality != DEFAULT_EDIT else "") if x)
    return _enqueue(session, user_id, lambda: edit(session, model, prompt, images), label,
                    f"排進改圖了（{note}）" if note else "排進改圖了", cfg["eta"], say)


async def _job(user_id, make, label, say, extra=""):
    global _waiting
    path = None
    try:
        async with _lock:
            t0 = time.time()
            raw = await make()
            path = await asyncio.to_thread(_to_file, raw)
            took = round(time.time() - t0)
        log.info("圖好了：%s %ds", label, took)
        await say(f"🖼️ 好了（{label}・{took} 秒）{extra}", path)
    except Paused as e:
        log.warning("畫圖服務暫停或連不上：%s", e)
        try:
            await say(PAUSED_REPLY)
        except Exception:
            pass
    except Exception:
        log.exception("畫圖／改圖失敗")
        try:
            await say("🎨 這張處理失敗了，換個說法或換張圖再試一次。")
        except Exception:
            pass
    finally:
        _waiting = max(0, _waiting - 1)
        left = _busy_users.get(user_id, 1) - 1
        if left > 0:
            _busy_users[user_id] = left
        else:
            _busy_users.pop(user_id, None)
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
