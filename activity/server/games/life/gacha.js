// 水墨卡冊・抽卡（套一：收集）：抽卡、保底、重複卡轉墨點、升星、墨點兌換、圖鑑獎勵、每日簽到。
// 規則數字全部在這個檔案，前端只負責畫。每個身分一份收藏；練習模式和真代幣模式的收藏是分開的（和種菜一樣）。
// 錢：真代幣模式用機器人錢包的真代幣（抽卡扣）；練習模式用自己的練習幣。獎勵只發「抽卡券」和「墨點」，不直接發代幣，不影響整體經濟。
import fs from "node:fs";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { botSettle, botInfo, ENV } from "../../bet.js";
import { arec } from "../../paths.js";

const REAL_ON = ENV.GACHA_REAL === "on";      // 真代幣抽卡預設關閉（.env 設 GACHA_REAL=on 才開）

const CARDS = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../../src/gacha-cards.json", import.meta.url)), "utf8"));
const CARD = new Map(CARDS.map((c) => [c.id, c]));
const BYR = { SSR: [], SR: [], R: [], N: [] };
for (const c of CARDS) BYR[c.rarity].push(c.id);
const SETS = { east: "東方", west: "西方", orig: "原創", whim: "異想" };
const SETIDS = Object.fromEntries(Object.keys(SETS).map((s) => [s, CARDS.filter((c) => c.set === s).map((c) => c.id)]));

// ---- 規則
export const PRICE = 10000, TEN_PRICE = 90000;                      // 單抽 1 萬、十連 9 萬（打九折）
export const RATE = { SSR: 15, SR: 85, R: 300, N: 600 };           // 千分比：SSR 1.5%、SR 8.5%、R 30%、N 60%
const DUP_INK = { N: 5, R: 15, SR: 50, SSR: 150 };                 // 抽到重複的卡轉成幾點墨點
const STAR_BASE = { N: 10, R: 25, SR: 80, SSR: 250 };             // 升星：從 k 星到 k+1 星要 base×k 墨點
const MAX_STAR = 5;
const DUP_STAR = { 1: 1, 2: 1, 3: 2, 4: 3 };                      // 用重複卡升星：從 k 星升到 k+1 星要幾張重複（共 7 張升滿）
const SWAP = { N: 100, R: 300, SR: 1200, SSR: 4000 };              // 用墨點直接兌換還沒有的卡
const MILESTONES = [[10, 1], [25, 2], [50, 3], [100, 5], [150, 8], [200, 10], [250, 12], [300, 20]];     // 收集到幾張不同的卡 → 一次性送幾張抽卡券
const SETBONUS = { east: 20, west: 20, orig: 10, whim: 10 };       // 集滿一個卡組 → 抽卡券
const DAILY_TICKETS = 10, START_TICKETS = 30;                      // 每日簽到送 10 抽；每個人第一次開局送 30 抽（真代幣模式）
const PRACTICE_COIN = 100000, PRACTICE_TICKETS = 10;               // 練習模式：每次進入都清空收藏，重新給 10 萬練習幣和 10 抽
const starCost = (r, star) => STAR_BASE[r] * star;

