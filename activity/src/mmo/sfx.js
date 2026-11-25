// 水墨江湖的音效與環境音：全部用 Web Audio 即時合成，不需要音檔。
// 聲音會經過 ../sfx.js 包好的總音量（右下角 🔊），另外這裡有「音效」「環境音」兩個開關，記在這台裝置上。
import "../sfx.js";

const KEY = "mmo_snd";
let opt = { fx: true, amb: true, fxv: 0.8, ambv: 0.7 };      // fxv／ambv：技能音效、背景環境音各自的音量（0～1）
try { opt = { ...opt, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
export const sndOpt = () => ({ ...opt });
const FX_BASE = 0.7, AMB_BASE = 1.1;
const fxLevel = () => FX_BASE * opt.fxv * opt.fxv, ambLevel = () => AMB_BASE * opt.ambv * opt.ambv;     // 平方：滑桿中段的音量變化比較平均
export function setSnd(k, v) {
  opt[k] = v; try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch {}
  if (k === "amb") { if (v) ambience(curTheme, true); else stopAmb(); }
  if (k === "fxv" && fxBus) fxBus.gain.setTargetAtTime(fxLevel(), ac.currentTime, 0.03);
  if (k === "ambv" && ambBus && amb) ambBus.gain.setTargetAtTime(ambLevel(), ac.currentTime, 0.05);
}

let ac = null, fxBus = null, ambBus = null;
function ctx() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      fxBus = ac.createGain(); fxBus.gain.value = fxLevel(); fxBus.connect(ac.destination);
      ambBus = ac.createGain(); ambBus.gain.value = 0; ambBus.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
// 瀏覽器要使用者先互動才准出聲：第一次點擊／按鍵時把聲音打開、環境音補上
let unlocked = false;
function unlock() { if (unlocked) return; unlocked = true; ctx(); if (opt.amb && curTheme) ambience(curTheme, true); }
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, unlock, { once: false, passive: true });

let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = c.createBufferSource(); s.buffer = noiseBuf; return s;
}
function tone(c, { type = "sine", f, to, d = 0.2, v = 0.3, at = 0, out = fxBus, att = 0.006 }) {
  const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
}
function hiss(c, { at = 0, f = 2500, to, q = 1, d = 0.1, v = 0.3, type = "bandpass", out = fxBus, att = 0.004 }) {
  const t = c.currentTime + at, s = noise(c), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = type; fl.frequency.setValueAtTime(f, t); if (to) fl.frequency.exponentialRampToValueAtTime(to, t + d); fl.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + d + 0.05);
}
// 古琴般的撥弦：基音＋泛音，慢慢衰減
function pluck(c, f, { at = 0, v = 0.12, d = 1.6, out = fxBus } = {}) { tone(c, { type: "triangle", f, d, v, at, out, att: 0.003 }); tone(c, { f: f * 2, d: d * 0.6, v: v * 0.35, at, out, att: 0.003 }); }
const PENTA = [262, 294, 330, 392, 440, 523, 587, 659, 784];
const gap = {};          // 同一種聲音太密集時跳過（一群怪同時被打不會炸耳朵）
const run = (name, ms, fn) => (vol = 1) => {
  if (!opt.fx || !unlocked || opt.fxv <= 0) return;
  const n = performance.now(); if (gap[name] && n - gap[name] < ms) return; gap[name] = n;
  const c = ctx(); if (!c) return;
  try { fn(c, Math.max(0.05, Math.min(1, vol))); } catch {}
};

