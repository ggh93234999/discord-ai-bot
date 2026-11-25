// 水墨江湖：畫面。地圖先畫成一張大圖（換地圖才重畫），人物、怪物、特效每一幀用筆觸畫。
export const TS = 48;                 // 一格幾個像素（地圖大圖的比例）
const INK = "#16140f", INK2 = "#4d493f", SEAL = "#b5342a";
export const KAI = `"KaiTi","DFKai-SB","BiauKai","Kaiti TC","STKaiti","LXGW WenKai TC","Noto Serif TC",serif`;
export const CLS_COLOR = { sword: "#34497e", mage: "#3d5f58", archer: "#9a7a2c" };
export const RAR_COLOR = ["#3b372e", "#40605a", "#3a4f86", "#b5342a"];

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const THEME = {
  town: { base: "#e9e1cb", wash: "rgba(140,110,70,.08)", grass: "rgba(60,72,48,.38)" },
  bamboo: { base: "#e3e2cd", wash: "rgba(56,92,80,.11)", grass: "rgba(44,70,56,.42)" },
  mount: { base: "#e4dcc4", wash: "rgba(100,86,62,.11)", grass: "rgba(70,66,46,.36)" },
  tomb: { base: "#d3ccb8", wash: "rgba(26,24,20,.13)", grass: "rgba(34,36,30,.40)" },
  snow: { base: "#eef0f0", wash: "rgba(110,135,160,.10)", grass: "rgba(80,100,112,.26)" },
  fire: { base: "#e7d5bd", wash: "rgba(160,60,24,.12)", grass: "rgba(80,46,28,.30)" },
  demon: { base: "#d8ccbc", wash: "rgba(96,20,20,.12)", grass: "rgba(48,30,28,.34)" },
  tower: { base: "#d9d3c6", wash: "rgba(80,60,110,.12)", grass: "rgba(50,44,60,.32)" },
  arena: { base: "#e9e1cb", wash: "rgba(140,110,70,.08)", grass: "rgba(60,72,48,.30)" },
  sea: { base: "#dfe4de", wash: "rgba(40,96,120,.13)", grass: "rgba(40,80,88,.30)" },
  kunlun: { base: "#e6e8de", wash: "rgba(70,110,96,.10)", grass: "rgba(56,84,64,.34)" },
  hell: { base: "#cfc7bd", wash: "rgba(60,30,60,.15)", grass: "rgba(60,36,44,.34)" },
  heaven: { base: "#f1ede2", wash: "rgba(190,160,80,.10)", grass: "rgba(140,120,70,.22)" },
};
const NPC_GLYPH = { smith: "鐵", herb: "藥", bank: "錢", guide: "書", post: "驛", tower: "塔", arena: "擂" };

