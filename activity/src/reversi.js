// 黑白棋（兩人，透過 WebSocket 同步）：8×8，夾住對方的棋就翻面，沒地方下會自動跳過
import { wsUrl } from "./gomoku.js";
import { wood, woodRegion, vignette, stone } from "./boardfx.js";
import { createWager } from "./wager.js";
import { createSeat, specFirst } from "./seat.js";
const N = 8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function flips(board, x, y, c) {
  if (board[y * N + x] !== ".") return 0;
  const o = c === "b" ? "w" : "b";
  let n = 0;
  for (const [dx, dy] of DIRS) {
    let k = 0, nx = x + dx, ny = y + dy;
    while (nx >= 0 && ny >= 0 && nx < N && ny < N && board[ny * N + nx] === o) { k++; nx += dx; ny += dy; }
    if (k && nx >= 0 && ny >= 0 && nx < N && ny < N && board[ny * N + nx] === c) n += k;
  }
  return n;
}

export function mountReversi(root, { env, back }) {
  root.innerHTML = `
    <div class="game gomoku reversi">
      <header><button class="back">← 選單</button><h2>黑白棋</h2><span class="watch"></span></header>
      <div class="status">連線中…</div>
      <div class="rvscore"></div>
      <div class="wager"></div>
      <div class="cwrap"><canvas></canvas></div>
      <div class="actions"><button class="resign" hidden>認輸</button><button class="again" hidden>再來一局（黑白互換）</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const statusEl = $(".status"), scoreEl = $(".rvscore"), resignBtn = $(".resign"), againBtn = $(".again"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);
  const wg = createWager(root, { env, getWs: () => ws, getSt: () => st });
  const seat = createSeat(root, { getWs: () => ws, getSt: () => st });

  let st = null, ws = null, closed = false, retry = 0, hover = null, cell = 50, px = 400;
  let prev = null, flipAt = {};   // 翻面動畫：記下哪些格剛翻過

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "join", game: "rv", room: env.instanceId, spectate: specFirst() })); wg.onOpen(); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "state") {
        if (prev && prev.length === m.board.length) {
          for (let i = 0; i < m.board.length; i++) if (prev[i] !== "." && m.board[i] !== prev[i]) flipAt[i] = performance.now();
        }
        prev = m.board; st = m; render(); wg.update(); seat.update(); animate();
      } else wg.onMsg(m);
    };
    ws.onclose = () => {
      if (closed) return;
      statusEl.textContent = "連線中斷，重新連線…";
      setTimeout(connect, Math.min(5000, 700 * ++retry));
    };
    ws.onerror = () => {};
  }

  function resize() {
    const wrap = $(".cwrap");
    const w = Math.max(240, Math.min(wrap.clientWidth, 640));
    const maxH = wrap.clientHeight || 9999;
    px = Math.min(w, maxH); cell = px / N;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = px + "px"; canvas.style.height = px + "px";
    canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  const name = (c) => (c === "b" ? "⚫黑棋" : "⚪白棋");
  const myTurn = () => st && !st.winner && st.you !== "s" && st.turn === st.you && st.players.b && st.players.w;
  const count = (c) => (st ? [...st.board].filter((x) => x === c).length : 2);

  function disc(cx, cy, r, c, sx = 1) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, 1);
    stone(ctx, 0, 0, r, c); ctx.restore();
  }

  function draw() {
    const fg = ctx.createRadialGradient(px / 2, px / 2, px * 0.1, px / 2, px / 2, px * 0.75); fg.addColorStop(0, "#2a9150"); fg.addColorStop(1, "#14592b");
    ctx.fillStyle = fg; ctx.fillRect(0, 0, px, px); wood(ctx, px, px, "rgba(0,0,0,0)", "#0b3a1a", 3);
    ctx.strokeStyle = "#0e4a22"; ctx.lineWidth = 1.5;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, px); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(px, i * cell); ctx.stroke();
    }
    ctx.fillStyle = "#0e4a22";
    for (const [x, y] of [[2, 2], [6, 2], [2, 6], [6, 6]]) { ctx.beginPath(); ctx.arc(x * cell, y * cell, cell * 0.06, 0, 7); ctx.fill(); }
    if (!st) return;
    const now = performance.now();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, c = st.board[i];
      if (c === ".") continue;
      const t = flipAt[i] ? (now - flipAt[i]) / 380 : 1;
      if (t < 1) {   // 翻面：先壓扁舊色，再展開新色
        const k = Math.abs(Math.cos(t * Math.PI));
        disc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.42, t < 0.5 ? (c === "b" ? "w" : "b") : c, Math.max(0.05, k));
      } else { delete flipAt[i]; disc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.42, c); }
    }
    if (st.last) {
      ctx.strokeStyle = "#ff5252"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc((st.last[0] + 0.5) * cell, (st.last[1] + 0.5) * cell, cell * 0.12, 0, 7); ctx.stroke();
    }
    if (myTurn()) {   // 可下的位置
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (flips(st.board, x, y, st.you)) {
          ctx.fillStyle = hover && hover[0] === x && hover[1] === y ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.2)";
          ctx.beginPath(); ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.12, 0, 7); ctx.fill();
        }
      }
    }
  }

  let raf = 0;
  function animate() {
    cancelAnimationFrame(raf);
    draw();
    if (Object.keys(flipAt).length) raf = requestAnimationFrame(animate);
  }

  function render() {
    draw();
    if (!st) return;
    watchEl.textContent = st.watchers > 2 ? `👀 ${st.watchers - 2} 人旁觀` : "";
    scoreEl.textContent = `⚫ ${count("b")}　　⚪ ${count("w")}`;
    const me = st.you === "s" ? "你在旁觀" : `你是${name(st.you)}`;
    let t;
    if (st.winner === "d") t = `平手！${count("b")} 比 ${count("w")}`;
    else if (st.winner) t = st.winner === st.you ? `🎉 你贏了！（${name(st.winner)}）` : (st.you === "s" ? `${name(st.winner)}獲勝` : `😢 ${name(st.winner)}贏了`);
    else if (!st.players.b || !st.players.w) t = `${me}　等另一位玩家加入…（請朋友也點開 Activity）`;
    else t = `${me}　輪到${name(st.turn)}${st.turn === st.you ? "（你）" : ""}` + (st.passed ? `　（${name(st.passed)}沒地方下，跳過）` : "");
    statusEl.textContent = t;
    resignBtn.hidden = !(st.you !== "s" && !st.winner && st.players.b && st.players.w);
    againBtn.hidden = !(st.you !== "s" && st.winner);
  }

  const cellAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / r.width * N), y = Math.floor((ev.clientY - r.top) / r.height * N);
    return x >= 0 && y >= 0 && x < N && y < N ? [x, y] : null;
  };
  canvas.addEventListener("mousemove", (e) => { hover = cellAt(e); draw(); });
  canvas.addEventListener("mouseleave", () => { hover = null; draw(); });
  canvas.addEventListener("click", (e) => {
    const p = cellAt(e);
    if (!p || !myTurn() || !flips(st.board, p[0], p[1], st.you)) return;
    ws.send(JSON.stringify({ t: "move", x: p[0], y: p[1] }));
  });
  againBtn.addEventListener("click", () => ws.send(JSON.stringify({ t: "again" })));
  let armed = 0;
  resignBtn.addEventListener("click", () => {
    if (Date.now() - armed < 3000) { armed = 0; resignBtn.textContent = "認輸"; ws.send(JSON.stringify({ t: "resign" })); return; }
    armed = Date.now(); resignBtn.textContent = "再按一次確認認輸";
    setTimeout(() => { if (Date.now() - armed >= 3000) { armed = 0; resignBtn.textContent = "認輸"; } }, 3100);
  });

  window.addEventListener("resize", resize);
  let ro = null; try { ro = new ResizeObserver(() => resize()); ro.observe(root.querySelector(".cwrap")); } catch {}
  connect();
  requestAnimationFrame(resize);
  return () => { closed = true; try { ro && ro.disconnect(); } catch {} cancelAnimationFrame(raf); window.removeEventListener("resize", resize); try { ws.close(); } catch {} };
}
