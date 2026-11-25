// 水墨江湖：技能特效腳本（轉職 18 招）
// 每招一個函式，收到伺服器的技能事件 f 時呼叫：f.x, f.y（格）、f.dx, f.dy, f.len（方向招）、f.r, f.t（延遲毫秒）、f.ticks（地面招）、f.b（目標）
// C＝{ V（特效引擎）, TS, pos(id)→{x,y}（格，跟著實體走）, mine, shake(n), flash(rgb, a), stop(ms) }
const R = Math.random, rr = (a, b) => a + R() * (b - a), now = () => performance.now();
const Z = 30;              // 人物胸口離地高度（像素）

// 元素：技能命中時用哪種火花
export const SK_EL = { seal: "gold", cleave: "blood", guanghan: "ice", wulei: "thunder", sanmei: "fire", fenghuang: "fire", huohai: "fire", liuxing: "fire", duwu: "poison", zhenyao: "gold", chuanyun: "gold", mingwang: "gold",
  fire: "fire", dragon: "fire", inferno: "fire", thunder: "thunder", ice: "ice", poison: "poison", net: "ink" };

// 地面招的每一下：延遲 f.t 毫秒後第一下，之後每 600 毫秒一下（跟伺服器一樣）
const ticks = (f, fn) => { for (let k = 0; k < (f.ticks || 1); k++) setTimeout(() => fn(k), (f.t || 0) + k * 600); };
// 地面範圍內隨機一點（橢圓，像在地上）
const inArea = (cx, cy, r) => { const a = R() * 6.28, d = Math.sqrt(R()) * r; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.55]; };
// 跟著某個實體（死掉／不見了就停在最後的位置）
function follow(C, id, fb) { let last = fb; return () => { const p = C.pos(id); if (p) last = p; return last; }; }
// 施法者身上的光環（跟著人走，持續 ms 毫秒）
function aura(C, id, ms, draw) { const { V, TS } = C; return V.actor({ life: ms, layer: "g", draw: (g, t, k) => { const p = C.pos(id); if (p) draw(g, p.x * TS, p.y * TS, t, k); } }); }

