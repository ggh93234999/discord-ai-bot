// 麻將牌面圖案：筒子畫圓餅、條子畫竹條（一條是鳥），用 SVG 畫，大小跟著牌縮放。萬子和字牌維持用字。
const B = "#1f5fbf", G = "#1e7b3a", R = "#c62828";

function pin(x, y, r, c) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="#fbf8ee"/><circle cx="${x}" cy="${y}" r="${r * 0.38}" fill="${c}"/>`;
}
// 筒子：每一種的圓餅位置和顏色（viewBox 30×40）
const PIN = {
  1: () => `<circle cx="15" cy="20" r="12" fill="${G}"/><circle cx="15" cy="20" r="9.6" fill="#fbf8ee"/><circle cx="15" cy="20" r="8" fill="${R}"/><circle cx="15" cy="20" r="5.6" fill="#fbf8ee"/><circle cx="15" cy="20" r="4" fill="${B}"/><circle cx="15" cy="20" r="1.6" fill="#fbf8ee"/>`,
  2: () => pin(15, 11, 6, G) + pin(15, 29, 6, B),
  3: () => pin(7.5, 8.5, 5, B) + pin(15, 20, 5, R) + pin(22.5, 31.5, 5, G),
  4: () => pin(9, 11, 5.2, B) + pin(21, 11, 5.2, G) + pin(9, 29, 5.2, G) + pin(21, 29, 5.2, B),
  5: () => pin(8, 9, 4.8, B) + pin(22, 9, 4.8, G) + pin(15, 20, 4.8, R) + pin(8, 31, 4.8, G) + pin(22, 31, 4.8, B),
  6: () => pin(9, 7.5, 4.3, G) + pin(21, 7.5, 4.3, G) + [21, 32.5].map((y) => pin(9, y, 4.3, R) + pin(21, y, 4.3, R)).join(""),
  7: () => pin(6.5, 5.5, 3.6, G) + pin(15, 9, 3.6, G) + pin(23.5, 12.5, 3.6, G) + [24, 34].map((y) => pin(9, y, 4.2, R) + pin(21, y, 4.2, R)).join(""),
  8: () => [5.5, 15, 25, 34.5].map((y) => pin(9, y, 4.2, B) + pin(21, y, 4.2, B)).join(""),
  9: () => [[7.5, B], [20, R], [32.5, G]].map(([y, c]) => pin(6.5, y, 4, c) + pin(15, y, 4, c) + pin(23.5, y, 4, c)).join(""),
};

// 一根竹條：(x, y) 是中心，h 長度，rot 旋轉角度
function stick(x, y, h, c = G, rot = 0) {
  const w = 4.4, top = y - h / 2;
  return `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="1.6" fill="${c}"/>`
    + `<rect x="${x - w / 2 - 0.4}" y="${y - 0.6}" width="${w + 0.8}" height="1.2" rx="0.6" fill="${c}" opacity=".9"/>`
    + `<line x1="${x}" y1="${top + 1.5}" x2="${x}" y2="${top + h - 1.5}" stroke="#fbf8ee" stroke-width=".7" opacity=".55"/></g>`;
}
// 條子
const SOU = {
  // 一條：一隻鳥
  1: () => `<path d="M8 27 C6 20 9 13 15 12 C21 11 24 16 22 22 C20 28 13 31 8 27Z" fill="${G}"/>`
    + `<circle cx="20.5" cy="11" r="4" fill="${R}"/><circle cx="21.5" cy="10.3" r="1" fill="#fbf8ee"/><path d="M24 11 L28 12 L24 13Z" fill="#d9a400"/>`
    + `<path d="M9 26 L3 35 M11 27 L7 37 M13 28 L12 38" stroke="${B}" stroke-width="1.8" stroke-linecap="round"/><path d="M12 18 C15 16 18 18 18 21" stroke="#fbf8ee" stroke-width="1.2" fill="none"/>`,
  2: () => stick(15, 11, 15) + stick(15, 29, 15, B),
  3: () => stick(15, 11, 15) + stick(9, 29, 15, B) + stick(21, 29, 15, B),
  4: () => stick(9, 11, 15) + stick(21, 11, 15, B) + stick(9, 29, 15, B) + stick(21, 29, 15),
  5: () => stick(7, 11, 15) + stick(23, 11, 15, B) + stick(15, 20, 15, R) + stick(7, 29, 15, B) + stick(23, 29, 15),
  6: () => [6, 15, 24].map((x) => stick(x, 11, 15) + stick(x, 29, 15, B)).join(""),
  7: () => stick(15, 6, 10, R) + [6, 15, 24].map((x) => stick(x, 20, 10) + stick(x, 33, 10, B)).join(""),
  8: () => [[6, -18], [12, 18], [18, -18], [24, 18]].map(([x, r]) => stick(x, 11, 15, G, r)).join("")
    + [[6, 18], [12, -18], [18, 18], [24, -18]].map(([x, r]) => stick(x, 29, 15, B, r)).join(""),
  9: () => [6, 15, 24].map((x) => [7, 20, 33].map((y) => stick(x, y, 11, x === 15 ? R : y === 20 ? B : G)).join("")).join(""),
};

// 回傳某張牌（0~26 的數牌）要放進牌面的 SVG；萬子回傳 null（照舊用字）
export function tileSvg(t) {
  if (t < 9 || t >= 27) return null;
  const n = (t % 9) + 1;
  const body = t < 18 ? PIN[n]() : SOU[n]();
  return `<svg class="mts" viewBox="0 0 30 40" aria-hidden="true">${body}</svg>`;
}
