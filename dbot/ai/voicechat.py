"""語音對話（原型階段）：讓大笨bot 在語音頻道「聽」人說話。

Discord 語音現在有 DAVE 端對端加密；收音套件 discord-ext-voice-recv 只解了傳輸層，
這裡在它解完傳輸層之後，再用 discord.py 自帶的 DAVE session（davey）補解一層。
目前只有 /對話測試：聽 10 秒、把每個人說的話丟給 GOOD 的 whisper-stt 辨識，回報收到多少、解密成功多少。
"""
import asyncio
import io
import logging
import time
import wave

import aiohttp
import discord
from discord import app_commands
from discord.ext import voice_recv

from dbot.core import models
from dbot.core.config import LLM_API_KEY, LLM_BASE_URL

log = logging.getLogger(__name__)

try:
    import davey
except Exception:       # 沒裝就當作沒有 DAVE
    davey = None


class DaveDecryptor:
    """包住 voice_recv 的傳輸層解密，再補一層 DAVE 解密。"""

    def __init__(self, inner, vc, stats: dict):
        self.inner, self.vc, self.stats = inner, vc, stats

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def decrypt_rtp(self, packet):
        data = self.inner.decrypt_rtp(packet)
        st = self.stats
        st["pkts"] += 1
        conn = getattr(self.vc, "_connection", None)
        sess = getattr(conn, "dave_session", None)
        if davey is None or sess is None or not getattr(conn, "dave_protocol_version", 0):
            st["plain"] += 1
            return data
        uid = self.vc._ssrc_to_id.get(packet.ssrc)
        if uid is None:
            st["noid"] += 1
            return data
        try:
            out = sess.decrypt(uid, davey.MediaType.audio, bytes(data))
            st["dave_ok"] += 1
            return out
        except Exception as e:
            st["dave_fail"] += 1
            st["last_err"] = f"{type(e).__name__}: {e}"[:160]
            return data


class CollectSink(voice_recv.AudioSink):
    """每個人的 PCM（48kHz 雙聲道 16 位元）各收一份。"""

    def __init__(self):
        super().__init__()
        self.pcm: dict[int, bytearray] = {}
        self.names: dict[int, str] = {}

    def wants_opus(self) -> bool:
        return False

    def write(self, user, data):
        if user is None or not data.pcm:
            return
        self.pcm.setdefault(user.id, bytearray()).extend(data.pcm)
        self.names[user.id] = getattr(user, "display_name", str(user.id))

    def cleanup(self):
        pass


def _wav16k(pcm48: bytes) -> bytes:
    """48kHz 雙聲道 → 16kHz 單聲道 wav（用 ffmpeg，同步執行；只在背景執行緒呼叫）。"""
    import subprocess
    p = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0",
                        "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"], input=pcm48, capture_output=True, timeout=30)
    return p.stdout


async def transcribe(wav: bytes, prompt: str = "") -> str:
    form = aiohttp.FormData()
    form.add_field("model", "whisper-stt")
    form.add_field("language", "zh")
    if prompt:
        form.add_field("prompt", prompt)
    form.add_field("file", wav, filename="a.wav", content_type="audio/wav")
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s:
        async with s.post(f"{LLM_BASE_URL}/audio/transcriptions", data=form, headers=headers) as r:
            j = await r.json()
            if r.status != 200:
                raise RuntimeError(str(j)[:200])
            return (j.get("text") or "").strip()


async def join_recv(channel: discord.VoiceChannel) -> voice_recv.VoiceRecvClient:
    """用能收音的 VoiceClient 進頻道；原本是一般的就先退出再重進。"""
    vc = channel.guild.voice_client
    if vc is not None and not isinstance(vc, voice_recv.VoiceRecvClient):
        try:
            await asyncio.wait_for(vc.disconnect(force=True), timeout=10)
        except Exception:
            log.exception("離開原本的語音連線失敗")
        vc = None
    if vc is None:
        vc = await channel.connect(cls=voice_recv.VoiceRecvClient, self_deaf=False)
    elif vc.channel.id != channel.id:
        await vc.move_to(channel)
    return vc


