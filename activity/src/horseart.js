// 賽馬的 AI 圖：每匹名馬一張 8 格奔跑動作（每格 220×168，已依上半身對齊）。沒有圖的馬退回程式畫的向量馬。
const U = {};
for (const [pth, url] of Object.entries(import.meta.glob("./horse-art/*.png", { eager: true, query: "?url", import: "default" }))) U[pth.split("/").pop().slice(0, -4)] = url;
const KEY = { 赤兔: "chitu", 烏騅: "wuzhui", 的盧: "dilu", 絕影: "jueying", 爪黃飛電: "zhuahuang", 踏雪: "taxue", 照夜玉獅子: "yushizi", 追風: "zhuifeng", 驊騮: "hualiu", 飛黃: "feihuang" };
export const FW = 220, FH = 168, FRAMES = 8;
const IMG = {};
export function horseSheet(name) {
  const k = KEY[name]; if (!k || !U[k]) return null;
  let e = IMG[k]; if (!e) { e = IMG[k] = new Image(); e.src = U[k]; }
  return e.complete && e.naturalWidth ? e : null;
}
