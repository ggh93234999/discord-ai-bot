// 棋盤共用的質感繪圖：木紋底、立體棋子（陰影＋高光）。純 canvas，不用圖檔。
const cache = new Map();
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function grain(w, h, base, dark, seed) {
  const key = [w, h, base, dark, seed].join("|");
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 10) cache.clear();
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const c = cv.getContext("2d"), R = rng(seed);
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  const lg = c.createLinearGradient(0, 0, w, h); lg.addColorStop(0, "rgba(255,255,255,.14)"); lg.addColorStop(.5, "rgba(255,255,255,0)"); lg.addColorStop(1, "rgba(0,0,0,.14)");
  c.fillStyle = lg; c.fillRect(0, 0, w, h);
  c.strokeStyle = dark; c.lineCap = "round";
  const n = Math.round(h / 2.2);
  for (let i = 0; i < n; i++) {
    const y0 = R() * h, amp = 1 + R() * 5, fr = 0.004 + R() * 0.012, ph = R() * 6.3;
    c.globalAlpha = 0.04 + R() * 0.13; c.lineWidth = 0.6 + R() * 1.6;
    c.beginPath();
    for (let x = 0; x <= w; x += 6) { const y = y0 + Math.sin(x * fr + ph) * amp; x ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
  }
  c.globalAlpha = 1; cache.set(key, cv); return cv;
}
// 把 (bw×bh) 大小的木紋，取 (x,y,w,h) 這塊畫上去，所以相鄰的格子紋路會接得起來
export function woodRegion(ctx, bw, bh, x, y, w, h, base, dark, seed = 1) {
  const g = grain(Math.ceil(bw), Math.ceil(bh), base, dark, seed), k = g.width / bw;
  ctx.drawImage(g, x * k, y * k, w * k, h * k, x, y, w, h);
}
export const wood = (ctx, w, h, base, dark, seed) => woodRegion(ctx, w, h, 0, 0, w, h, base, dark, seed);
// 棋盤外框的暗角
export function vignette(ctx, w, h, a = 0.28) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
// 圍棋式的立體棋子：c = "b" 黑、"w" 白
export function stone(ctx, cx, cy, r, c) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = r * 0.35; ctx.shadowOffsetX = r * 0.08; ctx.shadowOffsetY = r * 0.16;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  if (c === "b") { g.addColorStop(0, "#7a7a7a"); g.addColorStop(0.35, "#2b2b2b"); g.addColorStop(1, "#000"); }
  else { g.addColorStop(0, "#fff"); g.addColorStop(0.6, "#ebe8e1"); g.addColorStop(1, "#aaa69c"); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.shadowColor = "transparent";
  const s = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.42, 0, cx - r * 0.35, cy - r * 0.42, r * 0.38);
  s.addColorStop(0, c === "b" ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.95)"); s.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = s; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.restore();
}
