"""播放面板的按鈕（PanelView）。"""

import discord
import random
from .actions import (_need_same_channel, do_radio)
from .player import (GuildPlayer)
from .tracks import (MAX_VOLUME, VOLUME_STEP, short)

class PanelView(discord.ui.View):
    def __init__(self, player: "GuildPlayer"):
        super().__init__(timeout=None)
        self.player = player

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        err = _need_same_channel(interaction.user)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return False
        return True

    async def _done(self, interaction: discord.Interaction, action_text: str):
        self.player.last_action = f"{action_text}（{interaction.user.display_name}）"
        await interaction.response.defer()
        await self.player.refresh_panel()

    @discord.ui.button(emoji="⏯️", style=discord.ButtonStyle.secondary)
    async def toggle(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        if p.pause():
            await self._done(interaction, "⏸️ 暫停")
        elif p.resume():
            await self._done(interaction, "▶️ 繼續")
        else:
            await interaction.response.send_message("現在沒有在播放。", ephemeral=True)

    @discord.ui.button(emoji="⏭️", style=discord.ButtonStyle.secondary)
    async def skip(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        title = p.current.title if p.current else ""
        if p.skip():
            await self._done(interaction, f"⏭️ 跳過了「{short(title, 30)}」")
        else:
            await interaction.response.send_message("現在沒有歌可以跳。", ephemeral=True)

    @discord.ui.button(emoji="🔀", style=discord.ButtonStyle.secondary)
    async def shuffle(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        if len(p.queue) < 2:
            await interaction.response.send_message("接下來的歌不到 2 首，不用打亂。", ephemeral=True)
            return
        random.shuffle(p.queue)
        await self._done(interaction, "🔀 打亂佇列")

    @discord.ui.button(emoji="🔉", style=discord.ButtonStyle.secondary, row=1)
    async def vol_down(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._vol(interaction, -VOLUME_STEP)

    @discord.ui.button(emoji="🔊", style=discord.ButtonStyle.secondary, row=1)
    async def vol_up(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._vol(interaction, VOLUME_STEP)

    @discord.ui.button(emoji="📻", label="電台", style=discord.ButtonStyle.secondary, row=1)
    async def radio_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        p = self.player
        await interaction.response.defer()
        msg = await do_radio(interaction.user, p.text_channel or interaction.channel, not p.radio)
        if not p.radio and "電台" not in msg:
            await interaction.followup.send(msg, ephemeral=True)
        elif msg.startswith(("要先", "進不了")):
            await interaction.followup.send(msg, ephemeral=True)
        await p.refresh_panel()

    async def _vol(self, interaction: discord.Interaction, delta: int):
        p = self.player
        new = max(1, min(MAX_VOLUME, p.volume + delta))
        p.set_volume(new)
        await self._done(interaction, f"🔊 音量 {new}%")

    @discord.ui.button(emoji="⏹️", style=discord.ButtonStyle.danger)
    async def stop_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.player.last_action = f"⏹️ {interaction.user.display_name} 停止播放"
        await interaction.response.defer()
        await self.player.stop()
