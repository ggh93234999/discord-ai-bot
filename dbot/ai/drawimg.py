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
def _vgrad(size, top, bottom):
    return Image.composite(Image.new("RGB", size, bottom), Image.new("RGB", size, top), Image.linear_gradient("L").resize(size))


def _block(img, cx, cy, flat_up: bool, scale=1.0, tilt=0):
    """畫一個筊杯（半月形，邊緣有深色邊線和立體陰影）：平面朝上是淺橘紅、帶木紋；凸面朝上是深紅、有反光。tilt 是傾斜角度，讓每個看起來是隨手擲出的"""
    from PIL import ImageChops, ImageFilter
    S = 4                                                       # 先放大 4 倍畫再縮回來，邊緣才平滑
    w, h, pad = int(176 * scale), int(94 * scale), 34
    LW, LH = (w + 2 * pad) * S, (h + 2 * pad) * S
    x0, y0 = pad * S, pad * S
    mask = Image.new("L", (LW, LH), 0)
    md = ImageDraw.Draw(mask)
    md.pieslice([x0, y0 - h * S, x0 + w * S, y0 + h * S], 0, 180, fill=255)         # 下半個橢圓 = 半月形
    md.ellipse([x0 + int(w * .10) * S, y0 - int(h * .34) * S, x0 + int(w * .90) * S, y0 + int(h * .10) * S], fill=0)   # 平面那側微微內凹，像真的筊杯
    mask = mask.filter(ImageFilter.GaussianBlur(S * 1.2)).point(lambda v: 255 if v > 127 else 0).filter(ImageFilter.GaussianBlur(S * .6))   # 兩端磨圓
    top, bot = ((244, 164, 146), (214, 92, 76)) if flat_up else ((226, 78, 62), (122, 16, 12))
    body = _vgrad((LW, LH), top, bot)
    bd = ImageDraw.Draw(body)
    if flat_up:                                                 # 木紋
        for k in range(7):
            yy = y0 + int((10 + k * 11) * scale) * S
            bd.arc([x0 + int(w * .05) * S, yy - 40 * S, x0 + int(w * .95) * S, yy + 40 * S], 200, 340, fill=(200, 80, 66), width=S)
        gl = Image.new("L", (LW, LH), 0)
        ImageDraw.Draw(gl).ellipse([x0 + int(w * .18) * S, y0 + int(h * .12) * S, x0 + int(w * .62) * S, y0 + int(h * .34) * S], fill=70)
    else:                                                       # 凸面反光
        gl = Image.new("L", (LW, LH), 0)
        ImageDraw.Draw(gl).ellipse([x0 + int(w * .16) * S, y0 + int(h * .14) * S, x0 + int(w * .58) * S, y0 + int(h * .42) * S], fill=150)
    gl = gl.filter(ImageFilter.GaussianBlur(S * 7))
    body = Image.composite(Image.new("RGB", (LW, LH), (255, 240, 230)), body, gl)
    edge = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(2 * S * 2 + 1)))           # 邊線
    body = Image.composite(Image.new("RGB", (LW, LH), (70, 8, 6)), body, edge)
    layer = Image.new("RGBA", (LW, LH), (0, 0, 0, 0))
    sh = Image.new("RGBA", (LW, LH), (0, 0, 0, 0))
    sh.paste((0, 0, 0, 130), (0, 12 * S), mask.filter(ImageFilter.GaussianBlur(S * 6)))        # 投影
    layer = Image.alpha_composite(layer, sh)
    obj = body.convert("RGBA"); obj.putalpha(mask)
    layer = Image.alpha_composite(layer, obj)
    layer = layer.resize((LW // S, LH // S), Image.LANCZOS).rotate(tilt, resample=Image.BICUBIC, expand=True)
    img.paste(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2 + h * .25)), layer)


