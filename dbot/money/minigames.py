"""老虎機與 21 點的純遊戲邏輯／View。"""

import discord
from .account import (RNG, add, balance, fmt)
from .loans import (deduct_debt)

SLOT_SYMBOLS = ["🍒", "🍋", "💎"]   # 3 格單排只用 3 種圖案
SLOT_TRIPLE = {"🍒": 2, "🍋": 2.5, "💎": 3.2}   # 三個一樣：拿回幾倍賭注
SLOT_PAIR = 1                                                           # 兩個一樣：賭注退回

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
            deduct_debt(self.gid, self.user.id, self.bet)
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
            deduct_debt(self.gid, self.user.id, int(self.bet * 1.5))
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
