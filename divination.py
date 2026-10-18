"""占卜：塔羅牌、擲筊、抽籤詩（天上聖母六十甲子籤）、易經卜卦。

抽牌、擲筊、起卦都用系統亂數（secrets）由程式決定，模型只負責解讀，不能自己編結果。
run_tool() 回傳的文字分兩段：DIVIDER 前面是給大家看的「結果卡」（程式直接貼在回覆最上面），
後面是只給模型看的牌義／原文／解讀規則。
籤詩和《周易》原文取自維基文庫（divination_data/），塔羅牌義是自己整理的常見解釋。
"""
import json
import logging
import secrets
from pathlib import Path

DATA = Path(__file__).resolve().parent / "divination_data"
RNG = secrets.SystemRandom()
DIVIDER = "\n=====（以下只給模型看）=====\n"

ZHOUYI = json.loads((DATA / "zhouyi.json").read_text(encoding="utf-8"))
QIAN60 = json.loads((DATA / "qian60.json").read_text(encoding="utf-8"))

# ---------------------------------------------------------------- 塔羅（偉特牌系統，78 張）
# 每張：(名稱, 正位關鍵字, 逆位關鍵字)
MAJOR = [
    ("0 愚者", "新的開始、冒險、自由、單純的信心", "魯莽、猶豫不決、冒失、不切實際"),
    ("I 魔術師", "行動力、創造、資源齊備、把想法實現", "能力沒發揮、欺騙、操弄、準備不足"),
    ("II 女祭司", "直覺、潛意識、靜觀、祕密", "忽略直覺、隱瞞、表面功夫、情緒壓抑"),
    ("III 女皇", "豐盛、滋養、創造力、享受生活", "依賴、過度保護、停滯、缺乏自我照顧"),
    ("IV 皇帝", "權威、秩序、穩定、掌控全局", "專制、固執、失控、缺乏紀律"),
    ("V 教皇", "傳統、制度、指導者、信念", "打破常規、教條、被規矩綁住、不信任權威"),
    ("VI 戀人", "愛情、契合、重要的選擇、價值觀一致", "關係失衡、選擇困難、價值衝突、誘惑"),
    ("VII 戰車", "意志力、前進、勝利、克服阻礙", "方向混亂、失控、受阻、衝過頭"),
    ("VIII 力量", "內在力量、耐心、溫柔地掌控、勇氣", "自我懷疑、軟弱、情緒失控、缺乏信心"),
    ("IX 隱士", "獨處、反省、尋找答案、內在智慧", "孤立、逃避人群、鑽牛角尖、拒絕建議"),
    ("X 命運之輪", "轉機、循環、好運、命運的安排", "壞運、抗拒改變、時機不對、反覆"),
    ("XI 正義", "公平、因果、理性判斷、誠實", "不公平、逃避責任、偏見、判斷失準"),
    ("XII 吊人", "暫停、換個角度、犧牲、等待", "拖延、無謂的犧牲、卡住、不願放手"),
    ("XIII 死神", "結束與重生、轉變、告別舊的", "抗拒改變、拖著不結束、停滯"),
    ("XIV 節制", "平衡、調和、耐心、循序漸進", "失衡、過度、急躁、不協調"),
    ("XV 惡魔", "誘惑、執著、束縛、物慾", "掙脫束縛、覺醒、戒除壞習慣"),
    ("XVI 高塔", "突然的變動、崩解、真相揭露", "躲過災難、害怕改變、延後的危機"),
    ("XVII 星星", "希望、療癒、靈感、對未來樂觀", "失望、信心不足、與自己失去連結"),
    ("XVIII 月亮", "不安、迷惘、幻象、潛意識浮現", "疑慮消散、真相漸明、走出混亂"),
    ("XIX 太陽", "成功、快樂、活力、光明正面", "暫時的低潮、過度樂觀、延遲的成功"),
    ("XX 審判", "覺醒、重新評估、召喚、復活", "自我懷疑、不願面對過去、錯過機會"),
    ("XXI 世界", "完成、圓滿、整合、旅程告一段落", "未完成、差臨門一腳、缺乏結尾"),
]
SUITS = [
    ("權杖", "行動、熱情、事業、創意"),
    ("聖杯", "情感、人際、愛情、直覺"),
    ("寶劍", "思考、溝通、衝突、決斷"),
    ("錢幣", "金錢、工作、身體、現實物質"),
]
MINOR = {
    "權杖": [
        ("一", "新計畫、靈感、熱情的開端", "延誤、缺乏動力、起步受挫"),
        ("二", "規劃未來、做決定、展望", "害怕未知、計畫不周、猶豫"),
        ("三", "擴展、等待成果、遠見", "受阻、進展慢、眼光短淺"),
        ("四", "慶祝、安定、和諧的家", "不安定、過渡期、慶祝取消"),
        ("五", "競爭、衝突、意見不合", "避免衝突、內耗、緊張緩解"),
        ("六", "勝利、被肯定、成功", "失去面子、驕傲、功勞被搶"),
        ("七", "堅守立場、面對挑戰", "被壓倒、放棄、疲於應付"),
        ("八", "快速進展、消息、行動", "延遲、混亂、錯過時機"),
        ("九", "堅持、防備、最後關頭", "疲憊、防衛過度、快撐不住"),
        ("十", "負擔過重、責任、壓力", "卸下重擔、學會分工"),
        ("侍者", "好奇、新消息、探索", "三分鐘熱度、壞消息、不成熟"),
        ("騎士", "衝勁、冒險、說走就走", "衝動、魯莽、半途而廢"),
        ("皇后", "自信、熱情、有魅力", "嫉妒、情緒化、自我中心"),
        ("國王", "領導力、遠見、開創", "霸道、衝動決策、期望過高"),
    ],
    "聖杯": [
        ("一", "新的感情、愛、情緒滿溢", "情感封閉、空虛、壓抑"),
        ("二", "結合、互相吸引、夥伴", "關係失衡、分歧、誤會"),
        ("三", "友誼、慶祝、聚會", "過度玩樂、小圈圈、第三者"),
        ("四", "冷淡、不滿足、錯過機會", "重新振作、接受新機會"),
        ("五", "失落、遺憾、只看到失去的", "走出悲傷、接受、原諒"),
        ("六", "回憶、童年、單純的善意", "活在過去、無法前進"),
        ("七", "幻想、選擇太多、白日夢", "認清現實、做出選擇"),
        ("八", "離開、放下、尋找更深的意義", "害怕離開、徘徊不前"),
        ("九", "願望實現、滿足", "貪心、不滿足、表面的快樂"),
        ("十", "家庭幸福、圓滿、和樂", "家庭不和、價值觀衝突"),
        ("侍者", "感性、創意、好消息", "情緒不成熟、幻想"),
        ("騎士", "浪漫、追求、邀約", "不切實際、情緒善變"),
        ("皇后", "溫柔、同理心、照顧人", "情緒依賴、過度敏感"),
        ("國王", "情緒穩定、包容、成熟", "情緒操控、壓抑感受"),
    ],
    "寶劍": [
        ("一", "突破、清晰、真相", "混亂、判斷錯誤、誤用言語"),
        ("二", "僵局、難以抉擇、逃避", "資訊過多、做出選擇、解除僵局"),
        ("三", "心碎、悲傷、分離", "療傷、走出痛苦"),
        ("四", "休息、恢復、沉澱", "疲勞、休息不夠、重新出發"),
        ("五", "爭執、輸贏、贏了面子輸了裡子", "和解、放下爭執"),
        ("六", "過渡、離開困境、慢慢好轉", "困住、無法離開、舊事未了"),
        ("七", "計謀、隱瞞、單獨行動", "坦白、被揭穿、良心不安"),
        ("八", "受困、自我設限、無力感", "解脫、看清限制、重獲自由"),
        ("九", "焦慮、失眠、擔心過度", "走出焦慮、事情沒那麼糟"),
        ("十", "谷底、結束、最壞的過去了", "慢慢恢復、拒絕結束"),
        ("侍者", "好奇、觀察、求知", "八卦、多疑、說話不經思考"),
        ("騎士", "果斷、急進、直接", "莽撞、口無遮攔、衝突"),
        ("皇后", "獨立、理性、看得透", "尖酸、冷漠、過度批判"),
        ("國王", "理智、權威、公正判斷", "冷酷、濫用權力、操控"),
    ],
    "錢幣": [
        ("一", "新的財源、機會、穩固的開始", "錯失機會、計畫不實際"),
        ("二", "平衡、應變、兼顧多件事", "手忙腳亂、財務失衡"),
        ("三", "合作、技能被看見、團隊", "缺乏合作、品質不佳"),
        ("四", "守財、穩定、保守", "吝嗇、過度控制、守不住"),
        ("五", "困頓、匱乏、被冷落", "走出困境、得到幫助"),
        ("六", "給予與接受、分享、慷慨", "施捨不均、債務、附帶條件"),
        ("七", "耐心等待收成、評估", "白忙、沒耐心、投資報酬低"),
        ("八", "專注學習、磨練技藝、勤奮", "敷衍、缺乏熱情、重複"),
        ("九", "獨立、富足、自給自足", "過度工作、財務不穩"),
        ("十", "家業、長期財富、傳承", "家庭財務糾紛、根基不穩"),
        ("侍者", "學習、新機會、踏實", "不切實際、拖延"),
        ("騎士", "踏實、可靠、按部就班", "停滯、無聊、太保守"),
        ("皇后", "務實、照顧、富足", "物質至上、忽略自己"),
        ("國王", "成功、穩重、財務自由", "貪婪、固執、只看錢"),
    ],
}
TAROT = list(MAJOR) + [(f"{s}{r}", u, rv) for s, _ in SUITS for r, u, rv in MINOR[s]]
assert len(TAROT) == 78
SPREADS = {
    "one": ["指引"],
    "three": ["過去", "現在", "未來"],
    "choice": ["選項 A", "選項 B", "建議"],
    "love": ["你", "對方", "關係走向"],
}


