// 麻將共用核心：牌的編碼、牌牆、向聽數、拆牌（找出所有「眼＋面子」的組法）、聽哪些牌。
// 台灣 16 張（mjtw.js）和日本立直（mjjp.js）都用這裡的函式，牌桌流程在 mahjong.js。
//
// 牌的編碼：0~8 一~九萬、9~17 一~九筒、18~26 一~九條、27~30 東南西北、31~33 白發中、34~41 花（春夏秋冬梅蘭竹菊，只有台灣麻將用）
import { randomInt } from "node:crypto";

export const N_KIND = 34;
export const isHonor = (t) => t >= 27 && t < 34;
export const isFlower = (t) => t >= 34;
export const suitOf = (t) => (t < 27 ? Math.floor(t / 9) : 3);
export const numOf = (t) => (t < 27 ? (t % 9) + 1 : 0);
export const isTerminal = (t) => t < 27 && (t % 9 === 0 || t % 9 === 8);
export const isYaochu = (t) => isHonor(t) || isTerminal(t);
export const isDragon = (t) => t >= 31 && t <= 33;
export const isWind = (t) => t >= 27 && t <= 30;
export const WIND = 27, DRAGON = 31;

const NUM_ZH = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONOR_ZH = ["東", "南", "西", "北", "白", "發", "中"];
const FLOWER_ZH = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
export function tileName(t) {
  if (t >= 34) return FLOWER_ZH[t - 34];
  if (t >= 27) return HONOR_ZH[t - 27];
  return NUM_ZH[t % 9] + ["萬", "筒", "條"][Math.floor(t / 9)];
}

export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function newWall(withFlowers) {
  const w = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) w.push(t);
  if (withFlowers) for (let f = 34; f < 42; f++) w.push(f);
  return shuffle(w);
}
export function toCounts(tiles) { const c = new Array(34).fill(0); for (const t of tiles) if (t < 34) c[t]++; return c; }
export const sortTiles = (a) => a.sort((x, y) => x - y);

// ---------------------------------------------------------------- 向聽數
// 每一門（萬／筒／條／字）分開列出所有可能的 (面子數 m, 搭子數 t, 有沒有眼 p)，再把四門組合起來取最小。
// 向聽 = 2×需要的面子數 − 2m − t − p（m + t 不超過需要的面子數）；−1 代表已經胡了。
const memo = new Map();
function suitOpts(arr, honor) {
  const key = (honor ? "h" : "s") + arr.join("");
  const hit = memo.get(key); if (hit) return hit;
  const res = new Map();
  const a = arr.slice();
  (function dfs(i, m, t, p) {
    while (i < a.length && !a[i]) i++;
    if (i >= a.length) { const k = m * 100 + t * 10 + p; res.set(k, [m, t, p]); return; }
    if (a[i] >= 3) { a[i] -= 3; dfs(i, m + 1, t, p); a[i] += 3; }
    if (!honor && i <= 6 && a[i + 1] && a[i + 2]) { a[i]--; a[i + 1]--; a[i + 2]--; dfs(i, m + 1, t, p); a[i]++; a[i + 1]++; a[i + 2]++; }
    if (a[i] >= 2) {
      a[i] -= 2;
      if (!p) dfs(i, m, t, 1);
      dfs(i, m, t + 1, p);
      a[i] += 2;
    }
    if (!honor && i <= 7 && a[i + 1]) { a[i]--; a[i + 1]--; dfs(i, m, t + 1, p); a[i]++; a[i + 1]++; }
    if (!honor && i <= 6 && a[i + 2]) { a[i]--; a[i + 2]--; dfs(i, m, t + 1, p); a[i]++; a[i + 2]++; }
    a[i]--; dfs(i, m, t, p); a[i]++;
  })(0, 0, 0, 0);
  // 只留「沒有被別的組合完全壓過」的選項
  const all = [...res.values()];
  const keep = all.filter((x) => !all.some((y) => y !== x && y[0] >= x[0] && y[1] >= x[1] && y[2] >= x[2] && (y[0] > x[0] || y[1] > x[1] || y[2] > x[2])));
  if (memo.size > 200000) memo.clear();
  memo.set(key, keep);
  return keep;
}
export function shantenRegular(c, need) {
  const groups = [suitOpts(c.slice(0, 9), false), suitOpts(c.slice(9, 18), false), suitOpts(c.slice(18, 27), false), suitOpts(c.slice(27, 34), true)];
  let best = 99;
  for (const g0 of groups[0]) for (const g1 of groups[1]) for (const g2 of groups[2]) for (const g3 of groups[3]) {
    let m = g0[0] + g1[0] + g2[0] + g3[0], t = g0[1] + g1[1] + g2[1] + g3[1], p = g0[2] + g1[2] + g2[2] + g3[2];
    if (p > 1) { t += p - 1; p = 1; }
    if (m > need) m = need;
    if (m + t > need) t = need - m;
    const sh = 2 * need - 2 * m - t - p;
    if (sh < best) best = sh;
  }
  return best;
}
export function shantenChiitoi(c) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < 34; i++) { if (c[i]) kinds++; if (c[i] >= 2) pairs++; }
  return 6 - pairs + Math.max(0, 7 - kinds);
}
const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
export function shantenKokushi(c) {
  let kinds = 0, pair = 0;
  for (const i of YAOCHU) { if (c[i]) kinds++; if (c[i] >= 2) pair = 1; }
  return 13 - kinds - pair;
}
// jp=true 時也看七對子和國士無雙（只有沒副露時）
export function shanten(c, need, jp) {
  let s = shantenRegular(c, need);
  if (jp && need === 4) s = Math.min(s, shantenChiitoi(c), shantenKokushi(c));
  return s;
}