// ---- 派遣（套二）：把卡派出去按真實時間探險，回來領墨點，長任務還有機會拿抽卡券。不發代幣，不影響整體經濟。
// 一張卡同時只能在一隊；一隊 1～3 張。每張卡每小時的墨點：看稀有度、星級，卡的類別符合任務有加成，整隊同卡組有羈絆加成。
export const MISSIONS = [
  { id: "forest", name: "山林巡遊", icon: "🌲", hours: 1, mult: 1, types: ["神獸", "幻獸"], tick: 0 },
  { id: "town", name: "城鎮遊歷", icon: "🏘️", hours: 2, mult: 1.1, types: ["人物"], tick: 0 },
  { id: "ruin", name: "遺跡探索", icon: "🏛️", hours: 4, mult: 1.25, types: ["器物"], tick: 0.1 },
  { id: "scenery", name: "山水采風", icon: "🌄", hours: 8, mult: 1.5, types: ["山水", "風景"], tick: 0.2 },
];
const MISSION = Object.fromEntries(MISSIONS.map((x) => [x.id, x]));
const INK_RATE = { N: 0.5, R: 1, SR: 1.5, SSR: 3 };       // 每張卡每小時的基本墨點
const STAR_BONUS = 0.1, MATCH_BONUS = 1.5, BOND_BONUS = 1.2;      // 每多一星 +10%；類別符合 ×1.5；整隊（2 張以上）同卡組 ×1.2
const NSLOTS = 3, TEAM_MAX = 3, PRACTICE_SPEED = 60;               // 練習模式時間縮短 60 倍，方便試玩
const speedOf = (real) => (real ? 1 : PRACTICE_SPEED);
function calcTeam(u, ids, mid) {
  const ms = MISSION[mid]; let per = 0, match = 0;
  for (const id of ids) {
    const c = CARD.get(id), star = u.cards[id] || 1, hit = ms.types.includes(c.type);
    per += INK_RATE[c.rarity] * (1 + STAR_BONUS * (star - 1)) * (hit ? MATCH_BONUS : 1); if (hit) match++;
  }
  const bond = ids.length >= 2 && ids.every((id) => CARD.get(id).set === CARD.get(ids[0]).set);
  const ink = Math.max(1, Math.round(per * (bond ? BOND_BONUS : 1) * ms.hours * ms.mult));
  return { ink, tick: ms.tick, match, bond };
}
const busyIds = (u) => (u.slots || []).flatMap((s) => (s ? s.ids : []));

// ---- 存檔
const GFILE = arec("gacha.json");
let db = { users: {} };
try { db = { users: {}, ...JSON.parse(fs.readFileSync(GFILE, "utf8")) }; } catch {}
let saveT = 0;
export function gachaSave(now = false) {
  const w = () => { try { fs.writeFileSync(GFILE, JSON.stringify(db)); } catch (e) { console.log("卡冊存檔失敗", e.message); } };
  if (now) { clearTimeout(saveT); w(); return; }
  clearTimeout(saveT); saveT = setTimeout(w, 800);
}
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);     // 以台灣時間換日
const fresh = (real) => ({ coin: real ? 0 : PRACTICE_COIN, ink: 0, tickets: real ? START_TICKETS : PRACTICE_TICKETS, cards: {}, dups: {}, slots: [null, null, null], show: [null, null, null], pulls: 0, daily: "", claimed: [], nm: "" });
const userOf = (key) => { const u = (db.users[key] ||= fresh(key.startsWith("r:"))); u.dups ||= {}; u.slots ||= [null, null, null]; u.show ||= [null, null, null]; return u; };
const locks = new Set();

// ---- 抽一張（沒有保底，每抽都是獨立機率）
function rollOne(u) {
  u.pulls++;
  let x = randomInt(1000), r;
  r = Object.keys(RATE).find((k) => (x -= RATE[k]) < 0);
  const ids = BYR[r];
  return CARD.get(ids[randomInt(ids.length)]);
}
function takeCard(u, c) {
  const had = u.cards[c.id] || 0;
  if (!had) { u.cards[c.id] = 1; return { id: c.id, rarity: c.rarity, isNew: true, star: 1 }; }
  u.dups[c.id] = (u.dups[c.id] || 0) + 1;     // 重複的卡先留著，之後在圖鑑由玩家決定要不要分解成墨點
  return { id: c.id, rarity: c.rarity, isNew: false, worth: DUP_INK[c.rarity], star: had };
}
// 圖鑑獎勵：達成就自動發一次
function checkRewards(u) {
  const rewards = [], owned = Object.keys(u.cards).length;
  for (const [n, t] of MILESTONES) {
    const k = "m" + n;
    if (owned >= n && !u.claimed.includes(k)) { u.claimed.push(k); u.tickets += t; rewards.push({ k, text: `收集到 ${n} 張不同的卡`, tickets: t }); }
  }
  for (const [s, ids] of Object.entries(SETIDS)) {
    const k = "s" + s;
    if (ids.length && !u.claimed.includes(k) && ids.every((i) => u.cards[i])) { u.claimed.push(k); u.tickets += SETBONUS[s]; rewards.push({ k, text: `集滿「${SETS[s]}」全部 ${ids.length} 張`, tickets: SETBONUS[s] }); }
  }
  return rewards;
}

