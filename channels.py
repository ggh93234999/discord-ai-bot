"""
開頻道：
  - /開頻道：開文字或語音頻道（可指定分類、設成私人）
  - AI 工具 create_channel：「@機器人 幫我開一個叫 xxx 的語音頻道」
  - /臨時語音房：設一個「➕ 建立語音房」頻道，有人進去就幫他開一間自己的語音房，人走光自動刪掉

安全：開頻道一律檢查「下指令／講話的人」本身有沒有「管理頻道」權限，不交給 AI 判斷。
機器人本身需要：管理頻道（臨時語音房另外需要：移動成員）。
"""

import asyncio
import logging
import re

import discord
from discord import app_commands

import vstatus

log = logging.getLogger("discord-ai-bot.channels")

HUB_NAME = "➕ 建立語音房"
NO_BOT_PERM = "我沒有「{perm}」權限，請到 伺服器設定 → 身分組 → 大笨bot 把它打開（身分組也要排在夠上面）。"

_state: dict = {}
_save = lambda: None  # noqa: E731
_client: discord.Client | None = None


def _hubs(guild_id: int) -> list[int]:
    return _state.setdefault("temp_hubs", {}).setdefault(str(guild_id), [])


def _rooms() -> list[int]:
    return _state.setdefault("temp_rooms", [])


# ---------------------------------------------------------------- 開頻道（指令和 AI 工具共用）

async def find_or_create_category(guild: discord.Guild, name: str | None) -> discord.CategoryChannel | None:
    if not name:
        return None
    name = name.strip()
    for c in guild.categories:
        if c.name.lower() == name.lower():
            return c
    return await guild.create_category(name, reason="大笨bot 開頻道時建立分類")


def default_category_for(guild: discord.Guild, kind: str, fallback):
    """沒指定分類時：文字頻道放目前所在分類；語音頻道放「已經有最多語音頻道」的分類。"""
    if kind != "voice":
        return fallback
    counts: dict = {}
    for vc in guild.voice_channels:
        if vc.category and vc.id not in _rooms() and vc.id not in _hubs(guild.id):
            counts[vc.category] = counts.get(vc.category, 0) + 1
    for c in guild.categories:  # 名字有「語音」的分類也算候選
        if "語音" in c.name or "voice" in c.name.lower():
            counts.setdefault(c, 0)
    return max(counts, key=lambda c: (counts[c], "語音" in c.name or "voice" in c.name.lower())) if counts else fallback


async def do_create_channel(member: discord.Member, name: str, kind: str = "text",
                            category: str | None = None, private: bool = False,
                            default_category: discord.CategoryChannel | None = None) -> str:
    guild = member.guild
    if not member.guild_permissions.manage_channels:
        return "你沒有「管理頻道」權限，不能叫我開頻道喔。"
    if not guild.me.guild_permissions.manage_channels:
        return NO_BOT_PERM.format(perm="管理頻道")
    name = (name or "").strip()[:100]
    if not name:
        return "頻道要取什麼名字？"
    try:
        cat = (await find_or_create_category(guild, category) if category
               else default_category_for(guild, kind, default_category))
        overwrites = {}
        if private:
            overwrites = {
                guild.default_role: discord.PermissionOverwrite(view_channel=False),
                member: discord.PermissionOverwrite(view_channel=True, connect=True, send_messages=True),
                guild.me: discord.PermissionOverwrite(view_channel=True, connect=True, send_messages=True),
            }
        reason = f"{member.display_name} 透過大笨bot 開頻道"
        if kind == "voice":
            ch = await guild.create_voice_channel(name, category=cat, overwrites=overwrites, reason=reason)
        else:
            ch = await guild.create_text_channel(name, category=cat, overwrites=overwrites, reason=reason)
    except discord.Forbidden:
        return NO_BOT_PERM.format(perm="管理頻道")
    except discord.HTTPException as e:
        return f"開頻道失敗：{e.text or e}"
    where = f"（分類：{cat.name}）" if cat else ""
    lock = "🔒 私人，只有你和管理員看得到，" + "之後可以在頻道設定加人" if private else ""
    kind_txt = "語音" if kind == "voice" else "文字"
    return f"✅ 開好{kind_txt}頻道 {ch.mention}{where}。{lock}".rstrip("，")


# ---------------------------------------------------------------- AI 工具

