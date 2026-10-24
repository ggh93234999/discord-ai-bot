// 種菜（個人農場，即時生長）：每個身分一塊田，作物按真實時間長大，關掉 Activity 也照長。
// 數字和規則全部在這個檔案，前端只負責畫。
// 錢：賭注模式用機器人錢包的真代幣（買種子扣、賣菜補發）；練習模式用農場自己的練習幣（存在 farm.json）。
// 經濟：每塊地一次產 3 個，3 個賣價合計約是種子價的 1.16 倍，加上稀有變種期望值約 +18% 左右；
// 每塊地每小時大約賺 40 代幣上下，不會比賭場／鍛造容易賺。
// 果樹（tree:true）：種一次不用再買，每隔一段時間結一次果（一次至少 20 個），收成後樹還在、重新計時；
//   別人可以偷、次數不限、同一個人可以偷很多次，但每棵樹每次最多只能被偷走一半（floor(產量/2)）。
//   單價 = 樹苗價 × 1.25 ÷ 一半的數量（進位），所以就算被偷到只剩一半，主人這一輪賣掉也至少賺回樹苗錢的 1.25 倍，不會虧本。
// 偷菜：別人的田成熟 5 分鐘後才能偷，每塊地最多被偷 2 個（同一個人只能偷一次），主人至少留 1 個；每人每天最多偷 20 個。
import fs from "node:fs";
import { randomInt, randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { botSettle, botPay, botInfo } from "./bet.js";

export const CROPS = [
  { id: "radish", icon: "🥕", name: "蘿蔔", seed: 10, min: 3, y: 5 },
  { id: "cabbage", icon: "🥬", name: "小白菜", seed: 30, min: 10, y: 5 },
  { id: "tomato", icon: "🍅", name: "番茄", seed: 80, min: 30, y: 5 },
  { id: "corn", icon: "🌽", name: "玉米", seed: 200, min: 60, y: 4 },
  { id: "pumpkin", icon: "🎃", name: "南瓜", seed: 600, min: 180, y: 4 },
  { id: "melon", icon: "🍉", name: "西瓜", seed: 1500, min: 480, y: 4 },
  // 果樹：seed = 樹苗價（只買一次），min = 每輪結果要幾分鐘，y = 每輪結幾個
  { id: "cherry", icon: "🍒", name: "櫻桃", seed: 60, min: 60, y: 20, tree: true },
  { id: "blueberry", icon: "🫐", name: "藍莓", seed: 120, min: 120, y: 22, tree: true },
  { id: "starfruit", icon: "⭐", name: "楊桃", seed: 180, min: 180, y: 24, tree: true },
  { id: "peach", icon: "🍑", name: "水蜜桃", seed: 240, min: 240, y: 24, tree: true },
  { id: "grape", icon: "🍇", name: "麝香葡萄", seed: 360, min: 360, y: 26, tree: true },
  { id: "mango", icon: "🥭", name: "愛文芒果", seed: 480, min: 480, y: 28, tree: true },
  { id: "avocado", icon: "🥑", name: "酪梨", seed: 720, min: 720, y: 30, tree: true },
];
const CROP = Object.fromEntries(CROPS.map((c) => [c.id, c]));
const yieldOf = (c) => CROP[c].y;                // 每塊地一次收幾個（每種作物不同，見 CROPS）
const UNIT_RATE = 0.36;                          // 單個賣價 = 種子價 × 0.36；靠產量（4～5 個）讓被偷 1 個後還是賺，單價不隨被偷調整
const TREE_PROFIT = 1.25;                         // 果樹：被偷到只剩一半時，主人這一輪的收入至少是樹苗價的幾倍
const keepMin = (c) => Math.ceil(CROP[c].y / 2);   // 果樹每輪最少能留給主人的數量
const stealMax = (c) => (CROP[c].tree ? Math.floor(CROP[c].y / 2) : STEAL_PER_PLOT);   // 每塊地（每棵樹）每輪最多被偷幾個
export const unitPrice = (c) => (CROP[c].tree ? Math.ceil((CROP[c].seed * TREE_PROFIT) / keepMin(c)) : Math.max(1, Math.round(CROP[c].seed * UNIT_RATE)));
// 稀有變種：每個收成各自抽一次
export const VARIANTS = { n: { name: "", mult: 1 }, big: { name: "大顆", mult: 2 }, gold: { name: "金色", mult: 5 } };
const rollVariant = () => { const r = randomInt(1000); return r < 10 ? "gold" : r < 60 ? "big" : "n"; };
const START_PLOTS = 6, MAX_PLOTS = 24, PRACTICE_START = 300;
const plotCost = (np) => 500 * (np - START_PLOTS + 1);          // 從 np 塊買到 np+1 塊
const STEAL_GRACE = 5 * 60_000, STEAL_PER_PLOT = 1, STEAL_PER_DAY = 20, LOG_MAX = 20;
const ripeAt = (p) => p.at + CROP[p.c].min * 60_000;

// ---- 存檔
const FFILE = fileURLToPath(new URL("./farm.json", import.meta.url));
let db = { farms: {}, pend: {} };
try { db = { farms: {}, pend: {}, ...JSON.parse(fs.readFileSync(FFILE, "utf8")) }; } catch {}
let saveT = 0;
export function farmSave(now = false) {
  const w = () => { try { fs.writeFileSync(FFILE, JSON.stringify(db)); } catch (e) { console.log("農場存檔失敗", e.message); } };
  if (now) { clearTimeout(saveT); w(); return; }
  clearTimeout(saveT); saveT = setTimeout(w, 800);
}
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);     // 以台灣時間換日
const sid = (key) => createHash("sha1").update("farm:" + key).digest("hex").slice(0, 10);

