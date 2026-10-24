// 賭石的牌面與機率（純邏輯，casino.js 負責錢）。
// 一顆石頭買下時就決定了真正的價值等級（0～8），玩家看不到。皮殼和每一刀切面會給一個「帶雜訊的等級線索」，
// 收購商的出價 = 依目前所有線索算出的期望倍率 × 0.8，所以賣掉的期望值比全開低一些，切石要付費，整體略為負期望值。
import { randomInt } from "node:crypto";

export const TIERS = [
  { name: "廢石", mult: 0, p: 36.5, cut: "切面全灰，一點綠都沒有", skin: "皮殼粗糙乾澀，沒有任何表現" },
  { name: "綠絲石", mult: 0.3, p: 22, cut: "幾絲淡淡的綠", skin: "皮殼粗，偶爾有點色" },
  { name: "豆種", mult: 0.7, p: 16, cut: "一塊一塊的淡綠斑", skin: "皮殼普通，帶砂" },
  { name: "糯種", mult: 1.2, p: 11, cut: "一條連續的綠帶", skin: "皮殼細一點，有霧層" },
  { name: "油青種", mult: 2, p: 8, cut: "油亮的青綠，透光", skin: "皮殼細膩，有松花" },
  { name: "冰種", mult: 4, p: 4, cut: "冰透飄著花", skin: "皮殼緊，蟒帶明顯" },
  { name: "糯冰陽綠", mult: 10, p: 2, cut: "陽綠鮮豔，水頭足", skin: "皮殼緊密，蟒帶發亮" },
  { name: "玻璃種滿綠", mult: 25, p: 0.45, cut: "滿綠通透，像玻璃", skin: "皮殼極細，松花成片" },
  { name: "帝王綠", mult: 60, p: 0.05, cut: "濃豔帝王綠，水頭極好", skin: "皮殼完美，滿身蟒帶" },
];
export const MAX_CUTS = 3, CUT_FEE = 0.03, OPEN_FEE = 0.08, OFFER_RATE = 0.85;
const CUT_W = [0.75, 0.12, 0.02];                 // 切面線索：和真等級差 0、1、2 級的權重
const SKIN_W = [0.25, 0.2, 0.1, 0.04];          // 皮殼線索：差距可能更大
export const EV = TIERS.reduce((s, t) => s + t.mult * t.p / 100, 0);

export function drawTier() {
  let r = randomInt(100000) / 1000;             // 0..100，千分之一精度
  for (let k = 0; k < TIERS.length; k++) { r -= TIERS[k].p; if (r < 0) return k; }
  return 0;
}
// 對真等級 k，產生一個線索等級 j（超出 0..8 的重新抽）
export function hintFor(k, W) {
  const opts = [];
  for (let j = 0; j < TIERS.length; j++) { const w = W[Math.abs(j - k)] || 0; if (w) opts.push([j, w]); }
  let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  for (const [j, w] of opts) { r -= w; if (r <= 0) return j; }
  return k;
}
const lik = (W, k, j) => {
  let z = 0; for (let i = 0; i < TIERS.length; i++) z += W[Math.abs(i - k)] || 0;
  return (W[Math.abs(j - k)] || 0) / z;
};
// 依線索算每個真等級的後驗機率，回傳期望倍率
export function expectedMult(skinJ, cutJs) {
  let tot = 0, ev = 0;
  for (let k = 0; k < TIERS.length; k++) {
    let p = TIERS[k].p / 100 * lik(SKIN_W, k, skinJ);
    for (const j of cutJs) p *= lik(CUT_W, k, j);
    tot += p; ev += p * TIERS[k].mult;
  }
  return tot ? ev / tot : EV;
}
export const offerFor = (bet, skinJ, cutJs) => Math.max(0, Math.floor(bet * expectedMult(skinJ, cutJs) * OFFER_RATE));
export const cutFee = (bet) => Math.max(1, Math.round(bet * CUT_FEE));
export const openFee = (bet) => Math.max(1, Math.round(bet * OPEN_FEE));
export const CUT_WEIGHTS = CUT_W, SKIN_WEIGHTS = SKIN_W;

// ---- 市場：一次擺 6 顆石頭，大小（價格）不同。價格 = 基準價 × 大小；價值倍率照等級，所以大石頭只是賭得比較大，不會比較划算。
export const MARKET_N = 6;
export function newMarket(bet, maxPrice) {
  return Array.from({ length: MARKET_N }, (_, id) => {
    const tier = drawTier(), size = Math.round((0.6 + Math.random() * 1.0) * 100) / 100;
    return { id, tier, size, price: Math.max(1, Math.min(maxPrice, Math.round(bet * size))), seed: randomInt(1, 2 ** 30), skin: hintFor(tier, SKIN_WEIGHTS), win: Math.random() < 0.35 ? hintFor(tier, CUT_WEIGHTS) : null };
  });
}
