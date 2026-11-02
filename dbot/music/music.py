"""
音樂播放：從 YouTube 搜尋／貼網址，在語音頻道播放。

- 播放面板：一則會自己更新的訊息，顯示正在播放（進度條）、接下來的歌、播完了沒，附控制按鈕
- 語音頻道狀態：播歌時自動把語音頻道狀態改成「🎶 歌名」，播完／離開時還原
- 斜線指令：/播放 /插播 /跳過 /暫停 /繼續 /停止 /佇列 /隨機 /移除 /清空佇列
- 播放紀錄：每首播過的歌記在 play_history.json；/歷史 看紀錄、/隨機循環 從紀錄隨機一直放
- AI 工具：music（讓 @機器人 放某某歌 也能用）

需要：伺服器裝 ffmpeg、node；Python 套件 discord.py[voice]、yt-dlp[default]
"""

import asyncio
import json
import logging
import random
import os
import re
import time
from pathlib import Path
from dataclasses import dataclass, field

import discord
import yt_dlp
from discord import app_commands

from dbot.core import vstatus
import paths

log = logging.getLogger("discord-ai-bot.music")

from .tracks import (
    ALONE_LEAVE_SECONDS,
    AVOID_RECENT,
    COLOR_DONE,
    COLOR_LEFT,
    COLOR_PAUSED,
    COLOR_PLAYING,
    DEFAULT_VOLUME,
    FFMPEG_BEFORE,
    HISTORY_FILE,
    IDLE_LEAVE_SECONDS,
    MAX_HISTORY,
    MAX_PLAYLIST,
    MAX_QUEUE,
    MAX_VOLUME,
    NORMALIZE,
    PANEL_REFRESH_SECONDS,
    REFILL_COUNT,
    RESUME_MAX_AGE,
    SETTINGS_FILE,
    STATE_FILE,
    TARGET_LUFS,
    Track,
    URL_RE,
    VOLUME_STEP,
    YDL_BASE,
    YT_ID_RE,
    _YT_FALLBACK_CLIENTS,
    _gain_cache,
    _load_history,
    _load_settings,
    _playable,
    _resolve,
    _search,
    _stream_info,
    _video_id,
    _wait_available,
    fmt_dur,
    fmt_pos,
    get_volume,
    history,
    history_text,
    measure_gain,
    pick_random,
    progress_bar,
    radio_tracks,
    record_history,
    save_volume,
    settings,
    short,
)
from .player import (
    GuildPlayer,
    get_player,
    players,
)
from .panel import (
    PanelView,
)
from .persist import (
    _resume_started,
    _snapshot,
    _state_saver,
    resume_all,
    start_resume,
)
from .actions import (
    RADIO_SEEDS,
    SearchView,
    _need_same_channel,
    do_control,
    do_play,
    do_radio,
    do_random,
    do_remove,
    do_volume,
    enqueue_tracks,
)
from .ai_tools import (
    STATUS_TOOL,
    TOOL,
    is_playing,
    real_state,
    run_tool,
    tool_status,
)

_client: discord.Client | None = None

# ---------------------------------------------------------------- 斜線指令 & 事件

