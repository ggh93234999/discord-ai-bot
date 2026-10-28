"""做音效：呼叫 LiteLLM 的 POST /v1/audio/speech（model=sfx，其實是音效生成模型，不是語音也不是音樂）。

重點（對方那台的限制）：
- input 要用英文描述（中文它聽不懂），voice 欄位放「秒數」字串，1～47 秒，預設 5。
- 回傳直接是 flac 音檔（二進位）。和畫圖共用同一張顯卡，所以這邊跟畫圖共用同一把鎖，一個一個排隊；
  畫圖進行中音效要等，可能等數分鐘，所以也是「背景生成」：叫用的人馬上收到「排進去了」，做好再自動貼出來。
- 不適合人聲唱歌或說話；適合音效、環境音、短樂句（鼓點、氛圍）。
設定（.env，都可省略）：SFX_GEN=on|off、SFX_BASE_URL、SFX_API_KEY（預設沿用 LLM_BASE_URL / LLM_API_KEY）、SFX_MODEL（預設 sfx）、SFX_MAX_QUEUE（預設 3）。
"""
import asyncio
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time

import aiohttp

import imagegen

log = logging.getLogger("bot")

PAUSED_REPLY = "🔊 音效服務目前暫停中，晚點再試。"
MIN_SEC, MAX_SEC, DEFAULT_SEC = 1, 47, 5
DISCORD_LIMIT = imagegen.DISCORD_LIMIT

TOOL = {
    "type": "function",
    "function": {
        "name": "make_sound",
        "description": (
            "用音效生成模型做一段音效（環境音、物品聲、動作聲、短樂句如鼓點或氛圍；不是語音、不是唱歌、不是完整歌曲）。"
            "使用者說「做一個…的音效」「幫我生…的聲音」「我要…的音效」時呼叫。"
            "做一段要等約 10 秒到幾分鐘（和畫圖共用同一張顯卡，畫圖進行中要排隊），做好後程式會自動貼出來，你呼叫後只要簡短回一句「在做了」就好，不要說已經做好、不要描述聲音的內容。"
            "prompt 一定要用英文（先把使用者的意思翻成英文，再寫得具體一點）：聲音本身 + 環境，例如 \"footsteps on gravel, slow, night, crickets\"。"
            "seconds 是長度（1～47 秒，預設 5）：短音效（點擊、撞擊、叮）用 1～3，環境音或短樂句用 8～30；使用者有指定幾秒就照他的。"
            "不能做人聲說話或唱歌；使用者要的是歌曲或配樂，請告知這個只能做音效與短樂句。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "音效描述，用英文"},
                "seconds": {"type": "integer", "minimum": MIN_SEC, "maximum": MAX_SEC, "description": "長度（秒），預設 5"},
                "avoid": {"type": "string", "description": "不要出現的東西（英文，選填），例如 \"music, speech\""},
            },
            "required": ["prompt"],
        },
    },
}


def enabled() -> bool:
    return os.getenv("SFX_GEN", "on").strip().lower() not in ("off", "0", "false", "no")


def _endpoint() -> tuple[str, dict]:
    base = (os.getenv("SFX_BASE_URL") or os.getenv("IMAGE_BASE_URL") or os.getenv("LLM_BASE_URL") or "http://localhost:4000/v1").strip().rstrip("/")
    key = (os.getenv("SFX_API_KEY") or os.getenv("IMAGE_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    return base + "/audio/speech", ({"Authorization": f"Bearer {key}"} if key else {})


def _max_queue() -> int:
    return int(os.getenv("SFX_MAX_QUEUE", "3") or 3)


_waiting = 0
_busy_users: set[int] = set()
_tasks: set[asyncio.Task] = set()


async def generate(session: aiohttp.ClientSession, prompt: str, seconds: int, avoid: str = "") -> bytes:
    """回傳 flac 位元組。連不上、逾時、伺服器錯誤丟 imagegen.Paused；其他錯誤（例如 4xx）丟 RuntimeError（訊息是對方回的 error.message）。"""
    url, headers = _endpoint()
    body = {"model": (os.getenv("SFX_MODEL") or "sfx").strip() or "sfx", "input": prompt, "voice": str(seconds)}
    if avoid:
        body["negative_prompt"] = avoid
    try:
        async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=900, connect=15, sock_connect=15)) as resp:
            raw = await resp.read()
            if resp.status >= 500 or resp.status in (404, 408, 429):
                raise imagegen.Paused(f"HTTP {resp.status}：{raw[:200]!r}")
            if resp.status != 200:
                msg = raw[:300].decode("utf-8", "replace")
                m = re.search(r'"message"\s*:\s*"([^"]+)', msg)
                raise RuntimeError(m.group(1) if m else f"HTTP {resp.status}：{msg}")
    except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as e:
        raise imagegen.Paused(repr(e)) from e
    if len(raw) < 1000 or raw[:4] not in (b"fLaC", b"RIFF", b"OggS") and raw[:3] != b"ID3":
        raise RuntimeError("回傳的不是音檔：" + raw[:200].decode("utf-8", "replace"))
    return raw


