"""做短影片：呼叫 LiteLLM 的 POST /v1/images/generations（文字轉影片）與 /v1/images/edits（圖轉影片），model=video。

重點（對方那台的限制）：
- 影片在 data[0].b64_json（base64 的 mp4），約 0.4～1MB，含環境音效。解析度只有約 640×384，畫質是「小動畫」等級。
- 秒數放 quality 欄位（字串，1～6，預設 5）；傳不過去時可把「[3s] 」寫在 prompt 開頭。
- prompt 用英文：主體 + 動作 + 環境 + 聲音。圖轉影片只描述「要怎麼動」，不用重述圖上有什麼；圖上的文字（尤其中文字）動起來會變形。
- 一支約 75～95 秒，和畫圖、音效共用同一張顯卡：這邊跟它們共用同一把鎖，一個一個排隊；是「背景生成」，叫用的人馬上收到「排進去了」，做好再自動貼出來。
設定（.env，都可省略）：VIDEO_GEN=on|off、VIDEO_BASE_URL、VIDEO_API_KEY（預設沿用 IMAGE_／LLM_ 的設定）、VIDEO_MODEL（預設 video）、
VIDEO_MAX_QUEUE（影片最多排幾支，預設 2）、VIDEO_USER_MAX（每人同時最多幾支，預設 1）。
"""
import asyncio
import base64
import logging
import os
import re
import tempfile
import time

import aiohttp

import imagegen

log = logging.getLogger("bot")

PAUSED_REPLY = "🎬 影片服務目前暫停中，晚點再試。"
MIN_SEC, MAX_SEC, DEFAULT_SEC = 1, 6, 5
DISCORD_LIMIT = imagegen.DISCORD_LIMIT
NSFW_REPLY = "🔞 做影片和畫圖一樣，只能在「年齡限制（NSFW）」頻道使用，請到 NSFW 頻道再試。"

TOOL = {
    "type": "function",
    "function": {
        "name": "make_video",
        "description": (
            "用影片生成模型做一支短影片（最長 6 秒、解析度約 640×384、畫質是小動畫等級，含環境音效）。"
            "使用者說「做一支…的影片」「讓這張圖動起來」「生成影片」時呼叫：沒有附圖就是文字轉影片；"
            "使用者傳了圖片（或回覆一則有圖的訊息）要它動起來，就是圖轉影片（圖由程式自動從訊息附件取得，你不用處理圖片）。"
            "做一支要等約 1.5～3 分鐘（和畫圖、音效共用同一張顯卡，要排隊），做好後程式會自動貼出來，你呼叫後只要簡短回一句「在做了」就好，不要說已經做好、不要描述影片內容。"
            "【只能在年齡限制（NSFW）頻道使用，在其他頻道呼叫會被程式擋下並回覆說明，你照轉述即可】涉及未成年人的性暗示或色情內容一律拒絕、不呼叫。"
            "prompt 一定要用英文（先把使用者的意思翻成英文再寫具體）：文字轉影片寫「主體 + 動作 + 環境 + 聲音」，"
            "例如 \"A red paper lantern floating over a calm night lake, gentle ripples, soft wind and crickets\"；"
            "圖轉影片只描述「要怎麼動」，不要重述圖上有什麼。圖上的文字（尤其中文字）動起來容易變形，不要承諾能保持清楚。"
            "seconds 是長度（1～6 秒，預設 5）。這個不能做長影片或有劇情的完整影片，使用者要的是長片請告知上限。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "畫面、動作、聲音的描述，用英文"},
                "seconds": {"type": "integer", "minimum": MIN_SEC, "maximum": MAX_SEC, "description": "長度（秒），預設 5"},
            },
            "required": ["prompt"],
        },
    },
}


def enabled() -> bool:
    return os.getenv("VIDEO_GEN", "on").strip().lower() not in ("off", "0", "false", "no")


