// 小朋友下樓梯 / 小朋友上樓梯：最多 4 人同場的物理模擬（60 tick/秒，全部由伺服器算）。
// 快照送給前端的座標已經是「畫面座標」，前端只負責畫。
export const W = 400, H = 640;
const PW = 92, KW = 22, KH = 30;
export const MAXHP = 12;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (table) => { let r = Math.random() * table.reduce((s, [, w]) => s + w, 0); for (const [v, w] of table) { if ((r -= w) <= 0) return v; } return table[0][0]; };

// 事件旗標（給前端放音效）
const EV_LAND = 1, EV_HEAL = 2, EV_HURT = 4, EV_SPRING = 8, EV_FLIP = 16, EV_DIE = 32;

// ───────────────────────────── 下樓梯（照原版 NS-SHAFT 的規則）─────────────────────────────
// ・場地是一口豎井：左右是牆，頂端一排刺。樓梯一層一層等距往上捲，「地下 N 階」大家共用。
// ・生命 12 格。踩到新的平台回 1 格；踩到釘板扣 5；被頂到天花板的刺扣 5，並且從腳下的平台穿過去掉下來。
// ・平台六種：普通、釘板、左輸送帶、右輸送帶、彈簧床（一直彈）、翻轉板（踩上去一下子就翻掉）。
// ・越往下捲得越快（每 5 階加速一次）。掉出畫面下緣或生命歸零就出局。
// 尺寸照原版畫面比例（場地接近正方形；平台約場寬 1/4；小人約半層樓高）
export const DW = 636, DH = 540, WALL = 26, ROW = 73, DPW = 146, CEIL = 26;
const DKW = 38, DKH = 38;          // 玩家是 38×38 的正方形實體（小人圖 28 寬置中）
const EARLY = [["normal", 72], ["left", 9], ["right", 9], ["tramp", 10]];
// 難度（原版也有 やさしい／ふつう／むずかしい：改變床的出現方式與捲動速度）
const DIFF = {
  easy:   { speed: 0.82, types: [["normal", 50], ["nails", 8], ["left", 10], ["right", 10], ["tramp", 12], ["fake", 10]] },
  normal: { speed: 1.0,  types: [["normal", 40], ["nails", 15], ["left", 10], ["right", 10], ["tramp", 10], ["fake", 15]] },
  hard:   { speed: 1.22, types: [["normal", 30], ["nails", 22], ["left", 11], ["right", 11], ["tramp", 8], ["fake", 18]] },
};

function newRow(sim, y) {
  const TYPES = DIFF[sim.diff].types;
  let type = pick(sim.rows < 6 ? EARLY : TYPES);
  if (type === "nails" && sim.lastType === "nails") type = pick(TYPES);     // 少一點連續釘板
  sim.lastType = type; sim.rows++;
  return { id: sim.nextId++, x: rnd(WALL, DW - WALL - DPW), y, w: DPW, type, t: 0, flip: false, bounce: 0 };
}

function createDown(seats, opt = {}) {
  const sim = { mode: "down", diff: DIFF[opt.diff] ? opt.diff : "normal", t: 0, nextId: 1, plats: [], ps: [], deaths: [], over: false, winner: -1,
                speed: 0, scrolled: 0, floor: 0, ready: 120, rows: 0, lastType: "normal" };
  const first = { id: sim.nextId++, x: DW / 2 - 90, y: 170, w: 180, type: "normal", t: 0, flip: false, bounce: 0 };
  sim.plats.push(first);
  for (let y = first.y + ROW; y < DH + ROW; y += ROW) sim.plats.push(newRow(sim, y));
  const n = seats.length;
  seats.forEach((s, k) => {
    const x = n === 1 ? DW / 2 - DKW / 2 : first.x + 8 + k * ((first.w - 16 - DKW) / (n - 1));
    sim.ps.push({ seat: s, x, y: first.y - DKH, vy: 0, hp: MAXHP, alive: true, score: 0, on: first, lastId: first.id,
                  hurt: 0, face: 1, pass: -1, ev: 0, walk: false });
  });
  return sim;
}

