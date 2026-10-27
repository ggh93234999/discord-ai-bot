// 大老二（台灣玩法，練習點數）：4 人各 13 張，先出完的人贏。
// 牌型：單張、對子、三條、五張（順子、葫蘆）；鐵支和同花順是炸彈，可以直接壓任何非炸彈的牌，同花順 > 鐵支；一條龍（3 到 2 各一張，13 張）最大，壓全部。大小順序 3 < … < K < A < 2，同點比花色 ♣ < ♦ < ♥ < ♠。
// 第一手由 ♣3 的人先出（第一次出牌一定要包含 ♣3）；之後每手由上一手的贏家先出。
// 別人出牌後要出同張數且同牌型、更大的牌（炸彈例外），或「過」；連續三家都過，最後出牌的人可以自由出任何牌型。
// 伺服器負責發牌、判定、計分與電腦；前端只畫畫面和送操作。
import { randomInt, randomBytes } from "node:crypto";
import { classify, beats, cardsText, sortHand, strength, rstr, suitOf, CLUB3, TYPE_NAMES } from "../shared/bigtwo_rules.js";

const START_POINTS = 10000;
const DEFAULT_CFG = { len: 3, base: 20, triple: false };
const LENS = [1, 3, 5, 10];
const STAKES = [5, 10, 20, 50, 100];
const TURN_MS = 30000, RESULT_MS = 10000, BOT_MS = [700, 1500];
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "牌神", "胖虎"];

const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.btname || ws.user?.name || "玩家";
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

// ---------------------------------------------------------------- 開局、發牌
function deal() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return [0, 1, 2, 3].map((k) => sortHand(d.slice(k * 13, k * 13 + 13)));
}
function startGame(t) {
  for (let i = 0; i < 4; i++) if (!t.seats[i]) t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) });
  for (const s of t.seats) s.points = START_POINTS;
  t.g = { handNo: 0, lead: -1 };
  t.started = true; t.final = null;
  startHand(t);
}
function startHand(t) {
  const g = t.g; g.handNo++;
  const hands = deal();
  const club = true;                                        // 每一手都是持有 ♣3 的人先出（不論上一手誰贏）
  const first = hands.findIndex((h) => h.includes(CLUB3));
  t.h = { hands, turn: first, last: null, passes: 0, passed: new Set(), mustClub: club, deadline: 0, botAt: 0 };
  t.result = null; t.phase = "play";
  t.log = `第 ${g.handNo} 手，由 ${t.seats[first].name} 先出${club ? "（持有 ♣3）" : ""}`;
  setTurn(t, first);
}
function setTurn(t, i) {
  const h = t.h; h.turn = i; h.deadline = now() + TURN_MS;
  h.botAt = now() + BOT_MS[0] + randomInt(BOT_MS[1] - BOT_MS[0]);
}

// ---------------------------------------------------------------- 出牌、過
function checkPlay(t, h, i, cards) {
  if (!Array.isArray(cards) || !cards.length || cards.length > 13) return null;
  const mine = new Set(h.hands[i]);
  if (new Set(cards).size !== cards.length || !cards.every((c) => Number.isInteger(c) && mine.has(c))) return null;
  const combo = classify(cards); if (!combo || (combo.type === 3 && !t.cfg.triple)) return null;
  if (h.mustClub && !cards.includes(CLUB3)) return null;
  if (h.last && !beats(combo, h.last.combo)) return null;
  return combo;
}
function doPlay(t, i, cards) {
  const h = t.h; if (!h || h.turn !== i) return false;
  const combo = checkPlay(t, h, i, cards); if (!combo) return false;
  const set = new Set(cards);
  h.hands[i] = h.hands[i].filter((c) => !set.has(c));
  h.last = { seat: i, cards: sortHand(cards.slice()), combo, name: TYPE_NAMES[combo.type] };
  h.passes = 0; h.passed = new Set(); h.mustClub = false;
  t.log = `${t.seats[i].name} 出${h.last.name}：${cardsText(h.last.cards)}`;
  if (!h.hands[i].length) { settle(t, i); return true; }
  setTurn(t, (i + 1) % 4);
  return true;
}
function doPass(t, i) {
  const h = t.h; if (!h || h.turn !== i || !h.last || h.last.seat === i) return false;
  h.passes++; h.passed.add(i);
  t.log = `${t.seats[i].name} 過`;
  if (h.passes >= 3) { h.last = null; h.passes = 0; h.passed = new Set(); t.log += `｜三家都過，${t.seats[(i + 1) % 4].name} 重新出牌`; }
  setTurn(t, (i + 1) % 4);
  return true;
}

