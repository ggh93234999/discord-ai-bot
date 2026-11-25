// 配電腦：原價屋＋欣亞價格對照、相容性檢查、依預算自動推薦、價格歷史。
// 資料來自伺服器 /api/pc/data（定時抓取，同款已配對）；規則共用 shared/pcrules.js。
import "./pcbuild.css";
import { pim, wirePim } from "./pcimg.js";
import { CAT_LIST, SLOT_LIST, EXTRA_SSD, slotCat, CAT_NAME, USE_NAME, priceOf, cheaper, check, fits, needWatts, estWatts, recommend, totals } from "../shared/pcrules.js";

import { pcIcon, PC_TXT } from "./pcicons.js";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const MODES = { min: "兩家混搭最省", c: "只買原價屋", s: "只買欣亞" };

export function mountPcBuild(root, { env, back }) {
  root.innerHTML = `
    <div class="game pcb">
      <header><button class="back">← 選單</button><h2>配電腦</h2><span class="hdr"><span class="pcb-ts"></span></span></header>
      <div class="pcb-body">
        <div class="pcb-status">載入價格中…</div>
        <section class="pcb-rec" hidden>
          <h3>依預算自動配</h3>
          <div class="pcb-recrow">
            <label>預算 <input class="pcb-budget" type="number" inputmode="numeric" min="10000" step="1000" placeholder="例如 40000"></label>
            <label>用途 <select class="pcb-use"><option value="game">遊戲</option><option value="office">文書／上網</option><option value="create">剪片／繪圖</option></select></label>
          </div>
          <label class="pcb-keep"><input type="checkbox" class="pcb-keepcb" checked> 保留我自己選的零件，只配其他的</label>
          <button class="pcb-go">幫我配</button>
          <div class="pcb-saved"><button class="pcb-savedbtn">📋 最近的配單（點一下直接載入）</button><div class="pcb-savedlist" hidden></div></div>
          <div class="pcb-load"><input class="pcb-code" maxlength="6" placeholder="配單代碼（bot 給的）" autocapitalize="characters"><button class="pcb-loadbtn">載入</button></div>
          <p class="note">做法：先把預算扣掉你選好的零件，剩下的依用途分配（遊戲偏顯卡、文書偏 CPU 與硬碟），每類挑預算內最好的，並確保腳位、DDR、機殼、電源互相相容；剩的錢再拿去升級顯卡（文書機升級 CPU）。標「自動配」的零件下次按會重配，你自己選的會留著。</p>
        </section>
        <section class="pcb-slots" hidden></section>
        <section class="pcb-sum" hidden></section>
      </div>
      <div class="pcb-pick" hidden></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  $(".back").addEventListener("click", back);
  const url = (p) => { if (env.inDiscord) return `/.proxy/${p}`; const u = new URL(p, location.href); return u.pathname + u.search; };

  let data = null, sel = {}, auto = new Set(ls.get("pcb_auto", [])), mode = ls.get("pcb_mode", "min");
  if (!MODES[mode]) mode = "min";
  const saveSel = () => { for (const c of [...auto]) if (!sel[c]) auto.delete(c); ls.set("pcb_auto", [...auto]); ls.set("pcb_sel", Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.id]))); };
  const findPart = (cat, id) => (data.parts[cat] || []).find((p) => p.id === id);
  const partImg = (p, cls = "") => pim(url, [p.s && p.s.id, p.c && p.c.id], p.name, cls);
  wirePim(root, url);

  async function load() {
    try {
      const r = await fetch(url("api/pc/data"));
      if (r.status === 503) { $(".pcb-status").textContent = "伺服器正在第一次抓價格，約 2 分鐘後再進來"; return; }
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    } catch { $(".pcb-status").textContent = "價格資料載入失敗，晚點再試"; return; }
    const saved = ls.get("pcb_sel", {});
    for (const cat of SLOT_LIST) if (saved[cat]) { const p = findPart(slotCat(cat), saved[cat]); if (p) sel[cat] = p; }
    $(".pcb-status").hidden = true;
    for (const s of ["pcb-rec", "pcb-slots", "pcb-sum"]) $("." + s).hidden = false;
    $(".pcb-budget").value = ls.get("pcb_budget", "");
    $(".pcb-use").value = ls.get("pcb_use", "game");
    const d = new Date(Math.min(data.cool || 1e12, data.sinya || 1e12) * 1000);
    $(".pcb-ts").textContent = `價格 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    render();
    const qc = new URLSearchParams(location.search).get("pc");
    if (qc) loadCode(qc);
  }

  const priceCell = (p) => {
    const ch = cheaper(p);
    const c = p.c ? `<span class="pc ${ch === "c" ? "low" : ""}"><i>原</i>${money(p.c.p)}</span>` : `<span class="pc none"><i>原</i>無</span>`;
    const s = p.s ? `<span class="pc ${ch === "s" ? "low" : ""}"><i>欣</i>${money(p.s.p)}</span>` : `<span class="pc none"><i>欣</i>無</span>`;
    return c + s;
  };

  // 儲存配單：把目前選的存成配單編號（內容一樣的不會重複存）；改了零件後按鈕會變回「儲存配單」
  let savedKey = "", savedCode = "";
  const curKey = () => JSON.stringify(Object.entries(sel).map(([k, v]) => [k, v.id]).sort());
  async function saveOrder(btn) {
    if (!Object.keys(sel).length) return;
    btn.disabled = true; btn.textContent = "儲存中…";
    try {
      const j = await (await fetch(url("api/pc/share?ids=" + encodeURIComponent(JSON.stringify(Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.id]))))))).json();
      if (!j.code) throw new Error(j.err || "fail");
      savedKey = curKey(); savedCode = j.code;
    } catch { btn.textContent = "儲存失敗，再試一次"; btn.disabled = false; return; }
    renderSum();
  }
  const addRow = (k) => `<div class="slot empty addssd" data-cat="${k}"><span class="si">💿</span><span class="sn">＋ 再加一顆硬碟</span><button class="pick" data-cat="${k}">選擇</button></div>`;
  function render() {
    const slotKeys = CAT_LIST.flatMap((c) => (c === "ssd" ? ["ssd", ...EXTRA_SSD.filter((k) => sel[k])] : [c]));
    const addSsd = sel.ssd ? EXTRA_SSD.find((k) => !sel[k]) : null;       // 還能再加一顆硬碟
    const slots = slotKeys.map((cat) => {
      const p = sel[cat];
      if (!p) return `<div class="slot empty" data-cat="${cat}"><span class="si">${pcIcon(cat)}</span><span class="sn">${CAT_NAME[cat]}</span><button class="pick" data-cat="${cat}">選擇</button></div>`;
      const w = p.c && p.s && p.c.p !== p.s.p ? `（差 ${money(Math.abs(p.c.p - p.s.p))}）` : "";
      return `<div class="slot" data-cat="${cat}"><span class="si">${pcIcon(cat)}</span>${partImg(p, "sl")}
        <div class="sb"><div class="sc">${CAT_NAME[cat]}${auto.has(cat) ? "<em class=\"auto\">自動配</em>" : ""}${p.c && p.s ? `<em class="both">兩家都有${w}</em>` : p.c ? "<em>只有原價屋</em>" : "<em>只有欣亞</em>"}</div>
        <div class="sname">${esc(p.name)}</div><div class="prices">${priceCell(p)}</div></div>
        <div class="sact"><button class="pick" data-cat="${cat}">換</button><button class="trend" data-id="${p.id}" data-cat="${cat}" title="價格走勢">📈</button><button class="del" data-cat="${cat}" title="移除">✕</button></div></div>`;
    }).map((h, i) => (slotKeys[i] === "ssd" || EXTRA_SSD.includes(slotKeys[i])) && slotKeys[i + 1] !== undefined && !EXTRA_SSD.includes(slotKeys[i + 1]) && addSsd && h ? h + addRow(addSsd) : h).join("");
    $(".pcb-slots").innerHTML = slots;
    renderSum();
  }

  function renderSum() {
    const isSaved = !!savedCode && savedKey === curKey(), t = totals(sel), n = Object.keys(sel).length, nTotal = CAT_LIST.length + EXTRA_SSD.filter((k) => sel[k]).length;
    const issues = check(sel);
    const need = sel.cpu || sel.gpu ? needWatts(sel) : 0;
    const used = { c: t.c, s: t.s, min: t.min }[mode];
    const bad = issues.filter((x) => x.lv === "err"), warn = issues.filter((x) => x.lv === "warn"), ok = issues.filter((x) => x.lv === "ok");
    const miss = (arr) => (arr.length ? `<small>缺：${arr.map((c) => CAT_NAME[c]).join("、")}</small>` : "");
    $(".pcb-sum").innerHTML = n ? `
      <h3>目前組合（${n}/${nTotal} 項）</h3>
      <div class="modes">${Object.entries(MODES).map(([k, v]) => `<button class="mode ${k === mode ? "on" : ""}" data-m="${k}">${v}</button>`).join("")}</div>
      <div class="tot">
        <div class="trow ${mode === "min" ? "cur" : ""}"><span>混搭最省</span><b>${money(t.min)}</b></div>
        <div class="trow ${mode === "c" ? "cur" : ""}"><span>原價屋全買</span><b>${money(t.c)}</b>${miss(t.missC)}</div>
        <div class="trow ${mode === "s" ? "cur" : ""}"><span>欣亞全買</span><b>${money(t.s)}</b>${miss(t.missS)}</div>
      </div>
      <div class="big">${MODES[mode]}：<b>${money(used)}</b></div>
      ${need ? `<div class="watt">預估耗電約 ${estWatts(sel)}W，建議電源 ${need}W 以上</div>` : ""}
      <ul class="chk">${bad.map((x) => `<li class="err">❌ ${esc(x.msg)}</li>`).join("")}${warn.map((x) => `<li class="warn">⚠️ ${esc(x.msg)}</li>`).join("")}${ok.map((x) => `<li class="ok">✅ ${esc(x.msg)}</li>`).join("")}</ul>
      <div class="acts"><button class="save ${isSaved ? "done" : ""}">${isSaved ? "✓ 已儲存 " + savedCode : "💾 儲存配單"}</button><button class="order">📋 看估價單</button><button class="clear">全部清空</button></div>
      ${isSaved ? `<p class="note savemsg">已儲存，配單編號 <b>${savedCode}</b>：大家都可以在「最近的配單」點選，或輸入這個編號載入（30 天內有效）。你再改零件後要再按一次儲存。</p>` : ""}
      <p class="note">價格取自原價屋線上估價與欣亞商品頁，每 4 小時更新；相容性是依型號文字判斷，下單前仍請自行確認（尤其是顯卡長度、散熱器高度）。</p>` : `<p class="note">還沒選任何零件：上面輸入預算按「幫我配」，或從各分類自己選。</p>`;
  }

  // ---------- 選零件 ----------
  const pickEl = $(".pcb-pick");
  let pk = null;
  function openPick(slot) {
    const cat = slotCat(slot);
    pk = { slot, cat, q: "", compat: true, both: false, sort: "asc", shown: 60, brand: "" };
    pickEl.hidden = false;
    pickEl.innerHTML = `<div class="ph"><button class="pclose">✕</button><b>${pcIcon(slot)} 選${CAT_NAME[slot]}</b><span class="pcount"></span></div>
      <div class="pf"><input class="pq" type="search" placeholder="搜尋型號、品牌…"><select class="pbrand"></select><select class="psort"><option value="asc">價格低→高</option><option value="desc">價格高→低</option></select></div>
      <div class="pf2"><label><input type="checkbox" class="pcompat" checked> 只顯示相容</label><label><input type="checkbox" class="pboth"> 只看兩家都有</label></div>
      <div class="plist"></div>`;
    const brands = [...new Set((data.parts[cat] || []).map((p) => p.brand).filter(Boolean))].sort();
    pickEl.querySelector(".pbrand").innerHTML = `<option value="">全部品牌</option>` + brands.map((b) => `<option>${esc(b)}</option>`).join("");
    drawPick();
  }
  function drawPick() {
    const { cat, slot } = pk, other = { ...sel }; delete other[slot];
    const q = pk.q.trim().toUpperCase().split(/\s+/).filter(Boolean);
    let list = (data.parts[cat] || []).filter((p) => {
      if (pk.brand && p.brand !== pk.brand) return false;
      if (pk.both && !(p.c && p.s)) return false;
      if (q.length) { const h = (p.name + " " + p.brand + " " + p.spec).toUpperCase(); if (!q.every((w) => h.includes(w))) return false; }
      if (pk.compat && !fits(other, p)) return false;
      return true;
    });
    list.sort((a, b) => (pk.sort === "asc" ? 1 : -1) * ((priceOf(a, mode) ?? priceOf(a)) - (priceOf(b, mode) ?? priceOf(b))));
    pickEl.querySelector(".pcount").textContent = `${list.length} 項`;
    const rows = list.slice(0, pk.shown).map((p) => {
      const on = sel[slot] && sel[slot].id === p.id;
      return `<div class="prow ${on ? "on" : ""}" data-id="${p.id}"><div class="pn">${partImg(p, "pr")}<div>${esc(p.name)}${p.spec ? `<small>${esc(p.spec.slice(0, 90))}</small>` : ""}</div></div><div class="prices">${priceCell(p)}</div><button class="trend" data-id="${p.id}" data-cat="${cat}">📈</button></div>`;
    }).join("");
    pickEl.querySelector(".plist").innerHTML = (rows || `<p class="note">沒有符合的零件${pk.compat ? "（可以取消「只顯示相容」看看）" : ""}</p>`) + (list.length > pk.shown ? `<button class="more">再顯示 ${Math.min(60, list.length - pk.shown)} 項</button>` : "");
  }
  pickEl.addEventListener("input", (e) => {
    if (!pk) return;
    if (e.target.classList.contains("pq")) { pk.q = e.target.value; pk.shown = 60; drawPick(); }
  });
  pickEl.addEventListener("change", (e) => {
    if (!pk) return;
    const c = e.target.classList;
    if (c.contains("pbrand")) pk.brand = e.target.value;
    else if (c.contains("psort")) pk.sort = e.target.value;
    else if (c.contains("pcompat")) pk.compat = e.target.checked;
    else if (c.contains("pboth")) pk.both = e.target.checked;
    else return;
    pk.shown = 60; drawPick();
  });
  pickEl.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest(".pclose")) { pickEl.hidden = true; pk = null; return; }
    if (t.closest(".more")) { pk.shown += 60; drawPick(); return; }
    const tr = t.closest(".trend");
    if (tr) { showTrend(tr.dataset.cat, tr.dataset.id); return; }
    const row = t.closest(".prow");
    if (row && pk) { const p = findPart(pk.cat, row.dataset.id); if (p) { sel[pk.slot] = p; auto.delete(pk.slot); saveSel(); pickEl.hidden = true; pk = null; render(); } }
  });

  // ---------- 價格走勢 ----------
  async function showTrend(cat, id) {
    const p = findPart(cat, id);
    if (!p) return;
    const box = document.createElement("div");
    box.className = "pcb-trend";
    box.innerHTML = `<div class="tbox"><button class="tclose">✕</button><div class="thd">${partImg(p, "tr")}<b>${esc(p.name)}</b></div><div class="tbody">讀取中…</div></div>`;
    root.querySelector(".pcb").appendChild(box);
    box.addEventListener("click", (e) => { if (e.target === box || e.target.closest(".tclose")) box.remove(); });
    const ids = [p.c && p.c.id, p.s && p.s.id].filter(Boolean);
    let h = {};
    try { h = await (await fetch(url("api/pc/hist?ids=" + ids.join(",")))).json(); } catch {}
    const series = [["原價屋", p.c && h[p.c.id], "#f0a63a"], ["欣亞", p.s && h[p.s.id], "#4aa3ff"]].filter((s) => s[1] && s[1].length);
    const body = box.querySelector(".tbody");
    if (!series.length) { body.textContent = "還沒有紀錄"; return; }
    const now = Math.floor(Date.now() / 1000);
    const pts = series.flatMap((s) => s[1]);
    const t0 = Math.min(...pts.map((x) => x[0])), t1 = Math.max(now, ...pts.map((x) => x[0]));
    const vals = pts.map((x) => x[1]).filter((v) => v > 0);
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.15);
    const W = 320, H = 150, L = 46, R = 8, T = 8, B = 20;
    const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="tsvg">`;
    for (let i = 0; i <= 2; i++) { const v = lo - pad + ((hi - lo + 2 * pad) * i) / 2; svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v).toLocaleString("en-US")}</text>`; }
    for (const [, arr, col] of series) {
      let d = "";
      arr.forEach(([t, v], i) => { if (v === 0) return; d += `${d ? "L" : "M"}${X(t)},${Y(v)} `; const nx = arr[i + 1]; d += `L${X(nx ? nx[0] : t1)},${Y(v)} `; });
      svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2"/>`;
      for (const [t, v] of arr) if (v) svg += `<circle cx="${X(t)}" cy="${Y(v)}" r="2.5" fill="${col}"/>`;
    }
    const f = (t) => { const d = new Date(t * 1000); return `${d.getMonth() + 1}/${d.getDate()}`; };
    svg += `<text x="${L}" y="${H - 5}">${f(t0)}</text><text x="${W - R}" y="${H - 5}" text-anchor="end">${f(t1)}</text></svg>`;
    const legend = series.map(([n, arr, c]) => `<span><i style="background:${c}"></i>${n} 目前 ${money(arr[arr.length - 1][1] || null)}（最低 ${money(Math.min(...arr.filter((x) => x[1] > 0).map((x) => x[1])))}）</span>`).join("");
    body.innerHTML = svg + `<div class="tleg">${legend}</div><p class="note">只有價格變動才會記一筆；紀錄從網站開始收集那天起算，剛開始只會看到一個點。</p>`;
  }

  // ---------- 事件 ----------
  root.querySelector(".pcb-slots").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.classList.contains("pick")) openPick(t.dataset.cat);
    else if (t.classList.contains("trend")) showTrend(slotCat(t.dataset.cat), t.dataset.id);
    else if (t.classList.contains("del")) { delete sel[t.dataset.cat]; auto.delete(t.dataset.cat); saveSel(); render(); }
  });
  root.querySelector(".pcb-sum").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.classList.contains("mode")) { mode = t.dataset.m; ls.set("pcb_mode", mode); renderSum(); }
    else if (t.classList.contains("clear")) { sel = {}; auto.clear(); saveSel(); render(); }
    else if (t.classList.contains("save")) saveOrder(t);
    else if (t.classList.contains("order")) openOrder();
  });
  $(".pcb-go").addEventListener("click", () => {
    const budget = Math.round(Number($(".pcb-budget").value));
    if (!(budget >= 10000)) { $(".pcb-budget").focus(); return; }
    const use = $(".pcb-use").value;
    ls.set("pcb_budget", budget); ls.set("pcb_use", use);
    const keep = $(".pcb-keepcb").checked;
    const locked = keep ? Object.fromEntries(Object.entries(sel).filter(([c]) => !auto.has(c))) : {};
    const extraCost = EXTRA_SSD.reduce((a, k) => a + (locked[k] ? priceOf(locked[k], mode) || 0 : 0), 0);   // 額外的硬碟要先從預算扣掉
    const r = recommend(data.parts, budget - extraCost, use, mode, locked);
    sel = { ...locked, ...r.sel };
    auto = new Set(Object.keys(sel).filter((c) => !locked[c]));
    saveSel(); render();
    if (r.notes.length) $(".pcb-sum").insertAdjacentHTML("afterbegin", `<p class="warn">${esc(r.notes.join("；"))}</p>`);
    $(".pcb-sum").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  async function loadCode(code) {
    code = String(code || "").trim().toUpperCase();
    if (!code) return;
    try {
      const r = await fetch(url("api/pc/load?code=" + encodeURIComponent(code)));
      const j = await r.json();
      if (!r.ok) { $(".pcb-code").value = ""; $(".pcb-code").placeholder = j.err || "載入失敗"; return; }
      sel = {}; auto = new Set();
      for (const c of SLOT_LIST) if (j.ids[c]) { const p = findPart(slotCat(c), j.ids[c]); if (p) sel[c] = p; }
      saveSel(); savedKey = curKey(); savedCode = code; render();
      $(".pcb-sum").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { $(".pcb-code").placeholder = "載入失敗，晚點再試"; }
  }
  // 最近的配單：列出編號、時間、總價和主要零件，點一張就載入
  const ago = (ts) => { const sec = ts > 1e11 ? ts / 1000 : ts, m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60)); return m < 1 ? "剛剛" : m < 60 ? m + " 分鐘前" : m < 1440 ? Math.round(m / 60) + " 小時前" : Math.round(m / 1440) + " 天前"; };
  async function showSaved() {
    const box = $(".pcb-savedlist");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = `<p class="note">讀取中…</p>`;
    let list = [];
    try { list = (await (await fetch(url("api/pc/shares?n=40"))).json()).list || []; } catch { box.innerHTML = `<p class="note">讀取失敗，晚點再試</p>`; return; }
    const seen = new Set(), rows = [];
    for (const e of list) {
      const s2 = {}; let miss = 0;
      for (const c of SLOT_LIST) if (e.ids[c]) { const p = findPart(slotCat(c), e.ids[c]); if (p) s2[c] = p; else miss++; }
      const n = Object.keys(s2).length;
      if (!n) continue;
      const key = SLOT_LIST.map((c) => s2[c] ? s2[c].id : "").join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const t = totals(s2);
      const main = ["cpu", "gpu"].map((c) => s2[c] ? short(s2[c].name, 18) : "").filter(Boolean).join("　");
      rows.push(`<div class="pcb-svrow" data-code="${e.code}"><button class="pcb-sv" data-code="${e.code}"><span class="svc">${e.code}</span><span class="svp">${money(t.min)}</span><span class="svm">${esc(main || n + " 項零件")}</span><span class="svt">${n} 項${miss ? "（" + miss + " 項已下架）" : ""}・${ago(e.ts)}</span></button><button class="pcb-svdel" data-code="${e.code}" title="刪除這張配單">🗑</button></div>`);
    }
    box.innerHTML = rows.length ? rows.join("") : `<p class="note">目前沒有存過的配單</p>`;
    box.querySelectorAll(".pcb-sv").forEach((b) => b.addEventListener("click", () => { loadCode(b.dataset.code); box.hidden = true; }));
    // 刪除：第一下變成「確定刪？」，3 秒內再按一次才真的刪（誰都能刪，所以要確認）
    box.querySelectorAll(".pcb-svdel").forEach((b) => b.addEventListener("click", async () => {
      if (!b.classList.contains("armed")) {
        b.classList.add("armed"); b.textContent = "確定刪？";
        setTimeout(() => { if (b.isConnected && b.classList.contains("armed")) { b.classList.remove("armed"); b.textContent = "🗑"; } }, 3000);
        return;
      }
      b.disabled = true; b.textContent = "…";
      try {
        const r = await fetch(url("api/pc/unshare?code=" + encodeURIComponent(b.dataset.code)), { method: "POST" });
        const j = await r.json();
        if (!r.ok && r.status !== 404) throw new Error(j.err || "fail");
        if (b.dataset.code === savedCode) { savedCode = ""; savedKey = ""; renderSum(); }
        b.closest(".pcb-svrow").remove();
        if (!box.querySelector(".pcb-svrow")) box.innerHTML = `<p class="note">目前沒有存過的配單</p>`;
      } catch { b.disabled = false; b.classList.remove("armed"); b.textContent = "刪除失敗"; }
    }));
  }
  $(".pcb-savedbtn").addEventListener("click", showSaved);
  $(".pcb-loadbtn").addEventListener("click", () => loadCode($(".pcb-code").value));
  $(".pcb-code").addEventListener("keydown", (e) => { if (e.key === "Enter") loadCode(e.target.value); });

  // ---------- 估價單 ----------
  const SN = { c: "原價屋", s: "欣亞" };
  const short = (t, n = 30) => { t = String(t).replace(/\s+/g, " "); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  // 每個零件在目前的買法下要去哪家買
  function storeOf(p) {
    if (mode === "c") return p.c ? "c" : "s";
    if (mode === "s") return p.s ? "s" : "c";
    if (p.c && p.s) return p.c.p <= p.s.p ? "c" : "s";
    return p.c ? "c" : "s";
  }
  function orderData() {
    const g = { c: [], s: [] };
    for (const cat of CAT_LIST.flatMap((c) => (c === "ssd" ? ["ssd", ...EXTRA_SSD] : [c]))) { const p = sel[cat]; if (!p) continue; const st = storeOf(p); g[st].push({ cat, p, price: p[st].p, other: st === "c" ? p.s : p.c }); }
    const sum = (a) => a.reduce((x, r) => x + r.price, 0);
    return { g, sub: { c: sum(g.c), s: sum(g.s) }, total: sum(g.c) + sum(g.s) };
  }
  function orderText(code) {
    const o = orderData(), d = new Date(Math.min(data.cool || 1e12, data.sinya || 1e12) * 1000);
    const stamp = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const out = [`**🖥️ 電腦配單　${money(o.total)}**　（${MODES[mode]}，${stamp} 的價格）`];
    for (const st of ["c", "s"]) {
      if (!o.g[st].length) continue;
      out.push("", `**${SN[st]}　${money(o.sub[st])}**`);
      for (const r of o.g[st]) out.push(`${PC_TXT[r.cat]} ${CAT_NAME[r.cat]}｜${short(r.p.name, 34)}｜${money(r.price)}`);
    }
    const miss = CAT_LIST.filter((c) => !sel[c]).map((c) => CAT_NAME[c]);
    if (miss.length) out.push("", `還沒選：${miss.join("、")}`);
    const bad = check(sel).filter((x) => x.lv === "err");
    if (bad.length) out.push("", ...bad.map((x) => "❌ " + x.msg));
    if (code) out.push("", `配單代碼 \`${code}\`（在 Activity「配電腦」輸入可載入）`);
    return out.join("\n");
  }
  function openOrder() {
    if (!Object.keys(sel).length) return;
    const o = orderData(), box = document.createElement("div");
    box.className = "pcb-trend";
    const rows = (st) => o.g[st].map((r) => `<div class="orow"><span class="oi">${pcIcon(r.cat)}</span><div class="on"><small>${CAT_NAME[r.cat]}</small>${esc(r.p.name)}</div><b>${money(r.price)}</b>${r.other ? `<em>另一家 ${money(r.other.p)}</em>` : `<em class="only">只有這家有</em>`}</div>`).join("");
    const blocks = ["c", "s"].filter((st) => o.g[st].length).map((st) => `<div class="ostore"><div class="oh"><b>${SN[st]}</b><span>${o.g[st].length} 項　${money(o.sub[st])}</span></div>${rows(st)}</div>`).join("");
    const issues = check(sel).filter((x) => x.lv !== "ok");
    box.innerHTML = `<div class="tbox order"><button class="tclose">✕</button><div class="otitle">估價單<small>${MODES[mode]}</small></div>${blocks}
      <div class="ototal"><span>合計</span><b>${money(o.total)}</b></div>
      ${issues.length ? `<ul class="chk">${issues.map((x) => `<li class="${x.lv}">${x.lv === "err" ? "❌" : "⚠️"} ${esc(x.msg)}</li>`).join("")}</ul>` : ""}
      <div class="ocode">配單代碼：<b class="ocv">產生中…</b></div>
      <div class="acts"><button class="ocopy">複製（貼到 Discord）</button></div>
      <textarea class="otext" readonly rows="8" hidden></textarea></div>`;
    root.querySelector(".pcb").appendChild(box);
    let code = "";
    box.addEventListener("click", (e) => { if (e.target === box || e.target.closest(".tclose")) box.remove(); });
    fetch(url("api/pc/share?ids=" + encodeURIComponent(JSON.stringify(Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.id])))))).then((r) => r.json()).then((j) => { code = j.code || ""; box.querySelector(".ocv").textContent = code ? code + "（30 天內有效）" : "（無法產生）"; }).catch(() => { box.querySelector(".ocv").textContent = "（無法產生）"; });
    box.querySelector(".ocopy").addEventListener("click", () => {
      const text = orderText(code), ta = box.querySelector(".otext"), b = box.querySelector(".ocopy");
      const show = () => { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); b.textContent = "長按文字框全選後複製"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { b.textContent = "已複製 ✓"; setTimeout(() => (b.textContent = "複製（貼到 Discord）"), 1500); }, show);
      else show();
    });
  }

  load();
}
