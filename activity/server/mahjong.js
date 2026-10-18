// 麻將牌桌（練習點數）：台灣 16 張（rule "tw"）和日本立直（rule "jp"）共用同一套流程，計分各自在 mjtw.js / mjjp.js。
// 4 個座位，可加電腦補位；入座後有人按「開始」才開打（空位自動補電腦）。其他人旁觀。
// 伺服器負責洗牌、摸打、吃碰槓、胡牌判定、計分；前端只畫畫面和送操作。
import { randomInt, randomBytes } from "node:crypto";
import { newWall, toCounts, sortTiles, shanten, waitsOf, isHonor, isDragon, isFlower, tileName, kindOf, isAka } from "./mjcore.js";
import { scoreJP, payments } from "./mjjp.js";
import { scoreTW, dealerTai } from "./mjtw.js";

const RULES = {
  jp: { name: "日本麻將", n: 13, sets: 4, start: 25000, flowers: false, endLeft: 0, lens: [1, 2] },
  tw: { name: "台灣麻將", n: 16, sets: 5, start: 20000, flowers: true, endLeft: 16, lens: [1, 4] },
};
const DEFAULT_CFG = { jp: { len: 2, aka: true }, tw: { len: 1, base: 300, tai: 100 } };
const TW_STAKES = [[30, 10], [100, 20], [300, 100], [500, 200], [1000, 300]];
const TURN_MS = 20000, CLAIM_MS = 9000, RESULT_MS = 14000, BOT_MS = [450, 900];
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "雀神", "胖虎"];
const WINDS = "東南西北";

const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.mname || ws.user?.name || "玩家";
const tables = new Map();

function newTable(id, rule) {
  return { id, rule, R: RULES[rule], members: new Set(), seats: [null, null, null, null], started: false, phase: "wait", cfg: { ...DEFAULT_CFG[rule] }, g: null, h: null, log: "等玩家入座…", result: null, final: null, nextAt: 0, botHist: new Set() };
}
function getTable(rule, id) { const k = rule + ":" + id; if (!tables.has(k)) tables.set(k, newTable(id, rule)); return tables.get(k); }

function pickBotName(t) {
  const used = new Set(t.seats.filter(Boolean).map((s) => s.name));
  let pool = BOT_NAMES.filter((n) => !used.has("🤖" + n) && !t.botHist.has(n));
  if (!pool.length) { t.botHist.clear(); pool = BOT_NAMES.filter((n) => !used.has("🤖" + n)); }
  const n = pool[randomInt(pool.length)] || "電腦"; t.botHist.add(n); return "🤖" + n;
}
const mkSeat = (o) => ({ ws: null, pid: null, bot: false, name: "", points: 0, idle: 0, ...o });
const isAuto = (s) => s.bot || !s.ws;                              // 電腦或離線的人：自動打

// ---------------------------------------------------------------- 開局
function startGame(t) {
  for (let i = 0; i < 4; i++) if (!t.seats[i]) t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) });
  for (const s of t.seats) s.points = t.R.start;
  t.g = { dealer: randomInt(4), round: 0, kyoku: 0, honba: 0, sticks: 0, lian: 0, handNo: 0 };
  t.started = true; t.final = null;
  startHand(t);
}
const seatW = (t, i) => (i - t.g.dealer + 4) % 4;

function startHand(t) {
  const R = t.R, g = t.g;
  g.handNo++;
  const wall = newWall(R.flowers, t.rule === "jp" && t.cfg.aka !== false);
  const h = { dealer: g.dealer, wall, dead: [], dora: [], ura: [], p: [], turn: g.dealer, stage: "turn", drawn: null, noCalls: true, kans: 0, rinshan: false, claim: null, opts: null, deadline: 0, last: null };
  if (t.rule === "jp") { h.dead = wall.splice(-14); h.dora = [h.dead[4]]; h.ura = [h.dead[9]]; }
  for (let i = 0; i < 4; i++) h.p.push({ hand: [], melds: [], flowers: [], river: [], riichi: 0, ippatsu: false, firstDone: false, tempFuriten: false, riichiFuriten: false });
  t.h = h; t.result = null; t.phase = "play";
  for (let i = 0; i < 4; i++) { const p = h.p[(g.dealer + i) % 4]; for (let k = 0; k < R.n; k++) p.hand.push(wall.shift()); }
  if (R.flowers) for (let k = 0; k < 4; k++) { const i = (g.dealer + k) % 4; if (replaceFlowers(t, i)) return; }
  for (const p of h.p) sortTiles(p.hand);
  t.log = `${roundLabel(t)} 開始，莊家 ${t.seats[g.dealer].name}`;
  if (!draw(t, g.dealer, false)) return;
  enterTurn(t, g.dealer, false);
}
// 台灣：手上的花全部亮出來，從牌尾補牌；八張花湊齊直接胡（八仙過海）
function replaceFlowers(t, i) {
  const h = t.h, p = h.p[i];
  for (;;) {
    const k = p.hand.findIndex(isFlower);
    if (k < 0) return false;
    p.flowers.push(p.hand.splice(k, 1)[0]);
    if (p.flowers.length === 8) { settleEight(t, i); return true; }
    p.hand.push(h.wall.pop());
  }
}
function wallLeft(t) { return t.h.wall.length - t.R.endLeft; }
// 摸牌；牌摸完了就流局（回傳 false）
function draw(t, i, back) {
  const h = t.h, p = h.p[i];
  if (!back && wallLeft(t) <= 0) { exhaust(t); return false; }
  let tile;
  if (back && t.rule === "jp") { tile = h.dead[h.kans - 1]; h.wall.pop(); }   // 嶺上牌，海底往前移一張
  else tile = back ? h.wall.pop() : h.wall.shift();
  if (t.R.flowers) {
    while (isFlower(tile)) {
      p.flowers.push(tile);
      t.log = `${t.seats[i].name} 補花 ${tileName(tile)}`;
      if (p.flowers.length === 8) { settleEight(t, i); return false; }
      tile = h.wall.pop();
    }
  }
  p.hand.push(tile); h.drawn = tile;
  return true;
}

