// 麻將（練習點數）：台灣 16 張（rule "tw"）和日本立直（rule "jp"）共用這個畫面。
// 洗牌、判定、計分都在伺服器（server/mahjong.js），這裡只畫牌桌和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { GUIDE, guideItem, parseTiles } from "./mjguide.js";

const NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HON = ["東", "南", "西", "北", "白", "發", "中"];
const FLO = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function tileName(t) { if (t >= 100) return "赤" + tileName(t - 100); if (t >= 34) return FLO[t - 34]; if (t >= 27) return HON[t - 27]; return NUM[t % 9] + ["萬", "筒", "條"][Math.floor(t / 9)]; }
// 一張牌：數字牌上面大字、下面小字花色；字牌一個大字；花牌一個字＋編號
function tile(t, cls = "", attrs = "") {
  if (t == null || t < 0) return `<span class="mt back ${cls}" ${attrs}></span>`;
  if (t >= 100) return tile(t - 100, cls + " aka", attrs);                 // 赤寶牌（紅五）
  let body, k;
  if (t >= 34) { k = "f"; body = `<b>${FLO[t - 34]}</b><i>${(t - 34) % 4 + 1}</i>`; }
  else if (t >= 27) { k = ["w", "w", "w", "w", "dw", "dg", "dr"][t - 27]; body = `<b>${t === 31 ? "" : HON[t - 27]}</b>`; }
  else { const s = Math.floor(t / 9); k = ["m", "p", "s"][s]; body = `<b>${s === 0 ? NUM[t % 9] : (t % 9) + 1}</b><i>${["萬", "筒", "條"][s]}</i>`; }
  return `<span class="mt k${k} ${cls}" ${attrs}>${body}</span>`;
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
        <header><button class="back">← 選單</button><h2>${TITLE}</h2><button class="mjgbtn">📘 ${rule === "jp" ? "役表" : "台數表"}</button><span class="watch"></span></header>
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
    $(".mjgbtn").addEventListener("click", () => { if (guideEl.hidden) { renderGuide(); guideEl.hidden = false; guideEl.scrollIntoView({ block: "start" }); } else guideEl.hidden = true; });
    let ws = null, closed = false, retry = 0, st = null, timer = 0, riichiMode = false, lastSig = "";
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "mjoin", rule, room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "mstate") { st = m; st.at = Date.now() - m.now; if (!st.opts || st.opts.kind !== "turn" || !st.opts.riichi.length) riichiMode = false; render(); }
        else if (m.t === "merr") statusEl.textContent = m.error === "full" ? "座位滿了" : "發生錯誤";
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    const rel = (i) => (i - (st.you >= 0 ? st.you : 0) + 4) % 4;      // 0 自己（下）、1 下家（右）、2 對家（上）、3 上家（左）

    function render() {
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
        return `<div class="mjls${i === st.you ? " me" : ""}"><span class="w">${wind}</span><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}${seated && s.bot ? `<button class="mdel" data-del="${i}">✕</button>` : ""}</div>`;
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
        <div class="minfo"><span class="mw${st.dealer === i ? " dealer" : ""}">${s.wind || ""}</span><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}${s.riichi ? `<span class="mrii">立直</span>` : ""}${hidden}<em>${s.points.toLocaleString()}</em></div>
        <div class="mopen">${flowers}${melds}</div>
        <div class="mriver">${river}</div>
      </div>`;
    }
    function renderTable() {
      const you = st.you, me = you >= 0 ? st.seats[you] : null;
      const order = [2, 3, 1, 0].map((r) => [0, 1, 2, 3].find((i) => rel(i) === r));
      const dora = rule === "jp" && st.dora ? `<div class="mdora">寶牌指示 ${st.dora.map((d) => tile(d, "sm")).join("")}</div>` : "";
      const extra = rule === "jp" ? `${st.honba ? `${st.honba} 本場　` : ""}${st.sticks ? `立直棒 ${st.sticks}` : ""}` : st.lian ? `連莊 ${st.lian}` : "";
      const inRes = st.phase === "result" && st.result;
      const center = `<div class="mcenter"><div class="mround">${inRes ? st.result.label0 : st.round}</div><div class="mwall">${inRes ? "結算中" : `剩 ${st.wall ?? "-"} 張`}</div>${dora}<div class="mextra">${extra}</div><div class="mtimer"></div></div>`;
      let hand = "", ctl = "";
      if (me && st.phase === "play") {
        const o = st.opts, myTurn = o && o.kind === "turn";
        const can = (t, drawn) => myTurn && (!o.lock || drawn) && (!riichiMode || o.riichi.includes(t));
        hand = `<div class="mhand">${(st.hand || []).map((t) => tile(t, `big${can(t) ? " can" : ""}${riichiMode && o.riichi.includes(t) ? " rok" : ""}`, `data-t="${t}"`)).join("")}${st.drawn != null ? `<span class="mgap"></span>${tile(st.drawn, `big drawn${can(st.drawn, true) ? " can" : ""}${riichiMode && o.riichi.includes(st.drawn) ? " rok" : ""}`, `data-t="${st.drawn}"`)}` : ""}</div>`;
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
      } else if (st.phase === "play") ctl = `<div class="mctl"><div class="mhint">${spectate ? "👀 旁觀中（看不到手牌）" : `還沒入座。可以點電腦的位置接手：${st.seats.map((s, i) => (s && s.bot ? `<button class="mb ghost" data-sit="${i}">接手 ${esc(s.name)}</button>` : "")).join("")}`}</div></div>`;
      const result = st.phase === "result" && st.result ? resultHTML(st.result) : "";
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
      const sb = body.querySelector(".stand"); sb && sb.addEventListener("click", () => send({ t: "mstand" }));
      body.querySelectorAll(".myk").forEach((el) => el.addEventListener("click", () => { popName = popName === el.dataset.y ? "" : el.dataset.y; render(); }));
      tickStatus();
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
    function cleanup() { closed = true; clearInterval(timer); document.body.classList.remove("mj-myturn", "mj-myclaim"); try { ws && ws.close(); } catch {} }
    timer = setInterval(tickStatus, 300);
    connect();
    return cleanup;
  };
}
