// 西洋棋、象棋（兩人，透過 WebSocket 同步）：規則和合法走法都在伺服器，這裡只畫棋盤、點選棋子、送出走法。
import { wsUrl } from "./gomoku.js";
import { createWager } from "./wager.js";
import { createSeat, specFirst } from "./seat.js";

const GL = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const XQ_RED = { R: "車", H: "馬", E: "相", A: "仕", K: "帥", C: "炮", P: "兵" };
const XQ_BLK = { r: "車", h: "馬", e: "象", a: "士", k: "將", c: "砲", p: "卒" };
const isUp = (p) => p >= "A" && p <= "Z";

const CFG = {
  chess: { W: 8, H: 8, title: "西洋棋", names: { b: "⚪白方", w: "⚫黑方" }, again: "再來一局（黑白互換）" },
  xq: { W: 9, H: 10, title: "象棋", names: { b: "🔴紅方", w: "⚫黑方" }, again: "再來一局（紅黑互換）" },
};

export function mountBoard(game) {
  const cfg = CFG[game], { W, H } = cfg;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game gomoku chessui">
        <header><button class="back">← 選單</button><h2>${cfg.title}</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        <div class="wager"></div>
        <div class="cwrap"><canvas></canvas></div>
        <div class="promo" hidden></div>
        <div class="actions"><button class="resign" hidden>認輸</button><button class="again" hidden>${cfg.again}</button></div>
        <div class="botbar" hidden>
          <select class="botlv" title="電腦難度"><option value="1">新手</option><option value="2">普通</option><option value="3">高手</option><option value="4">大師</option></select>
          <button class="botadd" hidden>🤖 加電腦對手</button><button class="botdel" hidden>移除電腦</button>
        </div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const canvas = $("canvas"), ctx = canvas.getContext("2d");
    const statusEl = $(".status"), resignBtn = $(".resign"), againBtn = $(".again"), watchEl = $(".watch"), promoEl = $(".promo");
    const botbar = $(".botbar"), botLv = $(".botlv"), botAdd = $(".botadd"), botDel = $(".botdel");
    const lvGet = () => { try { return localStorage.getItem("botlv") || "2"; } catch { return "2"; } };
    botLv.value = lvGet();
    const botSend = (t) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t, level: Number(botLv.value) })); };
    botAdd.addEventListener("click", () => botSend("botadd"));
    botDel.addEventListener("click", () => botSend("botdel"));
    botLv.addEventListener("change", () => { try { localStorage.setItem("botlv", botLv.value); } catch {} if (st && st.bot) botSend("botadd"); });
    $(".back").addEventListener("click", back);
    const wg = createWager(root, { env, getWs: () => ws, getSt: () => st });
    const seat = createSeat(root, { getWs: () => ws, getSt: () => st });

    let st = null, ws = null, closed = false, retry = 0, sel = -1, w = 360, h = 360, cell = 45, pad = 0;
    const flipped = () => st && st.you === "w";

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "join", game, room: env.instanceId, spectate: specFirst() })); wg.onOpen(); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "state") { if (!st || m.moves !== st.moves || m.winner !== st.winner) { sel = -1; promoEl.hidden = true; } st = m; render(); wg.update(); seat.update(); }
        else wg.onMsg(m);
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }

    function resize() {
      const wrap = $(".cwrap");
      const aw = Math.max(240, Math.min(wrap.clientWidth || 360, 640)), ah = wrap.clientHeight || 9999;
      if (game === "chess") { cell = Math.min(aw, ah) / 8; w = h = cell * 8; pad = 0; }
      else { cell = Math.min(aw / (W + 0.2), ah / (H + 0.2)); pad = cell / 2; w = cell * W; h = cell * H; }
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    // 棋盤座標 (r,c) ↔ 畫面座標；後手那邊整盤轉 180 度
    const toScreen = (r, c) => { if (flipped()) { r = H - 1 - r; c = W - 1 - c; } return game === "chess" ? [c * cell + cell / 2, r * cell + cell / 2] : [c * cell + cell / 2, r * cell + cell / 2]; };
    const fromScreen = (x, y) => {
      let c = Math.floor(x / cell), r = Math.floor(y / cell);
      if (r < 0 || c < 0 || r >= H || c >= W) return -1;
      if (flipped()) { r = H - 1 - r; c = W - 1 - c; }
      return r * W + c;
    };
    const myPiece = (p) => st && st.you !== "s" && p !== "." && (st.you === "b") === isUp(p);
    const legalFrom = (i) => (st && st.legal ? st.legal.filter((m) => m[0] === i).map((m) => m[1]) : []);

    function drawChess() {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const [cx, cy] = toScreen(r, c);
        ctx.fillStyle = (r + c) % 2 ? "#b58863" : "#f0d9b5"; ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
      }
      const hl = (i, col) => { const [cx, cy] = toScreen(i >> 3, i & 7); ctx.fillStyle = col; ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell); };
      if (st) {
        if (st.last) { hl(st.last[0], "rgba(255,235,59,.45)"); hl(st.last[1], "rgba(255,235,59,.55)"); }
        if (st.check >= 0) hl(st.check, "rgba(229,57,53,.6)");
        if (sel >= 0) hl(sel, "rgba(76,175,80,.6)");
      }
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${cell * 0.8}px "Segoe UI Symbol","Noto Sans Symbols2","DejaVu Sans",serif`;
      if (st) for (let i = 0; i < 64; i++) {
        const p = st.board[i]; if (p === ".") continue;
        const [cx, cy] = toScreen(i >> 3, i & 7), up = isUp(p);
        ctx.lineWidth = Math.max(1.5, cell * 0.04); ctx.strokeStyle = up ? "#222" : "#eee"; ctx.fillStyle = up ? "#fff" : "#111";
        ctx.strokeText(GL[p.toLowerCase()], cx, cy + cell * 0.04); ctx.fillText(GL[p.toLowerCase()], cx, cy + cell * 0.04);
      }
      ctx.font = `${cell * 0.16}px sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "top";
      for (let k = 0; k < 8; k++) {
        const fc = flipped() ? 7 - k : k, fr = flipped() ? k + 1 : 8 - k;
        ctx.fillStyle = (k + 7) % 2 ? "#b58863" : "#f0d9b5"; ctx.fillText(String(fr), 2, k * cell + 2);
        ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText("abcdefgh"[fc], (k + 1) * cell - 2, 8 * cell - 2); ctx.textAlign = "left"; ctx.textBaseline = "top";
      }
      marks();
    }

    function marks() {
      if (!st || sel < 0) return;
      for (const t of legalFrom(sel)) {
        const [cx, cy] = toScreen(Math.floor(t / W), t % W), cap = st.board[t] !== ".";
        ctx.beginPath();
        if (cap) { ctx.strokeStyle = "rgba(229,57,53,.85)"; ctx.lineWidth = cell * 0.08; ctx.arc(cx, cy, cell * 0.42, 0, 7); ctx.stroke(); }
        else { ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.arc(cx, cy, cell * 0.13, 0, 7); ctx.fill(); }
      }
    }

    function drawXq() {
      ctx.fillStyle = "#e8c98a"; ctx.fillRect(0, 0, w, h);
      const X = (c) => c * cell + cell / 2, Y = (r) => r * cell + cell / 2;
      ctx.strokeStyle = "#5b3a1a"; ctx.lineWidth = 1.5;
      for (let r = 0; r < H; r++) { ctx.beginPath(); ctx.moveTo(X(0), Y(r)); ctx.lineTo(X(W - 1), Y(r)); ctx.stroke(); }
      for (let c = 0; c < W; c++) {
        ctx.beginPath(); ctx.moveTo(X(c), Y(0)); ctx.lineTo(X(c), Y(4)); ctx.moveTo(X(c), Y(5)); ctx.lineTo(X(c), Y(H - 1));
        if (c === 0 || c === W - 1) { ctx.moveTo(X(c), Y(4)); ctx.lineTo(X(c), Y(5)); }
        ctx.stroke();
      }
      for (const r0 of [0, 7]) {      // 九宮的斜線
        ctx.beginPath(); ctx.moveTo(X(3), Y(r0)); ctx.lineTo(X(5), Y(r0 + 2)); ctx.moveTo(X(5), Y(r0)); ctx.lineTo(X(3), Y(r0 + 2)); ctx.stroke();
      }
      ctx.strokeRect(X(0), Y(0), X(W - 1) - X(0), Y(H - 1) - Y(0));
      ctx.fillStyle = "#8a5a2b"; ctx.font = `${cell * 0.5}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const rv = flipped() ? ["漢界", "楚河"] : ["楚河", "漢界"];
      ctx.fillText(rv[0], X(2), (Y(4) + Y(5)) / 2); ctx.fillText(rv[1], X(6), (Y(4) + Y(5)) / 2);
      if (!st) return;
      const S = (i) => toScreen(Math.floor(i / W), i % W);
      const ring = (i, col, lw) => { const [cx, cy] = S(i); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, cell * 0.46, 0, 7); ctx.stroke(); };
      ctx.font = `bold ${cell * 0.5}px "Noto Serif CJK TC","Microsoft JhengHei",serif`;
      for (let i = 0; i < W * H; i++) {
        const p = st.board[i]; if (p === ".") continue;
        const [cx, cy] = S(i), red = isUp(p);
        ctx.beginPath(); ctx.arc(cx, cy, cell * 0.43, 0, 7); ctx.fillStyle = "#f6e3b4"; ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2; ctx.fill(); ctx.shadowColor = "transparent";
        ctx.lineWidth = 2; ctx.strokeStyle = red ? "#c62828" : "#222"; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, cell * 0.36, 0, 7); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = red ? "#c62828" : "#222"; ctx.fillText(red ? XQ_RED[p] : XQ_BLK[p], cx, cy + cell * 0.03);
      }
      if (st.last) { ring(st.last[0], "rgba(255,193,7,.9)", 3); ring(st.last[1], "rgba(255,193,7,.9)", 3); }
      if (st.check >= 0) ring(st.check, "rgba(229,57,53,.95)", 4);
      if (sel >= 0) ring(sel, "rgba(76,175,80,.95)", 4);
      if (sel >= 0) for (const t of legalFrom(sel)) {
        const [cx, cy] = S(t); ctx.beginPath();
        if (st.board[t] !== ".") { ctx.strokeStyle = "rgba(229,57,53,.85)"; ctx.lineWidth = 3; ctx.arc(cx, cy, cell * 0.46, 0, 7); ctx.stroke(); }
        else { ctx.fillStyle = "rgba(76,175,80,.7)"; ctx.arc(cx, cy, cell * 0.12, 0, 7); ctx.fill(); }
      }
    }

    function draw() { if (game === "chess") drawChess(); else drawXq(); }

    function render() {
      draw();
      if (!st) return;
      const nm = cfg.names, me = st.you === "s" ? "你在旁觀" : `你是${nm[st.you]}`;
      watchEl.textContent = st.watchers > 2 ? `👀 ${st.watchers - 2} 人旁觀` : "";
      let t;
      if (st.winner === "d") t = `和棋${st.reason ? "：" + st.reason : ""}`;
      else if (st.winner) t = (st.winner === st.you ? "🎉 你贏了！" : st.you === "s" ? `${nm[st.winner]}獲勝` : "😢 你輸了") + (st.reason ? `（${st.reason}）` : "（對方認輸或離開）");
      else if (!st.players.b || !st.players.w) t = st.you === "s" ? `${me}　等玩家加入…（按「🪑 上場對戰」入座後，可以加電腦對手）` : `${me}　等另一位玩家加入…（請朋友也點開 Activity，或按「🤖 加電腦對手」）`;
      else {
        const who = st.turn === st.you ? "（你）" : st.bot && st.turn === st.bot.c ? `（🤖電腦·${st.bot.name}${st.bot.thinking ? "，思考中…" : ""}）` : "";
        t = `${me}${st.bot ? `　對手：🤖電腦·${st.bot.name}` : ""}　輪到${nm[st.turn]}${who}${st.check >= 0 ? "　⚠️ 將軍！" : ""}`;
      }
      statusEl.textContent = t;
      resignBtn.hidden = !(st.you !== "s" && !st.winner && st.players.b && st.players.w);
      againBtn.hidden = !(st.you !== "s" && st.winner);
      botAdd.hidden = !st.canBot; botDel.hidden = !st.canBotDel;
      botbar.hidden = !(st.canBot || (st.bot && st.you !== "s"));
      if (st.bot && document.activeElement !== botLv) botLv.value = String(st.bot.level);
    }

    const pos = (ev) => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * (w / r.width), (ev.clientY - r.top) * (h / r.height)]; };
    canvas.addEventListener("click", (ev) => {
      if (!st || !st.legal) return;                              // 不是你的回合（伺服器只在輪到你時給 legal）
      const i = fromScreen(...pos(ev)); if (i < 0) return;
      if (sel >= 0 && legalFrom(sel).includes(i)) {
        const p = st.board[sel];
        if (game === "chess" && p.toLowerCase() === "p" && (i >> 3 === 0 || i >> 3 === 7)) { askPromo(sel, i); return; }
        ws.send(JSON.stringify({ t: "move", f: sel, to: i })); sel = -1; draw(); return;
      }
      sel = myPiece(st.board[i]) && legalFrom(i).length ? i : -1;
      promoEl.hidden = true; draw();
    });
    function askPromo(f, t) {
      const up = st.you === "b";
      promoEl.innerHTML = "升變成：" + ["q", "r", "b", "n"].map((k) => `<button data-p="${k}">${up ? GL[k] : GL[k]}</button>`).join("");
      promoEl.hidden = false;
      promoEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { ws.send(JSON.stringify({ t: "move", f, to: t, p: b.dataset.p })); sel = -1; promoEl.hidden = true; draw(); }));
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
    requestAnimationFrame(resize);
    return () => { closed = true; window.removeEventListener("resize", resize); try { ws.close(); } catch {} };
  };
}
