// 賭場（擲硬幣、骰子、21 點、賽馬，加上老虎機的旁觀動態）。結果全部由伺服器決定，前端只負責演出。
// 每個 Activity instance 的每種遊戲是一個「房間」：同房的人看得到彼此的名單與最新一把（旁觀），賽馬是全房一起押的回合制。
// 練習模式：每條連線一份練習幣；賭注模式：用 bauth 綁定的 Discord 身分，動用機器人錢包的真代幣。
// 真代幣押注中（21 點一手、賽馬一回合）會記在 casino_escrow.json，伺服器若在途中重啟，啟動時全額退回。
import { listPokerTables } from "./poker.js";
import fs from "node:fs";
import { randomInt, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { botSettle, botPay, betLimit } from "./bet.js";
import { FORGE_MAX, V as FV, C as FC, P as FP, REAL_SELL_MAX, FORGE_PRACTICE_START, FORGE_SLOTS, getSword, setSword, noteBest, forgeSave, forgeView } from "./forge.js";

const MAX_PRACTICE = 1_000_000;
export const CASINO_GAMES = ["slots", "coin", "dice", "bj", "horse", "forge"];
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
// ---- 賭博紀錄：每把結束記一筆。賭注模式（真代幣）依 Discord 身分存檔，換裝置也看得到；練習模式只回傳給當事人，由前端存在自己的瀏覽器
const LFILE = fileURLToPath(new URL("./casino_log.json", import.meta.url));
let blog = {};
try { blog = JSON.parse(fs.readFileSync(LFILE, "utf8")); } catch {}
let lsaveT = 0;
const lsave = () => { clearTimeout(lsaveT); lsaveT = setTimeout(() => { try { fs.writeFileSync(LFILE, JSON.stringify(blog)); } catch (e) { console.log("賭博紀錄寫入失敗", e.message); } }, 1500); };
function logLabel(e) {
  if (e.g === "coin") return `猜${e.pick === "heads" ? "正面" : "反面"}，開${e.res === "heads" ? "正面" : "反面"}`;
  if (e.g === "dice") return `你 ${e.me}　莊家 ${e.bot}`;
  if (e.g === "bj") return `${e.pv} 比 ${e.dv}　${String(e.text || "").replace(/^[^\u4e00-\u9fa5A-Za-z]+/, "")}`;
  if (e.g === "horse") return `${(e.idx ?? 0) + 1}號 ${e.name || ""}${e.win === e.idx ? "（冠軍）" : ""}`;
  if (e.g === "forge") return e.text || "";
  if (e.g === "slots") return `${{ 1: "3 格", 3: "3×3", 4: "4×4" }[e.kind] || ""}${e.nwin ? `　中 ${e.nwin} 線` : ""}`;
  return "";
}
function recordBet(ws, e) {
  if (!Number.isFinite(e.bet) || !Number.isFinite(e.back)) return;
  const entry = { ts: Date.now(), g: e.g, real: !!e.real, bet: e.bet, back: e.back, label: logLabel(e) };
  const uid = ws.user && ws.user.uid;
  if (entry.real && uid) {
    const u = (blog[uid] ||= { n: 0, bet: 0, back: 0, wins: 0, list: [] });
    u.n++; u.bet += e.bet; u.back += e.back; if (e.back > e.bet) u.wins++;
    u.list.push(entry); if (u.list.length > 300) u.list.shift();
    lsave();
  }
  out(ws, { t: "clog", e: entry });
}
function sendLog(ws) {
  const u = ws.user && blog[ws.user.uid];
  out(ws, { t: "clog", all: true, stats: u ? { n: u.n, bet: u.bet, back: u.back, wins: u.wins } : { n: 0, bet: 0, back: 0, wins: 0 }, list: u ? u.list.slice(-60) : [] });
}
export function casinoFeed(ws, entry) {       // 任何遊戲結束一把就呼叫，讓同房的人看到
  recordBet(ws, entry);
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
const HORSE_POOL = ["赤兔", "烏騅", "的盧", "絕影", "爪黃飛電", "踏雪", "照夜玉獅子", "追風", "驊騮", "飛黃"];
const FORMS = [["🔥 絕佳", 7], ["😀 良好", 3], ["😐 普通", 0], ["😓 欠佳", -4], ["🤕 低迷", -8]];
const FORM_W = [10, 30, 35, 18, 7];
function pickWeighted(w) { let r = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1; }
// ---- 馬匹的固定能力值與戰績：第一次出場前定下，之後不變；戰績每場累計並存檔（伺服器重啟不歸零）。
// 能力值第一次會沿用機器人 /賽馬 的 horses.json（同一匹馬同樣的強弱），戰績則是活動這邊自己的。
const HFILE = fileURLToPath(new URL("./horses.json", import.meta.url));
const horses = (() => {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(HFILE, "utf8")); } catch {
    try { const bot = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../horses.json", import.meta.url)), "utf8")); for (const n of HORSE_POOL) if (bot[n]) d[n] = { spd: bot[n].spd, sta: bot[n].sta, bst: bot[n].bst }; } catch {}
  }
  for (const n of HORSE_POOL) d[n] = { spd: 55 + rnd(41), sta: 55 + rnd(41), bst: 55 + rnd(41), races: 0, wins: 0, top3: 0, last: [], ...(d[n] || {}) };
  try { fs.writeFileSync(HFILE, JSON.stringify(d, null, 1)); } catch {}
  return d;
})();
// 每匹馬的固定特色：跑法（只影響比賽演出的節奏，不改變勝率）、毛色、個性介紹
const TRAITS = {
  "赤兔": { style: "先行", coat: "#b5462d", mane: "#2a1a10", blurb: "人中呂布、馬中赤兔。起跑俐落，一路緊咬前段，不太容易被追過。" },
  "烏騅": { style: "逃馬", coat: "#1c1c20", mane: "#08080a", blurb: "脾氣烈的黑馬，一開閘就衝到最前面，但後段容易喘。" },
  "的盧": { style: "穩定", coat: "#6b4a2e", mane: "#1f130b", blurb: "傳說會躍過檀溪的名駒。全程速度平均，越到後面越穩。" },
  "絕影": { style: "追込", coat: "#8d9094", mane: "#4a4d52", blurb: "像影子一樣安靜，前半段落在後面，最後直線暴衝追上來。" },
  "爪黃飛電": { style: "逃馬", coat: "#c8a24b", mane: "#f2e3a6", blurb: "金黃毛色、腳程飛快，開局搶位最兇，後半看體力。" },
  "踏雪": { style: "穩定", coat: "#f2f2f0", mane: "#cfd3d6", blurb: "四蹄踏雪的優雅白馬，步伐平穩，很少出大失誤。" },
  "照夜玉獅子": { style: "先行", coat: "#fbfbfb", mane: "#d9dde0", blurb: "通體雪白的名駒，一出閘就搶前排，氣勢最盛。" },
  "追風": { style: "追込", coat: "#a9754b", mane: "#3a2415", blurb: "名字就是追風：慢熱型，後半程一路追趕前面的馬。" },
  "驊騮": { style: "爆發", coat: "#5a3a22", mane: "#1a0f08", blurb: "周穆王八駿之一。前面不急，最後 200 公尺會突然加速。" },
  "飛黃": { style: "爆發", coat: "#e3b23c", mane: "#fff0b8", blurb: "神話裡的瑞獸之馬，衝刺力一流，最後直線最可怕。" },
};
function recordRace(names, order) {
  order.forEach((idx, k) => { const h = horses[names[idx]]; h.races++; if (k === 0) h.wins++; if (k < 3) h.top3++; h.last = [...h.last, k + 1].slice(-5); });
  try { fs.writeFileSync(HFILE, JSON.stringify(horses, null, 1)); } catch (e) { console.log("馬匹戰績寫入失敗", e.message); }
}
function newRaceCard() {
  const names = shuffle([...HORSE_POOL]).slice(0, 6);
  const forms = names.map(() => FORMS[pickWeighted(FORM_W)]);
  const str = names.map((n, i) => 0.4 * horses[n].spd + 0.3 * horses[n].sta + 0.3 * horses[n].bst + forms[i][1]);
  const m = Math.max(...str), ex = str.map((x) => Math.exp((x - m) / 14)), tot = ex.reduce((a, b) => a + b, 0);
  const probs = ex.map((x) => x / tot);
  return { names, forms: forms.map((f) => f[0]), probs, odds: probs.map((p) => Math.max(1.1, Math.round(0.95 / p * 10) / 10)) };
}
// 模擬 n 場賽馬並計入戰績（拿來建立基本資料；跑法和真的比賽一樣：每場抽 6 匹、依勝率抽名次）
export function simulateRaces(n) {
  for (let k = 0; k < n; k++) { const c = newRaceCard(); recordRace(c.names, raceOrder(c.probs)); }
  return horses;
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
  return { t: "hstate", phase: h.phase, id: h.id, no: h.no, names: c.names, forms: c.forms, odds: c.odds,
    info: c.names.map((n) => { const x = horses[n]; return { spd: x.spd, sta: x.sta, bst: x.bst, races: x.races, wins: x.wins, last: x.last, ...(TRAITS[n] || {}) }; }), now: Date.now(), closeAt: h.closeAt,
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
  recordRace(h.card.names, h.order);
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
  if (m.t === "clogq") { sendLog(ws); return true; }
  if (m.t === "clist") { out(ws, { t: "clist", rooms: listRooms() }); return true; }
  if (m.t === "cjoin") {
    const game = CASINO_GAMES.includes(m.game) ? m.game : "coin";
    leave(ws);
    const room = roomOf(game, String(m.room || "default").slice(0, 80));
    ws.cid ||= randomBytes(3).toString("hex");
    ws.cspec = !!m.spectate;
    ws.cr = room; room.members.add(ws); ws.cprac = ws.cprac ?? (game === "forge" ? FORGE_PRACTICE_START : PRACTICE_START);
    if (game === "horse" && !room.h) horseNew(room);
    out(ws, { t: "cinit", balance: ws.cprac, you: ws.cid });
    pushWho(room);
    if (game === "horse") { out(ws, horseView(room)); casinoReclaim(ws); }
    return true;
  }
  if (m.t === "creset") { if (!ws.bj) ws.cprac = ws.cr && ws.cr.game === "forge" ? FORGE_PRACTICE_START : PRACTICE_START; out(ws, { t: "cinit", balance: ws.cprac, you: ws.cid }); return true; }
  if (m.t === "fget" || m.t === "fforge" || m.t === "fsell") return handleForge(ws, m);
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

// 真代幣一次要扣的錢超過單筆上限時，分成幾筆扣；中途失敗就把已經扣掉的退回
async function stakeBig(ws, real, cost, why) {
  if (!real) return stake(ws, real, cost, why);
  const lim = Math.max(1, betLimit()); let left = cost, paid = 0, r = { ok: true };
  while (left > 0) {
    const part = Math.min(left, lim);
    r = await stake(ws, real, part, why);
    if (!r.ok) { if (paid > 0) { try { await botPay(ws.user.uid, ws.user.name, paid, "鍛造扣款失敗退回"); } catch {} } return r; }
    paid += part; left -= part;
  }
  return r;
}
// ---- 鍛造：每個身分一把劍（存在 forge.json）。練習幣用連線的練習幣，真代幣用機器人錢包。
async function handleForge(ws, m) {
  const real = !!m.real;
  let id;
  if (real) { if (!ws.user) { out(ws, { t: "cerr", error: "need_login" }); return true; } id = ws.user.uid; }
  else id = ws.user ? ws.user.uid : "g" + (String(m.pid || "").replace(/[^\w-]/g, "").slice(0, 40) || ws.cid || "x");
  const key = (real ? "r:" : "p:") + id;
  const bal = () => (real ? undefined : ws.cprac ?? FORGE_PRACTICE_START);
  const slot = Number.isInteger(m.slot) && m.slot >= 0 && m.slot < FORGE_SLOTS ? m.slot : 0;
  if (m.t === "fget") { out(ws, { ...forgeView(key, real, slot), balance: bal() }); return true; }
  if (ws.cspec || ws.fbusy) return true;
  ws.fbusy = true;
  try {
    const s = getSword(key, slot), tier = s ? s.tier : 0;
    const sellOf = (t) => (real ? Math.min(FV[t], REAL_SELL_MAX) : FV[t]);
    if (m.t === "fforge") {
      if (tier >= FORGE_MAX) return true;
      const cost = FC[tier], p = FP[tier];
      const r = await stakeBig(ws, real, cost, "鍛造");        // 真代幣超過單筆上限就分成幾筆扣
      if (!r.ok) { fail(ws, r); return true; }
      const ekey = "f:" + randomBytes(5).toString("hex");
      if (real) eadd(ekey, { uid: ws.user.uid, name: ws.user.name, amount: cost });   // 伺服器在中途重啟會把這筆費用退回
      const ok = rnd(10000) < Math.round(p * 10000);
      const lost = ok ? 0 : sellOf(tier);
      if (ok) { setSword(key, slot, { tier: tier + 1, spent: (s ? s.spent : 0) + cost, forged: (s ? s.forged : 0) + 1 }); noteBest(key, tier + 1); }
      else setSword(key, slot, null);
      forgeSave(true);
      if (real) edel(ekey);
      casinoFeed(ws, { g: "forge", real, bet: cost, back: 0, text: ok ? `升到 ${tier + 1} 階` : `第 ${tier + 1} 階失敗，${tier ? `${tier} 階的劍碎了` : "原料報銷"}` });
      out(ws, { ...forgeView(key, real, slot), t: "fres", ok, prev: tier, paid: cost, lost, balance: r.balance });
    } else if (m.t === "fsell") {
      if (!s) return true;
      const amt = sellOf(tier);
      if (real) {
        const ekey = "f:" + randomBytes(5).toString("hex");
        eadd(ekey, { uid: ws.user.uid, name: ws.user.name, amount: amt });          // 先記下，賣出中途重啟就補發
        setSword(key, slot, null); forgeSave(true);
        let r; try { r = await botPay(ws.user.uid, ws.user.name, amt, "鍛造賣劍"); } catch { r = { ok: false }; }
        if (!r || !r.ok) { setSword(key, slot, s); forgeSave(true); edel(ekey); out(ws, { t: "cerr", error: "bot_down" }); return true; }
        edel(ekey);
        casinoFeed(ws, { g: "forge", real, bet: 0, back: amt, text: `賣出 ${tier} 階劍` });
        out(ws, { ...forgeView(key, real, slot), t: "fres", sold: true, prev: tier, got: amt, balance: r.balance });
      } else {
        ws.cprac = (ws.cprac ?? FORGE_PRACTICE_START) + amt; setSword(key, slot, null); forgeSave(true);
        casinoFeed(ws, { g: "forge", real, bet: 0, back: amt, text: `賣出 ${tier} 階劍` });
        out(ws, { ...forgeView(key, real, slot), t: "fres", sold: true, prev: tier, got: amt, balance: ws.cprac });
      }
    }
  } catch (e) { console.log("鍛造錯誤", e && e.message); }
  finally { ws.fbusy = false; }
  return true;
}
