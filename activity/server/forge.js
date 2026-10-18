// 鍛造（賭場遊戲）：每升一階要付鍛造費，有機率成功或「劍碎」（全部歸零）；隨時可以賣掉現在的劍。共 100 階。
// 數字全部由這個檔案算好，前端只負責畫。每一步的期望回收率（RTP）固定壓在 95% 以下，
// 所以不管怎麼停手，長期都不可能靠鍛造賺代幣：   p(n) × 賣價(n+1) ≤ 0.95 × (賣價(n) + 鍛造費(n))
// 從零一路成功到 100 階，鍛造費總共剛好 100 萬。
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const FORGE_MAX = 100;
const RTP = 0.95, BOOST = Number(process.env.FBOOST || 1.01), TOTAL_COST = 1_000_000;     // TOTAL_COST：從零一路成功鍛到 100 階，總共要花的鍛造費
// 成功率：前 49 階約 97.3%→94.3%，50 階以後 94%→91%；從零一路成功到 100 階的機率約 0.23%
const PL0 = Number(process.env.FPL0 || 0.94), PL1 = Number(process.env.FPL1 || 0.91);
const PE0 = Number(process.env.FPE0 || 0.973), PE1 = Number(process.env.FPE1 || 0.943);
const pTarget = (n) => (n === 0 ? 0.97 : n < 50 ? PE0 - (PE0 - PE1) * ((n - 1) / 48) : PL0 - (PL0 - PL1) * ((n - 50) / 49));
// 鍛造費佔賣價的比例：前期 3% 慢慢升到約 5%，50 階以後 3%
// 每一步的期望回收率：第 1~49 階略大於 1（101%），讓「一路鍛到 50 階再賣」的期望淨值為正；50 階以後 100%（期望值從 50 階的高點緩緩下降，50 階是最佳停手點）
const RL = Number(process.env.FRL || 1.0);
const rr = (n) => (n < 50 ? BOOST : RL);
const ALATE = Number(process.env.FALATE || 0.03), AEND = Number(process.env.FAEND || 0.03);
const alpha = (n) => (n < 50 ? 0.03 + 0.05 * (n / 99) : ALATE + (AEND - ALATE) * ((n - 50) / 49));
function build(C0) {
  const V = [0], C = [C0], P = [];
  V[1] = Math.floor(RTP * C0 / 0.97);
  for (let n = 1; n < FORGE_MAX; n++) {
    C[n] = Math.max(1, Math.ceil(V[n] * alpha(n)));
    V[n + 1] = Math.max(V[n] + 1, Math.floor(rr(n) * (V[n] + C[n]) / pTarget(n)));
  }
  for (let n = 0; n < FORGE_MAX; n++) {
    const cap = rr(n) * (V[n] + C[n]) / V[n + 1];
    P[n] = Math.floor(1000 * Math.min(pTarget(n), cap, 0.99)) / 1000;
  }
  return { V, C, P, sum: C.reduce((a, b) => a + b, 0) };
}
// 用二分法找打造費 C0，讓全部鍛造費加起來剛好不超過 TOTAL_COST，剩下的零頭加在最後一階（多收一點只會讓莊家更有利）
let lo = 1, hi = 100000;
while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (build(mid).sum <= TOTAL_COST) lo = mid; else hi = mid - 1; }
const T = build(lo);
T.C[FORGE_MAX - 1] += TOTAL_COST - T.sum;
// V[n] = 第 n 階的賣價；C[n] = 從第 n 階鍛到 n+1 階的費用（n=0 表示「買劍」）；P[n] = 成功率
export const V = T.V, C = T.C, P = T.P;
export const REAL_SELL_MAX = 3_000_000;       // 賭注模式單把劍賣出上限（正常算出來的最高賣價約 205 萬，這只是保險）
export const FORGE_PRACTICE_START = 100_000;  // 鍛造的練習幣起始金額（一般賭場遊戲只有 1000，不夠鍛）

// ---- 存檔：每個身分一把劍。key：p:<id>（練習幣）、r:<uid>（真代幣，練習和真代幣的劍分開）
const FFILE = fileURLToPath(new URL("./forge.json", import.meta.url));
let db = { sw: {}, best: {}, xp: {} };
try { db = { sw: {}, best: {}, xp: {}, ...JSON.parse(fs.readFileSync(FFILE, "utf8")) }; } catch {}
let saveT = 0;
export function forgeSave(now = false) {
  const w = () => { try { fs.writeFileSync(FFILE, JSON.stringify(db)); } catch (e) { console.log("鍛造存檔失敗", e.message); } };
  if (now) { clearTimeout(saveT); w(); return; }
  clearTimeout(saveT); saveT = setTimeout(w, 800);
}
export const FORGE_SLOTS = 10;                 // 每個身分最多同時擁有的劍（格數）
// 舊存檔是單把劍（物件），讀到時轉成 10 格的陣列
function slotsOf(key) {
  let a = db.sw[key];
  if (!Array.isArray(a)) a = db.sw[key] = a ? [a] : [];
  while (a.length < FORGE_SLOTS) a.push(null);
  return a;
}
export const getSword = (key, i = 0) => slotsOf(key)[i] || null;
export const setSword = (key, i, s) => { slotsOf(key)[i] = s || null; };
// 鍛造經驗：真代幣模式下累計付出的鍛造費（成功或失敗都算，劍碎了也保留）
export const xpOf = (key) => (db.xp && db.xp[key]) || 0;
export function addXp(key, n) { if (!db.xp) db.xp = {}; db.xp[key] = (db.xp[key] || 0) + n; }
// 目前每把劍的階數；以及這些劍對應的「身分組區間」簽名（有變才通知 Discord，避免重複呼叫）
export const swordTiers = (key) => slotsOf(key).filter(Boolean).map((x) => x.tier);
export const roleSig = (key) => [...new Set(swordTiers(key).filter((t) => t >= 30).map((t) => Math.min(10, Math.floor(t / 10))))].sort((a, b) => a - b).join(",");
export const getRoleSig = (key) => (db.rl && db.rl[key]) || "";
export function setRoleSig(key, v) { if (!db.rl) db.rl = {}; db.rl[key] = v; }
export const bestOf = (key) => db.best[key] || 0;
export function noteBest(key, tier) { if (tier > (db.best[key] || 0)) db.best[key] = tier; }

// 玩家看到的目前狀態（含下一步的費用、成功率、成功後賣價）
export function forgeView(key, real, slot = 0) {
  slot = Number.isInteger(slot) && slot >= 0 && slot < FORGE_SLOTS ? slot : 0;
  const s = getSword(key, slot), tier = s ? s.tier : 0;
  const maxed = tier >= FORGE_MAX;
  const sell = (t) => (real ? Math.min(V[t], REAL_SELL_MAX) : V[t]);
  return {
    t: "fstate", real, slot, slots: slotsOf(key).map((x) => (x ? x.tier : 0)), tier, sell: sell(tier), best: bestOf(key), xp: real ? xpOf(key) : null, max: FORGE_MAX,
    cost: maxed ? 0 : C[tier], p: maxed ? 0 : P[tier], nextSell: maxed ? 0 : sell(tier + 1), spent: s ? s.spent : 0, forged: s ? s.forged : 0,
  };
}
