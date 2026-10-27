// 四連棋（兩人，透過 WebSocket 同步）：7 欄 × 6 列，棋子往下掉，先連四顆獲勝
import { wsUrl } from "./gomoku.js";
import { wood, woodRegion, vignette, stone } from "./boardfx.js";
import { createWager } from "./wager.js";
import { createSeat, specFirst } from "./seat.js";
const W = 7, H = 6;

export function mountConnect4(root, { env, back }) {
  root.innerHTML = `
    <div class="game gomoku c4">
      <header><button class="back">← 選單</button><h2>四連棋</h2><span class="watch"></span></header>
      <div class="status">連線中…</div>
      <div class="wager"></div>
      <div class="cwrap"><canvas></canvas></div>
      <div class="actions"><button class="resign" hidden>認輸</button><button class="again" hidden>再來一局（紅黃互換）</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const statusEl = $(".status"), resignBtn = $(".resign"), againBtn = $(".again"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);
  const wg = createWager(root, { env, getWs: () => ws, getSt: () => st });
  const seat = createSeat(root, { getWs: () => ws, getSt: () => st });

  let st = null, ws = null, closed = false, retry = 0, hover = -1, cell = 60, W_px = 420, H_px = 360;

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "join", game: "c4", room: env.instanceId, spectate: !!env.watchOnly || specFirst() })); wg.onOpen(); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "state") { st = m; render(); wg.update(); seat.update(); } else wg.onMsg(m); };
    ws.onclose = () => {
      if (closed) return;
      statusEl.textContent = "連線中斷，重新連線…";
      setTimeout(connect, Math.min(5000, 700 * ++retry));
    };
    ws.onerror = () => {};
  }

  function resize() {
    const wrap = $(".cwrap");
    const w = Math.max(210, Math.min(wrap.clientWidth, 640));
    const maxH = wrap.clientHeight || 9999;
    cell = Math.min(w / W, maxH / H);
    W_px = cell * W; H_px = cell * H;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W_px + "px"; canvas.style.height = H_px + "px";
    canvas.width = Math.round(W_px * dpr); canvas.height = Math.round(H_px * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  const COLORS = { b: ["#ff8a80", "#d32f2f"], w: ["#fff59d", "#f9a825"] };
  const name = (c) => (c === "b" ? "🔴紅棋" : "🟡黃棋");
  const myTurn = () => st && !st.winner && st.you !== "s" && st.turn === st.you && st.players.b && st.players.w;
  const colFull = (c) => st.board[c] !== ".";

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H_px); bg.addColorStop(0, "#2a63e0"); bg.addColorStop(1, "#173f9e");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W_px, H_px);
    const r = cell * 0.4;
    const win = new Set((st && st.line || []).map(([x, y]) => y * W + x));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = (x + 0.5) * cell, py = (y + 0.5) * cell;
      const c = st ? st.board[y * W + x] : ".";
      ctx.beginPath(); ctx.arc(px, py, r + cell * 0.04, 0, 7); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fill();
      if (c === ".") { const hg = ctx.createLinearGradient(0, py - r, 0, py + r); hg.addColorStop(0, "#08184a"); hg.addColorStop(1, "#13307f"); ctx.fillStyle = hg; }
      else {
        const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.35, r * 0.05, px, py, r);
        g.addColorStop(0, "#fff"); g.addColorStop(0.12, COLORS[c][0]); g.addColorStop(1, COLORS[c][1]); ctx.fillStyle = g;
      }
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
      if (c !== ".") { ctx.beginPath(); ctx.arc(px, py, r * 0.68, 0, 7); ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = cell * 0.04; ctx.stroke(); }
      if (win.has(y * W + x)) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.stroke(); }
      else if (st && st.last && st.last[0] === x && st.last[1] === y) { ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (st && hover >= 0 && myTurn() && !colFull(hover)) {   // 預覽會掉到哪一格
      let row = H - 1; while (row >= 0 && st.board[row * W + hover] !== ".") row--;
      ctx.fillStyle = st.you === "b" ? "rgba(255,138,128,.45)" : "rgba(255,245,157,.45)";
      ctx.beginPath(); ctx.arc((hover + 0.5) * cell, (row + 0.5) * cell, r, 0, 7); ctx.fill();
    }
  }

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

  const colAt = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((ev.clientX - rect.left) / rect.width * W);
    return c >= 0 && c < W ? c : -1;
  };
  canvas.addEventListener("mousemove", (e) => { hover = colAt(e); draw(); });
  canvas.addEventListener("mouseleave", () => { hover = -1; draw(); });
  canvas.addEventListener("click", (e) => {
    const c = colAt(e);
    if (c < 0 || !myTurn() || colFull(c)) return;
    ws.send(JSON.stringify({ t: "move", c }));
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
  return () => { closed = true; try { ro && ro.disconnect(); } catch {} window.removeEventListener("resize", resize); try { ws.close(); } catch {} };
}
