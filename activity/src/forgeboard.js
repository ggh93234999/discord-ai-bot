// 神兵榜：全服玩家「目前擁有的最高階劍」排行，分真代幣模式（真代幣）和練習模式兩張榜。
import { wsUrl } from "./gomoku.js";
import { swordName, swordSvg } from "./forgeui.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n).toLocaleString();
const MEDAL = ["🥇", "🥈", "🥉"];

export function mountForgeBoard(root, { env, back }) {
  let ws = null, closed = false, retry = 0, timer = 0, real = true, data = { true: null, false: null };

  root.innerHTML = `
    <div class="game fboard">
      <header><button class="back">← 選單</button><h2>🏆 神兵榜</h2><span></span></header>
      <div class="fbtabs"><button class="tab on" data-r="1">💰 真代幣模式</button><button class="tab" data-r="0">🎮 練習模式</button></div>
      <div class="fbhint">依每個人「目前手上最高階的那一把劍」排名，每人最多顯示最高階的 3 把，劍碎或賣掉就會掉榜。</div>
      <div class="fblist"></div>
    </div>`;
  const listEl = root.querySelector(".fblist");
  root.querySelector(".back").addEventListener("click", () => { destroy(); back(); });
  root.querySelectorAll(".fbtabs .tab").forEach((b) => b.addEventListener("click", () => {
    real = b.dataset.r === "1";
    root.querySelectorAll(".fbtabs .tab").forEach((x) => x.classList.toggle("on", x === b));
    render(); ask();
  }));

  function render() {
    const d = data[real];
    if (!d) { listEl.innerHTML = `<div class="mempty">讀取中…</div>`; return; }
    if (!d.rows.length) { listEl.innerHTML = `<div class="mempty">${real ? "真代幣模式" : "練習模式"}還沒有人有劍。去鍛造一把吧！</div>`; return; }
    listEl.innerHTML = d.rows.map((r, i) => `
      <div class="fbrow${i < 3 ? " top" + (i + 1) : ""}">
        <span class="fbrank">${MEDAL[i] || i + 1}</span>
        <span class="fbsw">${(r.top || [r.tier]).map((t, j) => swordSvg(t, "fb" + i + "_" + j)).join("")}</span>
        <span class="fbinfo"><b>${esc(r.name)}</b><small>${(r.top || [r.tier]).join("・")} 階${r.swords > 3 ? `（共 ${r.swords} 把，只顯示最高 3 把）` : ""}</small></span>
        <span class="fbval"><small>最高階賣價</small>${money(r.sell)}</span>
      </div>`).join("") + `<div class="fbtotal">共 ${d.total} 人有劍</div>`;
  }
  function ask() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "fboard", real })); }
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ask(); clearInterval(timer); timer = setInterval(ask, 10000); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "fboard") { data[m.real] = m; if (m.real === real) render(); } };
    ws.onclose = () => { clearInterval(timer); if (!closed) setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }
  function destroy() { closed = true; clearInterval(timer); try { ws && ws.close(); } catch {} }
  render(); connect();
  return destroy;
}
