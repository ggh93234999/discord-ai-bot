"""動作：點歌、插播、音量、移除、電台、隨機循環、控制。"""

import asyncio
import discord
import random
from .player import (get_player, players)
from .tracks import (AVOID_RECENT, DEFAULT_VOLUME, MAX_QUEUE, MAX_VOLUME, REFILL_COUNT, Track, _resolve, fmt_dur, get_volume, history, history_text, pick_random, save_volume, short)
import logging
log = logging.getLogger("discord-ai-bot.music")

async def do_play(member: discord.Member, text_channel, query: str, position: str = "end") -> str:
    """position：end＝排到最後；next＝插到下一首；now＝插隊並立刻播（現在這首被跳過）。"""
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    player = get_player(member.guild)
    if len(player.queue) >= MAX_QUEUE:
        return f"佇列已經有 {MAX_QUEUE} 首了，先聽完一些吧。"
    try:
        tracks, pl_title = await asyncio.to_thread(_resolve, query, member.display_name)
    except Exception as e:
        log.warning("搜尋失敗 %s：%r", query, e)
        return f"找不到或抓不到：{str(e)[:150]}"
    if not tracks:
        return f"YouTube 上找不到「{query}」。"
    return await enqueue_tracks(member, text_channel, tracks, pl_title, position)


async def enqueue_tracks(member: discord.Member, text_channel, tracks: list[Track], pl_title: str | None,
                         position: str = "end") -> str:
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    player = get_player(member.guild)
    if len(player.queue) >= MAX_QUEUE:
        return f"佇列已經有 {MAX_QUEUE} 首了，先聽完一些吧。"
    try:
        await player.connect(member.voice.channel)
    except Exception as e:
        log.exception("連語音頻道失敗")
        return f"進不了語音頻道（{e}），檢查一下我有沒有「連線」和「說話」權限。"
    player.text_channel = text_channel
    was_idle = player.current is None and not player.queue
    room = tracks[: MAX_QUEUE - len(player.queue)]
    if position in ("next", "now") and not was_idle:
        player.queue[0:0] = room  # 插到最前面（整串播放清單也一起插進去，順序不變）
    else:
        player.queue.extend(room)
    skipped = None
    if position == "now" and player.current:
        skipped = player.current.title
        player.last_action = f"⏩ {member.display_name} 插播：{short(room[0].title, 30)}" if room else None
        player.skip()
    player.ensure_loop()
    if player.current:  # 正在放歌：面板的「接下來」馬上更新
        asyncio.create_task(player.refresh_panel())
    where = {"next": "插到下一首", "now": "插播，馬上播"}.get(position, "加入佇列")
    if pl_title or len(tracks) > 1:
        if position in ("next", "now") and not was_idle:
            return f"📃 {where}：播放清單「{pl_title or ''}」共 {len(room)} 首。" + (f"（跳過了「{skipped}」）" if skipped else "")
        return f"📃 加入播放清單「{pl_title or ''}」共 {len(tracks)} 首。"
    t = tracks[0]
    if was_idle:
        return f"▶️ 準備播放：**{t.title}**（{fmt_dur(t.duration)}）"
    if position == "now":
        return f"⏩ 插播：**{t.title}**（{fmt_dur(t.duration)}）" + (f"　（跳過了「{skipped}」）" if skipped else "")
    if position == "next":
        return f"⤴️ 插到下一首：**{t.title}**（{fmt_dur(t.duration)}）"
    return f"➕ 已加入佇列第 {len(player.queue)} 首：**{t.title}**（{fmt_dur(t.duration)}）"


