// 麻將（練習點數）：台灣 16 張（rule "tw"）和日本立直（rule "jp"）共用這個畫面。
// 洗牌、判定、計分都在伺服器（server/mahjong.js），這裡只畫牌桌和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { GUIDE, guideItem, parseTiles } from "./mjguide.js";
import { mjSfx, mjSfxOn, setMjSfx } from "./mjsfx.js";
import { tileSvg } from "./mjtiles.js";

const NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HON = ["東", "南", "西", "北", "白", "發", "中"];
const FLO = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function tileName(t) { if (t >= 100) return "赤" + tileName(t - 100); if (t >= 34) return FLO[t - 34]; if (t >= 27) return HON[t - 27]; return NUM[t % 9] + ["萬", "筒", "條"][Math.floor(t / 9)]; }
// 一張牌：數字牌上面大字、下面小字花色；字牌一個大字；花牌一個字＋編號
// 寶牌：依桌上的寶牌指示牌算出哪些牌是寶牌，畫的時候讓它發光（只有日麻）
let DORA = new Set();
function doraOf(ind) {
  if (ind < 27) return Math.floor(ind / 9) * 9 + ((ind % 9) + 1) % 9;
  if (ind <= 30) return 27 + ((ind - 27 + 1) % 4);
  return 31 + ((ind - 31 + 1) % 3);
}
function tile(t, cls = "", attrs = "", noDora = false) {
  if (t == null || t < 0) return `<span class="mt back ${cls}" ${attrs}></span>`;
  if (t >= 100) return tile(t - 100, cls + " aka", attrs, noDora);         // 赤寶牌（紅五）：加紅框
  if (!noDora && DORA.has(t)) cls += " dora";
  let body, k;
  if (t >= 34) { k = "f"; body = `<b>${FLO[t - 34]}</b><i>${(t - 34) % 4 + 1}</i>`; }
  else if (t >= 27) { k = ["w", "w", "w", "w", "dw", "dg", "dr"][t - 27]; body = `<b>${t === 31 ? "" : HON[t - 27]}</b>`; }
  else { const s = Math.floor(t / 9); k = ["m", "p", "s"][s]; body = s === 0 ? `<b>${NUM[t % 9]}</b><i>萬</i>` : tileSvg(t); }   // 筒子、條子畫圖
  return `<span class="mt k${k} ${cls}" data-k="${t}" ${attrs}>${body}</span>`;
}
const meldHTML = (m) => `<span class="mmeld">${m.tiles.map((x, k) => tile(m.k === "ankan" && (k === 0 || k === 3) ? -1 : x, "sm")).join("")}</span>`;

