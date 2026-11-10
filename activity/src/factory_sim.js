// 自動化工廠：模擬核心（純邏輯，不碰畫面，之後要搬到伺服器也可以）。
// 格子地圖，每格最多一個東西；物品在傳送帶上一格一格移動。方向 0右 1下 2左 3上。
export const W = 28, H = 16;                 // 地圖最大尺寸；一開始只開發左上角一塊，之後可以花錢擴地
export const LANDS = [[20, 12], [24, 14], [28, 16]];
export const LAND_COST = [0, 600, 2500];     // 擴到第 N 級要多少錢
export const landSize = (g) => LANDS[g.land || 0];
export const MILESTONES = [[500, 50], [2000, 150], [6000, 400], [15000, 900], [40000, 2000], [100000, 5000], [300000, 15000]];   // [累計出貨, 獎金]
export const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
export const BELT_STEP = 3;                 // 傳送帶每 3 個 tick 前進一格
export const START_MONEY = 150;
// 電費：每台機器每分鐘耗電（度）。電用完整座工廠就停工，要儲值（現在用遊戲幣買，之後可改成代幣）。
export const POWER_USE = { belt: 0.1, bridge: 0.1, splitter: 0.5, filter: 0.5, chest: 0.3, miner: 1.5, smelter: 2.5, assembler: 3.5, shipper: 0.5 };
export const POWER_PRICE = 1;               // 1 度 = $1
export const START_POWER = 100;

export const KINDS = {
  belt:      { name: "傳送帶", cost: 1 },
  bridge:    { name: "橋", cost: 12 },                                    // 兩條帶子交叉用：橫向、縱向各走各的，互不干擾（直線穿過，不轉彎）
  filter:    { name: "過濾器", cost: 25 },                                  // 指定一種東西往前走，其他的往左右分出去（混在一條線上時用）
  chest:     { name: "倉庫", cost: 20, cap: 100 },                        // 緩衝箱：什麼都收（最多 100 個），慢慢從出口放出來；產線塞住時可以先擋一下
  splitter:  { name: "分流器", cost: 15 },                              // 把收到的東西輪流丟給前、左、右三個方向（收不下的那邊會跳過）
  miner:     { name: "採礦機", cost: 25, every: 15 },                    // 只能放在礦點上，每 1.5 秒出 1 礦
  smelter:   { name: "熔爐", cost: 45, cap: 4, time: 20 },               // 鐵礦→鐵板、銅礦→銅板（同一時間只處理一種）
  assembler: { name: "組裝機", cost: 90 },                               // 照配方組裝，點「配方」工具切換
  shipper:   { name: "出貨口", cost: 10 },
};
export const SMELT = { iron_ore: "iron_plate", copper_ore: "copper_plate", gold_ore: "gold_plate" };
export const ORE_ITEM = { iron: "iron_ore", copper: "copper_ore", gold: "gold_ore" };
// 配方：in 是需要的材料（每次消耗），out 是產出數量
export const RECIPES = [
  { id: "gear",    name: "齒輪",   in: { iron_plate: 2 },                  make: "gear",    n: 1, time: 30 },
  { id: "wire",    name: "電線",   in: { copper_plate: 1 },                make: "wire",    n: 2, time: 20 },
  { id: "circuit", name: "電路板", in: { iron_plate: 1, wire: 3 },         make: "circuit", n: 1, time: 40 },
  { id: "motor",   name: "馬達",   in: { gear: 2, circuit: 1, copper_plate: 2 }, make: "motor", n: 1, time: 60 },
  { id: "steel",   name: "鋼板",   in: { iron_plate: 3 },                  make: "steel",   n: 1, time: 50 },
  { id: "battery", name: "電池",   in: { steel: 1, copper_plate: 2, wire: 2 }, make: "battery", n: 1, time: 70 },
  { id: "chip",    name: "晶片",   in: { circuit: 2, gold_plate: 1 },      make: "chip",    n: 1, time: 80 },
  { id: "robot",   name: "機器人", in: { motor: 1, circuit: 2, battery: 1 }, make: "robot", n: 1, time: 90 },
  { id: "ai",      name: "AI 核心", in: { chip: 2, battery: 1, motor: 1 }, make: "ai_core", n: 1, time: 120 },
];
export const ITEMS = {
  iron_ore:     { name: "鐵礦",   value: 2,  color: "#a1887f" },
  copper_ore:   { name: "銅礦",   value: 2,  color: "#d98b5f" },
  iron_plate:   { name: "鐵板",   value: 6,  color: "#cfd8dc" },
  copper_plate: { name: "銅板",   value: 6,  color: "#f0a36b" },
  gear:         { name: "齒輪",   value: 20, color: "#ffb74d" },
  wire:         { name: "電線",   value: 4,  color: "#ff8a65" },
  circuit:      { name: "電路板", value: 60, color: "#66bb6a" },
  motor:        { name: "馬達",   value: 200, color: "#4fc3f7" },
  steel:        { name: "鋼板",   value: 30, color: "#90a4ae" },
  battery:      { name: "電池",   value: 110, color: "#aed581" },
  robot:        { name: "機器人", value: 700, color: "#ce93d8" },
  gold_ore:     { name: "金礦",   value: 6,  color: "#e6c84f" },
  gold_plate:   { name: "金板",   value: 22, color: "#ffd54f" },
  chip:         { name: "晶片",   value: 340, color: "#26c6da" },
  ai_core:      { name: "AI 核心", value: 1800, color: "#ff5252" },
};
// 升級：每級 -20% 時間（節能是 -10% 耗電）。第 L 級升到 L+1 要 150 × 2^L
export const UPGRADES = {
  miner:     { name: "採礦機加速", desc: "出礦間隔 -20% / 級" },
  smelter:   { name: "熔爐加速",   desc: "熔煉時間 -20% / 級" },
  assembler: { name: "組裝機加速", desc: "組裝時間 -20% / 級" },
  power:     { name: "節能",       desc: "全廠耗電 -10% / 級" },
};
export const MAX_LV = 5;
export const upCost = (lv) => 150 * 2 ** lv;
const mulT = (g, k) => 0.8 ** (g.up[k] || 0);
export const VALUE = Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, v.value]));

