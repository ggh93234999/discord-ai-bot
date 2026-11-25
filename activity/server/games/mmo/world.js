// 水墨江湖（MMORPG）伺服器：整個世界在這裡模擬（每秒 10 次），前端只負責畫和送指令。
// 角色綁 Discord 身分（r:<uid>，登入過）或訪客（g:<瀏覽器代號>）。訪客能玩，但不能用錢莊、不能交易。
// 存檔：data/records/activity/mmo.json（角色、錢莊待補發）。
import fs from "node:fs";
import { randomInt } from "node:crypto";
import { botSettle, botPay, botInfo } from "../../bet.js";
import { arec, DATA_ROOT } from "../../paths.js";
import * as D from "./data.js";
import { STORY_NPCS, STORY, storyReward } from "./story.js";
// ---- 錢莊：歷史存入額度
// 帳號記 bankIn（歷史上用代幣換進多少兩）、bankUsed（銀兩換代幣時超過每天額度、從這裡扣掉多少）。
// 舊帳號第一次用錢莊時，從機器人的帳本（logs/transfers.json，「水墨江湖：代幣換銀兩」）補算以前換進的總額。
let ledgerCache = null;
function ledgerIn(uid) {
  try {
    if (!ledgerCache) {
      ledgerCache = {};
      const L = JSON.parse(fs.readFileSync(DATA_ROOT + "/logs/transfers.json", "utf8")).items || [];
      for (const it of L) if (String(it.note || "").includes("水墨江湖：代幣換銀兩") && it.from) ledgerCache[String(it.from[0])] = (ledgerCache[String(it.from[0])] || 0) + (Number(it.amount) || 0);
    }
    return ledgerCache[String(uid)] || 0;
  } catch { return 0; }
}
function bankAcc(A, key) {
  if (A.bankIn == null) { A.bankIn = key.startsWith("r:") ? ledgerIn(key.slice(2)) : 0; A.bankUsed = 0; }
  return A;
}
const bankPool = (A) => Math.max(0, (A.bankIn || 0) - (A.bankUsed || 0));

const TICK = 100;                              // 毫秒
const now = () => Date.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const today = () => new Date(now() + 8 * 3600_000).toISOString().slice(0, 10);

// ======================================================================== 存檔
const FILE = arec("mmo.json");
let db = { ch: {}, pend: {} };
try { db = { ch: {}, pend: {}, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch {}
// 帳號：一個人可以有好幾隻角色，銀兩、錢莊每日額度、倉庫整個帳號共用；等級、經驗、職業、裝備、行囊、技能欄各角色自己的
// 角色物件上的 gold/day 是「指向帳號」的存取器（不可列舉，存檔時不會寫進角色裡），所以其他程式照舊用 c.gold 就好
const MAX_CHARS = 4;
const SHARED = ["gold", "day"];
function bindChar(c, A) {
  for (const k of SHARED) { delete c[k]; Object.defineProperty(c, k, { get: () => A[k], set: (v) => { A[k] = v; }, enumerable: false, configurable: true }); }
  return c;
}
db.acc = db.acc || {};
if (Object.keys(db.ch).length) {     // 舊存檔（一人一角）搬成帳號，搬之前留一份備份
  try { fs.copyFileSync(FILE, FILE + ".bak-premulti"); } catch {}
  for (const [k, ch] of Object.entries(db.ch)) {
    if (db.acc[k]) continue;
    ch.auto = k.startsWith("r:") && !ch.renamed;      // 名字跟著 Discord 名稱變（只有原本那隻）
    db.acc[k] = { lv: ch.lv || 1, exp: ch.exp || 0, gold: ch.gold || 0, day: ch.day || { d: "", out: 0 }, chars: [ch], last: 0 };
  }
  db.ch = {};
}
// 等級從「帳號共用」改回「每個角色自己的」：原本的角色都拿到當時的帳號等級，不會有人掉級
if (Object.values(db.acc).some((A) => A.chars.some((c) => typeof c.lv !== "number"))) {
  try { fs.copyFileSync(FILE, FILE + ".bak-perchar"); } catch {}
  for (const A of Object.values(db.acc)) { for (const c of A.chars) if (typeof c.lv !== "number") { c.lv = A.lv || 1; c.exp = A.exp || 0; } delete A.lv; delete A.exp; }
}
const accLv = (A) => Math.max(1, ...A.chars.map((c) => c.lv || 1));      // 帳號裡最高等級的角色（懸賞、排行用）
for (const A of Object.values(db.acc)) for (const c of A.chars) bindChar(c, A);
let saveT = 0;
export function mmoSave(nowSave = false) {
  for (const p of players.values()) syncSave(p);
  const w = () => { try { fs.writeFileSync(FILE + ".tmp", JSON.stringify(db)); fs.renameSync(FILE + ".tmp", FILE); } catch (e) { console.log("江湖存檔失敗", e.message); } };
  if (nowSave) { clearTimeout(saveT); w(); return; }
  clearTimeout(saveT); saveT = setTimeout(w, 1500);
}
function syncSave(p) {
  const c = p.ch;
  c.map = p.map; c.x = Math.round(p.x * 10) / 10; c.y = Math.round(p.y * 10) / 10; c.hp = Math.round(p.hp); c.mp = Math.round(p.mp);
  if (isInst(p.map)) { c.map = "town"; c.x = D.TOWN_SPAWN.x; c.y = D.TOWN_SPAWN.y; c.hp = Math.max(c.hp, 1); }     // 副本、擂台不存位置
}

// ======================================================================== 地圖產生
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 地塊：0 地面、1 樹叢／岩石（擋路）、2 水（擋路）、3 小路、4 傳送點、5 房屋（擋路）
const WALK = new Set([0, 3, 4]);
const maps = {};
function genMap(id, def = D.MAPS[id]) {
  const { w, h } = def, R = mulberry(def.seed), t = new Uint8Array(w * h);
  const at = (x, y) => t[y * w + x], set = (x, y, v) => { if (x >= 0 && y >= 0 && x < w && y < h) t[y * w + x] = v; };
  const inner = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  if (def.corridor) {      // 副本走廊：長長一條，中間零星柱子
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = inner(x, y) && y > 1 && y < h - 2 ? 0 : 1;
    for (let k = 0; k < w * 0.35; k++) { const x = 6 + Math.floor(R() * (w - 12)), y = 3 + Math.floor(R() * (h - 6)); set(x, y, 1); }
    for (const q of def.portals) { set(q.x, q.y, 4); set(q.x, q.y + 1, 4); set(q.x === 0 ? 1 : w - 2, q.y, 0); set(q.x === 0 ? 1 : w - 2, q.y + 1, 0); }
    def.bossAt = { x: w - 6 + 0.5, y: Math.floor(h / 2) + 0.5 };
  } else if (def.open) {          // 擂台：一整片空地，四周圍起來
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = inner(x, y) ? 0 : 1;
    for (const [x, y] of [[3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4]]) set(x, y, 1);
    if (def.pvp && w >= 30) for (const [x, y] of [[w / 2 - 6, h / 2 - 5], [w / 2 + 5, h / 2 - 5], [w / 2 - 6, h / 2 + 4], [w / 2 + 5, h / 2 + 4]]) set(Math.floor(x), Math.floor(y), 1);     // 大擂台中間四根柱子可以繞
    for (const q of def.portals || []) { set(q.x, q.y, 4); set(q.x, q.y + 1, 4); }
    def.bossAt = { x: w / 2, y: h / 2 };
  } else if (def.layout) {   // 主城：照 D.TOWN 的格局蓋
    const T = D.TOWN;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = inner(x, y) ? 0 : 5;
    for (const [x0, y0, x1, y1] of T.roads) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inner(x, y) && Math.hypot(x + 0.5 - T.plaza.x, y + 0.5 - T.plaza.y) <= T.plaza.r) set(x, y, 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inner(x, y) && Math.hypot(x + 0.5 - T.pond.x, y + 0.5 - T.pond.y) <= T.pond.r) set(x, y, 2);
    for (const b of T.buildings) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) set(x, y, 5);
    for (const d of T.deco) if (d[5]) set(Math.floor(d[1]), Math.floor(d[2] - 0.3), 1);
    for (const q of def.portals) { set(q.x, q.y, 4); set(q.x, q.y + 1, 4); }
  } else if (def.town) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = inner(x, y) ? 0 : 5;
    const house = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, 5); };
    house(2, 2, 7, 5); house(26, 2, 31, 5); house(2, 20, 7, 23); house(26, 20, 31, 23); house(13, 2, 20, 4);
    for (let x = 1; x < w - 1; x++) { set(x, 13, 3); set(x, 14, 3); }
    for (let y = 6; y < 21; y++) { set(16, y, 3); set(17, y, 3); }
    for (let i = 0; i < 26; i++) { const x = 1 + Math.floor(R() * (w - 2)), y = 1 + Math.floor(R() * (h - 2)); if (at(x, y) === 0 && (x < 4 || x > w - 5 || y < 3 || y > h - 4)) set(x, y, 1); }
    set(def.portals[0].x, def.portals[0].y, 4); set(def.portals[0].x, def.portals[0].y + 1, 4);
  } else {
    // 隨機障礙 → 細胞自動機平滑成一叢一叢
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = !inner(x, y) ? 1 : R() < 0.36 ? 1 : 0;
    for (let k = 0; k < 4; k++) {
      const n = t.slice();
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (t[(y + dy) * w + x + dx] === 1) c++;
        n[y * w + x] = c >= 5 ? 1 : 0;
      }
      t.set(n);
    }
    // 池塘
    for (let i = 0, np = Math.max(3, Math.round(w * h / 700)); i < np; i++) {
      const cx = 6 + Math.floor(R() * (w - 12)), cy = 6 + Math.floor(R() * (h - 12)), r = 1.5 + R() * 2;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (inner(x, y) && Math.hypot(x - cx, y - cy) <= r) set(x, y, 2);
    }
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const clear = (x0, y0, r, v = 0) => { for (let y = Math.floor(y0 - r); y <= y0 + r; y++) for (let x = Math.floor(x0 - r); x <= x0 + r; x++) if (inner(x, y) && Math.hypot(x - x0, y - y0) <= r && at(x, y) !== 3) set(x, y, v); };
    const carve = (x0, y0, x1, y1) => {   // 歪歪扭扭的小路（寬 2）
      let x = x0, y = y0, guard = 0;
      while ((x !== x1 || y !== y1) && guard++ < 2000) {
        if (R() < 0.7) { if (x !== x1 && (R() < 0.5 || y === y1)) x += Math.sign(x1 - x); else if (y !== y1) y += Math.sign(y1 - y); }
        else { if (R() < 0.5) y += R() < 0.5 ? -1 : 1; else x += R() < 0.5 ? -1 : 1; x = Math.max(1, Math.min(w - 2, x)); y = Math.max(1, Math.min(h - 2, y)); }
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (inner(x + dx, y + dy)) set(x + dx, y + dy, 3);
      }
    };
    clear(cx, cy, 3);
    for (const p of def.portals) { const ix = p.x === 0 ? 1 : p.x === w - 1 ? w - 2 : p.x; carve(ix, p.y, cx, cy); clear(ix, p.y, 2); }
    // 王的空地：離入口遠一點
    const bx = Math.floor(w * 0.66), by = Math.floor(h * 0.24);
    if (def.boss) { carve(bx, by, cx, cy); clear(bx, by, 4.5); }
    def.bossAt = { x: bx + 0.5, y: by + 0.5 };
    // 從中間淹水，走不到的地面直接變成樹叢，避免怪生在死角
    const seen = new Uint8Array(w * h), q = [cy * w + cx]; seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop(), x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * w + x + dx; if (inner(x + dx, y + dy) && !seen[j] && WALK.has(t[j])) { seen[j] = 1; q.push(j); } }
    }
    for (let i = 0; i < w * h; i++) if (!seen[i] && WALK.has(t[i])) t[i] = 1;
    for (const p of def.portals) { set(p.x, p.y, 4); set(p.x, p.y + 1, 4); set(p.x === 0 ? 1 : w - 2, p.y, 3); set(p.x === 0 ? 1 : w - 2, p.y + 1, 3); }
  }
  // 怪的出生點：走得到、離傳送點遠、不在王的空地裡
  const spots = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!WALK.has(at(x, y)) || at(x, y) === 4) continue;
    if (def.portals.some((p) => Math.hypot(p.x - x, p.y - y) < 8)) continue;
    if (def.boss && Math.hypot(def.bossAt.x - x, def.bossAt.y - y) < 7) continue;
    spots.push({ x: x + 0.5, y: y + 0.5 });
  }
  if (!def.town && !def.inst) {
    const ent = def.portals.find((q) => q.x === 0) || def.portals[0], sx = ent.x === 0 ? 4 : w - 5, sy = ent.y - 2;
    let best = null, bd = 1e9;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (at(x, y) !== 0 && at(x, y) !== 3) continue;
      if (![[0, 1], [1, 0], [-1, 0], [0, -1]].every(([dx, dy]) => WALK.has(at(x + dx, y + dy)) && at(x + dx, y + dy) !== 4)) continue;
      const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    def.stone = best;
  }
  // 小王的巢穴：挑空曠的地方，離傳送點、傳送石、大王、彼此越遠越好
  if (def.elites && def.elites.length && !def.inst) {
    const avoid = [...def.portals.map((q) => ({ x: q.x, y: q.y })), def.bossAt, def.stone].filter(Boolean);
    const openAt = (x, y, need) => { let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (WALK.has(at(x + dx, y + dy))) n++; return n >= need; };
    let cand = [];
    for (const need of [44, 38, 30]) { cand = spots.filter((s2) => { const x = Math.floor(s2.x), y = Math.floor(s2.y); return x > 6 && y > 6 && x < w - 7 && y < h - 7 && openAt(x, y, need); }); if (cand.length >= 30) break; }
    def.lairs = [];
    for (let i = 0; i < def.elites.length; i++) {
      let best = null, bd = -1;
      for (const c of cand) { let d = 1e9; for (const a of avoid.concat(def.lairs)) d = Math.min(d, Math.hypot(a.x - c.x, a.y - c.y)); if (d > bd) { bd = d; best = c; } }
      if (best) def.lairs.push(best);
    }
  }
  const tiles = Array.from(t).join("");
  return { id, def, w, h, t, tiles, spots, mobs: [], fx: [], R, loot: [], lootDirty: false };
}
const walk = (m, x, y) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < m.w && y < m.h && WALK.has(m.t[y * m.w + x]); };

// A*（8 方向、不切牆角），回傳路點（格子中心）
function astar(m, sx, sy, tx, ty, limit = 3000) {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (!walk(m, tx, ty)) {   // 終點不能走：找最近能走的格子
    let best = null, bd = 1e9;
    for (let r = 1; r <= 3 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (walk(m, tx + dx, ty + dy)) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = [tx + dx, ty + dy]; } }
    }
    if (!best) return null; [tx, ty] = best;
  }
  if (sx === tx && sy === ty) return [];
  const W = m.w, key = (x, y) => y * W + x, start = key(sx, sy), goal = key(tx, ty);
  const g = new Map([[start, 0]]), from = new Map(), open = [[Math.hypot(tx - sx, ty - sy), start]], closed = new Set();
  let n = 0;
  while (open.length && n++ < limit) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === goal) {
      const path = []; let c = cur;
      while (c !== start) { path.push({ x: (c % W) + 0.5, y: Math.floor(c / W) + 0.5 }); c = from.get(c); }
      return path.reverse();
    }
    if (closed.has(cur)) continue; closed.add(cur);
    const cx = cur % W, cy = Math.floor(cur / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!walk(m, nx, ny) || (dx && dy && (!walk(m, cx + dx, cy) || !walk(m, cx, cy + dy)))) continue;
      const k = key(nx, ny), ng = g.get(cur) + (dx && dy ? 1.414 : 1);
      if (ng < (g.get(k) ?? 1e9)) { g.set(k, ng); from.set(k, cur); open.push([ng + Math.hypot(tx - nx, ty - ny), k]); }
    }
  }
  return null;
}
// 兩點之間是否一路都能走（取樣檢查）
function clearLine(m, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d * 3);
  for (let i = 1; i <= n; i++) if (!walk(m, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false;
  return true;
}
// 沿路點前進；回傳是否走完
function stepPath(e, spd, dt) {
  let left = spd * dt;
  while (left > 0 && e.path && e.path.length) {
    const p = e.path[0], d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d <= left) { e.x = p.x; e.y = p.y; e.path.shift(); left -= d; }
    else { e.x += (p.x - e.x) / d * left; e.y += (p.y - e.y) / d * left; left = 0; }
  }
  return !e.path || !e.path.length;
}

// ======================================================================== 實體
let nextId = 1;
const players = new Map();       // key → 玩家（在線）
const byId = new Map();          // 實體編號 → 玩家
const parties = new Map();       // 隊伍編號 → { id, leader, members: Set<key> }
let nextParty = 1;
const trades = new Map();        // key → 交易（兩邊共用同一個物件）

function spawnMob(m, k, at, dd) {
  const def = dd || D.MONS[k], st = dd ? D.monStatsDef(dd) : D.monStats(k);
  const spot = at || m.spots[Math.floor(m.R() * m.spots.length)];
  const mob = { id: 100000 + nextId++, mapId: m.id, k, def, st, x: spot.x, y: spot.y, hx: spot.x, hy: spot.y, hp: st.hp, max: st.hp, tgt: null, atkT: 0, path: null, pathT: 0, wanderT: now() + rnd(1000, 5000), dead: false, dmg: new Map(), calmT: 0, slamAt: 0, slamT: 0 };
  m.mobs.push(mob); return mob;
}
function initMaps() {
  for (const id of Object.keys(D.MAPS)) {
    const m = maps[id] = genMap(id);
    for (const [k, n] of m.def.spawns) for (let i = 0; i < n; i++) spawnMob(m, k);
    if (m.def.boss) m.boss = spawnMob(m, m.def.boss, m.def.bossAt);
    (m.def.lairs || []).forEach((at, i) => { const mob = spawnMob(m, m.def.elites[i], at); mob.lair = at; mob.hx = at.x; mob.hy = at.y; });
  }
}
initMaps();

// 每張地圖上的 NPC：城裡是固定那幾位，野外只有一塊驛站傳送石
const npcsOf = (id) => {
  const m = maps[id]; if (!m) return [];
  if (m.xnpc) return m.xnpc;
  if (m.def.town) return [...D.NPCS, ...storyNpcs(id)];
  if (m.def.stone) return [{ id: "st_" + id, name: "驛站傳送石", kind: "stone", x: m.def.stone.x, y: m.def.stone.y, say: "伸手摸一下石碑，就能傳到去過的地方。" }, ...dgGates(id), ...storyNpcs(id)];
  return [];
};
// ---- 主線故事：說故事的 NPC 擺在長安城指定位置、野外傳送石旁、副本入口旁；找一格能走、不擋到別的 NPC 的地方
function freeSpot(m, x, y, others) {
  for (let r = 0; r < 9; r += 0.5) for (let k = 0; k < 16; k++) {
    const px = Math.floor(x + Math.cos(k / 16 * 6.283) * r) + 0.5, py = Math.floor(y + Math.sin(k / 16 * 6.283) * r) + 0.5;
    if (walk(m, px, py) && walk(m, px, py + 1) && others.every((o) => Math.hypot(o.x - px, o.y - py) > 2.2)) return { x: px, y: py };
  }
  return { x, y };
}
function storyNpcs(id) {
  const m = maps[id]; if (!m || m.inst) return [];
  if (m._story) return m._story;
  const taken = m.def.town ? [...D.NPCS] : [{ x: m.def.stone.x, y: m.def.stone.y }, ...dgGates(id)], out = [];
  for (const s of STORY_NPCS) {
    if (s.map !== id) continue;
    let ax, ay;
    if (s.at === "stone") { if (!m.def.stone) continue; ax = m.def.stone.x + 2.5; ay = m.def.stone.y + 1; }
    else if (s.at === "gate") { const g = dgGates(id).find((x) => x.dg === s.dg); if (!g) continue; ax = g.x - 2.5; ay = g.y + 1; }
    else { ax = s.at.x; ay = s.at.y; }
    const sp = freeSpot(m, ax, ay, [...taken, ...out]);
    out.push({ id: s.id, name: s.name, kind: "story", x: sp.x, y: sp.y, art: s.art, anim: s.anim, say: "" });
  }
  return (m._story = out);
}
// 這個 NPC 有哪些章：聽過的（可以重聽）、現在輪到的、還沒輪到的；順便告訴玩家下一章要去找誰
function storyView(c, npcId) {
  const at = c.story || 0, list = [];
  STORY.forEach((ch, i) => {
    if (ch.npc !== npcId) return;
    const rw = storyReward(ch, D.expNeed(ch.lv)), st = i < at ? "done" : i > at ? "locked" : c.lv < ch.lv ? "lv" : "ok";
    list.push({ i, title: ch.title, lv: ch.lv, st, pages: st === "ok" || st === "done" ? ch.pages : null, exp: rw.exp, gold: rw.gold });
  });
  const nx = STORY[at], N = nx && STORY_NPCS.find((s) => s.id === nx.npc);
  return { at, total: STORY.length, list, next: nx ? { i: at, lv: nx.lv, title: nx.title, npc: N.name, map: D.MAPS[N.map].name, here: nx.npc === npcId } : null };
}
const mapName = (id) => (maps[id] ? maps[id].def.name : D.MAPS[id] ? D.MAPS[id].name : "長安城");
const isInst = (id) => !!(maps[id] && maps[id].inst);
// 客棧酒菜（角色自己的）、城隍廟祈福（整個帳號）
const foodOf = (c) => (c.food && c.food.until > now() ? D.FOODS[c.food.k] : null);
const blessOf = (p) => { const A = db.acc[p.key], b = A && A.bless; if (!b || !(b.until > now())) return null; const B = D.BLESS.find((x) => x.k === b.k); return B && B.buff ? B : null; };
function bonus(p, kind) { let v = 0; const f = foodOf(p.ch), b = blessOf(p); if (f && f.buff === kind) v += f.v; if (b && b.buff === kind) v += b.v; return v; }
// ======================================================================== 角色數值
function statsOf(p) {
  const c = p.ch, C = D.CLASSES[c.cls], L = c.lv;
  const s = { hp: C.hp[0] + C.hp[1] * (L - 1), mp: C.mp[0] + C.mp[1] * (L - 1), atk: C.atk[0] + C.atk[1] * (L - 1), def: C.def[0] + C.def[1] * (L - 1), crit: 5, aspdP: 0, range: C.range, spd: C.spd, aspd: C.aspd, ls: 0, thorn: 0, cdmg: 0, dodge: 0, ms: 0, pen: 0, cdr: 0 };
  for (const it of Object.values(c.eq)) if (it) for (const st of [it.st, it.eb]) if (st) for (const [k, v] of Object.entries(st)) { if (k === "aspd") s.aspdP += v; else s[k] = (s[k] || 0) + v; }
  s.hp = Math.round(s.hp); s.mp = Math.round(s.mp); s.atk = Math.round(s.atk); s.def = Math.round(s.def);
  {   // 套裝加成
    const cnt = {}; for (const it of Object.values(c.eq)) if (it && it.set) cnt[it.set] = (cnt[it.set] || 0) + 1;
    for (const [k, n] of Object.entries(cnt)) { const S = D.SETS[k]; if (!S) continue; for (const B of [n >= 2 && S.b2, n >= 3 && S.b3, n >= 5 && S.b5]) if (B) for (const [kk, v] of Object.entries(B)) { if (kk === "aspd") s.aspdP += v; else if (D.ADD_STAT[kk]) s[kk] += v; else s[kk] = s[kk] * (1 + v); } }
    s.hp = Math.round(s.hp); s.mp = Math.round(s.mp); s.atk = Math.round(s.atk); s.def = Math.round(s.def);
  }
  s.over = {};      // 超過上限的數值：記下實際合計，介面上標「已達上限」
  for (const k of ["ls", "thorn", "cdmg", "dodge", "ms", "pen", "cdr"]) { if (s[k] > D.ADD_STAT[k]) s.over[k] = [Math.round(s[k]), D.ADD_STAT[k]]; s[k] = Math.min(D.ADD_STAT[k], s[k]); }
  s.aspd = C.aspd / (1 + s.aspdP / 100);
  s.spd *= 1 + s.ms / 100;
  if (p.slowT > now()) s.spd *= 0.55;
  const A = c.adv && D.ADV[c.adv];
  for (const AA of [A, c.adv2 && D.ADV2[c.adv2]]) if (AA) { const M = AA.mod; for (const k of ["hp", "mp", "atk", "def"]) if (M[k]) s[k] = Math.round(s[k] * M[k]); if (M.spd) s.spd *= M.spd; if (M.aspd) s.aspd *= M.aspd; s.crit += M.crit || 0; s.range += M.range || 0; for (const k of ["ls", "cdmg", "pen", "dodge", "ms", "thorn"]) if (M[k]) s[k] += M[k]; if (M.ms) s.spd *= 1 + M.ms / 100; }
  if (p.buff.berserk > now()) { s.atk = Math.round(s.atk * 1.4); s.aspd /= 1.2; s.ls += 10; }
  if (p.buff.hawk > now()) { s.crit += 40; s.cdmg += 50; }
  if (p.buff.gale > now()) { s.spd *= 1.4; s.aspd /= 1.4; }
  if (p.buff.rage > now()) s.atk = Math.round(s.atk * 1.3);
  if (p.buff.eagle > now()) { s.atk = Math.round(s.atk * 1.25); s.crit += 25; }
  const fa = bonus(p, "atk"); if (fa) s.atk = Math.round(s.atk * (1 + fa));
  const cc = p.buff.hawk > now() ? 95 : D.ADD_STAT.crit; if (s.crit > cc) s.over.crit = [Math.round(s.crit), cc]; s.crit = Math.min(cc, s.crit);
  return s;
}
const allSkills = (c) => [...D.SKILLS[c.cls], ...(c.adv ? D.ADV_SKILLS[c.adv] : []), ...(c.adv2 ? D.ADV2_SKILLS[c.adv2] : [])];
const slotN = (c) => D.SLOT_N + (c.adv ? 1 : 0) + (c.adv2 ? 1 : 0);   // 一轉多一格（F）、二轉再多一格（D）
const advName = (c) => (c.adv2 ? D.ADV2[c.adv2].name : c.adv ? D.ADV[c.adv].name : "");

