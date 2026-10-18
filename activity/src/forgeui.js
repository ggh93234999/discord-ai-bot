// 鍛造（賭場遊戲）的畫面：100 階的劍（程式畫的 SVG，越高階越華麗）＋鍛造／賣劍操作。所有數字和亂數都在伺服器（forge.js / casino.js）。
const RANKS = ["木劍", "青銅劍", "鐵劍", "鋼劍", "銀劍", "黃金劍", "秘銀劍", "精金劍", "龍鋼劍", "神劍"];
const EPI = ["學徒", "尋常", "精良", "百煉", "名匠", "傳世", "無雙", "絕世", "神鑄", "至尊"];
// 每個材質一組顏色：[刀刃暗, 刀刃亮, 護手, 握把, 寶石/發光]
const PAL = [
  ["#8a5a2b", "#d9b383", "#5b3a1a", "#3b2a1a", "#c9a36b"],
  ["#8c5524", "#e0a35e", "#6e3f17", "#3d2a1a", "#ffb26b"],
  ["#4d5862", "#b5c0c9", "#39424a", "#262b30", "#9ad0ff"],
  ["#5d7186", "#dbe6f0", "#44586b", "#222a33", "#7fc4ff"],
  ["#8fa4b8", "#ffffff", "#6f86a0", "#2a3340", "#bfe9ff"],
  ["#b57e0d", "#fff0a8", "#8a5e08", "#4a2f10", "#ffd23d"],
  ["#2a86c9", "#c9f6ff", "#1c6aa5", "#12304a", "#5ef0ff"],
  ["#5b2fb0", "#e8d4ff", "#44228a", "#24123f", "#c77dff"],
  ["#a62318", "#ffc07a", "#7a160f", "#3a0f0c", "#ff6a3d"],
  ["#d8b04a", "#ffffff", "#c98f1c", "#5a3b0a", "#fff3b0"],
];
export const swordName = (t) => (t < 1 ? "還沒有劍" : `${EPI[(t - 1) % 10]}${RANKS[Math.floor((t - 1) / 10)]}`);
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const star = (x, y, r) => { x = +x; y = +y; r = +r; const f = (v) => v.toFixed(1), q = r * 0.28; return `M${f(x)},${f(y - r)} L${f(x + q)},${f(y - q)} L${f(x + r)},${f(y)} L${f(x + q)},${f(y + q)} L${f(x)},${f(y + r)} L${f(x - q)},${f(y + q)} L${f(x - r)},${f(y)} L${f(x - q)},${f(y - q)} Z`; };

