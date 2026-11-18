// 零件商品圖：圖由伺服器 /api/pc/img?id= 代抓（欣亞、原價屋都有），這裡負責縮圖、失敗退路、點一下放大。
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ids：優先用第一個，圖載不到就換下一個，都沒有就把圖拿掉
export function pim(url, ids, name = "", cls = "") {
  const l = ids.filter(Boolean);
  if (!l.length) return "";
  return `<img class="pim ${cls}" loading="lazy" alt="${esc(name)}" src="${url("api/pc/img?id=" + encodeURIComponent(l[0]))}" data-alt="${esc(l.slice(1).join(","))}" data-name="${esc(name)}">`;
}

// 在整個畫面根節點掛一次：圖載入失敗的退路、點縮圖放大（放大時不會觸發底下那列的點擊）
export function wirePim(host, url) {
  host.addEventListener("error", (e) => {
    const im = e.target;
    if (!(im instanceof HTMLImageElement) || !im.classList.contains("pim")) return;
    const rest = (im.dataset.alt || "").split(",").filter(Boolean);
    if (rest.length) { im.dataset.alt = rest.slice(1).join(","); im.src = url("api/pc/img?id=" + encodeURIComponent(rest[0])); }
    else im.remove();
  }, true);
  host.addEventListener("click", (e) => {
    const im = e.target instanceof Element && e.target.closest("img.pim");
    if (!im) return;
    e.stopPropagation(); e.preventDefault();
    const z = document.createElement("div");
    z.className = "pim-zoom";
    z.innerHTML = `<img src="${im.src}" alt=""><span>${esc(im.dataset.name || "")}</span><button aria-label="關閉">✕</button>`;
    z.addEventListener("click", () => z.remove());
    (host.querySelector(".pcb") || host).appendChild(z);
  }, true);
}