export const SKFX = {
  // ================================================================ 劍仙
  // 御劍飛行：踩著飛劍衝過去，路上留下一道寒光和飛劍殘影
  yujian(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, ang = Math.atan2(f.dy, f.dx);
    const tr = V.trail({ w: 22, rgb: "150,185,225", a: 0.75, keep: 380, blend: "a" }), tr2 = V.trail({ w: 6, rgb: "40,60,100", a: 0.8, keep: 300 });
    let lastG = 0;
    V.actor({ life: 240, update: (t, k) => {
      const e = 1 - (1 - k) * (1 - k), x = x0 + f.dx * L * e, y = y0 + f.dy * L * e;
      tr.add(x, y, 8); tr2.add(x, y, 8);
      if (t - lastG > 28) { lastG = t; V.p({ tex: "x_sword", x, y: y - 6, rot: ang, s0: 70, s1: 60, a0: 0.55, a1: 0, life: 380, layer: "g" }); }
      if (k >= 1) tr.done = tr2.done = true;
    } });
    V.emit(14, C.mine, () => ({ tex: "glow", rgb: "170,210,255", x: x0 + f.dx * L * R(), y: y0 + f.dy * L * R() - rr(5, 30), vz: rr(0.3, 1.2), s0: rr(8, 16), s1: 2, a0: 0.8, life: rr(400, 700), blend: "a", delay: rr(0, 200) }));
    setTimeout(() => { const ex = x0 + f.dx * L, ey = y0 + f.dy * L; V.slash(ex, ey - Z, ang - 0.6, 110, "70,100,160", 260, { glow: "170,210,255" }); V.slash(ex, ey - Z, ang + 0.6, 110, "70,100,160", 300, { flip: true }); V.dust(ex, ey, 40, 6, C.mine); }, 220);
    if (C.mine) C.shake(4);
  },
  // 一劍光寒：一道冰藍月牙寒光往前飛，掉下冰屑
  guanghan(C, f) {
    const { V, TS } = C, ang = Math.atan2(f.dy, f.dx), tr = V.trail({ w: 4, rgb: "220,240,255", a: 0.9, keep: 260, blend: "a" }), this_t0 = now();
    let lastP = 0;
    const head = { x: f.x * TS, y: f.y * TS };
    V.actor({ life: (f.len / (f.spd || 20)) * 1000 + 160, update: (t, k) => {
      const ms = (f.len / (f.spd || 20)) * 1000, q = Math.min(1, (t - this_t0) / ms);
      head.x = f.x * TS + f.dx * f.len * TS * q; head.y = f.y * TS + f.dy * f.len * TS * q;
      tr.add(head.x, head.y, Z);
      if (t - lastP > 30 && q < 1) { lastP = t; V.emit(2, C.mine, () => ({ tex: "x_frost", x: head.x + rr(-14, 14), y: head.y + rr(-10, 10), z: Z, vz: rr(-0.5, 0.8), g: 0.12, vx: rr(-0.5, 0.5), rot: R() * 6.28, vr: rr(-0.1, 0.1), s0: rr(10, 18), s1: 4, a0: 0.9, life: rr(400, 650) })); }
      if (q >= 1) tr.done = true;
    }, draw: (g, t, k) => {
      const ms = (f.len / (f.spd || 20)) * 1000, q = Math.min(1, (t - this_t0) / ms), fade = t - this_t0 > ms ? 1 - (t - this_t0 - ms) / 160 : 1;
      V.shadow(g, head.x, head.y, 70, 0.18 * fade);
      V.drawTex(g, "glow", "190,230,255", head.x, head.y - Z, 120, 0, 0.5 * fade, "a");
      V.drawTex(g, "x_slash", "120,175,225", head.x, head.y - Z, 120, ang, 0.95 * fade, "s");
      V.drawTex(g, "x_slash", "235,248,255", head.x - f.dx * 6, head.y - Z - f.dy * 6, 96, ang, 0.7 * fade, "a");
    } });
    V.p({ tex: "glow", rgb: "200,235,255", x: f.x * TS, y: f.y * TS - Z, s0: 90, s1: 20, a0: 0.8, life: 260, blend: "a" });
  },
  // 萬劍歸宗：地上先亮劍陣，接著一波波飛劍從天而降插進地裡
  wanjian(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS, total = (f.t || 0) + 600 * ((f.ticks || 1) - 1) + 700;
    V.actor({ life: total, layer: "g", draw: (g, t, k) => {
      const a = Math.min(1, k * 8) * (k > 0.85 ? (1 - k) / 0.15 : 1), rot = t / 900;
      g.globalAlpha = 0.55 * a; g.strokeStyle = "rgb(70,100,150)"; g.lineWidth = 2;
      g.beginPath(); g.ellipse(cx, cy, r, r * 0.55, 0, 0, 7); g.stroke();
      g.beginPath(); g.ellipse(cx, cy, r * 0.72, r * 0.72 * 0.55, 0, 0, 7); g.stroke();
      for (let i = 0; i < 8; i++) { const q = rot + i * Math.PI / 4; g.beginPath(); g.moveTo(cx + Math.cos(q) * r * 0.72, cy + Math.sin(q) * r * 0.4); g.lineTo(cx + Math.cos(q) * r, cy + Math.sin(q) * r * 0.55); g.stroke(); }
      V.drawTex(g, "glow", "150,190,240", cx, cy, r * 1.6, 0, 0.18 * a, "a", 0.55);
    } });
    ticks(f, (k) => {
      const n = Math.round(7 * (C.mine ? 1 : 0.5));
      for (let i = 0; i < n; i++) {
        const [x, y] = i === 0 ? [cx, cy] : inArea(cx, cy, r * 0.9), d = i * 45 + rr(0, 30), h = rr(240, 320);
        V.actor({ life: 170, delay: d, draw: (g, t, q) => {
          const z = h * (1 - q * q);
          V.shadow(g, x, y, 22 + 22 * q, 0.08 + 0.22 * q);
          V.drawTex(g, "streak", "150,190,240", x, y - z - 40, 90, Math.PI / 2, 0.6 * q, "a", 1);
          V.drawTex(g, "x_sword", null, x, y - z - 34, 76, Math.PI / 2, 1, "s");
        } });
        setTimeout(() => {
          V.p({ tex: "x_sword", x, y, z: 22, rot: Math.PI / 2 + rr(-0.12, 0.12), s0: 76, s1: 76, a0: 1, a1: 0, fin: 0, life: 700, layer: "t", ys: true });
          V.p({ tex: "glow", rgb: "180,215,255", x, y: y - 6, s0: 50, s1: 10, a0: 0.8, life: 220, blend: "a" });
          V.emit(5, C.mine, () => { const a = R() * 6.28; return { tex: "dot", rgb: "60,54,44", x, y, z: 2, vx: Math.cos(a) * 2, vy: Math.sin(a) * 1, vz: rr(1, 3), g: 0.25, s0: 5, s1: 2, a0: 0.8, life: 400 }; });
          V.decal({ tex: "x_crack", x, y, w: 46, rot: R() * 6.28, a: 0.45, life: 1800 });
        }, d + 170);
      }
      if (C.mine) setTimeout(() => C.shake(k === (f.ticks || 1) - 1 ? 9 : 4), 200);
    });
  },

  // ================================================================ 霸刀
  // 刀氣斬月：一輪巨大的墨色月牙刀氣往前推，地上劃出一道刀痕
  zhanyue(C, f) {
    const { V, TS } = C, ang = Math.atan2(f.dy, f.dx), ms = (f.len / (f.spd || 12)) * 1000, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, t0 = now();
    let lastP = 0;
    V.actor({ life: ms + 200, update: (t) => {
      const q = Math.min(1, (t - t0) / ms), x = x0 + f.dx * L * q, y = y0 + f.dy * L * q;
      if (t - lastP > 35 && q < 1) { lastP = t; V.emit(2, C.mine, () => ({ tex: "x_dry", x: x - f.dx * 20 + rr(-10, 10), y: y - Z + rr(-30, 30), rot: ang, s0: rr(50, 80), s1: 30, a0: 0.5, life: 360 })); }
    }, draw: (g, t) => {
      const q = Math.min(1, (t - t0) / ms), fade = t - t0 > ms ? 1 - (t - t0 - ms) / 200 : 1, x = x0 + f.dx * L * q, y = y0 + f.dy * L * q;
      V.shadow(g, x, y, 130, 0.2 * fade);
      V.drawTex(g, "x_slash", null, x, y - Z, 200, ang, 0.9 * fade, "s", 1.25);
      V.drawTex(g, "x_slash", "150,30,26", x - f.dx * 10, y - Z - f.dy * 10, 170, ang, 0.45 * fade, "s", 1.1);
    } });
    for (let i = 1; i <= 4; i++) V.decal({ tex: "x_dry", x: x0 + f.dx * L * i / 4.5, y: y0 + f.dy * L * i / 4.5, w: L / 3.2, rot: ang, a: 0.35, life: 2000, delay: ms * i / 4.5, sy: 0.35 });
    if (C.mine) C.shake(5);
  },
  // 不動明王：身後浮現金色佛影，金光往外一圈把怪引過來；之後 8 秒身上一圈淡淡的金光
  mingwang(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS;
    V.actor({ life: 1400, layer: "g", draw: (g, t, k) => {
      const p = C.pos(f.a) || f, px = p.x * TS, py = p.y * TS, a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8, s = 1 + 0.15 * k;
      V.drawTex(g, "glow", "255,210,110", px, py - 70, 230 * s, 0, 0.35 * a, "a");
      V.drawTex(g, "x_buddha", null, px, py - 80 * s, 190 * s, 0, 0.75 * a, "m");
      V.drawTex(g, "x_halo", null, px, py - 120 * s, 150 * s, t / 3000, 0.6 * a, "s");
    } });
    V.ring(x, y, (f.r || 5) * TS, "176,128,30", 700, 10);
    V.ring(x, y, (f.r || 5) * TS * 0.6, "214,170,60", 500, 6);
    V.emit(20, C.mine, () => { const [px, py] = inArea(x, y, 50); return { tex: "glow", rgb: "255,210,110", x: px, y: py, vz: rr(0.8, 2), s0: rr(6, 12), s1: 2, a0: 0.9, life: rr(600, 1000), blend: "a", delay: rr(0, 300) }; });
    aura(C, f.a, 8000, (g, px, py, t, k) => { const a = 0.25 * (k > 0.9 ? (1 - k) / 0.1 : 1) * (0.7 + 0.3 * Math.sin(t / 200)); V.drawTex(g, "x_halo", null, px, py - 40, 70, t / 2500, a, "s"); g.globalAlpha = a; g.strokeStyle = "rgb(214,170,60)"; g.lineWidth = 2; g.beginPath(); g.ellipse(px, py + 2, 26, 9, 0, 0, 7); g.stroke(); });
    if (C.mine) { C.flash("255,230,160", 0.35); C.shake(5); }
  },
  // 霸王卸甲：掄刀狂轉四圈，每一下一圈刀光和衝擊波，最後砸出裂地
  bawang(C, f) {
    const { V, TS } = C, r = (f.r || 3.4) * TS;
    for (let h = 0; h < 4; h++) setTimeout(() => {
      const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS;
      for (let i = 0; i < 3; i++) V.slash(x + Math.cos(h * 1.7 + i * 2.1) * 30, y - 24 + Math.sin(h * 1.7 + i * 2.1) * 12, h * 1.7 + i * 2.1 + 1.57, 130, i === 1 ? "150,30,26" : null, 240, { flip: h % 2 === 1 });
      V.ring(x, y, r, "22,20,15", 360, 7);
      V.dust(x, y, r * 0.8, 5, C.mine);
      if (h === 3) { V.decal({ tex: "x_crack", x, y, w: r * 1.4, rot: R() * 6.28, a: 0.55, life: 2600 }); if (C.mine) C.shake(8); }
      else if (C.mine) C.shake(3);
    }, h * 260);
  },

  // ================================================================ 天師
  // 鎮妖符：一張黃符轉著飛過去貼在怪身上，金光一閃；貼著 3 秒
  zhenyao(C, f) {
    const { V, TS } = C, a = C.pos(f.a) || f, tb = follow(C, f.b, { x: f.x, y: f.y });
    V.actor({ life: 220, draw: (g, t, k) => {
      const b = tb(), x = (a.x + (b.x - a.x) * k) * TS, y = (a.y + (b.y - a.y) * k) * TS - Z - Math.sin(k * Math.PI) * 30;
      V.drawTex(g, "glow", "255,220,120", x, y, 50, 0, 0.6, "a"); V.drawTex(g, "x_talisman", null, x, y, 26, t / 40, 1, "s");
    } });
    setTimeout(() => {
      const b0 = tb();
      V.p({ tex: "glow", rgb: "255,220,120", x: b0.x * TS, y: b0.y * TS - Z, s0: 110, s1: 20, a0: 0.9, life: 320, blend: "a" });
      V.ring(b0.x * TS, b0.y * TS, 60, "176,128,30", 400, 5);
      V.actor({ life: 3000, draw: (g, t, k) => {
        const b = tb();
        const fl = Math.sin(t / 90) * 0.15, a2 = k > 0.85 ? (1 - k) / 0.15 : 1;
        V.drawTex(g, "glow", "255,220,120", b.x * TS, b.y * TS - Z - 10, 54, 0, (0.25 + 0.15 * Math.sin(t / 150)) * a2, "a");
        V.drawTex(g, "x_talisman", null, b.x * TS, b.y * TS - Z - 12, 24, fl, a2, "s");
      } });
    }, 220);
  },
  // 太極護體：腳下轉出一個大太極，綠色的氣往上飄
  taiji(C, f) {
    const { V, TS } = C;
    V.actor({ life: 1800, layer: "g", draw: (g, t, k) => {
      const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS, a = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1, s = 0.7 + 0.3 * Math.min(1, k * 4);
      V.drawTex(g, "glow", "120,200,160", x, y, 300 * s, 0, 0.25 * a, "a", 0.55);
      g.save(); g.translate(x, y); g.scale(1, 0.55); V.drawTex(g, "x_taiji", null, 0, 0, 200 * s, t / 500, 0.55 * a, "s"); g.restore();
    } });
    V.ring(f.x * TS, f.y * TS, (f.r || 6) * TS, "63,122,82", 800, 6);
    V.emit(26, C.mine, () => { const [px, py] = inArea(f.x * TS, f.y * TS, 90); return { tex: "glow", rgb: "140,220,170", x: px, y: py, vz: rr(0.6, 1.6), vx: rr(-0.2, 0.2), s0: rr(8, 16), s1: 3, a0: 0.85, fin: 0.2, life: rr(800, 1300), blend: "a", delay: rr(0, 500) }; });
  },
  // 五雷正法：每一下從天上劈一道雷，地面炸裂焦黑，畫面一閃
  wulei(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS;
    V.actor({ life: (f.t || 0) + 600 * ((f.ticks || 1) - 1) + 500, layer: "g", draw: (g, t, k) => { V.drawTex(g, "glow", "60,70,140", cx, cy, r * 2.2, 0, 0.2 * (1 - k), "s", 0.55); } });
    ticks(f, (k) => {
      const [x, y] = k === 0 ? [cx, cy] : inArea(cx, cy, r * 0.6);
      V.actor({ life: 260, draw: (g, t, q) => {
        const fl = q < 0.3 ? 1 : Math.random() < 0.5 ? 0.3 : 0.9, a = (1 - q) * fl;
        V.drawTex(g, "glow", "150,170,255", x, y - 140, 180, 0, 0.5 * a, "a", 2);
        V.drawTex(g, "x_bolt", null, x, y - 150, 120, 0, a, "s", 1);
        V.drawTex(g, "x_bolt", "220,230,255", x + 4, y - 150, 110, 0, 0.7 * a, "a", 1);
      } });
      V.p({ tex: "glow", rgb: "170,190,255", x, y: y - 10, s0: 160, s1: 40, a0: 0.9, life: 300, blend: "a" });
      V.ring(x, y, r * 0.9, "46,62,140", 420, 6);
      V.decal({ tex: "x_crack", rgb: "30,30,50", x, y, w: r * 0.9, rot: R() * 6.28, a: 0.42, life: 2600 });
      V.decal({ tex: "x_bloom", rgb: "40,40,60", x, y, w: r * 0.8, a: 0.16, life: 2600 });
      V.emit(14, C.mine, () => { const a = R() * 6.28, v = rr(3, 7); return { tex: "streak", rgb: "120,140,240", x, y, z: 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(1, 4), g: 0.3, align: true, s0: 20, s1: 6, sy: 0.4, a0: 1, life: 320, blend: "a" }; });
      if (C.mine) { C.flash("210,220,255", 0.55); C.shake(7); C.stop(60); }
    });
  },

  // ================================================================ 焚天
  // 三昧真火：一團火飛過去，在怪腳下燒起一根火柱
  sanmei(C, f) {
    const { V, TS } = C, a = C.pos(f.a) || f, tb = follow(C, f.b, { x: f.x, y: f.y });
    V.actor({ life: 200, draw: (g, t, k) => {
      const b = tb(), x = (a.x + (b.x - a.x) * k) * TS, y = (a.y + (b.y - a.y) * k) * TS - Z;
      V.drawTex(g, "glow", "255,140,50", x, y, 60, 0, 0.8, "a"); V.drawTex(g, "x_flame", null, x, y, 30, Math.atan2(b.y - a.y, b.x - a.x) - 1.57, 1, "s");
    } });
    setTimeout(() => {
      let last = 0;
      V.actor({ life: 1000, update: (t, k) => {
        const b = tb(); if (t - last < 30) return; last = t;
        V.emit(3, C.mine, () => ({ tex: "x_flame", ys: true, x: b.x * TS + rr(-14, 14), y: b.y * TS + rr(-4, 4), z: rr(0, 10), vz: rr(1.5, 3), vx: rr(-0.3, 0.3), s0: rr(26, 40), s1: 10, a0: 0.95, fin: 0.15, life: rr(380, 600) }));
        if (k < 0.7) V.p({ tex: "glow", rgb: "255,130,40", x: b.x * TS, y: b.y * TS - 40, s0: 90, s1: 60, a0: 0.25, life: 120, blend: "a" });
      } });
      const b0 = tb();
      V.decal({ tex: "x_bloom", rgb: "60,30,20", x: b0.x * TS, y: b0.y * TS, w: 70, a: 0.4, life: 2400 });
      if (C.mine) C.shake(4);
    }, 200);
  },
  // 鳳凰涅槃：一隻火鳳凰往前飛，一路掉下火羽
  fenghuang(C, f) {
    const { V, TS } = C, ms = (f.len / (f.spd || 12)) * 1000, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, t0 = now(), flip = f.dx < 0;
    const tr = V.trail({ w: 26, rgb: "255,140,50", a: 0.45, keep: 400, blend: "a" });
    let last = 0;
    V.actor({ life: ms + 250, update: (t) => {
      const q = Math.min(1, (t - t0) / ms), x = x0 + f.dx * L * q, y = y0 + f.dy * L * q;
      if (q < 1) tr.add(x, y, Z + 10); else tr.done = true;
      if (t - last > 40 && q < 1) { last = t; V.emit(2, C.mine, () => ({ tex: R() < 0.5 ? "x_feather" : "x_flame", x: x - f.dx * 30 + rr(-20, 20), y: y + rr(-10, 10), z: Z + rr(0, 30), vz: rr(-0.5, 0.5), g: 0.05, vx: rr(-0.6, 0.6), rot: R() * 6.28, vr: rr(-0.05, 0.05), s0: rr(18, 28), s1: 8, a0: 0.9, life: rr(500, 800) })); }
    }, draw: (g, t) => {
      const q = Math.min(1, (t - t0) / ms), fade = t - t0 > ms ? 1 - (t - t0 - ms) / 250 : 1, x = x0 + f.dx * L * q, y = y0 + f.dy * L * q - Z - 10 + Math.sin(t / 70) * 4;
      const ang = Math.atan2(f.dy, Math.abs(f.dx)) * (flip ? -1 : 1);
      V.shadow(g, x, y + Z + 10, 120, 0.2 * fade);
      V.drawTex(g, "glow", "255,150,60", x, y, 200, 0, 0.45 * fade, "a");
      g.save(); g.translate(x, y); if (flip) g.scale(-1, 1); V.drawTex(g, "x_phoenix", null, 0, 0, 150, ang, fade, "s"); g.restore();
    } });
    setTimeout(() => { const ex = x0 + f.dx * L, ey = y0 + f.dy * L; V.emit(16, C.mine, () => { const a = R() * 6.28, v = rr(2, 5); return { tex: "x_feather", x: ex, y: ey, z: Z, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0, 3), g: 0.1, drag: 0.05, rot: a, vr: rr(-0.08, 0.08), s0: 26, s1: 10, a0: 0.9, life: rr(600, 900) }; }); V.p({ tex: "glow", rgb: "255,150,60", x: ex, y: ey - Z, s0: 180, s1: 30, a0: 0.8, life: 350, blend: "a" }); }, ms);
  },
  // 焚天火海：地上整片燒起來，到處竄火舌，留下焦痕
  huohai(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS, d = f.t || 0, dur = 600 * ((f.ticks || 1) - 1) + 700;
    V.actor({ life: d + dur, layer: "g", draw: (g, t, k) => {
      const age = k * (d + dur);
      if (age < d) { const q = age / d; g.globalAlpha = 0.25 + 0.3 * q; g.strokeStyle = "rgb(181,52,42)"; g.lineWidth = 2; g.beginPath(); g.ellipse(cx, cy, r * q, r * q * 0.55, 0, 0, 7); g.stroke(); return; }
      const a = Math.min(1, (age - d) / 200) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      V.drawTex(g, "glow", "220,80,30", cx, cy, r * 2.3, 0, (0.3 + 0.08 * Math.sin(t / 90)) * a, "s", 0.55);
      V.drawTex(g, "glow", "255,160,60", cx, cy, r * 1.6, 0, 0.3 * a, "a", 0.55);
    } });
    setTimeout(() => {
      V.decal({ tex: "x_bloom", rgb: "110,60,36", x: cx, y: cy, w: r * 2.1, a: 0.3, life: dur + 2500 });
      let last = 0;
      V.actor({ life: dur, update: (t) => {
        if (t - last < 25) return; last = t;
        V.emit(4, C.mine, () => { const [x, y] = inArea(cx, cy, r * 0.95); return { tex: "x_flame", ys: true, x, y, z: 0, vz: rr(1.2, 2.6), vx: rr(-0.3, 0.3), s0: rr(24, 44), s1: 10, a0: 0.95, fin: 0.2, life: rr(420, 700) }; });
        if (R() < 0.3) V.emit(1, C.mine, () => { const [x, y] = inArea(cx, cy, r); return { tex: "dot", rgb: "255,170,60", x, y, z: 10, vz: rr(2, 4), vx: rr(-1, 1), g: 0.05, s0: 4, s1: 1, a0: 1, life: 800, blend: "a" }; });
      } });
      if (C.mine) { C.shake(6); C.flash("255,200,150", 0.25); }
    }, d);
  },

  // ================================================================ 神射
  // 穿雲神箭：拉滿弓一箭射出，箭後一道金光，一路震出氣環
  chuanyun(C, f) {
    const { V, TS } = C, ang = Math.atan2(f.dy, f.dx), ms = (f.len / (f.spd || 24)) * 1000, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, t0 = now();
    const tr = V.trail({ w: 10, rgb: "255,220,140", a: 0.9, keep: 300, blend: "a" }), tr2 = V.trail({ w: 3, rgb: "22,20,15", a: 0.8, keep: 200 });
    let lastR = 0;
    V.actor({ life: ms + 100, update: (t) => {
      const q = Math.min(1, (t - t0) / ms), x = x0 + f.dx * L * q, y = y0 + f.dy * L * q;
      if (q < 1) { tr.add(x, y, Z); tr2.add(x, y, Z); } else tr.done = tr2.done = true;
      if (q - lastR > 0.18 && q < 1) { lastR = q; V.actor({ life: 300, draw: (g, tt, k) => { g.globalAlpha = 0.6 * (1 - k); g.strokeStyle = "rgb(176,128,30)"; g.lineWidth = 3 * (1 - k) + 1; g.save(); g.translate(x, y - Z); g.rotate(ang); g.beginPath(); g.ellipse(0, 0, 6 + 6 * k, 18 + 18 * k, 0, 0, 7); g.stroke(); g.restore(); } }); }
    }, draw: (g, t) => {
      const q = Math.min(1, (t - t0) / ms); if (q >= 1) return;
      const x = x0 + f.dx * L * q, y = y0 + f.dy * L * q - Z;
      V.drawTex(g, "glow", "255,220,140", x, y, 60, 0, 0.7, "a"); V.drawTex(g, "x_arrow", null, x, y, 70, ang, 1, "s");
    } });
    V.p({ tex: "x_halo", x: x0 + f.dx * 20, y: y0 + f.dy * 20 - Z, rot: ang, s0: 40, s1: 110, a0: 0.8, life: 320 });
    if (C.mine) C.shake(3);
  },
  // 鷹眼：頭上一閃金光，十秒內眼前有金色光點
  yingyan(C, f) {
    const { V, TS } = C;
    V.actor({ life: 700, draw: (g, t, k) => { const p = C.pos(f.a) || f; V.drawTex(g, "x_halo", null, p.x * TS, p.y * TS - 62, 60 + 70 * k, t / 1500, 0.9 * (1 - k), "s"); V.drawTex(g, "glow", "255,215,120", p.x * TS, p.y * TS - 62, 120, 0, 0.6 * (1 - k), "a"); } });
    V.emit(14, C.mine, () => ({ tex: "streak", rgb: "214,170,60", x: f.x * TS + rr(-20, 20), y: f.y * TS, z: rr(0, 20), vz: rr(3, 6), align: true, s0: 26, s1: 6, sy: 0.4, a0: 0.9, life: 400, blend: "a", delay: rr(0, 150) }));
    aura(C, f.a, 10000, (g, px, py, t, k) => { const a = 0.6 * (k > 0.92 ? (1 - k) / 0.08 : 1); for (let i = 0; i < 2; i++) { const q = t / 600 + i * 3.14; V.drawTex(g, "glow", "255,215,120", px + Math.cos(q) * 18, py - 58 + Math.sin(q) * 5, 10, 0, a, "a"); } });
  },
  // 流星箭雨：一波波帶火尾的箭從斜上方射下來，插在地上冒火星
  liuxing(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS;
    ticks(f, (k) => {
      const n = Math.round(8 * (C.mine ? 1 : 0.5));
      for (let i = 0; i < n; i++) {
        const [x, y] = inArea(cx, cy, r * 0.9), d = i * 35 + rr(0, 25), sx = -180, sz = 260, ang = Math.atan2(sz, -sx);
        V.actor({ life: 200, delay: d, draw: (g, t, q) => {
          const px = x + sx * (1 - q), pz = sz * (1 - q); V.shadow(g, px, y, 22, 0.1 + 0.15 * q);
          V.drawTex(g, "x_flame", null, px - 22 * Math.cos(ang), y - pz - 22 * Math.sin(ang) - 12, 36, ang - 1.57, 0.85, "s");
          V.drawTex(g, "glow", "255,150,60", px, y - pz - 12, 40, 0, 0.6, "a");
          V.drawTex(g, "x_arrow", null, px, y - pz - 12, 52, ang, 1, "s");
        } });
        setTimeout(() => {
          V.p({ tex: "x_arrow", x: x - 10, y, z: 18, rot: ang, s0: 52, s1: 52, a0: 1, a1: 0, life: 700, ys: true });
          V.emit(5, C.mine, () => ({ tex: "dot", rgb: "255,160,60", x, y, z: 4, vx: rr(-2, 2), vy: rr(-1, 1), vz: rr(1, 3), g: 0.2, s0: 4, s1: 1, a0: 1, life: 450, blend: "a" }));
          V.decal({ tex: "x_bloom", rgb: "50,30,20", x, y, w: 30, a: 0.35, life: 1600 });
        }, d + 200);
      }
      if (C.mine) setTimeout(() => C.shake(4), 230);
    });
  },

  // ================================================================ 獵影
  // 連環弩：七發弩箭連珠射出，每發一道細線
  lianhuan(C, f) {
    const { V, TS } = C;
    for (let h = 0; h < 7; h++) {
      const off = (h % 2 ? 1 : -1) * rr(2, 8);
      V.actor({ life: 120, delay: h * 140, draw: (g, t, k) => {
        const a = C.pos(f.a) || f, b = C.pos(f.b) || { x: f.x, y: f.y }, ax = a.x * TS, ay = a.y * TS - Z + off, bx = b.x * TS, by = b.y * TS - Z, x = ax + (bx - ax) * k, y = ay + (by - ay) * k, ang = Math.atan2(by - ay, bx - ax);
        g.globalAlpha = 0.5; g.strokeStyle = "rgb(60,40,70)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax + (bx - ax) * Math.max(0, k - 0.35), ay + (by - ay) * Math.max(0, k - 0.35)); g.lineTo(x, y); g.stroke();
        V.drawTex(g, "glow", "150,110,190", x, y, 26, 0, 0.5, "a"); V.drawTex(g, "x_arrow", null, x, y, 44, ang, 1, "s");
      } });
    }
  },
  // 影步：化成一團黑影衝過去，路上留下一串墨色殘影
  yingbu(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, ang = Math.atan2(f.dy, f.dx);
    const tr = V.trail({ w: 30, rgb: "40,30,50", a: 0.5, keep: 420 });
    V.actor({ life: 200, update: (t, k) => { tr.add(x0 + f.dx * L * k, y0 + f.dy * L * k, 26); if (k >= 1) tr.done = true; } });
    for (let i = 0; i <= 5; i++) V.p({ tex: "x_bloom", rgb: "40,30,50", x: x0 + f.dx * L * i / 5, y: y0 + f.dy * L * i / 5 - 30, s0: 34, s1: 44, sy: 1.8, a0: 0.55, a1: 0, life: 500, delay: i * 35 });
    for (const [x, y] of [[x0, y0], [x0 + f.dx * L, y0 + f.dy * L]]) V.emit(10, C.mine, () => { const a = R() * 6.28, v = rr(0.8, 2); return { tex: "x_bloom", rgb: "30,24,36", x, y, z: 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0, 1), drag: 0.06, s0: 20, s1: 50, a0: 0.5, rot: R() * 6.28, life: rr(450, 700) }; });
    aura(C, f.a, 4000, (g, px, py, t, k) => { V.drawTex(g, "x_bloom", "40,30,50", px - 14 * Math.sin(t / 300), py - 30, 40, 0, 0.18 * (1 - k), "s", 1.6); });
  },
  // 毒霧陷阱：機關一彈，綠色毒霧漫開，裡面冒泡泡
  duwu(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS, d = f.t || 200;
    setTimeout(() => {
      V.ring(cx, cy, r, "70,120,50", 400, 6);
      V.decal({ tex: "x_bloom", rgb: "60,90,40", x: cx, y: cy, w: r * 2, a: 0.35, life: 4500 });
      let last = 0;
      V.actor({ life: 4000, update: (t, k) => {
        if (t - last < 90) return; last = t;
        V.emit(2, C.mine, () => { const [x, y] = inArea(cx, cy, r * 0.85); return { tex: "x_mist", x, y, z: rr(0, 16), vx: rr(-0.3, 0.3), vz: rr(0, 0.2), rot: R() * 6.28, vr: rr(-0.01, 0.01), s0: rr(40, 60), s1: rr(70, 100), a0: 0.5 * (1 - k * 0.6), fin: 0.3, life: rr(1200, 1800) }; });
        if (R() < 0.6) V.emit(1, C.mine, () => { const [x, y] = inArea(cx, cy, r * 0.8); return { tex: "dot", rgb: "150,210,90", x, y, z: 2, vz: rr(0.4, 0.9), s0: 5, s1: 9, a0: 0.8, life: 600, blend: "a" }; });
      } });
    }, d);
  },
};

