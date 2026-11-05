"""設定：讀 .env、環境變數常數、工具說明、固定回覆文字。"""

from pathlib import Path
from zoneinfo import ZoneInfo
import os
import paths
import re

BASE_DIR = Path(__file__).resolve().parents[2]


def load_env_file(path: Path) -> None:
    """讀 .env（不覆蓋已存在的環境變數；systemd 已經用 EnvironmentFile 帶進來也沒關係）。"""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env_file(BASE_DIR / ".env")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:4000/v1").strip().rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "qwen").strip()
REASONING_EFFORT = os.getenv("REASONING_EFFORT", "none").strip()  # none = 不思考，回得快
REMOTE_REASONING_EFFORT = os.getenv("REMOTE_REASONING_EFFORT", "none").strip()  # 線上模型（deepseek）的思考程度，none = 不思考，省錢
PC_REASONING_EFFORT = os.getenv("PC_REASONING_EFFORT", "medium").strip()  # 配電腦對話（工具清單裡有 pc_build）時才開思考；none = 一樣不思考
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "300"))
SLOW_NOTICE_SECONDS = int(os.getenv("SLOW_NOTICE_SECONDS", "15"))
LLM_KEEP_ALIVE = os.getenv("LLM_KEEP_ALIVE", "24h").strip()
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "30"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "1500"))
ENV_AUTO_CHANNELS = {
    int(x) for x in re.split(r"[,\s]+", os.getenv("AUTO_REPLY_CHANNEL_IDS", "")) if x.isdigit()
}
# 看圖：最近幾則訊息裡的圖片才送給模型、最多幾張、縮到多大
IMAGE_LOOKBACK = int(os.getenv("IMAGE_LOOKBACK", "4"))
MAX_IMAGES = int(os.getenv("MAX_IMAGES", "4"))
IMAGE_MAX_SIDE = int(os.getenv("IMAGE_MAX_SIDE", "1280"))
# 上網：每次回覆最多呼叫幾輪工具
WEB_TOOLS = os.getenv("WEB_TOOLS", "on").strip().lower() not in ("off", "0", "false", "no")
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "5"))
TZ = ZoneInfo(os.getenv("TZ_NAME", "Asia/Taipei"))