// ---------------------------------------------------------------- 輪到某人
function needOf(t, p) { return t.R.sets - p.melds.length; }
function scoreCtx(t, i, hand, win, tsumo, extra = {}) {
  const h = t.h, p = h.p[i], g = t.g;
  if (shanten(toCounts(hand), needOf(t, p), t.rule === "jp" && !p.melds.length) !== -1) return null;   // 還沒胡牌形，不用算
  const base = { hand, melds: p.melds, win, tsumo, seatW: seatW(t, i), roundW: g.round % 4, haitei: tsumo && wallLeft(t) <= 0, houtei: !tsumo && wallLeft(t) <= 0, rinshan: tsumo && h.rinshan, chankan: false, ...extra };
  const first = h.noCalls && !p.firstDone;
  if (t.rule === "jp") return scoreJP({ ...base, riichi: p.riichi, ippatsu: p.ippatsu, dora: h.dora, ura: h.ura, tenhou: tsumo && first && i === g.dealer, chiihou: tsumo && first && i !== g.dealer });
  const c = toCounts(hand); c[kindOf(win)]--;
  return scoreTW({ ...base, flowers: p.flowers, waitsN: waitsOf(c, needOf(t, p), false).length, tenhou: tsumo && first && i === g.dealer, chiihou: tsumo && first && i !== g.dealer });
}
function enterTurn(t, i, afterCall) {
  const h = t.h, p = h.p[i];
  h.stage = "turn"; h.turn = i; h.claim = null;
  const o = { kind: "turn", tsumo: false, ankan: [], kakan: [], riichi: [], lock: false };
  if (!afterCall) {
    const sc = scoreCtx(t, i, p.hand, h.drawn, true);
    if (sc) { o.tsumo = true; h.tsumoScore = sc; }
    const c = toCounts(p.hand);
    const kanOk = t.rule === "jp" ? h.kans < 4 : true;
    if (!p.riichi && kanOk && wallLeft(t) > 0) {
      for (let k = 0; k < 34; k++) if (c[k] === 4) o.ankan.push(k);
      for (const m of p.melds) if (m.k === "pon" && c[kindOf(m.tiles[0])]) o.kakan.push(kindOf(m.tiles[0]));
    }
    if (t.rule === "jp" && !p.riichi && p.melds.every((m) => m.k === "ankan") && t.seats[i].points >= 1000 && h.wall.length >= 4) {
      for (const k of new Set(p.hand)) { c[kindOf(k)]--; if (shanten(c, needOf(t, p), true) === 0) o.riichi.push(k); c[kindOf(k)]++; }
    }
    if (p.riichi) o.lock = true;
  }
  h.opts = o;
  const s = t.seats[i];
  h.deadline = Date.now() + (isAuto(s) ? BOT_MS[0] + Math.random() * (BOT_MS[1] - BOT_MS[0]) : p.riichi && !o.tsumo && !o.ankan.length ? 900 : TURN_MS);
}

function removeTiles(hand, tiles) { for (const x of tiles) { const k = hand.indexOf(x); if (k < 0) return false; hand.splice(k, 1); } return true; }
// 依牌種拿掉幾張（赤五也算），回傳實際拿掉的牌（副露要記住有沒有赤五）
function removeKinds(hand, kinds) { const out = []; for (const x of kinds) { let k = hand.findIndex((y) => y === x); if (k < 0) k = hand.findIndex((y) => kindOf(y) === x); if (k < 0) break; out.push(hand.splice(k, 1)[0]); } return out; }