// 礦點：index → "iron" / "copper"
export function makeOre() {
  const ore = new Map();
  const patch = (x0, y0, w, h, t) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) ore.set(y * W + x, t); };
  patch(1, 2, 4, 3, "iron"); patch(2, 8, 3, 3, "iron"); patch(14, 1, 3, 3, "copper"); patch(15, 8, 4, 3, "copper");
  patch(20, 4, 3, 3, "iron"); patch(21, 9, 3, 3, "copper"); patch(25, 12, 3, 3, "gold");   // 擴地之後才會用到的礦
  return ore;
}

const newCell = (k, dir, ore) => ({ k, dir, item: null, out: [], inv: {}, prog: 0, ago: 99, rr: 0, r: 0, ore: ore || null, cur: null, stall: 0, lane: [null, null], f: "" });
export function newGame() {
  const g = { land: 0, ms: 0, cells: new Array(W * H).fill(null), money: START_MONEY, power: START_POWER, off: false, tick: 0, shipped: 0, log: [], up: { miner: 0, smelter: 0, assembler: 0, power: 0 }, orders: [], oid: 0, done: 0, sold: {}, note: "" };
  fillOrders(g); return g;
}
// ---- 訂單：隨機要幾個東西，用出貨口送進去就算（東西照樣按售價賣錢），交齊了再拿一筆額外獎金
export function fillOrders(g) {
  const p = g.shipped, pool = [["iron_plate", 10, 20], ["copper_plate", 10, 20], ["wire", 10, 20], ["gear", 5, 10]];
  if (p >= 200) pool.push(["circuit", 3, 6]);
  if (p >= 400) pool.push(["steel", 5, 10]);
  if (p >= 1200) pool.push(["motor", 2, 4], ["battery", 3, 5]);
  if (p >= 2500) pool.push(["gold_plate", 5, 10]);
  if (p >= 8000) pool.push(["chip", 2, 4]);
  if (p >= 25000) pool.push(["ai_core", 1, 2]);
  if (p >= 4000) pool.push(["robot", 1, 2]);
  while (g.orders.length < 3) {
    const free = pool.filter(([k]) => !g.orders.some((o) => o.item === k)); if (!free.length) break;
    const [item, lo, hi] = free[Math.floor(Math.random() * free.length)], need = lo + Math.floor(Math.random() * (hi - lo + 1));
    g.orders.push({ id: ++g.oid, item, need, got: 0, reward: Math.round(need * ITEMS[item].value * 1.5) });
  }
}
export function upgrade(g, k) {
  if (!UPGRADES[k]) return "沒有這個升級";
  const lv = g.up[k] || 0; if (lv >= MAX_LV) return "已經滿級";
  const c = upCost(lv); if (g.money < c) return "錢不夠";
  g.money -= c; g.up[k] = lv + 1; return "";
}
const at = (g, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : g.cells[y * W + x]);
const invN = (c) => Object.values(c.inv).reduce((s, n) => s + n, 0);