function farmOf(key, create = true) {
  let f = db.farms[key];
  if (!f && create) f = db.farms[key] = { plots: Array(START_PLOTS).fill(null), inv: {}, coin: PRACTICE_START, nm: "", st: { d: "", n: 0 }, log: [] };
  if (f) while (f.plots.length < START_PLOTS) f.plots.push(null);
  return f;
}
const addInv = (f, c, v, n = 1) => { const k = c + "." + v; f.inv[k] = (f.inv[k] || 0) + n; };
const addLog = (f, txt, k = "") => {
  const last = f.log[f.log.length - 1], now = Date.now();
  if (k && last && last.k === k && now - last.ts < 10 * 60_000) { last.n = (last.n || 1) + 1; last.ts = now; last.txt = `${txt} ×${last.n}`; return; }     // 連續偷果樹：合併成「×N」
  f.log.push(k ? { ts: now, txt, k, n: 1 } : { ts: now, txt }); while (f.log.length > LOG_MAX) f.log.shift();
};

// ---- 賭注模式的錢
async function realBalance(ws) {
  if (typeof ws.crbal === "number") return ws.crbal;
  try { const r = await botInfo(ws.user.uid); if (r && typeof r.balance === "number") { ws.crbal = r.balance; return r.balance; } } catch {}
  return null;
}
const note = (ws, r) => { if (r && typeof r.balance === "number") ws.crbal = r.balance; return r; };
export async function recoverFarmPending() {
  for (const [id, v] of Object.entries(db.pend)) {
    try { const r = await botPay(v.uid, v.name, v.amount, v.why || "種菜補發"); if (r && r.ok) { console.log("農場補發", v.name, v.amount); delete db.pend[id]; } } catch {}
  }
  farmSave(true);
}

// ---- 給前端看的狀態
function viewOf(ws, f, real, bal) {
  const now = Date.now();
  const inv = Object.entries(f.inv).filter(([, n]) => n > 0).map(([k, n]) => {
    const [c, v] = k.split("."); return { k, c, v, n, unit: unitPrice(c) * VARIANTS[v].mult };
  });
  const day = today(), used = f.st.d === day ? f.st.n : 0;
  return {
    t: "fm", a: "view", real, now, np: f.plots.length, max: MAX_PLOTS, plotCost: f.plots.length < MAX_PLOTS ? plotCost(f.plots.length) : 0,
    plots: f.plots.map((p) => (p ? { c: p.c, left: Math.max(0, ripeAt(p) - now), grace: Math.max(0, ripeAt(p) + STEAL_GRACE - now), got: yieldOf(p.c) - p.st.length, stolen: p.st.length } : null)),
    inv, invValue: inv.reduce((s, x) => s + x.unit * x.n, 0),
    balance: real ? bal : f.coin, stealLeft: Math.max(0, STEAL_PER_DAY - used),
    log: f.log.slice(-8).reverse(),
    crops: CROPS.map((c) => ({ id: c.id, icon: c.icon, name: c.name, seed: c.seed, min: c.min, y: c.y, unit: unitPrice(c.id), tree: !!c.tree })),
  };
}