// ======================================================================== 物品
let itemSeq = now() % 1e6;
// who：撿到的角色（決定單一技能冷卻詞條從哪些招裡抽）；沒給就用職業全部的招
function makeEquip(slot, tier, r, cls, who) {
  const b = D.baseItem(slot, tier, cls);
  const it = { u: (itemSeq++).toString(36), s: slot, t: tier, r, c: slot === "weapon" ? cls : undefined, n: b.name, st: {}, v: 0 };
  it.af = rollAff(tier, D.RAR[r].aff, r, who || cls); rebuild(it);
  return it;
}
// 裝備數值 = 基礎（照品質放大）＋詞條（af）；強化加成另外放在 eb
function baseOf(it) { const b = D.baseItem(it.s, it.t, it.c || "sword"), st = {}; for (const [k, v] of Object.entries(b.st)) st[k] = Math.round(v * D.RAR[it.r].mult); return st; }
function affOf(it) {       // 舊裝備沒有分開存詞條：用「總數值 − 基礎」推回來
  if (it.af) return it.af;
  const b = baseOf(it), af = {}; for (const [k, v] of Object.entries(it.st)) { const d = v - (b[k] || 0); if (d > 0) af[k] = d; }
  return (it.af = af);
}
// 抽單一技能冷卻詞條的招式池：二轉了就只抽自己的招；一轉了抽一轉＋兩種二轉；還沒轉職抽整個職業
function skPool(who) {
  if (!who) return []; if (typeof who === "string") return D.classSkills(who);
  if (who.adv2) return allSkills(who);
  if (who.adv) return [...D.SKILLS[who.cls], ...D.ADV_SKILLS[who.adv], ...Object.entries(D.ADV2).filter(([, b]) => b.base === who.adv).flatMap(([k]) => D.ADV2_SKILLS[k])];
  return D.classSkills(who.cls);
}
function rollAff(tier, n, r = 0, cls) {
  const norm = Object.keys(D.AFFIX).filter((k) => !D.AFFIX[k].sp), sp = Object.keys(D.AFFIX).filter((k) => D.AFFIX[k].sp), picked = new Set(), af = {};
  const spP = r >= 3 ? 0.45 : r === 2 ? 0.3 : r === 1 ? 0.15 : 0;
  while (picked.size < n) { const pool = Math.random() < spP ? sp : norm; picked.add(pool[randomInt(pool.length)]); }
  for (const k of picked) af[k] = Math.max(1, Math.round(D.AFFIX[k].v(tier) * rnd(0.7, 1.3)));
  if (cls && Math.random() < (D.SKCD.p[r] || 0)) {        // 額外一行：某一招的冷卻縮短
    const pool = skPool(cls).filter((s) => s.cd >= 6 && s.lv <= tier + 10);
    if (pool.length) { const sk = pool[randomInt(pool.length)]; af["cd_" + sk.id] = Math.max(5, Math.round(D.SKCD.v(tier) * rnd(0.8, 1.2))); }
  }
  return af;
}
function rebuild(it) {
  const st = baseOf(it); for (const [k, v] of Object.entries(affOf(it))) st[k] = (st[k] || 0) + v; it.st = st;
  if (it.e) { const eb = {}; for (const [k, v] of Object.entries(D.baseItem(it.s, it.t, it.c || "sword").st)) if (k !== "crit" && k !== "ms") eb[k] = Math.max(1, Math.round(v * D.ENH.bonus * it.e)); it.eb = eb; } else delete it.eb;
  it.v = Math.round(D.itemValue(it.t, it.r) * (1 + 0.15 * (it.e || 0)));
}
const matCount = (c, k) => c.inv.filter((x) => x.p === k).reduce((s, x) => s + x.q, 0);
function takeMat(c, k, n) { const it = c.inv.find((x) => x.p === k && x.q >= n); if (!it) return false; it.q -= n; if (it.q <= 0) c.inv.splice(c.inv.indexOf(it), 1); return true; }
const isPot = (it) => it && it.p;
const invMax = (c) => c.bag || D.INV_MAX;
const bagCost = (c) => { const i = Math.round((invMax(c) - D.INV_MAX) / D.BAG_UP.step); return invMax(c) >= D.BAG_UP.max ? 0 : D.BAG_UP.cost[i] || 0; };
// 一鍵整理：裝備依部位、品質、等級、強化排；藥品照商店順序；材料放最後；同種的藥和材料併成一疊
function sortInv(c) {
  const SO = Object.keys(D.SLOTS), PO = Object.keys(D.POTIONS), stack = {}, eq = [], pots = [];
  for (const it of c.inv) { if (it.p) { if (stack[it.p]) stack[it.p].q += it.q; else { stack[it.p] = it; pots.push(it); } } else eq.push(it); }
  eq.sort((a, b) => SO.indexOf(a.s) - SO.indexOf(b.s) || b.r - a.r || b.t - a.t || (b.e || 0) - (a.e || 0) || (b.lock ? 1 : 0) - (a.lock ? 1 : 0));
  pots.sort((a, b) => (D.POTIONS[a.p] && D.POTIONS[a.p].mat ? 1 : 0) - (D.POTIONS[b.p] && D.POTIONS[b.p].mat ? 1 : 0) || PO.indexOf(a.p) - PO.indexOf(b.p));
  c.inv = [...eq, ...pots.filter((x) => !(D.POTIONS[x.p] && D.POTIONS[x.p].mat)), ...pots.filter((x) => D.POTIONS[x.p] && D.POTIONS[x.p].mat)];
}
function addItem(p, it) {
  const inv = p.ch.inv;
  if (isPot(it)) { const ex = inv.find((x) => x.p === it.p); if (ex) { ex.q += it.q; return true; } }
  if (inv.length >= invMax(p.ch)) return false;
  inv.push(it); return true;
}
function invChanged(p) { p.dirty = true; p.invDirty = true; if (p.trade) cancelTrade(p.trade, "背包有變動，交易取消"); }
// 掉寶等級：怪物等級附近、不超過怪物等級的那一階
const tierFor = (lv) => D.TIERS.filter((t) => t <= lv + 1).pop() || 1;
function rollRarity(boss) {
  const r = Math.random() * 100;
  if (boss) return r < 18 ? 3 : r < 70 ? 2 : 1;
  return r < 1 ? 3 : r < 8 ? 2 : r < 30 ? 1 : 0;
}
function pickSlot() { const E = Object.entries(D.SLOT_W), tot = E.reduce((a, [, w]) => a + w, 0); let r = Math.random() * tot; for (const [k, w] of E) if ((r -= w) < 0) return k; return "weapon"; }
function randomDrop(p, lv, boss) {
  const slot = pickSlot();
  return makeEquip(slot, tierFor(lv), rollRarity(boss), p.ch.cls, p.ch);   // 武器掉自己職業的
}

// ======================================================================== 新角色
function newChar(name, cls, lv = 1) {
  const c = { name, cls, lv, exp: 0, visited: ["town"], map: "town", x: D.TOWN_SPAWN.x, y: D.TOWN_SPAWN.y, hp: 9999, mp: 9999, inv: [], eq: Object.fromEntries(Object.keys(D.SLOTS).map((k) => [k, null])), made: now() };
  const t = tierFor(lv - 1);           // 帳號已經練高了：新角色直接拿那個等級的白裝
  c.eq.weapon = makeEquip("weapon", t, 0, cls); c.eq.armor = makeEquip("armor", t, 0, cls);
  if (lv > 1) c.visited = ["town", ...Object.entries(D.MAPS).filter(([, v]) => !v.town && (parseInt(v.lvl, 10) || 99) <= lv).map(([k]) => k)];
  c.inv.push({ p: "hp1", q: 8 }, { p: "mp1", q: 4 }, { p: "tp", q: 1 });
  return c;
}

// ======================================================================== 連線進出
const out = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const sys = (p, text) => out(p.ws, { t: "mo", a: "sys", text });
function sysAll(text) { for (const p of players.values()) sys(p, text); }

function charList(A) { return A.chars.map((c, i) => ({ i, n: c.name, c: c.cls, lv: c.lv, adv: c.adv2 || c.adv || "", advN: advName(c), map: D.MAPS[c.map] ? D.MAPS[c.map].name : "長安城", w: c.eq.weapon ? c.eq.weapon.n : "" })); }
function classList() { return Object.entries(D.CLASSES).map(([k, v]) => ({ k, n: v.name, d: v.desc, skills: D.SKILLS[k].map((s) => s.name) })); }
function sendChars(ws) {
  const A = db.acc[ws.mmoKey];
  if (!A || !A.chars.length) { out(ws, { t: "mo", a: "create", real: ws.mmoReal, first: true, name: ws.user ? ws.user.name : "", classes: classList() }); return; }
  out(ws, { t: "mo", a: "chars", real: ws.mmoReal, gold: A.gold, max: MAX_CHARS, last: A.last || 0, list: charList(A), classes: classList() });
}
function enter(ws, key, ch, real) {
  const old = players.get(key);
  if (old) { out(old.ws, { t: "mo", a: "kicked" }); leave(old.ws, true); }
  const p = { key, ws, ch, real, id: nextId++, map: "town", x: 0, y: 0, path: null, tgt: null, queued: null, hp: 1, mp: 1, cd: {}, buff: {}, atkT: 0, pathT: 0, lastHit: 0, dead: false, deadT: 0, potT: 0, party: null, trade: null, known: new Set(), dirty: true, invDirty: true, meSent: 0, chatT: 0, msgs: [], invites: new Map() };
  ws.mmo = p; fixSlots(ch);
  players.set(key, p); byId.set(p.id, p);
  const st = statsOf(p);
  p.hp = Math.min(ch.hp, st.hp); p.mp = Math.min(ch.mp, st.mp);
  if (p.hp <= 0) { p.hp = st.hp * 0.5; ch.map = "town"; ch.x = D.TOWN_SPAWN.x; ch.y = D.TOWN_SPAWN.y; }
  const m = maps[ch.map] ? ch.map : "town";
  placeIn(p, m, ch.x, ch.y);
  sys(p, `歡迎回到水墨江湖，${ch.name}。`);
}
function placeIn(p, mapId, x, y) {
  const m = maps[mapId];
  if (!walk(m, x, y)) { const s = m.def.town ? D.TOWN_SPAWN : m.spots[0]; x = s.x; y = s.y; }
  p.map = mapId; p.x = x; p.y = y; p.path = null; p.tgt = null; p.queued = null; p.known = new Set(); p.pickT = 0; m.lootDirty = true;
  for (const q of players.values()) if (q !== p && q.map === mapId) q.known.delete(p.id);
  out(p.ws, { t: "mo", a: "map", you: p.id, map: { id: mapId, name: m.def.name, lvl: m.def.lvl || "", w: m.w, h: m.h, theme: m.def.theme, town: !!m.def.town, tiles: m.tiles, portals: m.def.portals.map((q) => ({ x: q.x, y: q.y, label: q.label })), npcs: npcsOf(mapId), inst: m.inst ? m.inst.kind : "", pvp: !!m.pvp, layout: m.def.layout ? { buildings: D.TOWN.buildings, deco: D.TOWN.deco, stage: D.TOWN.stage, folk: D.TOWN.folk } : undefined } });
  if (m.inst) { p.dirty = true; p.invDirty = true; if (p.trade) cancelTrade(p.trade, "離開了，交易取消"); return; }
  if (!Array.isArray(p.ch.visited)) p.ch.visited = ["town", ...Object.entries(D.MAPS).filter(([, v]) => !v.town && (parseInt(v.lvl, 10) || 99) <= p.ch.lv).map(([k]) => k)];   // 驛站上線前就有的角色：等級夠的地圖直接當作去過
  if (!p.ch.visited.includes(mapId)) { p.ch.visited.push(mapId); if (!m.def.town) sys(p, `記住了${m.def.name}的驛站，之後可以在長安城驛站或各地的傳送石直接傳過來。`); }
  p.dirty = true; p.invDirty = true;
  if (p.trade) cancelTrade(p.trade, "離開了，交易取消");
}
export function mmoClose(ws) { leave(ws, false); }
function leave(ws, kicked) {
  const p = ws && ws.mmo; if (!p) return;
  ws.mmo = null;
  if (players.get(p.key) !== p) return;
  syncSave(p);
  if (p.trade) cancelTrade(p.trade, "對方離線了，交易取消");
  if (p.party) leaveParty(p);
  players.delete(p.key); byId.delete(p.id);
  for (const m of Object.values(maps)) for (const mob of m.mobs) if (mob.tgt === p.key) mob.tgt = null;
  mmoSave(kicked);
}

// ======================================================================== 戰鬥
function hitMob(p, mob, mult, fxKind, sid) {
  if (mob.pvp) return hitPvp(p, mob.pvp, mult, fxKind);
  if (mob.dead) return 0;
  const st = statsOf(p), crit = Math.random() * 100 < st.crit;
  let crit2 = crit;
  if (p.buff.stealth > now()) { p.buff.stealth = 0; crit2 = true; mult *= 2.5; for (const q of players.values()) q.known.delete(p.id); }     // 影遁：出手就現形，這一擊必暴、2.5 倍
  let d = st.atk * mult * rnd(0.9, 1.1) * (crit2 ? 1.6 + st.cdmg / 100 : 1) - mob.st.def * 0.5 * (1 - st.pen / 100);
  if (mob.curseT > now()) d *= 1 + (mob.curseP || 0);
  d = Math.max(1, Math.round(d * (mob.dmgMul ?? 1)));
  if (st.ls && d > 1) { const hl = Math.round(d * st.ls / 100); if (hl > 0 && p.hp < st.hp) { p.hp = Math.min(st.hp, p.hp + hl); p.dirty = true; } }
  mob.hp -= d; mob.dmg.set(p.key, (mob.dmg.get(p.key) || 0) + d);
  if (!mob.tgt) mob.tgt = p.key;
  mob.calmT = now();
  p.lastHit = now();
  maps[p.map].fx.push({ k: fxKind || "h", a: p.id, b: mob.id, d, c: crit2 ? 1 : 0, ...(sid ? { s: sid } : {}) });
  if (mob.hp <= 0) killMob(maps[p.map], mob);
  return d;
}
function hurtPlayer(m, mob, p, mult = 1) {
  if (p.dead) return;
  const st = statsOf(p);
  if (mult === 1 && st.dodge && Math.random() * 100 < st.dodge) { m.fx.push({ k: "miss", b: p.id }); return; }
  let d = mob.st.atk * mult * rnd(0.85, 1.15) - st.def * 0.5;
  if (p.buff.guard > now()) d *= 0.5;
  if (p.buff.shield > now()) d *= 0.6;
  if (p.buff.mingwang > now()) d *= 0.4;
  if (p.buff.bati > now()) d *= 0.5;
  if (p.buff.barrier > now()) d *= 0.5;
  d = Math.max(1, Math.round(d));
  p.hp -= d; p.lastHit = now(); p.dirty = true;
  m.fx.push({ k: "m", a: mob.id, b: p.id, d });
  if (mult === 1 && st.thorn && !mob.dead && !mob.pvp) {        // 反傷：一般攻擊打回去
    const r = Math.max(1, Math.round(d * st.thorn / 100)); mob.hp -= r; mob.dmg.set(p.key, (mob.dmg.get(p.key) || 0) + r);
    m.fx.push({ k: "s", a: p.id, b: mob.id, d: r, c: 0, s: "thorn" }); if (mob.hp <= 0) killMob(m, mob);
  }
  if (p.hp <= 0) die(p);
}
function die(p) {
  const im = maps[p.map] && maps[p.map].inst;
  if (im && im.kind === "arena") { p.hp = 1; const w = [...players.values()].find((q) => q !== p && q.map === p.map); arenaEnd(maps[p.map], p, w || null); return; }    // 擂台：不會真的倒下
  p.hp = 0; p.dead = true; p.deadT = now(); p.path = null; p.tgt = null; p.queued = null;
  if (p.map !== "town" && !im) p.ch.recall = { map: p.map, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  const loss = Math.floor(D.expNeed(p.ch.lv) * D.DEATH_EXP_LOSS);
  p.ch.exp = Math.max(0, p.ch.exp - loss);
  sys(p, `你倒下了……損失 ${loss} 點經驗，5 秒後在長安城醒來。醒來後在城裡按 3 可以回到這裡。`);
  maps[p.map].fx.push({ k: "die", b: p.id });
  p.dirty = true;
}
function giveExp(p, n, raw) {
  const c = p.ch; if (c.lv >= D.LV_CAP) return;
  c.exp += raw ? n : Math.round(n * (1 + bonus(p, "exp")));
  while (c.lv < D.LV_CAP && c.exp >= D.expNeed(c.lv)) {
    c.exp -= D.expNeed(c.lv); c.lv++;
    const st = statsOf(p); p.hp = st.hp; p.mp = st.mp;
    maps[p.map].fx.push({ k: "lvl", b: p.id });
    const sk = allSkills(c).find((s) => s.lv === c.lv);
    fixSlots(c);
    p.invDirty = true;
    sys(p, `升到 ${c.lv} 級！${sk ? `學會新技能「${sk.name}」${c.slots.includes(sk.id) ? "，已放進技能欄" : "，按 K 可以換到技能欄"}。` : ""}`);
    for (const q of players.values()) q.known.delete(p.id);       // 名牌上的等級要更新
  }
  if (c.lv >= D.LV_CAP) c.exp = 0;
  p.dirty = true;
}
function killMob(m, mob) {
  mob.dead = true; mob.hp = 0; mob.tgt = null; mob.path = null;
  mob.respawnAt = now() + (mob.def.boss || mob.def.elite ? mob.def.respawn * 1000 : rnd(12000, 22000));
  m.fx.push({ k: "kill", b: mob.id });
  const dmg = [...mob.dmg.entries()].filter(([k]) => { const q = players.get(k); return q && q.map === m.id; });
  mob.dmg = new Map();
  if (!dmg.length) return;
  const total = dmg.reduce((s, [, v]) => s + v, 0);
  if (m.inst && m.inst.kind === "dg" && mob === m.inst.boss) { dgBossKilled(m, mob); return; }
  if (m.inst && mob.def.boss) return;          // 爬塔的王：獎勵在上樓時給
  if (mob.def.boss) {
    const names = [];
    for (const [k, v] of dmg) {
      const q = players.get(k), share = v / total;
      if (share < 0.03) continue;
      giveExp(q, Math.round(mob.st.exp * Math.max(0.25, share)));
      const gold = Math.round(mob.st.gold * Math.max(0.15, share)); q.ch.gold += gold;
      const it = randomDrop(q, mob.def.lv, true), own = [q.key];
      dropLoot(m, it, mob.x, mob.y, own);
      const bs = D.BOSS_SET[mob.k]; if (bs && Math.random() * 100 < D.BOSS_SET_P) { const si = makeSetItem(bs, pickSlot(), tierFor(mob.def.lv), Math.max(2, rollRarity(true)), q.ch.cls, q.ch); dropLoot(m, si, mob.x, mob.y, own); sysAll(`【套裝】${q.ch.name} 從${mob.def.name}身上拿到「${si.n}」！`); }
      dropLoot(m, { p: "ore", q: 2 + randomInt(3) }, mob.x, mob.y, own);
      if (Math.random() < 0.5) dropLoot(m, { p: "jade", q: 1 }, mob.x, mob.y, own);
      if (Math.random() < 0.25) dropLoot(m, { p: "recast", q: 1 }, mob.x, mob.y, own);
      q.dirty = true;
      sys(q, `擊敗${mob.def.name}！分到 ${gold} 兩，你的戰利品掉在地上（名字是你的顏色），${D.LOOT_OWN} 秒內只有你撿得到。`);
      names.push(q.ch.name);
      bountyHit(q, "boss"); { const A = db.acc[q.key]; if (A) A.bk = (A.bk || 0) + 1; }
      if (it.r === 3) sysAll(`【傳說】${q.ch.name} 從${mob.def.name}身上得到傳說裝備「${it.n}」！`);
    }
    sysAll(`【${m.def.name}】${mob.def.name}被 ${names.join("、")} 擊敗了，${Math.round(mob.def.respawn / 60)} 分鐘後重生。`);
    return;
  }
  // 一般怪：傷害最高的人拿金幣和寶物；經驗給他和同地圖附近的隊友平分（人越多加成越多）
  dmg.sort((a, b) => b[1] - a[1]);
  const top = players.get(dmg[0][0]);
  const mates = top.party ? [...parties.get(top.party).members].map((k) => players.get(k)).filter((q) => q && q.map === m.id && !q.dead && dist(q, mob) < 16) : [top];
  if (!mates.includes(top)) mates.push(top);
  const each = Math.round(mob.st.exp * (1 + 0.15 * (mates.length - 1)) / mates.length);
  for (const q of mates) {
    bountyHit(q, "kill", m.id);
    const gap = q.ch.lv - mob.def.lv;                       // 打比自己低太多的怪，經驗遞減
    giveExp(q, Math.max(1, Math.round(each * (gap > 4 ? Math.max(0.1, 1 - 0.15 * (gap - 4)) : 1))));
  }
  const gold = Math.max(1, Math.round(mob.st.gold * rnd(0.6, 1.4)));
  top.ch.gold += gold; top.dirty = true;
  m.fx.push({ k: "gold", b: mob.id, d: gold, a: top.id });
  const r = Math.random();
  let it = null;
  if (r < 0.09 * (1 + bonus(top, "drop"))) it = randomDrop(top, mob.def.lv, false);
  else if (r < 0.21) { const lv = mob.def.lv; it = { p: Math.random() < 0.6 ? (lv >= 80 ? "hp6" : lv >= 60 ? "hp5" : lv >= 30 ? "hp4" : lv >= 18 ? "hp3" : lv >= 10 ? "hp2" : "hp1") : (lv >= 80 ? "mp5" : lv >= 60 ? "mp4" : lv >= 30 ? "mp3" : lv >= 10 ? "mp2" : "mp1"), q: 1 }; }
  // 強化材料：一般怪偶爾掉玄鐵、很少掉靈玉
  const mr = Math.random();
  const own = top.party ? [...parties.get(top.party).members] : [top.key];
  if (mr < 0.05 || (mr < 0.062 && mob.def.lv >= 10)) dropLoot(m, { p: mr < 0.05 ? "ore" : "jade", q: 1 }, mob.x, mob.y, own);
  if (mob.def.elite) {      // 小王：必掉一件裝備（三成機會是王級品質），外加玄鐵、偶爾靈玉／重鑄石
    it = randomDrop(top, mob.def.lv, Math.random() < 0.3);
    dropLoot(m, { p: "ore", q: 1 + randomInt(2) }, mob.x, mob.y, own);
    if (Math.random() < 0.35) dropLoot(m, { p: "jade", q: 1 }, mob.x, mob.y, own);
    if (Math.random() < 0.08) dropLoot(m, { p: "recast", q: 1 }, mob.x, mob.y, own);
    for (const q of mates) sys(q, `打倒小王「${mob.def.name}」！戰利品掉在地上，${Math.round(mob.def.respawn / 60)} 分鐘後牠會再出現。`);
  }
  if (it) {
    dropLoot(m, it, mob.x, mob.y, own);
    if (!it.p && it.r === 3) sysAll(`【傳說】${top.ch.name} 打倒${mob.def.name}，掉出傳說裝備「${it.n}」！`);
  }
}

// ======================================================================== 地上的掉落物
// 打怪掉的東西先掉在地上，點了才撿；前 LOOT_OWN 秒只有打倒的人（和隊友）撿得到，LOOT_TTL 秒後消失
let lootSeq = 1;
function dropLoot(m, it, x, y, own) {
  for (let k = 0; k < 10; k++) {          // 散開一點，找一格走得到的地
    const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 1.1, nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
    if (walk(m, nx, ny)) { x = nx; y = ny; break; }
  }
  const t = now();
  m.loot.push({ id: lootSeq++, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, it, own: own || null, ownUntil: t + D.LOOT_OWN * 1000, until: t + D.LOOT_TTL * 1000 });
  m.lootDirty = true;
}
const lootView = (m, key) => m.loot.map((l) => { const it = l.it, mine = !l.own || l.ownUntil < now() || l.own.includes(key); return { id: l.id, x: l.x, y: l.y, n: it.p ? `${D.POTIONS[it.p].name}${it.q > 1 ? " ×" + it.q : ""}` : (it.e ? `+${it.e} ` : "") + it.n, r: it.p ? (it.p === "recast" ? 3 : it.p === "jade" ? 2 : it.p === "ore" ? 1 : 0) : it.r, s: it.s || "", c: it.c || "", p: it.p || "", set: it.set || "", mine: mine ? 1 : 0 }; });
function tryPick(p, l) {
  const m = maps[p.map], t = now();
  if (l.own && l.ownUntil > t && !l.own.includes(p.key)) return `這是別人打到的，再等 ${Math.ceil((l.ownUntil - t) / 1000)} 秒才能撿`;
  if (!addItem(p, l.it.p ? { p: l.it.p, q: l.it.q } : l.it)) return "背包滿了";
  m.loot.splice(m.loot.indexOf(l), 1); m.lootDirty = true; invChanged(p);
  const it = l.it;
  m.fx.push({ k: "loot", a: p.id, b: p.id, n: it.p ? `${D.POTIONS[it.p].name}${it.q > 1 ? " ×" + it.q : ""}` : it.n, r: it.p ? 0 : it.r });
  return null;
}
function tickLoot(m) {
  const t = now(), n0 = m.loot.length;
  m.loot = m.loot.filter((l) => l.until > t);
  if (m.loot.length !== n0) m.lootDirty = true;
  for (const l of m.loot) if (l.own && !l.freed && l.ownUntil <= t) { l.freed = true; m.lootDirty = true; }      // 保護時間到了：大家都能撿（顏色要更新）
}

// ======================================================================== 技能
// 延後執行（投射物飛到才算命中、落雷延遲、持續傷害）
const pending = [];
const later = (ms, fn) => pending.push({ at: now() + ms, fn });
function runPending() { const t = now(); for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= t) { const f = pending.splice(i, 1)[0].fn; try { f(); } catch (e) { console.log("江湖延遲事件錯誤", e && e.message); } } }
// 從 (x,y) 往 (dx,dy) 走，最遠 len 格，撞牆就停；r 是身體半徑（衝刺用）
function rayLen(m, x, y, dx, dy, len, r = 0) {
  let d = 0;
  while (d < len) { const nd = Math.min(len, d + 0.1), nx = x + dx * nd, ny = y + dy * nd; if (!walk(m, nx, ny) || (r && (!walk(m, nx + r, ny) || !walk(m, nx - r, ny)))) break; d = nd; }
  return d;
}
// 一條線（寬 w）上的怪，依距離排序
function mobsOnLine(m, x, y, dx, dy, len, w, list = m.mobs) {
  const out = [];
  for (const mob of list) {
    if (mob.dead) continue;
    const vx = mob.x - x, vy = mob.y - y, along = vx * dx + vy * dy, side = Math.abs(vx * dy - vy * dx);
    if (along >= -0.3 && along <= len + 0.4 && side <= w / 2 + (mob.def.boss ? 1.0 : mob.def.elite ? 0.7 : 0.45)) out.push({ mob, along });
  }
  return out.sort((a, b) => a.along - b.along);
}
function applyFx(p, mob, sk) {      // 附帶效果：暈眩、緩速、中毒
  if (mob.dead) return;
  if (mob.pvp) { if (sk.dot) for (let k = 1; k <= sk.dot[1]; k++) later(k * 1000, () => hitPvp(p, mob.pvp, sk.dot[0], "dot")); return; }
  const t = now();
  if (sk.stun) mob.stunT = Math.max(mob.stunT || 0, t + sk.stun * 1000 * (mob.def.boss ? 0.4 : mob.def.elite ? 0.7 : 1));
  if (sk.slow) { mob.slowT = t + sk.slow[1] * 1000; mob.slowP = sk.slow[0] * (mob.def.boss ? 0.5 : 1); }
  if (sk.curse) { mob.curseT = t + sk.curse[1] * 1000; mob.curseP = sk.curse[0]; }
  if (sk.dot) for (let k = 1; k <= sk.dot[1]; k++) later(k * 1000, () => { if (!mob.dead && players.get(p.key) === p && p.map === mob.mapId) hitMob(p, mob, sk.dot[0], "dot", sk.id); });
}
function strike(p, mob, sk, mult = sk.mult) {
  if (mult > 0) {
    if (sk.exec && !mob.pvp && mob.hp / mob.max < sk.exec[0]) mult *= sk.exec[1];         // 斬殺：殘血的敵人傷害加倍
    const d = hitMob(p, mob, mult, "s", sk.id);
    if (sk.drain && d > 0) { const st = statsOf(p), h = Math.round(d * sk.drain / 100); if (p.hp < st.hp) { p.hp = Math.min(st.hp, p.hp + h); p.dirty = true; maps[p.map].fx.push({ k: "heal", b: p.id, d: h }); } }
  }
  applyFx(p, mob, sk);
}
const nearestMob = (m, x, y, r, list = m.mobs) => { let best = null, bd = r; for (const mob of list) if (!mob.dead) { const d = Math.hypot(mob.x - x, mob.y - y); if (d < bd) { bd = d; best = mob; } } return best; };

