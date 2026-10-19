// 西洋棋規則：完整合法走法（王車易位、吃過路兵、升變）、將死／逼和／三次重複／五十步／子力不足和棋。
// 棋盤 64 格，index = 橫排 * 8 + 直行，橫排 0 在最上面（黑方底線）。大寫 = 白棋 = 先手（房間裡的 "b"），小寫 = 黑棋 = 後手（"w"）。
const isW = (p) => p >= "A" && p <= "Z";
const at = (sq, r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? null : sq[r * 8 + c]);
const N8 = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const K8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], OR = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const key = (st) => st.sq.join("") + st.turn + st.castle + st.ep;

export function init() {
  const back = "rnbqkbnr";
  const sq = [...back, ..."pppppppp", ...".".repeat(32), ..."PPPPPPPP", ...back.toUpperCase()];
  const st = { sq, turn: "b", castle: "KQkq", ep: -1, half: 0, seen: {} };
  st.seen[key(st)] = 1;
  return st;
}

// idx 這格有沒有被 by 方（"b" 白 / "w" 黑）攻擊
function attacked(sq, idx, by) {
  const r = idx >> 3, c = idx & 7, wh = by === "b";
  const P = wh ? "P" : "p", N = wh ? "N" : "n", B = wh ? "B" : "b", R = wh ? "R" : "r", Q = wh ? "Q" : "q", K = wh ? "K" : "k";
  const pr = wh ? r + 1 : r - 1;
  if (at(sq, pr, c - 1) === P || at(sq, pr, c + 1) === P) return true;
  for (const [dr, dc] of N8) if (at(sq, r + dr, c + dc) === N) return true;
  for (const [dr, dc] of K8) if (at(sq, r + dr, c + dc) === K) return true;
  for (const [dr, dc] of DG) { let rr = r + dr, cc = c + dc, p; while ((p = at(sq, rr, cc)) === ".") { rr += dr; cc += dc; } if (p === B || p === Q) return true; }
  for (const [dr, dc] of OR) { let rr = r + dr, cc = c + dc, p; while ((p = at(sq, rr, cc)) === ".") { rr += dr; cc += dc; } if (p === R || p === Q) return true; }
  return false;
}
const kingIdx = (sq, wh) => sq.indexOf(wh ? "K" : "k");
// 輪到的那方是不是正被將軍（電腦搜尋用）
export function checked(st) { const wh = st.turn === "b", k = kingIdx(st.sq, wh); return k >= 0 && attacked(st.sq, k, wh ? "w" : "b"); }

