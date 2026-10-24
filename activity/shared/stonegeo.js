// 賭石的幾何（伺服器和前端共用，純數學，不依賴 three.js）。
// 座標：石頭的「本地座標」，形狀 = 單位球方向 d 乘上半徑函數 radius(d)，再依 sx/sy/sz 壓扁。
export const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const hash3 = (x, y, z, sd) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(sd | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
export function vnoise(x, y, z, sd) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
  const l = (a, b, t) => a + (b - a) * t, h = (i, j, k) => hash3(xi + i, yi + j, zi + k, sd);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy), l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
export const fbm = (x, y, z, sd, oct = 4) => { let a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, z * f, sd + i * 17); a *= 0.5; f *= 2.1; } return t; };

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; };
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function shapeParams(seed) {
  const r = mulberry(seed);
  return { seed, sx: 0.95 + r() * 0.3, sy: 0.62 + r() * 0.25, sz: 0.8 + r() * 0.25, lump: 0.2 + r() * 0.16, rid: 0.05 + r() * 0.06 };
}
export function radius(P, d, fine) {
  const [x, y, z] = d, s = P.seed;
  let rad = 1 + P.lump * (fbm(x * 1.7 + 5, y * 1.7 + 5, z * 1.7 + 5, s, 3) - 0.5) * 2 + P.rid * (fbm(x * 4.5, y * 4.5, z * 4.5, s + 41, 3) - 0.5);
  if (fine) rad += 0.035 * (fbm(x * 13, y * 13, z * 13, s + 99, 3) - 0.5);
  return rad;
}
export function surfacePoint(P, d, fine) { const rad = radius(P, d, fine); return [d[0] * P.sx * rad, d[1] * P.sy * rad, d[2] * P.sz * rad]; }
export function inside(P, p) {
  const x = p[0] / P.sx, y = p[1] / P.sy, z = p[2] / P.sz, l = Math.hypot(x, y, z) || 1e-9;
  return l <= radius(P, [x / l, y / l, z / l], false);
}

// 切面：沿座標軸（0=x 1=y 2=z）的平面，位置 pos；網格 GRID×GRID，覆蓋平面上 [-GS, GS]²
export const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const GRID = 48, GS = 1.4;
export function planeBasis(n) {
  const ref = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(ref, n)), w = norm(cross(n, u));
  return [u, w];
}
export const OUT = 255;                                  // 網格值：255 = 石頭外面；0 石皮／廢料；1..8 翡翠等級；9 裂；10 霧

// 一顆石頭裡面某一點是什麼。I = { body, cracks }
function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-9)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}
export function bodyRho(b, p) {
  const q = sub(p, b.c), x = dot(q, b.u) / b.r[0], y = dot(q, b.v) / b.r[1], z = dot(q, b.w) / b.r[2];
  const wob = 1 + 0.22 * (fbm(p[0] * 3 + 2, p[1] * 3 + 2, p[2] * 3 + 2, b.sd, 2) - 0.5);       // 邊界不規則
  return Math.hypot(x, y, z) / wob;
}
export function interiorAt(I, p) {
  for (const k of I.cracks) if (Math.abs(dot(k.n, p) - k.d) < 0.03 && dist(p, k.cc) < k.cr) return 9;
  const b = I.body; if (!b) return 0;
  const rho = bodyRho(b, p);
  if (rho <= 1) return rho < 0.7 ? b.q : rho < 0.9 ? Math.max(1, b.q - 1) : Math.max(1, b.q - 2);     // 核心最好，往外變差
  if (segDist(p, b.c, b.s) < b.rt) return Math.max(1, b.q - 2);                                          // 色根（通到表面）
  if (rho < 1.3 && b.q >= 2) return 10;                                                                    // 霧層
  return 0;
}
export function sectionGrid(I, P, axis, pos) {
  const n = AXES[axis], [u, w] = planeBasis(n), g = new Uint8Array(GRID * GRID);
  let inn = 0, jade = 0; const hist = new Array(11).fill(0);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const a = ((i + 0.5) / GRID * 2 - 1) * GS, b = ((j + 0.5) / GRID * 2 - 1) * GS;
    const p = [n[0] * pos + u[0] * a + w[0] * b, n[1] * pos + u[1] * a + w[1] * b, n[2] * pos + u[2] * a + w[2] * b];
    if (!inside(P, p)) { g[j * GRID + i] = OUT; continue; }
    const c = interiorAt(I, p); g[j * GRID + i] = c; inn++; hist[c]++; if (c >= 1 && c <= 8) jade++;
  }
  return { grid: g, inside: inn, jade, hist };
}
