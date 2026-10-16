"""
小工具：投票、抽籤、機器人狀態。

- /投票 題目 選項…  ：按鈕投票，每人一票（可改票），到時間自動公布結果；發起人或有「管理訊息」權限的人可提早結束
- /抽籤 選項 [人數]  ：從一串選項（空白、逗號或換行分隔）隨機抽出
- /狀態            ：模型連線、延遲、啟動多久、有沒有在放歌

注意：投票按鈕在機器人重開後會失效（投票不存檔）。
"""

import asyncio
import logging
import random
import re
import time

import aiohttp
import discord
from discord import app_commands

import models
import music

log = logging.getLogger("discord-ai-bot.extras")

BAR_WIDTH = 10
MAX_POLL_MINUTES = 24 * 60
OPTION_COLORS = ["🟦", "🟩", "🟨", "🟥", "🟪"]


# ---------------------------------------------------------------- 投票

class PollView(discord.ui.View):
    def __init__(self, question: str, options: list[str], author: discord.abc.User, minutes: int):
        super().__init__(timeout=None)
        self.question = question
        self.options = options
        self.author = author
        self.ends_at = time.time() + minutes * 60
        self.votes: dict[int, int] = {}  # 使用者 ID → 選項編號
        self.message: discord.Message | None = None
        self.closed = False
        self._task: asyncio.Task | None = None
        for i, opt in enumerate(options):
            b = discord.ui.Button(label=opt[:80], emoji=OPTION_COLORS[i], style=discord.ButtonStyle.secondary,
                                  custom_id=f"poll:{id(self)}:{i}")
            b.callback = self._make_callback(i)
            self.add_item(b)
        end = discord.ui.Button(label="結束投票", emoji="🛑", style=discord.ButtonStyle.danger, row=4,
                                custom_id=f"poll:{id(self)}:end")
        end.callback = self._end_callback
        self.add_item(end)

    def _make_callback(self, idx: int):
        async def cb(interaction: discord.Interaction):
            if self.closed:
                await interaction.response.send_message("這個投票已經結束了。", ephemeral=True)
                return
            old = self.votes.get(interaction.user.id)
            self.votes[interaction.user.id] = idx
            await interaction.response.edit_message(embed=self.build_embed())
            if old is not None and old != idx:
                await interaction.followup.send(f"已把你的票改成「{self.options[idx]}」。", ephemeral=True)
        return cb

    async def _end_callback(self, interaction: discord.Interaction):
        perms = interaction.permissions if hasattr(interaction, "permissions") else None
        if interaction.user.id != self.author.id and not (perms and perms.manage_messages):
            await interaction.response.send_message("只有發起人或有「管理訊息」權限的人可以結束投票。", ephemeral=True)
            return
        await interaction.response.defer()
        await self.close(f"🛑 {interaction.user.display_name} 提早結束了投票")

    def counts(self) -> list[int]:
        c = [0] * len(self.options)
        for v in self.votes.values():
            c[v] += 1
        return c

    def build_embed(self, final_note: str | None = None) -> discord.Embed:
        counts = self.counts()
        total = sum(counts)
        top = max(counts) if total else 0
        lines = []
        for i, (opt, n) in enumerate(zip(self.options, counts)):
            filled = round(BAR_WIDTH * n / total) if total else 0
            pct = f"{n * 100 // total}%" if total else "0%"
            crown = " 👑" if self.closed and total and n == top else ""
            lines.append(f"{OPTION_COLORS[i]} **{opt}**{crown}\n`{'█' * filled}{'░' * (BAR_WIDTH - filled)}` {n} 票（{pct}）")
        e = discord.Embed(
            title=f"📊 {self.question}",
            description="\n\n".join(lines),
            color=0x99AAB5 if self.closed else 0x5865F2,
        )
        if self.closed:
            e.set_footer(text=f"{final_note or '投票已結束'}｜共 {total} 人投票")
        else:
            e.add_field(name="結束時間", value=f"<t:{int(self.ends_at)}:R>（共 {total} 人投票，可改票）", inline=False)
            e.set_footer(text=f"發起人：{self.author.display_name}")
        return e

    async def close(self, note: str | None = None):
        if self.closed:
            return
        self.closed = True
        if self._task and self._task is not asyncio.current_task():
            self._task.cancel()
        for item in self.children:
            item.disabled = True
        if self.message:
            try:
                await self.message.edit(embed=self.build_embed(note), view=self)
                counts = self.counts()
                if sum(counts):
                    top = max(counts)
                    winners = [o for o, n in zip(self.options, counts) if n == top]
                    text = ("🏆 結果出爐：**" + "、".join(winners) + f"** 最高（{top} 票）" +
                            ("，平手！" if len(winners) > 1 else "。"))
                else:
                    text = "😅 投票結束，但沒有人投票。"
                await self.message.reply(text, mention_author=False)
            except discord.HTTPException as e:
                log.info("結束投票時更新訊息失敗：%r", e)

    async def run_timer(self):
        try:
            await asyncio.sleep(max(0, self.ends_at - time.time()))
            await self.close("⏰ 時間到")
        except asyncio.CancelledError:
            pass


