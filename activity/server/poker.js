// 德州撲克（現金桌，練習籌碼）：2～6 人，可加電腦玩家，其他人旁觀。賭注模式（真代幣）先不開放。
// 牌桌：每個 Activity instance 一桌；伺服器負責發牌、輪流下注、邊池、判勝負，前端只畫畫面。
import { randomInt, randomBytes } from "node:crypto";

const SEATS = 6, START = 1000, SB = 10, BB = 20;
const ACT_MS = 25000, RESULT_MS = 11000, STREET_MS = 1200;
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "大鵰", "豆豆"];

// ---------------------------------------------------------------- 牌與牌型
// 牌 = 0..51：點數 = c % 13 + 2（2..14，A=14），花色 = floor(c / 13)
const rankOf = (c) => (c % 13) + 2;
const suitOf = (c) => Math.floor(c / 13);
export const HAND_NAMES = ["高牌", "一對", "兩對", "三條", "順子", "同花", "葛蘆", "四條", "同花順"];

function score5(c) {
  const r = c.map(rankOf).sort((a, b) => b - a);
  const flush = c.every((x) => suitOf(x) === suitOf(c[0]));
  const uniq = [...new Set(r)];
  let high = 0;
  if (uniq.length === 5) {
    if (r[0] - r[4] === 4) high = r[0];
    else if (r[0] === 14 && r[1] === 5 && r[4] === 2) high = 5;     // A-2-3-4-5
  }
  const cnt = {}; for (const x of r) cnt[x] = (cnt[x] || 0) + 1;
  const groups = Object.entries(cnt).map(([k, v]) => [v, Number(k)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = (list) => list.reduce((s, x) => s * 15 + x, 0);
  let cat, ks;
  if (high && flush) { cat = 8; ks = [high]; }
  else if (groups[0][0] === 4) { cat = 7; ks = [groups[0][1], groups[1][1]]; }
  else if (groups[0][0] === 3 && groups[1][0] === 2) { cat = 6; ks = [groups[0][1], groups[1][1]]; }
  else if (flush) { cat = 5; ks = r; }
  else if (high) { cat = 4; ks = [high]; }
  else if (groups[0][0] === 3) { cat = 3; ks = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2 && groups[1][0] === 2) { cat = 2; ks = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2) { cat = 1; ks = groups.map((g) => g[1]); }
  else { cat = 0; ks = r; }
  return cat * 15 ** 5 + kick(ks);
}
// 從 5～7 張牌中選最大的 5 張，回傳分數（類別 = floor(分數 / 15^5)）
export function bestScore(cards) {
  const n = cards.length; let best = -1;
  if (n === 5) return score5(cards);
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const s = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]); if (s > best) best = s;
    }
  return best;
}
export const handCat = (score) => Math.floor(score / 15 ** 5);