TOOL = {
    "type": "function",
    "function": {
        "name": "create_channel",
        "description": "在 Discord 伺服器開一個新的文字或語音頻道。使用者明確要求開／建立頻道時才使用。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "頻道名稱"},
                "type": {"type": "string", "enum": ["text", "voice"], "description": "text=文字頻道，voice=語音頻道"},
                "category": {"type": "string", "description": "放在哪個分類（可省略；不存在會自動建立）"},
                "private": {"type": "boolean", "description": "是否設成私人頻道（只有要求的人和管理員看得到），預設 false"},
            },
            "required": ["name", "type"],
        },
    },
}


async def run_tool(msg: discord.Message, args: dict) -> str:
    if not msg.guild:
        return "私訊裡不能開頻道，要在伺服器裡說。"
    member = msg.author if isinstance(msg.author, discord.Member) else msg.guild.get_member(msg.author.id)
    if member is None:
        return "找不到你的成員資料，請改用 /開頻道 指令。"
    return await do_create_channel(
        member, args.get("name", ""), "voice" if args.get("type") == "voice" else "text",
        args.get("category") or None, bool(args.get("private")),
        default_category=getattr(msg.channel, "category", None),
    )


def tool_status(args: dict) -> str:
    return f"🛠️ 開頻道：{args.get('name', '')}"


# ---------------------------------------------------------------- 關頻道：封存／解除封存／刪除

ARCHIVE_DENY = ("send_messages", "send_messages_in_threads", "create_public_threads",
                "create_private_threads", "add_reactions", "connect", "speak")


def _archived() -> dict:
    return _state.setdefault("archived", {})


def find_channel(guild: discord.Guild, name: str | None, fallback=None, kind: str = "any"):
    if not name:
        return fallback
    key = name.strip().lstrip("#").strip()
    m = re.fullmatch(r"<#(\d+)>", key)
    if m:
        return guild.get_channel(int(m.group(1)))
    if key.isdigit():
        return guild.get_channel(int(key))
    cands = [c for c in guild.channels if not isinstance(c, discord.CategoryChannel)]
    if kind == "voice":
        cands = [c for c in cands if isinstance(c, (discord.VoiceChannel, discord.StageChannel))]
    elif kind == "text":
        cands = [c for c in cands if not isinstance(c, (discord.VoiceChannel, discord.StageChannel))]
    for c in cands:
        if c.name.lower() == key.lower():
            return c
    for c in cands:  # 文字頻道名稱會被 Discord 轉小寫、空白變 -
        if c.name.lower() == key.lower().replace(" ", "-"):
            return c
    return None


async def do_archive(member: discord.Member, channel, hide: bool = False) -> str:
    guild = member.guild
    if not member.guild_permissions.manage_channels:
        return "你沒有「管理頻道」權限，不能封存頻道。"
    me = guild.me.guild_permissions
    if not (me.manage_channels and me.manage_roles):
        return NO_BOT_PERM.format(perm="管理頻道、管理身分組")
    if channel is None:
        return "找不到這個頻道。"
    if str(channel.id) in _archived():
        return f"{channel.mention} 已經封存了。"
    ow = channel.overwrites_for(guild.default_role)
    allow, deny = ow.pair()
    new = discord.PermissionOverwrite.from_pair(allow, deny)
    for perm in ARCHIVE_DENY:
        if getattr(me, perm, False):  # 機器人自己沒有的權限不能拿來 deny
            setattr(new, perm, False)
    if hide:
        new.view_channel = False
    try:
        if hide:  # 隱藏後機器人自己也要看得到，之後才能解除
            await channel.set_permissions(guild.me, view_channel=True, reason="封存頻道：保留機器人存取")
        await channel.set_permissions(guild.default_role, overwrite=new, reason=f"{member.display_name} 封存頻道")
    except discord.Forbidden:
        return NO_BOT_PERM.format(perm="管理頻道、管理身分組")
    except discord.HTTPException as e:
        return f"封存失敗：{e.text or e}"
    _archived()[str(channel.id)] = {"allow": allow.value, "deny": deny.value, "hide": hide, "by": member.display_name}
    _save()
    how = "藏起來（只有管理員看得到）並鎖住" if hide else "鎖住，大家還看得到但不能再發言"
    return f"📦 已封存 {channel.mention}：{how}。要恢復用 `/關頻道` 選「解除封存」。"


