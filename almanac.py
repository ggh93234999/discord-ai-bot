"""擇日／黃曆：查某天或一段日子的宜、忌、黃道黑道、十二值星、沖煞，或在一段日子裡挑出適合某件事的日子。
用 lunar_python（壽星萬年曆）；資料是簡體，輸出前轉成台灣繁體。只在使用者提到吉日、黃道、擇日、宜忌、黃曆、農民曆時才放進工具清單（見 bot.py 的 ALMANAC_RE）。"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import opencc
from lunar_python import Solar

_t = opencc.OpenCC("s2tw").convert
TZ = ZoneInfo("Asia/Taipei")
WEEK = "一二三四五六日"
MAX_DAYS = 62
ZODIAC = list("鼠牛虎兔龍蛇馬羊猴雞狗豬")

# 使用者說的事 → 黃曆「宜」裡會出現的字（任一個符合就算適合）
EVENTS = {
    "結婚": ["嫁娶", "納采", "訂盟", "結婚"], "嫁娶": ["嫁娶", "納采", "訂盟"], "訂婚": ["訂盟", "納采", "嫁娶"],
    "搬家": ["移徙", "入宅", "安床"], "入宅": ["入宅", "移徙"], "安床": ["安床"],
    "開店": ["開市", "立券", "交易"], "開業": ["開市", "立券", "交易"], "開市": ["開市", "立券", "交易"], "開工": ["開市", "開光"],
    "動土": ["動土", "破土", "修造"], "裝修": ["修造", "動土", "竪柱上樑"], "上樑": ["竪柱上樑", "修造"],
    "買車": ["納財", "交易", "立券", "出行"], "交車": ["出行", "交易", "立券"], "簽約": ["立券", "交易", "訂盟"],
    "出門": ["出行"], "旅行": ["出行"], "出國": ["出行"], "求財": ["求財", "納財"],
    "祭祀": ["祭祀", "祈福"], "祈福": ["祈福", "祭祀"], "求醫": ["求醫", "治病"], "手術": ["求醫", "治病"],
    "領證": ["嫁娶", "納采", "訂盟"], "拜拜": ["祭祀", "祈福"], "剪髮": ["理髮", "沐浴"], "安葬": ["安葬", "入殮", "破土"],
}

TOOL = {
    "type": "function",
    "function": {
        "name": "almanac",
        "description": (
            "擇日／黃曆工具（農民曆）：查某天或一段日子的宜、忌、黃道或黑道日、十二值星、沖煞；"
            "或在一段日子裡挑出適合某件事（結婚、搬家、開店、動土、買車、出遠門…）的日子。"
            "使用者問吉日、黃道吉日、擇日、這天適不適合做某事、宜忌、農民曆時呼叫。日期不能自己編，一定要用工具結果。"
            "沒給日期範圍就預設從今天起 30 天。使用者說了生肖或不想沖的生肖，要帶 zodiac。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "起始日期 YYYY-MM-DD（國曆）。沒說就不要填，預設今天"},
                "end": {"type": "string", "description": "結束日期 YYYY-MM-DD，沒說就只查 start 那一天（有 event 時預設 start 起 30 天）"},
                "event": {"type": "string", "description": "想做的事，例如 結婚、搬家、開店、動土、買車、出門、簽約；只查某天宜忌時不用填"},
                "zodiac": {"type": "string", "description": "要避開沖的生肖（例如 龍），有就填"},
            },
        },
    },
}


def _parse(s, default):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except Exception:
        return default


def _info(d: date) -> dict:
    lun = Solar.fromYmd(d.year, d.month, d.day).getLunar()
    return {
        "date": d, "lunar": _t(f"{lun.getMonthInChinese()}月{lun.getDayInChinese()}"), "gz": lun.getDayInGanZhi(),
        "type": _t(lun.getDayTianShenType()), "star": _t(lun.getDayTianShen()), "zhixing": _t(lun.getZhiXing()),
        "yi": [_t(x) for x in lun.getDayYi()], "ji": [_t(x) for x in lun.getDayJi()],
        "chong": _t(lun.getDayChongShengXiao()), "sha": _t(lun.getDaySha()),
        "jishen": [_t(x) for x in lun.getDayJiShen()[:4]], "xiong": [_t(x) for x in lun.getDayXiongSha()[:4]],
    }


def _fmt(i: dict, full: bool = True) -> str:
    d = i["date"]
    head = f"{d:%Y-%m-%d}（週{WEEK[d.weekday()]}）農曆{i['lunar']}　{i['gz']}日　{i['type']}（{i['star']}）　{i['zhixing']}日　沖{i['chong']}煞{i['sha']}"
    if not full:
        return head
    return head + f"\n  宜：{'、'.join(i['yi'][:10]) or '無'}\n  忌：{'、'.join(i['ji'][:10]) or '無'}" + (
        f"\n  吉神：{'、'.join(i['jishen'])}　凶煞：{'、'.join(i['xiong'])}" if i["jishen"] or i["xiong"] else "")


def run(args: dict) -> str:
    today = datetime.now(TZ).date()
    event = str(args.get("event") or "").strip()[:20]
    zod = str(args.get("zodiac") or "").strip()[:2].replace("龙", "龍").replace("鸡", "雞")
    zod = zod[:1] if zod[:1] in ZODIAC else ""
    start = _parse(args.get("start"), today)
    end = _parse(args.get("end"), start + timedelta(days=29) if event else start)
    if end < start:
        start, end = end, start
    if (end - start).days + 1 > MAX_DAYS:
        end = start + timedelta(days=MAX_DAYS - 1)
    days = [_info(start + timedelta(days=k)) for k in range((end - start).days + 1)]

    if not event:
        if len(days) == 1:
            return _fmt(days[0])
        return "\n".join(_fmt(i, False) + f"　宜：{'、'.join(i['yi'][:5])}" for i in days)

    keys = next((v for k, v in EVENTS.items() if k in event or event in k), None) or [event]
    good, ok = [], []
    for i in days:
        if zod and i["chong"] == zod:
            continue
        hit = [k for k in keys if any(k in y for y in i["yi"])]
        bad = [k for k in keys if any(k in j for j in i["ji"])]
        if not hit or bad:
            continue
        (good if i["type"] == "黃道" else ok).append((i, hit))
    lines = [f"【{event}】{start}～{end}" + (f"，避開沖{zod}的日子" if zod else "") + f"：黃道日且宜（{'、'.join(keys)}）的有 {len(good)} 天，黑道但宜的有 {len(ok)} 天。"]
    for tag, rows in (("★ 黃道吉日", good), ("△ 黑道日但黃曆寫宜（次選）", ok)):
        if rows:
            lines.append(tag)
            lines += [_fmt(i) for i, _ in rows[:8]]
    if not good and not ok:
        lines.append("這段時間沒有符合的日子，可以放寬日期範圍再查。")
    lines.append("（黃曆只是傳統參考；實際還要看雙方八字、場地與行程，不能當作保證。）")
    return "\n".join(lines)
