// 自動化工廠：模擬核心（純邏輯，不碰畫面，之後要搬到伺服器也可以）。
// 格子地圖，每格最多一個東西；物品在傳送帶上一格一格移動。方向 0右 1下 2左 3上。
export const W = 20, H = 12;
export const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
export const BELT_STEP = 3;                 // 傳送帶每 3 個 tick 前進一格
export const START_MONEY = 150;
// 電費：每台機器每分鐘耗電（度）。電用完整座工廠就停工，要儲值（現在用遊戲幣買，之後可改成代幣）。
export const POWER_USE = { belt: 0.1, splitter: 0.5, miner: 1.5, smelter: 2.5, assembler: 3.5, shipper: 0.5 };
export const POWER_PRICE = 1;               // 1 度 = $1
export const START_POWER = 100;

export const KINDS = {
  belt:      { name: "傳送帶", cost: 1 },
  splitter:  { name: "分流器", cost: 15 },                              // 把收到的東西輪流丟給前、左、右三個方向（收不下的那邊會跳過）
  miner:     { name: "採礦機", cost: 25, every: 15 },                    // 只能放在礦點上，每 1.5 秒出 1 礦
  smelter:   { name: "熔爐", cost: 45, cap: 4, time: 20 },               // 鐵礦→鐵板、銅礦→銅板（同一時間只處理一種）
  assembler: { name: "組裝機", cost: 90 },                               // 照配方組裝，點「配方」工具切換
  shipper:   { name: "出貨口", cost: 10 },
};
export const SMELT = { iron_ore: "iron_plate", copper_ore: "copper_plate" };
// 配方：in 是需要的材料（每次消耗），out 是產出數量
export const RECIPES = [
  { id: "gear",    name: "齒輪",   in: { iron_plate: 2 },                  make: "gear",    n: 1, time: 30 },
  { id: "wire",    name: "電線",   in: { copper_plate: 1 },                make: "wire",    n: 2, time: 20 },
  { id: "circuit", name: "電路板", in: { iron_plate: 1, wire: 3 },         make: "circuit", n: 1, time: 40 },
  { id: "motor",   name: "馬達",   in: { gear: 2, circuit: 1, copper_plate: 2 }, make: "motor", n: 1, time: 60 },
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
};
export const VALUE = Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, v.value]));

// 礦點：index → "iron" / "copper"
export function makeOre() {
  const ore = new Map();
  const patch = (x0, y0, w, h, t) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) ore.set(y * W + x, t); };
  patch(1, 2, 4, 3, "iron"); patch(2, 8, 3, 3, "iron"); patch(14, 1, 3, 3, "copper"); patch(15, 8, 4, 3, "copper");
  return ore;
}

const newCell = (k, dir, ore) => ({ k, dir, item: null, out: [], inv: {}, prog: 0, ago: 99, rr: 0, r: 0, ore: ore || null, cur: null, stall: 0 });
export function newGame() { return { cells: new Array(W * H).fill(null), money: START_MONEY, power: START_POWER, off: false, tick: 0, shipped: 0, log: [] }; }
const at = (g, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : g.cells[y * W + x]);
const invN = (c) => Object.values(c.inv).reduce((s, n) => s + n, 0);

// c 能不能再收下 item（srcDir：來源前進的方向，用來擋「迎面接」；pend：這個 tick 已經預訂的數量）
function accepts(c, item, srcDir, pend) {
  if (!c) return false;
  pend = pend || 0;
  if (c.k === "belt") return c.dir !== (srcDir + 2) % 4 && !c.item;
  if (c.k === "shipper") return true;
  if (c.k === "splitter") return !c.item && !pend;
  if (c.k === "smelter") return !!SMELT[item] && (!c.cur || c.cur === item) && invN(c) + pend < KINDS.smelter.cap;
  if (c.k === "assembler") { const need = RECIPES[c.r].in[item]; return !!need && (c.inv[item] || 0) + pend < need * 2; }
  return false;
}

