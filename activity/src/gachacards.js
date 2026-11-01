// 水墨卡冊：圖鑑＋抽卡（套一：收集）。卡圖與資料在 gacha-art/、gacha-cards.json；抽卡、保底、墨點、升星的規則在伺服器 server/gacha.js。
// 模式和種菜、賭場一樣：練習模式（練習幣、獨立收藏）／真代幣模式（Discord 授權後動用機器人錢包的真代幣）。
import CARDS from "./gacha-cards.json";
import { wsUrl } from "./gomoku.js";

const ART = {};
for (const [p, url] of Object.entries(import.meta.glob("./gacha-art/*.jpg", { eager: true, query: "?url", import: "default" }))) ART[Number(p.split("/").pop().slice(0, -4))] = url;
const BYID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const RAR = ["SSR", "SR", "R", "N"];
const RNAME = { SSR: "傳說", SR: "稀世", R: "珍品", N: "凡品" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n).toLocaleString();
const stars = (n, max = 5) => "★".repeat(n) + "☆".repeat(Math.max(0, max - n));
const ERR = {
  real_off: "真代幣模式還沒開放", need_login: "要先登入才能用真代幣模式", bot_down: "機器人暫時連不上，稍後再試", insufficient: "代幣不夠", busy: "上一個動作還在處理，等一下再按",
  no_ticket: "抽卡券不夠", signed: "今天已經簽到過了", not_owned: "你還沒有這張卡", max_star: "已經是最高星級", no_ink: "墨點不夠", already: "這張卡你已經有了", bad_card: "沒有這張卡", error: "發生錯誤，再試一次",
};
const pidOf = () => { try { let p = localStorage.getItem("gcpid"); if (!p) { p = Math.random().toString(36).slice(2, 12); localStorage.setItem("gcpid", p); } return p; } catch { return "x" + Math.random().toString(36).slice(2, 10); } };

