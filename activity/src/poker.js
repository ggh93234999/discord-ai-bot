// 德州撲克（練習籌碼）：2～6 人，可加電腦，其他人旁觀。發牌與判定都在伺服器，這裡只畫畫面和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";

const SUITS = ["♠", "♥", "♦", "♣"], RED = [false, true, true, false];
const RK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const card = (c, small) => {
  if (c < 0) return `<span class="pcard back${small ? " sm" : ""}"></span>`;
  const r = (c % 13) + 2, s = Math.floor(c / 13);
  return `<span class="pcard${RED[s] ? " red" : ""}${small ? " sm" : ""}"><b>${RK[r] || r}</b><i>${SUITS[s]}</i></span>`;
};
const PHASE = { wait: "等玩家", preflop: "翻牌前", flop: "翻牌", turn: "轉牌", river: "河牌", result: "結算" };
// 6 個座位在橢圓桌上的位置（百分比），第 0 個是自己（下方），順時針
const POS = [[50, 90], [9, 68], [9, 24], [50, 8], [91, 24], [91, 68]];

function getPid() {
  try { let p = localStorage.getItem("pokerpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("pokerpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); }
}

export function mountPoker(opts = {}) {
  const spectate = opts.spectate || null;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots poker">
        <header><button class="back">← 選單</button><h2>德州撲克</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        ${spectate ? "" : `<div class="pnamebar">名稱 <input class="pnm" maxlength="12" placeholder="輸入你的名稱"></div>`}
        <div class="ptable"><div class="pfelt"><div class="pcenter"><div class="ptimer"></div><div class="ppot"></div><div class="pboard"></div></div></div><div class="pseats"></div></div>
        <div class="plog"></div>
        <div class="pctl"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "poker");
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), potEl = $(".ppot"), timerEl = $(".ptimer"), boardEl = $(".pboard"), seatsEl = $(".pseats"), logEl = $(".plog"), ctl = $(".pctl"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, timer = 0, raiseTo = 0, ctlKey = "";
    const pid = getPid();
    const nmIn = $(".pnm"), lsGet = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };
    if (nmIn) {
      nmIn.value = lsGet();
      nmIn.addEventListener("change", () => { const v = nmIn.value.trim(); try { localStorage.setItem("pokername", v); } catch {} if (v) send({ t: "pname", name: v }); });
    }
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "pjoin", room, spectate: !!spectate, pid, name: lsGet() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "pstate") { st = m; st.at = Date.now() - m.now; render(); }
        else if (m.t === "perr") statusEl.textContent = m.error === "full" ? "桌子滿了" : "發生錯誤";
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }

    function render() {
      if (!st) return;
      const you = st.you, seated = you >= 0;
      watchEl.textContent = st.watchers ? `👀 ${st.watchers} 人旁觀` : "";
      potEl.textContent = st.pot ? `底池 ${st.pot}` : "";
      boardEl.innerHTML = Array.from({ length: 5 }, (_, i) => (st.board[i] != null ? card(st.board[i]) : `<span class="pcard empty"></span>`)).join("");
      const base = seated ? you : 0;
      seatsEl.innerHTML = POS.map((pos, k) => {
        const i = (base + k) % 6, s = st.seats[i];
        const style = `left:${pos[0]}%;top:${pos[1]}%`;
        if (!s) {
          return `<div class="pseat empty" style="${style}">${spectate ? "<span>空位</span>" : !seated ? `<button data-sit="${i}">入座</button>` : `<button data-bot="${i}">＋電腦</button>`}</div>`;
        }
        const turn = st.toAct === i, win = st.result && st.result.winners.some((w) => w.i === i);
        const cls = ["pseat", s.folded ? "folded" : "", turn ? "turn" : "", win ? "win" : "", i === you ? "me" : "", s.away ? "away" : ""].join(" ");
        const hole = s.hole && s.hole.length ? s.hole.map((c) => card(c, i !== you)).join("") : "";
        return `<div class="${cls}" style="${style}">
          ${st.dealer === i ? `<span class="pdealer">D</span>` : ""}
          <div class="phole">${hole}</div>
          <div class="pname">${esc(s.name)}${s.away ? "（離線）" : ""}</div>
          <div class="pchips">💰 ${s.chips}${s.allin ? " 全下" : ""}</div>
          ${s.hand ? `<div class="phand">${s.hand}</div>` : s.last ? `<div class="plast">${esc(s.last)}</div>` : ""}
          ${s.bet ? `<div class="pbet">${s.bet}</div>` : ""}
          ${seated && s.bot ? `<button class="pdel" data-del="${i}" title="移除電腦">✕</button>` : ""}
        </div>`;
      }).join("");
      seatsEl.querySelectorAll("[data-sit]").forEach((b) => b.addEventListener("click", () => send({ t: "psit", seat: Number(b.dataset.sit) })));
      seatsEl.querySelectorAll("[data-bot]").forEach((b) => b.addEventListener("click", () => send({ t: "paddbot", seat: Number(b.dataset.bot) })));
      seatsEl.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "pdelbot", seat: Number(b.dataset.del) })));
      if (st.phase === "result" && st.result && st.result.showdown) {
        const rows = st.seats.filter((s) => s && s.inHand && !s.folded && s.hand).map((s) => {
          const w = st.result.winners.find((x) => x.i === s.i);
          return `<div class="prr${w ? " win" : ""}"><b>${esc(s.name)}</b><span class="prh">${s.hole.map((c) => card(c, true)).join("")}</span><em>${s.hand}</em>${w ? `<strong>🏆 +${w.amount}</strong>` : ""}</div>`;
        }).join("");
        logEl.innerHTML = `<div class="prt">攤牌　公開牌型</div>${rows}`;
      } else logEl.textContent = st.log || "";
      renderCtl();
      tickStatus();
    }

    function tickStatus() {
      if (!st) return;
      const left = st.deadline ? Math.max(0, Math.ceil((st.deadline - (Date.now() - st.at)) / 1000)) : 0;
      const me = st.you >= 0 ? st.seats[st.you] : null;
      let t = `${PHASE[st.phase] || ""}　盲注 ${st.sb}/${st.bb}　第 ${st.handNo} 手`;
      if (spectate) t = "👀 旁觀中　" + t;
      else if (!me) t = "還沒入座　" + t;
      if (st.toAct >= 0 && st.seats[st.toAct]) t += st.toAct === st.you ? `　輪到你（${left}s）` : `　輪到 ${st.seats[st.toAct].name}${left && !st.seats[st.toAct].bot ? `（${left}s）` : ""}`;
      statusEl.textContent = t;
      // 螢幕上的大計時器：輪到人類行動時倒數；結算時倒數下一手
      const nowS = Date.now() - st.at;
      let sec = 0, kind = "";
      if (st.phase === "result" && st.nextAt) { sec = Math.max(0, Math.ceil((st.nextAt - nowS) / 1000)); kind = "next"; }
      else if (st.toAct >= 0 && st.deadline && st.seats[st.toAct] && !st.seats[st.toAct].bot) { sec = left; kind = st.toAct === st.you ? "me" : "other"; }
      if (!kind) timerEl.className = "ptimer", timerEl.textContent = "";
      else {
        timerEl.className = `ptimer on ${kind}${kind !== "next" && sec <= 5 ? " urgent" : ""}`;
        timerEl.textContent = kind === "next" ? `下一手 ${sec}` : `⏱ ${sec}`;
      }
    }

    function renderCtl() {
      const me = st.you >= 0 ? st.seats[st.you] : null;
      if (spectate) { ctl.innerHTML = `<div class="mempty">你在旁觀，看不到別人的底牌（攤牌時才會翻開）</div>`; ctlKey = "s"; return; }
      if (!me) { ctl.innerHTML = `<div class="mempty">點空位入座，入座後可以加電腦陪你玩。練習籌碼 1000 起。</div>`; ctlKey = "n"; return; }
      const myTurn = st.toAct === st.you;
      const toCall = Math.max(0, st.curBet - me.bet);
      const maxTo = me.bet + me.chips, minTo = Math.min(maxTo, st.curBet + st.minRaise);
      const key = [st.handNo, st.phase, myTurn, st.curBet, me.chips, me.bet, st.seats.filter(Boolean).length].join("|");
      if (key === ctlKey) return;
      ctlKey = key;
      const seatedCount = st.seats.filter(Boolean).length;
      let h = "";
      if (myTurn) {
        if (raiseTo < minTo || raiseTo > maxTo) raiseTo = minTo;
        const canRaise = maxTo > st.curBet;
        h += `<div class="prow">
          <button class="pb fold">棄牌</button>
          <button class="pb call">${toCall ? (toCall >= me.chips ? `全下 ${me.chips}` : `跟注 ${toCall}`) : "過牌"}</button>
          ${canRaise ? `<button class="pb raise">${st.curBet ? "加注到" : "下注"} <span class="rv">${raiseTo}</span></button>` : ""}
        </div>`;
        if (canRaise && minTo < maxTo) h += `<div class="prow"><input type="range" class="rs" min="${minTo}" max="${maxTo}" step="10" value="${raiseTo}">
          <span class="pre"><button data-f="0.5">½池</button><button data-f="1">1池</button><button data-f="all">全下</button></span></div>`;
      } else if (st.phase === "wait" || st.phase === "result") {
        h += seatedCount < 2 ? `<div class="mempty">人不夠，按空位的「＋電腦」找人陪你玩</div>` : `<div class="mempty">${st.phase === "result" ? "下一手馬上開始…" : "準備開始…"}</div>`;
      } else h += `<div class="mempty">${me.folded ? "你已棄牌，等這手結束" : "等其他人行動…"}</div>`;
      h += `<div class="prow small"><button class="pb ghost reset">🔄 重開</button><button class="pb ghost stand">離桌</button></div>`;
      ctl.innerHTML = h;
      const q = (s) => ctl.querySelector(s);
      q(".fold") && q(".fold").addEventListener("click", () => send({ t: "pact", a: "fold" }));
      q(".call") && q(".call").addEventListener("click", () => send({ t: "pact", a: toCall ? "call" : "check" }));
      q(".raise") && q(".raise").addEventListener("click", () => send({ t: "pact", a: raiseTo >= maxTo ? "allin" : "raise", amt: raiseTo }));
      const rs = q(".rs");
      if (rs) {
        const setV = (v) => { raiseTo = Math.max(minTo, Math.min(maxTo, Math.round(v))); rs.value = raiseTo; q(".rv").textContent = raiseTo; };
        rs.addEventListener("input", () => setV(Number(rs.value)));
        ctl.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
          const f = b.dataset.f; setV(f === "all" ? maxTo : st.curBet + Math.round((st.pot + toCall) * Number(f) / 10) * 10);
        }));
      }
      { const rb = q(".reset"); let armed = 0; rb.addEventListener("click", () => {      // 兩段確認（Discord 內嵌畫面不一定能彈 confirm）
        if (armed) { armed = 0; send({ t: "preset" }); return; }
        armed = 1; rb.textContent = "再按一次確認重開"; setTimeout(() => { armed = 0; rb.textContent = "🔄 重開"; }, 3000);
      }); }
      q(".stand").addEventListener("click", () => { send({ t: "pstand" }); });
    }

    timer = setInterval(tickStatus, 250);
    function cleanup() { closed = true; clearInterval(timer); try { ws.close(); } catch {} }
    connect();
    return cleanup;
  };
}
