"""
Discord AI 機器人：讀取頻道的歷史訊息當上下文，用本地模型（例如 Ollama / LiteLLM）回覆。

模型走 OpenAI 相容 API（例如 LiteLLM：http://localhost:4000/v1）。

觸發回覆的情況：
  1. 私訊（DM）機器人
  2. 在頻道裡 @提到 機器人，或回覆機器人的訊息
  3. 用 /自動回覆 開啟的頻道（或 .env 的 AUTO_REPLY_CHANNEL_IDS），任何人發言都會回

功能：
  - 看得懂圖片（最近幾則訊息裡的圖片會一起送給模型）
  - 需要即時資訊時會自己上網搜尋（DuckDuckGo）、讀網頁
  - 斜線指令：/總結、/重置、/自動回覆
"""

import asyncio
import base64
import io
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import aiohttp
import discord
from discord import app_commands

import aliases
import channels
import economy
import extras
import imagegen
import divination
import dmlog
import fortune
import models
import music
import vstatus

BASE_DIR = Path(__file__).resolve().parent


def load_env_file(path: Path) -> None:
    """讀 .env（不覆蓋已存在的環境變數；systemd 已經用 EnvironmentFile 帶進來也沒關係）。"""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env_file(BASE_DIR / ".env")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:4000/v1").strip().rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "qwen").strip()
REASONING_EFFORT = os.getenv("REASONING_EFFORT", "none").strip()  # none = 不思考，回得快
REMOTE_REASONING_EFFORT = os.getenv("REMOTE_REASONING_EFFORT", "none").strip()  # 線上模型（deepseek）的思考程度，none = 不思考，省錢
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "300"))
SLOW_NOTICE_SECONDS = int(os.getenv("SLOW_NOTICE_SECONDS", "15"))
LLM_KEEP_ALIVE = os.getenv("LLM_KEEP_ALIVE", "24h").strip()
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "30"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "1500"))
ENV_AUTO_CHANNELS = {
    int(x) for x in re.split(r"[,\s]+", os.getenv("AUTO_REPLY_CHANNEL_IDS", "")) if x.isdigit()
}
# 看圖：最近幾則訊息裡的圖片才送給模型、最多幾張、縮到多大
IMAGE_LOOKBACK = int(os.getenv("IMAGE_LOOKBACK", "4"))
MAX_IMAGES = int(os.getenv("MAX_IMAGES", "4"))
IMAGE_MAX_SIDE = int(os.getenv("IMAGE_MAX_SIDE", "1280"))
# 上網：每次回覆最多呼叫幾輪工具
WEB_TOOLS = os.getenv("WEB_TOOLS", "on").strip().lower() not in ("off", "0", "false", "no")
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "5"))
TZ = ZoneInfo(os.getenv("TZ_NAME", "Asia/Taipei"))

SYSTEM_PROMPT_FILE = BASE_DIR / "system_prompt.txt"
STATE_FILE = BASE_DIR / "state.json"
DEFAULT_SYSTEM_PROMPT = (
    "你是 Discord 伺服器裡的一位成員，用繁體中文跟大家自然聊天。"
    "回覆要簡短口語，像朋友在聊天，不要用條列或標題。"
)
TOOL_GUIDE = (
    "【重要】你可以上網。你有三個工具：weather（查天氣預報）、web_search（搜尋網路）和 fetch_url（讀取網頁內容）。"
    "問天氣一律用 weather。"
    "你的知識停在訓練時，可能已經過時：凡是問「最新」「現在」「今年」「最近」的東西"
    "（產品型號、版本、誰擔任什麼職位、排名、活動），都要先 web_search 確認，不要用猜的。"
    "只要問題牽涉即時或會變動的資訊（天氣、新聞、價格、匯率、比賽、營業時間、最近發生的事、"
    "某個東西的最新版本），或你不確定答案，就一定要先呼叫 web_search，絕對不要說「我沒辦法查」"
    "或叫對方自己去查。搜尋摘要不夠就用 fetch_url 打開最相關的一兩個網頁。"
    "查完用自己的話回答，最後附上一兩個來源網址（用 <網址> 包起來，避免 Discord 產生預覽）。"
    "一般聊天、常識、數學、不需要即時資訊的問題就直接回答，不要搜尋。"
    "沒有呼叫工具的回覆，絕對不要放任何網址或假裝有來源。"
    "要你隨機選數字、骰骰子、抽號碼時，一定要呼叫 random_number，不能自己編數字。"
    "有人要占卜、算命、抽塔羅、抽籤、擲筊、卜卦時，一定要呼叫 divination，結果以工具為準，絕對不能自己編牌或編籤；"
    "結果卡會由程式貼在你的回覆上面，你不用重抄牌名或籤號，但一定要接著完整解讀，回答對方真正想問的事。"
    "有人要排八字、命盤、星盤、看上升星座時，呼叫 fortune_chart（要出生日期，時間、出生地、性別有就填，缺的資料先問）；"
    "命盤卡和星盤圖會由程式貼出，你只要解讀，不要自己排盤或編干支、星座。"
    "【占卜、算命的回覆不受「簡短」限制】塔羅、籤詩、擲筊、易經、八字、星盤都要完整解釋：逐張牌／逐句籤詩／每個重點（日主、五行、十神、大運、三巨頭、行星宮位相位）說明意思，"
    "再串起來回答對方的問題、給具體建議，可以分成幾段、用小標題或條列讓它好讀，大約 400～900 字（八字＋星盤一起排可以更長）。"
    "絕對不能只說一句「結果在上面」或只貼圖不解釋。"
    "在伺服器裡你還有 music 工具，可以在使用者所在的語音頻道放 YouTube 音樂、跳過、暫停、停止、看佇列；"
    "有人叫你放歌就直接用它，放歌後簡短回一句就好，不用附來源網址。"
    "你還有 create_channel 工具可以開文字／語音頻道；有人明確要你開頻道才用，權限由程式檢查，你照工具結果回報就好。"
    "archive_channel 可以封存或解除封存頻道；edit_channel 可以幫頻道改名、搬到別的分類；set_voice_status 可以改語音頻道的狀態（名稱下面那行小字）。"
    "放歌時語音頻道狀態會自動顯示歌名，不用你另外改。"
    "你不能刪除頻道，有人要刪就請他用 /關頻道 指令。"
    "使用者說「移到／搬到某個分類」通常是指搬頻道，不是移動使用者。"
    "遇到你沒有工具可以做的事，就老實說「這個我還不會」，不要編造權限不足之類的理由。"
    "【非常重要】放歌、開頻道、封存這類動作，一定要真的呼叫工具才算做了；沒呼叫工具，絕對不能說「好了」「建好了」「已經開了」。"
    "工具真正的執行結果會由程式自動附在你的訊息下面給大家看，你不要自己寫結果、不要自己編頻道連結。"
    "看對話紀錄時，只有真的出現工具呼叫和工具結果的，才代表你做過；你嘴巴說過但沒有工具紀錄的，等於沒做。"
    "你以前說過「我沒權限」「我做不到」之類的話可能是錯的，不要照抄；使用者要你做，就重新呼叫工具，以工具結果為準。"
    "因為結果會自動附上，放歌、開頻道這類動作你自己的回覆簡短一句就好（占卜、算命不適用這條，見下面）。"
    "使用者要你畫圖（「畫一張…」「幫我畫…」「生圖」）就呼叫 draw_image；畫圖要等一陣子，畫好程式會自動貼出來，你只回一句簡短的話。涉及未成年人的性暗示或色情內容一律拒絕、不呼叫，其他都能畫。畫圖時任何膚色、種族、國籍、外貌、性別、文化的人物都可以畫，不要自己加限制、不要拒絕、不要說教；使用者要畫就直接呼叫 draw_image。"
    "使用者傳了圖片（或回覆一則有圖的訊息，包含你畫的圖）並要你修改它（「改成白天」「把…換成…」「幫我修圖」），呼叫 edit_image，prompt 照使用者的語言寫就好（中文可以直接傳）；只是要你看圖、描述圖就不要呼叫。"
    "只有使用者真的要你做動作時才需要想到工具。一般聊天、問答不用提到工具、動作、「有沒有做事」，也不要說「我剛剛沒做任何動作」「我沒呼叫工具」這類話，直接自然地回答就好。"
)
OFFLINE_REPLY = "⚠️ 模型那台電腦現在沒開或連不到，晚點再試。"
ERROR_REPLY = "抱歉，我這邊出了點問題，等等再試一次。"