def setup(client: discord.Client, tree: app_commands.CommandTree):
    global _client
    _client = client

    @tree.command(name="播放", description="從 YouTube 放歌（歌名、YouTube 網址或播放清單網址）")
    @app_commands.describe(歌曲="歌名（可加歌手）或 YouTube 網址")
    @app_commands.guild_only()
    async def cmd_play(interaction: discord.Interaction, 歌曲: str):
        await interaction.response.defer(thinking=True)
        await interaction.followup.send(await do_play(interaction.user, interaction.channel, 歌曲))

    @tree.command(name="插播", description="插歌：插到下一首播，或立刻播（跳過現在這首）")
    @app_commands.describe(歌曲="歌名（可加歌手）或 YouTube 網址", 立刻播="開＝馬上播並跳過現在這首；不開＝插到下一首")
    @app_commands.guild_only()
    async def cmd_playnext(interaction: discord.Interaction, 歌曲: str, 立刻播: bool = False):
        await interaction.response.defer(thinking=True)
        await interaction.followup.send(await do_play(interaction.user, interaction.channel, 歌曲, "now" if 立刻播 else "next"))

    @tree.command(name="音量", description="看或調整音量（1~150%，100 是正常；不填就是看現在多少）")
    @app_commands.describe(音量="音量百分比，1~150")
    @app_commands.guild_only()
    async def cmd_volume(interaction: discord.Interaction, 音量: app_commands.Range[int, 1, MAX_VOLUME] = None):
        await interaction.response.send_message(await do_volume(interaction.user, 音量))

    @tree.command(name="搜尋", description="搜 YouTube 列出前 5 首，自己選一首，再決定加到最後／插到下一首／立刻播")
    @app_commands.describe(關鍵字="歌名或關鍵字")
    @app_commands.guild_only()
    async def cmd_search(interaction: discord.Interaction, 關鍵字: str):
        if not interaction.user.voice or not interaction.user.voice.channel:
            await interaction.response.send_message("要先進一個語音頻道，我才知道要去哪裡放。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        try:
            tracks = await asyncio.to_thread(_search, 關鍵字, interaction.user.display_name)
        except Exception as e:
            log.warning("搜尋失敗 %s：%r", 關鍵字, e)
            await interaction.followup.send(f"搜尋失敗：{str(e)[:150]}")
            return
        if not tracks:
            await interaction.followup.send(f"YouTube 上找不到「{關鍵字}」。")
            return
        lines = [f"`{i}.` {short(t.title, 70)}（{fmt_dur(t.duration)}）" for i, t in enumerate(tracks, 1)]
        e = discord.Embed(title=f"🔎 「{short(關鍵字, 40)}」的搜尋結果", description="\n".join(lines), color=COLOR_DONE)
        e.set_footer(text="用下面的選單選一首，再按按鈕決定怎麼放")
        view = SearchView(interaction.user.id, interaction.channel, tracks)
        view.message = await interaction.followup.send(embed=e, view=view, wait=True)

    @tree.command(name="佇列", description="把播放面板叫到最下面：正在放什麼、接下來的歌、播完了沒")
    @app_commands.guild_only()
    async def cmd_queue(interaction: discord.Interaction):
        p = players.get(interaction.guild_id)
        if not p or not p.connected:
            await interaction.response.send_message("目前沒有在放歌，也不在語音頻道。用 `/播放` 開始點歌。", ephemeral=True)
            return
        await interaction.response.send_message("📋 播放面板在下面 👇", ephemeral=True)
        if p.text_channel is None or p.text_channel.id != interaction.channel_id:
            if p.panel is not None:  # 換到這個頻道顯示
                try:
                    await p.panel.edit(view=None)
                except discord.HTTPException:
                    pass
                p.panel = None
            p.text_channel = interaction.channel
        await p.show_panel(repost=True)

    def simple(name, action, desc):
        @tree.command(name=name, description=desc)
        @app_commands.guild_only()
        async def _cmd(interaction: discord.Interaction):
            await interaction.response.send_message(await do_control(interaction.user, action))
        return _cmd

    simple("跳過", "skip", "跳過現在這首")
    simple("暫停", "pause", "暫停播放")
    simple("繼續", "resume", "繼續播放")
    simple("停止", "stop", "停止播放、清空佇列並離開語音頻道")
    simple("隨機", "shuffle", "把佇列裡接下來的歌打亂")
    simple("清空佇列", "clear", "把接下來的歌全部拿掉（現在這首會放完）")

    @tree.command(name="歷史", description="看播放紀錄（最近播過的歌）")
    @app_commands.guild_only()
    async def cmd_history(interaction: discord.Interaction):
        await interaction.response.send_message(history_text(interaction.guild_id), ephemeral=True)

    @tree.command(name="電台", description="無限隨便放：不用選歌，自動接相似的歌一直放（可給起點歌）")
    @app_commands.describe(開關="開 或 關", 起點="從哪首歌開始（不填就接目前這首）")
    @app_commands.choices(開關=[app_commands.Choice(name="開", value="on"), app_commands.Choice(name="關", value="off")])
    @app_commands.guild_only()
    async def cmd_radio(interaction: discord.Interaction, 開關: app_commands.Choice[str] = None, 起點: str = None):
        await interaction.response.defer(thinking=True)
        on = (開關.value if 開關 else "on") == "on"
        await interaction.followup.send(await do_radio(interaction.user, interaction.channel, on, 起點))

    @tree.command(name="隨機循環", description="懶得選歌？從播放紀錄隨機一直放，佇列空了自動補")
    @app_commands.describe(開關="開 或 關")
    @app_commands.choices(開關=[app_commands.Choice(name="開", value="on"), app_commands.Choice(name="關", value="off")])
    @app_commands.guild_only()
    async def cmd_random(interaction: discord.Interaction, 開關: app_commands.Choice[str] = None):
        await interaction.response.defer(thinking=True)
        on = (開關.value if 開關 else "on") == "on"
        await interaction.followup.send(await do_random(interaction.user, interaction.channel, on))

    @tree.command(name="移除", description="從佇列移除某一首歌（編號看播放面板）")
    @app_commands.describe(歌曲="佇列編號（例如 3）或歌名關鍵字")
    @app_commands.guild_only()
    async def cmd_remove(interaction: discord.Interaction, 歌曲: str):
        await interaction.response.send_message(await do_remove(interaction.user, 歌曲))


async def on_voice_state_update(member: discord.Member, before, after):
    client = _client
    p = players.get(member.guild.id)
    if not p:
        return
    if (member.id == client.user.id and before.channel and after.channel
            and after.channel != before.channel and after.channel == member.guild.afk_channel):
        # 被伺服器的「不活躍」機制移進掛機頻道：自己移回原本的頻道
        log.warning("機器人被移到不活躍頻道 %s，嘗試移回 %s", after.channel.name, before.channel.name)
        async def back():
            await asyncio.sleep(1)
            try:
                if p.vc:
                    await p.vc.move_to(before.channel)
                    log.info("已移回 %s", before.channel.name)
            except Exception as e:
                log.warning("移回原頻道失敗：%r", e)
        asyncio.create_task(back())
        return
    if member.id == client.user.id and after.channel is None:
        # 被踢出或斷線：清掉佇列，迴圈會把面板改成「已離開」
        p.queue.clear()
        if p.vc:
            p.vc.stop()
        p._next.set()  # 保險：叫醒卡在「等這首播完」的迴圈
        return
    if not p.connected:
        return
    humans = [uid for uid in p.vc.channel.voice_states if uid != client.user.id]
    if not humans and (p._alone_task is None or p._alone_task.done()):
        async def leave_if_still_alone():
            await asyncio.sleep(ALONE_LEAVE_SECONDS)
            if p.connected and not [u for u in p.vc.channel.voice_states if u != client.user.id]:
                p.last_action = "語音頻道沒人了，我先離開"
                await p.stop()
        p._alone_task = asyncio.create_task(leave_if_still_alone())
