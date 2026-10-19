// 象棋規則：9 直行 × 10 橫排，index = 橫排 * 9 + 直行，橫排 0 在最上面（黑方）。
// 大寫 = 紅棋 = 先手（房間裡的 "b"），小寫 = 黑棋 = 後手（"w"）。
// R 車 H 馬 E 相／象 A 仕／士 K 帥／將 C 炮／砲 P 兵／卒。沒有走法（被將死或困斃）就輸；王不能面對面（飛將）。
const W = 9, H = 10;
const isRed = (p) => p >= "A" && p <= "Z";
const at = (sq, r, c) => (r < 0 || r >= H || c < 0 || c >= W ? null : sq[r * W + c]);
const OR = [[-1, 0], [1, 0], [0, -1], [0, 1]], DG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const key = (st) => st.sq.join("") + st.turn;

export function init() {
  const rows = ["rheakaehr", ".........", ".c.....c.", "p.p.p.p.p", ".........", ".........", "P.P.P.P.P", ".C.....C.", ".........", "RHEAKAEHR"];
  const st = { sq: rows.join("").split(""), turn: "b", half: 0, seen: {} };
  st.seen[key(st)] = 1;
  return st;
}

// side 方所有「偽合法」走法（還沒檢查自己的王有沒有被吃）
function pseudo(sq, red) {
  const out = [];
  const ok = (t) => t !== null && (t === "." || isRed(t) !== red);
  for (let i = 0; i < W * H; i++) {
    const p = sq[i];
    if (p === "." || isRed(p) !== red) continue;
    const r = Math.floor(i / W), c = i % W, lo = p.toLowerCase();
    const add = (rr, cc) => out.push({ f: i, t: rr * W + cc });
    const inPalace = (rr, cc) => cc >= 3 && cc <= 5 && (red ? rr >= 7 : rr <= 2);
    if (lo === "r") {
      for (const [dr, dc] of OR) { let rr = r + dr, cc = c + dc, t; while ((t = at(sq, rr, cc)) !== null) { if (t === ".") add(rr, cc); else { if (ok(t)) add(rr, cc); break; } rr += dr; cc += dc; } }
    } else if (lo === "c") {
      for (const [dr, dc] of OR) {
        let rr = r + dr, cc = c + dc, t;
        while ((t = at(sq, rr, cc)) === ".") { add(rr, cc); rr += dr; cc += dc; }
        if (t === null) continue;
        rr += dr; cc += dc;                                           // 越過砲架，找第一顆子
        while ((t = at(sq, rr, cc)) === ".") { rr += dr; cc += dc; }
        if (t !== null && isRed(t) !== red) add(rr, cc);
      }
    } else if (lo === "h") {
      for (const [dr, dc] of OR) {
        if (at(sq, r + dr, c + dc) !== ".") continue;                 // 拐馬腳
        const dests = dr !== 0 ? [[r + 2 * dr, c - 1], [r + 2 * dr, c + 1]] : [[r - 1, c + 2 * dc], [r + 1, c + 2 * dc]];
        for (const [rr, cc] of dests) if (ok(at(sq, rr, cc))) add(rr, cc);
      }
    } else if (lo === "e") {
      for (const [dr, dc] of DG) {
        const rr = r + 2 * dr, cc = c + 2 * dc;
        if (at(sq, r + dr, c + dc) !== "." || !ok(at(sq, rr, cc))) continue;   // 塞象眼
        if (red ? rr < 5 : rr > 4) continue;                                    // 不能過河
        add(rr, cc);
      }
    } else if (lo === "a") {
      for (const [dr, dc] of DG) { const rr = r + dr, cc = c + dc; if (inPalace(rr, cc) && ok(at(sq, rr, cc))) add(rr, cc); }
    } else if (lo === "k") {
      for (const [dr, dc] of OR) { const rr = r + dr, cc = c + dc; if (inPalace(rr, cc) && ok(at(sq, rr, cc))) add(rr, cc); }
    } else if (lo === "p") {
      const dir = red ? -1 : 1, crossed = red ? r <= 4 : r >= 5;
      if (ok(at(sq, r + dir, c))) add(r + dir, c);
      if (crossed) for (const dc of [-1, 1]) if (ok(at(sq, r, c + dc))) add(r, c + dc);
    }
  }
  return out;
}
const kingIdx = (sq, red) => sq.indexOf(red ? "K" : "k");
function facing(sq) {
  const a = sq.indexOf("K"), b = sq.indexOf("k");
  if (a < 0 || b < 0 || a % W !== b % W) return false;
  for (let i = b + W; i < a; i += W) if (sq[i] !== ".") return false;
  return true;
}
// red 方的王有沒有被吃（含飛將）：直接從王的位置往外看有沒有車、炮、馬、兵（比產生對方所有走法快很多）
export function inCheck(sq, red) {
  const k = kingIdx(sq, red);
  if (k < 0) return true;
  if (facing(sq)) return true;
  const r = (k / W) | 0, c = k % W, R = red ? "r" : "R", C = red ? "c" : "C", Hs = red ? "h" : "H", P = red ? "p" : "P";
  for (const [dr, dc] of OR) {                                       // 車直接看到王；炮隔一顆子看到王
    let rr = r + dr, cc = c + dc, t;
    while ((t = at(sq, rr, cc)) === ".") { rr += dr; cc += dc; }
    if (t === null) continue;
    if (t === R) return true;
    rr += dr; cc += dc;
    while ((t = at(sq, rr, cc)) === ".") { rr += dr; cc += dc; }
    if (t === C) return true;
  }
  for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]]) {   // 馬：馬腳沒被塞住
    if (at(sq, r + dr, c + dc) !== Hs) continue;
    const lr = r + dr - (Math.abs(dr) === 2 ? Math.sign(dr) : 0), lc = c + dc - (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
    if (at(sq, lr, lc) === ".") return true;
  }
  if (at(sq, red ? r - 1 : r + 1, c) === P) return true;            // 兵：從前面吃（黑卒往下、紅兵往上）
  if (red ? r >= 5 : r <= 4) { if (at(sq, r, c - 1) === P || at(sq, r, c + 1) === P) return true; }   // 過河的兵可以橫吃
  return false;
}
// 舊寫法（產生對方所有走法），只留給測試比對
export function inCheckSlow(sq, red) {
  const k = kingIdx(sq, red);
  if (k < 0) return true;
  if (facing(sq)) return true;
  return pseudo(sq, !red).some((m) => m.t === k);
}

