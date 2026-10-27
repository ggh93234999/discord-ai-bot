// 自動化工廠（原型）：把礦挖出來、熔成鐵板、做成齒輪等產品，用傳送帶送去出貨口換錢。
import { W, H, DX, DY, BELT_STEP, KINDS, ITEMS, RECIPES, POWER_USE, POWER_PRICE, makeOre, newGame, canPlace, place, remove, setRecipe, machineState, step, perMinute, powerRate, buyPower, serialize, load } from "./factory_sim.js";

const CELL = 40, SAVE_KEY = "factory_v1", SEEN_KEY = "factory_help_seen";
const TOOLS = [
  { k: "inspect",  ic: "👆", nm: "檢視",   tip: "點機器看它在做什麼、缺什麼；點組裝機還能直接選配方。這個工具不會放東西，也不會花錢。" },
  { k: "belt",     ic: "➡️", nm: "傳送帶", tip: "按住拖曳來鋪：拖的方向就是帶子的方向，轉彎會自動接好。物品只往帶子的箭頭方向走。" },
  { k: "splitter", ic: "🔀", nm: "分流器", tip: "收到的東西會輪流丟給「前、右、左」三個方向（箭頭是前方）；哪邊收不下就跳過那邊。拿一個出口接出貨口，多出來的東西就不會塞住。" },
  { k: "miner",    ic: "⛏️", nm: "採礦機", tip: "只能放在礦點上（灰色是鐵礦、橘色是銅礦）。機器上的黃色小箭頭是出口，產出會推給那一格。" },
  { k: "smelter",  ic: "🔥", nm: "熔爐",   tip: "鐵礦熔成鐵板、銅礦熔成銅板。把帶子接進來，出口那格接下一段帶子。" },
  { k: "assembler", ic: "⚙️", nm: "組裝機", tip: "照配方把材料組裝成新東西。剛放下去預設做齒輪，用「檢視」點它可以換配方。" },
  { k: "shipper",  ic: "📦", nm: "出貨口", tip: "什麼東西都收，按售價換成錢。可以接在任何東西的出口。" },
  { k: "erase",    ic: "🧹", nm: "拆除",   tip: "點或拖曳經過就拆掉，退回一半的錢。" },
];
const COLOR = { miner: "#8d6e3f", smelter: "#b5532b", assembler: "#2f6fa8", shipper: "#3d8b57", splitter: "#7b5ea7" };
const ICON = { miner: "⛏", smelter: "♨", assembler: "⚙", shipper: "▣", splitter: "⑃" };
const STATE_COLOR = { work: "#66bb6a", wait: "#ffca28", blocked: "#ef5350" };
const DIRN = ["右", "下", "左", "上"], ARROW = ["➡️", "⬇️", "⬅️", "⬆️"];
const recipeText = (R) => Object.entries(R.in).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(" ＋ ") + " → " + R.n + " " + ITEMS[R.make].name;