def tarot(spread: str, question: str) -> str:
    pos = SPREADS.get(spread) or SPREADS["three"]
    cards = RNG.sample(range(78), len(pos))
    card_lines, detail, drawn = [], [], []
    for p, i in zip(pos, cards):
        name, up, rev = TAROT[i]
        reversed_ = RNG.random() < 0.5
        drawn.append((i, reversed_))
        card_lines.append(f"**{p}**：{name}（{'逆位' if reversed_ else '正位'}）")
        suit = next((s for s, _ in SUITS if name.startswith(s)), None)
        theme = f"；花色主題：{dict(SUITS)[suit]}" if suit else "（大阿爾克那，代表較重大的課題）"
        detail.append(f"{p}：{name}{'逆位' if reversed_ else '正位'} — 牌義：{rev if reversed_ else up}{theme}")
    head = f"🔮 **塔羅占卜**" + (f"｜問：{question}" if question else "")
    img = ""
    try:
        import drawimg
        img = "\n[[FILE:" + drawimg.tarot_spread([(p, i, TAROT[i][0], rv) for p, (i, rv) in zip(pos, drawn)], "塔羅占卜" + (f"｜{question}" if question else "")) + "]]"
    except Exception as e:
        logging.getLogger("discord-ai-bot.divination").warning("塔羅圖片失敗：%r", e)
    return (head + "\n" + "\n".join(card_lines) + DIVIDER + "\n".join(detail) +
            "\n解讀方式：依牌陣位置逐張說明，再把整體串成一個故事回答問題；逆位通常是能量受阻、不足或過度，不一定是壞事。" + img)


