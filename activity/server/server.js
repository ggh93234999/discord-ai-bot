// 五子棋房間伺服器：一個 Discord Activity instance（instanceId）= 一個房間。
// 先進房間的是黑棋，第二個是白棋，其他人旁觀。棋盤只存在記憶體，重啟會清掉。
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3101);
const SIZE = 15;
const rooms = new Map();

function newRoom() {
  return { board: ".".repeat(SIZE * SIZE), turn: "b", winner: null, line: null, last: null, moves: 0,
           players: { b: null, w: null }, clients: new Set(), emptySince: null };
}

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, newRoom());
  return rooms.get(id);
}

function checkWin(board, x, y, c) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[x, y]];
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && board[ny * SIZE + nx] === c) {
        line.push([nx, ny]); nx += dx * s; ny += dy * s;
      }
    }
    if (line.length >= 5) return line;
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
      t: "state", you: roleOf(room, ws), board: room.board, turn: room.turn, winner: room.winner,
      line: room.line, last: room.last, moves: room.moves,
      players: { b: !!room.players.b, w: !!room.players.w }, watchers: room.clients.size,
    });
  }
}

function assignSeat(room, ws) {
  if (!room.players.b) room.players.b = ws;
  else if (!room.players.w) room.players.w = ws;
}

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1", path: "/ws", maxPayload: 4096 });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "join") {
      if (ws.room) return;
      const id = String(m.room || "default").slice(0, 80);
      const room = getRoom(id);
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
    if (m.t === "move") {
      const x = Number(m.x), y = Number(m.y);
      if (role === "s" || room.winner || room.turn !== role) return;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
      if (!room.players.b || !room.players.w) return;     // 要兩個人都到了才能下
      const i = y * SIZE + x;
      if (room.board[i] !== ".") return;
      room.board = room.board.slice(0, i) + role + room.board.slice(i + 1);
      room.last = [x, y];
      room.moves++;
      const line = checkWin(room.board, x, y, role);
      if (line) { room.winner = role; room.line = line; }
      else if (room.moves >= SIZE * SIZE) { room.winner = "d"; }
      else room.turn = role === "b" ? "w" : "b";
      broadcast(room);
    } else if (m.t === "again") {
      if (role === "s" || !room.winner) return;
      // 重新開局，黑白互換
      const { b, w } = room.players;
      Object.assign(room, newRoomState(room));
      room.players = { b: w, w: b };
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
    for (const c of ["b", "w"]) if (room.players[c] === ws) room.players[c] = null;
    // 有旁觀者就遞補空位
    for (const w of room.clients) if (roleOf(room, w) === "s") assignSeat(room, w);
    if (room.clients.size === 0) room.emptySince = Date.now();
    broadcast(room);
  });
});

function newRoomState(room) {
  const fresh = newRoom();
  return { board: fresh.board, turn: "b", winner: null, line: null, last: null, moves: 0 };
}

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

console.log(`gomoku server listening on 127.0.0.1:${PORT}/ws`);
