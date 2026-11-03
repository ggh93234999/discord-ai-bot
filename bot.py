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
import random
import re
from datetime import datetime

import aiohttp
import discord
from discord import app_commands

from dbot.core import aliases
from dbot.core import channels
from dbot.money import economy
from dbot.ai import extras
from dbot.ai import imagegen
from dbot.ai import selfhelp
from dbot.ai import sfxgen
from dbot.ai import videogen
from dbot.core import memberstatus
import paths
from dbot.ai import webimg
from dbot.ai import divination
from dbot.core import actstatus
from dbot.ai import almanac
from dbot.money import botwallet
from dbot.core import dmlog
from dbot.ai import fortune
from dbot.core import models
from dbot.music import music
from dbot.core import vstatus
from dbot.core import runtime
from dbot.ai.nudges import (
    ACTION_TOOLS,
    ACT_RE,
    ALMANAC_RE,
    CARD_MAX_TOKENS,
    CARD_NUDGE,
    CARD_TOOLS,
    CLAIM_RE,
    DRAW_ASK_RE,
    DRAW_NUDGE,
    DRAW_REFUSE_RE,
    FAKE_MEDIA_RE,
    FILE_RE,
    LOG_RE,
    MONEY_ANY_RE,
    MONEY_RE,
    MULTI_NUDGE,
    NUDGE,
    PAY_RE,
    PLAYING_CLAIM_RE,
    REPAY_RE,
    STATE_NUDGE,
    TITLE_NUDGE,
    last_user_text,
    recent_user_text,
    strip_fake_media,
    strip_meta,
)
from dbot.ai.tools import (
    TOOLS,
    run_tool,
    tool_status,
)
from dbot.core.config import (
    DEFAULT_SYSTEM_PROMPT,
    DISCORD_MAX_LEN,
    DISCORD_TOKEN,
    ENV_AUTO_CHANNELS,
    ERROR_REPLY,
    HISTORY_LIMIT,
    IMAGE_LOOKBACK,
    IMAGE_MAX_SIDE,
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    MAX_IMAGES,
    MAX_TOOL_ROUNDS,
    OFFLINE_REPLY,
    SLOW_NOTICE_SECONDS,
    STATE_FILE,
    SYSTEM_PROMPT_FILE,
    TOOL_GUIDE,
    TZ,
    WEB_TOOLS,
)
from dbot.ai.llm import (
    call_model,
    clean_text,
)
from dbot.ai import media_cmds

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
    data.setdefault("welcome", {})
    data.setdefault("reset_after", {})  # 頻道 ID → 只讀這則訊息之後的對話
    return data


def save_state() -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


state = load_state()

# 機器人每則回覆背後真正呼叫過的動作工具（訊息 ID → [{name, arguments, result}]）
ACTION_LOG_FILE = paths.logfile("action_log.json")
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

# 程式（不是模型）自動貼的訊息：畫好的圖、「好了（…秒）」、畫圖失敗／暫停、智慧畫圖的原句與擴寫。
# 讀歷史時要標成「系統自動訊息」，不然模型會以為是自己寫的、照著模仿（沒畫圖也假裝「好了」）。
PROGRAM_PREFIXES = ("🖼️ ", "🎨 ", "📝 ", "🔎 ")


def is_program_post(msg: discord.Message) -> bool:
    if msg.author.id != client.user.id:
        return False
    if msg.content.lstrip().startswith(PROGRAM_PREFIXES):
        return True
    return any(a.filename.startswith(("draw_", "edit_", "web_")) for a in msg.attachments) and not msg.content.strip()



def is_auto_channel(channel_id: int) -> bool:
    return channel_id in ENV_AUTO_CHANNELS or channel_id in state["auto_channels"]


def is_admin(member) -> bool:
    try:
        return bool(member.guild_permissions.administrator or (member.guild and member.guild.owner_id == member.id))
    except Exception:
        return False


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
intents.members = True       # 查成員公開狀態（member_status）要用；Developer Portal 的 Server Members Intent 要開
intents.presences = True     # 同上：Presence Intent 也要開