def jiaobei_img(results: list[int], question: str) -> str:
    """results：每次的結果，0 聖筊、1 笑筊、2 陰筊"""
    from PIL import ImageFilter
    names = ["聖筊", "笑筊", "陰筊"]
    cols = [("#ffd54f", "#4a3a0c", "#c9a227"), ("#9be7a8", "#10321a", "#4f9a62"), ("#b8c4cc", "#1f272c", "#6a7a85")]      # 字色、底色、邊色
    tilts = [(-16, 12), (13, -18), (-10, 17), (15, -9)]
    n = len(results)
    PW, PH, GAP = 330, 330, 22
    W = max(640, n * PW + (n + 1) * GAP + 40)
    qlines = []
    if question:
        qf = _font(24, weight="Medium")
        _d = ImageDraw.Draw(Image.new("RGB", (4, 4)))
        qlines = _wrap(_d, question, qf, W - 160)[:2]
        if len(_wrap(_d, question, qf, W - 160)) > 2:
            qlines[1] = qlines[1][:-1] + "…"
    top = 128 + 34 * len(qlines)
    H = top + PH + 118
    img, d = _paper(W, H, "#4a1010", "#170505")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))              # 上方一圈暖光，像神桌上的燭火
    ImageDraw.Draw(glow).ellipse([W // 2 - 340, -230, W // 2 + 340, 190], fill=(255, 170, 70, 70))
    img.paste(glow.filter(ImageFilter.GaussianBlur(70)), (0, 0), glow.filter(ImageFilter.GaussianBlur(70)))
    d = ImageDraw.Draw(img)
    d.rectangle([14, 14, W - 15, H - 15], outline="#b8893c", width=2)                  # 金色雙線框
    d.rectangle([22, 22, W - 23, H - 23], outline="#6d4a1f", width=1)
    _center(d, (W // 2, 74), "擲　筊", _font(46, serif=True), "#f3d98b")
    for i, ln in enumerate(qlines):
        _center(d, (W // 2, 126 + 34 * i), ln if i or len(qlines) == 1 else ln, _font(24, weight="Medium"), "#e8dcc2")
    x_start = (W - (n * PW + (n - 1) * GAP)) // 2
    for k, r in enumerate(results):
        px = x_start + k * (PW + GAP)
        d.rounded_rectangle([px, top, px + PW, top + PH], 20, fill="#260a0a", outline="#7a4a22", width=2)
        cx = px + PW // 2
        _center(d, (cx, top + 34), f"第 {k + 1} 擲", _font(22, weight="Medium"), "#d9c7a6")
        a_flat, b_flat = (True, False) if r == 0 else (True, True) if r == 1 else (False, False)
        ta, tb = tilts[k % len(tilts)]
        if r == 0:                                              # 聖筊：背後一圈金光
            g2 = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(g2).ellipse([cx - 120, top + 70, cx + 120, top + 210], fill=(255, 205, 80, 90))
            g2 = g2.filter(ImageFilter.GaussianBlur(26)); img.paste(g2, (0, 0), g2); d = ImageDraw.Draw(img)
        _block(img, cx - 82, top + 140, a_flat, 0.7, ta)
        _block(img, cx + 82, top + 140, b_flat, 0.7, tb)
        d = ImageDraw.Draw(img)
        _center(d, (cx - 82, top + 222), "平面" if a_flat else "凸面", _font(17, weight="Regular"), "#a8926f")
        _center(d, (cx + 82, top + 222), "平面" if b_flat else "凸面", _font(17, weight="Regular"), "#a8926f")
        fg, bgc, ed = cols[r]
        d.rounded_rectangle([cx - 76, top + 252, cx + 76, top + 306], 27, fill=bgc, outline=ed, width=3)
        _center(d, (cx, top + 279), names[r], _font(32), fg)
    sheng = results.count(0)
    full = n == 3 and sheng == 3
    verdict = "三聖筊，神明明確同意" if full else f"{sheng} 個聖筊"
    _center(d, (W // 2, H - 58), verdict, _font(30), "#ffd54f" if full else "#e8e0cc")
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
