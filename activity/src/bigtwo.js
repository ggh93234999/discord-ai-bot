// 大老二（台灣玩法，練習點數）：發牌、判定、計分、電腦都在伺服器（server/bigtwo.js），這裡只畫畫面和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { backUrl } from "./bjui.js";
import { classify, beats, suitOf, rankOf, rstr, strength, SUITS, CLUB3 } from "../shared/bigtwo_rules.js";

const RN = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function card(c, cls = "", attrs = "") {
  if (c == null || c < 0) return `<span class="bc back ${cls}" ${attrs}${backUrl ? ` style="background-image:url(${backUrl})"` : ""}></span>`;
  const r = rankOf(c);
  return `<span class="bc s${suitOf(c)} ${cls}" ${attrs}><b>${RN[r] || r}</b><i>${SUITS[suitOf(c)]}︎</i><u>${SUITS[suitOf(c)]}︎</u></span>`;
}
function getPid() { try { let p = localStorage.getItem("btpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("btpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); } }
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountBigtwo(opts = {}) {
  const spectate = opts.spectate || null;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots mj br bt">
        <header><button class="back">← 選單</button><h2>大老二</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        <div class="brbody"></div>
        <div class="brlog"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "bigtwo");
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), body = $(".brbody"), logEl = $(".brlog"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, timer = 0, sel = new Set(), selKey = "", myOrder = [], ordHand = -1, nextSort = 0, dragging = false, pendRender = false;
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "btjoin", room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "btstate") { st = m; st.at = Date.now() - m.now; render(); }
        else if (m.t === "bterr") { statusEl.textContent = m.error === "full" ? "座位滿了" : "這樣出不行，請檢查牌型或大小"; }
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
          <label>每張牌 <select class="cf-base">${st.stakes.map((v) => `<option value="${v}"${c.base === v ? " selected" : ""}>${v} 點</option>`).join("")}</select></label>
          <label><input type="checkbox" class="cf-triple"${c.triple ? " checked" : ""}> 可出三條</label></div>
          <button class="mb start">▶ 開始${st.seats.some((s) => !s) ? "（空位由電腦補）" : ""}</button>`;
      } else if (!spectate) cfg = `<div class="mempty">點「入座」坐下，最多 4 人，空位可以加電腦。</div>`;
      const fin = st.final ? `<div class="mjfinal"><h3>牌局結束</h3>${st.final.map((r, k) => `<div class="fr${k === 0 ? " top" : ""}"><b>${esc(r.name)}</b><em>${r.points.toLocaleString()}</em></div>`).join("")}</div>` : "";
      body.innerHTML = `${fin}<div class="brlobby"><div class="brseats">${seats}</div>${cfg}<small>每人 10,000 點，練習用，不會動到代幣。每手最先出完牌的人贏，其他人照手上剩的張數 × 每張點數付給他（剩 10 張以上雙倍、13 張全沒出三倍）。</small>${seated && !spectate ? `<button class="mb ghost stand">離座</button>` : ""}</div>`;
      statusEl.textContent = spectate ? "👀 旁觀中，等開局" : st.phase === "end" ? "按開始再來一場" : "等玩家入座";
      body.querySelectorAll("[data-sit]").forEach((b) => b.addEventListener("click", () => send({ t: "btsit", seat: Number(b.dataset.sit) })));
      body.querySelectorAll("[data-bot]").forEach((b) => b.addEventListener("click", () => send({ t: "btaddbot", seat: Number(b.dataset.bot) })));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "btdelbot", seat: Number(b.dataset.del) })));
      const q = (s) => body.querySelector(s);
      q(".start") && q(".start").addEventListener("click", () => send({ t: "btstart" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "btstand" }));
      const sendCfg = () => send({ t: "btcfg", len: Number(q(".cf-len").value), base: Number(q(".cf-base").value), triple: q(".cf-triple").checked });
      q(".cf-len") && q(".cf-len").addEventListener("change", sendCfg);
      q(".cf-base") && q(".cf-base").addEventListener("change", sendCfg);
      q(".cf-triple") && q(".cf-triple").addEventListener("change", sendCfg);
    }

    // ---------------- 牌桌
    function seatBox(i) {
      const s = st.seats[i]; if (!s) return "";
      const r = rel(i), turn = st.phase === "play" && st.turn === i;
      const passed = st.phase === "play" && (st.passed || []).includes(i);
      const backs = r === 0 && st.you >= 0 ? "" : `<span class="brcnt"><span class="bc back xs"></span>${s.count}</span>`;
      return `<div class="brseat r${r}${turn ? " turn" : ""}${st.you === i ? " me" : ""}">
        <div class="brname"><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}</div>
        <div class="brsub">${backs}<em>${s.points.toLocaleString()}</em></div>${passed ? `<span class="brbub"><span class="bpass">過</span></span>` : ""}
      </div>`;
    }
    function midHTML() {
      let info = `<div class="brct">${st.last ? `${nm(st.last.seat)} 出${st.last.name}` : st.mustClub ? "先出的人要包含 ♣3" : "桌上沒牌，自由出牌"}</div>`;
      const cards = st.last ? `<div class="btlast">${st.last.cards.map((c) => card(c, "big")).join("")}</div>` : "";
      const tr = st.trail || [], old = !st.last, shown = (old ? tr : tr.slice(0, -1)).slice(-4);   // 這一輪大家出過的牌（最新一手用大牌顯示在下面）
      const trail = shown.length ? `<div class="bttrail${old ? " old" : ""}">${shown.map((x) => `<div><span>${nm(x.seat)}</span>${x.cards.map((c) => card(c, "sm")).join("")}</div>`).join("")}</div>` : "";
      return `<div class="brmid"><div class="brinfo">${info}<div class="brtimer"></div></div>${trail}${cards}</div>`;
    }
    function resultHTML(r) {
      const deltas = r.deltas.map((d, i) => `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${nm(i)} ${d > 0 ? "+" : ""}${d.toLocaleString()}</span>`).join("");
      const left = r.hands.map((h, i) => (i === r.winner ? "" : `<div class="btleft"><span>${nm(i)}（剩 ${h.length} 張）</span><div>${h.map((c) => card(c, "xs")).join("")}</div></div>`)).join("");
      return `<div class="mresult brres"><h3>第 ${r.handNo} 手　${nm(r.winner)} 贏了！</h3><div class="mdelta">${deltas}</div>${left}${r.gameOver ? "<div class='mrl'>這場打完了，馬上公布名次</div>" : ""}</div>`;
    }
    function myCombo() { return classify([...sel]); }
    function canPlay() {
      if (!st || st.phase !== "play" || st.turn !== st.you || !sel.size) return false;
      const cb = myCombo(); if (!cb || (cb.type === 3 && !st.cfg.triple)) return false;
      if (st.mustClub && !sel.has(CLUB3)) return false;
      if (st.last && !beats(cb, classify(st.last.cards))) return false;
      return true;
    }

    function orderedHand() {
      const h = st.hand || [];
      if (ordHand !== st.handNo) { ordHand = st.handNo; myOrder = h.slice(); nextSort = 0; }
      myOrder = myOrder.filter((c) => h.includes(c)); for (const c of h) if (!myOrder.includes(c)) myOrder.push(c);
      return myOrder;
    }
    // 手牌可以拖曳換位置（滑鼠直接拖；手機長按一下再拖）
    function wireDrag(handEl) {
      let d = null, just = false;
      const start = () => { if (!d || d.on) return; d.on = true; dragging = true; d.el.classList.add("drag"); try { handEl.setPointerCapture(d.id); } catch {} };
      handEl.addEventListener("pointerdown", (e) => {
        const el = e.target.closest(".bc.can"); if (!el) return;
        d = { el, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, touch: e.pointerType === "touch", timer: 0 };
        if (d.touch) d.timer = setTimeout(start, 260);
      });
      handEl.addEventListener("pointermove", (e) => {
        if (!d) return;
        if (!d.on) {
          const mv = Math.hypot(e.clientX - d.x, e.clientY - d.y);
          if (d.touch) { if (mv > 10) { clearTimeout(d.timer); d = null; } return; }
          if (mv > 6) start(); else return;
        }
        e.preventDefault();
        const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".bc.can");
        if (t && t !== d.el && t.parentNode === handEl) { const r = t.getBoundingClientRect(); handEl.insertBefore(d.el, e.clientX < r.left + r.width / 2 ? t : t.nextSibling); }
      });
      handEl.addEventListener("touchmove", (e) => { if (d && d.on) e.preventDefault(); }, { passive: false });
      const end = () => {
        if (!d) return; clearTimeout(d.timer);
        if (d.on) {
          d.el.classList.remove("drag"); dragging = false; just = true; setTimeout(() => { just = false; }, 0);
          myOrder = [...handEl.querySelectorAll(".bc.can")].map((x) => Number(x.dataset.c));
        }
        d = null;
        if (pendRender) { pendRender = false; renderTable(); }
      };
      handEl.addEventListener("pointerup", end); handEl.addEventListener("pointercancel", end);
      handEl.addEventListener("click", (e) => { if (just) { e.stopPropagation(); e.preventDefault(); } }, true);
    }

    function renderTable() {
      if (dragging) { pendRender = true; return; }
      const you = st.you, me = you >= 0 ? st.seats[you] : null, play = st.phase === "play";
      const order = [2, 1, 3, 0].map((r) => [0, 1, 2, 3].find((i) => rel(i) === r));
      const mid = play ? midHTML() : `<div class="brmid">${st.result ? resultHTML(st.result) : ""}</div>`;
      let below = `<div class="btspacer"></div>`;
      if (play && me) {
        const myTurn = st.turn === you;
        const key = (st.hand || []).join(",") + "|" + st.handNo;
        if (key !== selKey) { selKey = key; sel = new Set(); }
        sel = new Set([...sel].filter((c) => (st.hand || []).includes(c)));
        const hand = `<div class="brhand bthand${myTurn ? " act" : ""}">${orderedHand().map((c) => card(c, `big can${sel.has(c) ? " sel" : ""}`, `data-c="${c}"`)).join("")}</div>`;
        const tip = myTurn ? (st.last ? "輪到你：選牌壓過桌上的牌，或按「過」" : st.mustClub ? "你先出，牌裡要包含 ♣3" : "輪到你，隨便出一種牌型") : `等 ${nm(st.turn)} 出牌…`;
        below = `<div class="mhint">${tip}</div>${hand}<div class="btbtns"><button class="mb btplay" ${canPlay() ? "" : "disabled"}>出牌</button><button class="mb ghost btpass" ${myTurn && st.canPass ? "" : "disabled"}>過</button><button class="mb ghost btclear">清除選擇</button><button class="mb ghost btsort">整理（${nextSort ? "依花色" : "依大小"}）</button></div>`;
      } else if (play) {
        below = `<div class="mhint">${spectate ? "👀 旁觀中（看不到手牌）" : `還沒入座。可以點電腦的位置接手：${st.seats.map((s, i) => (s && s.bot ? `<button class="mb ghost" data-sit="${i}">接手 ${esc(s.name)}</button>` : "")).join("")}`}</div>`;
      }
      body.innerHTML = `<div class="brtable">${order.map(seatBox).join("")}${mid}</div>${below}${me && !spectate ? `<div class="mfoot"><button class="mb ghost stand">離座（電腦接手）</button></div>` : ""}`;
      body.querySelectorAll(".brhand .bc.can").forEach((el) => el.addEventListener("click", () => {
        const c = Number(el.dataset.c);
        if (sel.has(c)) sel.delete(c); else if (sel.size < 13) sel.add(c);
        el.classList.toggle("sel", sel.has(c));
        const p = body.querySelector(".btplay"); if (p) p.disabled = !canPlay();
      }));
      const pb = body.querySelector(".btplay"); pb && pb.addEventListener("click", () => { if (canPlay()) { send({ t: "btact", a: "play", cards: [...sel] }); sel = new Set(); } });
      const ps = body.querySelector(".btpass"); ps && ps.addEventListener("click", () => send({ t: "btact", a: "pass" }));
      const hEl = body.querySelector(".bthand"); if (hEl) wireDrag(hEl);
      const so = body.querySelector(".btsort"); so && so.addEventListener("click", () => {
        myOrder = (st.hand || []).slice().sort(nextSort ? (a, b) => suitOf(a) - suitOf(b) || strength(a) - strength(b) : (a, b) => strength(a) - strength(b));
        nextSort = 1 - nextSort; renderTable();
      });
      const cl = body.querySelector(".btclear"); cl && cl.addEventListener("click", () => { sel = new Set(); body.querySelectorAll(".brhand .bc.sel").forEach((e) => e.classList.remove("sel")); const p = body.querySelector(".btplay"); if (p) p.disabled = true; });
      body.querySelectorAll("[data-sit]").forEach((el) => el.addEventListener("click", () => send({ t: "btsit", seat: Number(el.dataset.sit) })));
      const sb = body.querySelector(".stand"); sb && sb.addEventListener("click", () => send({ t: "btstand" }));
    }
    function tickStatus() {
      if (!st) return;
      const myTurn = st.phase === "play" && st.you >= 0 && st.turn === st.you;
      document.body.classList.toggle("mj-myturn", myTurn);
      if (st.phase === "wait" || st.phase === "end") return;
      const n = Date.now() - st.at;
      if (st.phase === "result") { statusEl.textContent = `第 ${st.handNo} 手結束　下一手 ${Math.max(0, Math.ceil((st.nextAt - n) / 1000))} 秒`; return; }
      const left = st.deadline ? Math.max(0, Math.ceil((st.deadline - n) / 1000)) : 0;
      statusEl.textContent = `大老二　第 ${st.handNo} / ${st.cfg.len} 手　${myTurn ? "輪到你" : `輪到 ${st.seats[st.turn]?.name || ""}`}`;
      const tEl = body.querySelector(".brtimer");
      if (tEl) { tEl.textContent = myTurn && left ? `⏱ ${left}` : ""; tEl.classList.toggle("urgent", myTurn && left <= 5); }
    }
    function cleanup() { closed = true; clearInterval(timer); document.body.classList.remove("mj-myturn"); try { ws && ws.close(); } catch {} }
    timer = setInterval(tickStatus, 250);
    connect();
    return cleanup;
  };
}