# ---------------------------------------------------------------- 抽籤

SPLIT_RE = re.compile(r"[,，、;；\n\s]+")


def parse_choices(text: str) -> list[str]:
    seen, out = set(), []
    for x in SPLIT_RE.split(text.strip()):
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ---------------------------------------------------------------- 亂數

_rng = random.SystemRandom()
MAX_COUNT = 50


def roll(lo, hi, count: int = 1, unique: bool = False) -> str:
    """產生隨機數字（整數；只要有一端是小數就產生小數，取到小數第 2 位）。回傳給人看的文字。"""
    lo, hi = float(lo), float(hi)
    if lo > hi:
        lo, hi = hi, lo
    count = max(1, min(int(count or 1), MAX_COUNT))
    is_int = lo == int(lo) and hi == int(hi)
    if is_int:
        lo_i, hi_i = int(lo), int(hi)
        span = hi_i - lo_i + 1
        if unique and count > span:
            return f"{lo_i}~{hi_i} 只有 {span} 個數字，沒辦法不重複地抽 {count} 個。"
        nums = _rng.sample(range(lo_i, hi_i + 1), count) if unique else [_rng.randint(lo_i, hi_i) for _ in range(count)]
        rng_txt = f"{lo_i}~{hi_i}"
    else:
        nums = [round(_rng.uniform(lo, hi), 2) for _ in range(count)]
        rng_txt = f"{lo:g}~{hi:g}"
    body = "、".join(f"**{n}**" for n in nums) if count > 1 else f"**{nums[0]}**"
    return f"🎲 在 {rng_txt} 之間隨機抽{'（不重複）' if unique and count > 1 else ''}：{body}"


TOOL = {
    "type": "function",
    "function": {
        "name": "random_number",
        "description": (
            "產生真正的隨機數字。使用者要你「隨機選一個數字」「幫我骰」「8到80隨機一個」「抽幾號」時一定要用這個，"
            "不准自己編一個數字。回覆時直接用工具回傳的數字。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "min": {"type": "number", "description": "最小值（含）"},
                "max": {"type": "number", "description": "最大值（含）"},
                "count": {"type": "integer", "description": "要幾個，預設 1，最多 50"},
                "unique": {"type": "boolean", "description": "多個時是否不重複，預設 false"},
            },
            "required": ["min", "max"],
        },
    },
}


def run_tool(args: dict) -> str:
    try:
        return roll(args.get("min"), args.get("max"), args.get("count") or 1, bool(args.get("unique")))
    except (TypeError, ValueError):
        return "min 和 max 要是數字。"


# ---------------------------------------------------------------- 狀態

def fmt_uptime(sec: float) -> str:
    sec = int(sec)
    d, r = divmod(sec, 86400)
    h, r = divmod(r, 3600)
    m, _ = divmod(r, 60)
    return (f"{d} 天 " if d else "") + (f"{h} 小時 " if h or d else "") + f"{m} 分"


async def check_llm(session: aiohttp.ClientSession, base: str, key: str) -> tuple[bool, str]:
    t0 = time.time()
    try:
        async with session.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"},
                               timeout=aiohttp.ClientTimeout(total=6)) as r:
            ms = int((time.time() - t0) * 1000)
            if r.status == 200:
                return True, f"{ms} ms"
            return False, f"HTTP {r.status}"
    except asyncio.TimeoutError:
        return False, "逾時（6 秒沒回應）"
    except Exception as e:
        return False, f"連不上（{type(e).__name__}）"


