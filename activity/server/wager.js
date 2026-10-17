// 棋類對賭：雙方各押同樣金額，贏的人拿走全部（平手各退各的）。
// 流程：A 提出賭注 → B 同意 → 伺服器先把兩邊的賭注從錢包扣掉（託管）→ 比賽 → 結束時派彩。
// 錢包只有機器人那邊能改；這裡透過 bet.js 的內部 API 扣款／派彩。
// 託管中的賭注會記在 escrow.json，伺服器如果在比賽途中重啟，啟動時會把賭注全額退回。
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { botSettle, botPay, botInfo } from "./bet.js";

export const WAGERS = [10, 50, 100, 500];
export const GRACE_MS = 30000;      // 賭注比賽中斷線，給 30 秒回來，沒回來就算輸
const FILE = fileURLToPath(new URL("./escrow.json", import.meta.url));

let escrow = {};
let seq = 0;
function save() { try { fs.writeFileSync(FILE, JSON.stringify(escrow)); } catch (e) { console.log("escrow 寫入失敗", e.message); } }

async function payRetry(uid, name, amount, why) {
  for (let i = 0; i < 5; i++) {
    try { const r = await botPay(uid, name, amount, why); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  console.log(`!! 派彩失敗：${name}(${uid}) ${amount}，需要人工補發`);
  return false;
}

// 啟動時退還上次沒結算的託管
export async function recoverEscrow() {
  try { escrow = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { escrow = {}; }
  const ids = Object.keys(escrow);
  for (const id of ids) {
    const w = escrow[id];
    for (const p of w.players) await payRetry(p.uid, p.name, w.amount, "對賭中斷退款");
    delete escrow[id]; save();
    console.log("已退還中斷的對賭", id);
  }
}

const other = (c) => (c === "b" ? "w" : "b");
const fresh = (room) => room.moves === 0 && !room.winner;

export function wagerView(room) {
  return {
    offer: room.offer ? { by: room.offer.by, amount: room.offer.amount, name: room.offer.name } : null,
    wager: room.wager ? { amount: room.wager.amount, names: room.wager.names, settled: room.wager.settled } : null,
    wresult: room.wresult || null,
    busy: !!room.busy,
  };
}

export function canWager(room) { return room.game === "gomoku" || room.game === "c4" || room.game === "rv"; }

// 回傳錯誤碼字串，成功回傳 null
export function makeOffer(room, ws, role, amount) {
  if (!canWager(room) || role === "s") return "not_player";
  if (!ws.user) return "need_login";
  if (!WAGERS.includes(amount)) return "bad_amount";
  if (room.wager || room.busy) return "already";
  if (!fresh(room)) return "not_fresh";
  if (!room.players.b || !room.players.w) return "need_opponent";
  const oth = room.players[other(role)];
  if (oth.user && oth.user.uid === ws.user.uid) return "same_user";
  room.offer = { by: role, amount, uid: ws.user.uid, name: ws.user.name };
  return null;
}

export function clearOffer(room) { room.offer = null; }

export async function acceptOffer(room, ws, role, rebroadcast) {
  const o = room.offer;
  if (!o || role === "s" || role === o.by) return "no_offer";
  if (!ws.user) return "need_login";
  if (ws.user.uid === o.uid) return "same_user";
  if (room.wager || room.busy || !fresh(room)) return "not_fresh";
  const proposer = room.players[o.by];
  if (!proposer || !proposer.user || proposer.user.uid !== o.uid) { room.offer = null; return "no_offer"; }
  room.busy = true; rebroadcast();
  const A = { uid: o.uid, name: o.name }, B = { uid: ws.user.uid, name: ws.user.name };
  const amount = o.amount;
  let err = null;
  const taken = [];
  try {
    // 兩邊都要留至少 1 個代幣（派彩備援用），先確認餘額
    for (const p of [A, B]) {
      const i = await botInfo(p.uid);
      if (!i.ok) { err = i.error || "bot_down"; break; }
      if (i.balance < amount + 1) { err = p === A ? "opp_broke" : "you_broke"; break; }
    }
    if (!err) for (const p of [A, B]) {
      const r = await botSettle(p.uid, p.name, amount, 0, "對賭押金");
      if (!r.ok) { err = r.error === "insufficient" ? (p === A ? "opp_broke" : "you_broke") : (r.error || "bot_down"); break; }
      taken.push(p);
    }
  } catch { err = "bot_down"; }
  // 扣款途中如果座位變了（有人離開），整筆退回
  const still = room.players[o.by] === proposer && room.players[role] === ws && fresh(room);
  if (!err && !still) err = "changed";
  if (err) {
    for (const p of taken) await payRetry(p.uid, p.name, amount, "對賭押金退回");
    room.busy = false; room.offer = null; rebroadcast();
    return err;
  }
  const id = String(++seq) + "-" + Date.now();
  const uid = { [o.by]: A.uid, [role]: B.uid }, names = { [o.by]: A.name, [role]: B.name };
  room.wager = { id, amount, uid, names, settled: false, timers: {} };
  room.wresult = null; room.offer = null; room.busy = false;
  escrow[id] = { amount, players: [A, B] }; save();
  rebroadcast();
  return null;
}

// 比賽結束後呼叫（room.winner 已經設好）：派彩
export function settleWager(room, rebroadcast) {
  const w = room.wager;
  if (!w || w.settled || !room.winner) return;
  w.settled = true;
  for (const t of Object.values(w.timers)) clearTimeout(t);
  w.timers = {};
  const win = room.winner;
  const jobs = [];
  if (win === "d") {
    for (const c of ["b", "w"]) jobs.push(payRetry(w.uid[c], w.names[c], w.amount, "對賭平手退款"));
    room.wresult = { amount: w.amount, winner: "d" };
  } else {
    jobs.push(payRetry(w.uid[win], w.names[win], w.amount * 2, "對賭獲勝"));
    room.wresult = { amount: w.amount, winner: win, name: w.names[win] };
  }
  rebroadcast();
  Promise.all(jobs).then(() => { delete escrow[w.id]; save(); });
}

// 玩家連線中斷：賭注比賽進入倒數
export function onPlayerLeft(room, c, rebroadcast) {
  const w = room.wager;
  if (!w || w.settled || room.winner) return;
  clearTimeout(w.timers[c]);
  w.timers[c] = setTimeout(() => {
    if (room.winner || w.settled || room.players[c]) return;
    room.winner = room.players[other(c)] ? other(c) : "d";   // 兩邊都不在就算平手退款
    room.line = null;
    settleWager(room, rebroadcast);
    rebroadcast();
  }, GRACE_MS);
}

// 已登入的玩家連回來：拿回原本的座位
export function reclaimSeat(room, ws) {
  const w = room.wager;
  if (!w || w.settled || room.winner || !ws.user) return false;
  for (const c of ["b", "w"]) {
    if (w.uid[c] === ws.user.uid && !room.players[c]) {
      room.players[c] = ws;
      clearTimeout(w.timers[c]); delete w.timers[c];
      return true;
    }
  }
  return false;
}

// 這個座位被賭注保留中（旁觀者不能補位）
export function seatReserved(room, c, ws) {
  const w = room.wager;
  if (!w || w.settled || room.winner) return false;
  return !(ws && ws.user && ws.user.uid === w.uid[c]);
}