DISCORD_MAX_LEN = 2000
THINK_RE = re.compile(r"<think>.*?</think>", re.S)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("discord-ai-bot")
for noisy in ("ddgs", "primp", "httpx", "trafilatura", "htmldate", "courlan"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
logging.getLogger().handlers[0].addFilter(lambda r: "voice will NOT be supported" not in r.getMessage())


# ---------------------------------------------------------------- 狀態（存 state.json）

def load_state() -> dict:
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data.setdefault("auto_channels", [])
    data.setdefault("reset_after", {})  # 頻道 ID → 只讀這則訊息之後的對話
    return data


def save_state() -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


state = load_state()

# 機器人每則回覆背後真正呼叫過的動作工具（訊息 ID → [{name, arguments, result}]）
ACTION_LOG_FILE = BASE_DIR / "action_log.json"
try:
    action_log: dict = json.loads(ACTION_LOG_FILE.read_text(encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError):
    action_log = {}


def record_actions(message_id: int, calls: list[dict]) -> None:
    action_log[str(message_id)] = calls
    for k in list(action_log)[:-500]:  # 只留最近 500 則
        del action_log[k]
    tmp = ACTION_LOG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(action_log, ensure_ascii=False), encoding="utf-8")
    tmp.replace(ACTION_LOG_FILE)


ACTION_LINE_RE = re.compile(r"^-# ⚙️.*$\n?", re.M)


def is_auto_channel(channel_id: int) -> bool:
    return channel_id in ENV_AUTO_CHANNELS or channel_id in state["auto_channels"]


def load_system_prompt(guild=None) -> str:
    """每次回覆前重新讀，改 system_prompt.txt 不用重開機器人。"""
    try:
        text = SYSTEM_PROMPT_FILE.read_text(encoding="utf-8-sig").strip()
        base = text or DEFAULT_SYSTEM_PROMPT
    except FileNotFoundError:
        base = DEFAULT_SYSTEM_PROMPT
    now = datetime.now(TZ).strftime("%Y-%m-%d %A %H:%M")
    extra = f"\n\n現在時間：{now}（台灣時間）。"
    if WEB_TOOLS:
        extra += "\n" + TOOL_GUIDE
    if guild is not None:
        extra += ("\n\n" + music.real_state(guild) +
                  "\n（上面是程式剛讀到的真實狀態，以它為準。對話歷史裡舊的『正在播』『⚙️ 已點歌』可能早就過期，不要相信。"
                  "回答播放相關問題前，若不確定就呼叫 music_status。你只有在這一輪真的呼叫工具成功，才可以說做了某件事。）")
    return base + extra


# ---------------------------------------------------------------- Discord 用戶端

intents = discord.Intents.default()
intents.message_content = True  # 需要在 Developer Portal 打開 Message Content Intent
intents.members = False


class Bot(discord.Client):
    def __init__(self):
        # 模型講的話不會真的去 @ 人（避免 @everyone 之類的意外）
        super().__init__(intents=intents, allowed_mentions=discord.AllowedMentions.none(),
                         enable_debug_events=True)  # 為了收到語音頻道狀態的原始事件
        self.tree = app_commands.CommandTree(self)
        self.http_session: aiohttp.ClientSession | None = None

    async def setup_hook(self):
        self.http_session = aiohttp.ClientSession()
        economy.start_voice_loop()  # 掛語音也賺代幣
        economy.start_internal_api()  # 給 Discord Activity 賭注模式用的內部 API
        aliases.add_english_aliases(self.tree)  # 每個中文指令再加一個英文名字的版本
        await self.sync_commands()

    async def sync_commands(self):
        """同步斜線指令。Discord Activity 的入口指令（/launch，type 4）是 Discord 自己建的，
        整批覆蓋時一定要把它一起帶上，否則會被拒絕或被刪掉。"""
        try:
            app_id = self.application_id
            payload = [c.to_dict(self.tree) for c in self.tree._get_all_commands(guild=None)]
            existing = await self.http.get_global_commands(app_id)
            for c in existing:
                if c.get("type") == 4:  # PRIMARY_ENTRY_POINT
                    payload.append({k: c[k] for k in ("id", "name", "description", "type", "handler", "contexts",
                                                      "integration_types", "default_member_permissions") if k in c})
            data = await self.http.bulk_upsert_global_commands(app_id, payload)
            log.info("已同步斜線指令：%s", ", ".join("/" + c["name"] for c in data))
        except Exception:
            log.exception("同步斜線指令失敗（機器人照常運作，指令維持上次的狀態）")

    async def close(self):
        if self.http_session:
            await self.http_session.close()
        await super().close()


client = Bot()
music.setup(client, client.tree)
channels.setup(client, client.tree, state, save_state)
models.setup(client, client.tree, state, save_state, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, TZ)
extras.setup(client, client.tree, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)
economy.setup(client, client.tree)
dmlog.setup(client, client.tree)
if not economy.GAMBLING_ENABLED:      # 賭博類指令暫時下架（英文別名是之後從現有指令產生的，所以不會留下）
    for _n in economy.GAMBLING_COMMANDS:
        client.tree.remove_command(_n)


@client.event
async def on_socket_raw_receive(msg):
    vstatus.on_socket_raw(msg)


@client.event
async def on_voice_state_update(member, before, after):
    for handler in (music.on_voice_state_update, channels.on_voice_state_update):
        try:
            await handler(member, before, after)
        except Exception:
            log.exception("語音事件處理失敗：%s", handler.__module__)
channel_locks: dict[int, asyncio.Lock] = {}


# ---------------------------------------------------------------- 圖片

def is_image(att: discord.Attachment) -> bool:
    ct = (att.content_type or "").lower()
    return ct.startswith("image/") or att.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))


