// UNO（練習點數）：2～8 人（真人或電腦都可以），按開始時有幾個人入座就幾個人玩。標準 108 張牌（5 人以上自動改用兩副 216 張），每人 7 張，先出完手牌的人贏這一手。
// 牌的編號：0..99 是四色數字／功能牌（紅黃綠藍各 25 張：一張 0、1～9 各兩張、跳過 / 迴轉 / +2 各兩張），100..103 是變色牌，104..107 是變色 +4。
// 規則（標準 UNO）：出的牌要跟桌上最上面那張同色、同數字或同符號，變色牌隨時可出（出的時候要選新顏色）。
// 跳過：下家被跳過；迴轉：反方向（兩個人時等於跳過）；+2：下家抽 2 張並被跳過；變色 +4：選顏色，下家抽 4 張並被跳過。
// 可疊加（開桌可關）：被 +2 的人可以再出 +2（或 +4）轉給下家，累計張數；被 +4 的人可以再出 +4；不想疊或不能疊的人把累計的牌全部抽起來並被跳過。
// 可質疑 +4（開桌可關）：+4 本來只能在手上沒有「目前顏色」的牌時出；被 +4 的人可以質疑：出牌的人真的有該色牌 → 他抽 4 張、你照常出牌；沒有 → 你抽 6 張並被跳過。
// 喊 UNO：剩最後一張時要按「UNO!」（剩 2 張要出牌前也可以先按）；沒喊的話，在下一位玩家動作之前被別人「抓」到，罰抽 2 張。
// 起始牌若是功能牌也會生效（跳過／迴轉／+2／變色）。輪到你時可以出牌，或按「抽牌」一次抽一張（手上有能出的牌也可以抽，想抽幾張都行）；沒有「過」，一定要出牌才會換人；牌堆抽光了才換下家。
// 計分：贏的人收其他人手上剩的牌點（數字牌＝面值、功能牌 20、變色牌 50）× 每點點數，輸的人各付自己的。
// 伺服器負責發牌、判定、計分與電腦；前端只畫畫面和送操作。
import { randomInt, randomBytes } from "node:crypto";

const START_POINTS = 10000;
const DEFAULT_CFG = { len: 3, base: 1, stack: true, challenge: true };
const LENS = [1, 3, 5, 10];
const STAKES = [1, 2, 5, 10];
const TURN_MS = 30000, RESULT_MS = 10000, BOT_MS = [900, 1700];
const MAXP = 8;
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "牌神", "胖虎"];

// ---- 牌
const colorOf = (c) => ((c %= 108) < 100 ? Math.floor(c / 25) : 4);                // 兩副牌時編號 108 以上是第二副，花色和功能跟 c%108 相同                 // 0 紅 1 黃 2 綠 3 藍 4 變色牌
const kindOf = (c) => { c %= 108;                                                  // "n" 數字 "s" 跳過 "r" 迴轉 "d" +2 "w" 變色 "f" 變色+4
  if (c >= 104) return "f"; if (c >= 100) return "w";
  const k = c % 25; return k === 0 ? "n" : k <= 18 ? "n" : k <= 20 ? "s" : k <= 22 ? "r" : "d";
};
const numOf = (c) => { if (kindOf(c) !== "n") return -1; const k = (c % 108) % 25; return k === 0 ? 0 : Math.ceil(k / 2); };
const pointOf = (c) => { const k = kindOf(c); return k === "n" ? numOf(c) : k === "w" || k === "f" ? 50 : 20; };
const COLORS = ["紅", "黃", "綠", "藍"];
const cardName = (c) => { const k = kindOf(c); return k === "w" ? "變色牌" : k === "f" ? "變色+4" : COLORS[colorOf(c)] + ({ n: numOf(c), s: "跳過", r: "迴轉", d: "+2" }[k]); };

const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.unname || ws.user?.name || "玩家";
const tables = new Map();
const now = () => Date.now();