function discard(t, i, tile, riichi) {
  const h = t.h, p = h.p[i], o = h.opts;
  if (h.stage !== "turn" || h.turn !== i || !p.hand.includes(tile)) return false;
  if (o.lock && tile !== h.drawn) return false;
  if (riichi && !o.riichi.includes(tile)) return false;
  if (riichi) {
    p.riichi = h.noCalls && !p.firstDone ? 2 : 1; p.ippatsu = true;
    t.seats[i].points -= 1000; t.g.sticks++;
    t.log = `${t.seats[i].name} ${p.riichi === 2 ? "雙立直" : "立直"}！`;
  } else if (p.riichi) p.ippatsu = false;
  removeTiles(p.hand, [tile]); sortTiles(p.hand);
  p.river.push({ t: tile, called: false, riichi: !!riichi });
  p.firstDone = true; p.tempFuriten = false;
  h.drawn = null; h.rinshan = false; h.last = { seat: i, tile };
  if (!riichi) t.log = `${t.seats[i].name} 打 ${tileName(tile)}`;
  openClaim(t, i, tile, "discard");
  return true;
}

// 別人打牌（或加槓）後：誰可以胡／碰／槓／吃
function canRon(t, j, tile, chankan) {
  const h = t.h, p = h.p[j];
  const hand = [...p.hand, tile];
  if (t.rule === "jp") {
    if (p.tempFuriten || p.riichiFuriten) return null;
    const w = waitsOf(toCounts(p.hand), needOf(t, p), true);
    if (w.some((x) => p.river.some((r) => kindOf(r.t) === x))) return null;   // 振聽：聽的牌自己打過
  }
  return scoreCtx(t, j, hand, tile, false, { chankan });
}
function openClaim(t, from, tile, kind) {
  const h = t.h, opts = {};
  const last = wallLeft(t) <= 0;
  const kt = kindOf(tile);
  for (let k = 1; k < 4; k++) {
    const j = (from + k) % 4, p = h.p[j];
    const c = toCounts(p.hand);
    const o = { kind: "claim", tile, ron: false, pon: false, kan: false, chi: [] };
    const sc = canRon(t, j, tile, kind === "chankan");
    if (sc) { o.ron = true; o.score = sc; }
    if (kind === "discard" && !p.riichi && !last) {
      if (c[kt] >= 2) o.pon = true;
      if (c[kt] >= 3 && (t.rule !== "jp" || h.kans < 4)) o.kan = true;
      if (k === 1 && kt < 27) {
        const n = kt % 9;
        if (n >= 2 && c[kt - 2] && c[kt - 1]) o.chi.push([kt - 2, kt - 1]);
        if (n >= 1 && n <= 7 && c[kt - 1] && c[kt + 1]) o.chi.push([kt - 1, kt + 1]);
        if (n <= 6 && c[kt + 1] && c[kt + 2]) o.chi.push([kt + 1, kt + 2]);
      }
    }
    if (o.ron || o.pon || o.kan || o.chi.length) opts[j] = o;
  }
  if (!Object.keys(opts).length) return afterClaim(t, from, tile, kind, null);
  h.stage = "claim";
  h.claim = { from, tile, kind, opts, resp: {}, deadline: Date.now() + CLAIM_MS };
  for (const j of Object.keys(opts)) if (isAuto(t.seats[j])) h.claim.resp[j] = botClaim(t, Number(j), opts[j]);
  h.claim.botAt = Date.now() + BOT_MS[0] + Math.random() * (BOT_MS[1] - BOT_MS[0]);
  maybeResolve(t);
}
function claimRespond(t, j, a) {
  const c = t.h.claim; if (!c || !c.opts[j] || c.resp[j]) return false;
  const o = c.opts[j];
  if (a.a === "ron" && o.ron) c.resp[j] = { a: "ron" };
  else if (a.a === "pon" && o.pon) c.resp[j] = { a: "pon" };
  else if (a.a === "kan" && o.kan) c.resp[j] = { a: "kan" };
  else if (a.a === "chi" && o.chi.length) {
    const w = Array.isArray(a.with) ? a.with.map(Number) : o.chi[0];
    const ok = o.chi.find((x) => x[0] === w[0] && x[1] === w[1]); if (!ok) return false;
    c.resp[j] = { a: "chi", with: ok };
  } else c.resp[j] = { a: "pass" };
  maybeResolve(t);
  return true;
}
function maybeResolve(t, force) {
  const c = t.h.claim; if (!c) return;
  const seats = Object.keys(c.opts);
  const humansPending = seats.some((j) => !c.resp[j]);
  if (!force && humansPending) return;
  if (!force && Date.now() < c.botAt && seats.some((j) => isAuto(t.seats[j]))) return;   // 電腦假裝想一下
  for (const j of seats) if (!c.resp[j]) c.resp[j] = { a: "pass" };
  const h = t.h;
  // 有能胡卻沒胡的：日麻同巡振聽（立直後永久振聽）
  if (t.rule === "jp") for (const j of seats) if (c.opts[j].ron && c.resp[j].a !== "ron") { h.p[j].tempFuriten = true; if (h.p[j].riichi) h.p[j].riichiFuriten = true; }
  const order = [1, 2, 3].map((k) => (c.from + k) % 4);
  const ron = order.find((j) => c.resp[j] && c.resp[j].a === "ron");
  if (ron !== undefined) { const sc = c.opts[ron].score; h.claim = null; return settleWin(t, ron, c.from, c.tile, sc); }
  const pk = order.find((j) => c.resp[j] && (c.resp[j].a === "pon" || c.resp[j].a === "kan"));
  const ch = order.find((j) => c.resp[j] && c.resp[j].a === "chi");
  h.claim = null;
  if (pk !== undefined) return doCall(t, pk, c, c.resp[pk].a);
  if (ch !== undefined) return doCall(t, ch, c, "chi", c.resp[ch].with);
  afterClaim(t, c.from, c.tile, c.kind, null);
}
function afterClaim(t, from, tile, kind) {
  const h = t.h;
  if (kind === "chankan") { finishKakan(t, from, tile); return; }
  h.claim = null;
  const nx = (from + 1) % 4;
  if (!draw(t, nx, false)) return;
  enterTurn(t, nx, false);
}
function doCall(t, j, c, kind, withT) {
  const h = t.h, p = h.p[j], tile = c.tile;
  h.noCalls = false; for (const q of h.p) q.ippatsu = false;
  const fromP = h.p[c.from]; if (fromP.river.length) fromP.river[fromP.river.length - 1].called = true;
  const name = t.seats[j].name;
  const kt = kindOf(tile);
  if (kind === "chi") { const got = removeKinds(p.hand, withT); p.melds.push({ k: "chi", tiles: sortTiles([...got, tile]), from: c.from, called: tile }); t.log = `${name} 吃 ${tileName(tile)}`; enterTurn(t, j, true); return; }
  if (kind === "pon") { const got = removeKinds(p.hand, [kt, kt]); p.melds.push({ k: "pon", tiles: sortTiles([...got, tile]), from: c.from, called: tile }); t.log = `${name} 碰 ${tileName(tile)}`; enterTurn(t, j, true); return; }
  const got = removeKinds(p.hand, [kt, kt, kt]); p.melds.push({ k: "minkan", tiles: sortTiles([...got, tile]), from: c.from, called: tile });
  t.log = `${name} 槓 ${tileName(tile)}`;
  kanDraw(t, j);
}
function kanDraw(t, j) {
  const h = t.h;
  h.kans++;
  if (t.rule === "jp") { h.dora.push(h.dead[4 + h.kans]); h.ura.push(h.dead[9 + h.kans]); }
  if (!draw(t, j, true)) return;
  h.rinshan = true;
  enterTurn(t, j, false);
}
function doAnkan(t, i, tile) {
  const h = t.h, p = h.p[i];
  if (h.stage !== "turn" || h.turn !== i || !h.opts.ankan.includes(tile)) return false;
  const got = removeKinds(p.hand, [tile, tile, tile, tile]); p.melds.push({ k: "ankan", tiles: sortTiles(got) });
  h.noCalls = false; for (const q of h.p) q.ippatsu = false;
  h.drawn = null; t.log = `${t.seats[i].name} 暗槓`;
  kanDraw(t, i); return true;
}
function doKakan(t, i, tile) {
  const h = t.h, p = h.p[i];
  if (h.stage !== "turn" || h.turn !== i || !h.opts.kakan.includes(tile)) return false;
  const [real] = removeKinds(p.hand, [tile]); h.drawn = null;
  t.log = `${t.seats[i].name} 加槓 ${tileName(real)}`;
  openClaim(t, i, real, "chankan");                               // 先看有沒有人搶槓
  return true;
}
function finishKakan(t, i, tile) {
  const h = t.h, p = h.p[i];
  const m = p.melds.find((x) => x.k === "pon" && kindOf(x.tiles[0]) === kindOf(tile));
  m.k = "kakan"; m.tiles.push(tile);
  h.noCalls = false; for (const q of h.p) q.ippatsu = false;
  kanDraw(t, i);
}
function doTsumo(t, i) {
  const h = t.h;
  if (h.stage !== "turn" || h.turn !== i || !h.opts.tsumo) return false;
  settleWin(t, i, -1, h.drawn, h.tsumoScore); return true;
}

