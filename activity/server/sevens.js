// 排七（練習點數）：4 人各 13 張，沒牌可出要蓋牌，蓋牌點數少的贏。
// 牌的編號和大老二、橋牌一樣：花色 = floor(c/13)（♣0 ♦1 ♥2 ♠3），rank = c%13+2（2..14），這裡把 A 當 1 ，所以數字順序是 A 2 3 … 10 J Q K。
// 規則：持有 ♦7 的人先出 ♦7；之後每一輪，輪到你就要出一張能接上的牌：任何一個花色的 7（還沒開的花色），
// 或是桌上那個花色目前最小的前一張、最大的後一張。有牌能出就一定要出；沒有能出的牌，就要自己選一張手牌「蓋牌」（面朝下放到自己前面）。
// 任何一個花色的 A 或 K 打出去之後，那個花色就封口，不能再接了（剩下的牌只能蓋掉）。
// 手牌都處理完（出完或蓋掉）的人跳過；全部人手牌都沒了，這手結束。每人蓋牌的點數加總（A=1、J=11、Q=12、K=13）越少越好，
// 兩兩比較蓋牌點數的差再乘以每點點數。伺服器負責發牌、判定、計分與電腦；前端只畫畫面和送操作。
import { randomInt, randomBytes } from "node:crypto";

const START_POINTS = 10000;
const DEFAULT_CFG = { len: 3, base: 5 };
const LENS = [1, 3, 5, 10];
const STAKES = [1, 2, 5, 10, 20];
const TURN_MS = 30000, RESULT_MS = 10000, BOT_MS = [600, 1300], AUTOPASS_MS = 1100;
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "牌神", "胖虎"];
const DIAMOND7 = 13 + 5;                                   // ♦7：suit 1，rank 7 → 13 + (7-2)

const suitOf = (c) => Math.floor(c / 13);
const nat = (c) => { const r = (c % 13) + 2; return r === 14 ? 1 : r; };     // A=1 … K=13
const sortHand = (h) => h.slice().sort((a, b) => suitOf(a) - suitOf(b) || nat(a) - nat(b));

const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.svname || ws.user?.name || "玩家";
const tables = new Map();
const now = () => Date.now();

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
const cardName = (c) => ["♣", "♦", "♥", "♠"][suitOf(c)] + ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[nat(c)] || nat(c));

// ---------------------------------------------------------------- 規則
function legal(h, c) {
  if (h.first) return c === DIAMOND7;                       // 第一張一定是 ♦7
  const s = suitOf(c), n = nat(c), b = h.board[s];
  if (!b) return n === 7;
  if (b.lo === 1 || b.hi === 13) return false;               // 這個花色的 A 或 K 已經出現，整排封口
  return n === b.lo - 1 || n === b.hi + 1;
}
const legalCards = (h, i) => h.hands[i].filter((c) => legal(h, c));

// ---------------------------------------------------------------- 開局、發牌
function deal() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return [0, 1, 2, 3].map((k) => sortHand(d.slice(k * 13, k * 13 + 13)));
}
function startGame(t) {
  for (let i = 0; i < 4; i++) if (!t.seats[i]) t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) });
  for (const s of t.seats) s.points = START_POINTS;
  t.g = { handNo: 0 };
  t.started = true; t.final = null;
  startHand(t);
}
function startHand(t) {
  const g = t.g; g.handNo++;
  const hands = deal();
  const first = hands.findIndex((h) => h.includes(DIAMOND7));
  t.h = { hands, board: [null, null, null, null], first: true, turn: first, deadline: 0, botAt: 0, covers: [[], [], [], []], coveredNow: -1 };
  t.result = null; t.phase = "play";
  t.log = `第 ${g.handNo} 手，由 ${t.seats[first].name} 先出 ♦7`;
  setTurn(t, first);
}
function setTurn(t, i) {
  const h = t.h; h.turn = i; h.deadline = now() + TURN_MS;
  h.botAt = now() + BOT_MS[0] + randomInt(BOT_MS[1] - BOT_MS[0]);
}

