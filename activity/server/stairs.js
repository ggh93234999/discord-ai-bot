// 小朋友下樓梯 / 小朋友上樓梯：最多 4 人同場的物理模擬（60 tick/秒，全部由伺服器算）。
// 座標：寬 400、高 640 的「螢幕座標」；快照送給前端的 y 已經是螢幕座標，前端只負責畫。
export const W = 400, H = 640;
const PW = 92, PH = 12, KW = 22, KH = 30;
export const MAXHP = 12;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (table) => { let r = Math.random() * table.reduce((s, [, w]) => s + w, 0); for (const [v, w] of table) { if ((r -= w) <= 0) return v; } return table[0][0]; };

// ───────────────────────────── 下樓梯 ─────────────────────────────
// 樓梯往上捲，人往下掉；頭頂有天花板的刺，掉出畫面下緣就死。踩平台回血，踩刺扣血。
// 依原版 NS-SHAFT：普通（回 1 血）、釘板（-5）、左右傳送帶、跳板、翻板（站一下就翻）、消失（踩一下就沒）
const DOWN_TYPES = [["normal", 40], ["spike", 14], ["left", 8], ["right", 8], ["spring", 8], ["flip", 11], ["vanish", 11]];

function downPlat(sim, y, type) {
  return { id: sim.nextId++, x: rnd(0, W - PW), y, w: PW, type: type || pick(DOWN_TYPES), t: 0 };
}

function createDown(seats) {
  const sim = { mode: "down", t: 0, nextId: 1, plats: [], ps: [], deaths: [], over: false, winner: -1, speed: 1 };
  const first = { id: sim.nextId++, x: W / 2 - 90, y: 300, w: 180, type: "normal", t: 0 };
  sim.plats.push(first);
  for (let y = 300 + 80; y < H + 120; y += rnd(72, 96)) sim.plats.push(downPlat(sim, y));
  sim.plats[1].type = "normal";
  let k = 0;
  for (const s of seats) sim.ps.push({ seat: s, x: 130 + (k++) * 38, y: 300 - KH, vx: 0, vy: 0, hp: MAXHP, alive: true, score: 0, on: first, lastId: first.id, hurt: 0, face: 1 });
  return sim;
}

function stepDown(sim, input) {
  sim.t++;
  // 上捲速度隨「層數」加快（原版是越往下越快）：用場上最深的人的層數
  const depth = sim.ps.reduce((m, p) => Math.max(m, p.score), 0);
  const sp = sim.speed = Math.min(3.4, 1.0 + depth / 40);
  for (const p of sim.plats) p.y -= sp;
  sim.plats = sim.plats.filter((p) => p.y > -24 && !p.gone);
  let last = sim.plats.reduce((m, p) => Math.max(m, p.y), -1e9);
  while (last < H + 60) { last += rnd(70, 98); sim.plats.push(downPlat(sim, last)); }

  for (const p of sim.ps) {
    if (!p.alive) continue;
    const inp = input[p.seat] || {};
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    let vx = dir * 3.0;
    if (dir) p.face = dir;
    if (p.hurt > 0) p.hurt--;
    const on = p.on;
    if (on && !on.gone && p.x + KW > on.x && p.x < on.x + on.w) {
      p.y = on.y - KH; p.vy = 0;
      if (on.type === "left") vx -= 1.5; else if (on.type === "right") vx += 1.5;
      if (on.type === "flip") { on.t++; if (on.t > 26) { on.gone = true; p.on = null; } }
      else if (on.type === "vanish") { on.t++; if (on.t > 9) { on.gone = true; p.on = null; } }
    } else {
      p.on = null;
      const prevBottom = p.y + KH;
      p.vy = Math.min(7.5, p.vy + 0.36);
      p.y += p.vy;
      const bottom = p.y + KH;
      if (p.vy > 0) {
        let hit = null;
        for (const pl of sim.plats) {
          if (pl.gone) continue;
          if (p.x + KW > pl.x + 2 && p.x < pl.x + pl.w - 2 && bottom >= pl.y && prevBottom <= pl.y + sp + 5 && (!hit || pl.y < hit.y)) hit = pl;
        }
        if (hit) {
          p.y = hit.y - KH; p.vy = 0; p.on = hit;
          if (hit.id !== p.lastId) {
            p.lastId = hit.id; p.score++;
            if (hit.type === "spike") { p.hp -= 5; p.hurt = 30; } else p.hp = Math.min(MAXHP, p.hp + 1);
          }
          if (hit.type === "spring") { p.vy = -11.5; p.on = null; }
        }
      }
    }
    p.x = Math.max(0, Math.min(W - KW, p.x + vx));
    if (p.y < 28) {                          // 天花板的刺
      if (p.hurt <= 0) { p.hp -= 5; p.hurt = 50; }
      p.y = 28; p.vy = Math.max(p.vy, 1.5); p.on = null;
    }
    if (p.hp <= 0 || p.y > H + 10) kill(sim, p);
  }
  checkEnd(sim);
}