// c 能不能再收下 item（srcDir：來源前進的方向，用來擋「迎面接」；pend：這個 tick 已經預訂的數量）
function accepts(c, item, srcDir, pend) {
  if (!c) return false;
  pend = pend || 0;
  if (c.k === "belt") return c.dir !== (srcDir + 2) % 4 && !c.item;
  if (c.k === "shipper") return true;
  if (c.k === "splitter" || c.k === "filter") return !c.item && !pend;
  if (c.k === "bridge") return !c.lane[srcDir & 1] && !pend;
  if (c.k === "chest") return invN(c) + pend < KINDS.chest.cap;
  if (c.k === "smelter") return !!SMELT[item] && (!c.cur || c.cur === item) && invN(c) + pend < KINDS.smelter.cap;
  if (c.k === "assembler") { const need = RECIPES[c.r].in[item]; return !!need && (c.inv[item] || 0) + pend < need * 2; }
  return false;
}

// 這格能不能放這種東西（不改任何東西）；回傳錯誤說明，空字串代表可以
export function canPlace(g, ore, x, y, k, dir) {
  const [lw, lh] = landSize(g);
  if (x < 0 || y < 0 || x >= lw || y >= lh) return "這裡還沒開發（可以花錢擴地）";
  const i = y * W + x, cur = g.cells[i];
  if (cur && cur.k === k) return cur.dir !== dir ? "" : "這格已經有了";
  if (cur) return "這格有東西，先拆掉";
  if (k === "miner" && !ore.has(i)) return "採礦機只能放在礦點上";
  if (g.money < KINDS[k].cost) return "錢不夠";
  return "";
}
export function place(g, ore, x, y, k, dir) {
  const err = canPlace(g, ore, x, y, k, dir); if (err) return err;
  const i = y * W + x, cur = g.cells[i];
  if (cur) { cur.dir = dir; return ""; }          // 同種機器：只是轉方向
  g.money -= KINDS[k].cost;
  g.cells[i] = newCell(k, dir, k === "miner" ? ore.get(i) : null);
  return "";
}
export function remove(g, x, y) {
  const i = y * W + x, c = g.cells[i]; if (!c) return;
  g.money += Math.floor(KINDS[c.k].cost / 2); g.cells[i] = null;
}
// 組裝機換下一個配方（機器裡的材料清掉）
export function setRecipe(g, x, y, r) {
  const c = at(g, x, y); if (!c || c.k !== "assembler" || c.r === r) return false;
  c.r = r; c.inv = {}; c.out = []; c.prog = 0; return true;
}
export function cycleRecipe(g, x, y) { const c = at(g, x, y); return !!c && c.k === "assembler" && setRecipe(g, x, y, (c.r + 1) % RECIPES.length); }
// 給畫面用：機器現在的狀態。work 工作中／wait 等材料／blocked 出口堵住／idle 空閒
export function machineState(c) {
  if (c.out.length && c.stall > 10) return { s: "blocked", text: "出口堵住了：前面那格收不下（帶子滿了、方向不對，或前方的機器不收這種東西）" };
  if (c.k === "miner") return { s: "work", text: "採礦中" };
  if (c.prog > 0) return { s: "work", text: "工作中" };
  if (c.k === "smelter") return { s: "wait", text: "等材料：需要鐵礦或銅礦" };
  if (c.k === "assembler") {
    const R = RECIPES[c.r], miss = Object.entries(R.in).filter(([k, n]) => (c.inv[k] || 0) < n).map(([k, n]) => `${ITEMS[k].name} ×${n - (c.inv[k] || 0)}`);
    return miss.length ? { s: "wait", text: "還缺：" + miss.join("、") } : { s: "work", text: "準備開工" };
  }
  return { s: "idle", text: "" };
}

