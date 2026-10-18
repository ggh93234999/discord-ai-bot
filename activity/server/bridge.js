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
    contract: null, trump: -1, need: [0, 0], tricks: [0, 0], trick: [], lastTrick: null, played: new Set(), voids: [new Set(), new Set(), new Set(), new Set()], won: [0, 0, 0, 0], deadline: 0, botAt: 0, nextAt: 0 };
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
  if (h.trick.length && suitOf(c) !== suitOf(h.trick[0].c)) h.voids[i].add(suitOf(h.trick[0].c));   // 沒跟花色＝這門沒牌了（大家都看得到）
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
// 電腦個性（跟著名字走）：bold 叫牌膽量（加在估計墩數上）、fit 支持同伴的加分、ntMin 幾點以上牌型平均就叫無王、
// major 偏好高花（♥♠）、compete 同伴拿著合約也敢改叫、noise 出牌亂出的機率（新手）
const PERSONA = {
  "阿發": { tag: "愛搶叫", bold: 1.2, fit: 1, ntMin: 15, major: false, compete: true, noise: 0 },
  "小明": { tag: "穩健", bold: 0, fit: 1, ntMin: 15, major: false, compete: false, noise: 0 },
  "老王": { tag: "老狐狸", bold: 0.2, fit: 1.2, ntMin: 16, major: false, compete: false, noise: 0 },
  "花花": { tag: "愛叫無王", bold: 0.3, fit: 1, ntMin: 11, major: false, compete: false, noise: 0 },
  "阿牛": { tag: "保守", bold: -1, fit: 0.8, ntMin: 16, major: false, compete: false, noise: 0 },
  "小美": { tag: "挺同伴", bold: 0, fit: 2, ntMin: 15, major: false, compete: false, noise: 0 },
  "豆豆": { tag: "新手", bold: 0.6, fit: 0.5, ntMin: 13, major: false, compete: true, noise: 0.25 },
  "阿嬤": { tag: "老派高花", bold: -0.3, fit: 1, ntMin: 16, major: true, compete: false, noise: 0 },
  "橋神": { tag: "高手", bold: 0, fit: 1, ntMin: 15, major: false, compete: false, noise: 0, expert: true },
  "胖虎": { tag: "莽夫", bold: 2, fit: 1, ntMin: 14, major: false, compete: true, noise: 0.05 },
};
const DEFAULT_PERSONA = { tag: "", bold: 0, fit: 1, ntMin: 15, major: false, compete: false, noise: 0 };
export const brPersona = (s) => (s && s.bot && PERSONA[String(s.name || "").replace(/^🤖/, "")]) || DEFAULT_PERSONA;
function heuristicCard(t, i) {
  const h = t.h, hand = h.hands[i], legal = legalCards(t, i), trump = h.trump, me = teamOf(i), part = (i + 2) % 4;
  const low = (arr) => arr.reduce((a, b) => (rankOf(b) < rankOf(a) ? b : a));
  const high = (arr) => arr.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
  const unseen = (s) => { const r = []; for (let k = 0; k < 13; k++) { const x = s * 13 + k; if (!h.played.has(x) && !hand.includes(x)) r.push(x); } return r; };
  const opps = [(i + 1) % 4, (i + 3) % 4];
  const mayHold = (seat, s) => !h.voids[seat].has(s) && unseen(s).length > 0;
  // 對某個還沒出牌的對手來說，我這張牌（或同伴那張）會不會被壓過
  const canBeat = (seat, c, led) => {
    if (suitOf(c) === led || suitOf(c) !== trump) {
      if (mayHold(seat, led)) return unseen(led).some((x) => rankOf(x) > rankOf(c) && suitOf(c) === led);
      return trump >= 0 && suitOf(c) !== trump && mayHold(seat, trump);       // 他缺這門，可能王吃
    }
    if (mayHold(seat, led)) return false;                                    // 他還有這門就得跟，不能王吃
    return unseen(trump).some((x) => rankOf(x) > rankOf(c)) && mayHold(seat, trump);
  };
  const after = [1, 2, 3].map((k) => (i + k) % 4).slice(0, 3 - h.trick.length);
  const sure = (c, led) => after.filter((x) => teamOf(x) !== me).every((x) => !canBeat(x, c, led));
  // 同一門裡等值的牌（中間的牌都打掉了或在自己手上）出最小的那張
  const cheapest = (c) => { let x = c; for (let r = rankOf(c) - 1; r >= 2; r--) { const y = suitOf(c) * 13 + r - 2; if (hand.includes(y)) x = y; else if (!h.played.has(y)) break; } return x; };
  const masterOf = (c) => unseen(suitOf(c)).every((x) => rankOf(x) < rankOf(c));
  const discard = () => {
    const pool = legal.filter((c) => suitOf(c) !== trump && !masterOf(c));
    const cand = pool.length ? pool : legal.filter((c) => suitOf(c) !== trump).length ? legal.filter((c) => suitOf(c) !== trump) : legal;
    const lenOf = (s) => hand.filter((c) => suitOf(c) === s).length;
    const haveTrump = trump >= 0 && hand.some((c) => suitOf(c) === trump);
    const key = (c) => rankOf(c) + lenOf(suitOf(c)) * (haveTrump ? 0.6 : 0.3);      // 小牌優先，短門優先（有王時更想做出缺門）
    return cand.reduce((a, b) => (key(b) < key(a) ? b : a));
  };
  if (!h.trick.length) {                                                      // ---- 先出
    const declSide = teamOf(h.contract.seat) === me;
    const myT = trump >= 0 ? hand.filter((c) => suitOf(c) === trump) : [];
    const oppTrumps = trump >= 0 && opps.some((x) => mayHold(x, trump));
    if (declSide && oppTrumps && myT.length) {                                // 莊家方先清王
      const mt = myT.filter(masterOf);
      if (mt.length) return mt[0];
      if (myT.length >= 4) return low(myT);
    }
    const safeSuit = (s) => s === trump || !opps.some((x) => h.voids[x].has(s) && trump >= 0 && mayHold(x, trump));
    const cash = legal.filter((c) => suitOf(c) !== trump && masterOf(c) && safeSuit(suitOf(c)));
    if (cash.length) return cash[0];
    // 同伴缺門而且可能有王、對手沒缺：出那門讓同伴王吃
    if (trump >= 0) {
      const ruffFor = legal.filter((c) => suitOf(c) !== trump && h.voids[part].has(suitOf(c)) && mayHold(part, trump) && opps.every((x) => !h.voids[x].has(suitOf(c))));
      if (ruffFor.length) return low(ruffFor);
    }
    // 同伴叫過的花色
    const pSuit = [...h.bids].reverse().find((b) => b.seat === part && b.bid && b.bid.s < 4);
    if (pSuit && pSuit.bid.s !== trump) { const x = legal.filter((c) => suitOf(c) === pSuit.bid.s); if (x.length) return x.length <= 2 ? high(x) : low(x); }
    const nt = legal.filter((c) => suitOf(c) !== trump && safeSuit(suitOf(c)));
    const pool = nt.length ? nt : legal.filter((c) => suitOf(c) !== trump).length ? legal.filter((c) => suitOf(c) !== trump) : legal;
    // 防守方有王：出短門（單張）準備王吃；不然出最長的一門，有連張大牌（KQ、QJ）就出大的
    if (!declSide && myT.length) { const single = pool.filter((c) => hand.filter((x) => suitOf(x) === suitOf(c)).length === 1 && rankOf(c) < 13); if (single.length) return single[0]; }
    const lenOf = (s) => pool.filter((c) => suitOf(c) === s).length;
    let bs = suitOf(pool[0]); for (const c of pool) if (lenOf(suitOf(c)) > lenOf(bs)) bs = suitOf(c);
    const inS = pool.filter((c) => suitOf(c) === bs), top = high(inS);
    const seq = inS.some((c) => rankOf(c) === rankOf(top) - 1) && rankOf(top) >= 11;
    return seq ? top : low(inS);
  }
  const led = suitOf(h.trick[0].c), w = trickWinner(h.trick, trump);
  const partnerWins = teamOf(w.seat) === me;
  if (partnerWins && sure(w.c, led)) return suitOf(legal[0]) === led ? low(legal) : discard();
  const winners = legal.filter((c) => beats(c, w.c, led, trump));
  const sureW = winners.filter((c) => sure(c, led));
  if (sureW.length) return cheapest(low(sureW));
  if (suitOf(legal[0]) === led) {
    if (!winners.length) return low(legal);
    if (h.trick.length === 3) return low(winners);
    if (h.trick.length === 1) return partnerWins ? low(legal) : low(legal);     // 二家低
    return cheapest(high(winners));                                             // 三家：出夠大的（等值出最小）
  }
  if (partnerWins && h.trick.length === 3) return discard();
  const ruff = winners.filter((c) => suitOf(c) === trump);
  if (ruff.length && !partnerWins) return low(ruff);
  if (ruff.length && partnerWins && !sure(w.c, led)) return low(ruff);
  return discard();
}
// 高手出牌：把看不到的牌隨機發給另外三家（照已知的缺門），每張候選牌都「假裝打完這一手」很多次，
// 選讓我們這隊最常達成目標墩數的那張。模擬時四家都用標準電腦的打法。
const STD_SEATS = [0, 1, 2, 3].map(() => ({ bot: true, name: "🤖小明" }));
// 叫牌重播：用抽出來的手牌，照每個人的打法重新叫一次，看跟實際叫的差幾次（真人用標準電腦近似）
const seatModel = (t, x) => (t.seats[x] && t.seats[x].bot && !brPersona(t.seats[x]).expert ? t.seats[x] : STD_SEATS[x]);
const highOf = (bids) => { let hi = null; for (const b of bids) if (b.bid) hi = { ...b.bid, seat: b.seat }; return hi; };
function auctionMismatch(t, i, hands) {
  const h = t.h; let miss = 0;
  for (let j = 0; j < h.bids.length; j++) {
    const b = h.bids[j]; if (b.seat === i) continue;
    const prefix = h.bids.slice(0, j), passes = (() => { let n = 0; for (let k = prefix.length - 1; k >= 0 && !prefix[k].bid; k--) n++; return n; })();
    const ft = { h: { hands, bids: prefix, high: highOf(prefix), passes }, seats: [0, 1, 2, 3].map((x) => seatModel(t, x)) };
    const pred = botBid(ft, b.seat);
    if (!!pred !== !!b.bid || (pred && (pred.l !== b.bid.l || pred.s !== b.bid.s))) miss++;
  }
  return miss;
}
// 抽 M 組手牌（照缺門），留下跟叫牌最吻合的 S 組
function sampleWorlds(t, i, S, M) {
  const h = t.h, res = [];
  for (let k = 0; k < M; k++) { const hands = sampleHands(h, i); res.push({ hands, miss: h.bids.length ? auctionMismatch(t, i, hands) : 0 }); }
  res.sort((a, b) => a.miss - b.miss);
  return res.slice(0, S).map((r) => r.hands);
}
// 從某個叫牌狀態把叫牌和打牌都模擬完，回傳 i 這隊的得分（線位 × ±1，四家 Pass 算 0）
function simulateHand(t, i, hands, bids) {
  const seats = [0, 1, 2, 3].map((x) => seatModel(t, x)), me = teamOf(i);
  bids = bids.slice();
  let passes = 0; for (let k = bids.length - 1; k >= 0 && !bids[k].bid; k--) passes++;
  let high = highOf(bids), seat = bids.length ? (bids[bids.length - 1].seat + 1) % 4 : t.h.first;
  for (let guard = 0; guard < 40; guard++) {
    if (!high && passes >= 4) return 0;
    if (high && passes >= 3) break;
    const b = botBid({ h: { hands, bids, high, passes }, seats }, seat);
    bids.push({ seat, bid: b });
    if (b) { high = { ...b, seat }; passes = 0; } else passes++;
    seat = (seat + 1) % 4;
  }
  const c = high, dt = teamOf(c.seat), need = [0, 0]; need[dt] = 6 + c.l; need[1 - dt] = 8 - c.l;
  const sh = { hands, trick: [], played: new Set(), trump: c.s === 4 ? -1 : c.s, contract: c, need, tricks: [0, 0], voids: [new Set(), new Set(), new Set(), new Set()], bids };
  const st = { h: sh, seats: STD_SEATS };
  let cur = (c.seat + 1) % 4;
  for (let guard = 0; guard < 60; guard++) {
    const card = botCard(st, cur), hd = sh.hands[cur];
    hd.splice(hd.indexOf(card), 1);
    if (sh.trick.length && suitOf(card) !== suitOf(sh.trick[0].c)) sh.voids[cur].add(suitOf(sh.trick[0].c));
    sh.trick.push({ seat: cur, c: card }); sh.played.add(card);
    if (sh.trick.length === 4) {
      const w = trickWinner(sh.trick, sh.trump); sh.tricks[teamOf(w.seat)]++; sh.trick = [];
      if (sh.tricks[dt] >= need[dt]) return dt === me ? c.l : -c.l;
      if (sh.tricks[1 - dt] >= need[1 - dt]) return dt === me ? -c.l : c.l;
      cur = w.seat;
    } else cur = (cur + 1) % 4;
  }
  return 0;
}
function expertBid(t, i) {
  const h = t.h;
  const acts = [null];
  for (let s2 = 0; s2 <= 4; s2++) { const lo = !h.high ? 1 : h.high.l + (s2 > h.high.s ? 0 : 1); for (let l = lo; l <= Math.min(7, lo + 2); l++) acts.push({ l, s: s2 }); }
  const S = 20;
  const worlds = sampleWorlds(t, i, S, S * 6);
  const val = acts.map(() => 0);
  for (const w of worlds) acts.forEach((a, k) => { val[k] += simulateHand(t, i, w.map((x) => x.slice()), [...h.bids, { seat: i, bid: a }]) / worlds.length; });
  let best = 0; for (let k = 1; k < acts.length; k++) if (val[k] > val[best] + 0.04) best = k;     // 差不多就保守一點
  return acts[best];
}
function sampleHands(h, i) {
  const hand = h.hands[i], unknown = [];
  for (let c = 0; c < 52; c++) if (!h.played.has(c) && !hand.includes(c)) unknown.push(c);
  const others = [1, 2, 3].map((k) => (i + k) % 4);
  for (let tries = 0; tries < 30; tries++) {
    for (let k = unknown.length - 1; k > 0; k--) { const j = randomInt(k + 1); [unknown[k], unknown[j]] = [unknown[j], unknown[k]]; }
    const elig = (c) => others.filter((x) => !h.voids[x].has(suitOf(c)));
    const order = unknown.slice().sort((a, b) => elig(a).length - elig(b).length);
    const cap = {}; for (const x of others) cap[x] = h.hands[x].length;
    const out = { [i]: hand.slice() }; for (const x of others) out[x] = [];
    let ok = true;
    for (const c of order) {
      const e = elig(c).filter((x) => cap[x] > 0);
      if (!e.length) { ok = false; break; }
      const x = e[randomInt(e.length)]; out[x].push(c); cap[x]--;
    }
    if (ok || tries === 29) {
      if (!ok) { const rest = unknown.slice(); for (const x of others) { out[x] = rest.splice(0, h.hands[x].length); } }
      return [0, 1, 2, 3].map((k) => out[k]);
    }
  }
}
function rollout(h, i, c, hands) {
  const sh = { hands, trick: h.trick.slice(), played: new Set(h.played), trump: h.trump, contract: h.contract, need: h.need, tricks: h.tricks.slice(),
    voids: h.voids.map((v) => new Set(v)), bids: h.bids };
  const st = { h: sh, seats: STD_SEATS }, me = teamOf(i);
  let seat = i, card = c;
  for (let guard = 0; guard < 60; guard++) {
    const hd = sh.hands[seat]; hd.splice(hd.indexOf(card), 1);
    if (sh.trick.length && suitOf(card) !== suitOf(sh.trick[0].c)) sh.voids[seat].add(suitOf(sh.trick[0].c));
    sh.trick.push({ seat, c: card }); sh.played.add(card);
    if (sh.trick.length === 4) {
      const w = trickWinner(sh.trick, sh.trump); sh.tricks[teamOf(w.seat)]++; sh.trick = [];
      if (sh.tricks[me] >= sh.need[me]) return 1 + sh.tricks[me] * 0.001;
      if (sh.tricks[1 - me] >= sh.need[1 - me] || !sh.hands[0].length) return sh.tricks[me] * 0.001;
      seat = w.seat;
    } else seat = (seat + 1) % 4;
    card = botCard(st, seat);
  }
  return 0;
}
function expertCard(t, i) {
  const h = t.h, legal = legalCards(t, i);
  if (legal.length === 1) return legal[0];
  const hand = h.hands[i];
  // 等值的牌（中間的牌都打掉了或在自己手上）只試最小那張
  const cand = legal.filter((c) => { const y = c - 1; return !(c % 13 > 0 && suitOf(y) === suitOf(c) && hand.includes(y) && legal.includes(y)); });
  if (cand.length === 1) return cand[0];
  const guess = heuristicCard(t, i);
  const S = 24;
  const score = new Map(cand.map((c) => [c, c === guess ? 0.02 : 0]));
  const worlds = sampleWorlds(t, i, S, S * 4);
  for (let k = 0; k < worlds.length; k++) {
    const hands = worlds[k];
    for (const c of cand) score.set(c, score.get(c) + rollout(h, i, c, hands.map((a) => a.slice())) / S);
  }
  let best = cand[0]; for (const c of cand) if (score.get(c) > score.get(best)) best = c;
  return best;
}
function botBid(t, i) {
  const h = t.h, me = handInfo(h.hands[i]), p = (i + 2) % 4, P = brPersona(t.seats[i]);
  if (P.expert) return expertBid(t, i);
  const pBids = h.bids.filter((b) => b.seat === p), pLast = [...pBids].reverse().find((b) => b.bid);
  const pPts = pLast ? 12 + 2 * (pLast.bid.l - 1) : pBids.length ? 8 : 10;     // 從同伴叫過什麼猜他的牌力
  // 選王：同伴叫過的花色我有 3 張以上就支持；不然叫自己最長的花色；牌型平均又夠強就叫無王
  let strain, fit = false;
  if (pLast && pLast.bid.s < 4 && me.len[pLast.bid.s] >= 3) { strain = pLast.bid.s; fit = true; }
  else if (pLast && pLast.bid.s === 4 && me.balanced) { strain = 4; fit = true; }
  else if (me.balanced && me.hcp >= P.ntMin) strain = 4;
  else {
    strain = 3; for (let s = 3; s >= 0; s--) if (me.len[s] > me.len[strain]) strain = s;
    if (P.major && strain < 2) { const m = me.len[3] >= me.len[2] ? 3 : 2; if (me.len[m] >= 4) strain = m; }   // 老派：有四張高花就叫高花
  }
  const tricks = (me.pts + pPts) / 2.85 + (fit ? P.fit : 0) + (strain < 4 && me.len[strain] >= 6 ? 0.5 : 0) + P.bold;
  const maxLevel = Math.min(7, Math.floor(tricks) - 6);
  if (h.high && teamOf(h.high.seat) === teamOf(i)) {          // 同伴現在拿著合約：沒有明顯更好就 pass
    if (h.high.s === strain || maxLevel < h.high.l + 1 || !(strain < 4 && me.len[strain] >= (P.compete ? 5 : 6))) return null;
  }
  const lv = !h.high ? 1 : h.high.l + (strain > h.high.s ? 0 : 1);
  return lv <= maxLevel && lv <= 7 ? { l: lv, s: strain } : null;
}

