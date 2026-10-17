// 老虎機（轉輪動畫版）。結果由伺服器決定；這裡只負責演出。
// 兩種模式：
//   練習模式：練習幣，不需要登入，隨便玩。
//   賭注模式：要用 Discord 授權確認身分，動用機器人錢包裡的真代幣（只能在 Discord 裡開 Activity 時使用）。
import { wsUrl } from "./gomoku.js";

const KINDS = [
  { id: 1, name: "3 格", rows: 1, cols: 3, syms: ["🍒", "🍋", "💎"], hint: "三個一樣拿 2～3.2 倍，兩個一樣退錢" },
  { id: 3, name: "3×3", rows: 3, cols: 3, syms: ["🍒", "🍋", "🔔", "💎"], hint: "8 條線，3 格一樣就中" },
  { id: 4, name: "4×4", rows: 4, cols: 4, syms: ["🍒", "🍋", "💎"], hint: "10 條線，整排整欄 4 格一樣才中" },
];
const BETS = [10, 50, 100, 500];

export function mountSlots(root, { env, back }) {
  root.innerHTML = `
    <div class="game slots">
      <header><button class="back">← 選單</button><h2>老虎機</h2><button class="mute" title="音效">🔊</button></header>
      <div class="modebar">
        <button class="mode on" data-m="practice">🎮 練習模式</button>
        <button class="mode" data-m="real">💰 賭注模式</button>
      </div>
      <div class="confirm" hidden>
        <div class="ctext"></div>
        <div class="cbtns"><button class="cyes">確定開啟</button><button class="cno">取消</button></div>
      </div>
      <div class="status">連線中…</div>
      <div class="kinds"></div>
      <div class="machine"><div class="reels"></div></div>
      <div class="hint"></div>
      <div class="bar">
        <div class="bal"><span class="ballabel">練習幣</span> <b>--</b></div>
        <div class="bets"></div>
        <button class="spin">🎰 開轉</button>
      </div>
      <div class="actions"><button class="reset" hidden>補充練習幣</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const reelsEl = $(".reels"), statusEl = $(".status"), spinBtn = $(".spin"), balEl = $(".bal b"), resetBtn = $(".reset");
  const gameEl = $(".slots"), confirmEl = $(".confirm");
  $(".back").addEventListener("click", back);

  let kind = KINDS[1], bet = 50, ws = null, closed = false, retry = 0, busy = false, pending = false, muted = false;
  let cell = 64, last = null;
  let mode = "practice", session = null, practiceBal = null, realBal = null, wantReal = false;
  const timers = [];
  const real = () => mode === "real";
  const cur = () => (real() ? realBal : practiceBal);

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

  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => {
      retry = 0; send({ t: "slotjoin" });
      if (session) send({ t: "bauth", token: session.token });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "slotinit") onInit(m);
      else if (m.t === "slot") play(m);
      else if (m.t === "bauthed") onAuthed(m);
    };
    ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }

  const ERR = {
    insufficient: "代幣不夠，選小一點的賭注",
    bot_down: "機器人暫時連不上，稍後再試",
    no_guild: "找不到伺服器，請聯絡管理員",
    bad_amount: "賭注不合法",
  };
  function onInit(m) {
    if (m.real) {
      if (m.balance != null) realBal = m.balance;
      busy = false; pending = false; spinBtn.disabled = false; showBalance();
      statusEl.textContent = ERR[m.error] || "選賭注，按開轉";
      return;
    }
    practiceBal = m.balance;
    showBalance();
    if (!real()) statusEl.textContent = m.broke ? "練習幣不夠了，換小一點的賭注或補充" : "選賭注，按開轉";
  }
  function showBalance() {
    const b = cur();
    balEl.textContent = b == null ? "--" : b.toLocaleString();
    resetBtn.hidden = real() || !(practiceBal != null && practiceBal < Math.min(...BETS));
  }

  const modeBtns = root.querySelectorAll(".mode");
  function setMode(m) {
    mode = m;
    modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    gameEl.classList.toggle("realmode", m === "real");
    root.querySelector(".ballabel").textContent = m === "real" ? "💰 代幣" : "練習幣";
    showBalance();
    statusEl.textContent = m === "real" ? `賭注模式：${session ? session.name : ""}，用的是真代幣！` : "練習模式：選賭注，按開轉";
  }
  function askConfirm(text, onYes) {
    confirmEl.hidden = false; $(".ctext").textContent = text;
    $(".cyes").onclick = () => { confirmEl.hidden = true; onYes(); };
    $(".cno").onclick = () => { confirmEl.hidden = true; statusEl.textContent = "已取消"; };
  }
  modeBtns.forEach((b) => b.addEventListener("click", () => {
    if (busy) return;
    if (b.dataset.m === "practice") { setMode("practice"); return; }
    if (real()) return;
    if (!env.inDiscord || !env.sdk) { statusEl.textContent = "賭注模式要在 Discord 裡開啟這個 Activity 才能用（要確認你的 Discord 身分）"; return; }
    askConfirm("賭注模式會用到你在機器人那邊的真代幣，輸贏都會算數。要開啟嗎？（第一次會跳出 Discord 授權視窗）", login);
  }));

  async function login() {
    try {
      if (!session) {
        statusEl.textContent = "請在 Discord 跳出的視窗按「授權」…";
        await env.sdk.ready();
        const { code } = await env.sdk.commands.authorize({
          client_id: env.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"],
        });
        statusEl.textContent = "確認身分中…";
        const r = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 403) { statusEl.textContent = "你不是這個伺服器的成員，不能用賭注模式"; return; }
        if (!r.ok || !j.token) { statusEl.textContent = "登入失敗，請再試一次（" + (j.error || r.status) + "）"; return; }
        session = { token: j.token, name: j.name };
      }
      wantReal = true;
      send({ t: "bauth", token: session.token });
    } catch (e) {
      statusEl.textContent = "授權沒有完成，賭注模式未開啟";
    }
  }
  function onAuthed(m) {
    if (!m.ok) {
      session = null;
      if (wantReal) { wantReal = false; statusEl.textContent = m.error === "bot_down" ? ERR.bot_down : "登入已失效，請重新開啟賭注模式"; }
      if (real()) setMode("practice");
      return;
    }
    realBal = m.balance; session.name = m.name || session.name;
    if (wantReal) { wantReal = false; setMode("real"); }
    else showBalance();
  }

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

  spinBtn.addEventListener("click", () => {
    if (busy || !ws || ws.readyState !== 1) return;
    if (cur() != null && cur() < bet) { statusEl.textContent = ERR.insufficient; return; }
    busy = true; pending = false; last = null; spinBtn.disabled = true; statusEl.textContent = "轉動中…";
    reelsEl.querySelectorAll(".win").forEach((e) => e.classList.remove("win"));
    reelsEl.classList.remove("flash");
    beep(220, 0.06); beep(330, 0.06, "square", 0.05, 0.07);
    send({ t: "spin", kind: kind.id, bet, real: real() });
    timers.push(setTimeout(() => {
      if (busy && !pending) { busy = false; spinBtn.disabled = false; build(); statusEl.textContent = "沒有收到結果，再試一次"; }
    }, 6000));
  });

  function play(m) {
    pending = true;
    const reels = [...reelsEl.querySelectorAll(".reel")];
    reels.forEach((reel, c) => {
      const strip = reel.querySelector(".strip");
      strip.innerHTML = "";
      for (let r = 0; r < kind.rows; r++) strip.appendChild(sym(m.grid[r][c]));
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
    timers.push(setTimeout(() => finish(m), 1100 + (kind.cols - 1) * 420 + 150));
  }

  function finish(m) {
    pending = false; busy = false; spinBtn.disabled = false;
    last = { kind: m.kind, grid: m.grid, wins: m.wins };
    if (m.real) realBal = m.balance; else practiceBal = m.balance;
    showBalance();
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

  resetBtn.addEventListener("click", () => send({ t: "slotreset" }));
  const onResize = () => { if (!busy) build(); };
  window.addEventListener("resize", onResize);
  build(); connect();
  return () => { closed = true; timers.forEach(clearTimeout); window.removeEventListener("resize", onResize); try { ws.close(); } catch {} };
}
