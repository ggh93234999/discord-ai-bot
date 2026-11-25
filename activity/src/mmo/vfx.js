// 水墨江湖：特效引擎
// 粒子（AI 水墨貼圖 x_*.webp，或程式畫的墨點／光暈）、拖尾、地面殘痕、自訂動畫（actor）
// 座標都是世界像素（格 × TS）；z 是離地高度（往上為正），畫的時候 y - z
import { art } from "./art.js";
import FXM from "./art/fxanim.json";

// ---- 設定：特效品質（高／中／低）、減少別人的特效
const LS = "mmovfx";
const opt = { q: "h", others: true };
try { Object.assign(opt, JSON.parse(localStorage.getItem(LS) || "{}")); } catch {}
export const vfxOpt = () => opt;
export function setVfx(k, v) { opt[k] = v; try { localStorage.setItem(LS, JSON.stringify(opt)); } catch {} }
const CAP = { h: 900, m: 420, l: 160 }, MUL = { h: 1, m: 0.55, l: 0.25 };
// 粒子數量倍率：自己放的照品質，別人放的（開了「減少他人特效」）再打三五折
export const fxMul = (mine) => MUL[opt.q] * (!mine && opt.others ? 0.35 : 1);
const now = () => performance.now();
const R = Math.random, rr = (a, b) => a + R() * (b - a);

// ---- 貼圖：先找 AI 畫的 x_*，還沒載好（或沒有）就用程式畫的替代品
const FALL = { x_slash: "ink", x_splat: "ink", x_dry: "streak", x_bloom: "ink", x_flame: "glow:200,70,30", x_bolt: "streak:50,70,150", x_frost: "dot:150,200,235", x_mist: "glow:80,140,60",
  x_halo: "glow:214,170,60", x_sword: "streak:90,110,150", x_arrow: "streak", x_talisman: "dot:214,190,90", x_feather: "glow:210,80,40", x_taiji: "ink", x_crack: "ink", x_buddha: "glow:214,170,60", x_phoenix: "glow:210,80,40" };
