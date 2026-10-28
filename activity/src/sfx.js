// 全域音量與賭場音效。
// ・把 AudioContext 包一層：所有遊戲（老虎機、彈珠台、下樓梯、麻將、農場…）的聲音都先經過同一個總音量，
//   所以右下角的 🔊 按鈕可以一次調整／靜音全部遊戲，不用每個遊戲各做一個。
// ・另外提供發牌、擲骰、硬幣、籌碼、中獎、大獎、落敗、賽馬開閘／馬蹄／衝線的合成音效（不需要音檔）。
const KEY = "bot_vol";
let vol = 0.8, muted = false;
try { const o = JSON.parse(localStorage.getItem(KEY) || "null"); if (o) { vol = typeof o.v === "number" ? o.v : vol; muted = !!o.m; } } catch {}
const masters = new Set();
const level = () => (muted ? 0 : vol * vol);       // 平方：滑桿中段的音量感覺比較平均
function applyAll() { for (const g of masters) { try { g.gain.value = level(); } catch {} } }
function save() { try { localStorage.setItem(KEY, JSON.stringify({ v: vol, m: muted })); } catch {} }

const Base = window.AudioContext || window.webkitAudioContext;
if (Base && !Base.__wrapped) {
  const Wrapped = class extends Base {
    constructor(...a) {
      super(...a);
      try {
        const real = this.destination, g = this.createGain();
        g.gain.value = level(); g.connect(real); masters.add(g);
        Object.defineProperty(this, "destination", { value: g, configurable: true });
      } catch {}
    }
  };
  Wrapped.__wrapped = true;
  window.AudioContext = Wrapped; window.webkitAudioContext = Wrapped;
}

let ac = null;
function ctx() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
function noise(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
function tone(c, { type = "sine", f, to, d = 0.2, v = 0.3, at = 0 }) {
  const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.03);
}
function hiss(c, { at = 0, f = 2500, q = 2, d = 0.06, v = 0.3, type = "bandpass" }) {
  const t = c.currentTime + at, s = noise(c, d), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(fl); fl.connect(g); g.connect(c.destination); s.start(t); s.stop(t + d);
}
const run = (fn) => () => { if (muted || vol <= 0) return; const c = ctx(); if (c) { try { fn(c); } catch {} } };

