// 麻將音效：全部用 Web Audio 即時合成（洗牌、打牌、摸牌、吃碰槓、立直、胡牌…），不需要音檔。靜音設定記在這個瀏覽器。
let ac = null, master = null;
const KEY = "mj_sfx";
export const mjSfxOn = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export function setMjSfx(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} }

function ctx() {
  try {
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.32; master.connect(ac.destination); }
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
function noise(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
function tone(c, { type = "sine", freq, to, dur = 0.3, vol = 0.5, t0 = 0 }) {
  const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
// 帶通濾波的雜音：模擬硬物碰撞
function burst(c, { t0 = 0, f = 2500, q = 3, dur = 0.05, vol = 0.5, type = "bandpass" }) {
  const t = c.currentTime + t0, s = noise(c, dur), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
// 一張牌敲在桌上：清脆的「喀」＋一點木頭的悶聲
function clack(c, t0 = 0, vol = 1, pitch = 1) {
  burst(c, { t0, f: 2600 * pitch, q: 4, dur: 0.045, vol: 0.55 * vol });
  burst(c, { t0, f: 5200 * pitch, q: 6, dur: 0.02, vol: 0.25 * vol });
  tone(c, { type: "triangle", freq: 950 * pitch, to: 700 * pitch, dur: 0.05, vol: 0.18 * vol, t0 });
  tone(c, { type: "sine", freq: 190, to: 120, dur: 0.07, vol: 0.3 * vol, t0 });
}
const play = (fn) => () => { if (!mjSfxOn()) return; const c = ctx(); if (c) fn(c); };

export const mjSfx = {
  // 洗牌：一大堆牌嘩啦嘩啦互相碰撞，底下有低沉的搓動聲
  shuffle: play((c) => {
    burst(c, { f: 500, q: 0.7, dur: 1.6, vol: 0.18, type: "lowpass" });
    for (let i = 0; i < 46; i++) {
      const t0 = Math.random() * 1.45;
      clack(c, t0, 0.18 + Math.random() * 0.3, 0.75 + Math.random() * 0.6);
    }
  }),
  // 打出一張牌
  discard: play((c) => clack(c, 0, 1, 1)),
  // 自己摸牌：輕輕滑過來
  draw: play((c) => { burst(c, { f: 1800, q: 1.2, dur: 0.09, vol: 0.18 }); clack(c, 0.06, 0.35, 1.15); }),
  // 吃／碰／槓：幾張牌一起倒下，再加一聲提示
  call: play((c) => {
    clack(c, 0, 0.9, 0.95); clack(c, 0.06, 0.8, 1.05); clack(c, 0.12, 0.7, 0.9);
    tone(c, { type: "triangle", freq: 660, dur: 0.18, vol: 0.18, t0: 0.15 }); tone(c, { type: "triangle", freq: 880, dur: 0.22, vol: 0.18, t0: 0.24 });
  }),
  kan: play((c) => {
    for (let i = 0; i < 4; i++) clack(c, i * 0.06, 0.85, 0.9 + i * 0.05);
    tone(c, { type: "triangle", freq: 523, dur: 0.25, vol: 0.2, t0: 0.26 }); tone(c, { type: "triangle", freq: 784, dur: 0.3, vol: 0.2, t0: 0.34 });
  }),
  // 立直：點棒放到桌上＋往上掃的閃光
  riichi: play((c) => {
    clack(c, 0, 0.8, 1.3); tone(c, { type: "sine", freq: 300, to: 1200, dur: 0.45, vol: 0.2, t0: 0.05 });
    [1047, 1319, 1568].forEach((f, i) => tone(c, { type: "sine", freq: f, dur: 0.35, vol: 0.15, t0: 0.35 + i * 0.06 }));
  }),
  // 輪到自己：輕輕的叮
  myturn: play((c) => { tone(c, { type: "sine", freq: 1175, dur: 0.18, vol: 0.14 }); }),
  // 可以吃碰槓胡：兩聲提醒
  claim: play((c) => { tone(c, { type: "square", freq: 880, dur: 0.1, vol: 0.08 }); tone(c, { type: "square", freq: 1175, dur: 0.14, vol: 0.08, t0: 0.12 }); }),
  // 胡牌：亮麗的上行和弦；自己胡更熱鬧
  win: (mine) => play((c) => {
    clack(c, 0, 1, 1); clack(c, 0.04, 0.8, 1.1);
    const notes = mine ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    notes.forEach((f, i) => { tone(c, { type: "triangle", freq: f, dur: 0.5, vol: 0.22, t0: 0.12 + i * 0.09 }); tone(c, { type: "sine", freq: f * 2, dur: 0.3, vol: 0.06, t0: 0.12 + i * 0.09 }); });
    if (mine) for (let i = 0; i < 6; i++) tone(c, { type: "sine", freq: 2000 + i * 300, dur: 0.15, vol: 0.06, t0: 0.6 + i * 0.06 });
  })(),
  // 放槍給別人：往下的悶聲
  lose: play((c) => { tone(c, { type: "sawtooth", freq: 330, to: 150, dur: 0.5, vol: 0.12 }); tone(c, { type: "sine", freq: 110, to: 70, dur: 0.4, vol: 0.3 }); }),
  // 流局
  exhaust: play((c) => { tone(c, { type: "triangle", freq: 392, dur: 0.35, vol: 0.16 }); tone(c, { type: "triangle", freq: 330, dur: 0.45, vol: 0.16, t0: 0.25 }); }),
  // 補花
  flower: play((c) => { clack(c, 0, 0.6, 1.2); tone(c, { type: "sine", freq: 1568, dur: 0.2, vol: 0.1, t0: 0.05 }); }),
};
