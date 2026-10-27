// 選單圖示（AI 繪製）：檔名 = 遊戲 id；分類用 c_ 開頭。沒有圖就退回 emoji。
const U = {};
for (const [pth, url] of Object.entries(import.meta.glob("./icon-art/*.png", { eager: true, query: "?url", import: "default" }))) U[pth.split("/").pop().slice(0, -4)] = url;
export const iconHtml = (key, fallback, alt = "") => (U[key] ? `<img class="aico" src="${U[key]}" alt="${alt}" draggable="false">` : fallback);
