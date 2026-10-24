// 雙人棋類房間伺服器（五子棋 gomoku、四連棋 c4）。
// 一個 Discord Activity instance（instanceId）+ 遊戲種類 = 一個房間。
// 先進房間的是黑（c4 是紅），第二個是白（c4 是黃），其他人旁觀。棋盤只存在記憶體，重啟會清掉。
import http from "node:http";
import { WebSocketServer } from "ws";
import { handleApi, getSession, botInfo, botSettle, betLimit } from "./bet.js";
import { spin as slotSpin, KINDS as SLOT_KINDS } from "./slots.js";
import { createVb, stepVb, snapshotVb, WIN } from "./vb.js";
import { WAGERS, wagerView, makeOffer, clearOffer, acceptOffer, settleWager, onPlayerLeft, reclaimSeat, seatReserved, recoverEscrow } from "./wager.js";
import { MULTI_GAMES, joinMulti, handleMulti, leaveMulti, tickMulti } from "./multi.js";
import { handleFarm, recoverFarmPending } from "./farm.js";
import { handleGallery, serveGallery } from "./gallery.js";
import { handleCasino, casinoClose, casinoFeed, casinoReclaim, recoverCasinoEscrow, noteReal } from "./casino.js";
import * as chessEng from "./chess.js";
import * as xqEng from "./xq.js";
import { handlePoker, pokerClose } from "./poker.js";
import { handleMahjong, mjClose } from "./mahjong.js";
import { handleBridge, bridgeClose } from "./bridge.js";
import { handleBigtwo, bigtwoClose } from "./bigtwo.js";
import { handleAvalon, avalonClose } from "./avalon.js";
import { handleTheater, theaterClose, serveVideo, serveSub } from "./theater.js";
import { createPika, stepPika, snapshotPika } from "./pika.js";
import { thinkMove, LEVELS as BOT_LEVELS } from "./bots.js";

const PORT = Number(process.env.PORT || 3101);
const GOMOKU = 15;
const C4_W = 7, C4_H = 6;
const RV = 8;
const rooms = new Map();

// ---- 黑白棋（reversi）規則
const RV_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function rvFlips(board, x, y, c) {
  if (board[y * RV + x] !== ".") return [];
  const o = c === "b" ? "w" : "b", out = [];
  for (const [dx, dy] of RV_DIRS) {
    const run = []; let nx = x + dx, ny = y + dy;
    while (nx >= 0 && ny >= 0 && nx < RV && ny < RV && board[ny * RV + nx] === o) { run.push(ny * RV + nx); nx += dx; ny += dy; }
    if (run.length && nx >= 0 && ny >= 0 && nx < RV && ny < RV && board[ny * RV + nx] === c) out.push(...run);
  }
  return out;
}
function rvHasMove(board, c) {
  for (let y = 0; y < RV; y++) for (let x = 0; x < RV; x++) if (rvFlips(board, x, y, c).length) return true;
  return false;
}
function rvStart() {
  const a = Array(RV * RV).fill(".");
  a[3 * RV + 3] = "w"; a[4 * RV + 4] = "w"; a[3 * RV + 4] = "b"; a[4 * RV + 3] = "b";
  return a.join("");
}

const ENG = { chess: chessEng, xq: xqEng };      // 西洋棋、象棋：規則在 chess.js / xq.js
const BOT = { isBot: true, readyState: 3, send() {} };     // 電腦對手佔的座位（不是真的連線，所以不會收到廣播）
function freshBoard(game) {
  if (ENG[game]) return ENG[game].init().sq.join("");
  if (game === "vb" || game === "pika") return "";
  if (game === "rv") return rvStart();
  return game === "c4" ? ".".repeat(C4_W * C4_H) : ".".repeat(GOMOKU * GOMOKU);
}