// 畫第 t 階（1..100）的劍。uid 讓同一頁有多把劍時，漸層 id 不會打架。
export function swordSvg(t, uid = "s", opts = {}) {
  if (t < 1) return `<svg viewBox="0 0 220 380" class="fsw"><ellipse cx="110" cy="330" rx="70" ry="10" fill="#0006"/><text x="110" y="190" text-anchor="middle" font-size="16" fill="#778">空的鐵砧</text></svg>`;
  const rank = Math.floor((t - 1) / 10), sub = (t - 1) % 10, [dark, light, gd, grip, acc] = PAL[rank];
  const R = rng(t * 7919 + 13), id = (n) => `${uid}${n}`;
  const w = Math.min(19, 8 + rank * 0.85 + sub * 0.35), tip = 26 - Math.min(10, rank), top = tip + 24;
  const cx = 110, base = 250, glow = Math.min(7, 1 + t / 16);
  let defs = `<linearGradient id="${id("b")}" x1="0" x2="1"><stop offset="0" stop-color="${dark}"/><stop offset=".42" stop-color="${light}"/><stop offset=".58" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
    <linearGradient id="${id("g")}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${gd}"/></linearGradient>
    <radialGradient id="${id("a")}"><stop offset="0" stop-color="${acc}" stop-opacity=".55"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/></radialGradient>
    <filter id="${id("f")}" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="${glow}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  let s = "";
  // 光暈：材質越高、階數越高越亮
  const auraR = 60 + rank * 8 + sub * 2, auraO = Math.min(1, 0.1 + t / 110);
  if (t >= 12) s += `<circle cx="${cx}" cy="170" r="${auraR}" fill="url(#${id("a")})" opacity="${auraO}" class="fsw-pulse"/>`;
  if (rank >= 7) s += `<g class="fsw-spin" style="transform-origin:${cx}px 170px"><circle cx="${cx}" cy="170" r="${auraR - 8}" fill="none" stroke="${acc}" stroke-width="1.5" stroke-dasharray="${rank === 9 ? "3 7" : "10 10"}" opacity=".6"/>${rank >= 9 ? `<circle cx="${cx}" cy="170" r="${auraR + 6}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="2 12" opacity=".7"/>` : ""}</g>`;
  if (rank === 9) s += `<g class="fsw-spin2" style="transform-origin:${cx}px 170px">${[0, 1, 2, 3, 4, 5].map((k) => { const a = (k * Math.PI) / 3; return `<ellipse cx="${cx + Math.cos(a) * (auraR - 2)}" cy="${170 + Math.sin(a) * (auraR - 2)}" rx="9" ry="3" transform="rotate(${(a * 180) / Math.PI + 90} ${cx + Math.cos(a) * (auraR - 2)} ${170 + Math.sin(a) * (auraR - 2)})" fill="${["#ff6b6b", "#ffd36b", "#8ef58e", "#6bd6ff", "#b48cff", "#ff8ce0"][k]}" opacity=".8"/>`; }).join("")}</g>`;
  s += `<ellipse cx="${cx}" cy="338" rx="${48 + rank * 3}" ry="8" fill="#0007"/>`;
  // 火焰（龍鋼以上）
  if (rank >= 8) for (let k = 0; k < 6 + sub; k++) { const y = 70 + R() * 170, side = R() < 0.5 ? -1 : 1, x = cx + side * (w + 2 + R() * 6); s += `<path d="M${x},${y} q${side * 6},-10 0,-22 q${side * -2},10 ${side * -3},22 z" fill="${rank === 9 ? "#fff3b0" : "#ff7a3d"}" opacity=".8" class="fsw-flame" style="animation-delay:${(R() * 1.5).toFixed(2)}s"/>`; }
  // 刀身：高階帶弧度（葉形）
  const bulge = rank >= 5 ? 4 + (rank - 5) * 1.2 : 0;
  const blade = `M${cx},${tip} L${cx + w * 0.4},${top} Q${cx + w + bulge},${(top + base) / 2} ${cx + w},${base} L${cx - w},${base} Q${cx - w - bulge},${(top + base) / 2} ${cx - w * 0.4},${top} Z`;
  s += `<g filter="url(#${id("f")})"><path d="${blade}" fill="url(#${id("b")})" stroke="${dark}" stroke-width="1.2"/></g>`;
  s += `<path d="M${cx},${tip + 6} L${cx},${base - 4}" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>`;
  if (sub >= 3) s += `<path d="M${cx},${top + 6} L${cx},${base - 14}" stroke="${dark}" stroke-opacity=".55" stroke-width="${Math.min(6, 2 + sub * 0.4)}" stroke-linecap="round"/>`;
  if (sub >= 5) for (let k = 0; k < Math.min(5, sub - 3); k++) { const y = top + 30 + k * 30; s += `<path d="M${cx - 3},${y} l3,-5 l3,5 l-3,5 z" fill="${acc}" class="${rank >= 6 ? "fsw-pulse" : ""}" opacity=".9"/>`; }
  // 護手
  const gw = 34 + rank * 4;
  if (rank <= 2) s += `<rect x="${cx - gw / 2}" y="${base}" width="${gw}" height="9" rx="3" fill="url(#${id("g")})" stroke="${gd}"/>`;
  else if (rank <= 5) s += `<path d="M${cx - gw / 2},${base + 14} Q${cx - gw / 2 + 4},${base - 2} ${cx},${base} Q${cx + gw / 2 - 4},${base - 2} ${cx + gw / 2},${base + 14} Q${cx + gw / 4},${base + 8} ${cx},${base + 10} Q${cx - gw / 4},${base + 8} ${cx - gw / 2},${base + 14} Z" fill="url(#${id("g")})" stroke="${gd}"/>`;
  else {
    const n = rank - 4;                                  // 羽翼：越高階羽毛越多
    for (const sd of [-1, 1]) for (let k = 0; k < n; k++) s += `<path d="M${cx + sd * 6},${base + 6 - k * 3} Q${cx + sd * (22 + k * 10)},${base - 14 - k * 8} ${cx + sd * (28 + k * 12 + rank * 2)},${base - 6 - k * 9} Q${cx + sd * (24 + k * 9)},${base + 6 - k * 3} ${cx + sd * 6},${base + 12 - k * 3} Z" fill="${k % 2 ? light : acc}" stroke="${gd}" stroke-width=".8" opacity=".95"/>`;
    s += `<rect x="${cx - 10}" y="${base - 2}" width="20" height="14" rx="4" fill="url(#${id("g")})" stroke="${gd}"/>`;
  }
  s += `<circle cx="${cx}" cy="${base + 7}" r="${3 + Math.min(4, sub * 0.4)}" fill="${acc}" stroke="#fff" stroke-width=".8" class="fsw-pulse"/>`;
  // 握把＋劍首
  s += `<rect x="${cx - 5}" y="${base + 14}" width="10" height="58" rx="3" fill="${grip}"/>`;
  for (let y = base + 18; y < base + 70; y += 9) s += `<path d="M${cx - 5},${y} l10,5" stroke="${acc}" stroke-opacity=".55" stroke-width="1.4"/>`;
  s += `<circle cx="${cx}" cy="${base + 82}" r="${8 + Math.min(5, rank * 0.6)}" fill="url(#${id("g")})" stroke="${gd}"/><circle cx="${cx}" cy="${base + 82}" r="3.4" fill="${acc}"/>`;
  // 刀身上的寶石（子階越高越多）
  const gems = sub >= 7 ? 3 : sub >= 4 ? 2 : sub >= 2 ? 1 : 0;
  for (let k = 0; k < gems; k++) s += `<path d="M${cx},${base - 40 - k * 36} l5,6 l-5,6 l-5,-6 z" fill="${acc}" stroke="#fff" stroke-width=".8" class="fsw-pulse"/>`;
  // 閃光
  const sp = Math.floor(t / 7) + (t >= 90 ? 4 : 0);
  for (let k = 0; k < sp; k++) { const x = cx + (R() - 0.5) * (70 + rank * 8), y = 30 + R() * 280, r = 3 + R() * (3 + rank * 0.5); s += `<path d="${star(x.toFixed(1), y.toFixed(1), r.toFixed(1))}" fill="${R() < 0.5 ? "#fff" : acc}" class="fsw-twk" style="animation-delay:${(R() * 2).toFixed(2)}s;transform-origin:${x}px ${y}px"/>`; }
  // 神劍：頂上光環
  if (rank === 9) s += `<ellipse cx="${cx}" cy="${tip - 10}" rx="22" ry="6" fill="none" stroke="#fff3b0" stroke-width="2" class="fsw-pulse" filter="url(#${id("f")})"/>`;
  return `<svg viewBox="0 0 220 380" class="fsw${opts.cls ? " " + opts.cls : ""}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${s}</svg>`;
}

