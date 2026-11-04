// 俄羅斯方塊對戰（參考 Tetris Battle）。移動、旋轉、落下都在這裡算（手感好），
// 伺服器只中繼對方盤面、管待接垃圾行和判定勝負。兩邊用同一個 seed，方塊順序完全一樣（7 個一包）。
import { wsUrl } from "./gomoku.js";

const COLS = 10, ROWS = 22, HID = 2;                       // 上面 2 列是看不到的緩衝區
const NAMES = "IJLOSTZ";
const COLORS = { I: "#31c7ef", J: "#5a65ad", L: "#ef7921", O: "#f7d308", S: "#42b642", T: "#ad4d9c", Z: "#ef2029", G: "#7b7f86" };
const CELLS = {      // [x,y] 都在 n×n 方框裡（0 度）
  I: [4, [[0, 1], [1, 1], [2, 1], [3, 1]]], O: [4, [[1, 0], [2, 0], [1, 1], [2, 1]]],
  J: [3, [[0, 0], [0, 1], [1, 1], [2, 1]]], L: [3, [[2, 0], [0, 1], [1, 1], [2, 1]]],
  S: [3, [[1, 0], [2, 0], [0, 1], [1, 1]]], Z: [3, [[0, 0], [1, 0], [1, 1], [2, 1]]], T: [3, [[1, 0], [0, 1], [1, 1], [2, 1]]],
};
const SHAPES = {};       // SHAPES[type][rot] = [[x,y]...]
for (const t of NAMES) {
  const [n, base] = CELLS[t]; SHAPES[t] = [base];
  for (let r = 1; r < 4; r++) SHAPES[t].push(SHAPES[t][r - 1].map(([x, y]) => [n - 1 - y, x]));
}
// SRS 踢牆表（原表 y 朝上，這裡轉成 y 朝下）
const K_JLSTZ = { "01": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], "10": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], "12": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], "21": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "23": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], "32": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], "30": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], "03": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]] };
const K_I = { "01": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], "10": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], "12": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], "21": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "23": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], "32": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], "30": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], "03": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]] };
const kicksOf = (t, a, b) => (t === "O" ? [[0, 0]] : (t === "I" ? K_I : K_JLSTZ)[`${a}${b}`].map(([x, y]) => [x, -y]));

