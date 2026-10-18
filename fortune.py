"""八字命盤和西洋星盤（出生圖）。

- 八字：用 lunar_python（壽星萬年曆）排四柱。年柱、月柱看出生的「絕對時刻」（換成 UTC+8 給萬年曆，節氣交接才準），
  日柱、時柱看出生地的真太陽時（經度修正＋均時差）。十神、藏干、納音、五行、大運都由程式算好，模型只負責解讀。
- 星盤：用 kerykeion（Swiss Ephemeris）算行星落座、宮位、相位，並畫成中文星盤圖（svg2png.py 用 Chromium 轉成 PNG）。
run() 回傳 (文字, [圖片路徑])；文字分兩段：DIVIDER 前面是貼給大家看的命盤卡，後面只給模型看。
"""
import asyncio
import math
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import aiohttp
import opencc
from lunar_python import Lunar, Solar
from lunar_python.util import LunarUtil

BASE = Path(__file__).resolve().parent
DIVIDER = "\n=====（以下只給模型看）=====\n"
S2T = opencc.OpenCC("s2tw")
t = S2T.convert
SYS_PYTHON = os.getenv("SVG_PYTHON", "/usr/bin/python3")       # 有裝 playwright 的 Python，用來把星盤 SVG 轉成 PNG

# ---------------------------------------------------------------- 出生地
TW = "Asia/Taipei"
PLACES = {  # 常用地點（Open-Meteo 的中文地名搜尋常會找錯，例如「高雄」會找到四川）
    "台北": (25.0330, 121.5654, TW), "新北": (25.0120, 121.4657, TW), "基隆": (25.1276, 121.7392, TW), "桃園": (24.9937, 121.3010, TW),
    "新竹": (24.8138, 120.9675, TW), "苗栗": (24.5602, 120.8214, TW), "台中": (24.1477, 120.6736, TW), "彰化": (24.0518, 120.5161, TW),
    "南投": (23.9157, 120.6869, TW), "雲林": (23.7092, 120.4313, TW), "嘉義": (23.4801, 120.4491, TW), "台南": (22.9999, 120.2270, TW),
    "高雄": (22.6273, 120.3014, TW), "屏東": (22.6690, 120.4862, TW), "宜蘭": (24.7021, 121.7378, TW), "花蓮": (23.9871, 121.6015, TW),
    "台東": (22.7583, 121.1444, TW), "澎湖": (23.5711, 119.5793, TW), "金門": (24.4493, 118.3767, TW), "馬祖": (26.1505, 119.9499, TW),
    "連江": (26.1505, 119.9499, TW), "台灣": (23.6978, 120.9605, TW),
    "香港": (22.3193, 114.1694, "Asia/Hong_Kong"), "澳門": (22.1987, 113.5439, "Asia/Macau"), "北京": (39.9042, 116.4074, "Asia/Shanghai"),
    "上海": (31.2304, 121.4737, "Asia/Shanghai"), "廣州": (23.1291, 113.2644, "Asia/Shanghai"), "深圳": (22.5431, 114.0579, "Asia/Shanghai"),
    "廈門": (24.4798, 118.0894, "Asia/Shanghai"), "東京": (35.6762, 139.6503, "Asia/Tokyo"), "大阪": (34.6937, 135.5023, "Asia/Tokyo"),
    "首爾": (37.5665, 126.9780, "Asia/Seoul"), "新加坡": (1.3521, 103.8198, "Asia/Singapore"), "吉隆坡": (3.1390, 101.6869, "Asia/Kuala_Lumpur"),
    "曼谷": (13.7563, 100.5018, "Asia/Bangkok"), "紐約": (40.7128, -74.0060, "America/New_York"), "洛杉磯": (34.0522, -118.2437, "America/Los_Angeles"),
    "舊金山": (37.7749, -122.4194, "America/Los_Angeles"), "倫敦": (51.5074, -0.1278, "Europe/London"), "雪梨": (-33.8688, 151.2093, "Australia/Sydney"),
    "溫哥華": (49.2827, -123.1207, "America/Vancouver"), "多倫多": (43.6532, -79.3832, "America/Toronto"),
}


def _norm_place(name: str) -> str:
    n = name.strip().replace("臺", "台")
    n = re.sub(r"^(台灣|中華民國|中國|日本|美國)\s*", "", n) or n
    return re.sub(r"(市|縣|區|鄉|鎮)$", "", n)


