// 水墨江湖（MMORPG）伺服器：整個世界在這裡模擬（每秒 10 次），前端只負責畫和送指令。
// 角色綁 Discord 身分（r:<uid>，登入過）或訪客（g:<瀏覽器代號>）。訪客能玩，但不能用錢莊、不能交易。
// 存檔：data/records/activity/mmo.json（角色、錢莊待補發）。
import fs from "node:fs";
import { randomInt } from "node:crypto";
import { botSettle, botPay, botInfo } from "../../bet.js";
import { arec } from "../../paths.js";
import * as D from "./data.js";

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
  if (def.open) {          // 擂台：一整片空地，四周圍起來
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = inner(x, y) ? 0 : 1;
    for (const [x, y] of [[3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4]]) set(x, y, 1);
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
    for (let i = 0; i < 3; i++) {
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
  const tiles = Array.from(t).join("");
  return { id, def, w, h, t, tiles, spots, mobs: [], fx: [], R };
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
  }
}
initMaps();

// 每張地圖上的 NPC：城裡是固定那幾位，野外只有一塊驛站傳送石
const npcsOf = (id) => (maps[id] && maps[id].def.town ? D.NPCS : maps[id] && maps[id].def.stone ? [{ id: "st_" + id, name: "驛站傳送石", kind: "stone", x: maps[id].def.stone.x, y: maps[id].def.stone.y, say: "伸手摸一下石碑，就能傳到去過的地方。" }] : []);
const mapName = (id) => (maps[id] ? maps[id].def.name : D.MAPS[id] ? D.MAPS[id].name : "長安城");
const isInst = (id) => !!(maps[id] && maps[id].inst);
// 客棧酒菜（角色自己的）、城隍廟祈福（整個帳號）
const foodOf = (c) => (c.food && c.food.until > now() ? D.FOODS[c.food.k] : null);
const blessOf = (p) => { const A = db.acc[p.key], b = A && A.bless; if (!b || !(b.until > now())) return null; const B = D.BLESS.find((x) => x.k === b.k); return B && B.buff ? B : null; };
function bonus(p, kind) { let v = 0; const f = foodOf(p.ch), b = blessOf(p); if (f && f.buff === kind) v += f.v; if (b && b.buff === kind) v += b.v; return v; }
// ======================================================================== 角色數值
function statsOf(p) {
  const c = p.ch, C = D.CLASSES[c.cls], L = c.lv;
  const s = { hp: C.hp[0] + C.hp[1] * (L - 1), mp: C.mp[0] + C.mp[1] * (L - 1), atk: C.atk[0] + C.atk[1] * (L - 1), def: C.def[0] + C.def[1] * (L - 1), crit: 5, aspdP: 0, range: C.range, spd: C.spd, aspd: C.aspd };
  for (const it of Object.values(c.eq)) if (it) for (const st of [it.st, it.eb]) if (st) for (const [k, v] of Object.entries(st)) { if (k === "aspd") s.aspdP += v; else s[k] = (s[k] || 0) + v; }
  s.hp = Math.round(s.hp); s.mp = Math.round(s.mp); s.atk = Math.round(s.atk); s.def = Math.round(s.def);
  s.aspd = C.aspd / (1 + s.aspdP / 100);
  const A = c.adv && D.ADV[c.adv];
  if (A) { const M = A.mod; for (const k of ["hp", "mp", "atk", "def"]) if (M[k]) s[k] = Math.round(s[k] * M[k]); if (M.spd) s.spd *= M.spd; if (M.aspd) s.aspd *= M.aspd; s.crit += M.crit || 0; s.range += M.range || 0; }
  if (p.buff.gale > now()) { s.spd *= 1.4; s.aspd /= 1.4; }
  if (p.buff.rage > now()) s.atk = Math.round(s.atk * 1.3);
  if (p.buff.eagle > now()) { s.atk = Math.round(s.atk * 1.25); s.crit += 25; }
  const fa = bonus(p, "atk"); if (fa) s.atk = Math.round(s.atk * (1 + fa));
  s.crit = Math.min(60, s.crit);
  return s;
}
const allSkills = (c) => c.adv ? [...D.SKILLS[c.cls], ...D.ADV_SKILLS[c.adv]] : D.SKILLS[c.cls];
const slotN = (c) => (c.adv ? D.SLOT_N + 1 : D.SLOT_N);        // 轉職後多一格技能欄（F）

