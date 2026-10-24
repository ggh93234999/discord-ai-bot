// 種菜（個人農場，即時生長）：作物按真實時間長大，關掉 Activity 也照長。規則、數字、隨機都在伺服器，這裡只畫田和送指令。
// 模式和賭場一樣：練習模式（農場自己的練習幣）／真代幣模式（Discord 授權後動用機器人錢包的真代幣）。
import { wsUrl } from "./gomoku.js";
import { sfx, sfxOn, setSfx } from "./farmsfx.js";

const ERR = {
  need_login: "要先登入才能用真代幣模式", bot_down: "機器人暫時連不上，稍後再試", insufficient: "代幣不夠", busy: "上一個動作還在處理，等一下再按",
  no_empty: "沒有空地可以種", bad_crop: "沒有這種作物", none_ripe: "還沒有成熟的作物", nothing: "沒有東西可以賣", max_plots: "田已經擴到最大了",
  no_farm: "找不到這塊農場", self: "不能偷自己的菜", steal_cap: "你今天已經偷夠了（每天最多 20 個）", not_ripe: "還不能偷：剛成熟的 5 分鐘內主人優先",
  no_more: "這塊地你不能再偷了（每個人只能偷一次，每塊地最多被偷 1 個）", bad_plot: "這塊地沒有作物", tree_half: "這棵樹已經被偷走一半了，剩下的要留給主人", error: "發生錯誤，再試一次",
};
const VNAME = { n: "", big: "大顆", gold: "金色" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n).toLocaleString();
function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + " 秒";
  const m = Math.ceil(s / 60);
  if (m < 60) return m + " 分";
  const h = Math.floor(m / 60), r = m % 60;
  return h + " 小時" + (r ? " " + r + " 分" : "");
}
const pidOf = () => { try { let p = localStorage.getItem("farmpid"); if (!p) { p = Math.random().toString(36).slice(2, 12); localStorage.setItem("farmpid", p); } return p; } catch { return "x" + Math.random().toString(36).slice(2, 10); } };