// ---------------------------------------------------------------- 結算
function settle(t, w) {
  const h = t.h, base = t.cfg.base;
  const deltas = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    if (i === w) continue;
    const r = h.hands[i].length, mult = r >= 13 ? 3 : r >= 10 ? 2 : 1;      // 10 張以上雙倍、13 張全沒出三倍
    deltas[i] = -r * mult * base; deltas[w] -= deltas[i];
  }
  deltas.forEach((d, i) => { t.seats[i].points += d; });
  const gameOver = t.g.handNo >= t.cfg.len;
  t.result = { handNo: t.g.handNo, winner: w, deltas, left: h.hands.map((x) => x.length), hands: h.hands.map((x) => x.slice()), gameOver };
  t.log = `${t.seats[w].name} 先出完，贏了第 ${t.g.handNo} 手`;
  t.phase = "result"; t.nextAt = now() + RESULT_MS;
  t.g.lead = w;
}
function finishGame(t) {
  t.final = t.seats.map((s) => ({ name: s.name, points: s.points })).sort((a, b) => b.points - a.points);
  t.phase = "end"; t.started = false; t.h = null; t.result = null;
  t.log = "牌局結束";
  for (let i = 0; i < 4; i++) if (t.seats[i] && !t.seats[i].bot && !t.seats[i].ws) t.seats[i] = null;
}