// ---------------------------------------------------------------- 出牌、過
function nextTurn(t, i) {                                   // 下一個還有手牌的人；全部都沒牌了就結算
  const h = t.h;
  for (let k = 1; k <= 4; k++) { const j = (i + k) % 4; if (h.hands[j].length) { setTurn(t, j); return; } }
  settle(t);
}
function doPlay(t, i, c) {
  const h = t.h; if (!h || h.turn !== i || !Number.isInteger(c) || !h.hands[i].includes(c) || !legal(h, c)) return false;
  h.hands[i] = h.hands[i].filter((x) => x !== c);
  const s = suitOf(c), n = nat(c);
  h.board[s] = h.board[s] ? { lo: Math.min(h.board[s].lo, n), hi: Math.max(h.board[s].hi, n) } : { lo: n, hi: n };
  h.first = false; h.last = { seat: i, card: c, cover: false };
  t.log = `${t.seats[i].name} 出 ${cardName(c)}`;
  nextTurn(t, i);
  return true;
}
// 沒有牌能出的時候，自己選一張手牌蓋下去（有牌能出就不能蓋）
function doCover(t, i, c) {
  const h = t.h; if (!h || h.turn !== i || h.first || legalCards(h, i).length || !Number.isInteger(c) || !h.hands[i].includes(c)) return false;
  h.hands[i] = h.hands[i].filter((x) => x !== c); h.covers[i].push(c);
  h.last = { seat: i, card: -1, cover: true };
  t.log = `${t.seats[i].name} 沒有牌可出，蓋了一張牌（共 ${h.covers[i].length} 張）`;
  nextTurn(t, i);
  return true;
}

// ---------------------------------------------------------------- 結算
function settle(t) {
  const h = t.h, base = t.cfg.base;
  const pen = h.covers.map((cs) => cs.reduce((x, c) => x + nat(c), 0));               // 蓋牌點數（A=1 … K=13）
  const total = pen.reduce((x, y) => x + y, 0);
  const deltas = pen.map((p) => base * (total - 4 * p));                               // 兩兩比較差距，總和一定是 0
  deltas.forEach((d, i) => { t.seats[i].points += d; });
  const best = Math.min(...pen), winner = pen.indexOf(best);
  const gameOver = t.g.handNo >= t.cfg.len;
  t.result = { handNo: t.g.handNo, winner, deltas, pen, covers: h.covers.map((x) => sortHand(x)), gameOver };
  t.log = `第 ${t.g.handNo} 手結束：${t.seats[winner].name} 蓋牌點數最少（${best}）`;
  t.phase = "result"; t.nextAt = now() + RESULT_MS;
}
function finishGame(t) {
  t.final = t.seats.map((s) => ({ name: s.name, points: s.points })).sort((a, b) => b.points - a.points);
  t.phase = "end"; t.started = false; t.h = null; t.result = null;
  t.log = "牌局結束";
  for (let i = 0; i < 4; i++) if (t.seats[i] && !t.seats[i].bot && !t.seats[i].ws) t.seats[i] = null;
}

