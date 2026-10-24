// 賭石：每顆原石裡面真的有東西（遊戲簡化版）。
// 隱藏資料 hid：石頭重量、場口、裡面那塊翡翠肉（位置、大小、種水、通到表面的「色根」）、裂、癬。
// 公開資料 pub：外表看得到的線索（場口外皮、松花、蟒帶、霧、癬、表面的裂、窗口），這些都由隱藏資料「有機率地」長出來，也夾雜假線索。
// 價格 = 賣家看外表估的每公斤價 × 重量（所以貴的不一定好）；價值 = 翡翠體積 × 品質 × 重量 × 裂的折損。
import { randomInt } from "node:crypto";
import { shapeParams, surfacePoint, sectionGrid, interiorAt, dot, cross, norm, dist } from "../shared/stonegeo.js";

export const TIERS = [
  { name: "沒有翡翠" }, { name: "豆種" }, { name: "糯種" }, { name: "冰糯種" }, { name: "冰種" },
  { name: "高冰種" }, { name: "糯冰陽綠" }, { name: "玻璃種滿綠" }, { name: "帝王綠" },
];
export const U = [0, 60, 140, 350, 900, 2400, 7000, 22000, 80000];          // 每公斤翡翠肉的價值（代幣）
export const OFFER_K = 0.85, MAX_CUTS = 3, CUT_FEE = 0.03, OPEN_FEE = 0.08, YIELD = 0.55;
export const MARKET_MAX = 100, RESTOCK_MS = 15000, PRICE_MIN = 30, PRICE_MAX = 4000;
export const CUT_POS = [-0.6, 0.6];

// 場口：影響外皮顏色、有翡翠的機率和品質（遊戲簡化版，特徵只是大致參考）
export const SITES = [
  { id: "hj", name: "後江", skin: "黃沙皮，沙粒細", cols: ["#b8a06a", "#a98a52"], p: 0.62, qw: [0, 14, 22, 22, 18, 12, 7, 4, 1], score: 0.45, w: 18 },
  { id: "hp", name: "老帕敢", skin: "白鹽沙皮，細緻", cols: ["#cdbf9c", "#b5a47c"], p: 0.56, qw: [0, 16, 22, 22, 17, 12, 7, 3.5, 0.5], score: 0.35, w: 16 },
  { id: "mw", name: "莫灣基", skin: "黑烏沙皮，看不透", cols: ["#3b3430", "#4a403a"], p: 0.5, qw: [0, 12, 20, 22, 20, 14, 8, 3.5, 0.5], score: 0.1, w: 14 },
  { id: "hk", name: "會卡", skin: "黃褐粗沙皮", cols: ["#9a7a4a", "#8a6a3e"], p: 0.42, qw: [0, 26, 28, 20, 14, 8, 3, 1, 0], score: 0, w: 20 },
  { id: "gk", name: "灰卡", skin: "灰色沙皮", cols: ["#7d7a72", "#6b6862"], p: 0.34, qw: [0, 34, 30, 18, 10, 5, 2, 1, 0], score: -0.2, w: 18 },
  { id: "mn", name: "木那", skin: "紅褐皮，帶鐵鏽", cols: ["#9b5e3c", "#8a4f31"], p: 0.3, qw: [0, 36, 30, 17, 10, 4, 2, 1, 0], score: -0.3, w: 14 },
];
export let PK0 = 6.4;                                                // 價格基準（每公斤），用模擬校準讓平均 價值/價格 ≈ 0.9
export const setPK0 = (v) => { PK0 = v; };
const SITE_IDS = SITES.map((x) => x.id);
// 外表特徵（價格模型用）：場口 one-hot、松花強度、蟒帶、蟒帶+松花、霧 3 種、窗口（灰／翡翠等級／裂）、癬數、裂數
export function featOf(pub) {
  const f = SITE_IDS.map((id) => (pub.site === id ? 1 : 0));
  f.push(pub.pine ? pub.pine.str : 0, pub.band ? 1 : 0, pub.band && pub.pine ? 1 : 0);
  f.push(pub.haze && pub.haze.name === "白霧" ? 1 : 0, pub.haze && pub.haze.name === "黃霧" ? 1 : 0, pub.haze && pub.haze.name === "橙黃霧" ? 1 : 0);
  f.push(pub.win && pub.win.code === 0 ? 1 : 0, pub.win && pub.win.code >= 1 && pub.win.code <= 8 ? pub.win.code : 0, pub.win && pub.win.code === 9 ? 1 : 0);
  f.push(pub.xian.length, pub.cracks.length);
  return f;
}
export let BETA = [-2.701, -2.807, -2.805, -3.076, -3.266, -3.388, 4.91, 1.241, -1.289, 0.03, 0.282, 0.486, -0.01, 0.024, -0.095, -0.013, -0.233];                       // 迴歸係數（用 bench/stfit.mjs 擬合：每公斤翡翠價值的期望值 ≈ exp(β·特徵)×100）
export const setBeta = (b) => { BETA = b; };
export const marketPerKg = (pub) => (BETA ? Math.exp(featOf(pub).reduce((a, x, i) => a + x * BETA[i], 0)) * 100 : 20);
export const MARGIN = 1.12;                   // 賣家加價
const rnd = () => Math.random();
const pickW = (w) => { let r = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1; };
const randDir = () => norm([rnd() * 2 - 1, (rnd() * 2 - 1) * 0.65, rnd() * 2 - 1]);
const jitter = (d, a) => norm([d[0] + (rnd() - 0.5) * a, d[1] + (rnd() - 0.5) * a, d[2] + (rnd() - 0.5) * a]);