// 把一張圖鏡射拼成 2×2，當成無縫紋理
function mirrorTile(img, pw, ph) {
  const tile = document.createElement("canvas"); tile.width = pw * 2; tile.height = ph * 2;
  const tg = tile.getContext("2d");
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { tg.save(); tg.translate(sx < 0 ? pw * 2 : 0, sy < 0 ? ph * 2 : 0); tg.scale(sx, sy); tg.drawImage(img, 0, 0, pw, ph); tg.restore(); }
  return tile;
}
const ok = (im) => im && im.complete && im.naturalWidth;
// ---------------------------------------------------------------- 地圖大圖
export function renderMap(map, A = {}) {
  const { w, h, tiles, theme } = map, cv = document.createElement("canvas");
  cv.width = w * TS; cv.height = h * TS;
  const g = cv.getContext("2d"), R = rng(w * 977 + h * 131 + theme.length), T = THEME[theme] || THEME.town;
  // A.props：有水墨素材時，樹石房子不畫進底圖，改成清單讓畫面每幀依前後順序畫（人可以走到樹後面）
  const props = A.props ? [] : null, P = rng(w * 31 + h * 17 + 7);
  const prop = (n, x, y, pw, ph, face) => props.push({ n, x, y, w: pw, h: ph, face: face ?? (P() < 0.5 ? 1 : -1) });
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : +tiles[y * w + x]);
  const isPath = (x, y) => at(x, y) === 3 || at(x, y) === 4;
  // 底：宣紙（有素材圖就疊上去）＋大片淡墨暈
  g.fillStyle = T.base; g.fillRect(0, 0, cv.width, cv.height);
  if (A.paper && A.paper.complete && A.paper.naturalWidth) {
    g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = 0.5;
    g.fillStyle = g.createPattern(mirrorTile(A.paper, 576, 864), "repeat"); g.fillRect(0, 0, cv.width, cv.height);
    g.restore();
  }
  // AI 畫的地面紋理（每個地區一種），用 multiply 疊在宣紙上
  if (ok(A.ground)) {
    // 不用整片平鋪（會看到重複的花紋），改成一塊一塊邊緣柔和的圓形紋理，隨機旋轉蓋上去
    const SZ = 420, st = document.createElement("canvas"); st.width = st.height = SZ;
    const sg = st.getContext("2d"); sg.drawImage(A.ground, 0, 0, SZ, SZ);
    sg.globalCompositeOperation = "destination-in";
    const mg = sg.createRadialGradient(SZ / 2, SZ / 2, SZ * 0.18, SZ / 2, SZ / 2, SZ / 2); mg.addColorStop(0, "rgba(0,0,0,1)"); mg.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = mg; sg.fillRect(0, 0, SZ, SZ);
    g.save(); g.globalCompositeOperation = "multiply";
    const n = Math.ceil(cv.width * cv.height / (SZ * SZ * 0.32)), G = rng(w * 7 + h * 3 + 1);
    for (let i = 0; i < n; i++) {
      const x = G() * cv.width, y = G() * cv.height, k = 0.75 + G() * 0.6;
      g.globalAlpha = ({ bamboo: 0.26, mount: 0.3, tomb: 0.36, snow: 0.32, fire: 0.36, demon: 0.36, tower: 0.32, sea: 0.32, kunlun: 0.28, hell: 0.38, heaven: 0.22 }[theme] || 0.25) * (0.6 + G() * 0.4);
      g.save(); g.translate(x, y); g.rotate(G() * Math.PI * 2); g.drawImage(st, -SZ * k / 2, -SZ * k / 2, SZ * k, SZ * k); g.restore();
    }
    g.restore();
  }
  for (let i = 0; i < w * h / 4; i++) {
    const x = R() * cv.width, y = R() * cv.height, r = TS * (1 + R() * 3.5);
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, T.wash); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 地面細節
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 0) continue;
    const px = x * TS, py = y * TS;
    if (R() < 0.42) grass(g, px + R() * TS, py + R() * TS, T.grass, R);
    if (theme === "bamboo" && R() < 0.3) { g.fillStyle = `rgba(52,80,64,${0.25 + R() * 0.25})`; leaf(g, px + R() * TS, py + R() * TS, R() * 6, 6 + R() * 5); }
    if (theme === "mount" && R() < 0.22) pebble(g, px + R() * TS, py + R() * TS, R);
    if (theme === "mount" && R() < 0.06) crack(g, px + R() * TS, py + R() * TS, R);
    if (theme === "tomb" && R() < 0.2) blot(g, px + R() * TS, py + R() * TS, 6 + R() * 14, 0.12);
    if (theme === "tomb" && R() < 0.025) talisman(g, px + R() * TS, py + R() * TS, R);
    if (theme === "tomb" && R() < 0.03) bones(g, px + R() * TS, py + R() * TS, R);
    if (theme === "town" && R() < 0.05) flower(g, px + R() * TS, py + R() * TS, R);
    if (theme === "town" && map.layout && R() < 0.06) { const gx = px + R() * TS, gy = py + R() * TS, r = TS * (0.6 + R() * 1.1), gr = g.createRadialGradient(gx, gy, 0, gx, gy, r); gr.addColorStop(0, `rgba(78,100,62,${0.08 + R() * 0.07})`); gr.addColorStop(1, "rgba(78,100,62,0)"); g.fillStyle = gr; g.fillRect(gx - r, gy - r, r * 2, r * 2); for (let k = 0; k < 4; k++) grass(g, gx + (R() - 0.5) * r, gy + (R() - 0.5) * r * 0.6, "rgba(52,74,44,.5)", R); }
    if (theme === "fire" && R() < 0.05) crack(g, px + R() * TS, py + R() * TS, R, "rgba(190,70,30,.45)");
    if ((theme === "demon" || theme === "tower") && R() < 0.12) blot(g, px + R() * TS, py + R() * TS, 5 + R() * 12, 0.1);
    if (theme === "demon" && R() < 0.02) bones(g, px + R() * TS, py + R() * TS, R);
    if (theme === "hell" && R() < 0.1) blot(g, px + R() * TS, py + R() * TS, 5 + R() * 12, 0.09);
    if (theme === "hell" && R() < 0.03) crack(g, px + R() * TS, py + R() * TS, R, "rgba(120,40,90,.35)");
    if (theme === "tower" && R() < 0.03) talisman(g, px + R() * TS, py + R() * TS, R);
  }
  // 小路：一團一團淡淡的亮色疊起來，邊緣不會有格子線；城裡的路鋪石板
  const pathTex = theme === "town" ? (map.layout ? A.stone : null) : A.path;
  if (ok(pathTex)) {      // 路面紋理：先畫出路的形狀當遮罩，再讓紋理只出現在路上
    const mk = document.createElement("canvas"); mk.width = cv.width; mk.height = cv.height; const mg = mk.getContext("2d");
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isPath(x, y)) {
      const cx = x * TS + TS / 2, cy = y * TS + TS / 2, r = TS * 0.95;
      const gr = mg.createRadialGradient(cx, cy, r * 0.35, cx, cy, r); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      mg.fillStyle = gr; mg.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    const tx = document.createElement("canvas"); tx.width = cv.width; tx.height = cv.height; const xg = tx.getContext("2d");
    xg.fillStyle = xg.createPattern(mirrorTile(pathTex, theme === "town" ? 400 : 288, theme === "town" ? 400 : 288), "repeat"); xg.fillRect(0, 0, tx.width, tx.height);
    xg.globalCompositeOperation = "destination-in"; xg.drawImage(mk, 0, 0);
    g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = theme === "town" ? 0.42 : 0.85; g.drawImage(tx, 0, 0); g.restore();
  }
  {   // 路：先在小畫布上畫圓點，放大回來就變成邊緣柔和、平滑的路面形狀，再用亮色＋淡淡的邊線填上
    const D = 8, sm = document.createElement("canvas"); sm.width = Math.ceil(cv.width / D); sm.height = Math.ceil(cv.height / D);
    const smg = sm.getContext("2d"); smg.fillStyle = "#000";
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isPath(x, y)) { smg.beginPath(); smg.arc((x + 0.5) * TS / D, (y + 0.5) * TS / D, TS * 0.62 / D, 0, 7); smg.fill(); }
    const big = document.createElement("canvas"); big.width = cv.width; big.height = cv.height; const bg2 = big.getContext("2d");
    bg2.imageSmoothingEnabled = true; bg2.imageSmoothingQuality = "high"; bg2.drawImage(sm, 0, 0, cv.width, cv.height);
    const pc = theme === "town" ? (map.layout ? "236,226,202" : "246,240,224") : theme === "tomb" ? "214,204,180" : theme === "snow" ? "250,251,252" : theme === "fire" ? "214,190,160" : theme === "demon" || theme === "tower" ? "206,196,180" : theme === "sea" ? "226,224,206" : theme === "hell" ? "196,186,176" : theme === "heaven" ? "250,246,234" : "238,228,200";
    bg2.globalCompositeOperation = "source-in"; bg2.fillStyle = `rgba(${pc},${theme === "town" ? (map.layout ? 0.6 : 0.75) : theme === "tomb" ? 0.55 : 0.68})`; bg2.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(big, 0, 0);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isPath(x, y)) {
    const px = x * TS, py = y * TS;
    if (theme === "town") { if (!map.layout) flagstones(g, px, py, R); }
    else {
      g.fillStyle = "rgba(110,92,64,.28)";
      for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(px + R() * TS, py + R() * TS, 0.7 + R() * 1.4, 0, 7); g.fill(); }
      g.strokeStyle = "rgba(110,92,64,.12)"; g.lineWidth = 1;     // 車轍／腳印般的淡痕
      if (R() < 0.5) { const yy = py + TS * (0.3 + R() * 0.4); g.beginPath(); g.moveTo(px, yy); g.quadraticCurveTo(px + TS / 2, yy + (R() - 0.5) * 6, px + TS, yy); g.stroke(); }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!isPath(x + dx, y + dy) && at(x + dx, y + dy) === 0 && R() < 0.6) {
        g.fillStyle = "rgba(60,52,40,.28)"; const ex = px + TS / 2 + dx * TS * 0.48 + (dy ? (R() - 0.5) * TS : 0), ey = py + TS / 2 + dy * TS * 0.48 + (dx ? (R() - 0.5) * TS : 0);
        g.beginPath(); g.ellipse(ex, ey, 2 + R() * 2, 1.2 + R(), R() * 3, 0, 7); g.fill();
      }
    }
  }
  if (theme === "town") plaza(g, (map.layout ? 23.5 : 16.5) * TS, (map.layout ? 17.5 : 13.5) * TS, !!props);
  if (map.layout && map.layout.stage) {     // 主城的擂台木台（地面裝飾，可以走上去）
    const S = map.layout.stage, x0 = S.x0 * TS, y0 = S.y0 * TS, sw = (S.x1 - S.x0 + 1) * TS, shh = (S.y1 - S.y0 + 1) * TS;
    if (ok(A.stage)) {
      const k = Math.min(sw / A.stage.naturalWidth, shh * 1.25 / A.stage.naturalHeight) * 0.92, dw = A.stage.naturalWidth * k, dh = A.stage.naturalHeight * k, dx = x0 + (sw - dw) / 2, dy = y0 + (shh - dh) / 2;
      const sh = g.createRadialGradient(dx + dw / 2, dy + dh * 0.62, 4, dx + dw / 2, dy + dh * 0.62, dw * 0.55); sh.addColorStop(0, "rgba(58,48,32,.28)"); sh.addColorStop(1, "rgba(58,48,32,0)");
      g.fillStyle = sh; g.fillRect(dx - dw * 0.1, dy, dw * 1.2, dh * 1.1);
      const oc = document.createElement("canvas"); oc.width = A.stage.naturalWidth; oc.height = A.stage.naturalHeight; const og = oc.getContext("2d");
      try { og.filter = "saturate(0.62)"; } catch {} og.drawImage(A.stage, 0, 0); og.filter = "none";
      og.globalCompositeOperation = "source-atop"; og.fillStyle = "rgba(200,180,140,.24)"; og.fillRect(0, 0, oc.width, oc.height);
      g.drawImage(oc, dx, dy, dw, dh);
    }
    else { g.fillStyle = "rgba(150,110,70,.35)"; g.fillRect(x0, y0, sw, shh); }
  }
  if (theme === "arena") arenaFloor(g, w, h, R);      // 擂台：照實際能走的範圍畫一座俯視的木台（大小跟著地圖變）
  // 水：用等高線（marching squares）畫出圓潤的池塘外形，再沿岸描一筆墨線
  water(g, map, at, R, theme);
  // 房子：同一棟的格子合起來畫成一整棟（有屋簷、門、燈籠）；碰到地圖邊緣的是城牆
  if (theme === "town") {
    const seen = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (at(x, y) !== 5 || seen[y * w + x]) continue;
      const q = [[x, y]], cells = []; seen[y * w + x] = 1; let edge = false;
      while (q.length) { const [cx, cy] = q.pop(); cells.push([cx, cy]); if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) edge = true; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (at(nx, ny) === 5 && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; q.push([nx, ny]); } } }
      if (edge) { for (const [cx, cy] of cells) wall(g, cx, cy, w, h, at); continue; }
      if (map.layout && props) continue;
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const bx0 = Math.min(...xs) * TS, by0 = Math.min(...ys) * TS, bx1 = (Math.max(...xs) + 1) * TS, by1 = (Math.max(...ys) + 1) * TS;
      if (props) { g.fillStyle = "rgba(22,20,15,.14)"; g.beginPath(); g.ellipse((bx0 + bx1) / 2, by1 - 4, (bx1 - bx0) * 0.55, 14, 0, 0, 7); g.fill(); const wide = bx1 - bx0 >= TS * 7; prop(wide ? "e_hall" : P() < 0.5 ? "e_house1" : "e_house2", (bx0 + bx1) / 2, by1 + 8, bx1 - bx0 + TS * 1.2, (by1 - by0) + TS * 3, 1); }
      else building(g, bx0, by0, bx1, by1, R);
    }
  }
  // 擋路的東西：依地圖主題畫；先畫陰影，再從上往下畫本體
  const rail = (x, y) => theme === "arena" && (x === 0 || y === 0 || x === w - 1 || y === h - 1);      // 擂台外圈是欄杆，不另外放東西
  const railKeep = (x, y) => (x === 0 || x === w - 1) && (y === 0 || y === h - 1);                     // 只在四個角插旗
  if (!(map.layout && props)) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === 1 && !rail(x, y)) { g.fillStyle = "rgba(22,20,15,.10)"; g.beginPath(); g.ellipse(x * TS + TS / 2, y * TS + TS * 0.85, TS * 0.55, TS * 0.22, 0, 0, 7); g.fill(); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 1) continue;
    if (map.layout && props) continue;
    if (rail(x, y) && !railKeep(x, y)) continue;          // 主城的擋路物（樹、井、獅子…）在裝飾清單裡畫
    const px = x * TS, py = y * TS;
    if (props) {
      const cx = px + TS / 2 + (P() - 0.5) * 12, by = py + TS - 2 + (P() - 0.5) * 6, r = P();
      if (theme === "bamboo") prop("e_bamboo" + (1 + Math.floor(P() * 3)), cx, by, TS * 2.3, TS * (2.9 + P() * 0.9));
      else if (theme === "mount") r < 0.7 ? prop("e_rock" + (1 + Math.floor(P() * 3)), cx, by, TS * (1.3 + P() * 0.4), TS * 1.4) : prop("e_pine" + (1 + Math.floor(P() * 2)), cx, by, TS * 2.6, TS * (3 + P() * 0.6));
      else if (theme === "tomb") r < 0.5 ? prop("e_grave" + (1 + Math.floor(P() * 2)), cx, by, TS * 1.15, TS * 1.4) : r < 0.72 ? prop("e_lantern", cx, by, TS * 0.9, TS * 1.6) : prop("e_dtree" + (1 + Math.floor(P() * 2)), cx, by, TS * 2.4, TS * (2.6 + P() * 0.5));
      else if (theme === "snow") r < 0.55 ? prop("e_snowpine" + (1 + Math.floor(P() * 2)), cx, by, TS * 2.5, TS * (3 + P() * 0.6)) : prop("e_icerock" + (1 + Math.floor(P() * 2)), cx, by, TS * (1.3 + P() * 0.4), TS * 1.5);
      else if (theme === "fire") r < 0.6 ? prop("e_lavarock" + (1 + Math.floor(P() * 2)), cx, by, TS * (1.3 + P() * 0.4), TS * 1.4) : prop("e_burnt" + (1 + Math.floor(P() * 2)), cx, by, TS * 2.3, TS * (2.5 + P() * 0.5));
      else if (theme === "demon") r < 0.35 ? prop("e_pillar", cx, by, TS * 1.1, TS * 2.4) : r < 0.5 ? prop("e_brazier", cx, by, TS * 1.2, TS * 1.6) : r < 0.7 ? prop("e_banner", cx, by, TS * 1.2, TS * 2.6) : prop("e_bones", cx, by, TS * 1.3, TS * 1.0);
      else if (theme === "sea") r < 0.4 ? prop("e_coral" + (1 + Math.floor(P() * 2)), cx, by, TS * (1.6 + P() * 0.5), TS * (r < 0.2 ? 1.6 : 2.6)) : prop("e_kelp", cx, by, TS * 1.6, TS * (2.6 + P() * 0.8));
      else if (theme === "kunlun") r < 0.55 ? prop("e_cloudpine", cx, by, TS * 2.6, TS * (3 + P() * 0.6)) : prop("e_jaderock", cx, by, TS * (1.3 + P() * 0.4), TS * 1.8);
      else if (theme === "hell") r < 0.4 ? prop("e_spiderlily", cx, by, TS * 1.3, TS * 1.1) : r < 0.7 ? prop("e_soulstone", cx, by, TS * 1.2, TS * 1.6) : prop("e_ghostlamp", cx, by, TS * 1.0, TS * 1.7);
      else if (theme === "heaven") r < 0.45 ? prop("e_cloudpillar", cx, by, TS * 1.4, TS * 3) : r < 0.75 ? prop("e_cloud", cx, by, TS * 1.9, TS * 1.2) : prop("e_goldlamp", cx, by, TS * 1.0, TS * 1.9);
      else if (theme === "arena") rail(x, y) ? prop("e_banner", cx, by, TS * 1.3, TS * 2.6, 1) : prop("e_brazier", cx, by, TS * 1.2, TS * 2.0, 1);
      else if (theme === "tower") r < 0.6 ? prop("e_chain", cx, by, TS * 1.2, TS * 2.4) : r < 0.8 ? prop("e_lantern", cx, by, TS * 0.9, TS * 1.6) : prop("e_bones", cx, by, TS * 1.3, TS * 1.0);
      else prop("e_plum" + (1 + Math.floor(P() * 2)), cx, by, TS * 2.5, TS * (2.7 + P() * 0.5));
      continue;
    }
    if (theme === "bamboo") bambooTuft(g, px, py, R);
    else if (theme === "mount") (R() < 0.7 ? rock : pine)(g, px, py, R);
    else if (theme === "tomb") { const r = R(); (r < 0.5 ? grave : r < 0.72 ? stoneLantern : deadTree)(g, px, py, R); }
    else plum(g, px, py, R);
  }
  if (map.layout && props) {
    for (const b of map.layout.buildings) {     // 每棟建築都有自己的圖
      const cx = (b.x0 + b.x1 + 1) / 2 * TS, by = (b.y1 + 1) * TS, bw = (b.x1 - b.x0 + 1) * TS;
      {   // 接地：一大片柔和的淡墨陰影，加上兩側的苔痕、小草、碎石
        const sh = g.createRadialGradient(cx, by - 6, 4, cx, by - 6, bw * 0.62);
        sh.addColorStop(0, "rgba(58,48,32,.30)"); sh.addColorStop(0.6, "rgba(58,48,32,.12)"); sh.addColorStop(1, "rgba(58,48,32,0)");
        g.save(); g.translate(cx, by - 6); g.scale(1, 0.28); g.translate(-cx, -(by - 6)); g.fillStyle = sh; g.fillRect(cx - bw, by - 6 - bw, bw * 2, bw * 2); g.restore();
        const Q = rng(b.x0 * 131 + b.y0 * 17);
        for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
          const gx = cx + side * (bw * (0.42 + Q() * 0.22)), gy = by - 10 + Q() * 22;
          if (Q() < 0.55) grass(g, gx, gy, "rgba(52,70,44,.55)", Q); else blot(g, gx, gy, 5 + Q() * 9, 0.09);
          if (Q() < 0.25) { g.fillStyle = "rgba(110,100,84,.45)"; g.beginPath(); g.ellipse(gx + 6, gy + 2, 2.5 + Q() * 2, 1.6 + Q(), Q() * 3, 0, 7); g.fill(); }
        }
      }
      prop(b.art, cx, by + 10, bw * (b.tall ? 1.5 : 1.22), (b.tall ? 10 : b.y1 - b.y0 + 4.2) * TS, 1);
    }
    for (const d of map.layout.deco) {
      if (!d[3]) continue;
      const x = d[1] * TS, y = d[2] * TS;
      if (d[5]) { g.fillStyle = "rgba(22,20,15,.13)"; g.beginPath(); g.ellipse(x, y, d[3] * TS * 0.42, 7, 0, 0, 7); g.fill(); }
      prop(d[0], x, y + 4, d[3] * TS, d[4] * TS, P() < 0.5 ? 1 : -1);
    }
    for (let x = 0; x < w; x += 6) prop("t_wall", (x + 3) * TS, TS * 1.35, TS * 6.3, TS * 2.6, 1);     // 北邊城牆
  }
  if (theme === "town" && map.npcs && !map.layout) for (const n of map.npcs) { if (n.kind === "tower") continue; if (props) { prop("e_stall", n.x * TS - 4, n.y * TS - 3, TS * 2.3, TS * 2.1, 1); banner(g, n.x * TS, n.y * TS, n.kind); } else stall(g, n.x * TS, n.y * TS, n.kind); }
  for (const p of map.portals) { if (props && map.layout) { prop("t_gate", p.x * TS, (p.y + 2) * TS + 6, TS * 5, TS * 4.4, 1); continue; } if (props) { g.fillStyle = "rgba(22,20,15,.16)"; g.beginPath(); g.ellipse(p.x * TS + TS / 2, (p.y + 2) * TS - 4, TS * 1.2, 9, 0, 0, 7); g.fill(); prop("e_gate", p.x * TS + TS / 2, (p.y + 2) * TS, TS * 2.8, TS * 3.4, 1); } else gate(g, p.x * TS, p.y * TS); }
  if (props && theme === "town" && !map.layout) prop("e_cauldron", 16.5 * TS, 11.6 * TS, TS * 1.9, TS * 1.9, 1);
  if (props) { props.sort((a, b) => a.y - b.y); cv.props = props; }
  // 地圖邊緣暗一點，像畫紙邊上的暈染
  const ed = TS * 2.5;
  for (const [x0, y0, x1, y1] of [[0, 0, 0, ed], [0, cv.height, 0, cv.height - ed], [0, 0, ed, 0], [cv.width, 0, cv.width - ed, 0]]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, "rgba(40,32,20,.22)"); gr.addColorStop(1, "rgba(40,32,20,0)");
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  }
  return cv;
}

