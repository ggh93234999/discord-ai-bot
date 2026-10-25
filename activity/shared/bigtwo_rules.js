// 大老二的牌型判斷（伺服器和前端共用，純函式）。
// 牌的編號和橋牌一樣：花色 = floor(c/13)（♣0 ♦1 ♥2 ♠3），點數 = c%13+2（2..14，A=14）。
// 大小順序：3 < 4 < … < K < A < 2；同點數比花色 ♣ < ♦ < ♥ < ♠。
export const SUITS = ["♣", "♦", "♥", "♠"];
export const suitOf = (c) => Math.floor(c / 13);
export const rankOf = (c) => (c % 13) + 2;
export const rstr = (c) => (rankOf(c) === 2 ? 15 : rankOf(c));          // 點數強度（2 最大）
export const strength = (c) => rstr(c) * 4 + suitOf(c);                  // 單張強度（含花色）
export const CLUB3 = 1;                                                  // ♣3
export const TYPE_NAMES = { 1: "單張", 2: "對子", 3: "三條", 4: "順子", 6: "葫蘆", 7: "鐵支", 8: "同花順", 9: "一條龍" };

// 判斷一組牌是什麼牌型。回傳 { n, type, k, top }；k 是同張數下可比大小的數字。不是合法牌型回傳 null。
export function classify(cards) {
  const n = cards.length;
  if (n === 1) return { n, type: 1, k: strength(cards[0]), top: cards[0] };
  if (n === 2) {
    if (rstr(cards[0]) !== rstr(cards[1])) return null;
    return { n, type: 2, k: Math.max(strength(cards[0]), strength(cards[1])), top: strength(cards[0]) > strength(cards[1]) ? cards[0] : cards[1] };
  }
  if (n === 3) {                                                          // 三條：三張同點，比點數
    if (!(rstr(cards[0]) === rstr(cards[1]) && rstr(cards[1]) === rstr(cards[2]))) return null;
    return { n, type: 3, k: rstr(cards[0]), top: cards.reduce((a, b) => (strength(b) > strength(a) ? b : a)) };
  }
  if (n === 13) {                                                         // 一條龍：3 到 2 每個點數各一張
    const rs = new Set(cards.map(rstr));
    return rs.size === 13 ? { n, type: 9, k: 9000, top: cards.reduce((a, b) => (strength(b) > strength(a) ? b : a)) } : null;
  }
  if (n !== 5) return null;
  const by = {};
  for (const c of cards) (by[rstr(c)] ||= []).push(c);
  const ranks = Object.keys(by).map(Number).sort((a, b) => a - b);
  const top = cards.reduce((a, b) => (strength(b) > strength(a) ? b : a));
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const straight = ranks.length === 5 && ranks[4] - ranks[0] === 4;
  if (straight && flush) return { n, type: 8, k: 8000 + strength(top), top };
  const counts = ranks.map((r) => by[r].length).sort((a, b) => b - a).join("");
  if (counts === "41") return { n, type: 7, k: 7000 + 4 * ranks.find((r) => by[r].length === 4), top };
  if (counts === "32") return { n, type: 6, k: 6000 + 4 * ranks.find((r) => by[r].length === 3), top };
  if (straight) return { n, type: 4, k: 4000 + strength(top), top };
  return null;
}
// a 能不能壓過 b：
//  - 一條龍（3 到 2 各一張，13 張）最大，壓全部；鐵支、同花順是「炸彈」，可以直接壓任何非炸彈的牌（單張、對子、順子、葫蘆都行）；
//  - 炸彈之間：同花順 > 鐵支；同樣牌型再比大小（k 已經含牌型分數）；
//  - 其他牌型：張數和牌型都要一樣（單張壓單張、對子壓對子、順子壓順子、葫蘆壓葫蘆），而且更大。
export const isBomb = (x) => x.type >= 7;
export const beats = (a, b) => !b || (isBomb(a) ? !isBomb(b) || a.k > b.k : a.n === b.n && a.type === b.type && a.k > b.k);
export const cardsText = (cards) => cards.map((c) => SUITS[suitOf(c)] + ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[rankOf(c)] || rankOf(c))).join(" ");
// 手牌排序：由小到大（3 最小、2 最大）
export const sortHand = (h) => h.sort((a, b) => strength(a) - strength(b));
