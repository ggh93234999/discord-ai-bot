// 橋牌（台灣簡易版，練習點數）：叫牌、出牌、判定、計分都在伺服器（server/bridge.js），這裡只畫畫面和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";

const SUIT = ["♣", "♦", "♥", "♠", "無王"];
const DIR = ["南", "西", "北", "東"];                       // 座位 0..3 順時針；0、2 南北隊，1、3 東西隊
const TEAM = ["南北隊", "東西隊"];
const RN = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const suitOf = (c) => Math.floor(c / 13), rankOf = (c) => (c % 13) + 2;
const bidName = (b) => (b ? `${b.l}${SUIT[b.s]}` : "Pass");
const bidHTML = (b) => (b ? `${b.l}<span class="bs s${b.s}">${SUIT[b.s]}</span>` : `<span class="bpass">Pass</span>`);
const higher = (a, b) => !b || a.l > b.l || (a.l === b.l && a.s > b.s);
function card(c, cls = "", attrs = "") {
  if (c == null || c < 0) return `<span class="bc back ${cls}" ${attrs}></span>`;
  const r = rankOf(c);
  return `<span class="bc s${suitOf(c)} ${cls}" ${attrs}><b>${RN[r] || r}</b><i>${SUIT[suitOf(c)]}</i></span>`;
}
function getPid() { try { let p = localStorage.getItem("brpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("brpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); } }
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountBridge(opts = {}) {
  const spectate = opts.spectate || null;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots mj br">
        <header><button class="back">← 選單</button><h2>橋牌</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        <div class="brbody"></div>
        <div class="brlog"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "bridge");
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), body = $(".brbody"), logEl = $(".brlog"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, timer = 0;
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "brjoin", room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "brstate") { st = m; st.at = Date.now() - m.now; render(); }
        else if (m.t === "brerr") statusEl.textContent = m.error === "full" ? "座位滿了" : "發生錯誤";
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    const base = () => (st.you >= 0 ? st.you : 0);
    const rel = (i) => (i - base() + 4) % 4;                 // 0 自己（下）、1 下家（左）、2 同伴（上）、3 上家（右）
    const nm = (i) => esc(st.seats[i]?.name || "");

    function render() {
      watchEl.textContent = st.watchers ? `👀 ${st.watchers}` : "";
      logEl.textContent = st.log || "";
      if (st.phase === "wait" || st.phase === "end") renderLobby(); else renderTable();
      tickStatus();
    }

    // ---------------- 開打前：入座、加電腦、設定、開始
    function renderLobby() {
      const seated = st.you >= 0;
      const seats = [2, 1, 3, 0].map((i) => {
        const s = st.seats[i], lab = `<span class="w t${i % 2}">${DIR[i]}</span>`;
        if (!s) return `<div class="brls p${i} empty">${lab}${spectate ? "空位" : !seated ? `<button class="mb" data-sit="${i}">入座</button>` : `<button class="mb ghost" data-bot="${i}">＋電腦</button>`}</div>`;
        return `<div class="brls p${i}${i === st.you ? " me" : ""}">${lab}<b>${esc(s.name)}</b>${s.tag ? `<span class="btag" title="電腦個性">${s.tag}</span>` : ""}${s.away ? "（離線）" : ""}${seated && s.bot ? `<button class="mdel" data-del="${i}">✕</button>` : ""}</div>`;
      }).join("");
      let cfg = "";
      const c = st.cfg;
      if (seated && !spectate) {
        cfg = `<div class="mjcfg"><label>長度 <select class="cf-len">${st.lens.map((v) => `<option value="${v}"${c.len === v ? " selected" : ""}>${v} 手</option>`).join("")}</select></label>
          <label>每線位 <select class="cf-base">${st.stakes.map((v) => `<option value="${v}"${c.base === v ? " selected" : ""}>${v} 點</option>`).join("")}</select></label></div>
          <button class="mb start">▶ 開始${st.seats.some((s) => !s) ? "（空位由電腦補）" : ""}</button>`;
      } else if (!spectate) cfg = `<div class="mempty">點「入座」坐下。南北一隊、東西一隊，對面的人是你的同伴。</div>`;
      const fin = st.final ? `<div class="mjfinal"><h3>牌局結束</h3>${st.final.map((r, k) => `<div class="fr${k < 2 && st.final[0].team === r.team ? " top" : ""}"><span>${TEAM[r.team]}</span><b>${esc(r.name)}</b><em>${r.points.toLocaleString()}</em></div>`).join("")}</div>` : "";
      body.innerHTML = `${fin}<div class="brlobby"><div class="brseats">${seats}</div>${cfg}<small>每人 10,000 點，練習用，不會動到代幣。每手輸的那隊每人付「線位 × 每線位點數」給贏的那隊。</small>${seated && !spectate ? `<button class="mb ghost stand">離座</button>` : ""}</div>`;
      statusEl.textContent = spectate ? "👀 旁觀中，等開局" : st.phase === "end" ? "按開始再來一場" : "等玩家入座";
      body.querySelectorAll("[data-sit]").forEach((b) => b.addEventListener("click", () => send({ t: "brsit", seat: Number(b.dataset.sit) })));
      body.querySelectorAll("[data-bot]").forEach((b) => b.addEventListener("click", () => send({ t: "braddbot", seat: Number(b.dataset.bot) })));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "brdelbot", seat: Number(b.dataset.del) })));
      const q = (s) => body.querySelector(s);
      q(".start") && q(".start").addEventListener("click", () => send({ t: "brstart" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "brstand" }));
      const sendCfg = () => send({ t: "brcfg", len: Number(q(".cf-len").value), base: Number(q(".cf-base").value) });
      q(".cf-len") && q(".cf-len").addEventListener("change", sendCfg);
      q(".cf-base") && q(".cf-base").addEventListener("change", sendCfg);
    }

    // ---------------- 牌桌
    function seatBox(i) {
      const s = st.seats[i]; if (!s) return "";
      const r = rel(i), turn = st.stage !== "trick" && st.turn === i;
      const decl = st.contract && st.contract.seat === i;
      const myBids = (st.bids || []).filter((b) => b.seat === i);
      const lastBid = st.stage === "bid" && myBids.length ? `<span class="brbub">${bidHTML(myBids[myBids.length - 1].bid)}</span>` : "";
      const backs = r === 0 && st.you >= 0 ? "" : `<span class="brcnt"><span class="bc back xs"></span>${s.count}</span>`;
      return `<div class="brseat r${r}${turn ? " turn" : ""}${st.you === i ? " me" : ""}">
        <div class="brname"><span class="w t${i % 2}">${DIR[i]}</span><b>${esc(s.name)}</b>${s.tag ? `<span class="btag" title="電腦個性">${s.tag}</span>` : ""}${s.away ? "（離線）" : ""}${decl ? `<span class="brdecl">莊家</span>` : ""}</div>
        <div class="brsub">${backs}${st.stage !== "bid" ? `<span class="brwon">吃 ${s.won} 墩</span>` : ""}<em>${s.points.toLocaleString()}</em></div>${lastBid}
      </div>`;
    }
    function midHTML() {
      let info;
      if (st.stage === "bid") info = `<div class="brct">叫牌中</div><div class="brsm">目前最高：${st.high ? `${bidHTML(st.high)}（${nm(st.high.seat)}）` : "還沒有人叫"}</div>`;
      else {
        const c = st.contract, dt = c.seat % 2;
        const tm = (k) => `<div class="brtm t${k}${k === dt ? " decl" : ""}"><span>${TEAM[k]}${k === dt ? "（莊家方）" : ""}</span><b>${st.tricks[k]}</b> / ${st.need[k]} 墩</div>`;
        info = `<div class="brct">合約 ${bidHTML(c)}</div><div class="brsm">王牌：${c.s === 4 ? "無王" : `<span class="bs s${c.s}">${SUIT[c.s]}</span>`}</div>${tm(0)}${tm(1)}`;
      }
      const slots = st.stage === "bid" ? "" : (st.trick || []).map((x) => `<div class="brplay r${rel(x.seat)}${st.winner === x.seat ? " win" : ""}">${card(x.c)}</div>`).join("");
      const lt = st.lastTrick && st.stage !== "bid" ? `<div class="brlast">上一墩 ${st.lastTrick.cards.map((x) => card(x.c, `xs${x.seat === st.lastTrick.winner ? " win" : ""}`)).join("")}</div>` : "";
      return `<div class="brmid"><div class="brinfo">${info}<div class="brtimer"></div></div><div class="brtrick">${slots}</div>${lt}</div>`;
    }
    function bidsHTML() {
      const order = [0, 1, 2, 3].map((k) => (st.first + k) % 4);
      const cells = (st.bids || []).map((b) => `<span class="${st.high && b.bid && b.seat === st.high.seat && b.bid.l === st.high.l && b.bid.s === st.high.s ? "hi" : ""}">${bidHTML(b.bid)}</span>`);
      if (st.stage === "bid" && st.turn >= 0) cells.push(`<span class="now">？</span>`);
      return `<div class="brbids"><div class="brbh">${order.map((i) => `<span class="t${i % 2}">${DIR[i]} ${nm(i)}</span>`).join("")}</div><div class="brbg">${cells.join("")}</div></div>`;
    }
    function bidPanel() {
      const rows = [];
      for (let l = 1; l <= 7; l++) {
        const btns = [0, 1, 2, 3, 4].map((s) => `<button class="brb${higher({ l, s }, st.high) ? "" : " off"}" data-l="${l}" data-s="${s}"${higher({ l, s }, st.high) ? "" : " disabled"}>${l}<span class="bs s${s}">${SUIT[s]}</span></button>`).join("");
        if (higher({ l, s: 4 }, st.high)) rows.push(`<div class="brbr">${btns}</div>`);
      }
      return `<div class="brpanel"><div class="mhint">輪到你叫牌：叫 N 線位，你們這隊就要吃到 6＋N 墩（例如 2♥ 要 8 墩，♥ 當王牌）</div><div class="brbgrid">${rows.join("")}</div><button class="mb ghost brpass">Pass</button></div>`;
    }
    function resultHTML(r) {
      const c = r.contract, dt = c.seat % 2;
      const deltas = r.deltas.map((d, i) => `<span class="${d > 0 ? "up" : "down"}">${nm(i)} ${d > 0 ? "+" : ""}${d.toLocaleString()}</span>`).join("");
      return `<div class="mresult brres"><h3>第 ${r.handNo} 手　${r.made ? "成約！" : "倒約！"}</h3>
        <div class="brrl">合約 ${bidHTML(c)}（${nm(c.seat)}）　${TEAM[dt]}吃 ${r.tricks[dt]} 墩（要 ${r.need[dt]}）、${TEAM[1 - dt]}吃 ${r.tricks[1 - dt]} 墩（要 ${r.need[1 - dt]}）</div>
        <div class="mrs">${TEAM[r.winTeam]}贏</div><div class="mdelta">${deltas}</div>${r.gameOver ? "<div class='mrl'>這場打完了，馬上公布名次</div>" : ""}</div>`;
    }

    function renderTable() {
      const you = st.you, me = you >= 0 ? st.seats[you] : null, play = st.phase === "play";
      const order = [2, 1, 3, 0].map((r) => [0, 1, 2, 3].find((i) => rel(i) === r));
      const mid = play ? midHTML() : `<div class="brmid">${st.result ? resultHTML(st.result) : ""}</div>`;
      let below = "";
      if (play && me) {
        const myTurn = st.turn === you && st.stage !== "trick";
        const legal = new Set(st.legal || []);
        const hand = `<div class="brhand${myTurn && st.stage === "play" ? " act" : ""}">${(st.hand || []).map((c) => card(c, `big${myTurn && st.stage === "play" && legal.has(c) ? " can" : ""}`, `data-c="${c}"`)).join("")}</div>`;
        let ctl;
        if (st.stage === "bid") ctl = (myTurn ? bidPanel() : `<div class="mhint">等 ${nm(st.turn)} 叫牌…</div>`) + `<div class="mhint brhcp">你的大牌點 ${st.hcp} 點（A 4、K 3、Q 2、J 1）${st.canRedeal ? `<button class="mb brredeal">🔄 要求重洗</button>` : ""}</div>`;
        else ctl = `<div class="mhint">${myTurn && st.stage === "play" ? (st.trick.length ? "輪到你出牌（要跟同花色，沒有才可以王吃或墊牌）" : "輪到你先出一張") : st.stage === "trick" ? "" : `等 ${nm(st.turn)} 出牌…`}</div>`;
        below = `${st.stage === "bid" ? bidsHTML() : ""}${ctl}${hand}`;
      } else if (play) {
        below = `${st.stage === "bid" ? bidsHTML() : ""}<div class="mhint">${spectate ? "👀 旁觀中（看不到手牌）" : `還沒入座。可以點電腦的位置接手：${st.seats.map((s, i) => (s && s.bot ? `<button class="mb ghost" data-sit="${i}">接手 ${esc(s.name)}</button>` : "")).join("")}`}</div>`;
      }
      body.innerHTML = `<div class="brtable">${order.map(seatBox).join("")}${mid}</div>${below}${me && !spectate ? `<div class="mfoot"><button class="mb ghost stand">離座（電腦接手）</button></div>` : ""}`;
      body.querySelectorAll(".brhand .bc.can").forEach((el) => el.addEventListener("click", () => send({ t: "bract", a: "play", c: Number(el.dataset.c) })));
      body.querySelectorAll(".brb[data-l]:not([disabled])").forEach((el) => el.addEventListener("click", () => send({ t: "bract", a: "bid", l: Number(el.dataset.l), s: Number(el.dataset.s) })));
      const pb = body.querySelector(".brpass"); pb && pb.addEventListener("click", () => send({ t: "bract", a: "pass" }));
      const rb = body.querySelector(".brredeal"); rb && rb.addEventListener("click", () => send({ t: "bract", a: "redeal" }));
      body.querySelectorAll("[data-sit]").forEach((el) => el.addEventListener("click", () => send({ t: "brsit", seat: Number(el.dataset.sit) })));
      const sb = body.querySelector(".stand"); sb && sb.addEventListener("click", () => send({ t: "brstand" }));
    }
    function tickStatus() {
      if (!st) return;
      const myTurn = st.phase === "play" && st.you >= 0 && st.turn === st.you && st.stage !== "trick";
      document.body.classList.toggle("mj-myturn", myTurn);
      if (st.phase === "wait" || st.phase === "end") return;
      const n = Date.now() - st.at;
      if (st.phase === "result") { statusEl.textContent = `第 ${st.handNo} 手結束　下一手 ${Math.max(0, Math.ceil((st.nextAt - n) / 1000))} 秒`; return; }
      const left = st.deadline ? Math.max(0, Math.ceil((st.deadline - n) / 1000)) : 0;
      statusEl.textContent = `橋牌　第 ${st.handNo} 手　${st.stage === "bid" ? "叫牌" : "出牌"}　${myTurn ? "輪到你" : st.stage === "trick" ? "" : `輪到 ${st.seats[st.turn]?.name || ""}`}`;
      const tEl = body.querySelector(".brtimer");
      if (tEl) { tEl.textContent = myTurn && left ? `⏱ ${left}` : ""; tEl.classList.toggle("urgent", myTurn && left <= 5); }
    }
    function cleanup() { closed = true; clearInterval(timer); document.body.classList.remove("mj-myturn"); try { ws && ws.close(); } catch {} }
    timer = setInterval(tickStatus, 250);
    connect();
    return cleanup;
  };
}
