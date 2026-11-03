"""模型可呼叫的工具定義與執行（上網、天氣、畫圖、音樂、占卜…）。"""

from dbot.ai import almanac
from dbot.ai import divination
from dbot.ai import extras
from dbot.ai import fortune
from dbot.ai import imagegen
from dbot.ai import selfhelp
from dbot.ai import announce
from dbot.ai import sfxgen
from dbot.ai import videogen
from dbot.ai import webimg
from dbot.core import actstatus
from dbot.core import channels
from dbot.core import memberstatus
from dbot.core import runtime
from dbot.money import botwallet
from dbot.music import music
from pathlib import Path
import aiohttp
import asyncio
import discord
import io
import json
from dbot.core.config import (NSFW_SFX_REPLY)
import logging
log = logging.getLogger("discord-ai-bot")

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "weather",
            "description": "查某個地點現在的天氣和未來幾天的預報（溫度、降雨機率、天氣狀況）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "地名，用英文最準，例如 Taipei、Hualien、Fengbin、Tokyo"},
                    "days": {"type": "integer", "description": "要幾天的預報，預設 3，最多 7"},
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "用搜尋引擎搜尋網路，回傳標題、網址和摘要。查即時資訊、新聞、天氣、價格、不熟的東西時使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜尋關鍵字"},
                    "max_results": {"type": "integer", "description": "幾筆結果，預設 5，最多 10"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "打開一個網頁，回傳主要文字內容。搜尋摘要不夠詳細時使用。",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "網址"}},
                "required": ["url"],
            },
        },
    },
]


def _web_search(query: str, max_results: int = 5) -> str:
    from ddgs import DDGS

    max_results = max(1, min(int(max_results or 5), 10))
    results = DDGS().text(query, region="tw-tzh", max_results=max_results)
    if not results:
        return "沒有搜尋結果。"
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r.get('title', '')}\n   {r.get('href', '')}\n   {r.get('body', '')}")
    return "\n".join(lines)


def _fetch_url(url: str) -> str:
    import trafilatura

    html = trafilatura.fetch_url(url)
    if not html:
        return "打不開這個網頁。"
    text = trafilatura.extract(html, include_links=False, include_tables=True) or ""
    text = text.strip()
    if not text:
        return "這個網頁抓不到文字內容（可能要 JavaScript 才會顯示）。"
    return text[:6000] + ("\n…（後面省略）" if len(text) > 6000 else "")


WMO_CODES = {
    0: "晴", 1: "大致晴朗", 2: "多雲", 3: "陰", 45: "霧", 48: "霧淞",
    51: "毛毛雨", 53: "毛毛雨", 55: "較強毛毛雨", 56: "凍毛毛雨", 57: "凍毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨", 66: "凍雨", 67: "強凍雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "陣雨", 81: "較強陣雨", 82: "豪雨", 85: "陣雪", 86: "強陣雪",
    95: "雷雨", 96: "雷雨伴冰雹", 99: "強雷雨伴冰雹",
}


async def _weather(location: str, days: int = 3) -> str:
    days = max(1, min(int(days or 3), 7))
    s = runtime.client.http_session
    t = aiohttp.ClientTimeout(total=20)
    place = None
    for name in dict.fromkeys([location, location + "市", location + "縣"]):
        async with s.get("https://geocoding-api.open-meteo.com/v1/search",
                         params={"name": name, "count": 1, "language": "zh"}, timeout=t) as r:
            res = (await r.json()).get("results")
        if res:
            place = res[0]
            break
    if not place:
        return f"找不到「{location}」這個地點，試試用英文地名。"
    params = {
        "latitude": place["latitude"], "longitude": place["longitude"], "timezone": "auto", "forecast_days": days,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
    }
    async with s.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=t) as r:
        d = await r.json()
    c = d["current"]
    where = " ".join(x for x in (place.get("name"), place.get("admin1"), place.get("country")) if x)
    out = [
        f"地點：{where}",
        f"現在（{c['time']}）：{WMO_CODES.get(c['weather_code'], c['weather_code'])}，{c['temperature_2m']}°C，"
        f"體感 {c['apparent_temperature']}°C，濕度 {c['relative_humidity_2m']}%，風速 {c['wind_speed_10m']} km/h，"
        f"降水 {c['precipitation']} mm",
        "預報：",
    ]
    dl = d["daily"]
    for i, day in enumerate(dl["time"]):
        out.append(
            f"  {day}：{WMO_CODES.get(dl['weather_code'][i], dl['weather_code'][i])}，"
            f"{dl['temperature_2m_min'][i]}～{dl['temperature_2m_max'][i]}°C，"
            f"降雨機率 {dl['precipitation_probability_max'][i]}%，紫外線 {dl['uv_index_max'][i]}"
        )
    out.append("資料來源：Open-Meteo")
    return "\n".join(out)