function land(p, pl) {
  const fresh = pl.id !== p.lastId;
  p.lastId = pl.id;
  p.y = pl.y - DKH;
  if (pl.type === "nails") { if (fresh) { p.hp -= 5; p.hurt = 40; p.ev |= EV_HURT; } }
  else if (fresh && pl.type !== "tramp" && p.hp < MAXHP) { p.hp++; p.ev |= EV_HEAL; }
  if (fresh) p.ev |= EV_LAND;
  if (pl.type === "tramp") { p.vy = -10.6; p.on = null; pl.bounce = 8; p.ev |= EV_SPRING; return; }
  p.vy = 0; p.on = pl;
  if (pl.type === "fake" && pl.t === 0) { pl.t = 1; p.ev |= EV_FLIP; }
}


// 玩家都是實體方塊，不能互相穿過：左右相撞互相擋住（各退一半，被牆擋住的那個由另一個讓），從上方落下就站在對方頭上。
function collidePlayers(sim) {
  const al = sim.ps.filter((q) => q.alive);
  for (const q of al) q.cr = false;
  for (let it = 0; it < 5; it++) {
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j];
      const px = Math.min(a.x, b.x) + DKW - Math.max(a.x, b.x), py = Math.min(a.y, b.y) + DKH - Math.max(a.y, b.y);
      if (px <= 0 || py <= 0) continue;
      if (py < px) {
        const up = a.y < b.y ? a : b, lo = up === a ? b : a;
        up.y = lo.y - DKH; up.vy = Math.min(up.vy, lo.vy < 0 ? lo.vy : 0); up.cr = true;
      } else {   // 左右相撞：像推箱子，往對方走的人把對方整個推著走；推不動（對方頂到牆）換自己被擋住
        const l = a.x < b.x ? a : b, r = l === a ? b : a, lim = (v) => Math.max(WALL, Math.min(DW - WALL - DKW, v));
        const lp = l.dir > 0, rp = r.dir < 0;          // l 往右推、r 往左推
        if (lp && !rp) { r.x = lim(r.x + px); l.x = lim(r.x - DKW); }
        else if (rp && !lp) { l.x = lim(l.x - px); r.x = lim(l.x + DKW); }
        else {
          l.x = lim(l.x - px / 2); r.x = lim(r.x + px / 2);
          const rest = l.x + DKW - r.x;
          if (rest > 0) { if (r.x < DW - WALL - DKW) r.x = lim(r.x + rest); if (l.x + DKW > r.x) l.x = lim(r.x - DKW); }
        }
      }
    }
  }
}