# ---------------------------------------------------------------- 擲筊
JIAO = [("聖筊", "一平一凸：神明同意／可以"), ("笑筊", "兩個平面朝上：神明笑而不答，問題不清楚或答案已在心中"), ("陰筊", "兩個凸面朝上：神明不同意／不太好")]


def throw_jiao() -> int:
    a, b = RNG.random() < 0.5, RNG.random() < 0.5
    return 0 if a != b else (1 if a else 2)


def jiaobei(times: int, question: str) -> str:
    times = max(1, min(int(times or 3), 3))
    res = [throw_jiao() for _ in range(times)]
    sheng = res.count(0)
    icon = {0: "🌗", 1: "🌕", 2: "🌑"}
    lines = [f"第 {k + 1} 擲：{icon[r]} **{JIAO[r][0]}**" for k, r in enumerate(res)]
    if times == 3:
        verdict = "三個聖筊，神明明確同意 ✨" if sheng == 3 else f"{sheng} 個聖筊"
        lines.append(f"結果：{verdict}")
    head = "🙏 **擲筊**" + (f"｜問：{question}" if question else "")
    return (head + "\n" + "\n".join(lines) + DIVIDER + "\n".join(f"{n}：{d}" for n, d in JIAO) +
            "\n一般習慣：連續三個聖筊才算神明明確答應；出現陰筊通常表示不行或時機未到；笑筊表示問法不清楚、或心裡其實已有答案，可以換個方式再問。")


