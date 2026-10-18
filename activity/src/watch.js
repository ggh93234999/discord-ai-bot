// 「👀 同房玩家」旁觀面板：同一個 Activity 裡玩同一個賭場遊戲的人，名單、模式（練習／真代幣）和最新一把都看得到。
// 資料來自伺服器的 cwho 廣播（casino.js）。老虎機、擲硬幣、骰子、21 點、賽馬共用。
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => n.toLocaleString();

function outcome(e) {
  const net = e.back - e.bet;
  return e.back > e.bet ? `<b class="w">+${money(net)}</b>` : e.back === e.bet ? `<b>退回</b>` : `<b class="l">-${money(e.bet)}</b>`;
}
function cards(list, hide) { return list.map((c) => `<span class="mc ${/♥|♦/.test(c) ? "r" : ""}">${esc(c)}</span>`).join("") + (hide ? `<span class="mc b">?</span>` : ""); }
const die = (n) => "⚀⚁⚂⚃⚄⚅"[n - 1];

function body(e) {
  if (e.g === "slots") return `<div class="mgrid">${e.grid.map((r) => `<div>${r.join("")}</div>`).join("")}</div><div>押 ${money(e.bet)}　${outcome(e)}${e.nwin ? `　中 ${e.nwin} 條` : ""}</div>`;
  if (e.g === "coin") return `<div>押${e.pick === "heads" ? "正面" : "反面"} → 開出${e.res === "heads" ? "正面" : "反面"}　${outcome(e)}</div>`;
  if (e.g === "dice") return `<div>你 ${die(e.me[0])}${die(e.me[1])} ${e.me[0] + e.me[1]} 點 vs 莊 ${die(e.bot[0])}${die(e.bot[1])} ${e.bot[0] + e.bot[1]} 點　${outcome(e)}</div>`;
  if (e.g === "bj") return `<div>${cards(e.dealer)}<small> 莊 ${e.dv}</small></div><div>${cards(e.player)}<small> 他 ${e.pv}</small></div><div>${esc(e.text)}　${outcome(e)}</div>`;
  if (e.g === "forge") return `<div>⚒ ${esc(e.text || "")}</div>`;
  if (e.g === "horse") return `<div>押 ${e.idx + 1} 號 ${esc(e.name)}（${e.win === e.idx ? "奪冠" : "沒贏"}）　${outcome(e)}</div>`;
  return "";
}

// 單一玩家的最新狀態（21 點進行中顯示手牌，其餘顯示最新一把）
export function entryHtml(p) {
  if (p.hand) return `<div><small>🃏 思考中…　押 ${money(p.hand.bet)}</small></div><div>${cards([p.hand.dealerUp], true)}<small> 莊</small></div><div>${cards(p.hand.player)}<small> 他 ${p.hand.pv}</small></div>`;
  if (p.last) return body(p.last);
  return `<small>還沒開始玩</small>`;
}

export function createWatch(root, { title = "👀 同房玩家" } = {}) {
  const box = document.createElement("div");
  box.className = "watchbox";
  root.append(box);
  let you = null, list = [], seen = new Map();
  function render() {
    const others = list.filter((p) => p.id !== you);
    const rows = others.map((p) => {
      const e = p.hand || p.last;
      const tag = p.real ? `<span class="mt real">💰</span>` : `<span class="mt">🎮</span>`;
      const sig = e ? JSON.stringify(e) : "";
      const fresh = e && seen.has(p.id) && seen.get(p.id) !== sig ? " fresh" : "";
      seen.set(p.id, sig);
      let inner;
      if (p.hand) inner = `<div><small>🃏 思考中…　押 ${money(p.hand.bet)}</small></div><div>${cards([p.hand.dealerUp], true)}<small> 莊</small></div><div>${cards(p.hand.player)}<small> 他 ${p.hand.pv}</small></div>`;
      else if (p.last) inner = body(p.last);
      else inner = `<small>還沒開始玩</small>`;
      const bal = p.bal == null ? "" : ` <span class="mbal${p.real ? " real" : ""}" title="${p.real ? "真代幣餘額" : "練習幣餘額"}">${money(p.bal)}</span>`;
      return `<div class="mrow${fresh}"><div class="mname">${tag} ${esc(p.name)}${bal}</div><div class="mbody">${inner}</div></div>`;
    }).join("");
    box.innerHTML = `<h3>${title}<small>${others.length ? ` ${others.length} 人` : ""}</small></h3>` +
      (rows || `<div class="mempty">目前只有你一個人。朋友在同一個 Activity 裡玩這個遊戲時，他們的每一把會即時出現在這裡，你也可以什麼都不玩、純旁觀。</div>`);
  }
  render();
  return {
    setYou(id) { you = id; render(); },
    update(l) { list = l; render(); },
    destroy() { box.remove(); },
  };
}
