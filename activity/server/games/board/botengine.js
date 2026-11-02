// 西洋棋、象棋的電腦對手：alpha-beta（負極大值）+ 置換表 + PVS + 後段走法縮減 + 靜止搜尋。規則直接用 chess.js / xq.js，所以走法一定合法。
// 等級 1~4：新手（只看一步，常亂走）、普通（看兩步）、高手（限時 0.9 秒）、大師（限時 3 秒）。
// 評估和搜尋都是從「輪到的那一方」的角度算分，分數單位約等於 1/100 個兵。
// 加速重點：走法先不檢查合法，真的要走才檢查（被剪掉的走法就省了）；同一局面查表不重算；容易的走法少看一層。
import * as chessEng from "./chess.js";
import * as xqEng from "./xq.js";

export const LEVELS = [
  null,
  { name: "新手", depth: 1, qd: 0, noise: 170, rnd: 0.12 },
  { name: "普通", depth: 2, qd: 3, noise: 45, rnd: 0 },
  { name: "高手", depth: 20, qd: 8, ms: 900, noise: 0, rnd: 0 },
  { name: "大師", depth: 30, qd: 10, ms: 3000, noise: 0, rnd: 0 },
];

const MATE = 100000, INF = 1e9;
const ENG = { chess: chessEng, xq: xqEng };
const HALF = { chess: 100, xq: 120 };

// ---------- 西洋棋評估 ----------
const CV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const T = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  ke: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
};
const mir = (i) => ((7 - (i >> 3)) << 3) | (i & 7);

function evalChess(st) {
  const sq = st.sq;
  let mat = 0, wb = 0, bb = 0, queens = 0;
  for (let i = 0; i < 64; i++) {
    const p = sq[i]; if (p === ".") continue;
    const l = p.toLowerCase(); if (l === "q") queens++;
    if (l !== "p" && l !== "k") mat += CV[l];
    if (l === "b") { if (p === "B") wb++; else bb++; }
  }
  const end = queens === 0 || mat < 2600;
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = sq[i]; if (p === ".") continue;
    const l = p.toLowerCase(), up = p < "a";
    const tb = l === "k" ? (end ? T.ke : T.k) : T[l];
    const v = CV[l] + (up ? tb[i] : tb[mir(i)]);
    s += up ? v : -v;
  }
  if (wb >= 2) s += 30; if (bb >= 2) s -= 30;
  return st.turn === "b" ? s + 10 : -s + 10;
}

// ---------- 象棋評估 ----------
// 子力（車 9、炮 4.5、馬 4、仕相各 2、兵 1，過河 2）加上：兵過河越深越好、馬的活動（馬腳沒被塞）、車的活動範圍與開線、
// 炮站中路、仕相在對方火力強時更值錢、過河的兵互相連著、車炮對準老將所在的直行。
const XV = { r: 900, c: 450, h: 400, e: 200, a: 200, p: 100, k: 0 };
const XOR = [[-1, 0], [1, 0], [0, -1], [0, 1]];
function evalXq(st) {
  const sq = st.sq, pawnsR = new Int8Array(9), pawnsB = new Int8Array(9);
  let kR = -1, kB = -1, atkR = 0, atkB = 0;
  for (let i = 0; i < 90; i++) {
    const p = sq[i];
    if (p === ".") continue;
    switch (p) {
      case "P": pawnsR[i % 9]++; break;
      case "p": pawnsB[i % 9]++; break;
      case "K": kR = i; break;
      case "k": kB = i; break;
      case "R": case "C": case "H": atkR++; break;
      case "r": case "c": case "h": atkB++; break;
    }
  }
  const fR = kR >= 0 ? kR % 9 : -1, fB = kB >= 0 ? kB % 9 : -1;       // 雙方老將所在的直行
  let s = 0;
  for (let i = 0; i < 90; i++) {
    const p = sq[i]; if (p === ".") continue;
    const red = p < "a", l = p.toLowerCase(), r0 = (i / 9) | 0, c = i % 9;
    const r = red ? r0 : 9 - r0;                                   // 換成紅方視角：r 越小越靠近對方
    let v = XV[l];
    if (l === "p") {
      if (r <= 4) {
        v += 100 + (4 - r) * 12 + (c >= 3 && c <= 5 ? 12 : 0);
        if (c < 8 && sq[i + 1] === p) v += 10;                     // 過河的兵並排互相保護
      }
    } else if (l === "h") {
      let free = 0;
      for (const [dr, dc] of XOR) { const rr = r0 + dr, cc = c + dc; if (rr >= 0 && rr < 10 && cc >= 0 && cc < 9 && sq[rr * 9 + cc] === ".") free++; }
      v += 26 - 5 * Math.abs(c - 4) - 2 * Math.abs(r - 4.5) - (r === 9 ? 15 : 0) + free * 5 - (free === 0 ? 12 : 0) - (c === 0 || c === 8 ? 8 : 0);
    } else if (l === "r") {
      let mob = 0;
      for (const [dr, dc] of XOR) { let rr = r0 + dr, cc = c + dc; while (rr >= 0 && rr < 10 && cc >= 0 && cc < 9 && sq[rr * 9 + cc] === ".") { mob++; rr += dr; cc += dc; } }
      const own = red ? pawnsR[c] : pawnsB[c], ek = red ? fB : fR;
      v += mob * 2 + (own === 0 ? 8 : 0) + (r <= 4 ? 10 : 0) + (r === 9 ? -6 : 0) + (c === ek ? 8 : 0);
    } else if (l === "c") {
      const ek = red ? fB : fR;
      v += (c === 4 ? 12 : 0) + (r <= 6 && r >= 2 ? 6 : 0) + (c === ek ? 10 : 0);
    } else if (l === "a" || l === "e") {
      const ea = red ? atkB : atkR;
      v += ea >= 3 ? 14 : ea >= 1 ? 8 : 3;                          // 對方火力越強，仕相越重要
    }
    s += red ? v : -v;
  }
  return st.turn === "b" ? s + 10 : -s + 10;
}

