// 阿瓦隆角色肖像（AI 繪製）。依角色名稱找圖，找不到就不顯示。
const U = {};
for (const [p, url] of Object.entries(import.meta.glob("./av-art/*.png", { eager: true, query: "?url", import: "default" }))) U[p.split("/").pop().slice(0, -4)] = url;
export function roleArt(name) {
  const n = String(name || "");
  const k = n.includes("爪牙") ? "minion" : n.includes("莫德雷德") ? "mordred" : n.includes("莫甘娜") ? "morgana" : n.includes("奧伯倫") ? "oberon" : n.includes("刺客") ? "assassin" : n.includes("梅林") ? "merlin" : n.includes("派西") ? "percival" : n.includes("忠臣") ? "loyal" : "";
  return U[k] || "";
}