async def resolve_place(session: aiohttp.ClientSession, name: str, lat=None, lon=None, tz=None):
    """回傳 (顯示名稱, 緯度, 經度, 時區)；找不到回傳 None"""
    if name:
        n = _norm_place(name)
        for k, v in PLACES.items():
            if n == k or n.startswith(k):
                return (name.strip(), *v)
    if lat is not None and lon is not None and tz:
        try:
            ZoneInfo(tz)
            return (name or f"{lat:.2f}, {lon:.2f}", float(lat), float(lon), tz)
        except Exception:
            pass
    if name:
        try:
            async with session.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": name, "count": 5, "language": "zh"},
                                   timeout=aiohttp.ClientTimeout(total=15)) as r:
                res = (await r.json()).get("results") or []
            if res:
                p = next((x for x in res if x.get("country_code") == "TW"), res[0])
                where = " ".join(x for x in (p.get("name"), p.get("admin1"), p.get("country")) if x)
                return (t(where), p["latitude"], p["longitude"], p.get("timezone") or "UTC")
        except Exception:
            pass
    return None


# ---------------------------------------------------------------- 時間
def parse_birth(date: str, time_: str | None, calendar: str, leap: bool):
    m = re.match(r"\s*(\d{3,4})\D+(\d{1,2})\D+(\d{1,2})", date or "")
    if not m:
        raise ValueError("出生日期看不懂，請用 1990-05-15 這種格式")
    y, mo, d = map(int, m.groups())
    hh = mi = None
    if time_:
        tm = re.match(r"\s*(\d{1,2})(?::|：|點|時)?(\d{1,2})?", time_)
        if tm:
            hh, mi = int(tm.group(1)), int(tm.group(2) or 0)
            if not (0 <= hh <= 23 and 0 <= mi <= 59):
                raise ValueError("出生時間看不懂，請用 14:30 這種格式")
    if calendar == "lunar":
        sol = Lunar.fromYmdHms(y, -mo if leap else mo, d, hh or 12, mi or 0, 0).getSolar()
        y, mo, d = sol.getYear(), sol.getMonth(), sol.getDay()
    datetime(y, mo, d)                                                    # 檢查日期合法
    return y, mo, d, hh, mi


def equation_of_time(dt: datetime) -> float:
    """均時差（分鐘）"""
    n = dt.timetuple().tm_yday
    b = math.radians(360 / 365 * (n - 81))
    return 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)


# ---------------------------------------------------------------- 八字
WX = {"甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土", "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水",
      "子": "水", "丑": "土", "寅": "木", "卯": "木", "辰": "土", "巳": "火", "午": "火", "未": "土", "申": "金", "酉": "金", "戌": "土", "亥": "水"}


def ten_god(day_gan: str, gan: str) -> str:
    return t(LunarUtil.SHI_SHEN.get(day_gan + gan, ""))


