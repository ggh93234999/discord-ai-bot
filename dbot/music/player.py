"""每個伺服器一個播放器（GuildPlayer）：連語音、播放迴圈、面板文字、自動離開。"""

from dbot.core import vstatus
import asyncio
import discord
import time
from .tracks import (AVOID_RECENT, COLOR_DONE, COLOR_LEFT, COLOR_PAUSED, COLOR_PLAYING, DEFAULT_VOLUME, FFMPEG_BEFORE, IDLE_LEAVE_SECONDS, MAX_VOLUME, PANEL_REFRESH_SECONDS, REFILL_COUNT, Track, _stream_info, fmt_dur, fmt_pos, get_volume, measure_gain, pick_random, progress_bar, radio_tracks, record_history, save_volume, short)
import logging
log = logging.getLogger("discord-ai-bot.music")

class GuildPlayer:
    def __init__(self, guild: discord.Guild):
        self.guild = guild
        self.queue: list[Track] = []
        self.current: Track | None = None
        self.started_at = 0.0
        self.paused_at = 0.0
        self.text_channel: discord.abc.Messageable | None = None
        self.panel: discord.Message | None = None
        from .panel import PanelView
        self.view = PanelView(self)
        self.last_action: str | None = None
        self.finished_at: float | None = None
        self.radio = False  # 無限電台：佇列空了就用最後一首當種子，從 YouTube 推薦補歌
        self.shuffle_loop = False  # 隨機循環：佇列空了就從播放紀錄補歌
        self.recent: list[str] = []
        self.resume_offset = 0   # 重啟後接回去時，第一首要從第幾秒開始
        self._next = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._alone_task: asyncio.Task | None = None
        self._ticker: asyncio.Task | None = None
        # 語音頻道狀態：放歌前原本的狀態，播完要還原
        self._status_channel: discord.VoiceChannel | None = None
        self._saved_status: str | None = None
        self._status_saved = False

    @property
    def vc(self) -> discord.VoiceClient | None:
        return self.guild.voice_client

    @property
    def volume(self) -> int:
        return get_volume(self.guild.id)

    def set_volume(self, pct: int) -> None:
        """設定音量（百分比）。正在放的歌馬上生效，之後的歌也套用。"""
        pct = max(1, min(MAX_VOLUME, int(pct)))
        save_volume(self.guild.id, pct)
        src = self.vc.source if self.vc else None
        if isinstance(src, discord.PCMVolumeTransformer):
            src.volume = pct / 100

    @property
    def connected(self) -> bool:
        return bool(self.vc and self.vc.is_connected())

    def elapsed(self) -> int:
        if not self.current:
            return 0
        end = self.paused_at or time.time()
        return int(end - self.started_at)

    def remaining_total(self) -> tuple[int, bool]:
        """接下來佇列總長（秒）、是否有長度未知的（直播）。"""
        total, unknown = 0, False
        for t in self.queue:
            if t.duration:
                total += int(t.duration)
            else:
                unknown = True
        return total, unknown

    async def connect(self, channel: discord.VoiceChannel):
        if self.connected:
            if self.vc.channel.id != channel.id:
                await self.restore_status()
                await self.vc.move_to(channel)
        else:
            await channel.connect(self_deaf=False)   # 不自己拒聽：被當成閒置而移到不活躍頻道的機率較低

    def ensure_loop(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def announce(self, text: str):
        if self.text_channel:
            try:
                await self.text_channel.send(text, allowed_mentions=discord.AllowedMentions.none())
            except discord.HTTPException:
                pass

    # --- 語音頻道狀態 ---
    async def apply_status(self, text: str):
        ch = self.vc.channel if self.connected else None
        if not isinstance(ch, discord.VoiceChannel) or ch.id in vstatus.manual:
            return
        if not self._status_saved:
            self._saved_status = vstatus.known.get(ch.id)
            self._status_saved = True
            self._status_channel = ch
        err = await vstatus.set_status(ch, text, reason="大笨bot 播放中")
        if err:
            log.info("設定語音狀態失敗：%s", err)

    async def restore_status(self):
        ch = self._status_channel
        if self._status_saved and ch is not None and ch.id not in vstatus.manual:
            await vstatus.set_status(ch, self._saved_status, reason="大笨bot 停止播放，還原狀態")
        self._status_saved = False
        self._status_channel = None

    # --- 面板 ---
    def build_embed(self, left: bool = False, max_list: int = 8) -> discord.Embed:
        if left:
            e = discord.Embed(title="👋 已離開語音頻道", color=COLOR_LEFT,
                              description="要聽歌再用 `/播放` 或直接叫我放～")
            if self.last_action:
                e.set_footer(text=self.last_action)
            return e

        if self.current:
            paused = bool(self.vc and self.vc.is_paused())
            t = self.current
            e = discord.Embed(
                title="⏸️ 暫停中" if paused else "🎶 正在播放",
                color=COLOR_PAUSED if paused else COLOR_PLAYING,
                description=(f"**[{short(t.title, 60)}]({t.url})**\n"
                             f"{progress_bar(self.elapsed(), t.duration)}\n`{fmt_pos(min(self.elapsed(), t.duration or 10**9))}/{fmt_dur(t.duration)}`\n"
                             f"點歌：{t.requester}"),
            )
            if t.thumbnail:
                e.set_thumbnail(url=t.thumbnail)
        else:
            left_sec = IDLE_LEAVE_SECONDS - int(time.time() - (self.finished_at or time.time()))
            e = discord.Embed(
                title="✅ 歌單播完了",
                color=COLOR_DONE,
                description=(f"佇列已經空了。約 {max(1, round(left_sec / 60))} 分鐘內沒有點歌，我就會離開語音頻道。\n"
                             "用 `/播放` 或直接叫我放歌就能繼續。"),
            )

        if self.queue:
            total, unknown = self.remaining_total()
            lines = [f"`{i}.` {short(q.title)}（{fmt_dur(q.duration)}）· {q.requester}"
                     for i, q in enumerate(self.queue[:max_list], 1)]
            if len(self.queue) > max_list:
                lines.append(f"…還有 {len(self.queue) - max_list} 首")
            name = f"接下來（共 {len(self.queue)} 首，約 {fmt_dur(total) if total else '?'}{' + 直播' if unknown else ''}）"
            e.add_field(name=name, value="\n".join(lines)[:1024], inline=False)
        elif self.current:
            e.add_field(name="接下來", value="沒有了，這是最後一首。用 `/播放` 繼續點歌。", inline=False)

        foot = self.last_action or "⏯️ 暫停/繼續　⏭️ 跳過　🔀 隨機　⏹️ 停止"
        if self.radio:
            foot = "📻 無限電台中（/電台 關 可關閉）· " + foot
        if self.shuffle_loop:
            foot = "🎲 隨機循環中（/隨機循環 關 可關閉）· " + foot
        if self.volume != DEFAULT_VOLUME:
            foot = f"🔊 {self.volume}% · " + foot
        e.set_footer(text=foot)
        return e

    def _panel_buried(self) -> bool:
        """面板上面已經有別的新訊息了（被洗上去），就重新貼到最下面。"""
        if self.panel is None or self.text_channel is None:
            return True
        return getattr(self.text_channel, "last_message_id", None) != self.panel.id

    async def show_panel(self, repost: bool = False, left: bool = False):
        if self.text_channel is None:
            return
        embed = self.build_embed(left=left)
        view = None if left else self.view
        if view is not None:      # 電台開著就把按鈕亮成綠色
            view.radio_btn.style = discord.ButtonStyle.success if self.radio else discord.ButtonStyle.secondary
        if self.panel is not None and not repost:
            try:
                await self.panel.edit(embed=embed, view=view)
                return
            except discord.NotFound:
                self.panel = None
            except discord.HTTPException as e:
                log.info("更新面板失敗：%r", e)
                return
        if self.panel is not None and repost:
            try:
                await self.panel.delete()
            except discord.HTTPException:
                pass
            self.panel = None
        try:
            self.panel = await self.text_channel.send(embed=embed, view=view)
        except discord.HTTPException as e:
            log.info("貼面板失敗：%r", e)

    async def refresh_panel(self):
        if self.panel is not None:
            await self.show_panel()

    async def _tick(self):
        while True:
            await asyncio.sleep(PANEL_REFRESH_SECONDS)
            if self.current and self.vc and self.vc.is_playing():
                await self.refresh_panel()

    # --- 播放迴圈 ---
    async def _loop(self):
        self._ticker = asyncio.create_task(self._tick())
        try:
            while True:
                if not self.queue and self.radio and self.connected:
                    seed = self.recent[-1] if self.recent else (self.current.url if self.current else None)
                    try:
                        picks = await asyncio.to_thread(radio_tracks, seed, REFILL_COUNT, self.recent[-AVOID_RECENT:]) if seed else []
                    except Exception as e:
                        log.warning("電台補歌失敗：%r", e)
                        picks = []
                    if not picks and len(self.recent) > 1:  # 推薦抓不到，換更早的一首當種子
                        try:
                            picks = await asyncio.to_thread(radio_tracks, self.recent[-2], REFILL_COUNT, self.recent[-AVOID_RECENT:])
                        except Exception:
                            picks = []
                    if picks:
                        self.queue.extend(picks)
                    else:
                        self.radio = False
                        if self.text_channel:
                            try:
                                await self.text_channel.send("📻 電台找不到可接的歌，已關閉無限播放。")
                            except discord.HTTPException:
                                pass
                if not self.queue and self.shuffle_loop and self.connected:
                    picks = pick_random(self.guild.id, REFILL_COUNT, self.recent[-AVOID_RECENT:])
                    if picks:
                        self.queue.extend(picks)
                    else:
                        self.shuffle_loop = False
                if not self.queue:
                    # 播完了：還原狀態、面板顯示「播完了」，等一陣子沒人點歌就離開
                    self.current = None
                    self.finished_at = time.time()
                    await self.restore_status()
                    await self.refresh_panel()
                    deadline = time.time() + IDLE_LEAVE_SECONDS
                    last_minute_refresh = time.time()
                    while not self.queue:
                        if time.time() > deadline or not self.connected:
                            if self.connected:
                                await self.vc.disconnect()
                            if not self.last_action or "停止" not in self.last_action:
                                self.last_action = "沒有新的歌，我先離開了"
                            await self.show_panel(left=True)
                            return
                        if time.time() - last_minute_refresh > 60:  # 倒數分鐘數更新
                            last_minute_refresh = time.time()
                            await self.refresh_panel()
                        await asyncio.sleep(2)

                track = self.queue.pop(0)
                self.current = track
                try:
                    info = await asyncio.to_thread(_stream_info, track.url)
                    headers = "".join(f"{k}: {v}\r\n" for k, v in (info.get("http_headers") or {}).items())
                    offset, self.resume_offset = self.resume_offset, 0
                    before = (f"-ss {int(offset)} " if offset > 5 else "") + FFMPEG_BEFORE + (f' -headers "{headers}"' if headers else "")
                    gain = await measure_gain(track.url, info["url"], headers, track.duration)
                    opts = "-vn" + (f" -af volume={gain:.1f}dB,alimiter=limit=0.97" if gain is not None else "")
                    base = await asyncio.to_thread(discord.FFmpegPCMAudio, info["url"], before_options=before, options=opts)
                    source = discord.PCMVolumeTransformer(base, volume=get_volume(self.guild.id) / 100)  # 這樣才能即時調音量
                except Exception as e:
                    log.warning("無法播放 %s：%r", track.url, e)
                    await self.announce(f"⚠️ 這首放不了，跳過：**{track.title}**（{str(e)[:120]}）")
                    self.current = None
                    continue

                if not self.connected:
                    self.current = None
                    continue  # 回到上面，會走「離開」流程
                self._next.clear()
                loop = asyncio.get_running_loop()

                def after(err):
                    if err:
                        log.warning("播放中斷：%r", err)
                    loop.call_soon_threadsafe(self._next.set)

                self.started_at, self.paused_at = time.time() - (offset if offset > 5 else 0), 0.0
                self.vc.play(source, after=after)
                record_history(self.guild.id, track)
                self.recent = (self.recent + [track.url])[-30:]
                await self.apply_status(f"🎶 {track.title}")
                await self.show_panel(repost=self._panel_buried())
                self.last_action = None
                await self._next.wait()
                self.current = None
        finally:
            if self._ticker:
                self._ticker.cancel()

    # --- 控制 ---
    def skip(self) -> bool:
        if self.vc and (self.vc.is_playing() or self.vc.is_paused()):
            self.vc.stop()  # 觸發 after → 下一首
            return True
        return False

    def pause(self) -> bool:
        if self.vc and self.vc.is_playing():
            self.vc.pause()
            self.paused_at = time.time()
            return True
        return False

    def resume(self) -> bool:
        if self.vc and self.vc.is_paused():
            self.vc.resume()
            self.started_at += time.time() - self.paused_at
            self.paused_at = 0.0
            return True
        return False

    async def stop(self):
        self.shuffle_loop = False
        self.radio = False
        self.queue.clear()
        await self.restore_status()
        if self.vc:
            self.vc.stop()
            await self.vc.disconnect()
        self.current = None
        if self._task is None or self._task.done():  # 迴圈沒在跑就自己把面板改成「已離開」
            await self.show_panel(left=True)

    def remove(self, index: int | None = None, query: str | None = None) -> tuple[list[Track], str | None]:
        """移除佇列裡的歌。index 從 1 開始（跟面板的編號一樣）；query 用歌名關鍵字比對。"""
        if not self.queue:
            return [], "佇列是空的，沒有歌可以移除。"
        if index is not None:
            if not 1 <= index <= len(self.queue):
                return [], f"佇列只有 {len(self.queue)} 首，沒有第 {index} 首。"
            return [self.queue.pop(index - 1)], None
        q = (query or "").strip().lower()
        if not q:
            return [], "要移除第幾首，或是哪首歌？"
        hits = [t for t in self.queue if q in t.title.lower()]
        if not hits:
            words = q.split()
            hits = [t for t in self.queue if words and all(w in t.title.lower() for w in words)]
        if not hits:
            return [], f"佇列裡找不到「{query}」。"
        t = hits[0]
        self.queue.remove(t)
        return [t], None

    def clear(self) -> int:
        n = len(self.queue)
        self.queue.clear()
        return n

    def queue_text(self) -> str:
        """給 AI 看的純文字版（面板是給人看的）。"""
        if not self.connected:
            return "目前沒有在放歌，也不在語音頻道。"
        lines = [f"🔊 音量 {self.volume}%"]
        if self.radio:
            lines.append("📻 無限電台開啟中（佇列空了會自動接相似的歌）。")
        if self.shuffle_loop:
            lines.append("🎲 隨機循環開啟中（佇列空了會自動從播放紀錄補歌）。")
        if self.current:
            state = "⏸️ 暫停中" if self.vc.is_paused() else "▶️ 正在播放"
            lines.append(f"{state}：{self.current.title}（{fmt_pos(self.elapsed())} / {fmt_dur(self.current.duration)}）"
                         f"｜點歌：{self.current.requester}")
        else:
            lines.append("✅ 歌單已經播完了，正在等人點歌（沒人點的話幾分鐘後會離開）。")
        if self.queue:
            total, unknown = self.remaining_total()
            lines.append(f"接下來共 {len(self.queue)} 首，約 {fmt_dur(total) if total else '?'}{' + 直播' if unknown else ''}：")
            for i, t in enumerate(self.queue[:15], 1):
                lines.append(f"{i}. {t.title}（{fmt_dur(t.duration)}）｜{t.requester}")
            if len(self.queue) > 15:
                lines.append(f"…還有 {len(self.queue) - 15} 首")
        elif self.current:
            lines.append("接下來沒有歌了，這是最後一首。")
        return "\n".join(lines)


players: dict[int, GuildPlayer] = {}



def get_player(guild: discord.Guild) -> GuildPlayer:
    if guild.id not in players:
        players[guild.id] = GuildPlayer(guild)
    return players[guild.id]
