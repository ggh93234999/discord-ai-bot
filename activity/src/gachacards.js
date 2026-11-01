// 水墨卡冊：圖鑑＋抽卡（套一：收集）。卡圖與資料在 gacha-art/、gacha-cards.json；抽卡、保底、墨點、升星的規則在伺服器 server/gacha.js。
// 模式和種菜、賭場一樣：練習模式（練習幣、獨立收藏）／真代幣模式（Discord 授權後動用機器人錢包的真代幣）。
import CARDS from "./gacha-cards.json";
import { wsUrl } from "./gomoku.js";
import { sfx } from "./gachasfx.js";
import "@fontsource/lxgw-wenkai-tc/400.css";
import "@fontsource/lxgw-wenkai-tc/700.css";
import "./gachacards.css";

const ART = {};
for (const [p, url] of Object.entries(import.meta.glob("./gacha-art/*.jpg", { eager: true, query: "?url", import: "default" }))) ART[Number(p.split("/").pop().slice(0, -4))] = url;
const MIS_ART = {};
for (const [p, url] of Object.entries(import.meta.glob("./gacha-ui/m_*.jpg", { eager: true, query: "?url", import: "default" }))) MIS_ART[p.split("/").pop().slice(2, -4)] = url;
const mi = (id) => (MIS_ART[id] ? `<img class="gc-mi" src="${MIS_ART[id]}" alt="" draggable="false">` : "");
// 數值小圖示（手繪風單色 SVG）：幣＝方孔錢、墨點＝墨滴、券＝紙券
const I = {
  coin: '<svg class="gc-ico i-coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><rect x="8.5" y="8.5" width="7" height="7"/></svg>',
  ink: '<svg class="gc-ico i-ink" viewBox="0 0 24 24"><path d="M12 2c3.2 5 6.5 8.2 6.5 12.2a6.5 6.5 0 0 1-13 0C5.5 10.200 8.800 7 12 2z"/></svg>',
  tix: '<svg class="gc-ico i-tix" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1"/><path d="M9 6v12" stroke-dasharray="2 2"/></svg>',
};
const BYID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const RAR = ["SSR", "SR", "R", "N"];
const RNAME = { SSR: "傳說", SR: "稀世", R: "珍品", N: "凡品" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n).toLocaleString();
const stars = (n, max = 5) => "★".repeat(n) + "☆".repeat(Math.max(0, max - n));
const ERR = {
  real_off: "真代幣模式還沒開放", no_dup: "重複的卡不夠", bad_slot: "這個隊伍欄位不能用", slot_busy: "這一隊已經出發了", bad_team: "一隊要 1～3 張卡", card_busy: "有卡片已經在別隊出發了", not_done: "還沒完成，不能領取", need_login: "要先登入才能用真代幣模式", bot_down: "機器人暫時連不上，稍後再試", insufficient: "代幣不夠", busy: "上一個動作還在處理，等一下再按",
  no_ticket: "抽卡券不夠", signed: "今天已經簽到過了", not_owned: "你還沒有這張卡", max_star: "已經是最高星級", no_ink: "墨點不夠", already: "這張卡你已經有了", bad_card: "沒有這張卡", error: "發生錯誤，再試一次",
};
const pidOf = () => { try { let p = localStorage.getItem("gcpid"); if (!p) { p = Math.random().toString(36).slice(2, 12); localStorage.setItem("gcpid", p); } return p; } catch { return "x" + Math.random().toString(36).slice(2, 10); } };