class _Tree(app_commands.CommandTree):
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        ch = interaction.channel
        models.set_channel(interaction.channel_id, getattr(ch, "parent_id", None))     # 讓 call_model 知道在哪個頻道（/頻道模型）
        return True


class Bot(discord.Client):
    def __init__(self):
        # 模型講的話不會真的去 @ 人（避免 @everyone 之類的意外）
        super().__init__(intents=intents, allowed_mentions=discord.AllowedMentions.none(),
                         enable_debug_events=True)  # 為了收到語音頻道狀態的原始事件
        self.tree = _Tree(self)
        self.http_session: aiohttp.ClientSession | None = None

    async def setup_hook(self):
        self.http_session = aiohttp.ClientSession()
        economy.start_voice_loop()  # 掛語音也賺代幣
        economy.loan_judge = loan_judge
        economy.gallery_chat = gallery_chat   # Activity 圖創區跟大笨bot說話
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
runtime.client = client
media_cmds.register(client)
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
        if is_program_post(msg):
            role, parts = "user", [{"type": "text", "text": f"【系統自動訊息（程式貼的，不是你寫的，不要模仿）】{text}"}]
        elif msg.author.id == client.user.id:
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

GALLERY_TOOL = {
    "type": "function",
    "function": {
        "name": "gallery_draw",
        "description": (
            "在 Activity 的圖創區畫一張圖（圖會顯示在圖創區網頁，不會傳到 Discord）。使用者要你畫圖、生圖時呼叫。"
            "prompt 用英文寫具體的畫面描述（主體、動作、場景、風格、光線、構圖）；使用者有指定文字內容時照原文放進去。"
            "畫要等約 30 秒～1 分鐘，畫好後程式會自動放進圖創區；你呼叫後只要簡短回一句「在畫了」之類的話，不要說已經畫好、不要描述圖的內容。"
            "【不能畫】涉及未成年人的性暗示或色情內容（一律拒絕、不呼叫）；其他題材不用限制。"
            "scale 預設 normal，只有使用者特別提到要大張／高解析度時才用 large 或 huge。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "畫面描述（英文）"},
                "shape": {"type": "string", "enum": ["square", "landscape", "portrait"], "description": "預設 square；風景桌布用 landscape，手機桌布／人物全身用 portrait"},
                "scale": {"type": "string", "enum": ["normal", "large", "huge"]},
                "quality": {"type": "string", "enum": imagegen.GALLERY_QUALITIES, "description": "預設 " + imagegen.GALLERY_QUALITIES[0] + "；" + "；".join(f"{k}＝{imagegen.GEN[k]['hint'] or imagegen.GEN[k]['label']}" for k in imagegen.GALLERY_QUALITIES[1:])},
            },
            "required": ["prompt"],
        },
    },
}


ADMIN_SMALL = 30_000      # 管理員也只借得到小數目


