// 排球（兩人即時對戰，物理在伺服器算；這裡只負責送按鍵與畫面）。角色是原創的圓滾滾小怪物。
import { wsUrl } from "./gomoku.js";
const W = 432, H = 304, GROUND = 280, NET_X = 216, NET_HALF = 4, NET_TOP = 170, R = 32, BR = 14;

export function mountVolley(root, { env, back }) {
  root.innerHTML = `
    <div class="game gomoku vb">
      <header><button class="back">← 選單</button><h2>圓球排球</h2><span class="watch"></span></header>
      <div class="status">連線中…</div>
      <div class="cwrap"><canvas></canvas></div>
      <div class="pad"><button data-k="l">◀</button><button data-k="j">⤒ 跳</button><button data-k="r">▶</button></div>
      <div class="actions"><button class="resign" hidden>認輸</button><button class="again" hidden>再來一局（左右互換）</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const statusEl = $(".status"), resignBtn = $(".resign"), againBtn = $(".again"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);

  let st = null, ws = null, closed = false, retry = 0, k = 0;
  const keys = { l: false, r: false, j: false };
  let sent = "";

  const sendKeys = () => {
    const s = JSON.stringify(keys);
    if (s === sent || !ws || ws.readyState !== 1) return;
    sent = s; ws.send(JSON.stringify({ t: "in", ...keys }));
  };

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; sent = ""; ws.send(JSON.stringify({ t: "join", game: "vb", room: env.instanceId })); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "state") { st = m; updateText(); } };
    ws.onclose = () => {
      if (closed) return;
      statusEl.textContent = "連線中斷，重新連線…";
      setTimeout(connect, Math.min(5000, 700 * ++retry));
    };
    ws.onerror = () => {};
  }

  // 鍵盤
  const map = { ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r", ArrowUp: "j", KeyW: "j", Space: "j" };
  const onKey = (down) => (e) => { const a = map[e.code]; if (!a) return; e.preventDefault(); keys[a] = down; sendKeys(); };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
  // 觸控／滑鼠按鈕
  root.querySelectorAll(".pad button").forEach((b) => {
    const a = b.dataset.k;
    const set = (v) => (e) => { e.preventDefault(); keys[a] = v; sendKeys(); };
    b.addEventListener("pointerdown", set(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, set(false));
  });
  const blur = () => { keys.l = keys.r = keys.j = false; sendKeys(); };
  window.addEventListener("blur", blur);

  function resize() {
    const wrap = $(".cwrap");
    const w = Math.max(240, Math.min(wrap.clientWidth, 720));
    const maxH = wrap.clientHeight || 9999;
    const scale = Math.min(w / W, maxH / H);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W * scale + "px"; canvas.style.height = H * scale + "px";
    canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    k = scale * dpr;
  }

  function blob(x, y, color, role) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, R, Math.PI, 0); ctx.closePath(); ctx.fill();
    // 眼睛看向球
    const bx = st ? st.vb.ball[0] : x, by = st ? st.vb.ball[1] : y;
    const a = Math.atan2(by - (y - 12), bx - x);
    const ex = role === "b" ? 10 : -10;
    for (const off of [-9, 9]) {
      const px = x + off + ex * 0.3, py = y - 16;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill();
      ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(px + Math.cos(a) * 3, py + Math.sin(a) * 3, 3.2, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.arc(x - 14, y - 22, 5, 0, 7); ctx.fill();
  }

  function draw() {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#7ec8ff"); g.addColorStop(1, "#d7f0ff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e9c46a"; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = "#c9a24b"; ctx.fillRect(0, GROUND, W, 3);
    ctx.fillStyle = "#fff"; ctx.fillRect(NET_X - NET_HALF, NET_TOP, NET_HALF * 2, GROUND - NET_TOP);
    ctx.fillStyle = "#555"; ctx.fillRect(NET_X - NET_HALF - 1, NET_TOP - 3, NET_HALF * 2 + 2, 5);
    if (!st || !st.vb) return;
    const v = st.vb;
    blob(v.p.b[0], v.p.b[1], "#4f8cff", "b");
    blob(v.p.w[0], v.p.w[1], "#ff7a59", "w");
    // 球
    const [bx, by] = v.ball;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(bx, by, BR, 0, 7); ctx.fill();
    ctx.strokeStyle = "#e5b800"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bx, by, BR - 1.5, 0.3, 2.4); ctx.stroke();
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, by, BR, 0, 7); ctx.stroke();
    // 分數
    ctx.font = "bold 28px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#1c3d8f"; ctx.fillText(v.score.b, 70, 40);
    ctx.fillStyle = "#b8431f"; ctx.fillText(v.score.w, W - 70, 40);
    if (st.you !== "s") {
      ctx.font = "13px system-ui"; ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillText("▼ 你", st.you === "b" ? v.p.b[0] : v.p.w[0], v.p[st.you][1] - R - 8);
    }
  }
  function loop() { if (closed) return; draw(); requestAnimationFrame(loop); }

  const side = (c) => (c === "b" ? "左邊（藍）" : "右邊（橘）");
  function updateText() {
    if (!st) return;
    watchEl.textContent = st.watchers > 2 ? `👀 ${st.watchers - 2} 人旁觀` : "";
    const me = st.you === "s" ? "你在旁觀" : `你在${side(st.you)}`;
    let t;
    if (st.winner) t = st.winner === st.you ? "🎉 你贏了！" : (st.you === "s" ? `${side(st.winner)}獲勝` : "😢 對手贏了");
    else if (!st.players.b || !st.players.w) t = `${me}　等另一位玩家加入…（請朋友也點開 Activity）`;
    else t = `${me}　先得 15 分獲勝　←→ 移動、空白鍵/↑ 跳`;
    statusEl.textContent = t;
    resignBtn.hidden = !(st.you !== "s" && !st.winner && st.players.b && st.players.w);
    againBtn.hidden = !(st.you !== "s" && st.winner);
    root.querySelector(".pad").style.visibility = st.you === "s" ? "hidden" : "visible";
  }

  againBtn.addEventListener("click", () => ws.send(JSON.stringify({ t: "again" })));
  let armed = 0;
  resignBtn.addEventListener("click", () => {
    if (Date.now() - armed < 3000) { armed = 0; resignBtn.textContent = "認輸"; ws.send(JSON.stringify({ t: "resign" })); return; }
    armed = Date.now(); resignBtn.textContent = "再按一次確認認輸";
    setTimeout(() => { if (Date.now() - armed >= 3000) { armed = 0; resignBtn.textContent = "認輸"; } }, 3100);
  });

  window.addEventListener("resize", resize);
  connect();
  requestAnimationFrame(() => { resize(); loop(); });
  return () => {
    closed = true;
    window.removeEventListener("resize", resize); window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur);
    try { ws.close(); } catch {}
  };
}