export const snd = {
  // 刀劍砍中：短促的破風＋悶響
  slash: run("slash", 60, (c, k) => { hiss(c, { f: 3200, to: 900, q: 0.8, d: 0.11, v: 0.32 * k, type: "bandpass" }); tone(c, { type: "triangle", f: 180, to: 70, d: 0.12, v: 0.3 * k, at: 0.02 }); }),
  crit: run("crit", 80, (c, k) => { hiss(c, { f: 4500, to: 1200, q: 0.9, d: 0.14, v: 0.4 * k }); tone(c, { type: "triangle", f: 160, to: 55, d: 0.2, v: 0.45 * k, at: 0.02 }); tone(c, { type: "sine", f: 1760, d: 0.35, v: 0.08 * k, at: 0.03 }); }),
  arrow: run("arrow", 70, (c, k) => { hiss(c, { f: 5200, to: 2200, q: 2.5, d: 0.16, v: 0.22 * k }); tone(c, { type: "triangle", f: 420, to: 260, d: 0.05, v: 0.08 * k }); }),
  orb: run("orb", 70, (c, k) => { tone(c, { type: "sine", f: 700, to: 1100, d: 0.14, v: 0.12 * k }); hiss(c, { f: 2600, q: 4, d: 0.12, v: 0.1 * k }); }),
  hurt: run("hurt", 90, (c, k) => { tone(c, { type: "sine", f: 140, to: 60, d: 0.16, v: 0.4 * k }); hiss(c, { f: 600, q: 0.7, d: 0.08, v: 0.2 * k, type: "lowpass" }); }),
  kill: run("kill", 120, (c, k) => { hiss(c, { f: 1200, to: 300, q: 0.6, d: 0.35, v: 0.22 * k, type: "lowpass" }); tone(c, { type: "sine", f: 220, to: 90, d: 0.3, v: 0.16 * k }); }),
  // 技能：依類型
  whoosh: run("whoosh", 80, (c, k) => { hiss(c, { f: 800, to: 3800, q: 1.2, d: 0.28, v: 0.3 * k, att: 0.05 }); }),
  fire: run("fire", 100, (c, k) => { hiss(c, { f: 900, to: 400, q: 0.5, d: 0.5, v: 0.32 * k, type: "lowpass", att: 0.02 }); for (let i = 0; i < 6; i++) hiss(c, { at: Math.random() * 0.4, f: 3000 + Math.random() * 2000, q: 6, d: 0.02, v: 0.12 * k }); }),
  ice: run("ice", 100, (c, k) => { tone(c, { f: 2093, d: 0.5, v: 0.09 * k }); tone(c, { f: 2637, d: 0.4, v: 0.07 * k, at: 0.03 }); hiss(c, { f: 6000, q: 3, d: 0.1, v: 0.12 * k, type: "highpass" }); }),
  thunder: run("thunder", 150, (c, k) => { hiss(c, { f: 3000, to: 200, q: 0.4, d: 0.9, v: 0.5 * k, type: "lowpass", att: 0.003 }); tone(c, { type: "sawtooth", f: 55, to: 35, d: 0.8, v: 0.18 * k }); }),
  boom: run("boom", 150, (c, k) => { tone(c, { type: "sine", f: 90, to: 35, d: 0.6, v: 0.6 * k }); hiss(c, { f: 400, to: 100, q: 0.5, d: 0.5, v: 0.35 * k, type: "lowpass" }); }),
  heal: run("heal", 200, (c, k) => { [523, 659, 784, 1046].forEach((f, i) => tone(c, { f, d: 0.6, v: 0.08 * k, at: i * 0.07 })); }),
  buff: run("buff", 200, (c, k) => { tone(c, { type: "sine", f: 196, d: 1.4, v: 0.22 * k }); tone(c, { type: "sine", f: 294, d: 1.1, v: 0.1 * k }); tone(c, { type: "sine", f: 588, d: 0.7, v: 0.05 * k }); }),
  // 系統
  level: run("level", 300, (c) => { [392, 440, 523, 659, 784].forEach((f, i) => pluck(c, f, { at: i * 0.09, v: 0.16 })); tone(c, { type: "sine", f: 131, d: 2, v: 0.25, at: 0.45 }); }),
  loot: run("loot", 120, (c, k) => { tone(c, { f: 1568, d: 0.12, v: 0.12 * k }); tone(c, { f: 2093, d: 0.22, v: 0.1 * k, at: 0.06 }); }),
  rare: run("rare", 300, (c) => { [784, 988, 1175, 1568].forEach((f, i) => tone(c, { f, d: 0.7, v: 0.1, at: i * 0.08 })); }),
  coin: run("coin", 90, (c, k) => { tone(c, { type: "square", f: 1975, d: 0.06, v: 0.04 * k }); tone(c, { type: "square", f: 2637, d: 0.12, v: 0.04 * k, at: 0.05 }); }),
  potion: run("potion", 200, (c) => { for (let i = 0; i < 3; i++) tone(c, { type: "sine", f: 300 + i * 90, to: 520 + i * 90, d: 0.08, v: 0.14, at: i * 0.09 }); }),
  die: run("die", 500, (c) => { [392, 349, 294, 262, 196].forEach((f, i) => pluck(c, f, { at: i * 0.18, v: 0.14, d: 1.4 })); }),
  warp: run("warp", 400, (c) => { hiss(c, { f: 300, to: 5000, q: 2, d: 0.7, v: 0.22, att: 0.2 }); [523, 784, 1046].forEach((f, i) => tone(c, { f, d: 0.8, v: 0.06, at: 0.2 + i * 0.1 })); }),
  warn: run("warn", 400, (c) => { tone(c, { type: "sine", f: 70, d: 0.35, v: 0.5 }); tone(c, { type: "sine", f: 70, d: 0.35, v: 0.45, at: 0.38 }); }),
  gong: run("gong", 400, (c) => { [110, 220.5, 331, 443].forEach((f, i) => tone(c, { type: "sine", f, d: 2.5 - i * 0.4, v: 0.25 / (i + 1) })); }),
  anvil: run("anvil", 200, (c) => { tone(c, { type: "square", f: 1320, d: 0.25, v: 0.06 }); tone(c, { type: "sine", f: 2640, d: 0.5, v: 0.06 }); hiss(c, { f: 5000, q: 2, d: 0.05, v: 0.2 }); }),
  success: run("success", 300, (c) => { [523, 659, 784, 1046, 1318].forEach((f, i) => pluck(c, f, { at: 0.15 + i * 0.07, v: 0.12 })); }),
  fail: run("fail", 300, (c) => { tone(c, { type: "triangle", f: 220, to: 110, d: 0.5, v: 0.22, at: 0.15 }); }),
  click: run("click", 40, (c) => { tone(c, { type: "triangle", f: 900, to: 600, d: 0.04, v: 0.08 }); }),
};