def bazi(y, mo, d, hh, mi, tzname, lon, gender):
    known = hh is not None
    local = datetime(y, mo, d, hh if known else 12, mi or 0, tzinfo=ZoneInfo(tzname))
    utc = local.astimezone(timezone.utc)
    cst = utc + timedelta(hours=8)                                       # 萬年曆用的北京時間（年柱、月柱、節氣、大運）
    true_solar = utc + timedelta(minutes=lon * 4 + equation_of_time(local))   # 真太陽時（日柱、時柱）
    ec_abs = Solar.fromYmdHms(cst.year, cst.month, cst.day, cst.hour, cst.minute, 0).getLunar().getEightChar()
    lun_loc = Solar.fromYmdHms(true_solar.year, true_solar.month, true_solar.day, true_solar.hour, true_solar.minute, 0).getLunar()
    ec_loc = lun_loc.getEightChar()
    pillars = [("年柱", ec_abs.getYear()), ("月柱", ec_abs.getMonth()), ("日柱", ec_loc.getDay())]
    if known:
        pillars.append(("時柱", ec_loc.getTime()))
    dg = ec_loc.getDayGan()
    rows = []
    for name, gz in pillars:
        g, z = gz[0], gz[1]
        hide = LunarUtil.ZHI_HIDE_GAN.get(z, [])
        rows.append({"name": name, "gz": gz, "god": "日主" if name == "日柱" else ten_god(dg, g), "hide": hide,
                     "hide_gods": [ten_god(dg, h) for h in hide], "nayin": t(LunarUtil.NAYIN.get(gz, ""))})
    count = {k: 0 for k in "木火土金水"}
    for r in rows:
        count[WX[r["gz"][0]]] += 1
        count[WX[r["gz"][1]]] += 1
    lun = Solar.fromYmdHms(local.year, local.month, local.day, local.hour, local.minute, 0).getLunar()
    lunar_txt = t(f"{lun.getYearInGanZhi()}年 {lun.getMonthInChinese()}月{lun.getDayInChinese()}")
    yun_txt, yun_detail = "", ""
    if gender in ("male", "female"):
        yun = ec_abs.getYun(1 if gender == "male" else 0)
        dy = [x for x in yun.getDaYun()[1:9]]
        yun_txt = f"起運：出生後約 {yun.getStartYear()} 年 {yun.getStartMonth()} 個月 {yun.getStartDay()} 天\n大運：" + "　".join(f"{x.getGanZhi()}({x.getStartAge()}歲)" for x in dy)
        yun_detail = "大運（干支／起始虛歲／起始年）：" + "、".join(f"{x.getGanZhi()} {x.getStartAge()} 歲 {x.getStartYear()} 年" for x in dy)
    # 卡片（等寬排版）
    W = lambda s, n=4: s + "　" * max(0, n - len(s))
    lines = ["　　　" + "".join(W(r["name"]) for r in rows),
             "十神　" + "".join(W(r["god"]) for r in rows),
             "天干　" + "".join(W(r["gz"][0] + WX[r["gz"][0]]) for r in rows),
             "地支　" + "".join(W(r["gz"][1] + WX[r["gz"][1]]) for r in rows),
             "藏干　" + "".join(W("".join(r["hide"])) for r in rows),
             "納音　" + "".join(W(r["nayin"]) for r in rows)]
    tdiff = (true_solar.replace(tzinfo=None) - (utc + local.utcoffset()).replace(tzinfo=None)).total_seconds() / 60
    card = ("```\n" + "\n".join(lines) + "\n```\n"
            f"日主：**{dg}{WX[dg]}**　生肖：{t(lun.getYearShengXiao())}　農曆：{lunar_txt}\n"
            f"五行數量：" + "　".join(f"{k}{v}" for k, v in count.items()) +
            ("" if known else "\n⚠️ 沒有出生時間，只排年、月、日三柱") +
            (f"\n{yun_txt}" if yun_txt else "\n（告訴我性別就能排大運）"))
    detail = ("八字：" + " ".join(r["gz"] for r in rows) + f"；日主 {dg}（{WX[dg]}）；生於{rows[1]['gz'][1]}月\n" +
              "\n".join(f"{r['name']} {r['gz']}：天干十神 {r['god']}；地支藏干 {''.join(r['hide'])}（{'、'.join(r['hide_gods'])}）；納音 {r['nayin']}" for r in rows) +
              "\n五行數量（只算天干地支本身）：" + "、".join(f"{k}{v}" for k, v in count.items()) +
              (f"\n{yun_detail}" if yun_detail else "") +
              f"\n時間：當地 {local:%Y-%m-%d %H:%M}（{tzname}），真太陽時 {true_solar:%H:%M}（差 {tdiff:+.0f} 分鐘），日柱與時柱用真太陽時；子時用早晚子時（23 點後日柱不換日）。")
    return card, detail


# ---------------------------------------------------------------- 星盤
SIGN = {"Ari": "牡羊", "Tau": "金牛", "Gem": "雙子", "Can": "巨蟹", "Leo": "獅子", "Vir": "處女", "Lib": "天秤", "Sco": "天蠍",
        "Sag": "射手", "Cap": "摩羯", "Aqu": "水瓶", "Pis": "雙魚"}
PLANET = {"sun": "太陽", "moon": "月亮", "mercury": "水星", "venus": "金星", "mars": "火星", "jupiter": "木星", "saturn": "土星",
          "uranus": "天王星", "neptune": "海王星", "pluto": "冥王星", "true_north_lunar_node": "北交點", "chiron": "凱龍星"}
PNAME = {"Sun": "太陽", "Moon": "月亮", "Mercury": "水星", "Venus": "金星", "Mars": "火星", "Jupiter": "木星", "Saturn": "土星",
         "Uranus": "天王星", "Neptune": "海王星", "Pluto": "冥王星", "Ascendant": "上升", "Medium_Coeli": "天頂"}
ASPECT = {"conjunction": "合相 0°", "opposition": "對分 180°", "trine": "三分 120°", "square": "四分 90°", "sextile": "六分 60°"}
HOUSE = {"First": 1, "Second": 2, "Third": 3, "Fourth": 4, "Fifth": 5, "Sixth": 6, "Seventh": 7, "Eighth": 8, "Ninth": 9, "Tenth": 10, "Eleventh": 11, "Twelfth": 12}


