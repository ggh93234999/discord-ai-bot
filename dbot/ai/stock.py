"""股價查詢＋走勢圖：給 bot 的 stock_quote 工具用。

- 資料：Yahoo Finance 公開的 chart／search 介面（台股、美股、ETF、指數、加密幣都有）。
- 代號：台股只給數字（2330）會自動試 .TW（上市）和 .TWO（上櫃）；給公司名稱（台積電、蘋果）就用 Yahoo 搜尋。
- 圖：用 Pillow 直接畫（K 線＋成交量＋月線），顏色用台灣習慣：紅漲綠跌。
- 圖檔路徑用 [[FILE:路徑]] 標記回傳，由 bot.py 貼到頻道。
"""
import asyncio
import datetime as dt
import logging
import re
import tempfile

import aiohttp
from PIL import Image, ImageDraw

from dbot.ai.drawimg import _font
from dbot.core import runtime

log = logging.getLogger("discord-ai-bot.stock")

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWheelBot/1.0"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{}"
SEARCH = "https://query1.finance.yahoo.com/v1/finance/search"

# 區間 → (Yahoo range, interval, 中文名)
PERIODS = {
    "1d": ("1d", "5m", "今日"),
    "5d": ("5d", "30m", "5 日"),
    "1mo": ("1mo", "1d", "1 個月"),
    "3mo": ("3mo", "1d", "3 個月"),
    "6mo": ("6mo", "1d", "6 個月"),
    "1y": ("1y", "1d", "1 年"),
    "5y": ("5y", "1wk", "5 年"),
}
# 台灣習慣：紅漲綠跌
UP, DOWN, FLAT = (239, 83, 80), (38, 166, 91), (150, 156, 165)
BG, PANEL, GRID, TXT, SUB = (30, 31, 34), (43, 45, 49), (62, 65, 71), (240, 241, 243), (155, 160, 168)


class StockError(Exception):
    pass


async def _get_json(url: str, params: dict | None = None) -> dict:
    s = runtime.client.http_session
    async with s.get(url, params=params, headers={"User-Agent": UA}, timeout=aiohttp.ClientTimeout(total=20)) as r:
        if r.status == 404:
            raise StockError("查不到")
        if r.status != 200:
            raise StockError(f"資料來源回應 {r.status}")
        return await r.json(content_type=None)


async def _chart(symbol: str, rng: str, interval: str) -> dict:
    d = await _get_json(CHART.format(symbol), {"range": rng, "interval": interval, "includePrePost": "false"})
    res = (d.get("chart") or {}).get("result")
    if not res:
        raise StockError("查不到")
    r = res[0]
    ts = r.get("timestamp") or []
    q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
    rows = []
    for i, t in enumerate(ts):
        o, h, l, c = (q.get(k, [None] * len(ts))[i] for k in ("open", "high", "low", "close"))
        v = (q.get("volume") or [None] * len(ts))[i]
        if c is None or o is None or h is None or l is None:
            continue
        rows.append((t, o, h, l, c, v or 0))
    if not rows:
        raise StockError("這個區間沒有交易資料")
    return {"meta": r.get("meta") or {}, "rows": rows}


async def resolve(query: str) -> str:
    """使用者輸入 → Yahoo 代號。"""
    q = query.strip()
    if not q:
        raise StockError("沒有給股票名稱或代號")
    if re.fullmatch(r"\d{4,6}[A-Za-z]?", q):                   # 台股代號
        for suf in (".TW", ".TWO"):
            try:
                await _chart(q.upper() + suf, "5d", "1d")
                return q.upper() + suf
            except StockError:
                continue
        raise StockError(f"找不到台股代號 {q}")
    if re.fullmatch(r"[\^A-Za-z0-9.=\-]{1,15}", q) and not re.fullmatch(r"[A-Za-z]{5,}", q):   # 像代號（AAPL、^GSPC、BTC-USD、7203.T）
        try:
            await _chart(q.upper(), "5d", "1d")
            return q.upper()
        except StockError:
            pass
    if re.search(r"[一-鿿]", q):                       # 中文名稱：別名表 → 台股上市櫃名單（Yahoo 搜尋不吃中文）
        key = _norm(q)
        if key in ALIASES:
            return ALIASES[key]
        code = await _tw_code(key)
        if code:
            return await resolve(code)
        raise StockError(f"找不到「{q}」，試試直接給代號（例如 2330、AAPL）")
    d = await _get_json(SEARCH, {"q": q, "quotesCount": 8, "newsCount": 0})
    quotes = [x for x in d.get("quotes") or [] if x.get("quoteType") in ("EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY", "CURRENCY", "FUTURE", "MUTUALFUND")]
    if not quotes:
        raise StockError(f"找不到「{q}」，試試直接給代號（例如 2330、AAPL）")
    return quotes[0]["symbol"]


