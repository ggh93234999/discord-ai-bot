"""
代幣系統：在伺服器裡活動就自動賺代幣，拿去賭博（純好玩，沒有實際價值）。

賺錢：每分鐘最多 +10 代幣——在文字頻道發言，或掛在語音頻道（沒關耳機、不在 AFK 頻道）都算，兩邊合起來每分鐘最多 10。
指令：/規則 /錢包 /排行 /轉帳 /擲硬幣 /骰子 /老虎機 /21點
資料存 wallet.json（每個伺服器各自一本帳）。
"""

import asyncio
import json
import logging
import random
import time
from pathlib import Path

import discord
from discord import app_commands

log = logging.getLogger("discord-ai-bot.economy")

WALLET_FILE = Path(__file__).parent / "wallet.json"
EARN_AMOUNT = 10          # 每次賺多少
EARN_INTERVAL = 60        # 至少間隔幾秒才能再賺一次
START_COINS = 200         # 新玩家起始代幣
COIN = "🪙"
RNG = random.SystemRandom()   # 賭博用真亂數

SLOT_SYMBOLS = ["🍒", "🍋", "💎"]   # 3 格單排只用 3 種圖案
SLOT_TRIPLE = {"🍒": 2, "🍋": 2.5, "💎": 3.2}   # 三個一樣：拿回幾倍賭注
SLOT_PAIR = 1                                                           # 兩個一樣：賭注退回

wallet: dict = {}