// ---------------------------------------------------------------- 池塘
// 水面／熔岩的配色：base 底色、deep 中間、edge 岸邊往內一圈、rim／line 岸線、ripple 漣漪；lava 是熔岩（有亮流、裂殼、會冒泡）
export function liquidStyle(theme) {
  const W = (base, deep, extra = {}) => ({ base, deep, edge: "rgba(250,248,236,.38)", rim: "rgba(255,252,240,.5)", line: "rgba(24,30,32,.62)", ripple: "rgba(246,244,232,.6)", ...extra });
  return {
    fire: { base: "rgba(178,58,20,.92)", deep: "rgba(250,150,50,.55)", edge: "rgba(36,16,8,.85)", rim: "rgba(60,30,16,.45)", line: "rgba(30,14,8,.85)", lava: true, glow: "255,170,60" },
    hell: { base: "rgba(70,20,46,.85)", deep: "rgba(150,40,90,.35)", edge: "rgba(20,6,14,.7)", rim: "rgba(120,60,90,.35)", line: "rgba(20,8,16,.8)", lava: true, glow: "200,70,140" },
    snow: W("rgba(176,206,224,.62)", "rgba(110,160,200,.30)", { ripple: "rgba(255,255,255,.75)" }),
    sea: W("rgba(34,92,124,.62)", "rgba(16,56,92,.40)"),
    tomb: W("rgba(62,78,82,.5)", "rgba(30,44,50,.35)"),
    demon: W("rgba(112,22,22,.55)", "rgba(60,8,8,.4)", { ripple: "rgba(240,190,180,.45)" }),
    tower: W("rgba(64,52,86,.5)", "rgba(36,26,56,.35)"),
    kunlun: W("rgba(80,140,126,.52)", "rgba(40,100,96,.35)"),
    heaven: W("rgba(150,190,220,.5)", "rgba(110,150,200,.3)"),
  }[theme] || W("rgba(84,112,122,.48)", "rgba(36,62,74,.34)");
}
function water(g, map, at, R, theme) {
  const { w, h } = map, wt = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === 2) wt.push([x + 0.5, y + 0.5]);
  if (!wt.length) return;
  const step = 0.25, sw = Math.ceil(w / step) + 1, sh = Math.ceil(h / step) + 1, F = new Float32Array(sw * sh), rr = 0.62;
  for (const [cx, cy] of wt) {
    const x0 = Math.max(0, Math.floor((cx - 2) / step)), x1 = Math.min(sw - 1, Math.ceil((cx + 2) / step));
    const y0 = Math.max(0, Math.floor((cy - 2) / step)), y1 = Math.min(sh - 1, Math.ceil((cy + 2) / step));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { const d = Math.hypot(i * step - cx, j * step - cy) / rr; F[j * sw + i] += Math.exp(-d * d); }
  }
  {   // 岸邊不要是整齊的圓角方塊：疊一點低頻雜訊，讓池子、熔岩湖的邊緣歪歪扭扭像自然形成的
    const hsh = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7 + w * 3.3) * 43758.5453; return n - Math.floor(n); };
    const vn = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      return (hsh(x0, y0) * (1 - u) + hsh(x0 + 1, y0) * u) * (1 - v) + (hsh(x0, y0 + 1) * (1 - u) + hsh(x0 + 1, y0 + 1) * u) * v; };
    // 座標扭曲（domain warp）：每個取樣點往旁邊挪一點再讀，岸線最多歪約 0.7 格；再疊一點細的雜訊讓邊緣毛一點
    const F0 = F.slice(), at0 = (x, y) => { x = Math.max(0, Math.min(sw - 1.001, x)); y = Math.max(0, Math.min(sh - 1.001, y)); const i0 = Math.floor(x), j0 = Math.floor(y), u = x - i0, v = y - j0;
      return (F0[j0 * sw + i0] * (1 - u) + F0[j0 * sw + i0 + 1] * u) * (1 - v) + (F0[(j0 + 1) * sw + i0] * (1 - u) + F0[(j0 + 1) * sw + i0 + 1] * u) * v; };
    const WARP = 0.7 / step;
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      const X = i * step, Y = j * step, dx = (vn(X * 0.33, Y * 0.33) - 0.5) * 2 * WARP, dy = (vn(X * 0.33 + 17, Y * 0.33 + 5) - 0.5) * 2 * WARP;
      F[j * sw + i] = at0(i + dx, j + dy) + (vn(X * 1.6 + 9, Y * 1.6) - 0.5) * 0.25;
    }
  }
  const T = 0.55, S = TS * step, f = (i, j) => F[j * sw + i];
  const lerp = (a, b) => (T - a) / (b - a);
  const fillPath = new Path2D(), shore = new Path2D();
  for (let j = 0; j < sh - 1; j++) for (let i = 0; i < sw - 1; i++) {
    const a = f(i, j), b = f(i + 1, j), c = f(i + 1, j + 1), d = f(i, j + 1);
    const k = (a > T ? 8 : 0) | (b > T ? 4 : 0) | (c > T ? 2 : 0) | (d > T ? 1 : 0);
    if (!k) continue;
    const X = i * S, Y = j * S;
    if (k === 15) { fillPath.rect(X - 0.5, Y - 0.5, S + 1, S + 1); continue; }
    const top = [X + S * lerp(a, b), Y], right = [X + S, Y + S * lerp(b, c)], bot = [X + S * lerp(d, c), Y + S], left = [X, Y + S * lerp(a, d)];
    const A0 = [X, Y], B0 = [X + S, Y], C0 = [X + S, Y + S], D0 = [X, Y + S];
    const polys = {
      1: [[left, bot, D0]], 2: [[bot, right, C0]], 3: [[left, right, C0, D0]], 4: [[top, B0, right]], 5: [[left, top, B0, right, bot, D0]],
      6: [[top, B0, C0, bot]], 7: [[left, top, B0, C0, D0]], 8: [[A0, top, left]], 9: [[A0, top, bot, D0]], 10: [[A0, top, right, C0, bot, left]],
      11: [[A0, top, right, C0, D0]], 12: [[A0, B0, right, left]], 13: [[A0, B0, right, bot, D0]], 14: [[A0, B0, C0, bot, left]],
    }[k];
    for (const pl of polys) { fillPath.moveTo(pl[0][0], pl[0][1]); for (let q = 1; q < pl.length; q++) fillPath.lineTo(pl[q][0], pl[q][1]); fillPath.closePath(); }
    const segs = { 1: [[left, bot]], 2: [[bot, right]], 3: [[left, right]], 4: [[top, right]], 5: [[left, top], [bot, right]], 6: [[top, bot]], 7: [[left, top]], 8: [[top, left]], 9: [[top, bot]], 10: [[top, right], [bot, left]], 11: [[top, right]], 12: [[left, right]], 13: [[right, bot]], 14: [[bot, left]] }[k];
    for (const [p1, p2] of segs) { shore.moveTo(p1[0], p1[1]); shore.lineTo(p2[0], p2[1]); }
  }
  const LQ = liquidStyle(theme);
  g.save();
  g.fillStyle = LQ.base; g.fill(fillPath);
  g.clip(fillPath);
  // 深處：中間顏色比較深（熔岩是比較亮）
  for (const [cx, cy] of wt) { const x = cx * TS, y = cy * TS, r = TS * 1.3; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, LQ.deep); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  // 岸邊往內一圈：水是淺灘（淡）、熔岩是冷掉的黑殼
  try { g.filter = `blur(${Math.round(TS * 0.16)}px)`; } catch {}
  g.strokeStyle = LQ.edge; g.lineWidth = TS * 0.75; g.stroke(shore);
  g.filter = "none";
  if (LQ.lava) {
    // 熔岩：亮的熔流＋黑色裂殼
    for (const [cx, cy] of wt) if (R() < 0.35) { const x = (cx - 0.5 + R()) * TS, y = (cy - 0.5 + R()) * TS, r = TS * (0.5 + R() * 0.7); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,214,110,.75)"); gr.addColorStop(0.5, "rgba(250,140,40,.35)"); gr.addColorStop(1, "rgba(250,120,30,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    // 冷掉的岩殼：一塊塊黑色不規則板，板和板之間透出亮橘色的熔縫
    for (const [cx, cy] of wt) if (R() < 0.42) {
      const x = (cx - 0.5 + R()) * TS, y = (cy - 0.5 + R()) * TS, rx = TS * (0.28 + R() * 0.3), ry = rx * (0.6 + R() * 0.4), rot = R() * 3.14, n = 7;
      g.beginPath(); for (let k = 0; k < n; k++) { const a = k / n * 6.283, rk = 0.72 + R() * 0.36; g.lineTo(x + Math.cos(a + rot) * rx * rk, y + Math.sin(a + rot) * ry * rk); } g.closePath();
      g.fillStyle = "rgba(58,24,12,.62)"; g.fill();
      g.strokeStyle = "rgba(255,176,70,.55)"; g.lineWidth = 1.6; g.stroke();
    }
  } else {
    // 水：一筆一筆的淡色漣漪（長短不一，像毛筆輕掃）
    g.strokeStyle = LQ.ripple; g.lineCap = "round";
    for (const [cx, cy] of wt) if (R() < 0.5) { const x = (cx - 0.5 + R()) * TS, y = (cy - 0.5 + R()) * TS, L = 8 + R() * 14; g.lineWidth = 0.8 + R() * 1.2; g.beginPath(); g.moveTo(x - L, y); g.quadraticCurveTo(x, y - 2.5 - R() * 2, x + L, y); g.stroke(); }
    for (const [cx, cy] of wt) if (R() < 0.12) { const x = (cx - 0.5 + R()) * TS, y = (cy - 0.5 + R()) * TS; g.fillStyle = LQ.ripple; g.beginPath(); g.ellipse(x, y, 2 + R() * 2, 1, 0, 0, 7); g.fill(); }
  }
  g.restore();
  g.save(); g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = LQ.rim; g.lineWidth = 4; g.translate(0, 2); g.stroke(shore); g.translate(0, -2);
  g.strokeStyle = LQ.line; g.lineWidth = LQ.lava ? 2.6 : 1.8; g.stroke(shore);
  g.restore();
  if (theme === "bamboo" || theme === "town") for (const [cx, cy] of wt) if (R() < 0.18) lotus(g, (cx - 0.3 + R() * 0.6) * TS, (cy - 0.3 + R() * 0.6) * TS, R);
  if (theme === "bamboo" || theme === "mount") for (const [cx, cy] of wt) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(Math.floor(cx) + dx, Math.floor(cy) + dy) === 0 && R() < 0.25) reeds(g, (cx + dx * 0.62) * TS, (cy + dy * 0.62) * TS + 6, R);
}
function reeds(g, x, y, R) {
  g.strokeStyle = "rgba(40,52,38,.55)"; g.lineCap = "round";
  for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + (i - 1.5) * 0.18 + (R() - 0.5) * 0.15, l = 12 + R() * 10; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + i * 2, y); g.quadraticCurveTo(x + i * 2 + Math.cos(a) * l * 0.4, y + Math.sin(a) * l * 0.6, x + i * 2 + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
}

