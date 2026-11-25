// 水墨江湖：招牌技能的逐格特效（AI 影片做的 f_*.webp），疊在 skfx.js 原本的粒子特效上面
// 每招一個函式，跟 SKFX 收一樣的 C、f；沒有那張圖（還沒載好）就什麼都不做，原本的特效照樣播
const R = Math.random, rr = (a, b) => a + R() * (b - a), now = () => performance.now();
const Z = 30;

const at0 = (C, f) => ({ x: f.x * C.TS, y: f.y * C.TS });
// 目標位置：施放當下先記住，之後目標死掉消失也還有最後的位置（不然延遲出來的特效會找不到地方畫）
function track(C, f) { let last = (f.b && C.pos(f.b)) || (f.a && C.pos(f.a)) || { x: f.x || 0, y: f.y || 0 }; return () => { const b = f.b && C.pos(f.b); if (b) last = b; return { x: last.x * C.TS, y: last.y * C.TS }; }; }
const tgtPos = (C, f) => track(C, f)();
const casterAt = (C, f) => () => { const p = (f.a && C.pos(f.a)) || f; return { x: p.x * C.TS, y: p.y * C.TS }; };
const dirOf = (f) => ({ ang: Math.atan2(f.dy || 0, f.dx || 1), flip: (f.dx || 1) < 0 });
// 地面招每一下（跟伺服器一樣：延遲 f.t，之後每 600 毫秒）
const ticks = (f, fn) => { for (let k = 0; k < (f.ticks || 1); k++) setTimeout(() => fn(k), (f.t || 0) + k * 600); };
const inArea = (cx, cy, r) => { const a = R() * 6.28, d = Math.sqrt(R()) * r; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.55]; };
// 光束、龍：從施法者往前長出去，長度＝技能射程
function beam(C, f, name, o = {}) {
  const { ang, flip } = dirOf(f), p = at0(C, f);
  C.V.sheet({ name, x: p.x, y: p.y - Z, rot: ang, flip, anchor: "l", w: (f.len || 8) * C.TS * (o.k || 1), sy: o.sy, life: o.life || 800, glow: o.glow ?? 0.3, a: o.a });
}
// 會飛的：沿著方向飛 ms 毫秒
function fly(C, f, name, w, ms, o = {}) {
  const { ang, flip } = dirOf(f), p = at0(C, f), L = (f.len || 8) * C.TS, t0 = now() + (o.delay || 0);
  const at = () => { const q = Math.max(0, Math.min(1, (now() - t0) / ms)), e = 1 - (1 - q) * (1 - q); return { x: p.x + f.dx * L * e, y: p.y + f.dy * L * e - Z }; };
  C.V.sheet({ name, at, rot: o.mirror ? ang + Math.PI : ang, flip: o.mirror ? !flip : flip, w, life: o.life || ms + 260, glow: o.glow ?? 0.3, sy: o.sy, delay: o.delay });
}
const boom = (C, x, y, w, o = {}) => C.V.sheet({ name: "f_explode", x, y: y - w * 0.25, w, life: o.life || 700, glow: o.glow ?? 0.35, delay: o.delay, rot: o.rot || 0 });