// ---------------------------------------------------------------- 電腦
function combos(hand) {
  const res = [], seen = new Set();
  const add = (cs) => { const k = cs.slice().sort((a, b) => a - b).join(","); if (seen.has(k)) return; const cb = classify(cs); if (cb) { seen.add(k); res.push({ cards: cs, combo: cb }); } };
  const byR = {}, byS = [[], [], [], []];
  for (const c of hand) { (byR[rstr(c)] ||= []).push(c); byS[suitOf(c)].push(c); }
  const pick = (arr, k) => { const r = []; (function go(s, cur) { if (cur.length === k) return r.push(cur.slice()); for (let i = s; i < arr.length; i++) { cur.push(arr[i]); go(i + 1, cur); cur.pop(); } })(0, []); return r; };
  for (const c of hand) add([c]);
  for (const r in byR) if (byR[r].length >= 2) for (const p of pick(byR[r], 2)) add(p);
  for (const r in byR) if (byR[r].length >= 3) for (const p of pick(byR[r], 3)) add(p);
  for (let s = 3; s <= 11; s++) {                                      // 順子
    const cols = []; for (let r = s; r < s + 5; r++) cols.push(byR[r] || []);
    if (cols.some((x) => !x.length)) continue;
    let acc = [[]]; for (const col of cols) { const nx = []; for (const a of acc) for (const c of col) nx.push([...a, c]); acc = nx; }
    for (const a of acc) add(a);
  }
  for (const s of byS) if (s.length >= 5) for (const p of pick(s, 5)) add(p);   // 同花順（普通同花 classify 會擋掉）
  if (Object.keys(byR).length === 13) add(hand.slice());                       // 一條龍
  for (const r in byR) {
    if (byR[r].length >= 3) for (const tri of pick(byR[r], 3)) for (const r2 in byR) if (r2 !== r && byR[r2].length >= 2) for (const pr of pick(byR[r2], 2)) add([...tri, ...pr]);   // 葫蘆
    if (byR[r].length === 4) for (const c of hand) if (rstr(c) !== Number(r)) add([...byR[r], c]);                                                                        // 鐵支
  }
  return res;
}
function botMove(t, i) {
  const h = t.h, hand = h.hands[i];
  let cands = combos(hand).filter((x) => (t.cfg.triple || x.combo.type !== 3) && (!h.mustClub || x.cards.includes(CLUB3)) && (!h.last || beats(x.combo, h.last.combo)));
  if (!cands.length) return null;                                       // 只能過
  const fin = cands.find((x) => x.cards.length === hand.length);
  if (fin) return fin.cards;
  const minOpp = Math.min(...[0, 1, 2, 3].filter((k) => k !== i).map((k) => h.hands[k].length));
  if (!h.last) {                                                        // 領出：優先丟掉一串低牌，不輕易先出 2 和 A
    const cost = (x) => x.cards.reduce((s, c) => s + strength(c), 0) / x.cards.length - 3 * x.cards.length + (x.cards.some((c) => rstr(c) >= 14) ? 12 : 0) + (x.cards.length === 1 && minOpp <= 2 ? -10 + 2 * strength(x.cards[0]) / 4 : 0) + Math.random() * 3;
    cands.sort((a, b) => cost(a) - cost(b));
    return cands[0].cards;
  }
  cands.sort((a, b) => a.combo.k - b.combo.k);
  const pick = cands[0];
  if (pick.combo.type >= 7 && h.last.combo.type < 7 && minOpp > 3 && hand.length > 6 && Math.random() < 0.7) return null;   // 不輕易拿炸彈壓小牌
  const spendy = pick.cards.some((c) => rstr(c) >= 14) && hand.length > 5;
  if (spendy && minOpp > 3 && Math.random() < 0.6) return null;         // 沒人快出完時，不拿 A、2 去壓小牌
  return pick.cards;
}
function botAct(t, i) {
  const h = t.h;
  const mv = botMove(t, i);
  if (mv) return doPlay(t, i, mv);
  if (h.last && h.last.seat !== i) return doPass(t, i);
  // 理論上不會發生（領出一定有牌可出）；保險：出最小的單張
  return doPlay(t, i, [h.hands[i][0]]);
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.seats.findIndex((s) => s && s.ws === ws && !ws.btspec);
  const h = t.h;
  const v = { t: "btstate", phase: t.phase, started: t.started, cfg: t.cfg, lens: LENS, stakes: STAKES, you, log: t.log, now: now(),
    watchers: [...t.members].filter((w) => w.btspec).length, final: t.final, handNo: t.g ? t.g.handNo : 0 };
  v.seats = t.seats.map((s, i) => s && { i, name: s.name, bot: s.bot, away: !s.bot && !s.ws, points: s.points, count: h ? h.hands[i].length : 0 });
  if (h && t.phase === "play") {
    Object.assign(v, { turn: h.turn, last: h.last && { seat: h.last.seat, cards: h.last.cards, name: h.last.name }, passed: [...h.passed], mustClub: h.mustClub, deadline: h.deadline });
    if (you >= 0) { v.hand = h.hands[you]; v.canPass = h.turn === you && !!h.last && h.last.seat !== you; }
  }
  if (t.phase === "result") { v.result = t.result; v.nextAt = t.nextAt; }
  return v;
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listBigTwoTables() {
  const res = [];
  for (const t of tables.values()) {
    const seated = t.seats.filter(Boolean);
    if (!seated.some((s) => !s.bot)) continue;
    res.push({ game: "bigtwo", id: t.id, players: seated.filter((s) => !s.bot).map((s) => ({ name: s.name, real: false, playing: false })), watchers: [...t.members].filter((w) => w.btspec).length, bots: seated.filter((s) => s.bot).length });
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
    } catch (e) { console.log("大老二錯誤", e && e.stack); }
  }
}
setInterval(tick, 200).unref();