const money = (n) => Number(n).toLocaleString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function createForge({ stage, ctl, statusEl, send, getReal, setBal, pid }) {
  let st = null, busy = false, last = "";
  const $ = (s) => stage.querySelector(s);
  function refresh() { send({ t: "fget", real: getReal(), pid }); }

  function render(fx) {
    if (!st) { stage.innerHTML = `<div class="fg"><div class="fgmsg">讀取中…</div></div>`; ctl.innerHTML = ""; return; }
    const t = st.tier;
    stage.innerHTML = `<div class="fg${fx ? " " + fx : ""}">
      <div class="fgtop"><b>${t ? `第 ${t} 階` : "沒有劍"}</b><span>${esc(swordName(t))}</span><em>最高紀錄 ${st.best || 0} 階</em></div>
      <div class="fgsw">${swordSvg(t, "m")}</div>
      <div class="fgstats">
        <div><small>現在賣價</small><b>${t ? money(st.sell) : "—"}</b></div>
        <div><small>${t ? "下次鍛造費" : "打造費"}</small><b>${st.max <= t ? "—" : money(st.cost)}</b></div>
        <div><small>成功率</small><b>${st.max <= t ? "—" : (st.p * 100).toFixed(1).replace(/\.0$/, "") + "%"}</b></div>
        <div><small>成功後賣價</small><b>${st.max <= t ? "—" : money(st.nextSell)}</b></div>
      </div>
      <div class="fgmsg" id="fgmsg">${last}</div>
      <details class="fgbook"><summary>📖 劍譜（各材質的最高階）</summary><div class="fgbookg">${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((k) => `<div class="${t === k ? "cur" : ""}">${swordSvg(k, "k" + k)}<small>${k} 階<br>${esc(swordName(k))}</small></div>`).join("")}</div></details>
    </div>`;
    ctl.innerHTML = "";
    const mk = (label, cls, fn, dis) => { const b = document.createElement("button"); b.className = "spin " + cls; b.textContent = label; b.disabled = !!dis; b.addEventListener("click", fn); ctl.append(b); };
    const maxed = t >= st.max;
    mk(maxed ? "已經是最高階" : t ? `🔨 鍛造（${money(st.cost)}）` : `🔨 打造新劍（${money(st.cost)}）`, "", () => act("fforge"), busy || maxed);
    if (t) mk(`💰 賣掉（${money(st.sell)}）`, "alt", () => act("fsell"), busy);
  }
  function act(type) {
    if (busy) return;
    busy = true; statusEl.textContent = type === "fforge" ? "鍛造中…" : "…";
    const g = stage.querySelector(".fg"); if (g && type === "fforge") g.classList.add("hammer");
    send({ t: type, real: getReal(), pid });
  }
  function onState(m) {
    st = m; if (m.balance != null) setBal({ real: false, balance: m.balance });
    render();
  }
  function onRes(m) {
    st = m; busy = false;
    if (m.balance != null) setBal({ real: m.real, balance: m.balance });
    if (m.sold) { last = `<span class="ok">💰 賣掉 ${m.prev} 階的劍，拿到 ${money(m.got)}</span>`; statusEl.textContent = "賣出了"; render("sold"); return; }
    if (m.ok) {
      last = `<span class="ok">✨ 成功！升到 ${m.tier} 階「${esc(swordName(m.tier))}」（花了 ${money(m.paid)}）</span>`; statusEl.textContent = "成功了，要繼續賭嗎？";
      render("up");
    } else {
      last = `<span class="bad">💥 失敗，${m.prev ? `${m.prev} 階的劍碎了（損失賣價 ${money(m.lost)}）` : "原料報銷了"}（花了 ${money(m.paid)}）</span>`; statusEl.textContent = "劍碎了…";
      // 先顯示碎掉的舊劍，再回到空鐵砧
      stage.innerHTML = `<div class="fg broke"><div class="fgtop"><b>第 ${m.prev} 階</b><span>${esc(swordName(m.prev))}</span><em>最高紀錄 ${m.best || 0} 階</em></div>
        <div class="fgsw shatter"><div class="half l">${swordSvg(Math.max(1, m.prev), "bl")}</div><div class="half r">${swordSvg(Math.max(1, m.prev), "br")}</div></div>
        <div class="fgmsg">${last}</div></div>`;
      if (!m.prev) { render("fail"); return; }
      ctl.innerHTML = "";
      setTimeout(() => render("fail"), 1400);
    }
  }
  return { refresh, onState, onRes, render, busyReset() { busy = false; if (st) render(); } };
}