// ---------------------------------------------------------------- 拆牌
// 回傳所有「一個眼＋剩下全部是面子」的拆法：{ pair, sets: [{ k: "pung"|"chow", t }] }
export function decomps(c) {
  const out = [];
  const a = c.slice();
  const sets = [];
  function dfs(i) {
    while (i < 34 && !a[i]) i++;
    if (i >= 34) { out.push(sets.slice()); return; }
    if (a[i] >= 3) { a[i] -= 3; sets.push({ k: "pung", t: i }); dfs(i); sets.pop(); a[i] += 3; }
    if (i < 27 && i % 9 <= 6 && a[i + 1] && a[i + 2]) { a[i]--; a[i + 1]--; a[i + 2]--; sets.push({ k: "chow", t: i }); dfs(i); sets.pop(); a[i]++; a[i + 1]++; a[i + 2]++; }
  }
  const res = [];
  for (let p = 0; p < 34; p++) {
    if (a[p] < 2) continue;
    a[p] -= 2; out.length = 0; dfs(0); a[p] += 2;
    for (const s of out) res.push({ pair: p, sets: s });
  }
  return res;
}
export function isChiitoi(c) { let pairs = 0; for (let i = 0; i < 34; i++) { if (c[i] === 2) pairs++; else if (c[i]) return false; } return pairs === 7; }
export function isKokushi(c) { let n = 0, pair = false; for (let i = 0; i < 34; i++) { if (!c[i]) continue; if (!YAOCHU.includes(i)) return false; n++; if (c[i] === 2) pair = true; if (c[i] > 2) return false; } return n === 13 && pair; }

// 這副手牌（不含剛摸／別人打的那張）聽哪些牌
export function waitsOf(c, need, jp) {
  const res = [];
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (shanten(c, need, jp) === -1) res.push(t);
    c[t]--;
  }
  return res;
}

// 寶牌：指示牌的下一張（數牌 9→1，風牌 北→東，三元 中→白）
export function doraOf(ind) {
  if (ind < 27) return Math.floor(ind / 9) * 9 + ((ind % 9) + 1) % 9;
  if (ind <= 30) return 27 + ((ind - 27 + 1) % 4);
  return 31 + ((ind - 31 + 1) % 3);
}