// ---- 產生一顆石頭
export function genStone(id) {
  const seed = randomInt(1, 2 ** 30), site = SITES[pickW(SITES.map((s) => s.w))], P = shapeParams(seed);
  let w = Math.exp(Math.log(0.8) + rnd() * Math.log(30));                                        // 重量約 0.8～24 公斤（最後會依價格範圍微調）
  const hid = { seed, w, site: site.id, body: null, cracks: [], xian: [], cf: 1, vol: 0 };
  let tailDir = null;
  if (rnd() < site.p) {
    const q = pickW(site.qw);
    const vol = Math.max(0.025, Math.min(0.5, (0.46 - 0.04 * q) * (0.4 + 0.9 * rnd())));          // 翡翠占石頭體積的比例：低等級的比較大塊
    const ar = [0.7 + rnd() * 0.9, 0.7 + rnd() * 0.9, 0.7 + rnd() * 0.9], g = Math.cbrt(ar[0] * ar[1] * ar[2]), base = Math.cbrt(vol * P.sx * P.sy * P.sz);
    const r = ar.map((a) => (a / g) * base);
    const u = randDir(), v0 = randDir(), v = norm(cross(u, v0)), wv = norm(cross(u, v));
    const c = [(rnd() * 2 - 1) * Math.max(0, 0.75 * P.sx - Math.max(...r)), (rnd() * 2 - 1) * Math.max(0, 0.75 * P.sy - Math.max(...r)), (rnd() * 2 - 1) * Math.max(0, 0.75 * P.sz - Math.max(...r))];
    tailDir = jitter(norm([c[0] / P.sx + (rnd() - 0.5) * 1.2, c[1] / P.sy + (rnd() - 0.5) * 1.2, c[2] / P.sz + (rnd() - 0.5) * 1.2]), 0.2);
    const s = surfacePoint(P, tailDir, false).map((x) => x * 0.97);
    hid.body = { c, u, v, w: wv, r, q, s, rt: 0.05 + rnd() * 0.04, sd: seed % 997 };
    hid.vol = (r[0] * r[1] * r[2]) / (P.sx * P.sy * P.sz);
  }
  // 裂：平面，只在一個範圍內；穿過翡翠肉會折損
  for (let k = pickW([50, 30, 15, 5]); k > 0; k--) {
    const n = randDir(), d0 = (rnd() - 0.5) * 0.9, a = randDir(), cc = [n[0] * d0 + a[0] * 0.3 * rnd(), n[1] * d0 + a[1] * 0.3 * rnd(), n[2] * d0 + a[2] * 0.3 * rnd()];
    const k2 = { n, d: dot(n, cc), cc, cr: 0.35 + rnd() * 0.5 };
    hid.cracks.push(k2);
    const b = hid.body; if (b && Math.abs(dot(n, b.c) - k2.d) < 0.8 * Math.min(...b.r) && dist(b.c, cc) < k2.cr + 0.3) hid.cf *= 0.7;
  }
  hid.cf = Math.max(0.4, hid.cf);
  for (let k = pickW([55, 30, 15]); k > 0; k--) {                    // 癬：黑色一塊，靠近色根會吃掉一些
    const d = randDir(); hid.xian.push(d);
    if (tailDir && dot(d, tailDir) > 0.88) hid.cf *= 0.85;
  }
  // ---- 外表線索
  const b = hid.body, q = b ? b.q : 0, pub = { id, seed, site: site.id, siteName: site.name, skinDesc: site.skin, cols: site.cols };
  pub.pine = b && q >= 3 && rnd() < 0.5 + 0.05 * q ? { dir: tailDir, str: Math.min(1, (q - 1) / 6) } : rnd() < 0.12 ? { dir: randDir(), str: 0.3 } : null;                              // 松花
  pub.band = b && rnd() < 0.5 ? { n: norm(cross(tailDir, randDir())), w: 0.05 + rnd() * 0.04 } : rnd() < 0.28 ? { n: randDir(), w: 0.05 + rnd() * 0.04 } : null;                      // 蟒帶
  const hazeCol = q >= 7 ? "#e8b04a" : q >= 4 ? "#dcc45a" : "#dcd6c4";
  pub.haze = b && q >= 2 && rnd() < 0.5 ? { dir: tailDir, col: hazeCol, name: q >= 7 ? "橙黃霧" : q >= 4 ? "黃霧" : "白霧" } : rnd() < 0.15 ? { dir: randDir(), col: "#dcd6c4", name: "白霧" } : null;   // 霧
  pub.xian = hid.xian;
  pub.cracks = hid.cracks.map((k) => ({ n: k.n, d: k.d, cc: k.cc, cr: k.cr }));
  if (rnd() < 0.35) {                                                // 窗口：開了一小塊，看到那一點裡面的樣子
    const dir = b && rnd() < 0.5 ? jitter(tailDir, 0.35) : randDir(), p = surfacePoint(P, dir, false).map((x) => x * 0.93);
    let code = interiorAt(hid, p); if (code === 10) code = 0;
    pub.win = { dir, code };
  } else pub.win = null;
  // ---- 價格：賣家看外表（和你看到的一樣）估每公斤價，加價 12%，再加一點誤差（有人估高、有人估低，看得準就撿得到便宜）
  const noise = Math.exp((rnd() + rnd() + rnd() - 1.5) * 0.55), ppk = marketPerKg(pub) * MARGIN * noise;
  w = Math.round(Math.max(PRICE_MIN / ppk, Math.min(PRICE_MAX / ppk, w)) * 10) / 10 || 0.1;      // 重量依價格範圍調整（價值跟著重量走，不影響划不划算）
  hid.w = w; pub.w = w;
  const price = Math.max(PRICE_MIN, Math.min(PRICE_MAX, Math.round(w * ppk)));
  pub.price = price; hid.price = price;
  pub.size = Math.round(Math.min(1.8, Math.max(0.6, Math.cbrt(w / 4))) * 100) / 100;
  return { pub, hid };
}
export function descLines(pub) {
  const L = [`場口：${pub.siteName}（${pub.skinDesc}）`, `重量：${pub.w} 公斤`];
  L.push(pub.pine ? "松花：有，集中在一處" : "松花：沒看到");
  L.push(pub.band ? "蟒帶：有一圈凸起的帶子" : "蟒帶：沒有");
  L.push(pub.haze ? `霧：${pub.haze.name}` : "霧：沒有");
  L.push(pub.xian.length ? `癬：${pub.xian.length} 處黑斑` : "癬：沒有");
  L.push(pub.cracks.length ? `裂：${pub.cracks.length} 條` : "裂：沒看到");
  L.push(pub.win ? `窗口：${pub.win.code === 0 ? "一片灰，沒有翡翠" : pub.win.code === 9 ? "裂紋" : `看到${TIERS[pub.win.code].name}`}` : "窗口：沒有開窗");
  return L;
}