export function mountFactory(root, { env, back }) {
  const seen = (() => { try { return !!localStorage.getItem(SEEN_KEY); } catch { return false; } })();
  root.innerHTML = `
    <div class="game gomoku factory">
      <header><button class="back">← 選單</button><h2>自動化工廠</h2><span class="right fmoney"></span></header>
      <div class="status fstat"></div>
      <div class="cwrap"><canvas width="${W * CELL}" height="${H * CELL}"></canvas></div>
      <div class="fpower"></div>
      <div class="finfo"></div>
      <div class="ftools"></div>
      <div class="ftip"></div>
      <div class="factions"><button class="frot"></button><button class="freset">清空重來</button></div>
      <div class="fprice"></div>
      <div class="fhelp">
        <details class="fh" ${seen ? "" : "open"}><summary>快速上手（4 步）</summary>
          <ol>
            <li><b>採礦機</b>放在礦點上（灰色＝鐵礦、橘色＝銅礦）。</li>
            <li>用<b>傳送帶</b>（按住拖曳）把礦送進<b>熔爐</b>，熔成鐵板或銅板。</li>
            <li>板子可以直接賣，也可以送進<b>組裝機</b>做成更值錢的東西。</li>
            <li>最後接到<b>出貨口</b>換錢，再拿錢蓋更多機器。</li>
          </ol>
          <p>每台機器的黃色小箭頭是<b>出口方向</b>，放之前先用「方向」鈕（或鍵盤 R）轉好；放錯了，用「方向」再點一次同一台機器也能轉。</p>
        </details>
        <details class="fh"><summary>配方表</summary>
          <div class="frec">${RECIPES.map((R) => `<div><i style="background:${ITEMS[R.make].color}"></i><b>${ITEMS[R.make].name}</b> $${ITEMS[R.make].value}<span>${recipeText(R)}（${(R.time / 10).toFixed(0)} 秒）</span></div>`).join("")}
            <div><i style="background:${ITEMS.iron_plate.color}"></i><b>熔爐</b><span>1 鐵礦 → 1 鐵板；1 銅礦 → 1 銅板（2 秒）</span></div></div>
          <p>組裝機剛放下是做齒輪；用「檢視」點它，下面的面板可以選配方。換配方會清空機器裡的材料。</p>
        </details>
        <details class="fh"><summary>電費（用完就停工）</summary>
          <p>每台機器每分鐘都會耗電，電用完<b>整座工廠立刻停工</b>（帶子、機器全部停住，不會損失東西），儲值之後從原地繼續。</p>
          <div class="frec">${Object.entries(POWER_USE).map(([k, v]) => `<div><b>${KINDS[k].name}</b><span>每分鐘 ${v} 度</span></div>`).join("")}</div>
          <p>1 度 = $${POWER_PRICE}。機器越多耗電越多，記得看畫面上「撐得了幾分鐘」。電不夠時，錢也可能不夠買電，所以出貨口別拆光。起始送 100 度。</p>
        </details>
        <details class="fh"><summary>機器不動？常見原因</summary>
          <ul>
            <li><b>點「檢視」再點那台機器</b>：面板會寫「還缺：電線 ×3」之類的原因，狀態燈是 🟢 工作中、🟡 等材料、🔴 出口堵住。</li>
            <li><b>同一條帶子混著不同東西</b>：排頭的東西機器暫時不收，後面的就進不去，整條停住。讓每條帶子只送一種，或用分流器把不要的分出去。</li>
            <li><b>出口堵住</b>：出口那格不是帶子（或帶子是反方向、已經滿了）。接上出貨口或把帶子接通。</li>
            <li><b>整座工廠都不動</b>：看畫面上的 ⚡ 剩餘電量，是 0 的話就是停電了，儲值就會繼續。</li>
            <li><b>採礦機放不下去</b>：只能放在褐色／灰色礦點上。</li>
            <li><b>帶子迎面相對</b>：兩條帶子互相面對，東西過不去。</li>
          </ul>
        </details>
        <p class="fnote">存檔記在這個瀏覽器裡（每 5 秒自動存），換裝置不會跟過去。</p>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  root.querySelectorAll(".fh").forEach((d) => d.addEventListener("toggle", () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} }));
  const ore = makeOre();
  let g;
  try { g = load(JSON.parse(localStorage.getItem(SAVE_KEY) || "null")); } catch { g = newGame(); }
  let tool = "inspect", rot = 0, msg = "", msgAt = 0, closed = false, raf = 0, acc = 0, last = performance.now(), saveAt = 0;
  let sel = null, hover = null, drag = null, infoKey = "";

  // ---- 工具列
  const bar = $(".ftools");
  bar.innerHTML = TOOLS.map((t, i) => `<button data-k="${t.k}" title="${t.tip}"><span>${t.ic}</span><b>${t.nm}</b><small>${t.k === "erase" ? "退一半" : t.k === "inspect" ? "不花錢" : "$" + KINDS[t.k].cost}</small><em>${i + 1}</em></button>`).join("");
  function pickTool(k) {
    tool = k; if (k !== "inspect") sel = null;
    bar.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x.dataset.k === k));
    $(".ftip").textContent = TOOLS.find((t) => t.k === k).tip; infoKey = "";
  }
  bar.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pickTool(b.dataset.k); });
  const rotLabel = () => { $(".frot").textContent = `方向 ${ARROW[rot]} ${DIRN[rot]}（R）`; };
  const rotate = () => { rot = (rot + 1) & 3; rotLabel(); };
  rotLabel(); pickTool("inspect");
  $(".frot").addEventListener("click", rotate);
  let armed = 0;
  $(".freset").addEventListener("click", (e) => {          // Activity 裡不能用 confirm()，改成按兩次
    if (!armed) { armed = setTimeout(() => { armed = 0; e.target.textContent = "清空重來"; }, 3000); e.target.textContent = "再按一次確定清空"; return; }
    clearTimeout(armed); armed = 0; e.target.textContent = "清空重來"; g = newGame(); sel = null; persist(); infoKey = "";
  });
  $(".back").addEventListener("click", () => { cleanup(); back(); });
  const kd = (e) => {
    if (e.key === "r" || e.key === "R") rotate();
    else if (/^[1-8]$/.test(e.key) && !(e.target && /input|textarea/i.test(e.target.tagName))) pickTool(TOOLS[+e.key - 1].k);
    else if (e.key === "Escape") { sel = null; pickTool("inspect"); }
  };
  window.addEventListener("keydown", kd);

  // ---- 電費面板
  const pw = $(".fpower");
  pw.innerHTML = `<div class="fp-top"><span class="fp-v"></span><span class="fp-s"></span></div><div class="fp-bar"><i></i></div>
    <div class="fp-buy"><span>儲值電費</span>${[20, 100, 500].map((n) => `<button data-u="${n}">+${n} 度<small>$${n * POWER_PRICE}</small></button>`).join("")}<button data-rescue hidden>手搖發電 +5 度</button></div>`;
  let rescueAt = 0;
  pw.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.rescue !== undefined) { if (Date.now() - rescueAt < 10000) { say("手搖發電機還在冷卻（每 10 秒一次）"); return; } rescueAt = Date.now(); g.power += 5; say("手搖發電 +5 度"); return; }
    const err = buyPower(g, +b.dataset.u); say(err || `已儲值 ${b.dataset.u} 度`);
  });
  function renderPower() {
    const rate = powerRate(g), mins = rate > 0 ? g.power / rate : Infinity;
    pw.querySelector(".fp-v").textContent = `⚡ 剩餘 ${g.power.toFixed(g.power < 10 ? 1 : 0)} 度`;
    pw.querySelector(".fp-s").textContent = g.off ? "停電中，工廠已停工" : rate > 0 ? `每分鐘耗電 ${rate.toFixed(1)} 度，約撐 ${mins >= 100 ? "100+" : mins.toFixed(1)} 分鐘` : "還沒有機器";
    const bar = pw.querySelector(".fp-bar i"); bar.style.width = Math.max(0, Math.min(100, mins === Infinity ? 100 : mins / 20 * 100)) + "%";
    pw.classList.toggle("low", !g.off && mins < 3); pw.classList.toggle("off", g.off);
    pw.querySelector("[data-rescue]").hidden = !(g.power < 5 && g.money < 20);
  }
  const say = (t) => { msg = t; msgAt = performance.now(); };
  const cellAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H)];
  };
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const cellOf = (x, y) => (inGrid(x, y) ? g.cells[y * W + x] : null);

  const apply = (x, y, first) => {
    if (!inGrid(x, y)) return;
    if (tool === "inspect") { if (first) { sel = [x, y]; infoKey = ""; } return; }
    if (tool === "erase") { remove(g, x, y); return; }
    let d = rot;
    if (tool === "belt" && drag && drag.prev && (drag.prev[0] !== x || drag.prev[1] !== y)) {   // 拖曳方向決定傳送帶方向
      const dx = x - drag.prev[0], dy = y - drag.prev[1];
      d = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      const pc = cellOf(drag.prev[0], drag.prev[1]);
      if (pc && pc.k === "belt") pc.dir = d;
      rot = d; rotLabel();
    }
    const err = place(g, ore, x, y, tool, d);
    if (err) say(err);
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = cellAt(e); hover = [x, y]; drag = { prev: null }; apply(x, y, true); drag.prev = [x, y];
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = cellAt(e); hover = inGrid(x, y) ? [x, y] : null;
    if (!drag) return;
    if (drag.prev && drag.prev[0] === x && drag.prev[1] === y) return;
    if (drag.prev && Math.abs(x - drag.prev[0]) + Math.abs(y - drag.prev[1]) > 1) { drag.prev = [x, y]; return; }   // 滑太快跳格就不補
    apply(x, y, false); drag.prev = [x, y];
  });
  const up = () => { drag = null; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (!drag) hover = null; });

  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(g))); } catch {} }

  // ---- 畫面：格子
  const rrect = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
  function drawArrow(px, py, dir, color) {
    ctx.save(); ctx.translate(px + CELL / 2, py + CELL / 2); ctx.rotate(dir * Math.PI / 2);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(CELL / 2 - 2, 0); ctx.lineTo(CELL / 2 - 10, -6); ctx.lineTo(CELL / 2 - 10, 6); ctx.fill(); ctx.restore();
  }
  function drawCell(c, x, y) {
    const px = x * CELL, py = y * CELL;
    if (c.k === "belt") {
      ctx.fillStyle = "#39414f"; ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
      ctx.save(); ctx.translate(px + CELL / 2, py + CELL / 2); ctx.rotate(c.dir * Math.PI / 2);
      ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, -7); ctx.lineTo(3, 0); ctx.lineTo(-6, 7); ctx.stroke(); ctx.restore();
    } else {
      ctx.fillStyle = COLOR[c.k]; rrect(px + 3, py + 3, CELL - 6, CELL - 6, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ICON[c.k], px + CELL / 2, py + CELL / 2);
      if (c.k !== "shipper") {
        drawArrow(px, py, c.dir, "#ffe082");
        const n = Object.values(c.inv).reduce((a, b) => a + b, 0);
        if (n) { ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left"; ctx.fillText(n, px + 6, py + 9); }
        if (c.k === "assembler") { ctx.fillStyle = ITEMS[RECIPES[c.r].make].color; ctx.beginPath(); ctx.arc(px + CELL - 9, py + 9, 5, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }
        if (c.k !== "splitter") {                               // 狀態燈
          const st = machineState(c);
          if (STATE_COLOR[st.s]) { ctx.fillStyle = STATE_COLOR[st.s]; ctx.beginPath(); ctx.arc(px + 9, py + CELL - 9, 4, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }
        }
      }
    }
    const item = c.k === "belt" || c.k === "splitter" ? c.item : c.out[0];
    if (item) {
      let ox = 0, oy = 0;
      if (c.k === "belt") { const bk = c.ago < BELT_STEP ? 1 - c.ago / BELT_STEP : 0; ox = -DX[c.dir] * bk * CELL * 0.8; oy = -DY[c.dir] * bk * CELL * 0.8; }
      const cx = px + CELL / 2 + ox, cy = py + CELL / 2 + oy, big = item === "gear" || item === "motor";
      ctx.fillStyle = ITEMS[item].color; ctx.beginPath(); ctx.arc(cx, cy, big ? 7 : 6, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
      if (item === "gear") { ctx.fillStyle = "#1c2330"; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 7); ctx.fill(); }
    }
  }
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
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = g.cells[y * W + x]; if (c) drawCell(c, x, y); }
    // 放置預覽：綠＝可以放，紅＝不行
    if (hover && KINDS[tool]) {
      const [hx, hy] = hover, err = canPlace(g, ore, hx, hy, tool, rot), px = hx * CELL, py = hy * CELL;
      ctx.globalAlpha = 0.45; ctx.fillStyle = err ? "#ef5350" : "#66bb6a"; rrect(px + 2, py + 2, CELL - 4, CELL - 4, 7); ctx.fill(); ctx.globalAlpha = 1;
      if (tool !== "shipper") drawArrow(px, py, rot, "#fff");
    } else if (hover && tool === "erase") {
      const px = hover[0] * CELL, py = hover[1] * CELL; ctx.strokeStyle = "#ef5350"; ctx.lineWidth = 2; ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
    }
    if (g.off) {
      ctx.fillStyle = "rgba(10,14,22,.62)"; ctx.fillRect(0, 0, W * CELL, H * CELL);
      ctx.fillStyle = "#ffd54f"; ctx.font = "bold 34px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("⚡ 停電了", W * CELL / 2, H * CELL / 2 - 16);
      ctx.fillStyle = "#fff"; ctx.font = "18px sans-serif"; ctx.fillText("儲值電費後，工廠會從原地繼續", W * CELL / 2, H * CELL / 2 + 22);
    }
    if (sel) { ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 3; rrect(sel[0] * CELL + 1, sel[1] * CELL + 1, CELL - 2, CELL - 2, 8); ctx.stroke(); }
  }

  // ---- 資訊面板（檢視工具）
  const info = $(".finfo");
  info.addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]"); if (b && sel) { if (setRecipe(g, sel[0], sel[1], +b.dataset.r)) say("已換配方"); infoKey = ""; }
    const d = e.target.closest("[data-d]"); if (d && sel) { const c = cellOf(sel[0], sel[1]); if (c && c.k !== "shipper") { c.dir = (c.dir + 1) & 3; infoKey = ""; } }
  });
  function renderInfo() {
    if (tool !== "inspect") { if (infoKey !== "x") { info.innerHTML = ""; infoKey = "x"; } return; }
    if (!sel) { if (infoKey !== "none") { info.innerHTML = `<div class="fi-empty">點格子上的機器，這裡會顯示它的狀態</div>`; infoKey = "none"; } return; }
    const c = cellOf(sel[0], sel[1]);
    if (!c) { const o = ore.get(sel[1] * W + sel[0]); const k = "e" + sel + o; if (infoKey !== k) { info.innerHTML = `<div class="fi-empty">${o ? (o === "copper" ? "銅礦點：採礦機放這裡會挖銅礦" : "鐵礦點：採礦機放這裡會挖鐵礦") : "空地"}</div>`; infoKey = k; } return; }
    const st = c.k === "belt" || c.k === "splitter" || c.k === "shipper" ? null : machineState(c);
    const inv = Object.entries(c.inv).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k].name} ×${n}`).join("、") || "空的";
    let html = `<div class="fi-h"><b>${KINDS[c.k].name}</b>${c.k !== "shipper" ? `<span>出口朝${DIRN[c.dir]}</span><button data-d>轉方向</button>` : ""}</div>`;
    html += `<div class="fi-p">耗電：每分鐘 ${POWER_USE[c.k]} 度</div>`;
    if (st) html += `<div class="fi-s s-${st.s}"><i></i>${st.text}</div>`;
    if (c.k === "miner") html += `<div>挖的是${c.ore === "copper" ? "銅礦" : "鐵礦"}，每 1.5 秒 1 個</div>`;
    if (c.k === "smelter") html += `<div>機器裡：${inv}</div>`;
    if (c.k === "assembler") {
      html += `<div>機器裡：${inv}</div><div class="fi-rec">${RECIPES.map((R, i) => `<button data-r="${i}" class="${i === c.r ? "on" : ""}"><i style="background:${ITEMS[R.make].color}"></i>${ITEMS[R.make].name}<small>${recipeText(R)}</small></button>`).join("")}</div>`;
    }
    if (c.k === "belt") html += `<div>${c.item ? "帶子上有：" + ITEMS[c.item].name : "帶子上沒有東西"}</div>`;
    if (c.k === "splitter") html += `<div>${c.item ? "手上拿著：" + ITEMS[c.item].name : "沒有東西"}。輪流丟給前、右、左。</div>`;
    if (c.k === "shipper") html += `<div>什麼都收，按售價換錢。</div>`;
    const key = html.replace(/\s+/g, "");
    if (key !== infoKey) { info.innerHTML = html; infoKey = key; }
  }
  let priceDone = false;
  function hud() {
    $(".fmoney").textContent = `💰 ${g.money}`;
    if (!priceDone) { priceDone = true; $(".fprice").innerHTML = Object.values(ITEMS).map((it) => `<span><i style="background:${it.color}"></i>${it.name} $${it.value}</span>`).join(""); }
    const t = performance.now() - msgAt < 2500 ? msg : "";
    const el = $(".fstat"); el.textContent = t || `每分鐘出貨 $${perMinute(g)}　累計出貨 $${g.shipped}`; el.classList.toggle("warn", !!t);
    renderInfo(); renderPower();
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
