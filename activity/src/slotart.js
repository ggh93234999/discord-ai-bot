// 老虎機符號圖（AI 繪製）；沒有對應圖就退回 emoji 文字
const U = {};
for (const [p, url] of Object.entries(import.meta.glob("./slot-art/*.png", { eager: true, query: "?url", import: "default" }))) U[p.split("/").pop().slice(0, -4)] = url;
const MAP = { "🍒": "cherry", "🍋": "lemon", "🔔": "bell", "💎": "diamond" };
export const symUrl = (s) => U[MAP[s]] || "";
