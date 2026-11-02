"""
模型切換與用量統計。

- /模型：只有機器人擁有者（或 .env 的 ADMIN_USER_IDS）能切換，切之前會先試打一次確認模型真的能用；選擇存在 state.json，重開後還在
- 用量：每次呼叫模型都記一筆（次數、輸入/輸出 token），按日期存在 state.json，/狀態 會顯示今天和近 7 天
- 本機模型（LOCAL_MODELS，預設只有 .env 的 LLM_MODEL）才會送 reasoning_effort / keep_alive 這類 Ollama 專用參數，
  線上模型（例如 deepseek）不送，避免被拒絕
"""

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import aiohttp
import discord
from discord import app_commands

log = logging.getLogger("discord-ai-bot.models")

state: dict = {}
_save = lambda: None
BASE = ""
KEY = ""
DEFAULT = "qwen"
LOCAL: set[str] = set()
ADMINS: set[int] = set()
TZ = ZoneInfo("Asia/Taipei")
KEEP_DAYS = 30

_client: discord.Client | None = None
_owner_ids: set[int] | None = None
_models_cache: tuple[float, list[str]] = (0.0, [])


def setup(client: discord.Client, tree: app_commands.CommandTree, st: dict, save_fn, base: str, key: str,
          default: str, tz):
    global state, _save, BASE, KEY, DEFAULT, LOCAL, ADMINS, TZ, _client
    state, _save, BASE, KEY, DEFAULT, TZ, _client = st, save_fn, base, key, default, tz, client
    LOCAL = {m.strip() for m in os.getenv("LOCAL_MODELS", default).split(",") if m.strip()}
    ADMINS = {int(x) for x in os.getenv("ADMIN_USER_IDS", "").replace(" ", "").split(",") if x.isdigit()}
    st.setdefault("usage", {})

    @tree.command(name="模型", description="看或切換機器人用的 AI 模型（只有機器人擁有者能切）")
    @app_commands.describe(模型="要切換成哪個；不填就只是看現在用哪個")
    async def cmd_model(interaction: discord.Interaction, 模型: str = None):
        if not 模型:
            await interaction.response.send_message(await describe(), ephemeral=True)
            return
        if not await is_admin(interaction.user.id):
            await interaction.response.send_message("只有機器人擁有者可以切換模型。", ephemeral=True)
            return
        await interaction.response.defer()
        await interaction.followup.send(await switch(模型.strip(), interaction.user.display_name))

    @tree.command(name="餘額", description="查 DeepSeek 帳戶還剩多少錢（只有機器人擁有者能查，結果大家看得到）")
    async def cmd_balance(interaction: discord.Interaction):
        if not await is_admin(interaction.user.id):
            await interaction.response.send_message("只有機器人擁有者可以查餘額。", ephemeral=True)
            return
        await interaction.response.defer()  # 大家都看得到
        await interaction.followup.send(await balance_text())

    @cmd_model.autocomplete("模型")
    async def ac_model(interaction: discord.Interaction, current: str):
        names = await list_models()
        return [app_commands.Choice(name=n + ("（本機）" if n in LOCAL else "（線上，計費）"), value=n)
                for n in names if current.lower() in n.lower()][:25]


# ---------------------------------------------------------------- 目前模型

def current() -> str:
    return state.get("model") or DEFAULT


def is_local(model: str | None = None) -> bool:
    return (model or current()) in LOCAL


def label(model: str | None = None) -> str:
    m = model or current()
    return f"{m}（{'本機' if m in LOCAL else '線上，計費'}）"


async def is_admin(user_id: int) -> bool:
    global _owner_ids
    if user_id in ADMINS:
        return True
    if _owner_ids is None:
        try:
            info = await _client.application_info()
            _owner_ids = {info.team.owner_id} if info.team else {info.owner.id}
            if info.team:
                _owner_ids |= {m.id for m in info.team.members if m.role in (discord.TeamMemberRole.admin,)}
        except discord.HTTPException as e:
            log.warning("查不到機器人擁有者：%r", e)
            return False
    return user_id in _owner_ids


async def list_models() -> list[str]:
    global _models_cache
    if time.time() - _models_cache[0] < 60 and _models_cache[1]:
        return _models_cache[1]
    try:
        async with _client.http_session.get(f"{BASE}/models", headers={"Authorization": f"Bearer {KEY}"},
                                            timeout=aiohttp.ClientTimeout(total=6)) as r:
            data = await r.json(content_type=None)
        names = sorted(m["id"] for m in data["data"])
        _models_cache = (time.time(), names)
        return names
    except Exception as e:
        log.info("取得模型清單失敗：%r", e)
        return _models_cache[1] or [current()]