// ───────────────────────────── 上樓梯 ─────────────────────────────
// 人自動彈跳，只要左右移動；一路往上爬，畫面慢慢往上捲，掉到畫面下緣就淘汰。
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
  for (const s of seats) sim.ps.push({ seat: s, x: 70 + (k++) * 70, y: GROUND - KH, vx: 0, vy: -11, hp: 1, alive: true, score: 0, face: 1, best: 0 });
  return sim;
}

function stepUp(sim, input) {
  sim.t++;
  const auto = sim.speed = Math.min(1.7, 0.25 + sim.t / 5400);
  // 平台：移動型左右擺動、碎裂型踩過後掉落
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
  // 鏡頭：永遠往上，最高的人在畫面約 45% 的位置；另外有最低速度往上捲
  sim.cam = Math.min(sim.cam - auto, topAlive === Infinity ? sim.cam : topAlive - H * 0.45);
  // 補平台
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
  sim.deaths.push(p.seat);
}
function checkEnd(sim) {
  const alive = sim.ps.filter((p) => p.alive);
  const multi = sim.ps.length >= 2;
  if (alive.length === 0 || (multi && alive.length === 1)) {
    sim.over = true;
    if (multi && alive.length === 1) sim.winner = alive[0].seat;
  }
}

export function create(mode, seats) { return mode === "up" ? createUp(seats) : createDown(seats); }
export function step(sim, input) { return sim.mode === "up" ? stepUp(sim, input) : stepDown(sim, input); }

// 名次：贏家第一，其餘依死亡先後（晚死的在前）；還活著（單人結束不會有）排最前
export function ranking(sim) {
  const order = [];
  if (sim.winner >= 0) order.push(sim.winner);
  for (const s of [...sim.deaths].reverse()) if (!order.includes(s)) order.push(s);
  return order.map((seat) => { const p = sim.ps.find((q) => q.seat === seat); return { seat, score: p ? p.score : 0 }; });
}

export function snapshot(sim) {
  const cam = sim.mode === "up" ? sim.cam : 0;
  return {
    mode: sim.mode, speed: Math.round(sim.speed * 100) / 100,
    ps: sim.ps.map((p) => ({ s: p.seat, x: Math.round(p.x * 10) / 10, y: Math.round((p.y - cam) * 10) / 10, hp: p.hp, a: p.alive ? 1 : 0, sc: p.score, f: p.face, h: p.hurt > 0 ? 1 : 0, g: sim.mode === "down" ? (p.on ? 1 : 0) : (p.vy < 0 ? 0 : 1) })),
    pl: sim.plats.map((p) => [p.id, Math.round(p.x), Math.round((p.y - cam) * 10) / 10, p.w, p.type, (p.type === "fragile" || p.type === "flip" || p.type === "vanish") ? p.t : 0]),
  };
}