def setup(client, tree: app_commands.CommandTree, call_model=None, persona=None):
    if call_model is not None and persona is not None:
        setup_chat(client, tree, call_model, persona)
    @tree.command(name="對話測試", description="（機器人擁有者專用）進你的語音頻道聽 10 秒，測試收得到收不到、辨識準不準")
    async def cmd_voice_test(interaction: discord.Interaction):
        if not await models.is_admin(interaction.user.id):
            await interaction.response.send_message("只有機器人擁有者可以用。", ephemeral=True)
            return
        m = interaction.user
        if not isinstance(m, discord.Member) or not m.voice or not m.voice.channel:
            await interaction.response.send_message("先進一個語音頻道，我才知道要去哪裡聽。", ephemeral=True)
            return
        await interaction.response.send_message("🎧 進頻道中…")
        try:
            vc = await join_recv(m.voice.channel)
        except Exception as e:
            log.exception("對話測試：進語音失敗")
            await interaction.edit_original_response(content=f"進不了語音頻道：{e}")
            return
        stats = {"pkts": 0, "plain": 0, "noid": 0, "dave_ok": 0, "dave_fail": 0, "last_err": ""}
        sink = CollectSink()
        vc.listen(sink)
        vc._reader.decryptor = DaveDecryptor(vc._reader.decryptor, vc, stats)
        conn = vc._connection
        await interaction.edit_original_response(content="🎙️ 開始聽了，請對著頻道說話 10 秒（隨便說一句，例如「大笨機器人幫我播一首米津玄師的檸檬」）…")
        await asyncio.sleep(10)
        vc.stop_listening()
        lines = [f"DAVE 協定版本 {getattr(conn, 'dave_protocol_version', '?')}｜收到封包 {stats['pkts']}（沒加密 {stats['plain']}、DAVE 解密成功 {stats['dave_ok']}、失敗 {stats['dave_fail']}、不知是誰 {stats['noid']}）"]
        if stats["last_err"]:
            lines.append(f"最後一次錯誤：{stats['last_err']}")
        if not sink.pcm:
            lines.append("❌ 沒有收到任何可用的聲音。")
        for uid, buf in sink.pcm.items():
            secs = len(buf) / (48000 * 4)
            try:
                t0 = time.time()
                wav = await asyncio.to_thread(_wav16k, bytes(buf))
                txt = await transcribe(wav, "大笨bot，播放，米津玄師，檸檬")
                lines.append(f"**{sink.names.get(uid, uid)}**（{secs:.1f} 秒，辨識 {time.time() - t0:.1f} 秒）：{txt or '（沒辨識出文字）'}")
            except Exception as e:
                log.exception("對話測試：辨識失敗")
                lines.append(f"**{sink.names.get(uid, uid)}**（{secs:.1f} 秒）：辨識失敗 {e}")
        try:
            await vc.disconnect(force=True)
        except Exception:
            pass
        await interaction.edit_original_response(content="\n".join(lines)[:1900])

# ====================================================================== 語音對話（/對話、/結束對話）
import audioop
import os
import re
import tempfile
import threading
from collections import deque

try:
    import edge_tts
except Exception:
    edge_tts = None
try:
    import opencc
    _S2T = opencc.OpenCC("s2tw")
except Exception:
    _S2T = None

from dbot.ai.llm import clean_text
from dbot.ai.nudges import strip_meta