const p2 = (n) => String(n).padStart(2, "0");
// 紀錄時間：今天只顯示 HH:MM，其他天加上月/日
function logTime(ts) {
  if (!ts) return "";
  const d = new Date(ts), n = new Date();
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function mountFarm(root, { env, back }) {
  root.innerHTML = `
    <div class="game slots farm">
      <header><button class="back">← 選單</button><h2>🌱 種菜</h2><button class="fsnd" title="音效開關">${sfxOn() ? "🔊" : "🔇"}</button></header>
      <div class="modebar">
        <button class="mode on" data-m="practice">🎮 練習模式</button>
        <button class="mode" data-m="real">💰 真代幣模式</button>
      </div>
      <div class="confirm" hidden><div class="ctext"></div><div class="cbtns"><button class="cyes">確定</button><button class="cno">取消</button></div></div>
      <div class="status">連線中…</div>
      <div class="fbar"><div class="bal"><span class="ballabel">練習幣</span> <b>--</b></div><button class="fbuy" hidden></button></div>
      <div class="ftabs"><button class="on" data-tab="mine">我的農場</button><button data-tab="visit">拜訪別人</button></div>
      <div class="fbody"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const statusEl = $(".status"), body = $(".fbody"), balEl = $(".bal b"), buyBtn = $(".fbuy"), confirmEl = $(".confirm");
  const modeBtns = root.querySelectorAll(".mode"), tabBtns = root.querySelectorAll(".ftabs button");
  $(".back").addEventListener("click", back);
  $(".fsnd").addEventListener("click", (e) => { setSfx(!sfxOn()); e.currentTarget.textContent = sfxOn() ? "🔊" : "🔇"; if (sfxOn()) sfx.ripe(); });

  let ws = null, closed = false, retry = 0, wantReal = false;
  let mode = "practice", session = env.session || null, tab = "mine";
  let st = null, base = 0, sel = "radish", list = null, vis = null, visBase = 0, tick = 0;
  const real = () => mode === "real";
  let pend = "";      // 等伺服器回應的動作（種植／擴地），回應來了才播音效
  const send = (o) => { if (o.a === "plant" || o.a === "buyplot") pend = o.a; return ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "fm", real: real(), pid: pidOf(), ...o })); };

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; if (session) ws.send(JSON.stringify({ t: "bauth", token: session.token })); send({ a: "get" }); statusEl.textContent = "種點東西吧"; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "bauthed") return onAuthed(m);
      if (m.t !== "fm") return;
      if (m.a === "view") { st = m; base = Date.now(); if (!CROPS_BY.length) fillCrops(m.crops); showBal(); if (tab === "mine") draw(); if (pend === "plant") sfx.plant(); else if (pend === "buyplot") sfx.build(); pend = ""; }
      else if (m.a === "list") { list = m; if (tab === "visit" && !vis) draw(); }
      else if (m.a === "visit") { vis = m; visBase = Date.now(); if (tab === "visit") draw(); }
      else if (m.a === "got") { statusEl.textContent = "收成了 " + summarize(m.got); sfx.harvest(m.got); }
      else if (m.a === "sold") { statusEl.textContent = "賣出了，拿到 " + money(m.amount) + " 代幣"; sfx.sell(); }
      else if (m.a === "stole") { statusEl.textContent = m.tree ? `偷到了 ${VNAME[m.v]}${cropOf(m.c).icon}！果樹不限次數，這棵還能偷 ${m.treeLeft} 個` : `偷到了 ${VNAME[m.v]}${cropOf(m.c).icon}！今天還能偷 ${m.left} 個`; sfx.steal(); }
      else if (m.a === "err") {
        statusEl.textContent = (ERR[m.error] || ERR.error); pend = ""; sfx.err();
        if (m.balance != null && st) { st.balance = m.balance; showBal(); }
        if (m.error === "no_more" || m.error === "not_ripe") send({ a: "visit", id: vis && vis.id });
      }
    };
    ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }
  let CROPS_BY = [];
  const fillCrops = (c) => { CROPS_BY = c; };
  const cropOf = (id) => CROPS_BY.find((c) => c.id === id) || { icon: "🌱", name: id, seed: 0, min: 0, unit: 0 };
  function summarize(got) {
    const cnt = {}; for (const g of got) { const k = (VNAME[g.v] || "") + cropOf(g.c).icon; cnt[k] = (cnt[k] || 0) + 1; }
    return Object.entries(cnt).map(([k, n]) => k + "×" + n).join(" ");
  }
  function showBal() {
    $(".ballabel").textContent = real() ? "💰 代幣" : "練習幣";
    balEl.textContent = st && st.balance != null ? money(st.balance) : "--";
    if (st && st.plotCost) { buyBtn.hidden = false; buyBtn.textContent = `🟫 擴一塊地 ${money(st.plotCost)}（${st.np}/${st.max}）`; }
    else buyBtn.hidden = true;
  }

  // ---- 畫面
  const elapsed = () => Date.now() - base;
  let lastSig = "";
  const sigMine = () => (st ? st.plots.map((p) => (p ? (p.left - elapsed() <= 0 ? "r" : "g") : "e")).join("") : "");
  const sigVisit = () => (vis ? vis.plots.map((p) => { if (!p) return "n"; const el = Date.now() - visBase; return p.left - el > 0 ? "g" : p.grace - el > 0 ? "w" : p.canSteal ? "s" : "d"; }).join("") : "");
  function draw() {
    lastSig = sigMine();
    if (tab === "visit") return drawVisit();
    if (!st) { body.innerHTML = `<p class="fempty">讀取農場中…</p>`; return; }
    const el = elapsed();
    const seedCard = (c) => `<button class="seed${c.id === sel ? " sel" : ""}${c.tree ? " tree" : ""}" data-c="${c.id}"><span>${c.icon}</span><b>${c.name}</b><small>${c.tree ? `樹苗 ${money(c.seed)} 代幣<br>每 ${fmt(c.min * 60000)} 結 ${c.y} 個` : `${money(c.seed)} 代幣<br>${fmt(c.min * 60000)}・產 ${c.y}`}</small></button>`;
    const seeds = `<div class="seeds">${st.crops.filter((c) => !c.tree).map(seedCard).join("")}</div>`
      + (st.crops.some((c) => c.tree) ? `<div class="seedtitle">🌳 果樹：只買一次，收成後樹還在，每隔一段時間再結果</div><div class="seeds">${st.crops.filter((c) => c.tree).map(seedCard).join("")}</div>` : "");
    const plots = st.plots.map((p, i) => {
      if (!p) return `<button class="plot empty" data-i="${i}"><span class="pi">＋</span><small>種${cropOf(sel).name}</small></button>`;
      const left = Math.max(0, p.left - el), c = cropOf(p.c);
      const chop = c.tree ? `<span class="chop" data-i="${i}" title="砍掉這棵樹">🪓</span>` : "";
      if (left > 0) return `<div class="plot grow${c.tree ? " tree" : ""}" data-i="${i}" data-end="${base + p.left}">${chop}<span class="pi sm">${c.icon}</span><small>${fmt(left)}</small><i style="--pr:${Math.max(0.05, 1 - left / (c.min * 60000))}"></i></div>`;
      return `<button class="plot ripe${c.tree ? " tree" : ""}" data-i="${i}">${chop}<span class="pi">${c.icon}</span><small>可收成 ×${p.got}${p.stolen ? `（被偷 ${p.stolen}）` : ""}</small></button>`;
    }).join("");
    const emptyN = st.plots.filter((p) => !p).length, ripeN = st.plots.filter((p) => p && p.left - el <= 0).length;
    const inv = st.inv.map((x) => `<button class="item" data-k="${x.k}" title="賣出這個">${VNAME[x.v] ? `<em>${VNAME[x.v]}</em>` : ""}${cropOf(x.c).icon}<b>×${x.n}</b><small>${money(x.unit)}/個</small></button>`).join("");
    const log = st.log.length ? `<div class="flog"><b>最近發生的事</b>${st.log.map((l) => `<div><span class="ftime">${logTime(l.ts)}</span>${esc(l.txt)}</div>`).join("")}</div>` : "";
    body.innerHTML = `
      ${seeds}
      <div class="fact"><button class="plantall" ${emptyN ? "" : "disabled"}>全部種${cropOf(sel).icon}（${emptyN} 塊）</button><button class="harvall" ${ripeN ? "" : "disabled"}>全部收成（${ripeN} 塊）</button></div>
      <div class="fgrid">${plots}</div>
      <div class="finv"><div class="ftitle">🧺 倉庫${st.invValue ? `<button class="sellall">全部賣出 +${money(st.invValue)}</button>` : ""}</div>${inv || `<p class="fempty">空的。收成後的菜會放在這裡，按一下就能賣。</p>`}</div>
      ${log}
      <p class="fnote">蔬菜：每塊地一次收幾個看作物（種子卡上的「產」），收成後土地清空；別人看到成熟的菜 5 分鐘後可以來偷，每塊地最多被偷 1 個。<br>果樹：只買一次，每隔一段時間結一次果（一次 20 個以上），收成後樹還在；任何人都能偷、次數不限，但每棵樹每輪最多被偷走一半，被偷光一半主人也不會虧本。有機會長出大顆（賣 2 倍）和金色（賣 5 倍）。</p>`;
    body.querySelectorAll(".seed").forEach((b) => b.addEventListener("click", () => { sel = b.dataset.c; sfx.tick(); draw(); }));
    body.querySelectorAll(".plot.empty").forEach((b) => b.addEventListener("click", () => send({ a: "plant", c: sel, i: +b.dataset.i })));
    body.querySelectorAll(".plot.ripe").forEach((b) => b.addEventListener("click", () => send({ a: "harvest", i: +b.dataset.i })));
    body.querySelectorAll(".chop").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault();
      const i = +b.dataset.i, c = st.plots[i] && cropOf(st.plots[i].c);
      askConfirm(`要砍掉這棵${c ? c.name : ""}樹嗎？不會退樹苗錢，這輪還沒收的果子也會沒有。`, () => send({ a: "chop", i }));
    }));
    const pa = body.querySelector(".plantall"); if (pa) pa.addEventListener("click", () => send({ a: "plant", c: sel, i: "all" }));
    const ha = body.querySelector(".harvall"); if (ha) ha.addEventListener("click", () => send({ a: "harvest", i: "all" }));
    body.querySelectorAll(".item").forEach((b) => b.addEventListener("click", () => send({ a: "sell", k: b.dataset.k })));
    const sa = body.querySelector(".sellall"); if (sa) sa.addEventListener("click", () => send({ a: "sell", k: "all" }));
  }
  function drawVisit() {
    lastSig = sigVisit();
    if (vis) {
      const el = Date.now() - visBase;
      const plots = vis.plots.map((p, i) => {
        if (!p) return `<div class="plot none"><span class="pi sm">·</span></div>`;
        const c = cropOf(p.c), left = Math.max(0, p.left - el), grace = Math.max(0, p.grace - el);
        if (left > 0) return `<div class="plot grow" data-end="${visBase + p.left}"><span class="pi sm">${c.icon}</span><small>${fmt(left)}</small></div>`;
        if (grace > 0) return `<div class="plot wait" data-end="${visBase + p.grace}" data-pre="主人優先 "><span class="pi">${c.icon}</span><small>主人優先 ${fmt(grace)}</small></div>`;
        if (p.canSteal) return `<button class="plot ripe steal${p.tree ? " tree" : ""}" data-i="${i}"><span class="pi">${c.icon}</span><small>偷一個${p.tree ? `（還能偷 ${p.stealLeft}）` : ""}</small></button>`;
        return `<div class="plot done${p.tree ? " tree" : ""}"><span class="pi">${c.icon}</span><small>${p.mineDone ? "你偷過了" : p.full ? (p.tree ? "已被偷走一半" : "被偷光了") : "不能偷"}</small></div>`;
      }).join("");
      body.innerHTML = `<div class="ftitle"><button class="vback">← 農場列表</button><b>🏡 ${esc(vis.name)} 的農場</b></div><div class="fgrid">${plots}</div><p class="fnote">${st ? `蔬菜你今天還能偷 ${st.stealLeft} 個；果樹不限次數，但每棵每輪最多被偷走一半。` : ""}偷來的放進自己的倉庫，到「我的農場」賣掉。</p>`;
      body.querySelector(".vback").addEventListener("click", () => { vis = null; send({ a: "list" }); draw(); });
      body.querySelectorAll(".steal").forEach((b) => b.addEventListener("click", () => send({ a: "steal", id: vis.id, i: +b.dataset.i })));
      return;
    }
    if (!list) { body.innerHTML = `<p class="fempty">讀取中…</p>`; return; }
    body.innerHTML = list.rows.length
      ? `<div class="flist">${list.rows.map((r) => `<button class="frow" data-id="${r.id}"><b>🏡 ${esc(r.name)}</b><span>${r.planted}/${r.np} 塊有種${r.ripe ? ` · <em>${r.ripe} 塊成熟</em>` : ""}</span></button>`).join("")}</div>`
      : `<p class="fempty">還沒有別人的農場。等朋友開始種菜，這裡就看得到。</p>`;
    body.querySelectorAll(".frow").forEach((b) => b.addEventListener("click", () => send({ a: "visit", id: b.dataset.id })));
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.tab; tabBtns.forEach((x) => x.classList.toggle("on", x === b)); vis = null;
    if (tab === "visit") { list = null; send({ a: "list" }); } else send({ a: "get" });
    draw();
  }));
  buyBtn.addEventListener("click", () => { if (!st || !st.plotCost) return; askConfirm(`擴一塊地要花 ${money(st.plotCost)} ${real() ? "真代幣" : "練習幣"}（目前 ${st.np} 塊，擴完 ${st.np + 1} 塊），確定嗎？`, () => send({ a: "buyplot" })); });

  // ---- 模式切換／登入（和賭場相同）
  function setMode(m) {
    mode = m; modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.m === m)); root.querySelector(".farm").classList.toggle("realmode", m === "real");
    st = null; list = null; vis = null; draw(); showBal(); send({ a: tab === "visit" ? "list" : "get" });
    statusEl.textContent = m === "real" ? `真代幣模式：${session ? session.name : ""}，買種子、賣菜都是真代幣！` : "練習模式：農場獨立，用練習幣";
  }
  function askConfirm(text, onYes) {
    confirmEl.hidden = false; $(".ctext").textContent = text;
    $(".cyes").onclick = () => { confirmEl.hidden = true; onYes(); };
    $(".cno").onclick = () => { confirmEl.hidden = true; statusEl.textContent = "已取消"; };
  }
  modeBtns.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.m === "practice") { if (real()) setMode("practice"); return; }
    if (real()) return;
    if (!env.inDiscord || !env.sdk) { statusEl.textContent = "真代幣模式要在 Discord 裡開啟這個 Activity 才能用（要確認你的 Discord 身分）"; return; }
    askConfirm("真代幣模式會用到你在機器人那邊的真代幣：買種子會扣、賣菜會加。農場和練習模式是分開的。要開啟嗎？（第一次會跳出 Discord 授權視窗）", login);
  }));
  async function login() {
    try {
      if (!session) {
        statusEl.textContent = "請在 Discord 跳出的視窗按「授權」…";
        await env.sdk.ready();
        const { code } = await env.sdk.commands.authorize({ client_id: env.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"] });
        statusEl.textContent = "確認身分中…";
        const r = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 403) { statusEl.textContent = "你不是這個伺服器的成員，不能用真代幣模式"; return; }
        if (!r.ok || !j.token) { statusEl.textContent = "登入失敗，請再試一次（" + (j.error || r.status) + "）"; return; }
        session = { token: j.token, name: j.name }; env.session = session;
      }
      wantReal = true; ws.send(JSON.stringify({ t: "bauth", token: session.token }));
    } catch (e) { statusEl.textContent = "授權沒有完成：" + ((e && (e.message || e.code)) || "未知錯誤"); }
  }
  function onAuthed(m) {
    if (!m.ok) {
      session = null; env.session = null;
      if (wantReal) { wantReal = false; statusEl.textContent = m.error === "bot_down" ? ERR.bot_down : "登入已失效，請重新開啟真代幣模式"; }
      if (real()) setMode("practice");
      return;
    }
    session.name = m.name || session.name;
    if (wantReal) { wantReal = false; setMode("real"); }
  }

  // 每秒更新倒數；有東西剛好成熟就重畫（成熟與否以伺服器為準，這裡只是顯示）
  tick = setInterval(() => {
    if (document.hidden) return;
    const sig = tab === "mine" && st ? sigMine() : tab === "visit" && vis ? sigVisit() : null;
    if (sig == null) return;
    if (sig !== lastSig) { const more = tab === "mine" && (sig.match(/r/g) || []).length > (lastSig.match(/r/g) || []).length; tab === "mine" ? draw() : drawVisit(); if (more) sfx.ripe(); return; }     // 有格子換了狀態才重畫，其他只更新倒數文字（避免按到一半按鈕被換掉）
    body.querySelectorAll("[data-end]").forEach((d) => { const sm = d.querySelector("small"); if (sm) sm.textContent = (d.dataset.pre || "") + fmt(Math.max(0, +d.dataset.end - Date.now())); });
  }, 1000);
  // 每 30 秒重新跟伺服器對一次（別人偷菜、時間誤差）
  const sync = setInterval(() => { if (!document.hidden && ws && ws.readyState === 1) send({ a: tab === "visit" ? (vis ? "visit" : "list") : "get", id: vis && vis.id }); }, 30000);

  draw(); connect();
  return () => { closed = true; clearInterval(tick); clearInterval(sync); try { ws && ws.close(); } catch {} };
}
