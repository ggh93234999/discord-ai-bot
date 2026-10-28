// 彈珠台（單人）：左右擋板接球、撞彈跳器拿分，3 顆球。整個物理在瀏覽器裡跑，不需要伺服器。
// 操作：← / Z 左擋板，→ / M 右擋板，↓ / 空白鍵 按住蓄力、放開發射；手機用下方三顆按鈕。
const W = 400, H = 740, R = 8, G = 820, DT = 1 / 240;
const LS = "pinhigh", VK = "pinvol";
const FL = { L: 62, rest: 0.49, act: -0.52, w: 17, th: 6 };           // 擋板長度、休息角度、擊球角度（弧度）、轉速、半徑
const PIV = { l: [125, 625], r: [275, 625] };
const GATE = [350, 232, 380, 205];
const WALLS = [[20, 200, 20, 560], [20, 560, 125, 625], [350, 560, 275, 625], [350, 230, 350, 670], [380, 200, 380, 670], [350, 670, 380, 670]];
const SLINGS = [[60, 470, 108, 548], [338, 470, 292, 548]];             // 彈力片
const BUMPERS = [{ x: 140, y: 250, r: 22, pts: 100 }, { x: 260, y: 250, r: 22, pts: 100 }, { x: 200, y: 335, r: 22, pts: 100 }, { x: 100, y: 410, r: 15, pts: 50 }, { x: 290, y: 410, r: 15, pts: 50 }];
const BANKS = [   // 掉落靶：整排打倒有大獎
  { y: [[290, 312], [322, 344], [354, 376]], x: 50, name: "L" },
  { y: [[290, 312], [322, 344], [354, 376]], x: 320, name: "R" },
];
const SPIN = { x: 200, y: 168, hw: 26 };                              // 旋轉閘
const HOLE = { x: 90, y: 182, r: 13 };                                // 吸球洞
const SAVE_MS = 8000;                                                 // 開球後的救球時間
let BG = null; { const u = Object.values(import.meta.glob("./pin-art/bg.jpg", { eager: true, query: "?url", import: "default" }))[0]; if (u) { BG = new Image(); BG.src = u; } }
const LIGHTS = [{ x: 150, y: 120 }, { x: 200, y: 105 }, { x: 250, y: 120 }];   // 上方的三個滾過感應點

