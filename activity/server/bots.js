// 棋類電腦對手的管理：兩條搜尋執行緒輪流接工作；壞掉或太久沒回就隨便挑一個合法走法，不讓對局卡死。
import { Worker } from "node:worker_threads";
import * as chessEng from "./chess.js";
import * as xqEng from "./xq.js";

const ENG = { chess: chessEng, xq: xqEng };
export { LEVELS } from "./botengine.js";
const POOL = 2, TIMEOUT = 15000;
const workers = [], pend = new Map();
let seq = 0, rr = 0;

function spawn(i) {
  const w = new Worker(new URL("./botworker.js", import.meta.url));
  w.on("message", (m) => { const p = pend.get(m.id); if (p) { pend.delete(m.id); clearTimeout(p.timer); p.resolve(m.error ? null : m.move); } });
  const dead = () => {
    workers[i] = null;
    for (const [id, p] of pend) if (p.w === w) { pend.delete(id); clearTimeout(p.timer); p.resolve(null); }
  };
  w.on("error", (e) => { console.log("bot worker error", e && e.message); dead(); });
  w.on("exit", dead);
  w.unref();
  workers[i] = w;
  return w;
}

function fallback(game, st) {
  const ms = ENG[game].moves(st);
  if (!ms.length) return null;
  const m = ms[(Math.random() * ms.length) | 0];
  return { f: m.f, t: m.t, ...(m.p ? { p: m.p } : {}) };
}

// 回傳 { f, t, p? }；st 是 chess.js / xq.js 的局面物件
export function thinkMove(game, st, level) {
  const i = rr++ % POOL, w = workers[i] || spawn(i), id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pend.delete(id); resolve(null); }, TIMEOUT);
    pend.set(id, { resolve, timer, w });
    try { w.postMessage({ id, game, st, level }); } catch { pend.delete(id); clearTimeout(timer); resolve(null); }
  }).then((m) => m || fallback(game, st));
}
