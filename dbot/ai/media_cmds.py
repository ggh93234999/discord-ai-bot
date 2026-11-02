"""畫圖／改圖／音效／影片的斜線指令。"""

from dbot.ai import imagegen
from dbot.ai import sfxgen
from dbot.ai import videogen
from discord import app_commands
import discord
import re
from dbot.core.config import (NSFW_SFX_REPLY)
from dbot.ai.llm import (call_model, clean_text)
import logging
log = logging.getLogger("discord-ai-bot")

def register(client):
    @client.tree.command(name="畫圖", description="畫一張圖（約 30 秒～數分鐘，畫好會貼在頻道）")
    @app_commands.describe(內容="想畫什麼（中英文都可以）", 畫質="用哪個畫圖模型（選項依 image_models.json，第一個是預設）", 形狀="正方形（預設）／橫式／直式", 大小="一般（預設）／大圖／超大圖（要等比較久，只有快速畫質和 Chroma）")
    @app_commands.choices(
        畫質=[app_commands.Choice(name=n, value=v) for n, v in imagegen.gen_choices()],
        形狀=[app_commands.Choice(name="正方形", value="square"), app_commands.Choice(name="橫式", value="landscape"),
              app_commands.Choice(name="直式", value="portrait")],
        大小=[app_commands.Choice(name="一般（預設）", value="normal"), app_commands.Choice(name="大圖（約1900像素）", value="large"), app_commands.Choice(name="超大圖（長邊2048像素）", value="huge")])
    async def cmd_draw(interaction: discord.Interaction, 內容: str, 畫質: str = "fast", 形狀: str = "square", 大小: str = "normal"):
        if not imagegen.channel_ok(interaction.channel):
            await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
            return
        if not imagegen.enabled():
            await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        res = await imagegen.submit(client.http_session, {"prompt": 內容, "quality": 畫質, "shape": 形狀, "scale": 大小, "human": True},
                                    interaction.user.id, imagegen.say_for_interaction(interaction), 內容)
        await interaction.followup.send(res)


    @client.tree.command(name="智慧畫圖", description="先把你的一句話擴寫成完整的畫圖提示詞再畫（擴寫約 10～30 秒）")
    @app_commands.describe(內容="想畫什麼，一句話就好（中英文都可以）", 畫質="用哪個畫圖模型（選項依 image_models.json，第一個是預設）", 形狀="正方形（預設）／橫式／直式",
                           提示詞語言="擴寫出來的提示詞用英文（預設）還是中文", 大小="一般（預設）／大圖／超大圖（要等比較久，只有快速畫質和 Chroma）")
    @app_commands.choices(
        畫質=[app_commands.Choice(name=n, value=v) for n, v in imagegen.gen_choices()],
        形狀=[app_commands.Choice(name="正方形", value="square"), app_commands.Choice(name="橫式", value="landscape"),
              app_commands.Choice(name="直式", value="portrait")],
        提示詞語言=[app_commands.Choice(name="英文（預設）", value="en"), app_commands.Choice(name="中文", value="zh")],
        大小=[app_commands.Choice(name="一般（預設）", value="normal"), app_commands.Choice(name="大圖（約1900像素）", value="large"), app_commands.Choice(name="超大圖（長邊2048像素）", value="huge")])
    async def cmd_smart_draw(interaction: discord.Interaction, 內容: str, 畫質: str = "fast", 形狀: str = "square", 提示詞語言: str = "en", 大小: str = "normal"):
        if not imagegen.channel_ok(interaction.channel):
            await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
            return
        if not imagegen.enabled():
            await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
            return
        why = imagegen.check_prompt(內容)
        if why:
            await interaction.response.send_message(why + "（這張沒有畫）", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        expanded = await imagegen.expand_prompt(client.http_session, 內容, 畫質, lang=提示詞語言)
        note = ""
        if expanded:
            note = f"📝 原句：{內容[:300]}\n✨ 擴寫後的提示詞：{expanded[:900]}\n"
            prompt = expanded
        else:
            note = f"📝 原句：{內容[:300]}\n（提示詞擴寫失敗，這張直接用你的原句畫）\n"
            prompt = 內容
        log.info("智慧畫圖 user=%s 原句=%s 擴寫=%s", interaction.user.id, 內容[:80], (expanded or "失敗")[:200])
        res = await imagegen.submit(client.http_session, {"prompt": prompt, "quality": 畫質, "shape": 形狀, "scale": 大小, "human": True},
                                    interaction.user.id, imagegen.say_for_interaction(interaction), 內容, extra=f"\n📝 原句：{內容[:300]}")
        await interaction.followup.send(note + res)


    @client.tree.command(name="改圖", description="改一張圖：附上圖片，或貼訊息連結，或什麼都不給＝改頻道裡最近那張圖")
    @app_commands.describe(內容="要怎麼改（中英文都可以），例如：把背景改成白天", 圖片="要修改的圖（可不附）", 訊息="要改哪則訊息裡的圖：貼那則訊息的連結（可不填）",
                           參考圖2="選填：第二張參考圖", 參考圖3="選填：第三張參考圖", 畫質="用哪個改圖模型（選項依 image_models.json，第一個是預設；要加字改字選標示文字較好的那個）")
    @app_commands.choices(畫質=[app_commands.Choice(name=n, value=v) for n, v in imagegen.edit_choices()])
    async def cmd_edit(interaction: discord.Interaction, 內容: str, 圖片: discord.Attachment | None = None, 訊息: str | None = None,
                       參考圖2: discord.Attachment | None = None, 參考圖3: discord.Attachment | None = None, 畫質: str = "fast"):
        if not imagegen.channel_ok(interaction.channel):
            await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
            return
        if not imagegen.enabled():
            await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
            return
        atts = [a for a in (圖片, 參考圖2, 參考圖3) if a is not None]
        if any(not (a.content_type or "").startswith("image/") for a in atts):
            await interaction.response.send_message("請上傳圖片檔（PNG／JPEG／WEBP）。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        note = ""
        if atts:
            images = [(await a.read(), a.filename or "image.png", (a.content_type or "image/png").split(";")[0]) for a in atts]
        else:
            images, note = await imagegen.find_images(client, interaction.channel, 訊息)
        res = await imagegen.submit_edit(client.http_session, 內容, images, interaction.user.id,
                                         imagegen.say_for_interaction(interaction), 內容, 畫質)
        await interaction.followup.send((res + ("\n-# " + note if note and images else "")) if images else note or res)


    class EditModal(discord.ui.Modal, title="改這張圖"):
        內容 = discord.ui.TextInput(label="要怎麼改？", placeholder="例如：把背景改成白天，其他部分維持不變", style=discord.TextStyle.paragraph, max_length=500)

        def __init__(self, target: discord.Message):
            super().__init__()
            self.target = target

        async def on_submit(self, interaction: discord.Interaction):
            await interaction.response.defer(thinking=True)
            images = await imagegen.images_of(self.target)
            res = await imagegen.submit_edit(client.http_session, str(self.內容), images, interaction.user.id,
                                             imagegen.say_for_interaction(interaction), str(self.內容))
            await interaction.followup.send(res)


    @client.tree.context_menu(name="改這張圖")
    async def ctx_edit(interaction: discord.Interaction, message: discord.Message):
        if not imagegen.channel_ok(interaction.channel):
            await interaction.response.send_message(imagegen.NSFW_ONLY_REPLY, ephemeral=True)
            return
        if not imagegen.enabled():
            await interaction.response.send_message("畫圖功能目前沒開。", ephemeral=True)
            return
        if not any((a.content_type or "").startswith("image/") for a in message.attachments):
            await interaction.response.send_message("這則訊息沒有圖片。", ephemeral=True)
            return
        await interaction.response.send_modal(EditModal(message))



    _CJK_RE = re.compile(r"[\u4e00-\u9fff]")


    async def _sfx_to_english(text: str, video: bool = False) -> str:
        """音效模型只懂英文：描述有中文就先請語言模型翻成一句英文的音效描述。翻失敗就原樣回傳（讓呼叫的人處理）。"""
        if not _CJK_RE.search(text):
            return text
        try:
            reply = await call_model([
                {"role": "system", "content": ("You translate short-video requests into one concrete English description for a text-to-video model "
                                               "(subject + action + environment + sound, e.g. 'A red paper lantern floating over a calm night lake, gentle ripples, soft wind and crickets'). "
                                               "If the request is only about how an existing picture should move, describe just the motion. Output only the English description, no quotes, no explanation.")
                                              if video else
                                              "You translate sound-effect requests into a short, concrete English description for a text-to-sound-effect model "
                                              "(describe the sound itself and the environment, e.g. 'footsteps on gravel, slow, night, crickets'). Output only the English description, no quotes, no explanation."},
                {"role": "user", "content": text}], use_tools=False, max_tokens=120)
            out = clean_text(reply.get("content")).strip().strip('"“”')
            return out if out and not _CJK_RE.search(out) else text
        except Exception as e:
            log.warning("音效描述翻譯失敗：%r", e)
            return text


    @client.tree.command(name="音效", description="做一段音效（約 10 秒～數分鐘，做好會貼在頻道）：環境音、物品聲、短樂句；不是語音也不是歌")
    @app_commands.describe(內容="想要什麼聲音（中英文都可以），例如：雨夜裡的腳步聲", 秒數="長度 1～47 秒，預設 5", 避免="選填：不要出現的東西（英文），例如 music, speech")
    async def cmd_sfx(interaction: discord.Interaction, 內容: str, 秒數: app_commands.Range[int, 1, 47] = 5, 避免: str = ""):
        if not imagegen.channel_ok(interaction.channel):
            await interaction.response.send_message(NSFW_SFX_REPLY, ephemeral=True)
            return
        if not sfxgen.enabled():
            await interaction.response.send_message("音效功能目前沒開。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        prompt = await _sfx_to_english(內容)
        res = await sfxgen.submit(client.http_session, {"prompt": prompt, "seconds": 秒數, "avoid": 避免}, interaction.user.id,
                                  imagegen.say_for_interaction(interaction), 內容)
        await interaction.followup.send(res + (f"\n（英文描述：{prompt}）" if prompt != 內容 and "排進" in res else ""))


    @client.tree.command(name="影片", description="做一支最長 6 秒的小動畫影片（約 2～3 分鐘）：文字轉影片，或附上圖片讓它動起來")
    @app_commands.describe(內容="畫面與動作（中英文都可以）；有附圖就只寫「要怎麼動」", 秒數="長度 1～6 秒，預設 5", 圖片="選填：附圖＝讓這張圖動起來（圖轉影片）")
    async def cmd_video(interaction: discord.Interaction, 內容: str, 秒數: app_commands.Range[int, 1, 6] = 5, 圖片: discord.Attachment | None = None):
        if not imagegen.channel_ok(interaction.channel):
            await interaction.response.send_message(videogen.NSFW_REPLY, ephemeral=True)
            return
        if not videogen.enabled():
            await interaction.response.send_message("影片功能目前沒開。", ephemeral=True)
            return
        if 圖片 is not None and not (圖片.content_type or "").startswith("image/"):
            await interaction.response.send_message("請上傳圖片檔（PNG／JPEG／WEBP）。", ephemeral=True)
            return
        await interaction.response.defer(thinking=True)
        img = (await 圖片.read(), 圖片.filename or "image.png", (圖片.content_type or "image/png").split(";")[0]) if 圖片 is not None else None
        prompt = await _sfx_to_english(內容, video=True)
        res = await videogen.submit(client.http_session, {"prompt": prompt, "seconds": 秒數}, interaction.user.id,
                                    imagegen.say_for_interaction(interaction), 內容, img)
        await interaction.followup.send(res + (f"\n（英文描述：{prompt}）" if prompt != 內容 and "排進" in res else ""))