def _norm(s: str) -> str:
    return re.sub(r"[\s　]|股份有限公司|有限公司|公司|股票|股價|的", "", s).replace("臺", "台").lower()


# 常見的中文說法 → Yahoo 代號（指數、加密幣、熱門美股、熱門 ETF）
ALIASES = {_norm(k): v for k, v in {
    "大盤": "^TWII", "加權指數": "^TWII", "台股大盤": "^TWII", "加權": "^TWII", "櫃買指數": "^TWOII", "櫃買": "^TWOII",
    "標普": "^GSPC", "標普500": "^GSPC", "道瓊": "^DJI", "道瓊指數": "^DJI", "那斯達克": "^IXIC", "納斯達克": "^IXIC", "那斯達克指數": "^IXIC",
    "費半": "^SOX", "費城半導體": "^SOX", "日經": "^N225", "日經指數": "^N225", "恆生": "^HSI", "恆生指數": "^HSI", "韓國綜合": "^KS11",
    "比特幣": "BTC-USD", "以太幣": "ETH-USD", "以太坊": "ETH-USD", "狗狗幣": "DOGE-USD", "索拉納": "SOL-USD", "瑞波幣": "XRP-USD",
    "美元台幣": "TWD=X", "美金": "TWD=X", "日圓台幣": "JPYTWD=X", "黃金": "GC=F", "原油": "CL=F",
    "蘋果": "AAPL", "輝達": "NVDA", "英偉達": "NVDA", "特斯拉": "TSLA", "微軟": "MSFT", "谷歌": "GOOGL", "字母": "GOOGL", "亞馬遜": "AMZN", "臉書": "META",
    "超微": "AMD", "英特爾": "INTC", "美光": "MU", "高通": "QCOM", "博通": "AVGO", "台積電adr": "TSM", "網飛": "NFLX", "迪士尼": "DIS",
    "可口可樂": "KO", "波音": "BA", "星巴克": "SBUX", "麥當勞": "MCD", "沃爾瑪": "WMT", "好市多": "COST", "甲骨文": "ORCL", "輝瑞": "PFE",
    "元大台灣50": "0050.TW", "台灣50": "0050.TW", "元大高股息": "0056.TW", "高股息": "0056.TW", "國泰永續高股息": "00878.TW", "永續高股息": "00878.TW",
    "群益台灣精選高息": "00919.TW", "復華台灣科技優息": "00929.TW",
}.items()}

_TW_NAMES: dict[str, str] = {}      # 正規化後的名稱 → 代號
_TW_ABBR: dict[str, str] = {}       # 代號 → 簡稱（台積電）
_TW_AT = 0.0
TW_LISTS = (
    ("https://openapi.twse.com.tw/v1/opendata/t187ap03_L", "公司代號", "公司簡稱", "公司名稱"),                        # 上市
    ("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O", "SecuritiesCompanyCode", "CompanyAbbreviation", "CompanyName"),   # 上櫃
)


async def _load_tw_names() -> None:
    global _TW_AT
    import time
    if _TW_NAMES and time.time() - _TW_AT < 86400:
        return
    names: dict[str, str] = {}
    abbr: dict[str, str] = {}
    for url, kc, ks, kn in TW_LISTS:
        try:
            data = await _get_json(url)
        except Exception as e:
            log.warning("台股名單載入失敗 %s：%r", url, e)
            continue
        for row in data if isinstance(data, list) else []:
            code = str(row.get(kc) or "").strip()
            if code and row.get(ks):
                abbr.setdefault(code, str(row[ks]).strip())
            for k in (ks, kn):
                nm = _norm(str(row.get(k) or ""))
                if code and nm:
                    names.setdefault(nm, code)
    if names:
        _TW_NAMES.clear()
        _TW_NAMES.update(names)
        _TW_ABBR.update(abbr)
        _TW_AT = time.time()


async def _tw_code(key: str) -> str | None:
    await _load_tw_names()
    if key in _TW_NAMES:
        return _TW_NAMES[key]
    hits = [(len(n), c) for n, c in _TW_NAMES.items() if key in n]       # 名稱包含關鍵字，取最短（最像）的
    return min(hits)[1] if hits else None


