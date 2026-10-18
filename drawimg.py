"""占卜和命盤的圖片：塔羅牌陣（偉特塔羅牌圖，divination_data/tarot/）和八字命盤（五行配色）。用 Pillow 直接畫，不用瀏覽器。"""
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
TAROT_DIR = BASE / "divination_data" / "tarot"
NOTO = Path("/usr/share/fonts/opentype/noto")


def _font(size: int, serif=False, weight="Bold"):
    path = NOTO / f"Noto{'Serif' if serif else 'Sans'}CJK-{weight}.ttc"
    try:
        f = ImageFont.truetype(str(path), size, index=0)
        for i in range(8):                                    # 找繁體中文（TC）那一套
            g = ImageFont.truetype(str(path), size, index=i)
            if g.getname()[0].endswith("TC"):
                return g
        return f
    except OSError:
        return ImageFont.load_default()


def _tmp(prefix: str) -> str:
    return tempfile.NamedTemporaryFile(prefix=prefix, suffix=".png", delete=False).name


def _center(d: ImageDraw.ImageDraw, xy, text, font, fill):
    d.text(xy, text, font=font, fill=fill, anchor="mm")


# ---------------------------------------------------------------- 塔羅
def tarot_spread(cards: list[tuple[str, int, str, bool]], title: str) -> str:
    """cards：[(位置, 牌的編號 0~77, 牌名, 是否逆位)]"""
    cw, ch, gap, top, bottom = 260, 450, 34, 120, 110
    n = len(cards)
    W = max(560, n * cw + (n + 1) * gap)
    H = top + ch + bottom
    img = Image.new("RGB", (W, H), "#17121f")
    d = ImageDraw.Draw(img)
    for y in range(H):                                        # 深紫漸層背景
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(30 - 10 * t), int(20 - 6 * t), int(48 - 14 * t)))
    _center(d, (W // 2, 42), title, _font(30), "#f3d98b")
    x0 = (W - (n * cw + (n - 1) * gap)) // 2
    for k, (pos, idx, name, rev) in enumerate(cards):
        x = x0 + k * (cw + gap)
        card = Image.open(TAROT_DIR / f"{idx:02d}.jpg").convert("RGB").resize((cw, ch), Image.LANCZOS)
        if rev:
            card = card.rotate(180)
        d.rounded_rectangle([x - 6, top - 6, x + cw + 6, top + ch + 6], 12, fill="#d8b866")
        img.paste(card, (x, top))
        _center(d, (x + cw // 2, top - 24), pos, _font(24), "#ffffff")
        _center(d, (x + cw // 2, top + ch + 34), name, _font(26), "#f3d98b")
        _center(d, (x + cw // 2, top + ch + 72), "逆位" if rev else "正位", _font(22, weight="Medium"), "#ff8a80" if rev else "#9be7a8")
    out = _tmp("tarot_")
    img.save(out, optimize=True)
    return out


# ---------------------------------------------------------------- 八字
WX_COLOR = {"木": "#3fae5a", "火": "#e2463d", "土": "#b8863b", "金": "#d9b43c", "水": "#2f7fd8"}


def bazi_chart(title: str, sub: str, rows: list[dict], wx: dict, count: dict, day_master: str, yun: list[tuple[str, int]] | None) -> str:
    """rows：[{name, gz, god, hide, hide_gods, nayin}]；wx：干支→五行；count：五行數量；yun：[(大運干支, 起始歲數)]"""
    cols = len(rows)
    W, colw, left = 900, 170, 150
    top = 150
    H = top + 560 + (150 if yun else 30)
    img = Image.new("RGB", (W, H), "#1d1b17")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 110], fill="#2a241a")
    _center(d, (W // 2, 40), title, _font(32), "#f3d98b")
    _center(d, (W // 2, 82), sub, _font(20, weight="Regular"), "#cfc6b0")
    labels = [("十神", 50), ("天干", 120), ("地支", 120), ("藏干", 120), ("納音", 50)]
    xs = [left + (W - left - 40 - colw * cols) // 2 + i * colw for i in range(cols)]
    y = top
    lab = _font(22, weight="Medium")
    # 柱名
    for i, r in enumerate(rows):
        _center(d, (xs[i] + colw // 2, y), r["name"], _font(24), "#ffffff")
    y += 30
    for li, (lb, h) in enumerate(labels):
        _center(d, (70, y + h // 2), lb, lab, "#9c927c")
        for i, r in enumerate(rows):
            cx, cy = xs[i] + colw // 2, y + h // 2
            if lb == "十神":
                is_dm = r["god"] == "日主"
                _center(d, (cx, cy), r["god"], _font(24), "#ffd54f" if is_dm else "#e8e0cc")
            elif lb in ("天干", "地支"):
                ch = r["gz"][0] if lb == "天干" else r["gz"][1]
                col = WX_COLOR[wx[ch]]
                box = [cx - 52, cy - 52, cx + 52, cy + 52]
                d.rounded_rectangle(box, 16, fill="#2b2720", outline=col, width=4 if not (lb == "天干" and r["name"] == "日柱") else 7)
                _center(d, (cx, cy - 6), ch, _font(64, serif=True), col)
                _center(d, (cx + 34, cy + 34), wx[ch], _font(18, weight="Medium"), col)
            elif lb == "藏干":
                hs = r["hide"]
                for k, (hg, god) in enumerate(zip(hs, r["hide_gods"])):
                    yy = y + 20 + k * 34
                    d.text((cx - 40, yy), hg, font=_font(26, serif=True), fill=WX_COLOR[wx[hg]], anchor="lm")
                    d.text((cx - 8, yy), god, font=_font(18, weight="Regular"), fill="#cfc6b0", anchor="lm")
            else:
                _center(d, (cx, cy), r["nayin"], _font(20, weight="Regular"), "#cfc6b0")
        y += h + (14 if lb in ("天干", "地支") else 6)
        if li < len(labels) - 1:
            d.line([(40, y - 4), (W - 40, y - 4)], fill="#3a342a", width=1)
    # 五行條
    y += 14
    d.text((40, y + 16), f"日主 {day_master}", font=_font(24), fill="#ffd54f", anchor="lm")
    bx = 215
    for k, (e, v) in enumerate(count.items()):
        x = bx + k * 132
        d.text((x, y + 16), e, font=_font(24), fill=WX_COLOR[e], anchor="lm")
        d.rounded_rectangle([x + 30, y + 6, x + 30 + 62, y + 26], 6, fill="#2b2720")
        if v:
            d.rounded_rectangle([x + 30, y + 6, x + 30 + max(12, int(62 * v / max(count.values()))), y + 26], 6, fill=WX_COLOR[e])
        d.text((x + 100, y + 16), str(v), font=_font(20, weight="Medium"), fill="#e8e0cc", anchor="lm")
    y += 50
    if yun:
        d.text((40, y + 14), "大運", font=lab, fill="#9c927c", anchor="lm")
        bw = (W - 120 - 40) // len(yun)
        for k, (gz, age) in enumerate(yun):
            x = 120 + k * bw
            d.rounded_rectangle([x + 4, y - 6, x + bw - 4, y + 90], 10, fill="#2b2720")
            _center(d, (x + bw // 2 - 14, y + 30), gz[0], _font(30, serif=True), WX_COLOR[wx[gz[0]]])
            _center(d, (x + bw // 2 + 14, y + 30), gz[1], _font(30, serif=True), WX_COLOR[wx[gz[1]]])
            _center(d, (x + bw // 2, y + 70), f"{age} 歲", _font(18, weight="Regular"), "#cfc6b0")
    out = _tmp("bazi_")
    img.save(out, optimize=True)
    return out


def _wrap(d, text, font, width):
    """依寬度把中文斷行"""
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=font) > width:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def _paper(W, H, top="#3a0d0d", bottom="#1c0606"):
    img = Image.new("RGB", (W, H), top)
    d = ImageDraw.Draw(img)
    t0, t1 = ImageColor_get(top), ImageColor_get(bottom)
    for y in range(H):
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * k) for a, b in zip(t0, t1)))
    return img, d


def ImageColor_get(c):
    from PIL import ImageColor
    return ImageColor.getrgb(c)


# ---------------------------------------------------------------- 擲筊
def _block(img, cx, cy, flat_up: bool, scale=1.0):
    """畫一個筊杯（半月形）：平面朝上是淺色平面，凸面朝上是深紅色、有反光"""
    w, h = int(150 * scale), int(80 * scale)
    layer = Image.new("RGBA", (w + 20, h + 20), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = [10, 10 - h, 10 + w, 10 + h]                       # 下半個橢圓 = 半月形
    if flat_up:
        d.pieslice(box, 0, 180, fill="#e8574a", outline="#7a1410", width=3)
        d.pieslice([30, 10 - h + 18, w - 10, 10 + h - 18], 0, 180, fill="#f28b7e")
        d.line([(10, 10), (10 + w, 10)], fill="#7a1410", width=4)
    else:
        d.pieslice(box, 0, 180, fill="#b3221a", outline="#5c0a07", width=3)
        d.arc([40, 10 - h + 30, w - 20, 10 + h - 22], 20, 80, fill="#ff9e8f", width=6)   # 反光
    img.paste(layer, (int(cx - w / 2 - 10), int(cy - h / 2)), layer)


def jiaobei_img(results: list[int], question: str) -> str:
    """results：每次的結果，0 聖筊、1 笑筊、2 陰筊"""
    names = ["聖筊", "笑筊", "陰筊"]
    colors = ["#ffd54f", "#9be7a8", "#90a4ae"]
    n = len(results)
    W, H = max(520, 300 * n + 60), 400
    img, d = _paper(W, H)
    _center(d, (W // 2, 42), "擲筊" + (f"｜{question}" if question else ""), _font(30), "#f3d98b")
    for k, r in enumerate(results):
        cx = 30 + 300 * k + 150 + (W - 60 - 300 * n) // 2
        d.rounded_rectangle([cx - 135, 90, cx + 135, 330], 18, fill="#2a0b0b", outline="#6d2a1c", width=2)
        _center(d, (cx, 118), f"第 {k + 1} 擲", _font(22, weight="Medium"), "#d9c7a6")
        a_flat, b_flat = (True, False) if r == 0 else (True, True) if r == 1 else (False, False)
        _block(img, cx - 62, 200, a_flat, 0.75)
        _block(img, cx + 62, 200, b_flat, 0.75)
        d = ImageDraw.Draw(img)
        _center(d, (cx - 62, 262), "平" if a_flat else "凸", _font(18, weight="Regular"), "#bfa98a")
        _center(d, (cx + 62, 262), "平" if b_flat else "凸", _font(18, weight="Regular"), "#bfa98a")
        _center(d, (cx, 302), names[r], _font(32), colors[r])
    sheng = results.count(0)
    verdict = "三聖筊，神明明確同意" if n == 3 and sheng == 3 else f"{sheng} 個聖筊"
    _center(d, (W // 2, 366), verdict, _font(26), "#ffd54f" if n == 3 and sheng == 3 else "#e8e0cc")
    out = _tmp("jiao_")
    img.save(out, optimize=True)
    return out


# ---------------------------------------------------------------- 籤詩（直式籤紙）
def qian_img(n: int, gz: str, attr: str, poem: list[str], story: str, question: str) -> str:
    import re
    cols = []
    for line in poem:
        cols += [p for p in re.split(r"[，。；！？]", line) if p]
    W, H = 560, 860
    img = Image.new("RGB", (W, H), "#7a1d16")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([24, 24, W - 24, H - 24], 10, fill="#f4e2b0", outline="#b8892e", width=4)
    d.rectangle([40, 40, W - 40, H - 40], outline="#c0392b", width=2)
    _center(d, (W // 2, 86), "天上聖母　六十甲子籤", _font(30, serif=True), "#b0221a")
    _center(d, (W // 2, 140), f"第 {n} 籤　{gz}", _font(40, serif=True), "#2a1a0e")
    d.line([(70, 178), (W - 70, 178)], fill="#c0392b", width=2)
    # 直式：由右往左，每行 7 字
    fs = _font(46, serif=True)
    colw, y0 = 92, 210
    xs = [W // 2 + int(colw * (len(cols) - 1) / 2) - colw * i for i in range(len(cols))]
    for x, col in zip(xs, cols):
        for j, ch in enumerate(col):
            _center(d, (x, y0 + 30 + j * 56), ch, fs, "#1d120a")
    y = y0 + 30 + 7 * 56 + 10
    d.line([(70, y), (W - 70, y)], fill="#c0392b", width=2)
    _center(d, (W // 2, y + 34), attr, _font(22, weight="Medium"), "#7a3b16")
    if story:
        f = _font(18, weight="Regular")
        lines = _wrap(d, "典故：" + story, f, W - 140)[:4]
        for k, ln in enumerate(lines):
            d.text((70, y + 70 + k * 28), ln, font=f, fill="#5a4630")
    if question:
        _center(d, (W // 2, H - 64), f"問：{question}", _font(20, weight="Medium"), "#7a1d16")
    out = _tmp("qian_")
    img.save(out, optimize=True)
    return out


# ---------------------------------------------------------------- 易經卦象
def _hexagram(d, cx, top, lines, vals=None, w=200, gap=34, hl=None):
    """lines 由下往上（1 陽 0 陰）；vals 有的話標出變爻"""
    for k in range(6):
        y = top + (5 - k) * gap
        moving = vals is not None and vals[k] in (6, 9)
        col = "#ffcf5c" if moving else (hl or "#e8e0cc")
        if lines[k]:
            d.rounded_rectangle([cx - w // 2, y, cx + w // 2, y + 18], 4, fill=col)
        else:
            d.rounded_rectangle([cx - w // 2, y, cx - 18, y + 18], 4, fill=col)
            d.rounded_rectangle([cx + 18, y, cx + w // 2, y + 18], 4, fill=col)
        if moving:
            mark = "○" if vals[k] == 9 else "×"
            d.text((cx + w // 2 + 14, y + 9), mark, font=_font(20), fill="#ffcf5c", anchor="lm")


def iching_img(h1: dict, base: list[int], vals: list[int], h2: dict | None, rel: list[int] | None, nature: dict, question: str, focus: str) -> str:
    W = 900 if h2 else 560
    H = 760
    img, d = _paper(W, H, "#14202a", "#0b1218")
    _center(d, (W // 2, 42), "易經卜卦" + (f"｜{question}" if question else ""), _font(30), "#f3d98b")
    cols = [(h1, base, vals, "本卦")] + ([(h2, rel, None, "之卦")] if h2 else [])
    cxs = [W // 2] if not h2 else [W // 4 + 20, 3 * W // 4 - 20]
    for (h, lines, vv, label), cx in zip(cols, cxs):
        _center(d, (cx, 100), label, _font(22, weight="Medium"), "#9fb3c0")
        _center(d, (cx, 146), f"{h['name']}", _font(48, serif=True), "#ffffff")
        _center(d, (cx, 196), f"第 {h['n']} 卦　" + (f"{h['upper']}為{nature[h['upper']]}" if h['upper'] == h['lower'] else f"{nature[h['upper']]}{nature[h['lower']]}{h['name']}"), _font(20, weight="Regular"), "#cfd8dc")
        _hexagram(d, cx, 228, lines, vv)
        _center(d, (cx, 450), f"上{h['upper']}（{nature[h['upper']]}）　下{h['lower']}（{nature[h['lower']]}）", _font(18, weight="Regular"), "#9fb3c0")
    if h2:
        _center(d, (W // 2, 320), "→", _font(48), "#ffcf5c")
    f = _font(21, serif=True)
    y = 490
    for txt in [h1["gua"]] + ([h2["gua"]] if h2 else []):
        for ln in _wrap(d, txt, f, W - 100)[:3]:
            d.text((50, y), ln, font=f, fill="#e8e0cc"); y += 32
        y += 8
    fsm = _font(18, weight="Regular")
    for ln in _wrap(d, focus, fsm, W - 100)[:3]:
        d.text((50, y), ln, font=fsm, fill="#ffcf5c"); y += 28
    img = img.crop((0, 0, W, min(H, y + 30)))
    out = _tmp("iching_")
    img.save(out, optimize=True)
    return out