// ---------------------------------------------------------------- 結算
function revealAll(t) { return t.h.p.map((p) => ({ hand: p.hand.slice(), melds: p.melds })); }
function settleWin(t, w, from, tile, sc) {
  const h = t.h, g = t.g, deltas = [0, 0, 0, 0], tsumo = from < 0;
  const winP = h.p[w];
  const hand = tsumo ? winP.hand.slice() : sortTiles([...winP.hand, tile]);
  const res = { kind: tsumo ? "tsumo" : "ron", winner: w, from, tile, hand, melds: winP.melds, flowers: winP.flowers };
  if (t.rule === "jp") {
    const dealer = w === g.dealer;
    const pay = payments(sc.base, dealer, tsumo);
    if (tsumo) for (let j = 0; j < 4; j++) { if (j === w) continue; const x = (j === g.dealer ? pay.tsumo[0] : pay.tsumo[1]) + 100 * g.honba; deltas[j] -= x; deltas[w] += x; }
    else { const x = pay.ron + 300 * g.honba; deltas[from] -= x; deltas[w] += x; }
    deltas[w] += g.sticks * 1000; g.sticks = 0;
    Object.assign(res, { yaku: sc.yaku, han: sc.han, fu: sc.fu, label: sc.label, yakuman: sc.yakuman, dora: h.dora, ura: winP.riichi ? h.ura : [] });
  } else {
    const cfg = t.cfg, dt = dealerTai(g.lian), dSum = dt.reduce((s, x) => s + x[1], 0);
    const payers = tsumo ? [0, 1, 2, 3].filter((j) => j !== w) : [from];
    res.pays = [];
    for (const j of payers) {
      const tai = sc.tai + (w === g.dealer || j === g.dealer ? dSum : 0);
      const x = cfg.base + tai * cfg.tai;
      deltas[j] -= x; deltas[w] += x; res.pays.push({ seat: j, tai, amount: x });
    }
    res.list = w === g.dealer || payers.includes(g.dealer) ? [...sc.list, ...dt.map(([n, v]) => [n + (w === g.dealer ? "" : "（只算莊家那份）"), v])] : sc.list;
    res.tai = sc.tai;
  }
  for (let j = 0; j < 4; j++) t.seats[j].points += deltas[j];
  res.deltas = deltas; res.all = revealAll(t);
  t.log = `${t.seats[w].name} ${tsumo ? "自摸" : `胡 ${t.seats[from].name} 的 ${tileName(tile)}`}！`;
  endHand(t, res, w === g.dealer, false);
}
function settleEight(t, w) {
  const g = t.g, deltas = [0, 0, 0, 0], cfg = t.cfg, dt = dealerTai(g.lian), dSum = dt.reduce((s, x) => s + x[1], 0);
  for (let j = 0; j < 4; j++) { if (j === w) continue; const x = cfg.base + (8 + (w === g.dealer || j === g.dealer ? dSum : 0)) * cfg.tai; deltas[j] -= x; deltas[w] += x; }
  for (let j = 0; j < 4; j++) t.seats[j].points += deltas[j];
  const p = t.h.p[w];
  const res = { kind: "eight", winner: w, from: -1, tile: -1, hand: sortTiles(p.hand.filter((x) => !isFlower(x))), melds: p.melds, flowers: p.flowers, list: [["八仙過海", 8]], tai: 8, deltas, all: revealAll(t) };
  t.log = `${t.seats[w].name} 八仙過海！`;
  endHand(t, res, w === g.dealer, false);
}
// 流局：日麻聽牌的人收不聽的人共 3000 點；台麻不算錢、莊家連莊
function exhaust(t) {
  const h = t.h, g = t.g, deltas = [0, 0, 0, 0];
  const tenpai = h.p.map((p, i) => shanten(toCounts(p.hand), needOf(t, p), t.rule === "jp") === 0);
  let dealerKeeps = true;
  if (t.rule === "jp") {
    const n = tenpai.filter(Boolean).length;
    if (n > 0 && n < 4) for (let j = 0; j < 4; j++) deltas[j] += tenpai[j] ? 3000 / n : -3000 / (4 - n);
    dealerKeeps = tenpai[g.dealer];
  }
  for (let j = 0; j < 4; j++) t.seats[j].points += deltas[j];
  t.log = "流局";
  endHand(t, { kind: "draw", tenpai, deltas, all: revealAll(t) }, dealerKeeps, true);
}
function endHand(t, res, dealerKeeps, isDraw) {
  const g = t.g, h = t.h;
  h.stage = "done"; h.claim = null; h.opts = null;
  res.label0 = roundLabel(t);
  if (t.rule === "jp") {
    if (dealerKeeps) g.honba++;
    else { g.dealer = (g.dealer + 1) % 4; g.kyoku++; g.honba = isDraw ? g.honba + 1 : 0; }
  } else {
    if (dealerKeeps) g.lian++;
    else { g.dealer = (g.dealer + 1) % 4; g.kyoku++; g.lian = 0; }
  }
  if (g.kyoku >= 4) { g.kyoku = 0; g.round++; }
  const bust = t.seats.some((s) => (t.rule === "jp" ? s.points < 0 : s.points <= 0));
  res.gameOver = bust || g.round >= t.cfg.len;
  t.result = res; t.phase = "result"; t.nextAt = Date.now() + RESULT_MS;
}
function roundLabel(t) {
  const g = t.g; if (!g) return "";
  const w = WINDS[g.round % 4];
  if (t.rule === "jp") return `${w}${g.kyoku + 1}局${g.honba ? ` ${g.honba}本場` : ""}`;
  return `${w}風${WINDS[g.kyoku]}局${g.lian ? `（連${g.lian}）` : ""}`;
}
function finishGame(t) {
  const rank = t.seats.map((s, i) => ({ i, name: s.name, points: s.points })).sort((a, b) => b.points - a.points);
  t.final = rank; t.phase = "end"; t.started = false; t.h = null; t.result = null;
  t.log = `牌局結束，第一名 ${rank[0].name}`;
  t.seats.forEach((s, i) => { if (s && s.removeAfter) t.seats[i] = null; });
}

