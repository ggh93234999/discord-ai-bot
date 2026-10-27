// 自動化工廠：模擬核心（純邏輯，不碰畫面，之後要搬到伺服器也可以）。
// 格子地圖，每格最多一個東西；物品在傳送帶上一格一格移動。方向 0右 1下 2左 3上。
export const W = 20, H = 12;
export const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
export const BELT_STEP = 3;                 // 傳送帶每 3 個 tick 前進一格
export const START_MONEY = 150;

export const KINDS = {
  belt:      { name: "傳送帶", cost: 1 },
  miner:     { name: "採礦機", cost: 25, every: 15 },               // 只能放在礦點上，每 1.5 秒出 1 礦
  smelter:   { name: "熔爐", cost: 45, need: "ore", make: "plate", time: 20, cap: 4 },
  assembler: { name: "組裝機", cost: 90, need: "plate", n: 2, make: "gear", time: 30, cap: 6 },   // 2 鐵板 → 1 齒輪
  shipper:   { name: "出貨口", cost: 10 },
};
export const VALUE = { ore: 2, plate: 6, gear: 20 };

// 礦點：固定地圖
export function makeOre() {
  const ore = new Set();
  const patch = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) ore.add(y * W + x); };
  patch(1, 2, 4, 3); patch(2, 8, 3, 3); patch(14, 1, 3, 3);
  return ore;
}

export function newGame() { return { cells: new Array(W * H).fill(null), money: START_MONEY, tick: 0, shipped: 0, log: [] }; }
const at = (g, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : g.cells[y * W + x]);

// c 能不能收下 item（from：來源方向，用來擋「迎面接」）
function accepts(c, item, srcDir, pend) {
  if (!c) return false;
  if (c.k === "belt") return c.dir !== (srcDir + 2) % 4 && !c.item;
  if (c.k === "shipper") return true;
  const K = KINDS[c.k];
  if (c.k === "smelter" || c.k === "assembler") return item === K.need && c.inn + (pend || 0) < K.cap;
  return false;
}

export function place(g, ore, x, y, k, dir) {
  if (x < 0 || y < 0 || x >= W || y >= H) return "出界";
  const i = y * W + x, cur = g.cells[i];
  if (cur && cur.k === k) { if (cur.dir !== dir) { cur.dir = dir; return ""; } return "這格已經有了"; }
  if (cur) return "這格有東西，先拆掉";
  if (k === "miner" && !ore.has(i)) return "採礦機只能放在礦點上";
  const cost = KINDS[k].cost;
  if (g.money < cost) return "錢不夠";
  g.money -= cost;
  g.cells[i] = { k, dir, item: null, out: null, inn: 0, prog: 0, ago: 99 };
  return "";
}
export function remove(g, x, y) {
  const i = y * W + x, c = g.cells[i]; if (!c) return;
  g.money += Math.floor(KINDS[c.k].cost / 2); g.cells[i] = null;
}

// 前進一個 tick
export function step(g) {
  g.tick++;
  // 1) 機器：處理、產出、把成品推給面向的那一格
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g.cells[y * W + x]; if (!c || c.k === "belt" || c.k === "shipper") continue;
    const K = KINDS[c.k];
    if (c.k === "miner") { c.prog++; if (!c.out && c.prog >= K.every) { c.out = "ore"; c.prog = 0; } }
    else if (c.prog > 0) { if (--c.prog === 0) c.out = K.make; }
    else if (!c.out && c.inn >= (K.n || 1)) { c.inn -= K.n || 1; c.prog = K.time; }
    if (c.out) {
      const t = at(g, x + DX[c.dir], y + DY[c.dir]);
      if (accepts(t, c.out, c.dir)) { give(g, t, c.out, c.dir); c.out = null; }
    }
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
  moves.forEach(([c, x, y], i) => give(g, at(g, x + DX[c.dir], y + DY[c.dir]), items[i], c.dir));
}

function give(g, t, item, dir) {
  if (t.k === "belt") { t.item = item; t.ago = 0; }
  else if (t.k === "shipper") { const v = VALUE[item] || 0; g.money += v; g.shipped += v; g.log.push([g.tick, v]); if (g.log.length > 400) g.log.shift(); }
  else t.inn++;
}

// 最近 60 秒（600 tick）的出貨金額
export function perMinute(g) { const from = g.tick - 600; return g.log.filter(([t]) => t > from).reduce((s, [, v]) => s + v, 0); }

export function serialize(g) {
  return { m: g.money, s: g.shipped, c: g.cells.map((c, i) => (c ? [i, c.k, c.dir] : null)).filter(Boolean) };
}
export function load(o) {
  const g = newGame();
  if (o && Array.isArray(o.c)) {
    g.money = Number(o.m) || 0; g.shipped = Number(o.s) || 0;
    for (const [i, k, dir] of o.c) if (KINDS[k] && i >= 0 && i < W * H) g.cells[i] = { k, dir: dir & 3, item: null, out: null, inn: 0, prog: 0, ago: 99 };
  }
  return g;
}