function pseudo(st) {
  const { sq } = st, wh = st.turn === "b", out = [];
  const enemy = (p) => p !== null && p !== "." && isW(p) !== wh;
  for (let i = 0; i < 64; i++) {
    const p = sq[i];
    if (p === "." || isW(p) !== wh) continue;
    const r = i >> 3, c = i & 7, lo = p.toLowerCase();
    const add = (t, extra) => out.push({ f: i, t, ...extra });
    if (lo === "p") {
      const dir = wh ? -1 : 1, start = wh ? 6 : 1, last = wh ? 0 : 7, r1 = r + dir;
      const push = (t) => { if (r1 === last) for (const q of "qrbn") add(t, { p: q }); else add(t); };
      if (at(sq, r1, c) === ".") { push(r1 * 8 + c); if (r === start && at(sq, r + 2 * dir, c) === ".") add((r + 2 * dir) * 8 + c); }
      for (const dc of [-1, 1]) {
        const cc = c + dc, t = at(sq, r1, cc);
        if (enemy(t)) push(r1 * 8 + cc);
        else if (t === "." && r1 * 8 + cc === st.ep) add(r1 * 8 + cc, { ep: true });
      }
    } else if (lo === "n" || lo === "k") {
      for (const [dr, dc] of lo === "n" ? N8 : K8) {
        const t = at(sq, r + dr, c + dc);
        if (t === null || (t !== "." && isW(t) === wh)) continue;
        add((r + dr) * 8 + c + dc);
      }
      if (lo === "k") {
        const opp = wh ? "w" : "b";
        if (wh && i === 60 && !attacked(sq, 60, opp)) {
          if (st.castle.includes("K") && sq[61] === "." && sq[62] === "." && sq[63] === "R" && !attacked(sq, 61, opp) && !attacked(sq, 62, opp)) add(62, { cs: true });
          if (st.castle.includes("Q") && sq[59] === "." && sq[58] === "." && sq[57] === "." && sq[56] === "R" && !attacked(sq, 59, opp) && !attacked(sq, 58, opp)) add(58, { cs: true });
        }
        if (!wh && i === 4 && !attacked(sq, 4, opp)) {
          if (st.castle.includes("k") && sq[5] === "." && sq[6] === "." && sq[7] === "r" && !attacked(sq, 5, opp) && !attacked(sq, 6, opp)) add(6, { cs: true });
          if (st.castle.includes("q") && sq[3] === "." && sq[2] === "." && sq[1] === "." && sq[0] === "r" && !attacked(sq, 3, opp) && !attacked(sq, 2, opp)) add(2, { cs: true });
        }
      }
    } else {
      const dirs = lo === "b" ? DG : lo === "r" ? OR : [...DG, ...OR];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc, t;
        while ((t = at(sq, rr, cc)) !== null) {
          if (t === ".") add(rr * 8 + cc);
          else { if (isW(t) !== wh) add(rr * 8 + cc); break; }
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

export function apply(st, m, quick) {
  const sq = st.sq.slice(), p = sq[m.f], wh = isW(p), cap = sq[m.t] !== ".";
  sq[m.t] = m.p ? (wh ? m.p.toUpperCase() : m.p.toLowerCase()) : p; sq[m.f] = ".";
  if (m.ep) sq[m.t + (wh ? 8 : -8)] = ".";
  if (m.cs) {
    if (m.t === 62) { sq[61] = sq[63]; sq[63] = "."; } else if (m.t === 58) { sq[59] = sq[56]; sq[56] = "."; }
    else if (m.t === 6) { sq[5] = sq[7]; sq[7] = "."; } else if (m.t === 2) { sq[3] = sq[0]; sq[0] = "."; }
  }
  let castle = st.castle;
  if (p === "K") castle = castle.replace(/[KQ]/g, ""); if (p === "k") castle = castle.replace(/[kq]/g, "");
  for (const [s, ch] of [[63, "K"], [56, "Q"], [7, "k"], [0, "q"]]) if (m.f === s || m.t === s) castle = castle.replace(ch, "");
  const pawn = p.toLowerCase() === "p";
  const n = { sq, turn: wh ? "w" : "b", castle, ep: pawn && Math.abs(m.t - m.f) === 16 ? (m.f + m.t) / 2 : -1, half: pawn || cap || m.ep ? 0 : st.half + 1 };
  if (!quick) { n.seen = { ...st.seen }; const k = key(n); n.seen[k] = (n.seen[k] || 0) + 1; }
  return n;
}

export function moves(st) {
  const wh = st.turn === "b";
  return pseudo(st).filter((m) => { const n = apply(st, m, true); return !attacked(n.sq, kingIdx(n.sq, wh), wh ? "w" : "b"); });
}

function insufficient(sq) {
  const rest = sq.filter((p) => p !== "." && p.toLowerCase() !== "k").map((p) => p.toLowerCase());
  if (!rest.length) return true;
  if (rest.length === 1 && (rest[0] === "n" || rest[0] === "b")) return true;
  return false;
}

// 目前輪到的人之後的狀況：{ over, winner, reason, check(被將軍的王的位置或 -1), list(合法走法) }
export function outcome(st) {
  const list = moves(st), wh = st.turn === "b";
  const k = kingIdx(st.sq, wh), inCheck = k >= 0 && attacked(st.sq, k, wh ? "w" : "b");
  const res = { over: false, winner: null, reason: "", check: inCheck ? k : -1, list };
  if (!list.length) { res.over = true; if (inCheck) { res.winner = wh ? "w" : "b"; res.reason = "將死"; } else { res.winner = "d"; res.reason = "逼和（無子可動）"; } }
  else if (insufficient(st.sq)) { res.over = true; res.winner = "d"; res.reason = "子力不足，和棋"; }
  else if (st.half >= 100) { res.over = true; res.winner = "d"; res.reason = "五十步無吃子也沒走兵，和棋"; }
  else if ((st.seen[key(st)] || 0) >= 3) { res.over = true; res.winner = "d"; res.reason = "同一局面出現三次，和棋"; }
  return res;
}

export function perft(st, d) { if (!d) return 1; let n = 0; for (const m of moves(st)) n += d === 1 ? 1 : perft(apply(st, m, true), d - 1); return n; }