VOICES = {"曉臻（女）": "zh-TW-HsiaoChenNeural", "曉雨（女）": "zh-TW-HsiaoYuNeural", "雲哲（男）": "zh-TW-YunJheNeural"}
THR = 350                 # 音量門檻（16 位元 PCM 的 rms）；Discord 端已經做過降噪，說話遠高於這個
END_SILENCE = 0.85        # 這麼久沒聲音就當作說完一句
MIN_VOICED = 0.35         # 一句話至少要有這麼久的聲音，太短當雜音
MAX_UTT = 25              # 一句最長秒數
PREROLL = 12              # 開口前多留 12 個 20ms 片段（240ms），避免第一個字被切掉
BARGE_FRAMES = 6          # 機器人說話時連續 120ms 有聲音就打斷它
IDLE_END = 600            # 10 分鐘沒人說話就自動離開
STT_HINT = "以下是台灣人的日常對話，使用繁體中文。大笨bot。"
HALLU = ("字幕", "订阅", "訂閱", "謝謝收看", "謝謝觀看", "感謝觀看", "感谢观看", "Amara", "點贊", "点赞", "請不吝", "明鏡", "中文字幕")
VOICE_RULES = ("\n\n【現在是語音對話】你在跟人用說的聊天：用台灣口語，直接回答，一次只講 1～3 句、總共不要超過 80 字；"
               "不要用條列、標題、粗體、表情符號、網址或括號；數字和英文縮寫照唸得出來的方式寫。聽起來像朋友講話，不要像在寫文章。"
               "這個對話沒有工具可以用：不能播歌、查網路或畫圖，被要求時簡短說這裡不行、可以去文字頻道叫你做。")

sessions: dict[int, "VoiceSession"] = {}


def _pcm_to_wav16k(pcm48: bytes) -> bytes:
    return _wav16k(pcm48)


