"""
指令中英共存：幫每個中文斜線指令再註冊一個英文名字的版本（做一樣的事）。

例如 /播放 和 /play 在選單裡都找得到。英文版的參數名稱、說明、選項也都是英文。
要新增別的指令的英文版，在下面的 TABLE 加一行就好。
"""

import logging

from discord import app_commands

log = logging.getLogger("discord-ai-bot.aliases")

# 中文指令名 → (英文指令名, 英文說明, {中文參數名: (英文參數名, 英文說明)})
TABLE: dict[str, tuple[str, str, dict[str, tuple[str, str]]]] = {
    "私訊紀錄": ("dmlog", "(Bot owner only) Read DMs people sent to the bot; only you can see it",
             {"使用者": ("user", "Whose DMs to read (leave empty to list recent senders)"), "則數": ("count", "How many recent messages, default 30, max 200")}),
    "播放": ("play", "Play music from YouTube (song name, YouTube link or playlist link)",
           {"歌曲": ("song", "Song name (add the artist if you like) or a YouTube link")}),
    "插播": ("playnext", "Queue-jump: play a song next, or right now (skips the current one)",
           {"歌曲": ("song", "Song name (add the artist if you like) or a YouTube link"),
            "立刻播": ("now", "True = play immediately and skip the current song; False = play next")}),
    "音量": ("volume", "See or set the volume (1-150%, 100 is normal; leave empty to just see it)",
           {"音量": ("level", "Volume percent, 1-150")}),
    "搜尋": ("search", "Search YouTube, pick one of the top 5, then choose: add to end / play next / play now",
           {"關鍵字": ("keyword", "Song name or keywords")}),
    "佇列": ("queue", "Bring the player panel to the bottom: now playing, up next, finished or not", {}),
    "跳過": ("skip", "Skip the current song", {}),
    "暫停": ("pause", "Pause playback", {}),
    "繼續": ("resume", "Resume playback", {}),
    "停止": ("stop", "Stop playing, clear the queue and leave the voice channel", {}),
    "隨機": ("shuffle", "Shuffle the upcoming songs in the queue", {}),
    "清空佇列": ("clear", "Remove all upcoming songs (the current one finishes)", {}),
    "移除": ("remove", "Remove one song from the queue (numbers are on the panel)",
           {"歌曲": ("song", "Queue number (e.g. 3) or part of the song title")}),
    "歷史": ("history", "Show the play history (recently played songs)", {}),
    "電台": ("radio", "Endless autoplay: keeps queueing similar songs, no need to pick (optional starting song)",
           {"開關": ("mode", "on or off"), "起點": ("seed", "Starting song (default: continue from the current one)")}),
    "隨機循環": ("randomloop", "Too lazy to pick? Play random songs from the history on repeat",
             {"開關": ("mode", "on or off")}),
    "開頻道": ("newchannel", "Create a new text or voice channel",
            {"名稱": ("name", "Channel name"),
             "類型": ("kind", "Text or voice"),
             "分類": ("category", "Which category (default: this channel's category; created if missing)"),
             "私人": ("private", "Make it private: only you and admins can see it")}),
    "關頻道": ("closechannel", "Archive, unarchive or delete a channel",
            {"方式": ("action", "Archive = locked but restorable; Delete = permanent, cannot be undone"),
             "頻道": ("channel", "Which channel (default: this one)"),
             "隱藏": ("hide", "Also hide it from everyone except admins when archiving")}),
    "改頻道": ("editchannel", "Rename a channel or move it to another category",
            {"頻道": ("channel", "Which channel (default: this one)"),
             "新名稱": ("new_name", "New name (leave empty to keep)"),
             "分類": ("category", "Move to which category (leave empty to keep; created if missing)")}),
    "頻道狀態": ("voicestatus", "Set or clear a voice channel's status (the small text under its name)",
             {"狀態": ("status", "Text to show; empty = clear"),
              "頻道": ("channel", "Which voice channel (default: the one you are in)")}),
    "臨時語音房": ("tempvoice", "Turn on/off: joining the lobby makes you a voice room that disappears when empty",
              {"開關": ("mode", "on or off"),
               "分類": ("category", "Where the lobby and rooms go (default: this channel's category)")}),
    "投票": ("poll", "Start a button poll (one vote each, can change)",
           {"題目": ("question", "What to vote on"),
            "選項1": ("option1", "Option 1"), "選項2": ("option2", "Option 2"),
            "選項3": ("option3", "Option 3 (optional)"), "選項4": ("option4", "Option 4 (optional)"),
            "選項5": ("option5", "Option 5 (optional)"),
            "分鐘": ("minutes", "Minutes until it ends, default 60, max 1440")}),
    "抽籤": ("draw", "Randomly pick from a list (separate with spaces, commas or new lines)",
           {"選項": ("choices", "e.g. ramen curry bento"), "人數": ("count", "How many to pick, default 1")}),
    "亂數": ("random", "Pick random numbers in a range, e.g. 8 to 80",
           {"最小": ("min", "Minimum (inclusive)"), "最大": ("max", "Maximum (inclusive)"),
            "數量": ("count", "How many, default 1, max 50"), "不重複": ("unique", "No repeats when picking several")}),
    "狀態": ("status", "Is the bot OK? Model connection, latency, music state and usage", {}),
    "模型": ("model", "See or switch the AI model (bot owner only)",
           {"模型": ("model", "Which model to switch to; leave empty just to see the current one")}),
    "餘額": ("balance", "Check the remaining DeepSeek balance (bot owner only; everyone sees the result)", {}),
    "總結": ("summarize", "Summarize the recent conversation in this channel",
           {"則數": ("count", "How many recent messages (default 100, max 500)"),
            "重點": ("focus", "What to focus on (optional)")}),
    "錢包": ("wallet", "See how many tokens you (or someone else) have", {"對象": ("user", "Whose wallet (default: yours)")}),
    "規則": ("rules", "How the token games work: payouts, odds and rules", {"遊戲": ("game", "Which game (default: all)")}),
    "排行": ("leaderboard", "Token leaderboard for this server (top 10)", {}),
    "轉帳": ("pay", "Give some of your tokens to someone",
           {"對象": ("user", "Who to pay"), "金額": ("amount", "How many tokens")}),
    "發錢": ("give", "(Bot owner only) Give someone tokens", {"對象": ("user", "Who gets the tokens (default: yourself)"), "金額": ("amount", "How many tokens")}),
    "賽馬": ("horserace", "Start a horse race: everyone picks a horse with the buttons and bets tokens",
           {"等待秒數": ("wait", "Seconds to place bets, 10-120 (default 40)")}),
    "擲硬幣": ("coinflip", "Call heads or tails: win doubles your bet, lose it all",
            {"猜": ("guess", "Heads or tails"), "賭注": ("bet", "How many tokens to bet")}),
    "骰子": ("dice", "Roll two dice against the bot: higher wins, tie refunds", {"賭注": ("bet", "How many tokens to bet")}),
    "老虎機": ("slots", "Slot machine: 3 cells, 3x3 or 4x4 grid, more lines pay more (see /rules)",
            {"賭注": ("bet", "How many tokens to bet"), "格數": ("cells", "3 = single row, 9 = 3x3 grid, 16 = 4x4 grid")}),
    "21點": ("blackjack", "Play blackjack against the dealer (blackjack pays 3:2)", {"賭注": ("bet", "How many tokens to bet")}),
    "重置": ("reset", "Make the bot forget this channel's conversation so far and start fresh", {}),
    "自動回覆": ("autoreply", "Turn on/off replying to every message in this channel (no @ needed)",
             {"開關": ("mode", "on or off")}),
    "畫圖": ("imagine", "Draw an image from a description (30 s to a few minutes; the result is posted in the channel)",
           {"內容": ("prompt", "What to draw (any language)"), "畫質": ("quality", "Fast (default) / cleaner composition and text / best quality (slow)"),
            "形狀": ("shape", "Square (default) / landscape / portrait")}),
    "改圖": ("editimage", "Edit an image (about 20 s): attach one, paste a message link, or leave empty to use the latest image in the channel",
           {"內容": ("prompt", "How to change it (any language), e.g. make the background daytime"), "圖片": ("image", "The image to edit (optional)"),
            "訊息": ("message", "Message link of the message that has the image (optional)"),
            "參考圖2": ("image2", "Optional second reference image"), "參考圖3": ("image3", "Optional third reference image")}),
}