function newRoom(game) {
  return { game, cs: ENG[game] ? ENG[game].init() : null, board: freshBoard(game), turn: "b", winner: null, line: null, last: null, moves: 0,
           players: { b: null, w: null }, clients: new Set(), emptySince: null, bot: null, botBusy: false, botGen: 0,
           vb: game === "vb" ? createVb() : null,
           pika: game === "pika" ? createPika() : null,
           input: { b: {}, w: {} },
           speed: 1, acc: 0, ping: { b: null, w: null } };
}

function getRoom(game, id) {
  const key = `${game}:${id}`;
  if (!rooms.has(key)) rooms.set(key, newRoom(game));
  return rooms.get(key);
}

// 從 (x,y) 往四個方向數連線，len 個以上就算贏，回傳連線座標
function checkWin(get, w, h, x, y, c, len) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[x, y]];
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (nx >= 0 && ny >= 0 && nx < w && ny < h && get(nx, ny) === c) {
        line.push([nx, ny]); nx += dx * s; ny += dy * s;
      }
    }
    if (line.length >= len) return line;
  }
  return null;
}

function roleOf(room, ws) {
  if (room.players.b === ws) return "b";
  if (room.players.w === ws) return "w";
  return "s";
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function broadcast(room) {
  for (const ws of room.clients) {
    send(ws, {
      t: "state", game: room.game, you: roleOf(room, ws), board: room.board, turn: room.turn, winner: room.winner,
      line: room.line, last: room.last, moves: room.moves, passed: room.passed || null,
      canSit: roleOf(room, ws) === "s" && ["b", "w"].some((c) => !room.players[c] && !seatReserved(room, c, ws)),
      canStand: roleOf(room, ws) !== "s" && standOk(room),
      check: room.check ?? -1, reason: room.reason || "",
      legal: ENG[room.game] && !room.winner && roleOf(room, ws) === room.turn && room.players.b && room.players.w ? ENG[room.game].moves(room.cs).map((x) => [x.f, x.t]) : undefined,
      players: { b: !!room.players.b, w: !!room.players.w }, watchers: room.clients.size,
      bot: room.bot ? { c: room.bot.c, level: room.bot.level, name: BOT_LEVELS[room.bot.level].name, thinking: !!room.botBusy } : null,
      canBot: !!ENG[room.game] && roleOf(room, ws) !== "s" && !room.bot && room.moves === 0 && !room.winner && !room.wager && !room.offer && !room.busy && !!room.players.b !== !!room.players.w,
      canBotDel: !!room.bot && roleOf(room, ws) !== "s" && (room.moves === 0 || !!room.winner),
      speed: room.speed, ping: room.ping, ...wagerView(room),
      vb: room.vb ? snapshotVb(room.vb) : undefined,
      pika: room.pika ? snapshotPika(room.pika) : undefined,
    });
  }
}

// 能不能離開座位回觀眾席：對賭中、或雙方都在而且對局進行中都不行（要先認輸）
function standOk(room) {
  if (room.game === "vb") return false;
  if (room.wager && !room.wager.settled) return false;
  const both = room.players.b && room.players.w;
  if (both && !room.winner && !(room.game !== "pika" && room.moves === 0)) return false;
  return true;
}
function assignSeat(room, ws) {
  for (const c of ["b", "w"]) {
    if (room.players[c]) continue;
    if (seatReserved(room, c, ws)) continue;     // 對賭中，空出來的座位留給原本的人
    room.players[c] = ws;
    return;
  }
}
const rebroadcast = (room) => () => broadcast(room);

// ---- 電腦對手（西洋棋、象棋）：房間裡有真人坐著才會有電腦；電腦的走法在 bots.js 的執行緒裡算 ----
const humanSeated = (room) => ["b", "w"].some((c) => room.players[c] && room.players[c] !== BOT);
function resetBoard(room) {
  Object.assign(room, { board: freshBoard(room.game), cs: ENG[room.game] ? ENG[room.game].init() : null, check: -1, reason: "", turn: "b", winner: null, line: null, last: null, moves: 0, passed: null });
}
function dropBot(room) {
  if (!room.bot) return;
  room.players[room.bot.c] = null; room.bot = null; room.botGen++;
}
function dropBotIfAlone(room) { if (room.bot && !humanSeated(room)) { dropBot(room); resetBoard(room); } }

function maybeBot(room) {
  const b = room.bot;
  if (!b || room.winner || room.botBusy || room.turn !== b.c || !ENG[room.game] || !room.players.b || !room.players.w) return;
  room.botBusy = true;
  const gen = room.botGen, moves0 = room.moves, t0 = Date.now();
  broadcast(room);
  thinkMove(room.game, room.cs, b.level).then(async (mv) => {
    const wait = 450 + (b.level === 1 ? 350 : 0) - (Date.now() - t0);        // 不要秒回，看得到對手在想
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    room.botBusy = false;
    if (room.bot !== b || room.botGen !== gen || room.moves !== moves0 || room.winner || room.turn !== b.c) { broadcast(room); return; }   // 這段時間局面變了（有人離開、重開）
    let ok = mv && doMove(room, b.c, { f: mv.f, to: mv.t, p: mv.p });
    if (!ok) { const l = ENG[room.game].moves(room.cs); if (l.length) ok = doMove(room, b.c, { f: l[0].f, to: l[0].t, p: l[0].p }); }
    if (!ok) broadcast(room);
  }).catch((e) => { room.botBusy = false; console.log("bot error", e && e.message); broadcast(room); });
}

// 下一步棋：驗證 → 走棋 → 換邊 → 結算 → 廣播。真人和電腦共用
function doMove(room, role, m) {
  if (!place(room, role, m)) return false;
  if (room.offer) clearOffer(room);                    // 開始下棋就取消還沒人接的賭注
  if (!room.winner && room.game !== "rv") room.turn = role === "b" ? "w" : "b";
  if (room.winner) settleWager(room, rebroadcast(room));
  broadcast(room);
  return true;
}

function place(room, role, m) {
  const eng = ENG[room.game];
  if (eng) {
    const f = Number(m.f), t = Number(m.to);
    if (!Number.isInteger(f) || !Number.isInteger(t)) return false;
    const cands = eng.moves(room.cs).filter((x) => x.f === f && x.t === t);
    if (!cands.length) return false;
    const mv = cands.find((x) => x.p === String(m.p || "q")) || cands[0];     // 升變預設升后
    room.cs = eng.apply(room.cs, mv);
    room.board = room.cs.sq.join(""); room.last = [f, t]; room.moves++;
    const o = eng.outcome(room.cs);
    room.check = o.check; room.reason = o.reason; room.line = null;
    if (o.over) room.winner = o.winner;
    return true;
  }
  if (room.game === "rv") {
    const x = Number(m.x), y = Number(m.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= RV || y >= RV) return false;
    const fl = rvFlips(room.board, x, y, role);
    if (!fl.length) return false;
    const a = room.board.split("");
    a[y * RV + x] = role; for (const i of fl) a[i] = role;
    room.board = a.join(""); room.last = [x, y]; room.moves++; room.passed = null;
    const opp = role === "b" ? "w" : "b";
    if (rvHasMove(room.board, opp)) room.turn = opp;
    else if (rvHasMove(room.board, role)) { room.turn = role; room.passed = opp; }   // 對方沒地方下，跳過
    else {
      const nb = [...room.board].filter((c) => c === "b").length, nw = [...room.board].filter((c) => c === "w").length;
      room.winner = nb === nw ? "d" : nb > nw ? "b" : "w";
    }
    return true;
  }
  if (room.game === "gomoku") {
    const x = Number(m.x), y = Number(m.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GOMOKU || y >= GOMOKU) return false;
    const i = y * GOMOKU + x;
    if (room.board[i] !== ".") return false;
    room.board = room.board.slice(0, i) + role + room.board.slice(i + 1);
    room.last = [x, y];
    room.moves++;
    const line = checkWin((a, b) => room.board[b * GOMOKU + a], GOMOKU, GOMOKU, x, y, role, 5);
    if (line) { room.winner = role; room.line = line; }
    else if (room.moves >= GOMOKU * GOMOKU) room.winner = "d";
    return true;
  }
  // c4：只收「哪一欄」，棋子自己掉到最底下
  const c = Number(m.c);
  if (!Number.isInteger(c) || c < 0 || c >= C4_W) return false;
  let r = -1;
  for (let row = C4_H - 1; row >= 0; row--) if (room.board[row * C4_W + c] === ".") { r = row; break; }
  if (r < 0) return false;
  const i = r * C4_W + c;
  room.board = room.board.slice(0, i) + role + room.board.slice(i + 1);
  room.last = [c, r];
  room.moves++;
  const line = checkWin((a, b) => room.board[b * C4_W + a], C4_W, C4_H, c, r, role, 4);
  if (line) { room.winner = role; room.line = line; }
  else if (room.moves >= C4_W * C4_H) room.winner = "d";
  return true;
}


const httpServer = http.createServer((req, res) => {
  if (req.url.startsWith("/api/gallery/img/") && serveGallery(req, res)) return;
  if (req.url.startsWith("/api/tv/sub/")) return void serveSub(req, res).then((ok) => { if (!ok) { res.writeHead(404); res.end(); } });
  if (req.url.startsWith("/api/tv/") && serveVideo(req, res)) return;
  if (req.url.startsWith("/api/")) return handleApi(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} });
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 4096 });
recoverEscrow().catch((e) => console.log("escrow 還原失敗", e.message));
recoverFarmPending().catch((e) => console.log("農場補發失敗", e.message));
recoverCasinoEscrow().catch((e) => console.log("賭場 escrow 還原失敗", e.message));
httpServer.listen(PORT, "127.0.0.1");