function newTable(id) {
  return { id, members: new Set(), seats: Array(MAXP).fill(null), started: false, phase: "wait", cfg: { ...DEFAULT_CFG }, g: null, h: null, log: "等玩家入座…", result: null, final: null, nextAt: 0, botHist: new Set() };
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
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sortHand = (h) => h.slice().sort((a, b) => colorOf(a) - colorOf(b) || (kindOf(a) === "n" ? numOf(a) : 20) - (kindOf(b) === "n" ? numOf(b) : 20) || a - b);

// ---------------------------------------------------------------- 規則
const canPlayOn = (h, c) => {
  const k = kindOf(c); if (k === "w" || k === "f") return true;
  const top = h.top;
  if (colorOf(c) === h.color) return true;
  if (kindOf(top) === "n" && k === "n" && numOf(c) === numOf(top)) return true;
  if (k !== "n" && k === kindOf(top) && colorOf(top) !== 4) return true;          // 同符號（跳過、迴轉、+2）
  return false;
};
const stackable = (hand, kind) => hand.filter((c) => kindOf(c) === "f" || (kindOf(c) === "d" && kind === "d"));
const playable = (h, i) => (h.pend ? (h.pend.canStack ? stackable(h.hands[i], h.pend.kind) : []) : h.hands[i].filter((c) => canPlayOn(h, c)));
const nextSeat = (h, i, steps = 1) => { let j = i; for (let k = 0; k < steps; k++) j = (j + h.dir + h.n) % h.n; return j; };

// ---------------------------------------------------------------- 開局、發牌
function mkDeck(n) { return shuffle(Array.from({ length: n >= 5 ? 216 : 108 }, (_, i) => i)); }          // 5 人以上用兩副牌
function drawCards(h, i, n) {
  const got = [];
  for (let k = 0; k < n; k++) {
    if (!h.deck.length) {                                                // 抽牌堆用完：把棄牌堆（留最上面那張）洗回去
      const keep = h.discard.pop(); h.deck = shuffle(h.discard); h.discard = [keep];
      if (!h.deck.length) break;
    }
    got.push(h.deck.pop());
  }
  h.hands[i] = sortHand(h.hands[i].concat(got));
  return got;
}
function startGame(t) {
  t.seats = t.seats.filter(Boolean);                                  // 只留有人坐的座位（真人或電腦），座位編號重新排成 0..n-1
  for (const s of t.seats) s.points = START_POINTS;
  t.g = { handNo: 0, starter: randomInt(t.seats.length) };
  t.started = true; t.final = null;
  startHand(t);
}
function startHand(t) {
  const g = t.g; g.handNo++;
  const n = t.seats.length;
  const deck = mkDeck(n);
  const hands = Array.from({ length: n }, () => []);
  for (let k = 0; k < 7; k++) for (let i = 0; i < n; i++) hands[i].push(deck.pop());
  let top = deck.pop();
  const rest = [];
  while (kindOf(top) === "f") { rest.push(top); top = deck.pop(); }          // 起始牌不能是 +4（放回去重翻）
  deck.push(...rest); shuffle(deck);
  let start = (g.starter + g.handNo - 1) % n;
  const h = { n, deck, discard: [top], hands: hands.map(sortHand), top, color: colorOf(top), dir: 1, turn: start, drawn: null, deadline: 0, botAt: 0, last: null, pend: null, uno: null, preCall: -1 };
  t.h = h; t.result = null; t.phase = "play";
  t.log = `第 ${g.handNo} 手，由 ${t.seats[start].name} 先出`;
  const k0 = kindOf(top);                                                    // 起始牌是功能牌：照規則生效
  if (k0 === "s") { t.log += `（起始牌跳過，直接換 ${t.seats[nextSeat(h, start)].name}）`; start = nextSeat(h, start); }
  else if (k0 === "r") { h.dir = -1; t.log += "（起始牌迴轉，逆時針出牌）"; }
  else if (k0 === "d") { drawCards(h, start, 2); t.log += `（起始牌 +2，${t.seats[start].name} 抽 2 張並跳過）`; start = nextSeat(h, start); }
  else if (k0 === "w") { h.color = randomInt(4); t.log += `（起始牌變色，顏色定為${COLORS[h.color]}色）`; }
  setTurn(t, start);
}
function setTurn(t, i) {
  const h = t.h; h.turn = i; h.drawn = null; h.preCall = -1; h.deadline = now() + TURN_MS;
  h.botAt = now() + BOT_MS[0] + randomInt(BOT_MS[1] - BOT_MS[0]);
}

// ---------------------------------------------------------------- 出牌、抽牌、過
function setUno(t, i) {                                                    // 剩最後一張：有沒有喊 UNO
  const h = t.h, st = t.seats[i];
  const called = h.preCall === i || (isAuto(st) ? (st.bot ? Math.random() < 0.85 : true) : false);
  h.uno = { seat: i, called, catchAt: now() + 600 + randomInt(900) };
}
function doPlay(t, i, c, color) {
  const h = t.h; if (!h || h.turn !== i || !Number.isInteger(c) || !h.hands[i].includes(c)) return false;
  const k = kindOf(c), wasPend = h.pend;
  if (wasPend) { if (!wasPend.canStack || !stackable([c], wasPend.kind).length) return false; }
  else { if (!canPlayOn(h, c)) return false; }
  let col = colorOf(c);
  if (k === "w" || k === "f") { col = Number(color); if (!Number.isInteger(col) || col < 0 || col > 3) return false; }
  const hadColor = h.hands[i].some((x) => x !== c && colorOf(x) === h.color);       // +4 合法性：手上有沒有「目前顏色」的牌
  h.uno = null;
  h.hands[i] = h.hands[i].filter((x) => x !== c);
  h.discard.push(c); h.top = c; h.color = col; h.pend = null;
  h.last = { seat: i, card: c, color: col, draw: 0 };
  let msg = `${t.seats[i].name} ${wasPend ? "疊上 " : "出 "}${cardName(c)}${k === "w" || k === "f" ? `（改成${COLORS[col]}色）` : ""}`;
  const left = h.hands[i].length;
  if (left === 1) { msg += "　剩最後一張！"; setUno(t, i); }
  let nxt = nextSeat(h, i);
  if (k === "d" || k === "f") {
    const amt = k === "d" ? 2 : 4, total = (wasPend ? wasPend.total : 0) + amt, chain = wasPend ? wasPend.chain + 1 : 1, v = nxt;
    if (!left) { drawCards(h, v, total); h.last.draw = total; t.log = msg + `（${t.seats[v].name} 抽 ${total} 張）`; settle(t, i); return true; }
    const canChal = k === "f" && chain === 1 && t.cfg.challenge; void nxt;
    // 不管能不能疊、能不能質疑，被打到的人都要自己按「抽牌」（沒得疊時只有這個選項）
    h.pend = { kind: k, total, chain, from: i, victim: v, illegal: k === "f" && chain === 1 && hadColor, canChal };
    h.pend.canStack = !!t.cfg.stack;
    msg += `（累計 ${total} 張，等 ${t.seats[v].name} 決定）`;
    t.log = msg; setTurn(t, v); return true;
  } else if (!left) { t.log = msg; settle(t, i); return true; }
  else if (k === "r") { h.dir = -h.dir; nxt = h.n === 2 ? i : nextSeat(h, i); if (h.n === 2) msg += "（迴轉＝再出一次）"; else msg += "（轉向）"; }
  else if (k === "s") { const sk = nxt; nxt = nextSeat(h, nxt); msg += `（${t.seats[sk].name} 被跳過）`; }
  t.log = msg;
  setTurn(t, nxt);
  return true;
}
function doAccept(t, i) {                                                  // 不疊、不質疑：把累計的牌全部抽起來
  const h = t.h; if (!h || !h.pend || h.turn !== i) return false;
  const p = h.pend; h.uno = null; h.pend = null;
  drawCards(h, i, p.total); h.last = { seat: i, card: -1, draw: p.total };
  t.log = `${t.seats[i].name} 抽 ${p.total} 張並被跳過`;
  setTurn(t, nextSeat(h, i)); return true;
}
function doChallenge(t, i) {
  const h = t.h; if (!h || !h.pend || h.turn !== i || !h.pend.canChal) return false;
  const p = h.pend; h.uno = null; h.pend = null;
  const from = t.seats[p.from].name, me = t.seats[i].name;
  if (p.illegal) {                                                         // 質疑成功：出 +4 的人其實有該色牌
    drawCards(h, p.from, p.total); h.last = { seat: p.from, card: -1, draw: p.total };
    t.log = `${me} 質疑成功！${from} 手上有同色牌，罰抽 ${p.total} 張，${me} 照常出牌`;
    setTurn(t, i);
  } else {                                                                 // 質疑失敗：多抽 2 張
    const n = p.total + 2; drawCards(h, i, n); h.last = { seat: i, card: -1, draw: n };
    t.log = `${me} 質疑失敗，${from} 沒有同色牌。${me} 抽 ${n} 張並被跳過`;
    setTurn(t, nextSeat(h, i));
  }
  return true;
}
function doCall(t, i) {                                                    // 喊 UNO
  const h = t.h; if (!h) return false;
  if (h.uno && h.uno.seat === i) { if (!h.uno.called) { h.uno.called = true; t.log = `${t.seats[i].name} 喊 UNO！`; } return true; }
  if (h.turn === i && h.hands[i].length === 2 && !h.pend) { h.preCall = i; return true; }
  return false;
}
function doCatch(t, by, seat) {                                            // 抓沒喊 UNO 的人
  const h = t.h; if (!h || !h.uno || h.uno.seat !== seat || seat === by) return "none";
  if (h.uno.called) return "called";
  drawCards(h, seat, 2); h.last = { seat, card: -1, draw: 2 };
  t.log = `${t.seats[by].name} 抓到 ${t.seats[seat].name} 沒喊 UNO，罰抽 2 張`;
  h.uno = null; return "ok";
}
function doDraw(t, i) {                                                    // 每按一次「抽牌」抽一張，沒得出就繼續按，直到抽到能出的牌
  const h = t.h; if (!h || h.turn !== i || h.pend) return false;
  h.uno = null;
  const got = drawCards(h, i, 1);
  h.last = { seat: i, card: -1, draw: 1 };
  if (!got.length) { t.log = `${t.seats[i].name} 牌堆抽光了，過`; setTurn(t, nextSeat(h, i)); return true; }
  h.deadline = now() + TURN_MS; h.botAt = now() + BOT_MS[0];
  t.log = `${t.seats[i].name} 抽了一張牌`;                                              // 不管能不能出都可以繼續抽；只有出牌才會換人
  return true;
}
function doPass(t, i) {
  const h = t.h; if (!h || h.turn !== i || h.drawn == null) return false;
  h.uno = null;
  t.log = `${t.seats[i].name} 抽到的牌不出，過`;
  setTurn(t, nextSeat(h, i));
  return true;
}

// ---------------------------------------------------------------- 結算
function settle(t, w) {
  const h = t.h, base = t.cfg.base;
  const pts = h.hands.map((cs) => cs.reduce((a, c) => a + pointOf(c), 0));
  const deltas = h.hands.map(() => 0);
  for (let i = 0; i < h.n; i++) if (i !== w) { deltas[i] = -pts[i] * base; deltas[w] += pts[i] * base; }
  deltas.forEach((d, i) => { t.seats[i].points += d; });
  const gameOver = t.g.handNo >= t.cfg.len;
  t.result = { handNo: t.g.handNo, winner: w, deltas, pts, hands: h.hands.map((x) => x.slice()), gameOver };
  t.log = `${t.seats[w].name} 出完牌，贏了第 ${t.g.handNo} 手！`;
  t.phase = "result"; t.nextAt = now() + RESULT_MS;
}
function finishGame(t) {
  t.final = t.seats.map((s) => ({ name: s.name, points: s.points })).sort((a, b) => b.points - a.points);
  t.phase = "end"; t.started = false; t.h = null; t.result = null;
  t.log = "牌局結束";
  t.seats = t.seats.filter((s) => s.bot || s.ws);                       // 離線的真人移出座位
  while (t.seats.length < MAXP) t.seats.push(null);
}

// ---------------------------------------------------------------- 電腦
function pickColor(hand, c) { const cc = [0, 0, 0, 0]; for (const x of hand) if (x !== c && colorOf(x) < 4) cc[colorOf(x)]++; return Math.max(...cc) === 0 ? randomInt(4) : cc.indexOf(Math.max(...cc)); }
function botPend(t, i) {
  const h = t.h, p = h.pend;
  if (p.canChal && Math.random() < (h.hands[i].length >= 6 ? 0.15 : 0.3)) return doChallenge(t, i);
  const ps = playable(h, i);
  if (ps.length && Math.random() < 0.85) { const c = ps.find((x) => kindOf(x) === p.kind) ?? ps[0]; return doPlay(t, i, c, kindOf(c) === "f" ? pickColor(h.hands[i], c) : undefined); }
  return doAccept(t, i);
}
function botAct(t, i) {
  const h = t.h, hand = h.hands[i];
  if (h.pend) return botPend(t, i);
  let ps = playable(h, i);
  if (t.cfg.challenge && hand.some((x) => colorOf(x) === h.color) && Math.random() > 0.1) ps = ps.filter((c) => kindOf(c) !== "f");   // 有同色牌就不亂出 +4（偶爾唬人）
  if (!ps.length) return h.drawn != null ? doPass(t, i) : doDraw(t, i);
  const minOpp = Math.min(...h.hands.map((x, k) => (k === i ? 99 : x.length)));
  const cnt = [0, 0, 0, 0]; for (const c of hand) if (colorOf(c) < 4) cnt[colorOf(c)]++;
  const bestColor = () => cnt.indexOf(Math.max(...cnt));
  const score = (c) => {
    const k = kindOf(c);
    let s = Math.random() * 1.5;
    if (k === "n") s += numOf(c) * 0.3 + (cnt[colorOf(c)] > 2 ? 1 : 0);          // 數字牌：優先出大的、出手上多的顏色
    else if (k === "w") s += -4;                                                   // 變色牌留到最後
    else if (k === "f") s += minOpp <= 2 ? 6 : -6;                                 // +4 只在有人快贏的時候用
    else s += minOpp <= 3 ? 4 : 1.5;                                               // 跳過/迴轉/+2：有人快贏時優先
    return s;
  };
  const c = ps.map((x) => [x, score(x)]).sort((a, b) => b[1] - a[1])[0][0];
  const k = kindOf(c);
  let color;
  if (k === "w" || k === "f") color = pickColor(hand, c);
  void bestColor;
  return doPlay(t, i, c, color);
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.seats.findIndex((s) => s && s.ws === ws && !ws.unspec);
  const h = t.h;
  const v = { t: "unstate", phase: t.phase, started: t.started, cfg: t.cfg, lens: LENS, stakes: STAKES, you, log: t.log, now: now(),
    watchers: [...t.members].filter((w) => w.unspec).length, final: t.final, handNo: t.g ? t.g.handNo : 0 };
  v.seats = t.seats.map((s, i) => s && { i, name: s.name, bot: s.bot, away: !s.bot && !s.ws, points: s.points, count: h ? h.hands[i].length : 0 });
  if (h && t.phase === "play") {
    Object.assign(v, { turn: h.turn, top: h.top, color: h.color, dir: h.dir, deck: h.deck.length, last: h.last, deadline: h.deadline, pend: h.pend ? { kind: h.pend.kind, total: h.pend.total, from: h.pend.from, victim: h.pend.victim, canChal: h.pend.canChal } : null, unoSeat: h.uno && h.uno.called ? h.uno.seat : -1, drawn: h.drawn != null && h.turn === you ? h.drawn : null });
    if (you >= 0) { v.hand = h.hands[you]; v.playable = h.turn === you ? playable(h, you) : []; v.canDraw = h.turn === you && !h.pend; v.canAccept = !!h.pend && h.turn === you; v.canPass = false; }
  }
  if (t.phase === "result") { v.result = t.result; v.nextAt = t.nextAt; if (t.h) { v.top = t.h.top; v.color = t.h.color; } }
  return v;
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listUnoTables() {
  const res = [];
  for (const t of tables.values()) {
    const seated = t.seats.filter(Boolean);
    if (!seated.some((s) => !s.bot)) continue;
    res.push({ game: "uno", id: t.id, players: seated.filter((s) => !s.bot).map((s) => ({ name: s.name, real: false, playing: false })), watchers: [...t.members].filter((w) => w.unspec).length, bots: seated.filter((s) => s.bot).length });
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
    if (!humans.length && t.phase !== "wait" && t.phase !== "end") { t.seats = Array(MAXP).fill(null); t.phase = "wait"; t.started = false; t.h = null; t.g = null; t.result = null; t.log = "等玩家入座…"; push(t); continue; }
    try {
      if (t.phase === "result") { if (n >= t.nextAt) { if (t.result.gameOver) finishGame(t); else startHand(t); push(t); } continue; }
      if (t.phase !== "play") continue;
      const h = t.h, s = t.seats[h.turn];
      if (h.uno && !h.uno.called && n >= h.uno.catchAt) {                   // 電腦抓沒喊 UNO 的人
        const bots = t.seats.map((x, k) => (x && x.bot && k !== h.uno.seat ? k : -1)).filter((k) => k >= 0);
        if (bots.length && Math.random() < 0.7) { doCatch(t, bots[randomInt(bots.length)], h.uno.seat); push(t); continue; }
        h.uno.catchAt = Infinity;
      }
      if ((isAuto(s) && n >= h.botAt) || n >= h.deadline) { if (botAct(t, h.turn)) push(t); }
    } catch (e) { console.log("UNO 錯誤", e && e.stack); }
  }
}
setInterval(tick, 200).unref();

// ---------------------------------------------------------------- 連線
export function unoClose(ws) {
  const t = ws.untable; if (!t) return;
  t.members.delete(ws);
  const i = t.seats.findIndex((s) => s && s.ws === ws);
  if (i >= 0) { t.seats[i].ws = null; if (!t.started) t.seats[i] = null; }
  ws.untable = null;
  push(t);
}
export function handleUno(ws, m) {
  if (m.t === "unjoin") {
    if (ws.untable) unoClose(ws);
    const t = getTable(String(m.room || "default").slice(0, 80));
    ws.untable = t; ws.unspec = !!m.spectate; if (cleanName(m.name)) ws.unname = cleanName(m.name);
    ws.unpid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    if (!ws.unspec) { const i = t.seats.findIndex((s) => s && !s.bot && s.pid === ws.unpid); if (i >= 0) { t.seats[i].ws = ws; t.seats[i].name = nameOf(ws); } }
    push(t); return true;
  }
  const t = ws.untable; if (!t) return false;
  if (ws.unspec) return true;
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  if (m.t === "unsit") {
    if (mine >= 0) return true;
    let i = Number(m.seat);
    if (!Number.isInteger(i) || i < 0 || i >= MAXP) i = t.seats.findIndex((s) => !s);
    if (i >= 0 && t.seats[i] && !(t.seats[i].bot && t.started)) i = t.seats.findIndex((x) => !x);
    if (i < 0) return out(ws, { t: "unerr", error: "full" }), true;
    if (t.seats[i] && t.seats[i].bot) { const old = t.seats[i]; t.seats[i] = mkSeat({ ws, pid: ws.unpid, name: nameOf(ws), points: old.points }); t.log = `${nameOf(ws)} 接手 ${old.name} 的位置`; }
    else { t.seats[i] = mkSeat({ ws, pid: ws.unpid, name: nameOf(ws) }); t.log = `${nameOf(ws)} 入座`; }
    push(t);
  } else if (m.t === "unstand") {
    if (mine < 0) return true;
    const s = t.seats[mine];
    if (t.started) { t.seats[mine] = mkSeat({ bot: true, name: pickBotName(t), points: s.points }); t.log = `${s.name} 離座，由 ${t.seats[mine].name} 接手`; }
    else t.seats[mine] = null;
    push(t);
  } else if (m.t === "unaddbot") {
    if (mine < 0 || t.started) return true;
    const k = Number(m.seat);
    const i = Number.isInteger(k) && k >= 0 && k < MAXP && !t.seats[k] ? k : t.seats.findIndex((s) => !s);
    if (i < 0) return true;
    t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) }); push(t);
  } else if (m.t === "undelbot") {
    const s = t.seats[Number(m.seat)];
    if (mine < 0 || !s || !s.bot || t.started) return true;
    t.seats[Number(m.seat)] = null; push(t);
  } else if (m.t === "unname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.unname = nm; if (mine >= 0) t.seats[mine].name = nm; push(t);
  } else if (m.t === "uncfg") {
    if (mine < 0 || t.started) return true;
    if (LENS.includes(Number(m.len))) t.cfg.len = Number(m.len);
    if (STAKES.includes(Number(m.base))) t.cfg.base = Number(m.base);
    if (typeof m.stack === "boolean") t.cfg.stack = m.stack;
    if (typeof m.challenge === "boolean") t.cfg.challenge = m.challenge;
    t.log = `${nameOf(ws)} 調整設定`; push(t);
  } else if (m.t === "unstart") {
    if (mine < 0 || t.started) return true;
    if (t.seats.filter(Boolean).length < 2) return out(ws, { t: "unerr", error: "need2" }), true;
    startGame(t); t.log = `${nameOf(ws)} 按下開始｜` + t.log; push(t);
  } else if (m.t === "uncall") {
    if (t.phase === "play" && doCall(t, mine)) push(t);
  } else if (m.t === "uncatch") {
    if (t.phase !== "play") return true;
    const r = doCatch(t, mine, Number(m.seat));
    if (r === "ok") push(t); else out(ws, { t: "unerr", error: r === "called" ? "called" : "none" });
  } else if (m.t === "unact") {
    if (mine < 0 || t.phase !== "play") return true;
    const a = String(m.a || "");
    const ok = a === "play" ? doPlay(t, mine, Number(m.card), m.color) : a === "draw" ? doDraw(t, mine) : a === "accept" ? doAccept(t, mine) : a === "challenge" ? doChallenge(t, mine) : false;
    if (ok) push(t); else out(ws, { t: "unerr", error: "illegal" });
  }
  return true;
}