async def do_unarchive(member: discord.Member, channel) -> str:
    guild = member.guild
    if not member.guild_permissions.manage_channels:
        return "你沒有「管理頻道」權限。"
    if channel is None:
        return "找不到這個頻道。"
    saved = _archived().get(str(channel.id))
    if not saved:
        return f"{channel.mention} 不是我封存的，沒有可以還原的設定。"
    restored = discord.PermissionOverwrite.from_pair(
        discord.Permissions(saved["allow"]), discord.Permissions(saved["deny"]))
    try:
        if restored.is_empty():
            await channel.set_permissions(guild.default_role, overwrite=None, reason="解除封存")
        else:
            await channel.set_permissions(guild.default_role, overwrite=restored, reason="解除封存")
    except discord.Forbidden:
        return NO_BOT_PERM.format(perm="管理頻道、管理身分組")
    except discord.HTTPException as e:
        return f"解除封存失敗：{e.text or e}"
    del _archived()[str(channel.id)]
    _save()
    return f"📤 {channel.mention} 解除封存了，恢復成原本的權限。"


class ConfirmDelete(discord.ui.View):
    def __init__(self, owner_id: int, channel):
        super().__init__(timeout=60)
        self.owner_id, self.channel = owner_id, channel

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message("只有下指令的人能按喔。", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="確定刪除", style=discord.ButtonStyle.danger, emoji="🗑️")
    async def yes(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        name = self.channel.name
        same = interaction.channel_id == self.channel.id
        await interaction.response.edit_message(content=f"🗑️ 刪除 #{name} 中…", view=None)
        try:
            await self.channel.delete(reason=f"{interaction.user.display_name} 透過 /關頻道 刪除")
        except discord.Forbidden:
            await interaction.edit_original_response(content=NO_BOT_PERM.format(perm="管理頻道"))
            return
        except discord.HTTPException as e:
            await interaction.edit_original_response(content=f"刪除失敗：{e.text or e}")
            return
        _archived().pop(str(self.channel.id), None)
        _save()
        log.info("%s 刪除了頻道 #%s", interaction.user, name)
        if not same:
            await interaction.edit_original_response(content=f"🗑️ 已刪除 #{name}。")

    @discord.ui.button(label="取消", style=discord.ButtonStyle.secondary)
    async def no(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        await interaction.response.edit_message(content="好，沒刪。", view=None)


ARCHIVE_TOOL = {
    "type": "function",
    "function": {
        "name": "archive_channel",
        "description": (
            "封存（鎖住，可選擇藏起來）或解除封存一個頻道。使用者明確要求關掉／封存／鎖住／恢復頻道時才用。"
            "你不能刪除頻道；有人要刪除，請他自己用 /關頻道 指令。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["archive", "unarchive"], "description": "archive=封存，unarchive=解除封存"},
                "channel": {"type": "string", "description": "頻道名稱；省略代表目前這個頻道"},
                "hide": {"type": "boolean", "description": "封存時是否一併藏起來（只有管理員看得到），預設 false"},
                "type": {"type": "string", "enum": ["text", "voice", "any"], "description": "頻道類型，用來區分同名的文字和語音頻道，預設 any"},
            },
            "required": ["action"],
        },
    },
}


async def run_archive_tool(msg: discord.Message, args: dict) -> str:
    if not msg.guild:
        return "私訊裡不能用。"
    member = msg.author if isinstance(msg.author, discord.Member) else msg.guild.get_member(msg.author.id)
    if member is None:
        return "找不到你的成員資料，請改用 /關頻道 指令。"
    ch = find_channel(msg.guild, args.get("channel"), fallback=msg.channel, kind=args.get("type") or "any")
    if ch is None:
        return f"找不到叫「{args.get('channel')}」的頻道。"
    if args.get("action") == "unarchive":
        return await do_unarchive(member, ch)
    return await do_archive(member, ch, bool(args.get("hide")))


# ---------------------------------------------------------------- 改頻道（改名、搬分類）

async def do_edit_channel(member: discord.Member, channel, new_name: str | None = None,
                          category: str | None = None) -> str:
    guild = member.guild
    if not member.guild_permissions.manage_channels:
        return "你沒有「管理頻道」權限，不能叫我改頻道。"
    if not guild.me.guild_permissions.manage_channels:
        return NO_BOT_PERM.format(perm="管理頻道")
    if channel is None:
        return "找不到這個頻道。"
    if not new_name and not category:
        return "要改名字還是搬到哪個分類？"
    kwargs, done = {}, []
    if new_name and new_name.strip() and new_name.strip() != channel.name:
        kwargs["name"] = new_name.strip()[:100]
        done.append(f"改名為「{kwargs['name']}」")
    if category:
        if category.strip().lower() in ("無", "none", "沒有", "最上面", "不要分類"):
            kwargs["category"] = None
            done.append("移出分類")
        else:
            cat = await find_or_create_category(guild, category)
            if cat and cat != channel.category:
                kwargs["category"] = cat
                kwargs["sync_permissions"] = True
                done.append(f"搬到分類「{cat.name}」")
    if not kwargs:
        return f"{channel.mention} 本來就是這樣了，不用改。"
    try:
        await channel.edit(reason=f"{member.display_name} 透過大笨bot 改頻道", **kwargs)
    except discord.Forbidden:
        return NO_BOT_PERM.format(perm="管理頻道")
    except discord.HTTPException as e:
        return f"改頻道失敗：{e.text or e}"
    return f"✏️ {channel.mention} 已{'、'.join(done)}。"


EDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_channel",
        "description": "幫頻道改名，或把頻道搬到另一個分類（例如把語音頻道移到「語音頻道」分類）。使用者要求改名、移動、搬頻道時使用。",
        "parameters": {
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "要改的頻道名稱；省略代表目前這個頻道"},
                "type": {"type": "string", "enum": ["text", "voice", "any"], "description": "頻道類型，用來區分同名的文字和語音頻道，預設 any"},
                "new_name": {"type": "string", "description": "新名稱（不改名就省略）"},
                "category": {"type": "string", "description": "要搬到的分類名稱（不搬就省略）"},
            },
        },
    },
}


