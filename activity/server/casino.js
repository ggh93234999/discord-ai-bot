// 賭場（擲硬幣、骰子、21 點、賽馬，加上老虎機的旁觀動態）。結果全部由伺服器決定，前端只負責演出。
// 每個 Activity instance 的每種遊戲是一個「房間」：同房的人看得到彼此的名單與最新一把（旁觀），賽馬是全房一起押的回合制。
// 練習模式：每條連線一份練習幣；賭注模式：用 bauth 綁定的 Discord 身分，動用機器人錢包的真代幣。
// 真代幣押注中（21 點一手、賽馬一回合）會記在 casino_escrow.json，伺服器若在途中重啟，啟動時全額退回。
import { listPokerTables } from "./poker.js";
import fs from "node:fs";
import { randomInt, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { botSettle, botPay, betLimit } from "./bet.js";

const MAX_PRACTICE = 1_000_000;
export const CASINO_GAMES = ["slots", "coin", "dice", "bj", "horse"];
const PRACTICE_START = 1000;
const BET_MS = 30000, RESULT_MS = 10000;
const rnd = (n) => randomInt(n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

// ---- 賽馬場次：每個房間（Activity）各自累計，房間清空、伺服器重啟都不歸零
const SFILE = fileURLToPath(new URL("./casino_state.json", import.meta.url));
let raceNos = {};
try { raceNos = JSON.parse(fs.readFileSync(SFILE, "utf8")).raceNos || {}; } catch {}
function nextRaceNo(roomId) {
  raceNos[roomId] = (raceNos[roomId] || 0) + 1;
  const keys = Object.keys(raceNos); if (keys.length > 300) delete raceNos[keys[0]];
  try { fs.writeFileSync(SFILE, JSON.stringify({ raceNos })); } catch (e) { console.log("場次寫入失敗", e.message); }
  return raceNos[roomId];
}

// ---- 真代幣託管
const EFILE = fileURLToPath(new URL("./casino_escrow.json", import.meta.url));
let escrow = {};
const esave = () => { try { fs.writeFileSync(EFILE, JSON.stringify(escrow)); } catch (e) { console.log("casino escrow 寫入失敗", e.message); } };
const eadd = (key, v) => { escrow[key] = v; esave(); };
const edel = (key) => { if (escrow[key]) { delete escrow[key]; esave(); } };
export async function recoverCasinoEscrow() {
  try { escrow = JSON.parse(fs.readFileSync(EFILE, "utf8")); } catch { escrow = {}; }
  for (const [k, v] of Object.entries(escrow)) {
    try { const r = await botPay(v.uid, v.name, v.amount, "賭場中斷退款"); if (r && r.ok) { console.log("賭場退款", v.name, v.amount); delete escrow[k]; } } catch {}
  }
  esave();
}

// ---- 錢包：real=true 走機器人，否則練習幣
async function stake(ws, real, bet, why) {
  if (real) {
    const u = ws.user; if (!u) return { ok: false, error: "need_login" };
    try { return await botSettle(u.uid, u.name, bet, 0, why); } catch { return { ok: false, error: "bot_down" }; }
  }
  const bal = ws.cprac ?? PRACTICE_START;
  if (bal < bet) return { ok: false, error: "insufficient", balance: bal };
  ws.cprac = bal - bet;
  return { ok: true, balance: ws.cprac };
}
// 派彩給「某一注」（可能對方已離線）：真代幣用記下來的 uid，練習幣只有人還在才加
async function payTo(b, amount, why) {
  if (amount <= 0) return { ok: true, balance: b.real ? undefined : b.ws.cprac };
  if (b.real) {
    try { return await botPay(b.uid, b.name, amount, why); } catch { console.log("派彩失敗", b.uid, amount, why); return { ok: false, error: "bot_down" }; }
  }
  b.ws.cprac = (b.ws.cprac ?? PRACTICE_START) + amount;
  return { ok: true, balance: b.ws.cprac };
}
async function settleOnce(ws, real, bet, back, why) {
  if (real) {
    const u = ws.user; if (!u) return { ok: false, error: "need_login" };
    try { return await botSettle(u.uid, u.name, bet, back, why); } catch { return { ok: false, error: "bot_down" }; }
  }
  const bal = ws.cprac ?? PRACTICE_START;
  if (bal < bet) return { ok: false, error: "insufficient", balance: bal };
  ws.cprac = bal - bet + back;
  return { ok: true, balance: ws.cprac };
}
const betRef = (ws, real, bet) => ({ ws, real, bet, uid: ws.user?.uid, name: nameOf(ws) });

// ---- 房間與旁觀名單
const rooms = new Map();
let guestN = 0;
function nameOf(ws) { return ws.user?.name || (ws.guest ||= "路人" + String(++guestN).padStart(2, "0")); }
function roomOf(game, id) {
  const key = game + ":" + id;
  if (!rooms.has(key)) rooms.set(key, { key, game, id, members: new Set(), h: null, round: 0 });
  return rooms.get(key);
}
function whoList(room) {
  return [...room.members].filter((w) => !w.cspec).map((w) => ({ id: w.cid, name: nameOf(w), real: !!w.creal, last: w.clast || null, hand: w.chand || null }));
}
function pushWho(room) { const m = { t: "cwho", list: whoList(room), watchers: [...room.members].filter((w) => w.cspec).length }; for (const w of room.members) out(w, m); }
export function casinoFeed(ws, entry) {       // 任何遊戲結束一把就呼叫，讓同房的人看到
  ws.clast = { ...entry, ts: Date.now() }; ws.creal = !!entry.real; ws.chand = null;
  if (ws.cr) pushWho(ws.cr);
}
function setHand(ws, hand) { ws.chand = hand; if (ws.cr) pushWho(ws.cr); }

function leave(ws) {
  const room = ws.cr; if (!room) return;
  room.members.delete(ws); ws.cr = null;
  pushWho(room);
  cleanup(room);
}
function cleanup(room) {
  if (room.members.size || room.game === "horse") return;     // 賽馬房由 tick 負責收尾（可能還有未結的帳）
  rooms.delete(room.key);
}

// ---- 21 點
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠️", "♥️", "♦️", "♣️"];
function handValue(h) {
  let t = 0, a = 0;
  for (const [r] of h) { if (r === "A") { t += 11; a++; } else if ("JQK".includes(r)) t += 10; else t += Number(r); }
  while (t > 21 && a) { t -= 10; a--; }
  return t;
}
const cardTxt = (c) => c[1] + c[0];

async function finishBj(ws, bj, why) {
  const pv = handValue(bj.player);
  while (handValue(bj.dealer) < 17 && pv <= 21) bj.dealer.push(bj.deck.pop());
  const dv = handValue(bj.dealer);
  let back = 0, text;
  if (bj.natural) { back = Math.floor(bj.bet * 2.5); text = "🌟 Blackjack！"; }
  else if (pv > 21) text = "💥 爆牌，輸了";
  else if (dv > 21 || pv > dv) { back = bj.bet * 2; text = "🎉 你贏了！"; }
  else if (pv === dv) { back = bj.bet; text = "🤝 平手，賭注退回"; }
  else text = "😢 莊家贏";
  ws.bj = null;
  const r = await payTo(bj.ref, back, why);
  edel(bj.ekey);
  const res = { player: bj.player.map(cardTxt), pv, dealer: bj.dealer.map(cardTxt), dv, bet: bj.bet, back, text, real: bj.real };
  out(ws, { t: "cres", g: "bj", done: true, ...res, balance: r.balance, payfail: !r.ok });
  casinoFeed(ws, { g: "bj", ...res });
}

export function casinoClose(ws) {
  if (ws.bj) finishBj(ws, ws.bj, "21點(斷線自動停牌)").catch(() => {});
  leave(ws);
}

// ---- 賽馬（全房一起押的回合）
const HORSE_POOL = ["赤兔", "烏騅", "的盧", "絕影", "爪黃飛電", "踏雪", "照夜玉獅子", "追風", "青驄", "黃驃", "驊騮", "飛黃"];
const FORMS = [["🔥 絕佳", 7], ["😀 良好", 3], ["😐 普通", 0], ["😓 欠佳", -4], ["🤕 低迷", -8]];
const FORM_W = [10, 30, 35, 18, 7];
function pickWeighted(w) { let r = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1; }
function newRaceCard() {
  const names = shuffle([...HORSE_POOL]).slice(0, 6);
  const forms = names.map(() => FORMS[pickWeighted(FORM_W)]);
  const str = names.map((_, i) => 0.4 * (55 + rnd(41)) + 0.3 * (55 + rnd(41)) + 0.3 * (55 + rnd(41)) + forms[i][1]);
  const m = Math.max(...str), ex = str.map((x) => Math.exp((x - m) / 14)), tot = ex.reduce((a, b) => a + b, 0);
  const probs = ex.map((x) => x / tot);
  return { names, forms: forms.map((f) => f[0]), probs, odds: probs.map((p) => Math.max(1.1, Math.round(0.95 / p * 10) / 10)) };
}
function raceOrder(probs) {
  const left = probs.map((p, i) => [i, p]), order = [];
  while (left.length) { const k = pickWeighted(left.map((x) => x[1])); order.push(left[k][0]); left.splice(k, 1); }
  return order;
}
function horseNew(room) {
  const card = newRaceCard();
  room.h = { phase: "bet", id: randomBytes(5).toString("hex"), card, closeAt: Date.now() + BET_MS, bets: [], pending: 0, no: nextRaceNo(room.id) };
}
function horseView(room) {
  const h = room.h, c = h.card;
  return { t: "hstate", phase: h.phase, id: h.id, no: h.no, names: c.names, forms: c.forms, odds: c.odds, now: Date.now(), closeAt: h.closeAt,
    startAt: h.startAt, times: h.times, order: h.order, win: h.win, resultAt: h.resultAt,
    bets: h.bets.map((b) => ({ id: b.ws.cid, name: b.name, idx: b.idx, bet: b.bet, real: b.real, back: b.back })) };
}
function pushHorse(room) { if (!room.h) return; const m = horseView(room); for (const w of room.members) out(w, m); }
async function refundAll(room) {
  const h = room.h; if (!h) return;
  const bets = h.bets.splice(0);
  for (const b of bets) { await payTo(b, b.bet, "賽馬取消退款"); edel(b.ekey); }
}
async function horseSettle(room) {
  const h = room.h; h.phase = "result"; h.resultAt = Date.now() + RESULT_MS;
  for (const b of h.bets) b.back = b.idx === h.win ? Math.floor(b.bet * h.card.odds[b.idx]) : 0;
  pushHorse(room);
  for (const b of h.bets) {
    const r = await payTo(b, b.back, "賽馬");
    edel(b.ekey);
    if (b.ws.readyState === 1) out(b.ws, { t: "cbal", real: b.real, balance: r.balance, payfail: !r.ok });
    casinoFeed(b.ws, { g: "horse", bet: b.bet, back: b.back, real: b.real, idx: b.idx, name: h.card.names[b.idx], win: h.win });
  }
}
function horseTick() {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (room.game !== "horse") continue;
    if (!room.h) horseNew(room);
    const h = room.h;
    if (!room.members.size) {                                      // 沒人了：還沒開跑的注全額退回，結果階段過了就收房
      if (h.phase === "bet" && h.pending === 0) { h.phase = "closed"; refundAll(room).finally(() => rooms.delete(room.key)); continue; }
      if (h.phase === "result" && now > h.resultAt) { rooms.delete(room.key); continue; }
    }
    if (h.phase === "closed") continue;
    if (h.phase === "bet" && now >= h.closeAt) {
      if (h.pending > 0) continue;
      h.order = raceOrder(h.card.probs); h.win = h.order[0];
      const times = Array(6).fill(0); let t = 7500; h.order.forEach((i) => { times[i] = t; t += 250 + rnd(500); });
      h.times = times; h.startAt = now + 1000; h.phase = "run"; pushHorse(room);
    } else if (h.phase === "run" && now >= h.startAt + Math.max(...h.times) + 1500) horseSettle(room).catch((e) => console.log("賽馬結算錯誤", e && e.message));
    else if (h.phase === "result" && now >= h.resultAt) { horseNew(room); pushHorse(room); }
  }
}
setInterval(horseTick, 500).unref();
setInterval(() => { for (const room of rooms.values()) if (room.game === "horse" && room.h && room.h.phase === "bet" && room.members.size) pushHorse(room); }, 5000).unref();

// 旁觀大廳：有人（非旁觀者）在玩的房間
export function listRooms() {
  const out = [...listPokerTables()];
  for (const room of rooms.values()) {
    const players = whoList(room);
    if (!players.length) continue;
    const h = room.h;
    out.push({ game: room.game, id: room.id, players: players.map((p) => ({ name: p.name, real: p.real, playing: !!p.hand })),
               watchers: [...room.members].filter((w) => w.cspec).length,
               horse: room.game === "horse" && h ? { phase: h.phase, no: h.no, bets: h.bets.length, closeAt: h.closeAt, now: Date.now() } : undefined });
  }
  return out.sort((a, b) => b.players.length - a.players.length);
}

// 重新整理／斷線重連後，用 Discord 身分認回這一場自己已下的注
export function casinoReclaim(ws) {
  const room = ws.cr, h = room && room.game === "horse" ? room.h : null;
  if (!h || !ws.user) return;
  let changed = false;
  for (const b of h.bets) if (b.real && b.uid === ws.user.uid && b.ws !== ws) { b.ws = ws; changed = true; }
  if (changed) { ws.creal = true; pushHorse(room); pushWho(room); }
}

const fail = (ws, r, extra = {}) => out(ws, { t: "cerr", error: r.error || "error", balance: r.balance, ...extra });

export async function handleCasino(ws, m) {
  if (m.t === "clist") { out(ws, { t: "clist", rooms: listRooms() }); return true; }
  if (m.t === "cjoin") {
    const game = CASINO_GAMES.includes(m.game) ? m.game : "coin";
    leave(ws);
    const room = roomOf(game, String(m.room || "default").slice(0, 80));
    ws.cid ||= randomBytes(3).toString("hex");
    ws.cspec = !!m.spectate;
    ws.cr = room; room.members.add(ws); ws.cprac = ws.cprac ?? PRACTICE_START;
    if (game === "horse" && !room.h) horseNew(room);
    out(ws, { t: "cinit", balance: ws.cprac, you: ws.cid });
    pushWho(room);
    if (game === "horse") { out(ws, horseView(room)); casinoReclaim(ws); }
    return true;
  }
  if (m.t === "creset") { if (!ws.bj) ws.cprac = PRACTICE_START; out(ws, { t: "cinit", balance: ws.cprac, you: ws.cid }); return true; }
  if (!["cplay", "cbj", "chorse"].includes(m.t)) return false;
  if (ws.cspec) return true;                       // 旁觀者不能玩
  if (ws.cbusy) return true;
  ws.cbusy = true;
  try {
    const real = !!m.real, bet = Number(m.bet);
    const betOk = Number.isInteger(bet) && bet >= 1 && bet <= (real ? betLimit() : MAX_PRACTICE);
    if (m.t === "cplay") {
      if (!betOk) return true;
      if (m.g === "coin") {
        const pick = m.pick === "tails" ? "tails" : "heads", res = rnd(2) ? "heads" : "tails";
        const back = res === pick ? bet * 2 : 0;
        const r = await settleOnce(ws, real, bet, back, "擲硬幣");
        if (!r.ok) fail(ws, r);
        else { const o = { real, bet, pick, res, back }; out(ws, { t: "cres", g: "coin", ...o, balance: r.balance }); casinoFeed(ws, { g: "coin", ...o }); }
      } else if (m.g === "dice") {
        const me = [1 + rnd(6), 1 + rnd(6)], bot = [1 + rnd(6), 1 + rnd(6)];
        const a = me[0] + me[1], b = bot[0] + bot[1];
        const back = a > b ? bet * 2 : a === b ? bet : 0;
        const r = await settleOnce(ws, real, bet, back, "骰子");
        if (!r.ok) fail(ws, r);
        else { const o = { real, bet, me, bot, back }; out(ws, { t: "cres", g: "dice", ...o, balance: r.balance }); casinoFeed(ws, { g: "dice", ...o }); }
      }
    } else if (m.t === "cbj") {
      if (m.a === "deal") {
        if (ws.bj || !betOk) return true;
        const r = await stake(ws, real, bet, "21點");
        if (!r.ok) { fail(ws, r); return true; }
        const ekey = "bj:" + randomBytes(5).toString("hex");
        if (real) eadd(ekey, { uid: ws.user.uid, name: ws.user.name, amount: bet });
        const deck = []; for (const rk of RANKS) for (const s of SUITS) deck.push([rk, s]);
        shuffle(deck);
        const bj = { real, bet, deck, ekey, ref: betRef(ws, real, bet), player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], natural: false };
        ws.bj = bj; ws.creal = real;
        if (handValue(bj.player) === 21) { bj.natural = true; await finishBj(ws, bj, "21點"); }
        else {
          const view = { real, bet, player: bj.player.map(cardTxt), pv: handValue(bj.player), dealerUp: cardTxt(bj.dealer[0]) };
          out(ws, { t: "cres", g: "bj", done: false, ...view, balance: r.balance }); setHand(ws, { g: "bj", ...view });
        }
      } else if (ws.bj && m.a === "hit") {
        const bj = ws.bj; bj.player.push(bj.deck.pop());
        const v = handValue(bj.player);
        if (v >= 21) await finishBj(ws, bj, "21點");
        else {
          const view = { real: bj.real, bet: bj.bet, player: bj.player.map(cardTxt), pv: v, dealerUp: cardTxt(bj.dealer[0]) };
          out(ws, { t: "cres", g: "bj", done: false, ...view }); setHand(ws, { g: "bj", ...view });
        }
      } else if (ws.bj && m.a === "stand") await finishBj(ws, ws.bj, "21點");
    } else if (m.t === "chorse" && m.a === "bet") {
      const room = ws.cr, h = room && room.game === "horse" ? room.h : null, idx = Number(m.idx);
      if (!h || h.phase !== "bet" || Date.now() >= h.closeAt) return fail(ws, { error: "closed" }), true;
      if (m.id !== h.id || !betOk || !Number.isInteger(idx) || idx < 0 || idx > 5) return true;
      if (h.bets.some((b) => b.ws === ws || (real && b.real && b.uid && b.uid === ws.user?.uid)) || ws.hpend === h.id) return fail(ws, { error: "already" }), true;
      ws.hpend = h.id; h.pending++;
      const r = await stake(ws, real, bet, "賽馬");
      h.pending--;
      if (!r.ok) { ws.hpend = null; fail(ws, r); return true; }
      const ref = { ...betRef(ws, real, bet), idx, ekey: "h:" + randomBytes(5).toString("hex") };
      if (h.phase !== "bet") { await payTo(ref, bet, "賽馬截止退款"); fail(ws, { error: "closed", balance: r.balance }); return true; }
      if (real) eadd(ref.ekey, { uid: ref.uid, name: ref.name, amount: bet });
      ws.creal = real; h.bets.push(ref);
      out(ws, { t: "cbal", real, balance: r.balance });
      pushHorse(room); pushWho(room);
    }
  } catch (e) { console.log("casino 錯誤", e && e.message); }
  finally { ws.cbusy = false; }
  return true;
}