// ---------------------------------------------------------------- 環境音
// 一條一直播的「底」（濾過的雜訊＋慢慢起伏）＋偶爾出現的點綴（鳥叫、撥弦、遠處鼓聲…）
const AMB = {
  town: { bed: { f: 700, q: 0.4, v: 0.05, lfo: 0.06 }, drone: null, deco: "qin", every: [5000, 11000] },
  bamboo: { bed: { f: 2200, q: 0.6, v: 0.08, lfo: 0.12, type: "bandpass" }, deco: "bird", every: [3000, 8000] },
  mount: { bed: { f: 500, q: 1.4, v: 0.11, lfo: 0.09, type: "bandpass" }, deco: "hawk", every: [9000, 18000] },
  tomb: { bed: { f: 300, q: 0.8, v: 0.07, lfo: 0.05 }, drone: [55, 82.5], deco: "eerie", every: [6000, 13000] },
  snow: { bed: { f: 1400, q: 1.6, v: 0.12, lfo: 0.15, type: "bandpass" }, deco: "chime", every: [7000, 14000] },
  fire: { bed: { f: 260, q: 0.6, v: 0.1, lfo: 0.08 }, drone: [41, 61.5], deco: "crackle", every: [600, 1800] },
  demon: { bed: { f: 240, q: 0.7, v: 0.07, lfo: 0.05 }, drone: [49, 73.5], deco: "drum", every: [4000, 9000] },
  tower: { bed: { f: 360, q: 0.9, v: 0.07, lfo: 0.04 }, drone: [58, 87], deco: "eerie", every: [5000, 10000] },
  arena: { bed: { f: 800, q: 0.4, v: 0.06, lfo: 0.2 }, deco: "drum", every: [2500, 5000] },
  sea: { bed: { f: 420, q: 0.5, v: 0.12, lfo: 0.07 }, drone: [36, 54], deco: "chime", every: [6000, 12000] },
  kunlun: { bed: { f: 1200, q: 1.2, v: 0.09, lfo: 0.1, type: "bandpass" }, deco: "hawk", every: [7000, 15000] },
  hell: { bed: { f: 220, q: 0.8, v: 0.08, lfo: 0.04 }, drone: [45, 67.5], deco: "eerie", every: [4000, 9000] },
  heaven: { bed: { f: 900, q: 0.5, v: 0.06, lfo: 0.12 }, drone: [110, 165], deco: "chime", every: [5000, 10000] },
};
let curTheme = "", amb = null;
function stopAmb() {
  if (!amb) return;
  const a = amb; amb = null; clearTimeout(a.timer);
  try { const t = ac.currentTime; ambBus.gain.cancelScheduledValues(t); ambBus.gain.setValueAtTime(ambBus.gain.value, t); ambBus.gain.linearRampToValueAtTime(0, t + 0.8); } catch {}
  setTimeout(() => { for (const n of a.nodes) try { n.stop ? n.stop() : n.disconnect(); } catch {} }, 900);
}
function deco(c, kind) {
  const o = { out: ambBus };
  if (kind === "bird") { const f = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(c, { f, to: f * (1.2 + Math.random() * 0.3), d: 0.08, v: 0.05, at: i * 0.12, ...o }); }
  else if (kind === "qin") { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) pluck(c, PENTA[Math.floor(Math.random() * PENTA.length)] / 2, { at: i * (0.35 + Math.random() * 0.3), v: 0.07, d: 2.2, ...o }); }
  else if (kind === "hawk") tone(c, { type: "sine", f: 1800, to: 1100, d: 0.9, v: 0.035, ...o, att: 0.08 });
  else if (kind === "eerie") { const f = 220 + Math.random() * 180; tone(c, { type: "sine", f, to: f * 0.94, d: 2.5, v: 0.03, ...o, att: 0.6 }); tone(c, { type: "sine", f: f * 1.5, to: f * 1.42, d: 2.2, v: 0.015, ...o, att: 0.6 }); }
  else if (kind === "chime") { const f = 1568 + Math.random() * 800; tone(c, { f, d: 1.4, v: 0.025, ...o }); tone(c, { f: f * 1.5, d: 1, v: 0.012, at: 0.05, ...o }); }
  else if (kind === "crackle") { for (let i = 0; i < 3; i++) hiss(c, { at: Math.random() * 0.3, f: 2500 + Math.random() * 3000, q: 5, d: 0.015, v: 0.06, ...o }); }
  else if (kind === "drum") { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(c, { type: "sine", f: 75, to: 45, d: 0.4, v: 0.12, at: i * 0.42, ...o }); }
}
export function ambience(theme, force) {
  if (theme === curTheme && amb && !force) return;
  curTheme = theme;
  stopAmb();
  if (!opt.amb || !unlocked) return;
  const c = ctx(), A = AMB[theme]; if (!c || !A) return;
  const nodes = [];
  // 底：一直循環的雜訊，經過濾波器，音量用很慢的 LFO 起伏（像風）
  const s = noise(c); s.loop = true;
  const fl = c.createBiquadFilter(); fl.type = A.bed.type || "lowpass"; fl.frequency.value = A.bed.f; fl.Q.value = A.bed.q;
  const g = c.createGain(); g.gain.value = A.bed.v;
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = A.bed.lfo; lg.gain.value = A.bed.v * 0.7; lfo.connect(lg); lg.connect(g.gain);
  const lfo2 = c.createOscillator(), lg2 = c.createGain(); lfo2.frequency.value = A.bed.lfo * 0.63; lg2.gain.value = A.bed.f * 0.35; lfo2.connect(lg2); lg2.connect(fl.frequency);
  s.connect(fl); fl.connect(g); g.connect(ambBus); s.start(); lfo.start(); lfo2.start();
  nodes.push(s, lfo, lfo2, g);
  if (A.drone) for (const f of A.drone) { const o = c.createOscillator(), og = c.createGain(); o.type = "sine"; o.frequency.value = f; og.gain.value = 0.035; o.connect(og); og.connect(ambBus); o.start(); nodes.push(o); }
  amb = { nodes, timer: 0 };
  const t = c.currentTime; ambBus.gain.cancelScheduledValues(t); ambBus.gain.setValueAtTime(ambBus.gain.value, t); ambBus.gain.linearRampToValueAtTime(ambLevel(), t + 2);
  const me = amb;
  const tick = () => { if (amb !== me) return; try { deco(c, A.deco); } catch {} me.timer = setTimeout(tick, A.every[0] + Math.random() * (A.every[1] - A.every[0])); };
  me.timer = setTimeout(tick, 1500);
}
export function stopAmbience() { curTheme = ""; stopAmb(); }