// ---------------------------------------------------------------- 電腦
function visibleCounts(t, i) {
  const h = t.h, c = toCounts(h.p[i].hand);
  for (const p of h.p) { for (const r of p.river) c[kindOf(r.t)]++; for (const m of p.melds) for (const x of m.tiles) c[kindOf(x)]++; }
  for (const d of h.dora) c[kindOf(d)]++;
  return c;
}
function evalDiscards(t, i) {
  const h = t.h, p = h.p[i], need = needOf(t, p), jp = t.rule === "jp";
  const c = toCounts(p.hand), vis = visibleCounts(t, i);
  const danger = jp ? h.p.map((q, k) => (k !== i && q.riichi ? k : -1)).filter((k) => k >= 0) : [];
  const res = [];
  for (const k0 of new Set(p.hand)) {
    const k = kindOf(k0);
    c[k]--;
    const sh = shanten(c, need, jp);
    let uke = 0;
    for (let x = 0; x < 34; x++) { if (c[x] >= 4) continue; c[x]++; if (shanten(c, need, jp) < sh) uke += Math.max(0, 4 - vis[x]); c[x]--; }
    c[k]++;
    const safe = danger.length && danger.every((d) => h.p[d].river.some((r) => kindOf(r.t) === k));
    let score = -sh * 1000 + uke * 4 + (isHonor(k) ? 2 : 0) + (k < 27 && (k % 9 === 0 || k % 9 === 8) ? 1 : 0);
    if (danger.length && sh >= 1) score += safe ? 3000 : 0;
    if (isAka(k0)) score -= 6;                                      // 一樣的牌先打普通的，留著赤五
    res.push({ k: k0, sh, score });
  }
  return res.sort((a, b) => b.score - a.score);
}
function botTurn(t, i) {
  const h = t.h, o = h.opts, p = h.p[i];
  if (o.tsumo) return doTsumo(t, i);
  if (o.lock) return discard(t, i, h.drawn, false);
  const best = evalDiscards(t, i)[0];
  if (o.riichi.includes(best.k) && best.sh === 0) return discard(t, i, best.k, true);
  return discard(t, i, best.k, false);
}
function hasYakuhaiMeld(t, i) {
  const p = t.h.p[i], sw = 27 + seatW(t, i), rw = 27 + (t.g.round % 4);
  return p.melds.some((m) => { const k = kindOf(m.tiles[0]); return m.k !== "chi" && (isDragon(k) || k === sw || k === rw); });
}
function botClaim(t, i, o) {
  if (o.ron) return { a: "ron" };
  const h = t.h, p = h.p[i], jp = t.rule === "jp", tile = kindOf(o.tile);
  const c = toCounts(p.hand), need = needOf(t, p);
  const now = shanten(c, need, jp && !p.melds.length);
  const after = (rm) => {                                          // 叫牌後（再打一張最好的）的向聽數
    const d = c.slice(); for (const x of rm) d[x]--;
    let b = 99; for (let k = 0; k < 34; k++) if (d[k]) { d[k]--; b = Math.min(b, shanten(d, need - 1, false)); d[k]++; }
    return b;
  };
  const sw = 27 + seatW(t, i), rw = 27 + (t.g.round % 4);
  const yakuhai = isDragon(tile) || tile === sw || tile === rw;
  const allowOpen = !jp || yakuhai || hasYakuhaiMeld(t, i);           // 日麻：要有役牌才敢副露
  if (o.pon && allowOpen && (after([tile, tile]) < now || (jp && yakuhai && after([tile, tile]) <= now))) return { a: "pon" };
  if (o.chi.length && allowOpen && !(jp && !hasYakuhaiMeld(t, i))) {
    for (const w of o.chi) if (after(w) < now) return { a: "chi", with: w };
  }
  return { a: "pass" };
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.seats.findIndex((s) => s && s.ws === ws && !ws.mspec);
  const h = t.h, g = t.g;
  const v = { t: "mstate", rule: t.rule, phase: t.phase, started: t.started, cfg: t.cfg, stakes: t.rule === "tw" ? TW_STAKES : null, you, log: t.log, now: Date.now(),
    watchers: [...t.members].filter((w) => w.mspec).length, final: t.final, round: g ? roundLabel(t) : "", dealer: h ? h.dealer : g ? g.dealer : -1, honba: g ? g.honba : 0, sticks: g ? g.sticks : 0, lian: g ? g.lian : 0 };
  v.seats = t.seats.map((s, i) => {
    if (!s) return null;
    const o = { i, name: s.name, bot: s.bot, away: !s.bot && !s.ws, points: s.points };
    if (h && g) { const p = h.p[i]; Object.assign(o, { wind: WINDS[(i - h.dealer + 4) % 4], melds: p.melds, flowers: p.flowers, river: p.river, riichi: p.riichi, count: p.hand.length }); }
    return o;
  });
  if (h && t.phase === "play") {
    v.stage = h.stage; v.turn = h.turn; v.wall = Math.max(0, wallLeft(t)); v.dora = h.dora; v.last = h.last;
    v.deadline = h.stage === "claim" ? h.claim.deadline : h.deadline;
    if (you >= 0) {
      const p = h.p[you];
      const hand = p.hand.slice(); let drawn = null;
      if (h.stage === "turn" && h.turn === you && h.drawn != null) { const k = hand.lastIndexOf(h.drawn); if (k >= 0) { hand.splice(k, 1); drawn = h.drawn; } }
      v.hand = sortTiles(hand); v.drawn = drawn;
      if (h.stage === "turn" && h.turn === you) { const { kind, tsumo, ankan, kakan, riichi, lock } = h.opts; v.opts = { kind, tsumo, ankan, kakan, riichi, lock }; }
      if (h.stage === "claim" && h.claim.opts[you] && !h.claim.resp[you]) { const o = h.claim.opts[you]; v.opts = { kind: "claim", tile: o.tile, ron: o.ron, pon: o.pon, kan: o.kan, chi: o.chi }; }
      if (t.rule === "jp" && !(h.stage === "turn" && h.turn === you)) v.waits = waitsOf(toCounts(p.hand), needOf(t, p), true);
    }
  }
  if (t.phase === "result") { v.result = t.result; v.nextAt = t.nextAt; }
  return v;
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listMjTables() {
  const res = [];
  for (const t of tables.values()) {
    const seated = t.seats.filter(Boolean);
    if (!seated.some((s) => !s.bot)) continue;
    res.push({ game: "mj" + t.rule, id: t.id, players: seated.filter((s) => !s.bot).map((s) => ({ name: s.name, real: false, playing: false })), watchers: [...t.members].filter((w) => w.mspec).length, bots: seated.filter((s) => s.bot).length });
  }
  return res;
}

// ---------------------------------------------------------------- 計時
function tick() {
  const now = Date.now();
  for (const [key, t] of [...tables.entries()]) {
    if (!t.members.size) { if (now - (t.emptyAt || (t.emptyAt = now)) > 120000) tables.delete(key); continue; }
    t.emptyAt = 0;
    const humans = t.seats.filter((s) => s && !s.bot && s.ws);
    if (!humans.length && t.phase !== "wait" && t.phase !== "end") { t.seats = [null, null, null, null]; t.phase = "wait"; t.started = false; t.h = null; t.g = null; t.result = null; t.log = "等玩家入座…"; push(t); continue; }
    if (t.phase === "result") {
      if (now < t.nextAt) continue;
      if (t.result.gameOver) finishGame(t); else startHand(t);
      push(t); continue;
    }
    if (t.phase !== "play") continue;
    const h = t.h;
    try {
      if (h.stage === "claim") {
        const c = h.claim;
        if (now >= c.deadline) { for (const j of Object.keys(c.opts)) if (!c.resp[j]) { t.seats[j].idle++; c.resp[j] = { a: "pass" }; } maybeResolve(t, true); push(t); }
        else if (now >= c.botAt) { const before = h.claim; maybeResolve(t); if (h.claim !== before) push(t); }
        continue;
      }
      if (h.stage === "turn" && now >= h.deadline) {
        const s = t.seats[h.turn];
        if (isAuto(s)) botTurn(t, h.turn);
        else {                                                        // 超時：自摸能胡就胡，不然打掉剛摸的牌
          s.idle++;
          if (h.opts.tsumo) doTsumo(t, h.turn);
          else discard(t, h.turn, h.drawn != null ? h.drawn : h.p[h.turn].hand[h.p[h.turn].hand.length - 1], false);
        }
        push(t);
      }
    } catch (e) { console.log("麻將錯誤", e && e.stack); }
  }
}
setInterval(tick, 200).unref();

// ---------------------------------------------------------------- 連線
export function mjClose(ws) {
  const t = ws.mtable; if (!t) return;
  t.members.delete(ws);
  const i = t.seats.findIndex((s) => s && s.ws === ws);
  if (i >= 0) {
    const s = t.seats[i]; s.ws = null;
    if (!t.started && t.phase !== "result") t.seats[i] = null;     // 還沒開打就直接空出座位；打到一半由電腦代打
  }
  ws.mtable = null;
  push(t);
}
export function handleMahjong(ws, m) {
  if (m.t === "mjoin") {
    if (ws.mtable) mjClose(ws);
    const rule = m.rule === "tw" ? "tw" : "jp";
    const t = getTable(rule, String(m.room || "default").slice(0, 80));
    ws.mtable = t; ws.mspec = !!m.spectate; if (cleanName(m.name)) ws.mname = cleanName(m.name);
    ws.mpid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    if (!ws.mspec) { const i = t.seats.findIndex((s) => s && !s.bot && s.pid === ws.mpid); if (i >= 0) { t.seats[i].ws = ws; t.seats[i].name = nameOf(ws); t.seats[i].idle = 0; } }   // 重新整理後認回座位
    push(t); return true;
  }
  const t = ws.mtable; if (!t) return false;
  if (ws.mspec) return true;
  const mine = t.seats.findIndex((s) => s && s.ws === ws);
  if (m.t === "msit") {
    if (mine >= 0) return true;
    let i = Number(m.seat);
    if (!Number.isInteger(i) || i < 0 || i > 3) i = t.seats.findIndex((s) => !s);
    const s = t.seats[i];
    if (s && !(s.bot && t.started)) i = t.seats.findIndex((x) => !x);
    if (i < 0) return out(ws, { t: "merr", error: "full" }), true;
    if (t.seats[i] && t.seats[i].bot) { const old = t.seats[i]; t.seats[i] = mkSeat({ ws, pid: ws.mpid, name: nameOf(ws), points: old.points }); t.log = `${nameOf(ws)} 接手 ${old.name} 的位置`; }   // 打到一半換人接手電腦
    else { t.seats[i] = mkSeat({ ws, pid: ws.mpid, name: nameOf(ws) }); t.log = `${nameOf(ws)} 入座`; }
    push(t);
  } else if (m.t === "mstand") {
    if (mine < 0) return true;
    const s = t.seats[mine];
    if (t.started) { t.seats[mine] = mkSeat({ bot: true, name: pickBotName(t), points: s.points }); t.log = `${s.name} 離座，由 ${t.seats[mine].name} 接手`; }
    else t.seats[mine] = null;
    out(ws, view(t, ws)); push(t);
  } else if (m.t === "maddbot") {
    if (mine < 0 || t.started) return true;
    const i = Number.isInteger(Number(m.seat)) && !t.seats[Number(m.seat)] && Number(m.seat) >= 0 && Number(m.seat) <= 3 ? Number(m.seat) : t.seats.findIndex((s) => !s);
    if (i < 0) return true;
    t.seats[i] = mkSeat({ bot: true, name: pickBotName(t) }); push(t);
  } else if (m.t === "mdelbot") {
    const i = Number(m.seat), s = t.seats[i];
    if (mine < 0 || !s || !s.bot || t.started) return true;
    t.seats[i] = null; push(t);
  } else if (m.t === "mname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.mname = nm; if (mine >= 0) t.seats[mine].name = nm; push(t);
  } else if (m.t === "mcfg") {
    if (mine < 0 || t.started) return true;
    const len = Number(m.len);
    if (t.R.lens.includes(len)) t.cfg.len = len;
    if (t.rule === "tw") { const st = TW_STAKES[Number(m.stake)]; if (st) { t.cfg.base = st[0]; t.cfg.tai = st[1]; } }
    if (t.rule === "jp" && m.aka !== undefined) t.cfg.aka = !!m.aka;
    t.log = `${nameOf(ws)} 調整設定`; push(t);
  } else if (m.t === "mstart") {
    if (mine < 0 || t.started) return true;
    startGame(t); t.log = `${nameOf(ws)} 按下開始｜` + t.log; push(t);
  } else if (m.t === "mact") {
    if (mine < 0 || t.phase !== "play") return true;
    const h = t.h, a = String(m.a || ""), tile = Number(m.tile);
    t.seats[mine].idle = 0;
    let ok = false;
    if (h.stage === "turn" && h.turn === mine) {
      if (a === "discard") ok = discard(t, mine, tile, false);
      else if (a === "riichi") ok = discard(t, mine, tile, true);
      else if (a === "tsumo") ok = doTsumo(t, mine);
      else if (a === "ankan") ok = doAnkan(t, mine, tile);
      else if (a === "kakan") ok = doKakan(t, mine, tile);
    } else if (h.stage === "claim") ok = claimRespond(t, mine, m);
    if (ok) push(t);
  }
  return true;
}

// 測試用：4 個電腦直接打完一整場（不經過計時器），回傳每手的結果
export function _simGame(rule, cfg, greedy) {
  const t = newTable("sim", rule); if (cfg) Object.assign(t.cfg, cfg);
  startGame(t);
  const results = [];
  for (let guard = 0; guard < 200000; guard++) {
    if (t.phase === "end") break;
    if (t.phase === "result") { results.push(t.result); if (t.result.gameOver) finishGame(t); else startHand(t); continue; }
    const h = t.h;
    if (h.stage === "claim") {
      if (greedy) for (const j of Object.keys(h.claim.opts)) { const o = h.claim.opts[j]; h.claim.resp[j] = o.ron ? { a: "ron" } : o.kan ? { a: "kan" } : o.pon ? { a: "pon" } : o.chi.length ? { a: "chi", with: o.chi[0] } : { a: "pass" }; }
      maybeResolve(t, true);
    } else if (h.stage === "turn") {
      const o = h.opts;
      if (greedy && o.ankan.length) doAnkan(t, h.turn, o.ankan[0]);
      else if (greedy && o.kakan.length) doKakan(t, h.turn, o.kakan[0]);
      else botTurn(t, h.turn);
    }
    else throw new Error("stuck " + h.stage);
  }
  return { results, final: t.final, seats: t.seats.map((s) => s.points) };
}