function getPid() { try { let p = localStorage.getItem("mjpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("mjpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); } }
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountMahjong(rule, opts = {}) {
  const spectate = opts.spectate || null;
  const TITLE = rule === "tw" ? "台灣麻將" : "日本麻將";
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots mj mj-${rule}">
        <header><button class="back">← 選單</button><h2>${TITLE}</h2><button class="mjgbtn">📘 ${rule === "jp" ? "役表" : "台數表"}</button><button class="mjsnd" title="音效開關">${mjSfxOn() ? "🔊" : "🔇"}</button><span class="watch"></span></header>
        <div class="mjguide" hidden></div>
        <div class="status">連線中…</div>
        <div class="mjbody"></div>
        <div class="mjlog"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "mj" + rule);
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), body = $(".mjbody"), logEl = $(".mjlog"), watchEl = $(".watch"), guideEl = $(".mjguide");
    let popName = "", popFor = "";
    const exHTML = (ex) => ex ? `<div class="mgex">${ex.split("|").map((part) => parseTiles(part).map((t) => tile(t, "sm")).join("")).join('<span class="mgsep"></span>')}</div>` : "";
    function renderGuide() {
      const G = GUIDE[rule];
      guideEl.innerHTML = `<div class="mghead"><b>${G.title}</b><button class="mb ghost mgclose">收起</button></div><p class="mgintro">${G.intro}</p>
        ${G.groups.map((g) => `<details class="mggrp"${g === G.groups[0] ? " open" : ""}><summary>${g.name}（${g.items.length}）</summary>${g.items.map(([n, v, d, ex]) => `<div class="mgit"><div class="mgt"><b>${n}</b><span>${v}</span></div><div class="mgd">${d}</div>${exHTML(ex)}</div>`).join("")}</details>`).join("")}
        <p class="mgintro">範例牌型中間的空隙後面是吃碰槓亮出來的牌。</p>`;
      guideEl.querySelector(".mgclose").addEventListener("click", () => { guideEl.hidden = true; });
    }
    const sndBtn = $(".mjsnd");
    sndBtn.addEventListener("click", () => { setMjSfx(!mjSfxOn()); sndBtn.textContent = mjSfxOn() ? "🔊" : "🔇"; if (mjSfxOn()) mjSfx.discard(); });
    $(".mjgbtn").addEventListener("click", () => { if (guideEl.hidden) { renderGuide(); guideEl.hidden = false; guideEl.scrollIntoView({ block: "start" }); } else guideEl.hidden = true; });
    let ws = null, closed = false, retry = 0, st = null, timer = 0, riichiMode = false, lastSig = "";
    // 雀魂式自動功能：自動理牌（記在瀏覽器）、自動和牌、不吃碰槓、自動摸切（這次開著才有效）
    let autoSort = true; try { autoSort = localStorage.getItem("mj_sort") !== "0"; } catch {}
    const auto = { win: false, nocall: false, giri: false };
    let handOrder = null, autoSig = "", dragI = -1;
    // 自動理牌關掉時：手牌照自己排的順序，新進來的牌放最右邊
    function arranged() {
      const h = st.hand || [];
      if (autoSort || !handOrder) { handOrder = h.slice(); return h; }
      const pool = h.slice(), res = [];
      for (const t of handOrder) { const i = pool.indexOf(t); if (i >= 0) { res.push(t); pool.splice(i, 1); } }
      res.push(...pool); handOrder = res; return res;
    }
    const autoKey = () => JSON.stringify([st.round, st.wall, st.opts && st.opts.kind, st.opts && st.opts.tile, st.drawn, (st.hand || []).length, st.turn]);
    function autoAct() {
      if (spectate || !st || st.phase !== "play" || st.you < 0 || !st.opts) return;
      const o = st.opts, key = autoKey();
      if (key === autoSig) return;
      let act = null;
      if (o.kind === "turn") {
        if (o.tsumo && auto.win) act = { a: "tsumo" };
        else if (auto.giri && st.drawn != null && !o.lock && !riichiMode && !o.tsumo) act = { a: "discard", tile: st.drawn };
      } else if (o.kind === "claim") {
        if (o.ron && auto.win) act = { a: "ron" };
        else if (auto.nocall && !o.ron) act = { a: "pass" };
      }
      if (!act) return;
      autoSig = key;
      setTimeout(() => { if (st && st.opts && autoKey() === key) send({ t: "mact", ...act }); }, 380);
    }
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "mjoin", rule, room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "mstate") { const prev = st; try { sounds(prev, m); } catch {} st = m; st.at = Date.now() - m.now; if (!st.opts || st.opts.kind !== "turn" || !st.opts.riichi.length) riichiMode = false; render(); autoAct(); }
        else if (m.t === "merr") statusEl.textContent = m.error === "full" ? "座位滿了" : "發生錯誤";
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    const rel = (i) => (i - (st.you >= 0 ? st.you : 0) + 4) % 4;      // 0 自己（下）、1 下家（右）、2 對家（上）、3 上家（左）

    function render() {
      DORA = new Set(rule === "jp" && st.dora ? st.dora.map((d) => doraOf(d >= 100 ? d - 100 : d)) : []);
      watchEl.textContent = st.watchers ? `👀 ${st.watchers}` : "";
      logEl.textContent = st.log || "";
      if (st.phase === "wait" || st.phase === "end") return renderLobby();
      renderTable();
    }

    // ---------------- 開打前：入座、加電腦、設定、開始
    function renderLobby() {
      const seated = st.you >= 0;
      const seats = st.seats.map((s, i) => {
        const wind = "東南西北"[i];
        if (!s) return `<div class="mjls empty"><span class="w">${wind}</span>${spectate ? "空位" : !seated ? `<button class="mb" data-sit="${i}">入座</button>` : `<button class="mb ghost" data-bot="${i}">＋電腦</button>`}</div>`;
        return `<div class="mjls${i === st.you ? " me" : ""}"><span class="w">${wind}</span><b>${esc(s.name)}</b>${s.tag ? `<span class="btag" title="電腦個性">${s.tag}</span>` : ""}${s.away ? "（離線）" : ""}${seated && s.bot ? `<button class="mdel" data-del="${i}">✕</button>` : ""}</div>`;
      }).join("");
      let cfg = "";
      const c = st.cfg;
      if (seated && !spectate) {
        const lens = rule === "tw" ? [[1, "一圈（東風圈）"], [4, "一將（四圈）"]] : [[1, "東風戰"], [2, "半莊戰（東南）"]];
        cfg = `<div class="mjcfg"><label>長度 <select class="cf-len">${lens.map(([v, n]) => `<option value="${v}"${c.len === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
          ${rule === "jp" ? `<label>赤寶牌 <select class="cf-aka"><option value="1"${c.aka !== false ? " selected" : ""}>有（三張紅五）</option><option value="0"${c.aka === false ? " selected" : ""}>無</option></select></label>` : ""}
          ${rule === "tw" ? `<label>底／台 <select class="cf-st">${st.stakes.map(([b, t], k) => `<option value="${k}"${c.base === b && c.tai === t ? " selected" : ""}>${b} 底 ${t} 台</option>`).join("")}</select></label>` : ""}</div>
          <button class="mb start">▶ 開始${st.seats.some((s) => !s) ? "（空位由電腦補）" : ""}</button>`;
      } else if (!spectate) cfg = `<div class="mempty">點「入座」坐下，坐好後可以加電腦、按開始。</div>`;
      const fin = st.final ? `<div class="mjfinal"><h3>牌局結束</h3>${st.final.map((r, k) => `<div class="fr${k === 0 ? " top" : ""}"><span>${["🥇", "🥈", "🥉", "4"][k]}</span><b>${esc(r.name)}</b><em>${r.points.toLocaleString()}</em></div>`).join("")}</div>` : "";
      const start = rule === "tw" ? "每人 20,000 點" : "每人 25,000 點";
      body.innerHTML = `${fin}<div class="mjlobby"><div class="mjseats">${seats}</div>${cfg}<small>${start}，練習用，不會動到代幣。</small>${seated && !spectate ? `<button class="mb ghost stand">離座</button>` : ""}</div>`;
      statusEl.textContent = spectate ? "👀 旁觀中，等開局" : st.phase === "end" ? "按開始再來一場" : "等玩家入座";
      body.querySelectorAll("[data-sit]").forEach((b) => b.addEventListener("click", () => send({ t: "msit", seat: Number(b.dataset.sit) })));
      body.querySelectorAll("[data-bot]").forEach((b) => b.addEventListener("click", () => send({ t: "maddbot", seat: Number(b.dataset.bot) })));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "mdelbot", seat: Number(b.dataset.del) })));
      const q = (s) => body.querySelector(s);
      q(".start") && q(".start").addEventListener("click", () => send({ t: "mstart" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "mstand" }));
      const sendCfg = () => send({ t: "mcfg", len: Number(q(".cf-len").value), stake: q(".cf-st") ? Number(q(".cf-st").value) : undefined, aka: q(".cf-aka") ? q(".cf-aka").value === "1" : undefined });
      q(".cf-aka") && q(".cf-aka").addEventListener("change", sendCfg);
      q(".cf-len") && q(".cf-len").addEventListener("change", sendCfg);
      q(".cf-st") && q(".cf-st").addEventListener("change", sendCfg);
    }

    // ---------------- 牌桌
    function seatBox(i) {
      const s = st.seats[i]; if (!s) return "";
      const r = rel(i), turn = st.stage && st.turn === i && st.phase === "play";
      const river = (s.river || []).map((x, k) => tile(x.t, `sm${x.riichi ? " side" : ""}${x.called ? " called" : ""}${st.last && st.last.seat === i && k === s.river.length - 1 && !x.called ? " lastd" : ""}`)).join("");
      const melds = (s.melds || []).map(meldHTML).join("");
      const flowers = (s.flowers || []).map((f) => tile(f, "sm")).join("");
      const hidden = r === 0 && st.you >= 0 ? "" : `<span class="mcnt" title="手牌張數"><span class="mt back xs"></span>${s.count || 0}</span>`;
      return `<div class="mseat r${r}${turn ? " turn" : ""}">
        <div class="minfo"><span class="mw${st.dealer === i ? " dealer" : ""}">${s.wind || ""}</span><b>${esc(s.name)}</b>${s.tag ? `<span class="btag" title="電腦個性">${s.tag}</span>` : ""}${s.away ? "（離線）" : ""}${s.riichi ? `<span class="mrii">立直</span>` : ""}${hidden}<em>${s.points.toLocaleString()}</em></div>
        <div class="mopen">${flowers}${melds}</div>
        <div class="mriver">${river}</div>
      </div>`;
    }
    function renderTable() {
      const you = st.you, me = you >= 0 ? st.seats[you] : null;
      const order = [2, 3, 1, 0].map((r) => [0, 1, 2, 3].find((i) => rel(i) === r));
      const dora = rule === "jp" && st.dora ? `<div class="mdora">寶牌指示 ${st.dora.map((d) => tile(d, "sm", "", true)).join("")}<span class="mdorahint">→ 發光的牌是寶牌</span></div>` : "";
      const extra = rule === "jp" ? `${st.honba ? `${st.honba} 本場　` : ""}${st.sticks ? `立直棒 ${st.sticks}` : ""}` : st.lian ? `連莊 ${st.lian}` : "";
      const inRes = st.phase === "result" && st.result;
      const center = `<div class="mcenter"><div class="mround">${inRes ? st.result.label0 : st.round}</div><div class="mwall">${inRes ? "結算中" : `剩 ${st.wall ?? "-"} 張`}</div>${dora}<div class="mextra">${extra}</div><div class="mtimer"></div></div>`;
      let hand = "", ctl = "";
      if (me && st.phase === "play") {
        const o = st.opts, myTurn = o && o.kind === "turn";
        const can = (t, drawn) => myTurn && (!o.lock || drawn) && (!riichiMode || o.riichi.includes(t));
        hand = `<div class="mhand${autoSort ? "" : " manual"}">${arranged().map((t, i) => tile(t, `big${can(t) ? " can" : ""}${riichiMode && o.riichi.includes(t) ? " rok" : ""}`, `data-t="${t}" data-i="${i}"${autoSort ? "" : ` draggable="true"`}`)).join("")}${st.drawn != null ? `<span class="mgap"></span>${tile(st.drawn, `big drawn${can(st.drawn, true) ? " can" : ""}${riichiMode && o.riichi.includes(st.drawn) ? " rok" : ""}`, `data-t="${st.drawn}"`)}` : ""}</div>`;
        const b = [];
        if (myTurn) {
          if (o.tsumo) b.push(`<button class="mb hu" data-a="tsumo">${rule === "jp" ? "自摸" : "自摸胡"}</button>`);
          if (o.riichi.length) b.push(`<button class="mb${riichiMode ? " on" : ""}" data-a="riichi">${riichiMode ? "取消立直" : "立直"}</button>`);
          for (const k of o.ankan) b.push(`<button class="mb" data-a="ankan" data-t="${k}">暗槓 ${tileName(k)}</button>`);
          for (const k of o.kakan) b.push(`<button class="mb" data-a="kakan" data-t="${k}">加槓 ${tileName(k)}</button>`);
          ctl = `<div class="mhint">${riichiMode ? "選一張打出去並立直（亮的牌可以）" : o.lock ? "立直中：自動打出摸到的牌" : "點一張牌打出去"}</div>`;
        } else if (o && o.kind === "claim") {
          ctl = `<div class="mhint">${tile(o.tile, "sm")} 要不要？</div>`;
          if (o.ron) b.push(`<button class="mb hu" data-a="ron">${rule === "jp" ? "榮和" : "胡"}</button>`);
          if (o.kan) b.push(`<button class="mb" data-a="kan">槓</button>`);
          if (o.pon) b.push(`<button class="mb" data-a="pon">碰</button>`);
          for (const w of o.chi) b.push(`<button class="mb chi" data-a="chi" data-w="${w.join(",")}">吃 ${[...w, o.tile].sort((x, y) => x - y).map((x) => tile(x, "xs")).join("")}</button>`);
          b.push(`<button class="mb ghost" data-a="pass">過</button>`);
        } else ctl = `<div class="mhint">${st.stage === "claim" ? "等其他人決定…" : `輪到 ${esc(st.seats[st.turn]?.name || "")}`}</div>`;
        if (st.waits && st.waits.length) ctl += `<div class="mwaits">聽：${st.waits.map((x) => tile(x, "xs")).join("")}</div>`;
        ctl = `<div class="mctl">${ctl}<div class="mbtns">${b.join("")}</div></div>`;
        const chip = (k, on, name, tip) => `<button class="${on ? "on" : ""}" data-auto="${k}" title="${tip}">${name}</button>`;
        hand += `<div class="mauto">${chip("sort", autoSort, "自動理牌", "關掉後手牌不自動排序，可以拖曳牌自己排")}${chip("win", auto.win, "自動和牌", "能自摸或榮和時自動和")}${chip("nocall", auto.nocall, "不吃碰槓", "別人打牌時自動跳過吃、碰、槓（能和牌時還是會問）")}${chip("giri", auto.giri, "自動摸切", "摸到牌直接打出去（能自摸時會停下來讓你決定）")}</div>`;
      } else if (st.phase === "play") ctl = `<div class="mctl"><div class="mhint">${spectate ? "👀 旁觀中（看不到手牌）" : `還沒入座。可以點電腦的位置接手：${st.seats.map((s, i) => (s && s.bot ? `<button class="mb ghost" data-sit="${i}">接手 ${esc(s.name)}</button>` : "")).join("")}`}</div></div>`;
      const result = st.phase === "result" && st.result ? resultHTML(st.result) : "";
      const keepK = tipK;
      hideTip(true);
      body.innerHTML = `<div class="mtable">${order.map(seatBox).join("")}${center}</div>${result}${hand}${ctl}${me && !spectate ? `<div class="mfoot"><button class="mb ghost stand">離座（電腦接手）</button></div>` : ""}`;
      body.querySelectorAll(".mhand .mt.can").forEach((el) => el.addEventListener("click", () => {
        const t = Number(el.dataset.t);
        if (riichiMode) { riichiMode = false; send({ t: "mact", a: "riichi", tile: t }); } else send({ t: "mact", a: "discard", tile: t });
      }));
      body.querySelectorAll(".mbtns [data-a]").forEach((el) => el.addEventListener("click", () => {
        const a = el.dataset.a;
        if (a === "riichi") { riichiMode = !riichiMode; render(); return; }
        if (a === "chi") return send({ t: "mact", a, with: el.dataset.w.split(",").map(Number) });
        send({ t: "mact", a, tile: el.dataset.t != null ? Number(el.dataset.t) : undefined });
      }));
      body.querySelectorAll("[data-sit]").forEach((el) => el.addEventListener("click", () => send({ t: "msit", seat: Number(el.dataset.sit) })));
      body.querySelectorAll("[data-auto]").forEach((el) => el.addEventListener("click", () => {
        const k = el.dataset.auto;
        if (k === "sort") { autoSort = !autoSort; try { localStorage.setItem("mj_sort", autoSort ? "1" : "0"); } catch {} }
        else auto[k] = !auto[k];
        autoSig = ""; render(); autoAct();
      }));
      // 自動理牌關掉時：拖曳手牌換位置
      if (!autoSort) body.querySelectorAll(".mhand .mt[data-i]").forEach((el) => {
        el.addEventListener("dragstart", (e) => { dragI = Number(el.dataset.i); hideTip(); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragI)); } catch {} });
        el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dropto"); });
        el.addEventListener("dragleave", () => el.classList.remove("dropto"));
        el.addEventListener("drop", (e) => {
          e.preventDefault(); const to = Number(el.dataset.i);
          if (dragI >= 0 && dragI !== to && handOrder) { const [t] = handOrder.splice(dragI, 1); handOrder.splice(to, 0, t); }
          dragI = -1; render();
        });
        el.addEventListener("dragend", () => { dragI = -1; });
      });
      const sb = body.querySelector(".stand"); sb && sb.addEventListener("click", () => send({ t: "mstand" }));
      // 指到手牌：顯示這種牌在場上出現幾張、誰打的，並把桌上同樣的牌標出來（手機長按）
      body.querySelectorAll(".mhand .mt[data-t]").forEach((el) => {
        const k = Number(el.dataset.k);
        el.addEventListener("mouseenter", () => showTip(el, k));
        el.addEventListener("mouseleave", hideTip);
        let lp = 0;
        el.addEventListener("touchstart", () => { lp = setTimeout(() => { lp = -1; showTip(el, k); }, 450); }, { passive: true });
        el.addEventListener("touchend", (e) => { if (lp === -1) { e.preventDefault(); setTimeout(hideTip, 1500); } else clearTimeout(lp); lp = 0; });
        el.addEventListener("contextmenu", (e) => e.preventDefault());
      });
      if (keepK != null) { const el = [...body.querySelectorAll(".mhand .mt[data-t]")].find((x) => Number(x.dataset.k) % 100 === keepK && x.matches(":hover")); if (el) showTip(el, keepK); else tipK = null; }   // 畫面更新後，滑鼠還在同一張牌上就繼續顯示
      body.querySelectorAll(".myk").forEach((el) => el.addEventListener("click", () => { popName = popName === el.dataset.y ? "" : el.dataset.y; render(); }));
      tickStatus();
    }
    // ---- 音效：比較前後兩次狀態，看發生了什麼事
    const riverN = (s) => (s && s.seats ? s.seats.reduce((n, x) => n + ((x && x.river) || []).length, 0) : 0);
    function sounds(prev, m) {
      if (m.phase === "play" && riverN(m) === 0 && (!prev || prev.phase !== "play" || riverN(prev) > 0)) { mjSfx.shuffle(); return; }   // 新的一局：洗牌
      if (!prev || prev.phase !== "play") return;
      if (m.phase === "result" && m.result) {
        const r = m.result;
        if (r.kind === "draw") mjSfx.exhaust();
        else if (r.winner === m.you) mjSfx.win(true);
        else if (r.from === m.you && m.you >= 0) mjSfx.lose();
        else mjSfx.win(false);
        return;
      }
      if (m.phase !== "play") return;
      let called = null, riichi = false, flower = false;
      m.seats.forEach((x, i) => {
        const p = prev.seats[i]; if (!x || !p) return;
        const ml = x.melds || [], pl = p.melds || [];
        if (ml.length > pl.length) called = ml[ml.length - 1].k;
        else if (ml.some((mm, k) => pl[k] && mm.tiles.length > pl[k].tiles.length)) called = "kakan";
        if (x.riichi && !p.riichi) riichi = true;
        if ((x.flowers || []).length > (p.flowers || []).length) flower = true;
      });
      const dn = riverN(m) - riverN(prev);
      if (riichi) mjSfx.riichi();
      else if (called) (/kan/.test(called) ? mjSfx.kan() : mjSfx.call());
      else if (dn > 0) mjSfx.discard();
      if (flower) setTimeout(() => mjSfx.flower(), 120);
      const myTurnNow = m.opts && m.opts.kind === "turn", myTurnBefore = prev.opts && prev.opts.kind === "turn";
      if (myTurnNow && !myTurnBefore) { if (m.drawn != null) mjSfx.draw(); setTimeout(() => mjSfx.myturn(), 160); }
      if (m.opts && m.opts.kind === "claim" && !(prev.opts && prev.opts.kind === "claim" && prev.opts.tile === m.opts.tile)) setTimeout(() => mjSfx.claim(), 180);
    }

    // ---- 手牌提示：這種牌場上看得到幾張、誰打的
    const kindOf = (t) => (t >= 100 ? t - 100 : t);
    let tipEl = null, tipK = null;
    function hideTip(keep) { if (!keep) tipK = null; if (tipEl) { tipEl.remove(); tipEl = null; } body.querySelectorAll(".mt.hl").forEach((x) => x.classList.remove("hl")); }
    function showTip(el, k) {
      hideTip(); tipK = k;
      const nm = (i) => esc(st.seats[i]?.name || "");
      const disc = [], meld = [];
      let seen = 0;
      st.seats.forEach((s, i) => {
        if (!s) return;
        const rv = (s.river || []).filter((x) => kindOf(x.t) === k);
        if (rv.length) {
          const called = rv.filter((x) => x.called).length;
          disc.push(`${nm(i)} 打 ${rv.length} 張${called ? `（${called} 張被吃碰走）` : ""}`);
          seen += rv.length - called;
        }
        const mm = (s.melds || []).reduce((n, m) => n + m.tiles.filter((x) => kindOf(x) === k).length, 0);
        if (mm) { meld.push(`${nm(i)} 副露 ${mm} 張`); seen += mm; }
      });
      const dora = (st.dora || []).filter((d) => kindOf(d) === k).length;
      const mine = [...(st.hand || []), ...(st.drawn != null ? [st.drawn] : [])].filter((x) => kindOf(x) === k).length;
      seen += dora + mine;
      const left = Math.max(0, 4 - seen);
      tipEl = document.createElement("div");
      tipEl.className = "mtip";
      tipEl.innerHTML = `<b>${tileName(k)}</b>　場上看得到 <em>${seen}</em> 張（含你手上 ${mine} 張${dora ? `、寶牌指示 ${dora} 張` : ""}），還有 <em>${left}</em> 張沒出現`
        + (disc.length ? `<div>🀄 ${disc.join("、")}</div>` : `<div>還沒有人打過</div>`) + (meld.length ? `<div>🔒 ${meld.join("、")}</div>` : "");
      document.body.appendChild(tipEl);
      const r = el.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 16);
      tipEl.style.width = w + "px";
      tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
      tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight - 10) + "px";
      body.querySelectorAll(".mtable .mt[data-k]").forEach((x) => { if (kindOf(Number(x.dataset.k)) === k) x.classList.add("hl"); });
    }

    function resultHTML(r) {
      const nm = (i) => esc(st.seats[i]?.name || "");
      const deltas = r.deltas.map((d, i) => `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${nm(i)} ${d > 0 ? "+" : ""}${d.toLocaleString()}</span>`).join("");
      if (r.kind === "draw") {
        const tp = rule === "jp" ? `<div class="mrl">${r.tenpai.map((x, i) => `${nm(i)}：${x ? "聽牌" : "沒聽"}`).join("　")}</div>` : `<div class="mrl">莊家連莊</div>`;
        return `<div class="mresult"><h3>${r.label0} 流局</h3>${tp}<div class="mdelta">${deltas}</div>${r.gameOver ? "<div class='mrl'>這場打完了</div>" : ""}</div>`;
      }
      const title = r.kind === "tsumo" ? `${nm(r.winner)} 自摸` : r.kind === "eight" ? `${nm(r.winner)} 八仙過海` : `${nm(r.winner)} 胡 ${nm(r.from)} 的牌`;
      let hl = false;
      const handT = r.hand.map((t) => { const w = !hl && t === r.tile; if (w) hl = true; return tile(t, `sm${w ? " win" : ""}`); }).join("") + (r.melds || []).map(meldHTML).join("") + (r.flowers || []).map((f) => tile(f, "xs")).join("");
      let detail;
      const key = r.label0 + r.kind + r.winner;
      if (popFor !== key) { popFor = key; popName = ""; }
      const yk = (n, txt) => `<span class="myk${popName === n ? " on" : ""}" data-y="${esc(n)}">${txt}</span>`;
      const it = popName ? guideItem(rule, popName) : null;
      const pop = it ? `<div class="mypop"><b>${it[0]}</b>　<em>${it[1]}</em><div>${it[2]}</div>${exHTML(it[3])}</div>` : "";
      if (rule === "jp") detail = `<div class="mrl">${r.yaku.map(([n, v]) => yk(n, `${n} ${v === "役滿" ? "役滿" : v + " 翻"}`)).join("")}</div>${pop}<div class="mrs">${r.yakuman ? r.label : `${r.han} 翻 ${r.fu} 符${r.label ? "　" + r.label : ""}`}</div>`;
      else detail = `<div class="mrl">${r.list.length ? r.list.map(([n, v]) => yk(n, `${n} ${v} 台`)).join("") : "<span>沒有台（屁胡）</span>"}</div>${pop}<div class="mrs">${r.pays.map((p) => `${nm(p.seat)} 付 ${p.amount.toLocaleString()}（${p.tai} 台）`).join("　")}</div>`;
      return `<div class="mresult"><h3>${r.label0}　${title}！</h3><div class="mrhand">${handT}</div>${detail}<div class="mdelta">${deltas}</div>${r.gameOver ? "<div class='mrl'>這場打完了，馬上公布名次</div>" : ""}</div>`;
    }
    function tickStatus() {
      if (!st || st.phase === "wait" || st.phase === "end") { document.body.classList.remove("mj-myturn", "mj-myclaim"); return; }
      const now = Date.now() - st.at;
      const tEl = body.querySelector(".mtimer");
      if (st.phase === "result") { document.body.classList.remove("mj-myturn", "mj-myclaim"); statusEl.textContent = `${st.round}　下一局 ${Math.max(0, Math.ceil((st.nextAt - now) / 1000))} 秒`; if (tEl) tEl.textContent = ""; return; }
      const left = st.deadline ? Math.max(0, Math.ceil((st.deadline - now) / 1000)) : 0;
      const mine = st.opts && st.you >= 0;
      statusEl.textContent = `${TITLE}　${st.round}　${mine ? (st.opts.kind === "turn" ? "輪到你" : "可以叫牌") : st.stage === "claim" ? "等待叫牌" : `輪到 ${st.seats[st.turn]?.name || ""}`}`;
      if (tEl) { tEl.textContent = mine && left ? `⏱ ${left}` : ""; tEl.classList.toggle("urgent", mine && left <= 5); }
      // 輪到自己決定事情：打牌是藍色、可以吃碰槓胡是橘色
      document.body.classList.toggle("mj-myturn", !!(mine && st.opts.kind === "turn"));
      document.body.classList.toggle("mj-myclaim", !!(mine && st.opts.kind === "claim"));
    }
    function cleanup() { hideTip(); closed = true; clearInterval(timer); document.body.classList.remove("mj-myturn", "mj-myclaim"); try { ws && ws.close(); } catch {} }
    timer = setInterval(tickStatus, 300);
    connect();
    return cleanup;
  };
}
