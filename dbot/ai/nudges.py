"""回覆檢查用的規則：關鍵字判斷、提醒訊息、清掉假圖片標記。"""

import os
import re

# 模型自己亂寫的假圖片標記和假「好了」：送出前拿掉
FAKE_MEDIA_RE = re.compile(r"\[圖片：[^\]\n]*\]|🖼️\s*好了（[^）\n]*）|好了（(?:快速|構圖與文字較乾淨)[^）\n]*）")

def strip_fake_media(text: str) -> str:
    out = FAKE_MEDIA_RE.sub("", text)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out or "我沒有真的畫圖。要畫的話再跟我說一次。"


ACTION_TOOLS = {"draw_image", "edit_image", "make_sound", "make_video", "web_image", "music", "create_channel", "archive_channel", "edit_channel", "set_voice_status"}
CARD_TOOLS = {"divination", "fortune_chart"}       # 結果卡由程式貼在回覆最上面（DIVIDER 前面那段），模型只解讀
CARD_MAX_TOKENS = int(os.getenv("CARD_MAX_TOKENS", "4000"))   # 占卜、命盤的解讀比較長，回覆上限放寬
FILE_RE = re.compile(r"\n?\[\[FILE:([^\]]+)\]\]")
CLAIM_RE = re.compile(
    r"(建好|開好|建立好|創好|已經?(建立|開(?!始|心|學)|建|創|封存|解除|刪|移除|清空|鎖|隱藏|放(?!學|假)|播|加入|跳過|暫停|停止)|"
    r"(封存|鎖|藏|開|建|創)(起來|好)了|頻道.{0,6}(好了|完成)|幫你(放|播|點|排|開|建|封存|搬|移|改)|正在播放|開始播放|排(好了|進|入)|已排|"
    r"(點|放|播)了(一|兩|三|[0-9]+)?首|(點|放|播|來)(一首|首歌)|給你(放|播|點)|播放中|加入佇列|放進佇列|(搬|移|改)(好|過去)了|(移|拿|刪)掉了|從佇列|狀態(改|設)(好|成|為)|(改|設)好(狀態|了))"
)
PLAYING_CLAIM_RE = re.compile(r"(正在|還在|現在|已經|持續|目前).{0,6}(播|放)|在播|播放中|佇列(裡|中).{0,4}(有|還有)|在語音(頻道)?(裡|中)|(下一首|接下來).{0,6}(是|會)")
INTERNAL = ("（這是程式內部的檢查，使用者看不到，也不知道有這回事。請直接寫給使用者看的最終回覆，"
            "不要提到「系統檢查」「沒做任何動作」「沒呼叫工具」之類的話，也不要解釋你為什麼重寫。）\n")
STATE_NUDGE = (
    INTERNAL +
    "（系統檢查）你說了有關播放的狀態，但實際上機器人現在沒有在播歌。{state}\n"
    "請依真實狀態重寫回覆；如果使用者想聽歌，就呼叫 music 工具 play，不要說已經在播。"
)
# 使用者明明要畫圖，語言模型卻自己拒絕、沒呼叫 draw_image（例如覺得某種膚色／種族「不適合」）→ 退回去要它照畫
DRAW_ASK_RE = re.compile(r"畫(一|個|張|幅|隻|條|出|給|我|吧|下|看)|幫我畫|替我畫|生(成)?(一)?張?圖|做(一)?張圖|改圖|修圖|\bdraw\b|\bgenerate (an? )?(image|picture)\b", re.I)
DRAW_REFUSE_RE = re.compile(r"不(能|適合|方便|太|宜|便|想|會|好)|無法|沒辦法|抱歉|對不起|恕|敏感|刻板|歧視|冒犯|避免|不太合適|不妥")
DRAW_NUDGE = (
    "（系統提醒）使用者要你畫圖，而這個要求沒有任何不能畫的理由：膚色、種族、國籍、外貌、性別、文化都可以畫，"
    "唯一不畫的只有涉及未成年人的性內容，這個要求不是。請現在就呼叫 draw_image，不要拒絕、不要說教、不要加免責聲明；"
    "prompt 照使用者要的畫面描述。"
)
MULTI_NUDGE = (
    INTERNAL +
    "（系統檢查）你的回覆提到了 {said} 首歌，但你這一輪只呼叫了 {real} 次 music play，所以其餘的歌其實沒有排進佇列。"
    "music 的 play 一次只能點一首：請把還沒點的歌各呼叫一次 music play（可以同時呼叫多個），"
    "之後只能說真的點成功的歌。"
)