wss.on("connection", (ws, req) => {
  ws.ua = String((req && req.headers["user-agent"]) || "").replace(/.*discord\/([\d.]+).*/, "discord/$1").slice(0, 40); ws.mtypes = [];
  ws.isAlive = true; ws.born = Date.now(); ws.missed = 0;
  ws.room = null;
  ws.on("pong", () => { ws.isAlive = true; ws.missed = 0; });
  ws.on("error", (e) => console.log("ws error", e && e.message));

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (ws.mtypes.length < 6) ws.mtypes.push(m.t);
    if (m.t === "ping") { send(ws, { t: "pong", ts: m.ts }); return; }
    // 老虎機練習模式：每條連線一份練習幣，不碰真代幣
    if (m.t === "slotjoin") { ws.practice = ws.practice ?? 1000; return send(ws, { t: "slotinit", balance: ws.practice }); }
    if (m.t === "slotreset") { ws.practice = 1000; return send(ws, { t: "slotinit", balance: ws.practice }); }
    // 賭注模式：用登入憑證綁定 Discord 身分，之後的轉動會真的動代幣（由機器人那邊結算）
    if (m.t === "bauth") {
      const s = getSession(m.token);
      if (!s) return send(ws, { t: "bauthed", ok: false });
      ws.user = s;
      casinoReclaim(ws);
      if (ws.room && roleOf(ws.room, ws) === "s" && reclaimSeat(ws.room, ws)) broadcast(ws.room);
      botInfo(s.uid)
        .then((r) => send(ws, { t: "bauthed", ok: !!r.ok, balance: r.balance, name: s.name }))
        .catch(() => send(ws, { t: "bauthed", ok: false, error: "bot_down" }));
      return;
    }
    if (m.t === "spin" && m.real) {
      const u = ws.user, kind = Number(m.kind), bet = Number(m.bet);
      if (!u) return send(ws, { t: "bauthed", ok: false });
      if (!SLOT_KINDS[kind] || !Number.isInteger(bet) || bet < 1 || bet > betLimit()) return;
      if (ws.spinning || Date.now() - (ws.lastSpin || 0) < 800) return;
      ws.spinning = true; ws.lastSpin = Date.now();
      (async () => {
        try {
          const r = slotSpin(kind), back = Math.floor(bet * r.mult);     // 結果先由伺服器決定，再去結算
          const st = noteReal(ws, await botSettle(u.uid, u.name, bet, back));
          if (!st.ok) send(ws, { t: "slotinit", real: true, balance: st.balance ?? null, broke: st.error === "insufficient", error: st.error });
          else { send(ws, { t: "slot", real: true, kind, bet, back, balance: st.balance, ...r }); casinoFeed(ws, { g: "slots", real: true, kind, bet, back, grid: r.grid, nwin: r.wins.length }); }
        } catch { send(ws, { t: "slotinit", real: true, error: "bot_down", balance: null }); }
        finally { ws.spinning = false; }
      })();
      return;
    }
    if (m.t === "spin") {
      const kind = Number(m.kind), bet = Number(m.bet);
      if (!SLOT_KINDS[kind] || !Number.isInteger(bet) || bet < 1 || bet > 1_000_000) return;
      if (Date.now() - (ws.lastSpin || 0) < 500) return;
      if ((ws.practice ?? 1000) < bet) return send(ws, { t: "slotinit", balance: ws.practice ?? 0, broke: true });
      ws.lastSpin = Date.now();
      ws.practice = (ws.practice ?? 1000) - bet;
      const r = slotSpin(kind), back = Math.floor(bet * r.mult);
      ws.practice += back;
      casinoFeed(ws, { g: "slots", real: false, kind, bet, back, grid: r.grid, nwin: r.wins.length });
      return send(ws, { t: "slot", kind, bet, back, balance: ws.practice, ...r });
    }
    if (m.t === "gl") { handleGallery(ws, m).catch((e) => console.log("圖創區錯誤", e && e.message)); return; }
    if (m.t === "fm") { handleFarm(ws, m).catch((e) => console.log("農場錯誤", e && e.message)); return; }
    if (typeof m.t === "string" && /^(cjoin|cmode|creset|cplay|cbj|cstone|chorse|clist|clogq|fget|fforge|fsell|fboard)$/.test(m.t)) { handleCasino(ws, m); return; }
    if (typeof m.t === "string" && /^(pjoin|psit|pstart|pstand|paddbot|pdelbot|pact|pname|preset|pcfg)$/.test(m.t)) { handlePoker(ws, m); return; }
    if (typeof m.t === "string" && /^(mjoin|msit|mstart|mstand|maddbot|mdelbot|mact|mname|mcfg)$/.test(m.t)) { handleMahjong(ws, m); return; }
    if (typeof m.t === "string" && /^(avjoin|avsit|avstart|avstand|avaddbot|avdelbot|avact|avname|avcfg|avlobby)$/.test(m.t)) { handleAvalon(ws, m); return; }
    if (typeof m.t === "string" && /^(btjoin|btsit|btstart|btstand|btaddbot|btdelbot|btact|btname|btcfg)$/.test(m.t)) { handleBigtwo(ws, m); return; }
    if (typeof m.t === "string" && /^(brjoin|brsit|brstart|brstand|braddbot|brdelbot|bract|brname|brcfg)$/.test(m.t)) { handleBridge(ws, m); return; }
    if (typeof m.t === "string" && /^(tjoin|tname|tadd|tqual|tplay|tpause|tseek|tspeed|tskip|tremove|tup)$/.test(m.t)) { handleTheater(ws, m).catch(() => {}); return; }
    if (m.t === "join" && MULTI_GAMES.includes(m.game)) {
      if (ws.room || ws.multi) return;
      joinMulti(ws, m.game, String(m.room || "default"));
      return;
    }
    if (ws.multi) { handleMulti(ws, m); return; }
    if (m.t === "join") {
      if (ws.room) return;
      const game = ["c4", "rv", "vb", "pika", "chess", "xq"].includes(m.game) ? m.game : "gomoku";
      const id = String(m.room || "default").slice(0, 80);
      const room = getRoom(game, id);
      ws.room = room;
      room.clients.add(ws);
      room.emptySince = null;
      if (!m.spectate) assignSeat(room, ws);          // spectate：先當觀眾，不佔座位
      broadcast(room);
      return;
    }
    const room = ws.room;
    if (!room) return;
    const role = roleOf(room, ws);
    if (m.t === "in") {
      if ((room.game === "vb" || room.game === "pika") && role !== "s") room.input[role] = { l: !!m.l, r: !!m.r, j: !!m.j, d: !!m.d, p: !!m.p };
    } else if (m.t === "move") {
      if (room.game === "vb" || room.game === "pika") return;
      if (role === "s" || room.winner || room.turn !== role) return;
      if (!room.players.b || !room.players.w) return;     // 要兩個人都到了才能下
      if (room.busy) return;                               // 押金還在扣款
      if (!doMove(room, role, m)) return;
      maybeBot(room);
    } else if (m.t === "botadd") {
      if (role === "s" || !ENG[room.game]) return;
      const lvl = Math.max(1, Math.min(4, Number(m.level) | 0 || 2));
      if (room.bot) { room.bot.level = lvl; broadcast(room); return; }            // 已經有電腦：只是換難度
      if (room.winner || room.moves > 0 || room.wager || room.offer || room.busy) return;
      const empty = ["b", "w"].filter((c) => !room.players[c]);
      if (empty.length !== 1) return;
      room.players[empty[0]] = BOT; room.bot = { c: empty[0], level: lvl }; room.botGen++;
      broadcast(room); maybeBot(room);
    } else if (m.t === "botdel") {
      if (role === "s" || !room.bot || !(room.moves === 0 || room.winner)) return;
      dropBot(room); if (room.winner) resetBoard(room);
      broadcast(room);
    } else if (m.t === "sit") {
      if (role !== "s") return;
      assignSeat(room, ws); broadcast(room);
    } else if (m.t === "stand") {
      if (role === "s" || !standOk(room)) return;
      if (room.offer) clearOffer(room);
      room.players[role] = null; dropBotIfAlone(room); broadcast(room);
    } else if (m.t === "again") {
      if (role === "s" || !room.winner) return;
      if (room.wager && !room.wager.settled) return;
      room.wager = null; room.wresult = null; room.offer = null;
      // 重新開局，先後手互換
      const { b, w } = room.players;
      Object.assign(room, { board: freshBoard(room.game), cs: ENG[room.game] ? ENG[room.game].init() : null, check: -1, reason: "", turn: "b", winner: null, line: null, last: null, moves: 0, passed: null });
      room.players = { b: w, w: b };
      if (room.bot) { room.bot.c = room.bot.c === "b" ? "w" : "b"; room.botGen++; }      // 換邊：電腦跟著換顏色
      room.ping = { b: room.ping.w, w: room.ping.b };
      room.acc = 0;
      if (room.game === "vb") { room.vb = createVb(); room.input = { b: {}, w: {} }; }
      else if (room.game === "pika") { room.pika = createPika(); room.input = { b: {}, w: {} }; }
      broadcast(room); maybeBot(room);
    } else if (m.t === "restart") {
      // 打到一半重來：不換邊，直接重開本局
      if (role === "s") return;
      if (room.game === "pika") { room.pika = createPika(); room.input = { b: {}, w: {} }; room.winner = null; room.acc = 0; }
      broadcast(room);
    } else if (m.t === "speed") {
      if (role === "s") return;
      const v = Number(m.speed);
      if ([1, 1.5, 2].includes(v)) { room.speed = v; broadcast(room); }
    } else if (m.t === "pingreport") {
      if (role === "s") return;
      room.ping[role] = Math.max(0, Math.round(Number(m.rtt) || 0));
      broadcast(room);
    } else if (m.t === "resign") {
      if (role === "s" || room.winner) return;
      room.winner = role === "b" ? "w" : "b";
      room.line = null;
      settleWager(room, rebroadcast(room));
      broadcast(room);
    } else if (m.t === "woffer") {
      const e = makeOffer(room, ws, role, Number(m.amount));
      if (e) send(ws, { t: "werr", error: e }); else broadcast(room);
    } else if (m.t === "wcancel") {
      if (room.offer && role !== "s" && !room.busy) { clearOffer(room); broadcast(room); }
    } else if (m.t === "waccept") {
      acceptOffer(room, ws, role, rebroadcast(room)).then((e) => { if (e) send(ws, { t: "werr", error: e }); broadcast(room); });
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`ws close code=${code} reason=${String(reason || "").slice(0, 40)} ua=${ws.ua} msgs=${ws.mtypes.join(",")} age=${Math.round((Date.now() - ws.born) / 1000)}s missed=${ws.missed} room=${ws.cr ? ws.cr.key : ws.room ? "board" : ws.multi ? "multi" : "-"}`);
    casinoClose(ws);
    pokerClose(ws);
    mjClose(ws);
    bridgeClose(ws);
    bigtwoClose(ws);
    avalonClose(ws);
    theaterClose(ws);
    if (ws.multi) { leaveMulti(ws); return; }
    const room = ws.room;
    if (!room) return;
    room.clients.delete(ws);
    for (const c of ["b", "w"]) if (room.players[c] === ws) {
      room.players[c] = null; room.input[c] = {}; room.ping[c] = null;
      if (room.offer && room.offer.by === c) room.offer = null;
      onPlayerLeft(room, c, rebroadcast(room));
    }
    dropBotIfAlone(room);                                  // 真人都走了，電腦也不留
    // 有旁觀者就遞補空位
    for (const w of room.clients) if (roleOf(room, w) === "s") assignSeat(room, w);
    if (room.clients.size === 0) room.emptySince = Date.now();
    broadcast(room);
  });
});