async def run_edit_tool(msg: discord.Message, args: dict) -> str:
    if not msg.guild:
        return "私訊裡不能用。"
    member = msg.author if isinstance(msg.author, discord.Member) else msg.guild.get_member(msg.author.id)
    if member is None:
        return "找不到你的成員資料，請改用 /改頻道 指令。"
    ch = find_channel(msg.guild, args.get("channel"), fallback=msg.channel, kind=args.get("type") or "any")
    if ch is None:
        return f"找不到叫「{args.get('channel')}」的頻道。"
    return await do_edit_channel(member, ch, args.get("new_name"), args.get("category"))


# ---------------------------------------------------------------- 語音頻道狀態

async def do_voice_status(member: discord.Member, channel, text: str | None) -> str:
    """設定（text 有字）或清除（text 空白）語音頻道狀態。"""
    import music  # 避免循環匯入

    guild = member.guild
    if channel is None:
        channel = member.voice.channel if member.voice else None
    if channel is None:
        return "你要先進語音頻道，或指定要改哪個語音頻道。"
    if not isinstance(channel, discord.VoiceChannel):
        return f"{channel.mention} 不是語音頻道，只有語音頻道有狀態。"
    perms = channel.permissions_for(member)
    in_channel = bool(member.voice and member.voice.channel == channel)
    if not (perms.manage_channels or (in_channel and perms.set_voice_channel_status)):
        return "你要在那個語音頻道裡（而且有「設定語音頻道狀態」權限），或有「管理頻道」權限，才能改它的狀態。"
    text = (text or "").strip()
    err = await vstatus.set_status(channel, text or None, reason=f"{member.display_name} 透過大笨bot 設定")
    if err:
        return err
    p = music.players.get(guild.id)
    playing_here = bool(p and p.connected and p.vc.channel == channel and p.current)
    if text:
        vstatus.manual[channel.id] = text
        extra = "（放歌時也會保留這個狀態，不會被歌名蓋掉）" if playing_here else ""
        return f"📝 {channel.mention} 的狀態改成「{text}」{extra}"
    vstatus.manual.pop(channel.id, None)
    if playing_here:  # 清掉手動狀態後，換回顯示歌名
        await p.apply_status(f"🎶 {p.current.title}")
        return f"🧽 清掉 {channel.mention} 的手動狀態，改回顯示正在播放的歌。"
    return f"🧽 清掉 {channel.mention} 的狀態了。"


VSTATUS_TOOL = {
    "type": "function",
    "function": {
        "name": "set_voice_status",
        "description": "設定或清除語音頻道的狀態（語音頻道名稱底下那行小字，例如「🎮 打傳說中」）。使用者要求改／清除語音頻道狀態時使用。",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "新的狀態文字；要清除就給空字串"},
                "channel": {"type": "string", "description": "語音頻道名稱；省略代表使用者現在所在的語音頻道"},
            },
            "required": ["status"],
        },
    },
}


