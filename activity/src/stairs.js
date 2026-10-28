// 小朋友下樓梯（最多 4 人）。伺服器算物理，這裡只負責畫面、輸入、音效與介面。
// 畫面照原版的版面與風格：上方 LIFE 格與「地下0000階」、深藍岩石的井、冰藍石塊牆、頂端一排尖刺、
// 右側黑色花崗岩資訊欄。所有圖都是程式即時畫的原創像素圖，沒有使用原版素材或商標。
import { wsUrl } from "./gomoku.js";

// 伺服器的尺寸（要跟 server/stairs.js 一致）
const DW = 636, DH = 540, WALL = 26, KW = 38, KH = 38, MAXHP = 12;
const COLORS = ["#ffd21f", "#38c75a", "#ff4d4d", "#3d8bff"];     // 照原版：1P 黃衣服、2P 綠衣服
const NAMES = ["黃", "綠", "紅", "藍"];
const DIFFS = [["easy", "簡單"], ["normal", "普通"], ["hard", "困難"]];
const diffName = (d) => (DIFFS.find((x) => x[0] === d) || DIFFS[1])[1];
const UI_FONT = "'Noto Sans CJK TC','Noto Sans TC','Microsoft JhengHei',sans-serif";

export const mountDown = (root, o) => mountStairs(root, o);

// ---------- 原創像素小人（14×19，放大 2 倍 = 28×38）
// w 帽子 c 帽簷影 h 頭髮 k 皮膚 e 眼睛 b 衣服(玩家色) p 褲子 s 鞋
const HEAD = ["....wwwww.....", "...wwwwwww....", "..cwwwwwwwwwww"];
const SPR = {
  stand: [...HEAD, "...hkkkkkk....", "...hkkkkek....", "....kkkkkk....", ".....kkkk.....", "...bbbbbbbb...", "..bbbbbbbbbb..",
          "..kbbbbbbbbk..", "..kbbbbbbbbk..", "...bbbbbbbb...", "...pppppppp...", "...ppp..ppp...", "...ppp..ppp...",
          "...ppp..ppp...", "...ppp..ppp...", "...ppp..ppp...", "..ssss..ssss.."],
  walk: [...HEAD, "...hkkkkkk....", "...hkkkkek....", "....kkkkkk....", ".....kkkk.....", "...bbbbbbbb...", "..bbbbbbbbbb..",
         "..kbbbbbbbbk..", "..kbbbbbbbbk..", "...bbbbbbbb...", "...pppppppp...", "..ppp....ppp..", "..ppp....ppp..",
         ".ppp......ppp.", ".ppp......ppp.", ".ppp......ppp.", "ssss......ssss"],
  fall: [...HEAD, "k..hkkkkkk..k.", "k..hkkkkek..k.", "k...kkkkkk..k.", "kb...kkkk..bk.", "kbbbbbbbbbbbk.", "..bbbbbbbbbb..",
         "..bbbbbbbbbb..", "..bbbbbbbbbb..", "...bbbbbbbb...", "...pppppppp...", "..ppp....ppp..", "..ppp....ppp..",
         ".ppp......ppp.", ".ppp......ppp.", "ppp........ppp", "sss........sss"],
};

// ---------- 預先產生的材質（岩石背景、冰藍石、米色石、花崗岩）
function makeTex(w, h, base, dots, seed) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (const [color, n, size] of dots) {
    g.fillStyle = color;
    for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, sz = 1 + Math.floor(r() * size); g.fillRect(Math.floor(x), Math.floor(y), sz, Math.max(1, sz - (r() < .5 ? 1 : 0))); }
  }
  return c;
}
function makeRock() {      // 深藍井壁：淺藍斜筆觸＋暗色斑塊
  const w = 256, h = 256, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#0b1a8e"; g.fillRect(0, 0, w, h);
  const blob = (color, n, rx, ry) => { g.fillStyle = color; for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h; for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { g.beginPath(); g.ellipse(x + ox, y + oy, rx * (.5 + r()), ry * (.5 + r()), -.5 + r() * .4, 0, 7); g.fill(); } } };
  blob("rgba(4,10,70,.55)", 26, 34, 16);
  blob("rgba(30,60,190,.45)", 30, 22, 8);
  // 淺色斜向筆觸（像原版那種被光照到的岩面）
  for (let i = 0; i < 90; i++) {
    const x = r() * w, y = r() * h, len = 8 + r() * 26;
    g.strokeStyle = r() < .6 ? "rgba(120,150,255,.45)" : "rgba(190,210,255,.55)";
    g.lineWidth = 1 + r() * 2;
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + len * .5, y + oy - 4 - r() * 4, x + ox + len, y + oy - 2); g.stroke();
    }
  }
  g.fillStyle = "rgba(210,225,255,.6)";
  for (let i = 0; i < 160; i++) g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1, 1);
  return c;
}