async function realBalance(ws) {
  if (typeof ws.crbal === "number") return ws.crbal;
  try { const r = await botInfo(ws.user.uid); if (r && typeof r.balance === "number") { ws.crbal = r.balance; return r.balance; } } catch {}
  return null;
}
const note = (ws, r) => { if (r && typeof r.balance === "number") ws.crbal = r.balance; return r; };

function viewOf(u, real, bal) {
  const owned = Object.keys(u.cards).length;
  return {
    t: "gc", a: "view", real, balance: real ? bal : u.coin, ink: u.ink, tickets: u.tickets, cards: u.cards, dups: u.dups, show: u.show, disp: { now: Date.now(), speed: speedOf(real), nslots: NSLOTS, teamMax: TEAM_MAX, slots: u.slots, missions: MISSIONS, rates: INK_RATE, bonus: { star: STAR_BONUS, match: MATCH_BONUS, bond: BOND_BONUS } }, owned, total: CARDS.length,
    pulls: u.pulls, canSign: u.daily !== today(),
    claimed: u.claimed, milestones: MILESTONES, setBonus: SETBONUS, price: PRICE, tenPrice: TEN_PRICE, rate: RATE,
    dupInk: DUP_INK, dupStar: DUP_STAR, starBase: STAR_BASE, swap: SWAP, maxStar: MAX_STAR,
    sets: Object.fromEntries(Object.entries(SETIDS).map(([s, ids]) => [s, { name: SETS[s], have: ids.filter((i) => u.cards[i]).length, n: ids.length }])),
  };
}