def _fmt(x: float) -> str:
    if x is None:
        return "—"
    return f"{x:,.2f}" if abs(x) < 1000 else f"{x:,.1f}" if abs(x) < 10000 else f"{x:,.0f}"


def _sign(x: float) -> str:
    return "+" if x > 0 else ""


def _color(x: float):
    return UP if x > 0 else DOWN if x < 0 else FLAT


def _ma(vals: list[float], n: int) -> list[float | None]:
    out, s = [], 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


def _times(rows, off, intraday):
    out = []
    for r in rows:
        t = dt.datetime.utcfromtimestamp(r[0] + off)
        out.append(t)
    return out


def draw_chart(symbol: str, name: str, rows: list, meta: dict, period: str, price: float, chg: float, pct: float) -> str:
    S = 2                                                       # 兩倍大小畫完再縮，邊緣才不會鋸齒
    W, H = 1200, 770
    img = Image.new("RGB", (W * S, H * S), BG)
    d = ImageDraw.Draw(img)

    def f(sz, w="Bold"):
        return _font(sz * S, weight=w)

    def X(v):
        return int(v * S)

    cur = meta.get("currency") or ""
    off = int(meta.get("gmtoffset") or 0)
    intraday = period in ("1d", "5d")
    col = _color(chg)
    # 標題
    ab = _TW_ABBR.get(symbol.split(".")[0]) if symbol.endswith((".TW", ".TWO")) else None
    tf = f(30)
    title = ab or name
    while len(title) > 1 and tf.getlength(title) > X(W - 330):
        title = title[:-2] + "…"
    d.text((X(36), X(26)), title, font=tf, fill=TXT)
    sub_t = f"{symbol}" + (f"  ·  {name}" if ab else "") + f"  ·  {PERIODS[period][2]}" + (f"  ·  {cur}" if cur else "")
    sf = f(18, "Medium")
    while len(sub_t) > 1 and sf.getlength(sub_t) > X(W - 330):
        sub_t = sub_t[:-2] + "…"
    d.text((X(36), X(70)), sub_t, font=sf, fill=SUB)
    d.text((X(W - 36), X(24)), _fmt(price), font=f(44), fill=col, anchor="ra")
    d.text((X(W - 36), X(78)), f"{_sign(chg)}{_fmt(chg)}（{_sign(pct)}{pct:.2f}%）", font=f(22), fill=col, anchor="ra")

    # 繪圖區
    L, R, T, B = 36, W - 100, 124, H - 206                     # 價格區
    VT, VB = H - 186, H - 92                                    # 成交量區
    d.rounded_rectangle([X(L - 12), X(T - 14), X(W - 24), X(VB + 40)], X(10), fill=PANEL)
    n = len(rows)
    hi = max(r[2] for r in rows)
    lo = min(r[3] for r in rows)
    pad = (hi - lo) * 0.08 or hi * 0.01
    hi, lo = hi + pad, lo - pad

    def Y(p):
        return T + (hi - p) / (hi - lo) * (B - T)

    step = (R - L) / n
    # 水平格線與價格刻度
    for k in range(5):
        p = lo + (hi - lo) * k / 4
        y = Y(p)
        d.line([(X(L), X(y)), (X(R), X(y))], fill=GRID, width=S)
        d.text((X(R + 10), X(y)), _fmt(p), font=f(16, "Medium"), fill=SUB, anchor="lm")

    # 以第一根開盤為基準的整體顏色（整段上漲＝紅）
    first_open, last_close = rows[0][1], rows[-1][4]
    mcol = _color(last_close - first_open)
    closes = [r[4] for r in rows]
    cw = max(1, step * 0.62)
    if n <= 140:                                                # K 線
        for i, (t, o, h, l, c, v) in enumerate(rows):
            x = L + step * (i + 0.5)
            k = _color(c - o) if c != o else (_color(c - rows[i - 1][4]) if i else FLAT)
            d.line([(X(x), X(Y(h))), (X(x), X(Y(l)))], fill=k, width=max(S, int(S * 1.2)))
            y1, y2 = sorted((Y(o), Y(c)))
            d.rectangle([X(x - cw / 2), X(y1), X(x + cw / 2), X(max(y2, y1 + 1))], fill=k)
    else:                                                       # 點很多（5 年週線、1 年日線）改畫面積線
        pts = [(X(L + step * (i + 0.5)), X(Y(c))) for i, c in enumerate(closes)]
        area = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(area).polygon(pts + [(pts[-1][0], X(B)), (pts[0][0], X(B))], fill=mcol + (45,))
        img.paste(area, (0, 0), area)
        d = ImageDraw.Draw(img)
        d.line(pts, fill=mcol, width=int(2.4 * S), joint="curve")
    # 均線（日線以上才畫）
    if not intraday:
        for nn, mc in ((5, (255, 202, 40)), (20, (66, 165, 245))):
            if n > nn + 2:
                m = _ma(closes, nn)
                pts = [(X(L + step * (i + 0.5)), X(Y(v))) for i, v in enumerate(m) if v is not None]
                d.line(pts, fill=mc, width=int(1.6 * S), joint="curve")
        lx = L + 8
        for nn, mc in ((5, (255, 202, 40)), (20, (66, 165, 245))):
            if n > nn + 2:
                d.text((X(lx), X(T - 2)), f"MA{nn}" if period != "5y" else f"{nn}週", font=f(15), fill=mc, anchor="la")
                lx += 70
    # 最高／最低標註
    ih = max(range(n), key=lambda i: rows[i][2])
    il = min(range(n), key=lambda i: rows[i][3])
    for i, p, up in ((ih, rows[ih][2], True), (il, rows[il][3], False)):
        x = L + step * (i + 0.5)
        y = Y(p) + (-16 if up else 16)
        anc = "mm" if L + 60 < x < R - 60 else ("lm" if x <= L + 60 else "rm")
        d.text((X(x), X(y)), _fmt(p), font=f(16), fill=TXT, anchor=anc)

    # 成交量
    vmax = max((r[5] for r in rows), default=0) or 1
    for i, (t, o, h, l, c, v) in enumerate(rows):
        x = L + step * (i + 0.5)
        k = _color(c - o) if c != o else (_color(c - rows[i - 1][4]) if i else FLAT)
        y = VB - (v / vmax) * (VB - VT)
        d.rectangle([X(x - cw / 2), X(y), X(x + cw / 2), X(VB)], fill=k)
    d.text((X(L), X(VT - 6)), "成交量", font=f(15), fill=SUB, anchor="ls")

    # 時間軸
    times = [dt.datetime.utcfromtimestamp(r[0] + off) for r in rows]
    ticks = 6
    last_lab = None
    for k in range(ticks):
        i = min(n - 1, round((n - 1) * k / (ticks - 1)))
        t = times[i]
        lab = t.strftime("%H:%M") if period == "1d" else t.strftime("%m/%d") if period in ("5d", "1mo", "3mo") else t.strftime("%Y/%m") if period in ("6mo", "1y", "5y") else t.strftime("%m/%d")
        if period == "5d":
            lab = t.strftime("%m/%d %H:%M")
        if lab == last_lab:
            continue
        last_lab = lab
        x = L + step * (i + 0.5)
        anc = "ma" if L + 40 < x < R - 40 else ("la" if x <= L + 40 else "ra")
        d.text((X(x), X(VB + 8)), lab, font=f(15, "Medium"), fill=SUB, anchor=anc)

    # 底部摘要
    tot = (last_close - first_open) / first_open * 100 if first_open else 0
    foot = f"區間 {_sign(tot)}{tot:.2f}%　最高 {_fmt(max(r[2] for r in rows))}　最低 {_fmt(min(r[3] for r in rows))}"
    d.text((X(36), X(H - 28)), foot, font=f(18, "Medium"), fill=TXT, anchor="lm")
    d.text((X(W - 36), X(H - 28)), "資料：Yahoo Finance｜紅漲綠跌", font=f(15, "Medium"), fill=SUB, anchor="rm")

    img = img.resize((W, H), Image.LANCZOS)
    out = tempfile.NamedTemporaryFile(prefix="stock_", suffix=".png", delete=False).name
    img.save(out, optimize=True)
    return out