async def run_tool(name: str, args_json: str, msg: discord.Message | None = None) -> str:
    try:
        args = json.loads(args_json or "{}")
    except json.JSONDecodeError:
        return "參數格式錯誤。"
    try:
        if name == "set_voice_status":
            if msg is None:
                return "這裡不能用。"
            return await channels.run_vstatus_tool(msg, args)
        if name == "edit_channel":
            if msg is None:
                return "這裡不能用。"
            return await channels.run_edit_tool(msg, args)
        if name == "archive_channel":
            if msg is None:
                return "這裡不能用。"
            return await channels.run_archive_tool(msg, args)
        if name == "create_channel":
            if msg is None:
                return "這裡不能開頻道。"
            return await channels.run_tool(msg, args)
        if name == "random_number":
            return extras.run_tool(args)
        if name == "divination":
            return divination.run_tool(args)
        if name == "almanac":
            return almanac.run(args)
        if name == "bot_help":
            return selfhelp.run(args)
        if name == "announce":
            return await announce.run(msg, args)
        if name == "transfer_log":
            return botwallet.run_log(msg.guild.id if msg is not None and msg.guild else None, args)
        if name == "bot_pay":
            return botwallet.run_pay(msg, args)
        if name == "bot_collect":
            return botwallet.run_collect(msg, args)
        if name == "bot_wallet":
            return botwallet.run(msg.guild.id if msg is not None and msg.guild else None)
        if name == "activity_status":
            return await actstatus.run(msg.guild.id if msg is not None and msg.guild else None)
        if name == "fortune_chart":
            text, files = await fortune.run(runtime.client.http_session, args)
            return text + "".join(f"\n[[FILE:{f}]]" for f in files)
        if name == "music_status":
            return music.real_state(msg.guild if msg else None)
        if name == "member_status":
            return memberstatus.run(msg.guild if msg else None, args)
        if name == "music":
            if msg is None:
                return "這裡不能放音樂。"
            return await music.run_tool(msg, args)
        if name == "draw_image":
            if msg is None:
                return "這裡不能畫圖。"
            if not imagegen.channel_ok(msg.channel):
                return imagegen.NSFW_ONLY_REPLY
            return await imagegen.submit(runtime.client.http_session, args, msg.author.id, imagegen.say_for_message(msg), msg.content or "", imagegen.edit_key(args.get("edit_quality")))
        if name == "make_video":
            if msg is None:
                return "這裡不能做影片。"
            if not imagegen.channel_ok(msg.channel):
                return videogen.NSFW_REPLY
            imgs = await imagegen.collect_images(msg)
            return await videogen.submit(runtime.client.http_session, args, msg.author.id, imagegen.say_for_message(msg), msg.content or "", imgs[0] if imgs else None)
        if name == "make_sound":
            if msg is None:
                return "這裡不能做音效。"
            if not imagegen.channel_ok(msg.channel):
                return NSFW_SFX_REPLY
            return await sfxgen.submit(runtime.client.http_session, args, msg.author.id, imagegen.say_for_message(msg), msg.content or "")
        if name == "edit_image":
            if msg is None:
                return "這裡不能改圖。"
            if not imagegen.channel_ok(msg.channel):
                return imagegen.NSFW_ONLY_REPLY
            images = webimg.recall(msg.channel.id) if args.get("use_found") else await imagegen.collect_images(msg)
            if args.get("use_found") and not images:
                return "最近沒有上網找到的圖（超過 30 分鐘會清掉），請先用 web_image 找圖，或把圖片傳上來。"
            return await imagegen.submit_edit(runtime.client.http_session, args.get("prompt", ""), images, msg.author.id, imagegen.say_for_message(msg), msg.content or "",
                                            imagegen.edit_key(args.get("edit_quality")))
        if name == "web_image":
            if msg is None:
                return "這裡不能抓圖。"
            items = await webimg.find(runtime.client.http_session, str(args.get("query") or "").strip(), str(args.get("url") or "").strip(),
                                      args.get("count") or 1, safe=not webimg.is_nsfw(msg.channel))
            if not items:
                return "沒有找到可以下載的圖片（換個關鍵字，或直接給我圖片網址）。"
            webimg.remember(msg.channel.id, items)
            if args.get("send", True) is not False:
                for n, (raw, fname, ctype, title, src) in enumerate(items):
                    path = await asyncio.to_thread(imagegen._to_file, raw) if len(raw) > imagegen.DISCORD_LIMIT else None
                    ext = Path(path).suffix.lstrip(".") if path else fname.rsplit(".", 1)[-1]
                    f = discord.File(path or io.BytesIO(raw), filename=f"web_{msg.id}_{n + 1}.{ext}")
                    text = f"🔎 {title}\n<{src}>"[:500] if title else f"🔎 <{src}>"[:500]
                    try:
                        await (msg.reply(text, file=f, mention_author=False) if n == 0 else msg.channel.send(text, file=f))
                    except discord.HTTPException:
                        await msg.channel.send(text, file=f)
            sent = "並貼到頻道了" if args.get("send", True) is not False else "（沒有貼出）"
            return (f"找到 {len(items)} 張圖{sent}。來源：" + "；".join(i[4] for i in items)
                    + "。這些是網路上的圖、不是你畫的。要改它們就呼叫 edit_image 並設 use_found=true。")
        if name == "weather":
            return await _weather(args.get("location", ""), args.get("days", 3))
        if name == "web_search":
            return await asyncio.wait_for(asyncio.to_thread(_web_search, args.get("query", ""), args.get("max_results", 5)), 30)
        if name == "fetch_url":
            return await asyncio.wait_for(asyncio.to_thread(_fetch_url, args.get("url", "")), 30)
        return f"沒有 {name} 這個工具。"
    except Exception as e:
        log.warning("工具 %s 失敗：%r", name, e)
        return f"工具執行失敗：{e}"