// 擴地
export function buyLand(g) {
  const n = (g.land || 0) + 1; if (n >= LANDS.length) return "已經是最大的地";
  if (g.money < LAND_COST[n]) return "錢不夠";
  g.money -= LAND_COST[n]; g.land = n; return "";
}
// 復原：只還原機器與錢（傳送帶上的東西不還原）
export const snap = (g) => ({ m: g.money, land: g.land || 0, c: structuredClone(g.cells) });
export function restore(g, s) { g.money = s.m; g.land = s.land; g.cells = structuredClone(s.c); }
export function setFilter(g, x, y, item) { const c = at(g, x, y); if (!c || c.k !== "filter") return false; c.f = item || ""; c.item = null; return true; }
// 全廠每分鐘耗電（度）
export function powerRate(g) { let r = 0; for (const c of g.cells) if (c) r += POWER_USE[c.k]; return r * 0.9 ** (g.up.power || 0); }
export function buyPower(g, units) {
  const cost = Math.round(units * POWER_PRICE);
  if (!(units > 0)) return "數量不對";
  if (g.money < cost) return "錢不夠";
  g.money -= cost; g.power += units; return "";
}
// 前進一個 tick（沒電就整座工廠停工，tick 也不走）
export function step(g) {
  const rate = powerRate(g);
  if (g.power <= 0 && rate > 0) { g.off = true; return; }
  g.off = false; g.power = Math.max(0, g.power - rate / 600);
  g.tick++;
  // 1) 機器：處理、產出、把成品推給面向的那一格
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g.cells[y * W + x]; if (!c || c.k === "belt" || c.k === "shipper") continue;
    if (c.k === "bridge") {
      for (let a = 0; a < 2; a++) {
        const L = c.lane[a]; if (!L) continue;
        const t = at(g, x + DX[L.d], y + DY[L.d]);
        if (accepts(t, L.item, L.d)) { give(g, t, L.item, L.d); c.lane[a] = null; }
      }
      continue;
    }
    if (c.k === "splitter" || c.k === "filter") {
      if (c.item) {
        // 分流器：前、右、左輪流。過濾器：符合的往前，不符合的往右、左輪流（沒設定時全部往前）
        const outs = c.k === "splitter" ? [0, 1, 3] : !c.f || c.item === c.f ? [0] : [1, 3];
        for (let n = 0; n < outs.length; n++) {
          const d = (c.dir + outs[(c.rr + n) % outs.length]) & 3;
          const t = at(g, x + DX[d], y + DY[d]);
          if (accepts(t, c.item, d)) { give(g, t, c.item, d); c.item = null; c.rr = (c.rr + n + 1) % outs.length; break; }
        }
      }
      continue;
    }
    if (c.k === "miner") {
      c.prog++;
      if (c.out.length < 1 && c.prog >= Math.max(3, Math.round(KINDS.miner.every * mulT(g, "miner")))) { c.out.push(ORE_ITEM[c.ore] || "iron_ore"); c.prog = 0; }
    } else if (c.k === "chest") {
      if (!c.out.length) { const it = Object.keys(c.inv).find((k) => c.inv[k] > 0); if (it) { c.inv[it]--; c.out.push(it); } }
    } else if (c.k === "smelter") {
      if (c.prog > 0) { if (--c.prog === 0) { c.out.push(SMELT[c.cur]); if (invN(c) === 0) c.cur = null; } }
      else if (c.out.length < 2) {
        const it = Object.keys(c.inv).find((k) => c.inv[k] > 0);
        if (it) { c.inv[it]--; c.cur = it; c.prog = Math.max(4, Math.round(KINDS.smelter.time * mulT(g, "smelter"))); }
      }
    } else if (c.k === "assembler") {
      const R = RECIPES[c.r];
      if (c.prog > 0) { if (--c.prog === 0) for (let n = 0; n < R.n; n++) c.out.push(R.make); }
      else if (c.out.length < 4 && Object.entries(R.in).every(([k, n]) => (c.inv[k] || 0) >= n)) {
        for (const [k, n] of Object.entries(R.in)) c.inv[k] -= n;
        c.prog = Math.max(5, Math.round(R.time * mulT(g, "assembler")));
      }
    }
    if (c.out.length) {
      const t = at(g, x + DX[c.dir], y + DY[c.dir]);
      if (accepts(t, c.out[0], c.dir)) { give(g, t, c.out.shift(), c.dir); c.stall = 0; } else c.stall++;
    } else c.stall = 0;
  }
  // 2) 傳送帶：每 BELT_STEP 個 tick 前進一次
  for (const c of g.cells) if (c && c.k === "belt") c.ago++;
  if (g.tick % BELT_STEP) return;
  const belts = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = g.cells[y * W + x]; if (c && c.k === "belt" && c.item) belts.push([c, x, y]); }
  const state = new Map(), claim = new Map(), pend = new Map(), pendB = new Map();
  const res = (c, x, y) => {
    if (state.has(c)) return state.get(c);
    state.set(c, false);                                  // 繞圈圈的情況先當作動不了
    const tx = x + DX[c.dir], ty = y + DY[c.dir], t = at(g, tx, ty);
    let ok = false;
    if (t && t.k === "belt") {
      if (t.dir !== (c.dir + 2) % 4 && !claim.has(t)) ok = !t.item || res(t, tx, ty);
      if (ok) claim.set(t, c);
    } else if (t && t.k === "bridge") {                    // 橋：橫向、縱向各算各的
      const pb = pendB.get(t) || [0, 0], ax = c.dir & 1;
      if (accepts(t, c.item, c.dir, pb[ax])) { ok = true; pb[ax]++; pendB.set(t, pb); }
    } else if (t && accepts(t, c.item, c.dir, pend.get(t) || 0)) { ok = true; pend.set(t, (pend.get(t) || 0) + 1); }
    state.set(c, ok); return ok;
  };
  for (const [c, x, y] of belts) res(c, x, y);
  const moves = belts.filter(([c]) => state.get(c));
  const items = moves.map(([c]) => c.item);
  for (const [c] of moves) c.item = null;
  moves.forEach(([c, x, y], i) => give(g, at(g, x + DX[c.dir], y + DY[c.dir]), items[i], c.dir));
}