export function mountGachaCards(root, { env, back }) {
  let filter = "all", type = "all", set = "all", own = "all", tab = "pull";
  const inSet = (c) => set === "all" || c.set === set;
  root.innerHTML = `
    <div class="game slots gcards">
      <header><button class="back">← 選單</button><h2>🎴 水墨卡冊</h2><span></span></header>
      <div class="modebar">
        <button class="mode on" data-m="practice">🎮 練習模式</button>
        <button class="mode" data-m="real">💰 真代幣模式</button>
      </div>
      <div class="confirm" hidden><div class="ctext"></div><div class="cbtns"><button class="cyes">確定</button><button class="cno">取消</button></div></div>
      <div class="status">連線中…</div>
      <div class="gc-bar"><span>💰 <em class="ballabel">練習幣</em> <b class="bal">--</b></span><span>🖋️ 墨點 <b class="ink">--</b></span><span>🎟️ 抽卡券 <b class="tix">--</b></span></div>
      <div class="gc-tabs gc-main"><button class="tab on" data-tab="pull">🎴 抽卡</button><button class="tab" data-tab="book">📖 圖鑑</button></div>
      <div class="gc-body"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const statusEl = $(".status"), body = $(".gc-body"), confirmEl = $(".confirm");
  const modeBtns = root.querySelectorAll(".mode");
  $(".back").addEventListener("click", back);

  // ---- 連線
  let ws = null, closed = false, retry = 0, wantReal = false, mode = "practice", session = env && env.session || null, st = null;
  const real = () => mode === "real";
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "gc", real: real(), pid: pidOf(), ...o }));
  function connect() {
    ws = new WebSocket(wsUrl(env && env.inDiscord));
    ws.onopen = () => { retry = 0; if (session) ws.send(JSON.stringify({ t: "bauth", token: session.token })); send({ a: "get" }); statusEl.textContent = "抽張卡吧"; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "bauthed") return onAuthed(m);
      if (m.t !== "gc") return;
      if (m.a === "view") { st = m; showBar(); if (!resultOpen && !modalOpen) draw(); else if (modalOpen && refreshModal) refreshModal(); }
      else if (m.a === "pull") showResults(m);
      else if (m.a === "signed") statusEl.textContent = `簽到成功，抽卡券 +${m.tickets}`;
      else if (m.a === "upgraded") statusEl.textContent = `升到 ${m.star} 星了（花 ${m.cost} 墨點）`;
      else if (m.a === "swapped") { statusEl.textContent = `兌換成功（花 ${money(m.cost)} 墨點）` + (m.rewards && m.rewards.length ? "，" + m.rewards.map((r) => `${r.text}，抽卡券 +${r.tickets}`).join("；") : ""); }
      else if (m.a === "err") { statusEl.textContent = ERR[m.error] || ERR.error; if (m.balance != null && st) { st.balance = m.balance; showBar(); } }
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
    const bar = (v, max, cls) => `<div class="gc-pity ${cls}"><i style="width:${Math.min(100, v / max * 100)}%"></i><span>${v} / ${max}</span></div>`;
    const ms = st.milestones.map(([n, t]) => `<span class="gc-ms${st.claimed.includes("m" + n) ? " done" : ""}">${n} 張 → 🎟️${t}</span>`).join("");
    const sets = Object.entries(st.sets).map(([s, x]) => `<div class="gc-setrow"><b>${x.name}</b><span class="gc-setbar"><i style="width:${x.have / x.n * 100}%"></i></span><span>${x.have} / ${x.n}</span><em>${st.claimed.includes("s" + s) ? "已領" : "集滿 🎟️" + st.setBonus[s]}</em></div>`).join("");
    body.innerHTML = `
      <div class="gc-pull">
        <div class="gc-big-ink"><b>${st.owned}</b> / ${st.total} 張　<small>累計抽了 ${st.pulls} 次</small></div>
        <div class="gc-pt"><span>距離 SSR 保底</span>${bar(st.pity.ssr, st.pity.ssrMax, "ssr")}</div>
        <div class="gc-pt"><span>距離 SR 以上保底</span>${bar(st.pity.sr, st.pity.srMax, "sr")}</div>
        <div class="gc-btns">
          <button class="gc-one">抽 1 次<small>${money(st.price)} ${cur}</small></button>
          <button class="gc-ten">十連抽<small>${money(st.tenPrice)} ${cur}（九折）</small></button>
          <button class="gc-t1"${st.tickets >= 1 ? "" : " disabled"}>用券抽 1 次<small>🎟️ ×1</small></button>
          <button class="gc-t10"${st.tickets >= 10 ? "" : " disabled"}>用券十連<small>🎟️ ×10</small></button>
        </div>
        <button class="gc-sign"${st.canSign ? "" : " disabled"}>${st.canSign ? "📅 每日簽到，領 1 張抽卡券" : "📅 今天簽到過了"}</button>
        <details class="gc-rules"><summary>機率與規則</summary>
          <p>基礎機率：SSR ${st.rate.SSR / 10}%、SR ${st.rate.SR / 10}%、R ${st.rate.R / 10}%、N ${st.rate.N / 10}%（算上保底後實際 SSR 約 2.7%）。連續 ${st.pity.ssrMax} 抽沒出 SSR，第 ${st.pity.ssrMax} 抽一定是 SSR；連續 ${st.pity.srMax - 1} 抽都是 R 以下，第 ${st.pity.srMax} 抽一定是 SR 以上。</p>
          <p>抽到重複的卡會轉成墨點：N ${st.dupInk.N}、R ${st.dupInk.R}、SR ${st.dupInk.SR}、SSR ${st.dupInk.SSR}。墨點可以在圖鑑裡替卡升星（最高 ${st.maxStar} 星），或直接兌換還沒有的卡（N ${st.swap.N}、R ${st.swap.R}、SR ${st.swap.SR}、SSR ${money(st.swap.SSR)}）。</p>
          <p>練習模式和真代幣模式的收藏是分開的。獎勵只發抽卡券和墨點，不會直接發代幣。</p>
        </details>
        <div class="gc-sub">🏆 圖鑑獎勵（收集到幾張不同的卡，一次性）</div><div class="gc-mss">${ms}</div>
        <div class="gc-sub">📚 卡組進度</div><div class="gc-sets">${sets}</div>
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
    const newN = res.filter((r) => r.isNew).length, ink = res.reduce((s, r) => s + r.ink, 0);
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
            <div class="gc-face gc-front"><img src="${ART[r.id]}" alt="${esc(c.name)}" draggable="false"><span class="gc-badge ${r.rarity}">${r.rarity}</span>${r.isNew ? `<span class="gc-new">NEW</span>` : `<span class="gc-dup">重複 +${r.ink} 墨</span>`}</div></div>
          <div class="gc-cap"><b>${esc(c.name)}</b><small>No.${String(r.id).padStart(3, "0")}${many ? "" : "　" + esc(c.type)}</small></div></div>`;
      };
      el.innerHTML = `<div class="gc-rbox ${many ? "many" : "single"}">
        <div class="gc-rtitle">${many ? "十連結果" : "抽到了"}</div>
        <div class="gc-rgrid2${many ? "" : " one"}">${res.map(cardHtml).join("")}</div>
        <div class="gc-single"></div>
        <div class="gc-rfoot" hidden>
          <div class="gc-rsum">新卡 ${newN} 張${ink ? `，重複轉成墨點 +${ink}` : ""}</div>
          ${m.rewards && m.rewards.length ? `<div class="gc-rrew">${m.rewards.map((r) => `🏆 ${esc(r.text)}：抽卡券 +${r.tickets}`).join("<br>")}</div>` : ""}
        </div>
        <div class="gc-rbtns">${many ? `<button class="gc-all">全部翻開</button>` : ""}<button class="gc-rok" hidden>確定</button></div></div>`;
      const box = el.querySelector(".gc-rbox"), cards = [...el.querySelectorAll(".gc-rc2")];
      let shown = 0;
      const flip = (i) => {
        const c = cards[i]; if (!c || c.classList.contains("on")) return;
        c.classList.add("on"); shown++;
        const r = res[i], host = c.querySelector(".gc-flip");
        if (r.rarity === "SSR" || r.rarity === "SR") { burst(host, r.rarity); c.classList.add("pop"); if (r.rarity === "SSR") { box.classList.add("flash"); setTimeout(() => box.classList.remove("flash"), 700); } }
        if (!many) {
          const cd = BYID[r.id];
          el.querySelector(".gc-single").innerHTML = `<div class="gc-sinfo ${r.rarity}"><div class="gc-sname">${esc(cd.name)}</div><div class="gc-smeta"><span class="gc-badge ${r.rarity}">${r.rarity}・${RNAME[r.rarity]}</span> No.${String(r.id).padStart(3, "0")}　${esc(cd.type)}</div><p>${esc(cd.desc)}</p></div>`;
        }
        if (shown >= res.length) finish();
      };
      const finish = () => { el.querySelector(".gc-rfoot").hidden = false; el.querySelector(".gc-rok").hidden = false; const a = el.querySelector(".gc-all"); if (a) a.hidden = true; };
      cards.forEach((c, i) => c.addEventListener("click", () => flip(i)));
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
    const mine = st ? st.cards : {};
    const nOwn = CARDS.filter((c) => inSet(c) && mine[c.id]).length, total = CARDS.filter(inSet).length;
    const counts = Object.fromEntries(RAR.map((r) => [r, CARDS.filter((c) => inSet(c) && c.rarity === r).length]));
    body.innerHTML = `
      <div class="gc-hint">已收集 <b>${nOwn}</b> / ${total} 張　${RAR.map((r) => `<b class="gc-r ${r}">${r}</b> ${CARDS.filter((c) => inSet(c) && c.rarity === r && mine[c.id]).length}/${counts[r]}`).join("　")}</div>
      <div class="gc-tabs gc-set"></div><div class="gc-tabs gc-own"></div><div class="gc-tabs gc-rar"></div><div class="gc-tabs gc-typ"></div><div class="gc-grid"></div>`;
    tabs(body.querySelector(".gc-set"), [["all", "全部"], ["east", "東方"], ["west", "西方"], ["orig", "原創"], ["whim", "異想"]], set, "s");
    tabs(body.querySelector(".gc-own"), [["all", "全部"], ["have", "已擁有"], ["miss", "未擁有"]], own, "o");
    tabs(body.querySelector(".gc-rar"), [["all", "全部"], ...RAR.map((r) => [r, r])], filter, "r");
    tabs(body.querySelector(".gc-typ"), [["all", "全部類別"], ...types.map((t) => [t, t])], type, "t");
    const list = CARDS.filter((c) => inSet(c) && (filter === "all" || c.rarity === filter) && (type === "all" || c.type === type) && (own === "all" || (own === "have") === !!mine[c.id]))
      .sort((a, b) => RAR.indexOf(a.rarity) - RAR.indexOf(b.rarity) || a.id - b.id);
    curList = list;
    body.querySelector(".gc-grid").innerHTML = list.length ? list.map((c) => `
      <button class="gc-card ${c.rarity}${mine[c.id] ? "" : " lock"}" data-id="${c.id}">
        <img src="${ART[c.id]}" alt="${esc(c.name)}" loading="lazy" draggable="false">
        <span class="gc-badge ${c.rarity}">${c.rarity}</span>${mine[c.id] ? `<span class="gc-star">${"★".repeat(mine[c.id])}</span>` : `<span class="gc-lockt">未擁有</span>`}
        <span class="gc-name">${esc(c.name)}</span>
      </button>`).join("") : `<div class="mempty">沒有符合的卡</div>`;
  }
  let modalOpen = false, refreshModal = null;
  function detail(id) {                                         // 點開一張卡：可以用 ◀ ▶（或鍵盤左右鍵、左右滑動）切到目前篩選清單裡的上一張／下一張
    let pos = curList.findIndex((x) => x.id === id); if (pos < 0) return;
    const el = document.createElement("div");
    el.className = "gc-modal"; modalOpen = true;
    const close = () => { el.remove(); modalOpen = false; refreshModal = null; document.removeEventListener("keydown", onKey); drawBook(); };
    const show = () => {
      const c = curList[pos], star = st && st.cards[c.id] || 0;
      let act = "";
      if (st) {
        if (star) act = star >= st.maxStar ? `<div class="gc-act">已滿星 ★★★★★</div>` : `<div class="gc-act"><button class="gc-up"${st.ink >= st.starBase[c.rarity] * star ? "" : " disabled"}>升到 ${star + 1} 星<small>🖋️ ${st.starBase[c.rarity] * star}</small></button></div>`;
        else act = `<div class="gc-act"><button class="gc-swap"${st.ink >= st.swap[c.rarity] ? "" : " disabled"}>用墨點兌換<small>🖋️ ${money(st.swap[c.rarity])}</small></button></div>`;
      }
      el.innerHTML = `<button class="gc-nav gc-prev" aria-label="上一張"${curList.length < 2 ? " hidden" : ""}>◀</button>
        <div class="gc-big ${c.rarity}"><img src="${ART[c.id]}" alt="${esc(c.name)}" draggable="false">
        <div class="gc-info"><div class="gc-ttl"><b>${esc(c.name)}</b><span class="gc-badge ${c.rarity}">${c.rarity}・${RNAME[c.rarity]}</span></div>
        <div class="gc-meta">${esc(c.type)}　No.${String(c.id).padStart(2, "0")}　${pos + 1} / ${curList.length}　${star ? `<span class="gc-stars">${stars(star)}</span>` : "未擁有"}</div><p>${esc(c.desc)}</p>${act}</div>
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
      else if (e.target.closest(".gc-up")) send({ a: "upgrade", id: curList[pos].id });
      else if (e.target.closest(".gc-swap")) { const c = curList[pos]; confirmAsk(`用 ${money(st.swap[c.rarity])} 墨點兌換「${c.name}」？`, () => send({ a: "swap", id: c.id })); }
      else if (e.target === el || e.target.closest(".gc-x")) close();
    });
  }
  function draw() { if (tab === "pull") drawPull(); else drawBook(); }

  root.addEventListener("click", (e) => {
    const mt = e.target.closest(".gc-main [data-tab]");
    if (mt) { tab = mt.dataset.tab; root.querySelectorAll(".gc-main .tab").forEach((x) => x.classList.toggle("on", x === mt)); draw(); return; }
    const t = e.target.closest("[data-r],[data-t],[data-s],[data-o]");
    if (t && t.closest(".gc-tabs") && !t.closest(".gc-main")) { if (t.dataset.r !== undefined) filter = t.dataset.r; if (t.dataset.t !== undefined) type = t.dataset.t; if (t.dataset.s !== undefined) set = t.dataset.s; if (t.dataset.o !== undefined) own = t.dataset.o; drawBook(); return; }
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
    st = null; draw(); showBar(); send({ a: "get" });
    statusEl.textContent = m === "real" ? `真代幣模式：${session ? session.name : ""}，抽卡會扣真代幣！` : "練習模式：收藏獨立，用練習幣";
  }
  modeBtns.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.m === "practice") { if (real()) setMode("practice"); return; }
    if (real()) return;
    statusEl.textContent = ERR.real_off; return;
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
  return () => { closed = true; try { ws && ws.close(); } catch {} root.innerHTML = ""; };
}