# ---------------------------------------------------------------- 抽籤詩（天上聖母六十甲子籤）
def qian(question: str) -> str:
    tries = []
    for _ in range(10):                       # 抽一支籤，要擲到聖筊才算數，不然重抽
        n = RNG.randrange(60)
        j = throw_jiao()
        tries.append((n, j))
        if j == 0:
            break
    n = tries[-1][0]
    q = QIAN60[n]
    re_draw = "".join(f"（第 {t + 1} 籤擲出{JIAO[j][0]}，重抽）\n" for t, j in tries[:-1])
    head = "🏮 **抽籤（天上聖母六十甲子籤）**" + (f"｜問：{question}" if question else "")
    card = (f"{head}\n{re_draw}擲筊：🌗 聖筊，確認是這支籤\n"
            f"**第 {q['n']} 籤　{q['gz']}**（{q['attr']}）\n> {q['poem'][0]}\n> {q['poem'][1]}")
    detail = (f"籤詩：{q['poem'][0]}{q['poem'][1]}\n籤頭屬性：{q['attr']}\n卦頭故事：{q['story'] or '（無）'}\n"
              "解讀方式：先用白話解釋籤詩意思，再針對對方問的事（感情、工作、考試、財運、健康、尋物等）給具體建議；"
              "可以提一下卦頭故事的寓意。不要誇大或嚇人，健康、法律、金錢的重大決定要提醒對方以專業意見為準。")
    return card + DIVIDER + detail


# ---------------------------------------------------------------- 易經（三錢法起卦）
TRIGRAM = {(1, 1, 1): "乾", (1, 1, 0): "兌", (1, 0, 1): "離", (1, 0, 0): "震", (0, 1, 1): "巽", (0, 1, 0): "坎", (0, 0, 1): "艮", (0, 0, 0): "坤"}  # 由下往上
TRI_ICON = {"乾": "☰", "兌": "☱", "離": "☲", "震": "☳", "巽": "☴", "坎": "☵", "艮": "☶", "坤": "☷"}
TRI_NATURE = {"乾": "天", "兌": "澤", "離": "火", "震": "雷", "巽": "風", "坎": "水", "艮": "山", "坤": "地"}
BY_TRI = {(h["lower"], h["upper"]): h for h in ZHOUYI}
POS = ["初", "二", "三", "四", "五", "上"]


def hexagram(lines: list[int]) -> dict:
    return BY_TRI[(TRIGRAM[tuple(lines[:3])], TRIGRAM[tuple(lines[3:])])]