// ---------------------------------------------------------------- 地圖上的小東西
function blot(g, x, y, r, a) { const gr = g.createRadialGradient(x, y, r * 0.15, x, y, r); gr.addColorStop(0, `rgba(22,20,15,${a})`); gr.addColorStop(0.65, `rgba(22,20,15,${a * 0.65})`); gr.addColorStop(1, "rgba(22,20,15,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
function leaf(g, x, y, ang, len) { g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -len * 0.2, len, 0); g.quadraticCurveTo(len * 0.5, len * 0.12, 0, 0); g.fill(); g.restore(); }
function grass(g, x, y, col, R) {
  g.strokeStyle = col; g.lineCap = "round";
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - n / 2) * 0.28 + (R() - 0.5) * 0.2, l = 5 + R() * 6; g.lineWidth = 1 + R() * 0.8; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
}
function pebble(g, x, y, R) { g.fillStyle = `rgba(60,54,44,${0.18 + R() * 0.2})`; g.beginPath(); g.ellipse(x, y, 2 + R() * 3, 1.4 + R() * 2, R() * 3, 0, 7); g.fill(); }
function crack(g, x, y, R, col = "rgba(50,42,30,.22)") { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); let cx = x, cy = y; for (let i = 0; i < 4; i++) { cx += (R() - 0.3) * 10; cy += (R() - 0.5) * 8; g.lineTo(cx, cy); } g.stroke(); }
function flower(g, x, y, R) { g.fillStyle = `rgba(181,52,42,${0.35 + R() * 0.3})`; for (let i = 0; i < 5; i++) { const a = i * 1.256; g.beginPath(); g.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.5, 0, 7); g.fill(); } g.fillStyle = "rgba(200,170,60,.8)"; g.beginPath(); g.arc(x, y, 1, 0, 7); g.fill(); }
function talisman(g, x, y, R) { g.save(); g.translate(x, y); g.rotate((R() - 0.5) * 1.2); g.fillStyle = "rgba(214,190,110,.85)"; g.fillRect(-4, -8, 8, 16); g.strokeStyle = "rgba(160,40,30,.85)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 6); g.moveTo(-2.5, -3); g.lineTo(2.5, -1); g.moveTo(-2.5, 2); g.lineTo(2.5, 4); g.stroke(); g.restore(); }
function bones(g, x, y) { g.strokeStyle = "rgba(235,228,212,.85)"; g.lineWidth = 2; g.lineCap = "round"; g.beginPath(); g.moveTo(x - 5, y - 2); g.lineTo(x + 5, y + 2); g.moveTo(x - 4, y + 3); g.lineTo(x + 3, y - 3); g.stroke(); }
function lotus(g, x, y, R) { g.fillStyle = `rgba(52,82,66,${0.55 + R() * 0.25})`; const r = 4 + R() * 4; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, 0.3, Math.PI * 2 - 0.1); g.closePath(); g.fill(); if (R() < 0.3) { g.fillStyle = "rgba(205,120,120,.8)"; g.beginPath(); g.ellipse(x + r, y - 2, 2.2, 3.2, 0, 0, 7); g.fill(); } }
function flagstones(g, px, py, R) {
  g.strokeStyle = "rgba(90,78,58,.16)"; g.lineWidth = 1;
  const off = (Math.floor(py / TS) % 2) * TS / 4;
  for (let yy = 0; yy < TS; yy += TS / 2) for (let xx = -off; xx < TS; xx += TS / 2) {
    const x0 = Math.max(px, px + xx + 1.5), x1 = Math.min(px + TS, px + xx + TS / 2 - 1.5);
    if (x1 - x0 < 4) continue;
    g.beginPath(); g.roundRect(x0, py + yy + 1.5, x1 - x0, TS / 2 - 3, 3 + R() * 3);
    g.fillStyle = `rgba(${R() < 0.5 ? "120,105,80" : "150,140,120"},${0.03 + R() * 0.07})`; g.fill(); g.stroke();
  }
}
// 廣場：一圈圈扇形石板（每塊深淺不一）＋外圈石緣＋中間八卦石刻與太極
function plaza(g, cx, cy, noDing) {
  let sd = 11; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const R0 = TS * 1.15, R3 = TS * 3.55, bands = [[R0, TS * 1.85, 12], [TS * 1.85, TS * 2.7, 18], [TS * 2.7, R3, 26]];
  g.save();
  g.fillStyle = "rgba(40,32,22,.10)"; g.beginPath(); g.arc(cx, cy + 4, R3 + TS * 0.32, 0, 7); g.fill();          // 外緣的影子
  g.fillStyle = "#b9ad93"; g.beginPath(); g.arc(cx, cy, R3 + TS * 0.28, 0, 7); g.fill();                       // 石緣
  g.strokeStyle = "rgba(70,58,40,.45)"; g.lineWidth = 1.4; g.stroke();
  for (const [r1, r2, n] of bands) {
    const off = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a1 = off + i / n * Math.PI * 2, a2 = off + (i + 1) / n * Math.PI * 2, v = 200 + Math.round(rnd() * 26);
      g.fillStyle = `rgb(${v},${v - 8},${v - 26})`;
      g.beginPath(); g.arc(cx, cy, r2 - 1, a1 + 0.006, a2 - 0.006); g.arc(cx, cy, r1 + 1, a2 - 0.006, a1 + 0.006, true); g.closePath(); g.fill();
      if (rnd() < 0.35) { g.fillStyle = "rgba(90,78,58,.10)"; const am = (a1 + a2) / 2, rm = (r1 + r2) / 2; g.beginPath(); g.ellipse(cx + Math.cos(am) * rm, cy + Math.sin(am) * rm, 6 + rnd() * 8, 3 + rnd() * 4, am, 0, 7); g.fill(); }
    }
    g.strokeStyle = "rgba(96,82,60,.42)"; g.lineWidth = 1.6; g.beginPath(); g.arc(cx, cy, r2, 0, 7); g.stroke();
  }
  // 八卦石刻：八角形＋八組卦爻
  g.fillStyle = "#c7bca4"; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; g.lineTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0); } g.closePath(); g.fill();
  g.strokeStyle = "rgba(70,58,40,.55)"; g.lineWidth = 1.6; g.stroke();
  const TRI = ["111", "011", "101", "001", "110", "010", "100", "000"];
  g.strokeStyle = "rgba(48,40,30,.62)"; g.lineCap = "butt";
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 - Math.PI / 2; g.save(); g.translate(cx, cy); g.rotate(a + Math.PI / 2);
    for (let k = 0; k < 3; k++) { const yy = -R0 * 0.86 + k * 5.2, hw = R0 * 0.26; g.lineWidth = 3; g.beginPath();
      if (TRI[i][k] === "1") { g.moveTo(-hw, yy); g.lineTo(hw, yy); } else { g.moveTo(-hw, yy); g.lineTo(-hw * 0.22, yy); g.moveTo(hw * 0.22, yy); g.lineTo(hw, yy); } g.stroke(); }
    g.restore();
  }
  // 太極（淡淡的石刻，不要搶戲）
  const tr = R0 * 0.42; g.globalAlpha = 0.55;
  g.fillStyle = "#f1eadb"; g.beginPath(); g.arc(cx, cy, tr, 0, 7); g.fill();
  g.fillStyle = "#3a332a"; g.beginPath(); g.arc(cx, cy, tr, -Math.PI / 2, Math.PI / 2); g.arc(cx, cy + tr / 2, tr / 2, Math.PI / 2, -Math.PI / 2, true); g.arc(cx, cy - tr / 2, tr / 2, Math.PI / 2, -Math.PI / 2); g.closePath(); g.fill();
  g.beginPath(); g.arc(cx, cy - tr / 2, tr * 0.14, 0, 7); g.fill(); g.fillStyle = "#f1eadb"; g.beginPath(); g.arc(cx, cy + tr / 2, tr * 0.14, 0, 7); g.fill();
  g.globalAlpha = 1; g.strokeStyle = "rgba(48,40,30,.6)"; g.lineWidth = 1.4; g.beginPath(); g.arc(cx, cy, tr, 0, 7); g.stroke();
  g.restore();
  if (noDing) return;
  // 廣場北邊的大香爐（鼎）
  const x = cx, y = cy - TS * 2.2;
  g.fillStyle = "rgba(22,20,15,.14)"; g.beginPath(); g.ellipse(x, y + 18, 28, 8, 0, 0, 7); g.fill();
  g.fillStyle = "#3a3630"; g.beginPath(); g.moveTo(x - 20, y - 8); g.quadraticCurveTo(x - 22, y + 12, x - 12, y + 12); g.lineTo(x + 12, y + 12); g.quadraticCurveTo(x + 22, y + 12, x + 20, y - 8); g.closePath(); g.fill();
  g.fillRect(x - 24, y - 12, 48, 5); g.fillRect(x - 16, y + 10, 3, 9); g.fillRect(x + 13, y + 10, 3, 9);
  g.strokeStyle = "#3a3630"; g.lineWidth = 2.5; g.beginPath(); g.arc(x - 16, y - 16, 5, Math.PI, 0); g.moveTo(x + 21, y - 16); g.arc(x + 16, y - 16, 5, 0, Math.PI, true); g.stroke();
  g.strokeStyle = "rgba(120,110,95,.35)"; g.lineWidth = 2;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x - 6 + i * 6, y - 14); g.bezierCurveTo(x - 14 + i * 6, y - 34, x + 4 + i * 6, y - 44, x - 6 + i * 6, y - 64); g.stroke(); }
}
function bambooTuft(g, px, py, R) {
  const n = 2 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) {
    const x = px + 8 + R() * (TS - 16), top = py - TS * (0.5 + R() * 0.7), bot = py + TS - 4, wv = 3 + R() * 2.2, lean = (R() - 0.5) * 6;
    g.strokeStyle = `rgba(38,66,54,${0.72 + R() * 0.25})`; g.lineWidth = wv; g.lineCap = "butt";
    g.beginPath(); g.moveTo(x, bot); g.lineTo(x + lean, top); g.stroke();
    g.strokeStyle = "rgba(232,228,208,.9)"; g.lineWidth = 1.3;
    for (let yy = bot - 9; yy > top + 6; yy -= 10 + R() * 6) { const xx = x + lean * (bot - yy) / (bot - top); g.beginPath(); g.moveTo(xx - wv / 2, yy); g.lineTo(xx + wv / 2, yy); g.stroke(); }
    g.fillStyle = `rgba(28,50,42,${0.62 + R() * 0.3})`;
    for (let k = 0; k < 5; k++) leaf(g, x + lean, top + R() * 22, (R() - 0.5) * 2.8 + (k % 2 ? 0.6 : -0.6), 10 + R() * 9);
  }
}
function rock(g, px, py, R) {
  const cx = px + TS / 2 + (R() - 0.5) * 8, cy = py + TS * 0.6, r = TS * (0.4 + R() * 0.22);
  const pts = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, rr = r * (0.72 + R() * 0.35); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (Math.sin(a) < 0 ? 1.05 : 0.7)]); }
  const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r); gr.addColorStop(0, "rgba(96,90,78,.78)"); gr.addColorStop(1, "rgba(28,26,22,.92)");
  g.fillStyle = gr; g.beginPath(); pts.forEach((p, i) => g[i ? "lineTo" : "moveTo"](p[0], p[1])); g.closePath(); g.fill();
  g.strokeStyle = "rgba(18,16,12,.7)"; g.lineWidth = 2; g.stroke();
  g.strokeStyle = "rgba(232,226,208,.38)"; g.lineWidth = 1.4;    // 皴法：斜斜的乾筆
  for (let i = 0; i < 5; i++) { const sx = cx - r * 0.6 + R() * r * 0.9, sy = cy - r * 0.5 + R() * r * 0.7; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 5 + R() * 6, sy + 6 + R() * 5); g.stroke(); }
}
function pine(g, px, py, R) {
  const cx = px + TS / 2, by = py + TS - 4, tx = cx + (R() - 0.5) * 8;
  g.strokeStyle = "rgba(40,30,22,.9)"; g.lineWidth = 4; g.lineCap = "round"; g.beginPath(); g.moveTo(cx, by); g.quadraticCurveTo(cx - 5, py + TS * 0.4, tx, py - 10); g.stroke();
  for (let i = 0; i < 4; i++) { const yy = py - 8 + i * 11, sx = (i % 2 ? 1 : -1) * (6 + R() * 5); g.fillStyle = `rgba(26,34,28,${0.55 + R() * 0.25})`; g.beginPath(); g.ellipse(tx + sx, yy, 15 - i * 1.5 + R() * 4, 5 + R() * 2, (R() - 0.5) * 0.3, 0, 7); g.fill(); }
}
function grave(g, px, py, R) {
  const cx = px + TS / 2 + (R() - 0.5) * 6, w = 18 + R() * 8, h = 26 + R() * 10, by = py + TS - 6;
  g.fillStyle = "rgba(22,20,15,.15)"; g.beginPath(); g.ellipse(cx, by + 2, w * 0.8, 5, 0, 0, 7); g.fill();
  const gr = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0); gr.addColorStop(0, "#77716a"); gr.addColorStop(1, "#4a4640");
  g.fillStyle = gr; g.beginPath(); g.moveTo(cx - w / 2, by); g.lineTo(cx - w / 2, by - h + w / 2); g.arc(cx, by - h + w / 2, w / 2, Math.PI, 0); g.lineTo(cx + w / 2, by); g.closePath(); g.fill();
  g.strokeStyle = "rgba(16,14,10,.7)"; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = "rgba(16,14,10,.55)"; g.lineWidth = 1.2; g.beginPath(); for (let k = 0; k < 3; k++) { g.moveTo(cx - 3, by - h + 10 + k * 6); g.lineTo(cx + 3, by - h + 10 + k * 6); } g.stroke();
  if (R() < 0.4) blot(g, cx - w / 2, by - 4, 6, 0.2);
}
function stoneLantern(g, px, py) {
  const cx = px + TS / 2, by = py + TS - 6;
  g.fillStyle = "#615b52"; g.fillRect(cx - 4, by - 18, 8, 18); g.fillRect(cx - 9, by - 4, 18, 4);
  g.fillStyle = "#4a4640"; g.fillRect(cx - 8, by - 28, 16, 10);
  g.fillStyle = "rgba(220,190,120,.75)"; g.fillRect(cx - 4, by - 26, 8, 6);
  g.fillStyle = "#3a3630"; g.beginPath(); g.moveTo(cx - 13, by - 28); g.lineTo(cx, by - 38); g.lineTo(cx + 13, by - 28); g.closePath(); g.fill();
}
function deadTree(g, px, py, R) {
  const cx = px + TS / 2, by = py + TS - 2;
  g.strokeStyle = "rgba(25,22,18,.88)"; g.lineCap = "round";
  const br = (x, y, a, len, wd) => { if (len < 5) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + (R() - 0.5) * 6, (y + y2) / 2, x2, y2); g.stroke(); br(x2, y2, a - 0.45 - R() * 0.35, len * 0.68, wd * 0.62); br(x2, y2, a + 0.4 + R() * 0.35, len * 0.6, wd * 0.58); };
  br(cx, by, -Math.PI / 2 + (R() - 0.5) * 0.3, 22, 5);
}
function plum(g, px, py, R) {        // 梅樹：墨枝＋朱點
  const cx = px + TS / 2, by = py + TS - 4;
  g.strokeStyle = "rgba(30,24,18,.9)"; g.lineCap = "round";
  const br = (x, y, a, len, wd, d) => { if (d > 3 || len < 4) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); if (d >= 1) { g.fillStyle = `rgba(181,52,42,${0.55 + R() * 0.35})`; for (let k = 0; k < 2; k++) { g.beginPath(); g.arc(x2 + (R() - 0.5) * 6, y2 + (R() - 0.5) * 6, 2 + R() * 1.6, 0, 7); g.fill(); } } br(x2, y2, a - 0.5 - R() * 0.4, len * 0.72, wd * 0.62, d + 1); br(x2, y2, a + 0.45 + R() * 0.4, len * 0.66, wd * 0.6, d + 1); };
  blot(g, cx, py + 6, 18, 0.12);
  br(cx, by, -Math.PI / 2 + (R() - 0.5) * 0.4, 18, 5, 0);
}
function building(g, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, eave = 14, wallTop = y1 - Math.min(TS * 1.25, h * 0.45), roofBot = wallTop + 8;
  g.fillStyle = "rgba(22,20,15,.16)"; g.fillRect(x0 + 6, y1 - 4, w, 12);
  g.fillStyle = "#e6dfcc"; g.fillRect(x0 + 4, wallTop, w - 8, y1 - wallTop);
  g.fillStyle = "#3b2d22";
  const n = Math.max(1, Math.round((w - 8) / TS));
  for (let i = 0; i <= n; i++) g.fillRect(x0 + 4 + (w - 12) * i / n, wallTop, 4, y1 - wallTop);
  const dx = (x0 + x1) / 2;
  g.fillStyle = "#7a2a22"; g.fillRect(dx - 13, y1 - 30, 26, 30); g.fillStyle = "#c79a3a"; g.fillRect(dx - 1, y1 - 30, 2, 30); g.beginPath(); g.arc(dx - 5, y1 - 15, 1.6, 0, 7); g.arc(dx + 5, y1 - 15, 1.6, 0, 7); g.fill();
  g.strokeStyle = "rgba(59,45,34,.8)"; g.lineWidth = 1;
  for (const wx of [x0 + w * 0.22, x1 - w * 0.22]) { g.strokeRect(wx - 9, y1 - 32, 18, 14); g.beginPath(); g.moveTo(wx, y1 - 32); g.lineTo(wx, y1 - 18); g.moveTo(wx - 9, y1 - 25); g.lineTo(wx + 9, y1 - 25); g.stroke(); }
  // 屋頂：上翹的簷角
  const roof = () => { g.beginPath(); g.moveTo(x0 - eave, roofBot - 12); g.quadraticCurveTo(x0 - eave * 0.4, roofBot, x0 + 6, roofBot); g.lineTo(x1 - 6, roofBot); g.quadraticCurveTo(x1 + eave * 0.4, roofBot, x1 + eave, roofBot - 12); };
  const gr = g.createLinearGradient(0, y0, 0, roofBot); gr.addColorStop(0, "#2a2925"); gr.addColorStop(1, "#47443d");
  g.fillStyle = gr; roof(); g.lineTo(x1 - 4, y0 + 6); g.lineTo(x0 + 4, y0 + 6); g.closePath(); g.fill();
  g.strokeStyle = "rgba(230,224,206,.16)"; g.lineWidth = 1.2;
  for (let x = x0 + 10; x < x1 - 6; x += 7) { g.beginPath(); g.moveTo(x, y0 + 8); g.lineTo(x + (x - dx) * 0.06, roofBot - 2); g.stroke(); }
  g.strokeStyle = "#141210"; g.lineWidth = 3; roof(); g.stroke();
  g.fillStyle = "#141210"; g.fillRect(x0 + 2, y0 + 2, w - 4, 7);
  g.lineWidth = 3; g.beginPath(); g.arc(x0 + 6, y0 - 1, 5, Math.PI * 0.5, Math.PI * 1.6); g.stroke(); g.beginPath(); g.arc(x1 - 6, y0 - 1, 5, Math.PI * 1.4, Math.PI * 2.5); g.stroke();
  for (const lx of [x0 + 2, x1 - 2]) { g.strokeStyle = "#141210"; g.lineWidth = 1; g.beginPath(); g.moveTo(lx, roofBot - 2); g.lineTo(lx, roofBot + 6); g.stroke(); g.fillStyle = "#b5342a"; g.beginPath(); g.ellipse(lx, roofBot + 12, 5, 7, 0, 0, 7); g.fill(); g.fillStyle = "#e0b04a"; g.fillRect(lx - 3, roofBot + 4, 6, 2); g.fillRect(lx - 3, roofBot + 18, 6, 2); }
}
function wall(g, x, y, w, h, at) {
  const px = x * TS, py = y * TS;
  g.fillStyle = "#8a826e"; g.fillRect(px, py, TS, TS);
  g.strokeStyle = "rgba(30,26,20,.32)"; g.lineWidth = 1;
  for (let k = 0; k < TS; k += 12) { g.beginPath(); g.moveTo(px, py + k); g.lineTo(px + TS, py + k); g.stroke(); const o = (k / 12) % 2 ? 0 : 12; for (let j = o; j < TS; j += 24) { g.beginPath(); g.moveTo(px + j, py + k); g.lineTo(px + j, py + k + 12); g.stroke(); } }
  g.fillStyle = "#5a5346";            // 朝城內那一側加城垛
  if (y === 0 && at(x, 1) !== 5) for (let j = 2; j < TS; j += 14) g.fillRect(px + j, py + TS - 8, 9, 8);
  if (y === h - 1 && at(x, h - 2) !== 5) for (let j = 2; j < TS; j += 14) g.fillRect(px + j, py, 9, 8);
  if (x === 0 && at(1, y) !== 5) for (let j = 2; j < TS; j += 14) g.fillRect(px + TS - 8, py + j, 8, 9);
  if (x === w - 1 && at(w - 2, y) !== 5) for (let j = 2; j < TS; j += 14) g.fillRect(px, py + j, 8, 9);
}
function stall(g, x, y, kind) {      // NPC 背後的攤子：小棚子＋寫字的幌子
  const bx = x - 30, by = y - 34;
  g.fillStyle = "rgba(22,20,15,.12)"; g.fillRect(bx + 4, y - 6, 60, 10);
  g.fillStyle = "#6b4a2e"; g.fillRect(bx, by, 4, 36); g.fillRect(bx + 56, by, 4, 36);
  g.fillStyle = "#c9b89a"; g.fillRect(bx - 2, y - 14, 64, 10); g.strokeStyle = "#3b2d22"; g.lineWidth = 1; g.strokeRect(bx - 2, y - 14, 64, 10);
  g.fillStyle = "#2f2c27"; g.beginPath(); g.moveTo(bx - 8, by + 4); g.lineTo(bx + 30, by - 10); g.lineTo(bx + 68, by + 4); g.closePath(); g.fill();
  const fx = bx + 70, fy = by - 18;
  g.fillStyle = "#6b4a2e"; g.fillRect(fx, fy, 3, 56);
  g.fillStyle = "#efe7d2"; g.beginPath(); g.moveTo(fx + 3, fy + 4); g.lineTo(fx + 25, fy + 4); g.lineTo(fx + 25, fy + 36); g.lineTo(fx + 14, fy + 31); g.lineTo(fx + 3, fy + 36); g.closePath(); g.fill();
  g.strokeStyle = "#16140f"; g.stroke();
  g.fillStyle = "#b5342a"; g.font = `700 17px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(NPC_GLYPH[kind] || "", fx + 14, fy + 18);
  g.textBaseline = "alphabetic";
}
function banner(g, x, y, kind) {   // 攤子旁的幌子（有素材圖時只畫旗子）
  const fx = x + 40, fy = y - 74;
  g.fillStyle = "rgba(22,20,15,.12)"; g.beginPath(); g.ellipse(fx + 2, y - 2, 8, 3, 0, 0, 7); g.fill();
  g.fillStyle = "#6b4a2e"; g.fillRect(fx, fy, 3, 72);
  g.fillStyle = "#efe7d2"; g.beginPath(); g.moveTo(fx + 3, fy + 4); g.lineTo(fx + 27, fy + 4); g.lineTo(fx + 27, fy + 40); g.lineTo(fx + 15, fy + 34); g.lineTo(fx + 3, fy + 40); g.closePath(); g.fill();
  g.strokeStyle = "#16140f"; g.lineWidth = 1; g.stroke();
  g.fillStyle = "#b5342a"; g.font = `700 19px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(NPC_GLYPH[kind] || "", fx + 15, fy + 20); g.textBaseline = "alphabetic";
}
function gate(g, px, py) {           // 傳送點：朱紅牌坊
  const cx = px + TS / 2, top = py - TS * 0.95, bot = py + TS * 2 - 4, half = TS * 0.62;
  g.fillStyle = "rgba(22,20,15,.15)"; g.beginPath(); g.ellipse(cx, bot, half + 12, 7, 0, 0, 7); g.fill();
  g.fillStyle = "#3a3630"; g.fillRect(cx - half - 6, bot - 8, 16, 8); g.fillRect(cx + half - 10, bot - 8, 16, 8);
  g.fillStyle = SEAL; g.fillRect(cx - half - 2, top + 14, 8, bot - top - 20); g.fillRect(cx + half - 6, top + 14, 8, bot - top - 20);
  g.fillRect(cx - half, top + 26, half * 2, 6);
  g.fillStyle = "#1c1a16"; g.beginPath(); g.moveTo(cx - half - 18, top + 4); g.quadraticCurveTo(cx - half - 6, top + 14, cx - half + 4, top + 12); g.lineTo(cx + half - 4, top + 12); g.quadraticCurveTo(cx + half + 6, top + 14, cx + half + 18, top + 4); g.lineTo(cx + half, top - 4); g.lineTo(cx - half, top - 4); g.closePath(); g.fill();
  g.fillStyle = "#e9dfc3"; g.fillRect(cx - 10, top + 14, 20, 12); g.strokeStyle = "#1c1a16"; g.lineWidth = 1; g.strokeRect(cx - 10, top + 14, 20, 12);
}

