"""私訊紀錄：讓機器人擁有者看別人私訊機器人的內容（/私訊紀錄，只有自己看得到）。

- 機器人收到私訊時，在 dm_users.json 記下「誰、最後一次什麼時候、私訊幾則、最後一句」，用來列清單。
- 指定使用者時，直接從 Discord 讀機器人跟他的私訊頻道（之前的紀錄也看得到）。
- 只看得到「別人傳給機器人」和「機器人回的」，看不到使用者之間互傳的私訊（Discord 不開放）。
"""
import io
import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import discord
from discord import app_commands

import models

log = logging.getLogger("discord-ai-bot.dmlog")
FILE = Path(__file__).resolve().parent / "dm_users.json"
TZ = ZoneInfo("Asia/Taipei")
try:
    users: dict = json.loads(FILE.read_text(encoding="utf-8"))
except (OSError, ValueError):
    users = {}


def _save():
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(users, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(FILE)


def record(msg: discord.Message):
    """on_message 每則都呼叫；只記私訊、不記機器人自己"""
    if msg.guild is not None or msg.author.bot:
        return
    u = users.setdefault(str(msg.author.id), {"count": 0})
    u["name"] = msg.author.display_name
    u["user"] = str(msg.author)
    u["count"] = u.get("count", 0) + 1
    u["last"] = msg.created_at.timestamp()
    text = msg.content or ("［附件］" if msg.attachments else "［貼圖／其他］")
    u["preview"] = text[:60]
    try:
        _save()
    except OSError as e:
        log.warning("私訊紀錄寫入失敗：%r", e)


def _fmt_time(ts: float) -> str:
    return datetime.fromtimestamp(ts, TZ).strftime("%m-%d %H:%M")


def setup(client: discord.Client, tree: app_commands.CommandTree):
    @tree.command(name="私訊紀錄", description="（機器人擁有者專用）看大家私訊機器人的內容，只有你看得到")
    @app_commands.describe(使用者="要看誰的私訊（不填就列出最近私訊過機器人的人）", 則數="要看最近幾則，預設 30，最多 200")
    async def cmd_dmlog(interaction: discord.Interaction, 使用者: discord.User | None = None,
                        則數: app_commands.Range[int, 1, 200] = 30):
        if not await models.is_admin(interaction.user.id):
            await interaction.response.send_message("這個指令只有機器人擁有者能用。", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        if 使用者 is None:
            rows = sorted(users.items(), key=lambda kv: kv[1].get("last", 0), reverse=True)[:25]
            if not rows:
                await interaction.followup.send("還沒有人私訊過機器人（從這個功能上線後開始記錄；之前的私訊可以直接指定使用者查）。", ephemeral=True)
                return
            lines = [f"`{_fmt_time(u['last'])}` **{discord.utils.escape_markdown(u.get('name', '?'))}**（<@{uid}>）共 {u.get('count', 0)} 則："
                     f"{discord.utils.escape_markdown(u.get('preview', ''))}" for uid, u in rows]
            await interaction.followup.send("📨 最近私訊機器人的人（指定「使用者」可以看完整內容）：\n" + "\n".join(lines)[:1900],
                                            ephemeral=True, allowed_mentions=discord.AllowedMentions.none())
            return
        try:
            ch = 使用者.dm_channel or await 使用者.create_dm()
            msgs = [m async for m in ch.history(limit=則數)]
        except discord.HTTPException as e:
            await interaction.followup.send(f"讀不到跟 {使用者} 的私訊：{e}", ephemeral=True)
            return
        if not msgs:
            await interaction.followup.send(f"{使用者.display_name} 沒有私訊過機器人。", ephemeral=True)
            return
        out = []
        for m in reversed(msgs):
            who = "🤖 機器人" if m.author.id == client.user.id else f"👤 {m.author.display_name}"
            body = m.content or ""
            if m.attachments:
                body += "".join(f"\n　［附件］{a.url}" for a in m.attachments)
            if m.embeds and not body:
                body = "［嵌入內容］"
            out.append(f"[{m.created_at.astimezone(TZ):%Y-%m-%d %H:%M}] {who}：{body}")
        text = "\n".join(out)
        head = f"📨 {使用者.display_name}（{使用者}）跟機器人最近 {len(msgs)} 則私訊"
        if len(text) + len(head) < 1800:
            await interaction.followup.send(head + "\n```\n" + text.replace("```", "ˋˋˋ") + "\n```", ephemeral=True)
        else:
            f = discord.File(io.BytesIO(text.encode("utf-8")), filename=f"dm_{使用者.id}.txt")
            await interaction.followup.send(head + "（內容較長，放在附件）", file=f, ephemeral=True)