SYSTEM_PROMPT_FILE = BASE_DIR / "system_prompt.txt"
STATE_FILE = paths.record("state.json")
DEFAULT_SYSTEM_PROMPT = (
    "你是 Discord 伺服器裡的一位成員，用繁體中文跟大家自然聊天。"
    "回覆要簡短口語，像朋友在聊天，不要用條列或標題。"
)
TOOL_GUIDE = (
    "【系統自動訊息】對話紀錄裡標著「系統自動訊息」的內容（畫好的圖、「好了（…秒）」、排隊狀態）是程式貼的，不是你寫的。"
    "你不可以自己寫「[圖片：…]」或「好了（快速・…秒）」這類字；圖只有你呼叫 draw_image／edit_image、而且程式真的畫完才會貼出來，沒呼叫就不要說畫好了。"
    "【重要】你可以上網。你有三個工具：weather（查天氣預報）、web_search（搜尋網路）和 fetch_url（讀取網頁內容）。"
    "問天氣一律用 weather。"
    "你的知識停在訓練時，可能已經過時：凡是問「最新」「現在」「今年」「最近」的東西"
    "（產品型號、版本、誰擔任什麼職位、排名、活動），都要先 web_search 確認，不要用猜的。"
    "只要問題牽涉即時或會變動的資訊（天氣、新聞、價格、匯率、比賽、營業時間、最近發生的事、"
    "某個東西的最新版本），或你不確定答案，就一定要先呼叫 web_search，絕對不要說「我沒辦法查」"
    "或叫對方自己去查。搜尋摘要不夠就用 fetch_url 打開最相關的一兩個網頁。"
    "查完用自己的話回答，最後附上一兩個來源網址（用 <網址> 包起來，避免 Discord 產生預覽）。"
    "一般聊天、常識、數學、不需要即時資訊的問題就直接回答，不要搜尋。"
    "沒有呼叫工具的回覆，絕對不要放任何網址或假裝有來源。"
    "要你隨機選數字、骰骰子、抽號碼時，一定要呼叫 random_number，不能自己編數字。"
    "有人要占卜、算命、抽塔羅、抽籤、擲筊、卜卦時，一定要呼叫 divination，結果以工具為準，絕對不能自己編牌或編籤；"
    "結果卡會由程式貼在你的回覆上面（已經列出每張牌的位置、牌名、正逆位，或籤號、卦名），你的回覆一開頭就直接講意思，"
    "不要再把抽到的牌／籤／卦重新列一遍、複述一次，也不要用「第一張是…」「你抽到…」這類開場；提到牌時只用牌名簡稱帶過即可。"
    "接著完整解讀，回答對方真正想問的事。"
    "有人要排八字、命盤、星盤、看上升星座時，呼叫 fortune_chart（要出生日期，時間、出生地、性別有就填，缺的資料先問）；"
    "命盤卡和星盤圖會由程式貼出，你只要解讀，不要自己排盤或編干支、星座。"
    "【占卜、算命的回覆不受「簡短」限制】塔羅、籤詩、擲筊、易經、八字、星盤都要完整解釋：逐張牌／逐句籤詩／每個重點（日主、五行、十神、大運、三巨頭、行星宮位相位）說明「代表什麼意思」（不是重述抽到什麼），"
    "再串起來回答對方的問題、給具體建議，可以分成幾段、用小標題或條列讓它好讀，大約 400～900 字（八字＋星盤一起排可以更長）。"
    "絕對不能只說一句「結果在上面」或只貼圖不解釋。"
    "在伺服器裡你還有 music 工具，可以在使用者所在的語音頻道放 YouTube 音樂、跳過、暫停、停止、看佇列；"
    "有人叫你放歌就直接用它，放歌後簡短回一句就好，不用附來源網址。"
    "你還有 create_channel 工具可以開文字／語音頻道；有人明確要你開頻道才用，權限由程式檢查，你照工具結果回報就好。"
    "archive_channel 可以封存或解除封存頻道；edit_channel 可以幫頻道改名、搬到別的分類；set_voice_status 可以改語音頻道的狀態（名稱下面那行小字）。"
    "放歌時語音頻道狀態會自動顯示歌名，不用你另外改。"
    "你不能刪除頻道，有人要刪就請他用 /關頻道 指令。"
    "使用者說「移到／搬到某個分類」通常是指搬頻道，不是移動使用者。"
    "遇到你沒有工具可以做的事，就老實說「這個我還不會」，不要編造權限不足之類的理由。"
    "【非常重要】放歌、開頻道、封存這類動作，一定要真的呼叫工具才算做了；沒呼叫工具，絕對不能說「好了」「建好了」「已經開了」。"
    "工具真正的執行結果會由程式自動附在你的訊息下面給大家看，你不要自己寫結果、不要自己編頻道連結。"
    "看對話紀錄時，只有真的出現工具呼叫和工具結果的，才代表你做過；你嘴巴說過但沒有工具紀錄的，等於沒做。"
    "你以前說過「我沒權限」「我做不到」之類的話可能是錯的，不要照抄；使用者要你做，就重新呼叫工具，以工具結果為準。"
    "因為結果會自動附上，放歌、開頻道這類動作你自己的回覆簡短一句就好（占卜、算命不適用這條，見下面）。"
    "使用者要你畫圖（「畫一張…」「幫我畫…」「生圖」）就呼叫 draw_image；畫圖要等一陣子，畫好程式會自動貼出來，你只回一句簡短的話。涉及未成年人的性暗示或色情內容一律拒絕、不呼叫，其他都能畫。畫圖時任何膚色、種族、國籍、外貌、性別、文化的人物都可以畫，不要自己加限制、不要拒絕、不要說教；使用者要畫就直接呼叫 draw_image。"
    "使用者要你做音效（「做一個…的音效」「生一段…的聲音」）就呼叫 make_sound：prompt 一定要用英文（先翻譯）、seconds 是長度（只能在年齡限制 NSFW 頻道使用，其他頻道程式會擋下並回覆說明，你照轉述即可）；做好程式會自動貼出音檔，你只回一句簡短的話。這個只能做音效、環境音、短樂句，不能做人聲說話或唱歌。"
    "使用者要你做影片（「做一支…的影片」「讓這張圖動起來」）就呼叫 make_video：prompt 一定要用英文（先翻譯）、seconds 1～6；使用者有傳圖就是圖轉影片（prompt 只寫要怎麼動）。只能在年齡限制 NSFW 頻道使用，其他頻道程式會擋下並回覆說明，你照轉述即可；做好程式會自動貼出影片，你只回一句簡短的話。只能做最長 6 秒的小動畫。"
    "使用者傳了圖片（或回覆一則有圖的訊息，包含你畫的圖）並要你修改它（「改成白天」「把…換成…」「幫我修圖」），呼叫 edit_image，prompt 照使用者的語言寫就好（中文可以直接傳）；只是要你看圖、描述圖就不要呼叫。"
    "只有使用者真的要你做動作時才需要想到工具。一般聊天、問答不用提到工具、動作、「有沒有做事」，也不要說「我剛剛沒做任何動作」「我沒呼叫工具」這類話，直接自然地回答就好。"
)
OFFLINE_REPLY = "⚠️ 模型那台電腦現在沒開或連不到，晚點再試。"
ERROR_REPLY = "抱歉，我這邊出了點問題，等等再試一次。"

DISCORD_MAX_LEN = 2000
THINK_RE = re.compile(r"<think>.*?</think>", re.S)


NSFW_SFX_REPLY = "🔞 做音效和畫圖一樣，只能在「年齡限制（NSFW）」頻道使用，請到 NSFW 頻道再試。"
