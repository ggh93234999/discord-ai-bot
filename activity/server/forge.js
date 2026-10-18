// 鍛造（賭場遊戲）：每升一階要付鍛造費，有機率成功或「劍碎」（全部歸零）；隨時可以賣掉現在的劍。共 100 階。
// 數字全部由這個檔案算好，前端只負責畫。每一步的期望回收率（RTP）固定壓在 95% 以下，
// 所以不管怎麼停手，長期都不可能靠鍛造賺代幣：   p(n) × 賣價(n+1) ≤ 0.95 × (賣價(n) + 鍛造費(n))
// 從零一路成功到 100 階，鍛造費總共剛好 100 萬。
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const FORGE_MAX = 100;
const RTP = 0.95, TOTAL_COST = 1_000_000;     // TOTAL_COST：從零一路成功鍛到 100 階，總共要花的鍛造費
// 成功率：第 1 階 96%，一路降到第 99 階 88%（前面降得比較快，所以大約第 14 階開始「賣掉就賺」）
const pTarget = (n) => (n === 0 ? 0.97 : 0.96 - 0.08 * Math.pow((n - 1) / 98, 0.6));
// 鍛造費佔賣價的比例：前期 3%（便宜），後期 8%
const alpha = (n) => 0.03 + 0.05 * (n / 99);
function build(C0) {
  const V = [0], C = [C0], P = [];
  V[1] = Math.floor(RTP * C0 / 0.97);
  for (let n = 1; n < FORGE_MAX; n++) {
    C[n] = Math.max(1, Math.ceil(V[n] * alpha(n)));
    V[n + 1] = Math.max(V[n] + 1, Math.floor(RTP * (V[n] + C[n]) / pTarget(n)));
  }
  for (let n = 0; n < FORGE_MAX; n++) {
    const cap = RTP * (V[n] + C[n]) / V[n + 1];
    P[n] = Math.floor(1000 * Math.min(pTarget(n), cap, 0.99)) / 1000;
  }
  return { V, C, P, sum: C.reduce((a, b) => a + b, 0) };
}
// 用二分法找打造費 C0，讓全部鍛造費加起來剛好不超過 TOTAL_COST，剩下的零頭加在最後一階（多收一點只會讓莊家更有利）
let lo = 20, hi = 100000;
while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (build(mid).sum <= TOTAL_COST) lo = mid; else hi = mid - 1; }
const T = build(lo);
T.C[FORGE_MAX - 1] += TOTAL_COST - T.sum;
// V[n] = 第 n 階的賣價；C[n] = 從第 n 階鍛到 n+1 階的費用（n=0 表示「買劍」）；P[n] = 成功率
export const V = T.V, C = T.C, P = T.P;
export const REAL_SELL_MAX = 3_000_000;       // 賭注模式單把劍賣出上限（正常算出來的最高賣價約 205 萬，這只是保險）
export const FORGE_PRACTICE_START = 100_000;  // 鍛造的練習幣起始金額（一般賭場遊戲只有 1000，不夠鍛）

// ---- 存檔：每個身分一把劍。key：p:<id>（練習幣）、r:<uid>（真代幣，練習和真代幣的劍分開）
const FFILE = fileURLToPath(new URL("./forge.json", import.meta.url));
let db = { sw: {}, best: {} };
try { db = { sw: {}, best: {}, ...JSON.parse(fs.readFileSync(FFILE, "utf8")) }; } catch {}
let saveT = 0;
export function forgeSave(now = false) {
  const w = () => { try { fs.writeFileSync(FFILE, JSON.stringify(db)); } catch (e) { console.log("鍛造存檔失敗", e.message); } };
  if (now) { clearTimeout(saveT); w(); return; }
  clearTimeout(saveT); saveT = setTimeout(w, 800);
}
export const getSword = (key) => db.sw[key] || null;
export const setSword = (key, s) => { if (s) db.sw[key] = s; else delete db.sw[key]; };
export const bestOf = (key) => db.best[key] || 0;
export function noteBest(key, tier) { if (tier > (db.best[key] || 0)) db.best[key] = tier; }

// 玩家看到的目前狀態（含下一步的費用、成功率、成功後賣價）
export function forgeView(key, real) {
  const s = getSword(key), tier = s ? s.tier : 0;
  const maxed = tier >= FORGE_MAX;
  const sell = (t) => (real ? Math.min(V[t], REAL_SELL_MAX) : V[t]);
  return {
    t: "fstate", real, tier, sell: sell(tier), best: bestOf(key), max: FORGE_MAX,
    cost: maxed ? 0 : C[tier], p: maxed ? 0 : P[tier], nextSell: maxed ? 0 : sell(tier + 1), spent: s ? s.spent : 0, forged: s ? s.forged : 0,
  };
}