// 名卡榜：每個人擺在展示櫃的 3 張卡，依「展示分」排行（稀有度分 × 星數）。真代幣榜和練習榜分開，不需要登入就能看。
const SHOW_PT = { N: 1, R: 3, SR: 12, SSR: 40 };
export function handleGachaBoard(ws, m) {
  const real = !!m.real, pre = real ? "r:" : "p:", rows = [];
  for (const [k, u] of Object.entries(db.users)) {
    if (!k.startsWith(pre) || !u.show) continue;
    const cards = u.show.filter((c) => c && u.cards[c] && CARD.get(c)).map((c) => ({ id: c, star: u.cards[c], rarity: CARD.get(c).rarity }));
    if (!cards.length) continue;
    rows.push({ name: u.nm || (k.startsWith("p:g") ? "匿名玩家" : "玩家" + k.slice(-4)), cards, score: cards.reduce((t, c) => t + SHOW_PT[c.rarity] * c.star, 0), owned: Object.keys(u.cards).length });
  }
  rows.sort((x, y) => y.score - x.score || y.owned - x.owned);
  out(ws, { t: "gboard", real, rows: rows.slice(0, 30), total: rows.length });
}
const a0 = (m) => m.a;
export async function handleGacha(ws, m) {
  const real = !!m.real;
  if (real && !REAL_ON) { out(ws, { t: "gc", a: "err", error: "real_off" }); return; }
  let id;
  if (real) { if (!ws.user) { out(ws, { t: "gc", a: "err", error: "need_login" }); return; } id = ws.user.uid; }
  else id = ws.user ? ws.user.uid : "g" + (String(m.pid || "").replace(/[^\w-]/g, "").slice(0, 40) || ws.cid || "x");
  const key = (real ? "r:" : "p:") + id;
  const err = (error, extra = {}) => out(ws, { t: "gc", a: "err", error, ...extra });
  if (a0(m) === "get" && m.enter && !real) { db.users[key] = fresh(false); gachaSave(true); }     // 每次進入練習模式：收藏清空重來
  const u = userOf(key);
  if (ws.user && u.nm !== ws.user.name) { u.nm = ws.user.name; gachaSave(); }
  const send = async () => out(ws, viewOf(u, real, real ? await realBalance(ws) : null));
  const a = m.a;
  if (a === "get") { await send(); return; }
  if (a === "dauto") {      // 自動組隊：沒在出任務的卡裡，挑派去這個任務墨點最多的組合（要算類別加成、星級、同卡組羈絆）
    if (!MISSION[m.m]) { err("error"); return; }
    const busy = new Set(busyIds(u)), mine = Object.keys(u.cards).map(Number).filter((i) => !busy.has(i) && CARD.get(i));
    if (!mine.length) { out(ws, { t: "gc", a: "dauto", ids: [], ink: 0, tick: 0, match: 0, bond: false }); return; }
    const solo = (i) => calcTeam(u, [i], m.m).ink, val = new Map(mine.map((i) => [i, solo(i)]));
    const byV = [...mine].sort((x, y) => val.get(y) - val.get(x));
    const pool = new Set(byV.slice(0, 30));
    for (const set of Object.keys(SETS)) byV.filter((i) => CARD.get(i).set === set).slice(0, 12).forEach((i) => pool.add(i));      // 每個卡組多留幾張，湊羈絆用
    const P = [...pool]; let best = null, bestInk = -1;
    const tryIds = (ids) => { const r = calcTeam(u, ids, m.m); if (r.ink > bestInk) { bestInk = r.ink; best = { ids, ...r }; } };
    for (let i = 0; i < P.length; i++) {
      tryIds([P[i]]);
      for (let j = i + 1; j < P.length && TEAM_MAX >= 2; j++) {
        tryIds([P[i], P[j]]);
        for (let k = j + 1; k < P.length && TEAM_MAX >= 3; k++) tryIds([P[i], P[j], P[k]]);
      }
    }
    out(ws, { t: "gc", a: "dauto", ...best }); return;
  }
  if (a === "dprev") {      // 預覽這隊派去這個任務能拿多少
    const ids = [...new Set((Array.isArray(m.ids) ? m.ids : []).map(Number))].filter((i) => u.cards[i]).slice(0, TEAM_MAX);
    if (!ids.length || !MISSION[m.m]) { out(ws, { t: "gc", a: "dprev", ink: 0, tick: 0, match: 0, bond: false }); return; }
    out(ws, { t: "gc", a: "dprev", ...calcTeam(u, ids, m.m) }); return;
  }

  if (locks.has(key)) { err("busy"); return; }
  locks.add(key);
  try {
    if (a === "sign") {
      if (u.daily === today()) { err("signed"); return; }
      u.daily = today(); u.tickets += DAILY_TICKETS; gachaSave(true);
      out(ws, { t: "gc", a: "signed", tickets: DAILY_TICKETS });
      await send(); return;
    }
    if (a === "pull") {
      const n = Number(m.n) === 10 ? 10 : 1, byTicket = m.pay === "ticket";
      let cost = 0;
      if (byTicket) { if (u.tickets < n) { err("no_ticket"); return; } }
      else {
        cost = n === 10 ? TEN_PRICE : PRICE;
        if (real) {
          let r; try { r = note(ws, await botSettle(ws.user.uid, ws.user.name, cost, 0, "抽卡")); } catch { r = { ok: false, error: "bot_down" }; }
          if (!r || !r.ok) { err(r && r.error === "insufficient" ? "insufficient" : "bot_down", { balance: r && r.balance }); return; }
        } else {
          if (u.coin < cost) { err("insufficient", { balance: u.coin }); return; }
          u.coin -= cost;
        }
      }
      if (byTicket) u.tickets -= n;
      const results = [];
      for (let i = 0; i < n; i++) results.push(takeCard(u, rollOne(u)));
      const rewards = checkRewards(u);
      gachaSave(true);
      out(ws, { t: "gc", a: "pull", results, rewards, pay: byTicket ? "ticket" : "coin", cost });
      await send(); return;
    }
    if (a === "upgrade") {
      const cid = Number(m.id), c = CARD.get(cid), star = u.cards[cid];
      if (!c || !star) { err("not_owned"); return; }
      if (star >= MAX_STAR) { err("max_star"); return; }
      if (m.dup) {      // 拿 1 張重複的同一張卡來升星，不花墨點
        const need = DUP_STAR[star];
        if (!((u.dups[cid] || 0) >= need)) { err("no_dup", { need }); return; }
        u.dups[cid] -= need; if (u.dups[cid] <= 0) delete u.dups[cid];
        u.cards[cid] = star + 1; gachaSave(true);
        out(ws, { t: "gc", a: "upgraded", id: cid, star: star + 1, cost: 0, dup: true, need });
        await send(); return;
      }
      const cost = starCost(c.rarity, star);
      if (u.ink < cost) { err("no_ink"); return; }
      u.ink -= cost; u.cards[cid] = star + 1; gachaSave(true);
      out(ws, { t: "gc", a: "upgraded", id: cid, star: star + 1, cost });
      await send(); return;
    }
    if (a === "dsend") {
      const slot = Number(m.slot), ms = MISSION[m.m], ids = [...new Set((Array.isArray(m.ids) ? m.ids : []).map(Number))];
      if (!Number.isInteger(slot) || slot < 0 || slot >= NSLOTS || !ms) { err("bad_slot"); return; }
      if (u.slots[slot]) { err("slot_busy"); return; }
      if (!ids.length || ids.length > TEAM_MAX) { err("bad_team"); return; }
      const away = new Set(busyIds(u));
      if (ids.some((i) => !u.cards[i] || !CARD.has(i))) { err("not_owned"); return; }
      if (ids.some((i) => away.has(i))) { err("card_busy"); return; }
      const t = calcTeam(u, ids, ms.id), now = Date.now();
      u.slots[slot] = { ids, m: ms.id, at: now, end: now + ms.hours * 3600e3 / speedOf(real), ink: t.ink, tick: t.tick };
      gachaSave(true); out(ws, { t: "gc", a: "dsent", slot }); await send(); return;
    }
    if (a === "dclaim") {
      const idx = m.slot === "all" ? [...u.slots.keys()] : [Number(m.slot)], now = Date.now();
      let ink = 0, tix = 0, n = 0;
      for (const i of idx) {
        const s = Number.isInteger(i) ? u.slots[i] : null; if (!s || s.end > now) continue;
        ink += s.ink; n++; if (s.tick && randomInt(1000) < s.tick * 1000) tix++;
        u.slots[i] = null;
      }
      if (!n) { err("not_done"); return; }
      u.ink += ink; u.tickets += tix; gachaSave(true);
      out(ws, { t: "gc", a: "dclaimed", n, ink, tickets: tix }); await send(); return;
    }
    if (a === "dcall") {      // 中途召回：拿不到任何獎勵
      const i = Number(m.slot); if (!Number.isInteger(i) || !u.slots[i]) { err("bad_slot"); return; }
      u.slots[i] = null; gachaSave(true); out(ws, { t: "gc", a: "dcalled" }); await send(); return;
    }
    if (a === "salvage") {      // 把重複的卡分解成墨點：id 指定哪張卡（"all" 全部），n 要分解幾張（省略＝全部）
      const ids = m.id === "all" ? Object.keys(u.dups).map(Number) : [Number(m.id)];
      let ink = 0, cnt = 0;
      for (const cid of ids) {
        const c = CARD.get(cid), have = u.dups[cid] || 0; if (!c || have < 1) continue;
        const k = m.id === "all" || m.n == null ? have : Math.max(1, Math.min(have, Math.floor(Number(m.n)) || 1));
        u.dups[cid] = have - k; if (u.dups[cid] <= 0) delete u.dups[cid];
        ink += k * DUP_INK[c.rarity]; cnt += k;
      }
      if (!cnt) { err("no_dup"); return; }
      u.ink += ink; gachaSave(true);
      out(ws, { t: "gc", a: "salvaged", count: cnt, ink });
      await send(); return;
    }
    if (a === "show") {      // 展示櫃：最多 3 張，slot 0~2；id 空＝拿下來
      const sl = Number(m.slot);
      if (!(sl >= 0 && sl <= 2)) { err("error"); return; }
      if (m.id == null) u.show[sl] = null;
      else {
        const cid = Number(m.id);
        if (!u.cards[cid]) { err("not_owned"); return; }
        const at = u.show.indexOf(cid); if (at >= 0) u.show[at] = null;      // 已經在別格就搬過來
        u.show[sl] = cid;
      }
      gachaSave(true); await send(); return;
    }
    if (a === "swap") {
      const cid = Number(m.id), c = CARD.get(cid);
      if (!c) { err("bad_card"); return; }
      if (u.cards[cid]) { err("already"); return; }
      const cost = SWAP[c.rarity];
      if (u.ink < cost) { err("no_ink"); return; }
      u.ink -= cost; u.cards[cid] = 1;
      const rewards = checkRewards(u); gachaSave(true);
      out(ws, { t: "gc", a: "swapped", id: cid, cost, rewards });
      await send(); return;
    }
  } catch (e) { console.log("卡冊錯誤", e && e.message); err("error"); }
  finally { locks.delete(key); }
}

export const _test = { db: () => db, rollOne, userOf, checkRewards, RATE };
