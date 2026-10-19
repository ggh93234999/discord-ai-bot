// 種菜音效：全部用 Web Audio 即時合成，不需要音檔。靜音設定記在這個瀏覽器（localStorage）。
let ac = null, master = null;
const KEY = "farm_sfx";
export const sfxOn = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export function setSfx(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} }

function ctx() {
  try {
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.3; master.connect(ac.destination); }
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
function noiseSrc(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
function tone(c, { type = "sine", freq, to, dur = 0.3, vol = 0.5, t0 = 0 }) {
  const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
// 一小段雜訊：filter = lowpass（泥土、沙沙）或 highpass（亮的碎響）
function puff(c, { t0 = 0, filter = "lowpass", f = 900, dur = 0.12, vol = 0.5 }) {
  const t = c.currentTime + t0, s = noiseSrc(c, dur), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = filter; fl.frequency.value = f;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
const play = (fn) => { if (!sfxOn()) return; const c = ctx(); if (c) fn(c); };

export const sfx = {
  // 選種子：小小一聲
  tick() { play((c) => tone(c, { type: "triangle", freq: 700, to: 900, dur: 0.07, vol: 0.18 })); },
  // 播種：土被撥開的悶響＋兩顆種子落下的啵啵
  plant() {
    play((c) => {
      puff(c, { f: 700, dur: 0.16, vol: 0.55 });
      tone(c, { type: "sine", freq: 150, to: 70, dur: 0.16, vol: 0.5 });
      [0.12, 0.2].forEach((t0, i) => tone(c, { type: "sine", freq: 520 + i * 160, to: 760 + i * 200, dur: 0.1, vol: 0.28, t0 }));
    });
  },
  // 收成：拔菜的啵一聲＋清脆的叮；大顆多一個和聲，金色多一串閃光
  harvest(got = []) {
    play((c) => {
      tone(c, { type: "sine", freq: 220, to: 520, dur: 0.12, vol: 0.45 });
      puff(c, { filter: "highpass", f: 2500, dur: 0.07, vol: 0.25 });
      [660, 880, 1100].forEach((f, i) => tone(c, { type: "triangle", freq: f, dur: 0.3, vol: 0.26, t0: 0.1 + i * 0.07 }));
      if (got.some((g) => g.v === "big")) [784, 1175].forEach((f, i) => tone(c, { type: "sine", freq: f, dur: 0.45, vol: 0.22, t0: 0.34 + i * 0.08 }));
      if (got.some((g) => g.v === "gold")) for (let i = 0; i < 7; i++) tone(c, { type: "sine", freq: 1800 + i * 280, dur: 0.2, vol: 0.14, t0: 0.4 + i * 0.06 });
    });
  },
  // 成熟提醒：兩個柔和的音
  ripe() { play((c) => [784, 1047].forEach((f, i) => tone(c, { type: "sine", freq: f, dur: 0.5, vol: 0.2, t0: i * 0.16 }))); },
  // 賣菜：一串金幣
  sell() {
    play((c) => {
      for (let i = 0; i < 6; i++) { const t0 = i * 0.07; tone(c, { type: "square", freq: 1900 + (i % 3) * 260, to: 2100 + (i % 3) * 260, dur: 0.12, vol: 0.13, t0 }); tone(c, { type: "sine", freq: 3800 + (i % 2) * 400, dur: 0.18, vol: 0.11, t0 }); }
    });
  },
  // 擴地：兩下木槌
  build() {
    play((c) => [0, 0.18].forEach((t0) => { tone(c, { type: "sine", freq: 210, to: 110, dur: 0.14, vol: 0.55, t0 }); puff(c, { t0, f: 1800, dur: 0.07, vol: 0.4 }); tone(c, { type: "triangle", freq: 420, to: 380, dur: 0.12, vol: 0.18, t0 }); }));
  },
  // 偷菜：躡手躡腳的幾個短音＋沙沙聲
  steal() {
    play((c) => {
      [0, 0.14, 0.28, 0.42].forEach((t0, i) => tone(c, { type: "triangle", freq: 520 - i * 40, to: 400 - i * 40, dur: 0.08, vol: 0.2, t0 }));
      puff(c, { t0: 0.5, filter: "highpass", f: 3000, dur: 0.18, vol: 0.22 });
      tone(c, { type: "sine", freq: 880, to: 1320, dur: 0.14, vol: 0.2, t0: 0.62 });
    });
  },
  // 錯誤：低低的一聲
  err() { play((c) => tone(c, { type: "sawtooth", freq: 200, to: 120, dur: 0.18, vol: 0.18 })); },
};
