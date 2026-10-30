// 水墨卡冊：先展示 50 張卡（之後再接抽卡、收藏進度）。卡圖與資料在 gacha-art/、gacha-cards.json。
import CARDS from "./gacha-cards.json";

const ART = {};
for (const [p, url] of Object.entries(import.meta.glob("./gacha-art/*.jpg", { eager: true, query: "?url", import: "default" }))) ART[Number(p.split("/").pop().slice(0, -4))] = url;
const RAR = ["SSR", "SR", "R", "N"];
const RNAME = { SSR: "傳說", SR: "稀世", R: "珍品", N: "凡品" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountGachaCards(root, { back }) {
  let filter = "all", type = "all";
  const counts = Object.fromEntries(RAR.map((r) => [r, CARDS.filter((c) => c.rarity === r).length]));
  root.innerHTML = `
    <div class="game gcards">
      <header><button class="back">← 選單</button><h2>🎴 水墨卡冊</h2><span></span></header>
      <div class="gc-hint">共 ${CARDS.length} 張　${RAR.map((r) => `<b class="gc-r ${r}">${r}</b> ${counts[r]}`).join("　")}</div>
      <div class="gc-tabs gc-rar"></div>
      <div class="gc-tabs gc-typ"></div>
      <div class="gc-grid"></div>
    </div>`;
  const rarEl = root.querySelector(".gc-rar"), typEl = root.querySelector(".gc-typ"), grid = root.querySelector(".gc-grid");
  const types = [...new Set(CARDS.map((c) => c.type))];
  const tabs = (el, list, cur, key) => { el.innerHTML = list.map(([v, t]) => `<button class="tab${cur === v ? " on" : ""}" data-${key}="${v}">${t}</button>`).join(""); };
  function draw() {
    tabs(rarEl, [["all", "全部"], ...RAR.map((r) => [r, r])], filter, "r");
    tabs(typEl, [["all", "全部類別"], ...types.map((t) => [t, t])], type, "t");
    const list = CARDS.filter((c) => (filter === "all" || c.rarity === filter) && (type === "all" || c.type === type))
      .sort((a, b) => RAR.indexOf(a.rarity) - RAR.indexOf(b.rarity) || a.id - b.id);
    grid.innerHTML = list.length ? list.map((c) => `
      <button class="gc-card ${c.rarity}" data-id="${c.id}">
        <img src="${ART[c.id]}" alt="${esc(c.name)}" loading="lazy" draggable="false">
        <span class="gc-badge ${c.rarity}">${c.rarity}</span>
        <span class="gc-name">${esc(c.name)}</span>
      </button>`).join("") : `<div class="mempty">沒有符合的卡</div>`;
  }
  function detail(id) {
    const c = CARDS.find((x) => x.id === id); if (!c) return;
    const idx = CARDS.indexOf(c);
    const el = document.createElement("div");
    el.className = "gc-modal";
    el.innerHTML = `<div class="gc-big ${c.rarity}"><img src="${ART[c.id]}" alt="${esc(c.name)}" draggable="false">
      <div class="gc-info"><div class="gc-ttl"><b>${esc(c.name)}</b><span class="gc-badge ${c.rarity}">${c.rarity}・${RNAME[c.rarity]}</span></div>
      <div class="gc-meta">${esc(c.type)}　No.${String(c.id).padStart(2, "0")}</div><p>${esc(c.desc)}</p></div>
      <button class="gc-x" aria-label="關閉">✕</button></div>`;
    root.append(el);
    const close = () => el.remove();
    el.addEventListener("click", (e) => { if (e.target === el || e.target.closest(".gc-x")) close(); });
    return idx;
  }
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-r],[data-t]");
    if (t && t.closest(".gc-tabs")) { if (t.dataset.r !== undefined) filter = t.dataset.r; if (t.dataset.t !== undefined) type = t.dataset.t; draw(); return; }
    const c = e.target.closest(".gc-card"); if (c) detail(Number(c.dataset.id));
  });
  root.querySelector(".back").addEventListener("click", () => back());
  draw();
  return () => { root.innerHTML = ""; };
}