// 邊池：contrib = [{i, total, folded}]，回傳 [{amount, elig:[i...]}]
export function buildPots(contrib) {
  const levels = [...new Set(contrib.filter((c) => c.total > 0 && !c.folded).map((c) => c.total))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  for (const lv of levels) {
    let amount = 0; const elig = [];
    for (const c of contrib) { amount += Math.max(0, Math.min(c.total, lv) - prev); if (!c.folded && c.total >= lv) elig.push(c.i); }
    if (amount > 0) pots.push({ amount, elig });
    prev = lv;
  }
  const rest = contrib.reduce((s, c) => s + Math.max(0, c.total - prev), 0);       // 超過最高層的（棄牌者的錢）併入最後一池
  if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
  return pots;
}

const newDeck = () => { const d = Array.from({ length: 52 }, (_, i) => i); for (let i = 51; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; };
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

// ---------------------------------------------------------------- 電腦玩家：蒙地卡羅勝率 + 底池賠率
function equity(hole, board, nOpp, iters = 120) {
  const used = new Set([...hole, ...board]);
  const deckLeft = []; for (let i = 0; i < 52; i++) if (!used.has(i)) deckLeft.push(i);
  let win = 0;
  for (let it = 0; it < iters; it++) {
    const d = deckLeft.slice();
    const need = 5 - board.length + nOpp * 2;
    for (let i = 0; i < need; i++) { const j = i + Math.floor(Math.random() * (d.length - i)); [d[i], d[j]] = [d[j], d[i]]; }
    const full = board.concat(d.slice(0, 5 - board.length));
    const mine = bestScore([...hole, ...full]);
    let rank = 1;
    for (let o = 0; o < nOpp; o++) {
      const k = 5 - board.length + o * 2;
      const s = bestScore([d[k], d[k + 1], ...full]);
      if (s > mine) { rank = 0; break; } else if (s === mine) rank = Math.min(rank, 0.5);
    }
    win += rank;
  }
  return win / iters;
}
// 電腦個性：agg 加注傾向、loose 入池鬆緊（負數＝更愛跟）、bluff 詐唬率、size 下注尺寸、slow 強牌慢打率
const PERSONA = {
  "阿發": { tag: "愛衝", agg: 1.7, loose: -0.10, bluff: 0.20, size: 1.3, slow: 0 },
  "小明": { tag: "穩健", agg: 0.8, loose: 0.05, bluff: 0.03, size: 0.8, slow: 0.1 },
  "老王": { tag: "老狐狸", agg: 1.0, loose: 0, bluff: 0.10, size: 1.0, slow: 0.35 },
  "花花": { tag: "跟注機", agg: 0.5, loose: -0.16, bluff: 0.02, size: 0.7, slow: 0 },
  "阿牛": { tag: "超緊", agg: 1.0, loose: 0.13, bluff: 0.0, size: 1.0, slow: 0.1 },
  "小美": { tag: "心機", agg: 1.2, loose: -0.03, bluff: 0.15, size: 1.1, slow: 0.2 },
  "大鵰": { tag: "全下狂", agg: 2.2, loose: -0.12, bluff: 0.30, size: 2.0, slow: 0 },
  "豆豆": { tag: "新手", agg: 0.9, loose: -0.06, bluff: 0.08, size: 1.0, slow: 0 },
};
const DEFAULT_PERSONA = { tag: "", agg: 1, loose: 0, bluff: 0.07, size: 1, slow: 0 };
const personaOf = (s) => PERSONA[String(s.name || "").replace(/^🤖/, "")] || DEFAULT_PERSONA;
function botDecide(t, s) {
  const toCall = Math.max(0, t.curBet - s.bet), pot = t.potTotal();
  const P = personaOf(s);
  const opps = t.seats.filter((x) => x && x !== s && x.inHand && !x.folded).length;
  const e = equity(s.hole, t.board, Math.max(1, opps), t.board.length ? 140 : 100);
  const odds = toCall / (pot + toCall || 1), r = Math.random();
  const stackLeft = s.chips;
  const raiseTo = (frac) => Math.min(s.bet + stackLeft, t.curBet + Math.max(t.minRaise, Math.round((pot * frac * P.size) / 10) * 10));
  if (toCall === 0) {
    if (e > 0.85 && r < P.slow) return { a: "check" };                                  // 強牌慢打，誘敵
    if (e > 0.72 && r < Math.min(0.95, 0.8 * P.agg)) return { a: "raise", amt: raiseTo(0.7) };
    if (e > 0.55 + P.loose / 2 && r < Math.min(0.9, 0.45 * P.agg)) return { a: "raise", amt: raiseTo(0.45) };
    if (e < 0.35 && r < P.bluff) return { a: "raise", amt: raiseTo(0.5) };            // 詐唬
    return { a: "check" };
  }
  if (e > 0.78 - (P.agg - 1) * 0.05 && r < Math.min(0.95, 0.55 * P.agg) && !(r < P.slow)) return { a: "raise", amt: raiseTo(0.8) };
  if (e < 0.5 && r < P.bluff * 0.5) return { a: "raise", amt: raiseTo(0.8) };         // 衝動型的恐嚇加注
  if (e > odds + 0.05 + P.loose && (e > 0.35 + P.loose || toCall <= BB * 2)) return { a: "call" };
  if (r < 0.05 + Math.max(0, -P.loose) * 0.4 && toCall <= BB * 3) return { a: "call" };
  return { a: "fold" };
}

// ---------------------------------------------------------------- 牌桌
const tables = new Map();
let guest = 0;
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.pname || ws.user?.name || (ws.pguest ||= "玩家" + String(++guest).padStart(2, "0"));

function newTable(id) {
  const t = {
    id, members: new Set(), seats: Array(SEATS).fill(null), dealer: -1, phase: "wait", board: [], deck: [],
    curBet: 0, minRaise: BB, toAct: -1, deadline: 0, nextAt: 0, handNo: 0, result: null, log: "等玩家入座…", botSeq: 0,
  };
  t.potTotal = () => t.seats.reduce((s, x) => s + (x ? x.total : 0), 0);
  return t;
}
function getTable(id) { if (!tables.has(id)) tables.set(id, newTable(id)); return tables.get(id); }

const inHandSeats = (t) => t.seats.filter((s) => s && s.inHand);
const live = (t) => inHandSeats(t).filter((s) => !s.folded);
const actors = (t) => live(t).filter((s) => !s.allin);

function view(t, ws) {
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  const showAll = t.phase === "result" && t.result && t.result.showdown;
  return {
    t: "pstate", phase: t.phase, board: t.board, dealer: t.dealer, curBet: t.curBet, minRaise: t.minRaise, bb: BB, sb: SB,
    toAct: t.toAct, deadline: t.deadline, nextAt: t.phase === "result" ? t.nextAt : 0, now: Date.now(), handNo: t.handNo, pot: t.potTotal(), log: t.log, you: mine,
    watchers: [...t.members].filter((w) => w.pspec).length, result: t.result,
    seats: t.seats.map((s, i) => s && ({
      i, name: s.name, tag: s.bot ? personaOf(s).tag : undefined, chips: s.chips, bet: s.bet, total: s.total, bot: s.bot, folded: s.folded, allin: s.allin, inHand: s.inHand, away: s.bot ? false : !s.ws,
      last: s.last, hole: s.inHand && (s.ws === ws || (showAll && !s.folded)) ? s.hole : s.inHand ? [-1, -1] : [], hand: showAll && !s.folded && s.score != null ? HAND_NAMES[handCat(s.score)] : undefined,
    })),
  };
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listPokerTables() {
  const res = [];
  for (const t of tables.values()) {
    const seated = t.seats.filter(Boolean);
    if (!seated.some((s) => !s.bot) ) continue;
    res.push({ game: "poker", id: t.id, players: seated.filter((s) => !s.bot).map((s) => ({ name: s.name, real: false, playing: t.toAct >= 0 && t.seats[t.toAct] === s })),
               watchers: [...t.members].filter((w) => w.pspec).length, bots: seated.filter((s) => s.bot).length, phase: t.phase, handNo: t.handNo });
  }
  return res;
}

function seatPlayer(t, i, o) {
  t.seats[i] = { ws: null, pid: null, bot: false, name: "", chips: START, hole: [], bet: 0, total: 0, folded: false, allin: false, acted: false, inHand: false, last: "", score: null, idle: 0, ...o };
}

// ---- 一手牌
function startHand(t) {
  const players = t.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  for (const i of players) { const s = t.seats[i]; if (s.chips < BB) { s.chips = START; s.last = "補充籌碼"; } }
  if (players.length < 2) { t.phase = "wait"; t.toAct = -1; t.log = "等玩家入座…（可以加電腦）"; return; }
  t.handNo++; t.deck = newDeck(); t.board = []; t.result = null; t.phase = "preflop";
  for (const i of players) { const s = t.seats[i]; Object.assign(s, { hole: [t.deck.pop(), t.deck.pop()], bet: 0, total: 0, folded: false, allin: false, acted: false, inHand: true, last: "", score: null }); }
  // 按鈕往下一位
  let d = t.dealer; do { d = (d + 1) % SEATS; } while (!t.seats[d]);
  t.dealer = d;
  const next = (from) => { let k = from; do { k = (k + 1) % SEATS; } while (!t.seats[k] || !t.seats[k].inHand); return k; };
  const heads = players.length === 2;
  const sbI = heads ? d : next(d), bbI = next(sbI);
  const post = (i, amt) => { const s = t.seats[i], a = Math.min(amt, s.chips); s.chips -= a; s.bet += a; s.total += a; if (!s.chips) s.allin = true; s.last = amt === SB ? "小盲" : "大盲"; };
  post(sbI, SB); post(bbI, BB);
  t.curBet = BB; t.minRaise = BB;
  t.log = `第 ${t.handNo} 手：${t.seats[sbI].name} 小盲 ${SB}，${t.seats[bbI].name} 大盲 ${BB}`;
  t.toAct = nextActor(t, bbI);
  armTimer(t);
  if (t.toAct < 0) runout(t);
}
function nextActor(t, from) {
  let k = from;
  for (let n = 0; n < SEATS; n++) {
    k = (k + 1) % SEATS; const s = t.seats[k];
    if (s && s.inHand && !s.folded && !s.allin && (!s.acted || s.bet < t.curBet)) return k;
  }
  return -1;
}
function armTimer(t) {
  const s = t.seats[t.toAct];
  t.deadline = s ? Date.now() + (s.bot ? 800 + Math.random() * 900 : !s.ws ? 500 : ACT_MS) : 0;
}

function act(t, i, a, amt) {
  const s = t.seats[i]; if (!s || t.toAct !== i) return false;
  const toCall = Math.max(0, t.curBet - s.bet);
  const pay = (x) => { x = Math.min(x, s.chips); s.chips -= x; s.bet += x; s.total += x; if (!s.chips) s.allin = true; };
  if (a === "fold") { s.folded = true; s.last = "棄牌"; }
  else if (a === "check") { if (toCall) return false; s.last = "過牌"; }
  else if (a === "call") { if (!toCall) { s.last = "過牌"; } else { pay(toCall); s.last = s.allin ? "全下" : `跟注 ${s.bet}`; } }
  else if (a === "raise" || a === "allin") {
    let to = a === "allin" ? s.bet + s.chips : Math.floor(Number(amt));
    if (!Number.isFinite(to)) return false;
    to = Math.min(to, s.bet + s.chips);
    const minTo = t.curBet + t.minRaise;
    if (to < minTo && to < s.bet + s.chips) to = Math.min(minTo, s.bet + s.chips);     // 低於最小加注就補到最小（除非是全下）
    if (to <= t.curBet) { if (!toCall) return false; pay(toCall); s.last = s.allin ? "全下" : `跟注 ${s.bet}`; }
    else {
      const raise = to - t.curBet;
      pay(to - s.bet);
      if (raise >= t.minRaise) t.minRaise = raise;
      t.curBet = s.bet;
      for (const o of t.seats) if (o && o !== s && o.inHand && !o.folded && !o.allin) o.acted = false;
      s.last = s.allin ? `全下 ${s.bet}` : `加注到 ${s.bet}`;
    }
  } else return false;
  s.acted = true; s.idle = 0;
  afterAction(t, i);
  return true;
}
function afterAction(t, from) {
  if (live(t).length === 1) return finish(t, false);
  const act = actors(t);
  const done = act.length === 0
    || (act.length === 1 ? act[0].bet >= t.curBet                                   // 只剩一個還能下注的人：已經跟上就不用再下
                          : act.every((s) => s.acted && s.bet >= t.curBet));
  if (done) return endRound(t);
  t.toAct = nextActor(t, from);
  if (t.toAct < 0) return endRound(t);
  armTimer(t); push(t);
}

function endRound(t) {
  for (const s of t.seats) if (s) { s.bet = 0; s.acted = false; }
  t.curBet = 0; t.minRaise = BB;
  if (t.phase === "river") return finish(t, true);
  const nextPhase = { preflop: "flop", flop: "turn", turn: "river" }[t.phase];
  t.phase = nextPhase;
  t.board.push(...(nextPhase === "flop" ? [t.deck.pop(), t.deck.pop(), t.deck.pop()] : [t.deck.pop()]));
  for (const s of t.seats) if (s && s.inHand && !s.folded && !s.allin) s.last = "";
  if (actors(t).length < 2) { t.toAct = -1; t.deadline = 0; t.nextAt = Date.now() + STREET_MS; push(t); return; }     // 全下對決：自動翻牌
  t.toAct = nextActor(t, t.dealer);
  armTimer(t); push(t);
}
function runout(t) { t.toAct = -1; t.deadline = 0; t.nextAt = Date.now() + STREET_MS; push(t); }

function finish(t, showdown) {
  t.toAct = -1; t.deadline = 0;
  const contrib = t.seats.map((s, i) => s && s.inHand ? { i, total: s.total, folded: s.folded } : null).filter(Boolean);
  const survivors = live(t);
  const winners = [];
  if (!showdown || survivors.length === 1) {
    const w = survivors[0], amount = t.potTotal(); w.chips += amount;
    winners.push({ name: w.name, i: t.seats.indexOf(w), amount, hand: null });
    t.log = `${w.name} 贏得 ${amount}（其他人都棄牌）`;
    t.result = { showdown: false, winners, pots: [{ amount, win: [t.seats.indexOf(w)] }] };
  } else {
    for (const s of survivors) s.score = bestScore([...s.hole, ...t.board]);
    const pots = buildPots(contrib), resPots = [];
    for (const p of pots) {
      const el = p.elig.filter((i) => !t.seats[i].folded);
      const top = Math.max(...el.map((i) => t.seats[i].score));
      const wins = el.filter((i) => t.seats[i].score === top);
      const share = Math.floor(p.amount / wins.length); let odd = p.amount - share * wins.length;
      // 零頭給最靠近按鈕左邊的贏家
      const order = wins.slice().sort((a, b) => ((a - t.dealer + SEATS - 1) % SEATS) - ((b - t.dealer + SEATS - 1) % SEATS));
      for (const i of order) { const gain = share + (odd > 0 ? 1 : 0); if (odd > 0) odd--; t.seats[i].chips += gain; const w = winners.find((x) => x.i === i); if (w) w.amount += gain; else winners.push({ name: t.seats[i].name, i, amount: gain, hand: HAND_NAMES[handCat(t.seats[i].score)] }); }
      resPots.push({ amount: p.amount, win: order });
    }
    t.log = winners.map((w) => `${w.name} 贏 ${w.amount}（${w.hand}）`).join("；");
    t.result = { showdown: true, winners, pots: resPots };
  }
  t.phase = "result"; t.nextAt = Date.now() + RESULT_MS;
  for (const s of t.seats) if (s) { s.inHand = s.inHand; }
  push(t);
}

function tick() {
  const now = Date.now();
  for (const t of [...tables.values()]) {
    if (!t.members.size) { if (now - (t.emptyAt || (t.emptyAt = now)) > 120000) tables.delete(t.id); continue; }
    t.emptyAt = 0;
    const humans = t.seats.filter((s) => s && !s.bot);
    if (!humans.length && t.phase !== "wait") { t.phase = "wait"; t.toAct = -1; t.seats.forEach((s, i) => { if (s) t.seats[i] = null; }); t.log = "等玩家入座…"; push(t); continue; }
    if (t.phase === "wait") { if (t.seats.filter(Boolean).length >= 2) startHand(t), push(t); continue; }
    if (t.phase === "result") { if (now >= t.nextAt) { t.phase = "wait"; for (const s of t.seats) if (s) { s.inHand = false; s.last = ""; s.hole = []; } removeAway(t); if (t.seats.filter(Boolean).length >= 2) startHand(t); else t.log = "等玩家入座…（可以加電腦）"; push(t); } continue; }
    if (t.toAct < 0) { if (t.nextAt && now >= t.nextAt) { t.nextAt = 0; if (live(t).length > 1 && t.phase !== "river") endRoundAuto(t); else if (t.phase === "river") finish(t, true); } continue; }
    const s = t.seats[t.toAct];
    if (now < t.deadline) continue;
    if (s.bot) { const d = botDecide(t, s); if (!act(t, t.toAct, d.a, d.amt)) act(t, t.toAct, t.curBet > s.bet ? "call" : "check"); push(t); }
    else { s.idle++; const toCall = t.curBet > s.bet; act(t, t.toAct, toCall ? "fold" : "check"); s.last = toCall ? "超時棄牌" : "超時過牌"; push(t); }
  }
}
function endRoundAuto(t) { endRound(t); }
function removeAway(t) {
  t.seats.forEach((s, i) => { if (s && ((!s.bot && (!s.ws || s.idle >= 2)) || s.removeAfter)) t.seats[i] = null; });
  if (!t.seats.some((s) => s && !s.bot)) t.seats.fill(null);       // 沒有真人了，電腦也一起收掉
}
setInterval(tick, 300).unref();

// ---------------------------------------------------------------- 連線處理
export function pokerClose(ws) {
  const t = ws.ptable; if (!t) return;
  t.members.delete(ws);
  const i = t.seats.findIndex((s) => s && s.ws === ws);
  if (i >= 0) {
    const s = t.seats[i]; s.ws = null;
    if (!s.inHand) t.seats[i] = null;
    else if (t.toAct === i) t.deadline = Date.now() + 500;       // 不在這手牌裡就直接空出座位；在牌局中則留到這手結束（超時自動棄牌）
  }
  push(t);
}

export function handlePoker(ws, m) {
  if (m.t === "pjoin") {
    if (ws.ptable) pokerClose(ws);
    const t = getTable(String(m.room || "default").slice(0, 80));
    ws.ptable = t; ws.pspec = !!m.spectate; if (cleanName(m.name)) ws.pname = cleanName(m.name); ws.pid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    // 重新整理後認回原本的座位
    if (!ws.pspec) { const i = t.seats.findIndex((s) => s && !s.bot && s.pid === ws.pid); if (i >= 0) { t.seats[i].ws = ws; t.seats[i].name = nameOf(ws); t.seats[i].idle = 0; } }
    push(t); return true;
  }
  const t = ws.ptable; if (!t) return false;
  if (ws.pspec) return true;
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  if (m.t === "psit") {
    if (mine >= 0) return true;
    let i = Number(m.seat); if (!Number.isInteger(i) || i < 0 || i >= SEATS || t.seats[i]) i = t.seats.findIndex((s) => !s);
    if (i < 0) return out(ws, { t: "perr", error: "full" }), true;
    seatPlayer(t, i, { ws, pid: ws.pid, name: nameOf(ws) });
    t.log = `${nameOf(ws)} 入座`; push(t);
  } else if (m.t === "pstand") {
    if (mine < 0) return true;
    const s = t.seats[mine];
    if (s.inHand && t.phase !== "result" && t.phase !== "wait") { s.ws = null; if (t.toAct === mine) t.deadline = Date.now() + 500; }   // 這手牌打完（或輪到時自動棄牌）才離座
    else t.seats[mine] = null;
    out(ws, view(t, ws)); push(t);
  } else if (m.t === "paddbot") {
    if (mine < 0) return true;                                   // 要先入座才能加電腦
    const i = Number.isInteger(Number(m.seat)) && !t.seats[Number(m.seat)] && Number(m.seat) >= 0 && Number(m.seat) < SEATS ? Number(m.seat) : t.seats.findIndex((s) => !s);
    if (i < 0) return out(ws, { t: "perr", error: "full" }), true;
    const used = new Set(t.seats.filter(Boolean).map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has("🤖" + n)) || "電腦" + (++t.botSeq);
    seatPlayer(t, i, { bot: true, name: "🤖" + name }); push(t);
  } else if (m.t === "pdelbot") {
    const i = Number(m.seat), s = t.seats[i];
    if (mine < 0 || !s || !s.bot) return true;
    if (s.inHand && t.phase !== "result" && t.phase !== "wait") s.removeAfter = true;   // 這手打完才請下桌
    else t.seats[i] = null;
    push(t);
  } else if (m.t === "pname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.pname = nm; if (mine >= 0) t.seats[mine].name = nm; push(t);
  } else if (m.t === "preset") {
    if (mine < 0) return true;                                   // 入座的人可以重開：全員籌碼歸 START、重新發牌
    for (const x of t.seats) if (x) Object.assign(x, { chips: START, hole: [], bet: 0, total: 0, folded: false, allin: false, acted: false, inHand: false, last: "", score: null, removeAfter: false });
    t.board = []; t.result = null; t.toAct = -1; t.deadline = 0; t.curBet = 0; t.handNo = 0; t.phase = "wait";
    t.log = `${nameOf(ws)} 重開牌局，大家籌碼回到 ${START}`;
    startHand(t); push(t);
  } else if (m.t === "pact") {
    if (mine < 0 || t.toAct !== mine) return true;
    act(t, mine, String(m.a), m.amt); push(t);
  }
  return true;
}