class SearchView(discord.ui.View):
    """搜尋結果：先從選單選一首，再按按鈕決定怎麼放（加到最後／插到下一首／立刻播）。"""

    def __init__(self, owner_id: int, text_channel, tracks: list[Track]):
        super().__init__(timeout=120)
        self.owner_id, self.text_channel, self.tracks = owner_id, text_channel, tracks
        self.chosen: int | None = None
        self.message: discord.Message | None = None
        self.select = discord.ui.Select(
            placeholder="先選一首歌…",
            options=[discord.SelectOption(label=short(t.title, 95), description=fmt_dur(t.duration), value=str(i))
                     for i, t in enumerate(tracks)],
        )
        self.select.callback = self.on_select
        self.add_item(self.select)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message("這是別人的搜尋結果，你可以自己用 `/搜尋`。", ephemeral=True)
            return False
        return True

    async def on_select(self, interaction: discord.Interaction):
        self.chosen = int(self.select.values[0])
        for o in self.select.options:
            o.default = o.value == str(self.chosen)
        await interaction.response.edit_message(view=self)

    async def _go(self, interaction: discord.Interaction, position: str):
        if self.chosen is None:
            await interaction.response.send_message("先從上面的選單選一首。", ephemeral=True)
            return
        await interaction.response.defer()
        text = await enqueue_tracks(interaction.user, self.text_channel, [self.tracks[self.chosen]], None, position)
        self.stop()
        await interaction.edit_original_response(content=text, embed=None, view=None)

    @discord.ui.button(label="加到最後", emoji="➕", style=discord.ButtonStyle.primary, row=1)
    async def b_end(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._go(interaction, "end")

    @discord.ui.button(label="插到下一首", emoji="⤴️", style=discord.ButtonStyle.secondary, row=1)
    async def b_next(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._go(interaction, "next")

    @discord.ui.button(label="立刻播", emoji="⏩", style=discord.ButtonStyle.secondary, row=1)
    async def b_now(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._go(interaction, "now")

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(content="⌛ 搜尋結果過期了，要的話再 `/搜尋` 一次。", embed=None, view=None)
            except discord.HTTPException:
                pass


async def do_volume(member: discord.Member, level: int | None) -> str:
    gid = member.guild.id
    if level is None:
        return f"🔊 目前音量 {get_volume(gid)}%（範圍 1~{MAX_VOLUME}，預設 {DEFAULT_VOLUME}）。"
    level = max(1, min(MAX_VOLUME, int(level)))
    p = players.get(gid)
    if p and p.connected:
        err = _need_same_channel(member)
        if err:
            return err
        p.set_volume(level)
        p.last_action = f"🔊 {member.display_name} 把音量調到 {level}%"
        asyncio.create_task(p.refresh_panel())
        warn = "（超過 100% 可能會破音）" if level > 100 else ""
        return f"🔊 音量 {level}%{warn}"
    save_volume(gid, level)
    return f"🔊 音量先設成 {level}%，下次放歌就會套用。"


def _need_same_channel(member) -> str | None:
    p = players.get(member.guild.id) if getattr(member, "guild", None) else None
    if not p or not p.connected:
        return "我現在沒有在放歌。"
    if not member.voice or member.voice.channel != p.vc.channel:
        return "要跟我在同一個語音頻道才能控制喔。"
    return None


async def do_remove(member: discord.Member, target: str | int | None) -> str:
    err = _need_same_channel(member)
    if err:
        return err
    p = players[member.guild.id]
    index, query = None, None
    if isinstance(target, int):
        index = target
    elif target is not None:
        t = str(target).strip().lstrip("#第").rstrip("首")
        if t.isdigit():
            index = int(t)
        else:
            query = str(target)
    if index is None and query and p.current and query.strip().lower() in p.current.title.lower() \
            and not any(query.strip().lower() in t.title.lower() for t in p.queue):
        return f"「{p.current.title}」是現在正在放的，要跳過請用 /跳過。"
    removed, err = p.remove(index, query)
    if err:
        return err
    p.last_action = f"🗑️ {member.display_name} 移除了「{short(removed[0].title, 30)}」"
    asyncio.create_task(p.refresh_panel())
    return f"🗑️ 從佇列移除：**{removed[0].title}**（剩 {len(p.queue)} 首）"


RADIO_SEEDS = ["周杰倫 晴天", "五月天 倔強", "告五人 披星戴月的想你", "田馥甄 小幸運", "蔡依林 日不落", "Ed Sheeran Shape of You",
               "YOASOBI アイドル", "Official髭男dism Pretender", "Bruno Mars Uptown Funk", "Taylor Swift Shake It Off"]


async def do_radio(member: discord.Member, text_channel, on: bool, seed: str | None = None) -> str:
    """無限電台：不用選歌，一直自動接相似的歌。有給 seed 就先放那首當起點。"""
    if not on:
        p = players.get(member.guild.id)
        if not p or not p.radio:
            return "電台本來就沒開。"
        p.radio = False
        p.last_action = f"📻 {member.display_name} 關閉電台"
        asyncio.create_task(p.refresh_panel())
        return "📻 關閉電台，現有佇列放完就結束。"
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    player = get_player(member.guild)
    msg = ""
    if seed:
        msg = await do_play(member, text_channel, seed, "end")
        if not player.connected:
            return msg
    else:
        try:
            await player.connect(member.voice.channel)
        except Exception as e:
            return f"進不了語音頻道（{e}）。"
        if player.current is None and not player.queue and not player.recent:
            # 沒指定起點、也沒在放歌：直接隨機一首當起點（有播放紀錄就從紀錄挑，沒有就從內建熱門歌挑）
            h = history.get(str(member.guild.id))
            if h:
                player.recent.append(random.choice(h)["url"])
            else:
                msg = await do_play(member, text_channel, random.choice(RADIO_SEEDS), "end")
                if not player.connected:
                    return msg
    player.text_channel = text_channel
    player.radio = True
    player.shuffle_loop = False
    player.last_action = f"📻 {member.display_name} 開啟無限電台"
    player.ensure_loop()
    if player.current:
        asyncio.create_task(player.refresh_panel())
    return ((msg + "\n") if msg else "") + "📻 無限電台開啟：佇列空了會自動接相似的歌，一直放下去。要停就 `/停止` 或 `/電台 關`。"


async def do_random(member: discord.Member, text_channel, on: bool) -> str:
    if not on:
        p = players.get(member.guild.id)
        if not p or not p.shuffle_loop:
            return "隨機循環本來就沒開。"
        p.shuffle_loop = False
        p.last_action = f"🎲 {member.display_name} 關閉隨機循環"
        asyncio.create_task(p.refresh_panel())
        return "🎲 關閉隨機循環，現有佇列放完就結束。"
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return "要先進一個語音頻道，我才知道要去哪裡放。"
    if not history.get(str(member.guild.id)):
        return "還沒有播放紀錄可以隨機，先點幾首歌吧。"
    player = get_player(member.guild)
    try:
        await player.connect(member.voice.channel)
    except Exception as e:
        log.exception("連語音頻道失敗")
        return f"進不了語音頻道（{e}），檢查一下我有沒有「連線」和「說話」權限。"
    player.text_channel = text_channel
    player.shuffle_loop = True
    player.last_action = f"🎲 {member.display_name} 開啟隨機循環"
    if not player.queue and player.current is None:
        player.queue.extend(pick_random(member.guild.id, REFILL_COUNT, player.recent[-AVOID_RECENT:]))
    player.ensure_loop()
    if player.current:
        asyncio.create_task(player.refresh_panel())
    return "🎲 開啟隨機循環：會從播放紀錄隨機挑歌一直放，佇列空了自動補。要停就 `/停止` 或 `/隨機循環 關`。"


async def do_control(member: discord.Member, action: str) -> str:
    if action == "history":
        return history_text(member.guild.id)
    if action == "queue":
        p = players.get(member.guild.id)
        return p.queue_text() if p else "目前沒有在放歌，佇列也是空的。"
    err = _need_same_channel(member)
    if err:
        return err
    p = players[member.guild.id]
    name = member.display_name
    if action == "skip":
        title = p.current.title if p.current else ""
        if not p.skip():
            return "現在沒有歌可以跳。"
        p.last_action = f"⏭️ {name} 跳過了「{short(title, 30)}」"
        return f"⏭️ 跳過：**{title}**"
    if action == "pause":
        if not p.pause():
            return "現在沒有在播放。"
        p.last_action = f"⏸️ {name} 暫停"
        asyncio.create_task(p.refresh_panel())
        return "⏸️ 暫停。"
    if action == "resume":
        if not p.resume():
            return "現在沒有暫停。"
        p.last_action = f"▶️ {name} 繼續播放"
        asyncio.create_task(p.refresh_panel())
        return "▶️ 繼續播放。"
    if action == "stop":
        p.last_action = f"⏹️ {name} 停止播放"
        await p.stop()
        return "⏹️ 停止播放、清空佇列，我離開語音頻道了。"
    if action == "clear":
        n = p.clear()
        if not n:
            return "佇列本來就是空的。"
        p.last_action = f"🧹 {name} 清空了佇列"
        asyncio.create_task(p.refresh_panel())
        return f"🧹 清空佇列，拿掉 {n} 首（現在這首會放完）。"
    if action == "shuffle":
        random.shuffle(p.queue)
        p.last_action = f"🔀 {name} 打亂了佇列"
        asyncio.create_task(p.refresh_panel())
        return f"🔀 把接下來的 {len(p.queue)} 首打亂了。"
    return f"不認識的動作：{action}"
