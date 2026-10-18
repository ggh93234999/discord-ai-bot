// 橋牌（台灣常玩的簡易版，練習點數）：四人兩隊（0、2 一隊，1、3 一隊），順時針輪流。
// 叫牌決定王牌和墩數（1～7，♣<♦<♥<♠<無王），連續三家 pass 叫牌結束；四家都 pass 重新發牌。
// 最後叫的人是莊家，莊家方要吃到 6＋叫的線位 墩，防守方要吃到 8－線位 墩，先達成的一方贏這手。
// 沒有夢家，四個人都自己出牌；由莊家的下家先出。必須跟花色，沒有才可以王吃或墊牌。
// 伺服器負責發牌、判定、計分與電腦；前端只畫畫面和送操作。
import { randomInt, randomBytes } from "node:crypto";

const START_POINTS = 10000;
const DEFAULT_CFG = { len: 8, base: 100 };
const LENS = [4, 8, 16];
const STAKES = [50, 100, 200, 500, 1000];
const TURN_MS = 25000, TRICK_MS = 1300, RESULT_MS = 12000, BOT_MS = [650, 1200];
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "橋神", "胖虎"];
export const SUIT_SYM = ["♣", "♦", "♥", "♠", "無王"];

const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.brname || ws.user?.name || "玩家";
const tables = new Map();

// 牌 0..51：花色 = floor(c / 13)（0♣ 1♦ 2♥ 3♠），點數 = c % 13 + 2（A = 14）
const suitOf = (c) => Math.floor(c / 13);
const rankOf = (c) => (c % 13) + 2;
const teamOf = (i) => i % 2;
const RN = { 11: "J", 12: "Q", 13: "K", 14: "A" };
export const cardName = (c) => SUIT_SYM[suitOf(c)] + (RN[rankOf(c)] || rankOf(c));
export const bidName = (b) => (b ? `${b.l}${SUIT_SYM[b.s]}` : "Pass");
const higher = (a, b) => !b || a.l > b.l || (a.l === b.l && a.s > b.s);
const sortHand = (h) => h.sort((a, b) => [3, 2, 0, 1].indexOf(suitOf(a)) - [3, 2, 0, 1].indexOf(suitOf(b)) || rankOf(b) - rankOf(a));   // ♠♥♣♦ 紅黑交錯，大的在前

function newTable(id) {
  return { id, members: new Set(), seats: [null, null, null, null], started: false, phase: "wait", cfg: { ...DEFAULT_CFG }, g: null, h: null, log: "等玩家入座…", result: null, final: null, nextAt: 0, botHist: new Set() };
}
function getTable(id) { if (!tables.has(id)) tables.set(id, newTable(id)); return tables.get(id); }
function pickBotName(t) {
  const used = new Set(t.seats.filter(Boolean).map((s) => s.name));
  let pool = BOT_NAMES.filter((n) => !used.has("🤖" + n) && !t.botHist.has(n));
  if (!pool.length) { t.botHist.clear(); pool = BOT_NAMES.filter((n) => !used.has("🤖" + n)); }
  const n = pool[randomInt(pool.length)] || "電腦"; t.botHist.add(n); return "🤖" + n;
}
const mkSeat = (o) => ({ ws: null, pid: null, bot: false, name: "", points: 0, ...o });
const isAuto = (s) => s.bot || !s.ws;
const now = () => Date.now();

