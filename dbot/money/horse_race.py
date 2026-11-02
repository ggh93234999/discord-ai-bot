"""賽馬：馬匹資料、賽程模擬、下注介面。"""

import asyncio
import discord
import json
import paths
import random
import time
from .account import (RNG, add, balance, fmt, log)
from .loans import (deduct_debt)

# ---------------------------------------------------------------- 賽馬

HORSES_FILE = paths.record("horses.json")
HORSE_POOL = ["赤兔", "烏騅", "的盧", "絕影", "爪黃飛電", "踏雪", "照夜玉獅子", "追風", "驊騮", "飛黃"]

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
                new -= deduct_debt(race.guild_id, uid, pay - amt)
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