def _deg(p):
    d = int(p); m = int(round((p - d) * 60))
    if m == 60:
        d, m = d + 1, 0
    return f"{d}°{m:02d}′"


def astro(name, y, mo, d, hh, mi, place, lat, lon, tzname, out_png):
    from kerykeion import AstrologicalSubjectFactory, ChartDataFactory, ChartDrawer
    known = hh is not None
    nation = {"Asia/Taipei": "TW", "Asia/Hong_Kong": "HK", "Asia/Macau": "MO", "Asia/Shanghai": "CN", "Asia/Tokyo": "JP", "Asia/Seoul": "KR",
              "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Asia/Bangkok": "TH", "Europe/London": "GB", "Australia/Sydney": "AU"}.get(
        tzname, "US" if tzname.startswith("America/") and "Vancouver" not in tzname and "Toronto" not in tzname else "CA" if tzname.startswith("America/") else "")
    s = AstrologicalSubjectFactory.from_birth_data(name or "命主", y, mo, d, hh if known else 12, mi or 0, city=place, nation=nation or "--",
                                                   lng=lon, lat=lat, tz_str=tzname, online=False, suppress_geonames_warning=True)
    cd = ChartDataFactory.create_natal_chart_data(s)
    rows, card_rows = [], []
    for key, zh in PLANET.items():
        p = getattr(s, key, None)
        if p is None:
            continue
        house = HOUSE.get(str(p.house).split("_")[0]) if known else None
        rx = "（逆行）" if getattr(p, "retrograde", False) else ""
        rows.append(f"{zh}：{SIGN.get(p.sign, p.sign)} {_deg(p.position)}{rx}" + (f"，第 {house} 宮" if house else ""))
        if key in ("sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"):
            card_rows.append(f"{zh} {SIGN.get(p.sign, p.sign)}{(' ' + str(house) + '宮') if house else ''}{' ℞' if rx else ''}")
    asc = mc = None
    if known:
        asc, mc = s.first_house, s.tenth_house
        rows.append(f"上升：{SIGN.get(asc.sign)} {_deg(asc.position)}；天頂（MC）：{SIGN.get(mc.sign)} {_deg(mc.position)}")
        rows.append("宮首：" + "、".join(f"{i}宮{SIGN.get(h.sign)}" for i, h in enumerate([s.first_house, s.second_house, s.third_house, s.fourth_house, s.fifth_house, s.sixth_house, s.seventh_house, s.eighth_house, s.ninth_house, s.tenth_house, s.eleventh_house, s.twelfth_house], 1)))
    asp = []
    for a in cd.aspects:
        n1, n2 = PNAME.get(a.p1_name), PNAME.get(a.p2_name)
        if not n1 or not n2 or a.aspect not in ASPECT:
            continue
        if not known and ("上升" in (n1, n2) or "天頂" in (n1, n2)):
            continue
        asp.append((abs(a.orbit), f"{n1} {ASPECT[a.aspect]} {n2}（容許度 {abs(a.orbit):.1f}°）"))
    asp.sort()
    el = cd.element_distribution
    elem = f"火 {el.fire_percentage}%、土 {el.earth_percentage}%、風 {el.air_percentage}%、水 {el.water_percentage}%" if el else ""
    big3 = f"☀️ 太陽{SIGN.get(s.sun.sign)}　🌙 月亮{SIGN.get(s.moon.sign)}" + (f"　⬆️ 上升{SIGN.get(asc.sign)}" if asc else "")
    card = (f"{big3}\n" + "　".join(card_rows) + (f"\n元素：{elem}" if elem else "") +
            ("" if known else "\n⚠️ 沒有出生時間：用中午 12 點計算，宮位和上升星座不準，月亮可能差幾度"))
    detail = ("星盤（回歸黃道、普拉西度宮位）\n" + "\n".join(rows) + "\n主要相位：\n" + "\n".join(x for _, x in asp[:18]) +
              (f"\n元素分布：{elem}" if elem else ""))
    try:
        svg = S2T.convert(ChartDrawer(cd, theme="dark", chart_language="CN", custom_title=f"{name}的本命星盤" if name else "本命星盤").generate_svg_string())
        svg_path = out_png[:-4] + ".svg"
        Path(svg_path).write_text(svg, encoding="utf-8")
    except Exception:
        svg_path = None
    return card, detail, svg_path