// 別人的農場（拜訪）
function visitView(ws, key, f, myKey) {
  const now = Date.now();
  return {
    t: "fm", a: "visit", id: sid(key), name: f.nm || (key.startsWith("p:g") ? "匿名農夫" : "玩家" + key.slice(-4)), np: f.plots.length, now,
    plots: f.plots.map((p) => {
      if (!p) return null;
      const left = Math.max(0, ripeAt(p) - now), grace = Math.max(0, ripeAt(p) + STEAL_GRACE - now);
      const tree = !!CROP[p.c].tree, max = stealMax(p.c);
      const canSteal = left === 0 && grace === 0 && p.st.length < max && (tree || !p.st.includes(myKey)) && key !== myKey;
      return { c: p.c, left, grace, canSteal, mineDone: !tree && p.st.includes(myKey), full: p.st.length >= max, tree, stealLeft: Math.max(0, max - p.st.length) };
    }),
  };
}

const findBySid = (prefix, id) => Object.keys(db.farms).find((k) => k.startsWith(prefix) && sid(k) === id);
const locks = new Set();

export async function handleFarm(ws, m) {
  const real = !!m.real;
  let id;
  if (real) { if (!ws.user) { out(ws, { t: "fm", a: "err", error: "need_login" }); return; } id = ws.user.uid; }
  else id = ws.user ? ws.user.uid : "g" + (String(m.pid || "").replace(/[^\w-]/g, "").slice(0, 40) || ws.cid || "x");
  const prefix = real ? "r:" : "p:", key = prefix + id;
  const err = (error, extra = {}) => out(ws, { t: "fm", a: "err", error, ...extra });
  const f = farmOf(key);
  if (ws.user && f.nm !== ws.user.name) { f.nm = ws.user.name; farmSave(); }
  const name = ws.user ? ws.user.name : "匿名農夫";
  const send = async () => out(ws, viewOf(ws, f, real, real ? await realBalance(ws) : null));
  const a = m.a;

  if (a === "get") { await send(); return; }
  if (a === "list") {
    const now = Date.now(), rows = [];
    for (const [k, g] of Object.entries(db.farms)) {
      if (!k.startsWith(prefix) || k === key) continue;
      const planted = g.plots.filter(Boolean); if (!planted.length) continue;
      const ripe = planted.filter((p) => ripeAt(p) <= now).length;
      rows.push({ id: sid(k), name: g.nm || (k.startsWith("p:g") ? "匿名農夫" : "玩家" + k.slice(-4)), np: g.plots.length, planted: planted.length, ripe });
    }
    rows.sort((x, y) => y.ripe - x.ripe || y.planted - x.planted);
    out(ws, { t: "fm", a: "list", real, rows: rows.slice(0, 40), total: rows.length });
    return;
  }
  if (a === "visit" || a === "steal") {
    const tk = findBySid(prefix, String(m.id || ""));
    const g = tk && db.farms[tk];
    if (!g) { err("no_farm"); return; }
    if (a === "steal") {
      const i = Number(m.i);
      if (tk === key) { err("self"); return; }
      const day = today(); if (f.st.d !== day) f.st = { d: day, n: 0 };
      const p = Number.isInteger(i) ? g.plots[i] : null;
      if (!p) { err("bad_plot"); return; }
      const tree = !!CROP[p.c].tree;
      if (!tree && f.st.n >= STEAL_PER_DAY) { err("steal_cap"); return; }      // 果樹不受每天次數限制
      if (Date.now() < ripeAt(p) + STEAL_GRACE) { err("not_ripe"); return; }
      if (p.st.length >= stealMax(p.c)) { err(tree ? "tree_half" : "no_more"); return; }
      if (!tree && p.st.includes(key)) { err("no_more"); return; }
      const v = rollVariant();
      p.st.push(key); if (!tree) f.st.n++; addInv(f, p.c, v);
      addLog(g, `${name} 偷走了你的 ${VARIANTS[v].name}${CROP[p.c].icon}`, tree ? `${key}|${p.c}|${v}` : "");
      farmSave(true);
      out(ws, { t: "fm", a: "stole", c: p.c, v, tree, left: STEAL_PER_DAY - f.st.n, treeLeft: Math.max(0, stealMax(p.c) - p.st.length) });
    }
    out(ws, visitView(ws, tk, g, key));
    return;
  }

  // ---- 以下會動到錢或田：同一個身分一次只處理一個
  if (locks.has(key)) { err("busy"); return; }
  locks.add(key);
  try {
    if (a === "plant") {
      const c = CROP[m.c]; if (!c) { err("bad_crop"); return; }
      const idx = m.i === "all" ? f.plots.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0) : [Number(m.i)];
      const empty = idx.filter((i) => Number.isInteger(i) && i >= 0 && i < f.plots.length && !f.plots[i]);
      if (!empty.length) { err("no_empty"); return; }
      let n = empty.length, cost = c.seed * n;
      if (real) {
        // 錢不夠買全部就少種幾塊
        const bal = await realBalance(ws);
        if (bal != null && bal < cost) { n = Math.floor(bal / c.seed); empty.length = n; cost = c.seed * n; }
        if (n < 1) { err("insufficient", { balance: bal }); return; }
        let r; try { r = note(ws, await botSettle(ws.user.uid, ws.user.name, cost, 0, "種菜買種子")); } catch { r = { ok: false, error: "bot_down" }; }
        if (!r || !r.ok) { err(r && r.error === "insufficient" ? "insufficient" : "bot_down", { balance: r && r.balance }); return; }
      } else {
        if (f.coin < cost) { n = Math.floor(f.coin / c.seed); empty.length = n; cost = c.seed * n; }
        if (n < 1) { err("insufficient", { balance: f.coin }); return; }
        f.coin -= cost;
      }
      const at = Date.now();
      for (const i of empty) f.plots[i] = { c: c.id, at, st: [] };
      farmSave(true);
      await send(); return;
    }
    if (a === "harvest") {
      const now = Date.now();
      const idx = m.i === "all" ? f.plots.map((_, i) => i) : [Number(m.i)];
      const got = [];
      for (const i of idx) {
        const p = Number.isInteger(i) ? f.plots[i] : null;
        if (!p || ripeAt(p) > now) continue;
        for (let u = 0; u < yieldOf(p.c) - p.st.length; u++) { const v = rollVariant(); addInv(f, p.c, v); got.push({ c: p.c, v }); }
        if (CROP[p.c].tree) { p.at = now; p.st = []; }      // 果樹：樹留著，重新計時、被偷的紀錄清掉
        else f.plots[i] = null;
      }
      if (!got.length) { err("none_ripe"); return; }
      farmSave(true);
      out(ws, { t: "fm", a: "got", got });
      await send(); return;
    }
    if (a === "sell") {
      const keys = m.k === "all" ? Object.keys(f.inv) : [String(m.k)];
      let amt = 0; const taken = {};
      for (const k of keys) {
        const n = f.inv[k]; if (!n || n < 1) continue;
        const [c, v] = k.split("."); if (!CROP[c] || !VARIANTS[v]) continue;
        amt += n * unitPrice(c) * VARIANTS[v].mult; taken[k] = n;
      }
      if (amt < 1) { err("nothing"); return; }
      for (const k of Object.keys(taken)) { f.inv[k] -= taken[k]; if (f.inv[k] <= 0) delete f.inv[k]; }
      if (real) {
        const pid = "s:" + randomBytes(5).toString("hex");
        db.pend[pid] = { uid: ws.user.uid, name: ws.user.name, amount: amt, why: "種菜賣菜" };     // 先記下，賣出中途重啟就補發
        farmSave(true);
        let r; try { r = note(ws, await botPay(ws.user.uid, ws.user.name, amt, "種菜賣菜")); } catch { r = { ok: false }; }
        if (!r || !r.ok) { for (const k of Object.keys(taken)) f.inv[k] = (f.inv[k] || 0) + taken[k]; delete db.pend[pid]; farmSave(true); err("bot_down"); return; }
        delete db.pend[pid];
      } else f.coin += amt;
      farmSave(true);
      out(ws, { t: "fm", a: "sold", amount: amt });
      await send(); return;
    }
    if (a === "chop") {      // 砍掉果樹（不退錢），空出那塊地
      const i = Number(m.i), p = Number.isInteger(i) ? f.plots[i] : null;
      if (!p || !CROP[p.c].tree) { err("bad_plot"); return; }
      f.plots[i] = null; farmSave(true);
      await send(); return;
    }
    if (a === "buyplot") {
      if (f.plots.length >= MAX_PLOTS) { err("max_plots"); return; }
      const cost = plotCost(f.plots.length);
      if (real) {
        let r; try { r = note(ws, await botSettle(ws.user.uid, ws.user.name, cost, 0, "種菜擴地")); } catch { r = { ok: false, error: "bot_down" }; }
        if (!r || !r.ok) { err(r && r.error === "insufficient" ? "insufficient" : "bot_down", { balance: r && r.balance }); return; }
      } else {
        if (f.coin < cost) { err("insufficient", { balance: f.coin }); return; }
        f.coin -= cost;
      }
      f.plots.push(null); farmSave(true);
      await send(); return;
    }
    if (a === "reset" && !real) { if (f.coin < 1 && !Object.keys(f.inv).length) { f.coin = PRACTICE_START; farmSave(true); } await send(); return; }
  } catch (e) { console.log("農場錯誤", e && e.message); err("error"); }
  finally { locks.delete(key); }
}

// 啟動時要用到的小工具（測試用）
export const _test = { db: () => db, ripeAt, plotCost, rollVariant };
