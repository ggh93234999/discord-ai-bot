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