// ---------------------------------------------------------------- 人物
function shadow(g, x, y, r) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(22,20,15,.32)"); gr.addColorStop(1, "rgba(22,20,15,0)"); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.38, 0, 0, 7); g.fill(); }
const NPC_LOOK = {
  smith: { robe: "#3b342c", inner: "#8a6a48", hat: "band" },
  herb: { robe: "#4b6a55", inner: "#e9e2d0", hat: "cap" },
  bank: { robe: "#6b4a2e", inner: "#d9c9a8", hat: "official" },
  guide: { robe: "#d9d0b8", inner: "#9b9585", hat: "bun", beard: true },
};
// opt：moving、face（1 右 / -1 左）、atk（0~1 出手進度）、hurt、dead、s（大小）、npc（種類）
export function drawPlayer(g, x, y, cls, t, opt = {}) {
  const s = (opt.s || 1) * 1.12, face = opt.face || 1, look = opt.npc ? NPC_LOOK[opt.npc] : null;
  const robe = look ? look.robe : CLS_COLOR[cls] || INK2, inner = look ? look.inner : "#ece4cf";
  shadow(g, x, y + 2, 15 * s);
  g.save(); g.translate(x, y); g.scale(face * s, s);
  if (opt.dead) { g.globalAlpha *= 0.55; g.rotate(-Math.PI / 2 * 0.92); g.translate(-6, -4); }
  const walk = opt.moving ? Math.sin(t / 85) : 0, bob = opt.moving ? Math.abs(walk) * -1.6 : Math.sin(t / 600) * 0.5;
  const lunge = opt.atk ? Math.sin(opt.atk * Math.PI) * 4 : 0;
  g.translate(lunge, bob);
  g.lineJoin = "round"; g.lineCap = "round";
  g.strokeStyle = INK; g.lineWidth = 2.6;        // 腳
  g.beginPath(); g.moveTo(-3, -2); g.lineTo(-3 + walk * 3, 1); g.moveTo(3, -2); g.lineTo(3 - walk * 3, 1); g.stroke();
  g.fillStyle = inner; g.beginPath(); g.moveTo(-9, -1); g.lineTo(-6, -16); g.lineTo(6, -16); g.lineTo(9, -1); g.closePath(); g.fill();   // 內袍
  const sway = walk * 2.2;                         // 外袍：下襬隨走路擺動
  g.fillStyle = robe; g.beginPath();
  g.moveTo(-5, -25); g.quadraticCurveTo(-9, -14, -12 + sway, -1); g.quadraticCurveTo(-7, 1, -3 + sway * 0.5, -2);
  g.lineTo(-1, -16); g.lineTo(1, -16); g.lineTo(3 + sway * 0.5, -2); g.quadraticCurveTo(7, 1, 12 + sway, -1); g.quadraticCurveTo(9, -14, 5, -25); g.closePath(); g.fill();
  g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = inner; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-3.5, -25); g.lineTo(1.5, -17); g.moveTo(3.5, -25); g.lineTo(-0.5, -19); g.stroke();   // 衣領
  g.fillStyle = "#1f1c17"; g.fillRect(-6.5, -16.5, 13, 2.6);   // 腰帶
  if (!look) { g.strokeStyle = SEAL; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-4, -14); g.quadraticCurveTo(-5 - sway * 0.6, -10, -4.5 - sway, -6); g.stroke(); }
  // 背上的東西（在手臂後面）
  if (cls === "archer" && !look) { g.fillStyle = "#6b4a2e"; g.save(); g.translate(-6, -22); g.rotate(-0.35); g.fillRect(-2.5, 0, 5, 13); g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(-1, 0); g.lineTo(-2, -5); g.moveTo(1.5, 0); g.lineTo(1.5, -6); g.stroke(); g.restore(); }
  if (opt.npc === "herb") { g.fillStyle = "#b08a4a"; g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.arc(-8, -16, 3.4, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.arc(-8, -21, 2.4, 0, 7); g.fill(); g.stroke(); }
  // 袖子＋手＋武器
  const arm = opt.atk ? -0.9 + opt.atk * 1.6 : walk * 0.25;
  g.save(); g.translate(5, -23); g.rotate(arm);
  g.fillStyle = robe; g.beginPath(); g.moveTo(-2, 0); g.quadraticCurveTo(6, 3, 5, 11); g.lineTo(0, 11); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = "#efe6d0"; g.beginPath(); g.arc(3, 12, 2, 0, 7); g.fill();
  if (!look) {
    if (cls === "sword") { g.strokeStyle = "#d6dde2"; g.lineWidth = 2.6; g.beginPath(); g.moveTo(3, 13); g.lineTo(3, -14); g.stroke(); g.strokeStyle = "#7d8790"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(3, 11); g.lineTo(3, -12); g.stroke(); g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(-1, 12); g.lineTo(7, 12); g.stroke(); g.strokeStyle = SEAL; g.lineWidth = 1.2; g.beginPath(); g.moveTo(3, 14); g.quadraticCurveTo(5, 18, 2, 21); g.stroke(); }
    else if (cls === "mage") { g.strokeStyle = "#5a3d22"; g.lineWidth = 2.6; g.beginPath(); g.moveTo(3, 22); g.lineTo(3, -16); g.stroke(); g.fillStyle = `rgba(150,220,200,${0.25 + 0.15 * Math.sin(t / 200)})`; g.beginPath(); g.arc(3, -18, 7, 0, 7); g.fill(); g.fillStyle = "rgba(120,190,170,.95)"; g.beginPath(); g.arc(3, -18, 3.6, 0, 7); g.fill(); g.strokeStyle = "#d9c56a"; g.lineWidth = 1; g.beginPath(); g.arc(3, -18, 4.6, 0, 7); g.stroke(); }
    else { const pull = opt.atk ? 7 * Math.sin(opt.atk * Math.PI) : 0; g.strokeStyle = "#5a3d22"; g.lineWidth = 2.2; g.beginPath(); g.arc(-4, 6, 15, -1.15, 1.15); g.stroke(); g.strokeStyle = "rgba(22,20,15,.7)"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-4 + Math.cos(-1.15) * 15, 6 + Math.sin(-1.15) * 15); g.lineTo(-4 - pull, 6); g.lineTo(-4 + Math.cos(1.15) * 15, 6 + Math.sin(1.15) * 15); g.stroke(); }
  } else if (opt.npc === "smith") { g.strokeStyle = "#5a3d22"; g.lineWidth = 2.4; g.beginPath(); g.moveTo(3, 12); g.lineTo(3, -2); g.stroke(); g.fillStyle = "#555"; g.fillRect(-2, -6, 10, 5); }
  else if (opt.npc === "guide") { g.fillStyle = "#efe7d2"; g.beginPath(); g.moveTo(3, 12); g.arc(3, 12, 10, -2.2, -0.9); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke(); }
  else if (opt.npc === "bank") { g.fillStyle = "#6b4a2e"; g.fillRect(-2, 10, 12, 7); g.fillStyle = "#e9e2d0"; for (let i = 0; i < 4; i++) g.fillRect(0 + i * 2.6, 11, 1.4, 5); }
  g.restore();
  // 頭
  g.fillStyle = "#f0e6cf"; g.strokeStyle = INK; g.lineWidth = 1.4;
  g.beginPath(); g.arc(0, -31, 6.6, 0, 7); g.fill(); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.ellipse(-1, -33.5, 6.9, 4.4, 0, Math.PI, 0); g.fill();   // 頭髮
  g.beginPath(); g.moveTo(-6.6, -33); g.quadraticCurveTo(-7.5, -28, -5.5, -26); g.lineTo(-4, -31); g.fill();     // 鬢角（腦後）
  g.beginPath(); g.arc(3.6, -30.5, 0.95, 0, 7); g.fill();                                          // 眼睛（朝前方）
  const hat = look ? look.hat : "bun";
  if (hat === "bun") { g.beginPath(); g.arc(-1.5, -40, 2.9, 0, 7); g.fill(); if (!look) { const fl = Math.sin(t / 260) * 2; g.strokeStyle = SEAL; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-3.5, -40); g.quadraticCurveTo(-8, -38 + fl, -12, -34 + fl); g.stroke(); } }
  else if (hat === "band") { g.fillStyle = "#8a6a48"; g.fillRect(-7, -36, 14, 2.6); }
  else if (hat === "cap") { g.fillStyle = "#2f3b33"; g.beginPath(); g.arc(-0.5, -36, 6.4, Math.PI, 0); g.fill(); }
  else if (hat === "official") { g.fillStyle = INK; g.fillRect(-7, -42, 14, 7); g.fillRect(-12, -39, 24, 1.8); }
  if (look && look.beard) { g.strokeStyle = "#f1ebda"; g.lineWidth = 1.8; g.beginPath(); g.moveTo(2.5, -27); g.quadraticCurveTo(5, -21, 1.5, -16); g.stroke(); }
  if (opt.hurt) { g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(181,52,42,.45)"; g.fillRect(-24, -50, 48, 54); }
  g.restore();
}

