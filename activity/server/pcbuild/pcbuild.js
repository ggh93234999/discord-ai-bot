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
import { recommend, check, totals, priceOf, CAT_LIST, CAT_NAME, USE_NAME } from "../../shared/pcrules.js";

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
        out.push({ id, store: "c", cat, grp, name: core, spec, price, tag: /預購|缺貨|調貨|待到貨/.test(head + tail) ? "預購/缺貨" : "" });
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
      out.push({ id: "s" + x.prod_id, store: "s", cat, grp: "", name: title.replace(/^(【[^】]*】)+\s*/, ""), spec: "", price, href: x.href || "", tag: "" });
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
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join(""); } while (sh[code]);
  sh[code] = { ts: now, ids };
  try { fs.writeFileSync(arec("pcshares.json"), JSON.stringify(sh)); } catch {}
  return code;
}
const cleanIds = (o) => { const out = {}; for (const c of CATS) if (o && typeof o[c] === "string" && /^[cs][\w]{1,20}$/.test(o[c])) out[c] = o[c]; return out; };

const brief = (p) => ({ id: p.id, cat: p.cat, name: p.name, 規格: (p.spec || "").slice(0, 90), 原價屋: p.c ? p.c.p : null, 欣亞: p.s ? p.s.p : null, 較便宜: p.c && p.s ? (p.c.p === p.s.p ? "一樣" : p.c.p < p.s.p ? "原價屋" : "欣亞") : p.c ? "只有原價屋" : "只有欣亞" });
function json(res, o, code = 200) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); return true; }
function buildReply(sel, mode, extra, notes) {
  const t = totals(sel);
  const ids = {}; for (const c of CAT_LIST) if (sel[c]) ids[c] = sel[c].id;
  return {
    配單代碼: makeShare(ids), ...extra, 更新時間: state.ts,
    零件: CAT_LIST.filter((c) => sel[c]).map((c) => ({ 類別: CAT_NAME[c], ...brief(sel[c]), 取價: priceOf(sel[c], mode) })),
    尚未選的類別: CAT_LIST.filter((c) => !sel[c]).map((c) => CAT_NAME[c]),
    合計: { 混搭最省: t.min, 原價屋全買: t.c, 欣亞全買: t.s, 原價屋缺貨零件: t.missC.map((c) => CAT_NAME[c]), 欣亞缺貨零件: t.missS.map((c) => CAT_NAME[c]) },
    相容性: check(sel).map((x) => `${x.lv === "err" ? "❌" : x.lv === "warn" ? "⚠️" : "✅"} ${x.msg}`), 備註: notes || [],
  };
}
function handleTools(u, res) {
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
    for (const c of CAT_LIST) if (e.ids[c]) { const p = find(e.ids[c]); if (p) sel[c] = p; else notes.push(`${CAT_NAME[c]}原本的零件已經下架或找不到，已移除`); }
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
  if (u.pathname === "/api/pc/search") {
    const cat = u.searchParams.get("cat") || "", q = (u.searchParams.get("q") || "").toUpperCase().split(/\s+/).filter(Boolean);
    const cats = CATS.includes(cat) ? [cat] : CATS;
    const out = [];
    for (const c of cats) for (const p of state.parts[c] || []) {
      const hay = (p.name + " " + p.brand + " " + p.spec).toUpperCase();
      if (q.every((w) => hay.includes(w))) out.push(p);
    }
    out.sort((a, b) => (priceOf(a) || 0) - (priceOf(b) || 0));
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
  if (/^\/api\/pc\/(rec|search|trend|share|load|edit)$/.test(u.pathname)) return handleTools(u, res);
  if (u.pathname === "/api/pc/data") {
    if (!state.gz) { res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "30" }); res.end('{"err":"loading"}'); return true; }
    const ae = String(req.headers["accept-encoding"] || "");
    const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" };
    if (/\bgzip\b/.test(ae)) { res.writeHead(200, { ...h, "Content-Encoding": "gzip" }); res.end(state.gz); }
    else { res.writeHead(200, h); res.end(state.json); }
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