export function mountPinball(root, { env, back }) {
  root.innerHTML = `
    <div class="game gomoku pinball">
      <header><button class="back">← 選單</button><h2>彈珠台</h2><span class="right"><label class="pvol">🔊 <input type="range" class="pv" min="0" max="100"></label></span></header>
      <div class="status">按住「發射」蓄力，放開把球射出去</div>
      <div class="cwrap"><canvas></canvas></div>
      <div class="pad"><button data-k="l">◀ 左</button><button data-k="p" class="plunge">發射</button><button data-k="r">右 ▶</button></div>
      <div class="actions"><button class="again" hidden>再來一局</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d"), statusEl = $(".status"), againBtn = $(".again");
  $(".back").addEventListener("click", () => { cleanup(); back(); });

  // ---- 音效（簡單的合成音，音量記在瀏覽器）
  let ac = null, vol = 0.5;
  try { const v = localStorage.getItem(VK); if (v != null) vol = Math.max(0, Math.min(1, Number(v))); } catch {}
  vol = 1;                                    // 音量改由右下角的全域音量鈕控制
  const pv = $(".pv"); pv.value = Math.round(vol * 100);
  pv.addEventListener("input", () => { vol = Number(pv.value) / 100; try { localStorage.setItem(VK, String(vol)); } catch {} });
  const beep = (f, d = 0.08, type = "square", g = 0.15) => {
    if (!vol) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), a = ac.createGain();
      o.type = type; o.frequency.value = f; a.gain.value = g * vol;
      a.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
      o.connect(a); a.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
    } catch {}
  };

  // ---- 遊戲狀態
  let high = 0; try { high = Number(localStorage.getItem(LS)) || 0; } catch {}
  let ball, balls, score, mult, lit, state, charge, flash = {}, tg, spinA = 0, spinV = 0, combo = 0, comboT = 0, parts = [], pops = [], trail = [], banner = null, saveT = 0, bankT = {}, now = 0, fl, keys = { l: false, r: false, p: false }, last = 0, acc = 0, raf = 0, closed = false;
  const newFlip = (dir, pv) => ({ dir, pv, a: FL.rest, w: 0 });
  function reset() {
    balls = 3; score = 0; mult = 1; lit = [false, false, false]; flash = {}; tg = BANKS.map((b) => b.y.map(() => true)); spinV = 0; combo = 0; parts = []; pops = []; trail = []; banner = null; bankT = {};
    fl = { l: newFlip(1, PIV.l), r: newFlip(-1, PIV.r) };
    againBtn.hidden = true; serve();
  }
  function serve() { ball = { x: 365, y: 648, vx: 0, vy: 0 }; state = "ready"; charge = 0; trail = []; saveT = 0; text(); }
  function text() {
    statusEl.textContent = state === "over" ? `遊戲結束　得分 ${score}${score >= high && score > 0 ? "　🏆 新紀錄！" : ""}　最高 ${high}` :
      `得分 ${score}　×${mult}　剩 ${balls} 顆　最高 ${high}${state === "ready" ? "　（按住「發射」蓄力）" : ""}`;
  }
  const add = (n) => { score += n * mult; text(); };
  // 得分：連擊（1.5 秒內再得分）會多加分，並冒出飄字與火花
  function scoreAt(n, x, y, col = "#ffd54f", spark = 8) {
    combo = now - comboT < 1.5 ? combo + 1 : 1; comboT = now;
    const bonus = combo >= 3 ? Math.min(combo, 10) * 10 : 0;
    add(n + bonus);
    pops.push({ x, y, t: 0.8, txt: "+" + (n + bonus) * mult + (combo >= 3 ? `  連擊 ×${combo}` : ""), col });
    for (let i = 0; i < spark; i++) { const a = Math.random() * 6.283, v = 60 + Math.random() * 160; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.4 + Math.random() * 0.3, col }); }
  }
  const say = (txt, col = "#ffd54f") => { banner = { txt, col, t: 1.4 }; };

  // ---- 碰撞
  function hitSeg(b, ax, ay, bx, by, thick, e, kick, fp) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = ((b.x - ax) * dx + (b.y - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    let nx = b.x - px, ny = b.y - py, d = Math.hypot(nx, ny);
    const rr = R + thick;
    if (d >= rr) return false;
    if (d < 1e-6) { nx = -dy; ny = dx; d = Math.hypot(nx, ny); }
    nx /= d; ny /= d;
    b.x = px + nx * rr; b.y = py + ny * rr;                         // 推出牆外
    let sx = 0, sy = 0;                                               // 擋板表面在接觸點的速度
    if (fp) { const rx = px - fp.pv[0], ry = py - fp.pv[1]; sx = -fp.w * ry; sy = fp.w * rx; }
    const rvx = b.vx - sx, rvy = b.vy - sy, vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const j = -(1 + e) * vn;
      b.vx += j * nx; b.vy += j * ny;
      if (kick) { b.vx += nx * kick; b.vy += ny * kick; }
    }
    return vn < -40;
  }
  function hitCircle(b, c, e, kick) {
    const nx0 = b.x - c.x, ny0 = b.y - c.y, d = Math.hypot(nx0, ny0), rr = R + c.r;
    if (d >= rr) return false;
    const nx = nx0 / d, ny = ny0 / d;
    b.x = c.x + nx * rr; b.y = c.y + ny * rr;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
    b.vx += nx * kick; b.vy += ny * kick;
    return true;
  }
  function flipEnd(f) { return [f.pv[0] + f.dir * FL.L * Math.cos(f.a), f.pv[1] + FL.L * Math.sin(f.a)]; }

  function step() {
    now += DT;
    // 擋板
    for (const k of ["l", "r"]) {
      const f = fl[k], tgt = keys[k] ? FL.act : FL.rest, old = f.a;
      const dA = Math.sign(tgt - f.a) * Math.min(Math.abs(tgt - f.a), FL.w * DT);
      f.a += dA; f.w = ((f.a - old) / DT) * f.dir;                    // 接觸點的表面速度用；右擋板是鏡像，所以乘 dir
    }
    if (state === "ready") {
      if (keys.p) charge = Math.min(1, charge + DT * 1.1);
      ball.vx = 0; ball.vy = 0; ball.y = 648;
      return;
    }
    spinA += spinV * DT; spinV *= 0.985;
    for (const p of parts) { p.x += p.vx * DT; p.y += p.vy * DT; p.vy += 300 * DT; p.t -= DT; }
    parts = parts.filter((p) => p.t > 0);
    for (const q of pops) { q.t -= DT; q.y -= 22 * DT; }
    pops = pops.filter((q) => q.t > 0);
    if (banner) { banner.t -= DT; if (banner.t <= 0) banner = null; }
    if (state !== "play") return;
    if (ball.hold > 0) { ball.hold -= DT; if (ball.hold <= 0) { ball.hold = 0; ball.vx = 380 + Math.random() * 160; ball.vy = 380 + Math.random() * 220; ball.ignoreHole = 0.4; for (let k = 0; k < 10; k++) parts.push({ x: HOLE.x, y: HOLE.y, vx: (Math.random() - 0.2) * 220, vy: (Math.random() - 0.2) * 220, t: 0.4, col: "#ff9800" }); beep(420, 0.12, "sawtooth"); } return; }
    if (now % 0.04 < DT) { trail.push([ball.x, ball.y]); if (trail.length > 9) trail.shift(); }
    if (saveT > 0) saveT -= DT;
    ball.stuck = Math.hypot(ball.vx, ball.vy) < 25 ? (ball.stuck || 0) + DT : 0;
    if (ball.stuck > 1) { ball.vx += (Math.random() < 0.5 ? -1 : 1) * 160; ball.vy -= 120; ball.stuck = 0; }     // 卡住不動就輕輕震一下
    ball.vy += G * DT;
    const sp = Math.hypot(ball.vx, ball.vy); if (sp > 1500) { ball.vx *= 1500 / sp; ball.vy *= 1500 / sp; }
    ball.x += ball.vx * DT; ball.y += ball.vy * DT;
    // 上方圓弧
    const cx = 200, cy = 200, rad = 180, dx = ball.x - cx, dy = ball.y - cy, d = Math.hypot(dx, dy);
    if (ball.y < cy && d > rad - R) {
      const nx = -dx / d, ny = -dy / d;
      ball.x = cx + (dx / d) * (rad - R); ball.y = cy + (dy / d) * (rad - R);
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) { ball.vx -= 1.5 * vn * nx; ball.vy -= 1.5 * vn * ny; }
    }
    for (const w of WALLS) hitSeg(ball, w[0], w[1], w[2], w[3], 2, 0.45, 0, null);
    if (ball.vy > 0) hitSeg(ball, 350, 232, 380, 205, 2, 0.3, 0, null);       // 單向閘門：往上射出去的球會穿過，掉下來的球會被擋到場內
    if (ball.x > 352 && ball.y > 630 && Math.hypot(ball.vx, ball.vy) < 80) { ball.x = 365; ball.y = 648; ball.vx = ball.vy = 0; state = "ready"; charge = 0; text(); return; }   // 球掉回發射道就重新發射
    for (let i = 0; i < SLINGS.length; i++) { const s = SLINGS[i]; if (hitSeg(ball, s[0], s[1], s[2], s[3], 3, 0.9, 260, null)) { add(10); flash["s" + i] = 6; beep(300, 0.05); scoreAt(10, (s[0] + s[2]) / 2, (s[1] + s[3]) / 2, "#ff5ca8", 4); } }
    BUMPERS.forEach((c, i) => { if (hitCircle(ball, c, 0.9, c.r > 18 ? 330 : 380)) { flash["b" + i] = 8; beep(520 + i * 90, 0.09, "triangle"); scoreAt(c.pts, c.x, c.y - c.r, "#ffd54f", 10); } });
    // 掉落靶
    BANKS.forEach((bk, bi) => {
      bk.y.forEach((r, ti) => {
        if (!tg[bi][ti]) return;
        if (hitSeg(ball, bk.x, r[0], bk.x, r[1], 3, 0.5, 120, null)) { tg[bi][ti] = false; beep(700 + ti * 80, 0.07, "square", 0.1); scoreAt(150, bk.x, (r[0] + r[1]) / 2, "#4dd0e1", 8); }
      });
      if (!tg[bi].some(Boolean) && !bankT[bi]) { bankT[bi] = 1.2; add(2000); say(bk.name === "L" ? "左靶全倒！+2000" : "右靶全倒！+2000", "#4dd0e1"); beep(1000, 0.3, "sine"); for (let k = 0; k < 24; k++) { const a = Math.random() * 6.283, v = 80 + Math.random() * 200; parts.push({ x: bk.x, y: 330, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.8, col: "#4dd0e1" }); } }
      if (bankT[bi]) { bankT[bi] -= DT; if (bankT[bi] <= 0) { bankT[bi] = 0; tg[bi] = bk.y.map(() => true); } }
    });
    // 旋轉閘：球經過就轉、就得分
    if (Math.abs(ball.x - SPIN.x) < SPIN.hw && ((ball.y - ball.vy * DT < SPIN.y) !== (ball.y < SPIN.y))) { spinV = Math.min(40, spinV + 16); scoreAt(25, SPIN.x, SPIN.y - 14, "#b388ff", 3); beep(1000 + Math.random() * 200, 0.03, "sine", 0.06); }
    // 吸球洞：停住 0.9 秒再斜斜射出
    if (ball.ignoreHole > 0) ball.ignoreHole -= DT;
    if (!ball.hold && !(ball.ignoreHole > 0) && Math.hypot(ball.x - HOLE.x, ball.y - HOLE.y) < HOLE.r - 2 && Math.hypot(ball.vx, ball.vy) < 900) { ball.hold = 0.9; ball.x = HOLE.x; ball.y = HOLE.y; ball.vx = ball.vy = 0; scoreAt(500, HOLE.x, HOLE.y - 18, "#ff9800", 14); beep(260, 0.2, "triangle"); }
    for (const k of ["l", "r"]) {
      const f = fl[k], e = flipEnd(f);
      hitSeg(ball, f.pv[0], f.pv[1], e[0], e[1], FL.th, 0.35, 0, { pv: f.pv, w: f.w });
    }
    LIGHTS.forEach((p, i) => { if (!lit[i] && Math.hypot(ball.x - p.x, ball.y - p.y) < R + 9) { lit[i] = true; add(50); beep(880, 0.07, "sine"); if (lit.every(Boolean)) { add(1000); mult = Math.min(5, mult + 1); lit = [false, false, false]; beep(1200, 0.25, "sine"); say(`得分倍率 ×${mult}！`); text(); } } });
    if (ball.y > H - 5 && saveT > 0) { saveT = 0; say("救球！", "#69f0ae"); serve(); return; }
    if (ball.y > H - 5) { balls--; beep(150, 0.3, "sawtooth"); if (balls > 0) serve(); else { state = "over"; if (score > high) { high = score; try { localStorage.setItem(LS, String(high)); } catch {} } againBtn.hidden = false; text(); } }
  }

  function launch() {
    if (state !== "ready") return;
    const v = 940 + charge * 500;
    ball.vy = -v; ball.vx = 0; state = "play"; charge = 0; saveT = SAVE_MS / 1000; saveT0 = performance.now(); beep(240, 0.15, "sawtooth"); text();
  }

  // ---- 畫面
  let scale = 1, saveT0 = 0;
  function resize() {
    const wrap = $(".cwrap");
    const s = Math.min((wrap.clientWidth || W) / W, (wrap.clientHeight || H) / H);
    scale = Math.max(0.25, s);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.round(W * scale) + "px"; canvas.style.height = Math.round(H * scale) + "px";
    canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  function glowStroke(col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowColor = col; ctx.shadowBlur = 8; }
  function draw() {
    ctx.fillStyle = "#0b0d1a"; ctx.fillRect(0, 0, W, H);
    if (BG && BG.complete && BG.naturalWidth) { const k = H / BG.naturalHeight, w = BG.naturalWidth * k; ctx.globalAlpha = 0.42; ctx.drawImage(BG, (W - w) / 2, 0, w, H); ctx.globalAlpha = 1; }
    else { const g = ctx.createRadialGradient(200, 360, 40, 200, 360, 420); g.addColorStop(0, "#1a1e3d"); g.addColorStop(1, "#0b0d1a"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    ctx.lineCap = "round";
    glowStroke("#3fa7ff", 3);
    ctx.beginPath(); ctx.arc(200, 200, 180, Math.PI, 0); ctx.stroke();
    for (const w of WALLS) { ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke(); }
    glowStroke("#7cc4ff", 2); ctx.beginPath(); ctx.moveTo(GATE[0], GATE[1]); ctx.lineTo(GATE[2], GATE[3]); ctx.stroke(); glowStroke("#3fa7ff", 3);
    SLINGS.forEach((s, i) => { glowStroke(flash["s" + i] ? "#fff" : "#ff5ca8", 5); ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke(); });
    BUMPERS.forEach((c, i) => {
      const f = flash["b" + i] > 0, r = c.r + (f ? 3 : 0);
      ctx.shadowColor = f ? "#fff" : "#ffb300"; ctx.shadowBlur = f ? 26 : 10;
      const g = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.35, 2, c.x, c.y, r);
      g.addColorStop(0, f ? "#ffffff" : "#ffe082"); g.addColorStop(0.55, f ? "#fff3b0" : "#ffb300"); g.addColorStop(1, f ? "#ffd54f" : "#a66b00");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(60,30,0,.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.66, 0, 7); ctx.stroke();
      ctx.fillStyle = "#3b2f00"; ctx.font = `bold ${c.r > 18 ? 14 : 11}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(c.pts), c.x, c.y);
    });
    // 掉落靶
    BANKS.forEach((bk, bi) => bk.y.forEach((r, ti) => {
      ctx.shadowColor = "#4dd0e1"; ctx.shadowBlur = tg[bi][ti] ? 10 : 0; ctx.strokeStyle = tg[bi][ti] ? "#4dd0e1" : "rgba(77,208,225,.18)"; ctx.lineWidth = 7; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(bk.x, r[0]); ctx.lineTo(bk.x, r[1]); ctx.stroke(); ctx.lineCap = "round";
    }));
    ctx.shadowBlur = 0;
    // 旋轉閘
    { const w = Math.max(3, SPIN.hw * 2 * Math.abs(Math.cos(spinA))); ctx.shadowColor = "#b388ff"; ctx.shadowBlur = 8; ctx.fillStyle = "#b388ff"; ctx.fillRect(SPIN.x - w / 2, SPIN.y - 3, w, 6); ctx.shadowBlur = 0; ctx.fillStyle = "#5e3fb0"; ctx.fillRect(SPIN.x - SPIN.hw - 4, SPIN.y - 5, 4, 10); ctx.fillRect(SPIN.x + SPIN.hw, SPIN.y - 5, 4, 10); }
    // 吸球洞
    { const h = HOLE; const g = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r + 4); g.addColorStop(0, "#000"); g.addColorStop(0.75, "#1a0f00"); g.addColorStop(1, "#ff9800"); ctx.fillStyle = g; ctx.shadowColor = "#ff9800"; ctx.shadowBlur = ball && ball.hold ? 20 : 8; ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 3, 0, 7); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = "#ffcc80"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("500", h.x, h.y + h.r + 12); }
    LIGHTS.forEach((p, i) => { ctx.shadowColor = "#7cff7c"; ctx.shadowBlur = lit[i] ? 14 : 0; ctx.fillStyle = lit[i] ? "#7cff7c" : "#2c4a2c"; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fill(); });
    for (const k of ["l", "r"]) {
      const f = fl[k], e = flipEnd(f);
      glowStroke("#fff", FL.th * 2); ctx.beginPath(); ctx.moveTo(f.pv[0], f.pv[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (state === "ready") {                                         // 發射器的彈簧與蓄力條
      ctx.fillStyle = "#555"; ctx.fillRect(354, 662 + charge * 6, 24, 8);
      ctx.fillStyle = "#ffb300"; ctx.fillRect(386, 700 - charge * 90, 6, charge * 90 + 2);
    }
    trail.forEach((p, i) => { ctx.globalAlpha = (i + 1) / trail.length * 0.35; ctx.fillStyle = "#9fd8ff"; ctx.beginPath(); ctx.arc(p[0], p[1], R * (0.4 + 0.5 * (i + 1) / trail.length), 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
    if (!ball.hold) {
      ctx.shadowColor = "#fff"; ctx.shadowBlur = 10;
      const bg = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, R); bg.addColorStop(0, "#fff"); bg.addColorStop(1, "#9aa7b0"); ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, R, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    }
    for (const p of parts) { ctx.globalAlpha = Math.max(0, p.t * 2); ctx.fillStyle = p.col; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const q of pops) { ctx.globalAlpha = Math.min(1, q.t * 2); ctx.fillStyle = q.col; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 3; ctx.strokeText(q.txt, q.x, q.y); ctx.fillText(q.txt, q.x, q.y); }
    ctx.globalAlpha = 1;
    if (saveT > 0) { ctx.fillStyle = "rgba(105,240,174,.9)"; ctx.fillRect(20, H - 6, (W - 40) * (saveT / (SAVE_MS / 1000)), 3); }
    if (banner) { ctx.globalAlpha = Math.min(1, banner.t * 2); ctx.font = "bold 26px sans-serif"; ctx.textBaseline = "middle"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 5; ctx.strokeText(banner.txt, 200, 130); ctx.fillStyle = banner.col; ctx.fillText(banner.txt, 200, 130); ctx.globalAlpha = 1; }
    ctx.fillStyle = "#cfd8dc"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(String(score), 200, 34);
    if (mult > 1) { ctx.fillStyle = "#ffd54f"; ctx.font = "bold 14px sans-serif"; ctx.fillText(`×${mult}`, 200, 62); }
    if (state === "over") { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(40, 300, 320, 120); ctx.fillStyle = "#fff"; ctx.font = "bold 30px sans-serif"; ctx.textBaseline = "middle"; ctx.fillText("遊戲結束", 200, 345); ctx.font = "18px sans-serif"; ctx.fillText(`得分 ${score}`, 200, 385); }
    for (const k in flash) if (flash[k] > 0) flash[k]--;
  }

  function frame(t) {
    if (closed) return;
    if (!last) last = t;
    acc += Math.min(0.05, (t - last) / 1000); last = t;
    while (acc >= DT) { step(); acc -= DT; }
    draw(); raf = requestAnimationFrame(frame);
  }

  // ---- 輸入
  const KEYMAP = { ArrowLeft: "l", KeyZ: "l", KeyA: "l", ArrowRight: "r", KeyM: "r", KeyD: "r", ArrowDown: "p", Space: "p", KeyS: "p" };
  const press = (k, down) => { if (k === "p" && !down && keys.p) { keys.p = false; launch(); return; } if (k === "l" || k === "r") { if (down && !keys[k]) beep(180, 0.03, "square", 0.08); } keys[k] = down; };
  const kd = (e) => { const k = KEYMAP[e.code]; if (!k) return; e.preventDefault(); press(k, true); };
  const ku = (e) => { const k = KEYMAP[e.code]; if (!k) return; e.preventDefault(); press(k, false); };
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
  root.querySelectorAll(".pad button").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} press(k, true); });
    const up = (e) => { e.preventDefault(); press(k, false); };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", () => { if (keys[k]) press(k, false); });
  });
  againBtn.addEventListener("click", reset);
  window.addEventListener("resize", resize);

  function cleanup() { closed = true; cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("resize", resize); try { ac && ac.close(); } catch {} }
  reset(); requestAnimationFrame(() => { resize(); raf = requestAnimationFrame(frame); });
  return cleanup;
}