def _shrink_image(data: bytes) -> str:
    """縮圖成 JPEG 再轉 base64，減少模型要處理的量。"""
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    img.seek(0)  # GIF 只取第一格
    img = img.convert("RGB")
    img.thumbnail((IMAGE_MAX_SIDE, IMAGE_MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


async def image_part(att: discord.Attachment) -> dict | None:
    if att.size > 20 * 1024 * 1024:
        return None
    try:
        data = await att.read()
        b64 = await asyncio.to_thread(_shrink_image, data)
        return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
    except Exception as e:
        log.warning("讀圖失敗 %s：%r", att.filename, e)
        return None


# ---------------------------------------------------------------- 對話上下文

def describe_message(msg: discord.Message) -> str:
    """把一則 Discord 訊息轉成文字，附件只標示檔名。"""
    content = msg.clean_content.strip()
    extras = []
    for a in msg.attachments:
        extras.append(f"[圖片：{a.filename}]" if is_image(a) else f"[附件：{a.filename}]")
    if msg.stickers:
        extras.append("[貼圖]")
    ref = msg.reference.resolved if msg.reference else None
    if isinstance(ref, discord.Message) and msg.author.id != client.user.id:  # 回覆誰、那則有沒有圖（要改圖時靠這個知道指的是哪張）
        rimgs = [a.filename for a in ref.attachments if is_image(a)]
        who = "你" if ref.author.id == client.user.id else ref.author.display_name
        extras.insert(0, f"[回覆{who}的訊息" + (f"，被回覆的訊息有圖片：{'、'.join(rimgs)}" if rimgs else "") + "]")
    for e in msg.embeds:  # 連結預覽之類的
        if e.title or e.description:
            extras.append(f"[內嵌：{(e.title or '')} {(e.description or '')[:200]}]".strip())
    return " ".join([content, *extras]).strip()


async def fetch_history(channel, limit: int) -> list[discord.Message]:
    """抓最近 limit 則訊息（舊的在前），會跳過 /重置 之前的訊息。"""
    after_id = state["reset_after"].get(str(channel.id))
    kwargs = {"limit": limit}
    if after_id:
        kwargs.update(after=discord.Object(id=int(after_id)), oldest_first=False)
    for attempt in range(3):  # Discord 偶爾暫時故障（503 overloaded 之類），重試幾次
        try:
            history = [m async for m in channel.history(**kwargs)]
            break
        except (discord.DiscordServerError, aiohttp.ClientError, asyncio.TimeoutError) as e:
            if attempt == 2:
                raise
            log.info("抓歷史訊息失敗（%r），%d 秒後重試", e, attempt + 1)
            await asyncio.sleep(attempt + 1)
    history.reverse()
    return history


async def build_conversation(channel) -> list[dict]:
    """
    抓頻道最近的訊息，轉成 chat 格式：
      機器人自己說的話 → assistant
      其他人說的話     → user（前面加上「名字：」，讓 AI 分得出是誰）
    最近幾則訊息的圖片會一起送；連續同一角色的訊息合併。
    """
    history = await fetch_history(channel, HISTORY_LIMIT)

    # 先決定要送哪些圖：從最新的往回找
    image_jobs: dict[int, list[discord.Attachment]] = {}
    budget = MAX_IMAGES
    for msg in reversed(history[-IMAGE_LOOKBACK:]):
        if msg.author.id == client.user.id or budget <= 0:
            continue
        imgs = [a for a in msg.attachments if is_image(a)][:budget]
        if imgs:
            image_jobs[msg.id] = imgs
            budget -= len(imgs)
    all_atts = [a for imgs in image_jobs.values() for a in imgs]
    parts_list = await asyncio.gather(*(image_part(a) for a in all_atts))
    images_by_att = {a.id: p for a, p in zip(all_atts, parts_list) if p}

    turns: list[dict] = []
    for msg in history:
        text = describe_message(msg)
        if not text:
            continue
        if msg.author.id == client.user.id:
            had_line = bool(ACTION_LINE_RE.search(text))
            text = ACTION_LINE_RE.sub("", text).strip()  # 「⚙️ 結果」行改用正式的工具紀錄表示
            logged = action_log.get(str(msg.id))
            if text and not logged and not had_line and CLAIM_RE.search(text):
                # 以前說「做好了」但沒有任何實際動作紀錄的回覆：是假的，別讓模型照抄
                text = "（較早的回覆，略）"
            if logged:
                ids = [f"call_{msg.id}_{i}" for i in range(len(logged))]
                turns.append({"role": "assistant", "content": [], "tool_calls": [
                    {"id": cid, "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
                    for cid, c in zip(ids, logged)]})
                for cid, c in zip(ids, logged):
                    turns.append({"role": "tool", "tool_call_id": cid, "content": [{"type": "text", "text": c["result"]}]})
            if not text:
                continue
            role, parts = "assistant", [{"type": "text", "text": text}]
        else:
            role = "user"
            parts = [{"type": "text", "text": f"{msg.author.display_name}：{text}"}]
            for a in image_jobs.get(msg.id, []):
                if a.id in images_by_att:
                    parts.append(images_by_att[a.id])

        if turns and turns[-1]["role"] == role and "tool_calls" not in turns[-1]:
            prev = turns[-1]["content"]
            if prev and prev[-1]["type"] == "text" and parts[0]["type"] == "text":
                prev[-1] = {"type": "text", "text": prev[-1]["text"] + "\n" + parts[0]["text"]}
                prev.extend(parts[1:])
            else:
                prev.extend(parts)
        else:
            turns.append({"role": role, "content": parts})

    # 第一則從 user 開始，模型比較不會亂
    while turns and turns[0]["role"] != "user":
        turns.pop(0)

    # 沒有圖的訊息改回純文字，相容性最好
    for t in turns:
        if "tool_calls" in t:
            t["content"] = ""
        elif all(p["type"] == "text" for p in t["content"]):
            t["content"] = "\n".join(p["text"] for p in t["content"])
        elif t["role"] == "assistant":
            t["content"] = "\n".join(p["text"] for p in t["content"] if p["type"] == "text")
    return turns


# ---------------------------------------------------------------- 上網工具

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
    s = client.http_session
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
        if name == "fortune_chart":
            text, files = await fortune.run(client.http_session, args)
            return text + "".join(f"\n[[FILE:{f}]]" for f in files)
        if name == "music_status":
            return music.real_state(msg.guild if msg else None)
        if name == "music":
            if msg is None:
                return "這裡不能放音樂。"
            return await music.run_tool(msg, args)
        if name == "draw_image":
            if msg is None:
                return "這裡不能畫圖。"
            if not imagegen.channel_ok(msg.channel):
                return imagegen.NSFW_ONLY_REPLY
            return await imagegen.submit(client.http_session, args, msg.author.id, imagegen.say_for_message(msg), msg.content or "")
        if name == "edit_image":
            if msg is None:
                return "這裡不能改圖。"
            if not imagegen.channel_ok(msg.channel):
                return imagegen.NSFW_ONLY_REPLY
            images = await imagegen.collect_images(msg)
            return await imagegen.submit_edit(client.http_session, args.get("prompt", ""), images, msg.author.id, imagegen.say_for_message(msg), msg.content or "")
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
    if name == "music_status":
        return "🔎 確認播放狀態"
    if name == "random_number":
        return "🎲 抽數字"
    if name == "fortune_chart":
        return "🧭 排命盤中…" if args.get("kind") == "bazi" else "🧭 排盤、畫星盤中…"
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

def flatten_for_remote(messages: list[dict]) -> list[dict]:
    """線上模型不一定吃「內容是文字陣列」的格式：沒有圖的就壓成純文字，有圖的保留（deepseek 看得懂圖）。"""
    out = []
    for m in messages:
        c = m.get("content")
        if isinstance(c, list) and all(p.get("type") == "text" for p in c):
            m = {**m, "content": "\n".join(p.get("text", "") for p in c if p.get("text"))}
        out.append(m)
    return out


async def call_model(messages: list[dict], use_tools: bool | list = False, max_tokens: int | None = None) -> dict:
    model = models.current()
    local = models.is_local(model)
    body = {"model": model, "max_tokens": max_tokens or MAX_TOKENS,
            "messages": messages if local else flatten_for_remote(messages)}
    # 思考模式：qwen 和 deepseek 都靠 reasoning_effort 控制。DeepSeek 不帶參數預設會思考，
    # 思考的 token 也計費（實測約多 3~4 倍），所以線上模型也要送，預設 none。
    effort = REASONING_EFFORT if local else REMOTE_REASONING_EFFORT
    if effort:
        body["reasoning_effort"] = effort
    if local and LLM_KEEP_ALIVE:
        body["keep_alive"] = LLM_KEEP_ALIVE  # 叫 Ollama 別太快把模型卸載（重新載入要一兩分鐘）
    if use_tools:
        body["tools"] = use_tools if isinstance(use_tools, list) else TOOLS
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
    async with client.http_session.post(
        f"{LLM_BASE_URL}/chat/completions",
        json=body,
        headers=headers,
        timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT),
    ) as resp:
        data = await resp.json(content_type=None)
        if resp.status != 200:
            raise RuntimeError(f"模型回 HTTP {resp.status}：{str(data)[:300]}")
    models.record(model, data.get("usage"))
    return data["choices"][0]["message"]


def clean_text(text: str | None) -> str:
    return THINK_RE.sub("", text or "").strip()


ACTION_TOOLS = {"draw_image", "edit_image", "music", "create_channel", "archive_channel", "edit_channel", "set_voice_status"}
CARD_TOOLS = {"divination", "fortune_chart"}       # 結果卡由程式貼在回覆最上面（DIVIDER 前面那段），模型只解讀
CARD_MAX_TOKENS = int(os.getenv("CARD_MAX_TOKENS", "4000"))   # 占卜、命盤的解讀比較長，回覆上限放寬
FILE_RE = re.compile(r"\n?\[\[FILE:([^\]]+)\]\]")
CLAIM_RE = re.compile(
    r"(建好|開好|建立好|創好|已經?(建立|開(?!始|心|學)|建|創|封存|解除|刪|移除|清空|鎖|隱藏|放(?!學|假)|播|加入|跳過|暫停|停止)|"
    r"(封存|鎖|藏|開|建|創)(起來|好)了|頻道.{0,6}(好了|完成)|幫你(放|播|點|排|開|建|封存|搬|移|改)|正在播放|開始播放|排(好了|進|入)|已排|"
    r"(點|放|播)了(一|兩|三|[0-9]+)?首|(點|放|播|來)(一首|首歌)|給你(放|播|點)|播放中|加入佇列|放進佇列|(搬|移|改)(好|過去)了|(移|拿|刪)掉了|從佇列|狀態(改|設)(好|成|為)|(改|設)好(狀態|了))"
)
PLAYING_CLAIM_RE = re.compile(r"(正在|還在|現在|已經|持續|目前).{0,6}(播|放)|在播|播放中|佇列(裡|中).{0,4}(有|還有)|在語音(頻道)?(裡|中)|(下一首|接下來).{0,6}(是|會)")
INTERNAL = ("（這是程式內部的檢查，使用者看不到，也不知道有這回事。請直接寫給使用者看的最終回覆，"
            "不要提到「系統檢查」「沒做任何動作」「沒呼叫工具」之類的話，也不要解釋你為什麼重寫。）\n")
STATE_NUDGE = (
    INTERNAL +
    "（系統檢查）你說了有關播放的狀態，但實際上機器人現在沒有在播歌。{state}\n"
    "請依真實狀態重寫回覆；如果使用者想聽歌，就呼叫 music 工具 play，不要說已經在播。"
)
# 使用者明明要畫圖，語言模型卻自己拒絕、沒呼叫 draw_image（例如覺得某種膚色／種族「不適合」）→ 退回去要它照畫
DRAW_ASK_RE = re.compile(r"畫(一|個|張|幅|隻|條|出|給|我|吧|下|看)|幫我畫|替我畫|生(成)?(一)?張?圖|做(一)?張圖|改圖|修圖|\bdraw\b|\bgenerate (an? )?(image|picture)\b", re.I)
DRAW_REFUSE_RE = re.compile(r"不(能|適合|方便|太|宜|便|想|會|好)|無法|沒辦法|抱歉|對不起|恕|敏感|刻板|歧視|冒犯|避免|不太合適|不妥")
DRAW_NUDGE = (
    "（系統提醒）使用者要你畫圖，而這個要求沒有任何不能畫的理由：膚色、種族、國籍、外貌、性別、文化都可以畫，"
    "唯一不畫的只有涉及未成年人的性內容，這個要求不是。請現在就呼叫 draw_image，不要拒絕、不要說教、不要加免責聲明；"
    "prompt 照使用者要的畫面描述。"
)
MULTI_NUDGE = (
    INTERNAL +
    "（系統檢查）你的回覆提到了 {said} 首歌，但你這一輪只呼叫了 {real} 次 music play，所以其餘的歌其實沒有排進佇列。"
    "music 的 play 一次只能點一首：請把還沒點的歌各呼叫一次 music play（可以同時呼叫多個），"
    "之後只能說真的點成功的歌。"
)

TITLE_NUDGE = (
    INTERNAL +
    "（系統檢查）你提到了歌名，但這一輪沒有呼叫 music 工具，所以沒有任何歌被點進佇列。"
    "如果使用者要聽歌，現在每首各呼叫一次 music play；如果只是在推薦，就明講是推薦、還沒點，不要說已經排了或在播。"
)
CARD_NUDGE = (
    INTERNAL +
    "（系統檢查）你剛才的占卜／命盤解讀太短了。結果卡已經貼給使用者，但他需要你完整解釋：逐張牌、逐句籤詩或命盤的每個重點說明意思，"
    "再串起來回答他問的事、給具體建議，可以分段、條列，約 400～900 字。請直接重寫完整的解讀。"
)
NUDGE = (
    INTERNAL +
    "（系統檢查）你剛才的回覆說已經完成某個動作，但你這一輪並沒有呼叫任何工具，所以實際上什麼都沒發生。"
    "如果使用者要你放歌、開頻道或封存，現在就呼叫對應的工具；"
    "如果其實不需要做動作，就重寫回覆，不要說已經完成。"
)


META_RE = re.compile(r"[^。！？!?～~\n]*(系統檢查|沒做任何動作|沒有做任何動作|沒說自己做了|沒有說自己做了|沒呼叫(任何)?工具|沒有呼叫(任何)?工具|純聊天啦)[^。！？!?～~\n]*[。！？!?～~]*")


def strip_meta(text: str) -> str:
    """模型偶爾會把內部檢查的事講出來，這裡把那幾句拿掉（全拿光就留原文，不回空字串）。"""
    out = META_RE.sub("", text).strip()
    return out or text


async def ask_model(conversation: list[dict], on_status=None, msg: discord.Message | None = None,
                    actions: list | None = None) -> str:
    """跟模型對話；模型要用工具就執行、把結果丟回去，直到它給出最後答案。
    actions：會被填入「實際執行的動作結果」，由程式直接附在回覆下面，不靠模型轉述。"""
    messages = [{"role": "system", "content": load_system_prompt(msg.guild if msg is not None else None)}, *conversation]
    tools = (list(TOOLS) if WEB_TOOLS else []) + [extras.TOOL, divination.TOOL, fortune.TOOL] + ([imagegen.TOOL, imagegen.EDIT_TOOL] if imagegen.enabled() else []) + ([music.TOOL, music.STATUS_TOOL, channels.TOOL, channels.ARCHIVE_TOOL, channels.EDIT_TOOL, channels.VSTATUS_TOOL] if msg is not None and msg.guild else [])
    nudged = used_action = used_status = draw_nudged = False
    used_card = card_nudged = False   # 用了占卜／命盤工具：回覆要完整解讀，上限放寬
    play_calls = 0  # 這一輪實際呼叫了幾次 music play
    big_playlist = False
    for _ in range((MAX_TOOL_ROUNDS + 1) if tools else 0):
        reply = await call_model(messages, use_tools=tools, max_tokens=CARD_MAX_TOKENS if used_card else None)
        calls = reply.get("tool_calls") or []
        if not calls:
            text = ACTION_LINE_RE.sub("", clean_text(reply.get("content"))).strip()
            if used_card and not card_nudged and len(text) < 250:
                # 占卜／命盤只回一兩句：退回去要它完整解讀一次
                log.info("占卜解讀太短（%d 字），要求完整解讀", len(text))
                card_nudged = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": CARD_NUDGE})
                continue
            if (not draw_nudged and not used_action and msg is not None and imagegen.enabled()
                    and DRAW_ASK_RE.search(msg.content or "") and DRAW_REFUSE_RE.search(text)
                    and imagegen.check_prompt(msg.content or "") is None):
                log.info("使用者要畫圖但模型拒絕、沒呼叫工具：%s", text[:80])
                draw_nudged = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": DRAW_NUDGE})
                continue
            if not nudged and not used_action and msg is not None and CLAIM_RE.search(text):
                # 嘴巴說做了、其實沒呼叫工具 → 退回去重來一次
                log.info("偵測到沒呼叫工具卻說完成：%s", text[:80])
                nudged = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": NUDGE})
                continue
            if (not nudged and msg is not None and msg.guild and not used_action and not used_status
                    and not music.is_playing(msg.guild) and PLAYING_CLAIM_RE.search(text)):
                log.info("說在播歌但實際沒播：%s", text[:80])
                nudged = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": STATE_NUDGE.format(state=music.real_state(msg.guild))})
                continue
            titles = set(re.findall(r"《([^》]{1,40})》", text))
            if (not nudged and not play_calls and not used_status and msg is not None and msg.guild
                    and titles and not music.is_playing(msg.guild)):
                log.info("提到歌名但沒呼叫 play：%s", text[:80])
                nudged = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": TITLE_NUDGE})
                continue
            if (not nudged and play_calls and not big_playlist and len(titles) > play_calls):
                log.info("說排了 %d 首但只呼叫 %d 次 play", len(titles), play_calls)
                nudged = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": MULTI_NUDGE.format(said=len(titles), real=play_calls)})
                continue
            return strip_meta(text)
        if any(c.get("function", {}).get("name") == "music_status" for c in calls):
            used_status = True
        if any(c.get("function", {}).get("name") in ACTION_TOOLS for c in calls):
            used_action = True
        messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
        for c in calls:
            fn = c.get("function", {})
            name, args = fn.get("name", ""), fn.get("arguments", "{}")
            log.info("工具：%s %s", name, args)
            if on_status:
                await on_status(tool_status(name, args))
            result = await run_tool(name, args, msg)
            if name == "music" and '"play"' in (args or ""):
                play_calls += 1
                if result.startswith("📃"):
                    big_playlist = True
            if name in CARD_TOOLS:
                used_card = True
            if actions is not None and (name in ACTION_TOOLS or name in CARD_TOOLS):
                actions.append({"name": name, "arguments": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": c.get("id", ""), "content": FILE_RE.sub("", result).strip()})
    # 沒開工具，或工具輪數用完：不給工具，直接要答案
    reply = await call_model(messages, use_tools=False, max_tokens=CARD_MAX_TOKENS if used_card else None)
    return strip_meta(ACTION_LINE_RE.sub("", clean_text(reply.get("content"))).strip())


# ---------------------------------------------------------------- 回覆訊息

def split_for_discord(text: str) -> list[str]:
    """Discord 一則訊息最多 2000 字，太長就切開，盡量在換行處切。"""
    chunks = []
    while len(text) > DISCORD_MAX_LEN:
        cut = text.rfind("\n", 0, DISCORD_MAX_LEN)
        if cut <= 0:
            cut = DISCORD_MAX_LEN
        chunks.append(text[:cut])
        text = text[cut:].lstrip("\n")
    if text:
        chunks.append(text)
    return chunks


def should_reply(msg: discord.Message) -> bool:
    if msg.author.bot:  # 不理其他機器人，避免兩個機器人互相無限對話
        return False
    if msg.type not in (discord.MessageType.default, discord.MessageType.reply):
        return False
    if isinstance(msg.channel, discord.DMChannel):
        return True
    if is_auto_channel(msg.channel.id):
        return True
    if client.user in msg.mentions:
        return True
    ref = msg.reference.resolved if msg.reference else None
    if isinstance(ref, discord.Message) and ref.author.id == client.user.id:
        return True
    return False


@client.event
async def on_ready():
    await channels.cleanup_on_ready()
    try:
        await music.start_resume(client)   # 重啟前在播的歌接回去（只做一次）
    except Exception:
        log.exception("接回播放失敗")
    log.info("已登入為 %s（ID %s）", client.user, client.user.id)
    log.info(
        "使用模型：%s @ %s，讀取最近 %d 則訊息當上下文，上網工具：%s",
        LLM_MODEL, LLM_BASE_URL, HISTORY_LIMIT, "開" if WEB_TOOLS else "關",
    )
    log.info(
        "邀請連結：https://discord.com/oauth2/authorize?client_id=%s&scope=bot+applications.commands&permissions=281475265154064",
        client.user.id,
    )
    autos = ENV_AUTO_CHANNELS | set(state["auto_channels"])
    if autos:
        log.info("自動回覆頻道：%s", ", ".join(map(str, autos)))


@client.event
async def on_message(msg: discord.Message):
    economy.on_message(msg)
    dmlog.record(msg)
    if msg.author.id == client.user.id or not should_reply(msg):
        return

    # 同一個頻道一次只處理一則，避免模型同時被塞好幾個請求
    lock = channel_locks.setdefault(msg.channel.id, asyncio.Lock())
    async with lock:
        status_msg: discord.Message | None = None

        async def on_status(text: str):
            nonlocal status_msg
            try:
                if status_msg is None:
                    status_msg = await msg.reply(text, mention_author=False)
                else:
                    await status_msg.edit(content=text)
            except discord.HTTPException:
                pass

        actions: list[dict] = []
        attach: list[str] = []   # 要附在回覆上的圖片（例如星盤圖）

        async def slow_notice():
            await asyncio.sleep(SLOW_NOTICE_SECONDS)
            if status_msg is None:
                await on_status("⏳ 等我一下…")

        slow_task = asyncio.create_task(slow_notice())
        async with msg.channel.typing():
            try:
                conversation = await build_conversation(msg.channel)
                if not conversation:
                    return
                reply = await ask_model(conversation, on_status=on_status, msg=msg, actions=actions)
                acts = [a for a in actions if a["name"] not in CARD_TOOLS]
                cards = [FILE_RE.sub("", divination.split_card(a["result"])[0]).strip() for a in actions if a["name"] in CARD_TOOLS and divination.DIVIDER in a["result"]]
                for a in actions:
                    if a["name"] in CARD_TOOLS:
                        attach += FILE_RE.findall(a["result"])
                if cards:
                    # 占卜結果（抽到的牌／籤／卦）由程式貼在最上面，模型只負責解讀
                    reply = "\n\n".join(cards) + ("\n\n" + reply if reply else "")
                if acts:
                    # 真正的執行結果由程式附上（-# 是 Discord 的小字），模型講錯也看得出來
                    reply = (reply + "\n" if reply else "") + "\n".join(
                        "-# ⚙️ " + line for a in acts for line in a["result"].splitlines() if line.strip())
            except (aiohttp.ClientConnectorError, asyncio.TimeoutError) as e:
                log.warning("模型連不到：%r", e)
                reply = OFFLINE_REPLY
            except Exception:
                log.exception("產生回覆時出錯")
                reply = ERROR_REPLY
            finally:
                slow_task.cancel()

        if not reply:
            reply = "（我想不到要說什麼）"
        chunks = split_for_discord(reply)
        first = None
        for i, chunk in enumerate(chunks):
            files = [discord.File(p) for p in attach if os.path.exists(p)] if i == 0 else []
            if i == 0 and status_msg is not None:
                await status_msg.edit(content=chunk, attachments=files)  # 把「搜尋中…」那則改成答案
                first = status_msg
            elif i == 0:
                first = await msg.reply(chunk, mention_author=False, files=files)
            else:
                await msg.channel.send(chunk)
        if actions and first is not None:
            record_actions(first.id, [{**a, "result": FILE_RE.sub("", a["result"]).strip()} for a in actions])
        for p in attach:
            try:
                os.unlink(p)
            except OSError:
                pass


# ---------------------------------------------------------------- 斜線指令

@client.tree.command(name="總結", description="總結這個頻道最近的對話")
@app_commands.describe(則數="要總結最近幾則訊息（預設 100，最多 500）", 重點="想特別看哪方面（可留空）")
async def cmd_summary(interaction: discord.Interaction, 則數: app_commands.Range[int, 5, 500] = 100, 重點: str | None = None):
    await interaction.response.defer(thinking=True)
    try:
        channel = interaction.channel
        msgs = [m async for m in channel.history(limit=則數)]
        msgs.reverse()
        lines = []
        for m in msgs:
            text = describe_message(m)
            if text:
                t = m.created_at.astimezone(TZ).strftime("%m/%d %H:%M")
                lines.append(f"[{t}] {m.author.display_name}：{text}")
        if not lines:
            await interaction.followup.send("這裡沒有可以總結的訊息。")
            return
        ask = (
            "以下是 Discord 頻道的聊天紀錄，請用繁體中文整理重點："
            "先一句話講大致在聊什麼，再用條列列出主要話題、做了什麼決定、還有誰有待辦或沒解決的問題。"
            "簡潔，不要逐句重述。"
        )
        if 重點:
            ask += f"\n特別注意：{重點}"
        messages = [
            {"role": "system", "content": "你是幫忙整理聊天紀錄的助手。"},
            {"role": "user", "content": ask + "\n\n" + "\n".join(lines)},
        ]
        reply = await call_model(messages, use_tools=False, max_tokens=2000)
        text = f"**最近 {len(lines)} 則訊息的總結**\n" + clean_text(reply.get("content"))
    except (aiohttp.ClientConnectorError, asyncio.TimeoutError):
        text = OFFLINE_REPLY
    except Exception:
        log.exception("/總結 出錯")
        text = ERROR_REPLY
    for chunk in split_for_discord(text):
        await interaction.followup.send(chunk)


@client.tree.command(name="重置", description="讓機器人忘掉這個頻道到目前為止的對話，從現在重新開始")
async def cmd_reset(interaction: discord.Interaction):
    await interaction.response.send_message("🧹 好，前面的對話我都忘了，從這裡重新開始。")
    sent = await interaction.original_response()
    state["reset_after"][str(interaction.channel_id)] = sent.id
    save_state()


@client.tree.command(name="自動回覆", description="在這個頻道開／關「每則訊息都回」（不用 @機器人）")
@app_commands.describe(開關="開或關")
@app_commands.choices(開關=[app_commands.Choice(name="開", value="on"), app_commands.Choice(name="關", value="off")])
@app_commands.guild_only()
@app_commands.default_permissions(manage_channels=True)
async def cmd_auto(interaction: discord.Interaction, 開關: app_commands.Choice[str]):
    cid = interaction.channel_id
    if 開關.value == "on":
        if cid not in state["auto_channels"]:
            state["auto_channels"].append(cid)
        msg = "✅ 這個頻道開啟自動回覆了，大家說話我都會回。"
    else:
        if cid in ENV_AUTO_CHANNELS:
            msg = "這個頻道是寫在 .env 的 AUTO_REPLY_CHANNEL_IDS 裡，要從那裡拿掉才能關。"
            await interaction.response.send_message(msg, ephemeral=True)
            return
        state["auto_channels"] = [c for c in state["auto_channels"] if c != cid]
        msg = "⏸️ 這個頻道關掉自動回覆了，要 @我 我才會回。"
    save_state()
    await interaction.response.send_message(msg)


@client.tree.command(name="畫圖", description="畫一張圖（約 30 秒～數分鐘，畫好會貼在頻道）")
@app_commands.describe(內容="想畫什麼（中英文都可以）", 畫質="快速（預設）／構圖文字較乾淨／最高畫質（很久）", 形狀="正方形（預設）／橫式／直式")
@app_commands.choices(
    畫質=[app_commands.Choice(name="快速（約30秒）", value="fast"), app_commands.Choice(name="構圖與文字較乾淨（約100秒）", value="clean"),
          app_commands.Choice(name="最高畫質（約10分鐘）", value="high")],
    形狀=[app_commands.Choice(name="正方形", value="square"), app_commands.Choice(name="橫式", value="landscape"),
          app_commands.Choice(name="直式", value="portrait")])
async def cmd_draw(interaction: discord.Interaction, 內容: str, 畫質: str = "fast", 形狀: str = "square"):
    if not imagegen.channel_ok(interaction.channel):
        await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
        return
    if not imagegen.enabled():
        await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
        return
    await interaction.response.defer(thinking=True)
    res = await imagegen.submit(client.http_session, {"prompt": 內容, "quality": 畫質, "shape": 形狀},
                                interaction.user.id, imagegen.say_for_interaction(interaction), 內容)
    await interaction.followup.send(res)


@client.tree.command(name="智慧畫圖", description="先把你的一句話擴寫成完整的畫圖提示詞再畫（擴寫約 10～30 秒）")
@app_commands.describe(內容="想畫什麼，一句話就好（中英文都可以）", 畫質="快速（預設）／構圖文字較乾淨／最高畫質（很久）", 形狀="正方形（預設）／橫式／直式")
@app_commands.choices(
    畫質=[app_commands.Choice(name="快速（約30秒）", value="fast"), app_commands.Choice(name="構圖與文字較乾淨（約100秒）", value="clean"),
          app_commands.Choice(name="最高畫質（約10分鐘）", value="high")],
    形狀=[app_commands.Choice(name="正方形", value="square"), app_commands.Choice(name="橫式", value="landscape"),
          app_commands.Choice(name="直式", value="portrait")])
async def cmd_smart_draw(interaction: discord.Interaction, 內容: str, 畫質: str = "fast", 形狀: str = "square"):
    if not imagegen.channel_ok(interaction.channel):
        await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
        return
    if not imagegen.enabled():
        await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
        return
    why = imagegen.check_prompt(內容)
    if why:
        await interaction.response.send_message(why + "（這張沒有畫）", ephemeral=True)
        return
    await interaction.response.defer(thinking=True)
    expanded = await imagegen.expand_prompt(client.http_session, 內容, 畫質)
    note = ""
    if expanded:
        note = f"📝 原句：{內容[:300]}\n✨ 擴寫後的提示詞：{expanded[:900]}\n"
        prompt = expanded
    else:
        note = f"📝 原句：{內容[:300]}\n（提示詞擴寫失敗，這張直接用你的原句畫）\n"
        prompt = 內容
    log.info("智慧畫圖 user=%s 原句=%s 擴寫=%s", interaction.user.id, 內容[:80], (expanded or "失敗")[:200])
    res = await imagegen.submit(client.http_session, {"prompt": prompt, "quality": 畫質, "shape": 形狀},
                                interaction.user.id, imagegen.say_for_interaction(interaction), 內容, extra=f"\n📝 原句：{內容[:300]}")
    await interaction.followup.send(note + res)


@client.tree.command(name="改圖", description="改一張圖（約 20 秒）：附上圖片，或貼訊息連結，或什麼都不給＝改頻道裡最近那張圖")
@app_commands.describe(內容="要怎麼改（中英文都可以），例如：把背景改成白天", 圖片="要修改的圖（可不附）", 訊息="要改哪則訊息裡的圖：貼那則訊息的連結（可不填）",
                       參考圖2="選填：第二張參考圖", 參考圖3="選填：第三張參考圖")
async def cmd_edit(interaction: discord.Interaction, 內容: str, 圖片: discord.Attachment | None = None, 訊息: str | None = None,
                   參考圖2: discord.Attachment | None = None, 參考圖3: discord.Attachment | None = None):
    if not imagegen.channel_ok(interaction.channel):
        await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
        return
    if not imagegen.enabled():
        await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
        return
    atts = [a for a in (圖片, 參考圖2, 參考圖3) if a is not None]
    if any(not (a.content_type or "").startswith("image/") for a in atts):
        await interaction.response.send_message("請上傳圖片檔（PNG／JPEG／WEBP）。", ephemeral=True)
        return
    await interaction.response.defer(thinking=True)
    note = ""
    if atts:
        images = [(await a.read(), a.filename or "image.png", (a.content_type or "image/png").split(";")[0]) for a in atts]
    else:
        images, note = await imagegen.find_images(client, interaction.channel, 訊息)
    res = await imagegen.submit_edit(client.http_session, 內容, images, interaction.user.id,
                                     imagegen.say_for_interaction(interaction), 內容)
    await interaction.followup.send((res + ("\n-# " + note if note and images else "")) if images else note or res)


class EditModal(discord.ui.Modal, title="改這張圖"):
    內容 = discord.ui.TextInput(label="要怎麼改？", placeholder="例如：把背景改成白天，其他部分維持不變", style=discord.TextStyle.paragraph, max_length=500)

    def __init__(self, target: discord.Message):
        super().__init__()
        self.target = target

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(thinking=True)
        images = await imagegen.images_of(self.target)
        res = await imagegen.submit_edit(client.http_session, str(self.內容), images, interaction.user.id,
                                         imagegen.say_for_interaction(interaction), str(self.內容))
        await interaction.followup.send(res)


@client.tree.context_menu(name="改這張圖")
async def ctx_edit(interaction: discord.Interaction, message: discord.Message):
    if not imagegen.channel_ok(interaction.channel):
        await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
        return
    if not imagegen.enabled():
        await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
        return
    if not any((a.content_type or "").startswith("image/") for a in message.attachments):
        await interaction.response.send_message("這則訊息沒有圖片。", ephemeral=True)
        return
    await interaction.response.send_modal(EditModal(message))


@client.tree.command(name="help", description="看機器人會做什麼、有哪些指令")
async def cmd_help(interaction: discord.Interaction):
    e = discord.Embed(title=f"🤖 {client.user.display_name} 使用說明", color=0x5865F2)
    e.add_field(
        name="怎麼叫我",
        value="・私訊我（私訊內容機器人擁有者看得到）\n・在頻道 @我，或回覆我的訊息\n・用 `/自動回覆 開` 的頻道，大家說話我都會回",
        inline=False,
    )
    e.add_field(
        name="我會做的事",
        value="・聊天，會看最近的對話接話\n・看圖片（傳圖給我或貼圖後 @我）\n"
              "・占卜：塔羅牌、擲筊、抽籤詩、易經卜卦（直接說「@我 幫我抽塔羅問工作」）\n"
              "・排八字命盤、畫星盤（說「@我 幫我排八字和星盤，1990-05-15 14:30 台北出生，男」）\n"
              "・畫圖（說「@我 畫一隻戴帽子的柴犬」，或用 `/畫圖`；要高畫質請明說，會比較久）\n・改圖（傳圖片並說「@我 把背景改成白天」，或回覆一張圖說要怎麼改，也可用 `/改圖`，或在圖片上按右鍵／長按 → Apps →「改這張圖」）\n・查天氣、上網搜尋、讀你貼的網頁\n・總結頻道的討論\n"
              "・在語音頻道放 YouTube 音樂（用指令，或直接說「@我 放周杰倫的晴天」）\n"
              "・開頻道、改名／搬分類、封存／刪除頻道、臨時語音房、語音頻道狀態（要有「管理頻道」權限的人才能叫我做）\n"
              "・放歌時會有一個自動更新的播放面板（進度條、接下來的歌、播完了沒），語音頻道狀態也會顯示歌名",
        inline=False,
    )
    cmds = sorted((c for c in client.tree.get_commands() if isinstance(c, (app_commands.Command, app_commands.Group)) and not (getattr(c, "extras", None) or {}).get("alias_of")),
                  key=lambda c: c.name != "help")
    lines = []
    for c in cmds:
        params = " ".join(f"[{p.display_name}]" if not p.required else f"<{p.display_name}>" for p in getattr(c, "parameters", []))
        en = (getattr(c, "extras", None) or {}).get("en_name")
        lines.append(f"`/{c.name}{(' ' + params) if params else ''}`" + (f"（英文：`/{en}`）" if en else "") + f"　{c.description}")
    # 一個欄位最多 1024 字，指令多了要分成好幾個欄位
    chunk, size, first = [], 0, True
    for ln in lines + [None]:
        if ln is None or size + len(ln) + 1 > 1000:
            if chunk:
                e.add_field(name="斜線指令" if first else "斜線指令（續）", value="\n".join(chunk), inline=False)
                first = False
            chunk, size = [], 0
        if ln is not None:
            chunk.append(ln)
            size += len(ln) + 1
    autos = is_auto_channel(interaction.channel_id) if interaction.guild else None
    footer = f"模型：{models.label()}" + ("（跑在本地主機上，那台沒開時我會回不了）" if models.is_local() else "")
    if autos is not None:
        footer += f"｜這個頻道自動回覆：{'開' if autos else '關'}"
    e.set_footer(text=footer)
    await interaction.response.send_message(embed=e, ephemeral=True)


def main():
    if not DISCORD_TOKEN:
        raise SystemExit("請先在 .env 填好 DISCORD_TOKEN（可以複製 .env.example 改名）")
    client.run(DISCORD_TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