// ---------- 雜湊（置換表用）----------
let seed = 0x9e3779b9;
const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
const ZPC = {};
for (const ch of "PNBRQKpnbrqkHEACheac") ZPC[ch] = [Int32Array.from({ length: 90 }, rnd32), Int32Array.from({ length: 90 }, rnd32)];
const ZT = [rnd32(), rnd32()], ZC = { K: [rnd32(), rnd32()], Q: [rnd32(), rnd32()], k: [rnd32(), rnd32()], q: [rnd32(), rnd32()] }, ZE = Array.from({ length: 8 }, () => [rnd32(), rnd32()]);
function hashOf(s, chess) {
  const sq = s.sq, N = sq.length;
  let h1 = 0, h2 = 0;
  for (let i = 0; i < N; i++) { const p = sq[i]; if (p !== ".") { const z = ZPC[p]; h1 ^= z[0][i]; h2 ^= z[1][i]; } }
  if (s.turn === "w") { h1 ^= ZT[0]; h2 ^= ZT[1]; }
  if (chess) {
    for (const ch of s.castle) { h1 ^= ZC[ch][0]; h2 ^= ZC[ch][1]; }
    if (s.ep >= 0) { h1 ^= ZE[s.ep & 7][0]; h2 ^= ZE[s.ep & 7][1]; }
  }
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) >>> 11);
}

// ---------- 搜尋 ----------
class Abort extends Error {}
const toTT = (v, ply) => (v > MATE - 500 ? v + ply : v < -MATE + 500 ? v - ply : v);
const fromTT = (v, ply) => (v > MATE - 500 ? v - ply : v < -MATE + 500 ? v + ply : v);

