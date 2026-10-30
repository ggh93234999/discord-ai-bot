// 水墨卡冊：先展示 50 張卡（之後再接抽卡、收藏進度）。卡圖與資料在 gacha-art/、gacha-cards.json。
import CARDS from "./gacha-cards.json";

const ART = {};
for (const [p, url] of Object.entries(import.meta.glob("./gacha-art/*.jpg", { eager: true, query: "?url", import: "default" }))) ART[Number(p.split("/").pop().slice(0, -4))] = url;
const RAR = ["SSR", "SR", "R", "N"];
const RNAME = { SSR: "傳說", SR: "稀世", R: "珍品", N: "凡品" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountGachaCards(root, { back }) {
  let filter = "all", type = "all", set = "all";
  const inSet = (c) => set === "all" || c.set === set;
  const counts = () => Object.fromEntries(RAR.map((r) => [r, CARDS.filter((c) => inSet(c) && c.rarity === r).length]));
  root.innerHTML = `
    <div class="game gcards">
      <header><button class="back">← 選單</button><h2>🎴 水墨卡冊</h2><span></span></header>
      <div class="gc-hint"></div>
      <div class="gc-tabs gc-set"></div>
      <div class="gc-tabs gc-rar"></div>
      <div class="gc-tabs gc-typ"></div>
      <div class="gc-grid"></div>
    </div>`;
  const hintEl = root.querySelector(".gc-hint"), setEl = root.querySelector(".gc-set"), rarEl = root.querySelector(".gc-rar"), typEl = root.querySelector(".gc-typ"), grid = root.querySelector(".gc-grid");
  const tabs = (el, list, cur, key) => { el.innerHTML = list.map(([v, t]) => `<button class="tab${cur === v ? " on" : ""}" data-${key}="${v}">${t}</button>`).join(""); };
  function draw() {
    const types = [...new Set(CARDS.filter(inSet).map((c) => c.type))];
    if (type !== "all" && !types.includes(type)) type = "all";
    const n = counts(), total = CARDS.filter(inSet).length;
    hintEl.innerHTML = `共 ${total} 張　${RAR.map((r) => `<b class="gc-r ${r}">${r}</b> ${n[r]}`).join("　")}`;
    tabs(setEl, [["all", "全部"], ["east", "東方"], ["west", "西方"]], set, "s");
    tabs(rarEl, [["all", "全部"], ...RAR.map((r) => [r, r])], filter, "r");
    tabs(typEl, [["all", "全部類別"], ...types.map((t) => [t, t])], type, "t");
    const list = CARDS.filter((c) => inSet(c) && (filter === "all" || c.rarity === filter) && (type === "all" || c.type === type))
      .sort((a, b) => RAR.indexOf(a.rarity) - RAR.indexOf(b.rarity) || a.id - b.id);
    curList = list;
    grid.innerHTML = list.length ? list.map((c) => `
      <button class="gc-card ${c.rarity}" data-id="${c.id}">
        <img src="${ART[c.id]}" alt="${esc(c.name)}" loading="lazy" draggable="false">
        <span class="gc-badge ${c.rarity}">${c.rarity}</span>
        <span class="gc-name">${esc(c.name)}</span>
      </button>`).join("") : `<div class="mempty">沒有符合的卡</div>`;
  }
  let curList = [];
  function detail(id) {                                         // 點開一張卡：可以用 ◀ ▶（或鍵盤左右鍵、左右滑動）切到目前篩選清單裡的上一張／下一張
    let pos = curList.findIndex((x) => x.id === id); if (pos < 0) return;
    const el = document.createElement("div");
    el.className = "gc-modal";
    const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
    const show = () => {
      const c = curList[pos];
      el.innerHTML = `<button class="gc-nav gc-prev" aria-label="上一張"${curList.length < 2 ? " hidden" : ""}>◀</button>
        <div class="gc-big ${c.rarity}"><img src="${ART[c.id]}" alt="${esc(c.name)}" draggable="false">
        <div class="gc-info"><div class="gc-ttl"><b>${esc(c.name)}</b><span class="gc-badge ${c.rarity}">${c.rarity}・${RNAME[c.rarity]}</span></div>
        <div class="gc-meta">${esc(c.type)}　No.${String(c.id).padStart(2, "0")}　${pos + 1} / ${curList.length}</div><p>${esc(c.desc)}</p></div>
        <button class="gc-x" aria-label="關閉">✕</button></div>
        <button class="gc-nav gc-next" aria-label="下一張"${curList.length < 2 ? " hidden" : ""}>▶</button>`;
    };
    const go = (d) => { pos = (pos + d + curList.length) % curList.length; show(); };
    const onKey = (e) => { if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    show(); root.append(el);
    let x0 = null;
    el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); });
    el.addEventListener("click", (e) => {
      if (e.target.closest(".gc-prev")) go(-1); else if (e.target.closest(".gc-next")) go(1);
      else if (e.target === el || e.target.closest(".gc-x")) close();
    });
  }
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-r],[data-t],[data-s]");
    if (t && t.closest(".gc-tabs")) { if (t.dataset.r !== undefined) filter = t.dataset.r; if (t.dataset.t !== undefined) type = t.dataset.t; if (t.dataset.s !== undefined) set = t.dataset.s; draw(); return; }
    const c = e.target.closest(".gc-card"); if (c) detail(Number(c.dataset.id));
  });
  root.querySelector(".back").addEventListener("click", () => back());
  draw();
  return () => { root.innerHTML = ""; };
}