export const SHEETFX = {
  // ---------------- 炎帝
  yanlong(C, f) { beam(C, f, "f_firedragon", { life: 950, glow: 0.35, k: 1.05 }); if (C.mine) C.shake(6); },
  baoyan(C, f) { const tp = track(C, f); setTimeout(() => { const p = tp(); boom(C, p.x, p.y, 5.5 * C.TS); if (C.mine) C.shake(8); }, 200); },
  fencheng(C, f) {
    const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 5) * C.TS;
    setTimeout(() => boom(C, cx, cy, r * 1.4, { life: 800 }), f.t || 0);
    ticks(f, () => { for (let i = 0; i < 2; i++) { const [x, y] = inArea(cx, cy, r * 0.8); C.V.sheet({ name: "f_firepillar", x, y, anchor: "b", w: 2.3 * C.TS, life: 900, glow: 0.3, delay: i * 180 }); } });
  },
  huohai(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 4) * C.TS; ticks(f, () => { const [x, y] = inArea(cx, cy, r * 0.75); C.V.sheet({ name: "f_firepillar", x, y, anchor: "b", w: 1.9 * C.TS, life: 850, glow: 0.25 }); }); },
  sanmei(C, f) { const tp = track(C, f); setTimeout(() => { const p = tp(); boom(C, p.x, p.y, 3 * C.TS, { life: 600 }); }, 200); },
  // ---------------- 劍聖、天劍、劍仙
  jianyi(C, f) { fly(C, f, "f_swordqi", 3.6 * C.TS, 380, { glow: 0.45, mirror: true }); if (C.mine) C.shake(5); },
  wuwo(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_swordarray", at, w: (f.r || 3.6) * 2.4 * C.TS, sy: 0.6, layer: "g", life: 800, glow: 0.4 }); },
  qianzhan(C, f) {
    const tgtPos = track(C, f);
    for (let i = 0; i < 4; i++) setTimeout(() => { const p = tgtPos(); C.V.sheet({ name: "f_hitspark", x: p.x + rr(-20, 20), y: p.y - Z + rr(-16, 16), w: 2.2 * C.TS, rot: R() * 6.28, life: 300, glow: 0.4, grow: 0.35 }); }, 100 + i * 120);
    setTimeout(() => { const p = tgtPos(); C.V.sheet({ name: "f_swordqi", x: p.x, y: p.y - Z, w: 3.4 * C.TS, rot: R() * 6.28, life: 500, glow: 0.4 }); }, 560);
  },
  jianzhen(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_swordarray", at, w: Math.max(5, (f.r || 7) * 0.95) * C.TS, sy: 0.6, layer: "g", life: Math.min(10, f.dur || 10) * 1000, loop: true, a: 0.75, glow: 0.3 }); },
  zhuxie(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS; C.V.sheet({ name: "f_cleave", x: cx, y: cy + 10, anchor: "b", w: 4 * C.TS, life: 750, glow: 0.4, delay: f.t || 0 }); },
  wanjian(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS; C.V.sheet({ name: "f_swordarray", x: cx, y: cy, w: (f.r || 3.2) * 2.3 * C.TS, sy: 0.6, layer: "g", life: (f.t || 0) + 600 * (f.ticks || 1) + 300, loop: true, a: 0.6, glow: 0.3 }); },
  guanghan(C, f) { fly(C, f, "f_swordqi", 2.4 * C.TS, Math.max(200, ((f.len || 10) / (f.spd || 20)) * 1000), { glow: 0.5, mirror: true }); },
  // ---------------- 刀皇、修羅
  kaitian(C, f) {
    fly(C, f, "f_swordqi", 4.8 * C.TS, 320, { glow: 0.35, mirror: true });
    const p = at0(C, f), L = (f.len || 9) * C.TS * 0.75;
    C.V.sheet({ name: "f_cleave", x: p.x + f.dx * L, y: p.y + f.dy * L + 10, anchor: "b", w: 4.5 * C.TS, life: 800, glow: 0.35, delay: 180 });
    if (C.mine) setTimeout(() => C.shake(10), 200);
  },
  duanyue(C, f) { if (f.dash) return; const cx = f.x * C.TS, cy = f.y * C.TS; C.V.sheet({ name: "f_cleave", x: cx, y: cy + 10, anchor: "b", w: 4.6 * C.TS, life: 800, glow: 0.35, delay: f.t || 0 }); },
  bati(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_barrier", at: () => { const p = at(); return { x: p.x, y: p.y + 14 }; }, anchor: "b", w: 2.6 * C.TS, life: 900, a: 0.5, glow: 0.2 }); },
  xuewu(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_bloodwhirl", at: () => { const p = at(); return { x: p.x, y: p.y - 20 }; }, w: (f.r || 2.8) * 2.6 * C.TS, life: 850, glow: 0.3 }); },
  shura(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_bloodwhirl", at: () => { const p = at(); return { x: p.x, y: p.y - 24 }; }, w: 3 * C.TS, life: 700, a: 0.8, glow: 0.3 }); },
  tulu(C, f) { setTimeout(() => { const p = at0(C, f), L = (f.len || 7) * C.TS; C.V.sheet({ name: "f_bloodwhirl", x: p.x + f.dx * L, y: p.y + f.dy * L - 20, w: 3.4 * C.TS, life: 700, glow: 0.3 }); }, 160); },
  // ---------------- 真人、通靈、天師
  shenlei(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 3.4) * C.TS; ticks(f, () => { const [x, y] = inArea(cx, cy, r * 0.7); C.V.sheet({ name: "f_thunder", x, y: y + 6, anchor: "b", w: 2.6 * C.TS, life: 600, glow: 0.5 }); if (C.mine) C.flash && C.flash("170,180,255", 0.12); }); },
  leiyu(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 4.5) * C.TS; ticks(f, () => { for (let i = 0; i < 2; i++) { const [x, y] = inArea(cx, cy, r * 0.8); C.V.sheet({ name: "f_thunder", x, y: y + 6, anchor: "b", w: 2.3 * C.TS, life: 560, glow: 0.45, delay: i * 200 }); } }); },
  wulei(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 3.4) * C.TS; ticks(f, () => { const [x, y] = inArea(cx, cy, r * 0.6); C.V.sheet({ name: "f_thunder", x, y: y + 6, anchor: "b", w: 2.2 * C.TS, life: 560, glow: 0.45 }); }); },
  jiejie(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_barrier", at: () => { const p = at(); return { x: p.x, y: p.y + 30 }; }, anchor: "b", w: (f.r || 6) * 0.75 * C.TS, life: 2000, a: 0.42, glow: 0.2, loop: true }); },
  shenjiang(C, f) { const p = at0(C, f); C.V.sheet({ name: "f_summon", x: p.x - 44, y: p.y + 10, anchor: "b", w: 3.6 * C.TS, life: 950, glow: 0.45 }); if (C.mine) C.shake(4); },
  quxie(C, f) { const at = casterAt(C, f); C.V.sheet({ name: "f_bellwave", at: () => { const p = at(); return { x: p.x, y: p.y - 40 }; }, w: (f.r || 5) * 0.95 * C.TS, life: 700, a: 0.6, glow: 0.3 }); },
  wanling(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 6) * C.TS; for (let i = 0; i < 5; i++) { const [x, y] = inArea(cx, cy, r * 0.7); C.V.sheet({ name: "f_ghostfire", x, y: y - 30, w: 2.4 * C.TS, life: 900, glow: 0.4, delay: i * 140 }); } },
  // ---------------- 九幽
  guihuo(C, f) { fly(C, f, "f_ghostfire", 2.2 * C.TS, Math.max(220, ((f.len || 9) / (f.spd || 14)) * 1000), { glow: 0.45 }); },
  zuzhou(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS; C.V.sheet({ name: "f_curse", x: cx, y: cy, w: (f.r || 3.5) * 2.2 * C.TS, sy: 0.58, layer: "g", life: 1300, glow: 0.4, delay: f.t || 0 }); },
  huangquan(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS; C.V.sheet({ name: "f_hellhands", x: cx, y: cy + 16, anchor: "b", w: (f.r || 4) * 1.45 * C.TS, life: (f.ticks || 6) * 600 + 400, loop: true, a: 0.78, glow: 0.3, delay: f.t || 0 }); },
  // ---------------- 箭神、破軍、弓手
  guanri(C, f) { beam(C, f, "f_sunbeam", { life: 650, glow: 0.5, sy: 0.7 }); if (C.mine) C.shake(5); },
  luori(C, f) {
    const tp = track(C, f), w = 5.6 * C.TS;
    C.V.sheet({ name: "f_meteor", at: () => { const p = tp(); return { x: p.x - w * 0.28, y: p.y - w * 0.2 }; }, w, life: 560, glow: 0.4 });
    setTimeout(() => { const p = tp(); boom(C, p.x, p.y, 5 * C.TS); if (C.mine) C.shake(9); }, 420);
  },
  baolie(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS; boom(C, cx, cy, (f.r || 2.8) * 2.2 * C.TS, { delay: f.t || 0 }); },
  huoyu(C, f) { const cx = f.x * C.TS, cy = f.y * C.TS, r = (f.r || 4.5) * C.TS; ticks(f, () => { const [x, y] = inArea(cx, cy, r * 0.75), w = 3 * C.TS; C.V.sheet({ name: "f_meteor", x: x - w * 0.28, y: y - w * 0.2, w, life: 520, glow: 0.35 }); setTimeout(() => boom(C, x, y, 2.2 * C.TS, { life: 520 }), 380); }); },
  liuxing(C, f) { SHEETFX.huoyu(C, f); },
  pojun(C, f) { beam(C, f, "f_sunbeam", { life: 600, glow: 0.4, sy: 1.1 }); const p = at0(C, f), L = (f.len || 12) * C.TS; setTimeout(() => boom(C, p.x + f.dx * L, p.y + f.dy * L, 4.4 * C.TS), 300); },
  chuanyun(C, f) { beam(C, f, "f_sunbeam", { life: 520, glow: 0.45, sy: 0.45 }); },
  // ---------------- 影殺、機關
  jueying(C, f) { if (f.blinkTo) return; const tp = track(C, f); setTimeout(() => { const p = tp(); C.V.sheet({ name: "f_shadowslash", x: p.x, y: p.y - Z, w: 3.6 * C.TS, life: 560, glow: 0.35 }); if (C.mine) C.shake(5); }, 120); },
  qianying(C, f) { for (let i = 0; i < 3; i++) setTimeout(() => { const p = casterAt(C, f)(), r = (f.r || 4) * C.TS; C.V.sheet({ name: "f_shadowslash", x: p.x + rr(-r, r) * 0.5, y: p.y - Z + rr(-r, r) * 0.25, w: 3 * C.TS, rot: rr(-0.5, 0.5), life: 520, glow: 0.3 }); }, i * 180); },
  paotai_shot(C, f) { if (!C.mine) return; const p = tgtPos(C, f); boom(C, p.x, p.y, 1.7 * C.TS, { life: 480, glow: 0.25 }); },
  qianji_shot(C, f) { if (!C.mine) return; const p = tgtPos(C, f); boom(C, p.x, p.y, 2.2 * C.TS, { life: 520, glow: 0.25 }); },
};