const ATK = [0, 0, 1, 2, 4];                                // 消 0／1／2／3／4 行的攻擊
const TSPIN_ATK = [0, 2, 4, 6];
const COMBO = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
const DAS = 140, ARR = 40, SOFT = 35, LOCK_MS = 500, LOCK_RESETS = 15;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bagMaker(seed) {
  const r = rng(seed); let bag = [];
  return () => { if (!bag.length) { bag = [...NAMES]; for (let i = 6; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } } return bag.pop(); };
}
const UI_FONT = "'Noto Sans CJK TC','Noto Sans TC','Microsoft JhengHei',sans-serif";
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountTetris(root, { env, back }) {
  root.innerHTML = `
    <div class="game tetris">
      <header><button class="back">← 選單</button><h2>俄羅斯方塊對戰</h2><span class="hdr"><span class="watch"></span><button class="mute" title="音效">🔊</button></span></header>
      <div class="status">連線中…</div>
      <div class="twrap"><canvas></canvas><div class="overlay" hidden></div></div>
      <div class="tpad">
        <button data-k="left">◀</button><button data-k="down">▼</button><button data-k="right">▶</button>
        <button data-k="ccw">↺</button><button data-k="cw">↻</button><button data-k="hold">暫存</button><button data-k="hard">⤓ 落下</button>
      </div>
      <p class="thint">鍵盤：← → 移動　↓ 加速　空白 直接落下　↑ / X 順轉　Z 逆轉　C / Shift 暫存</p>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d"), statusEl = $(".status"), overlay = $(".overlay"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);

  // ---------- 音效
  let ac = null, muted = false;
  function tone(f, d, type = "square", v = .05, at = 0, f2 = null) {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + .02);
    } catch {}
  }
  const SFX = {
    move: () => tone(300, .03, "square", .02), rot: () => tone(420, .04, "square", .025), lock: () => tone(180, .06, "triangle", .06),
    hold: () => tone(500, .06, "triangle", .04), clear: (n) => { for (let i = 0; i < Math.min(n, 4); i++) tone(500 + i * 120, .08, "square", .04, i * .06); },
    atk: () => tone(200, .18, "sawtooth", .05, 0, 520), garb: () => tone(120, .2, "sawtooth", .07, 0, 60), go: () => { tone(523, .1); tone(784, .18, "square", .05, .11); },
    win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, .14, "square", .05, i * .1)); }, lose: () => { tone(300, .2, "square", .06, 0, 150); tone(150, .4, "square", .06, .2, 60); },
  };
  $(".mute").addEventListener("click", (e) => { muted = !muted; e.target.textContent = muted ? "🔇" : "🔊"; });

  // ---------- 狀態
  let ws = null, closed = false, retry = 0;
  let sv = null, offset = 0;                                // 伺服器狀態、伺服器時間差
  let g = null;                                             // 我這局的遊戲狀態
  const opp = [null, null];                                  // 各座位最近一次收到的盤面
  let pendingIn = [0, 0], fxText = [], lastSent = "", lastSentAt = 0, raf = 0, resultPlayed = "";
  const held = {};                                           // 按住的鍵：{t0, last}
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  const srvNow = () => Date.now() + offset;

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; send({ t: "ttjoin", room: env.instanceId, name: lsName() }); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "ttstate") onState(m);
      else if (m.t === "ttopp") { opp[m.seat] = m; }
      else if (m.t === "ttpend") { pendingIn = m.pending; }
      else if (m.t === "ttfx") onFx(m);
      else if (m.t === "ttgarb") onGarbage(m);
    };
    ws.onclose = () => { if (!closed) { statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 600 * ++retry)); } };
  }

  function onState(m) {
    const prev = sv; sv = m; offset = m.now - Date.now(); pendingIn = m.pending;
    if (m.state === "play" && (!prev || prev.state !== "play" || prev.t0 !== m.t0)) {
      opp[0] = opp[1] = null; resultPlayed = ""; fxText = [];
      g = m.you >= 0 ? newGame(m.seed, m.t0) : null;
    }
    if (m.state !== "play" && g && !g.dead) g.dead = true;
    if (m.state === "over" && resultPlayed !== m.t0 + "") {
      resultPlayed = m.t0 + "";
      if (m.you >= 0) (m.winner === m.you ? SFX.win : SFX.lose)();
    }
    watchEl.textContent = m.watchers ? `👀 ${m.watchers}` : "";
    renderOverlay();
  }

  function onFx(m) {
    const mine = sv && m.seat === sv.you;
    if (m.label || m.atk) fxText.push({ seat: m.seat, text: `${m.label || ""}${m.atk ? ` 攻擊 ${m.atk}` : ""}`.trim(), until: performance.now() + 1600 });
    if (m.atk) { if (!mine) SFX.garb(); else SFX.atk(); }
  }

  // ---------- 遊戲邏輯
  function newGame(seed, t0) {
    const nextType = bagMaker(seed);
    const s = { board: Array.from({ length: ROWS }, () => Array(COLS).fill("")), nextType, queue: [], hold: "", canHold: true, cur: null, score: 0, lines: 0, combo: -1, b2b: false,
      lastRot: false, fallAt: 0, lockAt: 0, lockResets: 0, dead: false, t0, started: false, flash: 0 };
    for (let i = 0; i < 6; i++) s.queue.push(nextType());
    return s;
  }
  const shapeOf = (c) => SHAPES[c.t][c.r];
  function fits(b, c) { for (const [x, y] of shapeOf(c)) { const bx = c.x + x, by = c.y + y; if (bx < 0 || bx >= COLS || by >= ROWS || (by >= 0 && b[by][bx])) return false; } return true; }
  function spawn(s, t) {
    const n = CELLS[t][0];
    s.cur = { t, r: 0, x: Math.floor((COLS - n) / 2), y: 0 };
    s.lastRot = false; s.lockAt = 0; s.lockResets = 0; s.fallAt = performance.now() + gravMs(s);
    if (!fits(s.board, s.cur)) { s.cur.y = -1; if (!fits(s.board, s.cur)) die(s); }          // 出生位置被擋住：頂到頂
  }
  function nextPiece(s) { spawn(s, s.queue.shift()); s.queue.push(s.nextType()); s.canHold = true; }
  const level = (s) => Math.max(0, Math.floor((srvNow() - s.t0) / 20000));
  const gravMs = (s) => Math.max(45, 800 * Math.pow(0.85, level(s)));
  function die(s) { if (s.dead) return; s.dead = true; send({ t: "ttdead" }); pushBoard(true); }

  const grounded = (s) => !fits(s.board, { ...s.cur, y: s.cur.y + 1 });
  function touch(s) { if (grounded(s)) { if (s.lockResets < LOCK_RESETS) { s.lockAt = performance.now() + LOCK_MS; s.lockResets++; } } else s.lockAt = 0; }
  function move(s, dx) {
    const c = { ...s.cur, x: s.cur.x + dx };
    if (fits(s.board, c)) { s.cur = c; s.lastRot = false; touch(s); SFX.move(); return true; }
    return false;
  }
  function rotate(s, dir) {
    const to = (s.cur.r + (dir > 0 ? 1 : 3)) % 4;
    for (const [kx, ky] of kicksOf(s.cur.t, s.cur.r, to)) {
      const c = { ...s.cur, r: to, x: s.cur.x + kx, y: s.cur.y + ky };
      if (fits(s.board, c)) { s.cur = c; s.lastRot = true; touch(s); SFX.rot(); return true; }
    }
    return false;
  }
  function softStep(s) {
    const c = { ...s.cur, y: s.cur.y + 1 };
    if (fits(s.board, c)) { s.cur = c; s.lastRot = false; s.fallAt = performance.now() + gravMs(s); if (grounded(s) && !s.lockAt) s.lockAt = performance.now() + LOCK_MS; return true; }
    return false;
  }
  const dropY = (s) => { let y = s.cur.y; while (fits(s.board, { ...s.cur, y: y + 1 })) y++; return y; };
  function hardDrop(s) { s.cur.y = dropY(s); lock(s); }
  function doHold(s) {
    if (!s.canHold) return;
    const t = s.cur.t, h = s.hold; s.hold = t; SFX.hold();
    if (h) { spawn(s, h); } else nextPiece(s);
    s.canHold = false;
  }

  function lock(s) {
    const c = s.cur, cells = shapeOf(c).map(([x, y]) => [c.x + x, c.y + y]);
    // T-spin：T 方塊最後一步是旋轉，而且中心四個斜角至少 3 個被佔（牆和地板也算）
    let tspin = false;
    if (c.t === "T" && s.lastRot) {
      const cx = c.x + 1, cy = c.y + 1;
      const occ = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([dx, dy]) => { const x = cx + dx, y = cy + dy; return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && s.board[y][x]); }).length;
      tspin = occ >= 3;
    }
    for (const [x, y] of cells) if (y >= 0) s.board[y][x] = c.t;
    const aboveAll = cells.every(([, y]) => y < HID);
    SFX.lock();
    const full = [];
    for (let y = 0; y < ROWS; y++) if (s.board[y].every(Boolean)) full.push(y);
    if (full.length) {
      for (const y of full) { s.board.splice(y, 1); s.board.unshift(Array(COLS).fill("")); }
      s.lines += full.length; s.combo++;
      const n = full.length, hard = n === 4 || tspin;
      let atk = tspin ? TSPIN_ATK[Math.min(n, 3)] : ATK[n];
      const b2bHit = hard && s.b2b;
      if (b2bHit) atk += 1;
      atk += COMBO[Math.min(s.combo, COMBO.length - 1)];
      const pc = s.board.every((row) => row.every((v) => !v));
      if (pc) atk += 10;
      s.b2b = hard;                                           // 普通消行會中斷連續高難度；沒消行不影響
      const label = (b2bHit ? "B2B " : "") + (pc ? "完美清空 " : "") + (tspin ? `T-Spin ${["", "單", "雙", "三"][Math.min(n, 3)]}` : ["", "單行", "雙行", "三行", "四行 TETRIS"][n]) + (s.combo > 0 ? ` ${s.combo} 連擊` : "");
      s.score += [0, 100, 300, 500, 800][n] * (1 + level(s) * 0.1) | 0;
      SFX.clear(n);
      send({ t: "ttclear", atk, label, combo: s.combo, b2b: b2bHit });
      s.flash = performance.now() + 200;
    } else {
      s.combo = -1;
      send({ t: "ttlock", cleared: false });
    }
    if (aboveAll && !full.length) { die(s); return; }
    s.cur = null; nextPiece(s);
    pushBoard(true);
  }

  function onGarbage(m) {
    const s = g; if (!s || s.dead || !s.cur) return;
    SFX.garb();
    for (let i = 0; i < m.n; i++) {
      if (s.board[0].some(Boolean)) { die(s); return; }
      s.board.shift();
      const row = Array(COLS).fill("G"); row[m.col] = "";
      s.board.push(row);
    }
    while (!fits(s.board, s.cur) && s.cur.y > -3) s.cur.y--;            // 方塊被頂上去
    if (!fits(s.board, s.cur)) die(s);
    pushBoard(true);
  }

  // ---------- 盤面送給對手
  function encode(s) {
    let out = "";
    const ghost = new Set(), cur = new Set();
    if (s.cur && !s.dead) for (const [x, y] of shapeOf(s.cur)) cur.add((s.cur.y + y) * COLS + s.cur.x + x);
    for (let y = HID; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const v = cur.has(y * COLS + x) ? s.cur.t : s.board[y][x]; out += v ? (v === "G" ? "G" : v) : "."; }
    return out;
  }
  function pushBoard(force) {
    const s = g; if (!s || !sv || sv.you < 0) return;
    const b = encode(s), now = performance.now();
    if (!force && (b === lastSent || now - lastSentAt < 90)) return;
    lastSent = b; lastSentAt = now;
    send({ t: "ttb", b, s: s.score, l: s.lines });
  }

  // ---------- 輸入
  const ACTIONS = {
    left: (s) => move(s, -1), right: (s) => move(s, 1), down: (s) => { if (softStep(s)) s.score += 1; }, cw: (s) => rotate(s, 1), ccw: (s) => rotate(s, -1),
    hold: (s) => doHold(s), hard: (s) => hardDrop(s),
  };
  const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "cw", x: "cw", X: "cw", z: "ccw", Z: "ccw", " ": "hard", c: "hold", C: "hold", Shift: "hold" };
  const REPEAT = new Set(["left", "right", "down"]);
  function press(k) {
    const s = g; if (!s || s.dead || !s.cur || srvNow() < s.t0) return;
    if (held[k]) return;
    held[k] = { t0: performance.now(), last: 0 };
    ACTIONS[k](s);
    if (!REPEAT.has(k)) delete held[k];            // 不重複的鍵，不用記按住
  }
  const release = (k) => { delete held[k]; };
  const onKeyDown = (e) => { const k = KEYMAP[e.key]; if (!k) return; e.preventDefault(); if (!e.repeat) press(k); };
  const onKeyUp = (e) => { const k = KEYMAP[e.key]; if (k) release(k); };
  window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp);
  root.querySelectorAll(".tpad button").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} press(k); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, () => release(k));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  function tickHeld(now) {
    const s = g; if (!s || s.dead || !s.cur) return;
    for (const k of Object.keys(held)) {
      const h = held[k], el = now - h.t0;
      if (k === "down") { if (now - h.last >= SOFT) { h.last = now; ACTIONS.down(s); } }
      else if (el >= DAS && now - h.last >= ARR) { h.last = now; ACTIONS[k](s); }
    }
  }

  // ---------- 主迴圈
  function step(now) {
    const s = g;
    if (s && !s.dead && sv && sv.state === "play") {
      if (srvNow() >= s.t0) {
        if (!s.started) { s.started = true; SFX.go(); nextPiece(s); }
        tickHeld(now);
        if (s.cur) {
          if (now >= s.fallAt) { if (!softStep(s)) { s.fallAt = now + gravMs(s); } }
          if (s.cur && grounded(s)) { if (!s.lockAt) s.lockAt = now + LOCK_MS; if (now >= s.lockAt) lock(s); }
          else if (s.cur) s.lockAt = 0;
        }
        pushBoard(false);
      }
    }
  }

  // ---------- 畫面
  let c = 20, CW = 320, CH = 420;
  function layout() {
    const w = Math.min(root.clientWidth || window.innerWidth, 640), h = window.innerHeight;
    c = Math.max(12, Math.min(32, Math.floor((w - 16) / 16), Math.floor((h - 300) / 20)));
    CW = Math.round(c * 15.8); CH = Math.round(c * 20.4);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = CW * dpr; canvas.height = CH * dpr; canvas.style.width = CW + "px"; canvas.style.height = CH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  layout(); window.addEventListener("resize", layout);

  function cellAt(x, y, col, size, alpha = 1) {
    ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fillRect(x, y, size, Math.max(1, size * .14)); ctx.fillRect(x, y, Math.max(1, size * .14), size);
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(x, y + size * .86, size, size * .14); ctx.fillRect(x + size * .86, y, size * .14, size);
    ctx.globalAlpha = 1;
  }
  function frame(x, y, w, h, title) {
    ctx.fillStyle = "#0b0e14"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#3a4256"; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    if (title) { ctx.fillStyle = "#9fb0d0"; ctx.font = `${Math.max(10, c * .5)}px ${UI_FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(title, x, y - 5); }
  }
  function miniPiece(t, x, y, size) {
    if (!t) return;
    const [n, base] = CELLS[t];
    const xs = base.map((p) => p[0]), ys = base.map((p) => p[1]), minX = Math.min(...xs), minY = Math.min(...ys), wcell = Math.max(...xs) - minX + 1;
    for (const [px, py] of base) cellAt(x + (px - minX) * size + (4 - wcell) * size / 2, y + (py - minY) * size, COLORS[t], size);
  }
  function drawStrBoard(str, x, y, size) {
    frame(x, y, COLS * size, (ROWS - HID) * size);
    if (!str) return;
    for (let i = 0; i < str.length; i++) { const ch = str[i]; if (ch !== ".") cellAt(x + (i % COLS) * size, y + Math.floor(i / COLS) * size, COLORS[ch] || "#888", size); }
  }
  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    const bx = Math.round(c * .7), by = Math.round(c * .3), rx = bx + c * 10 + c * .5;
    const you = sv ? sv.you : -1, mySeat = you >= 0 ? you : 0, oppSeat = you >= 0 ? 1 - you : 1;
    // 垃圾待接量（左邊紅條）
    const pend = sv ? pendingIn[mySeat] : 0;
    ctx.fillStyle = "#1a1d26"; ctx.fillRect(bx - c * .55, by, c * .35, c * 20);
    if (pend) { ctx.fillStyle = pend >= 8 ? "#ff3b3b" : "#ff8a3b"; const hh = Math.min(20, pend) * c; ctx.fillRect(bx - c * .55, by + c * 20 - hh, c * .35, hh); }
    // 主盤面
    const s = g;
    if (you >= 0 && s) {
      frame(bx, by, COLS * c, 20 * c);
      ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
      for (let i = 1; i < COLS; i++) { ctx.beginPath(); ctx.moveTo(bx + i * c, by); ctx.lineTo(bx + i * c, by + 20 * c); ctx.stroke(); }
      for (let i = 1; i < 20; i++) { ctx.beginPath(); ctx.moveTo(bx, by + i * c); ctx.lineTo(bx + COLS * c, by + i * c); ctx.stroke(); }
      for (let y = HID; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const v = s.board[y][x]; if (v) cellAt(bx + x * c, by + (y - HID) * c, COLORS[v], c); }
      if (s.cur && !s.dead) {
        const gy = dropY(s);
        for (const [x, y] of shapeOf(s.cur)) { const yy = gy + y - HID; if (yy >= 0) { ctx.strokeStyle = COLORS[s.cur.t]; ctx.globalAlpha = .55; ctx.lineWidth = 2; ctx.strokeRect(bx + (s.cur.x + x) * c + 1, by + yy * c + 1, c - 2, c - 2); ctx.globalAlpha = 1; } }
        for (const [x, y] of shapeOf(s.cur)) { const yy = s.cur.y + y - HID; if (yy >= 0) cellAt(bx + (s.cur.x + x) * c, by + yy * c, COLORS[s.cur.t], c); }
      }
      if (s.dead) { ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(bx, by, COLS * c, 20 * c); }
    } else {
      drawStrBoard(opp[mySeat] && opp[mySeat].b, bx, by, c);          // 旁觀：看座位 0
      if (you < 0 && !opp[mySeat]) frame(bx, by, COLS * c, 20 * c);
    }
    // 右欄：對手小盤面、暫存、下一個
    const ms = c * .4, ow = COLS * ms, oh = (ROWS - HID) * ms;
    const oname = sv && sv.names[oppSeat] ? sv.names[oppSeat] : "對手";
    ctx.fillStyle = "#cfd8ee"; ctx.font = `${Math.max(10, c * .52)}px ${UI_FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(oname.slice(0, 6), rx, by + c * .5);
    drawStrBoard(opp[oppSeat] && opp[oppSeat].b, rx, by + c * .8, ms);
    const oPend = sv ? pendingIn[oppSeat] : 0;
    if (oPend) { ctx.fillStyle = "#ff8a3b"; ctx.fillRect(rx + ow + 3, by + c * .8 + oh - Math.min(20, oPend) * ms, 3, Math.min(20, oPend) * ms); }
    let yy = by + c * .8 + oh + c * .45;
    ctx.fillStyle = "#9fb0d0"; ctx.fillText(`${opp[oppSeat] ? opp[oppSeat].s : 0} 分`, rx, yy + c * .4);
    yy += c * 1.0;
    if (you >= 0 && s) {
      ctx.fillStyle = "#9fb0d0"; ctx.fillText("暫存", rx, yy + c * .4);
      frame(rx, yy + c * .6, c * 3.4, c * 2.0); miniPiece(s.hold, rx + c * .2, yy + c * .8, c * .55);
      if (s.hold && !s.canHold) { ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(rx, yy + c * .6, c * 3.4, c * 2.0); }
      yy += c * 2.9;
      ctx.fillStyle = "#9fb0d0"; ctx.fillText("下一個", rx, yy + c * .4);
      for (let i = 0; i < 3; i++) { frame(rx, yy + c * .6 + i * c * 1.55, c * 3.4, c * 1.4); miniPiece(s.queue[i], rx + c * .2, yy + c * .72 + i * c * 1.55, c * .45); }
      yy += c * 5.5;
      ctx.fillStyle = "#cfd8ee"; ctx.fillText(`${s.score | 0} 分　${s.lines} 行`, rx, Math.min(yy + c * .3, CH - c * .2));
    }
    // 攻擊文字
    const now = performance.now();
    fxText = fxText.filter((f) => f.until > now);
    let ly = by + c * 3;
    for (const f of fxText) {
      const mine = f.seat === mySeat, a = Math.min(1, (f.until - now) / 500);
      ctx.globalAlpha = a; ctx.font = `bold ${Math.round(c * .8)}px ${UI_FONT}`; ctx.textAlign = "center"; ctx.fillStyle = mine ? "#ffe066" : "#ff9b8a";
      ctx.fillText((mine ? "" : "← ") + f.text, bx + c * 5, ly); ly += c * 1.1; ctx.globalAlpha = 1;
    }
    // 開局倒數
    if (sv && sv.state === "play" && srvNow() < sv.t0) {
      const n = Math.ceil((sv.t0 - srvNow()) / 1000);
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(bx, by, COLS * c, 20 * c);
      ctx.fillStyle = "#fff"; ctx.font = `bold ${c * 4}px ${UI_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(Math.min(3, n)), bx + c * 5, by + c * 10);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function renderOverlay() {
    if (!sv) return;
    const nm = (i) => sv.names[i] || "—";
    let html = "";
    const wins = `<div class="tscore">${nm(0)} <b>${sv.wins[0]}</b> : <b>${sv.wins[1]}</b> ${nm(1)}</div>`;
    if (sv.state === "lobby") {
      const ready = sv.names[0] && sv.names[1];
      if (sv.you >= 0 && ready) html = `${wins}<p>兩位玩家到齊了</p><button class="tbtn tstart">開始對戰</button>`;
      else if (sv.you >= 0) html = `<p>等另一位玩家進來…</p><small>同一個 Activity 的人進來就會自動入座</small>`;
      else html = `<p>房間等待中，你是旁觀</p>${wins}`;
    } else if (sv.state === "over") {
      const me = sv.you >= 0 ? (sv.winner === sv.you ? "🏆 你贏了！" : "💀 你輸了") : `${nm(sv.winner)} 獲勝`;
      html = `<h3>${me}</h3><p>${sv.reason || ""}</p>${wins}${sv.you >= 0 ? `<button class="tbtn tagain">再來一局</button>` : ""}`;
    }
    overlay.hidden = !html; overlay.innerHTML = html;
    const st = overlay.querySelector(".tstart"); if (st) st.addEventListener("click", () => send({ t: "ttstart" }));
    const ag = overlay.querySelector(".tagain"); if (ag) ag.addEventListener("click", () => send({ t: "ttagain" }));
    statusEl.textContent = sv.state === "play" ? (sv.you >= 0 ? "對戰中：消行會把垃圾行丟給對手" : "旁觀中") : sv.state === "over" ? "這局結束了" : "準備中";
  }

  let lastT = 0;
  function loop(now) {
    if (closed) return;
    step(now); draw();
    raf = requestAnimationFrame(loop);
  }
  connect(); raf = requestAnimationFrame(loop);
  return () => {
    closed = true; cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("resize", layout);
    try { ws && ws.close(); } catch {}
  };
}