// 實際冷卻：冷卻縮減（全部招）× 單一技能冷卻詞條（只算那一招，最多 SKCD.max%）
function effCd(st, sk) { return sk.cd * (1 - Math.min(D.ADD_STAT.cdr, st.cdr || 0) / 100) * (1 - Math.min(D.SKCD.max, st["cd_" + sk.id] || 0) / 100); }
function castSkill(p, sk, aim) {
  const m = maps[p.map], t = now();
  p.mp -= sk.mp; p.cd[sk.id] = t + effCd(statsOf(p), sk) * 1000; p.lastHit = Math.max(p.lastHit, t - 4000); p.dirty = true;
  const base = { k: "sk", a: p.id, s: sk.id, type: sk.type };
  if (sk.type === "self") {
    m.fx.push({ ...base, x: p.x, y: p.y, r: sk.r || 0, ...(sk.pet ? { dur: sk.pet.dur, follow: sk.pet.follow ? 1 : 0 } : {}), ...(sk.buff ? { bt: sk.buff[1] } : {}) });
    if (sk.buff) p.buff[sk.buff[0]] = t + sk.buff[1] * 1000;
    if (sk.buff && sk.buff[0] === "stealth") { for (const mob of m.mobs) if (mob.tgt === p.key) { mob.tgt = null; mob.path = null; } for (const q of players.values()) q.known.delete(p.id); }
    if (sk.pet) { p.pets = (p.pets || []).filter((x) => x.sid !== sk.id); p.pets.push({ sid: sk.id, ...sk.pet, sk, x: p.x, y: p.y, map: p.map, until: t + sk.pet.dur * 1000, next: t + 300 }); }
    if (sk.taunt) for (const mob of m.mobs) if (!mob.dead && dist(mob, p) <= sk.r) { mob.tgt = p.key; mob.path = null; }
    if (sk.heal) {
      const who = [p];
      if (p.party) for (const k of parties.get(p.party).members) { const q = players.get(k); if (q && q !== p && q.map === p.map && !q.dead && dist(q, p) <= sk.r) who.push(q); }
      for (const q of who) { const mx = statsOf(q).hp; q.hp = Math.min(mx, q.hp + mx * sk.heal); q.dirty = true; m.fx.push({ k: "heal", b: q.id, d: Math.round(mx * sk.heal) }); if (sk.pbuff) q.buff[sk.pbuff[0]] = t + sk.pbuff[1] * 1000; }
    } else if (sk.r && sk.mult) {
      const hits = sk.hits || 1;
      for (let h = 0; h < hits; h++) later(h * 260, () => { if (players.get(p.key) !== p || p.map !== m.id) return; for (const mob of foes(m, p)) if (!mob.dead && dist(mob, p) <= sk.r) strike(p, mob, sk); });
    }
    return;
  }
  if (sk.type === "target") {
    const mob = aim.mob;
    if (sk.blink && !mob.pvp) {        // 瞬移到目標身後
      const d = Math.hypot(mob.x - p.x, mob.y - p.y) || 1, bx = mob.x + (mob.x - p.x) / d * 0.9, by = mob.y + (mob.y - p.y) / d * 0.9;
      const to = walk(m, bx, by) ? { x: bx, y: by } : walk(m, mob.x - (mob.x - p.x) / d * 0.9, mob.y - (mob.y - p.y) / d * 0.9) ? { x: mob.x - (mob.x - p.x) / d * 0.9, y: mob.y - (mob.y - p.y) / d * 0.9 } : null;
      if (to) { m.fx.push({ ...base, x: p.x, y: p.y, dx: to.x - p.x, dy: to.y - p.y, len: 1, dash: 1, blinkTo: 1 }); p.x = to.x; p.y = to.y; p.path = null; p.face = mob.x >= p.x ? 1 : -1; }
    }
    m.fx.push({ ...base, b: mob.id, x: mob.x, y: mob.y });
    const hits = sk.hits || 1;
    for (let h = 0; h < hits; h++) later(h * 140 + 120, () => { if (players.get(p.key) === p && p.map === m.id) strike(p, mob, sk); });
    return;
  }
  // 方向：滑鼠位置減掉自己的位置
  let dx = aim.x - p.x, dy = aim.y - p.y; const l = Math.hypot(dx, dy);
  if (l < 0.05) { dx = p.face || 1; dy = 0; } else { dx /= l; dy /= l; }
  p.face = dx >= 0 ? 1 : -1;
  if (sk.type === "dir") {
    if (sk.dash) {
      const len = rayLen(m, p.x, p.y, dx, dy, sk.range, 0.28), x0 = p.x, y0 = p.y;
      const hit = sk.mult ? mobsOnLine(m, x0, y0, dx, dy, len, sk.w, foes(m, p)) : [];
      p.x = x0 + dx * len; p.y = y0 + dy * len; p.path = null; p.tgt = null; p.queued = null;
      if (sk.buff) p.buff[sk.buff[0]] = t + sk.buff[1] * 1000;
      m.fx.push({ ...base, x: x0, y: y0, dx, dy, len, dash: 1 });
      for (const { mob } of hit) strike(p, mob, sk);
      return;
    }
    const dirs = [];
    const n = sk.arrows || 1, spread = (sk.spread || 0) * Math.PI / 180, a0 = Math.atan2(dy, dx);
    for (let k = 0; k < n; k++) { const a = n > 1 ? a0 - spread / 2 + spread * k / (n - 1) : a0; dirs.push([Math.cos(a), Math.sin(a)]); }
    for (const [ddx, ddy] of dirs) {
      const wall = rayLen(m, p.x, p.y, ddx, ddy, sk.range);
      let hits = mobsOnLine(m, p.x, p.y, ddx, ddy, wall, sk.w, foes(m, p));
      if (!sk.pierce) hits = hits.slice(0, 1);
      const len = !sk.pierce && hits.length ? hits[0].along : wall;
      m.fx.push({ ...base, x: p.x, y: p.y, dx: ddx, dy: ddy, len, spd: sk.spd || 14 });
      for (const { mob, along } of hits) later((along / (sk.spd || 14)) * 1000, () => { if (players.get(p.key) === p && p.map === m.id) strike(p, mob, sk); });
    }
    return;
  }
  if (sk.type === "ground") {
    let cx = aim.x, cy = aim.y; const d = Math.hypot(cx - p.x, cy - p.y);
    if (d > sk.range) { cx = p.x + (cx - p.x) / d * sk.range; cy = p.y + (cy - p.y) / d * sk.range; }
    if (sk.leap) {
      const len = rayLen(m, p.x, p.y, dx, dy, Math.min(sk.range, Math.hypot(cx - p.x, cy - p.y)), 0.28);
      m.fx.push({ ...base, x: p.x, y: p.y, dx, dy, len, dash: 1 });
      p.x += dx * len; p.y += dy * len; cx = p.x; cy = p.y; p.path = null; p.tgt = null;
    }
    m.fx.push({ ...base, x: cx, y: cy, r: sk.r, t: (sk.delay || 0) * 1000, ticks: sk.ticks || 1 });
    const ticks = sk.ticks || 1;
    for (let k = 0; k < ticks; k++) later((sk.delay || 0) * 1000 + k * 600, () => {
      if (players.get(p.key) !== p || p.map !== m.id) return;
      for (const mob of foes(m, p)) if (!mob.dead && Math.hypot(mob.x - cx, mob.y - cy) <= sk.r + (mob.def.boss ? 0.8 : mob.def.elite ? 0.4 : 0)) strike(p, mob, sk);
      if (k > 0) m.fx.push({ k: "tick", s: sk.id, x: cx, y: cy, r: sk.r });
    });
  }
}
// aim：{ x, y, id }（滑鼠的世界座標、滑鼠下的怪）
function tryCast(p, sk, aim) {
  if (p.dead) return null;
  if (p.stunT > now()) return "暈眩中，不能放招";
  if (p.ch.lv < sk.lv) return `${sk.lv} 級才能用`;
  if (!p.ch.slots.includes(sk.id)) return "這招沒有放在技能欄";
  if ((p.cd[sk.id] || 0) > now()) return null;
  if (p.mp < sk.mp) return "法力不夠";
  const m = maps[p.map];
  if (sk.type === "target") {
    const F = foes(m, p);
    let mob = aim.id ? F.find((x) => x.id === aim.id && !x.dead) : null;
    if (!mob && Number.isFinite(aim.x)) mob = nearestMob(m, aim.x, aim.y, 1.6, F);
    if (!mob && p.tgt) mob = F.find((x) => x.id === p.tgt && !x.dead);
    if (!mob) return "這招要指定一隻怪：把滑鼠移到怪身上再放";
    if (dist(p, mob) > sk.range) { p.tgt = mob.id; p.queued = sk.id; return null; }   // 太遠：先走過去，到了自動放
    castSkill(p, sk, { mob }); return null;
  }
  if (!Number.isFinite(aim.x) || !Number.isFinite(aim.y)) {    // 沒給滑鼠位置（例如手機點按鈕）：朝目標或面向放
    const mob = p.tgt && m.mobs.find((x) => x.id === p.tgt && !x.dead);
    aim = mob ? { x: mob.x, y: mob.y } : { x: p.x + (p.face || 1) * 3, y: p.y };
  }
  castSkill(p, sk, aim); return null;
}
const skillDef = (c, id) => allSkills(c).find((s) => s.id === id);
function fixSlots(c) {      // 舊存檔沒有技能欄：照學會的順序放；新學會的招自動補進空格
  if (!Array.isArray(c.slots)) c.slots = [];
  c.slots = c.slots.slice(0, slotN(c)).map((id) => (id && skillDef(c, id) && skillDef(c, id).lv <= c.lv ? id : ""));
  while (c.slots.length < slotN(c)) c.slots.push("");
  for (const s of allSkills(c)) if (s.lv <= c.lv && !c.slots.includes(s.id)) { const i = c.slots.indexOf(""); if (i < 0) break; c.slots[i] = s.id; }
}