// 排球：每個 tick 推進有兩位玩家的房間
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.game !== "vb" || room.winner || !room.players.b || !room.players.w) continue;
    const scorer = stepVb(room.vb, room.input);
    if (scorer && room.vb.score[scorer] >= WIN) room.winner = scorer;
    broadcast(room);
  }
}, 1000 / 60);

// 皮卡丘排球：25 tick/秒。贏了之後仍推進「輸/贏動作」，認輸則直接凍結畫面。
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.game !== "pika" || !room.players.b || !room.players.w) continue;
    if (room.winner && room.pika.state !== "over") continue;
    // 速度倍率：acc 累積到 ≥1 就推進一步物理（speed 2 = 每 tick 兩步 = 50fps）
    room.acc += room.speed || 1;
    let stepped = 0;
    while (room.acc >= 1 && stepped < 4) {
      stepPika(room.pika, room.input);
      if (!room.winner && room.pika.winner) room.winner = room.pika.winner === 1 ? "b" : "w";
      room.acc -= 1;
      stepped++;
    }
    if (room.acc > 1) room.acc = 1;
    broadcast(room);
  }
}, 1000 / 25);

// 小朋友上下樓梯：60 tick/秒
setInterval(tickMulti, 1000 / 60);

// 心跳：斷線的連線清掉；沒人的房間 10 分鐘後刪除
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive && ++ws.missed >= 4) { ws.terminate(); continue; }   // 連續約 100 秒沒回應才斷線（代理可能吃掉 ping）
    ws.isAlive = false;
    ws.ping();
  }
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && room.emptySince && Date.now() - room.emptySince > 10 * 60 * 1000) rooms.delete(id);
  }
}, 25000);

console.log(`board game server listening on 127.0.0.1:${PORT}/ws`);