// ---- 價值與收購商
const mixOf = (q) => 0.343 * U[q] + 0.386 * U[Math.max(0, q - 1)] + 0.271 * U[Math.max(0, q - 2)];
export function valueOf(hid) {
  const b = hid.body; if (!b) return 0;
  return Math.round(hid.w * Math.min(0.6, hid.vol) * YIELD * mixOf(b.q) * hid.cf);
}
export const cutFee = (price) => Math.max(1, Math.round(price * CUT_FEE));
export const openFee = (price) => Math.max(1, Math.round(price * OPEN_FEE));
export function doCut(hid, axis, pos) {
  const P = shapeParams(hid.seed), s = sectionGrid(hid, P, axis, pos);
  let tot = 0, wq = 0; for (let t = 1; t <= 8; t++) { tot += s.hist[t]; wq += s.hist[t] * t; }
  return { axis, pos, grid: Buffer.from(s.grid).toString("base64"), inside: s.inside, jade: s.jade, frac: s.inside ? s.jade / s.inside : 0, avgQ: tot ? wq / tot : 0, crack: s.hist[9] > 0 };
}
// 收購商出價：沒切過，是標價的 5～6 成；切過就看切面（切到翡翠就依看到的比例和品質估，沒切到就大幅降價）
export function offerFor(st) {
  const price = st.price, cuts = st.cuts;
  if (!cuts.length) return Math.floor(price * (st.win && st.win.code >= 1 && st.win.code <= 8 ? 0.65 : 0.55));
  const hit = cuts.filter((c) => c.jade > 0);
  if (!hit.length) return Math.floor(price * Math.max(0.03, 0.4 * Math.pow(0.5, cuts.length)));
  const bestCut = hit.reduce((m, c) => (c.frac > m.frac ? c : m), hit[0]), q = Math.max(1, Math.round(bestCut.avgQ));
  const est = st.w * Math.min(0.6, 0.05 + 1.4 * bestCut.frac) * YIELD * mixOf(q);      // 切面占比 → 翡翠體積（用模擬資料迴歸）
  return Math.max(Math.floor(price * 0.12), Math.floor(est * OFFER_K));
}
// 全開：沿翡翠核心的三個方向，挑切到最多翡翠的那一面來展示
export function openSection(hid) {
  if (!hid.body) return doCut(hid, 1, 0);
  let best = null;
  for (let a = 0; a < 3; a++) { const c = doCut(hid, a, Math.max(-0.6, Math.min(0.6, hid.body.c[a]))); if (!best || c.jade > best.jade) best = c; }
  return best;
}