// ======================================================================== 每 0.1 秒的世界模擬
function findMob(m, id) {
  const mob = m.mobs.find((x) => x.id === id); if (mob || !m.pvp) return mob;
  const q = byId.get(id); return q && q.map === m.id ? proxy(q) : undefined;
}
// 擂台：把對手包成「像怪一樣」的物件，技能和普攻的程式就不用另外寫一套
function proxy(q) { return { id: q.id, x: q.x, y: q.y, dead: q.dead || !(maps[q.map] && maps[q.map].inst && maps[q.map].inst.fight), def: { boss: false, name: q.ch.name }, pvp: q, mapId: q.map }; }
function foes(m, p) { if (!m.pvp) return m.mobs; const l = m.mobs.slice(); for (const q of players.values()) if (q !== p && q.map === m.id) l.push(proxy(q)); return l; }
function hitPvp(p, q, mult, fxKind) {
  const m = maps[p.map]; if (!m || !m.inst || !m.inst.fight || q.dead || q.map !== p.map) return 0;
  const st = statsOf(p), sq = statsOf(q), crit = Math.random() * 100 < st.crit;
  const A = D.ARENA;
  let d = (st.atk * mult * rnd(0.9, 1.1) * (crit ? A.crit + st.cdmg / 200 : 1) - sq.def * 0.5 * (1 - st.pen / 100)) * A.dmg;
  d = Math.min(d, sq.hp * (mult > 1 || (fxKind && fxKind !== "h") ? A.cap : A.capAtk));       // 單下上限：至少要打好幾下才分得出勝負
  if (q.buff.guard > now()) d *= 0.5; if (q.buff.shield > now()) d *= 0.6; if (q.buff.mingwang > now()) d *= 0.4;
  if (q.buff.barrier > now()) d *= 0.7;
  if (sq.dodge && Math.random() * 100 < sq.dodge) { m.fx.push({ k: "miss", a: p.id, b: q.id }); return 0; }
  {   // 爆發上限：最近 win 毫秒內已經吃了多少，超過 burst 的部分打折
    const t = now(), lim = sq.hp * A.burst;
    q.pvpHits = (q.pvpHits || []).filter((h) => t - h[0] < A.win);
    const got = q.pvpHits.reduce((a, h) => a + h[1], 0);
    d = got >= lim ? d * A.over : got + d > lim ? (lim - got) + (got + d - lim) * A.over : d;
    q.pvpHits.push([t, d]);
  }
  if (st.ls) p.hp = Math.min(st.hp, p.hp + Math.max(0, d) * st.ls / 100 * 0.5);
  d = Math.max(1, Math.round(d));
  q.hp -= d; q.lastHit = p.lastHit = now(); q.dirty = true;
  m.fx.push({ k: fxKind || "h", a: p.id, b: q.id, d, c: crit ? 1 : 0 });
  if (q.hp <= 0) die(q);
  return d;
}
function tickPlayer(p, dt) {
  const m = maps[p.map], t = now();
  if (p.dead) {
    if (t - p.deadT > 5000) { p.dead = false; const st = statsOf(p); p.hp = st.hp * 0.5; p.mp = st.mp * 0.5; placeIn(p, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y); }
    return;
  }
  const st = statsOf(p);
  // 回血回魔：5 秒沒戰鬥回得快
  const calm = t - p.lastHit > 5000;
  const hp0 = p.hp, mp0 = p.mp;
  p.hp = Math.min(st.hp, p.hp + st.hp * (calm ? 0.04 : 0.005) * dt);
  p.mp = Math.min(st.mp, p.mp + st.mp * (calm ? 0.04 : 0.012) * dt);
  if ((p.hp | 0) !== (hp0 | 0) || (p.mp | 0) !== (mp0 | 0)) p.dirty = true;
  if (p.pets && p.pets.length) {
    p.pets = p.pets.filter((x) => x.until > t && x.map === p.map);
    for (const pe of p.pets) {
      if (pe.follow) { pe.x = p.x; pe.y = p.y; }
      if (t < pe.next) continue; pe.next = t + pe.every;
      const list = foes(m, p).filter((mob) => !mob.dead && Math.hypot(mob.x - pe.x, mob.y - pe.y) <= pe.r).sort((a, b) => Math.hypot(a.x - pe.x, a.y - pe.y) - Math.hypot(b.x - pe.x, b.y - pe.y)).slice(0, pe.n || 1);
      for (const mob of list) { m.fx.push({ k: "petshot", a: p.id, s: pe.sid, x: pe.x, y: pe.y, b: mob.id }); hitMob(p, mob, pe.mult, "s", pe.sid); if (pe.slow && !mob.pvp) { mob.slowT = t + pe.slow[1] * 1000; mob.slowP = pe.slow[0]; } }
    }
  }
  if (p.stunT > t) return;                        // 被王暈住：這段時間不能動也不能打
  // 鍵盤（WASD）移動：照方向一直走，撞牆時沿著牆滑；這時不會自動追怪，但目標在射程內照樣普攻
  const keyMove = p.dir && t - p.dirT < 1200;
  if (keyMove) {
    p.path = null;
    const step = st.spd * dt, r = 0.28, nx = p.x + p.dir.x * step, ny = p.y + p.dir.y * step;
    const free = (x, y) => walk(m, x - r, y) && walk(m, x + r, y) && walk(m, x, y - r * 0.6) && walk(m, x, y + r * 0.4);
    if (free(nx, p.y)) p.x = nx;
    if (free(p.x, ny)) p.y = ny;
  }
  // 追目標、普攻、到距離放技能
  if (p.tgt && keyMove) {
    const mob = findMob(m, p.tgt);
    if (!mob || mob.dead) { p.tgt = null; p.queued = null; }
    else if (!p.queued && dist(p, mob) <= st.range && t >= p.atkT) { p.atkT = t + st.aspd * 1000; hitMob(p, mob, 1, "h"); }
  } else if (p.tgt) {
    const mob = findMob(m, p.tgt);
    if (!mob || mob.dead) { p.tgt = null; p.queued = null; }
    else {
      const sk = p.queued ? skillDef(p.ch, p.queued) : null;
      const range = sk ? (sk.range || 6) : st.range;
      const d = dist(p, mob);
      if (d > range) {
        if (t - p.pathT > 400 || !p.path || !p.path.length) { p.pathT = t; p.path = clearLine(m, p, mob) ? [{ x: mob.x, y: mob.y }] : astar(m, p.x, p.y, mob.x, mob.y); }
        stepPath(p, st.spd, dt);
      } else {
        p.path = null;
        if (sk) { p.queued = null; if ((p.cd[sk.id] || 0) <= t && p.mp >= sk.mp) castSkill(p, sk, { mob, x: mob.x, y: mob.y }); }
        else if (t >= p.atkT) { p.atkT = t + st.aspd * 1000; hitMob(p, mob, 1, "h"); }
      }
    }
  } else if (p.path && p.path.length) stepPath(p, st.spd, dt);
  if (p.pickT) {
    const l = m.loot.find((x) => x.id === p.pickT);
    if (!l) p.pickT = 0;
    else if (Math.hypot(l.x - p.x, l.y - p.y) <= 1.3) { p.pickT = 0; p.path = null; const e = tryPick(p, l); if (e) out(p.ws, { t: "mo", a: "err", text: e }); }
    else if (!p.path || !p.path.length) p.pickT = 0;
  }
  // 傳送點
  const tile = m.t[Math.floor(p.y) * m.w + Math.floor(p.x)];
  if (tile === 4) {
    const pt = m.def.portals.find((q) => Math.abs(q.x - Math.floor(p.x)) <= 0 && (Math.floor(p.y) === q.y || Math.floor(p.y) === q.y + 1));
    if (pt && pt.escape && m.inst && m.inst.guard && !m.inst.guard.dead) {
      p.x = Math.min(p.x, pt.x - 0.6); p.path = null;
      if (!p.guardMsgT || now() - p.guardMsgT > 3000) { p.guardMsgT = now(); sys(p, "出口被熔岩封住了！先打倒「熔岩守將」才能出去。"); }
      return;
    }
    if (pt && pt.escape && m.inst && m.inst.kind === "dg") dgEscape(m, p);
    if (pt) placeIn(p, pt.to, pt.tx + 0.5, pt.ty + 0.5 + (Math.floor(p.y) - pt.y));
  }
}
// ======================================================================== 王的專屬技能
// 每隻王一套招式輪流放：先出預警（圓、直線、扇形、環形），預警結束才判定；放招時王站著不動（busyT）
const BOSS_SK = {
  b_bamboo: ["spikes", "leaves"],       // 竹妖：竹刺穿地、竹葉風暴
  b_tiger: ["pounce", "roar"],          // 白額虎王：猛虎撲擊、虎嘯山林（暈眩）
  b_corpse: ["pools", "raise"],         // 屍王：屍毒池（地上持續毒）、屍變（叫殭屍）
  b_snow: ["icicles", "breath"],        // 冰魄雪妖：冰錐雨、寒冰吐息（緩速）
  b_qilin: ["charge", "nova"],          // 火麒麟：烈焰衝鋒（留火）、麒麟踏火（三圈火環往外擴）
  b_lord: ["palm", "pull"],             // 魔教教主：天魔掌（打最遠的人）、吸星大法（拉過來再砸）
  b_fox: ["foxfire", "illusion"],       // 九尾妖狐：九尾狐火（九道放射）、幻狐分身（瞬移＋分身）
};
const foesNear = (m, x, y, r) => [...players.values()].filter((q) => q.map === m.id && !q.dead && Math.hypot(q.x - x, q.y - y) <= r);
const onLine = (q, x, y, dx, dy, len, w) => { const ax = q.x - x, ay = q.y - y, al = ax * dx + ay * dy; return al >= -0.4 && al <= len + 0.4 && Math.abs(ax * dy - ay * dx) <= w / 2 + 0.3; };
const inCone = (q, x, y, a, arc, r) => { const d = Math.hypot(q.x - x, q.y - y); if (d > r) return false; if (d < 0.6) return true; let da = Math.atan2(q.y - y, q.x - x) - a; da = Math.atan2(Math.sin(da), Math.cos(da)); return Math.abs(da) <= arc / 2; };
// 王技能的傷害（倍數 × 王的攻擊），附帶緩速／暈眩
function bossHit(m, mob, q, mult, o = {}) {
  if (q.dead || q.map !== m.id) return;
  hurtPlayer(m, mob, q, mult);
  const t = now();
  if (o.slow) q.slowT = Math.max(q.slowT || 0, t + o.slow * 1000);
  if (o.stun && !(q.buff.bati > t)) { q.stunT = Math.max(q.stunT || 0, t + o.stun * 1000); q.path = null; q.dirty = true; }
}
// 地面危險區：毒池、火痕；每 0.5 秒判定一次
function addHaz(m, h) { (m.haz || (m.haz = [])).push({ last: 0, ...h }); }
function tickHaz(m) {
  const t = now();
  m.haz = m.haz.filter((h) => h.until > t);
  for (const h of m.haz) {
    if (t < (h.on || 0) || t - h.last < 500) continue;
    h.last = t;
    for (const q of foesNear(m, h.x, h.y, h.r)) bossHit(m, h.mob, q, h.mult, { slow: h.slow });
  }
}
// 王的招式。回傳這招要站著不動多久（毫秒）
const BS = {
  // ---- 竹妖
  spikes(m, b, p) {
    const pts = foesNear(m, b.x, b.y, 12).slice(0, 4).map((q) => [q.x, q.y]);
    for (let i = 0; i < 2; i++) { const s = m.spots[randomInt(m.spots.length)]; if (Math.hypot(s.x - b.x, s.y - b.y) < 7) pts.push([s.x, s.y]); else pts.push([b.x + rnd(-3, 3), b.y + rnd(-3, 3)]); }
    for (const [x, y] of pts) m.fx.push({ k: "warn", x, y, r: 1.3, t: 1100, c: "g" });
    later(1100, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "spikes", a: b.id, pts: pts.map(([x, y]) => [r2(x) / 100, r2(y) / 100]) }); for (const [x, y] of pts) for (const q of foesNear(m, x, y, 1.3)) bossHit(m, b, q, 2.0); });
    return 1100;
  },
  leaves(m, b, p) {
    const a = Math.atan2(p.y - b.y, p.x - b.x), arc = 1.25, r = 5.5;
    m.fx.push({ k: "wcone", x: b.x, y: b.y, a, arc, r, t: 900, c: "g" });
    later(900, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "leaves", a: b.id, x: b.x, y: b.y, ang: a, arc, r }); for (const q of foesNear(m, b.x, b.y, r)) if (inCone(q, b.x, b.y, a, arc, r)) bossHit(m, b, q, 1.6, { slow: 2 }); });
    return 950;
  },
  // ---- 白額虎王
  pounce(m, b, p) {
    let dx = p.x - b.x, dy = p.y - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const len = rayLen(m, b.x, b.y, dx, dy, Math.min(9, l + 2), 0.4), x0 = b.x, y0 = b.y;
    m.fx.push({ k: "wline", x: x0, y: y0, dx, dy, len, w: 1.8, t: 800 });
    later(800, () => {
      if (b.dead) return;
      b.x = x0 + dx * len; b.y = y0 + dy * len; b.path = null;
      m.fx.push({ k: "bsk", s: "pounce", a: b.id, x: x0, y: y0, dx, dy, len });
      for (const q of foesNear(m, x0, y0, len + 1)) if (onLine(q, x0, y0, dx, dy, len, 1.8)) bossHit(m, b, q, 2.4);
    });
    return 1050;
  },
  roar(m, b) {
    const r = 4;
    m.fx.push({ k: "warn", x: b.x, y: b.y, r, t: 1200 });
    later(1200, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "roar", a: b.id, x: b.x, y: b.y, r }); for (const q of foesNear(m, b.x, b.y, r)) bossHit(m, b, q, 1.2, { stun: 1.3 }); });
    return 1300;
  },
  // ---- 屍王
  pools(m, b) {
    const pts = foesNear(m, b.x, b.y, 12).slice(0, 3).map((q) => [q.x, q.y]);
    while (pts.length < 3) pts.push([b.x + rnd(-4, 4), b.y + rnd(-3, 3)]);
    for (const [x, y] of pts) m.fx.push({ k: "warn", x, y, r: 1.7, t: 1000, c: "g" });
    later(1000, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "pools", a: b.id, pts: pts.map(([x, y]) => [r2(x) / 100, r2(y) / 100]), r: 1.7, dur: 6000 }); for (const [x, y] of pts) addHaz(m, { x, y, r: 1.7, until: now() + 6000, mob: b, mult: 0.55, slow: 0 }); });
    return 800;
  },
  raise(m, b) {
    const alive = m.mobs.filter((x) => x.summon === b.id && !x.dead).length;
    if (alive >= 6) return BS.pools(m, b);
    const pts = [0, 1, 2].map((i) => { const a = i * 2.1 + Math.random(); return [b.x + Math.cos(a) * 2.5, b.y + Math.sin(a) * 2]; }).filter(([x, y]) => walk(m, x, y));
    for (const [x, y] of pts) m.fx.push({ k: "warn", x, y, r: 0.9, t: 1100, c: "g" });
    later(1100, () => {
      if (b.dead) return;
      m.fx.push({ k: "bsk", s: "raise", a: b.id, pts: pts.map(([x, y]) => [r2(x) / 100, r2(y) / 100]) });
      for (const [x, y] of pts) { const z = spawnMob(m, "zombie", { x, y }, { ...D.MONS.zombie, name: "屍兵", lv: Math.max(1, b.def.lv - 4), agg: 12, hpm: 1.1 }); z.noRe = true; z.summon = b.id; z.dmgMul = 1; }
      for (const q of foesNear(m, b.x, b.y, 14)) sys(q, `${b.def.name}：「起來吧，我的屍兵！」`);
    });
    return 1200;
  },
  // ---- 冰魄雪妖
  icicles(m, b) {
    const pts = foesNear(m, b.x, b.y, 12).map((q) => [q.x, q.y]);
    for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 6; pts.push([b.x + Math.cos(a) * d, b.y + Math.sin(a) * d * 0.8]); }
    pts.forEach(([x, y], i) => {
      const wait = 900 + i * 70;
      m.fx.push({ k: "warn", x, y, r: 1.1, t: wait, c: "b" });
      later(wait, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "icicle", a: b.id, x, y }); for (const q of foesNear(m, x, y, 1.1)) bossHit(m, b, q, 1.4, { slow: 1.5 }); });
    });
    return 1000;
  },
  breath(m, b, p) {
    const a = Math.atan2(p.y - b.y, p.x - b.x), arc = 1.05, r = 6.5;
    m.fx.push({ k: "wcone", x: b.x, y: b.y, a, arc, r, t: 1000, c: "b" });
    later(1000, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "breath", a: b.id, x: b.x, y: b.y, ang: a, arc, r }); for (const q of foesNear(m, b.x, b.y, r)) if (inCone(q, b.x, b.y, a, arc, r)) bossHit(m, b, q, 1.8, { slow: 3 }); });
    return 1200;
  },
  // ---- 火麒麟
  charge(m, b, p) {
    let dx = p.x - b.x, dy = p.y - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const len = rayLen(m, b.x, b.y, dx, dy, 9, 0.4), x0 = b.x, y0 = b.y;
    m.fx.push({ k: "wline", x: x0, y: y0, dx, dy, len, w: 2, t: 900 });
    later(900, () => {
      if (b.dead) return;
      b.x = x0 + dx * len; b.y = y0 + dy * len; b.path = null;
      m.fx.push({ k: "bsk", s: "charge", a: b.id, x: x0, y: y0, dx, dy, len, dur: 4000 });
      for (const q of foesNear(m, x0, y0, len + 1)) if (onLine(q, x0, y0, dx, dy, len, 2)) bossHit(m, b, q, 2.2);
      for (let i = 0.5; i < len; i += 1.4) addHaz(m, { x: x0 + dx * i, y: y0 + dy * i, r: 1.0, until: now() + 4000, mob: b, mult: 0.45 });
    });
    return 1150;
  },
  nova(m, b) {
    const x = b.x, y = b.y, rings = [[0, 2.4, 900], [2.4, 4.4, 1500], [4.4, 6.4, 2100]];
    for (const [r0, r1, w] of rings) {
      m.fx.push({ k: "wring", x, y, r0, r1, t: w });
      later(w, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "nova", a: b.id, x, y, r0, r1 }); for (const q of foesNear(m, x, y, r1)) if (Math.hypot(q.x - x, q.y - y) >= r0) bossHit(m, b, q, 2.0); });
    }
    return 2150;
  },
  // ---- 魔教教主
  palm(m, b, p) {
    const all = foesNear(m, b.x, b.y, 14), q0 = all.sort((a, c) => Math.hypot(c.x - b.x, c.y - b.y) - Math.hypot(a.x - b.x, a.y - b.y))[0] || p;
    const x = q0.x, y = q0.y, r = 2.6;
    m.fx.push({ k: "warn", x, y, r, t: 1300 });
    for (const q of foesNear(m, b.x, b.y, 16)) if (q === q0) sys(q, "教主的天魔掌鎖定了你！快跑出紅圈！");
    later(1300, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "palm", a: b.id, x, y, r }); for (const q of foesNear(m, x, y, r)) bossHit(m, b, q, 3.0); });
    return 600;
  },
  pull(m, b) {
    const x = b.x, y = b.y, R = 7;
    m.fx.push({ k: "wring", x, y, r0: 2.6, r1: R, t: 500, c: "p" });
    later(500, () => {
      if (b.dead) return;
      m.fx.push({ k: "bsk", s: "pull", a: b.id, x, y, r: R });
      const who = foesNear(m, x, y, R);
      for (let i = 0; i < 6; i++) later(i * 160, () => { for (const q of who) { if (q.dead || q.map !== m.id) continue; const d = Math.hypot(q.x - x, q.y - y); if (d < 1.4) continue; const nx = q.x + (x - q.x) / d * 0.7, ny = q.y + (y - q.y) / d * 0.7; if (walk(m, nx, ny)) { q.x = nx; q.y = ny; q.path = null; } } });
      m.fx.push({ k: "warn", x, y, r: 2.6, t: 1100 });
      later(1100, () => { if (b.dead) return; m.fx.push({ k: "slam", x, y, r: 2.6 }); for (const q of foesNear(m, x, y, 2.6)) bossHit(m, b, q, 2.6); });
    });
    return 1700;
  },
  // ---- 九尾妖狐
  foxfire(m, b) {
    const x = b.x, y = b.y, a0 = Math.random() * 6.28, len = 8, dirs = [];
    for (let i = 0; i < 9; i++) { const a = a0 + i * (Math.PI * 2 / 9); dirs.push([Math.cos(a), Math.sin(a)]); }
    for (const [dx, dy] of dirs) m.fx.push({ k: "wline", x, y, dx, dy, len, w: 1.0, t: 900, c: "p" });
    later(900, () => {
      if (b.dead) return;
      m.fx.push({ k: "bsk", s: "foxfire", a: b.id, x, y, dirs: dirs.map(([dx, dy]) => [Math.round(dx * 1000) / 1000, Math.round(dy * 1000) / 1000]), len });
      for (const q of foesNear(m, x, y, len + 1)) if (dirs.some(([dx, dy]) => onLine(q, x, y, dx, dy, len, 1.0))) bossHit(m, b, q, 1.7);
    });
    return 950;
  },
  illusion(m, b, p) {
    const x0 = b.x, y0 = b.y;
    let to = null; for (let i = 0; i < 12 && !to; i++) { const a = Math.random() * 6.28, d = rnd(2.5, 4); const tx = p.x + Math.cos(a) * d, ty = p.y + Math.sin(a) * d; if (walk(m, tx, ty)) to = { x: tx, y: ty }; }
    if (!to) return BS.foxfire(m, b);
    b.x = to.x; b.y = to.y; b.path = null;
    m.fx.push({ k: "bsk", s: "blink", a: b.id, x: x0, y: y0, tx: to.x, ty: to.y });
    if (m.mobs.filter((x) => x.summon === b.id && !x.dead).length < 4) for (const [ax, ay] of [[x0, y0], [x0 + rnd(-2, 2), y0 + rnd(-2, 2)]]) if (walk(m, ax, ay)) { const z = spawnMob(m, "foxspirit", { x: ax, y: ay }, { ...D.MONS.foxspirit, name: "狐影分身", lv: Math.max(1, b.def.lv - 3), agg: 12, hpm: 0.8 }); z.noRe = true; z.summon = b.id; z.dmgMul = 1; }
    for (const q of foesNear(m, b.x, b.y, 14)) sys(q, "九尾妖狐化成狐影，分身出來了！");
    return 500;
  },
};
// ---- 60～100 級的四隻大王
Object.assign(BOSS_SK, {
  b_dragon: ["tide", "whirl"],              // 東海龍王：怒海狂濤（寬直線＋緩速）、漩渦水柱（腳下留水渦）
  b_kaiming: ["bite", "seal"],              // 開明獸：九首噬咬（大扇形）、鎮山印（貼在牠身邊才安全的環）
  b_yama: ["chain", "judge"],               // 閻羅王：勾魂鎖（把最遠的人拉過來）、生死簿（滿地判決圈）
  b_erlang: ["trident", "eye", "quake"],    // 二郎神：三尖兩刃、天眼神光、震天三圈
});
Object.assign(BS, {
  tide(m, b, p) {
    let dx = p.x - b.x, dy = p.y - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const x0 = b.x - dx, y0 = b.y - dy, len = 11, w = 4;
    m.fx.push({ k: "wline", x: x0, y: y0, dx, dy, len, w, t: 1100, c: "b" });
    later(1100, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "tide", a: b.id, x: x0, y: y0, dx, dy, len, w }); for (const q of foesNear(m, x0, y0, len + 2)) if (onLine(q, x0, y0, dx, dy, len, w)) bossHit(m, b, q, 2.2, { slow: 2.5 }); });
    return 1200;
  },
  whirl(m, b) {
    const pts = foesNear(m, b.x, b.y, 13).slice(0, 4).map((q) => [q.x, q.y]);
    while (pts.length < 3) pts.push([b.x + rnd(-4, 4), b.y + rnd(-3, 3)]);
    for (const [x, y] of pts) m.fx.push({ k: "warn", x, y, r: 1.8, t: 1000, c: "b" });
    later(1000, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "whirl", a: b.id, pts: pts.map(([x, y]) => [r2(x) / 100, r2(y) / 100]), r: 1.8, dur: 5000 }); for (const [x, y] of pts) { for (const q of foesNear(m, x, y, 1.8)) bossHit(m, b, q, 1.6); addHaz(m, { x, y, r: 1.8, until: now() + 5000, mob: b, mult: 0.5, slow: 1 }); } });
    return 900;
  },
  bite(m, b, p) {
    const a = Math.atan2(p.y - b.y, p.x - b.x), arc = 2.6, r = 4.8;
    m.fx.push({ k: "wcone", x: b.x, y: b.y, a, arc, r, t: 900 });
    later(900, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "bite", a: b.id, x: b.x, y: b.y, ang: a, arc, r }); for (const q of foesNear(m, b.x, b.y, r)) if (inCone(q, b.x, b.y, a, arc, r)) bossHit(m, b, q, 2.8); });
    return 1000;
  },
  seal(m, b) {
    const x = b.x, y = b.y;
    m.fx.push({ k: "wring", x, y, r0: 2.4, r1: 7.5, t: 1500 });
    for (const q of foesNear(m, x, y, 14)) sys(q, "開明獸要放鎮山印了——貼到牠身邊的圈裡才安全！");
    later(1500, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "seal", a: b.id, x, y, r0: 2.4, r1: 7.5 }); for (const q of foesNear(m, x, y, 7.5)) if (Math.hypot(q.x - x, q.y - y) >= 2.4) bossHit(m, b, q, 2.4, { stun: 1 }); });
    return 1600;
  },
  chain(m, b, p) {
    const all = foesNear(m, b.x, b.y, 14), q0 = all.sort((u, v) => Math.hypot(v.x - b.x, v.y - b.y) - Math.hypot(u.x - b.x, u.y - b.y))[0] || p;
    let dx = q0.x - b.x, dy = q0.y - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    m.fx.push({ k: "wline", x: b.x, y: b.y, dx, dy, len: l + 0.5, w: 0.9, t: 900, c: "p" });
    sys(q0, "閻羅王的勾魂鎖瞄準了你！");
    later(900, () => {
      if (b.dead || q0.dead || q0.map !== m.id) return;
      m.fx.push({ k: "bsk", s: "chain", a: b.id, b: q0.id, x: b.x, y: b.y, tx: q0.x, ty: q0.y });
      if (onLine(q0, b.x, b.y, dx, dy, l + 0.5, 1.4)) {
        const nx = b.x + dx * 1.3, ny = b.y + dy * 1.3; if (walk(m, nx, ny)) { q0.x = nx; q0.y = ny; q0.path = null; }
        bossHit(m, b, q0, 1.5, { stun: 0.8 });
      }
    });
    return 1000;
  },
  judge(m, b) {
    const pts = foesNear(m, b.x, b.y, 13).map((q) => [q.x, q.y]);
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 6; pts.push([b.x + Math.cos(a) * d, b.y + Math.sin(a) * d]); }
    pts.forEach(([x, y], i) => {
      const w = 1500 + i * 60;
      m.fx.push({ k: "warn", x, y, r: 1.6, t: w });
      later(w, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "judge", a: b.id, x, y, r: 1.6 }); for (const q of foesNear(m, x, y, 1.6)) bossHit(m, b, q, 2.4); });
    });
    for (const q of foesNear(m, b.x, b.y, 14)) sys(q, "閻羅王翻開生死簿——快離開紅圈！");
    return 900;
  },
  trident(m, b, p) {
    const a0 = Math.atan2(p.y - b.y, p.x - b.x), len = 9, dirs = [-0.42, 0, 0.42].map((o) => [Math.cos(a0 + o), Math.sin(a0 + o)]);
    for (const [dx, dy] of dirs) m.fx.push({ k: "wline", x: b.x, y: b.y, dx, dy, len, w: 1.3, t: 850 });
    later(850, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "trident", a: b.id, x: b.x, y: b.y, dirs: dirs.map(([dx, dy]) => [Math.round(dx * 1000) / 1000, Math.round(dy * 1000) / 1000]), len }); for (const q of foesNear(m, b.x, b.y, len + 1)) if (dirs.some(([dx, dy]) => onLine(q, b.x, b.y, dx, dy, len, 1.3))) bossHit(m, b, q, 2.3); });
    return 950;
  },
  eye(m, b, p) {
    let dx = p.x - b.x, dy = p.y - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const len = 15, x = b.x, y = b.y;
    m.fx.push({ k: "wline", x, y, dx, dy, len, w: 1.8, t: 1300, c: "p" });
    for (const q of foesNear(m, b.x, b.y, 16)) sys(q, "二郎神睜開天眼——快閃開那道光！");
    later(1300, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "eye", a: b.id, x, y, dx, dy, len }); for (const q of foesNear(m, x, y, len + 1)) if (onLine(q, x, y, dx, dy, len, 1.8)) bossHit(m, b, q, 3.2); });
    return 1400;
  },
  quake(m, b) {
    const x = b.x, y = b.y, rings = [[0, 2.2, 800], [2.2, 4.2, 1300], [4.2, 6.2, 1800], [6.2, 8.2, 2300]];
    for (const [r0, r1, w] of rings) {
      m.fx.push({ k: "wring", x, y, r0, r1, t: w });
      later(w, () => { if (b.dead) return; m.fx.push({ k: "bsk", s: "quake", a: b.id, x, y, r0, r1 }); for (const q of foesNear(m, x, y, r1)) if (Math.hypot(q.x - x, q.y - y) >= r0) bossHit(m, b, q, 2.0); });
    }
    return 2350;
  },
});
function bossCast(m, b, p) {
  const list = BOSS_SK[b.k]; b.bsi = ((b.bsi ?? -1) + 1) % list.length;
  b.busyT = now() + BS[list[b.bsi]](m, b, p);
}