function give(g, t, item, dir) {
  if (t.k === "belt") { t.item = item; t.ago = 0; }
  else if (t.k === "bridge") { t.lane[dir & 1] = { item, d: dir }; }
  else if (t.k === "splitter" || t.k === "filter") { t.item = item; }
  else if (t.k === "shipper") {
    const v = VALUE[item] || 0; g.money += v; g.shipped += v; g.log.push([g.tick, v]); if (g.log.length > 400) g.log.shift();
    g.sold[item] = (g.sold[item] || 0) + 1;
    while (g.ms < MILESTONES.length && g.shipped >= MILESTONES[g.ms][0]) { const [at, rw] = MILESTONES[g.ms++]; g.money += rw; g.note = `里程碑：累計出貨 $${at.toLocaleString("en-US")}，獎金 $${rw}`; }
    const o = g.orders.find((x) => x.item === item && x.got < x.need);
    if (o && ++o.got >= o.need) {
      g.money += o.reward; g.shipped += o.reward; g.done++; g.note = `訂單完成：${ITEMS[o.item].name} ×${o.need}，額外獎金 $${o.reward}`;
      g.orders = g.orders.filter((x) => x !== o); fillOrders(g);
    }
  }
  else if (t.k === "chest") { t.inv[item] = (t.inv[item] || 0) + 1; }
  else t.inv[item] = (t.inv[item] || 0) + 1;
}

