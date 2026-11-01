// 名卡榜：全服玩家展示櫃（最愛的 3 張卡）排行，分真代幣模式和練習模式兩張榜。展示分 = 稀有度分 × 星數。
import CARDS from "./gacha-cards.json";
import { wsUrl } from "./gomoku.js";
import "@fontsource/lxgw-wenkai-tc/400.css";
import "@fontsource/lxgw-wenkai-tc/700.css";
import "./gachacards.css";

const ART = {};
for (const [pth, url] of Object.entries(import.meta.glob("./gacha-art/*.jpg", { eager: true, query: "?url", import: "default" }))) ART[Number(pth.split("/").pop().slice(0, -4))] = url;
const BYID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MEDAL = ["壹", "貳", "參"];

export function mountCardBoard(root, { env, back }) {
  let ws = null, closed = false, retry = 0, timer = 0, real = true, data = { true: null, false: null };
  root.innerHTML = `
    <div class="game slots gcards cboard">
      <header class="gc-head"><button class="back">← 選單</button><h2 class="gc-title">名卡榜<i></i></h2></header>
      <div class="gc-tabs gc-main"><button class="tab on" data-r="1">真代幣模式</button><button class="tab" data-r="0">練習模式</button></div>
      <div class="gc-hint">依每個人展示櫃裡 3 張卡的「展示分」排名（稀有度分 × 星數：N 1、R 3、SR 12、SSR 40），換卡或升星會即時更新。</div>
      <div class="gc-blist"></div>
    </div>`;
  const listEl = root.querySelector(".gc-blist");
  root.querySelector(".back").addEventListener("click", () => { destroy(); back(); });
  root.querySelectorAll(".gc-main .tab").forEach((b) => b.addEventListener("click", () => {
    real = b.dataset.r === "1";
    root.querySelectorAll(".gc-main .tab").forEach((x) => x.classList.toggle("on", x === b));
    render(); ask();
  }));
  function render() {
    const d = data[real];
    if (!d) { listEl.innerHTML = `<div class="mempty">讀取中…</div>`; return; }
    if (!d.rows.length) { listEl.innerHTML = `<div class="mempty">${real ? "真代幣模式" : "練習模式"}還沒有人擺展示櫃。到「水墨卡冊」的「展示」分頁挑 3 張卡吧！</div>`; return; }
    listEl.innerHTML = d.rows.map((r, i) => `
      <div class="gc-brow${i < 3 ? " top" + (i + 1) : ""}">
        <span class="gc-brank">${MEDAL[i] || i + 1}</span>
        <span class="gc-bcards">${r.cards.map((c) => `<span class="gc-sh on ${c.rarity}"><img src="${ART[c.id]}" alt="${esc(BYID[c.id].name)}" loading="lazy" draggable="false"><span class="gc-badge ${c.rarity}">${c.rarity}</span><span class="gc-star">${"★".repeat(c.star)}</span></span>`).join("")}</span>
        <span class="gc-binfo"><b>${esc(r.name)}</b><small>${r.cards.map((c) => esc(BYID[c.id].name)).join("・")}</small><small>收藏 ${r.owned} / ${CARDS.length}</small></span>
        <span class="gc-bval"><small>展示分</small>${r.score}</span>
      </div>`).join("") + `<div class="gc-btotal">共 ${d.total} 人有展示櫃</div>`;
  }
  function ask() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "gboard", real })); }
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ask(); clearInterval(timer); timer = setInterval(ask, 10000); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "gboard") { data[m.real] = m; if (m.real === real) render(); } };
    ws.onclose = () => { clearInterval(timer); if (!closed) setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }
  function destroy() { closed = true; clearInterval(timer); try { ws && ws.close(); } catch {} }
  render(); connect();
  return destroy;
}