def setup(client: discord.Client, tree: app_commands.CommandTree, llm_base: str, llm_key: str, llm_model: str):
    started = time.time()

    @tree.command(name="投票", description="發起一個按鈕投票（每人一票，可改票）")
    @app_commands.describe(題目="要投什麼", 選項1="第 1 個選項", 選項2="第 2 個選項", 選項3="第 3 個選項（選填）",
                         選項4="第 4 個選項（選填）", 選項5="第 5 個選項（選填）", 分鐘="幾分鐘後結束，預設 60，最長 1440")
    @app_commands.guild_only()
    async def cmd_poll(interaction: discord.Interaction, 題目: str, 選項1: str, 選項2: str,
                       選項3: str = None, 選項4: str = None, 選項5: str = None,
                       分鐘: app_commands.Range[int, 1, MAX_POLL_MINUTES] = 60):
        opts = []
        for o in (選項1, 選項2, 選項3, 選項4, 選項5):
            o = (o or "").strip()
            if o and o not in opts:
                opts.append(o[:80])
        if len(opts) < 2:
            await interaction.response.send_message("至少要兩個不一樣的選項。", ephemeral=True)
            return
        view = PollView(題目[:200], opts, interaction.user, 分鐘)
        await interaction.response.send_message(embed=view.build_embed(), view=view)
        orig = await interaction.original_response()
        # 改用一般訊息物件：互動的 token 15 分鐘就失效，但投票可能開更久
        view.message = await interaction.channel.fetch_message(orig.id)
        view._task = asyncio.create_task(view.run_timer())

    @tree.command(name="抽籤", description="從一串選項隨機抽出（用空白、逗號或換行分隔）")
    @app_commands.describe(選項="例如：拉麵 咖哩 便當", 人數="要抽幾個，預設 1")
    async def cmd_draw(interaction: discord.Interaction, 選項: str, 人數: app_commands.Range[int, 1, 20] = 1):
        choices = parse_choices(選項)
        if len(choices) < 2:
            await interaction.response.send_message("至少要兩個選項，用空白、逗號或換行分開。", ephemeral=True)
            return
        n = min(人數, len(choices))
        picked = random.sample(choices, n)
        text = "🎲 抽到了：" + "、".join(f"**{p}**" for p in picked)
        if 人數 > len(choices):
            text += f"\n（只有 {len(choices)} 個選項，所以最多抽 {n} 個）"
        await interaction.response.send_message(f"從 {len(choices)} 個選項裡 {text}")

    @tree.command(name="亂數", description="在範圍內隨機抽數字，例如 8 到 80")
    @app_commands.describe(最小="最小值（含）", 最大="最大值（含）", 數量="要幾個，預設 1，最多 50", 不重複="多個時是否不重複")
    async def cmd_roll(interaction: discord.Interaction, 最小: float, 最大: float,
                       數量: app_commands.Range[int, 1, MAX_COUNT] = 1, 不重複: bool = False):
        await interaction.response.send_message(roll(最小, 最大, 數量, 不重複))

    @tree.command(name="狀態", description="看機器人現在好不好：模型連線、延遲、有沒有在放歌")
    async def cmd_status(interaction: discord.Interaction):
        await interaction.response.defer()  # 大家都看得到
        ok, detail = await check_llm(client.http_session, llm_base, llm_key)
        e = discord.Embed(title="🩺 機器人狀態", color=0x57F287 if ok else 0xED4245)
        e.add_field(name="模型", value=f"{'✅ 正常' if ok else '❌ 連不上'}　{detail}\n{models.label()}", inline=True)
        e.add_field(name="Discord 延遲", value=f"{int(client.latency * 1000)} ms", inline=True)
        e.add_field(name="已啟動", value=fmt_uptime(time.time() - started), inline=True)
        if interaction.guild:
            e.add_field(name="音樂", value=music.real_state(interaction.guild).replace("【真實狀態】", "").strip()[:300] or "—",
                        inline=False)
        e.add_field(name="模型用量", value=models.usage_text()[:1000], inline=False)
        e.set_footer(text=f"在 {len(client.guilds)} 個伺服器")
        if not ok:
            e.description = "模型那台可能沒開機或網路斷了，這時候我只能聊天以外的功能，也沒辦法回覆。"
        await interaction.followup.send(embed=e)
