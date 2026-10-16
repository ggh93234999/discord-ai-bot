// 五子棋（兩人，透過 WebSocket 同步）
const SIZE = 15;

function wsUrl(inDiscord) {
  if (inDiscord) return `wss://${location.host}/.proxy/ws`;           // Discord proxy：/ 對應到 mh.hy0936.com.tw/wordle
  const u = new URL("ws", location.href);                             // 一般瀏覽器：mh.hy0936.com.tw/wordle/ws
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.search = "";
  return u.toString();
}

export { wsUrl };
export function mountGomoku(root, { env, back }) {
  root.innerHTML = `
    <div class="game gomoku">
      <header><button class="back">← 選單</button><h2>五子棋</h2><span class="watch"></span></header>
      <div class="status">連線中…</div>
      <div class="cwrap"><canvas></canvas></div>
      <div class="actions"><button class="resign" hidden>認輸</button><button class="again" hidden>再來一局（黑白互換）</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const statusEl = $(".status"), resignBtn = $(".resign"), againBtn = $(".again"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);

  let st = null, ws = null, closed = false, retry = 0, hover = null;
  let cell = 30, pad = 18;

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "join", room: env.instanceId })); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "state") { st = m; render(); } };
    ws.onclose = () => {
      if (closed) return;
      statusEl.textContent = "連線中斷，重新連線…";
      setTimeout(connect, Math.min(5000, 700 * ++retry));
    };
    ws.onerror = () => {};
  }

  function resize() {
    const wrap = $(".cwrap");
    const size = Math.max(200, Math.min(wrap.clientWidth, wrap.clientHeight || 9999, 640));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = canvas.style.height = size + "px";
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pad = size / (SIZE + 1) * 0.9;
    cell = (size - pad * 2) / (SIZE - 1);
    canvas._size = size;
    render();
  }

  function pos(x, y) { return [pad + x * cell, pad + y * cell]; }

  function draw() {
    const size = canvas._size || 300;
    ctx.fillStyle = "#d9b45f"; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#5b4510"; ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const [x0, y0] = pos(0, i), [x1] = pos(SIZE - 1, i);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
      const [a, b0] = pos(i, 0), [, b1] = pos(i, SIZE - 1);
      ctx.beginPath(); ctx.moveTo(a, b0); ctx.lineTo(a, b1); ctx.stroke();
    }
    ctx.fillStyle = "#5b4510";
    for (const [sx, sy] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      const [x, y] = pos(sx, sy); ctx.beginPath(); ctx.arc(x, y, cell * 0.1, 0, 7); ctx.fill();
    }
    if (!st) return;
    const r = cell * 0.44;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const c = st.board[y * SIZE + x];
      if (c === ".") continue;
      const [px, py] = pos(x, y);
      const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
      if (c === "b") { g.addColorStop(0, "#666"); g.addColorStop(1, "#000"); } else { g.addColorStop(0, "#fff"); g.addColorStop(1, "#cfcfcf"); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1; ctx.stroke();
    }
    if (st.last) {
      const [px, py] = pos(st.last[0], st.last[1]);
      ctx.fillStyle = "#e53935"; ctx.beginPath(); ctx.arc(px, py, cell * 0.12, 0, 7); ctx.fill();
    }
    if (st.line) {
      ctx.strokeStyle = "#e53935"; ctx.lineWidth = 3; ctx.beginPath();
      st.line.forEach(([x, y], i) => { const [px, py] = pos(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }
    if (hover && myTurn() && st.board[hover[1] * SIZE + hover[0]] === ".") {
      const [px, py] = pos(hover[0], hover[1]);
      ctx.fillStyle = st.you === "b" ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.55)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    }
  }

  const name = (c) => (c === "b" ? "黑棋" : "白棋");
  function myTurn() { return st && !st.winner && st.you !== "s" && st.turn === st.you && st.players.b && st.players.w; }

  function render() {
    draw();
    if (!st) return;
    watchEl.textContent = st.watchers > 2 ? `👀 ${st.watchers - 2} 人旁觀` : "";
    const me = st.you === "s" ? "你在旁觀" : `你是${name(st.you)}`;
    let t;
    if (st.winner === "d") t = "平手！棋盤滿了";
    else if (st.winner) t = st.winner === st.you ? `🎉 你贏了！（${name(st.winner)}）` : (st.you === "s" ? `${name(st.winner)}獲勝` : `😢 ${name(st.winner)}贏了`);
    else if (!st.players.b || !st.players.w) t = `${me}　等另一位玩家加入…（請朋友也點開 Activity）`;
    else t = `${me}　輪到${name(st.turn)}${st.turn === st.you ? "（你）" : ""}`;
    statusEl.textContent = t;
    resignBtn.hidden = !(st.you !== "s" && !st.winner && st.players.b && st.players.w);
    againBtn.hidden = !(st.you !== "s" && st.winner);
  }

  function cellAt(ev) {
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (canvas._size / rect.width);
    const py = (ev.clientY - rect.top) * (canvas._size / rect.height);
    const x = Math.round((px - pad) / cell), y = Math.round((py - pad) / cell);
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? [x, y] : null;
  }
  canvas.addEventListener("mousemove", (e) => { hover = cellAt(e); draw(); });
  canvas.addEventListener("mouseleave", () => { hover = null; draw(); });
  canvas.addEventListener("click", (e) => {
    const c = cellAt(e);
    if (!c || !myTurn() || st.board[c[1] * SIZE + c[0]] !== ".") return;
    ws.send(JSON.stringify({ t: "move", x: c[0], y: c[1] }));
  });
  resignBtn.addEventListener("click", () => { if (confirm_("確定要認輸嗎？")) ws.send(JSON.stringify({ t: "resign" })); });
  againBtn.addEventListener("click", () => ws.send(JSON.stringify({ t: "again" })));
  // Discord iframe 裡不一定能用 window.confirm，改成點兩下確認
  let resignArmed = 0;
  function confirm_(txt) {
    const now = Date.now();
    if (now - resignArmed < 3000) { resignArmed = 0; resignBtn.textContent = "認輸"; return true; }
    resignArmed = now; resignBtn.textContent = "再按一次確認認輸";
    setTimeout(() => { if (Date.now() - resignArmed >= 3000) { resignArmed = 0; resignBtn.textContent = "認輸"; } }, 3100);
    return false;
  }

  window.addEventListener("resize", resize);
  connect();
  requestAnimationFrame(resize);
  return () => { closed = true; window.removeEventListener("resize", resize); try { ws.close(); } catch {} };
}