// ======================================================================== 物品
let itemSeq = now() % 1e6;
function makeEquip(slot, tier, r, cls) {
  const b = D.baseItem(slot, tier, cls);
  const it = { u: (itemSeq++).toString(36), s: slot, t: tier, r, c: slot === "weapon" ? cls : undefined, n: b.name, st: {}, v: 0 };
  it.af = rollAff(tier, D.RAR[r].aff); rebuild(it);
  return it;
}
// 裝備數值 = 基礎（照品質放大）＋詞條（af）；強化加成另外放在 eb
function baseOf(it) { const b = D.baseItem(it.s, it.t, it.c || "sword"), st = {}; for (const [k, v] of Object.entries(b.st)) st[k] = Math.round(v * D.RAR[it.r].mult); return st; }
function affOf(it) {       // 舊裝備沒有分開存詞條：用「總數值 − 基礎」推回來
  if (it.af) return it.af;
  const b = baseOf(it), af = {}; for (const [k, v] of Object.entries(it.st)) { const d = v - (b[k] || 0); if (d > 0) af[k] = d; }
  return (it.af = af);
}
function rollAff(tier, n) {
  const keys = Object.keys(D.AFFIX), picked = new Set(), af = {};
  while (picked.size < n) picked.add(keys[randomInt(keys.length)]);
  for (const k of picked) af[k] = Math.max(1, Math.round(D.AFFIX[k].v(tier) * rnd(0.7, 1.3)));
  return af;
}
function rebuild(it) {
  const st = baseOf(it); for (const [k, v] of Object.entries(affOf(it))) st[k] = (st[k] || 0) + v; it.st = st;
  if (it.e) { const eb = {}; for (const [k, v] of Object.entries(D.baseItem(it.s, it.t, it.c || "sword").st)) if (k !== "crit") eb[k] = Math.max(1, Math.round(v * D.ENH.bonus * it.e)); it.eb = eb; } else delete it.eb;
  it.v = Math.round(D.itemValue(it.t, it.r) * (1 + 0.15 * (it.e || 0)));
}
const matCount = (c, k) => c.inv.filter((x) => x.p === k).reduce((s, x) => s + x.q, 0);
function takeMat(c, k, n) { const it = c.inv.find((x) => x.p === k && x.q >= n); if (!it) return false; it.q -= n; if (it.q <= 0) c.inv.splice(c.inv.indexOf(it), 1); return true; }
const isPot = (it) => it && it.p;
function addItem(p, it) {
  const inv = p.ch.inv;
  if (isPot(it)) { const ex = inv.find((x) => x.p === it.p); if (ex) { ex.q += it.q; return true; } }
  if (inv.length >= D.INV_MAX) return false;
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
function randomDrop(p, lv, boss) {
  const slot = ["weapon", "armor", "acc"][randomInt(3)];
  return makeEquip(slot, tierFor(lv), rollRarity(boss), p.ch.cls);   // 武器掉自己職業的
}

// ======================================================================== 新角色
function newChar(name, cls, lv = 1) {
  const c = { name, cls, lv, exp: 0, visited: ["town"], map: "town", x: D.TOWN_SPAWN.x, y: D.TOWN_SPAWN.y, hp: 9999, mp: 9999, inv: [], eq: { weapon: null, armor: null, acc: null }, made: now() };
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

function charList(A) { return A.chars.map((c, i) => ({ i, n: c.name, c: c.cls, lv: c.lv, adv: c.adv || "", advN: c.adv ? D.ADV[c.adv].name : "", map: D.MAPS[c.map] ? D.MAPS[c.map].name : "長安城", w: c.eq.weapon ? c.eq.weapon.n : "" })); }
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
  p.map = mapId; p.x = x; p.y = y; p.path = null; p.tgt = null; p.queued = null; p.known = new Set();
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
function hitMob(p, mob, mult, fxKind) {
  if (mob.pvp) return hitPvp(p, mob.pvp, mult, fxKind);
  if (mob.dead) return 0;
  const st = statsOf(p), crit = Math.random() * 100 < st.crit;
  let d = st.atk * mult * rnd(0.9, 1.1) * (crit ? 1.6 : 1) - mob.st.def * 0.5;
  d = Math.max(1, Math.round(d));
  mob.hp -= d; mob.dmg.set(p.key, (mob.dmg.get(p.key) || 0) + d);
  if (!mob.tgt) mob.tgt = p.key;
  mob.calmT = now();
  p.lastHit = now();
  maps[p.map].fx.push({ k: fxKind || "h", a: p.id, b: mob.id, d, c: crit ? 1 : 0 });
  if (mob.hp <= 0) killMob(maps[p.map], mob);
  return d;
}
function hurtPlayer(m, mob, p, mult = 1) {
  if (p.dead) return;
  const st = statsOf(p);
  let d = mob.st.atk * mult * rnd(0.85, 1.15) - st.def * 0.5;
  if (p.buff.guard > now()) d *= 0.5;
  if (p.buff.shield > now()) d *= 0.6;
  if (p.buff.mingwang > now()) d *= 0.4;
  d = Math.max(1, Math.round(d));
  p.hp -= d; p.lastHit = now(); p.dirty = true;
  m.fx.push({ k: "m", a: mob.id, b: p.id, d });
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
  mob.respawnAt = now() + (mob.def.boss ? mob.def.respawn * 1000 : rnd(12000, 22000));
  m.fx.push({ k: "kill", b: mob.id });
  const dmg = [...mob.dmg.entries()].filter(([k]) => { const q = players.get(k); return q && q.map === m.id; });
  mob.dmg = new Map();
  if (!dmg.length) return;
  const total = dmg.reduce((s, [, v]) => s + v, 0);
  if (m.inst && mob.def.boss) { towerClear(m, mob, dmg); return; }
  if (mob.def.boss) {
    const names = [];
    for (const [k, v] of dmg) {
      const q = players.get(k), share = v / total;
      if (share < 0.03) continue;
      giveExp(q, Math.round(mob.st.exp * Math.max(0.25, share)));
      const gold = Math.round(mob.st.gold * Math.max(0.15, share)); q.ch.gold += gold;
      const it = randomDrop(q, mob.def.lv, true);
      const got = addItem(q, it); if (!got) q.ch.gold += it.v;
      const ore = 2 + randomInt(3); addItem(q, { p: "ore", q: ore });
      const extra = [`玄鐵 ×${ore}`];
      if (Math.random() < 0.5) { addItem(q, { p: "jade", q: 1 }); extra.push("靈玉"); }
      if (Math.random() < 0.25) { addItem(q, { p: "recast", q: 1 }); extra.push("重鑄石"); }
      sys(q, `另外拿到 ${extra.join("、")}。`);
      invChanged(q);
      sys(q, `擊敗${mob.def.name}！分到 ${gold} 兩${got ? `、${D.RAR[it.r].name}「${it.n}」` : `（背包滿了，戰利品換成 ${it.v} 兩）`}。`);
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
  else if (r < 0.21) { const lv = mob.def.lv; it = { p: Math.random() < 0.6 ? (lv >= 30 ? "hp4" : lv >= 18 ? "hp3" : lv >= 10 ? "hp2" : "hp1") : (lv >= 30 ? "mp3" : lv >= 10 ? "mp2" : "mp1"), q: 1 }; }
  // 強化材料：一般怪偶爾掉玄鐵、很少掉靈玉
  const mr = Math.random();
  if (mr < 0.05 || (mr < 0.062 && mob.def.lv >= 10)) { const k = mr < 0.05 ? "ore" : "jade"; if (addItem(top, { p: k, q: 1 })) { invChanged(top); m.fx.push({ k: "loot", a: top.id, b: mob.id, n: D.POTIONS[k].name, r: k === "jade" ? 2 : 1 }); } }
  if (it) {
    const got = addItem(top, it);
    if (got) { invChanged(top); m.fx.push({ k: "loot", a: top.id, b: mob.id, n: it.p ? D.POTIONS[it.p].name : it.n, r: it.p ? 0 : it.r }); }
    else sys(top, "背包滿了，撿不到東西。");
    if (!it.p && it.r === 3) sysAll(`【傳說】${top.ch.name} 打倒${mob.def.name}，掉出傳說裝備「${it.n}」！`);
  }
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
    if (along >= -0.3 && along <= len + 0.4 && side <= w / 2 + (mob.def.boss ? 1.0 : 0.45)) out.push({ mob, along });
  }
  return out.sort((a, b) => a.along - b.along);
}
function applyFx(p, mob, sk) {      // 附帶效果：暈眩、緩速、中毒
  if (mob.dead) return;
  if (mob.pvp) { if (sk.dot) for (let k = 1; k <= sk.dot[1]; k++) later(k * 1000, () => hitPvp(p, mob.pvp, sk.dot[0], "dot")); return; }
  const t = now();
  if (sk.stun) mob.stunT = Math.max(mob.stunT || 0, t + sk.stun * 1000 * (mob.def.boss ? 0.4 : 1));
  if (sk.slow) { mob.slowT = t + sk.slow[1] * 1000; mob.slowP = sk.slow[0] * (mob.def.boss ? 0.5 : 1); }
  if (sk.dot) for (let k = 1; k <= sk.dot[1]; k++) later(k * 1000, () => { if (!mob.dead && players.get(p.key) === p && p.map === mob.mapId) hitMob(p, mob, sk.dot[0], "dot"); });
}
function strike(p, mob, sk, mult = sk.mult) { if (mult > 0) hitMob(p, mob, mult, "s"); applyFx(p, mob, sk); }
const nearestMob = (m, x, y, r, list = m.mobs) => { let best = null, bd = r; for (const mob of list) if (!mob.dead) { const d = Math.hypot(mob.x - x, mob.y - y); if (d < bd) { bd = d; best = mob; } } return best; };

function castSkill(p, sk, aim) {
  const m = maps[p.map], t = now();
  p.mp -= sk.mp; p.cd[sk.id] = t + sk.cd * 1000; p.lastHit = Math.max(p.lastHit, t - 4000); p.dirty = true;
  const base = { k: "sk", a: p.id, s: sk.id, type: sk.type };
  if (sk.type === "self") {
    m.fx.push({ ...base, x: p.x, y: p.y, r: sk.r || 0 });
    if (sk.buff) p.buff[sk.buff[0]] = t + sk.buff[1] * 1000;
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
      for (const mob of foes(m, p)) if (!mob.dead && Math.hypot(mob.x - cx, mob.y - cy) <= sk.r + (mob.def.boss ? 0.8 : 0)) strike(p, mob, sk);
      if (k > 0) m.fx.push({ k: "tick", s: sk.id, x: cx, y: cy, r: sk.r });
    });
  }
}
// aim：{ x, y, id }（滑鼠的世界座標、滑鼠下的怪）
function tryCast(p, sk, aim) {
  if (p.dead) return null;
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
  let d = (st.atk * mult * rnd(0.9, 1.1) * (crit ? 1.6 : 1) - sq.def * 0.5) * D.ARENA.dmg;
  if (q.buff.guard > now()) d *= 0.5; if (q.buff.shield > now()) d *= 0.6; if (q.buff.mingwang > now()) d *= 0.4;
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
  // 傳送點
  const tile = m.t[Math.floor(p.y) * m.w + Math.floor(p.x)];
  if (tile === 4) {
    const pt = m.def.portals.find((q) => Math.abs(q.x - Math.floor(p.x)) <= 0 && (Math.floor(p.y) === q.y || Math.floor(p.y) === q.y + 1));
    if (pt) placeIn(p, pt.to, pt.tx + 0.5, pt.ty + 0.5 + (Math.floor(p.y) - pt.y));
  }
}
function tickMob(m, mob, dt) {
  const t = now();
  if (mob.dead) {
    if (mob.noRe) return;
    if (t >= mob.respawnAt) {
      const at = mob.def.boss ? m.def.bossAt : m.spots[Math.floor(Math.random() * m.spots.length)];
      Object.assign(mob, { dead: false, hp: mob.max, x: at.x, y: at.y, hx: at.x, hy: at.y, tgt: null, path: null, dmg: new Map(), slamAt: 0 });
      if (mob.def.boss) sysAll(`【${m.def.name}】${mob.def.name}出現了！`);
    }
    return;
  }
  if (mob.stunT > t) return;                      // 暈眩：不動、不打
  const sp = mob.st.spd * (mob.slowT > t ? 1 - (mob.slowP || 0) : 1);
  const leash = mob.def.boss ? 16 : 12;
  let p = mob.tgt ? players.get(mob.tgt) : null;
  if (p && (p.map !== m.id || p.dead || Math.hypot(mob.x - mob.hx, mob.y - mob.hy) > leash)) { mob.tgt = null; p = null; mob.path = astar(m, mob.x, mob.y, mob.hx, mob.hy); mob.returning = true; }
  if (!p && mob.def.agg && !mob.returning) {
    let best = null, bd = mob.def.agg;
    for (const q of players.values()) if (q.map === m.id && !q.dead) { const d = dist(q, mob); if (d < bd) { bd = d; best = q; } }
    if (best) { mob.tgt = best.key; p = best; }
  }
  if (p) {
    mob.returning = false;
    const range = mob.def.boss ? 1.9 : 1.2, d = dist(mob, p);
    // 王的範圍重擊：先出警示圈，1.2 秒後打圈內所有人
    if (mob.def.boss) {
      if (!mob.slamAt && t - mob.slamT > 7000) { mob.slamAt = t + 1200; mob.slamX = mob.x; mob.slamY = mob.y; m.fx.push({ k: "warn", x: mob.x, y: mob.y, r: 2.8, t: 1200 }); }
      if (mob.slamAt && t >= mob.slamAt) {
        mob.slamAt = 0; mob.slamT = t; m.fx.push({ k: "slam", x: mob.slamX, y: mob.slamY, r: 2.8 });
        for (const q of players.values()) if (q.map === m.id && !q.dead && Math.hypot(q.x - mob.slamX, q.y - mob.slamY) <= 2.8) hurtPlayer(m, mob, q, 2.2);
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
  if (!here.length) { m.fx = []; return; }
  const ents = [];
  for (const p of here) {
    const st = statsOf(p);
    ents.push([p.id, r2(p.x), r2(p.y), Math.max(0, Math.round(p.hp / st.hp * 100)), (p.dead ? 1 : 0) | (p.buff.guard > now() ? 2 : 0) | (p.buff.gale > now() ? 4 : 0), Math.max(0, Math.round(p.mp / st.mp * 100))]);
  }
  const tn = now();
  for (const mob of m.mobs) if (!mob.dead) ents.push([mob.id, r2(mob.x), r2(mob.y), Math.max(0, Math.round(mob.hp / mob.max * 100)), (mob.tgt ? 8 : 0) | (mob.slamAt ? 16 : 0) | (mob.stunT > tn ? 32 : 0) | (mob.slowT > tn ? 64 : 0)]);
  const fx = m.fx; m.fx = [];
  for (const p of here) {
    const meta = {};
    for (const e of ents) if (!p.known.has(e[0])) {
      p.known.add(e[0]);
      const q = byId.get(e[0]);
      if (q) meta[e[0]] = { k: "p", n: q.ch.name, lv: q.ch.lv, c: q.ch.cls, ad: q.ch.adv || "", pt: q.party || 0 };
      else { const mob = m.mobs.find((x) => x.id === e[0]); if (mob) meta[e[0]] = { k: "m", n: mob.def.name, lv: mob.def.lv, s: mob.def.shape, boss: mob.def.boss ? 1 : 0 }; }
    }
    const msg = { t: "mo", a: "s", e: ents, fx };
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
    hp: Math.round(p.hp), mp: Math.round(p.mp), st: { hp: st.hp, mp: st.mp, atk: st.atk, def: st.def, crit: st.crit, aspd: Math.round(st.aspd * 100) / 100, range: st.range },
    ...(full ? { inv: c.inv, eq: c.eq, adv: c.adv || "", advOk: !c.adv && c.lv >= D.ADV_LV, skills: allSkills(c).map((s) => ({ id: s.id, name: s.name, lv: s.lv, mp: s.mp, cd: s.cd, desc: s.desc, type: s.type, range: s.range || 0, r: s.r || 0, w: s.w || 0, arrows: s.arrows || 1, spread: s.spread || 0, dash: !!s.dash, leap: !!s.leap })), slots: c.slots } : {}), cd, buff: Object.fromEntries(["guard", "gale", "rage", "shield", "eagle", "mingwang"].map((k) => [k, Math.max(0, (p.buff[k] || 0) - t)])),
    tgt: p.tgt || 0, dead: p.dead,
    bankOut: c.day.d === today() ? c.day.out : 0, bankCap: D.BANK_DAILY_OUT, recall: c.recall && D.MAPS[c.recall.map] ? D.MAPS[c.recall.map].name : "", inTown: p.map === "town",
    buffs: buffList(p),
  });
}
let partyT = 0;
setInterval(() => {
  const dt = TICK / 1000;
  try {
    runPending();
    for (const p of players.values()) tickPlayer(p, dt);
    for (const m of Object.values(maps)) { for (const mob of m.mobs) tickMob(m, mob, dt); broadcast(m); if (m.inst) instTick(m); }
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
  if (I.kind === "tower") {
    if (I.done) { if (t > I.closeAt) for (const q of here) placeIn(q, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y); else if (t - I.infoT > 1000) { I.infoT = t; instInfo(m, `通關！${Math.ceil((I.closeAt - t) / 1000)} 秒後回長安城`); } return; }
    if (t > I.endAt) { for (const q of here) { sys(q, "時間到了，被守塔人拉出了鎖妖塔。"); placeIn(q, "town", D.TOWN_SPAWN.x, D.TOWN_SPAWN.y); } I.done = true; I.closeAt = 0; return; }
    if (t >= I.nextT && (I.wave === 0 || m.mobs.every((x) => x.dead))) {
      if (I.wave > 0 && !I.nextSet) { I.nextSet = true; I.nextT = t + 2500; }       // 清完一波：喘口氣再出下一波
      else { I.nextSet = false; towerWave(m); }
    }
    if (t - I.infoT > 1000) { I.infoT = t; const alive = m.mobs.filter((x) => !x.dead).length; instInfo(m, `${I.wave === 0 ? "準備中" : I.wave > D.TOWER.waves.length ? "塔頂・九尾妖狐" : `第 ${I.wave}/${D.TOWER.waves.length} 波・剩 ${alive} 隻`}・${clock}`); }
    return;
  }
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
// ---- 鎖妖塔
function towerWave(m) {
  const I = m.inst, T = D.TOWER; I.wave++;
  m.mobs = m.mobs.filter((x) => !x.dead);
  const mk = (k, lv, hpm, extra = {}) => { const b = D.MONS[k]; const mob = spawnMob(m, k, extra.at, { ...b, lv, agg: 14, hpm: (b.hpm || 1) * hpm, respawn: 0, ...(extra.def || {}) }); mob.noRe = true; return mob; };
  if (I.wave <= T.waves.length) {
    const n = T.waves[I.wave - 1] + Math.max(0, I.n - 1) * 2;
    for (let i = 0; i < n; i++) {
      const elite = I.wave === T.waves.length && i < T.elites;
      const k = T.pool[randomInt(T.pool.length)];
      mk(k, I.lv + (elite ? 2 : 0), elite ? T.eliteHpm : T.hpm, { def: elite ? { name: "精英・" + D.MONS[k].name, atkm: (D.MONS[k].atkm || 1) * 1.3 } : {} });
    }
    for (const q of instHere(m)) sys(q, I.wave === T.waves.length ? `第 ${I.wave} 波：有精英怪，小心！` : `第 ${I.wave} 波妖魔出現了！`);
    return;
  }
  if (I.wave === T.waves.length + 1) {
    m.boss = mk("b_fox", I.lv + 3, D.MONS.b_fox.hpm * (1 + 0.5 * (I.n - 1)), { at: m.def.bossAt });
    for (const q of instHere(m)) sys(q, "塔頂傳來一陣狐鳴……九尾妖狐現身了！");
  }
}
function towerClear(m, mob) {
  const I = m.inst; I.done = true; I.closeAt = now() + 45000;
  const names = [];
  for (const q of instHere(m)) {
    giveExp(q, Math.round(mob.st.exp * 0.6));
    const gold = Math.round(mob.st.gold * 1.5); q.ch.gold += gold;
    const r = Math.random() * 100 < D.TOWER.legend ? 3 : 2;
    const it = makeEquip(["weapon", "armor", "acc"][randomInt(3)], tierFor(I.lv), r, q.ch.cls);
    const got = addItem(q, it); if (!got) q.ch.gold += it.v;
    addItem(q, { p: "ore", q: 5 }); addItem(q, { p: "jade", q: 2 }); addItem(q, { p: "recast", q: 1 });
    invChanged(q);
    sys(q, `鎖妖塔通關！拿到 ${gold} 兩、${D.RAR[it.r].name}「${it.n}」${got ? "" : "（背包滿了，換成銀兩）"}、玄鐵 ×5、靈玉 ×2、重鑄石 ×1。`);
    if (it.r === 3) sysAll(`【傳說】${q.ch.name} 在鎖妖塔得到傳說裝備「${it.n}」！`);
    names.push(q.ch.name);
    bountyHit(q, "tower"); bountyHit(q, "boss"); { const A = db.acc[q.key]; if (A) { A.tc = (A.tc || 0) + 1; A.bk = (A.bk || 0) + 1; } }
  }
  sysAll(`【鎖妖塔】${names.join("、")} 打倒了九尾妖狐！`);
  mmoSave();
}
function towerEnter(p) {
  const c = p.ch, T = D.TOWER;
  if (c.lv < T.minLv) return `${T.minLv} 級才能進鎖妖塔`;
  if (p.party && parties.get(p.party).leader !== p.key) return "要由隊長帶隊進塔";
  const team = p.party ? [...parties.get(p.party).members].map((k) => players.get(k)).filter(Boolean) : [p];
  const ok = [], skip = [];
  for (const q of team) {
    const A = db.acc[q.key], tw = A && A.tw && A.tw.d === today() ? A.tw : { d: today(), n: 0 };
    if (q.map !== "town" || q.dead) skip.push(`${q.ch.name}（不在長安城）`);
    else if (q.ch.lv < T.minLv) skip.push(`${q.ch.name}（未滿 ${T.minLv} 級）`);
    else if (tw.n >= T.daily) skip.push(`${q.ch.name}（今天的次數用完了）`);
    else ok.push(q);
  }
  if (!ok.includes(p)) return `你今天的次數用完了（每天 ${T.daily} 次）`;
  const lv = Math.round(ok.reduce((s2, q) => s2 + q.ch.lv, 0) / ok.length);
  const m = makeInst({ name: "鎖妖塔", w: 34, h: 26, theme: "tower", lvl: `${lv} 級`, boss: "b_fox", portals: [{ x: 0, y: 13, to: "town", tx: 6, ty: 11, label: "← 離開" }] },
    { kind: "tower", lv, n: ok.length, wave: 0, nextT: now() + 4000, endAt: now() + T.time * 1000 });
  for (const q of ok) {
    const A = db.acc[q.key]; A.tw = A.tw && A.tw.d === today() ? A.tw : { d: today(), n: 0 }; A.tw.n++;
    if (q.trade) cancelTrade(q.trade, "進了鎖妖塔，交易取消");
    placeIn(q, m.id, 3.5, 13.5);
    sys(q, `進入鎖妖塔（${lv} 級）。打完三波妖魔，九尾妖狐就會出現。限時 ${T.time / 60} 分鐘，今天還能再進 ${T.daily - A.tw.n} 次。走左邊的門可以離開。`);
  }
  if (skip.length) sys(p, `沒有跟進來：${skip.join("、")}`);
  mmoSave();
  return null;
}
// ---- 擂台
function arenaStart(a, b) {
  const m = makeInst({ name: "擂台", w: 20, h: 14, theme: "arena", open: true, pvp: true, lvl: "切磋" }, { kind: "arena", a: a.key, b: b.key, fight: false, startAt: now() + D.ARENA.countdown * 1000, endAt: now() + (D.ARENA.countdown + D.ARENA.time) * 1000 });
  for (const [q, x] of [[a, 5.5], [b, 14.5]]) {
    if (q.trade) cancelTrade(q.trade, "上擂台了，交易取消");
    const st = statsOf(q); q.hp = st.hp; q.mp = st.mp; q.cd = {}; q.buff = {}; q.tgt = null; q.queued = null;
    placeIn(q, m.id, x, 7.5); q.face = x < 10 ? 1 : -1;
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
  if (L >= D.TOWER.minLv) pool.push({ kind: "tower", name: "通關鎖妖塔 1 次", need: 1, jade: 1 });
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
    return { n: c.name, lv: c.lv || 1, exp: c.exp || 0, gold: A.gold, bk: A.bk || 0, tc: A.tc || 0, pw: (A.pvp && A.pvp.w) || 0, enh };
  });
  const top = (key, fmt, tie) => rows.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || (tie ? b[tie] - a[tie] : 0)).slice(0, 10).map((r) => ({ n: r.n, v: fmt(r) }));
  return [
    { k: "lv", name: "等級", list: top("lv", (r) => `${r.lv} 級`, "exp") },
    { k: "gold", name: "財富", list: top("gold", (r) => `${r.gold.toLocaleString()} 兩`) },
    { k: "bk", name: "打王", list: top("bk", (r) => `${r.bk} 次`) },
    { k: "tc", name: "鎖妖塔", list: top("tc", (r) => `${r.tc} 次`) },
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
  const room = (q, give, get) => q.ch.inv.length - give.length + get.filter((it) => !(it.p && q.ch.inv.some((x) => x.p === it.p && !give.includes(x)))).length <= D.INV_MAX;
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
    for (const t of D.TIERS) for (const s of Object.keys(D.SLOTS)) { const b = D.baseItem(s, t, c.cls); list.push({ k: `${s}:${t}`, n: b.name, s, t, st: b.st, price: D.itemValue(t, 0), lv: t }); }
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
    case "move": {
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
    case "stop": p.tgt = null; p.queued = null; p.path = null; return;
    case "skill": {
      const sk = skillDef(c, m.s); if (!sk) return;
      const x = Number(m.x), y = Number(m.y);
      const e = tryCast(p, sk, { x: m.x == null ? NaN : x, y: m.y == null ? NaN : y, id: Number(m.id) || 0 }); if (e) err(e); return;
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
    case "sellall": {     // 一鍵賣裝：把某個品質以下的裝備全部賣掉（鎖住的、強化過的不賣，傳說永遠不會一鍵賣）
      const r = Math.max(0, Math.min(2, Math.floor(Number(m.r) || 0)));
      const list = c.inv.filter((x) => !x.p && x.r <= r && !x.lock && !(x.e > 0));
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
        c.gold -= gold; it.af = rollAff(it.t, n); rebuild(it); if (worn) clampHp(p); invChanged(p);
        out(ws, { t: "mo", a: "forged", u: it.u, ok: true, op: "aff" });
        sys(p, `「${it.n}」的詞條重抽了。`); return;
      }
      if (m.op === "recast") {
        if (it.r >= 3) return err("已經是傳說了，不能再重鑄");
        const gold = D.RECAST.gold(it.t); if (c.gold < gold) return err(`要 ${gold} 兩`); if (!takeMat(c, "recast", D.RECAST.stone)) return err("要重鑄石 ×1");
        c.gold -= gold;
        const ok = Math.random() * 100 < D.RECAST.up[it.r];
        if (ok) { it.r++; it.af = rollAff(it.t, D.RAR[it.r].aff); }
        rebuild(it); if (worn) clampHp(p); invChanged(p);
        out(ws, { t: "mo", a: "forged", u: it.u, ok, op: "recast" });
        sys(p, ok ? `重鑄成功！「${it.n}」升為${D.RAR[it.r].name}。` : `重鑄失敗，「${it.n}」品質沒變（重鑄石用掉了）。`);
        if (ok && it.r === 3) sysAll(`【鍛造】${c.name} 把「${it.n}」重鑄成傳說裝備！`);
        return;
      }
      return;
    }
    case "tower": {
      if (!nearNpc(p, "tower")) return err("要在守塔人旁邊");
      const e = towerEnter(p); if (e) err(e); return;
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
      if (c.inv.length >= D.INV_MAX) return err("背包滿了");
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
      const o = { t: "mo", a: "npc", id: n.id, kind: n.kind, name: n.name, say: n.say, shop: shopOf(p, n.kind) };
      if (n.kind === "guide") { o.adv = Object.entries(D.ADV).filter(([, v]) => v.base === c.cls).map(([k, v]) => ({ k, n: v.name, d: v.desc, mod: v.mod, skills: D.ADV_SKILLS[k].map((s) => ({ name: s.name, lv: s.lv, desc: s.desc, id: s.id })) })); o.advLv = D.ADV_LV; o.myAdv = c.adv || ""; }
      if (n.kind === "tower") { const A = db.acc[p.key], tw = A && A.tw && A.tw.d === today() ? A.tw.n : 0; o.tower = { left: D.TOWER.daily - tw, daily: D.TOWER.daily, minLv: D.TOWER.minLv, time: D.TOWER.time / 60, lead: !p.party || parties.get(p.party).leader === p.key, team: p.party ? parties.get(p.party).members.size : 1 }; }
      if (n.kind === "arena") { const A = db.acc[p.key]; o.arena = { top: arenaTop(), me: (A && A.pvp) || { w: 0, l: 0 } }; }
      Object.assign(o, npcExtra(p, n.kind));
      if (n.kind === "smith") o.mats = Object.entries(D.POTIONS).filter(([, v]) => v.mat).map(([k, v]) => ({ k, n: v.name, price: v.price, d: v.d }));
      if (n.kind === "post" || n.kind === "stone") {
        const vis = c.visited || ["town"];
        o.warps = Object.entries(D.MAPS).filter(([k]) => k !== p.map).map(([k, v]) => ({ k, n: v.name, lvl: v.lvl || (v.town ? "安全區" : ""), cost: D.WARP_COST[k] || 0, ok: vis.includes(k) }));
        o.recall = n.kind === "post" && c.recall && D.MAPS[c.recall.map] ? D.MAPS[c.recall.map].name : "";
      }
      if (n.kind === "bank") { o.real = p.real; o.cap = D.BANK_DAILY_OUT; o.used = c.day.d === today() ? c.day.out : 0; if (p.real) { try { const r = await botInfo(ws.user.uid); o.tokens = r && typeof r.balance === "number" ? r.balance : null; } catch { o.tokens = null; } } }
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
      if (c.inv.length >= D.INV_MAX) return err("背包滿了");
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
          if (amt > D.BANK_MAX_IN) return err(`一次最多存 ${D.BANK_MAX_IN.toLocaleString()}`);
          const r = await botSettle(ws.user.uid, ws.user.name, amt, 0, "水墨江湖：代幣換銀兩");
          if (!r || !r.ok) return err(r && r.error === "insufficient" ? "代幣不夠" : "機器人暫時連不上，稍後再試");
          c.gold += amt; p.dirty = true; mmoSave(true);
          out(ws, { t: "mo", a: "bank", tokens: r.balance, used: c.day.d === today() ? c.day.out : 0, cap: D.BANK_DAILY_OUT });
          sys(p, `用 ${amt} 代幣換了 ${amt} 兩。`); return;
        }
        if (m.op === "out") {
          if (c.day.d !== today()) c.day = { d: today(), out: 0 };
          const left = D.BANK_DAILY_OUT - c.day.out;
          if (left <= 0) return err("今天的兌換額度用完了，明天再來");
          if (amt > left) return err(`今天最多還能換 ${left} 兩`);
          if (c.gold < amt) return err("銀兩不夠");
          c.gold -= amt; c.day.out += amt; p.dirty = true; mmoSave(true);     // 先扣，再付；付失敗就記下來之後補發
          let r = null; try { r = await botPay(ws.user.uid, ws.user.name, amt, "水墨江湖：銀兩換代幣"); } catch {}
          if (!r || !r.ok) { db.pend[p.key + ":" + now()] = { uid: ws.user.uid, name: ws.user.name, amount: amt }; mmoSave(true); sys(p, `已扣 ${amt} 兩，代幣稍後補發（機器人暫時連不上）。`); return; }
          out(ws, { t: "mo", a: "bank", tokens: r.balance, used: c.day.out, cap: D.BANK_DAILY_OUT });
          sys(p, `用 ${amt} 兩換了 ${amt} 代幣。`); return;
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