export const sfx = {
  // 牌從牌靴滑出來：一小段高頻的「咻」＋輕敲
  deal: run((c) => { hiss(c, { f: 4200, q: 0.8, d: 0.09, v: 0.35, type: "highpass" }); hiss(c, { at: 0.07, f: 1800, q: 3, d: 0.03, v: 0.25 }); }),
  flip: run((c) => { hiss(c, { f: 3000, q: 1, d: 0.05, v: 0.25, type: "highpass" }); }),
  // 籌碼：陶瓷互敲的「喀啦」
  chip: run((c) => { for (let i = 0; i < 3; i++) { tone(c, { type: "triangle", f: 2400 + i * 330, to: 1900, d: 0.05, v: 0.14, at: i * 0.045 }); hiss(c, { at: i * 0.045, f: 5200, q: 5, d: 0.02, v: 0.14 }); } }),
  click: run((c) => { tone(c, { type: "square", f: 900, to: 600, d: 0.04, v: 0.05 }); }),
  // 骰子在杯裡搖、落桌
  dice: run((c) => { for (let i = 0; i < 9; i++) hiss(c, { at: i * 0.05 + Math.random() * 0.02, f: 1400 + Math.random() * 1800, q: 4, d: 0.035, v: 0.2 }); hiss(c, { at: 0.5, f: 700, q: 2, d: 0.08, v: 0.3 }); }),
  // 硬幣：拋起的叮＋落下的旋轉聲
  coin: run((c) => { tone(c, { f: 2900, d: 0.55, v: 0.14 }); tone(c, { f: 4300, d: 0.35, v: 0.07 }); for (let i = 0; i < 6; i++) tone(c, { type: "triangle", f: 3200 - i * 140, d: 0.04, v: 0.08, at: 0.55 + i * (0.09 - i * 0.012) }); }),
  win: run((c) => { [523, 659, 784, 1047].forEach((f, i) => { tone(c, { type: "triangle", f, d: 0.22, v: 0.16, at: i * 0.08 }); tone(c, { f: f * 2, d: 0.18, v: 0.05, at: i * 0.08 }); }); for (let i = 0; i < 6; i++) tone(c, { type: "triangle", f: 3000 + Math.random() * 1500, d: 0.05, v: 0.06, at: 0.35 + i * 0.06 }); }),
  bigwin: run((c) => {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => { tone(c, { type: "sawtooth", f, d: 0.28, v: 0.07, at: i * 0.1 }); tone(c, { type: "triangle", f, d: 0.35, v: 0.13, at: i * 0.1 }); });
    [1047, 1319, 1568].forEach((f) => tone(c, { type: "triangle", f, d: 1.0, v: 0.1, at: 0.7 }));
    for (let i = 0; i < 24; i++) { tone(c, { type: "triangle", f: 2600 + Math.random() * 2400, d: 0.05, v: 0.07, at: 0.4 + i * 0.07 }); hiss(c, { at: 0.4 + i * 0.07, f: 6000, q: 6, d: 0.02, v: 0.08 }); }
  }),
  lose: run((c) => { [392, 349, 311, 233].forEach((f, i) => tone(c, { type: "triangle", f, to: f * 0.96, d: 0.3, v: 0.12, at: i * 0.17 })); }),
  push: run((c) => { tone(c, { type: "sine", f: 520, d: 0.18, v: 0.1 }); tone(c, { type: "sine", f: 520, d: 0.18, v: 0.1, at: 0.14 }); }),
  // 賽馬
  gateClose: run((c) => { hiss(c, { f: 900, q: 2, d: 0.12, v: 0.35 }); tone(c, { type: "square", f: 140, to: 90, d: 0.12, v: 0.12 }); }),
  gateOpen: run((c) => { hiss(c, { f: 1200, q: 1.5, d: 0.25, v: 0.4 }); tone(c, { type: "square", f: 220, to: 70, d: 0.22, v: 0.16 }); tone(c, { type: "triangle", f: 1500, to: 1100, d: 0.4, v: 0.1, at: 0.02 }); }),
  bell: run((c) => { [880, 1175, 880].forEach((f, i) => { tone(c, { f, d: 0.5, v: 0.14, at: i * 0.22 }); tone(c, { f: f * 2.4, d: 0.3, v: 0.04, at: i * 0.22 }); }); }),
  hoof: run((c) => { tone(c, { type: "sine", f: 150, to: 70, d: 0.09, v: 0.1 }); hiss(c, { f: 500, q: 1.5, d: 0.05, v: 0.1 }); }),
  cheer: run((c) => { const s = noise(c, 1.4), fl = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime; fl.type = "bandpass"; fl.frequency.setValueAtTime(900, t); fl.frequency.linearRampToValueAtTime(1500, t + 0.6); fl.Q.value = 0.7; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.35); g.gain.linearRampToValueAtTime(0.0001, t + 1.4); s.connect(fl); fl.connect(g); g.connect(c.destination); s.start(t); s.stop(t + 1.4); }),
};

