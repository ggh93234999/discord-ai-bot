// 雙人棋類房間伺服器（五子棋 gomoku、四連棋 c4）。
// 一個 Discord Activity instance（instanceId）+ 遊戲種類 = 一個房間。
// 先進房間的是黑（c4 是紅），第二個是白（c4 是黃），其他人旁觀。棋盤只存在記憶體，重啟會清掉。
import { WebSocketServer } from "ws";
import { spin as slotSpin, KINDS as SLOT_KINDS } from "./slots.js";
import { createVb, stepVb, snapshotVb, WIN } from "./vb.js";
import { createPika, stepPika, snapshotPika } from "./pika.js";

const PORT = Number(process.env.PORT || 3101);
const GOMOKU = 15;
const C4_W = 7, C4_H = 6;
const rooms = new Map();

function freshBoard(game) {
  if (game === "vb" || game === "pika") return "";
  return game === "c4" ? ".".repeat(C4_W * C4_H) : ".".repeat(GOMOKU * GOMOKU);
}

function newRoom(game) {
  return { game, board: freshBoard(game), turn: "b", winner: null, line: null, last: null, moves: 0,
           players: { b: null, w: null }, clients: new Set(), emptySince: null,
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
      line: room.line, last: room.last, moves: room.moves,
      players: { b: !!room.players.b, w: !!room.players.w }, watchers: room.clients.size,
      speed: room.speed, ping: room.ping,
      vb: room.vb ? snapshotVb(room.vb) : undefined,
      pika: room.pika ? snapshotPika(room.pika) : undefined,
    });
  }
}

function assignSeat(room, ws) {
  if (!room.players.b) room.players.b = ws;
  else if (!room.players.w) room.players.w = ws;
}

function place(room, role, m) {
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

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1", path: "/ws", maxPayload: 4096 });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "ping") { send(ws, { t: "pong", ts: m.ts }); return; }
    // 老虎機練習模式：每條連線一份練習幣，不碰真代幣
    if (m.t === "slotjoin") { ws.practice = ws.practice ?? 1000; return send(ws, { t: "slotinit", balance: ws.practice }); }
    if (m.t === "slotreset") { ws.practice = 1000; return send(ws, { t: "slotinit", balance: ws.practice }); }
    if (m.t === "spin") {
      const kind = Number(m.kind), bet = Number(m.bet);
      if (!SLOT_KINDS[kind] || !Number.isInteger(bet) || bet < 1 || bet > 1000) return;
      if (Date.now() - (ws.lastSpin || 0) < 500) return;
      if ((ws.practice ?? 1000) < bet) return send(ws, { t: "slotinit", balance: ws.practice ?? 0, broke: true });
      ws.lastSpin = Date.now();
      ws.practice = (ws.practice ?? 1000) - bet;
      const r = slotSpin(kind), back = Math.floor(bet * r.mult);
      ws.practice += back;
      return send(ws, { t: "slot", kind, bet, back, balance: ws.practice, ...r });
    }
    if (m.t === "join") {
      if (ws.room) return;
      const game = ["c4", "vb", "pika"].includes(m.game) ? m.game : "gomoku";
      const id = String(m.room || "default").slice(0, 80);
      const room = getRoom(game, id);
      ws.room = room;
      room.clients.add(ws);
      room.emptySince = null;
      assignSeat(room, ws);
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
      if (!place(room, role, m)) return;
      if (!room.winner) room.turn = role === "b" ? "w" : "b";
      broadcast(room);
    } else if (m.t === "again") {
      if (role === "s" || !room.winner) return;
      // 重新開局，先後手互換
      const { b, w } = room.players;
      Object.assign(room, { board: freshBoard(room.game), turn: "b", winner: null, line: null, last: null, moves: 0 });
      room.players = { b: w, w: b };
      room.ping = { b: room.ping.w, w: room.ping.b };
      room.acc = 0;
      if (room.game === "vb") { room.vb = createVb(); room.input = { b: {}, w: {} }; }
      else if (room.game === "pika") { room.pika = createPika(); room.input = { b: {}, w: {} }; }
      broadcast(room);
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
      broadcast(room);
    }
  });

  ws.on("close", () => {
    const room = ws.room;
    if (!room) return;
    room.clients.delete(ws);
    for (const c of ["b", "w"]) if (room.players[c] === ws) { room.players[c] = null; room.input[c] = {}; room.ping[c] = null; }
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

// 心跳：斷線的連線清掉；沒人的房間 10 分鐘後刪除
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && room.emptySince && Date.now() - room.emptySince > 10 * 60 * 1000) rooms.delete(id);
  }
}, 25000);

console.log(`board game server listening on 127.0.0.1:${PORT}/ws`);