export function mountGachaCards(root, { env, back }) {
  let filter = "all", type = "all", set = "all", own = "have", tab = "pull";     // 圖鑑預設只顯示已擁有的，要看沒抽到的得按「未擁有」
  const inSet = (c) => set === "all" || c.set === set;
  root.innerHTML = `
    <div class="game slots gcards">
      <header class="gc-head"><button class="back">← 選單</button><h2 class="gc-title">水墨卡冊<i></i></h2></header>
      <div class="modebar">
        <button class="mode on" data-m="practice">練習模式</button>
        <button class="mode" data-m="real">真代幣模式</button>
      </div>
      <div class="confirm" hidden><div class="ctext"></div><div class="cbtns"><button class="cyes">確定</button><button class="cno">取消</button></div></div>
      <div class="status">連線中…</div>
      <div class="gc-bar"><span>${I.coin}<em class="ballabel">練習幣</em> <b class="bal">--</b></span><span>${I.ink}墨點 <b class="ink">--</b></span><span>${I.tix}抽卡券 <b class="tix">--</b></span></div>
      <div class="gc-tabs gc-main"><button class="tab on" data-tab="pull">抽卡</button><button class="tab" data-tab="disp">派遣</button><button class="tab" data-tab="book">圖鑑</button><button class="tab" data-tab="show">展示</button></div>
      <div class="gc-body"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const statusEl = $(".status"), body = $(".gc-body"), confirmEl = $(".confirm");
  const modeBtns = root.querySelectorAll(".mode");
  $(".back").addEventListener("click", back);

  // ---- 連線
  let needEnter = true;      // 進入練習模式的第一個請求要帶 enter（伺服器據此清空練習收藏），斷線重連不算
  let ws = null, closed = false, retry = 0, wantReal = false, mode = "practice", session = env && env.session || null, st = null;
  const real = () => mode === "real";
  const send = (o) => { if (o.a === "get" && needEnter && !real()) { o = { ...o, enter: true }; needEnter = false; } return ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "gc", real: real(), pid: pidOf(), ...o })); };
  function connect() {
    ws = new WebSocket(wsUrl(env && env.inDiscord));
    ws.onopen = () => { retry = 0; if (session) ws.send(JSON.stringify({ t: "bauth", token: session.token })); send({ a: "get" }); statusEl.textContent = "抽張卡吧"; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "bauthed") return onAuthed(m);
      if (m.t !== "gc") return;
      if (m.a === "view") { st = m; if (m.disp) srvOff = m.disp.now - Date.now(); showBar(); if (!resultOpen && !modalOpen) draw(); else if (modalOpen && refreshModal) refreshModal(); }
      else if (m.a === "pull") showResults(m);
      else if (m.a === "signed") { sfx.sign(); statusEl.textContent = `簽到成功，抽卡券 +${m.tickets}`; }
      else if (m.a === "dauto") { if (dispSel) { dispSel.ids = m.ids.slice(); dprev = m; sfx.place(); if (tab === "disp") drawDisp(); statusEl.textContent = m.ids.length ? "已選出這個任務墨點最多的隊伍" : "沒有可派的卡"; } }
      else if (m.a === "dprev") { dprev = m; if (tab === "disp" && dispSel) drawDisp(); }
      else if (m.a === "dsent") { sfx.send(); dispSel = null; dprev = null; statusEl.textContent = "出發了！"; }
      else if (m.a === "dclaimed") { sfx.claim(); statusEl.textContent = `領回 ${m.ink} 墨點${m.tickets ? `，還拿到抽卡券 +${m.tickets}` : ""}`; }
      else if (m.a === "dcalled") { sfx.recall(); statusEl.textContent = "已召回"; }
      else if (m.a === "salvaged") { sfx.salvage(); statusEl.textContent = `分解了 ${m.count} 張重複卡，墨點 +${m.ink}`; }
      else if (m.a === "upgraded") { sfx.star(); statusEl.textContent = m.dup ? `用 ${m.need} 張重複卡升到 ${m.star} 星了` : `升到 ${m.star} 星了（花 ${m.cost} 墨點）`; }
      else if (m.a === "swapped") { sfx.swap(); if (m.rewards && m.rewards.length) setTimeout(sfx.reward, 600); statusEl.textContent = `兌換成功（花 ${money(m.cost)} 墨點）` + (m.rewards && m.rewards.length ? "，" + m.rewards.map((r) => `${r.text}，抽卡券 +${r.tickets}`).join("；") : ""); }
      else if (m.a === "err") { sfx.err(); statusEl.textContent = ERR[m.error] || ERR.error; if (m.balance != null && st) { st.balance = m.balance; showBar(); } }
    };
    ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }
  function showBar() {
    $(".ballabel").textContent = real() ? "代幣" : "練習幣";
    $(".bal").textContent = st && st.balance != null ? money(st.balance) : "--";
    $(".ink").textContent = st ? money(st.ink) : "--";
    $(".tix").textContent = st ? st.tickets : "--";
  }

  // ---- 抽卡分頁
  const tabs = (el, list, cur, key) => { el.innerHTML = list.map(([v, t]) => `<button class="tab${cur === v ? " on" : ""}" data-${key}="${v}">${t}</button>`).join(""); };
  function drawPull() {
    if (!st) { body.innerHTML = `<p class="mempty">讀取中…</p>`; return; }
    const cur = real() ? "真代幣" : "練習幣";
    const ms = st.milestones.map(([n, t]) => `<span class="gc-ms${st.claimed.includes("m" + n) ? " done" : ""}">${n} 張 → ${I.tix}${t}</span>`).join("");
    const sets = Object.entries(st.sets).map(([s, x]) => `<div class="gc-setrow"><b>${x.name}</b><span class="gc-setbar"><i style="width:${x.have / x.n * 100}%"></i></span><span>${x.have} / ${x.n}</span><em>${st.claimed.includes("s" + s) ? "已領" : `集滿 ${I.tix}` + st.setBonus[s]}</em></div>`).join("");
    body.innerHTML = `
      <div class="gc-pull">
        <div class="gc-big-ink"><b>${st.owned}</b> / ${st.total} 張　<small>累計抽了 ${st.pulls} 次</small></div>
        <div class="gc-btns">
          <button class="gc-one">抽 1 次<small>${money(st.price)} ${cur}</small></button>
          <button class="gc-ten">十連抽<small>${money(st.tenPrice)} ${cur}（九折）</small></button>
          <button class="gc-t1"${st.tickets >= 1 ? "" : " disabled"}>用券抽 1 次<small>${I.tix} ×1</small></button>
          <button class="gc-t10"${st.tickets >= 10 ? "" : " disabled"}>用券十連<small>${I.tix} ×10</small></button>
        </div>
        <button class="gc-sign"${st.canSign ? "" : " disabled"}>${st.canSign ? "每日簽到，領 1 張抽卡券" : "今天已經簽到過了"}</button>
        <details class="gc-rules"><summary>機率與規則</summary>
          <p>機率：SSR ${st.rate.SSR / 10}%、SR ${st.rate.SR / 10}%、R ${st.rate.R / 10}%、N ${st.rate.N / 10}%，每抽都是獨立機率，沒有保底。每天簽到送 1 抽。</p>
          <p>抽到重複的卡會留在收藏裡，到圖鑑可以自己決定要不要分解成墨點（每張：N ${st.dupInk.N}、R ${st.dupInk.R}、SR ${st.dupInk.SR}、SSR ${st.dupInk.SSR}）。墨點可以在圖鑑裡替卡升星（最高 ${st.maxStar} 星），或直接兌換還沒有的卡（N ${st.swap.N}、R ${st.swap.R}、SR ${st.swap.SR}、SSR ${money(st.swap.SSR)}）。</p>
          <p>練習模式和真代幣模式的收藏是分開的；<b>每次進入練習模式，收藏都會清空重來</b>（重新給 10 萬練習幣和 10 抽）。獎勵只發抽卡券和墨點，不會直接發代幣。</p>
        </details>
        <div class="gc-sub">圖鑑獎勵（收集到幾張不同的卡，一次性）</div><div class="gc-mss">${ms}</div>
        <div class="gc-sub">卡組進度</div><div class="gc-sets">${sets}</div>
      </div>`;
    const cost = (n) => `${n === 10 ? st.tenPrice : st.price} ${cur}`;
    const ask = (n) => confirmAsk(`花 ${cost(n)} 抽 ${n === 10 ? "十連" : "1 次"}？${real() ? "（真代幣會被扣）" : ""}`, () => send({ a: "pull", n, pay: "coin" }));
    $(".gc-one").onclick = () => ask(1); $(".gc-ten").onclick = () => ask(10);
    $(".gc-t1").onclick = () => send({ a: "pull", n: 1, pay: "ticket" }); $(".gc-t10").onclick = () => send({ a: "pull", n: 10, pay: "ticket" });
    $(".gc-sign").onclick = () => send({ a: "sign" });
  }

  // ---- 抽卡結果：先放一段「墨氣凝聚」的演出（顏色看這次抽到最好的稀有度），再一張一張翻開，每張下面都有名稱和編號
  let resultOpen = false;
  const GLOW = { SSR: "#f3c64a", SR: "#e0614d", R: "#5fb7a8", N: "#a9a39a" };
  function burst(host, rarity) {
    const n = rarity === "SSR" ? 36 : rarity === "SR" ? 20 : 0;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("i"); s.className = "gc-sp";
      const a = Math.random() * 6.283, d = 40 + Math.random() * (rarity === "SSR" ? 120 : 80);
      s.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--c:${GLOW[rarity]};--s:${3 + Math.random() * 5}px;animation-delay:${Math.random() * 0.15}s`;
      host.append(s); setTimeout(() => s.remove(), 1400);
    }
  }
  function showResults(m) {
    resultOpen = true;
    const res = m.results, many = res.length > 1;
    const best = res.reduce((b, r) => (RAR.indexOf(r.rarity) < RAR.indexOf(b) ? r.rarity : b), "N");
    const newN = res.filter((r) => r.isNew).length, dupN = res.filter((r) => !r.isNew).length;
    sfx.summon(best);
    const el = document.createElement("div");
    el.className = "gc-result";
    root.append(el);
    let timers = [], done = false;
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const close = () => { timers.forEach(clearTimeout); el.remove(); resultOpen = false; draw(); };

    // 第一段：墨氣凝聚
    el.innerHTML = `<div class="gc-summon ${best}"><div class="gc-orb"><i></i><i></i><i></i><b></b></div><div class="gc-stxt">${best === "SSR" ? "天降異象…" : best === "SR" ? "墨氣翻湧…" : "落墨成卡…"}</div><small>點一下跳過</small></div>`;
    const reveal = () => {
      if (done) return; done = true; timers.forEach(clearTimeout); timers = [];
      const cardHtml = (r, i) => {
        const c = BYID[r.id];
        return `<div class="gc-rc2 ${r.rarity}" data-i="${i}">
          <div class="gc-flip"><div class="gc-face gc-back"><span>墨</span></div>
            <div class="gc-face gc-front"><img src="${ART[r.id]}" alt="${esc(c.name)}" draggable="false"><span class="gc-badge ${r.rarity}">${r.rarity}</span>${r.isNew ? `<span class="gc-new">NEW</span>` : `<span class="gc-dup">重複</span>`}</div></div>
          <div class="gc-cap"><b>${esc(c.name)}</b><small>No.${String(r.id).padStart(3, "0")}${many ? "" : "　" + esc(c.type)}</small></div></div>`;
      };
      el.innerHTML = `<div class="gc-rbox ${many ? "many" : "single"}">
        <div class="gc-rtitle">${many ? "十連結果" : "抽到了"}</div><div class="gc-hint2">翻開的卡可以點一下放大</div>
        <div class="gc-rgrid2${many ? "" : " one"}">${res.map(cardHtml).join("")}</div>
        <div class="gc-single"></div>
        <div class="gc-rfoot" hidden>
          <div class="gc-rsum">新卡 ${newN} 張${dupN ? `，重複 ${dupN} 張（留在收藏，到圖鑑決定要不要分解成墨點）` : ""}</div>
          ${m.rewards && m.rewards.length ? `<div class="gc-rrew">${m.rewards.map((r) => `◆ ${esc(r.text)}：抽卡券 +${r.tickets}`).join("<br>")}</div>` : ""}
        </div>
        <div class="gc-rbtns">${many ? `<button class="gc-all">全部翻開</button>` : ""}<button class="gc-rok" hidden>確定</button></div></div>`;
      const box = el.querySelector(".gc-rbox"), cards = [...el.querySelectorAll(".gc-rc2")];
      let shown = 0;
      const flip = (i) => {
        const c = cards[i]; if (!c || c.classList.contains("on")) return;
        c.classList.add("on"); shown++;
        const r = res[i], host = c.querySelector(".gc-flip");
        sfx.flip(); if (!many || r.rarity === "SSR" || r.rarity === "SR") setTimeout(() => sfx.reveal(r.rarity, r.isNew), 140); else if (r.isNew) setTimeout(() => sfx.reveal("N", true), 140);
        if (r.rarity === "SSR" || r.rarity === "SR") { burst(host, r.rarity); c.classList.add("pop"); if (r.rarity === "SSR") { box.classList.add("flash"); setTimeout(() => box.classList.remove("flash"), 700); } }
        if (!many) {
          const cd = BYID[r.id];
          el.querySelector(".gc-single").innerHTML = `<div class="gc-sinfo ${r.rarity}"><div class="gc-sname">${esc(cd.name)}</div><div class="gc-smeta"><span class="gc-badge ${r.rarity}">${r.rarity}・${RNAME[r.rarity]}</span> No.${String(r.id).padStart(3, "0")}　${esc(cd.type)}</div><p>${esc(cd.desc)}</p></div>`;
        }
        if (shown >= res.length) finish();
      };
      const finish = () => { if (m.rewards && m.rewards.length) setTimeout(sfx.reward, 500); el.querySelector(".gc-rfoot").hidden = false; el.querySelector(".gc-rok").hidden = false; const a = el.querySelector(".gc-all"); if (a) a.hidden = true; };
      // 翻開的卡可以點開放大看（◀ ▶ 或左右鍵切換這次抽到的其他卡）
      const zoom = (i0) => {
        let pos = i0;
        const z = document.createElement("div"); z.className = "gc-zoom";
        const showZ = () => {
          const r = res[pos], cd = BYID[r.id];
          z.innerHTML = `<button class="gc-nav gc-zp" aria-label="上一張"${res.length < 2 ? " hidden" : ""}>◀</button>
            <div class="gc-big ${r.rarity}"><img src="${ART[r.id]}" alt="${esc(cd.name)}" draggable="false">
            <div class="gc-info"><div class="gc-ttl"><b>${esc(cd.name)}</b><span class="gc-badge ${r.rarity}">${r.rarity}・${RNAME[r.rarity]}</span></div>
            <div class="gc-meta">${esc(cd.type)}　No.${String(r.id).padStart(3, "0")}　${pos + 1} / ${res.length}　${r.isNew ? "新卡" : "重複，留在收藏（到圖鑑可分解成墨點）"}</div><p>${esc(cd.desc)}</p></div>
            <button class="gc-x" aria-label="關閉">✕</button></div>
            <button class="gc-nav gc-zn" aria-label="下一張"${res.length < 2 ? " hidden" : ""}>▶</button>`;
        };
        const move = (d) => { for (let k = 1; k <= res.length; k++) { const j = (pos + d * k + res.length * k) % res.length; if (cards[j].classList.contains("on")) { pos = j; break; } } showZ(); };
        const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeZ(); } else if (e.key === "ArrowRight") move(1); else if (e.key === "ArrowLeft") move(-1); };
        const closeZ = () => { z.remove(); document.removeEventListener("keydown", onKey, true); };
        document.addEventListener("keydown", onKey, true);
        z.addEventListener("click", (e) => {
          if (e.target.closest(".gc-zp")) move(-1); else if (e.target.closest(".gc-zn")) move(1);
          else if (e.target === z || e.target.closest(".gc-x")) closeZ();
        });
        let x0 = null;
        z.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        z.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1); });
        showZ(); el.append(z);
      };
      cards.forEach((c, i) => c.addEventListener("click", () => { if (c.classList.contains("on")) zoom(i); else flip(i); }));
      const all = el.querySelector(".gc-all");
      if (all) all.onclick = () => { timers.forEach(clearTimeout); cards.forEach((_, i) => flip(i)); };
      el.querySelector(".gc-rok").onclick = close;
      // 自動翻：稀有的留久一點。十連先翻 N、R，最後才翻 SR、SSR 當壓軸。
      const order = res.map((r, i) => i).sort((a, b) => RAR.indexOf(res[b].rarity) - RAR.indexOf(res[a].rarity) || a - b);
      let t = 500;
      for (const i of order) { later(() => flip(i), t); t += res[i].rarity === "SSR" ? 1500 : res[i].rarity === "SR" ? 900 : many ? 280 : 400; }
    };
    el.querySelector(".gc-summon").addEventListener("click", reveal);
    later(reveal, best === "SSR" ? 2300 : best === "SR" ? 1700 : 1100);
  }

  // ---- 圖鑑分頁
  let curList = [];
  function drawBook() {
    const types = [...new Set(CARDS.filter(inSet).map((c) => c.type))];
    if (type !== "all" && !types.includes(type)) type = "all";
    const mine = st ? st.cards : {}, dups = st ? st.dups || {} : {};
    const dupTot = Object.values(dups).reduce((x, y) => x + y, 0), dupInk = Object.entries(dups).reduce((x, [id, n]) => x + n * st.dupInk[BYID[id].rarity], 0);
    const nOwn = CARDS.filter((c) => inSet(c) && mine[c.id]).length, total = CARDS.filter(inSet).length;
    const counts = Object.fromEntries(RAR.map((r) => [r, CARDS.filter((c) => inSet(c) && c.rarity === r).length]));
    body.innerHTML = `
      <div class="gc-hint">已收集 <b>${nOwn}</b> / ${total} 張　${RAR.map((r) => `<b class="gc-r ${r}">${r}</b> ${CARDS.filter((c) => inSet(c) && c.rarity === r && mine[c.id]).length}/${counts[r]}`).join("　")}</div>
      ${dupTot ? `<div class="gc-salvbar">有 <b>${dupTot}</b> 張重複的卡<button class="gc-salvgrid">全部分解成墨點 +${money(dupInk)}</button></div>` : ""}
      <div class="gc-tabs gc-set"></div><div class="gc-tabs gc-own"></div><div class="gc-tabs gc-rar"></div><div class="gc-tabs gc-typ"></div><div class="gc-grid"></div>`;
    tabs(body.querySelector(".gc-set"), [["all", "全部"], ["east", "東方"], ["west", "西方"], ["orig", "原創"], ["whim", "異想"]], set, "s");
    tabs(body.querySelector(".gc-own"), [["have", "已擁有"], ["miss", "未擁有"], ["all", "全部"]], own, "o");
    tabs(body.querySelector(".gc-rar"), [["all", "全部"], ...RAR.map((r) => [r, r])], filter, "r");
    tabs(body.querySelector(".gc-typ"), [["all", "全部類別"], ...types.map((t) => [t, t])], type, "t");
    const list = CARDS.filter((c) => inSet(c) && (filter === "all" || c.rarity === filter) && (type === "all" || c.type === type) && (own === "all" || (own === "have") === !!mine[c.id]))
      .sort((a, b) => RAR.indexOf(a.rarity) - RAR.indexOf(b.rarity) || a.id - b.id);
    curList = list;
    body.querySelector(".gc-grid").innerHTML = list.length ? list.map((c) => `
      <button class="gc-card ${c.rarity}${mine[c.id] ? "" : " lock"}" data-id="${c.id}">
        <img src="${ART[c.id]}" alt="${esc(c.name)}" loading="lazy" draggable="false">
        <span class="gc-badge ${c.rarity}">${c.rarity}</span>${mine[c.id] && dups[c.id] ? `<span class="gc-dupn">×${dups[c.id] + 1}</span>` : ""}${mine[c.id] ? `<span class="gc-star">${"★".repeat(mine[c.id])}</span>` : `<span class="gc-lockt">未擁有</span>`}
        <span class="gc-name">${esc(c.name)}</span>
      </button>`).join("") : `<div class="mempty">${own === "have" && !nOwn ? "還沒有卡，到「抽卡」抽幾張吧" : own === "have" ? "這個條件下還沒有已擁有的卡" : "沒有符合的卡"}</div>`;
  }
  let modalOpen = false, refreshModal = null;
  function detail(id) {                                         // 點開一張卡：可以用 ◀ ▶（或鍵盤左右鍵、左右滑動）切到目前篩選清單裡的上一張／下一張
    let pos = curList.findIndex((x) => x.id === id); if (pos < 0) return;
    const el = document.createElement("div");
    el.className = "gc-modal"; modalOpen = true;
    const close = () => { el.remove(); modalOpen = false; refreshModal = null; document.removeEventListener("keydown", onKey); draw(); };
    const show = () => {
      const c = curList[pos], star = st && st.cards[c.id] || 0;
      const dn = st && st.dups && st.dups[c.id] || 0, per = st ? st.dupInk[c.rarity] : 0;
      const salv = dn ? `<div class="gc-act gc-salv"><div class="gc-dnote">你有 ${dn} 張重複</div><button class="gc-salv1">分解 1 張<small>${I.ink} +${per}</small></button>${dn > 1 ? `<button class="gc-salvall">分解全部 ${dn} 張<small>${I.ink} +${per * dn}</small></button>` : ""}</div>` : "";
      let act = "";
      if (st) {
        if (star) act = star >= st.maxStar ? `<div class="gc-act">已滿星 ★★★★★</div>` : `<div class="gc-act">${dn ? `<button class="gc-updup"${dn >= st.dupStar[star] ? "" : " disabled"}>用 ${st.dupStar[star]} 張重複卡升到 ${star + 1} 星<small>你有 ${dn} 張重複</small></button>` : ""}<button class="gc-up"${st.ink >= st.starBase[c.rarity] * star ? "" : " disabled"}>升到 ${star + 1} 星<small>${I.ink} ${st.starBase[c.rarity] * star}</small></button></div>`;
        else act = `<div class="gc-act"><button class="gc-swap"${st.ink >= st.swap[c.rarity] ? "" : " disabled"}>用墨點兌換<small>${I.ink} ${money(st.swap[c.rarity])}</small></button></div>`;
      }
      el.innerHTML = `<button class="gc-nav gc-prev" aria-label="上一張"${curList.length < 2 ? " hidden" : ""}>◀</button>
        <div class="gc-big ${c.rarity}"><img class="${star ? "" : "gc-blur"}" src="${ART[c.id]}" alt="${esc(c.name)}" draggable="false">
        <div class="gc-info"><div class="gc-ttl"><b>${esc(c.name)}</b><span class="gc-badge ${c.rarity}">${c.rarity}・${RNAME[c.rarity]}</span></div>
        <div class="gc-meta">${esc(c.type)}　No.${String(c.id).padStart(2, "0")}　${pos + 1} / ${curList.length}　${star ? `<span class="gc-stars">${stars(star)}</span>` : "未擁有"}</div><p>${esc(c.desc)}</p>${act}${salv}</div>
        <button class="gc-x" aria-label="關閉">✕</button></div>
        <button class="gc-nav gc-next" aria-label="下一張"${curList.length < 2 ? " hidden" : ""}>▶</button>`;
    };
    refreshModal = show;
    const go = (d) => { pos = (pos + d + curList.length) % curList.length; show(); };
    const onKey = (e) => { if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    show(); root.append(el);
    let x0 = null;
    el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); });
    el.addEventListener("click", (e) => {
      if (e.target.closest(".gc-prev")) go(-1); else if (e.target.closest(".gc-next")) go(1);
      else if (e.target.closest(".gc-updup")) send({ a: "upgrade", id: curList[pos].id, dup: true });
      else if (e.target.closest(".gc-up")) send({ a: "upgrade", id: curList[pos].id });
      else if (e.target.closest(".gc-salv1")) send({ a: "salvage", id: curList[pos].id, n: 1 });
      else if (e.target.closest(".gc-salvall")) { const c = curList[pos]; confirmAsk(`把「${c.name}」的重複卡全部分解成墨點？`, () => send({ a: "salvage", id: c.id })); }
      else if (e.target.closest(".gc-swap")) { const c = curList[pos]; confirmAsk(`用 ${money(st.swap[c.rarity])} 墨點兌換「${c.name}」？`, () => send({ a: "swap", id: c.id })); }
      else if (e.target === el || e.target.closest(".gc-x")) close();
    });
  }
  // ---- 派遣分頁（套二）：把卡派去探險，按真實時間，回來領墨點（長任務有機會拿抽卡券）
  let dispSel = null, dprev = null, srvOff = 0;
  const srvNow = () => Date.now() + srvOff;
  const fmtT = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); if (s < 60) return s + " 秒"; const m = Math.ceil(s / 60); if (m < 60) return m + " 分"; const h = Math.floor(m / 60), r = m % 60; return h + " 小時" + (r ? " " + r + " 分" : ""); };
  const thumb = (id, extra = "") => `<span class="gc-th ${BYID[id].rarity}${extra}"><img src="${ART[id]}" alt="${esc(BYID[id].name)}" draggable="false"></span>`;
  function drawDisp() {
    if (!st || !st.disp) { body.innerHTML = `<p class="mempty">讀取中…</p>`; return; }
    const d = st.disp;
    const now = srvNow(), busy = new Set(d.slots.flatMap((s) => (s ? s.ids : [])));
    const doneN = d.slots.filter((s) => s && s.end <= now).length;
    const mname = (id) => d.missions.find((x) => x.id === id);
    const ZH = ["一", "二", "三", "四"];
    const slots = d.slots.map((s, i) => {
      if (!s) return `<div class="gc-slot idle"><div class="gc-snum">第${ZH[i]}隊</div><div class="gc-idle"><b>待命</b><small>派卡片出去探險，回來領墨點</small></div><button class="gc-go" data-i="${i}">派遣</button></div>`;
      const ms = mname(s.m), left = s.end - now, total = s.end - s.at, ok = left <= 0;
      return `<div class="gc-slot ${ok ? "done" : "run"}"><div class="gc-top"><div class="gc-snum">第${ZH[i]}隊</div>${mi(ms.id)}<div class="gc-tt"><b>${ms.name}</b><small>${ms.hours} 小時・${ms.types.join("／")}加成</small></div></div>
        <div class="gc-ths">${s.ids.map((id) => thumb(id)).join("")}</div>
        <div class="gc-prog" data-end="${s.end}" data-at="${s.at}"><i style="width:${ok ? 100 : Math.max(2, (1 - left / total) * 100)}%"></i><span>${ok ? "完成了" : "剩 " + fmtT(left)}</span></div>
        <div class="gc-sr">預計 ${I.ink} +${s.ink}${s.tick ? `　${I.tix} ${Math.round(s.tick * 100)}% +1` : ""}</div>
        ${ok ? `<button class="gc-claim" data-i="${i}">領取</button>` : `<button class="gc-recall" data-i="${i}">召回（沒有獎勵）</button>`}</div>`;
    }).join("");
    let picker = "";
    if (dispSel) {
      const ms = mname(dispSel.m);
      const mine = Object.keys(st.cards).map(Number).filter((id) => !busy.has(id))
        .sort((a, b) => (ms.types.includes(BYID[b].type) - ms.types.includes(BYID[a].type)) || RAR.indexOf(BYID[a].rarity) - RAR.indexOf(BYID[b].rarity) || a - b);
      picker = `<div class="gc-sheetbg"></div><div class="gc-picker"><div class="gc-ph"><b>第 ${dispSel.slot + 1} 隊：選任務和卡片（最多 ${d.teamMax} 張）</b><button class="gc-auto">自動選最多</button></div>
        <div class="gc-ms2">${d.missions.map((x) => `<button class="gc-mis${x.id === dispSel.m ? " on" : ""}" data-m="${x.id}">${mi(x.id)}<span>${x.name}</span><small>${x.hours} 小時${d.speed > 1 ? `（練習 ${fmtT(x.hours * 3600e3 / d.speed)}）` : ""}・${x.types.join("／")}加成${x.tick ? `・${I.tix}${Math.round(x.tick * 100)}%` : ""}</small></button>`).join("")}</div>
        <div class="gc-team">${Array.from({ length: d.teamMax }, (_, k) => { const id = dispSel.ids[k]; return id ? `<button class="gc-tm on ${BYID[id].rarity}" data-rm="${id}" title="點一下移出隊伍"><img src="${ART[id]}" alt="" draggable="false"><span class="gc-star">${"★".repeat(st.cards[id])}</span></button>` : `<div class="gc-tm"><i>＋</i></div>`; }).join("")}</div>
        <div class="gc-pv">${dprev && dispSel.ids.length ? `預計 ${I.ink} <b>+${dprev.ink}</b>${dprev.tick ? `　${I.tix} ${Math.round(dprev.tick * 100)}% +1` : ""}　類別符合 ${dprev.match} 張${dprev.bond ? "　✓ 同卡組羈絆 +20%" : ""}` : "點下面的卡加入隊伍（類別符合任務的卡墨點 ×1.5，整隊同卡組再 ×1.2）"}</div>
        <div class="gc-pgrid">${mine.length ? mine.map((id) => { const sel = dispSel.ids.includes(id), hit = ms.types.includes(BYID[id].type);
          return `<button class="gc-pc ${BYID[id].rarity}${sel ? " sel" : ""}${hit ? " hit" : ""}" data-id="${id}" title="${esc(BYID[id].name)}"><img src="${ART[id]}" alt="" draggable="false"><span class="gc-badge ${BYID[id].rarity}">${BYID[id].rarity}</span><span class="gc-star">${"★".repeat(st.cards[id])}</span>${sel ? `<span class="gc-chk">✓</span>` : ""}</button>`; }).join("") : `<p class="mempty">沒有可派遣的卡</p>`}</div>
        <div class="gc-pbtns"><button class="gc-send"${dispSel.ids.length ? "" : " disabled"}>出發（${dispSel.ids.length}/${d.teamMax}）</button><button class="gc-pcancel">取消</button></div></div>`;
    }
    body.innerHTML = `<div class="gc-disp">
      <div class="gc-dnote">把卡派出去探險，按真實時間計算，回來領墨點。一張卡同時只能在一隊。${d.speed > 1 ? "<br><b>練習模式時間縮短 60 倍</b>，方便試玩。" : ""}</div>
      ${doneN > 1 ? `<button class="gc-claimall">全部領取（${doneN} 隊完成）</button>` : ""}
      <div class="gc-slots">${slots}</div>${picker}</div>`;
  }
  function askPrev() { if (dispSel && dispSel.ids.length) send({ a: "dprev", ids: dispSel.ids, m: dispSel.m }); else { dprev = null; } }
  function dispClick(e) {
    const t = e.target;
    const go = t.closest(".gc-go"); if (go) { dispSel = { slot: Number(go.dataset.i), m: "forest", ids: [] }; dprev = null; drawDisp(); return true; }
    const mis = t.closest(".gc-mis"); if (mis && dispSel) { dispSel.m = mis.dataset.m; askPrev(); drawDisp(); return true; }
    const rm = t.closest("[data-rm]"); if (rm && dispSel) { dispSel.ids = dispSel.ids.filter((x) => x !== Number(rm.dataset.rm)); askPrev(); drawDisp(); return true; }
    if (t.closest(".gc-sheetbg") && dispSel) { dispSel = null; dprev = null; drawDisp(); return true; }
    const pc = t.closest(".gc-pc"); if (pc && dispSel) {
      const id = Number(pc.dataset.id), k = dispSel.ids.indexOf(id);
      if (k >= 0) dispSel.ids.splice(k, 1); else if (dispSel.ids.length < st.disp.teamMax) dispSel.ids.push(id); else { statusEl.textContent = `一隊最多 ${st.disp.teamMax} 張`; return true; }
      askPrev(); drawDisp(); return true;
    }
    if (t.closest(".gc-auto") && dispSel) { send({ a: "dauto", m: dispSel.m }); return true; }
    if (t.closest(".gc-pcancel")) { dispSel = null; dprev = null; drawDisp(); return true; }
    if (t.closest(".gc-send") && dispSel && dispSel.ids.length) { send({ a: "dsend", slot: dispSel.slot, ids: dispSel.ids, m: dispSel.m }); return true; }
    const cl = t.closest(".gc-claim"); if (cl) { send({ a: "dclaim", slot: Number(cl.dataset.i) }); return true; }
    if (t.closest(".gc-claimall")) { send({ a: "dclaim", slot: "all" }); return true; }
    const rc = t.closest(".gc-recall"); if (rc) { confirmAsk("中途召回這一隊？不會拿到任何獎勵。", () => send({ a: "dcall", slot: Number(rc.dataset.i) })); return true; }
    return false;
  }
  const dispTick = setInterval(() => {
    if (document.hidden || tab !== "disp" || !st || !st.disp) return;
    const now = srvNow(); let finished = false;
    body.querySelectorAll(".gc-prog").forEach((p) => {
      const end = Number(p.dataset.end), at = Number(p.dataset.at), left = end - now;
      if (left <= 0) { if (!p.closest(".done")) finished = true; return; }
      p.querySelector("i").style.width = Math.max(2, (1 - left / (end - at)) * 100) + "%"; p.querySelector("span").textContent = "剩 " + fmtT(left);
    });
    if (finished && !resultOpen && !modalOpen) drawDisp();
  }, 1000);

  let pickSlot = null;
  function drawShow() {
    const mine = st ? st.cards : {}, sh = st && st.show || [null, null, null];
    const slot = (id, i) => id && mine[id] && BYID[id] ? `<button class="gc-sh on ${BYID[id].rarity}" data-sl="${i}" data-view="${id}"><span class="gc-swp" data-sl="${i}">換</span><img src="${ART[id]}" alt="" draggable="false"><span class="gc-badge ${BYID[id].rarity}">${BYID[id].rarity}</span><span class="gc-star">${"★".repeat(mine[id])}</span><span class="gc-name">${esc(BYID[id].name)}</span></button>` : `<button class="gc-sh" data-sl="${i}"><i>＋</i><span>選一張</span></button>`;
    body.innerHTML = `
      <div class="gc-hint">挑 3 張你最喜歡的卡擺在展示櫃，點已擺的卡可以放大看（也能升星），點右上角「換」更換或拿下來。${real() ? "真代幣模式的展示櫃會上名卡榜。" : "練習模式每次進來展示櫃都會清空。"}</div>
      <div class="gc-shelf">${sh.map(slot).join("")}</div>
      ${pickSlot !== null ? `<div class="gc-pick"><div class="gc-hint">選一張放進第 ${pickSlot + 1} 格${sh[pickSlot] ? `　<button class="gc-unshow">拿下來</button>` : ""}　<button class="gc-pickx">取消</button></div><div class="gc-grid">${CARDS.filter((c) => mine[c.id]).sort((a, b) => RAR.indexOf(a.rarity) - RAR.indexOf(b.rarity) || a.id - b.id).map((c) => `<button class="gc-card ${c.rarity}" data-pk="${c.id}"><img src="${ART[c.id]}" alt="" loading="lazy" draggable="false"><span class="gc-badge ${c.rarity}">${c.rarity}</span><span class="gc-star">${"★".repeat(mine[c.id])}</span><span class="gc-name">${esc(c.name)}</span></button>`).join("") || `<div class="mempty">還沒有卡，先去抽幾張吧</div>`}</div></div>` : ""}
      <div class="gc-hint">展示的卡會依「展示分」（稀有度分 × 星數）排進選單裡的「名卡榜」，N 1・R 3・SR 12・SSR 40 分，升星分數更高。</div>`;
  }
  function draw() { if (tab === "pull") drawPull(); else if (tab === "disp") drawDisp(); else if (tab === "show") drawShow(); else drawBook(); }

  root.addEventListener("click", (e) => {
    sfx.unlock(); if (e.target.closest("button") && !e.target.closest(".gc-main [data-tab]")) sfx.tap();
    if (tab === "disp" && dispClick(e)) return;
    if (tab === "show") {
      const sl = e.target.closest("[data-sl]"), pk = e.target.closest("[data-pk]");
      if (pk) { sfx.place(); send({ a: "show", slot: pickSlot, id: Number(pk.dataset.pk) }); pickSlot = null; return; }
      if (e.target.closest(".gc-unshow")) { sfx.take(); send({ a: "show", slot: pickSlot, id: null }); pickSlot = null; return; }
      if (e.target.closest(".gc-pickx")) { pickSlot = null; drawShow(); return; }
      const sw = e.target.closest(".gc-swp"), vw = e.target.closest("[data-view]");
      if (vw && !sw) { curList = (st && st.show || []).filter((x) => x && st.cards[x]).map((x) => BYID[x]); detail(Number(vw.dataset.view)); return; }
      if (sl && sl.closest(".gc-shelf") && !sl.closest(".sm") && sl.dataset.sl !== undefined) { pickSlot = Number(sl.dataset.sl); drawShow(); return; }
    }
    const mt = e.target.closest(".gc-main [data-tab]");
    if (mt) { sfx.tab(); tab = mt.dataset.tab; root.querySelectorAll(".gc-main .tab").forEach((x) => x.classList.toggle("on", x === mt)); draw(); return; }
    const t = e.target.closest("[data-r],[data-t],[data-s],[data-o]");
    if (t && t.closest(".gc-tabs") && !t.closest(".gc-main")) { if (t.dataset.r !== undefined) filter = t.dataset.r; if (t.dataset.t !== undefined) type = t.dataset.t; if (t.dataset.s !== undefined) set = t.dataset.s; if (t.dataset.o !== undefined) own = t.dataset.o; drawBook(); return; }
    if (e.target.closest(".gc-salvgrid")) { const d = st && st.dups || {}, n = Object.values(d).reduce((x, y) => x + y, 0); confirmAsk(`把全部 ${n} 張重複的卡分解成墨點？`, () => send({ a: "salvage", id: "all" })); return; }
    const c = e.target.closest(".gc-card"); if (c) detail(Number(c.dataset.id));
  });

  // ---- 模式切換／登入（和種菜相同）
  function confirmAsk(text, onYes) {
    confirmEl.hidden = false; $(".ctext").textContent = text;
    $(".cyes").onclick = () => { confirmEl.hidden = true; onYes(); };
    $(".cno").onclick = () => { confirmEl.hidden = true; statusEl.textContent = "已取消"; };
  }
  function setMode(m) {
    mode = m; modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.m === m)); root.querySelector(".gcards").classList.toggle("realmode", m === "real");
    st = null; pickSlot = null; dispSel = null; dprev = null; if (m === "practice") needEnter = true; draw(); showBar(); send({ a: "get" });
    statusEl.textContent = m === "real" ? `真代幣模式：${session ? session.name : ""}，抽卡會扣真代幣！` : "練習模式：收藏獨立，用練習幣";
  }
  modeBtns.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.m === "practice") { if (real()) setMode("practice"); return; }
    if (real()) return;
    if (!env || !env.inDiscord || !env.sdk) { statusEl.textContent = "真代幣模式要在 Discord 裡開啟這個 Activity 才能用（要確認你的 Discord 身分）"; return; }
    confirmAsk("真代幣模式抽卡會扣你在機器人那邊的真代幣。收藏和練習模式是分開的。要開啟嗎？（第一次會跳出 Discord 授權視窗）", login);
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
      session = null; if (env) env.session = null;
      if (wantReal) { wantReal = false; statusEl.textContent = m.error === "bot_down" ? ERR.bot_down : "登入已失效，請重新開啟真代幣模式"; }
      if (real()) setMode("practice");
      return;
    }
    session.name = m.name || session.name;
    if (wantReal) { wantReal = false; setMode("real"); }
  }

  draw(); connect();
  return () => { closed = true; clearInterval(dispTick); try { ws && ws.close(); } catch {} root.innerHTML = ""; };
}