// ---------------------------------------------------------------- 電腦
// 想法：能把自己同花色的一整串接下去的牌優先出；盡量留住「別人要等的」牌，也就是 7 的兩側（6、8）不急著開，7 本身先出去。
// 想法：能出的牌，優先接自己手上連得起來的一串，7 先出去；沒牌可出要蓋牌時，蓋點數最小、而且最不會卡死別人的牌（優先蓋靠近 A 的牌）。
function botMove(t, i) {
  const h = t.h, hand = h.hands[i], cs = legalCards(h, i);
  if (!cs.length) return null;
  const score = (c) => {
    const s = suitOf(c), n = nat(c), b = h.board[s];
    const dir = !b ? 0 : n < 7 ? -1 : 1;
    let run = 0;
    if (dir !== 0) for (let k = n + dir; k >= 1 && k <= 13 && hand.some((x) => suitOf(x) === s && nat(x) === k); k += dir) run++;
    const mine = hand.filter((x) => suitOf(x) === s).length;
    let sc = run * 3 + (n === 7 ? 4 : 0) + (mine >= 4 ? 1 : 0) - Math.abs(n - 7) * 0.25 + Math.random() * 1.2;
    if (n === 1 || n === 13) {                                // 打出 A 或 K 會讓這排封口：我這個花色剩下的牌就只能蓋掉
      const left = hand.filter((x) => suitOf(x) === s && x !== c);
      sc += left.length ? -2 - left.reduce((a, x) => a + nat(x), 0) * 0.35 : 3;
    }
    return sc;
  };
  return cs.map((c) => [c, score(c)]).sort((a, b) => b[1] - a[1])[0][0];
}
function botCover(t, i) {
  const hand = t.h.hands[i];
  return hand.map((c) => [c, nat(c) + Math.random() * 0.5]).sort((a, b) => a[1] - b[1])[0][0];     // 蓋最小的（點數越小扣越少）
}
function botAct(t, i) {
  const mv = botMove(t, i);
  return mv == null ? doCover(t, i, botCover(t, i)) : doPlay(t, i, mv);
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.seats.findIndex((s) => s && s.ws === ws && !ws.svspec);
  const h = t.h;
  const v = { t: "svstate", phase: t.phase, started: t.started, cfg: t.cfg, lens: LENS, stakes: STAKES, you, log: t.log, now: now(),
    watchers: [...t.members].filter((w) => w.svspec).length, final: t.final, handNo: t.g ? t.g.handNo : 0 };
  v.seats = t.seats.map((s, i) => s && { i, name: s.name, bot: s.bot, away: !s.bot && !s.ws, points: s.points, count: h ? h.hands[i].length : 0, covers: h ? h.covers[i].length : 0 });
  if (h && t.phase === "play") {
    Object.assign(v, { turn: h.turn, board: h.board, first: h.first, last: h.last || null, deadline: h.deadline });
    if (you >= 0) { v.hand = h.hands[you]; v.myCovers = sortHand(h.covers[you]); v.playable = h.turn === you ? legalCards(h, you) : []; v.mustCover = h.turn === you && !h.first && !v.playable.length; }
  }
  if (t.phase === "result") { v.result = t.result; v.nextAt = t.nextAt; v.board = t.h ? t.h.board : null; }
  return v;
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listSevensTables() {
  const res = [];
  for (const t of tables.values()) {
    const seated = t.seats.filter(Boolean);
    if (!seated.some((s) => !s.bot)) continue;
    res.push({ game: "sevens", id: t.id, players: seated.filter((s) => !s.bot).map((s) => ({ name: s.name, real: false, playing: false })), watchers: [...t.members].filter((w) => w.svspec).length, bots: seated.filter((s) => s.bot).length });
  }
  return res;
}

// ---------------------------------------------------------------- 計時
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
      const h = t.h, s = t.seats[h.turn];
      if ((isAuto(s) && n >= h.botAt) || n >= h.deadline) { if (botAct(t, h.turn)) push(t); }
    } catch (e) { console.log("排七錯誤", e && e.stack); }
  }
}
setInterval(tick, 200).unref();