export function pickMove(game, st, lv, rnd = Math.random) {
  const eng = ENG[game], isChess = game === "chess", evalFn = isChess ? evalChess : evalXq, half = HALF[game];
  const VAL = isChess ? CV : XV, N = isChess ? 64 : 90;
  const hist = new Int32Array(N * N), killers = [], TT = new Map();
  let nodes = 0, deadline = Infinity;

  const capScore = (sq, m) => {
    const v = sq[m.t];
    let s = 0;
    if (v !== ".") s = 100000 + 10 * VAL[v.toLowerCase()] - VAL[sq[m.f].toLowerCase()] / 10;
    else if (m.ep) s = 100000 + 900;
    if (m.p) s += m.p === "q" ? 90000 : 0;
    return s;
  };
  function order(ms, sq, ply, tm) {
    const k = killers[ply];
    for (const m of ms) {
      if (tm && m.f === tm.f && m.t === tm.t && (m.p || "") === (tm.p || "")) { m.o = 1e9; continue; }
      let s = capScore(sq, m);
      if (!s) s = hist[m.f * N + m.t] + (k && ((k[0] && k[0].f === m.f && k[0].t === m.t) || (k[1] && k[1].f === m.f && k[1].t === m.t)) ? 5000 : 0);
      m.o = s;
    }
    ms.sort((a, b) => b.o - a.o);
  }
  const tick = () => { if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Abort(); };

  function qs(s, alpha, beta, qd) {
    tick();
    const stand = evalFn(s);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd <= 0) return stand;
    const caps = eng.pseudoMoves(s).filter((m) => s.sq[m.t] !== "." || m.ep);
    order(caps, s.sq, 0, null);
    for (const m of caps) {
      const n = eng.apply(s, m, true);
      if (eng.movedIntoCheck(n)) continue;
      const v = -qs(n, -beta, -alpha, qd - 1);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  const hasPieces = (s) => {
    const w = s.turn === "b";
    for (let i = 0; i < 64; i++) { const p = s.sq[i]; if (p !== "." && p !== "P" && p !== "p" && p !== "K" && p !== "k" && (p < "a") === w) return true; }
    return false;
  };

  function ab(s, depth, alpha, beta, ply, canNull) {
    if (s.half >= half) return 0;
    const inChk = eng.checked(s);
    if (inChk && ply < 24) depth = depth <= 0 ? 1 : depth + 1;                  // 被將軍時多看一步
    if (depth <= 0) return lv.qd > 0 ? qs(s, alpha, beta, lv.qd) : evalFn(s);
    tick();
    const key = hashOf(s, isChess), tt = TT.get(key), a0 = alpha;
    let ttMove = null;
    if (tt) {
      ttMove = tt.m;
      if (tt.d >= depth) {
        const v = fromTT(tt.v, ply);
        if (tt.f === 0) return v;
        if (tt.f === 1 && v > alpha) alpha = v;
        else if (tt.f === 2 && v < beta) beta = v;
        if (alpha >= beta) return v;
      }
    }
    if (isChess && canNull && !inChk && depth >= 3 && beta < MATE - 500 && hasPieces(s)) {      // 空步：讓對方連走兩次還是壓得住，就直接剪掉
      const ns = { sq: s.sq, turn: s.turn === "b" ? "w" : "b", castle: s.castle, ep: -1, half: s.half + 1 };
      const v = -ab(ns, depth - 3, -beta, -beta + 1, ply + 1, false);
      if (v >= beta) return v >= MATE - 500 ? beta : v;
    }
    const ms = eng.pseudoMoves(s);
    order(ms, s.sq, ply, ttMove);
    let best = -INF, bestM = null, legal = 0;
    for (const m of ms) {
      const n = eng.apply(s, m, true);
      if (eng.movedIntoCheck(n)) continue;
      legal++;
      const quiet = s.sq[m.t] === "." && !m.ep && !m.p;
      let v;
      if (legal === 1) v = -ab(n, depth - 1, -beta, -alpha, ply + 1, true);
      else {
        const red = depth >= 3 && legal > 3 && quiet && !inChk ? (depth >= 5 && legal > 8 ? 2 : 1) : 0;     // 排在後面的安靜走法少看一兩層
        v = -ab(n, depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
        if (v > alpha && red > 0) v = -ab(n, depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (v > alpha && v < beta) v = -ab(n, depth - 1, -beta, -alpha, ply + 1, true);
      }
      if (v > best) { best = v; bestM = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (quiet) { (killers[ply] ||= [null, null]); if (killers[ply][0] !== m) { killers[ply][1] = killers[ply][0]; killers[ply][0] = m; } hist[m.f * N + m.t] += depth * depth; }
        break;
      }
    }
    if (!legal) return isChess ? (inChk ? -MATE + ply : 0) : -MATE + ply;
    if (TT.size > 600000) TT.clear();
    TT.set(key, { d: depth, v: toTT(best, ply), f: best <= a0 ? 2 : best >= beta ? 1 : 0, m: bestM ? { f: bestM.f, t: bestM.t, ...(bestM.p ? { p: bestM.p } : {}) } : null });
    return best;
  }

  const root = eng.moves(st);
  if (!root.length) return null;
  const pub = (m) => ({ f: m.f, t: m.t, ...(m.p ? { p: m.p } : {}) });
  if (root.length === 1) return pub(root[0]);
  if (lv.rnd && rnd() < lv.rnd) return pub(root[(rnd() * root.length) | 0]);

  // 根節點：先看會不會立刻和棋（三次重複），其他交給搜尋
  const info = root.map((m) => {
    const n = eng.apply(st, m), cnt = n.seen[eng.key(n)] || 0;
    return { m, n, cnt };
  });
  const gauss = () => { let a = 0; for (let i = 0; i < 4; i++) a += rnd(); return (a - 2) * 1.7; };
  const adj = (x, v) => (x.cnt >= 3 ? 0 : x.cnt === 2 && v > 40 ? v - 60 : v);        // 重複局面：領先時盡量避開

  if (lv.noise) {                                   // 新手／普通：固定深度，每個走法都算分，再加雜訊
    for (const x of info) x.v = adj(x, -ab(x.n, lv.depth - 1, -INF, INF, 1, true)) + gauss() * lv.noise;
    info.sort((a, b) => b.v - a.v);
    return pub(info[0].m);
  }

  deadline = Date.now() + (lv.ms || 1000);
  for (let i = info.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [info[i], info[j]] = [info[j], info[i]]; }   // 同分時隨機，開局才不會每次都一樣
  info.sort((a, b) => capScore(st.sq, b.m) - capScore(st.sq, a.m));
  let bestMove = info[0], done = 0;
  for (let d = 1; d <= lv.depth; d++) {
    try {
      let alpha = -INF, curBest = null;
      for (const x of info) {
        let v;
        if (x.cnt >= 3) v = 0;
        else if (!curBest) v = adj(x, -ab(x.n, d - 1, -INF, INF, 1, true));
        else {
          v = -ab(x.n, d - 1, -alpha - 1, -alpha, 1, true);
          if (v > alpha) v = -ab(x.n, d - 1, -INF, -alpha, 1, true);
          v = adj(x, v);
        }
        x.v = v;
        if (!curBest || v > curBest.v) { curBest = x; if (v > alpha) alpha = v; }
      }
      bestMove = curBest; done = d;
      info.sort((a, b) => (a === curBest ? -1 : b === curBest ? 1 : b.v - a.v));
      if (Math.abs(curBest.v) > MATE - 200) break;               // 已經看到將死
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      break;
    }
  }
  pickMove.last = { depth: done, nodes, score: bestMove.v };
  return pub(bestMove.m);
}