async def test_model(model: str) -> tuple[bool, str]:
    body = {"model": model, "max_tokens": 8, "messages": [{"role": "user", "content": "回一個字：好"}]}
    t0 = time.time()
    try:
        async with _client.http_session.post(f"{BASE}/chat/completions", json=body,
                                             headers={"Authorization": f"Bearer {KEY}"},
                                             timeout=aiohttp.ClientTimeout(total=90)) as r:
            data = await r.json(content_type=None)
            if r.status != 200:
                return False, f"HTTP {r.status}：{str(data)[:150]}"
        record(model, data.get("usage"))
        return True, f"{int((time.time() - t0) * 1000)} ms"
    except asyncio.TimeoutError:
        return False, "90 秒沒回應"
    except Exception as e:
        return False, f"{type(e).__name__}：{e}"


async def switch(model: str, who: str) -> str:
    names = await list_models()
    if model not in names:
        return f"沒有 `{model}` 這個模型。可選：" + "、".join(f"`{n}`" for n in names)
    if model == current():
        return f"本來就在用 {label()}。"
    ok, detail = await test_model(model)
    if not ok:
        return f"❌ 沒有切換：`{model}` 試打失敗（{detail}），還是用 {label()}。"
    old = current()
    if model == DEFAULT:
        state.pop("model", None)
    else:
        state["model"] = model
    _save()
    log.info("%s 把模型從 %s 切到 %s", who, old, model)
    note = "" if model in LOCAL else "\n⚠️ 這是線上模型，聊天內容會送到對方伺服器，而且會計費。用完記得 `/模型 " + DEFAULT + "` 切回來。"
    return f"🔁 {who} 把模型從 **{old}** 切換成 **{label(model)}**（試打 {detail}）。{note}"


# ---------------------------------------------------------------- 餘額（DeepSeek 官方 API）

async def balance_text() -> str:
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not key:
        return ("還沒設定 DeepSeek 的金鑰。到 DeepSeek 平台建立（或用現有的）API key，"
                "在 `.env` 加一行 `DEEPSEEK_API_KEY=sk-...`，再重開機器人就能查。")
    try:
        async with _client.http_session.get("https://api.deepseek.com/user/balance",
                                            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
                                            timeout=aiohttp.ClientTimeout(total=15)) as r:
            data = await r.json(content_type=None)
            if r.status == 401:
                return "❌ DeepSeek 說金鑰無效（401），檢查 `.env` 的 `DEEPSEEK_API_KEY`。"
            if r.status != 200:
                return f"❌ 查詢失敗：HTTP {r.status}　{str(data)[:200]}"
    except asyncio.TimeoutError:
        return "❌ 連 DeepSeek 逾時，等一下再試。"
    except Exception as e:
        return f"❌ 查詢失敗：{type(e).__name__}：{e}"
    infos = data.get("balance_infos") or []
    if not infos:
        return "查不到餘額資料。"
    sym = {"CNY": "¥", "USD": "$"}
    lines = []
    for b in infos:
        cur = b.get("currency", "")
        lines.append(f"**{sym.get(cur, '')}{b.get('total_balance')} {cur}**"
                     f"（儲值 {b.get('topped_up_balance')}，贈送 {b.get('granted_balance')}）")
    status = "✅ 可正常使用" if data.get("is_available") else "⚠️ 餘額不足，API 目前不能呼叫"
    return "💰 DeepSeek 餘額\n" + "\n".join(lines) + f"\n{status}"


# ---------------------------------------------------------------- 用量

def record(model: str, usage: dict | None) -> None:
    day = datetime.now(TZ).strftime("%Y-%m-%d")
    days = state.setdefault("usage", {})
    e = days.setdefault(day, {}).setdefault(model, {"calls": 0, "prompt": 0, "completion": 0})
    e["calls"] += 1
    if isinstance(usage, dict):
        e["prompt"] += int(usage.get("prompt_tokens") or 0)
        e["completion"] += int(usage.get("completion_tokens") or 0)
    for d in sorted(days)[:-KEEP_DAYS]:
        del days[d]
    try:
        _save()
    except OSError as err:
        log.warning("存用量失敗：%r", err)


def _sum(days: list[str]) -> dict[str, dict]:
    tot: dict[str, dict] = {}
    for d in days:
        for m, e in state.get("usage", {}).get(d, {}).items():
            t = tot.setdefault(m, {"calls": 0, "prompt": 0, "completion": 0})
            for k in t:
                t[k] += e.get(k, 0)
    return tot


def _fmt(tot: dict[str, dict]) -> str:
    if not tot:
        return "沒有紀錄"
    lines = []
    for m, e in sorted(tot.items()):
        lines.append(f"`{m}`{'' if m in LOCAL else ' 💰'}：{e['calls']} 次，輸入 {e['prompt']:,} / 輸出 {e['completion']:,} token")
    return "\n".join(lines)


def usage_text() -> str:
    now = datetime.now(TZ)
    today = now.strftime("%Y-%m-%d")
    week = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    return f"**今天**\n{_fmt(_sum([today]))}\n**近 7 天**\n{_fmt(_sum(week))}"


async def describe() -> str:
    names = await list_models()
    return (f"目前使用：**{label()}**\n可選：" + "、".join(f"`{n}`" + ("" if n in LOCAL else "💰") for n in names) +
            "\n（💰 = 線上模型，會計費；用 `/模型 模型名稱` 切換，只有擁有者能切）")