function tickMob(m, mob, dt) {
  const t = now();
  if (mob.dead) {
    if (mob.noRe) return;
    if (t >= mob.respawnAt) {
      const at = mob.def.boss ? m.def.bossAt : mob.lair || m.spots[Math.floor(Math.random() * m.spots.length)];
      Object.assign(mob, { dead: false, hp: mob.max, x: at.x, y: at.y, hx: at.x, hy: at.y, tgt: null, path: null, dmg: new Map(), slamAt: 0, busyT: 0, bsT: undefined, bsi: -1 });
      if (mob.def.boss) sysAll(`【${m.def.name}】${mob.def.name}出現了！`);
      else if (mob.def.elite) for (const q of players.values()) if (q.map === m.id) sys(q, `【小王】${mob.def.name}又出現在${m.def.name}了。`);
    }
    return;
  }
  if (mob.stunT > t) return;                      // 暈眩：不動、不打
  const sp = mob.st.spd * (mob.slowT > t ? 1 - (mob.slowP || 0) : 1);
  const leash = mob.def.boss ? 16 : mob.def.elite ? 14 : 12;
  let p = mob.tgt ? players.get(mob.tgt) : null;
  if (p && (p.map !== m.id || p.dead || Math.hypot(mob.x - mob.hx, mob.y - mob.hy) > leash)) { mob.tgt = null; p = null; mob.path = astar(m, mob.x, mob.y, mob.hx, mob.hy); mob.returning = true; }
  if (!p && mob.def.agg && !mob.returning) {
    let best = null, bd = mob.def.agg;
    for (const q of players.values()) if (q.map === m.id && !q.dead && !(q.buff.stealth > t)) { const d = dist(q, mob); if (d < bd) { bd = d; best = q; } }
    if (best) { mob.tgt = best.key; p = best; }
  }
  if (p) {
    mob.returning = false;
    const range = mob.def.boss ? 1.9 : mob.def.elite ? 1.5 : 1.2, d = dist(mob, p);
    // 王（和小王）的範圍重擊：先出警示圈，1.2 秒後打圈內所有人
    if (mob.def.boss && BOSS_SK[mob.k]) {
      if (mob.busyT > t) return;                       // 放招中：站著不動
      const I = m.inst, gap = (mob.enrage ? 3200 : 5600) * (I && I.kind === "dg" && I.boss === mob && D.DUNGEONS[I.key].kind !== "trap" ? 1.5 : 1);
      if (mob.bsT === undefined) mob.bsT = t - gap + 2200;   // 剛發現人：2 秒多後出第一招
      if (t - mob.bsT > gap && d < 10) { mob.bsT = t; bossCast(m, mob, p); return; }
    } else if (mob.def.boss || mob.def.elite) {
      const SR = mob.def.boss ? 2.8 : 2.1;
      if (!mob.slamAt && t - mob.slamT > (mob.enrage ? 3500 : mob.def.boss ? 7000 : 9000) && d < 4) { mob.slamAt = t + 1200; mob.slamX = mob.x; mob.slamY = mob.y; m.fx.push({ k: "warn", x: mob.x, y: mob.y, r: SR, t: 1200 }); }
      if (mob.slamAt && t >= mob.slamAt) {
        mob.slamAt = 0; mob.slamT = t; m.fx.push({ k: "slam", x: mob.slamX, y: mob.slamY, r: SR });
        for (const q of players.values()) if (q.map === m.id && !q.dead && Math.hypot(q.x - mob.slamX, q.y - mob.slamY) <= SR) hurtPlayer(m, mob, q, mob.def.boss ? 2.2 : 1.8);
      }
      if (mob.slamAt) return;   // 蓄力中不動
    }
    if (d > range) {
      if (t - mob.pathT > 600 || !mob.path || !mob.path.length) { mob.pathT = t; mob.path = clearLine(m, mob, p) ? [{ x: p.x, y: p.y }] : astar(m, mob.x, mob.y, p.x, p.y, 1500); }
      stepPath(mob, sp, dt);
    } else if (t >= mob.atkT) { mob.atkT = t + mob.st.aspd * 1000; hurtPlayer(m, mob, p); }
    return;
  }
  // 沒目標：回家、回血、閒晃
  if (mob.returning) { if (stepPath(mob, sp * 1.5, dt)) { mob.returning = false; mob.hp = mob.max; mob.dmg = new Map(); } return; }
  if (mob.hp < mob.max && t - mob.calmT > 8000) { mob.hp = Math.min(mob.max, mob.hp + mob.max * 0.1 * dt); if (mob.hp >= mob.max) mob.dmg = new Map(); }
  if (mob.path && mob.path.length) { stepPath(mob, sp * 0.5, dt); return; }
  if (t > mob.wanderT && !mob.def.boss) {
    mob.wanderT = t + rnd(3000, 7000);
    const tx = mob.hx + rnd(-3, 3), ty = mob.hy + rnd(-3, 3);
    if (walk(m, tx, ty)) mob.path = astar(m, mob.x, mob.y, tx, ty, 400);
  }
}

// 每個地圖送一份快照給裡面的玩家
const r2 = (v) => Math.round(v * 100);
function broadcast(m) {
  const here = [...players.values()].filter((p) => p.map === m.id);
  m.lootSend = m.lootDirty; m.lootDirty = false;
  if (!here.length) { m.fx = []; return; }
  const ents = [];
  for (const p of here) {
    const st = statsOf(p);
    ents.push([p.id, r2(p.x), r2(p.y), Math.max(0, Math.round(p.hp / st.hp * 100)), (p.dead ? 1 : 0) | (p.buff.guard > now() ? 2 : 0) | (p.buff.gale > now() ? 4 : 0) | (p.stunT > now() ? 32 : 0) | (p.slowT > now() ? 64 : 0) | (p.buff.stealth > now() ? 8 : 0), Math.max(0, Math.round(p.mp / st.mp * 100))]);
  }
  const tn = now();
  for (const mob of m.mobs) if (!mob.dead) ents.push([mob.id, r2(mob.x), r2(mob.y), Math.max(0, Math.round(mob.hp / mob.max * 100)), (mob.tgt ? 8 : 0) | (mob.slamAt || mob.busyT > tn ? 16 : 0) | (mob.stunT > tn ? 32 : 0) | (mob.slowT > tn ? 64 : 0)]);
  const fx = m.fx; m.fx = [];
  for (const p of here) {
    const meta = {};
    for (const e of ents) if (!p.known.has(e[0])) {
      p.known.add(e[0]);
      const q = byId.get(e[0]);
      if (q) meta[e[0]] = { k: "p", n: q.ch.name, lv: q.ch.lv, c: q.ch.cls, ad: q.ch.adv2 || q.ch.adv || "", pt: q.party || 0 };
      else { const mob = m.mobs.find((x) => x.id === e[0]); if (mob) meta[e[0]] = { k: "m", n: mob.def.name, lv: mob.def.lv, s: mob.def.shape, boss: mob.def.boss ? 1 : 0, el: mob.def.elite ? 1 : 0 }; }
    }
    const msg = { t: "mo", a: "s", e: ents, fx };
    if (m.lootSend) msg.loot = lootView(m, p.key);
    if (Object.keys(meta).length) msg.meta = meta;
    out(p.ws, msg);
    if (p.dirty && now() - p.meSent > 200) sendMe(p);
  }
}
function sendMe(p) {
  const full = p.invDirty; p.dirty = false; p.invDirty = false; p.meSent = now();
  const c = p.ch, st = statsOf(p), t = now();
  const cd = {}; for (const [k, v] of Object.entries(p.cd)) if (v > t) cd[k] = v - t;
  out(p.ws, {
    t: "mo", a: "me", id: p.id, real: p.real, name: c.name, cls: c.cls, lv: c.lv, exp: c.exp, need: D.expNeed(c.lv), gold: c.gold,
    hp: Math.round(p.hp), mp: Math.round(p.mp), st: { hp: st.hp, mp: st.mp, atk: st.atk, def: st.def, crit: st.crit, aspd: Math.round(st.aspd * 100) / 100, range: st.range, ls: st.ls, thorn: st.thorn, cdmg: st.cdmg, dodge: st.dodge, ms: st.ms, pen: st.pen, cdr: st.cdr, over: st.over, skcd: Object.fromEntries(Object.entries(st).filter(([k, v]) => k.startsWith("cd_") && v)) },
    ...(full ? { inv: c.inv, eq: c.eq, bag: invMax(c), bagCost: bagCost(c), adv: c.adv || "", adv2: c.adv2 || "", advOk: (!c.adv && c.lv >= D.ADV_LV) || (c.adv && !c.adv2 && c.lv >= D.ADV2_LV), skills: allSkills(c).map((s) => ({ id: s.id, name: s.name, lv: s.lv, mp: s.mp, cd: Math.round(effCd(st, s) * 10) / 10, cd0: s.cd, desc: s.desc, type: s.type, range: s.range || 0, r: s.r || 0, w: s.w || 0, arrows: s.arrows || 1, spread: s.spread || 0, dash: !!s.dash, leap: !!s.leap })), slots: c.slots } : {}), cd, buff: Object.fromEntries(["guard", "gale", "rage", "shield", "eagle", "mingwang", "bati", "berserk", "barrier", "hawk", "stealth"].map((k) => [k, Math.max(0, (p.buff[k] || 0) - t)])),
    tgt: p.tgt || 0, dead: p.dead,
    story: c.story || 0, bankOut: c.day.d === today() ? c.day.out : 0, bankCap: D.BANK_DAILY_OUT, recall: c.recall && D.MAPS[c.recall.map] ? D.MAPS[c.recall.map].name : "", inTown: p.map === "town",
    buffs: buffList(p),
  });
}
let partyT = 0;
setInterval(() => {
  const dt = TICK / 1000;
  try {
    runPending();
    for (const p of players.values()) tickPlayer(p, dt);
    for (const m of Object.values(maps)) { for (const mob of m.mobs) tickMob(m, mob, dt); if (m.loot.length) tickLoot(m); if (m.haz && m.haz.length) tickHaz(m); broadcast(m); if (m.inst) instTick(m); }
    if (now() - partyT > 1000) { partyT = now(); for (const pt of parties.values()) sendParty(pt); }
  } catch (e) { console.log("江湖 tick 錯誤", e && e.stack); }
}, TICK);
setInterval(() => mmoSave(), 30_000);

// ======================================================================== 副本與擂台（臨時地圖）
let instSeq = 1;
function makeInst(def, inst) {
  const id = "i" + instSeq++;
  const m = maps[id] = genMap(id, { seed: randomInt(1e6), spawns: [], portals: [], lvl: "", inst: true, ...def });
  m.inst = { graceT: now() + 20000, infoT: 0, ...inst };
  if (def.pvp) m.pvp = true;
  return m;
}
function closeInst(m) { delete maps[m.id]; }
const instHere = (m) => [...players.values()].filter((q) => q.map === m.id);
function instInfo(m, text) { for (const q of instHere(m)) out(q.ws, { t: "mo", a: "inst", text }); }
function instTick(m) {
  const I = m.inst, t = now(), here = instHere(m);
  if (!here.length) { if (t > I.graceT) closeInst(m); return; }
  I.graceT = t + 20000;
  const left = Math.max(0, Math.ceil((I.endAt - t) / 1000)), clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  if (I.kind === "dg") return dgTick(m, here);
  if (I.kind === "climb") return climbTick(m, here);
  if (I.kind === "arena") {
    if (I.over) { if (t > I.closeAt) for (const q of here) placeIn(q, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y); return; }
    const a = players.get(I.a), b = players.get(I.b);
    if (!a || a.map !== m.id) return arenaEnd(m, a || null, b || null);
    if (!b || b.map !== m.id) return arenaEnd(m, b || null, a || null);
    if (!I.fight && t >= I.startAt) { I.fight = true; I.endAt = t + D.ARENA.time * 1000; instInfo(m, "開打！"); for (const q of here) q.known = new Set(); }
    if (I.fight && t > I.endAt) { const ha = a.hp / statsOf(a).hp, hb = b.hp / statsOf(b).hp; return arenaEnd(m, ha < hb ? a : b, ha < hb ? b : a, true); }
    if (t - I.infoT > 500) { I.infoT = t; instInfo(m, I.fight ? `擂台・${clock}` : `${Math.ceil((I.startAt - t) / 1000)}…`); }
  }
}
// ---- 副本共用
const diffOf = (k) => D.DIFF.find((x) => x.k === k) || D.DIFF[0];
function dgLeft(A, key, daily) { if (!daily) return 99; const g = A.dg && A.dg.d === today() ? A.dg : { d: today() }; return daily - (g[key] || 0); }
function dgUse(A, key) { if (!A.dg || A.dg.d !== today()) A.dg = { d: today() }; A.dg[key] = (A.dg[key] || 0) + 1; }
// 傷害：照最大生命的百分比（陷阱、岩漿、大招），一樣吃減傷
function hurtPct(m, p, pct) {
  if (p.dead) return;
  const st = statsOf(p); let d = st.hp * pct;
  if (p.buff.guard > now()) d *= 0.5; if (p.buff.shield > now()) d *= 0.6; if (p.buff.mingwang > now()) d *= 0.4;
  d = Math.max(1, Math.round(d)); p.hp -= d; p.lastHit = now(); p.dirty = true;
  m.fx.push({ k: "m", b: p.id, d });
  if (p.hp <= 0) die(p);
}
// 套裝裝備：一般裝備加上套裝標記，基礎數值多 10%
function makeSetItem(setKey, slot, tier, r, cls, who) {
  const it = makeEquip(slot, tier, r, cls, who);
  it.set = setKey; it.n = D.SETS[setKey].name + "・" + it.n;
  for (const k of Object.keys(it.st)) it.st[k] = Math.round(it.st[k] * 1.1);
  it.v = Math.round(it.v * 1.5);
  return it;
}
// 通關獎勵（每人一份，掉在 at 附近、只有自己撿得到）
function dgReward(m, p, setKey, lv, dif, mult, at) {
  const own = [p.key], slot = pickSlot();
  const rr = Math.random() * 100, r = Math.max(dif.rarMin, rr < dif.legend ? 3 : rr < 45 ? 2 : 1);
  const isSet = Math.random() * 100 < dif.setP * mult;
  const it = isSet ? makeSetItem(setKey, slot, tierFor(lv), r, p.ch.cls, p.ch) : makeEquip(slot, tierFor(lv), r, p.ch.cls, p.ch);
  dropLoot(m, it, at.x, at.y, own);
  dropLoot(m, { p: "ore", q: 3 * dif.mats }, at.x, at.y, own);
  dropLoot(m, { p: "jade", q: dif.mats }, at.x, at.y, own);
  if (dif.mats >= 2 || Math.random() < 0.4) dropLoot(m, { p: "recast", q: Math.max(1, dif.mats - 1) }, at.x, at.y, own);
  const dm = [1, 1.5, 2.2][D.DIFF.indexOf(dif)] * mult;
  giveExp(p, Math.round(D.expNeed(Math.min(lv, D.LV_CAP)) * 0.5 * dm)); const gold = Math.round(40 * lv * dm); p.ch.gold += gold; p.dirty = true;
  bountyHit(p, "boss"); { const A = db.acc[p.key]; if (A) A.bk = (A.bk || 0) + 1; }
  if (it.r === 3) sysAll(`【傳說】${p.ch.name} 在副本得到傳說裝備「${it.n}」！`);
  else if (isSet) sys(p, `掉出了套裝「${it.n}」！`);
  return gold;
}
// 副本入口（在各副本所在的野外地圖上，驛站傳送石旁邊）
function dgGates(mapId) {
  const m = maps[mapId]; if (!m || !m.def.stone) return [];
  if (!m.dgates) {
    m.dgates = [];
    for (const [k, d] of Object.entries(D.DUNGEONS)) if (d.map === mapId) {
      let best = m.def.stone, bd = 1e9;
      for (const s2 of m.spots) { const dd = Math.hypot(s2.x - (m.def.stone.x + 3), s2.y - m.def.stone.y); if (dd < bd && dd > 0.5) { bd = dd; best = s2; } }
      m.dgates.push({ id: "dg_" + k, name: `副本・${d.name}`, kind: "dungeon", dg: k, x: best.x, y: best.y, say: d.say || d.desc });
    }
  }
  return m.dgates;
}
function teamOf(p) { return p.party ? [...parties.get(p.party).members].map((k) => players.get(k)).filter(Boolean) : [p]; }
// 進副本：隊長帶隊，隊員要在同一張地圖、在入口附近
function dgEnter(p, key, dk) {
  const d = D.DUNGEONS[key], dif = diffOf(dk); if (!d) return "沒有這個副本";
  const need = d.lv + dif.lv;
  if (p.party && parties.get(p.party).leader !== p.key) return "要由隊長帶隊進副本";
  const ok = [], skip = [];
  for (const q of teamOf(p)) {
    const A = db.acc[q.key];
    if (q.map !== p.map || q.dead || Math.hypot(q.x - p.x, q.y - p.y) > 12) skip.push(`${q.ch.name}（不在入口附近）`);
    else if (q.ch.lv < need) skip.push(`${q.ch.name}（未滿 ${need} 級）`);
    else if (dgLeft(A, key, d.daily) <= 0) skip.push(`${q.ch.name}（今天的次數用完了）`);
    else ok.push(q);
  }
  if (!ok.includes(p)) return p.ch.lv < need ? `${dif.name}難度要 ${need} 級` : "你今天的次數用完了";
  const mlv = Math.min(D.LV_CAP, d.lv + 3 + dif.lv), n = ok.length;
  const back = maps[d.map].def.stone || { x: 4, y: 10 };
  const def = { name: `${d.name}・${dif.name}`, w: d.w, h: d.h, theme: d.theme, lvl: `${mlv} 級`, inst: true };
  if (d.kind === "trap" || d.kind === "race") def.corridor = true; else def.open = true;
  def.portals = [{ x: 0, y: Math.floor(d.h / 2) - 1, to: d.map, tx: Math.floor(back.x), ty: Math.floor(back.y), label: "← 離開" }];
  if (d.kind === "race") def.portals.push({ x: d.w - 1, y: Math.floor(d.h / 2) - 1, to: d.map, tx: Math.floor(back.x), ty: Math.floor(back.y), label: "出口 →", escape: true });
  const m = makeInst(def, { kind: "dg", key, dk, mlv, n, start: now() + 3000, endAt: now() + (d.time || 15 * 60) * 1000, phase: 1, got: new Set() });
  dgSetup(m);
  for (const q of ok) {
    dgUse(db.acc[q.key], key);
    if (q.trade) cancelTrade(q.trade, "進了副本，交易取消");
    placeIn(q, m.id, 2.5, Math.floor(d.h / 2) + 0.5);
    sys(q, `進入${d.name}（${dif.name}，怪物 ${mlv} 級）。${d.desc}`);
  }
  if (skip.length) sys(p, `沒有跟進來：${skip.join("、")}`);
  mmoSave(); return null;
}
// 怪：照副本難度放大
function dgMob(m, k, at, extra = {}) {
  const I = m.inst, dif = diffOf(I.dk), b = D.MONS[k];
  const mob = spawnMob(m, k, at, { ...b, lv: I.mlv + (b.boss ? 2 : 0), agg: extra.agg || 7, hpm: (b.hpm || 1) * dif.hp * (extra.hpm || 1) * (1 + 0.45 * (I.n - 1)) * (b.boss ? 1 : 0.8), atkm: (b.atkm || 1) * dif.atk * (extra.atkm || 1), respawn: 0, ...(extra.def || {}) });
  mob.noRe = true; mob.dmgMul = 1; return mob;
}
function dgSetup(m) {
  const I = m.inst, d = D.DUNGEONS[I.key], W = m.w, H = m.h, R = () => Math.random();
  const spot = (x, y) => { let best = null, bd = 1e9; for (const s2 of m.spots) { const dd = Math.hypot(s2.x - x, s2.y - y); if (dd < bd) { bd = dd; best = s2; } } return best || { x, y }; };
  if (d.kind === "trap") {
    for (const gx of [13, 25, 37, 49, 60]) for (let i = 0; i < 3 + randomInt(2); i++) dgMob(m, d.mobs[randomInt(d.mobs.length)], spot(gx + R() * 3, 3 + R() * (H - 6)));
    I.boss = dgMob(m, d.boss, spot(W - 6, H / 2), { agg: 9, def: { name: d.bossName } });
    I.traps = [];
    for (let x = 8; x < W - 12; x += 5 + randomInt(4)) {
      const ty = randomInt(3);
      if (ty === 0) I.traps.push({ type: "arrow", x: x + 0.5, w: 1.4, per: 3200 + randomInt(1200), next: now() + 2000 + randomInt(2000) });
      else if (ty === 1) { const y = 3 + randomInt(H - 6) + 0.5, dir = R() < 0.5 ? 1 : -1; I.traps.push({ type: "boulder", y, x0: dir > 0 ? x - 2 : x + 8, x1: dir > 0 ? x + 8 : x - 2, per: 4500 + randomInt(1500), dur: 1500, next: now() + 2500 + randomInt(2500) }); }
      else I.traps.push({ type: "poison", x: x + 1 + R() * 2, y: 3 + R() * (H - 6), r: 1.9, per: 6000, next: now() + 1500 + randomInt(3000) });
    }
  } else if (d.kind === "phase") {
    I.boss = dgMob(m, d.boss, spot(W / 2, H / 2), { agg: 14, def: { name: d.bossName } });
    for (let i = 0; i < 4; i++) dgMob(m, d.mobs[randomInt(d.mobs.length)], spot(W / 2 + (R() - 0.5) * 10, H / 2 + (R() - 0.5) * 8), { agg: 10 });
    I.zones = [];
  } else if (d.kind === "race") {
    for (let x = 12; x < W - 6; x += 4) if (R() < 0.8) dgMob(m, d.mobs[randomInt(d.mobs.length)], spot(x + R() * 3, 2 + R() * (H - 4)), { agg: 5 });
    I.lavaX = -3; I.lavaV = 0.42 + 0.06 * D.DIFF.findIndex((x) => x.k === I.dk); I.escaped = new Set();
    I.guard = dgMob(m, "lavagolem", spot(W - 5, H / 2), { agg: 6, hpm: 6, atkm: 1.4, def: { name: "熔岩守將" } });
  } else if (d.kind === "tide") {         // 龍宮：龍王在中間，四個角有珊瑚台
    I.boss = dgMob(m, d.boss, spot(W / 2, H / 2), { agg: 16, def: { name: d.bossName } });
    for (let i = 0; i < 4; i++) dgMob(m, d.mobs[randomInt(d.mobs.length)], spot(W / 2 + (R() - 0.5) * 12, H / 2 + (R() - 0.5) * 8), { agg: 10 });
    I.plats = [[0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]].map(([fx, fy]) => { const s2 = spot(W * fx, H * fy); return [s2.x, s2.y]; });
    I.tideAt = now() + 14000; I.tide = null;
  } else if (d.kind === "waves") {       // 瑤池：一波一波，最後開明獸
    I.wave = 0; I.waveAt = now() + 4000; I.waveMobs = [];
  } else if (d.kind === "raid") {
    I.boss = dgMob(m, d.boss, spot(W / 2, H / 2 - 2), { agg: 16, def: { name: d.bossName } });
    for (let i = 0; i < 4; i++) dgMob(m, d.mobs[randomInt(d.mobs.length)], spot(W / 2 + (R() - 0.5) * 12, H / 2 + (R() - 0.5) * 8), { agg: 10 });
    I.clones = []; I.ultT = 0;
  }
}
function dgTick(m, here) {
  const I = m.inst, d = D.DUNGEONS[I.key], t = now(), tick = !I.lastHalf || t - I.lastHalf >= 500;
  if (tick) I.lastHalf = t;
  const left = Math.max(0, Math.ceil((I.endAt - t) / 1000)), clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  if (I.done) { if (t > I.closeAt) for (const q of here) placeIn(q, d.map, maps[d.map].def.stone.x, maps[d.map].def.stone.y + 1); else if (t - I.infoT > 1000) { I.infoT = t; const left = Math.ceil((I.closeAt - t) / 1000); instInfo(m, `通關！走進出口傳送門離開・${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`); } return; }
  if (t > I.endAt) { for (const q of here) { sys(q, "時間到了，副本關閉。"); placeIn(q, d.map, maps[d.map].def.stone.x, maps[d.map].def.stone.y + 1); } I.done = true; I.closeAt = 0; return; }
  const alive = here.filter((q) => !q.dead);
  if (d.kind === "trap") {
    for (const tr of I.traps) {
      if (t < tr.next) continue;
      if (tr.type === "arrow") {
        if (!tr.armed) { tr.armed = true; tr.fireAt = t + 1000; m.fx.push({ k: "wcol", x: tr.x, w: tr.w, t: 1000 }); }
        else if (t >= tr.fireAt) { tr.armed = false; tr.next = t + tr.per; m.fx.push({ k: "arrows", x: tr.x, w: tr.w }); for (const q of alive) if (Math.abs(q.x - tr.x) <= tr.w / 2 + 0.3) hurtPct(m, q, 0.22); }
      } else if (tr.type === "boulder") {
        if (!tr.armed) { tr.armed = true; tr.goAt = t + 800; m.fx.push({ k: "wrow", y: tr.y, x0: tr.x0, x1: tr.x1, t: 800 }); }
        else if (!tr.rolling && t >= tr.goAt) { tr.rolling = true; tr.t0 = t; tr.hit = new Set(); m.fx.push({ k: "boulder", y: tr.y, x0: tr.x0, x1: tr.x1, dur: tr.dur }); }
        else if (tr.rolling) {
          const k = (t - tr.t0) / tr.dur, bx = tr.x0 + (tr.x1 - tr.x0) * Math.min(1, k);
          for (const q of alive) if (!tr.hit.has(q.key) && Math.hypot(q.x - bx, q.y - tr.y) < 0.9) { tr.hit.add(q.key); hurtPct(m, q, 0.35); }
          if (k >= 1) { tr.rolling = false; tr.armed = false; tr.next = t + tr.per; }
        }
      } else if (tr.type === "poison") {
        if (!tr.armed) { tr.armed = true; tr.onAt = t + 1000; tr.offAt = t + 4000; m.fx.push({ k: "warn", x: tr.x, y: tr.y, r: tr.r, t: 1000, c: "g" }); }
        else if (t >= tr.onAt && !tr.on) { tr.on = true; m.fx.push({ k: "pzone", x: tr.x, y: tr.y, r: tr.r, dur: 3000 }); }
        if (tr.on && tick) for (const q of alive) if (Math.hypot(q.x - tr.x, q.y - tr.y) <= tr.r) hurtPct(m, q, 0.06);
        if (tr.on && t >= tr.offAt) { tr.on = false; tr.armed = false; tr.next = t + tr.per; }
      }
    }
    if (t - I.infoT > 1000) { I.infoT = t; const far = Math.max(0, ...alive.map((q) => q.x)); instInfo(m, `${I.boss.dead ? "通關" : `往深處前進 ${Math.round(far / (m.w - 6) * 100)}%`}・${clock}`); }
  } else if (d.kind === "phase") {
    const B = I.boss, hp = B.hp / B.max;
    if (I.phase === 1 && hp <= 0.7) { I.phase = 2; I.addT = 0; I.zoneT = 0; for (const q of here) sys(q, `${B.def.name}：「冰封萬里！」（召喚冰魄、地上會冒出冰封區）`); }
    if (I.phase === 2 && hp <= 0.35) { I.phase = 3; B.st = { ...B.st, atk: Math.round(B.st.atk * 1.4) }; B.enrage = true; for (const q of here) sys(q, `${B.def.name}狂暴了！重擊又快又痛，快拉開距離。`); }
    if (I.phase >= 2 && !B.dead) {
      if (t - I.addT > 12000) { I.addT = t; for (let i = 0; i < 3; i++) dgMob(m, "iceghost", { x: B.x + (Math.random() - 0.5) * 5, y: B.y + (Math.random() - 0.5) * 4 }, { agg: 14, hpm: 0.6 }); }
      if (t - I.zoneT > 5500) { I.zoneT = t; for (const q of alive.slice(0, 2 + (I.phase === 3 ? 1 : 0))) { const z = { x: q.x, y: q.y, r: 1.8, on: t + 1200, until: t + 7200 }; I.zones.push(z); m.fx.push({ k: "warn", x: z.x, y: z.y, r: z.r, t: 1200, c: "b" }); setTimeout(() => m.fx.push({ k: "izone", x: z.x, y: z.y, r: z.r, dur: 6000 }), 1200); } }
    }
    I.zones = I.zones.filter((z) => z.until > t);
    if (tick) for (const z of I.zones) if (t >= z.on) for (const q of alive) if (Math.hypot(q.x - z.x, q.y - z.y) <= z.r) { hurtPct(m, q, 0.04); q.slowT = t + 900; }
    if (t - I.infoT > 1000) { I.infoT = t; instInfo(m, `${B.def.name}・第 ${I.phase} 階段・${Math.max(0, Math.round(hp * 100))}%・${clock}`); }
  } else if (d.kind === "race") {
    if (t > I.start + 4000) I.lavaX += I.lavaV * 0.1;
    if (tick) for (const q of alive) if (q.x < I.lavaX) hurtPct(m, q, 0.1);
    if (I.guard && I.guard.dead && !I.gateOpen) { I.gateOpen = true; for (const q of here) sys(q, "熔岩守將倒下了，出口打開！快衝出去！"); }
    if (t - I.infoT > 400) { I.infoT = t; for (const q of here) out(q.ws, { t: "mo", a: "inst", text: `${I.gateOpen ? "出口開了！快衝出去" : "岩漿追上來了！打倒出口的熔岩守將"}・${clock}`, lava: { x: I.lavaX, v: t > I.start + 4000 ? I.lavaV : 0 } }); }
  } else if (d.kind === "tide") {
    const B = I.boss, hp = B.hp / B.max, R2 = 2.4;
    if (!I.tide && t >= I.tideAt) {
      I.tide = { at: t + 3500 }; m.fx.push({ k: "safe", pts: I.plats, r: R2, t: 3500 });
      for (const q of here) sys(q, "大潮要來了！快跑上金色的珊瑚台！");
      for (let i = 0; i < 2 + I.n; i++) dgMob(m, d.mobs[randomInt(d.mobs.length)], { x: B.x + (Math.random() - 0.5) * 6, y: B.y + (Math.random() - 0.5) * 4 }, { agg: 14, hpm: 0.7 });
    }
    if (I.tide && t >= I.tide.at) {
      I.tide = null; I.tideAt = t + (hp < 0.4 ? 10000 : 16000);
      m.fx.push({ k: "tidewave", x: m.w / 2, y: m.h / 2 });
      for (const q of alive) if (!I.plats.some(([x, y]) => Math.hypot(q.x - x, q.y - y) <= R2)) { hurtPct(m, q, 0.32); q.slowT = t + 3000; }
    }
    if (t - I.infoT > 1000) { I.infoT = t; instInfo(m, `${B.def.name}・${Math.max(0, Math.round(hp * 100))}%・${I.tide ? "大潮來了！" : `下一波潮 ${Math.max(0, Math.ceil((I.tideAt - t) / 1000))} 秒`}・${clock}`); }
  } else if (d.kind === "waves") {
    I.waveMobs = I.waveMobs.filter((x) => !x.dead);
    if (I.wave <= d.waves && t >= I.waveAt && (I.wave === 0 || !I.waveMobs.length || t > I.waveAt + 45000)) {
      I.wave++;
      const edge = () => { const side = randomInt(4), u = Math.random(); return side === 0 ? { x: 2 + u * (m.w - 4), y: 2 } : side === 1 ? { x: 2 + u * (m.w - 4), y: m.h - 3 } : side === 2 ? { x: 2, y: 2 + u * (m.h - 4) } : { x: m.w - 3, y: 2 + u * (m.h - 4) }; };
      const near = (p0) => { let best = null, bd = 1e9; for (const s2 of m.spots) { const dd = Math.hypot(s2.x - p0.x, s2.y - p0.y); if (dd < bd) { bd = dd; best = s2; } } return best || p0; };
      if (I.wave <= d.waves) {
        for (let i = 0; i < 4 + I.wave * 2 + I.n; i++) { const mob = dgMob(m, d.mobs[randomInt(d.mobs.length)], near(edge()), { agg: 40, hpm: 0.8 + I.wave * 0.1 }); mob.hx = m.w / 2; mob.hy = m.h / 2; I.waveMobs.push(mob); }
        for (const q of here) sys(q, `第 ${I.wave} 波妖獸衝進瑤池了！`);
      } else {
        I.boss = dgMob(m, d.boss, near({ x: m.w / 2, y: m.h / 2 }), { agg: 20, def: { name: d.bossName } }); I.boss.hx = m.w / 2; I.boss.hy = m.h / 2;
        m.fx.push({ k: "slam", x: I.boss.x, y: I.boss.y, r: 3 });
        for (const q of here) sys(q, `${d.bossName}現身了！`);
      }
      I.waveAt = t + 2500;
    }
    if (t - I.infoT > 1000) { I.infoT = t; instInfo(m, `${I.wave > d.waves ? `${d.bossName}・${I.boss && !I.boss.dead ? Math.round(I.boss.hp / I.boss.max * 100) : 0}%` : I.wave === 0 ? "準備……" : `第 ${I.wave}/${d.waves} 波・剩 ${I.waveMobs.length} 隻`}・${clock}`); }
  } else if (d.kind === "raid") {
    const B = I.boss, hp = B.hp / B.max;
    I.clones = I.clones.filter((c2) => !c2.dead);
    B.dmgMul = I.clones.length ? 0.15 : 1;
    if (I.phase === 1 && hp <= 0.66) {
      I.phase = 2;
      for (const dx of [-4, 4]) I.clones.push(dgMob(m, d.boss, { x: B.x + dx, y: B.y + 1 }, { agg: 16, hpm: 0.14, atkm: 0.6, def: { name: d.cloneName || "教主分身", boss: false } }));
      for (const q of here) sys(q, d.msg2 || "教主：「分身化影！」——先打掉兩個分身，分身活著時教主幾乎打不動。");
    }
    if (I.phase === 2 && hp <= 0.33) { I.phase = 3; I.ultT = t + 4000; for (const q of here) sys(q, d.msg3 || "教主：「天魔解體！」——看到金色安全圈就躲進去！"); }
    if (I.phase === 3 && !B.dead) {
      if (!I.ult && t >= I.ultT) {
        const pts = []; for (let i = 0; i < 3; i++) { const s2 = m.spots[randomInt(m.spots.length)]; pts.push([s2.x, s2.y]); }
        I.ult = { pts, at: t + 3200, r: 2.3 }; m.fx.push({ k: "safe", pts, r: 2.3, t: 3200 });
      }
      if (I.ult && t >= I.ult.at) { const U = I.ult; I.ult = null; I.ultT = t + 14000; m.fx.push({ k: "slam", x: m.w / 2, y: m.h / 2, r: Math.max(m.w, m.h) }); for (const q of alive) if (!U.pts.some(([x, y]) => Math.hypot(q.x - x, q.y - y) <= U.r)) hurtPct(m, q, 0.75); }
    }
    if (t - I.infoT > 1000) { I.infoT = t; instInfo(m, `${B.def.name}・第 ${I.phase} 階段・${Math.max(0, Math.round(hp * 100))}%${I.clones.length ? `・分身 ${I.clones.length}` : ""}・${clock}`); }
  }
}
// 王倒下（古墓、冰宮、秘境）：每個還在副本裡的人一份獎勵
function dgBossKilled(m, mob) {
  const I = m.inst, d = D.DUNGEONS[I.key], dif = diffOf(I.dk);
  if (mob !== I.boss) return;
  I.done = true; I.closeAt = now() + 180000;
  // 王倒下的地方開一道出口傳送門：撿完東西走進去就回到外面
  let ex = null; for (const [dx, dy] of [[0, 2.6], [2.6, 0], [-2.6, 0], [0, -2.6], [0, 0]]) if (!ex && walk(m, mob.x + dx, mob.y + dy) && walk(m, mob.x + dx, mob.y + dy + 1)) ex = { x: mob.x + dx, y: mob.y + dy };
  ex = ex || m.spots[0];        // 跟掉落物錯開，免得點到寶物變成點傳送門
  m.xnpc = [{ id: "exit", name: "出口傳送門", kind: "exit", x: ex.x, y: ex.y, say: "穿過傳送門就回到外面。" }];
  const names = [];
  for (const q of instHere(m)) { const g = dgReward(m, q, d.set, I.mlv, dif, 1, mob); sys(q, `通關${d.name}（${dif.name}）！拿到 ${g} 兩，戰利品掉在地上。撿完走進「出口傳送門」就能出去（3 分鐘後也會自動送你出去）。`); names.push(q.ch.name); out(q.ws, { t: "mo", a: "npcs", npcs: npcsOf(m.id) }); }
  sysAll(`【副本】${names.join("、")} 通關了${d.name}（${dif.name}）！`);
  mmoSave();
}
// 熔洞：跑到出口的人拿獎勵（越快越多）
function dgEscape(m, p) {
  const I = m.inst, d = D.DUNGEONS[I.key], dif = diffOf(I.dk);
  if (I.escaped.has(p.key)) return;
  I.escaped.add(p.key);
  const used = (now() - I.start) / 1000, mult = Math.max(0.5, Math.min(1.4, 0.5 + 0.9 * (1 - used / d.time)));
  const g = dgReward(maps[d.map], p, d.set, I.mlv, dif, mult, { x: maps[d.map].def.stone.x + 1, y: maps[d.map].def.stone.y + 1 });
  sys(p, `逃出${d.name}！花了 ${Math.round(used)} 秒，獎勵 ×${mult.toFixed(2)}：${g} 兩，戰利品掉在傳送石旁邊。`);
  sysAll(`【副本】${p.ch.name} 在 ${Math.round(used)} 秒內逃出了${d.name}（${dif.name}）！`);
}