def tool_status(name: str, args_json: str) -> str:
    try:
        args = json.loads(args_json or "{}")
    except json.JSONDecodeError:
        args = {}
    if name == "music":
        return music.tool_status(args)
    if name in ("draw_image", "edit_image"):
        return imagegen.tool_status(args)
    if name == "make_sound":
        return sfxgen.tool_status(args)
    if name == "make_video":
        return videogen.tool_status(args)
    if name == "web_image":
        return f"🔎 上網找圖：{args.get('query') or args.get('url') or ''}"[:80]
    if name == "music_status":
        return "🔎 確認播放狀態"
    if name == "member_status":
        return f"👀 看成員狀態：{args.get('name') or '大家'}"[:80]
    if name == "random_number":
        return "🎲 抽數字"
    if name == "fortune_chart":
        return "🧭 排命盤中…" if args.get("kind") == "bazi" else "🧭 排盤、畫星盤中…"
    if name == "almanac":
        return "📅 查黃曆、擇日"
    if name == "bot_wallet":
        return "🪙 數自己的代幣"
    if name == "bot_pay":
        return "💸 考慮要不要給錢"
    if name == "bot_collect":
        return "💰 收還款"
    if name == "bot_help":
        return "📖 翻自己的功能說明"
    if name == "announce":
        return "📢 處理公告"
    if name == "transfer_log":
        return "📒 翻轉帳紀錄"
    if name == "activity_status":
        return "👀 看大家在玩什麼"
    if name == "divination":
        return {"tarot": "🔮 洗牌、抽塔羅…", "jiaobei": "🙏 擲筊中…", "qian": "🏮 搖籤筒…", "iching": "☯️ 擲錢起卦…"}.get(args.get("kind"), "🔮 占卜中…")
    if name == "create_channel":
        return channels.tool_status(args)
    if name == "set_voice_status":
        return f"📝 改語音頻道狀態：{args.get('status') or '（清除）'}"
    if name == "edit_channel":
        return f"✏️ 改頻道：{args.get('channel') or '這個頻道'}"
    if name == "archive_channel":
        return "📦 " + ("解除封存" if args.get("action") == "unarchive" else "封存") + f"：{args.get('channel') or '這個頻道'}"
    if name == "weather":
        return f"🌤️ 查天氣：{args.get('location', '')}"
    if name == "web_search":
        return f"🔎 搜尋：{args.get('query', '')}"
    if name == "fetch_url":
        return f"📄 讀網頁：<{args.get('url', '')}>"
    return f"🔧 {name}"


# ---------------------------------------------------------------- 呼叫模型