// 最近 60 秒（600 tick）的出貨金額
export function perMinute(g) { const from = g.tick - 600; return g.log.filter(([t]) => t > from).reduce((s, [, v]) => s + v, 0); }

export function serialize(g) {
  return { v: 5, land: g.land || 0, ms: g.ms || 0, up: g.up, o: g.orders, oid: g.oid, dn: g.done, sd: g.sold, m: g.money, p: Math.round(g.power * 100) / 100, s: g.shipped,
    c: g.cells.map((c, i) => (c ? [i % W, Math.floor(i / W), c.k, c.dir, c.r || 0, c.ore || "", c.f || ""] : null)).filter(Boolean) };
}
export function load(o) {
  const g = newGame();
  if (o && Array.isArray(o.c)) {
    if (o.up) for (const k of Object.keys(g.up)) g.up[k] = Math.max(0, Math.min(MAX_LV, o.up[k] | 0));
    if (Array.isArray(o.o)) g.orders = o.o.filter((x) => ITEMS[x.item] && x.need > 0).slice(0, 3).map((x) => ({ id: x.id | 0, item: x.item, need: x.need | 0, got: Math.min(x.got | 0, x.need | 0), reward: x.reward | 0 }));
    g.oid = o.oid | 0; g.done = o.dn | 0; g.sold = o.sd && typeof o.sd === "object" ? o.sd : {};
    g.land = Math.max(0, Math.min(LANDS.length - 1, o.land | 0)); g.ms = Math.max(0, Math.min(MILESTONES.length, o.ms | 0));
    g.money = Number(o.m) || 0; g.shipped = Number(o.s) || 0; g.power = typeof o.p === "number" ? o.p : 150;   // 舊存檔送 150 度
    if (!o.v || o.v < 5) { g.ms = MILESTONES.filter(([a]) => g.shipped >= a).length; }   // 舊存檔：不補發之前的里程碑獎金
    const [lw, lh] = landSize(g);
    for (const e of o.c) {
      let x, y, k, dir, r, ore, f;
      if (o.v >= 5) [x, y, k, dir, r, ore, f] = e; else { const i = e[0]; x = i % 20; y = Math.floor(i / 20); [, k, dir, r, ore] = e; }   // v4 以前地圖寬 20，存的是一維索引
      if (KINDS[k] && x >= 0 && y >= 0 && x < lw && y < lh) { const c = newCell(k, dir & 3, ore || null); c.r = (r | 0) % RECIPES.length; c.f = ITEMS[f] ? f : ""; g.cells[y * W + x] = c; }
    }
  }
  fillOrders(g);
  return g;
}