function mountStairs(root, { env, back }) {
  root.innerHTML = `
    <div class="game stairs">
      <header><button class="back">← 選單</button><h2>小朋友下樓梯</h2><span class="hdr"><span class="watch"></span><button class="mute" title="音效">🔊</button></span></header>
      <div class="status">連線中…</div>
      <div class="swrap"><canvas></canvas><div class="overlay" hidden></div></div>
      <div class="pad"><button class="pl">◀</button><button class="pr">▶</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const statusEl = $(".status"), overlay = $(".overlay"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);

  const TEX = {
    rock: makeRock(),
    ice: makeTex(64, 64, "#74b2ec", [["#a9d3ff", 70, 2], ["#5a98dc", 60, 2], ["#d4ebff", 18, 1]], 3),
    sand: makeTex(64, 64, "#c9b48e", [["#e6d8b8", 70, 2], ["#a8946e", 60, 2], ["#f3ead6", 16, 1]], 5),
    granite: makeTex(128, 128, "#121215", [["#26262b", 260, 2], ["#34343a", 120, 2], ["#4a4a52", 40, 1]], 9),
  };
  const PAT = {};
  for (const k in TEX) PAT[k] = ctx.createPattern(TEX[k], "repeat");

  let st = null, ws = null, closed = false, retry = 0;
  const disp = new Map();
  let L = false, R = false, sent = "";
  let scroll = 0, lastT = performance.now(), raf = 0, muted = false;
  let lay = null;                       // 版面（橫式／直式）

  // ---------- 音效（8-bit 風格，WebAudio 即時合成）
  let ac = null;
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
    land: () => tone(520, .05, "square", .04),
    heal: () => { tone(660, .05, "square", .04); tone(880, .06, "square", .035, .05); },
    hurt: () => tone(160, .22, "sawtooth", .07, 0, 70),
    spring: () => tone(300, .16, "square", .05, 0, 900),
    flip: () => tone(500, .14, "triangle", .06, 0, 180),
    die: () => { tone(440, .18, "square", .06, 0, 220); tone(220, .4, "square", .06, .18, 60); },
    go: () => { tone(523, .1, "square", .05); tone(784, .16, "square", .05, .11); },
  };
  $(".mute").addEventListener("click", (e) => { muted = !muted; e.target.textContent = muted ? "🔇" : "🔊"; });

  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; sent = ""; send({ t: "join", game: "down", room: env.instanceId }); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t !== "mstate") return;
      const prev = st;
      st = m;
      if (m.state === "play" && (!prev || prev.state !== "play")) { disp.clear(); L = R = false; sent = ""; }
      if (m.snap && m.you >= 0) {
        const me = m.snap.ps.find((p) => p.s === m.you);
        if (me && me.ev) {
          if (me.ev & 32) SFX.die(); else if (me.ev & 4) SFX.hurt(); else if (me.ev & 8) SFX.spring();
          else if (me.ev & 16) SFX.flip(); else if (me.ev & 2) SFX.heal(); else if (me.ev & 1) SFX.land();
        }
      }
      if (m.snap && prev && prev.snap && prev.snap.ready > 0 && m.snap.ready === 0) SFX.go();
      ui();
    };
    ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }

  // ---------- 輸入
  function pushInput() {
    const k = (L ? "l" : "") + (R ? "r" : "");
    if (k === sent) return;
    sent = k; send({ t: "in", l: L, r: R });
  }
  const keyMap = { ArrowLeft: "l", a: "l", A: "l", ArrowRight: "r", d: "r", D: "r" };
  const onKey = (e, v) => { const k = keyMap[e.key]; if (!k) return; e.preventDefault(); if (k === "l") L = v; else R = v; pushInput(); };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
  const hold = (btn, set) => {
    const on = (e) => { e.preventDefault(); set(true); btn.classList.add("down"); pushInput(); };
    const off = (e) => { e.preventDefault(); set(false); btn.classList.remove("down"); pushInput(); };
    btn.addEventListener("pointerdown", on); btn.addEventListener("pointerup", off); btn.addEventListener("pointerleave", off); btn.addEventListener("pointercancel", off);
  };
  hold($(".pl"), (v) => (L = v)); hold($(".pr"), (v) => (R = v));
  const onBlur = () => { L = R = false; pushInput(); };
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", (e) => { const r = canvas.getBoundingClientRect(); if (e.clientX - r.left < r.width / 2) L = true; else R = true; pushInput(); canvas.setPointerCapture(e.pointerId); });
  const up = () => { L = R = false; pushInput(); };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

  // ---------- 大廳／結算（HTML 疊在畫布上）
  const floorText = (n) => `地下${String(n).padStart(4, "0")}階`;
  function ui() {
    if (!st) return;
    const seated = st.you >= 0;
    watchEl.textContent = st.watchers > 0 ? `👀 ${st.watchers}` : "";
    const n = st.seats.filter(Boolean).length;
    if (st.state === "lobby") {
      statusEl.textContent = seated ? `你是${NAMES[st.you]}衣服的小朋友` : "房間已滿或正在遊戲中，你在旁觀";
      overlay.hidden = false;
      overlay.innerHTML = `<div class="box"><h3>小朋友下樓梯</h3>
        <ul class="rules">
          <li>樓梯一直往上捲，左右移動找下一層踩，<b>越往下越快</b>。</li>
          <li>生命 12 格：踩到新的一層回 1 格。</li>
          <li><b>釘板</b>扣 5；被頂到<b>天花板的刺</b>扣 5，還會穿過腳下的平台掉下去。</li>
          <li><b>輸送帶</b>把你往左／右送；<b>彈簧床</b>會一直彈；<b>米色的翻轉板</b>踩上去一下子就翻掉。</li>
          <li>掉出畫面下緣、或生命歸零就出局。</li></ul>
        <div class="seats">${st.seats.map((s, i) => `<span class="seat ${s ? "on" : ""}" style="--c:${COLORS[i]}">${s ? (i === st.you ? "你" : "玩家") : "空位"}</span>`).join("")}</div>
        <div class="diffs">難度：${DIFFS.map(([k, n]) => `<button class="df ${st.diff === k ? "on" : ""}" data-d="${k}" ${seated ? "" : "disabled"}>${n}</button>`).join("")}</div>
        <p class="sm">最多 4 人同場，一個人也可以玩；多人時撐最久（下得最深）的人獲勝。</p>
        ${seated ? `<button class="go">開始遊戲（${n} 人）</button>` : ""}</div>`;
      const go = overlay.querySelector(".go"); if (go) go.onclick = () => send({ t: "start" });
      overlay.querySelectorAll(".df").forEach((b) => (b.onclick = () => send({ t: "diff", v: b.dataset.d })));
    } else if (st.state === "over") {
      const r = st.result || { rank: [] };
      const solo = r.rank.length === 1;
      statusEl.textContent = r.winner >= 0 ? `🏆 ${NAMES[r.winner]}衣服的小朋友獲勝！` : "遊戲結束";
      overlay.hidden = false;
      overlay.innerHTML = `<div class="box"><h3>${r.winner >= 0 ? `🏆 ${NAMES[r.winner]}衣服獲勝` : (solo ? floorText(r.rank[0].score) : "遊戲結束")}</h3>
        <ol class="rank">${r.rank.map((x, i) => `<li style="--c:${COLORS[x.seat]}"><b>${["🥇", "🥈", "🥉", "4️⃣"][i] || ""}</b> ${NAMES[x.seat]}衣服${x.seat === st.you ? "（你）" : ""}　${floorText(x.score)}</li>`).join("")}</ol>
        ${seated ? `<button class="go">再來一局</button>` : ""}</div>`;
      const go = overlay.querySelector(".go"); if (go) go.onclick = () => send({ t: "again" });
    } else {
      overlay.hidden = true;
      statusEl.textContent = seated ? "◀ ▶ ／ A D ／ 點畫面左右半邊 移動" : "旁觀中";
    }
  }

  // ---------- 版面：橫式（右側資訊欄，像原版）或直式（資訊欄放到下面）
  const LAYOUTS = {
    land: { cw: 940, ch: 650, fx: 22, fy: 98, panel: { x: 680, y: 10, w: 248, h: 630, side: true } },
    port: { cw: 680, ch: 870, fx: 22, fy: 98, panel: { x: 22, y: 650, w: 636, h: 210, side: false } },
  };
  function fit() {
    const wrap = $(".swrap");
    const ww = wrap.clientWidth, wh = wrap.clientHeight || 9999;
    const sL = Math.min(ww / 940, wh / 650), sP = Math.min(ww / 680, wh / 870);
    lay = sL >= sP ? LAYOUTS.land : LAYOUTS.port;
    const s = Math.min(sL >= sP ? sL : sP, 1.4);
    const w = Math.max(200, Math.floor(lay.cw * s)), h = Math.floor(lay.ch * s);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    overlay.style.width = w + "px"; overlay.style.height = h + "px";
  }

  // ---------- 小工具
  const bevel = (x, y, w, h, hi, lo) => { ctx.fillStyle = hi; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h); ctx.fillStyle = lo; ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h); };
  function texRect(pat, x, y, w, h, ox = 0, oy = 0) {
    ctx.save(); ctx.translate(x + ox, y + oy); ctx.fillStyle = pat; ctx.fillRect(-ox, -oy, w, h); ctx.restore();
  }
  function bigText(txt, x, y, size, top, bottom, stroke, align = "left") {
    ctx.save();
    ctx.font = `italic 900 ${size}px ${UI_FONT}`; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
    const g = ctx.createLinearGradient(0, y - size, 0, y); g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(3, size / 8); ctx.strokeStyle = stroke; ctx.strokeText(txt, x, y);
    ctx.fillStyle = g; ctx.fillText(txt, x, y);
    ctx.restore();
  }
  const silver = (txt, x, y, size, align = "left") => bigText(txt, x, y, size, "#ffffff", "#8d8d96", "#000", align);

  // ---------- 井
  function shaft() {
    // 岩石背景跟著樓梯一起往上捲
    texRect(PAT.rock, 0, 0, DW, DH, 0, -(scroll % 256));
    // 左右冰藍石塊牆
    const bh = 50, off = scroll % bh;
    for (const x0 of [0, DW - WALL]) {
      for (let y = -off; y < DH; y += bh) {
        texRect(PAT.ice, x0, y, WALL, bh, 0, -(scroll % 64));
        bevel(x0, y, WALL, bh, "#c9e6ff", "#2f66b4");
        ctx.fillStyle = "#16346e"; ctx.fillRect(x0, y + bh - 1, WALL, 1);
      }
    }
  }
  function ceiling() {
    ctx.fillStyle = "#5e5e66"; ctx.fillRect(0, 0, DW, 5);
    ctx.fillStyle = "#a9a9b2"; ctx.fillRect(0, 0, DW, 2);
    for (let sx = WALL; sx < DW - WALL - 4; sx += 24) {
      ctx.fillStyle = "#f2f2f5"; ctx.beginPath(); ctx.moveTo(sx, 4); ctx.lineTo(sx + 12, 26); ctx.lineTo(sx + 12, 4); ctx.fill();
      ctx.fillStyle = "#9a9aa3"; ctx.beginPath(); ctx.moveTo(sx + 12, 4); ctx.lineTo(sx + 12, 26); ctx.lineTo(sx + 24, 4); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, 4); ctx.lineTo(sx + 12, 26); ctx.lineTo(sx + 24, 4); ctx.stroke();
    }
  }

  // ---------- 平台
  function metalBar(x, y, w, h) {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#f0f0f3"); g.addColorStop(.45, "#b9b9c0"); g.addColorStop(1, "#6e6e76");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#2c2c32"; ctx.lineWidth = 1.5; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }
  function plat(x, y, w, type, t, fl, bo, now) {
    const h = 24;
    if (type === "normal") {
      texRect(PAT.ice, x, y, w, h, -x % 64, 0);
      bevel(x, y, w, h, "#d6edff", "#3a73c0");
    } else if (type === "fake") {
      // 米色翻轉板：踩到後繞水平軸翻過去（露出上面那一面），翻完只剩薄薄的側邊
      const a = fl ? 1 : Math.min(1, t / 18);
      if (a <= 0) { texRect(PAT.sand, x, y, w, h, -x % 64, 0); bevel(x, y, w, h, "#f4ead2", "#8c7a56"); return; }
      const front = Math.max(3, h * Math.cos(a * Math.PI / 2)), top = 30 * Math.sin(a * Math.PI / 2);
      ctx.save(); ctx.globalAlpha = fl ? .55 : 1;
      if (top > 1) { texRect(PAT.sand, x, y - top + 6, w, top, -x % 64, 0); ctx.fillStyle = "rgba(60,40,10,.35)"; ctx.fillRect(x, y - top + 6, w, top); bevel(x, y - top + 6, w, top, "#e8dcc0", "#6d5d3c"); }
      texRect(PAT.sand, x, y + 6, w, front, -x % 64, 0); bevel(x, y + 6, w, front, "#f4ead2", "#8c7a56");
      ctx.restore();
    } else if (type === "nails") {
      metalBar(x, y + 10, w, 14);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x + 4, y + 16, w - 8, 1); ctx.fillRect(x + 4, y + 19, w - 8, 1);
      const n = 6, sw = (w - 12) / n;
      for (let i = 0; i < n; i++) {
        const sx = x + 6 + i * sw;
        ctx.fillStyle = "#ededf1"; ctx.beginPath(); ctx.moveTo(sx + 1, y + 11); ctx.lineTo(sx + sw / 2, y - 14); ctx.lineTo(sx + sw / 2, y + 11); ctx.fill();
        ctx.fillStyle = "#8f8f98"; ctx.beginPath(); ctx.moveTo(sx + sw / 2, y + 11); ctx.lineTo(sx + sw / 2, y - 14); ctx.lineTo(sx + sw - 1, y + 11); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx + 1, y + 11); ctx.lineTo(sx + sw / 2, y - 14); ctx.lineTo(sx + sw - 1, y + 11); ctx.stroke();
      }
    } else if (type === "left" || type === "right") {
      const dir = type === "left" ? -1 : 1, r = 11;
      metalBar(x + r, y + 1, w - r * 2, h - 2);
      ctx.fillStyle = "#3a3a42"; ctx.fillRect(x + r, y + 6, w - r * 2, 2); ctx.fillRect(x + r, y + h - 8, w - r * 2, 2);
      // 中間移動的小箭頭
      ctx.save(); ctx.beginPath(); ctx.rect(x + r + 4, y + 8, w - r * 2 - 8, h - 16); ctx.clip();
      const o = ((now / 25) * dir) % 22;
      ctx.fillStyle = "#e3dc6e";
      for (let ax = x - 22 + o; ax < x + w + 22; ax += 22) {
        ctx.beginPath();
        if (dir > 0) { ctx.moveTo(ax, y + 9); ctx.lineTo(ax + 8, y + 12); ctx.lineTo(ax, y + 15); }
        else { ctx.moveTo(ax + 8, y + 9); ctx.lineTo(ax, y + 12); ctx.lineTo(ax + 8, y + 15); }
        ctx.fill();
      }
      ctx.restore();
      // 兩端白色滾輪
      for (const cx of [x + r, x + w - r]) {
        const g = ctx.createRadialGradient(cx - 3, y + h / 2 - 3, 1, cx, y + h / 2, r);
        g.addColorStop(0, "#ffffff"); g.addColorStop(.7, "#d0d0d6"); g.addColorStop(1, "#7a7a82");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y + h / 2, r, 0, 7); ctx.fill();
        ctx.strokeStyle = "#2c2c32"; ctx.lineWidth = 1.5; ctx.stroke();
        const a = now / 90 * dir;
        ctx.fillStyle = "#6a6a72"; ctx.fillRect(cx + Math.cos(a) * 6 - 1.5, y + h / 2 + Math.sin(a) * 6 - 1.5, 3, 3);
      }
    } else if (type === "tramp") {
      // 彈簧床：上下兩根綠桿，中間夾灰色彈簧；被踩時上桿往下壓
      const sq = bo > 0 ? Math.sin((8 - bo) / 8 * Math.PI) * 7 : 0;
      const topY = y + sq, botY = y + h - 5;
      ctx.strokeStyle = "#9b9ba4"; ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const sx = x + 14 + i * ((w - 28) / 3);
        ctx.beginPath(); const steps = 5;
        for (let k = 0; k <= steps; k++) { const yy = topY + 5 + (botY - topY - 5) * k / steps; ctx.lineTo(sx + (k % 2 ? 9 : -9), yy); }
        ctx.stroke();
      }
      for (const by of [topY, botY]) {
        ctx.fillStyle = "#0e5a1e"; ctx.fillRect(x, by - 1, w, 7);
        ctx.fillStyle = "#3cf06a"; ctx.fillRect(x + 1, by, w - 2, 5);
        ctx.fillStyle = "#b9ffcb"; ctx.fillRect(x + 1, by, w - 2, 1);
      }
    }
  }

  // ---------- 小人
  function kid(seat, x, y, f, grounded, walking, hurt, you, now) {
    if (hurt && Math.floor(now / 70) % 2) return;
    const spr = !grounded ? SPR.fall : (walking && Math.floor(now / 110) % 2 ? SPR.walk : SPR.stand);
    const pal = { w: "#ffffff", c: "#c9c9d2", h: "#6b3a1a", k: "#ffd2a0", e: "#1b1b1b", b: COLORS[seat], p: "#f2f2f2", s: "#7a4a22" };
    const X = Math.round(x) + 5, Y = Math.round(y);
    // 黑色外框（像素圖常見的描邊，讓小人在深藍背景上看得清楚）
    ctx.fillStyle = "rgba(0,0,0,.75)";
    for (let r = 0; r < 19; r++) for (let c = 0; c < 14; c++) {
      if (spr[r][f < 0 ? 13 - c : c] === ".") continue;
      ctx.fillRect(X + c * 2 - 1, Y + r * 2 - 1, 4, 4);
    }
    for (let r = 0; r < 19; r++) for (let c = 0; c < 14; c++) {
      const ch = spr[r][f < 0 ? 13 - c : c];
      if (ch === ".") continue;
      ctx.fillStyle = pal[ch]; ctx.fillRect(X + c * 2, Y + r * 2, 2, 2);
    }
    if (you) { ctx.fillStyle = COLORS[seat]; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + KW / 2, y - 5); ctx.lineTo(x + KW / 2 - 7, y - 14); ctx.lineTo(x + KW / 2 + 7, y - 14); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }

  // ---------- 上方：LIFE 格 + 地下 N 階
  function lifeBar(x, y, hp, cw, chh, now, dim) {
    for (let k = 0; k < MAXHP; k++) {
      const cx = x + k * (cw + 2);
      ctx.fillStyle = "#c01818"; ctx.fillRect(cx, y, cw, chh);
      const on = k < hp;
      if (on) {
        const g = ctx.createLinearGradient(0, y, 0, y + chh); g.addColorStop(0, "#fff7a0"); g.addColorStop(.5, "#ffd400"); g.addColorStop(1, "#ff9a00");
        ctx.fillStyle = dim ? "#555" : (hp <= 4 && Math.floor(now / 220) % 2 ? "#ff5a3a" : g);
      } else ctx.fillStyle = "#2a0606";
      ctx.fillRect(cx + 2, y + 2, cw - 4, chh - 4);
    }
  }
  function hud(now) {
    const s = st && st.snap;
    const me = s && (s.ps.find((p) => p.s === st.you) || s.ps.find((p) => p.a) || s.ps[0]);
    bigText("LIFE", 92, 40, 30, "#ffe0f6", "#ff3fbf", "#4a0034");
    lifeBar(40, 50, me ? me.hp : MAXHP, 15, 30, now, me && !me.a);
    const f = s ? s.floor : 0;
    bigText(`地下${String(f).padStart(4, "0")}階`, lay.fx + 300 + 170, 80, lay.panel.side ? 60 : 52, "#f7ffc6", "#9be22a", "#173608", "center");
  }

  // ---------- 資訊欄（原創內容：標題、玩家、紀錄）
  function panel(now) {
    const P = lay.panel, s = st && st.snap;
    const ps = s ? s.ps : (st ? st.seats.map((on, i) => (on ? { s: i, hp: MAXHP, a: 1 } : null)).filter(Boolean) : []);
    const rec = st ? Math.max(st.record || 0, s ? s.floor : 0) : 0;
    if (P.side) {
      silver("小朋友", P.x + P.w - 6, P.y + 56, 44, "right");
      silver("下樓梯", P.x + P.w - 6, P.y + 108, 44, "right");
      silver("大笨 bot", P.x + P.w - 8, P.y + 136, 18, "right");
      silver("DIFFICULTY:", P.x + 6, P.y + 182, 22);
      silver(diffName(st && st.diff), P.x + P.w - 6, P.y + 212, 24, "right");
      silver("PLAYERS:", P.x + 6, P.y + 256, 22);
      ps.forEach((p, i) => {
        const y = P.y + 274 + i * 50;
        ctx.fillStyle = COLORS[p.s]; ctx.fillRect(P.x + 10, y, 18, 18); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(P.x + 10.5, y + .5, 17, 17);
        silver(`${NAMES[p.s]}${p.s === (st && st.you) ? "（你）" : ""}${p.a ? "" : "　OUT"}`, P.x + 36, y + 17, 18);
        lifeBar(P.x + 10, y + 26, p.hp, 17, 16, now, !p.a);
      });
      silver("RECORD:", P.x + 6, P.y + 500, 22);
      silver(`地下${String(rec).padStart(4, "0")}階`, P.x + P.w - 6, P.y + 534, 26, "right");
      if (s && st.state === "play") silver(`SPEED ×${s.speed.toFixed(1)}`, P.x + P.w - 6, P.y + 600, 18, "right");
    } else {
      silver("PLAYERS:", P.x + 4, P.y + 26, 22);
      ps.forEach((p, i) => {
        const x = P.x + 4 + (i % 2) * 318, y = P.y + 44 + Math.floor(i / 2) * 58;
        ctx.fillStyle = COLORS[p.s]; ctx.fillRect(x, y, 18, 18);
        silver(`${NAMES[p.s]}${p.s === (st && st.you) ? "（你）" : ""}${p.a ? "" : "　OUT"}`, x + 26, y + 17, 18);
        lifeBar(x, y + 26, p.hp, 17, 16, now, !p.a);
      });
      silver(`DIFFICULTY: ${diffName(st && st.diff)}`, P.x + 4, P.y + 196, 20);
      silver(`RECORD: 地下${String(rec).padStart(4, "0")}階`, P.x + P.w - 4, P.y + 196, 20, "right");
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
    if (!lay) return;
    const sc = canvas.width / lay.cw;
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    // 整個背景：黑色花崗岩
    ctx.fillStyle = PAT.granite; ctx.fillRect(0, 0, lay.cw, lay.ch);
    hud(now);
    panel(now);
    // 井（裁切在框內）
    const fx = lay.fx, fy = lay.fy;
    ctx.fillStyle = "#000"; ctx.fillRect(fx - 4, fy - 4, DW + 8, DH + 8);
    ctx.strokeStyle = "#8a8a92"; ctx.lineWidth = 2; ctx.strokeRect(fx - 3, fy - 3, DW + 6, DH + 6);
    ctx.save(); ctx.translate(fx, fy); ctx.beginPath(); ctx.rect(0, 0, DW, DH); ctx.clip();
    const playing = st && st.snap && st.state === "play" && st.snap.ready === 0;
    if (playing) scroll += st.snap.speed * dt * 60;
    shaft();
    if (st && st.snap && st.state !== "lobby") {
      const k = 1 - Math.pow(.0005, dt);
      const seen = new Set();
      for (const [id, x, y, w, type, t, fl, bo] of st.snap.pl) {
        seen.add("p" + id);
        let d = disp.get("p" + id); if (d == null) d = y; else d += (y - d) * k; disp.set("p" + id, d);
        plat(x, d, w, type, t, fl, bo, now);
      }
      for (const key of [...disp.keys()]) if (key[0] === "p" && !seen.has(key)) disp.delete(key);
      for (const p of st.snap.ps) {
        let d = disp.get("k" + p.s);
        if (!d) d = { x: p.x, y: p.y }; else { d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k; if (Math.abs(p.x - d.x) > 160) d.x = p.x; }
        disp.set("k" + p.s, d);
        if (p.a) kid(p.s, d.x, d.y, p.f, p.g, p.w, p.h, p.s === st.you, now);
      }
      if (st.snap.ready > 0) bigText(st.snap.ready > 30 ? "READY" : "GO!", DW / 2, DH / 2 + 24, 72, "#f7ffc6", "#9be22a", "#173608", "center");
    }
    ceiling();
    ctx.restore();
  }

  const onResize = () => fit();
  window.addEventListener("resize", onResize);
  fit(); connect(); raf = requestAnimationFrame(frame);
  return () => {
    closed = true; cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", onBlur);
    try { ws.close(); } catch {}
  };
}