// ---------------------------------------------------------------- 開局、發牌
function startGame(t) {
  for (let i = 0; i < 4; i++) if (!t.seats[i]) t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) });
  for (const s of t.seats) s.points = START_POINTS;
  t.g = { first: randomInt(4), handNo: 0, redeals: 0 };
  t.started = true; t.final = null;
  startHand(t);
}
function deal() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return [0, 1, 2, 3].map((k) => sortHand(d.slice(k * 13, k * 13 + 13)));
}
function startHand(t, redeal = false) {
  const g = t.g;
  if (!redeal) { g.handNo++; g.redeals = 0; }
  const h = { first: g.first, hands: deal(), stage: "bid", turn: g.first, bids: [], high: null, passes: 0,
    contract: null, trump: -1, need: [0, 0], tricks: [0, 0], trick: [], lastTrick: null, played: new Set(), won: [0, 0, 0, 0], deadline: 0, botAt: 0, nextAt: 0 };
  t.h = h; t.result = null; t.phase = "play";
  t.log = `第 ${g.handNo} 手${redeal ? "（重新發牌）" : ""}，由 ${t.seats[g.first].name} 先叫牌`;
  setTurn(t, g.first);
}
function setTurn(t, i) {
  const h = t.h; h.turn = i; h.deadline = now() + TURN_MS;
  h.botAt = now() + BOT_MS[0] + randomInt(BOT_MS[1] - BOT_MS[0]);
}

// ---------------------------------------------------------------- 叫牌
function doBid(t, i, bid) {
  const h = t.h;
  if (h.stage !== "bid" || h.turn !== i) return false;
  if (bid) {
    const l = Number(bid.l), s = Number(bid.s);
    if (!(l >= 1 && l <= 7 && s >= 0 && s <= 4)) return false;
    bid = { l, s };
    if (!higher(bid, h.high)) return false;
    h.high = { ...bid, seat: i }; h.passes = 0;
  } else h.passes++;
  h.bids.push({ seat: i, bid });
  t.log = `${t.seats[i].name} 叫 ${bidName(bid)}`;
  if (!h.high && h.passes >= 4) {                            // 四家都 pass：換下一家先叫，重新發牌
    t.g.first = (t.g.first + 1) % 4; t.g.redeals++;
    startHand(t, true); t.log = "四家都 pass，重新發牌｜" + t.log; return true;
  }
  if (h.high && h.passes >= 3) { startPlay(t); return true; }
  setTurn(t, (i + 1) % 4);
  return true;
}
// 點數太少（A4 K3 Q2 J1 加起來 4 點以下）可以要求重洗：叫牌結束前誰都可以喊，整副重發、同一個人先叫
export const REDEAL_MAX = 4;
const hcpOf = (hand) => hand.reduce((s, c) => s + (HCP[rankOf(c)] || 0), 0);
function doRedeal(t, i) {
  const h = t.h;
  if (h.stage !== "bid") return false;
  const p = hcpOf(h.hands[i]);
  if (p > REDEAL_MAX) return false;
  t.g.redeals++;
  startHand(t, true);
  t.log = `${t.seats[i].name} 只有 ${p} 點，要求重洗｜` + t.log;
  return true;
}
function startPlay(t) {
  const h = t.h, c = h.high, dt = teamOf(c.seat);
  h.contract = c; h.trump = c.s === 4 ? -1 : c.s; h.stage = "play";
  h.need[dt] = 6 + c.l; h.need[1 - dt] = 8 - c.l;
  const lead = (c.seat + 1) % 4;
  t.log = `合約 ${bidName(c)}（${t.seats[c.seat].name}），莊家方要 ${h.need[dt]} 墩、防守方要 ${h.need[1 - dt]} 墩。${t.seats[lead].name} 先出`;
  setTurn(t, lead);
}