async def run(args: dict) -> str:
    query = str(args.get("symbol") or args.get("query") or "").strip()
    period = str(args.get("period") or "3mo").lower()
    if period not in PERIODS:
        period = "3mo"
    want_chart = args.get("chart", True) is not False
    try:
        sym = await resolve(query)
        rng, interval, label = PERIODS[period]
        main, daily = await asyncio.gather(_chart(sym, rng, interval), _chart(sym, "5d", "1d"))
    except StockError as e:
        return f"查不到「{query}」：{e}"
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        log.warning("股價資料取得失敗：%r", e)
        return "股價資料來源現在連不上，晚點再試。"
    meta, rows = main["meta"], main["rows"]
    dm, drows = daily["meta"], daily["rows"]
    price = dm.get("regularMarketPrice") or drows[-1][4]
    # 前一收盤：日線倒數第二根（最後一根是最近一個交易日）
    prev = drows[-2][4] if len(drows) >= 2 else (dm.get("previousClose") or price)
    chg = price - prev
    pct = chg / prev * 100 if prev else 0
    name = meta.get("longName") or meta.get("shortName") or sym
    text_name = name
    if sym.endswith((".TW", ".TWO")):
        await _load_tw_names()
        ab = _TW_ABBR.get(sym.split(".")[0])
        text_name = f"{ab} {name}" if ab else name
    cur = meta.get("currency") or ""
    first_open, last_close = rows[0][1], rows[-1][4]
    pchg = (price - first_open) / first_open * 100 if first_open else 0
    hi52, lo52 = dm.get("fiftyTwoWeekHigh"), dm.get("fiftyTwoWeekLow")
    off = int(dm.get("gmtoffset") or 0)
    when = dt.datetime.utcfromtimestamp((dm.get("regularMarketTime") or rows[-1][0]) + off).strftime("%Y-%m-%d %H:%M")
    lines = [
        f"{text_name}（{sym}）",
        f"現價 {_fmt(price)} {cur}，較前一收盤 {_sign(chg)}{_fmt(chg)}（{_sign(pct)}{pct:.2f}%）［台灣習慣：紅漲綠跌］",
        f"前收 {_fmt(prev)}，今日最高 {_fmt(dm.get('regularMarketDayHigh'))}，最低 {_fmt(dm.get('regularMarketDayLow'))}，成交量 {int(dm.get('regularMarketVolume') or 0):,}",
        f"52 週區間 {_fmt(lo52)} ～ {_fmt(hi52)}",
        f"{label}走勢：{_fmt(first_open)} → {_fmt(price)}（{_sign(pchg)}{pchg:.2f}%），區間最高 {_fmt(max(r[2] for r in rows))}，最低 {_fmt(min(r[3] for r in rows))}",
        f"資料時間（當地）：{when}；來源：Yahoo Finance，可能有延遲，不是投資建議",
    ]
    if want_chart:
        try:
            path = await asyncio.to_thread(draw_chart, sym, name, rows, meta, period, price, chg, pct)
            lines.append("[[FILE:" + path + "]]")
        except Exception:
            log.exception("畫走勢圖失敗")
            lines.append("（走勢圖畫失敗，只有文字數據）")
    return "\n".join(lines)


