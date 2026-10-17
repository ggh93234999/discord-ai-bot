// 賽馬下注頁的馬匹介紹卡（戰鬥卡）：每張是 button.hcard[data-i]，點了選馬；只顯示公開資訊：能力、歷史戰績、近 5 場、今天狀態、倍率。
const SILK = ["#e53935", "#1e88e5", "#fdd835", "#43a047", "#8e24aa", "#fb8c00"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (v) => Math.max(0.06, Math.min(1, (v - 40) / 56));
const pct = (f) => (f.races ? Math.floor((f.wins * 100) / f.races) : 0);
const chips = (last) => (last && last.length ? last.map((p) => `<i class="pl p${p <= 3 ? p : 0}">${p}</i>`).join("") : `<span class="none">—</span>`);
const formTone = (f) => (f.includes("絕佳") ? "hot" : f.includes("良好") ? "up" : f.includes("普通") ? "mid" : f.includes("欠佳") ? "down" : "cold");

function radar(f, col) {
  const cx = 34, cy = 36, R = 27, ang = [-90, 30, 150].map((a) => (a * Math.PI) / 180), vals = [f.spd, f.sta, f.bst].map(norm);
  const pt = (k, r) => `${(cx + Math.cos(ang[k]) * R * r).toFixed(1)},${(cy + Math.sin(ang[k]) * R * r).toFixed(1)}`;
  const ring = (r) => `<polygon points="${[0, 1, 2].map((k) => pt(k, r)).join(" ")}" fill="none" stroke="rgba(255,255,255,.18)"/>`;
  return `<svg viewBox="0 0 68 68" class="radar">${ring(1)}${ring(0.5)}<polygon points="${[0, 1, 2].map((k) => pt(k, vals[k])).join(" ")}" fill="${col}55" stroke="${col}" stroke-width="1.6"/>
    <text x="34" y="7" text-anchor="middle">速</text><text x="62" y="52" text-anchor="middle">耐</text><text x="6" y="52" text-anchor="middle">爆</text></svg>`;
}

function card(i, f, o) {
  const col = SILK[i % 6];
  return `<button class="hcard vb ${o.cls}" data-i="${i}" style="--c:${col}">
    <div class="vbhead"><span class="no">${i + 1}</span><b class="nm">${esc(o.name)}</b><span class="tag">${esc(f.style || "")}</span><span class="oddsb"><small>倍率</small> ×${o.odds}</span></div>
    <div class="vbmid">${radar(f, col)}<div class="info"><div class="vbf ${formTone(o.form)}">${o.form}${o.per ? `　👥${o.per}` : ""}</div>
      <div class="bl">${esc(f.blurb || "")}</div>
      <div class="vbn"><span>速 <b>${f.spd}</b></span><span>耐 <b>${f.sta}</b></span><span>爆 <b>${f.bst}</b></span></div></div></div>
    <div class="vbfoot"><span>${f.races ? `${f.wins} 勝 / ${f.races} 戰（${pct(f)}%）` : "新馬"}</span><span class="last">${chips(f.last)}</span></div></button>`;
}

export function horseCards(hs, { sel, mine, per }) {
  return `<div class="hcards">${hs.names.map((n, i) => card(i, (hs.info && hs.info[i]) || {}, {
    name: n, form: hs.forms[i], odds: hs.odds[i], per: per[i],
    cls: `${sel === i ? "sel" : ""} ${mine && mine.idx === i ? "mine" : ""}`,
  })).join("")}</div>`;
}
