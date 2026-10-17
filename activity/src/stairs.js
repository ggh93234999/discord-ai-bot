// 小朋友下樓梯 / 小朋友上樓梯（最多 4 人）。伺服器算物理，這裡只負責畫面、輸入與介面。
import { wsUrl } from "./gomoku.js";

const W = 400, H = 640, KW = 22, KH = 30, MAXHP = 12;
const COLORS = ["#ff5a5a", "#4aa8ff", "#5ad36b", "#ffd23f"];
const NAMES = ["紅", "藍", "綠", "黃"];

export const mountDown = (root, o) => mountStairs(root, o, "down");
export const mountUp = (root, o) => mountStairs(root, o, "up");

function mountStairs(root, { env, back }, mode) {
  const down = mode === "down";
  root.innerHTML = `
    <div class="game stairs">
      <header><button class="back">← 選單</button><h2>${down ? "小朋友下樓梯" : "小朋友上樓梯"}</h2><span class="watch"></span></header>
      <div class="status">連線中…</div>
      <div class="swrap"><canvas></canvas><div class="overlay" hidden></div></div>
      <div class="pad"><button class="pl">◀</button><button class="pr">▶</button></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const statusEl = $(".status"), overlay = $(".overlay"), watchEl = $(".watch");
  $(".back").addEventListener("click", back);

  let st = null, ws = null, closed = false, retry = 0, scale = 1;
  const disp = new Map();            // 平滑用：平台 id → 顯示 y；玩家 seat → {x,y}
  let L = false, R = false, sent = "";
  let bgOff = 0, lastT = performance.now(), raf = 0;

  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; sent = ""; send({ t: "join", game: mode, room: env.instanceId }); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t !== "mstate") return;
      const was = st && st.state;
      st = m;
      if (m.state === "play" && was !== "play") { disp.clear(); L = R = false; sent = ""; }
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
  // 直接觸碰畫面左半／右半也可以
  canvas.addEventListener("pointerdown", (e) => { const r = canvas.getBoundingClientRect(); if (e.clientX - r.left < r.width / 2) L = true; else R = true; pushInput(); canvas.setPointerCapture(e.pointerId); });
  const up = () => { L = R = false; pushInput(); };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

  // ---------- 介面（大廳／結算）
  function ui() {
    if (!st) return;
    const seated = st.you >= 0;
    watchEl.textContent = st.watchers > 0 ? `👀 ${st.watchers} 人旁觀` : "";
    const n = st.seats.filter(Boolean).length;
    if (st.state === "lobby") {
      statusEl.textContent = seated ? `你是${NAMES[st.you]}色小朋友` : "房間已滿或正在遊戲中，你在旁觀";
      overlay.hidden = false;
      overlay.innerHTML = `<div class="box"><h3>${down ? "小朋友下樓梯" : "小朋友上樓梯"}</h3>
        <p>${down ? "12 滴血。踩普通平台回 1 滴；釘板扣 5、撞到天花板的刺也扣 5；掉出畫面下緣就淘汰。越往下，樓梯上捲越快。" : "自動彈跳往上爬，只要左右移動。畫面一直往上捲，掉出畫面下緣就淘汰。"}</p>
        <div class="seats">${st.seats.map((s, i) => `<span class="seat ${s ? "on" : ""}" style="--c:${COLORS[i]}">${s ? (i === st.you ? "你" : "玩家") : "空位"}</span>`).join("")}</div>
        <p class="sm">最多 4 人同場，一個人也可以玩。${down ? "最後活著的人獲勝。" : "最後活著的人獲勝。"}</p>
        ${seated ? `<button class="go">開始遊戲（${n} 人）</button>` : ""}</div>`;
      const go = overlay.querySelector(".go"); if (go) go.onclick = () => send({ t: "start" });
    } else if (st.state === "over") {
      const r = st.result || { rank: [] };
      statusEl.textContent = r.winner >= 0 ? `🏆 ${NAMES[r.winner]}色小朋友獲勝！` : "遊戲結束";
      overlay.hidden = false;
      const unit = down ? "層" : "格高";
      overlay.innerHTML = `<div class="box"><h3>${r.winner >= 0 ? `🏆 ${NAMES[r.winner]}色獲勝` : "遊戲結束"}</h3>
        <ol class="rank">${r.rank.map((x, i) => `<li style="--c:${COLORS[x.seat]}"><b>${["🥇", "🥈", "🥉", "4️⃣"][i] || ""}</b> ${NAMES[x.seat]}色${x.seat === st.you ? "（你）" : ""}　${x.score} ${unit}</li>`).join("")}</ol>
        ${seated ? `<button class="go">再來一局</button>` : ""}</div>`;
      const go = overlay.querySelector(".go"); if (go) go.onclick = () => send({ t: "again" });
    } else {
      overlay.hidden = true;
      statusEl.textContent = seated ? "◀ ▶ / A D 左右移動" : "旁觀中";
    }
  }

  // ---------- 畫面
  function fit() {
    const wrap = $(".swrap");
    const w = Math.max(200, Math.min(wrap.clientWidth, (wrap.clientHeight || 9999) * (W / H), 480));
    const dpr = window.devicePixelRatio || 1;
    scale = w / W;
    canvas.style.width = w + "px"; canvas.style.height = w * (H / W) + "px";
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * (H / W) * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    overlay.style.width = w + "px"; overlay.style.height = w * (H / W) + "px";
  }

  function bg(dt) {
    const sp = st && st.snap ? st.snap.speed : 1;
    bgOff = (bgOff + sp * dt * 60) % 64;
    if (down) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1b1622"); g.addColorStop(1, "#2c2436");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 2;
      for (let y = -bgOff; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); for (let x = ((y / 64) | 0) % 2 ? 0 : 32; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 64); ctx.stroke(); } }
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#5aa9e6"); g.addColorStop(1, "#cfeaff");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      for (let i = 0; i < 5; i++) { const y = ((i * 150 + bgOff * 3) % (H + 80)) - 40, x = (i * 97) % 340 + 20; ctx.beginPath(); ctx.ellipse(x, y, 42, 14, 0, 0, 7); ctx.ellipse(x + 26, y - 8, 28, 12, 0, 0, 7); ctx.fill(); }
    }
  }

  function platform(id, x, y, w, type, t, now) {
    const h = 12;
    ctx.save();
    if ((type === "fragile" || type === "flip") && t > 0) ctx.translate(Math.sin(now / 25) * 1.6, 0);
    if (type === "vanish" && t > 0) ctx.globalAlpha = Math.max(.15, 1 - t / 10);
    if (type === "normal" || type === "move") {
      ctx.fillStyle = down ? "#c9a26b" : (type === "move" ? "#4fc3a1" : "#b98a52"); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = down ? "#e6c68f" : (type === "move" ? "#7fe3c4" : "#d9ad74"); ctx.fillRect(x, y, w, 4);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x, y + h - 3, w, 3);
      if (type === "move") { ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("◀▶", x + w / 2, y + 10); }
    } else if (type === "spike") {
      ctx.fillStyle = "#8a8f98"; ctx.fillRect(x, y + 4, w, h - 4);
      ctx.fillStyle = "#d8dde6";
      for (let sx = x; sx < x + w - 6; sx += 12) { ctx.beginPath(); ctx.moveTo(sx, y + 5); ctx.lineTo(sx + 6, y - 9); ctx.lineTo(sx + 12, y + 5); ctx.fill(); }
    } else if (type === "left" || type === "right") {
      ctx.fillStyle = "#4b4f5c"; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#ffb74d"; const dir = type === "left" ? -1 : 1;
      const o = ((now / 60) * dir) % 16;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      for (let ax = x - 16 + o; ax < x + w + 16; ax += 16) { ctx.beginPath(); if (dir > 0) { ctx.moveTo(ax, y + 2); ctx.lineTo(ax + 8, y + h / 2); ctx.lineTo(ax, y + h - 2); } else { ctx.moveTo(ax + 8, y + 2); ctx.lineTo(ax, y + h / 2); ctx.lineTo(ax + 8, y + h - 2); } ctx.fill(); }
      ctx.restore();
    } else if (type === "spring") {
      ctx.fillStyle = "#c9a26b"; ctx.fillRect(x, y + 4, w, h - 4);
      ctx.strokeStyle = "#e53935"; ctx.lineWidth = 3;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const sx = x + w / 2 - 14 + i * 5.6; ctx.moveTo(sx, y + 4); ctx.lineTo(sx + 2.8, y - 6); } ctx.stroke();
      ctx.fillStyle = "#e53935"; ctx.fillRect(x + w / 2 - 18, y - 9, 36, 4);
    } else if (type === "vanish") {
      ctx.fillStyle = "#b9c4d6"; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,.6)"; for (let sx = x; sx < x + w; sx += 16) ctx.fillRect(sx, y, 8, h);
      ctx.strokeStyle = "#6b7a90"; ctx.setLineDash([4, 3]); ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); ctx.setLineDash([]);
    } else if (type === "flip") {
      const tilt = Math.min(1, t / 26) * 0.5;
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(tilt);
      ctx.fillStyle = "#c77dff"; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "#e0b3ff"; ctx.fillRect(-w / 2, -h / 2, w, 4);
      ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("▼▼", 0, 4);
    } else if (type === "fragile") {
      ctx.fillStyle = "#cfd8e3"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#7b8794"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(x + w * .3, y); ctx.lineTo(x + w * .35, y + h * .5); ctx.lineTo(x + w * .28, y + h);
      ctx.moveTo(x + w * .66, y); ctx.lineTo(x + w * .6, y + h * .6); ctx.lineTo(x + w * .68, y + h); ctx.stroke();
    }
    ctx.restore();
  }

  function kid(seat, x, y, f, grounded, hurt, dead, you, now) {
    const c = COLORS[seat];
    ctx.save(); ctx.translate(x + KW / 2, y);
    if (dead) { ctx.globalAlpha = .35; }
    if (hurt && Math.floor(now / 60) % 2) ctx.globalAlpha = .45;
    const run = grounded ? Math.sin(now / 70) * 4 : 0;
    ctx.fillStyle = "#334"; // 腿
    ctx.fillRect(-7, KH - 12, 5, 12 + (run > 0 ? -run * .4 : 0)); ctx.fillRect(2, KH - 12, 5, 12 + (run < 0 ? run * .4 : 0));
    ctx.fillStyle = c; ctx.fillRect(-9, 12, 18, 12);                      // 衣服
    ctx.fillRect(-12, 13, 4, grounded ? 9 : 5); ctx.fillRect(8, 13, 4, grounded ? 9 : 5);
    ctx.fillStyle = "#ffdcb0"; ctx.beginPath(); ctx.arc(0, 7, 8, 0, 7); ctx.fill();   // 頭
    ctx.fillStyle = "#3a2a1a"; ctx.beginPath(); ctx.arc(0, 4, 8, Math.PI, 0); ctx.fill();   // 頭髮
    ctx.fillStyle = "#222"; ctx.fillRect(f > 0 ? 1 : -4, 6, 3, 3);                  // 眼睛
    ctx.restore();
    if (you && !dead) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x + KW / 2, y - 7); ctx.lineTo(x + KW / 2 - 6, y - 15); ctx.lineTo(x + KW / 2 + 6, y - 15); ctx.fill(); }
  }

  function hud() {
    if (!st || !st.snap) return;
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left";
    st.snap.ps.forEach((p, i) => {
      const x = 8 + i * 98, y = down ? 34 : 8;
      ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x - 3, y - 3, 94, down ? 30 : 18);
      ctx.fillStyle = COLORS[p.s]; ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = "#fff"; ctx.fillText(`${p.a ? "" : "✖ "}${down ? "地下" : ""}${p.sc}${down ? "層" : "格"}`, x + 12, y + 8);
      if (down) { ctx.fillStyle = "#555"; ctx.fillRect(x, y + 14, 84, 7); ctx.fillStyle = p.hp <= 4 ? "#ff5252" : "#69f0ae"; ctx.fillRect(x, y + 14, 84 * Math.max(0, p.hp) / MAXHP, 7); }
    });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
    ctx.save();
    bg(dt);
    if (st && st.snap && st.state !== "lobby") {
      const k = 1 - Math.pow(.0005, dt);           // 平滑係數（約 1~2 個畫格追上）
      const seen = new Set();
      for (const [id, x, y, w, type, t] of st.snap.pl) {
        seen.add("p" + id);
        let d = disp.get("p" + id); if (d == null) d = y; else d += (y - d) * k; disp.set("p" + id, d);
        platform(id, x, d, w, type, t, now);
      }
      for (const key of [...disp.keys()]) if (key[0] === "p" && !seen.has(key)) disp.delete(key);
      for (const p of st.snap.ps) {
        let d = disp.get("k" + p.s); if (!d) d = { x: p.x, y: p.y }; else { d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k; if (Math.abs(p.x - d.x) > 120) d.x = p.x; }
        disp.set("k" + p.s, d);
        if (p.a || st.state === "over") kid(p.s, d.x, d.y, p.f, p.g, p.h, !p.a, p.s === st.you, now);
      }
      if (down) {                                     // 天花板的刺
        ctx.fillStyle = "#9aa0ad"; ctx.fillRect(0, 0, W, 6);
        ctx.fillStyle = "#e8ecf3";
        for (let sx = 0; sx < W; sx += 16) { ctx.beginPath(); ctx.moveTo(sx, 4); ctx.lineTo(sx + 8, 26); ctx.lineTo(sx + 16, 4); ctx.fill(); }
      }
      hud();
    }
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
