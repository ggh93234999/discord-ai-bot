// 賽馬下注頁的「馬匹介紹卡」：四種版型（A 出馬表／B 戰鬥卡／C 儀表板／D 收藏卡），上面有切換鈕，選定後可以只留一種。
// 每張卡都是 button.hcard[data-i]，點了選馬；顯示的都是公開資訊：能力、歷史戰績、近 5 場、今天狀態、賠率。
export const VARIANTS = [["A", "出馬表"], ["B", "戰鬥卡"], ["C", "儀表板"], ["D", "收藏卡"]];
const SILK = ["#e53935", "#1e88e5", "#fdd835", "#43a047", "#8e24aa", "#fb8c00"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (v) => Math.max(0.06, Math.min(1, (v - 40) / 56));
const pct = (f) => (f.races ? Math.floor((f.wins * 100) / f.races) : 0);
const chips = (last) => (last && last.length ? last.map((p) => `<i class="pl p${p <= 3 ? p : 0}">${p}</i>`).join("") : `<span class="none">—</span>`);
const formTone = (f) => (f.includes("絕佳") ? "hot" : f.includes("良好") ? "up" : f.includes("普通") ? "mid" : f.includes("欠佳") ? "down" : "cold");
const formArrow = (f) => ({ hot: "▲▲", up: "▲", mid: "▬", down: "▼", cold: "▼▼" }[formTone(f)]);

function stat(label, v, kind) {
  if (kind === "led") { const n = Math.max(0, Math.min(10, Math.round((v - 40) / 5.6))); return `<div class="st"><span>${label}</span><div class="led">${Array.from({ length: 10 }, (_, k) => `<u class="${k < n ? "on" : ""}"></u>`).join("")}</div><em>${v}</em></div>`; }
  return `<div class="st"><span>${label}</span><div class="bar"><u style="width:${Math.round(norm(v) * 100)}%"></u></div><em>${v}</em></div>`;
}
function radar(f, col) {
  const cx = 34, cy = 36, R = 27, ang = [-90, 30, 150].map((a) => (a * Math.PI) / 180), vals = [f.spd, f.sta, f.bst].map(norm);
  const pt = (k, r) => `${(cx + Math.cos(ang[k]) * R * r).toFixed(1)},${(cy + Math.sin(ang[k]) * R * r).toFixed(1)}`;
  const ring = (r) => `<polygon points="${[0, 1, 2].map((k) => pt(k, r)).join(" ")}" fill="none" stroke="rgba(255,255,255,.18)"/>`;
  return `<svg viewBox="0 0 68 68" class="radar">${ring(1)}${ring(0.5)}<polygon points="${[0, 1, 2].map((k) => pt(k, vals[k])).join(" ")}" fill="${col}55" stroke="${col}" stroke-width="1.6"/>
    <text x="34" y="7" text-anchor="middle">速</text><text x="62" y="52" text-anchor="middle">耐</text><text x="6" y="52" text-anchor="middle">爆</text></svg>`;
}
function spark(last) {
  if (!last || !last.length) return `<span class="none">—</span>`;
  const w = 70, h = 26, n = last.length, xs = (k) => (n === 1 ? w / 2 : 4 + (k * (w - 8)) / (n - 1)), ys = (p) => 3 + ((p - 1) / 5) * (h - 6);
  return `<svg viewBox="0 0 ${w} ${h}" class="spark"><polyline points="${last.map((p, k) => `${xs(k).toFixed(1)},${ys(p).toFixed(1)}`).join(" ")}" fill="none" stroke="#7cf" stroke-width="1.6"/>${last.map((p, k) => `<circle cx="${xs(k).toFixed(1)}" cy="${ys(p).toFixed(1)}" r="2.2" fill="${p === 1 ? "#ffd54f" : "#7cf"}"/>`).join("")}</svg>`;
}
const rarity = (f) => { const p = pct(f); return p >= 22 ? ["傳說", "legend"] : p >= 15 ? ["稀有", "rare"] : p >= 10 ? ["優秀", "good"] : ["普通", "common"]; };

function cardA(i, f, o) {
  return `<button class="hcard va ${o.cls}" data-i="${i}" style="--s:${SILK[i % 6]}">
    <div class="no">${i + 1}</div>
    <div class="body">
      <div class="top"><b class="nm">${esc(o.name)}</b><span class="tag">${esc(f.style || "")}</span><span class="form ${formTone(o.form)}">${o.form}</span>${o.per ? `<span class="ppl">👥${o.per}</span>` : ""}</div>
      <div class="bl">${esc(f.blurb || "")}</div>
      <div class="sts">${stat("速度", f.spd)}${stat("耐力", f.sta)}${stat("爆發", f.bst)}</div>
      <div class="rec"><span>${f.races ? `${f.races} 戰 ${f.wins} 勝（${pct(f)}%）` : "新馬"}</span><span class="last">近五場 ${chips(f.last)}</span></div>
    </div>
    <div class="odds"><small>賠率</small><b>${o.odds}</b></div></button>`;
}
function cardB(i, f, o) {
  const col = SILK[i % 6];
  return `<button class="hcard vb ${o.cls}" data-i="${i}" style="--c:${col}">
    <div class="vbhead"><span class="no">${i + 1}</span><b class="nm">${esc(o.name)}</b><span class="tag">${esc(f.style || "")}</span><span class="oddsb">×${o.odds}</span></div>
    <div class="vbmid">${radar(f, col)}<div class="info"><div class="vbf ${formTone(o.form)}">${o.form}${o.per ? `　👥${o.per}` : ""}</div>
      <div class="bl">${esc(f.blurb || "")}</div>
      <div class="vbn"><span>速 <b>${f.spd}</b></span><span>耐 <b>${f.sta}</b></span><span>爆 <b>${f.bst}</b></span></div></div></div>
    <div class="vbfoot"><span>${f.races ? `${f.wins} 勝 / ${f.races} 戰（${pct(f)}%）` : "新馬"}</span><span class="last">${chips(f.last)}</span></div></button>`;
}
function cardC(i, f, o) {
  return `<button class="hcard vc ${o.cls}" data-i="${i}" style="--s:${SILK[i % 6]};--coat:${f.coat || "#999"}">
    <div class="vcrow"><span class="no">${i + 1}</span>
      <div class="id"><b class="nm">${esc(o.name)}</b><span class="tag">${esc(f.style || "")}</span></div>
      <div class="trend ${formTone(o.form)}"><span>${formArrow(o.form)}</span><small>${o.form.replace(/^\S+\s/, "")}</small></div>
      <div class="spk">${spark(f.last)}<small>近${(f.last || []).length}場</small></div>
      <div class="odds"><small>ODDS</small><b>${o.odds}</b></div></div>
    <div class="vcmore"><div class="sts">${stat("SPD", f.spd, "led")}${stat("STA", f.sta, "led")}${stat("BST", f.bst, "led")}</div>
      <div class="bl">${esc(f.blurb || "")}</div><div class="rec">${f.races ? `${f.races} 戰 ${f.wins} 勝（${pct(f)}%）` : "新馬，還沒有戰績"}${o.per ? `　👥${o.per}` : ""}</div></div></button>`;
}
function cardD(i, f, o) {
  const [rl, rc] = rarity(f);
  return `<button class="hcard vd r-${rc} ${o.cls}" data-i="${i}" style="--c:${f.coat || "#888"};--s:${SILK[i % 6]}">
    <div class="art"><span class="no">${i + 1}</span><span class="rar">${rl}</span><span class="horse">🐎</span><span class="sty">${esc(f.style || "")}</span></div>
    <div class="nm">${esc(o.name)}</div>
    <div class="vds"><span>⚡${f.spd}</span><span>🫁${f.sta}</span><span>💥${f.bst}</span></div>
    <div class="bl">${esc(f.blurb || "")}</div>
    <div class="vdr">${f.races ? `${f.wins}/${f.races} 勝（${pct(f)}%）` : "新馬"}<span class="last">${chips(f.last)}</span></div>
    <div class="vdf"><span class="${formTone(o.form)}">${o.form}</span><span class="rib">×${o.odds}${o.per ? `　👥${o.per}` : ""}</span></div></button>`;
}
const MAKE = { A: cardA, B: cardB, C: cardC, D: cardD };

export function horseCards(v, hs, { sel, mine, per }) {
  const make = MAKE[v] || cardA;
  return `<div class="hcards hv-${v}">${hs.names.map((n, i) => make(i, (hs.info && hs.info[i]) || {}, {
    name: n, form: hs.forms[i], odds: hs.odds[i], per: per[i],
    cls: `${sel === i ? "sel" : ""} ${mine && mine.idx === i ? "mine" : ""}`,
  })).join("")}</div>`;
}
