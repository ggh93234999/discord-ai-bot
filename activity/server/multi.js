// 最多 4 人同場的房間（小朋友下樓梯 down、小朋友上樓梯 up）。
// 流程：大廳（等人加入，任何一位玩家按「開始」）→ 遊戲中（60 tick/秒）→ 結算 → 再來一局（回大廳）。
// 一個 Discord Activity instance + 遊戲種類 = 一個房間；滿 4 人之後進來的人旁觀。
import * as ST from "./stairs.js";

export const MULTI_GAMES = ["down", "up"];
const rooms = new Map();
const SEATS = 4;

function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }

function getRoom(game, id) {
  const key = `${game}:${id}`;
  if (!rooms.has(key)) rooms.set(key, { key, game, state: "lobby", seats: Array(SEATS).fill(null), clients: new Set(), sim: null, input: Array(SEATS).fill(null).map(() => ({})), result: null, emptySince: null, n: 0, record: 0, diff: "normal" });
  return rooms.get(key);
}

const seatOf = (r, ws) => r.seats.indexOf(ws);

function broadcast(r) {
  const snap = r.sim && r.state !== "lobby" ? ST.snapshot(r.sim) : undefined;
  for (const ws of r.clients) {
    send(ws, { t: "mstate", game: r.game, state: r.state, you: seatOf(r, ws), seats: r.seats.map((s) => !!s), watchers: r.clients.size - r.seats.filter(Boolean).length, snap, result: r.result, diff: r.diff, record: Math.max(r.record, r.sim && r.sim.floor || 0) });
  }
  if (r.sim) ST.clearEvents(r.sim);     // 事件（音效用）送出後清掉
}

function fillSeats(r) {
  for (const ws of r.clients) if (seatOf(r, ws) < 0) { const i = r.seats.indexOf(null); if (i >= 0) r.seats[i] = ws; }
}

export function joinMulti(ws, game, id) {
  const r = getRoom(game, String(id || "default").slice(0, 80));
  ws.multi = r;
  r.clients.add(ws);
  r.emptySince = null;
  if (r.state === "lobby") fillSeats(r);
  broadcast(r);
}

export function handleMulti(ws, m) {
  const r = ws.multi;
  if (!r) return;
  const seat = seatOf(r, ws);
  if (m.t === "in") {
    if (seat >= 0 && r.state === "play") r.input[seat] = { l: !!m.l, r: !!m.r };
  } else if (m.t === "start") {
    if (seat < 0 || r.state !== "lobby") return;
    const seats = r.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    r.sim = ST.create(r.game, seats, { diff: r.diff });
    r.input = Array(SEATS).fill(null).map(() => ({}));
    r.result = null; r.state = "play";
    broadcast(r);
  } else if (m.t === "diff") {
    if (seat < 0 || r.state !== "lobby" || !["easy", "normal", "hard"].includes(m.v)) return;
    r.diff = m.v; broadcast(r);
  } else if (m.t === "again") {
    if (seat < 0 || r.state !== "over") return;
    r.state = "lobby"; r.sim = null; r.result = null;
    // 已離開的座位空出來，旁觀的人補位
    fillSeats(r);
    broadcast(r);
  }
}

export function leaveMulti(ws) {
  const r = ws.multi;
  if (!r) return;
  r.clients.delete(ws);
  const i = seatOf(r, ws);
  if (i >= 0) {
    r.seats[i] = null;
    if (r.state === "play" && r.sim) {          // 遊戲中離開：當場淘汰
      const p = r.sim.ps.find((q) => q.seat === i);
      if (p && p.alive) { p.alive = false; r.sim.deaths.push(i); }
    }
  }
  if (r.state === "lobby") fillSeats(r);
  if (r.clients.size === 0) r.emptySince = Date.now();
  broadcast(r);
}

// 每個 tick（60Hz）呼叫一次；每兩個 tick 廣播一次快照（30 次/秒）
export function tickMulti() {
  for (const [key, r] of rooms) {
    if (r.state === "play" && r.sim) {
      ST.step(r.sim, r.input);
      r.n++;
      if (r.sim.over) {
        r.state = "over";
        r.record = Math.max(r.record, r.sim.floor || 0);
        r.result = { winner: r.sim.winner, rank: ST.ranking(r.sim) };
        broadcast(r);
      } else if (r.n % 2 === 0) broadcast(r);
    }
    if (r.clients.size === 0 && r.emptySince && Date.now() - r.emptySince > 10 * 60 * 1000) rooms.delete(key);
  }
}