class ConvSink(voice_recv.AudioSink):
    """在收音的執行緒裡用音量切句；切好的句子由事件迴圈那邊定時來取。"""

    def __init__(self, sess):
        super().__init__()
        self.s = sess
        self.lock = threading.Lock()
        self.cur: dict[int, dict] = {}
        self.run: dict[int, int] = {}

    def wants_opus(self) -> bool:
        return False

    def write(self, user, data):
        if user is None or not data.pcm or not self.s.allowed(user.id):
            return
        pcm = bytes(data.pcm)
        try:
            loud = audioop.rms(pcm[: len(pcm) // 2 * 2], 2) > THR
        except Exception:
            return
        now = time.monotonic()
        with self.lock:
            c = self.cur.setdefault(user.id, {"buf": None, "voiced": 0, "last": 0.0, "t0": 0.0, "pre": deque(maxlen=PREROLL), "name": ""})
            c["name"] = getattr(user, "display_name", str(user.id))
            if c["buf"] is None:
                if loud:
                    c["buf"] = bytearray(b"".join(c["pre"])); c["pre"].clear(); c["buf"].extend(pcm)
                    c["voiced"] = 1; c["last"] = c["t0"] = now
                else:
                    c["pre"].append(pcm)
            else:
                c["buf"].extend(pcm)
                if loud:
                    c["voiced"] += 1; c["last"] = now
        self.run[user.id] = self.run.get(user.id, 0) + 1 if loud else 0
        if loud and self.s.speaking and self.run[user.id] >= BARGE_FRAMES:
            self.s.loop.call_soon_threadsafe(self.s.interrupt)

    def take_ready(self):
        out, now = [], time.monotonic()
        with self.lock:
            for uid, c in self.cur.items():
                if c["buf"] is not None and (now - c["last"] > END_SILENCE or now - c["t0"] > MAX_UTT):
                    buf, voiced = bytes(c["buf"]), c["voiced"]
                    c["buf"] = None; c["voiced"] = 0
                    if voiced * 0.02 >= MIN_VOICED:
                        out.append((uid, c["name"], buf))
        return out

    def cleanup(self):
        pass


def _tts_text(t: str) -> str:
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"[*_`#>~|]", "", t)
    t = re.sub(r"[\U00010000-\U0010ffff☀-➿️]", "", t)     # 表情符號念不出來
    t = re.sub(r"\s+", " ", t).strip()
    return t[:300]


class VoiceSession:
    def __init__(self, guild, vc, text_ch, owner_id, everyone, voice, call_model, persona):
        self.guild, self.vc, self.text_ch, self.owner_id, self.everyone, self.voice = guild, vc, text_ch, owner_id, everyone, voice
        self.call_model, self.persona = call_model, persona
        self.loop = asyncio.get_running_loop()
        self.speaking = False
        self.history: list[dict] = []
        self.queue: asyncio.Queue = asyncio.Queue()
        self.sink = ConvSink(self)
        self.tasks: list[asyncio.Task] = []
        self.last_act = time.monotonic()
        self.closed = False
        self.stats = {"pkts": 0, "plain": 0, "noid": 0, "dave_ok": 0, "dave_fail": 0, "last_err": ""}

    def allowed(self, uid: int) -> bool:
        return self.everyone or uid == self.owner_id

    def start(self):
        self.vc.listen(self.sink)
        self.vc._reader.decryptor = DaveDecryptor(self.vc._reader.decryptor, self.vc, self.stats)
        self.tasks = [asyncio.create_task(self._watch()), asyncio.create_task(self._work())]

    def interrupt(self):
        if self.speaking and self.vc.is_playing():
            self.vc.stop()

    async def say_text(self, text: str):
        try:
            await self.text_ch.send(text[:1900], allowed_mentions=discord.AllowedMentions.none())
        except Exception:
            pass

    async def _watch(self):
        while not self.closed:
            await asyncio.sleep(0.1)
            for item in self.sink.take_ready():
                if self.queue.qsize() >= 3:
                    try:
                        self.queue.get_nowait()
                    except Exception:
                        pass
                self.last_act = time.monotonic()
                await self.queue.put(item)
            humans = [m for m in getattr(self.vc.channel, "members", []) if not m.bot]
            if not humans or time.monotonic() - self.last_act > IDLE_END or not self.vc.is_connected():
                why = "頻道裡沒人了" if not humans else ("太久沒人說話" if self.vc.is_connected() else "語音斷線了")
                asyncio.create_task(self.close(f"👋 {why}，語音對話結束。"))
                return

    async def _work(self):
        while not self.closed:
            uid, name, pcm = await self.queue.get()
            try:
                await self._handle(uid, name, pcm)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("語音對話處理失敗")

    async def _handle(self, uid: int, name: str, pcm: bytes):
        t0 = time.time()
        wav = await asyncio.to_thread(_wav16k, pcm)
        try:
            text = await transcribe(wav, STT_HINT)
        except Exception as e:
            log.warning("語音辨識失敗：%r", e)
            return
        if _S2T:
            text = _S2T.convert(text)
        text = text.strip()
        if len(re.sub(r"[\W_]+", "", text)) < 2 or (len(text) < 25 and any(h in text for h in HALLU)):
            log.info("語音對話：忽略（%r）", text)
            return
        t1 = time.time()
        log.info("語音對話：%s 說「%s」（辨識 %.1fs）", name, text, t1 - t0)
        await self.say_text(f"🎙️ **{name}**：{text}")
        self.history.append({"role": "user", "content": text if not self.everyone else f"{name}說：{text}"})
        del self.history[:-16]
        try:
            from dbot.core import models
            ch = self.text_ch
            models.set_channel(ch.id, getattr(ch, "parent_id", None))
        except Exception:
            pass
        messages = [{"role": "system", "content": self.persona() + VOICE_RULES}, *self.history]
        reply = await self.call_model(messages, use_tools=False, max_tokens=300)
        ans = strip_meta(clean_text(reply.get("content"))).strip()
        t2 = time.time()
        if not ans:
            return
        self.history.append({"role": "assistant", "content": ans})
        await self.say_text(f"🔊 {ans}")
        log.info("語音對話：回答（思考 %.1fs）：%s", t2 - t1, ans[:80])
        await self.speak(ans)

    async def speak(self, text: str):
        text = _tts_text(text)
        if not text or edge_tts is None or self.closed or not self.vc.is_connected():
            return
        if self.vc.is_playing():          # 頻道裡正在放別的聲音（音樂），不搶
            return
        path = os.path.join(tempfile.gettempdir(), f"vc_{self.guild.id}_{int(time.time() * 1000)}.mp3")
        try:
            await edge_tts.Communicate(text, self.voice, rate="+8%").save(path)
            done = asyncio.Event()
            self.speaking = True
            self.vc.play(discord.FFmpegPCMAudio(path), after=lambda e: self.loop.call_soon_threadsafe(done.set))
            await done.wait()
        except Exception:
            log.exception("語音合成／播放失敗")
        finally:
            self.speaking = False
            try:
                os.remove(path)
            except OSError:
                pass
            self.last_act = time.monotonic()

    async def close(self, msg: str = ""):
        if self.closed:
            return
        self.closed = True
        sessions.pop(self.guild.id, None)
        for t in self.tasks:
            if t is not asyncio.current_task():
                t.cancel()
        try:
            self.vc.stop_listening()
        except Exception:
            pass
        try:
            if self.vc.is_playing():
                self.vc.stop()
            await asyncio.wait_for(self.vc.disconnect(force=True), timeout=10)
        except Exception:
            pass
        if msg:
            await self.say_text(msg)


def setup_chat(client, tree: app_commands.CommandTree, call_model, persona):
    @tree.command(name="對話", description="進你的語音頻道，直接用說的跟大笨bot 聊天（說完它會用語音回答）；機器人說話時你開口可以打斷它")
    @app_commands.describe(聲音="大笨bot 說話的聲音", 全員="打開的話頻道裡每個人說的它都會回；預設只回應你")
    @app_commands.choices(聲音=[app_commands.Choice(name=n, value=v) for n, v in VOICES.items()])
    async def cmd_talk(interaction: discord.Interaction, 聲音: app_commands.Choice[str] = None, 全員: bool = False):
        m = interaction.user
        if interaction.guild is None or not isinstance(m, discord.Member) or not m.voice or not m.voice.channel:
            await interaction.response.send_message("先進一個語音頻道，我才知道要去哪裡聽你說話。", ephemeral=True)
            return
        if edge_tts is None:
            await interaction.response.send_message("語音合成套件沒裝好，這個功能暫時不能用。", ephemeral=True)
            return
        g = interaction.guild
        if g.id in sessions:
            s = sessions[g.id]
            await interaction.response.send_message(f"我已經在 {s.vc.channel.mention} 跟人對話了，要先用 `/結束對話`。", ephemeral=True)
            return
        vc0 = g.voice_client
        if vc0 is not None and (vc0.is_playing() or vc0.is_paused()):
            await interaction.response.send_message("音樂還在播，先讓它停下來（例如叫它離開語音頻道）再開始對話。", ephemeral=True)
            return
        await interaction.response.send_message("🎧 進頻道中…")
        try:
            vc = await join_recv(m.voice.channel)
        except Exception as e:
            log.exception("對話：進語音失敗")
            await interaction.edit_original_response(content=f"進不了語音頻道：{e}")
            return
        s = VoiceSession(g, vc, interaction.channel, m.id, bool(全員), (聲音.value if 聲音 else "zh-TW-HsiaoChenNeural"), call_model, persona)
        sessions[g.id] = s
        s.start()
        await interaction.edit_original_response(
            content=f"🎙️ 開始語音對話！直接說話就好，說完停一下我就會回答。用 `/結束對話` 結束。"
                    f"{'（頻道裡每個人說的我都會回）' if 全員 else '（只回應你；要大家都能聊請用「全員」選項）'}\n文字頻道會同步顯示我聽到的和我說的。建議戴耳機，不然喇叭的聲音會被麥克風收進去。")
        await s.speak("我在聽囉，直接說話就可以了。")

    @tree.command(name="結束對話", description="結束語音對話，大笨bot 離開語音頻道")
    async def cmd_talk_end(interaction: discord.Interaction):
        s = sessions.get(interaction.guild_id) if interaction.guild_id else None
        if s is None:
            await interaction.response.send_message("現在沒有在語音對話。", ephemeral=True)
            return
        await interaction.response.send_message("👋 好，先聊到這裡。")
        await s.close()