// ---- 鎖妖塔（爬塔）
function climbEnter(p) {
  const C = D.CLIMB;
  if (p.ch.lv < C.minLv) return `${C.minLv} 級才能進鎖妖塔`;
  if (p.party && parties.get(p.party).leader !== p.key) return "要由隊長帶隊進塔";
  const ok = [], skip = [];
  for (const q of teamOf(p)) {
    const A = db.acc[q.key];
    if (q.map !== "town" || q.dead) skip.push(`${q.ch.name}（不在長安城）`);
    else if (q.ch.lv < C.minLv) skip.push(`${q.ch.name}（未滿 ${C.minLv} 級）`);
    else if (dgLeft(A, "climb", C.daily) <= 0) skip.push(`${q.ch.name}（今天的次數用完了）`);
    else ok.push(q);
  }
  if (!ok.includes(p)) return `你今天的次數用完了（每天 ${C.daily} 次）`;
  const lv = Math.round(ok.reduce((s2, q) => s2 + q.ch.lv, 0) / ok.length);
  const m = makeInst({ name: "鎖妖塔", w: 26, h: 20, theme: "tower", lvl: `${lv} 級`, open: true, portals: [{ x: 0, y: 9, to: "town", tx: 6, ty: 22, label: "← 離開" }] },
    { kind: "climb", lv, n: ok.length, floor: 0, nextT: now() + 3500, endAt: now() + C.time * 1000 });
  for (const q of ok) {
    dgUse(db.acc[q.key], "climb");
    if (q.trade) cancelTrade(q.trade, "進了鎖妖塔，交易取消");
    placeIn(q, m.id, 3.5, 10.5);
    sys(q, `進入鎖妖塔。一層一層往上爬，每 5 層一隻王，越高越強。限時 ${C.time / 60} 分鐘，看能爬到第幾層！`);
  }
  if (skip.length) sys(p, `沒有跟進來：${skip.join("、")}`);
  mmoSave(); return null;
}
function climbFloor(m) {
  const I = m.inst, C = D.CLIMB; I.floor++;
  m.mobs = m.mobs.filter((x) => !x.dead);
  const f = I.floor, mult = 1 + C.perFloor * (f - 1), lv = Math.min(D.LV_CAP, I.lv + Math.floor(f / 2));
  const mk = (k, extra = {}) => { const b = D.MONS[k]; const mob = spawnMob(m, k, extra.at, { ...b, lv, agg: 14, hpm: (b.hpm || 1) * mult * (1 + 0.45 * (I.n - 1)) * (extra.hpm || 1), atkm: (b.atkm || 1) * (1 + 0.05 * (f - 1)), respawn: 0, ...(extra.def || {}) }); mob.noRe = true; mob.dmgMul = 1; return mob; };
  if (f % 5 === 0) {
    const bk = C.bosses[(f / 5 - 1) % C.bosses.length];
    I.boss = mk(bk, { at: { x: m.w / 2, y: m.h / 2 }, hpm: 0.6, def: { name: `第 ${f} 層・${D.MONS[bk].name}` } });
    for (const q of instHere(m)) sys(q, `第 ${f} 層：${D.MONS[bk].name}鎮守此層！`);
  } else {
    I.boss = null;
    const n = C.mobs + Math.floor(f / 3) + Math.max(0, I.n - 1) * 2;
    for (let i = 0; i < n; i++) mk(D.TOWER.pool[randomInt(D.TOWER.pool.length)]);
    for (const q of instHere(m)) sys(q, `第 ${f} 層。`);
  }
  for (const q of instHere(m)) { const st = statsOf(q); q.hp = Math.min(st.hp, q.hp + st.hp * 0.25); q.mp = Math.min(st.mp, q.mp + st.mp * 0.25); q.dirty = true; }
}
function climbTick(m, here) {
  const I = m.inst, t = now(), C = D.CLIMB;
  const left = Math.max(0, Math.ceil((I.endAt - t) / 1000)), clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const best = I.floor - (m.mobs.some((x) => !x.dead) ? 1 : 0);
  for (const q of here) { const A = db.acc[q.key]; if (A && best > (A.tb || 0)) A.tb = best; }
  if (t > I.endAt) { for (const q of here) { sys(q, `時間到了！這次爬到第 ${best} 層。`); placeIn(q, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y); } return; }
  if (t >= I.nextT && m.mobs.every((x) => x.dead)) {
    if (I.floor > 0 && !I.nextSet) {        // 清完一層：Boss 層掉寶，給點經驗，3 秒後上樓
      I.nextSet = true; I.nextT = t + 3000;
      const lv = Math.min(D.LV_CAP, I.lv + Math.floor(I.floor / 2));
      for (const q of here) {
        giveExp(q, Math.round(D.expNeed(Math.min(lv, D.LV_CAP)) * 0.05 * (1 + I.floor * 0.08)));
        if (I.floor === 5) { bountyHit(q, "tower"); const A = db.acc[q.key]; if (A) A.tc = (A.tc || 0) + 1; }
        if (I.floor % 5 === 0) { const dif = I.floor >= 15 ? D.DIFF[2] : I.floor >= 10 ? D.DIFF[1] : D.DIFF[0]; dgReward(m, q, "tower", lv, dif, 1 + I.floor * 0.03, I.boss || { x: m.w / 2, y: m.h / 2 }); }
      }
      instInfo(m, `第 ${I.floor} 層清空！3 秒後上樓`);
    } else { I.nextSet = false; climbFloor(m); }
  }
  if (t - I.infoT > 1000) { I.infoT = t; const alive = m.mobs.filter((x) => !x.dead).length; instInfo(m, `${I.floor === 0 ? "準備中" : `第 ${I.floor} 層${alive ? `・剩 ${alive} 隻` : ""}`}・${clock}`); }
}

// ---- 擂台
function arenaStart(a, b) {
  const m = makeInst({ name: "擂台", w: D.ARENA.w, h: D.ARENA.h, theme: "arena", open: true, pvp: true, lvl: "切磋" }, { kind: "arena", a: a.key, b: b.key, fight: false, startAt: now() + D.ARENA.countdown * 1000, endAt: now() + (D.ARENA.countdown + D.ARENA.time) * 1000 });
  const W = D.ARENA.w, H = D.ARENA.h;
  for (const [q, x] of [[a, 7.5], [b, W - 7.5]]) {
    if (q.trade) cancelTrade(q.trade, "上擂台了，交易取消");
    const st = statsOf(q); q.hp = st.hp; q.mp = st.mp; q.cd = {}; q.buff = {}; q.tgt = null; q.queued = null; q.pvpHits = [];
    placeIn(q, m.id, x, H / 2 + 0.5); q.face = x < W / 2 ? 1 : -1;
  }
  for (const q of [a, b]) sys(q, `擂台切磋：${a.ch.name} 對 ${b.ch.name}。${D.ARENA.countdown} 秒後開打，打到對方剩 0 就贏（不掉東西、不扣經驗）。`);
}
function arenaEnd(m, loser, winner, timeUp) {
  const I = m.inst; if (I.over) return;
  I.over = true; I.fight = false; I.closeAt = now() + 3500;
  for (const q of instHere(m)) { q.hp = Math.max(q.hp, 1); q.dead = false; q.tgt = null; q.queued = null; q.dirty = true; }
  if (winner && loser && loser.map === m.id) {
    for (const [q, w] of [[winner, 1], [loser, 0]]) { const A = db.acc[q.key]; if (A) { A.pvp = A.pvp || { w: 0, l: 0 }; if (w) A.pvp.w++; else A.pvp.l++; } }
    sysAll(`【擂台】${winner.ch.name} ${timeUp ? "時間到時血量領先，" : ""}擊敗了 ${loser.ch.name}！`);
    m.fx.push({ k: "lvl", b: winner.id });
  } else if (winner) sys(winner, "對手離開了擂台。");
  instInfo(m, winner ? `${winner.ch.name} 獲勝` : "結束");
  mmoSave();
}
function arenaTop() {
  const rows = [];
  for (const A of Object.values(db.acc)) if (A.pvp && A.pvp.w + A.pvp.l > 0) rows.push({ n: (A.chars[A.last || 0] || A.chars[0] || {}).name || "?", w: A.pvp.w, l: A.pvp.l });
  return rows.sort((x, y) => y.w - x.w || x.l - y.l).slice(0, 10);
}

