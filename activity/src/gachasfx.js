// 水墨卡冊音效：全部用 Web Audio 即時合成（不需要音檔），走五聲音階，帶一點古箏、木魚、銅鑼的味道。
// 音量和靜音由右下角的 🔊 統一控制（見 sfx.js 把 AudioContext 包了一層總音量）。
let ac = null, master = null;
function ctx() {
  try {
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.34; master.connect(ac.destination); }
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
const N = (semi) => 261.63 * Math.pow(2, semi / 12);                      // 以 C4 為基準
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];                       // 宮商角徵羽，往上兩個八度
const noiseSrc = (c, dur) => {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
};
function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }

// 古箏撥弦：三角波＋泛音，急起緩落
function pluck(c, f, t0 = 0, vol = 0.5, dur = 0.9) {
  const t = c.currentTime + t0;
  for (const [mul, v, type] of [[1, 1, "triangle"], [2, 0.35, "sine"], [3, 0.12, "sine"]]) {
    const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
    o.type = type; o.frequency.value = f * mul; fl.type = "lowpass"; fl.frequency.setValueAtTime(4200, t); fl.frequency.exponentialRampToValueAtTime(700, t + dur);
    env(g, t, 0.004, vol * v, dur); o.connect(fl); fl.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
}
// 銅鑼／磬：不協和的泛音，長尾
function gong(c, f = 110, t0 = 0, vol = 0.5, dur = 2.4) {
  const t = c.currentTime + t0;
  for (const [mul, v] of [[1, 1], [1.5, 0.55], [2.76, 0.4], [4.1, 0.25], [5.4, 0.15]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = f * mul; env(g, t, 0.012, vol * v, dur * (1.1 - mul * 0.1)); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
}
// 小磬／風鈴：高而短的亮音
function chime(c, f, t0 = 0, vol = 0.3, dur = 1.1) {
  const t = c.currentTime + t0;
  for (const [mul, v] of [[1, 1], [2.4, 0.4], [3.9, 0.18]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = f * mul; env(g, t, 0.003, vol * v, dur / mul ** 0.4); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
}
// 鼓：音高快速下掉的正弦＋一小段低頻雜訊
function drum(c, t0 = 0, vol = 0.6, f = 150, dur = 0.4) {
  const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.35, t + dur);
  env(g, t, 0.004, vol, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  const s = noiseSrc(c, 0.08), fl = c.createBiquadFilter(), ng = c.createGain();
  fl.type = "lowpass"; fl.frequency.value = 500; ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  s.connect(fl); fl.connect(ng); ng.connect(master); s.start(t);
}
// 木魚：短促的木頭敲擊
function wood(c, t0 = 0, vol = 0.5, f = 720) {
  const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
  o.type = "square"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.05);
  const fl = c.createBiquadFilter(); fl.type = "bandpass"; fl.frequency.value = f; fl.Q.value = 4;
  env(g, t, 0.002, vol, 0.09); o.connect(fl); fl.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
}
// 毛筆／紙張的沙沙聲：帶通雜訊，頻率掃過
function swish(c, t0 = 0, dur = 0.25, vol = 0.35, from = 1200, to = 3200) {
  const t = c.currentTime + t0, s = noiseSrc(c, dur), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = "bandpass"; fl.Q.value = 0.9; fl.frequency.setValueAtTime(from, t); fl.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
}
// 墨滴入水：音高下滑的「咚」
function drop(c, t0 = 0, vol = 0.5, f = 520) {
  const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.22);
  env(g, t, 0.006, vol, 0.28); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32);
}
// 銅錢叮噹
function coin(c, t0 = 0, vol = 0.3, f = 2200) { chime(c, f, t0, vol, 0.35); chime(c, f * 1.5, t0 + 0.05, vol * 0.7, 0.3); }

const run = (fn) => { const c = ctx(); if (!c) return; try { fn(c); } catch {} };
export const sfx = {
  unlock: () => { ctx(); },                                                                           // 第一次點擊時先把音訊打開（瀏覽器規定要使用者操作過才能出聲）
  tap: () => run((c) => wood(c, 0, 0.32, 820)),
  tab: () => run((c) => { wood(c, 0, 0.3, 640); swish(c, 0.02, 0.12, 0.12, 2000, 3500); }),
  err: () => run((c) => { drum(c, 0, 0.5, 90, 0.35); wood(c, 0.02, 0.3, 300); }),
  place: () => run((c) => { wood(c, 0, 0.5, 700); pluck(c, N(PENT[3]), 0.04, 0.3, 0.6); }),         // 展示櫃擺上去
  take: () => run((c) => { swish(c, 0, 0.18, 0.25, 2800, 900); }),                                 // 拿下來
  // ---- 抽卡：落墨 → 悶鼓蓄力（稀有度越高越久、越重）
  summon: (r) => run((c) => {
    drop(c, 0, 0.55, 560); swish(c, 0.05, 0.9, 0.18, 400, 1500);
    const hits = r === "SSR" ? 5 : r === "SR" ? 3 : 2;
    for (let i = 0; i < hits; i++) drum(c, 0.45 + i * (r === "SSR" ? 0.34 : 0.4), 0.38 + i * 0.07, 130 - i * 8, 0.45);
    if (r === "SSR") { gong(c, 82, 2.1, 0.3, 2.6); swish(c, 1.2, 1.2, 0.2, 500, 5000); }
  }),
  flip: () => run((c) => { swish(c, 0, 0.16, 0.3, 1800, 4200); wood(c, 0.1, 0.2, 900); }),            // 翻牌
  reveal: (r, isNew) => run((c) => {
    if (r === "N") { pluck(c, N(PENT[2]), 0, 0.4, 0.7); }
    else if (r === "R") { pluck(c, N(PENT[2]), 0, 0.45, 0.8); pluck(c, N(PENT[4]), 0.1, 0.45, 0.9); }
    else if (r === "SR") { [3, 5, 6, 8].forEach((k, i) => pluck(c, N(PENT[k]), i * 0.09, 0.5, 1.1)); chime(c, N(PENT[9]), 0.38, 0.28, 1.4); gong(c, 130, 0, 0.22, 1.6); }
    else { [2, 4, 5, 7, 8, 10].forEach((k, i) => pluck(c, N(PENT[k]), i * 0.08, 0.55, 1.4)); gong(c, 98, 0, 0.5, 3.2); chime(c, N(PENT[10]), 0.55, 0.35, 2); chime(c, N(PENT[8]) * 2, 0.7, 0.25, 2.2); swish(c, 0, 0.7, 0.25, 800, 6000); }
    if (isNew) chime(c, 2600, r === "SSR" ? 0.9 : 0.25, 0.22, 0.5);                                   // NEW 的小「叮」
  }),
  reward: () => run((c) => { [0, 2, 4, 5, 7].forEach((k, i) => pluck(c, N(PENT[k + 2]), i * 0.1, 0.5, 1)); gong(c, 110, 0.5, 0.3, 2); }),   // 圖鑑獎勵／集滿卡組
  sign: () => run((c) => { chime(c, N(PENT[6]), 0, 0.35, 1.2); chime(c, N(PENT[8]), 0.12, 0.3, 1.4); }),
  star: () => run((c) => { [3, 5, 6, 8].forEach((k, i) => chime(c, N(PENT[k + 2]), i * 0.08, 0.3, 0.9)); gong(c, 196, 0.2, 0.18, 1.2); }),     // 升星
  swap: () => run((c) => { swish(c, 0, 0.3, 0.3, 600, 2800); pluck(c, N(PENT[5]), 0.2, 0.5, 1); chime(c, N(PENT[8]), 0.28, 0.3, 1); }),    // 兌換新卡
  salvage: () => run((c) => { for (let i = 0; i < 4; i++) coin(c, i * 0.07, 0.22, 1800 + i * 260); drop(c, 0.3, 0.3, 400); }),             // 分解成墨點
  send: () => run((c) => { drum(c, 0, 0.55, 120, 0.4); drum(c, 0.18, 0.5, 140, 0.35); swish(c, 0.1, 0.5, 0.2, 900, 3000); pluck(c, N(PENT[3]), 0.4, 0.4, 0.8); }),   // 派遣出發
  claim: () => run((c) => { for (let i = 0; i < 6; i++) coin(c, i * 0.08, 0.26, 1900 + (i % 3) * 300); pluck(c, N(PENT[5]), 0.45, 0.4, 1); }),    // 領回墨點
  recall: () => run((c) => { swish(c, 0, 0.3, 0.25, 3000, 800); wood(c, 0.25, 0.3, 500); }),
};
