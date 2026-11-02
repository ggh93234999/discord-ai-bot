"""上網找圖／抓圖：給 bot 的 web_image 工具用。

- 用 ddgs 搜圖片（query），或直接下載指定網址的圖片（url）。
- 抓下來的圖暫存在記憶體（每個頻道最近 3 張、30 分鐘），之後 edit_image 設 use_found 就能拿來改圖。
- 要貼到頻道時，由呼叫的人（bot.py）負責送出。
- 安全：只抓 http/https、擋內網／本機位址、限制大小、一定要真的是圖片（用 Pillow 驗證）。
"""
import asyncio
import io
import ipaddress
import logging
import socket
import time
from urllib.parse import urlparse

from yarl import URL

import aiohttp
from PIL import Image

log = logging.getLogger("discord-ai-bot.webimg")

MAX_BYTES = 12_000_000
KEEP_PER_CHANNEL = 3
KEEP_SECONDS = 30 * 60
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWheelBot/1.0"

# channel_id -> [(時間, 位元組, 檔名, content_type, 標題, 來源網址)]
_found: dict[int, list[tuple]] = {}


def remember(channel_id: int, items: list[tuple]) -> None:
    now = time.time()
    keep = [x for x in _found.get(channel_id, []) if now - x[0] < KEEP_SECONDS]
    keep.extend((now, raw, name, ctype, title, src) for raw, name, ctype, title, src in items)
    _found[channel_id] = keep[-KEEP_PER_CHANNEL:]


def recall(channel_id: int) -> list[tuple[bytes, str, str]]:
    """最近找到的圖，給 imagegen.submit_edit 用：[(位元組, 檔名, content_type)]"""
    now = time.time()
    return [(raw, name, ctype) for t, raw, name, ctype, _, _ in _found.get(channel_id, []) if now - t < KEEP_SECONDS]


async def _public_host(host: str) -> bool:
    """主機名稱解析出來的位址全部都是公網才放行（擋 localhost、內網、VPN 網段）。"""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return False
    return bool(infos)


async def download(session: aiohttp.ClientSession, url: str) -> tuple[bytes, str, str] | None:
    """下載一張圖：回傳 (位元組, 檔名, content_type)，失敗回傳 None。"""
    try:
        for _ in range(4):      # 手動跟著轉址，每一跳都檢查位址
            u = urlparse(url)
            if u.scheme not in ("http", "https") or not u.hostname or not await _public_host(u.hostname):
                return None
            async with session.get(url, headers={"User-Agent": UA, "Accept": "image/*"}, allow_redirects=False,
                                   timeout=aiohttp.ClientTimeout(total=25, connect=8)) as r:
                if r.status in (301, 302, 303, 307, 308) and r.headers.get("Location"):
                    url = str(URL(url).join(URL(r.headers["Location"])))
                    continue
                if r.status != 200:
                    return None
                if r.content_length and r.content_length > MAX_BYTES:
                    return None
                raw = bytearray()
                async for chunk in r.content.iter_chunked(65536):
                    raw.extend(chunk)
                    if len(raw) > MAX_BYTES:
                        return None
            break
        else:
            return None
        img = Image.open(io.BytesIO(bytes(raw)))
        img.load()
        fmt = (img.format or "PNG").upper()
        ext = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif"}.get(fmt)
        if ext is None:     # 其他格式（BMP、TIFF…）轉成 PNG
            buf = io.BytesIO()
            img.convert("RGB").save(buf, "PNG")
            return buf.getvalue(), "web.png", "image/png"
        ctype = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}[ext]
        return bytes(raw), f"web.{ext}", ctype
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError, Image.UnidentifiedImageError, Image.DecompressionBombError):
        return None


def _search(query: str, count: int, safe: bool) -> list[dict]:
    from ddgs import DDGS
    return list(DDGS().images(query, region="tw-tzh", safesearch="on" if safe else "off", max_results=max(count * 4, 8)) or [])


async def find(session: aiohttp.ClientSession, query: str = "", url: str = "", count: int = 1, safe: bool = True) -> list[tuple[bytes, str, str, str, str]]:
    """回傳 [(位元組, 檔名, content_type, 標題, 來源網址)]，最多 count 張；找不到回傳 []。"""
    count = max(1, min(int(count or 1), 3))
    out = []
    if url:
        got = await download(session, url.strip())
        if got:
            out.append((*got, url.strip(), url.strip()))
        return out
    if not query:
        return out
    try:
        results = await asyncio.wait_for(asyncio.to_thread(_search, query, count, safe), 30)
    except Exception as e:
        log.warning("搜圖失敗：%r", e)
        return out
    for r in results:
        if len(out) >= count:
            break
        try:
            w, h = int(r.get("width") or 0), int(r.get("height") or 0)
        except (TypeError, ValueError):
            w = h = 0
        if w and h and min(w, h) < 256:
            continue        # 太小的圖不要
        src = r.get("image") or ""
        got = await download(session, src) if src else None
        if got:
            out.append((*got, (r.get("title") or "")[:100], r.get("url") or src))
    log.info("搜圖 %r → %d 張（試了 %d 筆）", query[:60], len(out), len(results))
    return out


def is_nsfw(channel) -> bool:
    try:
        return bool(channel is not None and channel.is_nsfw())
    except Exception:
        return False


TOOL = {
    "type": "function",
    "function": {
        "name": "web_image",
        "description": (
            "上網找圖片，或下載指定網址的圖片，並貼到頻道。使用者說「找一張…的圖」「上網抓…的照片」「把這個網址的圖傳上來」時呼叫。"
            "query 是搜尋關鍵字（找照片用英文或中文都可以，要具體）；使用者給了圖片網址就用 url。count 是要幾張（預設 1，最多 3）。"
            "send 預設 true＝直接貼到頻道；如果使用者只是要拿來改圖，也可以照樣貼出。"
            "抓到的圖會暫存，之後使用者要改它（例如「找一張貓的圖，改成水彩風」），就接著呼叫 edit_image 並設 use_found=true。"
            "這些圖是網路上的圖，不是你畫的，不要說是你畫的；找不到就照實說，不要假裝找到。非年齡限制頻道只會搜安全內容。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜尋關鍵字"},
                "url": {"type": "string", "description": "直接下載這個圖片網址（有給就不搜尋）"},
                "count": {"type": "integer", "description": "要幾張，1～3，預設 1"},
                "send": {"type": "boolean", "description": "是否貼到頻道，預設 true"},
            },
        },
    },
}