function stepDown(sim, input) {
  sim.t++;
  let sp = 0;
  if (sim.ready > 0) sim.ready--;
  else {
    const k = DIFF[sim.diff].speed;
    sp = sim.speed = Math.min(3.0 * k, (1.0 + Math.floor(sim.floor / 5) * 0.09) * k);
    sim.scrolled += sp;
    sim.floor = Math.floor(sim.scrolled / ROW);
  }
  for (const pl of sim.plats) {
    pl.y -= sp;
    if (pl.type === "fake" && pl.t > 0) { pl.t++; if (pl.t > 42) { pl.t = 0; pl.flip = false; } else if (pl.t > 18) pl.flip = true; }   // 1~18 踩上去還撐得住；19~42 翻下去再翻回來（不能踩）；42 之後恢復原樣可以再踩
    if (pl.bounce > 0) pl.bounce--;
  }
  sim.plats = sim.plats.filter((p) => p.y > -24);
  let last = sim.plats.reduce((m, p) => Math.max(m, p.y), -1e9);
  while (last < DH + ROW) { last += ROW; sim.plats.push(newRow(sim, last)); }

  for (const p of sim.ps) {
    if (!p.alive) continue;
    const inp = input[p.seat] || {};
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (dir) p.face = dir;
    p.dir = dir;
    p.walk = dir !== 0;
    if (p.hurt > 0) p.hurt--;
    let vx = dir * 4.6;
    const on = p.on;
    if (on && !on.flip && p.x + DKW > on.x + 4 && p.x < on.x + on.w - 4) {
      p.y = on.y - DKH; p.vy = 0;
      if (on.type === "left") vx -= 2.0; else if (on.type === "right") vx += 2.0;
    } else {
      p.on = null;
      const prevBottom = p.y + DKH;
      p.vy = Math.min(6.0, p.vy + 0.29);
      p.y += p.vy;
      const bottom = p.y + DKH;
      if (p.vy >= 0) {
        let hit = null;
        for (const pl of sim.plats) {
          if (pl.flip || pl.id === p.pass) continue;
          if (p.x + DKW > pl.x + 4 && p.x < pl.x + pl.w - 4 && bottom >= pl.y && prevBottom <= pl.y + sp + 2 && (!hit || pl.y < hit.y)) hit = pl;
        }
        if (hit) land(p, hit);
      }
    }
    p.x = Math.max(WALL, Math.min(DW - WALL - DKW, p.x + vx));
    if (p.y < CEIL) {                         // 被頂到天花板的刺：扣 5，從腳下的平台穿過去
      if (p.hurt <= 0) { p.hp -= 5; p.hurt = 60; p.ev |= EV_HURT; }
      if (p.on) { p.pass = p.on.id; p.on = null; }
      p.y = CEIL; p.vy = Math.max(p.vy, 1);
    }
    if (p.hp <= 0 || p.y > DH + 4) kill(sim, p);
  }
  collidePlayers(sim);
  checkEnd(sim);
}

// ───────────────────────────── 上樓梯（目前選單沒開放）─────────────────────────────
const UP_TYPES = [["normal", 64], ["move", 14], ["spring", 7], ["fragile", 15]];
const GROUND = H - 30;

function upPlat(sim, y, type) {
  const t = type || pick(UP_TYPES);
  const x = rnd(0, W - PW);
  return { id: sim.nextId++, x, x0: x, y, w: PW, type: t, ph: rnd(0, 6.28), amp: rnd(40, 110), t: 0 };
}

function createUp(seats) {
  const sim = { mode: "up", t: 0, nextId: 1, plats: [], ps: [], deaths: [], over: false, winner: -1, cam: 0, topY: GROUND, prevFragile: false, speed: 0 };
  sim.plats.push({ id: sim.nextId++, x: 0, x0: 0, y: GROUND, w: W, type: "normal", ph: 0, amp: 0, t: 0 });
  let k = 0;
  for (const s of seats) sim.ps.push({ seat: s, x: 70 + (k++) * 70, y: GROUND - KH, vx: 0, vy: -11, hp: 1, alive: true, score: 0, face: 1, best: 0, ev: 0 });
  return sim;
}

function stepUp(sim, input) {
  sim.t++;
  const auto = sim.speed = Math.min(1.7, 0.25 + sim.t / 5400);
  for (const pl of sim.plats) {
    if (pl.type === "move") pl.x = Math.max(0, Math.min(W - pl.w, pl.x0 + Math.sin(sim.t * 0.02 + pl.ph) * pl.amp * 0.5));
  }
  let topAlive = Infinity;
  for (const p of sim.ps) {
    if (!p.alive) continue;
    const inp = input[p.seat] || {};
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (dir) p.face = dir;
    p.x += dir * 3.6;
    if (p.x < -KW) p.x = W; else if (p.x > W) p.x = -KW;
    const prevBottom = p.y + KH;
    p.vy = Math.min(13, p.vy + 0.4);
    p.y += p.vy;
    if (p.vy > 0) {
      const bottom = p.y + KH;
      let hit = null;
      for (const pl of sim.plats) {
        if (pl.gone) continue;
        if (p.x + KW > pl.x + 2 && p.x < pl.x + pl.w - 2 && bottom >= pl.y && prevBottom <= pl.y + 3 && (!hit || pl.y < hit.y)) hit = pl;
      }
      if (hit) {
        p.y = hit.y - KH;
        p.vy = hit.type === "spring" ? -17 : -11.4;
        if (hit.type === "fragile") hit.gone = true;
      }
    }
    p.best = Math.max(p.best, Math.floor((GROUND - (p.y + KH)) / 10));
    p.score = p.best;
    topAlive = Math.min(topAlive, p.y);
  }
  sim.cam = Math.min(sim.cam - auto, topAlive === Infinity ? sim.cam : topAlive - H * 0.45);
  while (sim.topY > sim.cam - 240) {
    sim.topY -= rnd(58, 108);
    const pl = upPlat(sim, sim.topY, sim.prevFragile ? "normal" : null);
    sim.prevFragile = pl.type === "fragile";
    sim.plats.push(pl);
  }
  sim.plats = sim.plats.filter((p) => !p.gone && p.y < sim.cam + H + 60);
  for (const p of sim.ps) if (p.alive && p.y > sim.cam + H + 10) kill(sim, p);
  checkEnd(sim);
}