// 這格能不能放這種東西（不改任何東西）；回傳錯誤說明，空字串代表可以
export function canPlace(g, ore, x, y, k, dir) {
  if (x < 0 || y < 0 || x >= W || y >= H) return "出界";
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

// 全廠每分鐘耗電（度）
export function powerRate(g) { let r = 0; for (const c of g.cells) if (c) r += POWER_USE[c.k]; return r; }
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
    if (c.k === "splitter") {
      if (c.item) {
        for (let n = 0; n < 3; n++) {
          const d = (c.dir + [0, 1, 3][(c.rr + n) % 3]) & 3;      // 前、右、左 輪流
          const t = at(g, x + DX[d], y + DY[d]);
          if (accepts(t, c.item, d)) { give(g, t, c.item); c.item = null; c.rr = (c.rr + n + 1) % 3; break; }
        }
      }
      continue;
    }
    if (c.k === "miner") {
      c.prog++;
      if (c.out.length < 1 && c.prog >= KINDS.miner.every) { c.out.push(c.ore === "copper" ? "copper_ore" : "iron_ore"); c.prog = 0; }
    } else if (c.k === "smelter") {
      if (c.prog > 0) { if (--c.prog === 0) { c.out.push(SMELT[c.cur]); if (invN(c) === 0) c.cur = null; } }
      else if (c.out.length < 2) {
        const it = Object.keys(c.inv).find((k) => c.inv[k] > 0);
        if (it) { c.inv[it]--; c.cur = it; c.prog = KINDS.smelter.time; }
      }
    } else if (c.k === "assembler") {
      const R = RECIPES[c.r];
      if (c.prog > 0) { if (--c.prog === 0) for (let n = 0; n < R.n; n++) c.out.push(R.make); }
      else if (c.out.length < 4 && Object.entries(R.in).every(([k, n]) => (c.inv[k] || 0) >= n)) {
        for (const [k, n] of Object.entries(R.in)) c.inv[k] -= n;
        c.prog = R.time;
      }
    }
    if (c.out.length) {
      const t = at(g, x + DX[c.dir], y + DY[c.dir]);
      if (accepts(t, c.out[0], c.dir)) { give(g, t, c.out.shift()); c.stall = 0; } else c.stall++;
    } else c.stall = 0;
  }
  // 2) 傳送帶：每 BELT_STEP 個 tick 前進一次
  for (const c of g.cells) if (c && c.k === "belt") c.ago++;
  if (g.tick % BELT_STEP) return;
  const belts = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = g.cells[y * W + x]; if (c && c.k === "belt" && c.item) belts.push([c, x, y]); }
  const state = new Map(), claim = new Map(), pend = new Map();
  const res = (c, x, y) => {
    if (state.has(c)) return state.get(c);
    state.set(c, false);                                  // 繞圈圈的情況先當作動不了
    const tx = x + DX[c.dir], ty = y + DY[c.dir], t = at(g, tx, ty);
    let ok = false;
    if (t && t.k === "belt") {
      if (t.dir !== (c.dir + 2) % 4 && !claim.has(t)) ok = !t.item || res(t, tx, ty);
      if (ok) claim.set(t, c);
    } else if (t && accepts(t, c.item, c.dir, pend.get(t) || 0)) { ok = true; pend.set(t, (pend.get(t) || 0) + 1); }
    state.set(c, ok); return ok;
  };
  for (const [c, x, y] of belts) res(c, x, y);
  const moves = belts.filter(([c]) => state.get(c));
  const items = moves.map(([c]) => c.item);
  for (const [c] of moves) c.item = null;
  moves.forEach(([c, x, y], i) => give(g, at(g, x + DX[c.dir], y + DY[c.dir]), items[i]));
}

function give(g, t, item) {
  if (t.k === "belt") { t.item = item; t.ago = 0; }
  else if (t.k === "splitter") { t.item = item; }
  else if (t.k === "shipper") { const v = VALUE[item] || 0; g.money += v; g.shipped += v; g.log.push([g.tick, v]); if (g.log.length > 400) g.log.shift(); }
  else t.inv[item] = (t.inv[item] || 0) + 1;
}

// 最近 60 秒（600 tick）的出貨金額
export function perMinute(g) { const from = g.tick - 600; return g.log.filter(([t]) => t > from).reduce((s, [, v]) => s + v, 0); }

export function serialize(g) {
  return { v: 3, m: g.money, p: Math.round(g.power * 100) / 100, s: g.shipped, c: g.cells.map((c, i) => (c ? [i, c.k, c.dir, c.r || 0, c.ore || ""] : null)).filter(Boolean) };
}
export function load(o) {
  const g = newGame();
  if (o && Array.isArray(o.c)) {
    g.money = Number(o.m) || 0; g.shipped = Number(o.s) || 0; g.power = typeof o.p === "number" ? o.p : 150;   // 舊存檔送 150 度
    for (const [i, k, dir, r, ore] of o.c) if (KINDS[k] && i >= 0 && i < W * H) { const c = newCell(k, dir & 3, ore || null); c.r = (r | 0) % RECIPES.length; g.cells[i] = c; }
  }
  return g;
}