CHOICE_EN = {
    "快速（約30秒）": "Fast (~30 s)", "構圖與文字較乾淨（約100秒）": "Cleaner composition/text (~100 s)", "最高畫質（約10分鐘）": "Best quality (~10 min)",
    "正方形": "Square", "橫式": "Landscape", "直式": "Portrait",
    "開": "on", "關": "off", "3 格（單排）": "3 cells (single row)", "9 格（3×3）": "9 cells (3x3)", "16 格（4×4）": "16 cells (4x4)", "正面": "heads", "反面": "tails", "全部": "all", "代幣怎麼賺": "how to earn tokens", "老虎機": "slots", "21點": "blackjack", "賽馬": "horse race", "擲硬幣": "coin flip", "骰子": "dice", "文字": "text", "語音": "voice",
    "封存（可還原）": "archive (restorable)", "解除封存": "unarchive", "刪除（永久）": "delete (permanent)",
}


def add_english_aliases(tree: app_commands.CommandTree) -> None:
    existing = {c.name for c in tree.get_commands()}
    added = []
    for cmd in list(tree.get_commands()):
        spec = TABLE.get(cmd.name)
        if not spec or not isinstance(cmd, app_commands.Command):
            continue
        en_name, en_desc, pmap = spec
        if en_name in existing:
            log.warning("英文名 /%s 已經被用了，略過 /%s", en_name, cmd.name)
            continue
        alias = app_commands.Command(name=en_name, description=en_desc, callback=cmd.callback)
        for zh_p, p in alias._params.items():
            en_p = pmap.get(zh_p)
            if en_p:
                p._rename, p.description = en_p[0], en_p[1]
            else:
                log.warning("/%s 的參數 %s 沒有英文翻譯", cmd.name, zh_p)
            orig = cmd._params.get(zh_p)
            if orig is not None:
                p.autocomplete = orig.autocomplete
                if p.choices:
                    p.choices = [app_commands.Choice(name=CHOICE_EN.get(str(c.name), str(c.name)), value=c.value)
                                 for c in p.choices]
        alias.extras = {**getattr(cmd, "extras", {}), "alias_of": cmd.name}
        cmd.extras = {**getattr(cmd, "extras", {}), "en_name": en_name}
        tree.add_command(alias)
        existing.add(en_name)
        added.append(en_name)
    log.info("已加入 %d 個英文指令：%s", len(added), ", ".join("/" + n for n in added))