// ---------------------------------------------------------------- 出牌
function legalCards(t, i) {
  const h = t.h, hand = h.hands[i];
  if (!h.trick.length) return hand.slice();
  const led = suitOf(h.trick[0].c), follow = hand.filter((c) => suitOf(c) === led);
  return follow.length ? follow : hand.slice();
}
const beats = (a, b, led, trump) => (suitOf(a) === suitOf(b) ? rankOf(a) > rankOf(b) : suitOf(a) === trump);
function trickWinner(trick, trump) {
  const led = suitOf(trick[0].c); let w = trick[0];
  for (const x of trick.slice(1)) if (beats(x.c, w.c, led, trump)) w = x;
  return w;
}
function doPlay(t, i, c) {
  const h = t.h;
  if (h.stage !== "play" || h.turn !== i) return false;
  c = Number(c);
  if (!legalCards(t, i).includes(c)) return false;
  h.hands[i].splice(h.hands[i].indexOf(c), 1);
  h.trick.push({ seat: i, c }); h.played.add(c);
  if (h.trick.length < 4) { setTurn(t, (i + 1) % 4); return true; }
  const w = trickWinner(h.trick, h.trump);
  h.tricks[teamOf(w.seat)]++; h.won[w.seat]++;
  h.stage = "trick"; h.winner = w.seat; h.nextAt = now() + TRICK_MS; h.deadline = 0;
  t.log = `${t.seats[w.seat].name} 用 ${cardName(w.c)} 吃下這一墩`;
  return true;
}
function endTrick(t) {
  const h = t.h;
  h.lastTrick = { cards: h.trick, winner: h.winner }; h.trick = [];
  const dt = teamOf(h.contract.seat);
  if (h.tricks[dt] >= h.need[dt] || h.tricks[1 - dt] >= h.need[1 - dt] || !h.hands[0].length) return settle(t);
  h.stage = "play"; setTurn(t, h.winner);
}
function settle(t) {
  const h = t.h, c = h.contract, dt = teamOf(c.seat);
  const made = h.tricks[dt] >= h.need[dt];
  const amt = t.cfg.base * c.l, winTeam = made ? dt : 1 - dt;
  const deltas = [0, 1, 2, 3].map((i) => (teamOf(i) === winTeam ? amt : -amt));
  deltas.forEach((d, i) => { t.seats[i].points += d; });
  const gameOver = t.g.handNo >= t.cfg.len;
  t.result = { handNo: t.g.handNo, contract: c, made, tricks: h.tricks.slice(), need: h.need.slice(), winTeam, deltas, gameOver, hands: h.hands.map((x) => x.slice()) };
  t.log = `${made ? "成約" : "倒約"}！${bidName(c)} ${made ? "做成" : "沒做成"}，莊家方 ${h.tricks[dt]} 墩、防守方 ${h.tricks[1 - dt]} 墩`;
  t.phase = "result"; t.nextAt = now() + RESULT_MS;
  t.g.first = (t.g.first + 1) % 4;
}
function finishGame(t) {
  t.final = t.seats.map((s, i) => ({ name: s.name, points: s.points, team: teamOf(i) })).sort((a, b) => b.points - a.points);
  t.phase = "end"; t.started = false; t.h = null; t.result = null;
  t.log = "牌局結束";
  for (let i = 0; i < 4; i++) if (t.seats[i] && (t.seats[i].bot || !t.seats[i].ws)) { if (!t.seats[i].bot) t.seats[i] = null; }
}

// ---------------------------------------------------------------- 電腦：叫牌
const HCP = { 14: 4, 13: 3, 12: 2, 11: 1 };
function handInfo(hand) {
  const len = [0, 0, 0, 0]; let hcp = 0;
  for (const c of hand) { len[suitOf(c)]++; hcp += HCP[rankOf(c)] || 0; }
  const pts = hcp + len.reduce((s, n) => s + Math.max(0, n - 4), 0);
  const balanced = len.every((n) => n >= 2) && len.filter((n) => n === 2).length <= 1 && Math.max(...len) <= 5;
  return { len, hcp, pts, balanced };
}
function botBid(t, i) {
  const h = t.h, me = handInfo(h.hands[i]), p = (i + 2) % 4;
  const pBids = h.bids.filter((b) => b.seat === p), pLast = [...pBids].reverse().find((b) => b.bid);
  const pPts = pLast ? 12 + 2 * (pLast.bid.l - 1) : pBids.length ? 8 : 10;     // 從同伴叫過什麼猜他的牌力
  // 選王：同伴叫過的花色我有 3 張以上就支持；不然叫自己最長的花色；牌型平均又夠強就叫無王
  let strain, fit = false;
  if (pLast && pLast.bid.s < 4 && me.len[pLast.bid.s] >= 3) { strain = pLast.bid.s; fit = true; }
  else if (pLast && pLast.bid.s === 4 && me.balanced) { strain = 4; fit = true; }
  else if (me.balanced && me.hcp >= 15) strain = 4;
  else { strain = 3; for (let s = 3; s >= 0; s--) if (me.len[s] > me.len[strain]) strain = s; }
  const tricks = (me.pts + pPts) / 2.85 + (fit ? 1 : 0) + (strain < 4 && me.len[strain] >= 6 ? 0.5 : 0);
  const maxLevel = Math.min(7, Math.floor(tricks) - 6);
  if (h.high && teamOf(h.high.seat) === teamOf(i)) {          // 同伴現在拿著合約：沒有明顯更好就 pass
    if (h.high.s === strain || maxLevel < h.high.l + 1 || !(strain < 4 && me.len[strain] >= 6)) return null;
  }
  const lv = !h.high ? 1 : h.high.l + (strain > h.high.s ? 0 : 1);
  return lv <= maxLevel && lv <= 7 ? { l: lv, s: strain } : null;
}

