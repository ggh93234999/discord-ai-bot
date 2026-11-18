"""頻道工具：讓管理者替「某個頻道」指定大笨bot能用哪些工具、並換成對應的精簡提示。
沒設定的頻道完全照舊（所有工具照原本的條件給）。設定存在 state.json 的 channel_tools。

  /頻道工具                     看這個頻道和其他頻道的設定、所有可選的工具名稱
  /頻道工具 方案:畫圖專用        只給 draw_image、edit_image，換畫圖專用提示
  /頻道工具 方案:純聊天          完全不給工具
  /頻道工具 方案:查資料          weather、web_search、fetch_url
  /頻道工具 方案:自訂 工具:a,b   自己指定工具（名稱用 /頻道工具 看）
  /頻道工具 方案:全部            這個頻道恢復預設
  另外可以用 提示:… 加這個頻道的額外規定（提示:清除 移除）
討論串會先看自己、再看上層頻道。
"""

import logging

import discord
from discord import app_commands

from dbot.ai import imagegen
from dbot.core import models

log = logging.getLogger("discord-ai-bot.chantools")

state: dict = {}
_save = lambda: None
_catalog = lambda: {}           # () -> {工具名稱: 工具定義}（目前這支機器人實際可用的）
_now = lambda: ""

PRESETS = {
    "畫圖專用": ["draw_image", "edit_image"],
    "純聊天": [],
    "查資料": ["weather", "web_search", "fetch_url"],
}
ALL = "全部"
CUSTOM = "自訂"

BASE = (
    "你是 Discord 伺服器裡的成員「大笨bot」，用繁體中文、口語簡短地回話，像朋友聊天，不要條列或標題。\n"
    "對話紀錄裡每則訊息前面的「名字：」是發言的人，你回覆時不用在開頭加自己的名字。不知道的事就說不知道，不要亂編。\n"
    "你只有被明確列出的工具，沒有其他能力。做不到的事就直接說這個頻道做不到，不要假裝做了，也不要自己寫「[圖片：…]」「好了（…秒）」這類字。"
)
HINTS = {
    "weather": "問天氣一律用 weather。",
    "web_search": "問最新、現在、今年等會變動的資訊，先用 web_search 確認，不要用猜的；查完用自己的話回答，最後附一兩個來源網址（用 <網址> 包起來）。",
    "fetch_url": "搜尋摘要不夠時用 fetch_url 打開最相關的網頁。",
    "draw_image": "使用者要畫新圖就呼叫 draw_image；呼叫後只回一句「在畫了」，不要說已經畫好。",
    "edit_image": "使用者附了圖要修改就呼叫 edit_image；呼叫後只回一句「在改了」。",
}


SHORT = {
    "weather": "查天氣", "web_search": "搜尋網路", "fetch_url": "讀網頁內文", "web_image": "上網找圖／下載圖", "random_number": "隨機數字、骰子",
    "divination": "塔羅、擲筊、抽籤", "fortune_chart": "八字、星盤", "bot_help": "查bot功能與遊戲玩法", "activity_status": "誰在Activity玩什麼",
    "almanac": "擇日、農民曆", "bot_wallet": "查bot餘額", "bot_pay": "bot轉錢給成員", "transfer_log": "轉帳紀錄、欠款", "bot_collect": "收還款",
    "announce": "發公告（可@everyone）", "mention_members": "標記成員", "pc_build": "配電腦、零件價格", "member_status": "成員線上／玩什麼",
    "music": "放歌、點歌", "music_status": "查播放狀態", "create_channel": "開頻道", "archive_channel": "封存頻道", "edit_channel": "改頻道名／搬分類",
    "set_voice_status": "語音頻道狀態", "draw_image": "畫新圖", "edit_image": "改圖", "make_sound": "生成音效", "make_video": "生成短影片",
}