// ---------------------------------------------------------------- 電腦：出牌
function botCard(t, i) {
  const h = t.h, hand = h.hands[i], legal = legalCards(t, i), trump = h.trump;
  const P = brPersona(t.seats[i]);
  if (P.expert) return expertCard(t, i);
  if (P.noise && Math.random() < P.noise) return legal[randomInt(legal.length)];       // 新手偶爾亂出
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
  v.seats = t.seats.map((s, i) => s && { i, name: s.name, bot: s.bot, tag: s.bot ? brPersona(s).tag : "", away: !s.bot && !s.ws, points: s.points, count: h ? h.hands[i].length : 0, won: h ? h.won[i] : 0 });
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

// 測試用：指定四家手牌和先叫的人，電腦打完這一手，回傳 0 號座位那隊的點數增減（重洗或四家 Pass 算 0）
export function _playDeal(names, hands, first) {
  const t = newTable("dup");
  names.forEach((n, k) => { t.seats[k] = mkSeat({ bot: true, name: "🤖" + n, points: 10000 }); });
  t.g = { first, handNo: 0, redeals: 0 }; t.started = true;
  startHand(t); t.h.hands = hands.map((a) => sortHand(a.slice()));
  for (let guard = 0; guard < 5000; guard++) {
    if (t.g.redeals) return { delta: 0, redeal: true };
    if (t.phase === "result") return { delta: t.result.deltas[0], made: t.result.made, contract: t.result.contract };
    const h = t.h;
    if (h.stage === "trick") { endTrick(t); continue; }
    if (!botAct(t, h.turn)) throw new Error("stuck");
  }
  throw new Error("too long");
}
export const _deal = deal;
// 測試用：4 個電腦直接打完一整場（不經過計時器）
export function _simGame(cfg, names) {
  const t = newTable("sim"); if (cfg) Object.assign(t.cfg, cfg);
  if (names) names.forEach((n, i) => { t.seats[i] = mkSeat({ bot: true, name: "🤖" + n }); });
  startGame(t);
  const results = [];
  for (let guard = 0; guard < 100000; guard++) {
    if (t.phase === "end") break;
    if (t.phase === "result") { results.push(t.result); if (t.result.gameOver) finishGame(t); else startHand(t); continue; }
    const h = t.h;
    if (h.stage === "trick") { endTrick(t); continue; }
    if (!botAct(t, h.turn)) throw new Error("bot stuck " + h.stage);
  }
  return { results, final: t.final, redeals: t.g.redeals, seats: t.seats.map((s) => s.points) };
}