// ---------------------------------------------------------------- 電腦：出牌
function botCard(t, i) {
  const h = t.h, hand = h.hands[i], legal = legalCards(t, i), trump = h.trump;
  const low = (arr) => arr.reduce((a, b) => (rankOf(b) < rankOf(a) ? b : a));
  const high = (arr) => arr.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
  // 「大牌」：同花色比它大的牌都已經打出去或在自己手上
  const master = (c) => { for (let r = rankOf(c) + 1; r <= 14; r++) { const x = suitOf(c) * 13 + r - 2; if (!h.played.has(x) && !hand.includes(x)) return false; } return true; };
  const nonTrump = (arr) => arr.filter((c) => suitOf(c) !== trump);
  const discard = () => { const nt = nonTrump(legal); return low(nt.length ? nt : legal); };
  if (!h.trick.length) {
    const declSide = teamOf(h.contract.seat) === teamOf(i);
    if (trump >= 0 && declSide) {                             // 莊家方：手上有最大的王牌、外面還有王牌，就先清王
      const myT = hand.filter((c) => suitOf(c) === trump);
      let outside = 0; for (let r = 0; r < 13; r++) { const x = trump * 13 + r; if (!h.played.has(x) && !hand.includes(x)) outside++; }
      const mt = myT.filter(master);
      if (outside && mt.length) return high(mt);
    }
    const ms = nonTrump(legal).filter(master);
    if (ms.length) return high(ms);
    const nt = nonTrump(legal);
    if (!nt.length) return low(legal);
    const lenOf = (s) => nt.filter((c) => suitOf(c) === s).length;
    let best = suitOf(nt[0]); for (const c of nt) if (lenOf(suitOf(c)) > lenOf(best)) best = suitOf(c);
    return low(nt.filter((c) => suitOf(c) === best));
  }
  const led = suitOf(h.trick[0].c), w = trickWinner(h.trick, trump), pos = h.trick.length, last = pos === 3;
  const partnerWins = teamOf(w.seat) === teamOf(i);
  const winners = legal.filter((c) => beats(c, w.c, led, trump));
  if (suitOf(legal[0]) === led) {                            // 跟得出花色
    if (partnerWins && (last || (suitOf(w.c) === led ? master(w.c) : true))) return low(legal);
    if (!winners.length) return low(legal);
    if (last) return low(winners);
    const mw = winners.filter(master);
    if (mw.length) return low(mw);
    return pos === 1 ? low(legal) : high(winners);            // 二家低、三家高
  }
  if (partnerWins && (last || master(w.c))) return discard();   // 沒這個花色：同伴會贏就墊小牌
  const ruff = winners.filter((c) => suitOf(c) === trump);
  if (ruff.length) return low(ruff);
  return discard();
}
function botAct(t, i) {
  const h = t.h;
  if (h.stage === "bid" && t.seats[i].bot && hcpOf(h.hands[i]) <= REDEAL_MAX) return doRedeal(t, i);   // 電腦點數太少一定喊重洗
  if (h.stage === "bid") return doBid(t, i, botBid(t, i));
  if (h.stage === "play") return doPlay(t, i, botCard(t, i));
  return false;
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.seats.findIndex((s) => s && s.ws === ws && !ws.brspec);
  const h = t.h;
  const v = { t: "brstate", phase: t.phase, started: t.started, cfg: t.cfg, lens: LENS, stakes: STAKES, you, log: t.log, now: now(),
    watchers: [...t.members].filter((w) => w.brspec).length, final: t.final, handNo: t.g ? t.g.handNo : 0 };
  v.seats = t.seats.map((s, i) => s && { i, name: s.name, bot: s.bot, away: !s.bot && !s.ws, points: s.points, count: h ? h.hands[i].length : 0, won: h ? h.won[i] : 0 });
  if (h && t.phase === "play") {
    Object.assign(v, { stage: h.stage, turn: h.turn, first: h.first, bids: h.bids, high: h.high, contract: h.contract, trump: h.trump, need: h.need, tricks: h.tricks,
      trick: h.trick, lastTrick: h.lastTrick, winner: h.stage === "trick" ? h.winner : -1, deadline: h.deadline });
    if (you >= 0) {
      v.hand = h.hands[you]; v.hcp = hcpOf(h.hands[you]);
      v.canRedeal = h.stage === "bid" && v.hcp <= REDEAL_MAX;
      if (h.turn === you && h.stage === "play") v.legal = legalCards(t, you);
    }
  }
  if (t.phase === "result") { v.result = t.result; v.nextAt = t.nextAt; }
  return v;
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listBridgeTables() {
  const res = [];
  for (const t of tables.values()) {
    const seated = t.seats.filter(Boolean);
    if (!seated.some((s) => !s.bot)) continue;
    res.push({ game: "bridge", id: t.id, players: seated.filter((s) => !s.bot).map((s) => ({ name: s.name, real: false, playing: false })), watchers: [...t.members].filter((w) => w.brspec).length, bots: seated.filter((s) => s.bot).length });
  }
  return res;
}

// ---------------------------------------------------------------- 計時（電腦、超時代打、每墩停一下）
function tick() {
  const n = now();
  for (const [key, t] of [...tables.entries()]) {
    if (!t.members.size) { if (n - (t.emptyAt || (t.emptyAt = n)) > 120000) tables.delete(key); continue; }
    t.emptyAt = 0;
    const humans = t.seats.filter((s) => s && !s.bot && s.ws);
    if (!humans.length && t.phase !== "wait" && t.phase !== "end") { t.seats = [null, null, null, null]; t.phase = "wait"; t.started = false; t.h = null; t.g = null; t.result = null; t.log = "等玩家入座…"; push(t); continue; }
    try {
      if (t.phase === "result") { if (n >= t.nextAt) { if (t.result.gameOver) finishGame(t); else startHand(t); push(t); } continue; }
      if (t.phase !== "play") continue;
      const h = t.h;
      if (h.stage === "trick") { if (n >= h.nextAt) { endTrick(t); push(t); } continue; }
      const s = t.seats[h.turn];
      if ((isAuto(s) && n >= h.botAt) || n >= h.deadline) { if (botAct(t, h.turn)) push(t); }
    } catch (e) { console.log("橋牌錯誤", e && e.stack); }
  }
}
setInterval(tick, 200).unref();

// ---------------------------------------------------------------- 連線
export function bridgeClose(ws) {
  const t = ws.brtable; if (!t) return;
  t.members.delete(ws);
  const i = t.seats.findIndex((s) => s && s.ws === ws);
  if (i >= 0) { t.seats[i].ws = null; if (!t.started) t.seats[i] = null; }
  ws.brtable = null;
  push(t);
}
export function handleBridge(ws, m) {
  if (m.t === "brjoin") {
    if (ws.brtable) bridgeClose(ws);
    const t = getTable(String(m.room || "default").slice(0, 80));
    ws.brtable = t; ws.brspec = !!m.spectate; if (cleanName(m.name)) ws.brname = cleanName(m.name);
    ws.brpid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    if (!ws.brspec) { const i = t.seats.findIndex((s) => s && !s.bot && s.pid === ws.brpid); if (i >= 0) { t.seats[i].ws = ws; t.seats[i].name = nameOf(ws); } }   // 重新整理後認回座位
    push(t); return true;
  }
  const t = ws.brtable; if (!t) return false;
  if (ws.brspec) return true;
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  if (m.t === "brsit") {
    if (mine >= 0) return true;
    let i = Number(m.seat);
    if (!Number.isInteger(i) || i < 0 || i > 3) i = t.seats.findIndex((s) => !s);
    if (i >= 0 && t.seats[i] && !(t.seats[i].bot && t.started)) i = t.seats.findIndex((x) => !x);
    if (i < 0) return out(ws, { t: "brerr", error: "full" }), true;
    if (t.seats[i] && t.seats[i].bot) { const old = t.seats[i]; t.seats[i] = mkSeat({ ws, pid: ws.brpid, name: nameOf(ws), points: old.points }); t.log = `${nameOf(ws)} 接手 ${old.name} 的位置`; }
    else { t.seats[i] = mkSeat({ ws, pid: ws.brpid, name: nameOf(ws) }); t.log = `${nameOf(ws)} 入座`; }
    push(t);
  } else if (m.t === "brstand") {
    if (mine < 0) return true;
    const s = t.seats[mine];
    if (t.started) { t.seats[mine] = mkSeat({ bot: true, name: pickBotName(t), points: s.points }); t.log = `${s.name} 離座，由 ${t.seats[mine].name} 接手`; }
    else t.seats[mine] = null;
    push(t);
  } else if (m.t === "braddbot") {
    if (mine < 0 || t.started) return true;
    const k = Number(m.seat);
    const i = Number.isInteger(k) && k >= 0 && k <= 3 && !t.seats[k] ? k : t.seats.findIndex((s) => !s);
    if (i < 0) return true;
    t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) }); push(t);
  } else if (m.t === "brdelbot") {
    const s = t.seats[Number(m.seat)];
    if (mine < 0 || !s || !s.bot || t.started) return true;
    t.seats[Number(m.seat)] = null; push(t);
  } else if (m.t === "brname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.brname = nm; if (mine >= 0) t.seats[mine].name = nm; push(t);
  } else if (m.t === "brcfg") {
    if (mine < 0 || t.started) return true;
    if (LENS.includes(Number(m.len))) t.cfg.len = Number(m.len);
    if (STAKES.includes(Number(m.base))) t.cfg.base = Number(m.base);
    t.log = `${nameOf(ws)} 調整設定`; push(t);
  } else if (m.t === "brstart") {
    if (mine < 0 || t.started) return true;
    startGame(t); t.log = `${nameOf(ws)} 按下開始｜` + t.log; push(t);
  } else if (m.t === "bract") {
    if (mine < 0 || t.phase !== "play") return true;
    const a = String(m.a || "");
    let ok = false;
    if (a === "bid") ok = doBid(t, mine, { l: m.l, s: m.s });
    else if (a === "pass") ok = doBid(t, mine, null);
    else if (a === "play") ok = doPlay(t, mine, m.c);
    else if (a === "redeal") ok = doRedeal(t, mine);
    if (ok) push(t);
  }
  return true;
}

// 測試用：4 個電腦直接打完一整場（不經過計時器）
export function _simGame(cfg) {
  const t = newTable("sim"); if (cfg) Object.assign(t.cfg, cfg);
  startGame(t);
  const results = [];
  for (let guard = 0; guard < 100000; guard++) {
    if (t.phase === "end") break;
    if (t.phase === "result") { results.push(t.result); if (t.result.gameOver) finishGame(t); else startHand(t); continue; }
    const h = t.h;
    if (h.stage === "trick") { endTrick(t); continue; }
    if (!botAct(t, h.turn)) throw new Error("bot stuck " + h.stage);
  }
  return { results, final: t.final, redeals: t.g.redeals };
}
