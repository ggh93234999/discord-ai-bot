// 賭場贏輸演出：贏錢噴金幣、大獎全螢幕動畫、落敗時畫面一沉。
// 做法：監聽賭場畫面裡的 .cresult（結算那一行），不用每個遊戲各自接線；老虎機另外直接呼叫 celebrate()。
import { sfx } from "./sfx.js";

let layer = null, cv = null, cx = null, parts = [], raf = 0, bigEl = null;
function ensureLayer() {
  if (layer) return;
  layer = document.createElement("div"); layer.className = "fxlayer";
  cv = document.createElement("canvas"); layer.append(cv); document.body.append(layer);
  cx = cv.getContext("2d");
}
function fit() {
  const d = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.width = w + "px"; cv.style.height = h + "px"; cx.setTransform(d, 0, 0, d, 0, 0);
}
function loop(last) {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  cx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of parts) {
    p.life -= dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.y > innerHeight + 30) p.life = 0;
    const a = Math.min(1, p.life / 0.5);
    cx.save(); cx.globalAlpha = a; cx.translate(p.x, p.y);
    if (p.kind === "coin") {
      const sx = Math.abs(Math.cos(p.rot)), r = p.r;
      cx.scale(sx < 0.12 ? 0.12 : sx, 1);
      const g = cx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      g.addColorStop(0, "#fff3b0"); g.addColorStop(0.55, "#f4c542"); g.addColorStop(1, "#b9831a");
      cx.fillStyle = g; cx.strokeStyle = "#7a520c"; cx.lineWidth = 1.5;
      cx.beginPath(); cx.arc(0, 0, r, 0, 7); cx.fill(); cx.stroke();
      cx.strokeStyle = "rgba(122,82,12,.6)"; cx.beginPath(); cx.arc(0, 0, r * 0.62, 0, 7); cx.stroke();
    } else {
      cx.rotate(p.rot); cx.fillStyle = p.col; cx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
    }
    cx.restore();
  }
  parts = parts.filter((p) => p.life > 0);
  if (parts.length) raf = requestAnimationFrame(() => loop(now)); else { cx.clearRect(0, 0, innerWidth, innerHeight); raf = 0; }
}
function emit(list) { ensureLayer(); fit(); parts.push(...list); if (!raf) raf = requestAnimationFrame(() => loop(performance.now())); }

// 金幣噴發：從 (x,y) 往上噴，再落下
export function coinBurst(x, y, n = 40) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5, sp = 380 + Math.random() * 520;
    list.push({ kind: "coin", x: x + (Math.random() - 0.5) * 40, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: 8 + Math.random() * 10, r: 7 + Math.random() * 6, life: 2.2 + Math.random() * 0.8 });
  }
  emit(list);
}
function confetti(n = 80) {
  const cols = ["#ff5252", "#ffd740", "#69f0ae", "#40c4ff", "#e040fb"], list = [];
  for (let i = 0; i < n; i++) list.push({ kind: "conf", x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 160, vy: 50 + Math.random() * 200, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, r: 4 + Math.random() * 3, col: cols[i % 5], life: 3 + Math.random() });
  emit(list);
}

function bigBanner(net, level) {
  if (bigEl) bigEl.remove();
  const el = bigEl = document.createElement("div");
  el.className = "bigwin " + level;
  el.innerHTML = `<div class="bw-rays"></div><div class="bw-box"><div class="bw-t">${level === "mega" ? "MEGA WIN" : "BIG WIN"}</div><div class="bw-n">+0</div><div class="bw-s">點一下關閉</div></div>`;
  document.body.append(el);
  const nEl = el.querySelector(".bw-n"), t0 = performance.now(), dur = 1500;
  const tick = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    nEl.textContent = "+" + Math.round(net * e).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const close = () => { el.classList.add("out"); setTimeout(() => { el.remove(); if (bigEl === el) bigEl = null; }, 350); };
  el.addEventListener("click", close); setTimeout(() => { if (el.isConnected) close(); }, 3800);
}

function shake(el) { if (!el) return; el.classList.remove("fx-shake"); void el.offsetWidth; el.classList.add("fx-shake"); setTimeout(() => el.classList.remove("fx-shake"), 600); }
function dim() { const d = document.createElement("div"); d.className = "fxlose"; document.body.append(d); setTimeout(() => d.remove(), 900); }

// net：淨輸贏（可為負）；bet：這一把的賭注；at：噴金幣的位置（螢幕座標）
export function celebrate({ net, bet, at, host, quiet }) {
  const r = bet > 0 ? net / bet : 0;
  if (quiet && (net <= 0 || r < 2)) return;                       // 老虎機自己有音效：只有中大一點才加演出
  const x = at ? at.x : innerWidth / 2, y = at ? at.y : innerHeight * 0.55;
  if (net > 0) {
    coinBurst(x, y, Math.min(110, 22 + Math.round(r * 9)));
    if (r >= 5) { sfx.bigwin(); bigBanner(net, r >= 20 ? "mega" : "big"); confetti(r >= 20 ? 140 : 90); if (r >= 12) setTimeout(() => coinBurst(innerWidth * 0.25, innerHeight * 0.7, 40), 300); if (r >= 12) setTimeout(() => coinBurst(innerWidth * 0.75, innerHeight * 0.7, 40), 450); }
    else if (!quiet) sfx.win();
  } else if (net < 0) { sfx.lose(); dim(); shake(host); }
  else sfx.push();
}

// ---- 監聽賭場結算列
const seen = new Map();
function onResult(el) {
  const host = el.closest(".casino");
  if (!host || host.classList.contains("spectating")) return;
  const text = el.textContent.trim(), key = text;
  const nowT = performance.now();
  if (seen.has(key) && nowT - seen.get(key) < 4000) return;
  seen.set(key, nowT);
  const win = el.classList.contains("win"), lose = el.classList.contains("lose");
  const m = text.match(/\+\s*([\d,]+)/), l = text.match(/-\s*([\d,]+)/);
  const bet = Number(host.dataset.lastbet) || 0;
  const net = win ? (m ? Number(m[1].replace(/,/g, "")) : bet) : lose ? -(l ? Number(l[1].replace(/,/g, "")) : bet) : 0;
  const delay = parseFloat(el.style.animationDelay) || 0;
  setTimeout(() => {
    if (!el.isConnected) return;
    const b = el.getBoundingClientRect();
    celebrate({ net, bet: bet || Math.abs(net) || 1, at: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, host });
  }, delay * 1000 + 60);
}
new MutationObserver((list) => {
  for (const mu of list) for (const n of mu.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches && n.matches(".casino .cresult")) onResult(n);
    else if (n.querySelectorAll) n.querySelectorAll(".casino .cresult").forEach(onResult);
  }
}).observe(document.body, { childList: true, subtree: true });