async def run_vstatus_tool(msg: discord.Message, args: dict) -> str:
    if not msg.guild:
        return "私訊裡不能用。"
    member = msg.author if isinstance(msg.author, discord.Member) else msg.guild.get_member(msg.author.id)
    if member is None:
        return "找不到你的成員資料，請改用 /頻道狀態 指令。"
    ch = None
    if args.get("channel"):
        ch = find_channel(msg.guild, args.get("channel"), kind="voice")
        if ch is None:
            return f"找不到叫「{args.get('channel')}」的語音頻道。"
    return await do_voice_status(member, ch, args.get("status") or "")


# ---------------------------------------------------------------- 臨時語音房

async def _cleanup_room(channel: discord.abc.GuildChannel):
    try:
        await channel.delete(reason="臨時語音房沒人了")
    except discord.NotFound:
        pass
    except discord.HTTPException as e:
        log.warning("刪臨時語音房失敗 %s：%r", channel, e)
        return
    if channel.id in _rooms():
        _rooms().remove(channel.id)
        _save()


async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    guild = member.guild
    # 有人進了「➕ 建立語音房」→ 幫他開房間並移過去
    if after.channel and after.channel.id in _hubs(guild.id) and not member.bot:
        hub = after.channel
        me = guild.me.guild_permissions
        if not (me.manage_channels and me.move_members):
            log.warning("臨時語音房缺權限：manage_channels=%s move_members=%s", me.manage_channels, me.move_members)
            return
        try:
            room = await guild.create_voice_channel(
                f"🔊 {member.display_name} 的房間",
                category=hub.category,
                overwrites={
                    **(hub.category.overwrites if hub.category else {}),
                    member: discord.PermissionOverwrite(manage_channels=True, move_members=True, connect=True),
                },
                reason="臨時語音房",
            )
            _rooms().append(room.id)
            _save()
            await member.move_to(room, reason="臨時語音房")
        except discord.HTTPException as e:
            log.warning("開臨時語音房失敗：%r", e)
            return

    # 有人離開臨時房，房間空了就刪掉
    ch = before.channel
    if ch and ch.id in _rooms() and (after.channel is None or after.channel.id != ch.id):
        humans = [uid for uid in ch.voice_states if uid != guild.me.id]
        if not humans:
            await _cleanup_room(ch)


async def cleanup_on_ready():
    """機器人重開期間房間可能已經空了，啟動時清一次。"""
    for cid in list(_rooms()):
        ch = _client.get_channel(cid)
        if ch is None:
            _rooms().remove(cid)
            continue
        if not [uid for uid in ch.voice_states if uid != ch.guild.me.id]:
            await _cleanup_room(ch)
    _save()


# ---------------------------------------------------------------- 斜線指令

