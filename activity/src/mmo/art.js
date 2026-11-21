// 水墨江湖：AI 生成的水墨素材（art/*.webp，已去背）。缺圖時呼叫端會退回程式畫的版本。
const URLS = {};
for (const [p, url] of Object.entries(import.meta.glob("./art/*.webp", { eager: true, query: "?url", import: "default" }))) URLS[p.split("/").pop().slice(0, -5)] = url;
const imgs = {}, tints = {};
export const artLoad = (name) => { art(name); return imgs[name] || null; };     // 拿到圖片物件（還沒載好也給，可以等 load）
export function art(name) {
  if (!URLS[name]) return null;
  let im = imgs[name];
  if (!im) { im = imgs[name] = new Image(); im.decoding = "async"; im.src = URLS[name]; }
  return im.complete && im.naturalWidth ? im : null;
}
export const artUrl = (name) => URLS[name] || "";
export function preloadArt() { for (const n of Object.keys(URLS)) art(n); }
// 受傷時閃紅：第一次用到時做一張染紅的版本，之後重複用
function tinted(name, im) {
  let c = tints[name];
  if (!c) {
    c = tints[name] = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0); g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(181,52,42,.6)"; g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}
// 場景素材調成跟地面同一個色調：稍微降飽和、蓋一層宣紙色，底部再慢慢淡掉，像從地面長出來而不是貼上去
const toneCache = {};
const TONE = { b: { sat: 0.82, wash: "rgba(206,186,148,.20)", fade: 0.13, fadeA: 0.9 }, d: { sat: 0.88, wash: "rgba(206,186,148,.12)", fade: 0.08, fadeA: 0.75 } };
function toned(name, im, kind) {
  const key = name + kind; let c = toneCache[key];
  if (!c) {
    const T = TONE[kind]; c = toneCache[key] = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d");
    try { g.filter = `saturate(${T.sat})`; } catch {}
    g.drawImage(im, 0, 0); g.filter = "none";
    g.globalCompositeOperation = "source-atop"; g.fillStyle = T.wash; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "destination-out";
    const fh = c.height * T.fade, gr = g.createLinearGradient(0, c.height - fh, 0, c.height);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, `rgba(0,0,0,${T.fadeA})`);
    g.fillStyle = gr; g.fillRect(0, c.height - fh, c.width, fh);
  }
  return c;
}
// 畫一張素材：腳底在 (x, y)，大小塞進 maxW × maxH（像素），face=-1 左右翻轉
export function drawArt(g, name, x, y, maxW, maxH, o = {}) {
  const im = art(name); if (!im) return null;
  const k = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
  g.save(); g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  g.scale((o.face || 1) * (o.sx || 1), o.sy || 1);
  if (o.alpha != null) g.globalAlpha *= o.alpha;
  g.drawImage(o.hurt ? tinted(name, im) : o.tone ? toned(name, im, o.tone) : im, -w / 2, -h, w, h);
  g.restore();
  return { w, h };
}
export const MOB_ART = {
  rat: ["m_rat", 1.1, 0.75], hare: ["m_hare", 1.0, 1.05], snake: ["m_snake", 1.3, 0.85], monkey: ["m_monkey", 1.3, 1.35], wolf: ["m_wolf", 1.7, 1.15],
  golem: ["m_golem", 1.6, 1.7], bird: ["m_bird", 1.6, 1.1], bandit: ["m_bandit", 1.5, 1.9], zombie: ["m_zombie", 1.4, 1.9], wisp: ["m_wisp", 1.2, 1.3],
  terra: ["m_terra", 1.4, 1.95], scorp: ["m_scorp", 1.6, 1.0], bamboo: ["b_bamboo", 3.4, 4.4], tiger: ["b_tiger", 4.2, 3.0], corpse: ["b_corpse", 3.0, 4.2],
  snowfox: ["m_snowfox", 1.5, 1.1], yeti: ["m_yeti", 1.8, 2.0], iceghost: ["m_iceghost", 1.3, 1.8], assassin: ["m_assassin", 1.5, 1.7],
  salamander: ["m_salamander", 1.7, 0.9], firecrow: ["m_firecrow", 1.5, 1.2], lavagolem: ["m_lavagolem", 2.0, 2.2], fireimp: ["m_fireimp", 1.2, 1.5],
  cultist: ["m_cultist", 1.4, 1.9], bat: ["m_bat", 1.6, 1.1], shadow: ["m_shadow", 1.5, 1.9], general: ["m_general", 1.8, 2.3], foxspirit: ["m_foxspirit", 1.4, 1.9],
  snow: ["b_snow", 3.6, 4.4], qilin: ["b_qilin", 4.4, 3.4], lord: ["b_lord", 3.0, 4.4], fox: ["b_fox", 4.6, 3.6],
};
export const FLOAT = { bird: 0.55, wisp: 0.45, iceghost: 0.4, firecrow: 0.55, bat: 0.55 };
export const NPC_ART = { smith: "n_smith", herb: "n_herb", bank: "n_bank", guide: "n_guide", post: "n_post", stone: "e_stone", tower: "n_tower", arena: "n_arena", store: "n_store", bounty: "n_bounty", inn: "n_inn", temple: "n_temple", casino: "n_casino", rank: "d_stele" };
export const SKILL_ART = Object.fromEntries("sweep thrust guard qi cleave whirl roar leap fire ice heal thunder dragon seal shield inferno triple pierce gale rain spread swallow poison net yujian guanghan wanjian zhanyue mingwang bawang zhenyao taiji wulei sanmei fenghuang huohai chuanyun yingyan liuxing lianhuan yingbu duwu".split(" ").map((k) => [k, "s_" + k]));
export function itemArt(it) {
  if (!it) return "";
  if (it.p) return it.p.startsWith("hp") ? "i_hp" : it.p.startsWith("mp") ? "i_mp" : it.p === "tp" ? "i_tp" : "i_" + it.p;
  if (it.s === "weapon") return it.c === "mage" ? "i_staff" : it.c === "archer" ? "i_bow" : "i_sword";
  return it.s === "armor" ? "i_armor" : "i_acc";
}
// 等素材都載好（最多等 ms 毫秒），避免一進場景樹石還是空的
export function artReady(ms = 5000) {
  for (const n of Object.keys(URLS)) if (n.startsWith("a_")) art(n);      // 動畫圖背景下載，不用等（下載好之前先用靜態圖）
  const all = Object.keys(URLS).filter((n) => !n.startsWith("a_")).map((n) => new Promise((res) => { art(n); const im = imgs[n]; if (im.complete) return res(); im.onload = im.onerror = () => res(); }));
  return Promise.race([Promise.all(all), new Promise((r) => setTimeout(r, ms))]);
}
export const hasArt = (n) => !!URLS[n];
// ---- 影格動畫（a_*.webp：橫向拼好的 sprite sheet；anim.json 記每張幾格、多大、幾 fps、播放方式）
import MAN from "./art/anim.json";
export const hasAnim = (n) => !!(MAN[n] && URLS[n]);
export const animMs = (n) => (MAN[n] ? (MAN[n].f / MAN[n].fps) * 1000 : 0);
export function drawAnim(g, name, x, y, maxW, maxH, o = {}) {
  const m = MAN[name], im = m && art(name); if (!im) return null;
  const fr = Math.max(0, Math.floor(((o.t || 0) * m.fps) / 1000));
  let i;
  if (m.mode === "ping") { const p = 2 * m.f - 2, k = fr % p; i = k < m.f ? k : p - k; }
  else if (m.mode === "loop") i = fr % m.f;
  else i = Math.min(m.f - 1, fr);
  // 有 ref（同一隻的靜態圖）就用靜態圖的縮放比例，動畫和靜態圖一樣大；動作比較大的影格會超出框，這是對的
  const ref = o.ref && art(o.ref);
  const k = ref ? Math.min(maxW / ref.naturalWidth, maxH / ref.naturalHeight) : Math.min(maxW / m.w, maxH / m.h), w = m.w * k, h = m.h * k;
  g.save(); g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  g.scale((o.face || 1) * (o.sx || 1), o.sy || 1);
  if (o.alpha != null) g.globalAlpha *= o.alpha;
  g.drawImage(o.hurt ? tinted(name, im) : im, i * m.w, 0, m.w, m.h, -w / 2, -h, w, h);
  g.restore();
  return { w, h };
}
