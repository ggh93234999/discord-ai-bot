// 接七（排七，練習點數）：發牌、判定、計分、電腦都在伺服器（server/sevens.js），這裡只畫畫面和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { backUrl } from "./bjui.js";

const SUITS = ["♣", "♦", "♥", "♠"];
const suitOf = (c) => Math.floor(c / 13);
const nat = (c) => { const r = (c % 13) + 2; return r === 14 ? 1 : r; };        // A=1 … K=13
const RN = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const rn = (n) => RN[n] || n;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function card(c, cls = "", attrs = "") {
  if (c == null || c < 0) return `<span class="bc back ${cls}" ${attrs}${backUrl ? ` style="background-image:url(${backUrl})"` : ""}></span>`;
  return `<span class="bc s${suitOf(c)} ${cls}" ${attrs}><b>${rn(nat(c))}</b><i>${SUITS[suitOf(c)]}︎</i><u>${SUITS[suitOf(c)]}︎</u></span>`;
}
function getPid() { try { let p = localStorage.getItem("svpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("svpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); } }
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountSevens(opts = {}) {
  const spectate = opts.spectate || null;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots mj br bt sv">
        <header><button class="back">← 選單</button><h2>接七</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        <div class="brbody"></div>
        <div class="brlog"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "sevens");
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), body = $(".brbody"), logEl = $(".brlog"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, timer = 0;
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "svjoin", room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "svstate") { st = m; st.at = Date.now() - m.now; render(); }
        else if (m.t === "sverr") { statusEl.textContent = m.error === "full" ? "座位滿了" : "這張現在不能出"; }
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    const base = () => (st.you >= 0 ? st.you : 0);
    const rel = (i) => (i - base() + 4) % 4;                 // 0 自己（下）、1 下家（左）、2 對面（上）、3 上家（右）
    const nm = (i) => esc(st.seats[i]?.name || "");

    function render() {
      watchEl.textContent = st.watchers ? `👀 ${st.watchers}` : "";
      logEl.textContent = st.log || "";
      if (st.phase === "wait" || st.phase === "end") renderLobby(); else renderTable();
      tickStatus();
    }

    // ---------------- 開打前
    function renderLobby() {
      const seated = st.you >= 0;
      const seats = [2, 1, 3, 0].map((i) => {
        const s = st.seats[i];
        if (!s) return `<div class="brls p${i} empty">${spectate ? "空位" : !seated ? `<button class="mb" data-sit="${i}">入座</button>` : `<button class="mb ghost" data-bot="${i}">＋電腦</button>`}</div>`;
        return `<div class="brls p${i}${i === st.you ? " me" : ""}"><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}${seated && s.bot ? `<button class="mdel" data-del="${i}">✕</button>` : ""}</div>`;
      }).join("");
      let cfg = "";
      const c = st.cfg;
      if (seated && !spectate) {
        cfg = `<div class="mjcfg"><label>長度 <select class="cf-len">${st.lens.map((v) => `<option value="${v}"${c.len === v ? " selected" : ""}>${v} 手</option>`).join("")}</select></label>
          <label>每張牌 <select class="cf-base">${st.stakes.map((v) => `<option value="${v}"${c.base === v ? " selected" : ""}>${v} 點</option>`).join("")}</select></label></div>
          <button class="mb start">▶ 開始${st.seats.some((s) => !s) ? "（空位由電腦補）" : ""}</button>`;
      } else if (!spectate) cfg = `<div class="mempty">點「入座」坐下，最多 4 人，空位可以加電腦。</div>`;
      const fin = st.final ? `<div class="mjfinal"><h3>牌局結束</h3>${st.final.map((r, k) => `<div class="fr${k === 0 ? " top" : ""}"><b>${esc(r.name)}</b><em>${r.points.toLocaleString()}</em></div>`).join("")}</div>` : "";
      body.innerHTML = `${fin}<div class="brlobby"><div class="brseats">${seats}</div>${cfg}<small>每人 10,000 點，練習用，不會動到代幣。持有 ♦7 的人先出 ♦7，之後接同花色相鄰的牌或開新的 7；沒牌可出自動過。最先出完的人贏，其他人照手上剩的張數 × 每張點數付給他。</small>${seated && !spectate ? `<button class="mb ghost stand">離座</button>` : ""}</div>`;
      statusEl.textContent = spectate ? "👀 旁觀中，等開局" : st.phase === "end" ? "按開始再來一場" : "等玩家入座";
      body.querySelectorAll("[data-sit]").forEach((b) => b.addEventListener("click", () => send({ t: "svsit", seat: Number(b.dataset.sit) })));
      body.querySelectorAll("[data-bot]").forEach((b) => b.addEventListener("click", () => send({ t: "svaddbot", seat: Number(b.dataset.bot) })));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "svdelbot", seat: Number(b.dataset.del) })));
      const q = (s) => body.querySelector(s);
      q(".start") && q(".start").addEventListener("click", () => send({ t: "svstart" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "svstand" }));
      const sendCfg = () => send({ t: "svcfg", len: Number(q(".cf-len").value), base: Number(q(".cf-base").value) });
      q(".cf-len") && q(".cf-len").addEventListener("change", sendCfg);
      q(".cf-base") && q(".cf-base").addEventListener("change", sendCfg);
    }

    // ---------------- 牌桌
    function seatBox(i) {
      const s = st.seats[i]; if (!s) return "";
      const r = rel(i), turn = st.phase === "play" && st.turn === i;
      const passed = st.phase === "play" && (st.passed || [])[i];
      const backs = r === 0 && st.you >= 0 ? "" : `<span class="brcnt"><span class="bc back xs"></span>${s.count}</span>`;
      return `<div class="brseat r${r}${turn ? " turn" : ""}${st.you === i ? " me" : ""}">
        <div class="brname"><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}</div>
        <div class="brsub">${backs}<em>${s.points.toLocaleString()}</em></div>${passed ? `<span class="brbub"><span class="bpass">過</span></span>` : ""}
      </div>`;
    }
    // 桌上四排：每個花色一排 A…K，打出的牌亮起來，還沒出的是淡淡的格子；7 那一欄加底色
    function boardHTML(board, last) {
      return `<div class="svboard">${[0, 1, 2, 3].map((s) => {
        const b = board && board[s];
        const cells = [];
        for (let n = 1; n <= 13; n++) {
          const on = b && n >= b.lo && n <= b.hi, cid = s * 13 + ((n === 1 ? 14 : n) - 2);
          cells.push(`<i class="svc s${s}${on ? " on" : ""}${n === 7 ? " seven" : ""}${last && last.card === cid ? " new" : ""}">${on ? `<b>${rn(n)}</b>` : `<em>${rn(n)}</em>`}</i>`);
        }
        return `<div class="svrow"><span class="svs s${s}">${SUITS[s]}</span>${cells.join("")}</div>`;
      }).join("")}</div>`;
    }
    function resultHTML(r) {
      const deltas = r.deltas.map((d, i) => `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${nm(i)} ${d > 0 ? "+" : ""}${d.toLocaleString()}</span>`).join("");
      const left = r.hands.map((h, i) => (i === r.winner ? "" : `<div class="btleft"><span>${nm(i)}（剩 ${h.length} 張）</span><div>${h.map((c) => card(c, "xs")).join("")}</div></div>`)).join("");
      return `<div class="mresult brres"><h3>第 ${r.handNo} 手　${nm(r.winner)} 贏了！</h3><div class="mdelta">${deltas}</div>${left}${r.gameOver ? "<div class='mrl'>這場打完了，馬上公布名次</div>" : ""}</div>`;
    }

    function renderTable() {
      const you = st.you, me = you >= 0 ? st.seats[you] : null, play = st.phase === "play";
      const order = [2, 1, 3, 0].map((r) => [0, 1, 2, 3].find((i) => rel(i) === r));
      const mid = `<div class="brmid"><div class="brinfo"><div class="brct">${play ? (st.first ? "第一張要出 ♦7" : st.last ? `${nm(st.last.seat)} 出了 ${SUITS[suitOf(st.last.card)]}${rn(nat(st.last.card))}` : "") : ""}</div><div class="brtimer"></div></div>${play || st.board ? boardHTML(st.board, play ? st.last : null) : ""}${!play && st.result ? resultHTML(st.result) : ""}</div>`;
      let below = `<div class="btspacer"></div>`;
      if (play && me) {
        const myTurn = st.turn === you, can = new Set(st.playable || []);
        const hand = `<div class="brhand bthand${myTurn ? " act" : ""}">${(st.hand || []).map((c) => card(c, `big${myTurn && can.has(c) ? " can" : ""}`, `data-c="${c}"`)).join("")}</div>`;
        const tip = myTurn ? (can.size ? (st.first ? "你先出：點 ♦7" : "輪到你：點一張亮著的牌打出去") : "你沒有牌可以出，自動過…") : `等 ${nm(st.turn)} 出牌…`;
        below = `<div class="mhint">${tip}</div>${hand}`;
      } else if (play) {
        below = `<div class="mhint">${spectate ? "👀 旁觀中（看不到手牌）" : `還沒入座。可以點電腦的位置接手：${st.seats.map((s, i) => (s && s.bot ? `<button class="mb ghost" data-sit="${i}">接手 ${esc(s.name)}</button>` : "")).join("")}`}</div>`;
      }
      body.innerHTML = `<div class="brtable">${order.map(seatBox).join("")}${mid}</div>${below}${me && !spectate ? `<div class="mfoot"><button class="mb ghost stand">離座（電腦接手）</button></div>` : ""}`;
      body.querySelectorAll(".brhand .bc.can").forEach((el) => el.addEventListener("click", () => send({ t: "svact", a: "play", card: Number(el.dataset.c) })));
      body.querySelectorAll("[data-sit]").forEach((el) => el.addEventListener("click", () => send({ t: "svsit", seat: Number(el.dataset.sit) })));
      const sb = body.querySelector(".stand"); sb && sb.addEventListener("click", () => send({ t: "svstand" }));
    }
    function tickStatus() {
      if (!st) return;
      const myTurn = st.phase === "play" && st.you >= 0 && st.turn === st.you;
      document.body.classList.toggle("mj-myturn", myTurn);
      if (st.phase === "wait" || st.phase === "end") return;
      const n = Date.now() - st.at;
      if (st.phase === "result") { statusEl.textContent = `第 ${st.handNo} 手結束　下一手 ${Math.max(0, Math.ceil((st.nextAt - n) / 1000))} 秒`; return; }
      const left = st.deadline ? Math.max(0, Math.ceil((st.deadline - n) / 1000)) : 0;
      statusEl.textContent = `接七　第 ${st.handNo} / ${st.cfg.len} 手　${myTurn ? "輪到你" : `輪到 ${st.seats[st.turn]?.name || ""}`}`;
      const tEl = body.querySelector(".brtimer");
      if (tEl) { tEl.textContent = myTurn && left ? `⏱ ${left}` : ""; tEl.classList.toggle("urgent", myTurn && left <= 5); }
    }
    function cleanup() { closed = true; clearInterval(timer); document.body.classList.remove("mj-myturn"); try { ws && ws.close(); } catch {} }
    timer = setInterval(tickStatus, 250);
    connect();
    return cleanup;
  };
}