// ======================================================================== 主城 NPC：倉庫、懸賞、客棧、城隍廟、賭坊、江湖榜
function buffList(p) {
  const t = now(), out2 = [], f = foodOf(p.ch), A = db.acc[p.key], b = blessOf(p);
  if (f) out2.push({ k: "food", n: f.name, d: f.d, left: Math.round((p.ch.food.until - t) / 1000) });
  if (b) out2.push({ k: "bless", n: b.name, d: b.d, left: Math.round((A.bless.until - t) / 1000) });
  return out2;
}
// ---- 懸賞
const FIELD = () => Object.entries(D.MAPS).filter(([, v]) => !v.town).map(([k, v]) => ({ k, name: v.name, min: parseInt(v.lvl, 10) || 1 }));
function bountyList(A) {
  if (A.bty && A.bty.d === today()) return A.bty;
  const L = accLv(A), f = FIELD().filter((x) => x.min <= L).pop() || FIELD()[0];
  const pool = [
    { kind: "boss", name: "打倒任一隻王（或鎖妖塔的九尾妖狐）", need: 1, jade: 1 },
    { kind: "forge", name: "到鐵匠那裡鍛造 3 次（強化、洗詞條、重鑄都算）", need: 3 },
    { kind: "sell", name: "賣掉 8 件裝備", need: 8 },
    { kind: "potion", name: "吃 15 顆藥", need: 15 },
  ];
  if (L >= D.TOWER.minLv) pool.push({ kind: "tower", name: "鎖妖塔爬到第 5 層", need: 1, jade: 1 });
  const pick = [];
  while (pick.length < D.BOUNTY_N - 1 && pool.length) pick.push(pool.splice(randomInt(pool.length), 1)[0]);
  const list = [{ kind: "kill", target: f.k, name: `清剿${f.name}：打倒 40 隻怪`, need: 40 }, ...pick].map((q, i) => ({ ...q, i, have: 0, done: false, got: false }));
  A.bty = { d: today(), list, all: false };
  return A.bty;
}
function bountyHit(p, kind, target, n = 1) {
  const A = db.acc[p.key]; if (!A) return;
  const B = bountyList(A);
  for (const q of B.list) {
    if (q.kind !== kind || q.done || (q.target && q.target !== target)) continue;
    q.have = Math.min(q.need, q.have + n);
    if (q.have >= q.need) { q.done = true; sys(p, `【懸賞】「${q.name}」完成了，回長安城找捕快領賞。`); }
  }
}
const bountyReward = (A, q) => ({ exp: Math.round(D.expNeed(accLv(A)) * 0.2), gold: 30 * accLv(A), ore: 3, jade: q.jade || 0 });
// ---- 江湖榜
function rankTables() {
  const rows = Object.values(db.acc).filter((A) => A.chars && A.chars.length).map((A) => {
    const c = A.chars.reduce((b, x) => ((x.lv || 1) > (b.lv || 1) || ((x.lv || 1) === (b.lv || 1) && (x.exp || 0) > (b.exp || 0)) ? x : b), A.chars[0]);      // 用帳號裡最高等級的角色上榜
    let enh = 0; for (const ch of A.chars) for (const it of [...Object.values(ch.eq), ...ch.inv]) if (it && it.e > enh) enh = it.e;
    return { n: c.name, lv: c.lv || 1, exp: c.exp || 0, gold: A.gold, bk: A.bk || 0, tc: A.tc || 0, tb: A.tb || 0, pw: (A.pvp && A.pvp.w) || 0, enh };
  });
  const top = (key, fmt, tie) => rows.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || (tie ? b[tie] - a[tie] : 0)).slice(0, 10).map((r) => ({ n: r.n, v: fmt(r) }));
  return [
    { k: "lv", name: "等級", list: top("lv", (r) => `${r.lv} 級`, "exp") },
    { k: "gold", name: "財富", list: top("gold", (r) => `${r.gold.toLocaleString()} 兩`) },
    { k: "bk", name: "打王", list: top("bk", (r) => `${r.bk} 次`) },
    { k: "tb", name: "鎖妖塔", list: top("tb", (r) => `第 ${r.tb} 層`) },
    { k: "pw", name: "擂台", list: top("pw", (r) => `${r.pw} 勝`) },
    { k: "enh", name: "強化", list: top("enh", (r) => `+${r.enh}`) },
  ];
}
// ---- 打開 NPC 時多帶的資料
function npcExtra(p, kind) {
  const c = p.ch, A = db.acc[p.key];
  if (kind === "store") return { stash: A.stash || [], max: D.STASH_MAX };
  if (kind === "bounty") { const B = bountyList(A); return { bty: B.list.map((q) => ({ ...q, rw: bountyReward(A, q) })), all: B.all }; }
  if (kind === "inn") { const f = foodOf(c); return { foods: Object.entries(D.FOODS).map(([k, v]) => ({ k, n: v.name, d: v.d })), price: D.foodPrice(c.lv), min: D.FOOD_MIN, cur: f ? { n: f.name, left: Math.round((c.food.until - now()) / 1000) } : null }; }
  if (kind === "temple") { const b = A.bless; return { prayed: !!(b && b.d === today()), last: b && b.d === today() ? D.BLESS.find((x) => x.k === b.k) : null, odds: D.BLESS.map((x) => ({ n: x.name, d: x.d, p: x.p })) }; }
  if (kind === "casino") return { dice: D.DICE };
  if (kind === "rank") return { ranks: rankTables() };
  return {};
}
function townAction(p, a, m) {
  const c = p.ch, A = db.acc[p.key];
  if (a === "stash") {          // 倉庫：放進去（put）／拿出來（take）
    A.stash = A.stash || [];
    if (m.op === "put") {
      const it = c.inv.find((x) => (x.u || x.p) === m.u); if (!it) return;
      if (it.lock) return "鎖住的東西先解鎖才能放倉庫";
      if (it.p) { const ex = A.stash.find((x) => x.p === it.p); if (ex) ex.q += it.q; else { if (A.stash.length >= D.STASH_MAX) return "倉庫滿了"; A.stash.push({ p: it.p, q: it.q }); } }
      else { if (A.stash.length >= D.STASH_MAX) return "倉庫滿了"; A.stash.push(it); }
      c.inv.splice(c.inv.indexOf(it), 1);
    } else if (m.op === "take") {
      const it = A.stash.find((x) => (x.u || x.p) === m.u); if (!it) return;
      if (!addItem(p, it.p ? { p: it.p, q: it.q } : it)) return "背包滿了";
      A.stash.splice(A.stash.indexOf(it), 1);
    } else return;
    invChanged(p); mmoSave();
    out(p.ws, { t: "mo", a: "npcup", stash: A.stash, max: D.STASH_MAX }); return null;
  }
  if (a === "bounty") {         // 領懸賞
    const B = bountyList(A), q = B.list[Number(m.i)];
    if (!q || !q.done || q.got) return "這個懸賞還不能領";
    const R = bountyReward(A, q); q.got = true;
    giveExp(p, R.exp, true); c.gold += R.gold; addItem(p, { p: "ore", q: R.ore }); if (R.jade) addItem(p, { p: "jade", q: R.jade });
    let extra = "";
    if (!B.all && B.list.every((x) => x.got)) { B.all = true; addItem(p, { p: "recast", q: 1 }); extra = "三個懸賞都完成了，捕快多給了一顆重鑄石！"; }
    invChanged(p); mmoSave();
    sys(p, `領到懸賞：${R.exp} 經驗、${R.gold} 兩、玄鐵 ×${R.ore}${R.jade ? `、靈玉 ×${R.jade}` : ""}。${extra}`);
    out(p.ws, { t: "mo", a: "npcup", bty: B.list.map((x) => ({ ...x, rw: bountyReward(A, x) })), all: B.all }); return null;
  }
  if (a === "eat") {            // 客棧點菜
    const F = D.FOODS[m.k]; if (!F) return;
    const price = D.foodPrice(c.lv); if (c.gold < price) return `要 ${price} 兩`;
    c.gold -= price; c.food = { k: m.k, until: now() + D.FOOD_MIN * 60000 }; p.dirty = true;
    sys(p, `吃了一份${F.name}，${D.FOOD_MIN} 分鐘內${F.d}。`);
    out(p.ws, { t: "mo", a: "npcup", cur: { n: F.name, left: D.FOOD_MIN * 60 } }); return null;
  }
  if (a === "pray") {           // 城隍廟祈福：每個帳號每天一次
    if (A.bless && A.bless.d === today()) return "今天已經祈福過了，明天再來";
    let r = Math.random() * 100, B = D.BLESS[0];
    for (const x of D.BLESS) { if (r < x.p) { B = x; break; } r -= x.p; }
    A.bless = { d: today(), k: B.k, until: B.buff ? now() + B.min * 60000 : 0 };
    let got = "";
    if (B.k === "gold") { const g = 60 * c.lv + randomInt(40 * c.lv); c.gold += g; got = `${g} 兩`; }
    if (B.k === "jade") { addItem(p, { p: "jade", q: 2 }); got = "靈玉 ×2"; }
    if (B.k === "big") { addItem(p, { p: "recast", q: 1 }); got = "重鑄石 ×1"; sysAll(`【城隍廟】${c.name} 求到了上上籤「大吉大利」！`); }
    invChanged(p); mmoSave();
    sys(p, `抽到${B.slip}「${B.name}」：${B.d}${got ? `（${got}）` : ""}。`);
    out(p.ws, { t: "mo", a: "npcup", prayed: true, last: B, slipAnim: true }); return null;
  }
  if (a === "dice") {           // 賭坊：押大、小或豹子
    const bet = Math.floor(Number(m.bet) || 0), pick = m.pick;
    if (!["big", "small", "triple"].includes(pick)) return;
    if (bet < D.DICE.min || bet > D.DICE.max) return `押注要在 ${D.DICE.min}～${D.DICE.max} 兩之間`;
    if (c.gold < bet) return "銀兩不夠";
    const d = [1 + randomInt(6), 1 + randomInt(6), 1 + randomInt(6)], sum = d[0] + d[1] + d[2], triple = d[0] === d[1] && d[1] === d[2];
    const res = triple ? "triple" : sum >= 11 ? "big" : "small";
    const win = pick === res ? (pick === "triple" ? bet * D.DICE.triplePay : bet) : -bet;
    c.gold += win; p.dirty = true;
    if (win >= 5000) sysAll(`【賭坊】${c.name} 在如意坊贏了 ${win.toLocaleString()} 兩！`);
    out(p.ws, { t: "mo", a: "dice", d, sum, res, win, gold: c.gold }); return null;
  }
}

// ======================================================================== 隊伍
function sendParty(pt) {
  const list = [...pt.members].map((k) => players.get(k)).filter(Boolean).map((q) => { const st = statsOf(q); return { id: q.id, n: q.ch.name, lv: q.ch.lv, c: q.ch.cls, hp: Math.round(q.hp / st.hp * 100), map: mapName(q.map), lead: q.key === pt.leader }; });
  for (const k of pt.members) { const q = players.get(k); if (q) out(q.ws, { t: "mo", a: "party", id: pt.id, list }); }
}
function leaveParty(p) {
  const pt = parties.get(p.party); p.party = null;
  out(p.ws, { t: "mo", a: "party", id: 0, list: [] });
  if (!pt) return;
  pt.members.delete(p.key);
  for (const q of players.values()) q.known.delete(p.id);
  if (pt.members.size <= 1) { for (const k of pt.members) { const q = players.get(k); if (q) { q.party = null; out(q.ws, { t: "mo", a: "party", id: 0, list: [] }); sys(q, "隊伍解散了。"); for (const r of players.values()) r.known.delete(q.id); } } parties.delete(pt.id); return; }
  if (pt.leader === p.key) pt.leader = [...pt.members][0];
  for (const k of pt.members) { const q = players.get(k); if (q) sys(q, `${p.ch.name} 離開了隊伍。`); }
  sendParty(pt);
}

// ======================================================================== 交易
function tradeView(tr) {
  const side = (k) => { const q = players.get(k); return { id: q.id, n: q.ch.name, items: tr.items[k].map((u) => q.ch.inv.find((x) => (x.u || x.p) === u)).filter(Boolean), gold: tr.gold[k], ok: tr.ok[k] }; };
  for (const k of [tr.a, tr.b]) { const q = players.get(k); if (q) out(q.ws, { t: "mo", a: "trade", me: side(k), them: side(k === tr.a ? tr.b : tr.a) }); }
}
function cancelTrade(tr, why) {
  for (const k of [tr.a, tr.b]) { const q = players.get(k); if (q) { q.trade = null; out(q.ws, { t: "mo", a: "trade", close: true }); if (why) sys(q, why); } }
  trades.delete(tr.a); trades.delete(tr.b);
}
function finishTrade(tr) {
  const A = players.get(tr.a), B = players.get(tr.b);
  if (!A || !B) return cancelTrade(tr, "交易失敗");
  const take = (q, us) => us.map((u) => q.ch.inv.find((x) => (x.u || x.p) === u)).filter(Boolean);
  const ia = take(A, tr.items[tr.a]), ib = take(B, tr.items[tr.b]);
  if (ia.length !== tr.items[tr.a].length || ib.length !== tr.items[tr.b].length || A.ch.gold < tr.gold[tr.a] || B.ch.gold < tr.gold[tr.b]) return cancelTrade(tr, "交易內容有變，取消了");
  const room = (q, give, get) => q.ch.inv.length - give.length + get.filter((it) => !(it.p && q.ch.inv.some((x) => x.p === it.p && !give.includes(x)))).length <= invMax(q.ch);
  if (!room(A, ia, ib) || !room(B, ib, ia)) return cancelTrade(tr, "背包放不下，交易取消");
  A.ch.inv = A.ch.inv.filter((x) => !ia.includes(x)); B.ch.inv = B.ch.inv.filter((x) => !ib.includes(x));
  for (const it of ib) addItem(A, it); for (const it of ia) addItem(B, it);
  A.ch.gold += tr.gold[tr.b] - tr.gold[tr.a]; B.ch.gold += tr.gold[tr.a] - tr.gold[tr.b];
  A.trade = B.trade = null; trades.delete(tr.a); trades.delete(tr.b);
  for (const q of [A, B]) { q.dirty = true; out(q.ws, { t: "mo", a: "trade", close: true }); sys(q, "交易完成。"); }
  console.log("江湖交易", A.ch.name, ia.length, tr.gold[tr.a], "<->", B.ch.name, ib.length, tr.gold[tr.b]);
  mmoSave(true);
}

// ======================================================================== 錢莊
export async function recoverMmoPending() {
  for (const [id, v] of Object.entries(db.pend)) {
    try { const r = await botPay(v.uid, v.name, v.amount, "水墨江湖：錢莊補發"); if (r && r.ok) { console.log("江湖錢莊補發", v.name, v.amount); delete db.pend[id]; } } catch {}
  }
  mmoSave(true);
}
const nearNpc = (p, kind) => npcsOf(p.map).some((n) => n.kind === kind && Math.hypot(n.x - p.x, n.y - p.y) < 4.5);

// ======================================================================== 商店
function shopOf(p, kind) {
  const c = p.ch;
  if (kind === "herb") return Object.entries(D.POTIONS).filter(([, v]) => !v.mat).map(([k, v]) => ({ k, n: v.name, price: v.price, lv: v.lv || 1, d: v.hp ? `回 ${v.hp} 生命` : v.mp ? `回 ${v.mp} 法力` : "立刻回長安城" }));
  if (kind === "smith") {
    const list = [];
    const near = D.TIERS.filter((t) => t <= c.lv + 5 && t >= c.lv - 10);        // 只列跟自己等級差不多的
    for (const t of near.length ? near : [1]) for (const s of Object.keys(D.SLOTS)) { const b = D.baseItem(s, t, c.cls); list.push({ k: `${s}:${t}`, n: b.name, s, t, st: b.st, price: D.itemValue(t, 0), lv: t }); }
    return list;
  }
  return [];
}