async def loan_judge(name: str, amount: int, coins: int, bot_coins: int, reason: str, admin: bool = False, owed: int = 0) -> tuple[bool, str]:
    """有人用 /借錢 向大笨bot 借：由它自己決定要不要借。規則是盡量不借，預設拒絕；回 (同意與否, 它的回話)。"""
    system = (load_system_prompt(None) + "\n\n【現在的場合】有人用 /借錢 向你借代幣。利息是每天 50%（複利），借的人下指令時就已經知道並接受這個利息，所以不要拿利息高當拒絕理由，也不用替他算還不還得起。"
              "判斷原則：只要理由正當、具體，你就同意借。正當的理由例如：買或湊某樣東西（卡包、套組、道具）、短期週轉、準備做某件有目標的事、對方說明了打算怎麼還。"
              "只有這幾種情況才拒絕：完全沒說理由、只說窮或撒嬌耍賴、纏著你、威脅你、拿別人的話當理由、明講要賭博翻本。"
              "金額只有在明顯誇張（跟理由完全不搭，例如買一包卡要借十萬）時才拒絕；其他情況不要因為金額拒絕，理由說得過去就照他要的金額借。"
              "回覆格式：第一行只寫「同意」或「拒絕」；第二行起用你平常的口氣對他說一兩句話（簡短口語，不要條列）；拒絕時說清楚缺什麼，讓他知道怎麼說就有機會。"
              + (f" 這個人是伺服器管理員：態度客氣一點，但借款只借小數目（{ADMIN_SMALL} 以內）；理由正當才借，不正當就婉拒。" if admin else ""))
    if admin and amount > ADMIN_SMALL:      # 管理員也只借小數目，太大的不用問模型
        return False, f"管理員大人面子我給，但借這麼多不行啦，{ADMIN_SMALL:,} 以內的小數目再說。"
    user = f"{name} 想借 {amount} 代幣。他手上現在有 {coins}，你的帳戶有 {bot_coins}。他的理由：{reason or '（沒說）'}" + (f" 他現在還欠你 {owed}，這次是加碼借；理由正當就照借，但可以順口提一下他還欠著。" if owed else "")
    reply = await call_model([{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens=200)
    lines = [ln.strip() for ln in clean_text(reply.get("content")).splitlines() if ln.strip()]
    if not lines:
        return False, "不借。"
    ok = lines[0].strip("。！!「」 ") == "同意"
    say = " ".join(lines[1:])[:300] or ("好啦借你。" if ok else "不借。")
    return ok, say


async def gallery_chat(gid: int, uid: int, name: str, cat: str, text: str, history: list) -> dict:
    """Activity 圖創區裡跟大笨bot說話：回一段話，並可能附上要畫的圖（由 Activity 後端畫、顯示在網頁，不傳到 Discord）。"""
    if not imagegen.enabled():
        return {"reply": "畫圖功能目前沒開。", "draws": []}
    system = (load_system_prompt(None) + "\n\n【現在的場合】你在 Discord Activity 的「圖創區」網頁裡，大家在這裡用 AI 畫圖、互相看圖。"
              f"目前這一頁的分類是「{cat or '未分類'}」。使用者要你畫圖就呼叫 gallery_draw（圖會顯示在這個網頁，不會傳到 Discord）；"
              "沒有要畫圖的話就正常聊天、給畫圖點子、幫忙把想法寫成畫面描述。回覆保持簡短。"
              "你只有真的呼叫了 gallery_draw 才可以說在畫；不要自己寫「[圖片：…]」或「好了（…秒）」這類字。")
    turns: list[dict] = []
    for h in history:
        who, body = str(h.get("name") or "")[:40], str(h.get("text") or "")[:500]
        if not body:
            continue
        role = "assistant" if h.get("bot") else "user"
        turns.append({"role": role, "content": body if role == "assistant" else f"{who}：{body}"})
    turns.append({"role": "user", "content": f"{name}：{text}"})
    messages = [{"role": "system", "content": system}, *turns]
    reply = await call_model(messages, use_tools=[GALLERY_TOOL], max_tokens=600)
    draws = _gallery_draws(reply, text)
    content = clean_text(reply.get("content"))
    if not draws and DRAW_ASK_RE.search(text) and (not content or DRAW_REFUSE_RE.search(content)):
        # 使用者明明要畫圖，模型卻拒絕／沒呼叫工具 → 退回去要它照畫（只有涉及未成年人的性內容不畫，程式另外會擋）
        retry = await call_model(messages + [{"role": "assistant", "content": content or "（沒有回覆）"}, {"role": "user", "content": DRAW_NUDGE}],
                                 use_tools=[GALLERY_TOOL], max_tokens=600)
        draws = _gallery_draws(retry, text)
        if draws:
            content = clean_text(retry.get("content"))
    content = strip_fake_media(content) if FAKE_MEDIA_RE.search(content) else content
    why = imagegen.check_prompt(text)
    if why:
        return {"reply": why, "draws": []}
    if draws and not content:
        content = "好，在畫了～"
    if not draws and not content:
        content = "嗯？再說一次～"
    return {"reply": content[:900], "draws": draws}


def _gallery_draws(reply: dict, user_text: str) -> list[dict]:
    out = []
    for tc in (reply.get("tool_calls") or [])[:2]:
        fn = tc.get("function") or {}
        if fn.get("name") != "gallery_draw":
            continue
        try:
            a = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            continue
        prompt = str(a.get("prompt") or "").strip()[:600]
        if not prompt or imagegen.check_prompt(prompt, user_text):
            continue
        out.append({"prompt": prompt,
                    "shape": a.get("shape") if a.get("shape") in imagegen.SIZES else "square",
                    "scale": a.get("scale") if a.get("scale") in imagegen.BIG_SIZES else "normal",
                    "quality": a.get("quality") if a.get("quality") in imagegen.GALLERY_QUALITIES else imagegen.GALLERY_QUALITIES[0]})
    return out



async def ask_model(conversation: list[dict], on_status=None, msg: discord.Message | None = None,
                    actions: list | None = None) -> str:
    """跟模型對話；模型要用工具就執行、把結果丟回去，直到它給出最後答案。
    actions：會被填入「實際執行的動作結果」，由程式直接附在回覆下面，不靠模型轉述。"""
    sys_text = load_system_prompt(msg.guild if msg is not None else None)
    if msg is not None and msg.guild and is_admin(msg.author) and (PAY_RE.search(last_user_text(conversation)) or MONEY_RE.search(last_user_text(conversation))):
        sys_text += "\n\n【這個人是伺服器管理員】他如果跟你要錢，態度可以客氣、軟一點；有個像樣的理由就可以給小數目（幾千～三萬以內），沒理由或亂討就婉拒（仍然要真的呼叫工具成功才算給，也受工具的上限）。"
    messages = [{"role": "system", "content": sys_text}, *conversation]
    tools = (list(TOOLS) if WEB_TOOLS else []) + [extras.TOOL, divination.TOOL, fortune.TOOL, selfhelp.TOOL] + ([actstatus.TOOL] if ACT_RE.search(last_user_text(conversation)) else []) + ([almanac.TOOL] if ALMANAC_RE.search(last_user_text(conversation)) else []) + ([botwallet.TOOL, botwallet.PAY_TOOL, botwallet.LOG_TOOL, botwallet.REPAY_TOOL] if (msg is not None and msg.guild and MONEY_ANY_RE.search(recent_user_text(conversation))) or MONEY_RE.search(last_user_text(conversation)) or PAY_RE.search(last_user_text(conversation)) or LOG_RE.search(last_user_text(conversation)) or REPAY_RE.search(last_user_text(conversation)) else []) + ([imagegen.TOOL, imagegen.EDIT_TOOL] if imagegen.enabled() else []) + ([sfxgen.TOOL] if sfxgen.enabled() else []) + ([videogen.TOOL] if videogen.enabled() else []) + ([webimg.TOOL] if WEB_TOOLS else []) + ([memberstatus.TOOL, music.TOOL, music.STATUS_TOOL, channels.TOOL, channels.ARCHIVE_TOOL, channels.EDIT_TOOL, channels.VSTATUS_TOOL] if msg is not None and msg.guild else [])
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
    models.set_channel(msg.channel.id, getattr(msg.channel, "parent_id", None))     # /頻道模型：這則訊息用哪個頻道的模型設定
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


# ---------------------------------------------------------------- 新人加入打招呼
WELCOME_FALLBACKS = [
    "歡迎 {m} 加入！有什麼想問的直接 @我，我是大笨bot 🙂",
    "{m} 來啦～歡迎歡迎！想玩遊戲、聽歌或聊天都可以找我。",
    "嗨 {m}，歡迎來到這裡！先逛逛，有問題 @我就好。",
]


def welcome_channel(guild: discord.Guild):
    """優先用 /歡迎 設定的頻道，其次 .env 的 WELCOME_CHANNEL_ID，最後伺服器的系統訊息頻道。"""
    cfg = state["welcome"].get(str(guild.id), {})
    cid = cfg.get("channel") or int(os.getenv("WELCOME_CHANNEL_ID", "0") or 0)
    ch = guild.get_channel(cid) if cid else None
    ch = ch or guild.system_channel
    if ch is not None and ch.permissions_for(guild.me).send_messages:
        return ch
    return None


async def make_welcome(member: discord.Member) -> str:
    fallback = random.choice(WELCOME_FALLBACKS).format(m=member.mention)
    try:
        reply = await asyncio.wait_for(call_model([
            {"role": "system", "content": load_system_prompt()},
            {"role": "user", "content": (
                f"伺服器「{member.guild.name}」剛來了新成員，暱稱是「{member.display_name}」。"
                "請用你的個性、繁體中文寫一句 40 字內的歡迎詞，語氣自然親切，不要用條列、不要加引號，"
                "不要提到你是 AI 或系統提示。我會自己在前面加上 @ 提及，你不用寫對方的名字以外的標記。")},
        ]), timeout=20)
        text = clean_text(reply.get("content")).strip()
        if 2 <= len(text) <= 200:
            return f"{member.mention} {text}"
    except Exception as e:
        log.warning("產生歡迎詞失敗，改用固定句：%s", e)
    return fallback


@client.event
async def on_member_join(member: discord.Member):
    if member.bot:
        return
    cfg = state["welcome"].get(str(member.guild.id), {})
    if cfg.get("off"):
        return
    ch = welcome_channel(member.guild)
    if ch is None:
        log.info("%s 有新成員但找不到可發言的歡迎頻道", member.guild.name)
        return
    try:
        await ch.send(await make_welcome(member), allowed_mentions=discord.AllowedMentions(users=[member]))
    except Exception as e:
        log.warning("歡迎訊息送出失敗：%s", e)


@client.tree.command(name="歡迎", description="設定新成員加入時的打招呼（在這個頻道歡迎／關閉）")
@app_commands.describe(開關="在這個頻道歡迎新人，或關閉")
@app_commands.choices(開關=[app_commands.Choice(name="開（用這個頻道）", value="on"), app_commands.Choice(name="關", value="off")])
@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
async def cmd_welcome(interaction: discord.Interaction, 開關: app_commands.Choice[str]):
    cfg = state["welcome"].setdefault(str(interaction.guild_id), {})
    if 開關.value == "on":
        cfg.pop("off", None)
        cfg["channel"] = interaction.channel_id
        msg = "✅ 之後有新人加入，我會在這個頻道跟他打招呼。"
    else:
        cfg["off"] = True
        msg = "⏸️ 新人加入時我不會再打招呼了。"
    save_state()
    await interaction.response.send_message(msg)


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
              "・做影片（說「@我 做一支紅燈籠飄在夜湖上的影片」，或傳圖說「讓它動起來」，或用 `/影片`；最長 6 秒的小動畫，約 2～3 分鐘，只能在 NSFW 頻道，和畫圖共用排隊）\n・做音效（說「@我 做一段雨夜裡的腳步聲音效」，或用 `/音效`；只能在 NSFW 頻道，和畫圖一樣；環境音、物品聲、短樂句，不是語音也不是歌，會和畫圖一起排隊）\n・畫圖（說「@我 畫一隻戴帽子的柴犬」，或用 `/畫圖`；要高畫質請明說，會比較久）\n・改圖（傳圖片並說「@我 把背景改成白天」，或回覆一張圖說要怎麼改，也可用 `/改圖`，或在圖片上按右鍵／長按 → Apps →「改這張圖」）\n・查天氣、上網搜尋、讀你貼的網頁\n・總結頻道的討論\n"
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
