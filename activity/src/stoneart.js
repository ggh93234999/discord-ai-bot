// 賭石的 AI 圖：p0–p8 = 結算時的成品（0 沒有翡翠，1–8 豆種到帝王綠），dealer = 收購商。切面／外皮材質在 stone3d.js 載入。
const U = {};
for (const [pth, url] of Object.entries(import.meta.glob("./stone-art/{p[0-8],dealer}.png", { eager: true, query: "?url", import: "default" }))) U[pth.split("/").pop().slice(0, -4)] = url;
export const prodUrl = (q) => U["p" + (q >= 1 && q <= 8 ? q : 0)] || "";
export const dealerUrl = () => U.dealer || "";