// ======================================================================== 指令
export async function handleMmo(ws, m) {
  // 簡單的洪水保護：每秒最多 25 個指令
  const t = now(); ws.mmoMsgs = (ws.mmoMsgs || []).filter((x) => t - x < 1000); if (ws.mmoMsgs.length > 25) return; ws.mmoMsgs.push(t);
  const a = m.a;
  if (a === "hello") {
    const real = !!ws.user;
    const key = real ? "r:" + ws.user.uid : "g:" + (String(m.pid || "").replace(/[^\w-]/g, "").slice(0, 40) || "x" + randomInt(1e9));
    ws.mmoKey = key; ws.mmoReal = real;
    const A = db.acc[key];
    if (A && real) for (const c of A.chars) if (c.auto && c.name !== ws.user.name) c.name = ws.user.name;
    const i = m.pick == null ? -1 : Number(m.pick);           // 斷線重連：直接回到剛剛那隻角色
    if (A && Number.isInteger(i) && A.chars[i]) { A.last = i; enter(ws, key, A.chars[i], real); return; }
    sendChars(ws); return;
  }
  if (a === "create") {
    if (!ws.mmoKey || ws.mmo || !D.CLASSES[m.cls]) return;
    let A = db.acc[ws.mmoKey];
    if (A && A.chars.length >= MAX_CHARS) { out(ws, { t: "mo", a: "err", text: `一個帳號最多 ${MAX_CHARS} 個角色` }); return; }
    const name = clean(m.name, 12) || (ws.user ? ws.user.name : "無名俠客");
    if (!A) A = db.acc[ws.mmoKey] = { gold: 50, day: { d: "", out: 0 }, chars: [], last: 0 };
    const c = bindChar(newChar(name, m.cls, 1), A); c.lv = 1; c.exp = 0;
    if (ws.user && name === ws.user.name && !A.chars.some((x) => x.auto)) c.auto = true;
    A.chars.push(c); A.last = A.chars.length - 1; mmoSave(true);
    enter(ws, ws.mmoKey, c, ws.mmoReal); return;
  }
  if (a === "pick") {
    const A = db.acc[ws.mmoKey], i = Number(m.i);
    if (!A || ws.mmo || !A.chars[i]) return;
    A.last = i; enter(ws, ws.mmoKey, A.chars[i], ws.mmoReal); return;
  }
  if (a === "delchar") {      // 刪角色：要打一次角色名字確認，至少留一隻
    const A = db.acc[ws.mmoKey], i = Number(m.i);
    if (!A || ws.mmo || !A.chars[i]) return;
    if (A.chars.length <= 1) { out(ws, { t: "mo", a: "err", text: "至少要留一個角色" }); return; }
    if (String(m.name || "") !== A.chars[i].name) { out(ws, { t: "mo", a: "err", text: "名字不對，沒有刪除" }); return; }
    console.log("江湖刪角色", ws.mmoKey, A.chars[i].name, A.chars[i].cls);
    A.chars.splice(i, 1); A.last = 0; mmoSave(true); sendChars(ws); return;
  }
  if (a === "switch") {       // 回到選角畫面
    if (!ws.mmo) return;
    if (ws.mmo.trade) cancelTrade(ws.mmo.trade, "對方換角色了，交易取消");
    leave(ws, false); sendChars(ws); return;
  }
  const p = ws.mmo; if (!p) return;
  const c = p.ch, mp = maps[p.map];
  const err = (text) => out(ws, { t: "mo", a: "err", text });
  switch (a) {
    case "move": { p.pickT = 0;
      if (p.dead) return;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      p.tgt = null; p.queued = null;
      const path = clearLine(mp, p, { x, y }) && walk(mp, x, y) ? [{ x, y }] : astar(mp, p.x, p.y, x, y);
      p.path = path || null; return;
    }
    case "dir": {       // 鍵盤移動方向；x、y 是 -1～1，(0,0) 表示停下
      if (p.dead) return;
      let x = Number(m.x) || 0, y = Number(m.y) || 0; const l = Math.hypot(x, y);
      if (l < 0.1) { p.dir = null; return; }
      x /= l; y /= l; p.dir = { x, y }; p.dirT = t; p.path = null; p.queued = null; if (Math.abs(x) > 0.1) p.face = x > 0 ? 1 : -1; return;
    }
    case "atk": { const mob = findMob(mp, Number(m.id)); if (mob && !mob.dead && !p.dead && mob.pvp !== p) { p.tgt = mob.id; p.queued = null; } return; }
    case "stop": p.tgt = null; p.queued = null; p.path = null; p.pickT = 0; return;
    case "loot": {        // 撿地上的東西（選角色的指令叫 pick，這裡不能撞名）：太遠就先走過去，到了自動撿
      const l = mp.loot.find((x) => x.id === Number(m.id)); if (!l || p.dead) return;
      if (Math.hypot(l.x - p.x, l.y - p.y) <= 1.3) { const e = tryPick(p, l); if (e) err(e); return; }
      p.tgt = null; p.queued = null; p.pickT = l.id; p.dir = null; p.path = astar(mp, p.x, p.y, l.x, l.y, 15000); if (!p.path) { p.pickT = 0; err("走不過去"); } return;
    }
    case "skill": {
      const sk = skillDef(c, m.s); if (!sk) return;
      const x = Number(m.x), y = Number(m.y);
      const e = tryCast(p, sk, { x: m.x == null ? NaN : x, y: m.y == null ? NaN : y, id: Number(m.id) || 0 }); if (e) err(e); return;
    }
    case "story": {     // 聽完一章：要照順序、等級夠、站在說故事的人旁邊；第一次聽完給經驗和銀兩
      const i = Number(m.i), ch = STORY[i]; if (!ch) return;
      if ((c.story || 0) !== i) return err("這段故事不是現在聽的");
      if (c.lv < ch.lv) return err(`${ch.lv} 級才能聽這段故事`);
      const n = npcsOf(p.map).find((x) => x.id === ch.npc); if (!n || Math.hypot(n.x - p.x, n.y - p.y) > 5) return err("要站在說故事的人旁邊");
      const rw = storyReward(ch, D.expNeed(ch.lv));
      c.story = i + 1; c.gold += rw.gold; giveExp(p, rw.exp); p.dirty = true; mmoSave(true);
      sys(p, `聽完第 ${i + 1} 回「${ch.title}」，得到 ${rw.exp.toLocaleString()} 經驗、${rw.gold.toLocaleString()} 兩。`);
      if (i + 1 === STORY.length) sysAll(`【江湖傳聞】${c.name} 聽完了「乾坤筆」的全部故事！`);
      out(ws, { t: "mo", a: "storyok", i, exp: rw.exp, gold: rw.gold, story: storyView(c, ch.npc) }); return;
    }
    case "slot": {      // 換技能欄：把第 i 格換成某招（已經在別格的話兩格互換）
      const i = Math.floor(Number(m.i)); if (!(i >= 0 && i < slotN(c))) return;
      const id = String(m.s || ""), sk = id ? skillDef(c, id) : null;
      if (id && (!sk || sk.lv > c.lv)) return err("還沒學會這招");
      const j = id ? c.slots.indexOf(id) : -1;
      if (j >= 0) c.slots[j] = c.slots[i];
      c.slots[i] = id; p.invDirty = true; p.dirty = true; mmoSave(); return;
    }
    case "quaff": {   // 吃藥：hp / mp 自動挑能用的最好那種
      if (p.dead || t < p.potT) return;
      const kind = m.k === "mp" ? "mp" : "hp";
      const it = c.inv.filter((x) => x.p && D.POTIONS[x.p][kind] && (D.POTIONS[x.p].lv || 1) <= c.lv).sort((x, y) => D.POTIONS[y.p][kind] - D.POTIONS[x.p][kind])[0];
      if (!it) return err(kind === "hp" ? "身上沒有回血的藥" : "身上沒有回魔的藥");
      return usePotion(p, it);
    }
    case "use": {
      if (m.u === "tp" && p.map === "town") return recall(p);
      const it = c.inv.find((x) => (x.u || x.p) === m.u); if (!it) return m.u === "tp" ? err("身上沒有回城符") : undefined;
      if (it.p) return usePotion(p, it); return equip(p, it);
    }
    case "sortinv": { sortInv(c); invChanged(p); return; }
    case "bagup": {       // 行囊擴充 +10 格
      const cost = bagCost(c); if (!cost) return err(`行囊已經是最大的 ${D.BAG_UP.max} 格了`);
      if (c.gold < cost) return err(`擴充要 ${cost} 兩`);
      c.gold -= cost; c.bag = invMax(c) + D.BAG_UP.step; invChanged(p);
      sys(p, `行囊擴充到 ${c.bag} 格（花了 ${cost} 兩）。`); return;
    }
    case "sellall": {     // 一鍵賣裝：把某個品質以下的裝備全部賣掉（鎖住的、強化過的不賣，傳說永遠不會一鍵賣）
      const r = Math.max(0, Math.min(2, Math.floor(Number(m.r) || 0)));
      const list = c.inv.filter((x) => !x.p && x.r <= r && !x.lock && !(x.e > 0) && !x.set);
      if (!list.length) return err("沒有可以一鍵賣的裝備");
      const gold = list.reduce((s2, x) => s2 + Math.max(1, Math.floor(x.v * D.SELL_RATE)), 0);
      c.inv = c.inv.filter((x) => !list.includes(x)); c.gold += gold; invChanged(p); bountyHit(p, "sell", null, list.length);
      sys(p, `一鍵賣掉 ${list.length} 件${D.RAR[r].name}${r ? "以下" : ""}的裝備，得到 ${gold} 兩。`); return;
    }
    case "lock": {        // 鎖定／解鎖一件裝備（鎖住的不會被賣掉）
      const it = c.inv.find((x) => x.u === m.u) || Object.values(c.eq).find((x) => x && x.u === m.u); if (!it) return;
      it.lock = !it.lock; invChanged(p); return;
    }
    case "forge": {       // 鐵匠：強化（lv）、洗詞條（aff）、重鑄（recast）
      if (!nearNpc(p, "smith")) return err("要在鐵匠旁邊才能鍛造");
      const it = c.inv.find((x) => x.u === m.u) || Object.values(c.eq).find((x) => x && x.u === m.u); if (!it || it.p) return;
      affOf(it);
      const worn = Object.values(c.eq).includes(it);
      bountyHit(p, "forge");
      if (m.op === "lv") {
        const e = it.e || 0; if (e >= D.ENH.max) return err(`已經 +${D.ENH.max}，強化到頂了`);
        const gold = D.ENH.gold(it.t, e), ore = D.ENH.ore(e);
        if (c.gold < gold) return err(`要 ${gold} 兩`); if (matCount(c, "ore") < ore) return err(`要玄鐵 ×${ore}`);
        c.gold -= gold; for (let i = 0; i < ore; i++) takeMat(c, "ore", 1);
        const ok = Math.random() * 100 < D.ENH.rate[e];
        if (ok) it.e = e + 1; else if (e >= D.ENH.drop) it.e = e - 1;
        rebuild(it); if (worn) clampHp(p); invChanged(p);
        out(ws, { t: "mo", a: "forged", u: it.u, ok, op: "lv", e: it.e || 0 });
        sys(p, ok ? `強化成功！「${it.n}」變成 +${it.e}。` : e >= D.ENH.drop ? `強化失敗……「${it.n}」掉回 +${it.e}。` : `強化失敗，「${it.n}」還是 +${e}。`);
        if (ok && it.e >= 10) sysAll(`【鍛造】${c.name} 把「${it.n}」強化到 +${it.e}！`);
        return;
      }
      if (m.op === "aff") {
        const n = D.RAR[it.r].aff; if (!n) return err("普通裝備沒有詞條，先用重鑄把品質提上去");
        const gold = D.REROLL.gold(it.t); if (c.gold < gold) return err(`要 ${gold} 兩`); if (!takeMat(c, "jade", D.REROLL.jade)) return err("要靈玉 ×1");
        c.gold -= gold; it.af = rollAff(it.t, n, it.r, c); rebuild(it); if (worn) clampHp(p); invChanged(p);
        out(ws, { t: "mo", a: "forged", u: it.u, ok: true, op: "aff" });
        sys(p, `「${it.n}」的詞條重抽了。`); return;
      }
      if (m.op === "recast") {
        if (it.r >= 3) return err("已經是傳說了，不能再重鑄");
        const gold = D.RECAST.gold(it.t); if (c.gold < gold) return err(`要 ${gold} 兩`); if (!takeMat(c, "recast", D.RECAST.stone)) return err("要重鑄石 ×1");
        c.gold -= gold;
        const ok = Math.random() * 100 < D.RECAST.up[it.r];
        if (ok) { it.r++; it.af = rollAff(it.t, D.RAR[it.r].aff, it.r, c); }
        rebuild(it); if (worn) clampHp(p); invChanged(p);
        out(ws, { t: "mo", a: "forged", u: it.u, ok, op: "recast" });
        sys(p, ok ? `重鑄成功！「${it.n}」升為${D.RAR[it.r].name}。` : `重鑄失敗，「${it.n}」品質沒變（重鑄石用掉了）。`);
        if (ok && it.r === 3) sysAll(`【鍛造】${c.name} 把「${it.n}」重鑄成傳說裝備！`);
        return;
      }
      return;
    }
    case "dungeon": {
      const g = npcsOf(p.map).find((x) => x.kind === "dungeon" && x.dg === m.key);
      if (!g || Math.hypot(g.x - p.x, g.y - p.y) > 4.5) return err("要在副本入口旁邊");
      const e = dgEnter(p, m.key, m.diff); if (e) err(e); return;
    }
    case "tower": {
      if (!nearNpc(p, "tower")) return err("要在守塔人旁邊");
      const e = climbEnter(p); if (e) err(e); return;
    }
    case "duelreq": {     // 擂台切磋邀請：雙方都要在長安城
      const q = byId.get(Number(m.id)); if (!q || q === p) return;
      if (p.map !== "town" || q.map !== "town") return err("兩個人都要在長安城才能切磋");
      if (p.dead || q.dead) return;
      q.invites.set("duel:" + p.key, t);
      out(q.ws, { t: "mo", a: "ask", kind: "duel", from: p.id, n: c.name }); sys(p, `已向 ${q.ch.name} 提出切磋。`); return;
    }
    case "duelacc": {
      const q = byId.get(Number(m.id)); if (!q || !p.invites.has("duel:" + q.key) || t - p.invites.get("duel:" + q.key) > 60000) return err("邀請過期了");
      p.invites.delete("duel:" + q.key);
      if (p.map !== "town" || q.map !== "town" || p.dead || q.dead) return err("兩個人都要在長安城才能切磋");
      arenaStart(q, p); return;
    }
    case "stash": case "bounty": case "eat": case "pray": case "dice": {
      const need = { stash: "store", bounty: "bounty", eat: "inn", pray: "temple", dice: "casino" }[a];
      if (!nearNpc(p, need)) return err("要在城裡那位 NPC 旁邊才能做");
      const e = townAction(p, a, m); if (e) err(e); return;
    }
    case "advance2": {    // 二轉：60 級以後，一轉再二選一
      if (!nearNpc(p, "guide")) return err("要在長安城說書人旁邊才能二轉");
      const A2 = D.ADV2[m.k]; if (!A2 || A2.base !== c.adv) return;
      if (c.adv2) return err("已經二轉過了");
      if (c.lv < D.ADV2_LV) return err(`${D.ADV2_LV} 級才能二轉`);
      c.adv2 = m.k; fixSlots(c); clampHp(p); p.invDirty = true; p.dirty = true;
      for (const q of players.values()) q.known.delete(p.id);
      maps[p.map].fx.push({ k: "lvl", b: p.id });
      sysAll(`【二轉】${c.name} 二轉成為「${A2.name}」！`);
      sys(p, `技能欄多了一格（D），新招式按 K 可以看。`);
      mmoSave(); return;
    }
    case "advance": {     // 轉職：25 級以後在說書人那裡選一條路，選了就不能換
      if (!nearNpc(p, "guide")) return err("要在長安城說書人旁邊才能轉職");
      const A = D.ADV[m.k]; if (!A || A.base !== c.cls) return;
      if (c.adv) return err("已經轉職過了");
      if (c.lv < D.ADV_LV) return err(`${D.ADV_LV} 級才能轉職`);
      c.adv = m.k; fixSlots(c); clampHp(p); p.invDirty = true; p.dirty = true;
      for (const q of players.values()) q.known.delete(p.id);
      maps[p.map].fx.push({ k: "lvl", b: p.id });
      sysAll(`【轉職】${c.name} 轉職成為「${A.name}」！`);
      sys(p, `技能欄多了一格（F），新招式按 K 可以看。`);
      mmoSave(); return;
    }
    case "unequip": {
      const s = m.s; if (!D.SLOTS[s] || !c.eq[s]) return;
      if (c.inv.length >= invMax(c)) return err("背包滿了");
      c.inv.push(c.eq[s]); c.eq[s] = null; clampHp(p); invChanged(p); return;
    }
    case "sell": {        // 行囊裡隨時可以賣（不用跑回城）
      const it = c.inv.find((x) => (x.u || x.p) === m.u); if (!it) return;
      if (it.lock) return err("這件鎖住了，先解鎖才能賣");
      const each = it.p ? Math.max(1, Math.floor(D.POTIONS[it.p].price * D.SELL_RATE)) : Math.max(1, Math.floor(it.v * D.SELL_RATE));
      const n = it.p ? Math.min(it.q, Math.max(1, Number(m.n) || it.q)) : 1;
      if (it.p) { it.q -= n; if (it.q <= 0) c.inv.splice(c.inv.indexOf(it), 1); } else c.inv.splice(c.inv.indexOf(it), 1);
      if (!it.p) bountyHit(p, "sell");
      c.gold += each * n; invChanged(p); sys(p, `賣掉 ${it.p ? D.POTIONS[it.p].name + " ×" + n : it.n}，得到 ${each * n} 兩。`); return;
    }
    case "npc": {
      const n = npcsOf(p.map).find((x) => x.id === m.id); if (!n) return;
      if (Math.hypot(n.x - p.x, n.y - p.y) > 4.5) { p.tgt = null; p.path = astar(mp, p.x, p.y, n.x, n.y + 1); out(ws, { t: "mo", a: "walkto", id: n.id }); return; }
      if (n.kind === "exit") { const I = mp.inst, d = I && D.DUNGEONS[I.key]; if (d) placeIn(p, d.map, maps[d.map].def.stone.x, maps[d.map].def.stone.y + 1); return; }
      const o = { t: "mo", a: "npc", id: n.id, kind: n.kind, name: n.name, say: n.say, shop: shopOf(p, n.kind) };
      if (n.kind === "guide") { o.adv = Object.entries(D.ADV).filter(([, v]) => v.base === c.cls).map(([k, v]) => ({ k, n: v.name, d: v.desc, mod: v.mod, skills: D.ADV_SKILLS[k].map((s) => ({ name: s.name, lv: s.lv, desc: s.desc, id: s.id })) })); o.advLv = D.ADV_LV; o.myAdv = c.adv || "";
        if (c.adv) { o.adv2 = Object.entries(D.ADV2).filter(([, v]) => v.base === c.adv).map(([k, v]) => ({ k, n: v.name, d: v.desc, mod: v.mod, skills: D.ADV2_SKILLS[k].map((s) => ({ name: s.name, lv: s.lv, desc: s.desc, id: s.id })) })); o.adv2Lv = D.ADV2_LV; o.myAdv2 = c.adv2 || ""; } }
      if (n.kind === "tower") { const A = db.acc[p.key], tw = A && A.tw && A.tw.d === today() ? A.tw.n : 0; o.tower = { left: D.TOWER.daily - tw, daily: D.TOWER.daily, minLv: D.TOWER.minLv, time: D.TOWER.time / 60, lead: !p.party || parties.get(p.party).leader === p.key, team: p.party ? parties.get(p.party).members.size : 1 }; }
      if (n.kind === "arena") { const A = db.acc[p.key]; o.arena = { top: arenaTop(), me: (A && A.pvp) || { w: 0, l: 0 } }; }
      if (n.kind === "story") { o.story = storyView(c, n.id); o.art = n.art; }
      Object.assign(o, npcExtra(p, n.kind));
      if (n.kind === "dungeon") { const d = D.DUNGEONS[n.dg], A = db.acc[p.key]; o.dg = { key: n.dg, name: d.name, desc: d.desc, lv: d.lv, left: dgLeft(A, n.dg, d.daily), daily: d.daily, set: { ...D.SETS[d.set], b2: undefined, b3: undefined }, diffs: D.DIFF.map((x) => ({ k: x.k, n: x.name, lv: d.lv + x.lv, setP: x.setP, legend: x.legend })), lead: !p.party || parties.get(p.party).leader === p.key, team: p.party ? parties.get(p.party).members.size : 1 }; }
      if (n.kind === "tower") { const A = db.acc[p.key]; o.climb = { left: dgLeft(A, "climb", D.CLIMB.daily), daily: D.CLIMB.daily, best: A.tb || 0, minLv: D.CLIMB.minLv, time: D.CLIMB.time / 60 }; }
      if (n.kind === "smith") o.mats = Object.entries(D.POTIONS).filter(([, v]) => v.mat).map(([k, v]) => ({ k, n: v.name, price: v.price, d: v.d }));
      if (n.kind === "post" || n.kind === "stone") {
        const vis = c.visited || ["town"];
        o.warps = Object.entries(D.MAPS).filter(([k]) => k !== p.map).map(([k, v]) => ({ k, n: v.name, lvl: v.lvl || (v.town ? "安全區" : ""), cost: D.WARP_COST[k] || 0, ok: vis.includes(k) }));
        o.recall = n.kind === "post" && c.recall && D.MAPS[c.recall.map] ? D.MAPS[c.recall.map].name : "";
      }
      if (n.kind === "bank") { const BA = bankAcc(db.acc[p.key], p.key); o.real = p.real; o.cap = D.BANK_DAILY_OUT; o.used = c.day.d === today() ? c.day.out : 0; o.pool = bankPool(BA); o.poolIn = BA.bankIn || 0; o.maxIn = D.BANK_MAX_IN; if (p.real) { try { const r = await botInfo(ws.user.uid); o.tokens = r && typeof r.balance === "number" ? r.balance : null; } catch { o.tokens = null; } } }
      out(ws, o); return;
    }
    case "warp": {      // 驛站傳送：要站在車夫或傳送石旁邊、目的地去過、付得起車資
      if (p.dead) return;
      const to = String(m.to || ""), def = D.MAPS[to];
      if (!def || to === p.map) return;
      if (!nearNpc(p, "post") && !nearNpc(p, "stone")) return err("要在驛站車夫或傳送石旁邊才能傳送");
      if (!(c.visited || []).includes(to)) return err(`還沒去過${def.name}，要先自己走過去一次`);
      const cost = D.WARP_COST[to] || 0;
      if (c.gold < cost) return err(`車資 ${cost} 兩，銀兩不夠`);
      c.gold -= cost; p.dirty = true;
      const at = def.town ? { x: D.NPCS.find((n) => n.kind === "post").x, y: D.NPCS.find((n) => n.kind === "post").y + 1.2 } : { x: maps[to].def.stone.x, y: maps[to].def.stone.y + 1 };
      placeIn(p, to, at.x, at.y); sys(p, `${cost ? `付了 ${cost} 兩，` : ""}傳送到${def.name}。`); return;
    }
    case "buy": {
      const k = String(m.k || "");
      if (D.POTIONS[k]) {
        if (D.POTIONS[k].mat ? !nearNpc(p, "smith") : !nearNpc(p, "herb")) return err(D.POTIONS[k].mat ? "要在鐵匠旁邊才能買" : "要在藥鋪旁邊才能買");
        const P = D.POTIONS[k], n = Math.max(1, Math.min(99, Math.floor(Number(m.n) || 1)));
        if ((P.lv || 1) > c.lv) return err(`${P.lv} 級才能買`);
        if (c.gold < P.price * n) return err("銀兩不夠");
        if (!addItem(p, { p: k, q: n })) return err("背包滿了");
        c.gold -= P.price * n; invChanged(p); sys(p, `買了 ${P.name} ×${n}，花 ${P.price * n} 兩。`); return;
      }
      const [s, ts] = k.split(":"), tier = Number(ts);
      if (!D.SLOTS[s] || !D.TIERS.includes(tier)) return;
      if (!nearNpc(p, "smith")) return err("要在鐵匠旁邊才能買");
      if (tier > c.lv) return err(`${tier} 級才能買`);
      const price = D.itemValue(tier, 0);
      if (c.gold < price) return err("銀兩不夠");
      if (c.inv.length >= invMax(c)) return err("背包滿了");
      c.gold -= price; const it = makeEquip(s, tier, 0, c.cls); c.inv.push(it); invChanged(p); sys(p, `買了「${it.n}」，花 ${price} 兩。`); return;
    }
    case "bank": {
      if (!p.real || !ws.user) return err("要先用 Discord 登入才能用錢莊");
      if (!nearNpc(p, "bank")) return err("要在錢莊旁邊才能換");
      if (p.banking) return err("上一筆還在處理");
      const amt = Math.floor(Number(m.n));
      if (!(amt >= 1)) return err("金額不對");
      p.banking = true;
      try {
        if (m.op === "in") {
          if (amt > D.BANK_MAX_IN) return err(`一次最多換 ${D.BANK_MAX_IN.toLocaleString()}`);
          const BA = bankAcc(db.acc[p.key], p.key);
          const r = await botSettle(ws.user.uid, ws.user.name, amt, 0, "水墨江湖：代幣換銀兩");
          if (!r || !r.ok) return err(r && r.error === "insufficient" ? "代幣不夠" : "機器人暫時連不上，稍後再試");
          c.gold += amt; BA.bankIn = (BA.bankIn || 0) + amt; p.dirty = true; mmoSave(true);
          out(ws, { t: "mo", a: "bank", tokens: r.balance, used: c.day.d === today() ? c.day.out : 0, cap: D.BANK_DAILY_OUT, pool: bankPool(BA), poolIn: BA.bankIn });
          sys(p, `用 ${amt} 代幣換了 ${amt} 兩。`); return;
        }
        if (m.op === "out") {
          if (c.day.d !== today()) c.day = { d: today(), out: 0 };
          const BA = bankAcc(db.acc[p.key], p.key);
          const dayLeft = Math.max(0, D.BANK_DAILY_OUT - c.day.out), pool = bankPool(BA), left = dayLeft + pool;
          if (left <= 0) return err("今天的兌換額度用完了，明天再來");
          if (amt > left) return err(`現在最多還能換 ${left.toLocaleString()} 兩（今天額度 ${dayLeft.toLocaleString()}＋歷史存入額度 ${pool.toLocaleString()}）`);
          if (c.gold < amt) return err("銀兩不夠");
          const useDay = Math.min(amt, dayLeft), usePool = amt - useDay;      // 先扣每天的額度，不夠再扣歷史存入
          c.gold -= amt; c.day.out += useDay; BA.bankUsed = (BA.bankUsed || 0) + usePool; p.dirty = true; mmoSave(true);     // 先扣，再付；付失敗就記下來之後補發
          let r = null; try { r = await botPay(ws.user.uid, ws.user.name, amt, "水墨江湖：銀兩換代幣"); } catch {}
          if (!r || !r.ok) { db.pend[p.key + ":" + now()] = { uid: ws.user.uid, name: ws.user.name, amount: amt }; mmoSave(true); sys(p, `已扣 ${amt} 兩，代幣稍後補發（機器人暫時連不上）。`); return; }
          out(ws, { t: "mo", a: "bank", tokens: r.balance, used: c.day.out, cap: D.BANK_DAILY_OUT, pool: bankPool(BA), poolIn: BA.bankIn });
          sys(p, `用 ${amt.toLocaleString()} 兩換了 ${amt.toLocaleString()} 代幣${usePool ? `（其中 ${usePool.toLocaleString()} 用歷史存入額度）` : ""}。`); return;
        }
      } finally { p.banking = false; }
      return;
    }
    case "chat": {
      const text = clean(m.text, 80); if (!text || t - p.chatT < 700) return; p.chatT = t;
      if (text.startsWith("/p ")) {
        if (!p.party) return err("你沒有隊伍");
        for (const k of parties.get(p.party).members) { const q = players.get(k); if (q) out(q.ws, { t: "mo", a: "chat", id: p.id, n: c.name, text: text.slice(3), ch: "party" }); }
        return;
      }
      for (const q of players.values()) if (q.map === p.map) out(q.ws, { t: "mo", a: "chat", id: p.id, n: c.name, text, ch: "map" });
      return;
    }
    case "pinv": {
      const q = byId.get(Number(m.id)); if (!q || q === p) return;
      if (q.party && q.party === p.party) return err("已經是隊友了");
      if (q.party) return err("對方已經有隊伍");
      if (p.party && parties.get(p.party).members.size >= D.PARTY_MAX) return err(`隊伍最多 ${D.PARTY_MAX} 人`);
      q.invites.set(p.key, t);
      out(q.ws, { t: "mo", a: "ask", kind: "party", from: p.id, n: c.name }); sys(p, `已邀請 ${q.ch.name} 組隊。`); return;
    }
    case "pacc": {
      const q = byId.get(Number(m.id)); if (!q || !p.invites.has(q.key) || t - p.invites.get(q.key) > 60000) return err("邀請過期了");
      p.invites.delete(q.key);
      if (p.party) leaveParty(p);
      let pt = q.party ? parties.get(q.party) : null;
      if (!pt) { pt = { id: nextParty++, leader: q.key, members: new Set([q.key]) }; parties.set(pt.id, pt); q.party = pt.id; }
      if (pt.members.size >= D.PARTY_MAX) return err("隊伍滿了");
      pt.members.add(p.key); p.party = pt.id;
      for (const r of players.values()) { r.known.delete(p.id); r.known.delete(q.id); }
      for (const k of pt.members) { const r = players.get(k); if (r) sys(r, `${c.name} 加入了隊伍。`); }
      sendParty(pt); return;
    }
    case "pleave": if (p.party) leaveParty(p); return;
    case "treq": {
      const q = byId.get(Number(m.id)); if (!q || q === p) return;
      if (!p.real || !q.real) return err("交易要雙方都用 Discord 登入");
      if (q.map !== p.map || dist(p, q) > 8) return err("離太遠了，走近一點再交易");
      if (p.trade || q.trade) return err("有人正在交易中");
      q.invites.set("t:" + p.key, t);
      out(q.ws, { t: "mo", a: "ask", kind: "trade", from: p.id, n: c.name }); sys(p, `已向 ${q.ch.name} 提出交易。`); return;
    }
    case "tacc": {
      const q = byId.get(Number(m.id)); if (!q || !p.invites.has("t:" + q.key) || t - p.invites.get("t:" + q.key) > 60000) return err("交易邀請過期了");
      p.invites.delete("t:" + q.key);
      if (p.trade || q.trade) return err("有人正在交易中");
      if (q.map !== p.map || dist(p, q) > 8) return err("離太遠了");
      const tr = { a: q.key, b: p.key, items: { [q.key]: [], [p.key]: [] }, gold: { [q.key]: 0, [p.key]: 0 }, ok: { [q.key]: false, [p.key]: false } };
      trades.set(q.key, tr); trades.set(p.key, tr); p.trade = q.trade = tr; tradeView(tr); return;
    }
    case "tadd": case "tgold": case "tok": case "tcancel": {
      const tr = p.trade; if (!tr) return;
      if (a === "tcancel") return cancelTrade(tr, `${c.name} 取消了交易`);
      if (a === "tok") { tr.ok[p.key] = true; if (tr.ok[tr.a] && tr.ok[tr.b]) return finishTrade(tr); return tradeView(tr); }
      tr.ok[tr.a] = tr.ok[tr.b] = false;           // 內容一改，兩邊都要重新確認
      if (a === "tgold") tr.gold[p.key] = Math.max(0, Math.min(c.gold, Math.floor(Number(m.n) || 0)));
      else {
        const it = c.inv.find((x) => (x.u || x.p) === m.u); if (!it) return;
        const L = tr.items[p.key], u = it.u || it.p, i = L.indexOf(u);
        if (i >= 0) L.splice(i, 1); else if (L.length < 8) L.push(u);
      }
      return tradeView(tr);
    }
  }
}
function clampHp(p) { const st = statsOf(p); p.hp = Math.min(p.hp, st.hp); p.mp = Math.min(p.mp, st.mp); }
function recall(p) {        // 回到上次用回城符（或倒下）的地方
  const c = p.ch;
  if (!c.recall || !maps[c.recall.map]) return out(p.ws, { t: "mo", a: "err", text: "沒有可以回去的地方：在野外用回城符回城後，才能用它回到原地" });
  const r = c.recall; c.recall = null; p.dirty = true;
  placeIn(p, r.map, r.x, r.y); sys(p, `回到${D.MAPS[r.map].name}剛剛的位置。`);
}
function usePotion(p, it) {
  const P = D.POTIONS[it.p], c = p.ch, t = now();
  if (P.mat) return out(p.ws, { t: "mo", a: "err", text: `${P.name}是鍛造材料，拿去給鐵匠用` });
  if (!P.tp && t >= p.potT) bountyHit(p, "potion");
  if (t < p.potT) return;
  if ((P.lv || 1) > c.lv) return out(p.ws, { t: "mo", a: "err", text: `${P.lv} 級才能用` });
  if (P.tp) {
    if (p.map === "town") return recall(p);
    if (isInst(p.map)) { if (maps[p.map].inst.kind === "arena") return out(p.ws, { t: "mo", a: "err", text: "擂台上不能用回城符" }); it.q--; if (it.q <= 0) c.inv.splice(c.inv.indexOf(it), 1); invChanged(p); placeIn(p, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y); sys(p, "離開了鎖妖塔。"); return; }
    c.recall = { map: p.map, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    it.q--; if (it.q <= 0) c.inv.splice(c.inv.indexOf(it), 1); invChanged(p); placeIn(p, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y);
    sys(p, `回到長安城。補給完在城裡再用一次回城符（按 3），就能回到剛剛${D.MAPS[c.recall.map].name}的位置（不會再扣符）。`); return;
  }
  const st = statsOf(p);
  if (P.hp && p.hp >= st.hp) return out(p.ws, { t: "mo", a: "err", text: "生命已經滿了" });
  if (P.mp && p.mp >= st.mp && !P.hp) return out(p.ws, { t: "mo", a: "err", text: "法力已經滿了" });
  p.potT = t + D.POTION_CD * 1000;
  if (P.hp) p.hp = Math.min(st.hp, p.hp + P.hp);
  if (P.mp) p.mp = Math.min(st.mp, p.mp + P.mp);
  it.q--; if (it.q <= 0) c.inv.splice(c.inv.indexOf(it), 1);
  maps[p.map].fx.push({ k: "heal", b: p.id, d: P.hp || 0, m: P.mp || 0 });
  invChanged(p);
}
function equip(p, it) {
  const c = p.ch;
  if (it.t > c.lv) return out(p.ws, { t: "mo", a: "err", text: `${it.t} 級才能裝備` });
  if (it.s === "weapon" && it.c && it.c !== c.cls) return out(p.ws, { t: "mo", a: "err", text: `這是${D.CLASSES[it.c].name}的武器` });
  const old = c.eq[it.s];
  c.inv.splice(c.inv.indexOf(it), 1);
  if (old) c.inv.push(old);
  c.eq[it.s] = it; clampHp(p); invChanged(p);
}
// 給測試用
export const _mmo = { maps, players, db, statsOf, astar, walk };
// 關機（systemctl restart）前存檔，避免掉最多 30 秒的進度
for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => { try { mmoSave(true); } catch {} process.exit(0); });