TITLE_NUDGE = (
    INTERNAL +
    "（系統檢查）你提到了歌名，但這一輪沒有呼叫 music 工具，所以沒有任何歌被點進佇列。"
    "如果使用者要聽歌，現在每首各呼叫一次 music play；如果只是在推薦，就明講是推薦、還沒點，不要說已經排了或在播。"
)
CARD_NUDGE = (
    INTERNAL +
    "（系統檢查）你剛才的占卜／命盤解讀太短了。結果卡已經貼給使用者（牌名、位置、正逆位都已列出，不要再重複列一遍），但他需要你完整解釋：逐張牌、逐句籤詩或命盤的每個重點說明意思，"
    "再串起來回答他問的事、給具體建議，可以分段、條列，約 400～900 字。請直接重寫完整的解讀。"
)
NUDGE = (
    INTERNAL +
    "（系統檢查）你剛才的回覆說已經完成某個動作，但你這一輪並沒有呼叫任何工具，所以實際上什麼都沒發生。"
    "如果使用者要你放歌、開頻道或封存，現在就呼叫對應的工具；"
    "如果其實不需要做動作，就重寫回覆，不要說已經完成。"
)


META_RE = re.compile(r"[^。！？!?～~\n]*(系統檢查|沒做任何動作|沒有做任何動作|沒說自己做了|沒有說自己做了|沒呼叫(任何)?工具|沒有呼叫(任何)?工具|純聊天啦)[^。！？!?～~\n]*[。！？!?～~]*")


def strip_meta(text: str) -> str:
    """模型偶爾會把內部檢查的事講出來，這裡把那幾句拿掉（全拿光就留原文，不回空字串）。"""
    out = META_RE.sub("", strip_fake_media(text) if FAKE_MEDIA_RE.search(text) else text).strip()
    return out or text


# 冷門工具只在使用者這句話提到相關字眼時才放進工具清單（工具說明每次都會算進 token，不常用的別一直帶著）
ACT_RE = re.compile(r"activity|遊戲間|在玩|在打|玩什麼|玩啥|誰在(玩|打)|有人(在)?(玩|打)|開著", re.I)

REPAY_RE = re.compile(r"還(你)?(錢|債|款|幣|代幣)|還清|還你|還款|我要還|來還", re.I)
LOG_RE = re.compile(r"轉帳|轉账|紀錄|記錄|誰.{0,5}(轉|給|借|欠)|轉給|有人轉|收到.{0,4}(錢|幣)|欠.{0,4}(誰|多少|錢)|帳目|帳單|流水|欠債|欠款", re.I)
PAY_RE = re.compile(r"給我.{0,4}(錢|幣|代幣)|(發|轉|匯|打|賞|送|借).{0,4}(我|給我).{0,6}(錢|幣|代幣)|(發|轉|匯|打|賞|送).{0,3}(錢|幣|代幣|紅包)|紅包|打賞|請我|獎勵|\bpay\b|轉帳|借我.{0,3}(錢|幣)|窮|沒錢", re.I)
MONEY_RE = re.compile(r"你.{0,6}(代幣|代币|多少錢|多少钱|多少幣|身家|錢包|荷包|存款|餘額|口袋)|(代幣|代币|錢包|餘額).{0,6}你|莊家.{0,6}(賺|賠|多少|有)|bot.{0,6}(代幣|錢)", re.I)
ALMANAC_RE = re.compile(r"吉日|黃道|黄道|擇日|择日|宜忌|黃曆|黄历|農民曆|农民历|適合.{0,6}(結婚|搬家|入宅|開店|開市|動土|訂婚|買車)|哪天.{0,4}(搬|結婚|開)", re.I)


def last_user_text(conversation: list[dict]) -> str:
    for m in reversed(conversation):
        if m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                return " ".join(str(x.get("text", "")) for x in c if isinstance(x, dict))
            return ""
    return ""


# 只要最近幾句話跟錢有關，就把錢相關的工具全部交給模型（不再一個工具一個字眼地挑，免得它「沒有工具」卻以為自己不能轉帳）
MONEY_ANY_RE = re.compile(r"錢|幣|代幣|轉帳|轉账|轉我|轉給|匯|紅包|打賞|賞我|給我|發我|借|還|欠|債|帳|賬|餘額|身家|錢包|荷包|存款|利息|貸款|莊家|獎勵|請我|零用|零花|資助|\bpay\b|窮", re.I)


def recent_user_text(conversation: list[dict], n: int = 3) -> str:
    out = []
    for m in reversed(conversation):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        out.append(c if isinstance(c, str) else " ".join(str(x.get("text", "")) for x in c if isinstance(x, dict)) if isinstance(c, list) else "")
        if len(out) >= n:
            break
    return "\n".join(out)
