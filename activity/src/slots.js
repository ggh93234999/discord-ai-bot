// 老虎機（轉輪動畫版）。結果由伺服器決定；這裡只負責演出。
// 目前只有「練習模式」（練習幣，不碰真代幣）；賭注模式需要 Discord 授權，之後再接。
import { wsUrl } from "./gomoku.js";

const KINDS = [
  { id: 1, name: "3 格", rows: 1, cols: 3, syms: ["🍒", "🍋", "🔔", "🍇", "🍀", "💎"], hint: "三個一樣大賠，兩個一樣退錢" },
  { id: 3, name: "3×3", rows: 3, cols: 3, syms: ["🍒", "🍋", "🔔", "💎"], hint: "8 條線，3 格一樣就中" },
  { id: 4, name: "4×4", rows: 4, cols: 4, syms: ["🍒", "🍋", "💎"], hint: "10 條線，整排整欄 4 格一樣才中" },
];
const BETS = [10, 50, 100, 500];

export function mountSlots(root, { env, back }) {
  root.innerHTML = `
    <div class="game slots">
      <header><button class="back">← 選單</button><h2>老虎機</h2><button class="mute" title="音效">🔊</button></header>
      <div class="modebar"><span class="mode on">🎮 練習模式</span><span class="mode off" title="需要 Discord 授權，還沒開放">💰 賭注模式（尚未開放）</span></div>
      <div class="status">連線中…</div>
      <div class="kinds"></div>
      <div class="machine"><div class="reels"></div></div>
      <div class="hint"></div>
      <div class="bar">
        <div class="bal">練習幣 <b>--</b></div>
        <div class="bets"></div>
        <button class="spin">🎰 開轉</button>
      </div>
      <div class="actions"><button class="reset" hidden>補充練習幣</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const reelsEl = $(".reels"), statusEl = $(".status"), spinBtn = $(".spin"), balEl = $(".bal b"), resetBtn = $(".reset");
  $(".back").addEventListener("click", back);

  let kind = KINDS[1], bet = 50, ws = null, closed = false, retry = 0, busy = false, pending = false, balance = null, muted = false;
  let cell = 64, last = null;   // last：最後一次結果，縮放視窗重畫時要保留
  const timers = [];

  // ---- 音效（WebAudio，點了才會開始）
  let ac = null;
  const beep = (f, d = 0.08, type = "square", v = 0.05, at = 0) => {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
    } catch {}
  };
  $(".mute").addEventListener("click", (e) => { muted = !muted; e.target.textContent = muted ? "🔇" : "🔊"; });

  // ---- 連線
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "slotjoin" })); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "slotinit") { balance = m.balance; showBalance(); statusEl.textContent = m.broke ? "練習幣不夠了，換小一點的賭注或補充" : "選賭注，按開轉"; }
      else if (m.t === "slot") play(m);
    };
    ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }
  function showBalance() {
    balEl.textContent = balance == null ? "--" : balance.toLocaleString();
    resetBtn.hidden = !(balance != null && balance < Math.min(...BETS));
  }

  // ---- 介面
  const kindsEl = $(".kinds"), betsEl = $(".bets");
  KINDS.forEach((k) => {
    const b = document.createElement("button"); b.textContent = k.name; b.dataset.id = k.id;
    b.addEventListener("click", () => { if (!busy) { kind = k; last = null; build(); } });
    kindsEl.appendChild(b);
  });
  BETS.forEach((n) => {
    const b = document.createElement("button"); b.textContent = n; b.dataset.bet = n;
    b.addEventListener("click", () => { if (!busy) { bet = n; mark(); } });
    betsEl.appendChild(b);
  });
  function mark() {
    kindsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", Number(b.dataset.id) === kind.id));
    betsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", Number(b.dataset.bet) === bet));
    $(".hint").textContent = kind.hint;
  }
  const rnd = (syms) => syms[Math.floor(Math.random() * syms.length)];
  function sym(s) { const d = document.createElement("div"); d.className = "sym"; d.textContent = s; return d; }

  // 每一欄是一條符號帶；平常只露出 rows 格
  function build() {
    const w = Math.min(root.clientWidth - 40, 420);
    cell = Math.max(46, Math.min(72, Math.floor(w / kind.cols)));
    reelsEl.style.setProperty("--cell", cell + "px");
    reelsEl.style.setProperty("--rows", kind.rows);
    reelsEl.innerHTML = "";
    for (let c = 0; c < kind.cols; c++) {
      const reel = document.createElement("div"); reel.className = "reel";
      const strip = document.createElement("div"); strip.className = "strip";
      for (let r = 0; r < kind.rows; r++) strip.appendChild(sym(last && last.kind === kind.id ? last.grid[r][c] : rnd(kind.syms)));
      reel.appendChild(strip); reelsEl.appendChild(reel);
    }
    if (last && last.kind === kind.id) markWins(last.wins);
    mark();
  }

  function markWins(wins) {
    const reels = reelsEl.querySelectorAll(".reel");
    for (const w of wins) for (const [r, c] of w.line) reels[c].querySelector(".strip").children[r].classList.add("win");
  }

  // ---- 轉動
  spinBtn.addEventListener("click", () => {
    if (busy || !ws || ws.readyState !== 1) return;
    if (balance != null && balance < bet) { statusEl.textContent = "練習幣不夠，選小一點的賭注"; return; }
    busy = true; pending = false; spinBtn.disabled = true; statusEl.textContent = "轉動中…";
    last = null;
    reelsEl.querySelectorAll(".win").forEach((e) => e.classList.remove("win"));
    reelsEl.classList.remove("flash");
    beep(220, 0.06); beep(330, 0.06, "square", 0.05, 0.07);
    reelsEl.querySelectorAll(".strip").forEach((strip) => strip.classList.add("blur"));   // 等伺服器結果時先快速滾動
    ws.send(JSON.stringify({ t: "spin", kind: kind.id, bet }));
    timers.push(setTimeout(() => {
      if (busy && !pending) { busy = false; spinBtn.disabled = false; build(); statusEl.textContent = "沒有收到結果，再試一次"; }
    }, 6000));
  });

  function play(m) {
    pending = true;
    const reels = [...reelsEl.querySelectorAll(".reel")];
    reels.forEach((reel, c) => {
      const strip = reel.querySelector(".strip");
      strip.classList.remove("blur");
      strip.innerHTML = "";
      for (let r = 0; r < kind.rows; r++) strip.appendChild(sym(m.grid[r][c]));      // 最上面是最後停下的結果
      for (let i = 0; i < 14 + c * 6; i++) strip.appendChild(sym(rnd(kind.syms)));
      const total = strip.children.length;
      strip.style.transition = "none";
      strip.style.transform = `translateY(${-(total - kind.rows) * cell}px)`;
      void strip.offsetHeight;
      const dur = 1100 + c * 420;
      strip.style.transition = `transform ${dur}ms cubic-bezier(.15,.75,.25,1)`;
      strip.style.transform = "translateY(0)";
      timers.push(setTimeout(() => beep(520 + c * 90, 0.07, "triangle", 0.07), dur));
    });
    timers.push(setTimeout(() => finish(m, reels), 1100 + (kind.cols - 1) * 420 + 150));
  }

  function finish(m, reels) {
    pending = false; busy = false; spinBtn.disabled = false;
    last = { kind: m.kind, grid: m.grid, wins: m.wins };
    balance = m.balance; showBalance();
    const net = m.back - m.bet;
    const sign = net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `${net.toLocaleString()}` : "打平";
    if (m.wins.length || m.mult > 0) {
      markWins(m.wins);
      statusEl.textContent = `${m.kind === 1 ? m.note : `中了 ${m.wins.length} 條線`}　${sign}`;
      if (net > 0) {
        reelsEl.classList.add("flash");
        [660, 880, 1100, 1320].forEach((f, i) => beep(f, 0.14, "triangle", 0.08, i * 0.1));
        if (m.mult >= 3 || m.wins.length >= 3) [1320, 1760].forEach((f, i) => beep(f, 0.3, "sine", 0.09, 0.45 + i * 0.12));
      } else beep(300, 0.15, "sine", 0.05);
    } else { statusEl.textContent = `沒中　${sign}`; beep(160, 0.2, "sawtooth", 0.04); }
  }

  resetBtn.addEventListener("click", () => ws && ws.send(JSON.stringify({ t: "slotreset" })));
  const onResize = () => { if (!busy) build(); };   // 轉動中不重畫，停下後保留結果
  window.addEventListener("resize", onResize);
  build(); connect();
  return () => { closed = true; timers.forEach(clearTimeout); window.removeEventListener("resize", onResize); try { ws.close(); } catch {} };
}
