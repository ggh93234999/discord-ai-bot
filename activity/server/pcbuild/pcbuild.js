// 配電腦：抓原價屋 (coolpc) 與欣亞 (sinya) 的零件價格，自動配對同一個零件，並把價格變動記進 SQLite 當歷史。
// 低頻率抓取（預設每 4 小時一次；原價屋 1 個請求、欣亞約 80 個請求並且有間隔），結果快取在記憶體 + 檔案。
//   GET /api/pc/data          → 整包零件資料（gzip）
//   GET /api/pc/hist?ids=a,b  → 這些零件各自的價格歷史（只有價格有變才有一筆）
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { arec } from "../paths.js";
import { extract, matchCat, CATS } from "./parts.js";
import { recommend, check, fits, totals, priceOf, CAT_LIST, SLOT_LIST, slotCat, CAT_NAME, USE_NAME } from "../../shared/pcrules.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64) pc-price-viewer (low-frequency personal use)";
const REFRESH_MS = Number(process.env.PC_REFRESH_MS || 4 * 3600 * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let db = null;
const lastPrice = new Map();           // side id -> 目前價格（0 = 下架）
let state = { ts: 0, cool: { ts: 0, items: [] }, sinya: { ts: 0, items: [] }, parts: {}, gz: null, json: "" };
let busy = false;

function openDb() {
  if (db) return db;
  db = new DatabaseSync(arec("pcprices.db"));
  db.exec(`CREATE TABLE IF NOT EXISTS item (id TEXT PRIMARY KEY, store TEXT, cat TEXT, name TEXT, first_ts INTEGER, last_ts INTEGER);
           CREATE TABLE IF NOT EXISTS hist (id TEXT NOT NULL, ts INTEGER NOT NULL, price INTEGER NOT NULL);
           CREATE INDEX IF NOT EXISTS hist_id ON hist(id, ts);`);
  for (const r of db.prepare("SELECT h.id AS id, h.price AS price FROM hist h JOIN (SELECT id, MAX(ts) AS t FROM hist GROUP BY id) m ON h.id = m.id AND h.ts = m.t").all()) lastPrice.set(r.id, r.price);
  return db;
}

function recordPrices(items, store, now) {
  const d = openDb();
  const insH = d.prepare("INSERT INTO hist (id, ts, price) VALUES (?, ?, ?)");
  const upI = d.prepare("INSERT INTO item (id, store, cat, name, first_ts, last_ts) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_ts = excluded.last_ts");
  const seen = new Set();
  let changed = 0;
  d.exec("BEGIN");
  try {
    for (const it of items) {
      seen.add(it.id);
      upI.run(it.id, store, it.cat, String(it.name).slice(0, 200), now, now);
      if (lastPrice.get(it.id) !== it.price) { insH.run(it.id, now, it.price); lastPrice.set(it.id, it.price); changed++; }
    }
    // 這一輪沒看到、之前有價格的 → 記為下架（價格 0）
    for (const [id, p] of lastPrice) {
      if (p === 0 || seen.has(id)) continue;
      const isCool = id.startsWith("c_");
      if ((store === "c") !== isCool) continue;
      insH.run(id, now, 0); lastPrice.set(id, 0); changed++;
    }
    d.exec("COMMIT");
  } catch (e) { try { d.exec("ROLLBACK"); } catch {} throw e; }
  return changed;
}

// ---------- 原價屋 ----------
const COOL_CATS = { cpu: [4], mb: [5], ram: [6], ssd: [7], gpu: [12], case: [14], psu: [15], cooler: [10, 11] };
const COOL_SKIP = /周邊|專業|工作站|伺服器|筆記型|DDR3|散熱片|散熱膏|導熱|水冷套件|Pro B70|機架|NAS|福利品|限量大全套|客訂/;
function decodeEnt(s) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)); }

