// 排球小遊戲的物理（伺服器權威，60 tick/秒）。座標單位是像素，原點左上，y 向下。
export const W = 432, H = 304, GROUND = 280, NET_X = 216, NET_HALF = 4, NET_TOP = 170;
export const R = 32, BR = 14, WIN = 15;
const MAXV = 15;

export function createVb(serve = "b") {
  const vb = { p: { b: { x: 108, y: GROUND, vx: 0, vy: 0 }, w: { x: 324, y: GROUND, vx: 0, vy: 0 } },
               ball: { x: 0, y: 0, vx: 0, vy: 0 }, score: { b: 0, w: 0 }, pause: 90 };
  resetBall(vb, serve);
  return vb;
}

function resetBall(vb, side) {
  vb.ball = { x: side === "b" ? 108 : 324, y: 90, vx: 0, vy: 0 };
  vb.pause = 90;
}

// 回傳得分方 "b"/"w"，沒得分回傳 null
export function stepVb(vb, input) {
  for (const role of ["b", "w"]) {
    const p = vb.p[role], inp = input[role] || {};
    p.vx = ((inp.r ? 1 : 0) - (inp.l ? 1 : 0)) * 5.5;
    p.x += p.vx;
    const lo = role === "b" ? R : NET_X + NET_HALF + R, hi = role === "b" ? NET_X - NET_HALF - R : W - R;
    p.x = Math.min(hi, Math.max(lo, p.x));
    if (inp.j && p.y >= GROUND) p.vy = -13.5;
    p.vy += 0.65; p.y += p.vy;
    if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; }
  }
  const b = vb.ball;
  if (vb.pause > 0) { vb.pause--; return null; }
  b.vy += 0.32; b.x += b.vx; b.y += b.vy;
  if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx); }
  if (b.x > W - BR) { b.x = W - BR; b.vx = -Math.abs(b.vx); }
  if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy) * 0.8; }
  // 網子（當成一根矩形柱子）
  {
    const cx = Math.min(NET_X + NET_HALF, Math.max(NET_X - NET_HALF, b.x));
    const cy = Math.min(GROUND, Math.max(NET_TOP, b.y));
    let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    if (d < BR) {
      if (d === 0) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d;
      b.x = cx + nx * BR; b.y = cy + ny * BR;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 1.8 * vn * nx; b.vy -= 1.8 * vn * ny; }
    }
  }
  // 玩家（上半圓；球永遠在地面上方，所以當整圓算就好）
  for (const role of ["b", "w"]) {
    const p = vb.p[role];
    let dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
    if (d < R + BR) {
      if (d === 0) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d;
      b.x = p.x + nx * (R + BR); b.y = p.y + ny * (R + BR);
      const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
      if (vn < 0) { b.vx -= 2.15 * vn * nx; b.vy -= 2.15 * vn * ny; }
      const s = Math.hypot(b.vx, b.vy);
      if (s > MAXV) { b.vx *= MAXV / s; b.vy *= MAXV / s; }
    }
  }
  if (b.y >= GROUND - BR) {
    const side = b.x < NET_X ? "w" : "b";     // 球落在哪邊，對面得分
    vb.score[side]++;
    resetBall(vb, side);
    return side;
  }
  return null;
}

export function snapshotVb(vb) {
  const r = (n) => Math.round(n * 10) / 10;
  return { p: { b: [r(vb.p.b.x), r(vb.p.b.y)], w: [r(vb.p.w.x), r(vb.p.w.y)] }, ball: [r(vb.ball.x), r(vb.ball.y)],
           score: vb.score, wait: vb.pause > 0 };
}