// ---------------------------------------------------------------- 連線
export function bigtwoClose(ws) {
  const t = ws.bttable; if (!t) return;
  t.members.delete(ws);
  const i = t.seats.findIndex((s) => s && s.ws === ws);
  if (i >= 0) { t.seats[i].ws = null; if (!t.started) t.seats[i] = null; }
  ws.bttable = null;
  push(t);
}
export function handleBigtwo(ws, m) {
  if (m.t === "btjoin") {
    if (ws.bttable) bigtwoClose(ws);
    const t = getTable(String(m.room || "default").slice(0, 80));
    ws.bttable = t; ws.btspec = !!m.spectate; if (cleanName(m.name)) ws.btname = cleanName(m.name);
    ws.btpid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    if (!ws.btspec) { const i = t.seats.findIndex((s) => s && !s.bot && s.pid === ws.btpid); if (i >= 0) { t.seats[i].ws = ws; t.seats[i].name = nameOf(ws); } }
    push(t); return true;
  }
  const t = ws.bttable; if (!t) return false;
  if (ws.btspec) return true;
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  if (m.t === "btsit") {
    if (mine >= 0) return true;
    let i = Number(m.seat);
    if (!Number.isInteger(i) || i < 0 || i > 3) i = t.seats.findIndex((s) => !s);
    if (i >= 0 && t.seats[i] && !(t.seats[i].bot && t.started)) i = t.seats.findIndex((x) => !x);
    if (i < 0) return out(ws, { t: "bterr", error: "full" }), true;
    if (t.seats[i] && t.seats[i].bot) { const old = t.seats[i]; t.seats[i] = mkSeat({ ws, pid: ws.btpid, name: nameOf(ws), points: old.points }); t.log = `${nameOf(ws)} 接手 ${old.name} 的位置`; }
    else { t.seats[i] = mkSeat({ ws, pid: ws.btpid, name: nameOf(ws) }); t.log = `${nameOf(ws)} 入座`; }
    push(t);
  } else if (m.t === "btstand") {
    if (mine < 0) return true;
    const s = t.seats[mine];
    if (t.started) { t.seats[mine] = mkSeat({ bot: true, name: pickBotName(t), points: s.points }); t.log = `${s.name} 離座，由 ${t.seats[mine].name} 接手`; }
    else t.seats[mine] = null;
    push(t);
  } else if (m.t === "btaddbot") {
    if (mine < 0 || t.started) return true;
    const k = Number(m.seat);
    const i = Number.isInteger(k) && k >= 0 && k <= 3 && !t.seats[k] ? k : t.seats.findIndex((s) => !s);
    if (i < 0) return true;
    t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) }); push(t);
  } else if (m.t === "btdelbot") {
    const s = t.seats[Number(m.seat)];
    if (mine < 0 || !s || !s.bot || t.started) return true;
    t.seats[Number(m.seat)] = null; push(t);
  } else if (m.t === "btname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.btname = nm; if (mine >= 0) t.seats[mine].name = nm; push(t);
  } else if (m.t === "btcfg") {
    if (mine < 0 || t.started) return true;
    if (LENS.includes(Number(m.len))) t.cfg.len = Number(m.len);
    if (STAKES.includes(Number(m.base))) t.cfg.base = Number(m.base);
    if (m.triple !== undefined) t.cfg.triple = !!m.triple;
    t.log = `${nameOf(ws)} 調整設定`; push(t);
  } else if (m.t === "btstart") {
    if (mine < 0 || t.started) return true;
    startGame(t); t.log = `${nameOf(ws)} 按下開始｜` + t.log; push(t);
  } else if (m.t === "btact") {
    if (mine < 0 || t.phase !== "play") return true;
    const a = String(m.a || "");
    let ok = false;
    if (a === "play") ok = doPlay(t, mine, Array.isArray(m.cards) ? m.cards.map(Number) : []);
    else if (a === "pass") ok = doPass(t, mine);
    if (ok) push(t); else out(ws, { t: "bterr", error: "illegal" });
  }
  return true;
}

// 測試用：四個座位都由電腦打完一場，回傳每手的步數和點數
export function _simGame(len = 1) {
  const t = newTable("sim"); t.cfg.len = len;
  startGame(t);
  let steps = 0;
  while (steps < 5000) {
    if (t.phase === "play") { if (!botAct(t, t.h.turn)) throw new Error("電腦出不了牌"); steps++; }
    else if (t.phase === "result" && !t.result.gameOver) startHand(t);
    else break;
  }
  return { steps, result: t.result, points: t.seats.map((s) => s.points) };
}