def _load() -> dict:
    try:
        return json.loads(WALLET_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save() -> None:
    try:
        tmp = WALLET_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(wallet, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(WALLET_FILE)
    except OSError as e:
        log.warning("存錢包失敗：%r", e)


wallet = _load()


def on_message(msg: discord.Message) -> None:
    """由 bot.py 的 on_message 呼叫：在伺服器發言就可能賺幣（每分鐘最多一次）。"""
    if msg.guild and not msg.author.bot:
        try_earn(msg.guild.id, msg.author.id, msg.author.display_name)


start_voice_loop = lambda: None   # setup() 之後換成真的
start_internal_api = lambda: None   # setup() 之後換成真的
gallery_chat = None                 # bot.py 設定：Activity 圖創區的「跟大笨bot說話」處理函式 async (gid, uid, name, cat, text, history) -> dict


def _acct(gid: int, uid: int, name: str | None = None) -> dict:
    a = wallet.setdefault(str(gid), {}).setdefault(str(uid), {"coins": START_COINS, "last": 0.0, "name": name or str(uid)})
    if name:
        a["name"] = name
    return a


def balance(gid: int, uid: int) -> int:
    return int(wallet.get(str(gid), {}).get(str(uid), {}).get("coins", START_COINS))


def add(gid: int, uid: int, delta: int, name: str | None = None) -> int:
    a = _acct(gid, uid, name)
    a["coins"] = max(0, int(a["coins"]) + int(delta))
    _save()
    return a["coins"]


def try_earn(gid: int, uid: int, name: str) -> bool:
    a = _acct(gid, uid, name)
    now = time.time()
    if now - a["last"] < EARN_INTERVAL - 1:
        return False
    a["last"] = now
    a["coins"] = int(a["coins"]) + EARN_AMOUNT
    _save()
    return True


def fmt(n: int) -> str:
    return f"{COIN}{n:,}"


# ---------------------------------------------------------------- 遊戲

def slot_spin() -> tuple[list[str], int, str]:
    """回傳 (三個符號, 拿回的倍率×2 的整數不用，這裡回傳「拿回倍率」, 說明)。"""
    reels = [RNG.choice(SLOT_SYMBOLS) for _ in range(3)]
    if reels[0] == reels[1] == reels[2]:
        return reels, SLOT_TRIPLE[reels[0]], f"三個 {reels[0]}！"
    if len(set(reels)) == 2:
        return reels, SLOT_PAIR, "兩個一樣，賭注退回"
    return reels, 0, "沒中"


# ---- 多格老虎機：9 格（3×3，8 條連線，3 格一樣）、16 格（4×4，10 條連線，4 格一樣）
GRID_SYMBOLS = {3: ["🍒", "🍋", "🔔", "💎"], 4: ["🍒", "🍋", "💎"]}
GRID_PAY = {
    3: {"🍒": 1.2, "🍋": 1.6, "🔔": 2, "💎": 2.8},   # 只有 4 種圖案，約 41% 的把數會賺錢
    4: {"🍒": 2, "🍋": 2.5, "💎": 3.2},   # 3 種圖案、4 格一樣才算一條線
}
GRID_SCALE = {3: 1.0, 4: 1.0}
PAIR_PAY_3X3 = 0.0   # 3×3：每一橫排左邊兩格一樣（第三格不同）退 0.4 倍，讓常有小回饋   # 調到理論回報率約 95%


def grid_lines(n: int) -> list[list[tuple[int, int]]]:
    L = []
    if n == 3:
        L += [[(r, c) for c in range(3)] for r in range(3)]
        L += [[(r, c) for r in range(3)] for c in range(3)]
        L += [[(i, i) for i in range(3)], [(i, 2 - i) for i in range(3)]]
    else:   # 4×4：整排、整欄 4 格一樣才算，加兩條對角線，共 10 條
        L += [[(r, c) for c in range(4)] for r in range(4)]
        L += [[(r, c) for r in range(4)] for c in range(4)]
        L += [[(i, i) for i in range(4)], [(i, 3 - i) for i in range(4)]]
    return L


def grid_spin(n: int) -> tuple[list[list[str]], float, list[str]]:
    """n=3 → 3×3、n=4 → 4×4。回傳 (盤面, 拿回的倍率, 中獎說明)。"""
    syms = GRID_SYMBOLS[n]
    g = [[RNG.choice(syms) for _ in range(n)] for _ in range(n)]
    mult, wins = 0.0, []
    for line in grid_lines(n):
        cells = {g[r][c] for r, c in line}
        if len(cells) == 1:
            sym = g[line[0][0]][line[0][1]]
            mult += GRID_PAY[n][sym]
            wins.append(sym)
    if n == 3 and PAIR_PAY_3X3:
        for r in range(3):
            if g[r][0] == g[r][1] != g[r][2]:
                mult += PAIR_PAY_3X3
                wins.append("左兩格")
    mult *= GRID_SCALE[n]
    return g, mult, wins


CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
CARD_SUITS = ["♠️", "♥️", "♦️", "♣️"]


def hand_value(hand: list[tuple[str, str]]) -> int:
    total, aces = 0, 0
    for r, _ in hand:
        if r == "A":
            total, aces = total + 11, aces + 1
        elif r in ("J", "Q", "K"):
            total += 10
        else:
            total += int(r)
    while total > 21 and aces:
        total, aces = total - 10, aces - 1
    return total


def hand_text(hand, hide_second=False) -> str:
    if hide_second:
        return f"{hand[0][1]}{hand[0][0]}  🂠"
    return "  ".join(f"{s}{r}" for r, s in hand)


class BlackjackView(discord.ui.View):
    def __init__(self, user: discord.Member, bet: int):
        super().__init__(timeout=120)
        self.user, self.bet = user, bet
        self.gid = user.guild.id
        deck = [(r, s) for r in CARD_RANKS for s in CARD_SUITS]
        RNG.shuffle(deck)
        self.deck = deck
        self.player = [deck.pop(), deck.pop()]
        self.dealer = [deck.pop(), deck.pop()]
        self.message: discord.Message | None = None
        self.done = False

    def embed(self, final: str | None = None, color=discord.Color.blurple()) -> discord.Embed:
        e = discord.Embed(title=f"🃏 21 點　賭注 {fmt(self.bet)}", color=color)
        e.add_field(name=f"你（{hand_value(self.player)} 點）", value=hand_text(self.player), inline=False)
        if final:
            e.add_field(name=f"莊家（{hand_value(self.dealer)} 點）", value=hand_text(self.dealer), inline=False)
            e.description = final
        else:
            e.add_field(name="莊家", value=hand_text(self.dealer, hide_second=True), inline=False)
            e.set_footer(text="要牌 或 停牌；兩分鐘不動會自動停牌")
        return e

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.user.id:
            await interaction.response.send_message("這局是別人的，你可以自己 `/21點`。", ephemeral=True)
            return False
        return True

    def settle(self) -> tuple[str, discord.Color]:
        """莊家補牌並結算，回傳 (說明, 顏色)。賭注開局時已扣，這裡只發回應得的錢。"""
        pv = hand_value(self.player)
        while hand_value(self.dealer) < 17 and pv <= 21:
            self.dealer.append(self.deck.pop())
        dv = hand_value(self.dealer)
        if pv > 21:
            return f"💥 爆牌，輸了 {fmt(self.bet)}", discord.Color.red()
        if dv > 21 or pv > dv:
            add(self.gid, self.user.id, self.bet * 2)
            return f"🎉 你贏了！+{fmt(self.bet)}", discord.Color.green()
        if pv == dv:
            add(self.gid, self.user.id, self.bet)
            return "🤝 平手，賭注退回", discord.Color.light_grey()
        return f"😢 莊家贏，輸了 {fmt(self.bet)}", discord.Color.red()

    async def finish(self, interaction: discord.Interaction | None, natural: bool = False):
        self.done = True
        self.stop()
        if natural:
            add(self.gid, self.user.id, int(self.bet * 2.5))
            text, color = f"🌟 Blackjack！+{fmt(int(self.bet * 1.5))}", discord.Color.gold()
        else:
            text, color = self.settle()
        text += f"\n目前餘額 {fmt(balance(self.gid, self.user.id))}"
        e = self.embed(text, color)
        if interaction:
            await interaction.response.edit_message(embed=e, view=None)
        elif self.message:
            try:
                await self.message.edit(embed=e, view=None)
            except discord.HTTPException:
                pass

    @discord.ui.button(label="要牌", emoji="➕", style=discord.ButtonStyle.primary)
    async def hit(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.player.append(self.deck.pop())
        v = hand_value(self.player)
        if v >= 21:
            await self.finish(interaction)
        else:
            await interaction.response.edit_message(embed=self.embed(), view=self)

    @discord.ui.button(label="停牌", emoji="✋", style=discord.ButtonStyle.secondary)
    async def stand(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.finish(interaction)

    async def on_timeout(self):
        if not self.done:
            await self.finish(None)


# ---------------------------------------------------------------- 賽馬

HORSES_FILE = Path(__file__).parent / "horses.json"
HORSE_POOL = ["赤兔", "烏騅", "的盧", "絕影", "爪黃飛電", "踏雪", "照夜玉獅子", "追風", "驊騮", "飛黃"]
# 賭博類斜線指令暫時下架：程式都還在，把 GAMBLING_ENABLED 改成 True 再重啟機器人就會回來
GAMBLING_ENABLED = False
GAMBLING_COMMANDS = ("賽馬", "擲硬幣", "骰子", "老虎機", "21點")
HORSE_EDGE = 0.95                          # 賠率 = 0.95 / 機率（莊家抽 5%）
HORSES_PER_RACE = 6
STRENGTH_TEMP = 14.0                       # 越小，強弱差距越大
TRACK_LEN = 20
RACE_TICKS = 10
NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"]
FORMS = [("🔥 絕佳", 7), ("😀 良好", 3), ("😐 普通", 0), ("😓 欠佳", -4), ("🤕 低迷", -8)]
FORM_WEIGHTS = [10, 30, 35, 18, 7]


def _load_horses() -> dict:
    try:
        d = json.loads(HORSES_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        d = {}
    changed = False
    for n in HORSE_POOL:
        if n not in d:     # 第一次出場前先給固定的能力值，之後不變
            d[n] = {"spd": random.randint(55, 95), "sta": random.randint(55, 95), "bst": random.randint(55, 95),
                    "races": 0, "wins": 0, "top3": 0, "last": []}
            changed = True
    if changed:
        _save_horses(d)
    return d


def _save_horses(d: dict) -> None:
    try:
        tmp = HORSES_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(HORSES_FILE)
    except OSError as e:
        log.warning("存馬匹資料失敗：%r", e)


horses: dict = _load_horses()


def horse_strength(h: dict, form_bonus: int) -> float:
    return 0.4 * h["spd"] + 0.3 * h["sta"] + 0.3 * h["bst"] + form_bonus


def bar(v: int) -> str:
    n = max(0, min(5, round((v - 40) / 11)))
    return "▰" * n + "▱" * (5 - n)


class Race:
    def __init__(self, guild_id: int, channel_id: int, starter: str, wait: int):
        self.names = random.sample(HORSE_POOL, HORSES_PER_RACE)
        forms = [RNG.choices(FORMS, weights=FORM_WEIGHTS)[0] for _ in self.names]
        self.forms = [f[0] for f in forms]
        strengths = [horse_strength(horses[n], f[1]) for n, f in zip(self.names, forms)]
        m = max(strengths)
        exps = [pow(2.718281828, (x - m) / STRENGTH_TEMP) for x in strengths]
        tot = sum(exps)
        self.probs = [x / tot for x in exps]
        self.odds = [max(1.1, round(HORSE_EDGE / p, 1)) for p in self.probs]
        self.guild_id, self.channel_id, self.starter = guild_id, channel_id, starter
        self.close_at = time.time() + wait
        self.bets: dict[int, tuple[int, int, str]] = {}   # 使用者 ID → (馬, 賭注, 名字)
        self.message: discord.Message | None = None
        self.view: "RaceView | None" = None
        self.closed = False

    def bet_embed(self) -> discord.Embed:
        e = discord.Embed(title="🏇 賽馬開跑倒數", color=discord.Color.orange())
        e.description = (f"{self.starter} 開了一場賽馬！看數值和戰績，按下面的按鈕選馬、輸入賭注。\n"
                         f"<t:{int(self.close_at)}:R> 截止下注　（賠率 = 中了拿回的倍數，含本金）")
        for i, n in enumerate(self.names):
            h = horses[n]
            rec = f"{h['races']} 戰 {h['wins']} 勝（{h['wins'] * 100 // h['races']}%）" if h["races"] else "新馬，還沒有戰績"
            last = "、".join(str(x) for x in h["last"][-5:]) or "—"
            nb = [b for b in self.bets.values() if b[0] == i]
            pool = f"　👥{len(nb)}人 {fmt(sum(b[1] for b in nb))}" if nb else ""
            e.add_field(
                name=f"{NUM_EMOJI[i]} {n}　×{self.odds[i]}　（勝率約 {self.probs[i] * 100:.0f}%）",
                value=(f"速度 {bar(h['spd'])} {h['spd']}　耐力 {bar(h['sta'])} {h['sta']}　爆發 {bar(h['bst'])} {h['bst']}\n"
                       f"今日狀態 {self.forms[i]}　戰績 {rec}\n近 5 場名次：{last}{pool}"),
                inline=False)
        if self.bets:
            e.add_field(name="已下注", value="\n".join(f"{nm}：{NUM_EMOJI[hh]}{self.names[hh]} {fmt(a)}" for hh, a, nm in self.bets.values())[:1000],
                        inline=False)
        e.set_footer(text="每人一注；重按別匹馬會改注（賭注退回再重下）· 賠率已反映能力與狀態，強馬賠得少")
        return e

    def track_lines(self, pos: list[int], finished: list[int] | None = None) -> str:
        lines = []
        for i, n in enumerate(self.names):
            p = min(pos[i], TRACK_LEN)
            mark = "🏆" if finished and finished[0] == i and pos[i] >= TRACK_LEN else "🐎"
            lines.append(f"{NUM_EMOJI[i]} {'·' * p}{mark}{'·' * (TRACK_LEN - p)}🏁　{n}")
        return "\n".join(lines)


def plan_race(probs: list[float]) -> tuple[list[list[int]], list[int]]:
    """先決定名次（贏家依機率抽），再編排每一格的跑法讓動畫跟名次一致。回傳 (每個 tick 各馬位置, 名次)。"""
    n = len(probs)
    winner = RNG.choices(range(n), weights=probs)[0]
    rest = [i for i in range(n) if i != winner]
    rest.sort(key=lambda i: RNG.random() * (1.2 - probs[i]))      # 其他馬名次：機率高的稍微前面
    order = [winner] + rest
    finish = {order[0]: RACE_TICKS}
    for rank in range(1, n):
        finish[order[rank]] = finish[order[rank - 1]] + RNG.randint(0 if rank > 1 else 1, 1)
    last = max(finish.values())
    frames = []
    prev = [0] * n
    for t in range(1, last + 1):
        cur = []
        for h in range(n):
            if t >= finish[h]:
                cur.append(TRACK_LEN)
            else:
                target = TRACK_LEN * t / finish[h]
                v = int(round(target + RNG.uniform(-1.6, 1.6)))
                v = max(prev[h], min(TRACK_LEN - 1, v))
                cur.append(v)
        frames.append(cur)
        prev = cur
    return frames, order


def record_results(names: list[str], order: list[int]) -> None:
    """把這場名次寫進每匹馬的戰績。"""
    for place, idx in enumerate(order, 1):
        h = horses[names[idx]]
        h["races"] += 1
        h["wins"] += place == 1
        h["top3"] += place <= 3
        h["last"] = (h["last"] + [place])[-5:]
    _save_horses(horses)


class BetModal(discord.ui.Modal):
    def __init__(self, race: Race, horse: int, have: int):
        super().__init__(title=f"下注 {race.names[horse]}（賠率 ×{race.odds[horse]}）")
        self.race, self.horse = race, horse
        self.amount = discord.ui.TextInput(label=f"賭注（你有 {have}）", placeholder="輸入整數，例如 50", max_length=12)
        self.add_item(self.amount)

    async def on_submit(self, interaction: discord.Interaction):
        race = self.race
        if race.closed:
            await interaction.response.send_message("下注已經截止了。", ephemeral=True)
            return
        try:
            amt = int(self.amount.value.replace(",", "").strip())
        except ValueError:
            await interaction.response.send_message("賭注要輸入整數。", ephemeral=True)
            return
        uid, gid = interaction.user.id, race.guild_id
        old = race.bets.get(uid)
        if old:
            add(gid, uid, old[1])          # 改注：先退回舊賭注
        have = balance(gid, uid)
        if amt < 1 or amt > have:
            if old:
                add(gid, uid, -old[1])     # 失敗就還原舊賭注
            await interaction.response.send_message(f"賭注要在 1 ~ {have} 之間。", ephemeral=True)
            return
        add(gid, uid, -amt, interaction.user.display_name)
        race.bets[uid] = (self.horse, amt, interaction.user.display_name)
        await interaction.response.send_message(
            f"✅ 已押 {NUM_EMOJI[self.horse]}**{race.names[self.horse]}** {fmt(amt)}，中了拿 {fmt(int(amt * race.odds[self.horse]))}。", ephemeral=True)
        if race.message:
            try:
                await race.message.edit(embed=race.bet_embed())
            except discord.HTTPException:
                pass


class RaceView(discord.ui.View):
    def __init__(self, race: Race):
        super().__init__(timeout=None)
        self.race = race
        for i, name in enumerate(race.names):
            b = discord.ui.Button(label=f"{name} ×{race.odds[i]}", emoji=NUM_EMOJI[i], style=discord.ButtonStyle.primary,
                                  row=i // 3)
            b.callback = self._make_cb(i)
            self.add_item(b)

    def _make_cb(self, horse: int):
        async def cb(interaction: discord.Interaction):
            if self.race.closed:
                await interaction.response.send_message("下注已經截止了。", ephemeral=True)
                return
            await interaction.response.send_modal(BetModal(self.race, horse, balance(self.race.guild_id, interaction.user.id)))
        return cb


async def run_race(race: Race, active: dict):
    try:
        await asyncio.sleep(max(0, race.close_at - time.time()))
        race.closed = True
        for item in race.view.children:
            item.disabled = True
        msg = race.message
        if not race.bets:
            await msg.edit(embed=discord.Embed(title="🏇 賽馬取消", description="沒人下注，這場取消了。", color=discord.Color.light_grey()), view=None)
            return
        frames, order = plan_race(race.probs)
        title = "🏇 比賽開始！"
        await msg.edit(embed=discord.Embed(title=title, description=race.track_lines([0] * 6), color=discord.Color.green()), view=None)
        for pos in frames:
            await asyncio.sleep(1.6)
            done = [i for i in order if pos[i] >= TRACK_LEN]
            await msg.edit(embed=discord.Embed(title=title, description=race.track_lines(pos, done), color=discord.Color.green()))
        winner = order[0]
        record_results(race.names, order)
        lines = [f"🥇 {NUM_EMOJI[order[0]]}**{race.names[order[0]]}**　🥈 {race.names[order[1]]}　🥉 {race.names[order[2]]}", ""]
        for uid, (h, amt, name) in race.bets.items():
            if h == winner:
                pay = int(amt * race.odds[h])
                new = add(race.guild_id, uid, pay)
                lines.append(f"🎉 {name} 押 {race.names[h]} {fmt(amt)} → 拿回 {fmt(pay)}（+{fmt(pay - amt)}）　餘額 {fmt(new)}")
            else:
                lines.append(f"😢 {name} 押 {race.names[h]} {fmt(amt)} → 輸了")
        e = discord.Embed(title="🏁 比賽結束", description=race.track_lines(frames[-1], order) + "\n\n" + "\n".join(lines)[:3500],
                          color=discord.Color.gold())
        await msg.edit(embed=e)
    except Exception:
        log.exception("賽馬出錯")
        for uid, (h, amt, name) in race.bets.items():      # 出錯就把賭注退回
            add(race.guild_id, uid, amt)
        if race.message:
            try:
                await race.message.channel.send("🏇 比賽出了點問題，所有賭注已退回。")
            except discord.HTTPException:
                pass
    finally:
        active.pop(race.channel_id, None)


# ---------------------------------------------------------------- 設定

def setup(client: discord.Client, tree: app_commands.CommandTree):
    busy: set[tuple[int, int]] = set()   # 正在玩 21 點的人，一次只能一局

    async def voice_earn_loop():
        await client.wait_until_ready()
        while not client.is_closed():
            await asyncio.sleep(EARN_INTERVAL)
            try:
                for g in client.guilds:
                    for vc in g.voice_channels:
                        if g.afk_channel and vc.id == g.afk_channel.id:
                            continue
                        for m in vc.members:
                            v = m.voice
                            if m.bot or not v or v.self_deaf or v.deaf:
                                continue
                            try_earn(g.id, m.id, m.display_name)
            except Exception:
                log.exception("語音賺幣迴圈出錯")

    global start_voice_loop, start_internal_api
    start_voice_loop = lambda: asyncio.create_task(voice_earn_loop())

    # ---- 內部 API：給 Discord Activity 的後端用（只聽 127.0.0.1，要帶金鑰）。
    # 錢包只有機器人這個行程在讀寫，Activity 想動錢一律透過這裡，避免兩邊同時改 wallet.json。
    async def internal_api():
        from aiohttp import web
        import hmac
        key_file = Path(__file__).parent / "activity" / "server" / "internal.key"
        try:
            key = key_file.read_text().strip()
        except OSError:
            log.info("沒有 internal.key，不啟動 Activity 內部 API")
            return
        if len(key) < 32:
            return

        # 成員身分由 Activity 後端用玩家自己的 OAuth（guilds 範圍）確認過才會呼叫這裡；
        # 這裡只認得金鑰，並且只服務機器人實際所在的伺服器。
        def guild_ok(gid: int) -> bool:
            return client.get_guild(gid) is not None

        @web.middleware
        async def auth(request, handler):
            if not hmac.compare_digest(request.headers.get("X-Key", ""), key):
                return web.json_response({"ok": False, "error": "forbidden"}, status=403)
            return await handler(request)

        API_MAX_BET = 1_000_000   # Activity 單筆賭注上限（自訂金額用）

        async def parse(request):
            try:
                d = await request.json()
                return int(d["gid"]), int(d["uid"]), d
            except Exception:
                return None

        async def info(request):
            p = await parse(request)
            if not p:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            gid, uid, _ = p
            if not guild_ok(gid):
                return web.json_response({"ok": False, "error": "no_guild"})
            return web.json_response({"ok": True, "balance": balance(gid, uid), "max_bet": API_MAX_BET})

        async def settle(request):
            p = await parse(request)
            if not p:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            gid, uid, d = p
            try:
                bet, back = int(d["bet"]), int(d["back"])
            except Exception:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            if not (1 <= bet <= API_MAX_BET) or back < 0 or back > bet * 100:
                return web.json_response({"ok": False, "error": "bad_amount"}, status=400)
            if not guild_ok(gid):
                return web.json_response({"ok": False, "error": "no_guild"})
            have = balance(gid, uid)
            if have < bet:
                return web.json_response({"ok": False, "error": "insufficient", "balance": have})
            name = str(d.get("name") or uid)[:80]
            new = add(gid, uid, back - bet, name)   # 同一個事件迴圈裡，沒有 await，不會被別的請求插隊
            log.info("Activity %s結算：%s 賭 %s 拿回 %s → 餘額 %s", str(d.get("why") or "老虎機")[:20], name, bet, back, new)
            return web.json_response({"ok": True, "balance": new})

        async def pay(request):
            # 對賭派彩／退款：把錢加給玩家（賭注先前已經用 settle 扣掉）
            p = await parse(request)
            if not p:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            gid, uid, d = p
            try:
                amount = int(d["amount"])
            except Exception:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            if not (1 <= amount <= API_MAX_BET * 100):
                return web.json_response({"ok": False, "error": "bad_amount"}, status=400)
            if not guild_ok(gid):
                return web.json_response({"ok": False, "error": "no_guild"})
            name = str(d.get("name") or uid)[:80]
            new = add(gid, uid, amount, name)
            log.info("Activity %s派彩：%s +%s → 餘額 %s", str(d.get("why") or "")[:20], name, amount, new)
            return web.json_response({"ok": True, "balance": new})

        # 鍛造身分組：手上每把劍所在的區間（30/40/…/100 階）各對應一個身分，持有幾個不同區間就有幾個身分
        FORGE_ROLES = [
            (30, "鑄劍學徒", 0x8D8D8D), (40, "百煉匠", 0xB08D57), (50, "鑄劍師", 0x9BB7C9), (60, "名匠", 0x4AA3A0),
            (70, "劍宗", 0x6A5ACD), (80, "劍聖", 0xD4A017), (90, "劍仙", 0xE0592A), (100, "神鑄", 0xC0392B),
        ]

        async def forge_role(request):
            p = await parse(request)
            if not p:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            gid, uid, d = p
            try:
                tiers = [int(x) for x in (d.get("tiers") or [])][:20]
            except Exception:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            g = client.get_guild(gid)
            if g is None:
                return web.json_response({"ok": False, "error": "no_guild"})
            want = set()
            for tier in tiers:
                best = None
                for t, name, col in FORGE_ROLES:
                    if tier >= t:
                        best = name
                if best:
                    want.add(best)
            try:
                member = g.get_member(uid) or await g.fetch_member(uid)
                have = {r.name: r for r in g.roles}
                for t, name, col in reversed(FORGE_ROLES):     # 8 個身分組一次全部建好（從高階建起，高階排在上面）
                    if name not in have:
                        have[name] = await g.create_role(name=name, colour=discord.Colour(col), hoist=True, reason="鍛造身分組")
                mine = {r.name for r in member.roles}
                drop = [have[n] for _, n, _ in FORGE_ROLES if n in have and n in mine and n not in want]
                add_ = [have[n] for _, n, _ in FORGE_ROLES if n in want and n not in mine]
                if drop:
                    await member.remove_roles(*drop, reason="鍛造：沒有這個區間的劍了")
                if add_:
                    await member.add_roles(*add_, reason="鍛造：持有這個區間的劍")
                log.info("鍛造身分組：%s 的劍 %s → %s", member.display_name, tiers, sorted(want) or "無")
                return web.json_response({"ok": True, "roles": sorted(want)})
            except discord.Forbidden:
                log.warning("鍛造身分組：沒有權限（需要「管理身分組」，機器人的身分組要在這些身分組之上）")
                return web.json_response({"ok": False, "error": "forbidden_role"})
            except discord.NotFound:
                return web.json_response({"ok": False, "error": "no_member"})
            except Exception:
                log.exception("鍛造身分組出錯")
                return web.json_response({"ok": False, "error": "role_failed"})

        async def gallery_route(request):
            # Activity 圖創區：使用者在頁面裡跟大笨bot說話，回覆文字與要畫的圖（圖由 Activity 後端畫，不會傳到 Discord）
            p = await parse(request)
            if not p:
                return web.json_response({"ok": False, "error": "bad_request"}, status=400)
            gid, uid, d = p
            if not guild_ok(gid):
                return web.json_response({"ok": False, "error": "no_guild"})
            if gallery_chat is None:
                return web.json_response({"ok": False, "error": "not_ready"})
            try:
                hist = [h for h in (d.get("history") or []) if isinstance(h, dict)][-14:]
                res = await asyncio.wait_for(gallery_chat(gid, uid, str(d.get("name") or uid)[:40], str(d.get("cat") or "")[:30], str(d.get("text") or "")[:600], hist), 150)
                return web.json_response({"ok": True, **res})
            except Exception as e:
                log.warning("圖創區對話失敗：%r", e)
                return web.json_response({"ok": False, "error": "chat_failed"})

        app = web.Application(middlewares=[auth])
        app.router.add_post("/gallery/chat", gallery_route)
        app.router.add_post("/wallet/info", info)
        app.router.add_post("/wallet/settle", settle)
        app.router.add_post("/wallet/pay", pay)
        app.router.add_post("/forge/role", forge_role)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", int(os.getenv("BOT_API_PORT", "3107"))).start()
        log.info("Activity 內部 API 已啟動（127.0.0.1:%s）", os.getenv("BOT_API_PORT", "3107"))

    start_internal_api = lambda: asyncio.create_task(internal_api())

    def check_bet(inter: discord.Interaction, bet: int) -> str | None:
        have = balance(inter.guild_id, inter.user.id)
        if bet > have:
            return f"錢不夠：你只有 {fmt(have)}，要下 {fmt(bet)}。（每分鐘聊天或掛語音就賺 {EARN_AMOUNT}）"
        return None

    @tree.command(name="錢包", description="看你（或別人）有多少代幣")
    @app_commands.describe(對象="看誰的，不填就是自己")
    @app_commands.guild_only()
    async def cmd_wallet(interaction: discord.Interaction, 對象: discord.Member = None):
        who = 對象 or interaction.user
        n = balance(interaction.guild_id, who.id)
        await interaction.response.send_message(f"{COIN} **{who.display_name}** 有 {fmt(n)}")

    def rules_embeds(which: str) -> list[discord.Embed]:
        def table(d: dict, per: int = 3) -> str:
            items = [f"{k} ×{v}" for k, v in d.items()]
            return "\n".join("　".join(items[i:i + per]) for i in range(0, len(items), per))

        def mk(title: str, desc: str, color, fields: list[tuple[str, str]], foot: str | None = None) -> discord.Embed:
            e = discord.Embed(title=title, description=desc, color=color)
            for n, v in fields:
                e.add_field(name=n, value=v, inline=False)
            if foot:
                e.set_footer(text=foot)
            return e

        gold, green, red, blue, purple = (discord.Color.gold(), discord.Color.green(), discord.Color.red(),
                                          discord.Color.blurple(), discord.Color.purple())
        E = {
            "coins": mk("💰 代幣", f"新玩家起始 **{fmt(START_COINS)}**", gold, [
                ("怎麼賺", f"▸ 文字頻道發言，或掛在語音頻道（沒關耳機、不在 AFK 頻道）\n▸ 每分鐘最多 **+{EARN_AMOUNT}**，文字和語音合起來算一份"),
                ("怎麼用", "▸ `/錢包` 看餘額　`/排行` 排行榜　`/轉帳` 給別人\n▸ 拿去玩下面的小遊戲"),
                ("輸光了？", "只會歸零不會變負，繼續聊天就會慢慢賺回來。"),
            ]),
            "coin": mk("🪙 擲硬幣　`/擲硬幣`", "最簡單的 50/50。", blue, [
                ("玩法", "選正面或反面，下賭注。"),
                ("結果", "▸ 猜中：拿回 **2 倍**（淨賺一份賭注）\n▸ 猜錯：輸掉賭注"),
            ]),
            "dice": mk("🎲 骰子　`/骰子`", "跟機器人比大小。", blue, [
                ("玩法", "你和機器人各擲兩顆骰子，點數加總比大小。"),
                ("結果", "▸ 你比較大：淨賺一份賭注\n▸ 你比較小：輸掉賭注\n▸ 一樣大：賭注退回"),
            ]),
            "slots": mk("🎰 老虎機　`/老虎機 賭注 [格數]`", "按下去的瞬間用真亂數決定結果，動畫只是演出。\n倍率是「**含本金**拿回幾倍」：賭 100、中 1.2 倍 → 拿回 120。", red, [
                ("3 格（單排）", f"三個一樣拿回：\n{table(SLOT_TRIPLE)}\n只有兩個一樣：**退回賭注**　其他：輸"),
                ("9 格（3×3）　約 41% 的把數會賺", f"4 種圖案。橫 3 條 + 直 3 條 + 斜 2 條，共 **8 條線**，一條線三個一樣就中。\n一條線拿回：\n{table(GRID_PAY[3], 4)}\n同一把可以中好幾條，倍率**加起來**。"),
                ("16 格（4×4）　約 32% 的把數會賺", f"3 種圖案。橫 4 排 + 直 4 欄 + 斜 2 條，共 **10 條線**，一條線 **4 格全部一樣**才算中。\n一條線拿回：\n{table(GRID_PAY[4], 3)}\n同樣可以同時中好幾條，倍率加起來。"),
            ], "各版本長期回報率約 94～95%"),
            "bj": mk("🃏 21點　`/21點 賭注`", "點數比莊家大，但不能超過 21。", green, [
                ("點數", "A 算 1 或 11　J / Q / K 算 10　其他照牌面"),
                ("流程", "▸ 開局你兩張牌，莊家一明一暗\n▸ ➕ 要牌：再拿一張（超過 21 就爆牌輸）\n▸ ✋ 停牌：換莊家，**16 點以下補牌、17 點以上停**"),
                ("結果", "▸ 贏：淨賺一份賭注\n▸ 🌟 Blackjack（開局 A + 10 點牌）：賠 **1.5 倍**\n▸ 點數一樣：退回賭注\n▸ 爆牌或比莊家小：輸"),
            ]),
            "horse": mk("🏇 賽馬　`/賽馬`", "大家一起押馬，跑完依賠率分錢。", purple, [
                ("下注", "▸ 開一場後有一段時間下注（預設 40 秒）\n▸ 按馬名按鈕、輸入金額，**每人一注**\n▸ 想改注：按別匹馬，賭注會退回再重下"),
                ("看數值", "每匹馬有速度、耐力、爆發、穩定、狀態和近期戰績，面板上有勝率。"),
                ("賠率", "**賠率 = 0.95 ÷ 勝率**（含本金的倍數）\n強馬賠得少、冷門賠得多，莊家抽 5%。\n押中拿回 賭注 × 賠率。"),
                ("名次", "由比賽模擬跑出來，有能力差距也有運氣，不是純亂數。"),
            ]),
        }
        order = ["coins", "coin", "dice", "slots", "bj", "horse"]
        return [E[k] for k in order] if which == "all" else [E[which]]

    @tree.command(name="規則", description="看賭博小遊戲和代幣的規則、賠率")
    @app_commands.describe(遊戲="要看哪個，不選就是全部")
    @app_commands.choices(遊戲=[app_commands.Choice(name="全部", value="all"), app_commands.Choice(name="代幣怎麼賺", value="coins"),
                              app_commands.Choice(name="老虎機", value="slots"), app_commands.Choice(name="21點", value="bj"),
                              app_commands.Choice(name="賽馬", value="horse"), app_commands.Choice(name="擲硬幣", value="coin"),
                              app_commands.Choice(name="骰子", value="dice")])
    async def cmd_rules(interaction: discord.Interaction, 遊戲: app_commands.Choice[str] = None):
        which = 遊戲.value if 遊戲 else "all"
        await interaction.response.send_message(embeds=rules_embeds(which))

    @tree.command(name="排行", description="本伺服器代幣排行榜（前 10 名）")
    @app_commands.guild_only()
    async def cmd_board(interaction: discord.Interaction):
        accts = wallet.get(str(interaction.guild_id), {})
        top = sorted(accts.items(), key=lambda kv: kv[1]["coins"], reverse=True)[:10]
        if not top or top[0][1]["coins"] <= 0:
            await interaction.response.send_message("還沒有人有代幣，聊天或掛語音就會開始賺。")
            return
        medals = ["🥇", "🥈", "🥉"]
        lines = [f"{medals[i] if i < 3 else f'`{i + 1}.`'} {a['name']}　{fmt(a['coins'])}" for i, (_, a) in enumerate(top)]
        await interaction.response.send_message(embed=discord.Embed(title="🏆 代幣排行榜", description="\n".join(lines),
                                                                    color=discord.Color.gold()))

    @tree.command(name="轉帳", description="把你的代幣轉給別人")
    @app_commands.describe(對象="轉給誰", 金額="轉多少")
    @app_commands.guild_only()
    async def cmd_pay(interaction: discord.Interaction, 對象: discord.Member, 金額: app_commands.Range[int, 1]):
        if 對象.bot or 對象.id == interaction.user.id:
            await interaction.response.send_message("不能轉給機器人或自己。", ephemeral=True)
            return
        err = check_bet(interaction, 金額)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return
        gid = interaction.guild_id
        add(gid, interaction.user.id, -金額, interaction.user.display_name)
        add(gid, 對象.id, 金額, 對象.display_name)
        await interaction.response.send_message(f"💸 {interaction.user.display_name} 轉了 {fmt(金額)} 給 {對象.display_name}")

    races: dict[int, Race] = {}   # 頻道 ID → 進行中的賽馬

    @tree.command(name="賽馬", description="開一場賽馬，大家按按鈕押馬下注，跑完依賠率分錢")
    @app_commands.describe(等待秒數="開放下注幾秒，10~120，預設 40")
    @app_commands.guild_only()
    async def cmd_race(interaction: discord.Interaction, 等待秒數: app_commands.Range[int, 10, 120] = 40):
        if interaction.channel_id in races:
            await interaction.response.send_message("這個頻道已經有一場賽馬在進行了。", ephemeral=True)
            return
        race = Race(interaction.guild_id, interaction.channel_id, interaction.user.display_name, 等待秒數)
        race.view = RaceView(race)
        races[interaction.channel_id] = race
        await interaction.response.send_message(embed=race.bet_embed(), view=race.view)
        race.message = await interaction.original_response()
        asyncio.create_task(run_race(race, races))

    @tree.command(name="發錢", description="（機器人擁有者專用）直接給某人代幣")
    @app_commands.describe(金額="給多少", 對象="給誰，不填就是發給自己")
    @app_commands.guild_only()
    async def cmd_give(interaction: discord.Interaction, 金額: app_commands.Range[int, 1, 1_000_000_000], 對象: discord.Member = None):
        import models
        對象 = 對象 or interaction.user
        if not await models.is_admin(interaction.user.id):
            await interaction.response.send_message("只有機器人擁有者能發錢。", ephemeral=True)
            return
        new = add(interaction.guild_id, 對象.id, 金額, 對象.display_name)
        await interaction.response.send_message(f"💰 發給 {對象.display_name} {fmt(金額)}　餘額 {fmt(new)}")

    @tree.command(name="擲硬幣", description="猜正反面，猜中賭注翻倍，猜錯輸光")
    @app_commands.describe(猜="正面或反面", 賭注="下多少代幣")
    @app_commands.choices(猜=[app_commands.Choice(name="正面", value="heads"), app_commands.Choice(name="反面", value="tails")])
    @app_commands.guild_only()
    async def cmd_coin(interaction: discord.Interaction, 猜: app_commands.Choice[str], 賭注: app_commands.Range[int, 1]):
        err = check_bet(interaction, 賭注)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return
        gid, uid = interaction.guild_id, interaction.user.id
        res = RNG.choice(["heads", "tails"])
        name = {"heads": "正面", "tails": "反面"}[res]
        if res == 猜.value:
            new = add(gid, uid, 賭注, interaction.user.display_name)
            await interaction.response.send_message(f"🪙 **{name}**！猜中了，+{fmt(賭注)}　餘額 {fmt(new)}")
        else:
            new = add(gid, uid, -賭注, interaction.user.display_name)
            await interaction.response.send_message(f"🪙 **{name}**…猜錯了，-{fmt(賭注)}　餘額 {fmt(new)}")

    @tree.command(name="骰子", description="跟機器人各擲兩顆骰子比點數，大的贏，一樣就退錢")
    @app_commands.describe(賭注="下多少代幣")
    @app_commands.guild_only()
    async def cmd_dice(interaction: discord.Interaction, 賭注: app_commands.Range[int, 1]):
        err = check_bet(interaction, 賭注)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return
        gid, uid = interaction.guild_id, interaction.user.id
        me = [RNG.randint(1, 6), RNG.randint(1, 6)]
        bot_ = [RNG.randint(1, 6), RNG.randint(1, 6)]
        head = f"🎲 你 {me[0]}+{me[1]}=**{sum(me)}**　vs　我 {bot_[0]}+{bot_[1]}=**{sum(bot_)}**\n"
        if sum(me) > sum(bot_):
            new = add(gid, uid, 賭注, interaction.user.display_name)
            await interaction.response.send_message(head + f"你贏了！+{fmt(賭注)}　餘額 {fmt(new)}")
        elif sum(me) < sum(bot_):
            new = add(gid, uid, -賭注, interaction.user.display_name)
            await interaction.response.send_message(head + f"我贏了，-{fmt(賭注)}　餘額 {fmt(new)}")
        else:
            await interaction.response.send_message(head + f"平手，賭注退回　餘額 {fmt(balance(gid, uid))}")

    @tree.command(name="老虎機", description="拉霸：3 格單排、9 格（3×3）或 16 格（4×4），連線越多賠越多")
    @app_commands.describe(賭注="下多少代幣", 格數="3 格＝單排（三個一樣大賠，兩個一樣退錢）；9／16 格＝連成線才算，可同時中很多條")
    @app_commands.choices(格數=[app_commands.Choice(name="3 格（單排）", value=1),
                              app_commands.Choice(name="9 格（3×3）", value=3),
                              app_commands.Choice(name="16 格（4×4）", value=4)])
    @app_commands.guild_only()
    async def cmd_slots(interaction: discord.Interaction, 賭注: app_commands.Range[int, 1], 格數: app_commands.Choice[int] = None):
        err = check_bet(interaction, 賭注)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return
        gid, uid = interaction.guild_id, interaction.user.id
        kind = 格數.value if 格數 else 1
        add(gid, uid, -賭注, interaction.user.display_name)   # 先扣賭注
        if kind == 1:
            reels, mult, note = slot_spin()
            final = [reels]
            wins_text = note
        else:
            grid, mult, wins = grid_spin(kind)
            final = grid
            full = [w for w in wins if w != "左兩格"]
            pairs = wins.count("左兩格")
            parts = []
            if full:
                parts.append("中了 " + "、".join(f"{w}×{full.count(w)}" for w in dict.fromkeys(full)) + " 連線")
            if pairs:
                parts.append(f"{pairs} 排左兩格一樣（小退）")
            wins_text = "，".join(parts) if parts else "沒連線"
        rows, cols = len(final), len(final[0])
        syms = SLOT_SYMBOLS if kind == 1 else GRID_SYMBOLS[kind]

        def render(cells, footer: str) -> str:
            # 轉動中和結果用同一個版型（同樣的行數），訊息高度不會在最後跳動
            body = "\n".join("　".join(r) for r in cells)
            return f"🎰 **老虎機**　賭注 {fmt(賭注)}\n\n{body}\n\n{footer}"

        spin = lambda: [[RNG.choice(syms) for _ in range(cols)] for _ in range(rows)]
        await interaction.response.send_message(render(spin(), "轉動中…"))
        for _ in range(2):
            await asyncio.sleep(0.8)
            try:
                await interaction.edit_original_response(content=render(spin(), "轉動中…"))
            except discord.HTTPException:
                pass
        await asyncio.sleep(0.8)
        back = int(賭注 * mult)
        new = add(gid, uid, back)
        net = back - 賭注
        sign = f"+{fmt(net)}" if net > 0 else (f"-{fmt(-net)}" if net < 0 else "打平")
        try:
            await interaction.edit_original_response(content=render(final, f"{wins_text}　{sign}　餘額 {fmt(new)}"))
        except discord.HTTPException:
            pass

    @tree.command(name="21點", description="跟莊家玩 21 點，贏了賭注翻倍，Blackjack 賠 1.5 倍")
    @app_commands.describe(賭注="下多少代幣")
    @app_commands.guild_only()
    async def cmd_bj(interaction: discord.Interaction, 賭注: app_commands.Range[int, 1]):
        key = (interaction.guild_id, interaction.user.id)
        if key in busy:
            await interaction.response.send_message("你還有一局 21 點沒打完。", ephemeral=True)
            return
        err = check_bet(interaction, 賭注)
        if err:
            await interaction.response.send_message(err, ephemeral=True)
            return
        add(interaction.guild_id, interaction.user.id, -賭注, interaction.user.display_name)  # 開局先扣
        view = BlackjackView(interaction.user, 賭注)
        busy.add(key)
        orig_finish = view.finish

        async def finish_and_free(*a, **kw):
            busy.discard(key)
            await orig_finish(*a, **kw)

        view.finish = finish_and_free
        if hand_value(view.player) == 21:
            busy.discard(key)
            view.done = True
            if hand_value(view.dealer) == 21:
                add(interaction.guild_id, interaction.user.id, 賭注)
                e = view.embed(f"🤝 雙方都是 Blackjack，退回賭注\n餘額 {fmt(balance(interaction.guild_id, interaction.user.id))}")
            else:
                add(interaction.guild_id, interaction.user.id, int(賭注 * 2.5))
                e = view.embed(f"🌟 Blackjack！+{fmt(int(賭注 * 1.5))}\n餘額 {fmt(balance(interaction.guild_id, interaction.user.id))}",
                               discord.Color.gold())
            await interaction.response.send_message(embed=e)
            return
        await interaction.response.send_message(embed=view.embed(), view=view)
        view.message = await interaction.original_response()
