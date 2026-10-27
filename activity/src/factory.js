// 自動化工廠（原型）：把礦挖出來、熔成鐵板、做成齒輪，用傳送帶送去出貨口換錢。
import { W, H, DX, DY, BELT_STEP, KINDS, ITEMS, RECIPES, makeOre, newGame, place, remove, cycleRecipe, step, perMinute, serialize, load } from "./factory_sim.js";

const CELL = 40, SAVE_KEY = "factory_v1";
const TOOLS = [
  ["belt", "➡️", "傳送帶"], ["splitter", "🔀", "分流器"], ["miner", "⛏️", "採礦機"], ["smelter", "🔥", "熔爐"],
  ["assembler", "⚙️", "組裝機"], ["recipe", "📋", "配方"], ["shipper", "📦", "出貨口"], ["erase", "🧹", "拆除"],
];
const COLOR = { miner: "#8d6e3f", smelter: "#b5532b", assembler: "#2f6fa8", shipper: "#3d8b57", splitter: "#7b5ea7" };
const ICON = { miner: "⛏", smelter: "♨", assembler: "⚙", shipper: "▣", splitter: "⑃" };

export function mountFactory(root, { env, back }) {
  root.innerHTML = `
    <div class="game gomoku factory">
      <header><button class="back">← 選單</button><h2>自動化工廠</h2><span class="right fmoney"></span></header>
      <div class="status fstat"></div>
      <div class="cwrap"><canvas width="${W * CELL}" height="${H * CELL}"></canvas></div>
      <div class="ftools"></div>
      <div class="factions"><button class="frot">方向 ➡️（R）</button><button class="freset">清空重來</button></div>
      <div class="fprice"></div><div class="fhelp">拖曳鋪傳送帶（會自動轉彎）。<b>採礦機</b>放在褐色礦點上 → 傳送帶 → <b>熔爐</b>（礦變鐵板）→ <b>組裝機</b>（2 鐵板變齒輪）→ <b>出貨口</b>換錢。機器上的小箭頭是出口方向，用「方向」鍵旋轉。<b>分流器</b>會把東西輪流丟給前、右、左三個方向。<b>配方</b>工具點組裝機可切換：齒輪、電線（銅板）、電路板（鐵板＋電線）、馬達（齒輪＋電路板＋銅板）。</div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const ore = makeOre();
  let g;
  try { g = load(JSON.parse(localStorage.getItem(SAVE_KEY) || "null")); } catch { g = newGame(); }
  let tool = "belt", rot = 0, msg = "", msgAt = 0, closed = false, raf = 0, acc = 0, last = performance.now(), saveAt = 0;
  const ARROW = ["➡️", "⬇️", "⬅️", "⬆️"];

  const bar = $(".ftools");
  bar.innerHTML = TOOLS.map(([k, ic, nm]) => `<button data-k="${k}" class="${k === tool ? "sel" : ""}"><span>${ic}</span><b>${nm}</b><small>${k === "erase" ? "退一半" : k === "recipe" ? "點組裝機" : "$" + KINDS[k].cost}</small></button>`).join("");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    tool = b.dataset.k; bar.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
  });
  const rotate = () => { rot = (rot + 1) & 3; $(".frot").textContent = `方向 ${ARROW[rot]}（R）`; };
  $(".frot").addEventListener("click", rotate);
  let armed = 0;
  $(".freset").addEventListener("click", (e) => {          // Activity 裡不能用 confirm()，改成按兩次
    if (!armed) { armed = setTimeout(() => { armed = 0; e.target.textContent = "清空重來"; }, 3000); e.target.textContent = "再按一次確定清空"; return; }
    clearTimeout(armed); armed = 0; e.target.textContent = "清空重來"; g = newGame(); persist();
  });
  $(".back").addEventListener("click", () => { cleanup(); back(); });
  const kd = (e) => { if (e.key === "r" || e.key === "R") rotate(); };
  window.addEventListener("keydown", kd);

  const recipeText = (r) => { const R = RECIPES[r]; return Object.entries(R.in).map(([k, n]) => `${n}${ITEMS[k].name}`).join("＋") + " → " + (R.n > 1 ? R.n : "") + ITEMS[R.make].name; };
  const say = (t) => { msg = t; msgAt = performance.now(); };
  const cellAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H)];
  };
  let drag = null;      // { prev:[x,y] }
  const apply = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (tool === "erase") { remove(g, x, y); return; }
    if (tool === "recipe") { if (!drag || !drag.prev) { if (cycleRecipe(g, x, y)) say("配方：" + recipeText(g.cells[y * W + x].r)); else say("要點在組裝機上"); } return; }
    let d = rot;
    if (tool === "belt" && drag && drag.prev && (drag.prev[0] !== x || drag.prev[1] !== y)) {   // 拖曳方向決定傳送帶方向
      const dx = x - drag.prev[0], dy = y - drag.prev[1];
      d = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      const pc = g.cells[drag.prev[1] * W + drag.prev[0]];
      if (pc && pc.k === "belt") pc.dir = d;
      rot = d;
    }
    const err = place(g, ore, x, y, tool, d);
    if (err) say(err);
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = cellAt(e); drag = { prev: null }; apply(x, y); drag.prev = [x, y];
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = cellAt(e);
    if (drag.prev && drag.prev[0] === x && drag.prev[1] === y) return;
    if (drag.prev && Math.abs(x - drag.prev[0]) + Math.abs(y - drag.prev[1]) > 1) { drag.prev = [x, y]; return; }   // 滑太快跳格就不補
    apply(x, y); drag.prev = [x, y];
  });
  const up = () => { drag = null; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(g))); } catch {} }

  // ---- 畫面
  function draw() {
    ctx.fillStyle = "#1c2330"; ctx.fillRect(0, 0, W * CELL, H * CELL);
    ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H * CELL); ctx.stroke(); }
    for (let y = 0; y <= H; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W * CELL, y * CELL); ctx.stroke(); }
    for (const [i, t] of ore) {
      const x = (i % W) * CELL, y = Math.floor(i / W) * CELL;
      ctx.fillStyle = t === "copper" ? "#4a2f24" : "#3a3f4a"; ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = t === "copper" ? "#d98b5f" : "#9aa7b8"; for (const [dx, dy] of [[9, 10], [24, 14], [14, 26], [28, 28]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 3.5, 0, 7); ctx.fill(); }
    }
    const frac = (g.tick % BELT_STEP) / BELT_STEP;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = g.cells[y * W + x]; if (!c) continue;
      const px = x * CELL, py = y * CELL;
      if (c.k === "belt") {
        ctx.fillStyle = "#39414f"; ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
        ctx.save(); ctx.translate(px + CELL / 2, py + CELL / 2); ctx.rotate(c.dir * Math.PI / 2);
        ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, -7); ctx.lineTo(3, 0); ctx.lineTo(-6, 7); ctx.stroke(); ctx.restore();
      } else {
        ctx.fillStyle = COLOR[c.k]; ctx.beginPath(); ctx.roundRect(px + 3, py + 3, CELL - 6, CELL - 6, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ICON[c.k], px + CELL / 2, py + CELL / 2);
        if (c.k !== "shipper") {                                   // 出口方向（分流器的箭頭是「前方」）
          ctx.save(); ctx.translate(px + CELL / 2, py + CELL / 2); ctx.rotate(c.dir * Math.PI / 2);
          ctx.fillStyle = "#ffe082"; ctx.beginPath(); ctx.moveTo(CELL / 2 - 2, 0); ctx.lineTo(CELL / 2 - 10, -6); ctx.lineTo(CELL / 2 - 10, 6); ctx.fill(); ctx.restore();
          const n = Object.values(c.inv).reduce((a, b) => a + b, 0);
          if (n) { ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left"; ctx.fillText(n, px + 6, py + 9); }
          if (c.k === "assembler") { ctx.fillStyle = ITEMS[RECIPES[c.r].make].color; ctx.beginPath(); ctx.arc(px + CELL - 9, py + 9, 5, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }
        }
      }
      const item = c.k === "belt" || c.k === "splitter" ? c.item : c.out[0];
      if (item) {
        let ox = 0, oy = 0;
        if (c.k === "belt") { const back = c.ago < BELT_STEP ? 1 - (c.ago + frac * 0) / BELT_STEP : 0; ox = -DX[c.dir] * back * CELL * 0.8; oy = -DY[c.dir] * back * CELL * 0.8; }
        ctx.fillStyle = ITEMS[item].color; ctx.beginPath(); ctx.arc(px + CELL / 2 + ox, py + CELL / 2 + oy, item === "gear" || item === "motor" ? 7 : 6, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
        if (item === "gear") { ctx.fillStyle = "#1c2330"; ctx.beginPath(); ctx.arc(px + CELL / 2 + ox, py + CELL / 2 + oy, 2.5, 0, 7); ctx.fill(); }
      }
    }
  }
  let priceDone = false;
  function hud() {
    $(".fmoney").textContent = `💰 ${g.money}`;
    if (!priceDone) { priceDone = true; $(".fprice").innerHTML = Object.values(ITEMS).map((it) => `<span><i style="background:${it.color}"></i>${it.name} $${it.value}</span>`).join(""); }
    const t = performance.now() - msgAt < 2500 ? msg : "";
    $(".fstat").textContent = t || `每分鐘出貨 $${perMinute(g)}　累計出貨 $${g.shipped}　`;
  }

  // ---- 主迴圈：固定 10 tick/秒
  function frame(now) {
    if (closed) return;
    acc += Math.min(1000, now - last); last = now;
    while (acc >= 100) { step(g); acc -= 100; }
    draw(); hud();
    if (now - saveAt > 5000) { saveAt = now; persist(); }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  function cleanup() { closed = true; cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); persist(); }
  return cleanup;
}