// ───────────────────────────── 共用 ─────────────────────────────
function kill(sim, p) {
  p.alive = false; p.hp = Math.max(0, p.hp);
  if (sim.mode === "down") p.score = sim.floor;
  p.ev = (p.ev || 0) | EV_DIE;
  sim.deaths.push(p.seat);
}
function checkEnd(sim) {
  const alive = sim.ps.filter((p) => p.alive);
  const multi = sim.ps.length >= 2;
  if (sim.mode === "down") {
    // 下樓梯：大家都出局才結束（最後一個人可以繼續往下挑戰紀錄），最後出局的人獲勝
    if (alive.length === 0) { sim.over = true; if (multi) sim.winner = sim.deaths[sim.deaths.length - 1]; }
    return;
  }
  if (alive.length === 0 || (multi && alive.length === 1)) {
    sim.over = true;
    if (multi && alive.length === 1) sim.winner = alive[0].seat;
    if (sim.mode === "down") for (const p of alive) p.score = sim.floor;
  }
}

export function create(mode, seats, opt) { return mode === "up" ? createUp(seats) : createDown(seats, opt); }
export function step(sim, input) { return sim.mode === "up" ? stepUp(sim, input) : stepDown(sim, input); }
export function clearEvents(sim) { for (const p of sim.ps) p.ev = 0; }

// 名次：贏家第一，其餘依出局先後（晚出局的在前）
export function ranking(sim) {
  const order = [];
  if (sim.winner >= 0) order.push(sim.winner);
  for (const s of [...sim.deaths].reverse()) if (!order.includes(s)) order.push(s);
  return order.map((seat) => { const p = sim.ps.find((q) => q.seat === seat); return { seat, score: p ? p.score : 0 }; });
}

const r1 = (v) => Math.round(v * 10) / 10;
export function snapshot(sim) {
  if (sim.mode === "down") {
    return {
      mode: "down", diff: sim.diff, speed: r1(sim.ready > 0 ? 0 : sim.speed), floor: sim.floor, ready: sim.ready,
      ps: sim.ps.map((p) => ({ s: p.seat, x: r1(p.x), y: r1(p.y), hp: p.hp, a: p.alive ? 1 : 0, sc: p.alive ? sim.floor : p.score,
                                f: p.face, h: p.hurt > 0 ? 1 : 0, g: p.on || p.cr ? 1 : 0, w: p.walk ? 1 : 0, ev: p.ev || 0 })),
      pl: sim.plats.map((p) => [p.id, Math.round(p.x), r1(p.y), p.w, p.type, p.t, p.flip ? 1 : 0, p.bounce]),
    };
  }
  const cam = sim.cam;
  return {
    mode: "up", speed: r1(sim.speed),
    ps: sim.ps.map((p) => ({ s: p.seat, x: r1(p.x), y: r1(p.y - cam), hp: p.hp, a: p.alive ? 1 : 0, sc: p.score, f: p.face, h: 0, g: p.vy < 0 ? 0 : 1, w: 1, ev: p.ev || 0 })),
    pl: sim.plats.map((p) => [p.id, Math.round(p.x), r1(p.y - cam), p.w, p.type, 0, 0, 0]),
  };
}
