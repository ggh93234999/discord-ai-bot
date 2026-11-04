// 俄羅斯方塊對戰（參考 Tetris Battle）：2 人，其他人旁觀。
// 為了手感，方塊的移動、旋轉、下落都在各自的瀏覽器算（同一個 seed ＝ 兩邊拿到一樣的方塊順序）；
// 伺服器只當裁判：中繼對方的盤面、管「待接垃圾行」（攻擊先抵銷自己的待接，剩下的才送給對手）、判定誰先死。
// 訊息：ttjoin ttname ttstart ttb ttclear ttlock ttdead ttagain
const rooms = new Map();
const MAX_GARBAGE_PER_LOCK = 8;       // 一次落地最多升起幾行垃圾

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { id, state: "lobby", seats: [null, null], clients: new Set(), seed: 0, t0: 0, pending: [0, 0], wins: [0, 0], winner: -1, reason: "", emptySince: null });
  return rooms.get(id);
}
const seatOf = (r, ws) => r.seats.indexOf(ws);
const nameOf = (ws) => (ws && ws.ttName) || "玩家";

function broadcast(r) {
  const base = { t: "ttstate", state: r.state, names: r.seats.map((s) => (s ? nameOf(s) : "")), seed: r.seed, t0: r.t0, pending: r.pending, wins: r.wins, winner: r.winner, reason: r.reason, watchers: r.clients.size - r.seats.filter(Boolean).length };
  for (const ws of r.clients) send(ws, { ...base, you: seatOf(r, ws), now: Date.now() });
}
const toAll = (r, o, except) => { for (const ws of r.clients) if (ws !== except) send(ws, o); };

function fillSeats(r) {
  for (const ws of r.clients) if (seatOf(r, ws) < 0) { const i = r.seats.indexOf(null); if (i >= 0) r.seats[i] = ws; }
}

function finish(r, winner, reason) {
  if (r.state !== "play") return;
  r.state = "over"; r.winner = winner; r.reason = reason;
  if (winner >= 0) r.wins[winner]++;
  broadcast(r);
}

export function tetrisClose(ws) {
  const r = ws.tt; if (!r) return;
  ws.tt = null; r.clients.delete(ws);
  const i = r.seats.indexOf(ws);
  if (i >= 0) {
    r.seats[i] = null;
    if (r.state === "play") finish(r, 1 - i, "對手離開了");
    if (r.state !== "play") { r.wins = [0, 0].map((_, k) => (r.seats[k] ? r.wins[k] : 0)); fillSeats(r); }
  }
  if (!r.clients.size) r.emptySince = Date.now();
  broadcast(r);
}

export function handleTetris(ws, m) {
  if (m.t === "ttjoin") {
    if (ws.tt) return;
    const r = getRoom(String(m.room || "default").slice(0, 80));
    ws.tt = r; ws.ttName = cleanName(m.name) || cleanName(ws.gname) || cleanName(ws.user && ws.user.name) || "玩家";
    r.clients.add(ws); r.emptySince = null;
    if (r.state !== "play") fillSeats(r);
    broadcast(r);
    return;
  }
  const r = ws.tt; if (!r) return;
  const seat = seatOf(r, ws);
  if (m.t === "ttname") { ws.ttName = cleanName(m.name) || ws.ttName; broadcast(r); }
  else if (m.t === "ttstart") {
    if (seat < 0 || !r.seats[0] || !r.seats[1] || r.state === "play") return;
    r.state = "play"; r.seed = (Math.random() * 4294967296) >>> 0; r.t0 = Date.now() + 3500;       // 3.5 秒倒數後同時開始
    r.pending = [0, 0]; r.winner = -1; r.reason = "";
    broadcast(r);
  } else if (m.t === "ttb") {                                                  // 我的盤面（給對手和旁觀者看）
    if (seat < 0 || r.state !== "play") return;
    toAll(r, { t: "ttopp", seat, b: String(m.b || "").slice(0, 260), s: Number(m.s) | 0, l: Number(m.l) | 0, h: String(m.h || "").slice(0, 1), n: String(m.n || "").slice(0, 6) }, ws);
  } else if (m.t === "ttclear") {                                              // 我消行了，攻擊 atk 行
    if (seat < 0 || r.state !== "play") return;
    const atk = Math.max(0, Math.min(30, Number(m.atk) | 0));
    const cancel = Math.min(r.pending[seat], atk);
    r.pending[seat] -= cancel;
    r.pending[1 - seat] += atk - cancel;
    toAll(r, { t: "ttfx", seat, atk, cancel, label: String(m.label || "").slice(0, 20), combo: Number(m.combo) | 0, b2b: !!m.b2b });
    toAll(r, { t: "ttpend", pending: r.pending });
  } else if (m.t === "ttlock") {                                               // 我落地一塊；沒消行的話，待接的垃圾這時升起來
    if (seat < 0 || r.state !== "play" || m.cleared || !r.pending[seat]) return;
    const n = Math.min(r.pending[seat], MAX_GARBAGE_PER_LOCK);
    r.pending[seat] -= n;
    send(ws, { t: "ttgarb", n, col: Math.floor(Math.random() * 10) });
    toAll(r, { t: "ttpend", pending: r.pending });
  } else if (m.t === "ttdead") {
    if (seat < 0) return;
    finish(r, 1 - seat, "對手頂到頂了");
  } else if (m.t === "ttagain") {
    if (seat < 0 || r.state !== "over") return;
    r.state = "lobby"; r.winner = -1; r.reason = ""; r.pending = [0, 0];
    fillSeats(r);
    broadcast(r);
  }
}

export function tickTetris() {
  for (const [id, r] of rooms) if (!r.clients.size && r.emptySince && Date.now() - r.emptySince > 10 * 60 * 1000) rooms.delete(id);
}