def tool_status(args: dict) -> str:
    return f"📈 查股價：{args.get('symbol') or args.get('query') or ''}"[:80]


TOOL = {
    "type": "function",
    "function": {
        "name": "stock_quote",
        "description": (
            "查股票／ETF／指數／加密幣的即時股價，並畫走勢圖（K 線、成交量、均線）貼到頻道。"
            "使用者問「台積電股價」「2330 現在多少」「幫我看 NVDA 走勢」「大盤今天怎麼樣」「比特幣漲跌」時呼叫。"
            "symbol 可以是代號（台股 2330、0050；美股 AAPL、NVDA；指數 ^TWII 台灣加權、^GSPC 標普 500、^IXIC 那斯達克；加密幣 BTC-USD）或公司名稱（台積電、鴻海、蘋果）。"
            "period 是走勢圖區間：1d 今日、5d 五日、1mo 一個月、3mo 三個月（預設）、6mo、1y、5y；使用者說「今天走勢」用 1d，「最近一年」用 1y。"
            "圖由程式自動貼出，你只要用口語簡短講重點（現價、漲跌、區間趨勢），不要把數字全部重抄一遍。"
            "台灣習慣紅漲綠跌。回覆數字一律以工具結果為準，不要自己編；資料有延遲，不是投資建議，使用者問該不該買賣時，只能客觀講數據，不要給買賣建議。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "股票代號或公司名稱"},
                "period": {"type": "string", "enum": list(PERIODS), "description": "走勢圖區間，預設 3mo"},
                "chart": {"type": "boolean", "description": "是否畫走勢圖，預設 true；使用者只問價格時可設 false"},
            },
            "required": ["symbol"],
        },
    },
}