const cache = {}, tints = {};
let seed = 7; const sr = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function proc(key) {
  if (cache[key]) return cache[key];
  const [kind, rgb = "22,20,15"] = key.split(":"), c = document.createElement("canvas"), g = c.getContext("2d");
  if (kind === "glow" || kind === "dot") {
    const S = kind === "glow" ? 64 : 32, h = S / 2; c.width = c.height = S;
    const gr = g.createRadialGradient(h, h, 0, h, h, h);
    if (kind === "glow") { gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.3, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`); }
    else { gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.65, `rgba(${rgb},.85)`); gr.addColorStop(1, `rgba(${rgb},0)`); }
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else if (kind === "streak") {
    c.width = 64; c.height = 10; const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(0.7, `rgba(${rgb},.8)`); gr.addColorStop(1, `rgba(${rgb},1)`);
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 5); g.lineTo(60, 1.5); g.quadraticCurveTo(64, 5, 60, 8.5); g.closePath(); g.fill();
  } else {          // 墨團：幾顆圓疊在一起，邊緣不規則
    c.width = c.height = 64; seed = 7; g.fillStyle = `rgba(${rgb},.85)`;
    for (let i = 0; i < 9; i++) { const a = sr() * 6.3, d = sr() * 14, r = 8 + sr() * 12; g.beginPath(); g.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, r, 0, 7); g.fill(); }
  }
  return (cache[key] = c);
}
// 紙紋：一小塊隨機深淺的雜點，疊在貼圖上當宣紙的纖維
let grain = null;
function grainPat(g) {
  if (!grain) {
    const c = document.createElement("canvas"); c.width = c.height = 96; const q = c.getContext("2d"), d = q.createImageData(96, 96);
    for (let i = 0; i < d.data.length; i += 4) { const v = 200 + Math.random() * 55; d.data[i] = v; d.data[i + 1] = v * 0.97; d.data[i + 2] = v * 0.9; d.data[i + 3] = 255; }
    q.putImageData(d, 0, 0); grain = c;
  }
  return g.createPattern(grain, "repeat");
}
// 貼圖調成跟場景同一個調子：飽和度降一點、蓋一層宣紙黃、加紙紋，邊緣再暈開一點點（像墨滲進紙裡）
const toned = {};
function tone(name, im) {
  let c = toned[name]; if (c) return c;
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, pad = 4;
  c = toned[name] = document.createElement("canvas"); c.width = w + pad * 2; c.height = h + pad * 2;
  const g = c.getContext("2d");
  try { g.filter = "blur(2px)"; g.globalAlpha = 0.45; g.drawImage(im, pad, pad); g.filter = "saturate(0.78) contrast(0.96)"; } catch {}
  g.globalAlpha = 1; g.drawImage(im, pad, pad); g.filter = "none";
  const mask = document.createElement("canvas"); mask.width = c.width; mask.height = c.height; mask.getContext("2d").drawImage(c, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(206,186,148,.14)"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "multiply"; g.fillStyle = grainPat(g); g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-in"; g.drawImage(mask, 0, 0);    // 紙紋只留在貼圖本身有顏色的地方
  return c;
}
// 把貼圖整張染成某個顏色（墨色刀光 → 冰藍），保留原本的透明度
function tinted(name, im, rgb) {
  const key = name + "|" + rgb; let c = tints[key];
  if (!c) {
    const base = tone(name, im);
    c = tints[key] = document.createElement("canvas"); c.width = base.width; c.height = base.height;
    const g = c.getContext("2d"); g.drawImage(base, 0, 0); g.globalCompositeOperation = "source-atop"; g.fillStyle = `rgb(${rgb})`; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "multiply"; g.fillStyle = grainPat(g); g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = "destination-in"; g.drawImage(base, 0, 0);
  }
  return c;
}
export function tex(name, rgb) {
  if (name.startsWith("x_")) { const im = art(name); if (im) return rgb ? tinted(name, im, rgb) : tone(name, im); const f = FALL[name] || "ink"; return proc(rgb && !f.includes(":") ? f + ":" + rgb : f); }
  return proc(rgb ? name + ":" + rgb : name);
}
const BL = { s: "source-over", a: "source-over", m: "multiply" };
const GLOW_A = 0.68;       // 「發光」改成淡彩之後的透明度倍率

export function createVfx(hooks = {}) {
  let P = [], T = [], D = [], A = [], last = now();
  const V = { hooks };
  setTimeout(() => { for (const n of Object.keys(FXM)) art(n); }, 4000);      // 逐格特效圖比較大：進遊戲幾秒後在背景先載好，第一次放招就看得到
  // ---- 粒子
  // o：tex, rgb, x, y, z, vx, vy, vz（每 16ms 走幾像素）, g（重力，往下）, drag, rot, vr, align（轉向速度方向）, s0→s1（寬度像素）, a0→a1, fin（淡入比例）,
  //    life（毫秒）, delay, blend（s 一般／a 發光／m 疊色）, layer（g 地面／t 上層）, sx, sy（寬高比例）, st（依速度拉長）
  V.p = (o) => {
    const cap = CAP[opt.q]; if (P.length >= cap) P.splice(0, P.length - cap + 1);
    const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, rot: 0, vr: 0, s0: 16, s1: 16, a0: 1, a1: 0, fin: 0, life: 500, blend: "s", layer: "t", ...o };
    p.t0 = now() + (o.delay || 0); P.push(p); return p;
  };
  // n 顆（會乘上品質倍率），fn(i) 回傳每顆的參數
  V.emit = (n, mine, fn) => { const k = Math.max(1, Math.round(n * fxMul(mine))); for (let i = 0; i < k; i++) V.p(fn(i, k)); };
  // ---- 拖尾：tr.add(x, y) 一直加點，舊的點 keep 毫秒內慢慢變細變淡
  V.trail = (o) => { const tr = { pts: [], w: 10, rgb: "22,20,15", a: 0.7, keep: 220, blend: "s", layer: "t", ...o, done: false }; tr.add = (x, y, z = 0) => tr.pts.push({ x, y: y - z, t: now() }); T.push(tr); return tr; };
  // ---- 地面殘痕（焦痕、裂地、墨漬）：畫在地面，慢慢淡掉
  V.decal = (o) => { if (opt.q === "l" && !o.keep) return; if (D.length > 40) D.shift(); D.push({ rot: 0, a: 0.6, life: 2500, fin: 120, w: 60, ...o, t0: now() + (o.delay || 0) }); };
  // ---- 自訂動畫：update(t, k) 每格呼叫、draw(g, t, k) 畫，k＝0→1 的進度
  V.actor = (o) => { const a = { life: 600, layer: "t", ...o, t0: now() + (o.delay || 0) }; A.push(a); return a; };
  // ---- 逐格特效（f_*.webp：AI 影片轉成的橫向 sprite sheet；fxanim.json 記格數、每格大小）
  // o：name, x, y（或 at()→{x,y} 跟著走）, w（寬，像素）, rot, flip（上下翻，朝左的招用）, life（毫秒，預設照 fps 播完）,
  //    anchor（c 中心／b 底部貼地／l 左端在 x,y：光束、龍這種從施法者往前延伸的）, a（透明度）, glow（再疊一層提亮，0～1）,
  //    loop（持續型：來回播）, layer, grow（一開始從幾成大長出來）, delay
  V.sheet = (o) => {
    const m = FXM[o.name]; if (!m || !art(o.name)) return null;
    const life = o.life || (m.f / m.fps) * 1000;
    return V.actor({ life, layer: o.layer || "t", delay: o.delay, draw: (g, t, k) => {
      const im = art(o.name); if (!im || !im.complete) return;
      const fr = o.loop ? (() => { const n = Math.floor((life * k) / 1000 * m.fps), p = 2 * m.f - 2; const q = n % p; return q < m.f ? q : p - q; })() : Math.min(m.f - 1, Math.floor(k * m.f));
      const pos = o.at ? o.at() : o; if (!pos) return;
      const gk = o.grow == null ? 0.82 : o.grow, kin = Math.min(1, k / 0.08), sc = gk + (1 - gk) * (1 - Math.pow(1 - kin, 3));
      const w = o.w * sc, h = w * m.h / m.w * (o.sy || 1);
      let a = (o.a == null ? 1 : o.a) * kin * (k > 0.78 ? Math.max(0, 1 - (k - 0.78) / 0.22) : 1);
      if (o.fade) a *= o.fade(k);
      g.save(); g.translate(pos.x, pos.y - (pos.z || 0)); if (o.rot) g.rotate(o.rot); if (o.flip) g.scale(1, -1);
      const dx = o.anchor === "l" ? 0 : -w / 2, dy = o.anchor === "b" ? -h : -h / 2;
      g.globalAlpha = Math.max(0, Math.min(1, a)); g.drawImage(im, fr * m.w, 0, m.w, m.h, dx, dy, w, h);
      if (o.glow) { g.globalCompositeOperation = "lighter"; g.globalAlpha = Math.max(0, Math.min(1, a * o.glow)); g.drawImage(im, fr * m.w, 0, m.w, m.h, dx, dy, w, h); }
      g.restore();
    } });
  };
  V.hasSheet = (n) => !!(FXM[n] && art(n));
  V.count = () => P.length;
  V.stats = () => ({ p: P.length, a: A.length, t: T.length, d: D.length });
  V.clear = () => { P = []; T = []; D = []; A = []; };

  function drawTex(g, name, rgb, x, y, w, rot, a, blend, sy = 1) {
    const im = tex(name, rgb); if (!im) return;
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, h = (w * ih / iw) * Math.abs(sy);
    g.globalAlpha = Math.max(0, Math.min(1, blend === "a" ? a * GLOW_A : a)); g.globalCompositeOperation = BL[blend] || blend;
    if (rot || sy < 0) { g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (sy < 0) g.scale(1, -1); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore(); }
    else g.drawImage(im, x - w / 2, y - h / 2, w, h);
  }
  V.drawTex = drawTex;
  V.shadow = (g, x, y, w, a = 0.22) => drawTex(g, "dot", "40,34,26", x, y, w, 0, a, "m", 0.38);
  // 每格更新（在畫地面層之前呼叫一次）
  V.update = (t) => {
    const dt = Math.min(4, (t - last) / 16.7); last = t;
    for (const p of P) {
      if (t < p.t0) continue;
      if (p.drag) { const f = Math.pow(1 - p.drag, dt); p.vx *= f; p.vy *= f; p.vz *= f; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt; p.rot += p.vr * dt;
      if (p.z < 0 && p.floor) { p.z = 0; p.vz = 0; p.vx *= 0.6; p.vy *= 0.6; }
    }
    P = P.filter((p) => t < p.t0 + p.life);
    for (const a of A) if (t >= a.t0 && a.update) a.update(t, Math.min(1, (t - a.t0) / a.life));
    A = A.filter((a) => t < a.t0 + a.life);
    D = D.filter((d) => t < d.t0 + d.life);
    T = T.filter((tr) => { tr.pts = tr.pts.filter((q) => t - q.t < tr.keep); return !tr.done || tr.pts.length; });
  };
  // 畫一層：g＝地面（人物底下），t＝上層（人物上面）
  V.draw = (g, t, layer) => {
    g.save();
    if (layer === "g") for (const d of D) {
      if (t < d.t0) continue;
      const age = t - d.t0, a = d.a * Math.min(1, age / d.fin) * (age > d.life * 0.6 ? 1 - (age - d.life * 0.6) / (d.life * 0.4) : 1);
      drawTex(g, d.tex, d.rgb, d.x, d.y, d.w, d.rot, a * 1.25, d.blend || "m", d.sy || 0.55);
    }
    for (const tr of T) {
      if (tr.layer !== layer || tr.pts.length < 2) continue;
      g.globalCompositeOperation = BL[tr.blend]; g.lineCap = "round"; g.lineJoin = "round";
      const ta = tr.blend === "a" ? tr.a * GLOW_A : tr.a;
      g.globalCompositeOperation = "source-over"; g.strokeStyle = `rgb(${tr.rgb})`;
      for (const [wk, ak] of [[2.2, 0.22], [1, 1]]) for (let i = 1; i < tr.pts.length; i++) {      // 外圈淡淡的暈、內圈實的筆劃
        const q0 = tr.pts[i - 1], q1 = tr.pts[i], f = 1 - (t - q1.t) / tr.keep; if (f <= 0) continue;
        g.globalAlpha = ta * f * ak; g.lineWidth = Math.max(0.5, tr.w * f * wk);
        g.beginPath(); g.moveTo(q0.x, q0.y); g.lineTo(q1.x, q1.y); g.stroke();
      }
    }
    for (const a of A) if (a.layer === layer && a.ys == null && t >= a.t0 && a.draw) { g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; a.draw(g, t, Math.min(1, (t - a.t0) / a.life)); }
    for (const p of P) if (p.layer === layer && !p.ys && t >= p.t0) drawP(g, p, t);
    g.restore();
  };
  function drawP(g, p, t) {
    const k = (t - p.t0) / p.life, e = 1 - (1 - k) * (1 - k);
    let a = p.a0 + (p.a1 - p.a0) * k; if (p.fin && k < p.fin) a *= k / p.fin;
    const s = p.s0 + (p.s1 - p.s0) * e;
    let rot = p.rot, sx = p.sx || 1;
    if (p.align) rot = Math.atan2(p.vy - p.vz, p.vx);
    if (p.st) sx *= 1 + Math.hypot(p.vx, p.vy, p.vz) * p.st;
    drawTex(g, p.tex, p.rgb, p.x, p.y - p.z, s * sx, rot, a, p.blend, (p.sy || 1) / sx);
  }
  // 貼著地面的特效（火舌、插在地上的劍和箭、竹刺）要跟人物一起依 y 排前後：人站在火後面就會被火擋住
  V.sorted = (t) => {
    const o = [];
    for (const p of P) if (p.ys && t >= p.t0) o.push({ y: p.y, p });
    for (const a of A) if (a.ys != null && t >= a.t0 && a.draw) o.push({ y: typeof a.ys === "function" ? a.ys() : a.ys, a });
    return o.sort((u, v) => u.y - v.y);
  };
  V.drawOne = (g, it, t) => {
    g.save();
    if (it.p) drawP(g, it.p, t); else { g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; it.a.draw(g, t, Math.min(1, (t - it.a.t0) / it.a.life)); }
    g.restore();
  };

  // ================================================================ 常用招式零件
  const EL = {
    ink: { rgb: "22,20,15", glow: null },
    fire: { rgb: "196,64,28", glow: "255,140,50", tex: "x_flame" },
    thunder: { rgb: "46,62,140", glow: "150,170,255", tex: "x_bolt" },
    ice: { rgb: "90,150,200", glow: "190,230,255", tex: "x_frost" },
    poison: { rgb: "70,120,50", glow: "150,210,90", tex: "x_mist" },
    gold: { rgb: "176,128,30", glow: "255,210,110", tex: "x_halo" },
    blood: { rgb: "150,30,26", glow: null },
  };
  V.EL = EL;
  // 命中：墨點噴濺＋依元素的火花／光；crit 再加一個墨花＋（自己打的）頓幀
  V.hit = (x, y, el = "ink", crit = false, mine = false, power = 1) => {
    const E = EL[el] || EL.ink, n = (crit ? 12 : 6) * power;
    V.emit(n, mine, () => { const a = R() * 6.28, v = rr(1.5, 4.5) * power; return { tex: "dot", rgb: E.rgb, x, y, z: rr(10, 26), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0.5, 3), g: 0.25, drag: 0.04, s0: rr(3, 7), s1: 1.5, a0: 0.9, a1: 0, life: rr(300, 560) }; });
    V.emit(crit ? 6 : 3, mine, () => { const a = R() * 6.28, v = rr(5, 9); return { tex: "streak", rgb: E.rgb, x, y, z: 18, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, align: true, drag: 0.16, s0: 26, s1: 8, sy: 0.35, a0: 0.9, a1: 0, life: 220 }; });
    if (E.glow) V.p({ tex: "glow", rgb: E.glow, x, y: y - 18, s0: crit ? 70 : 44, s1: 10, a0: 0.75, a1: 0, life: 260, blend: "a" });
    if (crit && V.hasSheet("f_hitspark") && (mine || opt.q === "h")) V.sheet({ name: "f_hitspark", x, y: y - 22, w: 92 * power, rot: R() * 6.28, life: 300, glow: 0.3, grow: 0.35 });
    if (crit) {
      V.p({ tex: "x_splat", rgb: el === "ink" ? null : E.rgb, x, y: y - 18, s0: 30, s1: 86, a0: 0.75, a1: 0, rot: R() * 6.28, life: 420 });
      if (mine && hooks.stop) hooks.stop(70);
    }
  };
  // 刀光：一筆弧（x_slash），在 (x, y) 朝 ang 方向揮出
  V.slash = (x, y, ang, w = 90, rgb = null, life = 260, o = {}) => (w *= 1.22, life *= 1.12, V.actor({ life, layer: "t", draw: (g, t, k) => {
    const e = 1 - Math.pow(1 - k, 3);
    drawTex(g, "x_slash", rgb, x + Math.cos(ang) * 10 * e, y + Math.sin(ang) * 10 * e, w * (0.75 + 0.35 * e), ang + (o.flip ? -1 : 1) * (e - 0.5) * 0.8, (1 - k) * (o.a || 0.95), o.blend || "s", o.flip ? -1 : 1);
    if (o.glow) drawTex(g, "glow", o.glow, x, y, w * 0.9, 0, (1 - k) * 0.4, "a");
  } }));
  // 衝擊波：地面一圈往外擴散的墨環
  V.ring = (x, y, r, rgb = "22,20,15", life = 450, wid = 8, mine = true) => V.actor({ life, layer: "g", draw: (g, t, k) => {
    const e = 1 - Math.pow(1 - k, 2.5);
    g.globalAlpha = (1 - k) * 0.8; g.strokeStyle = `rgb(${rgb})`; g.lineWidth = wid * (1 - k) + 1;
    g.beginPath(); g.ellipse(x, y, r * e, r * e * 0.55, 0, 0, 7); g.stroke();
  } });
  // 煙塵：地面往外散的墨霧
  V.dust = (x, y, r, n = 10, mine = true, rgb = "60,54,44") => V.emit(n, mine, () => { const a = R() * 6.28, v = rr(0.6, 1.6) * r / 60; return { tex: "x_bloom", rgb, x: x + Math.cos(a) * r * 0.3, y: y + Math.sin(a) * r * 0.15, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0.1, 0.4), drag: 0.05, s0: rr(20, 34), s1: rr(50, 80), a0: 0.35, a1: 0, rot: R() * 6.28, vr: rr(-0.02, 0.02), life: rr(600, 900), layer: "t" }; });
  return V;
}