// ---- 真實音效檔（用音效生成模型做的，在 sfx-audio/）：載入成功就用檔案，否則退回上面的合成音
const URLS = {};
for (const [p, u] of Object.entries(import.meta.glob("./sfx-audio/*.mp3", { eager: true, query: "?url", import: "default" }))) URLS[p.split("/").pop().slice(0, -4)] = u;
const SAMPLE = { deal: ["deal", 0.9], flip: ["flip", 0.8], chip: ["chip", 0.7], dice: ["dice", 0.8], coin: ["coin", 0.8], win: ["win", 0.8], bigwin: ["bigwin", 0.9], lose: ["lose", 0.7], gateOpen: ["gate", 0.8], bell: ["bell", 0.7], cheer: ["cheer", 0.6], hoof: ["gallop", 0.5] };
const bufs = {}; let loading = false;
function loadSamples() {
  if (loading) return; const c = ctx(); if (!c) return; loading = true;
  for (const k of Object.keys(URLS)) {
    fetch(URLS[k]).then((r) => r.arrayBuffer()).then((ab) => c.decodeAudioData(ab)).then((b) => { bufs[k] = b; }).catch(() => {});
  }
}
let galUntil = 0;
for (const [name, [file, g]] of Object.entries(SAMPLE)) {
  const synth = sfx[name];
  sfx[name] = () => {
    if (muted || vol <= 0) return;
    const c = ctx(), b = bufs[file];
    if (!c) return;
    if (!b) { loadSamples(); return synth(); }
    if (name === "hoof") { const now = performance.now(); if (now < galUntil) return; galUntil = now + b.duration * 1000 - 150; }   // 馬蹄整段只播一次，不重疊
    try { const src = c.createBufferSource(), gn = c.createGain(); src.buffer = b; gn.gain.value = g; src.connect(gn); gn.connect(c.destination); src.start(); } catch { synth(); }
  };
}
document.addEventListener("pointerdown", loadSamples, { once: true, capture: true });

// 點按鈕時的回饋音（賭場畫面裡）：依按鈕文字決定發牌／骰子／硬幣／籌碼
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest(".casino button, .casino .chip");
  if (!b || b.disabled) return;
  const t = (b.textContent || "").trim();
  if (b.closest(".bets")) return sfx.chip();
  if (/發牌|要牌|雙倍|分牌|加倍|補牌/.test(t)) return sfx.deal();
  if (/骰|擲/.test(t)) return sfx.dice();
  if (/硬幣|正面|反面/.test(t)) return sfx.coin();
  if (/下注|押|買|賣/.test(t)) return sfx.chip();
  if (/停牌|停止/.test(t)) return sfx.flip();
  sfx.click();
}, true);

// ---- 右下角音量鈕
function mountUI() {
  if (document.getElementById("gvol")) return;
  const el = document.createElement("div");
  el.id = "gvol";
  el.innerHTML = `<button class="gv-btn" title="音量" aria-label="音量"></button><div class="gv-pop" hidden><input class="gv-range" type="range" min="0" max="100" step="1" aria-label="音量"><button class="gv-mute"></button></div>`;
  document.body.append(el);
  const btn = el.querySelector(".gv-btn"), pop = el.querySelector(".gv-pop"), rng = el.querySelector(".gv-range"), mb = el.querySelector(".gv-mute");
  const icon = () => (muted || vol <= 0 ? "🔇" : vol < 0.4 ? "🔈" : vol < 0.75 ? "🔉" : "🔊");
  const paint = () => { btn.textContent = icon(); mb.textContent = muted ? "取消靜音" : "靜音"; rng.value = Math.round(vol * 100); rng.style.setProperty("--p", `${Math.round(vol * 100)}%`); el.classList.toggle("off", muted || vol <= 0); };
  paint();
  btn.addEventListener("click", () => { pop.hidden = !pop.hidden; });
  rng.addEventListener("input", () => { vol = rng.value / 100; if (vol > 0) muted = false; applyAll(); save(); paint(); });
  rng.addEventListener("change", () => sfx.chip());
  mb.addEventListener("click", () => { muted = !muted; applyAll(); save(); paint(); if (!muted) sfx.chip(); });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !el.contains(e.target)) pop.hidden = true; }, true);
}
if (document.body) mountUI(); else document.addEventListener("DOMContentLoaded", mountUI);
