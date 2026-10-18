// 鍛造音效：全部用 Web Audio 即時合成，不需要音檔。靜音設定記在這個瀏覽器（localStorage）。
let ac = null, master = null;
const KEY = "forge_sfx";
export const sfxOn = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export function setSfx(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} }

function ctx() {
  try {
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.28; master.connect(ac.destination); }
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
function noise(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
// 一個音：type 波形、freq 起始頻率、to 結束頻率、dur 長度、vol 音量、t0 開始時間
function tone(c, { type = "sine", freq, to, dur = 0.3, vol = 0.5, t0 = 0 }) {
  const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function hit(c, { t0 = 0, hp = 1500, dur = 0.12, vol = 0.6 }) {
  const t = c.currentTime + t0, s = noise(c, dur), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "highpass"; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}

export const sfx = {
  // 開始鍛造：兩下鐵錘敲在鐵砧上
  hammer() {
    if (!sfxOn()) return; const c = ctx(); if (!c) return;
    for (const t0 of [0, 0.2]) {
      hit(c, { t0, hp: 2500, dur: 0.09, vol: 0.55 });
      tone(c, { type: "triangle", freq: 880, to: 840, dur: 0.35, vol: 0.35, t0 });
      tone(c, { type: "square", freq: 1320, to: 1250, dur: 0.18, vol: 0.12, t0 });
      tone(c, { type: "sine", freq: 150, to: 70, dur: 0.14, vol: 0.5, t0 });
    }
  },
  // 成功：往上的鈴聲，階數越高越亮；50 階以上多一串閃光
  success(tier = 1) {
    if (!sfxOn()) return; const c = ctx(); if (!c) return;
    const base = 523 * Math.pow(2, Math.min(2, Math.floor((tier || 1) / 34)) / 3);
    [1, 1.25, 1.5, 2].forEach((r, i) => { tone(c, { type: "sine", freq: base * r, dur: 0.5, vol: 0.4, t0: 0.08 + i * 0.09 }); tone(c, { type: "triangle", freq: base * r * 2, dur: 0.3, vol: 0.1, t0: 0.08 + i * 0.09 }); });
    if (tier >= 50) for (let i = 0; i < 5; i++) tone(c, { type: "sine", freq: 2400 + i * 330, dur: 0.18, vol: 0.12, t0: 0.5 + i * 0.07 });
  },
  // 失敗：悶響加玻璃碎裂，再接一個下降的音
  fail() {
    if (!sfxOn()) return; const c = ctx(); if (!c) return;
    tone(c, { type: "sine", freq: 120, to: 40, dur: 0.35, vol: 0.7 });
    hit(c, { hp: 3500, dur: 0.5, vol: 0.5 }); hit(c, { t0: 0.07, hp: 5000, dur: 0.35, vol: 0.35 });
    tone(c, { type: "sawtooth", freq: 330, to: 110, dur: 0.6, vol: 0.18, t0: 0.12 });
  },
  // 卷軸擋下破壞：向上掃過的閃光＋和弦
  saved() {
    if (!sfxOn()) return; const c = ctx(); if (!c) return;
    tone(c, { type: "sine", freq: 400, to: 1800, dur: 0.35, vol: 0.25 });
    [659, 831, 988].forEach((f, i) => tone(c, { type: "triangle", freq: f, dur: 0.6, vol: 0.3, t0: 0.3 + i * 0.05 }));
  },
  // 賣掉：一串金幣叮噹
  sell() {
    if (!sfxOn()) return; const c = ctx(); if (!c) return;
    for (let i = 0; i < 6; i++) { const t0 = i * 0.07; tone(c, { type: "square", freq: 1900 + (i % 3) * 260, to: 2100 + (i % 3) * 260, dur: 0.12, vol: 0.14, t0 }); tone(c, { type: "sine", freq: 3800 + (i % 2) * 400, dur: 0.18, vol: 0.12, t0 }); }
  },
};