// 測試用：四個座位都由電腦打完一場，回傳步數和點數
export function _simGame(len = 1, n = 4) {
  const t = newTable("sim"); t.cfg.len = len;
  for (let i = 0; i < n; i++) t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) });
  startGame(t);
  let steps = 0;
  while (steps < 20000) {
    if (t.phase === "play") { if (!botAct(t, t.h.turn)) throw new Error("電腦動不了"); steps++; }
    else if (t.phase === "result" && !t.result.gameOver) startHand(t);
    else break;
  }
  return { steps, result: t.result, points: t.seats.map((s) => s.points) };
}

// 測試用：指定手牌，回傳疊 +4 的過程
export function _scenario() {
  const t = newTable("scn"); for (let i = 0; i < 3; i++) t.seats[i] = mkSeat({ bot: true, name: "b" + i });
  startGame(t); const h = t.h;
  h.hands = [[104, 5, 6], [105, 7, 8], [9, 10, 11]]; h.top = 1; h.color = 0; h.dir = 1; setTurn(t, 0);
  const o = [];
  o.push(doPlay(t, 0, 104, 2)); o.push(JSON.stringify(h.pend)); o.push(JSON.stringify(playable(h, 1)));
  o.push(doPlay(t, 1, 105, 3)); o.push(JSON.stringify(h.pend)); o.push(h.turn);
  return o;
}
export function _deal(n) { const t = newTable("d"); for (let i = 0; i < n; i++) t.seats[i] = mkSeat({ bot: true, name: "b" + i }); startGame(t); return { hands: t.h.hands.map((x) => x.map((c) => kindOf(c)).join("")), deck: t.h.deck.length }; }