export function parseCool(html) {
  const out = [], idSeen = new Set();
  for (const [cat, ns] of Object.entries(COOL_CATS)) {
    for (const n of ns) {
      const m = html.match(new RegExp("name=n" + n + " class=s>([\\s\\S]*?)</SELECT>", "i"));
      if (!m) continue;
      let grp = "";
      const gm = html.match(new RegExp("\\bg" + n + "=\\[([^\\]]*)\\]"));   // 每個選項對應的商品編號（拿實圖用）
      const garr = gm ? gm[1].split(",").map(Number) : [];
      const re = /<OPTGROUP LABEL='([^']*)'>|<OPTION([^>]*)>([^<\n]*)/gi;
      let t;
      while ((t = re.exec(m[1]))) {
        if (t[1] !== undefined) { grp = decodeEnt(t[1]); continue; }
        if (/disabled/i.test(t[2]) || COOL_SKIP.test(grp)) continue;
        const text = decodeEnt(t[3]).trim();
        const pm = text.match(/,\s*\$(\d+)/);
        if (!pm) continue;
        const price = +pm[1];
        if (!(price > 0)) continue;
        const head = text.slice(0, pm.index);
        const nm = head.match(/^[｛{]([^｝}]+)[｝}]\s*(.*)$/);
        const core = (nm ? nm[1] : head).trim(), spec = (nm ? nm[2] : "").trim();
        if (/\+/.test(core) || /搭購|套裝|組合|福利/.test(head)) continue;       // 組合包不要
        let id = "c_" + crypto.createHash("md5").update(cat + core).digest("hex").slice(0, 10);
        while (idSeen.has(id)) id += "x";
        idSeen.add(id);
        const tail = text.slice(pm.index);
        const vm = t[2].match(/value=(\d+)/i), g = vm ? garr[+vm[1]] || 0 : 0;
        out.push({ id, store: "c", cat, grp, name: core, spec, price, g, tag: /預購|缺貨|調貨|待到貨/.test(head + tail) ? "預購/缺貨" : "" });
      }
    }
  }
  return out;
}

async function fetchCool() {
  const r = await fetch("https://www.coolpc.com.tw/evaluate.php", { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error("coolpc HTTP " + r.status);
  const html = new TextDecoder("big5").decode(Buffer.from(await r.arrayBuffer()));
  const items = parseCool(html);
  if (items.length < 300) throw new Error("coolpc 解析筆數異常：" + items.length);
  return items;
}

// ---------- 欣亞 ----------
const SINYA_CATS = { cpu: [1], mb: [2], ram: [3], ssd: [105], gpu: [5], case: [8], psu: [9], cooler: [11, 150] };
const SINYA_SKIP = /專案|優惠組|搭購|套餐|組合|福利品|整新|拆封|展示|二手|\+|筆電|SO-?DIMM|NB/i;
async function fetchSinyaCat(cat, slave) {
  const out = [];
  let total = 0;
  for (let p = 1; p <= 40; p++) {
    const r = await fetch(`https://www.sinya.com.tw/api/search/getdata/1_${slave}${p > 1 ? "?page=" + p : ""}`, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) throw new Error(`sinya ${slave} p${p} HTTP ${r.status}`);
    const j = await r.json();
    total = +j.result_total || 0;
    const rs = j.results || [];
    for (const x of rs) {
      const price = parseInt(String(x.new_price || "").replace(/[^\d]/g, ""), 10) || 0;
      const title = String(x.prod_title || "").trim();
      if (!price || !title || SINYA_SKIP.test(title) || x.display_price_status !== 1) continue;
      out.push({ id: "s" + x.prod_id, store: "s", cat, grp: "", name: title.replace(/^(【[^】]*】)+\s*/, ""), spec: "", price, href: x.href || "", img: typeof x.image === "string" && x.image.startsWith("/upload/") ? x.image : "", tag: "" });
    }
    if (!rs.length || p * 20 >= total) break;
    await sleep(500);
  }
  return out;
}
async function fetchSinya() {
  const all = [], ids = new Set();
  for (const [cat, slaves] of Object.entries(SINYA_CATS)) {
    for (const sl of slaves) {
      const items = await fetchSinyaCat(cat, sl);
      for (const it of items) if (!ids.has(it.id)) { ids.add(it.id); all.push(it); }
      await sleep(500);
    }
  }
  if (all.length < 200) throw new Error("sinya 筆數異常：" + all.length);
  return all;
}

// ---------- 合併 ----------
function build() {
  const parts = {};
  for (const cat of CATS) {
    const cs = state.cool.items.filter((x) => x.cat === cat).map((x) => ({ ...x, ...extract(cat, x) }));
    const ss = state.sinya.items.filter((x) => x.cat === cat).map((x) => ({ ...x, ...extract(cat, x) }));
    const pairs = matchCat(cat, cs, ss);                      // [[c, s], ...] 其中一邊可為 null
    const JUNK = /滑鼠墊|Game Pass|點數|提醒|支撐架|支架|轉接|濾網|延長|線材|防塵|擋板|螺絲|貼紙|燈條|燈帶|扣具|散熱膏|導熱/;
    parts[cat] = pairs.filter(([c, s]) => {
      const x = c || s;
      if (cat === "gpu") return !!x.sp.chip && !JUNK.test(x.name);
      if (cat === "case" || cat === "cooler") return !JUNK.test(x.name) && x.price >= (cat === "case" ? 600 : 250);
      return true;
    }).map(([c, s]) => {
      const base = c || s;
      const side = (x) => x && { id: x.id, p: x.price, n: x.name, u: x.href || "", t: x.tag || "" };
      return { id: (s || c).id, cat, brand: base.brand || "", name: c ? c.name : s.name, spec: c ? c.spec : "", sp: base.sp, c: side(c), s: side(s) };
    });
  }
  state.parts = parts;
  state.json = JSON.stringify({ ts: state.ts, cool: state.cool.ts, sinya: state.sinya.ts, parts });
  state.gz = zlib.gzipSync(state.json, { level: 6 });
}

function save() {
  try { fs.writeFileSync(arec("pcbuild_cache.json"), JSON.stringify({ ts: state.ts, cool: state.cool, sinya: state.sinya })); } catch (e) { console.log("配電腦快取寫入失敗", e.message); }
}
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(arec("pcbuild_cache.json"), "utf8"));
    state.ts = j.ts || 0; state.cool = j.cool || state.cool; state.sinya = j.sinya || state.sinya;
    if (state.cool.items.length || state.sinya.items.length) build();
  } catch {}
}