class ToolPicker(discord.ui.View):
    """跳出來的多選選單：勾要給這個頻道用的工具，按「儲存」才會生效。Discord 一個選單最多 25 項，所以分兩個。"""

    def __init__(self, owner_id: int, channel_id: int, who: str, current: list[str], prompt: str | None = None):
        super().__init__(timeout=300)
        self.owner_id, self.channel_id, self.who, self.prompt = owner_id, channel_id, who, prompt
        self.chosen = {n for n in current if n in _catalog()}
        names = list(_catalog())
        half = (len(names) + 1) // 2
        self.groups = [names[:half], names[half:]]
        for i, g in enumerate(self.groups):
            if not g:
                continue
            sel = discord.ui.Select(placeholder=f"選工具（第 {i + 1}/{len(self.groups)} 組）", min_values=0, max_values=len(g), row=i,
                                    options=[discord.SelectOption(label=n, description=SHORT.get(n, "")[:90], value=n, default=n in self.chosen) for n in g])
            sel.callback = self._make_cb(sel, g)
            self.add_item(sel)

    def _make_cb(self, sel, group):
        async def cb(interaction: discord.Interaction):
            self.chosen = (self.chosen - set(group)) | set(sel.values)
            await interaction.response.defer()
        return cb

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message("這個選單是別人開的。", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="儲存", style=discord.ButtonStyle.success, row=2)
    async def save(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.chosen:
            await interaction.response.send_message("還沒選任何工具。要完全不給工具，請用 `/頻道工具 方案:純聊天`。", ephemeral=True)
            return
        order = [n for n in _catalog() if n in self.chosen]
        msg = apply(self.channel_id, CUSTOM, ",".join(order), self.prompt, self.who)
        self.stop()
        await interaction.response.edit_message(content=msg, view=None)

    @discord.ui.button(label="取消", style=discord.ButtonStyle.secondary, row=2)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        await interaction.response.edit_message(content="沒有更改。", view=None)


def setup(client, tree: app_commands.CommandTree, st: dict, save_fn, catalog_fn, now_fn):
    global state, _save, _catalog, _now
    state, _save, _catalog, _now = st, save_fn, catalog_fn, now_fn
    st.setdefault("channel_tools", {})

    @tree.command(name="頻道工具", description="（機器人擁有者專用）設定這個頻道大笨bot能用哪些工具；方案選「全部」就恢復預設")
    @app_commands.describe(方案="要用哪種工具組合；不填就只是看目前設定", 工具="（可不填）方案選「自訂」時，不填會跳出選單讓你勾；也可以直接打工具名稱用逗號分開",
                           提示="這個頻道額外的規定（可不填；填「清除」移除）")
    @app_commands.choices(方案=[app_commands.Choice(name=n, value=n) for n in (*PRESETS, CUSTOM, ALL)])
    async def cmd_channel_tools(interaction: discord.Interaction, 方案: app_commands.Choice[str] = None, 工具: str = None, 提示: str = None):
        if not await models.is_admin(interaction.user.id):
            await interaction.response.send_message("只有機器人擁有者可以設定頻道的工具。", ephemeral=True)
            return
        cid = interaction.channel_id
        cur = (state.get("channel_tools") or {}).get(str(cid)) or {}
        if 方案 is None and 工具 is None and 提示 is None:
            view = ToolPicker(interaction.user.id, cid, interaction.user.display_name, cur.get("tools", []))
            await interaction.response.send_message(report(cid) + "\n\n👇 要改這個頻道的工具，直接在下面勾選後按「儲存」：", view=view, ephemeral=True)
            return
        if (方案 is not None and 方案.value == CUSTOM and not 工具):
            view = ToolPicker(interaction.user.id, cid, interaction.user.display_name, cur.get("tools", []), 提示)
            await interaction.response.send_message("👇 勾選這個頻道要給大笨bot用的工具，按「儲存」才會生效：", view=view, ephemeral=True)
            return
        await interaction.response.send_message(apply(cid, 方案.value if 方案 else None, 工具, 提示, interaction.user.display_name))


def _norm_names(text: str) -> list[str]:
    return [t for t in (x.strip() for x in str(text or "").replace("，", ",").replace("、", ",").replace(" ", ",").split(",")) if t]


def apply(channel_id: int, preset: str | None, tools_text: str | None, prompt: str | None, who: str) -> str:
    table = state.setdefault("channel_tools", {})
    key = str(channel_id)
    if preset == ALL:
        if table.pop(key, None) is None:
            return "這個頻道本來就沒有限制工具，維持預設。"
        _save()
        log.info("%s 把頻道 %s 的工具改回預設", who, channel_id)
        return f"🔁 {who} 把這個頻道的工具恢復預設（所有工具照原本的條件使用）。"
    cfg = dict(table.get(key) or {})
    if preset in PRESETS:
        cfg = {"preset": preset, "tools": list(PRESETS[preset]), "prompt": cfg.get("prompt", "")}
    elif preset == CUSTOM or (preset is None and tools_text):
        names = _norm_names(tools_text)
        if not names:
            return "選「自訂」要在「工具」欄填工具名稱（用逗號分開）。可用的名稱：" + "、".join(f"`{n}`" for n in _catalog())
        bad = [n for n in names if n not in _catalog()]
        if bad:
            return "沒有這些工具：" + "、".join(f"`{n}`" for n in bad) + "\n可用的名稱：" + "、".join(f"`{n}`" for n in _catalog())
        cfg = {"preset": CUSTOM, "tools": names, "prompt": cfg.get("prompt", "")}
    elif not cfg:
        return "這個頻道還沒有設定工具，請先用「方案」選一種（畫圖專用／純聊天／查資料／自訂），再用「提示」加規定。"
    if prompt is not None:
        cfg["prompt"] = "" if prompt.strip() in ("清除", "無", "clear") else prompt.strip()[:800]
    table[key] = cfg
    _save()
    log.info("%s 設定頻道 %s 的工具：%s", who, channel_id, cfg)
    return f"🔧 {who} 設定這個頻道：**{cfg['preset']}**，工具：{_tool_text(cfg)}" + (f"\n額外規定：{cfg['prompt']}" if cfg.get("prompt") else "") + "\n其他頻道不受影響；用 `/頻道工具 方案:全部` 可以恢復預設。"


def _tool_text(cfg: dict) -> str:
    return "、".join(f"`{n}`" for n in cfg.get("tools", [])) or "（不給任何工具）"


def report(channel_id: int) -> str:
    table = state.get("channel_tools") or {}
    here = table.get(str(channel_id))
    lines = ["這個頻道：" + (f"**{here['preset']}**，工具：{_tool_text(here)}" + (f"\n額外規定：{here['prompt']}" if here.get("prompt") else "") if here else "沒有限制，所有工具照預設。")]
    others = [(k, v) for k, v in table.items() if k != str(channel_id)]
    if others:
        lines.append("其他有設定的頻道：\n" + "\n".join(f"<#{k}> → {v['preset']}（{_tool_text(v)}）" for k, v in others))
    lines.append("快速設定：`/頻道工具 方案:畫圖專用`、`方案:純聊天`、`方案:查資料`，`方案:全部` 恢復預設；要自己挑就選 `方案:自訂`，會跳出選單。")
    return "\n".join(lines)


def config_for_current() -> dict | None:
    """目前這則訊息所在的頻道（討論串會看到上層）有沒有設定；沒有就 None＝照預設。"""
    table = state.get("channel_tools") or {}
    for cid in models.CHANNEL.get():
        if str(cid) in table:
            return table[str(cid)]
    return None


def pick_tools(cfg: dict) -> list:
    cat = _catalog()
    return [cat[n] for n in cfg.get("tools", []) if n in cat]


def system_prompt(cfg: dict) -> str:
    extra = f"\n\n【這個頻道的額外規定】{cfg['prompt']}" if cfg.get("prompt") else ""
    if cfg.get("preset") == "畫圖專用" and cfg.get("tools") == PRESETS["畫圖專用"]:
        return imagegen.DRAW_SYSTEM + extra
    names = [n for n in cfg.get("tools", []) if n in _catalog()]
    if names:
        body = BASE + "\n這個頻道你能用的工具只有：" + "、".join(names) + "。\n" + "".join(HINTS[n] for n in names if n in HINTS)
    else:
        body = BASE + "\n這個頻道你沒有任何工具，純粹聊天。"
    return body + f"\n\n現在時間：{_now()}（台灣時間）。" + extra