// ================================================================ 王的技能特效（伺服器的 bsk 事件）
// C 跟技能一樣，另外 C.near(x, y)＝離自己多近（0～1），用來決定震動大小
const KAI = '"LXGW WenKai TC","Noto Serif TC",serif';
export const BOSSFX = {
  // 竹妖・竹刺穿地：每個點從地下竄出一叢竹刺
  spikes(C, f) {
    const { V, TS } = C;
    for (const [px, py] of f.pts) {
      const x = px * TS, y = py * TS, n = 5, sp = Array.from({ length: n }, (_, i) => [(i - (n - 1) / 2) * 9 + rr(-3, 3), rr(40, 70), rr(-0.25, 0.25)]);
      V.actor({ life: 700, ys: y, draw: (g, t, k) => {
        const e = k < 0.25 ? k / 0.25 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        g.fillStyle = "rgb(52,82,46)"; g.strokeStyle = "rgb(22,30,18)"; g.lineWidth = 1.2;
        for (const [dx, h, a] of sp) { g.save(); g.translate(x + dx, y); g.rotate(a); g.globalAlpha = Math.min(1, e * 1.5); g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -h * e); g.lineTo(4, 0); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      } });
      V.dust(x, y, 30, 5, true, "70,90,60");
      V.decal({ tex: "x_crack", x, y, w: 50, rot: R() * 6.28, a: 0.4, life: 1800 });
      V.emit(4, true, () => ({ tex: "streak", rgb: "60,100,50", x, y, z: 10, vx: rr(-2, 2), vy: rr(-1, 1), vz: rr(2, 4), g: 0.2, align: true, s0: 16, s1: 6, sy: 0.5, a0: 0.9, life: 450 }));
    }
    C.shake(C.near(f.pts[0][0], f.pts[0][1]) * 6);
  },
  // 竹妖・竹葉風暴：一大片竹葉朝扇形方向刮過去
  leaves(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS;
    V.emit(46, true, () => { const a = f.ang + rr(-f.arc / 2, f.arc / 2), v = rr(5, 9); return { tex: "x_dry", rgb: R() < 0.5 ? "50,90,50" : "90,120,60", x, y, z: rr(10, 40), vx: Math.cos(a) * v, vy: Math.sin(a) * v, align: true, s0: rr(26, 38), s1: 16, sy: 1.6, a0: 0.95, a1: 0, life: (f.r * TS) / v * 16.7 + rr(-80, 60), delay: rr(0, 160) }; });
    for (let i = 0; i < 3; i++) V.slash(x + Math.cos(f.ang) * TS * (1.5 + i * 1.5), y + Math.sin(f.ang) * TS * (1.5 + i * 1.5) - 26, f.ang, 90 + i * 20, "50,90,50", 300, { a: 0.6, flip: i % 2 === 1 });
  },
  // 虎王・猛虎撲擊：沿路三道爪痕，落地揚塵
  pounce(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, ang = Math.atan2(f.dy, f.dx), nx = -f.dy, ny = f.dx;
    for (const o of [-14, 0, 14]) V.decal({ tex: "x_dry", rgb: "70,20,16", x: x0 + f.dx * L * 0.55 + nx * o, y: y0 + f.dy * L * 0.55 + ny * o, w: L * 0.9, rot: ang, a: 0.55, life: 2200, sy: 0.25 });
    const ex = x0 + f.dx * L, ey = y0 + f.dy * L;
    V.ring(ex, ey, 2 * TS, "22,20,15", 400, 8); V.dust(ex, ey, 70, 10, true);
    V.slash(ex, ey - 40, ang, 150, "120,30,20", 280, {});
    C.shake(C.near(f.x + f.dx * f.len, f.y + f.dy * f.len) * 9);
  },
  // 虎王・虎嘯山林：三圈音波＋一個大大的「吼」字
  roar(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    for (let i = 0; i < 3; i++) V.actor({ life: 600, delay: i * 120, layer: "g", draw: (g, t, k) => { g.globalAlpha = (1 - k) * 0.7; g.strokeStyle = "rgb(22,20,15)"; g.lineWidth = 10 * (1 - k) + 2; g.beginPath(); g.arc(x, y - 20, r * (0.3 + 0.7 * k), 0, 7); g.stroke(); } });
    V.actor({ life: 800, draw: (g, t, k) => { g.globalAlpha = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8; g.font = `700 ${Math.round(70 + 40 * k)}px ${KAI}`; g.textAlign = "center"; g.fillStyle = "rgb(150,30,26)"; g.fillText("吼", x + 90, y - 150 - 20 * k); } });
    V.dust(x, y, r, 12, true);
    C.shake(C.near(f.x, f.y) * 12); if (C.near(f.x, f.y) > 0.6) C.stop(80);
  },
  // 屍王・屍毒池：地上一灘灘綠色毒水，冒泡、飄毒氣
  pools(C, f) {
    const { V, TS } = C, dur = f.dur || 6000;
    for (const [px, py] of f.pts) {
      const x = px * TS, y = py * TS, r = f.r * TS;
      V.decal({ tex: "x_bloom", rgb: "60,100,40", x, y, w: r * 2.1, a: 0.55, life: dur, sy: 1 });
      let last = 0;
      V.actor({ life: dur, update: (t, k) => {
        if (t - last < 140) return; last = t;
        V.emit(1, true, () => { const a = R() * 6.28, d = Math.sqrt(R()) * r * 0.8; return { tex: "x_mist", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 4, vz: rr(0.2, 0.5), s0: 30, s1: 60, a0: 0.4, fin: 0.3, rot: R() * 6.28, life: 1200 }; });
        V.emit(1, true, () => { const a = R() * 6.28, d = Math.sqrt(R()) * r * 0.8; return { tex: "dot", rgb: "150,210,90", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vz: rr(0.3, 0.7), s0: 4, s1: 9, a0: 0.8, life: 500, blend: "a" }; });
      } });
      V.actor({ life: dur, layer: "g", draw: (g, t, k) => { g.globalAlpha = 0.6 * (k > 0.85 ? (1 - k) / 0.15 : 1); g.strokeStyle = "rgb(70,120,50)"; g.lineWidth = 2; g.setLineDash([6, 5]); g.lineDashOffset = -t / 60; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.setLineDash([]); } });
    }
  },
  // 屍王・屍變：地面裂開，屍兵爬出來
  raise(C, f) {
    const { V, TS } = C;
    for (const [px, py] of f.pts) {
      const x = px * TS, y = py * TS;
      V.decal({ tex: "x_splat", rgb: "30,40,24", x, y, w: 80, a: 0.55, life: 2500 });
      V.emit(10, true, () => ({ tex: "x_bloom", rgb: "40,50,34", x: x + rr(-10, 10), y, z: 4, vz: rr(0.8, 1.8), vx: rr(-0.4, 0.4), s0: 18, s1: 46, a0: 0.55, rot: R() * 6.28, life: rr(600, 900) }));
      V.emit(6, true, () => ({ tex: "dot", rgb: "230,225,210", x, y, z: 6, vx: rr(-2, 2), vy: rr(-1, 1), vz: rr(2, 4), g: 0.25, s0: 4, s1: 3, a0: 1, life: 600 }));
    }
  },
  // 雪妖・冰錐：一根冰錐從天上掉下來砸碎
  icicle(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS;
    V.actor({ life: 120, draw: (g, t, k) => { V.shadow(g, x, y, 26, 0.1 + 0.15 * k); V.drawTex(g, "x_frost", null, x, y - 170 * (1 - k) - 20, 40, Math.PI, 1, "s"); } });
    setTimeout(() => {
      V.emit(8, true, () => { const a = R() * 6.28, v = rr(1.5, 3.5); return { tex: "x_frost", x, y, z: 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(1, 3), g: 0.25, rot: R() * 6.28, vr: rr(-0.2, 0.2), s0: rr(10, 16), s1: 4, a0: 1, life: 500 }; });
      V.p({ tex: "glow", rgb: "200,235,255", x, y: y - 8, s0: 60, s1: 10, a0: 0.8, life: 220, blend: "a" });
      V.decal({ tex: "x_bloom", rgb: "150,195,225", x, y, w: 46, a: 0.45, life: 2000 });
    }, 120);
    C.shake(C.near(f.x, f.y) * 3);
  },
  // 雪妖・寒冰吐息：一道扇形寒氣，冰晶跟白霧往前噴
  breath(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, R0 = f.r * TS;
    V.emit(40, true, () => { const a = f.ang + rr(-f.arc / 2, f.arc / 2), v = rr(4, 7); return { tex: R() < 0.4 ? "x_frost" : "x_mist", rgb: null, x, y, z: 40, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: -0.5, drag: 0.02, rot: R() * 6.28, vr: rr(-0.05, 0.05), s0: rr(14, 22), s1: rr(40, 70), a0: 0.75, a1: 0, life: R0 / v * 16.7, delay: rr(0, 260) }; });
    V.p({ tex: "glow", rgb: "190,230,255", x: x + Math.cos(f.ang) * R0 * 0.5, y: y + Math.sin(f.ang) * R0 * 0.5 - 20, s0: R0, s1: R0 * 1.3, a0: 0.4, life: 500, blend: "a" });
    for (let i = 1; i <= 3; i++) V.decal({ tex: "x_bloom", rgb: "170,210,235", x: x + Math.cos(f.ang) * R0 * i / 3.5, y: y + Math.sin(f.ang) * R0 * i / 3.5, w: 60 + i * 30, a: 0.35, life: 2500, delay: i * 80 });
  },
  // 麒麟・烈焰衝鋒：衝過去，身後留一道燒 4 秒的火痕
  charge(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, ang = Math.atan2(f.dy, f.dx), dur = f.dur || 4000;
    V.decal({ tex: "x_dry", rgb: "60,26,14", x: x0 + f.dx * L / 2, y: y0 + f.dy * L / 2, w: L, rot: ang, a: 0.55, life: dur + 1500, sy: 0.4 });
    let last = 0;
    V.actor({ life: dur, update: (t, k) => {
      if (t - last < 40) return; last = t;
      V.emit(2, true, () => { const q = R(); return { tex: "x_flame", ys: true, x: x0 + f.dx * L * q + rr(-10, 10), y: y0 + f.dy * L * q + rr(-8, 8), vz: rr(1.2, 2.4), s0: rr(22, 34), s1: 8, a0: 0.9 * (1 - k * 0.5), fin: 0.2, life: rr(380, 560) }; });
    } });
    const ex = x0 + f.dx * L, ey = y0 + f.dy * L;
    V.p({ tex: "glow", rgb: "255,150,60", x: ex, y: ey - 30, s0: 160, s1: 40, a0: 0.8, life: 350, blend: "a" }); V.dust(ex, ey, 60, 8, true, "80,50,30");
    C.shake(C.near(f.x + f.dx * f.len, f.y + f.dy * f.len) * 9);
  },
  // 麒麟・踏火：一圈火環往外擴
  nova(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, rm = (f.r0 + f.r1) / 2 * TS, w = (f.r1 - f.r0) * TS;
    V.actor({ life: 450, layer: "g", draw: (g, t, k) => { g.globalAlpha = (1 - k) * 0.65; g.strokeStyle = "rgb(230,110,40)"; g.lineWidth = w * (1 - k * 0.5); g.beginPath(); g.arc(x, y, Math.max(1, rm), 0, 7); g.stroke(); } });
    const n = Math.round(10 + rm / 8);
    V.emit(n, true, () => { const a = R() * 6.28, d = rm + rr(-w / 2, w / 2); return { tex: "x_flame", ys: true, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vz: rr(1.5, 3), s0: rr(26, 40), s1: 8, a0: 0.95, fin: 0.15, life: rr(380, 600) }; });
    C.shake(C.near(f.x, f.y) * 5);
  },
  // 教主・天魔掌：一個大大的墨色「掌」字從天上壓下來
  palm(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    V.actor({ life: 520, draw: (g, t, k) => {
      const e = Math.min(1, k / 0.3), s = 2.2 - 1.2 * e, a = k < 0.3 ? e : 1 - (k - 0.3) / 0.7;
      V.drawTex(g, "x_bloom", "40,10,30", x, y - 10, r * 2.2 * s, 0, 0.5 * a, "s", 0.6);
      g.globalAlpha = a; g.font = `700 ${Math.round(r * 1.6 * s)}px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "rgb(30,10,24)"; g.fillText("掌", x, y - 30 - 40 * (1 - e)); g.textBaseline = "alphabetic";
    } });
    setTimeout(() => {
      V.decal({ tex: "x_crack", rgb: "40,10,30", x, y, w: r * 2.2, rot: R() * 6.28, a: 0.6, life: 3000 });
      V.decal({ tex: "x_splat", rgb: "40,10,30", x, y, w: r * 2.4, rot: R() * 6.28, a: 0.4, life: 3000 });
      V.ring(x, y, r * 1.3, "60,16,40", 500, 10); V.dust(x, y, r, 12, true, "50,30,40");
      C.shake(C.near(f.x, f.y) * 14); if (C.near(f.x, f.y) > 0.5) C.stop(90);
    }, 150);
  },
  // 教主・吸星大法：紫黑色的氣旋往中間吸
  pull(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    V.actor({ life: 1100, layer: "g", draw: (g, t, k) => {
      g.globalAlpha = 0.5 * (1 - k); g.strokeStyle = "rgb(90,30,90)"; g.lineWidth = 3;
      for (let i = 0; i < 3; i++) { const rr2 = r * (1 - ((k + i / 3) % 1)); g.beginPath(); g.arc(x, y, Math.max(2, rr2), 0, 7); g.stroke(); }
      V.drawTex(g, "glow", "120,40,120", x, y - 20, r * 0.8, 0, 0.3 * (1 - k), "s");
    } });
    V.emit(36, true, () => { const a = R() * 6.28, d = r * rr(0.6, 1); return { tex: "x_bloom", rgb: "70,20,70", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 20, vx: -Math.cos(a) * d / 50 + Math.sin(a) * 2, vy: -Math.sin(a) * d / 50 - Math.cos(a) * 2, drag: 0.02, s0: 30, s1: 8, a0: 0.55, fin: 0.2, life: 900, delay: rr(0, 300) }; });
  },
  // 九尾狐・狐火：九團粉紫色狐火往外飛
  foxfire(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, L = f.len * TS;
    for (const [dx, dy] of f.dirs) {
      const tr = V.trail({ w: 14, rgb: "220,120,200", a: 0.6, keep: 260, blend: "a" });
      V.actor({ life: 360, update: (t, k) => { tr.add(x + dx * L * k, y + dy * L * k, 30); if (k >= 1) tr.done = true; }, draw: (g, t, k) => { const px = x + dx * L * k, py = y + dy * L * k - 30; V.shadow(g, px, py + 30, 22, 0.15); V.drawTex(g, "glow", "230,130,220", px, py, 54, 0, 0.9, "a"); V.drawTex(g, "dot", "160,40,140", px, py, 14, 0, 1, "s"); } });
    }
    V.p({ tex: "glow", rgb: "230,130,220", x, y: y - 30, s0: 140, s1: 30, a0: 0.8, life: 300, blend: "a" });
  },
  // 九尾狐・幻狐分身：原地一團狐煙，換到別的地方冒出來
  blink(C, f) {
    const { V, TS } = C;
    for (const [px, py] of [[f.x, f.y], [f.tx, f.ty]]) {
      const x = px * TS, y = py * TS;
      V.emit(14, true, () => { const a = R() * 6.28, v = rr(0.8, 2); return { tex: "x_bloom", rgb: "150,80,140", x, y, z: 30, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0, 1), drag: 0.05, s0: 24, s1: 60, a0: 0.5, rot: R() * 6.28, life: rr(500, 800) }; });
      V.p({ tex: "glow", rgb: "230,130,220", x, y: y - 40, s0: 120, s1: 30, a0: 0.7, life: 350, blend: "a" });
    }
  },
};

// ================================================================ 基本職業 24 招（劍客、術士、弓手）
// 投射物：沿 (dx,dy) 飛 len 格；draw(g, x, y, ang, k) 畫頭、trail 可選
function shot(C, f, o) {
  const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, ms = Math.max(60, (f.len / (f.spd || 14)) * 1000), ang = Math.atan2(f.dy, f.dx), t0 = now();
  const tr = o.trail ? V.trail(o.trail) : null; let last = 0;
  V.actor({ life: ms + (o.tail || 120), update: (t) => {
    const q = Math.min(1, (t - t0) / ms), x = x0 + f.dx * L * q, y = y0 + f.dy * L * q;
    if (tr) { if (q < 1) tr.add(x, y, Z); else tr.done = true; }
    if (o.shed && q < 1 && t - last > (o.every || 40)) { last = t; o.shed(x, y, q); }
  }, draw: (g, t) => {
    const q = Math.min(1, (t - t0) / ms); if (q >= 1 && !o.tail) return;
    const fade = (t - t0) > ms ? 1 - ((t - t0) - ms) / (o.tail || 120) : 1;
    const gx = x0 + f.dx * L * q, gy = y0 + f.dy * L * q;
    C.V.shadow(g, gx, gy, o.shadow || 26, 0.2 * fade);
    g.globalAlpha = 1; o.draw(g, gx, gy - Z, ang, fade);
  } });
  if (o.end) setTimeout(() => o.end(x0 + f.dx * L, y0 + f.dy * L), ms);
}
// 指定目標：從施法者飛到目標（ms 毫秒），抵達後呼叫 hit(x, y)；目標死了就停在最後的位置
function toTarget(C, f, ms, draw, hit) {
  const { V, TS } = C, a = C.pos(f.a) || f, tb = follow(C, f.b, { x: f.x, y: f.y });
  V.actor({ life: ms, draw: (g, t, k) => { const b = tb(), x = (a.x + (b.x - a.x) * k) * TS, y = (a.y + (b.y - a.y) * k) * TS - Z; V.shadow(g, x, y + Z, 20, 0.18); draw(g, x, y, Math.atan2(b.y - a.y, b.x - a.x), k); } });
  if (hit) setTimeout(() => { const b = tb(); hit(b.x * TS, b.y * TS); }, ms);
}
// 衝刺：從 (x,y) 衝 len 格，留拖尾
function dashFx(C, f, rgb, w, extra) {
  const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS;
  const tr = V.trail({ w, rgb, a: 0.55, keep: 320 });
  V.actor({ life: 180, update: (t, k) => { tr.add(x0 + f.dx * L * k, y0 + f.dy * L * k, 22); if (k >= 1) tr.done = true; } });
  V.dust(x0, y0, 30, 4, C.mine);
  if (extra) setTimeout(() => extra(x0 + f.dx * L, y0 + f.dy * L, Math.atan2(f.dy, f.dx)), 180);
}
Object.assign(SKFX, {
  // ---------------------------------------------------------------- 劍客
  sweep(C, f) {
    const { V, TS } = C, p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS, r = (f.r || 2.2) * TS;
    V.slash(x - r * 0.25, y - 26, Math.PI, r * 1.5, null, 260, {}); V.slash(x + r * 0.25, y - 22, 0, r * 1.5, null, 300, { flip: true });
    V.ring(x, y, r, "22,20,15", 320, 5); V.dust(x, y, r * 0.6, 4, C.mine);
  },
  thrust(C, f) { dashFx(C, f, "22,20,15", 16, (x, y, a) => { C.V.slash(x, y - Z, a, 110, null, 240, {}); if (C.mine) C.shake(3); }); },
  guard(C, f) {
    const { V, TS } = C;
    V.actor({ life: 700, draw: (g, t, k) => { const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS; V.drawTex(g, "glow", "255,210,110", x, y - 30, 120, 0, 0.5 * (1 - k), "a"); g.globalAlpha = 1 - k; g.strokeStyle = "rgb(168,131,42)"; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y - 28, 26 + 10 * k, 36 + 12 * k, 0, 0, 7); g.stroke(); } });
    V.emit(10, C.mine, () => ({ tex: "glow", rgb: "255,210,110", x: f.x * TS + rr(-20, 20), y: f.y * TS, vz: rr(1, 2), s0: 8, s1: 2, a0: 0.9, life: 600, blend: "a" }));
  },
  qi(C, f) {
    shot(C, f, { trail: { w: 3, rgb: "60,80,130", a: 0.6, keep: 200 }, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "x_slash", "40,56,100", x, y, 80, a, 0.9 * fade, "s"); } });
  },
  cleave(C, f) {
    toTarget(C, f, 90, () => {}, (x, y) => {
      const { V } = C;
      V.slash(x, y - Z, -0.8, 150, null, 280, {}); V.slash(x, y - Z, -0.8, 120, "150,30,26", 240, { a: 0.5 });
      V.decal({ tex: "x_splat", x, y, w: 60, rot: R() * 6.28, a: 0.35, life: 1500 });
      if (C.mine) { C.shake(6); C.stop(60); }
    });
  },
  whirl(C, f) {
    const { V, TS } = C, r = (f.r || 2.6) * TS;
    for (let h = 0; h < 3; h++) setTimeout(() => { const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS; V.slash(x, y - 26, h * 2.1, r * 1.4, null, 260, { flip: h % 2 === 1 }); V.ring(x, y, r, "22,20,15", 260, 4); }, h * 260);
  },
  roar(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS;
    V.p({ tex: "x_splat", rgb: "150,30,26", x, y: y - 36, s0: 40, s1: 120, a0: 0.6, rot: R() * 6.28, life: 500 });
    V.ring(x, y, 2 * TS, "150,30,26", 450, 7);
    V.actor({ life: 700, draw: (g, t, k) => { g.globalAlpha = 1 - k; g.font = `700 ${Math.round(44 + 16 * k)}px ${KAI}`; g.textAlign = "center"; g.fillStyle = "rgb(150,30,26)"; g.fillText("怒", x, y - 90 - 20 * k); } });
    if (C.mine) C.shake(4);
  },
  leap(C, f) {
    const { V, TS } = C;
    if (f.dash) {           // 跳起來：一道弧線
      const x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, tr = V.trail({ w: 12, rgb: "22,20,15", a: 0.45, keep: 300 });
      V.actor({ life: 200, update: (t, k) => { tr.add(x0 + f.dx * L * k, y0 + f.dy * L * k, 22 + Math.sin(k * Math.PI) * 70); if (k >= 1) tr.done = true; } });
      return;
    }
    const x = f.x * TS, y = f.y * TS, r = (f.r || 2.4) * TS;
    V.ring(x, y, r, "22,20,15", 420, 9); V.dust(x, y, r, 10, C.mine);
    V.decal({ tex: "x_crack", x, y, w: r * 1.5, rot: R() * 6.28, a: 0.5, life: 2200 });
    if (C.mine) { C.shake(8); C.stop(60); }
  },
  // ---------------------------------------------------------------- 術士
  fire(C, f) {
    toTarget(C, f, 160, (g, x, y, a) => { C.V.drawTex(g, "glow", "255,140,50", x, y, 44, 0, 0.7, "a"); C.V.drawTex(g, "x_talisman", "190,50,30", x, y, 20, a + 1.57, 1, "s"); }, (x, y) => {
      const { V } = C;
      V.p({ tex: "glow", rgb: "255,140,50", x, y: y - Z, s0: 90, s1: 20, a0: 0.8, life: 280, blend: "a" });
      V.emit(8, C.mine, () => ({ tex: "x_flame", ys: true, x: x + rr(-12, 12), y, z: rr(5, 20), vz: rr(1.5, 3), s0: rr(18, 28), s1: 6, a0: 0.9, fin: 0.15, life: rr(300, 480) }));
    });
  },
  ice(C, f) {
    shot(C, f, { trail: { w: 4, rgb: "190,225,250", a: 0.8, keep: 220, blend: "a" }, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "glow", "190,230,255", x, y, 40, 0, 0.5 * fade, "a"); C.V.drawTex(g, "x_frost", null, x, y, 30, a + 1.57, fade, "s"); },
      end: (x, y) => C.V.emit(6, C.mine, () => { const a = R() * 6.28, v = rr(1.5, 3); return { tex: "x_frost", x, y, z: Z, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0, 2), g: 0.2, rot: R() * 6.28, s0: 12, s1: 4, a0: 1, life: 420 }; }) });
  },
  heal(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = (f.r || 5) * TS;
    V.ring(x, y, r, "63,122,82", 650, 4);
    V.p({ tex: "glow", rgb: "140,220,170", x, y: y - 30, s0: 60, s1: 140, a0: 0.6, life: 500, blend: "a" });
    V.emit(16, C.mine, () => { const [px, py] = inArea(x, y, 60); return { tex: "glow", rgb: "140,220,170", x: px, y: py, vz: rr(0.8, 1.8), s0: rr(8, 14), s1: 2, a0: 0.85, fin: 0.2, life: rr(600, 1000), blend: "a", delay: rr(0, 250) }; });
  },
  thunder(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    setTimeout(() => {
      V.actor({ life: 220, draw: (g, t, q) => { const a = (1 - q) * (q < 0.3 || R() < 0.6 ? 1 : 0.3); V.drawTex(g, "glow", "150,170,255", x, y - 120, 140, 0, 0.45 * a, "a", 2); V.drawTex(g, "x_bolt", null, x, y - 125, 96, 0, a, "s"); } });
      V.p({ tex: "glow", rgb: "170,190,255", x, y: y - 10, s0: 120, s1: 30, a0: 0.85, life: 260, blend: "a" });
      V.decal({ tex: "x_crack", rgb: "30,30,50", x, y, w: r * 1.2, rot: R() * 6.28, a: 0.4, life: 2000 });
      V.emit(10, C.mine, () => { const a = R() * 6.28, v = rr(3, 6); return { tex: "streak", rgb: "120,140,240", x, y, z: 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(1, 3), g: 0.3, align: true, s0: 18, s1: 5, sy: 0.4, a0: 1, life: 300, blend: "a" }; });
      if (C.mine) { C.shake(5); C.flash("210,220,255", 0.3); }
    }, f.t || 0);
  },
  dragon(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, ms = (f.len / (f.spd || 11)) * 1000, t0 = now(), nx = -f.dy, ny = f.dx;
    let last = 0;
    V.actor({ life: ms + 150, update: (t) => {
      const q = Math.min(1, (t - t0) / ms); if (q >= 1 || t - last < 25) return; last = t;
      const w = Math.sin(q * 18) * 14, x = x0 + f.dx * L * q + nx * w, y = y0 + f.dy * L * q + ny * w;
      V.p({ tex: "x_flame", x, y, z: Z, vz: 0.5, rot: Math.atan2(f.dy, f.dx) - 1.57 + 3.14, s0: 34, s1: 10, a0: 0.95, life: 320 });
    }, draw: (g, t) => { const q = Math.min(1, (t - t0) / ms); if (q >= 1) return; const w = Math.sin(q * 18) * 14; V.drawTex(g, "glow", "255,140,50", x0 + f.dx * L * q + nx * w, y0 + f.dy * L * q + ny * w - Z, 70, 0, 0.7, "a"); } });
  },
  seal(C, f) {
    const { V, TS } = C, tb = follow(C, f.b, { x: f.x, y: f.y });
    toTarget(C, f, 200, (g, x, y, a, k) => V.drawTex(g, "x_talisman", null, x, y, 22, now() / 50, 1, "s"), (x, y) => {
      V.p({ tex: "glow", rgb: "255,220,120", x, y: y - Z, s0: 80, s1: 20, a0: 0.8, life: 280, blend: "a" });
      V.actor({ life: 2500, draw: (g, t, k) => { const b = tb(); V.drawTex(g, "x_talisman", null, b.x * TS, b.y * TS - Z - 10, 20, Math.sin(t / 90) * 0.15, k > 0.85 ? (1 - k) / 0.15 : 1, "s"); } });
    });
  },
  shield(C, f) {
    const { V, TS } = C;
    V.actor({ life: 900, draw: (g, t, k) => { const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS - 30, a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8; V.drawTex(g, "glow", "100,190,150", x, y, 110, 0, 0.35 * a, "a"); g.globalAlpha = 0.7 * a; g.strokeStyle = "rgb(64,140,110)"; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 34 + 4 * Math.sin(t / 80), 0, 7); g.stroke(); } });
  },
  inferno(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS;
    ticks(f, () => {
      for (let i = 0; i < 6; i++) { const [x, y] = inArea(cx, cy, r * 0.85), d = i * 40; V.actor({ life: 160, delay: d, draw: (g, t, q) => { V.shadow(g, x, y, 22, 0.08 + 0.15 * q); V.drawTex(g, "glow", "255,140,50", x, y - 160 * (1 - q) - 10, 40, 0, 0.7, "a"); V.drawTex(g, "x_flame", null, x, y - 160 * (1 - q) - 10, 26, 3.14, 1, "s"); } }); setTimeout(() => { V.emit(5, C.mine, () => ({ tex: "x_flame", ys: true, x: x + rr(-8, 8), y, vz: rr(1, 2.2), s0: rr(18, 28), s1: 6, a0: 0.9, fin: 0.15, life: rr(300, 500) })); V.decal({ tex: "x_bloom", rgb: "50,24,16", x, y, w: 36, a: 0.35, life: 1600 }); }, d + 160); }
      if (C.mine) setTimeout(() => C.shake(3), 200);
    });
  },
  // ---------------------------------------------------------------- 弓手
  triple(C, f) {
    for (let i = 0; i < 3; i++) setTimeout(() => toTarget(C, f, 110, (g, x, y, a) => { C.V.drawTex(g, "streak", "22,20,15", x - Math.cos(a) * 14, y - Math.sin(a) * 14, 30, a, 0.6, "s"); C.V.drawTex(g, "x_arrow", null, x, y, 40, a, 1, "s"); }), i * 140);
  },
  pierce(C, f) {
    shot(C, f, { trail: { w: 4, rgb: "22,20,15", a: 0.6, keep: 220 }, draw: (g, x, y, a, fade) => C.V.drawTex(g, "x_arrow", null, x, y, 56, a, fade, "s") });
  },
  gale(C, f) {
    const { V, TS } = C;
    V.actor({ life: 900, draw: (g, t, k) => { const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS; g.globalAlpha = 0.7 * (1 - k); g.strokeStyle = "rgb(64,96,90)"; g.lineWidth = 2; for (let i = 0; i < 5; i++) { const a = i * 1.26 + t / 120; g.beginPath(); g.ellipse(x, y - 26, 20 + 14 * k, 28 + 14 * k, 0, a, a + 0.9); g.stroke(); } } });
    V.emit(10, C.mine, () => ({ tex: "streak", rgb: "90,130,120", x: f.x * TS + rr(-20, 20), y: f.y * TS, z: rr(0, 40), vx: rr(-4, 4), align: true, s0: 24, s1: 6, sy: 0.4, a0: 0.8, life: 360 }));
  },
  rain(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS;
    for (let i = 0; i < 12; i++) {
      const [x, y] = inArea(cx, cy, r * 0.9), d = (f.t || 0) - 150 + i * 18;
      V.actor({ life: 150, delay: Math.max(0, d), draw: (g, t, q) => { V.shadow(g, x, y, 16, 0.08 + 0.15 * q); V.drawTex(g, "x_arrow", null, x, y - 170 * (1 - q) - 14, 40, 1.57, 1, "s"); } });
      setTimeout(() => { V.p({ tex: "x_arrow", x, y, z: 14, rot: 1.57, s0: 40, s1: 40, a0: 1, a1: 0, life: 600, ys: true }); V.dust(x, y, 14, 1, C.mine); }, Math.max(0, d) + 150);
    }
    if (C.mine) setTimeout(() => C.shake(3), f.t || 0);
  },
  spread(C, f) {
    shot(C, f, { trail: { w: 2, rgb: "22,20,15", a: 0.5, keep: 160 }, draw: (g, x, y, a, fade) => C.V.drawTex(g, "x_arrow", null, x, y, 38, a, fade, "s") });
  },
  swallow(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS;
    for (let i = 0; i <= 3; i++) V.p({ tex: "x_bloom", rgb: "60,80,75", x: x0 + f.dx * L * i / 3, y: y0 + f.dy * L * i / 3 - 30, s0: 26, s1: 34, sy: 1.8, a0: 0.35, a1: 0, life: 380, delay: i * 40 });
    dashFx(C, f, "60,80,75", 10);
  },
  poison(C, f) {
    toTarget(C, f, 150, (g, x, y, a) => { C.V.drawTex(g, "glow", "150,210,90", x, y, 30, 0, 0.5, "a"); C.V.drawTex(g, "x_arrow", "50,90,40", x, y, 42, a, 1, "s"); }, (x, y) => {
      C.V.emit(6, C.mine, () => ({ tex: "x_mist", x: x + rr(-10, 10), y, z: rr(10, 30), vz: rr(0.2, 0.6), rot: R() * 6.28, s0: 24, s1: 50, a0: 0.55, life: rr(600, 900) }));
    });
  },
  net(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    V.actor({ life: 3000, layer: "g", draw: (g, t, k) => { const e = Math.min(1, k * 8), a = k > 0.8 ? (1 - k) / 0.2 : 1; V.drawTex(g, "x_web", null, x, y, r * 2.1 * (0.6 + 0.4 * e), 0, 0.8 * a, "s"); } });
    V.ring(x, y, r, "60,50,35", 400, 4);
  },
});

// ---- 60～100 級四隻大王的招式特效
Object.assign(BOSSFX, {
  // 東海龍王・怒海狂濤：一道寬浪往前推，浪頭濺起水花
  tide(C, f) {
    const { V, TS } = C, x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, Wd = f.w * TS, ang = Math.atan2(f.dy, f.dx), nx = -f.dy, ny = f.dx; let last = 0;
    V.actor({ life: 560, update: (t, k) => {
      if (t - last < 30) return; last = t; const hx = x0 + f.dx * L * k, hy = y0 + f.dy * L * k;
      V.emit(4, true, () => { const o = (R() - 0.5) * Wd; return { tex: R() < 0.5 ? "x_mist" : "dot", rgb: R() < 0.5 ? "120,170,200" : "220,236,244", x: hx + nx * o, y: hy + ny * o, z: rr(10, 40), vx: f.dx * rr(1, 3), vy: f.dy * rr(1, 3), vz: rr(1, 3), g: 0.15, rot: R() * 6.28, s0: rr(10, 30), s1: rr(30, 60), a0: 0.6, life: rr(400, 700) }; });
    }, draw: (g, t, k) => { const hx = x0 + f.dx * L * k, hy = y0 + f.dy * L * k; g.save(); g.translate(hx, hy); g.rotate(ang); V.drawTex(g, "x_slash", "60,110,150", 0, -30, Wd * 1.1, Math.PI / 2, 0.8 * (1 - k * 0.5), "s", 0.6); V.drawTex(g, "x_slash", "220,236,244", -6, -34, Wd, Math.PI / 2, 0.6 * (1 - k * 0.5), "s", 0.5); g.restore(); } });
    for (let i = 1; i <= 4; i++) V.decal({ tex: "x_bloom", rgb: "90,140,170", x: x0 + f.dx * L * i / 4.5, y: y0 + f.dy * L * i / 4.5, w: Wd * 1.2, a: 0.3, life: 2200, delay: i * 110 });
    C.shake(C.near(f.x + f.dx * f.len / 2, f.y + f.dy * f.len / 2) * 8);
  },
  // 東海龍王・漩渦水柱：腳下轉著的水渦
  whirl(C, f) {
    const { V, TS } = C, dur = f.dur || 5000;
    for (const [px, py] of f.pts) {
      const x = px * TS, y = py * TS, r = f.r * TS;
      V.decal({ tex: "x_bloom", rgb: "70,120,150", x, y, w: r * 2.1, a: 0.4, life: dur, sy: 1 });
      V.actor({ life: dur, layer: "g", draw: (g, t, k) => { const a = 0.6 * (k > 0.85 ? (1 - k) / 0.15 : 1); g.globalAlpha = a; g.strokeStyle = "rgb(200,228,240)"; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const s0 = t / 300 + i * 1.57; g.beginPath(); g.arc(x, y, r * (0.3 + 0.17 * i), s0, s0 + 2.2); g.stroke(); } } });
      V.emit(12, true, () => ({ tex: "dot", rgb: "220,236,244", x: x + rr(-r / 2, r / 2), y, z: 5, vz: rr(2, 5), g: 0.2, s0: 5, s1: 2, a0: 0.9, life: 600 }));
    }
  },
  // 開明獸・九首噬咬：扇形裡一排咬痕
  bite(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    for (let i = 0; i < 9; i++) { const a = f.ang - f.arc / 2 + f.arc * i / 8, d = r * rr(0.55, 0.9); setTimeout(() => V.slash(x + Math.cos(a) * d, y + Math.sin(a) * d - 30, a + 1.57, 90, i % 2 ? "120,30,20" : null, 240, { flip: i % 2 === 1 }), i * 25); }
    V.dust(x + Math.cos(f.ang) * r * 0.6, y + Math.sin(f.ang) * r * 0.6, r * 0.6, 8, true);
    C.shake(C.near(f.x, f.y) * 9);
  },
  // 開明獸・鎮山印：中間一枚金印砸下，外圈整片震裂（貼在牠身邊才安全）
  seal(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r0 = f.r0 * TS, r1 = f.r1 * TS;
    V.actor({ life: 700, layer: "g", draw: (g, t, k) => { g.globalAlpha = 0.6 * (1 - k); g.strokeStyle = "rgb(176,128,30)"; g.lineWidth = (r1 - r0) * (1 - k * 0.6); g.beginPath(); g.arc(x, y, (r0 + r1) / 2, 0, 7); g.stroke(); } });
    V.p({ tex: "x_halo", x, y: y - 60, s0: 80, s1: 260, a0: 0.9, life: 600 });
    for (let i = 0; i < 8; i++) { const a = i * 0.785 + R() * 0.3, d = rr(r0 + 20, r1 - 20); V.decal({ tex: "x_crack", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, w: 80, rot: R() * 6.28, a: 0.45, life: 2400 }); }
    V.dust(x, y, r1, 16, true);
    C.shake(C.near(f.x, f.y) * 13); if (C.near(f.x, f.y) > 0.4) C.stop(80);
  },
  // 閻羅王・勾魂鎖：一條鐵鍊從王甩到目標身上
  chain(C, f) {
    const { V, TS } = C;
    V.actor({ life: 650, draw: (g, t, k) => {
      const a = C.pos(f.a) || { x: f.x, y: f.y }, b = C.pos(f.b) || { x: f.tx, y: f.ty }, ax = a.x * TS, ay = a.y * TS - 40, bx = b.x * TS, by = b.y * TS - 30, n = Math.max(4, Math.round(Math.hypot(bx - ax, by - ay) / 14)), al = k < 0.7 ? 1 : (1 - k) / 0.3;
      g.globalAlpha = al; g.strokeStyle = "rgb(50,40,60)"; g.lineWidth = 2.4;
      for (let i = 0; i < n; i++) { const q = (i + 0.5) / n, x = ax + (bx - ax) * q, y = ay + (by - ay) * q + Math.sin(q * Math.PI) * 12 * (1 - k); g.beginPath(); g.ellipse(x, y, 6, 3.5, Math.atan2(by - ay, bx - ax) + (i % 2 ? 1.57 : 0), 0, 7); g.stroke(); }
      V.drawTex(g, "glow", "150,90,200", bx, by, 60, 0, 0.5 * al, "a");
    } });
  },
  // 閻羅王・生死簿：每個判決圈落下一個朱紅的「判」字
  judge(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    V.actor({ life: 600, draw: (g, t, k) => { const e = Math.min(1, k / 0.25), a = k < 0.25 ? e : 1 - (k - 0.25) / 0.75; g.globalAlpha = a; g.font = `700 ${Math.round(r * 1.5 * (1.6 - 0.6 * e))}px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "rgb(150,30,26)"; g.fillText("判", x, y - 20 - 40 * (1 - e)); g.textBaseline = "alphabetic"; } });
    setTimeout(() => { V.decal({ tex: "x_splat", rgb: "120,24,20", x, y, w: r * 2, rot: R() * 6.28, a: 0.5, life: 2500 }); V.dust(x, y, r, 5, true, "60,30,30"); C.shake(C.near(f.x, f.y) * 5); }, 150);
  },
  // 二郎神・三尖兩刃：三道金色刃光
  trident(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS - 30, L = f.len * TS;
    V.actor({ life: 380, draw: (g, t, k) => { for (const [dx, dy] of f.dirs) { const e = Math.min(1, k * 3); g.globalAlpha = 1 - k; g.strokeStyle = "rgb(176,128,30)"; g.lineWidth = 10 * (1 - k) + 2; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * L * e, y + dy * L * e); g.stroke(); g.strokeStyle = "rgb(250,236,200)"; g.lineWidth = 3 * (1 - k) + 1; g.stroke(); } } });
    for (const [dx, dy] of f.dirs) V.slash(x + dx * L * 0.5, y + dy * L * 0.5, Math.atan2(dy, dx), 130, "176,128,30", 300, {});
    C.shake(C.near(f.x, f.y) * 6);
  },
  // 二郎神・天眼神光：額頭射出一道金白光柱，地上燒出一條焦痕
  eye(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, L = f.len * TS, ang = Math.atan2(f.dy, f.dx);
    V.actor({ life: 520, draw: (g, t, k) => {
      const w = TS * 1.8 * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8);
      g.save(); g.translate(x, y - 60); g.rotate(ang);
      const gr = g.createLinearGradient(0, -w, 0, w); gr.addColorStop(0, "rgba(255,230,160,0)"); gr.addColorStop(0.5, "rgba(255,245,215,.95)"); gr.addColorStop(1, "rgba(255,230,160,0)");
      g.fillStyle = gr; g.fillRect(0, -w, L, w * 2); g.restore();
      V.drawTex(g, "x_halo", null, x, y - 60, 90 + 50 * k, t / 400, 0.9 * (1 - k), "s");
    } });
    V.decal({ tex: "x_dry", rgb: "90,60,30", x: x + f.dx * L / 2, y: y + f.dy * L / 2, w: L, rot: ang, a: 0.4, life: 2600, sy: 0.5 });
    if (C.near(f.x, f.y) > 0.2) C.flash("255,240,200", 0.5);
    C.shake(C.near(f.x, f.y) * 9);
  },
  // 二郎神・震天：一圈圈往外震開
  quake(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, rm = (f.r0 + f.r1) / 2 * TS, w = (f.r1 - f.r0) * TS;
    V.actor({ life: 420, layer: "g", draw: (g, t, k) => { g.globalAlpha = (1 - k) * 0.55; g.strokeStyle = "rgb(150,120,60)"; g.lineWidth = w * (1 - k * 0.5); g.beginPath(); g.arc(x, y, Math.max(1, rm), 0, 7); g.stroke(); } });
    V.emit(Math.round(8 + rm / 10), true, () => { const a = R() * 6.28, d = rm + rr(-w / 2, w / 2); return { tex: "x_bloom", rgb: "110,90,60", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 4, vz: rr(0.5, 1.5), s0: 20, s1: 50, a0: 0.4, rot: R() * 6.28, life: 600 }; });
    C.shake(C.near(f.x, f.y) * 6);
  },
});

