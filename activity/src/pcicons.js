// 電腦零件圖示：AI 畫的水墨淡彩（pcicons/*.webp），墊一枚宣紙圓底，深色、淺色畫面都看得清楚。
// pcIcon(cat) 回傳 HTML 字串；PC_TXT 是純文字場合（複製清單）用的 emoji。
const URLS = {};
for (const [p, url] of Object.entries(import.meta.glob("./pcicons/*.webp", { eager: true, query: "?url", import: "default" }))) URLS[p.split("/").pop().slice(0, -5)] = url;
const NAME = { cpu: "處理器", mb: "主機板", gpu: "顯示卡", ram: "記憶體", ssd: "固態硬碟", psu: "電源供應器", case: "機殼", cooler: "散熱器" };
const ALIAS = { ssd2: "ssd", ssd3: "ssd", ssd4: "ssd" };
export function pcIcon(cat) {
  const k = ALIAS[cat] || cat; if (!URLS[k]) return "";
  return `<span class="pcico pcico-${k}"><img src="${URLS[k]}" alt="${NAME[k] || ""}" loading="lazy" decoding="async"></span>`;
}
export const PC_TXT = { cpu: "🧠", mb: "🔌", gpu: "🎮", ram: "💾", ssd: "💿", ssd2: "💿", ssd3: "💿", ssd4: "💿", psu: "⚡", case: "🗄️", cooler: "❄️" };