// ---------------------------------------------------------------- 連線
export function sevensClose(ws) {
  const t = ws.svtable; if (!t) return;
  t.members.delete(ws);
  const i = t.seats.findIndex((s) => s && s.ws === ws);
  if (i >= 0) { t.seats[i].ws = null; if (!t.started) t.seats[i] = null; }
  ws.svtable = null;
  push(t);
}
export function handleSevens(ws, m) {
  if (m.t === "svjoin") {
    if (ws.svtable) sevensClose(ws);
    const t = getTable(String(m.room || "default").slice(0, 80));
    ws.svtable = t; ws.svspec = !!m.spectate; if (cleanName(m.name)) ws.svname = cleanName(m.name);
    ws.svpid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    if (!ws.svspec) { const i = t.seats.findIndex((s) => s && !s.bot && s.pid === ws.svpid); if (i >= 0) { t.seats[i].ws = ws; t.seats[i].name = nameOf(ws); } }
    push(t); return true;
  }
  const t = ws.svtable; if (!t) return false;
  if (ws.svspec) return true;
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  if (m.t === "svsit") {
    if (mine >= 0) return true;
    let i = Number(m.seat);
    if (!Number.isInteger(i) || i < 0 || i > 3) i = t.seats.findIndex((s) => !s);
    if (i >= 0 && t.seats[i] && !(t.seats[i].bot && t.started)) i = t.seats.findIndex((x) => !x);
    if (i < 0) return out(ws, { t: "sverr", error: "full" }), true;
    if (t.seats[i] && t.seats[i].bot) { const old = t.seats[i]; t.seats[i] = mkSeat({ ws, pid: ws.svpid, name: nameOf(ws), points: old.points }); t.log = `${nameOf(ws)} 接手 ${old.name} 的位置`; }
    else { t.seats[i] = mkSeat({ ws, pid: ws.svpid, name: nameOf(ws) }); t.log = `${nameOf(ws)} 入座`; }
    push(t);
  } else if (m.t === "svstand") {
    if (mine < 0) return true;
    const s = t.seats[mine];
    if (t.started) { t.seats[mine] = mkSeat({ bot: true, name: pickBotName(t), points: s.points }); t.log = `${s.name} 離座，由 ${t.seats[mine].name} 接手`; }
    else t.seats[mine] = null;
    push(t);
  } else if (m.t === "svaddbot") {
    if (mine < 0 || t.started) return true;
    const k = Number(m.seat);
    const i = Number.isInteger(k) && k >= 0 && k <= 3 && !t.seats[k] ? k : t.seats.findIndex((s) => !s);
    if (i < 0) return true;
    t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) }); push(t);
  } else if (m.t === "svdelbot") {
    const s = t.seats[Number(m.seat)];
    if (mine < 0 || !s || !s.bot || t.started) return true;
    t.seats[Number(m.seat)] = null; push(t);
  } else if (m.t === "svname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.svname = nm; if (mine >= 0) t.seats[mine].name = nm; push(t);
  } else if (m.t === "svcfg") {
    if (mine < 0 || t.started) return true;
    if (LENS.includes(Number(m.len))) t.cfg.len = Number(m.len);
    if (STAKES.includes(Number(m.base))) t.cfg.base = Number(m.base);
    t.log = `${nameOf(ws)} 調整設定`; push(t);
  } else if (m.t === "svstart") {
    if (mine < 0 || t.started) return true;
    startGame(t); t.log = `${nameOf(ws)} 按下開始｜` + t.log; push(t);
  } else if (m.t === "svact") {
    if (mine < 0 || t.phase !== "play") return true;
    const a = String(m.a || "");
    const ok = a === "play" ? doPlay(t, mine, Number(m.card)) : a === "cover" ? doCover(t, mine, Number(m.card)) : false;
    if (ok) push(t); else out(ws, { t: "sverr", error: "illegal" });
  }
  return true;
}

// 測試用：四個座位都由電腦打完一場，回傳步數和點數
export function _simGame(len = 1) {
  const t = newTable("sim"); t.cfg.len = len;
  startGame(t);
  let steps = 0;
  while (steps < 5000) {
    if (t.phase === "play") { if (!botAct(t, t.h.turn)) throw new Error("電腦動不了"); steps++; }
    else if (t.phase === "result" && !t.result.gameOver) startHand(t);
    else break;
  }
  return { steps, result: t.result, points: t.seats.map((s) => s.points) };
}