// ================================================================ 二轉 36 招
// 瞬移：伺服器先送一個 blinkTo 事件（從哪裡閃到哪裡）
function blinkFx(C, f, rgb = "30,24,36") {
  const { V, TS } = C;
  for (const [x, y] of [[f.x * TS, f.y * TS], [(f.x + f.dx) * TS, (f.y + f.dy) * TS]]) V.emit(10, C.mine, () => { const a = R() * 6.28, v = rr(0.8, 2); return { tex: "x_bloom", rgb, x, y, z: 25, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, drag: 0.06, s0: 20, s1: 50, a0: 0.5, rot: R() * 6.28, life: rr(400, 650) }; });
  const tr = V.trail({ w: 18, rgb, a: 0.4, keep: 260 }); V.actor({ life: 90, update: (t, k) => { tr.add((f.x + f.dx * k) * TS, (f.y + f.dy * k) * TS, 26); if (k >= 1) tr.done = true; } });
}
// 打在目標身上的一下刀光（跟著目標，目標死了停在原地）
function hitSlashes(C, f, n, every, rgb, w = 90, first = 120) {
  const tb = follow(C, f.b, { x: f.x, y: f.y });
  for (let i = 0; i < n; i++) setTimeout(() => { const b = tb(); C.V.slash(b.x * C.TS + rr(-12, 12), b.y * C.TS - Z + rr(-10, 10), R() * 6.28, w, rgb, 200, { flip: i % 2 === 1 }); if (C.mine && i === n - 1) C.shake(5); }, first + i * every);
}
// 召喚物：畫在人旁邊（follow）或固定在原地，持續 dur 秒
function petFx(C, f, draw) {
  const { V, TS } = C, x0 = f.x, y0 = f.y;
  V.actor({ life: (f.dur || 10) * 1000, ys: f.follow ? () => { const p = C.pos(f.a) || { y: y0 }; return p.y * TS - 1; } : y0 * TS - 1, draw: (g, t, k) => { const p = f.follow ? (C.pos(f.a) || { x: x0, y: y0 }) : { x: x0, y: y0 }, a = Math.min(1, k * 12) * (k > 0.92 ? (1 - k) / 0.08 : 1); draw(g, p.x * TS, p.y * TS, t, k, a); } });
}
// 機關砲台（程式畫的小木架＋弩臂）
function turret(g, x, y, a, sc = 1) {
  g.save(); g.translate(x, y); g.globalAlpha = a;
  g.fillStyle = "rgba(40,34,26,.25)"; g.beginPath(); g.ellipse(0, 2, 18 * sc, 6 * sc, 0, 0, 7); g.fill();
  g.strokeStyle = "rgb(60,44,30)"; g.lineWidth = 3 * sc; g.beginPath(); g.moveTo(-12 * sc, 0); g.lineTo(0, -16 * sc); g.lineTo(12 * sc, 0); g.stroke();
  g.fillStyle = "rgb(120,86,52)"; g.fillRect(-11 * sc, -24 * sc, 22 * sc, 9 * sc); g.strokeRect(-11 * sc, -24 * sc, 22 * sc, 9 * sc);
  g.strokeStyle = "rgb(40,30,22)"; g.lineWidth = 2 * sc; g.beginPath(); g.moveTo(-14 * sc, -28 * sc); g.quadraticCurveTo(0, -36 * sc, 14 * sc, -28 * sc); g.stroke();
  g.beginPath(); g.moveTo(0, -20 * sc); g.lineTo(16 * sc, -20 * sc); g.stroke();
  g.restore();
}
Object.assign(SKFX, {
  // ---------------- 劍聖
  jianyi(C, f) { shot(C, f, { shadow: 80, trail: { w: 5, rgb: "220,236,250", a: 0.8, keep: 260, blend: "a" }, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "glow", "190,225,255", x, y, 150, 0, 0.45 * fade, "a"); C.V.drawTex(g, "x_slash", "90,130,180", x, y, 170, a, 0.95 * fade, "s", 1.2); C.V.drawTex(g, "x_slash", "235,246,255", x - Math.cos(a) * 8, y - Math.sin(a) * 8, 140, a, 0.6 * fade, "a", 1.1); } }); if (C.mine) C.shake(5); },
  wuwo(C, f) {
    const { V, TS } = C, r = (f.r || 3.6) * TS;
    petFx(C, { ...f, dur: 1.7, follow: 1 }, (g, x, y, t, k, a) => { for (let i = 0; i < 8; i++) { const q = t / 140 + i * 0.785; V.drawTex(g, "x_sword", null, x + Math.cos(q) * r * 0.7, y - 20 + Math.sin(q) * r * 0.35, 56, q + 1.57, a * 0.9, "s"); } });
    for (let h = 0; h < 6; h++) setTimeout(() => { const p = C.pos(f.a) || f; V.slash(p.x * TS, p.y * TS - 26, h * 1.05, r * 1.3, h % 2 ? "90,130,180" : null, 240, { flip: h % 2 === 1 }); V.ring(p.x * TS, p.y * TS, r, "60,80,120", 260, 4); }, h * 260);
  },
  qianzhan(C, f) { if (f.blinkTo) return blinkFx(C, f, "60,80,120"); hitSlashes(C, f, 9, 140, null, 100); hitSlashes(C, f, 3, 400, "90,130,180", 140, 300); },
  // ---------------- 天劍
  feijian(C, f) { shot(C, f, { trail: { w: 3, rgb: "150,185,225", a: 0.7, keep: 220, blend: "a" }, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "glow", "170,210,255", x, y, 40, 0, 0.5 * fade, "a"); C.V.drawTex(g, "x_sword", null, x, y, 70, a, fade, "s"); } }); },
  jianzhen(C, f) {
    const { V } = C;
    petFx(C, f, (g, x, y, t, k, a) => { for (let i = 0; i < 6; i++) { const q = t / 500 + i * 1.047; V.drawTex(g, "x_sword", null, x + Math.cos(q) * 46, y - 40 + Math.sin(q) * 18, 46, q + 1.57, a * 0.85, "s"); } V.drawTex(g, "glow", "170,210,255", x, y - 40, 120, 0, 0.18 * a, "a"); });
  },
  jianzhen_shot(C, f) { const { V, TS } = C, b = C.pos(f.b); if (!b) return; const x0 = f.x * TS, y0 = f.y * TS - 40, x1 = b.x * TS, y1 = b.y * TS - Z, ang = Math.atan2(y1 - y0, x1 - x0); V.actor({ life: 130, draw: (g, t, k) => V.drawTex(g, "x_sword", null, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 46, ang, 1, "s") }); },
  zhuxie(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS, d = f.t || 700;
    V.actor({ life: d, layer: "g", draw: (g, t, k) => { V.shadow(g, x, y, r * 1.2 * k, 0.1 + 0.25 * k); } });
    V.actor({ life: 260, delay: d - 260, draw: (g, t, k) => { V.drawTex(g, "glow", "190,225,255", x, y - 140, 200, 0, 0.5, "a", 2); V.drawTex(g, "x_sword", null, x, y - 330 * (1 - k * k) - 90, 230, Math.PI / 2, 1, "s"); } });
    setTimeout(() => { V.p({ tex: "x_sword", x, y, z: 90, rot: Math.PI / 2, s0: 230, s1: 230, a0: 1, a1: 0, life: 900, ys: true }); V.ring(x, y, r, "60,80,120", 500, 10); V.decal({ tex: "x_crack", x, y, w: r * 2, rot: R() * 6.28, a: 0.55, life: 3000 }); V.dust(x, y, r, 14, C.mine); if (C.mine) { C.shake(12); C.stop(90); C.flash("220,235,255", 0.35); } }, d);
  },
  // ---------------- 刀皇
  kaitian(C, f) {
    const { V, TS } = C, ang = Math.atan2(f.dy, f.dx), L = f.len * TS;
    shot(C, f, { shadow: 160, draw: (g, x, y, a, fade) => { V.drawTex(g, "x_slash", null, x, y, 260, a, 0.9 * fade, "s", 1.3); V.drawTex(g, "x_slash", "150,30,26", x - Math.cos(a) * 12, y - Math.sin(a) * 12, 220, a, 0.5 * fade, "s", 1.2); }, shed: (x, y) => V.emit(2, C.mine, () => ({ tex: "x_bloom", rgb: "60,54,44", x: x + rr(-30, 30), y: y + rr(-30, 30), z: 6, vz: 0.5, s0: 30, s1: 60, a0: 0.4, rot: R() * 6.28, life: 600 })), every: 50 });
    for (let i = 1; i <= 4; i++) V.decal({ tex: "x_dry", x: f.x * TS + f.dx * L * i / 4.5, y: f.y * TS + f.dy * L * i / 4.5, w: L / 3, rot: ang, a: 0.4, life: 2200, sy: 0.5, delay: i * 80 });
    if (C.mine) C.shake(7);
  },
  bati(C, f) {
    const { V, TS } = C;
    V.ring(f.x * TS, f.y * TS, (f.r || 5) * TS, "176,128,30", 600, 9);
    V.actor({ life: 800, draw: (g, t, k) => { g.globalAlpha = 1 - k; g.font = `700 ${Math.round(48 + 20 * k)}px ${KAI}`; g.textAlign = "center"; g.fillStyle = "rgb(168,131,42)"; g.fillText("霸", f.x * TS, f.y * TS - 100 - 20 * k); } });
    aura(C, f.a, (f.bt || 10) * 1000, (g, x, y, t, k) => { const a = 0.35 * (k > 0.92 ? (1 - k) / 0.08 : 1) * (0.75 + 0.25 * Math.sin(t / 150)); V.drawTex(g, "glow", "214,170,60", x, y - 40, 110, 0, a, "a", 1.4); g.globalAlpha = a; g.strokeStyle = "rgb(176,128,30)"; g.lineWidth = 2.5; g.beginPath(); g.ellipse(x, y - 34, 26, 42, 0, 0, 7); g.stroke(); });
    if (C.mine) C.shake(5);
  },
  duanyue(C, f) {
    const { V, TS } = C;
    if (f.dash) { const x0 = f.x * TS, y0 = f.y * TS, L = f.len * TS, tr = V.trail({ w: 16, rgb: "22,20,15", a: 0.45, keep: 320 }); V.actor({ life: 220, update: (t, k) => { tr.add(x0 + f.dx * L * k, y0 + f.dy * L * k, 22 + Math.sin(k * Math.PI) * 110); if (k >= 1) tr.done = true; } }); return; }
    const x = f.x * TS, y = f.y * TS, r = f.r * TS;
    V.ring(x, y, r * 1.2, "22,20,15", 520, 12); V.dust(x, y, r, 16, C.mine);
    V.decal({ tex: "x_crack", x, y, w: r * 2.2, rot: R() * 6.28, a: 0.6, life: 3000 });
    V.emit(10, C.mine, () => ({ tex: "dot", rgb: "60,54,44", x: x + rr(-r / 2, r / 2), y, z: 6, vx: rr(-3, 3), vz: rr(3, 6), g: 0.3, s0: rr(6, 12), s1: 4, a0: 1, life: 700 }));
    if (C.mine) { C.shake(12); C.stop(90); }
  },
  // ---------------- 修羅
  xuewu(C, f) {
    const { V, TS } = C, r = (f.r || 2.8) * TS;
    for (let h = 0; h < 5; h++) setTimeout(() => { const p = C.pos(f.a) || f; V.slash(p.x * TS, p.y * TS - 26, h * 1.3, r * 1.3, "150,30,26", 220, { flip: h % 2 === 1 }); V.emit(5, C.mine, () => { const a = R() * 6.28; return { tex: "dot", rgb: "140,24,20", x: p.x * TS + Math.cos(a) * r * 0.6, y: p.y * TS + Math.sin(a) * r * 0.3, z: 20, vx: Math.cos(a) * 2, vz: rr(1, 3), g: 0.25, s0: 6, s1: 2, a0: 1, life: 450 }; }); }, h * 260);
  },
  shura(C, f) {
    const { V, TS } = C;
    V.p({ tex: "x_splat", rgb: "140,24,20", x: f.x * TS, y: f.y * TS - 40, s0: 60, s1: 180, a0: 0.6, rot: R() * 6.28, life: 600 });
    V.actor({ life: 800, draw: (g, t, k) => { g.globalAlpha = 1 - k; g.font = `700 ${Math.round(50 + 20 * k)}px ${KAI}`; g.textAlign = "center"; g.fillStyle = "rgb(150,24,20)"; g.fillText("殺", f.x * TS, f.y * TS - 100 - 20 * k); } });
    aura(C, f.a, (f.bt || 8) * 1000, (g, x, y, t, k) => { const a = 0.4 * (k > 0.9 ? (1 - k) / 0.1 : 1); V.drawTex(g, "x_bloom", "150,24,20", x, y, 70 + 6 * Math.sin(t / 90), t / 800, a, "m", 0.5); });
    if (C.mine) C.shake(5);
  },
  tulu(C, f) { dashFx(C, f, "140,24,20", 26, (x, y, a) => { C.V.slash(x, y - Z, a, 130, "150,30,26", 260, {}); }); for (let i = 1; i <= 4; i++) C.V.decal({ tex: "x_splat", rgb: "120,20,16", x: (f.x + f.dx * f.len * i / 5) * C.TS, y: (f.y + f.dy * f.len * i / 5) * C.TS, w: 40, rot: R() * 6.28, a: 0.45, life: 2200 }); },
  // ---------------- 真人
  shenlei(C, f) { SKFX.wulei(C, f); },
  jiejie(C, f) {
    const { V, TS } = C, r = (f.r || 6) * TS;
    V.actor({ life: 2200, layer: "g", draw: (g, t, k) => { const p = C.pos(f.a) || f, x = p.x * TS, y = p.y * TS, a = k < 0.12 ? k / 0.12 : k > 0.7 ? (1 - k) / 0.3 : 1; g.save(); g.translate(x, y); g.scale(1, 0.55); V.drawTex(g, "x_taiji", null, 0, 0, 240, t / 600, 0.5 * a, "s"); g.restore(); g.globalAlpha = 0.5 * a; g.strokeStyle = "rgb(176,128,30)"; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r * 0.6, Math.PI, 0); g.stroke(); V.drawTex(g, "glow", "255,220,140", x, y - r * 0.3, r * 1.2, 0, 0.18 * a, "a"); } });
    V.ring(f.x * TS, f.y * TS, r, "176,128,30", 700, 6);
    V.emit(24, C.mine, () => { const [x, y] = inArea(f.x * TS, f.y * TS, 100); return { tex: "glow", rgb: "255,220,140", x, y, vz: rr(0.6, 1.5), s0: rr(8, 14), s1: 2, a0: 0.85, fin: 0.2, life: rr(800, 1300), blend: "a", delay: rr(0, 500) }; });
  },
  leiyu(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS, dur = (f.t || 0) + 600 * ((f.ticks || 1) - 1) + 600;
    V.actor({ life: dur, layer: "g", draw: (g, t, k) => { const a = Math.min(1, k * 10) * (k > 0.9 ? (1 - k) / 0.1 : 1); g.globalAlpha = 0.6 * a; g.strokeStyle = "rgb(60,70,150)"; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= 40; i++) { const q = i / 40 * 6.283, rr2 = r * (1 + (Math.random() - 0.5) * 0.05); i ? g.lineTo(cx + Math.cos(q) * rr2, cy + Math.sin(q) * rr2) : g.moveTo(cx + Math.cos(q) * rr2, cy + Math.sin(q) * rr2); } g.stroke(); V.drawTex(g, "glow", "60,70,140", cx, cy, r * 2, 0, 0.18 * a, "s"); } });
    ticks(f, () => { for (let i = 0; i < 2; i++) { const [x, y] = inArea(cx, cy, r * 0.8); V.actor({ life: 220, draw: (g, t, q) => { const a = 1 - q; V.drawTex(g, "x_bolt", null, x, y - 120, 90, 0, a, "s"); V.drawTex(g, "glow", "150,170,255", x, y - 110, 120, 0, 0.4 * a, "a", 2); } }); V.decal({ tex: "x_crack", rgb: "30,30,50", x, y, w: 60, rot: R() * 6.28, a: 0.35, life: 1800 }); } if (C.mine) { C.shake(4); C.flash("210,220,255", 0.2); } });
  },
  // ---------------- 通靈
  shenjiang(C, f) { const { V, TS } = C; petFx(C, f, (g, x, y, t, k, a) => { const bob = Math.sin(t / 400) * 4; V.drawTex(g, "glow", "255,215,120", x - 44, y - 50 + bob, 110, 0, 0.25 * a, "a", 1.5); C.V.drawTex(g, "x_halo", null, x - 44, y - 92 + bob, 50, t / 2000, 0.4 * a, "s"); C.drawArt && C.drawArt(g, "m_tianjiang", x - 44, y + bob, TS * 1.5, TS * 2.0, { alpha: 0.6 * a }); }); },
  shenjiang_shot(C, f) { const b = C.pos(f.b); if (b) C.V.slash(b.x * C.TS, b.y * C.TS - Z, R() * 6.28, 110, "176,128,30", 220, { flip: R() < 0.5 }); },
  quxie(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = (f.r || 5) * TS;
    for (let i = 0; i < 3; i++) V.actor({ life: 600, delay: i * 140, layer: "g", draw: (g, t, k) => { g.globalAlpha = (1 - k) * 0.7; g.strokeStyle = "rgb(176,128,30)"; g.lineWidth = 6 * (1 - k) + 1; g.beginPath(); g.arc(x, y, r * (0.2 + 0.8 * k), 0, 7); g.stroke(); } });
    V.p({ tex: "x_halo", x, y: y - 70, s0: 40, s1: 120, a0: 0.9, life: 500 });
    if (C.mine) C.shake(6);
  },
  wanling(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS;
    V.ring(x, y, (f.r || 6) * TS, "63,122,82", 700, 5);
    V.emit(30, C.mine, () => { const a = R() * 6.28, d = rr(40, 110); return { tex: "glow", rgb: R() < 0.5 ? "140,220,170" : "255,220,140", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.5, vx: -Math.cos(a) * 1.2, vy: -Math.sin(a) * 0.6, vz: rr(0.8, 1.8), s0: rr(8, 14), s1: 2, a0: 0.9, fin: 0.2, life: rr(900, 1400), blend: "a", delay: rr(0, 400) }; });
  },
  // ---------------- 炎帝
  yanlong(C, f) { SKFX.dragon(C, f); shot(C, f, { shadow: 60, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "glow", "255,140,50", x, y, 120, 0, 0.6 * fade, "a"); C.V.drawTex(g, "x_flame", null, x, y, 60, a + 1.57, fade, "s"); } }); },
  baoyan(C, f) {
    toTarget(C, f, 200, (g, x, y) => { C.V.drawTex(g, "glow", "255,140,50", x, y, 60, 0, 0.8, "a"); C.V.drawTex(g, "x_flame", null, x, y, 30, 3.14, 1, "s"); }, (x, y) => {
      const { V } = C;
      V.p({ tex: "glow", rgb: "255,150,60", x, y: y - 30, s0: 220, s1: 60, a0: 0.85, life: 380, blend: "a" });
      V.emit(18, C.mine, () => { const a = R() * 6.28, v = rr(2, 5); return { tex: "x_flame", x, y, z: 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(1, 3), g: 0.05, drag: 0.05, s0: rr(26, 40), s1: 8, a0: 0.95, life: rr(400, 650) }; });
      V.ring(x, y, 2.2 * C.TS, "160,50,24", 420, 8); V.decal({ tex: "x_bloom", rgb: "100,50,30", x, y, w: 110, a: 0.35, life: 2400 });
      if (C.mine) { C.shake(8); C.stop(70); }
    });
  },
  fencheng(C, f) { SKFX.huohai(C, f); SKFX.inferno(C, f); },
  // ---------------- 九幽
  guihuo(C, f) { shot(C, f, { trail: { w: 10, rgb: "90,200,180", a: 0.45, keep: 280, blend: "a" }, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "glow", "110,220,200", x, y, 56, 0, 0.8 * fade, "a"); C.V.drawTex(g, "x_flame", "70,170,160", x, y, 28, a + 1.57 + 3.14, fade, "s"); } }); },
  zuzhou(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS;
    V.actor({ life: 8000, layer: "g", draw: (g, t, k) => { const a = Math.min(1, k * 15) * (k > 0.88 ? (1 - k) / 0.12 : 1); V.drawTex(g, "x_web", "80,30,90", x, y, r * 2, t / 4000, 0.45 * a, "m"); } });
    V.actor({ life: 900, draw: (g, t, k) => { g.globalAlpha = 1 - k; g.font = `700 ${Math.round(60 + 20 * k)}px ${KAI}`; g.textAlign = "center"; g.fillStyle = "rgb(80,30,90)"; g.fillText("咒", x, y - 60 - 20 * k); } });
    V.emit(16, C.mine, () => { const [px, py] = inArea(x, y, r * 0.8); return { tex: "x_mist", rgb: "90,40,100", x: px, y: py, z: 10, vz: rr(0.2, 0.6), rot: R() * 6.28, s0: 30, s1: 60, a0: 0.45, life: rr(900, 1400) }; });
  },
  huangquan(C, f) {
    const { V, TS } = C, cx = f.x * TS, cy = f.y * TS, r = f.r * TS, dur = (f.t || 0) + 600 * ((f.ticks || 1) - 1) + 700;
    V.decal({ tex: "x_bloom", rgb: "130,110,60", x: cx, y: cy, w: r * 2.1, a: 0.4, life: dur + 1000, sy: 0.6 });
    V.actor({ life: dur, layer: "g", draw: (g, t, k) => { const a = 0.55 * Math.min(1, k * 8) * (k > 0.85 ? (1 - k) / 0.15 : 1); g.globalAlpha = a; g.strokeStyle = "rgb(150,130,70)"; g.lineWidth = 2; for (let i = 0; i < 5; i++) { const s0 = -t / 500 + i * 1.25; g.beginPath(); g.arc(cx, cy, r * (0.25 + 0.15 * i), s0, s0 + 2); g.stroke(); } } });
    ticks(f, () => V.emit(8, C.mine, () => { const [x, y] = inArea(cx, cy, r * 0.85); return { tex: "x_mist", rgb: "150,130,80", x, y, z: 4, vz: rr(0.4, 1), rot: R() * 6.28, s0: 24, s1: 50, a0: 0.5, life: 800 }; }));
  },
  // ---------------- 箭神
  guanri(C, f) { shot(C, f, { shadow: 34, trail: { w: 12, rgb: "255,220,140", a: 0.9, keep: 380, blend: "a" }, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "glow", "255,220,140", x, y, 90, 0, 0.8 * fade, "a"); C.V.drawTex(g, "x_arrow", null, x, y, 90, a, fade, "s"); } }); C.V.p({ tex: "x_halo", x: f.x * C.TS + f.dx * 24, y: f.y * C.TS - Z, rot: Math.atan2(f.dy, f.dx), s0: 50, s1: 150, a0: 0.9, life: 380 }); if (C.mine) C.shake(4); },
  shenyan(C, f) { SKFX.yingyan(C, { ...f }); },
  luori(C, f) {
    const { V, TS } = C, a0 = C.pos(f.a) || f;
    V.actor({ life: 500, draw: (g, t, k) => { const x = a0.x * TS - 40, y = a0.y * TS - 110; g.globalAlpha = 0.6 * (1 - k); g.fillStyle = "rgb(200,70,40)"; g.beginPath(); g.arc(x, y, 40 + 10 * k, 0, 7); g.fill(); } });
    toTarget(C, f, 220, (g, x, y, a) => { V.drawTex(g, "glow", "255,170,90", x, y, 90, 0, 0.7, "a"); V.drawTex(g, "x_arrow", "120,40,24", x, y, 100, a, 1, "s"); }, (x, y) => { V.p({ tex: "glow", rgb: "255,170,90", x, y: y - Z, s0: 200, s1: 40, a0: 0.9, life: 360, blend: "a" }); V.decal({ tex: "x_splat", rgb: "120,40,24", x, y, w: 100, rot: R() * 6.28, a: 0.4, life: 2200 }); if (C.mine) { C.shake(9); C.stop(80); } });
  },
  // ---------------- 破軍
  baolie(C, f) {
    const { V, TS } = C, a0 = C.pos(f.a) || f, x = f.x * TS, y = f.y * TS, r = f.r * TS, d = f.t || 300;
    V.actor({ life: d, draw: (g, t, k) => { const px = (a0.x + (f.x - a0.x) * k) * TS, py = (a0.y + (f.y - a0.y) * k) * TS - 30 - Math.sin(k * Math.PI) * 80; V.drawTex(g, "x_flame", null, px, py, 26, Math.atan2(f.y - a0.y, f.x - a0.x) - 1.57, 1, "s"); V.drawTex(g, "x_arrow", null, px, py, 40, Math.atan2(f.y - a0.y, f.x - a0.x), 1, "s"); } });
    setTimeout(() => { V.p({ tex: "glow", rgb: "255,150,60", x, y: y - 20, s0: r * 2.4, s1: r * 0.6, a0: 0.85, life: 380, blend: "a" }); V.emit(20, C.mine, () => { const a = R() * 6.28, v = rr(2, 5); return { tex: R() < 0.6 ? "x_flame" : "x_bloom", rgb: null, x, y, z: 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(1, 3), drag: 0.05, s0: rr(24, 36), s1: 10, a0: 0.9, rot: R() * 6.28, life: rr(400, 700) }; }); V.ring(x, y, r, "160,50,24", 420, 8); V.decal({ tex: "x_crack", rgb: "60,26,14", x, y, w: r * 1.6, rot: R() * 6.28, a: 0.45, life: 2400 }); if (C.mine) C.shake(7); }, d);
  },
  huoyu(C, f) { SKFX.liuxing(C, f); },
  pojun(C, f) { SKFX.chuanyun(C, f); shot(C, f, { shadow: 90, draw: (g, x, y, a, fade) => { C.V.drawTex(g, "x_slash", "150,40,24", x, y, 150, a, 0.6 * fade, "s"); } }); if (C.mine) C.shake(7); },
  // ---------------- 影殺
  yingdun(C, f) {
    const { V, TS } = C;
    V.emit(18, C.mine, () => { const a = R() * 6.28, v = rr(0.8, 2.2); return { tex: "x_bloom", rgb: "24,20,30", x: f.x * TS, y: f.y * TS, z: 30, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rr(0, 1), drag: 0.05, s0: 26, s1: 70, a0: 0.55, rot: R() * 6.28, life: rr(500, 800) }; });
    aura(C, f.a, (f.bt || 5) * 1000, (g, x, y, t, k) => { V.drawTex(g, "x_bloom", "24,20,30", x + Math.sin(t / 200) * 8, y - 30, 50, t / 900, 0.18 * (1 - k), "s", 1.6); });
  },
  jueying(C, f) { if (f.blinkTo) return blinkFx(C, f); hitSlashes(C, f, 3, 140, "30,24,36", 70); },
  qianying(C, f) {
    const { V, TS } = C, r = (f.r || 4) * TS;
    for (let h = 0; h < 8; h++) setTimeout(() => { const p = C.pos(f.a) || f, a = R() * 6.28, x = p.x * TS + Math.cos(a) * r * 0.6, y = p.y * TS + Math.sin(a) * r * 0.35; V.p({ tex: "x_bloom", rgb: "24,20,30", x, y: y - 30, s0: 30, s1: 40, sy: 1.8, a0: 0.55, a1: 0, life: 400 }); V.slash(x, y - 30, a + 3.14, 80, "30,24,36", 200, { flip: h % 2 === 1 }); }, h * 260);
  },
  // ---------------- 機關
  paotai(C, f) { petFx(C, f, (g, x, y, t, k, a) => turret(g, x + 30, y + 6, a)); C.V.dust(f.x * C.TS + 30, f.y * C.TS, 20, 4, C.mine); },
  paotai_shot(C, f) { const { V, TS } = C, b = C.pos(f.b); if (!b) return; const x0 = f.x * TS + 30, y0 = f.y * TS - 14, x1 = b.x * TS, y1 = b.y * TS - Z, ang = Math.atan2(y1 - y0, x1 - x0); V.actor({ life: 110, draw: (g, t, k) => V.drawTex(g, "x_arrow", null, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 30, ang, 1, "s") }); },
  dilei(C, f) {
    const { V, TS } = C, x = f.x * TS, y = f.y * TS, r = f.r * TS, d = f.t || 1200, pts = [0, 1, 2, 3].map((i) => inArea(x, y, r * 0.6));
    V.actor({ life: d, layer: "g", draw: (g, t, k) => { for (const [px, py] of pts) { g.globalAlpha = 1; g.fillStyle = "rgb(50,44,36)"; g.beginPath(); g.ellipse(px, py, 9, 4, 0, 0, 7); g.fill(); if (Math.floor(t / (k > 0.6 ? 90 : 220)) % 2) { g.fillStyle = "rgb(200,50,30)"; g.beginPath(); g.arc(px, py - 2, 2.5, 0, 7); g.fill(); } } } });
    setTimeout(() => { for (const [px, py] of pts) { V.p({ tex: "glow", rgb: "255,150,60", x: px, y: py - 10, s0: 90, s1: 20, a0: 0.8, life: 300, blend: "a" }); V.emit(8, C.mine, () => ({ tex: R() < 0.5 ? "x_flame" : "x_bloom", x: px, y: py, z: 6, vx: rr(-3, 3), vy: rr(-1.5, 1.5), vz: rr(1, 4), drag: 0.05, s0: 26, s1: 10, a0: 0.9, rot: R() * 6.28, life: 500 })); V.decal({ tex: "x_crack", rgb: "50,30,20", x: px, y: py, w: 60, rot: R() * 6.28, a: 0.45, life: 2200 }); } V.ring(x, y, r, "60,44,30", 420, 8); if (C.mine) C.shake(8); }, d);
  },
  qianji(C, f) { petFx(C, f, (g, x, y, t, k, a) => { for (const [dx, dy] of [[-34, -10], [34, -10], [0, 22]]) turret(g, x + dx, y + dy, a, 0.85); }); },
  qianji_shot(C, f) { const { V, TS } = C, b = C.pos(f.b); if (!b) return; const o = [[-34, -10], [34, -10], [0, 22]][Math.floor(R() * 3)], x0 = f.x * TS + o[0], y0 = f.y * TS + o[1] - 14, x1 = b.x * TS, y1 = b.y * TS - Z, ang = Math.atan2(y1 - y0, x1 - x0); V.actor({ life: 100, draw: (g, t, k) => V.drawTex(g, "x_arrow", null, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 28, ang, 1, "s") }); },
});
Object.assign(SK_EL, { jianyi: "ice", baoyan: "fire", yanlong: "fire", fencheng: "fire", guihuo: "poison", zuzhou: "poison", huangquan: "poison", shenlei: "thunder", leiyu: "thunder", baolie: "fire", huoyu: "fire", guanri: "gold", luori: "fire", xuewu: "blood", tulu: "blood", zhuxie: "ice" });