export async function refresh(force = false) {
  if (busy) return;
  if (!force && Date.now() - state.ts * 1000 < REFRESH_MS * 0.9 && state.json) return;
  busy = true;
  const t0 = Date.now();
  try {
    const now = Math.floor(Date.now() / 1000);
    let nc = 0, ns = 0;
    try { const items = await fetchCool(); state.cool = { ts: now, items }; nc = recordPrices(items, "c", now); } catch (e) { console.log("原價屋抓取失敗", e.message); }
    try { const items = await fetchSinya(); state.sinya = { ts: now, items }; ns = recordPrices(items, "s", now); } catch (e) { console.log("欣亞抓取失敗", e.message); }
    state.ts = now;
    build(); save();
    console.log(`配電腦價格更新：原價屋 ${state.cool.items.length} 筆（變動 ${nc}）、欣亞 ${state.sinya.items.length} 筆（變動 ${ns}），${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  } finally { busy = false; }
}

export function startPc() {
  try { openDb(); } catch (e) { console.log("配電腦資料庫開啟失敗", e.message); return; }
  load();
  setTimeout(() => refresh().catch((e) => console.log("配電腦更新錯誤", e.message)), 15000);
  setInterval(() => refresh().catch((e) => console.log("配電腦更新錯誤", e.message)), 30 * 60 * 1000).unref?.();
}


// ---------- 商品圖：欣亞有現成路徑；原價屋要拿商品編號去問 eva-img.php（跟網頁上點 ★ 一樣）。圖由伺服器代抓、快取，Activity 不用直連店家 ----------
const imgCache = new Map();            // id -> {type, buf} 或 null（沒有圖）
let coolGFill = null;
async function fillCoolG() {
  if (!coolGFill) coolGFill = (async () => {
    const items = await fetchCool();
    const m = new Map(items.map((x) => [x.id, x.g]));
    for (const x of state.cool.items) if (m.has(x.id)) x.g = m.get(x.id);
  })().finally(() => { coolGFill = null; });
  return coolGFill;
}
async function getBytes(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) return null;
  const type = r.headers.get("content-type") || "";
  if (!/^image\//.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > 20 && buf.length < 3e6 ? { type, buf } : null;
}
async function imgFor(id) {
  if (!/^[cs][\w]{1,20}$/.test(id)) return null;
  if (imgCache.has(id)) return imgCache.get(id);
  let im = null;
  if (id[0] === "s") {
    const it = state.sinya.items.find((x) => x.id === id);
    if (it) {
      const path = it.img || (/^s(\d+)$/.test(id) ? `/upload/prod/${id.slice(1)}.png` : "");
      if (path) im = await getBytes("https://www.sinya.com.tw" + path);
    }
  } else {
    let it = state.cool.items.find((x) => x.id === id);
    if (it && it.g === undefined) { await fillCoolG(); it = state.cool.items.find((x) => x.id === id); }
    if (it && it.g > 0) {
      const r = await fetch("https://www.coolpc.com.tw/eva-img.php", { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" }, body: `G=${it.g}&D=1` });
      const m = r.ok ? (await r.text()).match(/src='(\/eval\/[\w\/.\-]+\.(?:jpg|png|jpeg))'/i) : null;
      if (m) im = await getBytes("https://www.coolpc.com.tw" + m[1]);
    }
  }
  if (imgCache.size > 400) imgCache.delete(imgCache.keys().next().value);
  imgCache.set(id, im);
  return im;
}

// ---------- 配單代碼：bot 配好的單、或自己的單，用 6 碼代碼在 Activity 載入 ----------
let shares = null;
function loadShares() {
  if (shares) return shares;
  try { shares = JSON.parse(fs.readFileSync(arec("pcshares.json"), "utf8")); } catch { shares = {}; }
  return shares;
}
function makeShare(ids) {
  const sh = loadShares(), now = Date.now();
  for (const [k, v] of Object.entries(sh)) if (now - v.ts > 30 * 86400e3) delete sh[k];
  const keys = Object.keys(sh);
  if (keys.length > 800) for (const k of keys.sort((a, b) => sh[a].ts - sh[b].ts).slice(0, keys.length - 800)) delete sh[k];
  const same = JSON.stringify(Object.entries(ids).sort());      // 內容完全一樣的配單只留一份（重複按儲存不會越存越多）
  for (const [k, v] of Object.entries(sh)) if (JSON.stringify(Object.entries(v.ids || {}).sort()) === same) {
    v.ts = now;
    try { fs.writeFileSync(arec("pcshares.json"), JSON.stringify(sh)); } catch {}
    return k;
  }
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join(""); } while (sh[code]);
  sh[code] = { ts: now, ids };
  try { fs.writeFileSync(arec("pcshares.json"), JSON.stringify(sh)); } catch {}
  return code;
}
const cleanIds = (o) => { const out = {}; for (const c of SLOT_LIST) if (o && typeof o[c] === "string" && /^[cs][\w]{1,20}$/.test(o[c])) out[c] = o[c]; return out; };

const brief = (p) => ({ id: p.id, cat: p.cat, name: p.name, 規格: (p.spec || "").slice(0, 90), 原價屋: p.c ? p.c.p : null, 欣亞: p.s ? p.s.p : null, 較便宜: p.c && p.s ? (p.c.p === p.s.p ? "一樣" : p.c.p < p.s.p ? "原價屋" : "欣亞") : p.c ? "只有原價屋" : "只有欣亞" });
function json(res, o, code = 200) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); return true; }
function buildReply(sel, mode, extra, notes) {
  const t = totals(sel);
  const ids = {}; for (const c of SLOT_LIST) if (sel[c]) ids[c] = sel[c].id;
  return {
    配單代碼: makeShare(ids), ...extra, 更新時間: state.ts,
    零件: SLOT_LIST.filter((c) => sel[c]).map((c) => ({ 類別: CAT_NAME[c], ...brief(sel[c]), 取價: priceOf(sel[c], mode) })),
    尚未選的類別: CAT_LIST.filter((c) => !sel[c]).map((c) => CAT_NAME[c]),
    合計: { 混搭最省: t.min, 原價屋全買: t.c, 欣亞全買: t.s, 原價屋缺貨零件: t.missC.map((c) => CAT_NAME[c]), 欣亞缺貨零件: t.missS.map((c) => CAT_NAME[c]) },
    相容性: check(sel).map((x) => `${x.lv === "err" ? "❌" : x.lv === "warn" ? "⚠️" : "✅"} ${x.msg}`), 備註: notes || [],
  };
}
function handleTools(u, res, req) {
  if (!state.json) return json(res, { err: "價格資料還在載入，請稍後再試" }, 503);
  if (u.pathname === "/api/pc/rec") {
    const budget = Math.max(8000, Math.min(500000, +u.searchParams.get("budget") || 0));
    const use = ["game", "office", "create"].includes(u.searchParams.get("use")) ? u.searchParams.get("use") : "game";
    const mode = ["c", "s", "min"].includes(u.searchParams.get("mode")) ? u.searchParams.get("mode") : "min";
    const locked = {};
    for (const id of (u.searchParams.get("keep") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8)) {
      for (const c of CATS) { const p = (state.parts[c] || []).find((x) => x.id === id); if (p) { locked[c] = p; break; } }
    }
    const r = recommend(state.parts, budget, use, mode, locked);
    return json(res, buildReply(r.sel, mode, { 預算: budget, 用途: USE_NAME[use] }, r.notes));
  }
  if (u.pathname === "/api/pc/edit") {
    const e = loadShares()[String(u.searchParams.get("code") || "").toUpperCase().trim()];
    if (!e) return json(res, { err: "找不到這個配單代碼（可能打錯或已過期）" }, 404);
    const mode = ["c", "s", "min"].includes(u.searchParams.get("mode")) ? u.searchParams.get("mode") : "min";
    const find = (id) => { for (const c of CATS) { const p = (state.parts[c] || []).find((x) => x.id === id); if (p) return p; } return null; };
    const sel = {}; const notes = [];
    for (const c of SLOT_LIST) if (e.ids[c]) { const p = find(e.ids[c]); if (p) sel[c] = p; else notes.push(`${CAT_NAME[c]}原本的零件已經下架或找不到，已移除`); }
    for (const pair of (u.searchParams.get("set") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8)) {
      const id = pair.includes(":") ? pair.split(":")[1] : pair, p = find(id);
      if (p) sel[p.cat] = p; else notes.push(`找不到零件 ${id}`);
    }
    for (const c of (u.searchParams.get("drop") || "").split(",").map((x) => x.trim()).filter(Boolean)) delete sel[c];
    const budget = +u.searchParams.get("budget") || 0;
    let extra = {};
    if (u.searchParams.get("fill") === "1" && budget >= 8000) {
      const use = ["game", "office", "create"].includes(u.searchParams.get("use")) ? u.searchParams.get("use") : "game";
      const r = recommend(state.parts, Math.min(500000, budget), use, mode, sel);
      Object.assign(sel, r.sel); notes.push(...r.notes); extra = { 預算: budget, 用途: USE_NAME[use] };
    }
    return json(res, buildReply(sel, mode, extra, notes));
  }
  if (u.pathname === "/api/pc/share") {
    let ids = {};
    try { ids = cleanIds(JSON.parse(u.searchParams.get("ids") || "{}")); } catch {}
    if (!Object.keys(ids).length) return json(res, { err: "沒有零件" }, 400);
    return json(res, { code: makeShare(ids) });
  }
  if (u.pathname === "/api/pc/load") {
    const e = loadShares()[String(u.searchParams.get("code") || "").toUpperCase().trim()];
    return e ? json(res, { ids: e.ids }) : json(res, { err: "找不到這個代碼（可能打錯或已過期）" }, 404);
  }
  if (u.pathname === "/api/pc/unshare") {       // 刪除配單（誰都能刪）；內容一樣的重複單一起刪，不然舊的會又冒出來
    if (req.method !== "POST") return json(res, { err: "請用 POST" }, 405);
    const sh = loadShares(), code = String(u.searchParams.get("code") || "").toUpperCase().trim();
    const e = sh[code];
    if (!e) return json(res, { err: "找不到這張配單（可能已經被刪掉了）" }, 404);
    const same = JSON.stringify(Object.entries(e.ids || {}).sort());
    let n = 0;
    for (const [k, v] of Object.entries(sh)) if (k === code || JSON.stringify(Object.entries(v.ids || {}).sort()) === same) { delete sh[k]; n++; }
    try { fs.writeFileSync(arec("pcshares.json"), JSON.stringify(sh)); } catch (err) { return json(res, { err: "刪除失敗" }, 500); }
    console.log(`配單刪除：${code}（共 ${n} 筆內容相同）`);
    return json(res, { ok: true, removed: n });
  }
  if (u.pathname === "/api/pc/shares") {       // 最近的配單（bot 配的、大家存的），讓人直接點，不用打代碼
    const n = Math.min(60, Math.max(1, +u.searchParams.get("n") || 30));
    const list = Object.entries(loadShares()).sort((a, b) => b[1].ts - a[1].ts).slice(0, n).map(([code, v]) => ({ code, ts: v.ts, ids: v.ids }));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(JSON.stringify({ list }));
    return true;
  }
  if (u.pathname === "/api/pc/search") {
    const cat = u.searchParams.get("cat") || "", q = (u.searchParams.get("q") || "").toUpperCase().split(/\s+/).filter(Boolean);
    const cats = CATS.includes(cat) ? [cat] : CATS;
    const min = +u.searchParams.get("min") || 0, max = +u.searchParams.get("max") || 0;
    // fit=配單代碼：只留下跟那份單其他零件相容的
    let base = null;
    const fc = u.searchParams.get("fit");
    if (fc) {
      const e = loadShares()[fc.toUpperCase().trim()];
      if (!e) return json(res, { err: "找不到這個配單代碼" }, 404);
      base = {};
      for (const c of SLOT_LIST) if (e.ids[c]) { const p = (state.parts[slotCat(c)] || []).find((x) => x.id === e.ids[c]); if (p) base[c] = p; }
    }
    const out = [];
    for (const c of cats) for (const p of state.parts[c] || []) {
      const hay = (p.name + " " + p.brand + " " + p.spec).toUpperCase();
      if (!q.every((w) => hay.includes(w))) continue;
      const pr = priceOf(p);
      if ((min && pr < min) || (max && pr > max)) continue;
      if (base) { const o = { ...base }; delete o[p.cat]; if (!fits(o, p)) continue; }
      out.push(p);
    }
    const dir = u.searchParams.get("sort") === "desc" ? -1 : 1;
    out.sort((a, b) => dir * ((priceOf(a) || 0) - (priceOf(b) || 0)));
    return json(res, { 共: out.length, 更新時間: state.ts, 結果: out.slice(0, 15).map((p) => ({ 類別: CAT_NAME[p.cat], ...brief(p) })) });
  }
  if (u.pathname === "/api/pc/trend") {
    const id = u.searchParams.get("id") || "";
    let part = null;
    for (const c of CATS) { const p = (state.parts[c] || []).find((x) => x.id === id || (x.c && x.c.id === id)); if (p) { part = p; break; } }
    if (!part) return json(res, { err: "找不到這個零件" }, 404);
    const st = openDb().prepare("SELECT ts, price FROM hist WHERE id = ? ORDER BY ts DESC LIMIT 30");
    const f = (x) => x ? st.all(x.id).reverse().map((r) => ({ 時間: new Date(r.ts * 1000).toISOString().slice(0, 16).replace("T", " "), 價格: r.price })) : null;
    return json(res, { 零件: part.name, 原價屋: f(part.c), 欣亞: f(part.s), 說明: "只有價格變動時才有紀錄，記錄從開始收集那天起算" });
  }
  return false;
}

export function handlePc(req, res) {
  const u = new URL(req.url, "http://x");
  if (/^\/api\/pc\/(rec|search|trend|share|shares|unshare|load|edit)$/.test(u.pathname)) return handleTools(u, res, req);
  if (u.pathname === "/api/pc/data") {
    if (!state.gz) { res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "30" }); res.end('{"err":"loading"}'); return true; }
    const ae = String(req.headers["accept-encoding"] || "");
    const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" };
    if (/\bgzip\b/.test(ae)) { res.writeHead(200, { ...h, "Content-Encoding": "gzip" }); res.end(state.gz); }
    else { res.writeHead(200, h); res.end(state.json); }
    return true;
  }
  if (u.pathname === "/api/pc/moves") {
    // 漲跌榜：這段時間內每個零件（各店各算）的價格從多少變成多少。只看目前還上架的；下架／重新上架不算漲跌
    const days = Math.max(0, Math.min(365, Number(u.searchParams.get("days")) || 0));
    const now = Math.floor(Date.now() / 1000), t0 = days ? now - days * 86400 : 0;
    const meta = new Map();
    for (const cat of CATS) for (const p of state.parts[cat] || []) {
      if (p.c) meta.set(p.c.id, { name: p.name, brand: p.brand, u: p.c.u, st: "c" });
      if (p.s) meta.set(p.s.id, { name: p.s.n || p.name, brand: p.brand, u: p.s.u, st: "s" });
    }
    const out = { ts: state.ts, days, moves: [], tracked: 0, same: 0, delisted: 0, first: 0, last: 0, cats: {} };
    try {
      const d = openDb();
      const items = new Map(d.prepare("SELECT id, store, cat, name FROM item").all().map((r) => [r.id, r]));
      const rows = d.prepare("SELECT id, ts, price FROM hist ORDER BY id, ts").all();
      const bump = (cat, k) => { const c = (out.cats[cat] ||= { up: 0, down: 0, same: 0 }); c[k]++; };
      let i = 0;
      while (i < rows.length) {
        let j = i; while (j < rows.length && rows[j].id === rows[i].id) j++;
        const seq = rows.slice(i, j); i = j;
        const id = seq[0].id, it = items.get(id); if (!it) continue;
        if (!out.first || seq[0].ts < out.first) out.first = seq[0].ts;
        const lastRow = seq[seq.length - 1];
        if (lastRow.ts > out.last) out.last = lastRow.ts;
        if (lastRow.price === 0) { out.delisted++; continue; }
        const nz = seq.filter((r) => r.price > 0);
        let start = nz[0]; for (const r of nz) if (r.ts <= t0) start = r;
        const end = nz[nz.length - 1];
        out.tracked++;
        const n = nz.filter((r) => r.ts > start.ts && r.price !== start.price).length;
        if (end.price === start.price) { out.same++; bump(it.cat, "same"); continue; }
        bump(it.cat, end.price > start.price ? "up" : "down");
        const m = meta.get(id) || {};
        out.moves.push({ id, st: it.store, cat: it.cat, name: m.name || it.name, from: start.price, to: end.price, at: start.ts, to_at: end.ts, n, u: m.u || "" });
      }
    } catch (e) { out.err = String(e.message || e); }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" });
    res.end(JSON.stringify(out));
    return true;
  }
  if (u.pathname === "/api/pc/img") {
    imgFor(u.searchParams.get("id") || "").then((im) => {
      if (!im) { res.writeHead(404, { "Cache-Control": "public, max-age=600" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": im.type, "Cache-Control": "public, max-age=86400" });
      res.end(im.buf);
    }).catch(() => { res.writeHead(502); res.end(); });
    return true;
  }
  if (u.pathname === "/api/pc/hist") {
    const ids = (u.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter((s) => /^[cs][\w]{1,20}$/.test(s)).slice(0, 8);
    const out = {};
    try {
      const st = openDb().prepare("SELECT ts, price FROM hist WHERE id = ? ORDER BY ts LIMIT 600");
      for (const id of ids) out[id] = st.all(id).map((r) => [r.ts, r.price]);
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" });
    res.end(JSON.stringify(out));
    return true;
  }
  return false;
}