def _to_file(raw: bytes) -> str:
    """存成暫存檔；flac 太大（Discord 單檔上限）就轉成 mp3。"""
    ext = ".flac" if raw[:4] == b"fLaC" else ".wav" if raw[:4] == b"RIFF" else ".ogg" if raw[:4] == b"OggS" else ".mp3"
    f = tempfile.NamedTemporaryFile(prefix="sfx_", suffix=ext, delete=False)
    f.write(raw)
    f.close()
    if len(raw) > DISCORD_LIMIT and shutil.which("ffmpeg"):
        out = f.name.rsplit(".", 1)[0] + ".mp3"
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f.name, "-c:a", "libmp3lame", "-b:a", "192k", out], capture_output=True, timeout=120)
        os.unlink(f.name)
        if r.returncode == 0:
            return out
        raise RuntimeError("音檔太大，轉檔失敗")
    return f.name


def tool_status(args: dict) -> str:
    return f"🔊 排進音效佇列（約 {_secs(args)} 秒的音效）"


def _secs(args: dict) -> int:
    try:
        s = int(float(args.get("seconds") or DEFAULT_SEC))
    except (TypeError, ValueError):
        s = DEFAULT_SEC
    return max(MIN_SEC, min(MAX_SEC, s))


async def submit(session: aiohttp.ClientSession, args: dict, user_id: int, say, source_text: str = "") -> str:
    """排一段音效。立刻回傳要給模型／使用者看的一句話；背景生成，好了呼叫 say(text, path) 貼出。"""
    global _waiting
    if not enabled():
        return "音效功能目前沒開。"
    prompt = str(args.get("prompt") or "").strip()[:500]
    if not prompt:
        return "沒有說要做什麼音效。"
    if re.search(r"[一-鿿]", prompt):
        return "音效描述要用英文（對方聽不懂中文），請先翻成英文再呼叫。"
    secs = _secs(args)
    avoid = str(args.get("avoid") or "").strip()[:200]
    if user_id in _busy_users:
        return "你上一段音效還在處理，等它好了再要下一段。"
    if _waiting + imagegen._waiting >= _max_queue() + imagegen._max_queue():
        return "排隊的人太多了（目前滿了），晚點再試。"
    if _waiting >= _max_queue():
        return "音效排隊的人太多了（目前滿了），晚點再試。"
    ahead = _waiting + imagegen._waiting
    _waiting += 1
    _busy_users.add(user_id)
    task = asyncio.create_task(_job(session, user_id, prompt, secs, avoid, say))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    wait = ahead * 40 + 15 + secs
    when = f"前面還有 {ahead} 個在排（畫圖和音效共用同一張顯卡），" if ahead else ""
    return f"🔊 排進音效了（{secs} 秒）：{when}預計約 {max(1, round(wait / 60))} 分鐘，好了會自動貼在這則下面。"


async def _job(session, user_id, prompt, secs, avoid, say):
    global _waiting
    path = None
    try:
        async with imagegen._lock:                  # 和畫圖共用同一張顯卡，一個一個來
            t0 = time.time()
            raw = await generate(session, prompt, secs, avoid)
            path = await asyncio.to_thread(_to_file, raw)
            took = round(time.time() - t0)
        log.info("音效好了：%s（%d 秒）%ds", prompt[:60], secs, took)
        await say(f"🔊 好了（{secs} 秒・{took} 秒做好）\n> {prompt}"[:900], path)
    except imagegen.Paused as e:
        log.warning("音效服務暫停或連不上：%s", e)
        try:
            await say(PAUSED_REPLY)
        except Exception:
            pass
    except Exception as e:
        log.exception("做音效失敗")
        try:
            await say(f"🔊 這段音效做失敗了：{str(e)[:150]}　（換個描述再試一次）")
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
