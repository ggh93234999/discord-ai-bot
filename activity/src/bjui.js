// 21 點的牌桌畫面：絨布桌、有點數排列的撲克牌（宮廷牌與牌背是 AI 畫的）、發牌／翻牌動畫。牌的內容與結果都由伺服器給，這裡只負責畫。
const U = {};
for (const [pth, url] of Object.entries(import.meta.glob("./card-art/*.png", { eager: true, query: "?url", import: "default" }))) U[pth.split("/").pop().slice(0, -4)] = url;
const PIPS = {
  2: [[50, 17], [50, 83]], 3: [[50, 17], [50, 50], [50, 83]],
  4: [[30, 17], [70, 17], [30, 83], [70, 83]], 5: [[30, 17], [70, 17], [50, 50], [30, 83], [70, 83]],
  6: [[30, 17], [70, 17], [30, 50], [70, 50], [30, 83], [70, 83]], 7: [[30, 17], [70, 17], [50, 33], [30, 50], [70, 50], [30, 83], [70, 83]],
  8: [[30, 17], [70, 17], [50, 33], [30, 50], [70, 50], [50, 67], [30, 83], [70, 83]],
  9: [[30, 17], [70, 17], [30, 39], [70, 39], [50, 50], [30, 61], [70, 61], [30, 83], [70, 83]],
  10: [[30, 17], [70, 17], [50, 28], [30, 39], [70, 39], [30, 61], [70, 61], [50, 72], [30, 83], [70, 83]],
};
export const backUrl = U.back || "";
export const parseCard = (c) => { const m = /^([♠♥♦♣])️?(.+)$/.exec(String(c)); return m ? { s: m[1], r: m[2] } : { s: "♠", r: String(c) }; };

function faceHtml(c) {
  const { s, r } = parseCard(c), red = s === "♥" || s === "♦", g = s + "︎";
  let mid;
  if (PIPS[r]) mid = PIPS[r].map(([x, y]) => `<i class="pip${y > 50 ? " flip" : ""}" style="left:${x}%;top:${y}%">${g}</i>`).join("");
  else if (r === "A") mid = `<i class="pip ace" style="left:50%;top:50%">${g}</i>`;
  else {
    const u = U[{ J: "jack", Q: "queen", K: "king" }[r]];
    mid = u ? `<div class="court"><img src="${u}" alt=""></div>` : `<b class="cl">${r}</b>`;
  }
  return `<div class="cf${red ? " red" : ""}" data-s="${s}"><div class="ix tl"><b>${r}</b><span>${g}</span></div><div class="ix br"><b>${r}</b><span>${g}</span></div><div class="mid">${mid}</div></div>`;
}
// kind: "" 靜止、"deal" 從牌靴飛進來並翻面、"flip" 蓋著的牌翻開
export function cardHtml(c, kind, delay) {
  const down = c == null;
  return `<div class="bjc${kind === "deal" ? " deal" : ""}" style="--dl:${delay || 0}s"><div class="bjin${down ? " down" : ""}${kind && !(down && kind === "deal") ? " " + kind : ""}"><div class="bjf">${down ? "" : faceHtml(c)}</div><div class="bjb"${U.back ? ` style="background-image:url(${U.back})"` : ""}></div></div></div>`;
}
const chipHtml = (bet) => `<div class="bjchips"><div class="chip c${bet >= 500 ? 3 : bet >= 100 ? 2 : bet >= 50 ? 1 : 0} b"></div><div class="chip c${bet >= 500 ? 3 : bet >= 100 ? 2 : bet >= 50 ? 1 : 0}"><span>${bet}</span></div></div>`;

// st：跨手維持的狀態 { p, d, hole, reset }，讓已經在桌上的牌不要每次重畫都重新發一遍
export function newBjState() { return { p: 0, d: 0, hole: true, reset: true }; }
export function bjHtml(m, st) {
  if (st.reset) { st.p = 0; st.d = 0; st.hole = true; st.reset = false; }
  const first = st.p === 0;
  const newP = m.player.length - st.p, pdelay = newP > 0 ? (first ? 1.25 : 0.8) : 0;
  const pt = (txt, d) => (d > 0 ? `<em class="dvl" style="animation-delay:${d}s">${txt}</em>` : txt);
  const pl = m.player.map((c, i) => cardHtml(c, i >= st.p ? "deal" : "", first ? (i === 0 ? 0 : 0.4) : 0)).join("");
  let dl = "", extra = 0;
  if (!m.done) dl = cardHtml(m.dealerUp, st.d === 0 ? "deal" : "", 0.2) + cardHtml(null, st.d === 0 ? "deal" : "", 0.6);
  else {
    dl = m.dealer.map((c, i) => {
      if (i === 0) return cardHtml(c, st.d === 0 ? "deal" : "", 0.2);
      if (i === 1) return cardHtml(c, st.hole ? "flip" : "", st.hole ? (first ? 1.0 : 0.15) : 0);
      extra++; return cardHtml(c, "deal", 0.9 + (extra - 1) * 0.5);
    }).join("");
  }
  const dealerN = m.done ? m.dealer.length : 2, ov = (n) => (n <= 2 ? -8 : n <= 3 ? 10 : n <= 5 ? 24 : 34);
  st.p = m.player.length; st.d = m.done ? m.dealer.length : 1;
  const rdelay = m.done ? (first ? 1.5 : 0.7) + extra * 0.5 : 0;
  if (m.done) { st.hole = false; st.reset = true; }
  return {
    rdelay,
    html: `<div class="bjtab"><div class="bjshoe"></div>
      <div class="bjrow"><small>莊家${m.done ? `（${pt(m.dv + " 點", rdelay)}）` : ""}</small><div class="hand" style="--ov:${ov(dealerN)}px">${dl}</div></div>
      <div class="bjmid"><span>BLACKJACK　2.5 倍</span>${chipHtml(m.bet)}</div>
      <div class="bjrow"><small>你（${pt(m.pv + " 點", pdelay)}）</small><div class="hand" style="--ov:${ov(m.player.length)}px">${pl}</div></div></div>`,
  };
}