async def svg_to_png(svg_path: str, png_path: str) -> bool:
    try:
        p = await asyncio.create_subprocess_exec(SYS_PYTHON, str(BASE / "svg2png.py"), svg_path, png_path, "1400",
                                                 stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        _, err = await asyncio.wait_for(p.communicate(), 60)
        return p.returncode == 0 and Path(png_path).exists()
    except Exception:
        return False


# ---------------------------------------------------------------- 工具
TOOL = {
    "type": "function",
    "function": {
        "name": "fortune_chart",
        "description": (
            "排八字命盤或西洋星盤（出生圖）。使用者要算八字、四柱、命盤、星盤、上升星座、看本命盤時呼叫。"
            "需要出生日期；出生時間、出生地、性別有就填（八字的大運要性別；星盤的宮位和上升要時間和地點）。"
            "資料不夠時先問使用者，不要自己亂填。命盤卡和星盤圖會由程式自動貼出，你只要接著解讀，不用重抄。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["bazi", "astro", "both"], "description": "bazi 八字、astro 星盤、both 兩個都排"},
                "date": {"type": "string", "description": "出生日期，例如 1990-05-15"},
                "time": {"type": "string", "description": "出生時間 24 小時制，例如 14:30；不知道就不要填"},
                "calendar": {"type": "string", "enum": ["solar", "lunar"], "description": "date 是國曆（solar，預設）還是農曆（lunar）"},
                "leap_month": {"type": "boolean", "description": "農曆生日是不是閏月"},
                "place": {"type": "string", "description": "出生地，例如 台北、高雄、香港、東京；預設台北"},
                "lat": {"type": "number", "description": "出生地緯度（只有你很確定、而且地點不是常見城市時才填）"},
                "lon": {"type": "number", "description": "出生地經度"},
                "timezone": {"type": "string", "description": "出生地 IANA 時區，例如 Asia/Taipei"},
                "gender": {"type": "string", "enum": ["male", "female"], "description": "性別，排大運用"},
                "name": {"type": "string", "description": "名字或暱稱（只用來當標題）"},
            },
            "required": ["kind", "date"],
        },
    },
}


async def run(session: aiohttp.ClientSession, args: dict) -> tuple[str, list[str]]:
    kind = args.get("kind") or "both"
    try:
        y, mo, d, hh, mi = parse_birth(args.get("date", ""), args.get("time"), args.get("calendar") or "solar", bool(args.get("leap_month")))
    except ValueError as e:
        return str(e), []
    place_in = (args.get("place") or "").strip() or "台北"
    pl = await resolve_place(session, place_in, args.get("lat"), args.get("lon"), args.get("timezone"))
    if not pl:
        return f"找不到出生地「{place_in}」。請換個說法（例如城市名），或提供經緯度和時區。", []
    place, lat, lon, tzname = pl
    name = (args.get("name") or "").strip()[:20]
    when = f"{y}-{mo:02d}-{d:02d}" + (f" {hh:02d}:{mi:02d}" if hh is not None else "（時間不明）")
    head = f"🧭 **{name + '的' if name else ''}{'八字命盤' if kind == 'bazi' else '星盤' if kind == 'astro' else '八字與星盤'}**｜{when}｜{place}（{lat:.2f}, {lon:.2f}，{tzname}）"
    if args.get("calendar") == "lunar":
        head += f"\n（農曆 {args.get('date')}{'（閏月）' if args.get('leap_month') else ''} 換算成國曆）"
    cards, details, files = [head], [], []
    if kind in ("bazi", "both"):
        c, dt = bazi(y, mo, d, hh, mi, tzname, lon, args.get("gender"))
        cards.append("**🀄 八字**\n" + c); details.append(dt)
    if kind in ("astro", "both"):
        out = tempfile.NamedTemporaryFile(prefix="natal_", suffix=".png", delete=False).name
        c, dt, svg = await asyncio.to_thread(astro, name, y, mo, d, hh, mi, place, lat, lon, tzname, out)
        cards.append("**✨ 星盤**\n" + c); details.append(dt)
        if svg and await svg_to_png(svg, out):
            files.append(out)
        if svg:
            try: os.unlink(svg)
            except OSError: pass
    guide = ("解讀方式：八字先講日主強弱和五行多寡、喜用方向（用「偏向」「可能」這類說法），再講十神代表的個性與六親、大運走勢；"
             "星盤先講太陽、月亮、上升（三巨頭），再挑重要的行星落座、宮位和緊密相位。語氣溫和、正面但誠實，"
             "這是娛樂和自我探索，不要做健康、壽命、災禍的斷言。")
    return "\n\n".join(cards) + DIVIDER + "\n\n".join(details) + "\n" + guide, files
