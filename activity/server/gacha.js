// 水墨卡冊・抽卡（套一：收集）：抽卡、保底、重複卡轉墨點、升星、墨點兌換、圖鑑獎勵、每日簽到。
// 規則數字全部在這個檔案，前端只負責畫。每個身分一份收藏；練習模式和真代幣模式的收藏是分開的（和種菜一樣）。
// 錢：真代幣模式用機器人錢包的真代幣（抽卡扣）；練習模式用自己的練習幣。獎勵只發「抽卡券」和「墨點」，不直接發代幣，不影響整體經濟。
import fs from "node:fs";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { botSettle, botInfo, ENV } from "./bet.js";

const REAL_ON = ENV.GACHA_REAL === "on";      // 真代幣抽卡預設關閉（.env 設 GACHA_REAL=on 才開）

const CARDS = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../src/gacha-cards.json", import.meta.url)), "utf8"));
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
const SWAP = { N: 100, R: 300, SR: 1200, SSR: 4000 };              // 用墨點直接兌換還沒有的卡
const MILESTONES = [[10, 1], [25, 2], [50, 3], [100, 5], [150, 8], [200, 10], [250, 12], [300, 20]];     // 收集到幾張不同的卡 → 一次性送幾張抽卡券
const SETBONUS = { east: 20, west: 20, orig: 10, whim: 10 };       // 集滿一個卡組 → 抽卡券
const DAILY_TICKETS = 1, START_TICKETS = 30;                       // 每日簽到送 1 抽；每個人第一次開局送 30 抽（真代幣模式）
const PRACTICE_COIN = 100000, PRACTICE_TICKETS = 10;               // 練習模式：每次進入都清空收藏，重新給 10 萬練習幣和 10 抽
const starCost = (r, star) => STAR_BASE[r] * star;

// ---- 存檔
const GFILE = fileURLToPath(new URL("./gacha.json", import.meta.url));
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
const fresh = (real) => ({ coin: real ? 0 : PRACTICE_COIN, ink: 0, tickets: real ? START_TICKETS : PRACTICE_TICKETS, cards: {}, dups: {}, pulls: 0, daily: "", claimed: [], nm: "" });
const userOf = (key) => { const u = (db.users[key] ||= fresh(key.startsWith("r:"))); u.dups ||= {}; return u; };
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
    t: "gc", a: "view", real, balance: real ? bal : u.coin, ink: u.ink, tickets: u.tickets, cards: u.cards, dups: u.dups, owned, total: CARDS.length,
    pulls: u.pulls, canSign: u.daily !== today(),
    claimed: u.claimed, milestones: MILESTONES, setBonus: SETBONUS, price: PRICE, tenPrice: TEN_PRICE, rate: RATE,
    dupInk: DUP_INK, starBase: STAR_BASE, swap: SWAP, maxStar: MAX_STAR,
    sets: Object.fromEntries(Object.entries(SETIDS).map(([s, ids]) => [s, { name: SETS[s], have: ids.filter((i) => u.cards[i]).length, n: ids.length }])),
  };
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
      const cost = starCost(c.rarity, star);
      if (u.ink < cost) { err("no_ink"); return; }
      u.ink -= cost; u.cards[cid] = star + 1; gachaSave(true);
      out(ws, { t: "gc", a: "upgraded", id: cid, star: star + 1, cost });
      await send(); return;
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