// ---------------------------------------------------------------- 怪物
// s 是大小倍數（王是 2 倍）；face 1 右 / -1 左；atk 0~1 撲擊進度
export function drawMob(g, x, y, shape, t, s, hurt, face = 1, atk = 0) {
  const k = 1 + (hurt ? 0.07 : 0), bob = Math.sin(t / 220 + x) * 1.2, lunge = atk ? Math.sin(atk * Math.PI) * 6 : 0;
  shadow(g, x, y + 2, 15 * s);
  g.save(); g.translate(x, y + bob); g.scale(s * k * face, s * k); g.translate(lunge, 0);
  g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = INK; g.lineWidth = 1.7;
  const fill = (c) => { g.fillStyle = c; g.fill(); g.stroke(); };
  const eye = (ex, ey, c = SEAL) => { g.fillStyle = c; g.beginPath(); g.arc(ex, ey, 1.7, 0, 7); g.fill(); };
  const wash = (cx, cy, rx, ry, a = 0.18) => { g.fillStyle = `rgba(22,20,15,${a})`; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill(); };
  switch (shape) {
    case "rat": g.beginPath(); g.ellipse(0, -6, 11, 6.5, 0, 0, 7); fill("#6e665a"); wash(-2, -8, 7, 3); g.beginPath(); g.moveTo(-10, -5); g.quadraticCurveTo(-20, -2 + Math.sin(t / 150) * 3, -23, -10); g.stroke(); g.beginPath(); g.arc(8, -10, 3.5, 0, 7); fill("#7a7264"); g.beginPath(); g.arc(5, -14, 2.4, 0, 7); fill("#9a8f80"); eye(10, -8); break;
    case "hare": g.beginPath(); g.ellipse(0, -9, 10, 8.5, 0, 0, 7); fill("#ece5d2"); g.beginPath(); g.ellipse(-3, -24, 2.6, 9, -0.25 + Math.sin(t / 300) * 0.1, 0, 7); fill("#ece5d2"); g.beginPath(); g.ellipse(3, -24, 2.6, 9, 0.2, 0, 7); fill("#ece5d2"); g.beginPath(); g.arc(-9, -6, 3, 0, 7); fill("#fff"); eye(5, -11); break;
    case "snake": g.strokeStyle = INK; g.lineWidth = 7; g.beginPath(); for (let i = 0; i <= 12; i++) { const xx = -16 + i * 2.8, yy = -4 + Math.sin(i * 0.9 + t / 150) * 4; g[i ? "lineTo" : "moveTo"](xx, yy); } g.stroke(); g.strokeStyle = "#4b7a54"; g.lineWidth = 4.6; g.stroke(); g.fillStyle = "#4b7a54"; g.strokeStyle = INK; g.lineWidth = 1.4; g.beginPath(); g.ellipse(19, -5 + Math.sin(13 * 0.9 + t / 150) * 4, 5.4, 3.8, 0, 0, 7); g.fill(); g.stroke(); eye(21, -6); g.strokeStyle = SEAL; g.lineWidth = 1; g.beginPath(); g.moveTo(24, -4); g.lineTo(28, -3); g.stroke(); break;
    case "monkey": g.beginPath(); g.ellipse(0, -11, 9.5, 11, 0, 0, 7); fill("#5b4a38"); wash(-2, -14, 6, 6, 0.2); g.beginPath(); g.arc(1, -25, 7, 0, 7); fill("#5b4a38"); g.fillStyle = "#c9a37a"; g.beginPath(); g.ellipse(2.5, -24, 4.2, 3.6, 0, 0, 7); g.fill(); eye(1, -25); eye(4.5, -25); g.beginPath(); g.moveTo(-8, -14); g.lineTo(-15, -4 + Math.sin(t / 120) * 3); g.moveTo(8, -14); g.lineTo(15, -4 - Math.sin(t / 120) * 3); g.lineWidth = 3; g.stroke(); g.lineWidth = 1.7; g.beginPath(); g.moveTo(-9, -6); g.quadraticCurveTo(-18, -14, -14, -24); g.stroke(); break;
    case "wolf": { g.beginPath(); g.ellipse(0, -10, 15, 7.5, 0, 0, 7); fill("#57544c"); wash(-3, -13, 10, 3, 0.25); g.beginPath(); g.moveTo(10, -13); g.lineTo(22, -16); g.lineTo(19, -8); g.closePath(); fill("#57544c"); g.beginPath(); g.moveTo(13, -15); g.lineTo(14, -22); g.lineTo(17, -16); fill("#3d3b35"); g.beginPath(); g.moveTo(-14, -11); g.quadraticCurveTo(-24, -17, -26, -8); g.lineWidth = 3; g.stroke(); eye(17, -13); const st = Math.sin(t / 90) * 2; g.lineWidth = 2.4; for (const [lx, d] of [[-9, st], [-4, -st], [5, -st], [10, st]]) { g.beginPath(); g.moveTo(lx, -4); g.lineTo(lx + d, 0); g.stroke(); } break; }
    case "golem": for (const [bx, by, bw, bh] of [[-10, -15, 20, 15], [-7, -28, 14, 12], [-17, -17, 7, 11], [10, -17, 7, 11]]) { g.beginPath(); g.roundRect(bx, by, bw, bh, 2); fill("#7c776c"); } g.strokeStyle = "rgba(230,224,206,.4)"; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-6 + i * 4, -12); g.lineTo(-3 + i * 4, -6); g.stroke(); } eye(-2, -22, "#e0c060"); eye(2.5, -22, "#e0c060"); break;
    case "bird": { const f = Math.sin(t / 90) * 7; g.beginPath(); g.ellipse(0, -19, 7, 5.5, 0, 0, 7); fill("#3b3832"); g.fillStyle = "#2b2925"; g.beginPath(); g.moveTo(-4, -19); g.quadraticCurveTo(-15, -28 - f, -25, -16 - f); g.quadraticCurveTo(-14, -20 - f * 0.4, -4, -16); g.fill(); g.beginPath(); g.moveTo(4, -19); g.quadraticCurveTo(15, -28 - f, 25, -16 - f); g.quadraticCurveTo(14, -20 - f * 0.4, 4, -16); g.fill(); g.fillStyle = "#e9e2d0"; g.beginPath(); g.arc(6, -21, 3, 0, 7); g.fill(); g.fillStyle = "#c79a3a"; g.beginPath(); g.moveTo(8, -21); g.lineTo(12, -19); g.lineTo(8, -19); g.fill(); eye(6.5, -21.5, INK); break; }
    case "bandit": case "zombie": case "terra": {
      const c = shape === "bandit" ? "#4a3f33" : shape === "zombie" ? "#6b7766" : "#9a6a48";
      if (shape === "zombie") g.translate(0, Math.abs(Math.sin(t / 180)) * -4);
      g.beginPath(); g.moveTo(-10, 0); g.lineTo(-6, -23); g.lineTo(6, -23); g.lineTo(10, 0); g.closePath(); fill(c); wash(-3, -12, 4, 9, 0.18);
      g.beginPath(); g.arc(0, -29, 6.2, 0, 7); fill(shape === "zombie" ? "#b9c2ae" : shape === "terra" ? "#b07c55" : "#d9c9a8");
      if (shape === "bandit") { g.fillStyle = SEAL; g.fillRect(-6.5, -33, 13, 3); g.beginPath(); g.moveTo(-6, -32); g.lineTo(-11, -28); g.lineTo(-10, -33); g.fill(); g.strokeStyle = "#d6dde2"; g.lineWidth = 2.6; g.beginPath(); g.moveTo(8, -10); g.quadraticCurveTo(18, -18, 17, -30); g.stroke(); }
      if (shape === "zombie") { g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); g.moveTo(-4, -19); g.lineTo(11, -19); g.moveTo(4, -15); g.lineTo(13, -15); g.stroke(); g.fillStyle = "#d8c27a"; g.fillRect(-2.5, -36, 5, 11); g.strokeStyle = SEAL; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -35); g.lineTo(0, -26); g.stroke(); g.fillStyle = INK; g.fillRect(-7, -38, 14, 4); }
      if (shape === "terra") { g.strokeStyle = "rgba(30,20,10,.5)"; g.lineWidth = 1; for (let yy = -20; yy < 0; yy += 4) { g.beginPath(); g.moveTo(-7, yy); g.lineTo(7, yy); g.stroke(); } g.fillStyle = "#7a4e30"; g.beginPath(); g.arc(0, -33, 4, Math.PI, 0); g.fill(); }
      eye(-2, -29); eye(2.5, -29); break;
    }
    case "wisp": { const gr = g.createRadialGradient(0, -16, 1, 0, -16, 16); gr.addColorStop(0, "rgba(210,255,240,.95)"); gr.addColorStop(0.45, "rgba(90,190,170,.6)"); gr.addColorStop(1, "rgba(60,140,130,0)"); g.fillStyle = gr; g.beginPath(); g.arc(0, -16, 16 + Math.sin(t / 100) * 2, 0, 7); g.fill(); g.fillStyle = "rgba(90,190,170,.8)"; g.beginPath(); g.moveTo(-7, -14); g.quadraticCurveTo(-2, -40 - Math.sin(t / 80) * 4, 7, -14); g.fill(); eye(-2.5, -16, INK); eye(2.5, -16, INK); break; }
    case "scorp": g.beginPath(); g.ellipse(0, -6, 12, 6.5, 0, 0, 7); fill("#4b3a2c"); wash(-2, -8, 8, 3, 0.25); g.beginPath(); g.moveTo(-10, -7); g.quadraticCurveTo(-23, -12, -17, -25 + Math.sin(t / 200) * 2); g.quadraticCurveTo(-10, -30, -7, -23); g.lineWidth = 3.6; g.stroke(); g.fillStyle = SEAL; g.beginPath(); g.arc(-7, -23, 2, 0, 7); g.fill(); g.lineWidth = 1.7; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(10, -6 + sx * 3); g.lineTo(18, -6 + sx * 7); g.lineTo(21, -6 + sx * 3); g.stroke(); } for (const lx of [-6, -2, 2, 6]) { g.beginPath(); g.moveTo(lx, -2); g.lineTo(lx - 3, 2); g.stroke(); } eye(8, -8); break;
    case "bamboo": g.strokeStyle = "rgba(38,66,54,.95)"; g.lineWidth = 6.5; for (const bx of [-8, 0, 8]) { g.beginPath(); g.moveTo(bx, 0); g.quadraticCurveTo(bx * 1.1 + Math.sin(t / 400 + bx) * 2, -18, bx * 1.25, -36); g.stroke(); } g.strokeStyle = "rgba(232,228,208,.8)"; g.lineWidth = 1.2; for (const bx of [-8, 0, 8]) for (let yy = -6; yy > -34; yy -= 9) { g.beginPath(); g.moveTo(bx - 3, yy); g.lineTo(bx + 3, yy); g.stroke(); } g.fillStyle = "rgba(28,50,42,.88)"; for (let i = 0; i < 12; i++) leaf(g, (i - 6) * 3, -36 + Math.sin(i) * 4, -1.7 + i * 0.3 + Math.sin(t / 300) * 0.12, 15); g.fillStyle = SEAL; g.beginPath(); g.arc(-3, -22, 2.6, 0, 7); g.arc(3, -22, 2.6, 0, 7); g.fill(); break;
    case "tiger": g.beginPath(); g.ellipse(0, -11, 17, 9.5, 0, 0, 7); fill("#d9b47a"); g.fillStyle = "#efe2c4"; g.beginPath(); g.ellipse(2, -6, 11, 4, 0, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 2.6; for (const sx of [-10, -4, 2, 8]) { g.beginPath(); g.moveTo(sx, -19); g.quadraticCurveTo(sx + 3, -14, sx + 1, -9); g.stroke(); } g.lineWidth = 1.7; g.beginPath(); g.arc(15, -17, 7.5, 0, 7); fill("#e9dcb8"); g.fillStyle = INK; g.fillRect(12, -24, 7, 2); g.fillRect(14.5, -26, 2, 5); g.beginPath(); g.moveTo(-17, -11); g.quadraticCurveTo(-28, -21, -24, -28); g.lineWidth = 3.4; g.stroke(); eye(17, -18); break;
    case "corpse": g.beginPath(); g.moveTo(-12, 0); g.lineTo(-8, -27); g.lineTo(8, -27); g.lineTo(12, 0); g.closePath(); fill("#2b2a26"); g.fillStyle = "rgba(181,52,42,.9)"; g.fillRect(-8, -21, 16, 3); g.strokeStyle = "#c79a3a"; g.lineWidth = 1; for (let yy = -16; yy < -2; yy += 5) { g.beginPath(); g.moveTo(-7, yy); g.lineTo(7, yy); g.stroke(); } g.strokeStyle = INK; g.lineWidth = 1.7; g.beginPath(); g.arc(0, -33, 7, 0, 7); fill("#b9c2ae"); g.fillStyle = "#e0c870"; g.fillRect(-3, -42, 6, 13); g.fillStyle = INK; g.fillRect(-9, -44, 18, 5); eye(-2.5, -33, SEAL); eye(2.5, -33, SEAL); break;
    default: g.beginPath(); g.arc(0, -10, 10, 0, 7); fill("#555");
  }
  if (hurt) { g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(181,52,42,.4)"; g.fillRect(-32, -50, 64, 54); }
  g.restore();
}
// 王身邊的墨煙
export function bossAura(g, x, y, t, s) {
  for (let i = 0; i < 6; i++) {
    const a = t / 900 + i * 1.05, r = 26 * s + Math.sin(t / 400 + i) * 6;
    const px = x + Math.cos(a) * r, py = y - 18 * s + Math.sin(a) * r * 0.5;
    const gr = g.createRadialGradient(px, py, 0, px, py, 14 * s); gr.addColorStop(0, "rgba(22,20,15,.16)"); gr.addColorStop(1, "rgba(22,20,15,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, 14 * s, 0, 7); g.fill();
  }
}
export function hpBar(g, x, y, w, pct, col) {
  g.fillStyle = "rgba(22,20,15,.7)"; g.beginPath(); g.roundRect(x - w / 2 - 1.5, y - 1.5, w + 3, 7, 3.5); g.fill();
  g.fillStyle = "rgba(240,232,212,.9)"; g.beginPath(); g.roundRect(x - w / 2, y, w, 4, 2); g.fill();
  const p = Math.max(0, Math.min(1, pct / 100));
  if (p > 0) { g.fillStyle = col; g.beginPath(); g.roundRect(x - w / 2, y, Math.max(2, w * p), 4, 2); g.fill(); }
}
// 擂台木台：木板地＋紅漆欄杆＋角柱＋中間淡淡的「擂」字；欄杆就壓在地圖最外一圈（不能走的那圈）上
function arenaFloor(g, w, h, R) {
  const x0 = TS * 0.55, y0 = TS * 0.55, x1 = (w - 0.55) * TS, y1 = (h - 0.55) * TS, W = x1 - x0, H = y1 - y0;
  g.save();
  g.fillStyle = "rgba(40,28,16,.22)"; g.fillRect(x0 + TS * 0.3, y0 + TS * 0.45, W, H);          // 台子的影子
  g.fillStyle = "#d9c296"; g.fillRect(x0, y0, W, H);
  const ph = TS * 0.8;                                                                        // 一條條木板，接縫錯開
  for (let y = y0, row = 0; y < y1; y += ph, row++) {
    const hh = Math.min(ph, y1 - y);
    g.fillStyle = row % 2 ? "rgba(122,84,44,.07)" : "rgba(255,248,226,.12)"; g.fillRect(x0, y, W, hh);
    g.strokeStyle = "rgba(92,62,32,.30)"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.strokeStyle = "rgba(92,62,32,.22)";
    for (let sx = x0 + TS * (0.8 + (row * 1.7) % 3); sx < x1 - TS * 0.5; sx += TS * (3.2 + (row * 7) % 3)) { g.beginPath(); g.moveTo(sx, y + 1); g.lineTo(sx, y + hh - 1); g.stroke(); }
    for (let k = 0; k < W / TS * 0.6; k++) { g.fillStyle = "rgba(92,62,32,.10)"; g.fillRect(x0 + R() * W, y + R() * hh, TS * (0.4 + R() * 0.9), 1); }      // 木紋
  }
  for (let k = 0; k < 9; k++) {                                                               // 墨染的舊漬
    const cx = x0 + R() * W, cy = y0 + R() * H, r = TS * (1.5 + R() * 3), gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, "rgba(110,76,40,.10)"); gr.addColorStop(1, "rgba(110,76,40,0)"); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const cx = w * TS / 2, cy = h * TS / 2, rr = Math.min(W, H) * 0.2;                          // 中央：紅圈＋擂字
  g.strokeStyle = "rgba(158,47,38,.30)"; g.lineWidth = TS * 0.14; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
  g.lineWidth = TS * 0.05; g.beginPath(); g.arc(cx, cy, rr * 0.86, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "rgba(158,47,38,.13)"; g.font = `700 ${Math.round(rr * 1.05)}px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("擂", cx, cy + rr * 0.04); g.textBaseline = "alphabetic";
  for (const x of [x0 + TS * 2.2, x1 - TS * 2.2]) { g.strokeStyle = "rgba(158,47,38,.22)"; g.lineWidth = 2; g.setLineDash([TS * 0.3, TS * 0.22]); g.beginPath(); g.moveTo(x, cy - TS * 1.4); g.lineTo(x, cy + TS * 1.4); g.stroke(); }     // 兩邊的開打線
  g.setLineDash([]);
  g.strokeStyle = "#8f2a22"; g.lineWidth = TS * 0.3; g.strokeRect(x0, y0, W, H);               // 紅漆欄杆
  g.strokeStyle = "rgba(255,222,190,.45)"; g.lineWidth = TS * 0.06; g.strokeRect(x0 - TS * 0.06, y0 - TS * 0.06, W, H);
  g.strokeStyle = "rgba(30,18,10,.55)"; g.lineWidth = TS * 0.05; g.strokeRect(x0 + TS * 0.17, y0 + TS * 0.17, W - TS * 0.34, H - TS * 0.34);
  const post = (px, py, big) => { const r = TS * (big ? 0.34 : 0.2); g.fillStyle = "#2a1d14"; g.beginPath(); g.arc(px, py + r * 0.25, r * 1.05, 0, 7); g.fill(); g.fillStyle = big ? "#7d241d" : "#9e3328"; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.fillStyle = "rgba(255,226,196,.5)"; g.beginPath(); g.arc(px - r * 0.3, py - r * 0.3, r * 0.3, 0, 7); g.fill(); };
  for (let x = x0 + TS * 3; x < x1 - TS * 1.5; x += TS * 3) { post(x, y0); post(x, y1); }
  for (let y = y0 + TS * 3; y < y1 - TS * 1.5; y += TS * 3) { post(x0, y); post(x1, y); }
  for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) post(px, py, true);
  g.restore();
}
export function label(g, x, y, text, col = INK, size = 12, bold = false, font = `"LXGW WenKai TC","Noto Serif TC",serif`) {
  g.font = `${bold ? "700 " : ""}${size}px ${font}`; g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.lineJoin = "round"; g.lineWidth = Math.max(3, size / 4); g.strokeStyle = "rgba(242,236,220,.9)"; g.strokeText(text, x, y); g.fillStyle = col; g.fillText(text, x, y);
}
// 名牌：左邊一個小朱印寫等級，右邊名字
export function nameTag(g, x, y, name, lv, col, bold) {
  const F = `"LXGW WenKai TC","Noto Serif TC",serif`;
  g.font = `${bold ? "700 " : ""}12px ${F}`;
  const tw = g.measureText(name).width, lw = 15, total = tw + lw + 4, sx = x - total / 2;
  g.fillStyle = SEAL; g.beginPath(); g.roundRect(sx, y - 11, lw, 13, 2); g.fill();
  g.fillStyle = "#f6efe0"; g.font = `700 9px "Noto Sans TC",sans-serif`; g.textAlign = "center"; g.fillText(String(lv), sx + lw / 2, y - 1.5);
  g.font = `${bold ? "700 " : ""}12px ${F}`; g.textAlign = "left";
  g.lineJoin = "round"; g.lineWidth = 3; g.strokeStyle = "rgba(242,236,220,.92)"; g.strokeText(name, sx + lw + 4, y); g.fillStyle = col; g.fillText(name, sx + lw + 4, y);
  g.textAlign = "center";
}