def _endpoint(path: str) -> tuple[str, dict]:
    base = (os.getenv("VIDEO_BASE_URL") or os.getenv("IMAGE_BASE_URL") or os.getenv("LLM_BASE_URL") or "http://localhost:4000/v1").strip().rstrip("/")
    key = (os.getenv("VIDEO_API_KEY") or os.getenv("IMAGE_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    return base + "/images/" + path, ({"Authorization": f"Bearer {key}"} if key else {})


def _model() -> str:
    return (os.getenv("VIDEO_MODEL") or "video").strip() or "video"


def _max_queue() -> int:
    return max(1, int(os.getenv("VIDEO_MAX_QUEUE", "2") or 2))


def _user_max() -> int:
    return max(1, int(os.getenv("VIDEO_USER_MAX", "1") or 1))


def _secs(args: dict) -> int:
    try:
        s = int(float(args.get("seconds") or DEFAULT_SEC))
    except (TypeError, ValueError):
        s = DEFAULT_SEC
    return max(MIN_SEC, min(MAX_SEC, s))


_waiting = 0
_busy_users: dict[int, int] = {}
_tasks: set[asyncio.Task] = set()


async def generate(session: aiohttp.ClientSession, prompt: str, seconds: int, image: tuple[bytes, str, str] | None = None) -> bytes:
    """回傳 mp4 位元組。連不上、逾時、伺服器錯誤丟 imagegen.Paused；其他錯誤（4xx）丟 RuntimeError（訊息是對方回的 error.message）。"""
    path = "edits" if image else "generations"
    url, headers = _endpoint(path)
    kw: dict = {}
    if image:
        form = aiohttp.FormData()
        form.add_field("model", _model())
        form.add_field("prompt", prompt)
        form.add_field("quality", str(seconds))
        form.add_field("image", image[0], filename=image[1], content_type=image[2])
        kw["data"] = form
    else:
        kw["json"] = {"model": _model(), "prompt": prompt, "quality": str(seconds), "size": "640x384"}
    try:
        async with session.post(url, headers=headers, timeout=aiohttp.ClientTimeout(total=900, connect=15, sock_connect=15), **kw) as resp:
            body = await resp.json(content_type=None)
            if resp.status >= 500 or resp.status in (404, 408, 429):
                raise imagegen.Paused(f"HTTP {resp.status}：{str(body)[:200]}")
            if resp.status != 200:
                err = body.get("error") if isinstance(body, dict) else None
                msg = err.get("message") if isinstance(err, dict) else None
                raise RuntimeError(str(msg or body)[:300])
    except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as e:
        raise imagegen.Paused(repr(e)) from e
    item = (body.get("data") or [{}])[0]
    if not item.get("b64_json"):
        raise RuntimeError("回傳裡沒有影片：" + str(body)[:200])
    raw = base64.b64decode(item["b64_json"])
    if len(raw) < 1000:
        raise RuntimeError("回傳的影片是空的")
    return raw


def _to_file(raw: bytes) -> str:
    f = tempfile.NamedTemporaryFile(prefix="vid_", suffix=".mp4", delete=False)
    f.write(raw)
    f.close()
    return f.name


def tool_status(args: dict) -> str:
    return f"🎬 排進影片佇列（約 {_secs(args)} 秒的影片，要等 2～3 分鐘）"


async def submit(session: aiohttp.ClientSession, args: dict, user_id: int, say, source_text: str = "",
                 image: tuple[bytes, str, str] | None = None) -> str:
    """排一支影片。立刻回傳一句話；背景生成，好了呼叫 say(text, path) 貼出。image 有值就是圖轉影片。"""
    global _waiting
    if not enabled():
        return "影片功能目前沒開。"
    prompt = str(args.get("prompt") or "").strip()[:500]
    if not prompt:
        return "沒有說要做什麼影片。"
    if re.search(r"[一-鿿]", prompt):
        return "影片描述要用英文（對方聽不懂中文），請先翻成英文再呼叫。"
    why = imagegen.check_prompt(prompt, source_text)
    if why:
        log.info("影片被擋：%s｜%s", why, prompt[:80])
        return why + "（這支沒有做）"
    secs = _secs(args)
    if _busy_users.get(user_id, 0) >= _user_max():
        return "你上一支影片還在處理，等它好了再要下一支。"
    if _waiting >= _max_queue():
        return "影片排隊的人太多了（目前滿了），晚點再試。"
    ahead = _waiting + imagegen._waiting
    _waiting += 1
    _busy_users[user_id] = _busy_users.get(user_id, 0) + 1
    task = asyncio.create_task(_job(session, user_id, prompt, secs, image, say))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    wait = ahead * 60 + 100
    when = f"前面還有 {ahead} 個在排（畫圖、音效、影片共用同一張顯卡），" if ahead else ""
    kind = "圖轉影片" if image else "文字轉影片"
    return f"🎬 排進影片了（{kind}，{secs} 秒）：{when}預計約 {max(2, round(wait / 60))} 分鐘，好了會自動貼在這則下面。"


async def _job(session, user_id, prompt, secs, image, say):
    global _waiting
    path = None
    try:
        async with imagegen._lock:                  # 和畫圖、音效共用同一張顯卡，一個一個來
            t0 = time.time()
            raw = await generate(session, prompt, secs, image)
            path = await asyncio.to_thread(_to_file, raw)
            took = round(time.time() - t0)
        log.info("影片好了：%s（%d 秒）%ds", prompt[:60], secs, took)
        await say(f"🎬 好了（{secs} 秒・{took} 秒做好）\n> {prompt}"[:900], path)
    except imagegen.Paused as e:
        log.warning("影片服務暫停或連不上：%s", e)
        try:
            await say(PAUSED_REPLY)
        except Exception:
            pass
    except Exception as e:
        log.exception("做影片失敗")
        try:
            await say(f"🎬 這支影片做失敗了：{str(e)[:150]}　（換個描述再試一次）")
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