def iching(question: str) -> str:
    vals = [sum(RNG.choice((2, 3)) for _ in range(3)) for _ in range(6)]   # 由下往上：6 老陰、7 少陽、8 少陰、9 老陽
    base = [1 if v in (7, 9) else 0 for v in vals]
    moving = [k for k, v in enumerate(vals) if v in (6, 9)]
    rel = [1 - b if k in moving else b for k, b in enumerate(base)]
    h1 = hexagram(base)
    h2 = hexagram(rel) if moving else None
    draw = []
    for k in range(5, -1, -1):                 # 由上往下畫
        bar = "▅▅▅▅▅▅▅" if base[k] else "▅▅▅　▅▅▅"
        mark = "　○ 老陽（變）" if vals[k] == 9 else "　✕ 老陰（變）" if vals[k] == 6 else ""
        draw.append(f"`{bar}`{mark}")
    def title(h):
        return f"第 {h['n']} 卦　{h['name']}（{TRI_NATURE[h['upper']]}{TRI_NATURE[h['lower']]}{'' if h['upper'] != h['lower'] else ''}，{TRI_ICON[h['upper']]}上{TRI_ICON[h['lower']]}下）"
    head = "☯️ **易經卜卦**" + (f"｜問：{question}" if question else "")
    card = f"{head}\n本卦：**{title(h1)}**\n" + "\n".join(draw) + f"\n> {h1['gua']}"
    if h2:
        card += f"\n變爻：{'、'.join(h1['yao'][k][:2] for k in moving)}　→　之卦：**{title(h2)}**"
    # 依變爻數決定看哪段（朱熹《易學啟蒙》的常見說法）
    n = len(moving)
    if n == 0:
        focus = "沒有變爻：以本卦卦辭為主。"
    elif n == 1:
        focus = f"一個變爻：以本卦「{h1['yao'][moving[0]]}」為主。"
    elif n == 2:
        focus = f"兩個變爻：以本卦這兩爻的爻辭為主，上面那爻（{h1['yao'][moving[1]][:2]}）為重。"
    elif n == 3:
        focus = "三個變爻：本卦卦辭和之卦卦辭一起看，本卦為主、之卦為輔（代表事情的發展方向）。"
    elif n == 4:
        still = [k for k in range(6) if k not in moving]
        focus = f"四個變爻：看之卦中沒變的兩爻（{h2['yao'][still[0]][:2]}、{h2['yao'][still[1]][:2]}），下面那爻為重。"
    elif n == 5:
        still = [k for k in range(6) if k not in moving][0]
        focus = f"五個變爻：看之卦中沒變的那一爻「{h2['yao'][still]}」。"
    else:
        focus = "六爻全變：" + (f"乾坤看「{h1['use'][0]}」。" if h1["use"] else "看之卦卦辭。")
    detail = [f"本卦 {h1['name']}：卦辭「{h1['gua']}」；大象「{h1['xiang']}」",
              "本卦爻辭：" + "／".join(h1["yao"]) + ("／" + h1["use"][0] if h1["use"] else "")]
    if h2:
        detail.append(f"之卦 {h2['name']}：卦辭「{h2['gua']}」；大象「{h2['xiang']}」")
        detail.append("之卦爻辭：" + "／".join(h2["yao"]))
    detail.append("看法：" + focus)
    detail.append("解讀方式：先說明卦名和卦象（上下卦代表的自然現象）的意思，再用白話解釋該看的卦辭／爻辭，"
                  "最後針對對方的問題給建議；原文要引用時照上面的字，不要自己改字。")
    return card + DIVIDER + "\n".join(detail)


# ---------------------------------------------------------------- 給模型用的工具
TOOL = {
    "type": "function",
    "function": {
        "name": "divination",
        "description": (
            "占卜工具：塔羅牌、擲筊、抽籤詩（媽祖六十甲子籤）、易經卜卦。使用者要算命、占卜、抽塔羅、抽籤、擲筊、卜卦、問神明時一定要呼叫，"
            "結果由程式隨機決定，你絕對不能自己編牌、編籤號或編卦。工具結果的結果卡會自動貼給使用者看，你只要接著解讀就好，不用重抄抽到什麼。"
            "使用者沒指定方式時：問是不是／可不可以 → jiaobei；問運勢、感情、工作、心情 → tarot；說抽籤 → qian；說卜卦、易經 → iching。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["tarot", "jiaobei", "qian", "iching"], "description": "tarot 塔羅、jiaobei 擲筊、qian 抽籤詩、iching 易經卜卦"},
                "question": {"type": "string", "description": "使用者想問的事（簡短）"},
                "spread": {"type": "string", "enum": ["one", "three", "choice", "love"],
                           "description": "塔羅牌陣：one 單張指引、three 過去現在未來（預設）、choice 二選一（A、B、建議）、love 感情（你、對方、關係走向）"},
                "times": {"type": "integer", "description": "擲筊次數 1~3，預設 3"},
            },
            "required": ["kind"],
        },
    },
}


def run_tool(args: dict) -> str:
    kind = args.get("kind")
    q = str(args.get("question") or "").strip()[:80]
    if kind == "tarot":
        return tarot(args.get("spread") or "three", q)
    if kind == "jiaobei":
        return jiaobei(args.get("times") or 3, q)
    if kind == "qian":
        return qian(q)
    if kind == "iching":
        return iching(q)
    return "kind 要是 tarot、jiaobei、qian、iching 其中一個。"


def split_card(result: str) -> tuple[str, str]:
    """(給大家看的結果卡, 完整內容)"""
    card = result.split(DIVIDER, 1)[0]
    return card, result