// 輪到的那方是不是正被將軍（電腦搜尋用）
export const checked = (st) => inCheck(st.sq, st.turn === "b");

export function apply(st, m, quick) {
  const sq = st.sq.slice(), cap = sq[m.t] !== ".";
  sq[m.t] = sq[m.f]; sq[m.f] = ".";
  const n = { sq, turn: st.turn === "b" ? "w" : "b", half: cap ? 0 : st.half + 1 };
  if (!quick) { n.seen = { ...st.seen }; const k = key(n); n.seen[k] = (n.seen[k] || 0) + 1; }
  return n;
}
export function moves(st) {
  const red = st.turn === "b";
  return pseudo(st.sq, red).filter((m) => { const n = apply(st, m, true); return !inCheck(n.sq, red); });
}

export function outcome(st) {
  const list = moves(st), red = st.turn === "b";
  const chk = inCheck(st.sq, red);
  const res = { over: false, winner: null, reason: "", check: chk ? kingIdx(st.sq, red) : -1, list };
  if (!list.length) { res.over = true; res.winner = red ? "w" : "b"; res.reason = chk ? "將死" : "困斃（無子可動）"; }
  else if (st.half >= 120) { res.over = true; res.winner = "d"; res.reason = "太久沒有吃子，和棋"; }
  else if ((st.seen[key(st)] || 0) >= 3) { res.over = true; res.winner = "d"; res.reason = "同一局面出現三次，和棋"; }
  return res;
}
export function perft(st, d) { if (!d) return 1; let n = 0; for (const m of moves(st)) n += d === 1 ? 1 : perft(apply(st, m, true), d - 1); return n; }