def setup(client: discord.Client, tree: app_commands.CommandTree, state: dict, save_state):
    global _state, _save, _client
    _state, _save, _client = state, save_state, client

    @tree.command(name="開頻道", description="開一個新的文字或語音頻道")
    @app_commands.describe(名稱="頻道名稱", 類型="文字或語音", 分類="放在哪個分類（不填就放在目前這個頻道的分類；不存在會自動建立）",
                           私人="設成私人：只有你和管理員看得到")
    @app_commands.choices(類型=[app_commands.Choice(name="文字", value="text"), app_commands.Choice(name="語音", value="voice")])
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_channels=True)
    async def cmd_create(interaction: discord.Interaction, 名稱: str, 類型: app_commands.Choice[str],
                         分類: str | None = None, 私人: bool = False):
        await interaction.response.defer(thinking=True)
        msg = await do_create_channel(interaction.user, 名稱, 類型.value, 分類, 私人,
                                      default_category=getattr(interaction.channel, "category", None))
        await interaction.followup.send(msg)

    @tree.command(name="關頻道", description="封存、解除封存或刪除頻道")
    @app_commands.describe(方式="封存＝鎖住不能發言（可還原）；刪除＝永久刪掉、救不回來",
                           頻道="要處理的頻道（不填就是目前這個）", 隱藏="封存時順便藏起來，只有管理員看得到")
    @app_commands.choices(方式=[
        app_commands.Choice(name="封存（可還原）", value="archive"),
        app_commands.Choice(name="解除封存", value="unarchive"),
        app_commands.Choice(name="刪除（永久）", value="delete"),
    ])
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_channels=True)
    async def cmd_close(interaction: discord.Interaction, 方式: app_commands.Choice[str],
                        頻道: discord.abc.GuildChannel | None = None, 隱藏: bool = False):
        member = interaction.user
        ch = 頻道 or interaction.channel
        if isinstance(ch, discord.CategoryChannel):
            await interaction.response.send_message("分類不能用這個指令處理。", ephemeral=True)
            return
        if 方式.value == "delete":
            if not member.guild_permissions.manage_channels:
                await interaction.response.send_message("你沒有「管理頻道」權限。", ephemeral=True)
                return
            if not interaction.guild.me.guild_permissions.manage_channels:
                await interaction.response.send_message(NO_BOT_PERM.format(perm="管理頻道"), ephemeral=True)
                return
            await interaction.response.send_message(
                f"⚠️ 確定要**永久刪除** {ch.mention} 嗎？裡面所有訊息都會消失，救不回來。（60 秒內有效）",
                view=ConfirmDelete(member.id, ch), ephemeral=True,
            )
            return
        await interaction.response.defer(thinking=True)
        if 方式.value == "archive":
            text = await do_archive(member, ch, 隱藏)
        else:
            text = await do_unarchive(member, ch)
        await interaction.followup.send(text)


    @tree.command(name="改頻道", description="幫頻道改名，或搬到別的分類")
    @app_commands.describe(頻道="要改的頻道（不填就是目前這個）", 新名稱="新的名字（不改就留空）",
                           分類="搬到哪個分類（不搬就留空；不存在會自動建立）")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_channels=True)
    async def cmd_edit(interaction: discord.Interaction, 頻道: discord.abc.GuildChannel | None = None,
                       新名稱: str | None = None, 分類: str | None = None):
        ch = 頻道 or interaction.channel
        if isinstance(ch, discord.CategoryChannel):
            await interaction.response.send_message("分類不能用這個指令處理。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        await interaction.followup.send(await do_edit_channel(interaction.user, ch, 新名稱, 分類))


    @tree.command(name="頻道狀態", description="設定或清除語音頻道的狀態（名稱底下那行小字）")
    @app_commands.describe(狀態="要顯示的文字；留空＝清除", 頻道="哪個語音頻道（不填就是你現在所在的）")
    @app_commands.guild_only()
    async def cmd_vstatus(interaction: discord.Interaction, 狀態: str | None = None,
                          頻道: discord.VoiceChannel | None = None):
        await interaction.response.defer(thinking=True)
        await interaction.followup.send(await do_voice_status(interaction.user, 頻道, 狀態))


    @tree.command(name="臨時語音房", description="開／關「進去就自動幫你開一間語音房，人走光自動刪掉」的功能")
    @app_commands.describe(開關="開或關", 分類="入口和房間放在哪個分類（不填就用目前這個頻道的分類）")
    @app_commands.choices(開關=[app_commands.Choice(name="開", value="on"), app_commands.Choice(name="關", value="off")])
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_channels=True)
    async def cmd_temp(interaction: discord.Interaction, 開關: app_commands.Choice[str], 分類: str | None = None):
        guild = interaction.guild
        member = interaction.user
        if not member.guild_permissions.manage_channels:
            await interaction.response.send_message("你沒有「管理頻道」權限。", ephemeral=True)
            return
        me = guild.me.guild_permissions
        missing = [n for ok, n in ((me.manage_channels, "管理頻道"), (me.move_members, "移動成員")) if not ok]
        if missing:
            await interaction.response.send_message(NO_BOT_PERM.format(perm="、".join(missing)), ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        if 開關.value == "on":
            try:
                cat = await find_or_create_category(guild, 分類) if 分類 else getattr(interaction.channel, "category", None)
                hub = await guild.create_voice_channel(HUB_NAME, category=cat, reason="大笨bot 臨時語音房入口")
            except discord.HTTPException as e:
                await interaction.followup.send(f"建立入口失敗：{e.text or e}")
                return
            _hubs(guild.id).append(hub.id)
            _save()
            await interaction.followup.send(
                f"✅ 建好入口 {hub.mention}。有人進去，我就會幫他開一間「🔊 名字 的房間」並把他移過去；"
                "房主可以自己改房名、設人數上限，人走光我會自動刪掉。"
            )
        else:
            removed = 0
            for hid in list(_hubs(guild.id)):
                ch = guild.get_channel(hid)
                if ch:
                    try:
                        await ch.delete(reason="關閉臨時語音房")
                        removed += 1
                    except discord.HTTPException:
                        pass
                _hubs(guild.id).remove(hid)
            _save()
            await interaction.followup.send(
                f"⏹️ 關掉臨時語音房了（刪除 {removed} 個入口）。現有的房間還是會在人走光後自動刪掉。"
            )
