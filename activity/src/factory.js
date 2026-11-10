// 自動化工廠（原型）：把礦挖出來、熔成鐵板、做成齒輪等產品，用傳送帶送去出貨口換錢。
import { W, H, DX, DY, BELT_STEP, KINDS, ITEMS, RECIPES, POWER_USE, POWER_PRICE, makeOre, newGame, canPlace, place, remove, setRecipe, machineState, step, perMinute, powerRate, buyPower, serialize, load, UPGRADES, MAX_LV, upCost, upgrade, LANDS, LAND_COST, landSize, MILESTONES, buyLand, snap, restore, setFilter } from "./factory_sim.js";

// AI 畫的圖示（factory-art/*.png，檔名＝機器或物品代號）。圖還沒載入或缺圖時，退回原本的色塊畫法。
const IMG = {};
for (const [pth, url] of Object.entries(import.meta.glob("./factory-art/*.png", { eager: true, query: "?url", import: "default" }))) {
  const n = pth.split("/").pop().slice(0, -4), im = new Image(); im.src = url; IMG[n] = { im, url };
}
const ready = (n) => IMG[n] && IMG[n].im.complete && IMG[n].im.naturalWidth > 0;
const artTag = (n, px, fallback) => (IMG[n] ? `<img class="fart" src="${IMG[n].url}" width="${px}" height="${px}" alt="">` : fallback);
const CELL = 40, SAVE_KEY = "factory_v1", SEEN_KEY = "factory_help_seen";
const TOOLS = [
  { k: "inspect",  key: "1", ic: "👆", nm: "檢視",   tip: "點機器看它在做什麼、缺什麼；點組裝機可以選配方，點過濾器可以選要放行的東西。這個工具不會放東西，也不會花錢。" },
  { k: "belt",     key: "2", ic: "➡️", nm: "傳送帶", tip: "按住拖曳來鋪：拖的方向就是帶子的方向，轉彎會自動接好。物品只往帶子的箭頭方向走。" },
  { k: "bridge",   key: "3", ic: "✚", nm: "橋",     tip: "讓兩條傳送帶交叉：橫著來的橫著走、直著來的直著走，東西只會直線穿過、不會轉彎，互不干擾。把橋放在兩條線交會的那一格就好。" },
  { k: "splitter", key: "4", ic: "🔀", nm: "分流器", tip: "收到的東西會輪流丟給「前、右、左」三個方向（箭頭是前方）；哪邊收不下就跳過那邊。拿一個出口接出貨口，多出來的東西就不會塞住。" },
  { k: "filter",   key: "5", ic: "🔻", nm: "過濾器", tip: "用「檢視」點它選一種東西：符合的往前走（箭頭方向），其他的往左右分出去。一條線混了好幾種東西時，用它把想要的挑出來。沒選時全部往前。" },
  { k: "chest",    key: "6", ic: "🧰", nm: "倉庫",   tip: "什麼東西都收（最多 100 個），再一個一個從出口（黃色箭頭）放出去。產線塞住或下游比較慢時，先放個倉庫擋一下，前面的機器就不會停工。" },
  { k: "miner",    key: "7", ic: "⛏️", nm: "採礦機", tip: "只能放在礦點上（灰色是鐵礦、橘色是銅礦、金黃色是金礦）。機器上的黃色小箭頭是出口，產出會推給那一格。" },
  { k: "smelter",  key: "8", ic: "🔥", nm: "熔爐",   tip: "鐵礦熔成鐵板、銅礦熔成銅板、金礦熔成金板。把帶子接進來，出口那格接下一段帶子。" },
  { k: "assembler", key: "9", ic: "⚙️", nm: "組裝機", tip: "照配方把材料組裝成新東西。剛放下去預設做齒輪，用「檢視」點它可以換配方。" },
  { k: "shipper",  key: "0", ic: "📦", nm: "出貨口", tip: "什麼東西都收，按售價換成錢，也會算進訂單。可以接在任何東西的出口。" },
  { k: "erase",    key: "X", ic: "🧹", nm: "拆除",   tip: "點或拖曳經過就拆掉，退回一半的錢。" },
  { k: "pan",      key: "H", ic: "✋", nm: "移動",   tip: "放大畫面之後，用這個工具拖曳來移動視野（滑鼠也可以直接用捲動）。" },
];
const COLOR = { miner: "#8d6e3f", smelter: "#b5532b", assembler: "#2f6fa8", shipper: "#3d8b57", splitter: "#7b5ea7", chest: "#8a6d3b", filter: "#b5679a" };
const ICON = { miner: "⛏", smelter: "♨", assembler: "⚙", shipper: "▣", splitter: "⑃", chest: "▤", filter: "▽" };
const STATE_COLOR = { work: "#66bb6a", wait: "#ffca28", blocked: "#ef5350" };
const DIRN = ["右", "下", "左", "上"], ARROW = ["➡️", "⬇️", "⬅️", "⬆️"];
const recipeText = (R) => Object.entries(R.in).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(" ＋ ") + " → " + R.n + " " + ITEMS[R.make].name;

export function mountFactory(root, { env, back }) {
  const seen = (() => { try { return !!localStorage.getItem(SEEN_KEY); } catch { return false; } })();
  root.innerHTML = `
    <div class="game gomoku factory">
      <header><button class="back">← 選單</button><h2>自動化工廠</h2><span class="right fmoney"></span></header>
      <div class="fwrap">
       <div class="fleft">
        <div class="status fstat"></div>
        <div class="cwrap"><canvas width="${LANDS[0][0] * CELL}" height="${LANDS[0][1] * CELL}"></canvas></div>
        <div class="fzoom"><button class="zm">－</button><span class="zv">100%</span><button class="zp">＋</button></div>
        <div class="ftools"></div>
        <div class="ftip"></div>
        <div class="factions"><button class="frot"></button><button class="fundo">↶ 復原</button><button class="fspeed"></button><button class="fland"></button><button class="freset">清空重來</button></div>
       </div>
       <div class="fright">
        <div class="finfo"></div>
        <div class="fms"></div>
        <div class="fpower"></div>
        <div class="forders"></div>
        <div class="fupg"></div>
       </div>
      </div>
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
          <div class="frec">${RECIPES.map((R) => `<div>${artTag(R.make, 20, `<i style="background:${ITEMS[R.make].color}"></i>`)}<b>${ITEMS[R.make].name}</b> $${ITEMS[R.make].value}<span>${recipeText(R)}（${(R.time / 10).toFixed(0)} 秒）</span></div>`).join("")}
            <div>${artTag("smelter", 20, "")}<b>熔爐</b><span>1 鐵礦 → 1 鐵板；1 銅礦 → 1 銅板（2 秒）</span></div></div>
          <p>組裝機剛放下是做齒輪；用「檢視」點它，下面的面板可以選配方。換配方會清空機器裡的材料。</p>
        </details>
        <details class="fh"><summary>橋、倉庫、訂單、升級</summary>
          <ul>
            <li><b>橋</b>：兩條傳送帶要交叉時，在交會那格放橋。橫著進來的橫著出去、直著進來的直著出去，不會轉彎，也不會混在一起。</li>
            <li><b>倉庫</b>：什麼都收（最多 100 個），再從黃色箭頭出口一個個放出去。拿來當緩衝，下游忙不過來時前面的機器不會停。</li>
            <li><b>訂單</b>：畫面上會有 3 張訂單，要你送指定的東西。用<b>出貨口</b>送進去就算進度，東西照樣賣錢；交齊拿一筆額外獎金（約售價的 1.5 倍）。累計出貨越多，訂單裡會出現越高階的東西。</li>
            <li><b>過濾器</b>：用「檢視」點它選一種東西。符合的往前走，其他的分到左右兩邊。一條線混了好幾種東西時，拿它把想要的挑出來。</li>
            <li><b>擴地</b>：按「擴地」花錢把地變大（最多兩次）。新的地有更多鐵礦、銅礦，最遠的角落有<b>金礦</b>：金礦熔成金板，再配電路板做成晶片，晶片＋電池＋馬達就是最貴的 AI 核心。</li>
            <li><b>里程碑</b>：累計出貨到一定金額會自動發獎金，右邊有進度條。</li>
            <li><b>復原</b>：按「↶ 復原」或 Ctrl+Z，最近 40 次放置、拆除、換方向、擴地都可以退回去（傳送帶上正在跑的東西不會還原）。</li>
            <li><b>加速與暫停</b>：「倍速」按鈕可以切 1／2／4 倍速或暫停，暫停時可以慢慢規劃。</li>
            <li><b>縮放與移動</b>：右上方的 ＋／－ 放大縮小畫面（鍵盤 +／-），放大後用「✋ 移動」工具拖曳，或直接捲動。</li>
            <li><b>升級</b>：花錢讓採礦機、熔爐、組裝機變快（每級快 20%），或讓全廠省電（每級 -10%）。每級價格翻倍，最高 Lv5。</li>
          </ul>
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
  bar.innerHTML = TOOLS.map((t, i) => `<button data-k="${t.k}" title="${t.tip}"><span>${artTag(t.k, 30, t.ic)}</span><b>${t.nm}</b><small>${t.k === "erase" ? "退一半" : !KINDS[t.k] ? "不花錢" : "$" + KINDS[t.k].cost}</small><em>${t.key}</em></button>`).join("");
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
    clearTimeout(armed); armed = 0; e.target.textContent = "清空重來"; g = newGame(); sel = null; undoStack.length = 0; resizeCanvas(); persist(); infoKey = "";
  });
  $(".back").addEventListener("click", () => { cleanup(); back(); });
  const kd = (e) => {
    if ((e.key === "r" || e.key === "R") && tool === "inspect" && sel && cellOf(sel[0], sel[1]) && !["shipper", "bridge"].includes(cellOf(sel[0], sel[1]).k)) { pushUndo(); const c = cellOf(sel[0], sel[1]); c.dir = (c.dir + 1) & 3; infoKey = ""; }
    else if (e.key === "r" || e.key === "R") rotate();
    else if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undo(); }
    else if (e.key === "+" || e.key === "=") setZoom(zoom + 0.5);
    else if (e.key === "-" || e.key === "_") setZoom(zoom - 0.5);
    else if (e.key === "Escape") { sel = null; pickTool("inspect"); }
    else { const t = TOOLS.find((x) => x.key === e.key.toUpperCase()); if (t) pickTool(t.k); }
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
    const [lw, lh] = landSize(g);
    return [Math.floor(((e.clientX - r.left) / r.width) * lw), Math.floor(((e.clientY - r.top) / r.height) * lh)];
  };
  const inGrid = (x, y) => { const [lw, lh] = landSize(g); return x >= 0 && y >= 0 && x < lw && y < lh; };
  const cellOf = (x, y) => (inGrid(x, y) ? g.cells[y * W + x] : null);

  const apply = (x, y, first) => {
    if (!inGrid(x, y)) return;
    if (tool === "inspect") { if (first) { sel = [x, y]; infoKey = ""; } return; }
    if (tool === "pan") return;
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
    if (tool === "pan") { const w = $(".cwrap"); drag = { pan: true, x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop }; return; }
    if (tool !== "inspect") pushUndo();
    const [x, y] = cellAt(e); hover = [x, y]; drag = { prev: null }; apply(x, y, true); drag.prev = [x, y];
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag && drag.pan) { const w = $(".cwrap"); w.scrollLeft = drag.sl - (e.clientX - drag.x); w.scrollTop = drag.st - (e.clientY - drag.y); return; }
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

  // ---- 地圖大小、縮放、復原、速度、擴地
  let zoom = (() => { try { const z = Number(localStorage.getItem("factory_zoom")); if (z >= 1 && z <= 3) return z; } catch {} return window.innerWidth < 600 ? 1.5 : 1; })();
  const undoStack = [];
  function pushUndo() { undoStack.push(snap(g)); if (undoStack.length > 40) undoStack.shift(); }
  function undo() { const s0 = undoStack.pop(); if (!s0) { say("沒有可以復原的了"); return; } restore(g, s0); resizeCanvas(); sel = null; infoKey = ""; say("已復原"); }
  function resizeCanvas() {
    const [lw, lh] = landSize(g);
    if (canvas.width !== lw * CELL || canvas.height !== lh * CELL) { canvas.width = lw * CELL; canvas.height = lh * CELL; }
    canvas.style.aspectRatio = `${lw}/${lh}`;
  }
  function setZoom(z) {
    zoom = Math.max(1, Math.min(3, Math.round(z * 2) / 2)); try { localStorage.setItem("factory_zoom", String(zoom)); } catch {}
    canvas.style.width = zoom * 100 + "%"; canvas.style.maxWidth = zoom === 1 ? "" : "none";
    $(".zv").textContent = Math.round(zoom * 100) + "%";
  }
  $(".zm").addEventListener("click", () => setZoom(zoom - 0.5)); $(".zp").addEventListener("click", () => setZoom(zoom + 0.5));
  $(".fundo").addEventListener("click", undo);
  const SPEEDS = [[1, "▶ 1 倍速"], [2, "⏩ 2 倍速"], [4, "⏩⏩ 4 倍速"], [0, "⏸ 暫停"]];
  let spi = 0;
  const speedLabel = () => { $(".fspeed").textContent = SPEEDS[spi][1]; };
  $(".fspeed").addEventListener("click", () => { spi = (spi + 1) % SPEEDS.length; speedLabel(); });
  $(".fland").addEventListener("click", () => {
    const n = (g.land || 0) + 1; if (n >= LANDS.length) return;
    pushUndo(); const err = buyLand(g); if (err) { undoStack.pop(); say(err); return; }
    resizeCanvas(); say(`地擴大了（${LANDS[g.land][0]}×${LANDS[g.land][1]}），新的礦點出現了`);
  });
  resizeCanvas(); setZoom(zoom); speedLabel();

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
    } else if (c.k === "bridge") {
      ctx.fillStyle = "#39414f"; ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
      ctx.fillStyle = "#566179"; ctx.fillRect(px + 3, py + CELL / 2 - 5, CELL - 6, 10); ctx.fillRect(px + CELL / 2 - 5, py + 3, 10, CELL - 6);
      ctx.fillStyle = "#6f7c96"; ctx.fillRect(px + CELL / 2 - 5, py + CELL / 2 - 5, 10, 10);
      c.lane.forEach((L, a) => {
        if (!L) return;
        const cx = px + CELL / 2 + (a ? 0 : 0), cy = py + CELL / 2;
        const ox = a === 0 ? (L.d === 0 ? 7 : -7) : 0, oy = a === 1 ? (L.d === 1 ? 7 : -7) : 0;
        if (ready(L.item)) ctx.drawImage(IMG[L.item].im, cx + ox - 8, cy + oy - 8, 16, 16);
        else { ctx.fillStyle = ITEMS[L.item].color; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5; ctx.stroke(); }
      });
    } else {
      if (ready(c.k)) {
        ctx.fillStyle = "#2b3345"; rrect(px + 2, py + 2, CELL - 4, CELL - 4, 8); ctx.fill();
        ctx.strokeStyle = COLOR[c.k]; ctx.lineWidth = 2; ctx.stroke();
        ctx.drawImage(IMG[c.k].im, px + 4, py + 3, CELL - 8, CELL - 8);
      } else {
        ctx.fillStyle = COLOR[c.k]; rrect(px + 3, py + 3, CELL - 6, CELL - 6, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ICON[c.k], px + CELL / 2, py + CELL / 2);
      }
      if (c.k !== "shipper") {
        drawArrow(px, py, c.dir, "#ffe082");
        const n = Object.values(c.inv).reduce((a, b) => a + b, 0);
        if (n) { ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left"; ctx.fillText(n, px + 6, py + 9); }
        if (c.k === "assembler" || (c.k === "filter" && c.f)) {
          const mk = c.k === "filter" ? c.f : RECIPES[c.r].make;
          ctx.fillStyle = "rgba(20,26,38,.85)"; ctx.beginPath(); ctx.arc(px + CELL - 9, py + 9, 8, 0, 7); ctx.fill();
          if (ready(mk)) ctx.drawImage(IMG[mk].im, px + CELL - 16, py + 2, 14, 14);
          else { ctx.fillStyle = ITEMS[mk].color; ctx.beginPath(); ctx.arc(px + CELL - 9, py + 9, 5, 0, 7); ctx.fill(); }
        }
        if (c.k !== "splitter" && c.k !== "chest" && c.k !== "filter") {   // 狀態燈
          const st = machineState(c);
          if (STATE_COLOR[st.s]) { ctx.fillStyle = STATE_COLOR[st.s]; ctx.beginPath(); ctx.arc(px + 9, py + CELL - 9, 4, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }
        }
      }
    }
    const item = c.k === "belt" || c.k === "splitter" ? c.item : c.out[0];
    if (item) {
      let ox = 0, oy = 0;
      if (c.k === "belt") { const bk = c.ago < BELT_STEP ? 1 - c.ago / BELT_STEP : 0; ox = -DX[c.dir] * bk * CELL * 0.8; oy = -DY[c.dir] * bk * CELL * 0.8; }
      const onMachine = c.k !== "belt" && c.k !== "splitter";                // 機器的成品畫在出口那一側，看得出往哪送
      const cx = px + CELL / 2 + ox + (onMachine ? DX[c.dir] * 10 : 0), cy = py + CELL / 2 + oy + (onMachine ? DY[c.dir] * 10 : 0);
      if (ready(item)) { const sz = onMachine ? 16 : 22; ctx.drawImage(IMG[item].im, cx - sz / 2, cy - sz / 2, sz, sz); }
      else {
        const big = item === "gear" || item === "motor";
        ctx.fillStyle = ITEMS[item].color; ctx.beginPath(); ctx.arc(cx, cy, big ? 7 : 6, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
        if (item === "gear") { ctx.fillStyle = "#1c2330"; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 7); ctx.fill(); }
      }
    }
  }
  function draw() {
    const [LW, LH] = landSize(g);
    ctx.fillStyle = "#1c2330"; ctx.fillRect(0, 0, LW * CELL, LH * CELL);
    ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
    for (let x = 0; x <= LW; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, LH * CELL); ctx.stroke(); }
    for (let y = 0; y <= LH; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(LW * CELL, y * CELL); ctx.stroke(); }
    for (const [i, t] of ore) {
      if (i % W >= LW || Math.floor(i / W) >= LH) continue;
      const x = (i % W) * CELL, y = Math.floor(i / W) * CELL;
      ctx.fillStyle = t === "copper" ? "#4a2f24" : t === "gold" ? "#4d4521" : "#3a3f4a"; ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = t === "copper" ? "#d98b5f" : t === "gold" ? "#ffd54f" : "#9aa7b8"; for (const [dx, dy] of [[9, 10], [24, 14], [14, 26], [28, 28]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 3.5, 0, 7); ctx.fill(); }
    }
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) { const c = g.cells[y * W + x]; if (c) drawCell(c, x, y); }
    // 放置預覽：綠＝可以放，紅＝不行
    if (hover && KINDS[tool]) {
      const [hx, hy] = hover, err = canPlace(g, ore, hx, hy, tool, rot), px = hx * CELL, py = hy * CELL;
      ctx.globalAlpha = 0.45; ctx.fillStyle = err ? "#ef5350" : "#66bb6a"; rrect(px + 2, py + 2, CELL - 4, CELL - 4, 7); ctx.fill(); ctx.globalAlpha = 1;
      if (tool !== "shipper" && tool !== "bridge") drawArrow(px, py, rot, "#fff");
    } else if (hover && tool === "erase") {
      const px = hover[0] * CELL, py = hover[1] * CELL; ctx.strokeStyle = "#ef5350"; ctx.lineWidth = 2; ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
    }
    if (g.off) {
      ctx.fillStyle = "rgba(10,14,22,.62)"; ctx.fillRect(0, 0, LW * CELL, LH * CELL);
      ctx.fillStyle = "#ffd54f"; ctx.font = "bold 34px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("⚡ 停電了", LW * CELL / 2, LH * CELL / 2 - 16);
      ctx.fillStyle = "#fff"; ctx.font = "18px sans-serif"; ctx.fillText("儲值電費後，工廠會從原地繼續", LW * CELL / 2, LH * CELL / 2 + 22);
    }
    if (sel) { ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 3; rrect(sel[0] * CELL + 1, sel[1] * CELL + 1, CELL - 2, CELL - 2, 8); ctx.stroke(); }
  }

  // ---- 資訊面板（檢視工具）
  const info = $(".finfo");
  info.addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]"); if (b && sel) { pushUndo(); if (setRecipe(g, sel[0], sel[1], +b.dataset.r)) say("已換配方"); infoKey = ""; }
    const fb = e.target.closest("[data-f]"); if (fb && sel) { pushUndo(); setFilter(g, sel[0], sel[1], fb.dataset.f); infoKey = ""; }
    const d = e.target.closest("[data-d]"); if (d && sel) { const c = cellOf(sel[0], sel[1]); if (c && c.k !== "shipper" && c.k !== "bridge") { pushUndo(); c.dir = (c.dir + 1) & 3; infoKey = ""; } }
  });
  function renderInfo() {
    if (tool !== "inspect") { if (infoKey !== "x") { info.innerHTML = ""; infoKey = "x"; } return; }
    if (!sel) { if (infoKey !== "none") { info.innerHTML = `<div class="fi-empty">點格子上的機器，這裡會顯示它的狀態</div>`; infoKey = "none"; } return; }
    const c = cellOf(sel[0], sel[1]);
    if (!c) { const o = ore.get(sel[1] * W + sel[0]); const k = "e" + sel + o; if (infoKey !== k) { info.innerHTML = `<div class="fi-empty">${o ? (o === "copper" ? "銅礦點：採礦機放這裡會挖銅礦" : "鐵礦點：採礦機放這裡會挖鐵礦") : "空地"}</div>`; infoKey = k; } return; }
    const st = ["belt", "bridge", "splitter", "filter", "chest", "shipper"].includes(c.k) ? null : machineState(c);
    const inv = Object.entries(c.inv).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k].name} ×${n}`).join("、") || "空的";
    let html = `<div class="fi-h"><b>${KINDS[c.k].name}</b>${c.k !== "shipper" && c.k !== "bridge" ? `<span>出口朝${DIRN[c.dir]}</span><button data-d>轉方向</button>` : ""}</div>`;
    html += `<div class="fi-p">耗電：每分鐘 ${POWER_USE[c.k]} 度</div>`;
    if (st) html += `<div class="fi-s s-${st.s}"><i></i>${st.text}</div>`;
    if (c.k === "miner") html += `<div>挖的是${c.ore === "copper" ? "銅礦" : "鐵礦"}，約每 ${(Math.max(3, Math.round(KINDS.miner.every * 0.8 ** (g.up.miner || 0))) / 10).toFixed(1)} 秒 1 個</div>`;
    if (c.k === "smelter") html += `<div>機器裡：${inv}</div>`;
    if (c.k === "assembler") {
      html += `<div>機器裡：${inv}</div><div class="fi-rec">${RECIPES.map((R, i) => `<button data-r="${i}" class="${i === c.r ? "on" : ""}">${artTag(R.make, 18, `<i style="background:${ITEMS[R.make].color}"></i>`)}${ITEMS[R.make].name}<small>${recipeText(R)}</small></button>`).join("")}</div>`;
    }
    if (c.k === "belt") html += `<div>${c.item ? "帶子上有：" + ITEMS[c.item].name : "帶子上沒有東西"}</div>`;
    if (c.k === "splitter") html += `<div>${c.item ? "手上拿著：" + ITEMS[c.item].name : "沒有東西"}。輪流丟給前、右、左。</div>`;
    if (c.k === "shipper") html += `<div>什麼都收，按售價換錢。</div>`;
    if (c.k === "bridge") html += `<div>橫向、縱向各走各的，直線穿過。${c.lane.map((L) => (L ? ITEMS[L.item].name : "")).filter(Boolean).join("、") ? "目前有：" + c.lane.map((L) => (L ? ITEMS[L.item].name : "")).filter(Boolean).join("、") : ""}</div>`;
    if (c.k === "filter") html += `<div>${c.f ? "只讓 <b>" + ITEMS[c.f].name + "</b> 往前走，其他的分到左右兩邊" : "還沒選：現在全部往前走"}。選一種：</div><div class="fi-rec fi-flt"><button data-f="" class="${c.f ? "" : "on"}">不過濾</button>${Object.entries(ITEMS).map(([k, it]) => `<button data-f="${k}" class="${c.f === k ? "on" : ""}">${artTag(k, 16, `<i style="background:${it.color}"></i>`)}${it.name}</button>`).join("")}</div>`;
    if (c.k === "chest") html += `<div>存貨：${inv}（最多 100 個）</div>`;
    const key = html.replace(/\s+/g, "");
    if (key !== infoKey) { info.innerHTML = html; infoKey = key; }
  }
  // ---- 里程碑
  const msEl = $(".fms"); let msKey = "";
  function renderMs() {
    const nxt = MILESTONES[g.ms], key = nxt ? g.ms + ":" + Math.floor(g.shipped / Math.max(1, nxt[0] / 50)) : "done";
    if (key === msKey) return; msKey = key;
    msEl.innerHTML = nxt ? `<div class="fo-h">🎯 里程碑<small>累計出貨到 $${nxt[0].toLocaleString("en-US")} 領獎金 $${nxt[1].toLocaleString("en-US")}</small></div><div class="fo-bar big"><i style="width:${Math.min(100, (g.shipped / nxt[0]) * 100)}%"></i></div><div class="fo-ms">${g.shipped.toLocaleString("en-US")} / ${nxt[0].toLocaleString("en-US")}</div>` : `<div class="fo-h">🎯 里程碑<small>全部達成，你已經是工廠大亨了</small></div>`;
  }
  // ---- 訂單與升級
  const od = $(".forders"), ug = $(".fupg"); let odKey = "", ugKey = "";
  ug.addEventListener("click", (e) => { const b = e.target.closest("[data-up]"); if (!b) return; const err = upgrade(g, b.dataset.up); say(err || `${UPGRADES[b.dataset.up].name} 升到 Lv${g.up[b.dataset.up]}`); ugKey = ""; });
  function renderOrders() {
    const key = JSON.stringify(g.orders.map((o) => [o.id, o.got]));
    if (key !== odKey) {
      odKey = key;
      od.innerHTML = `<div class="fo-h">📋 訂單<small>用出貨口送進去就算；東西一樣會賣錢，交齊再拿額外獎金。已完成 ${g.done} 張</small></div>` + g.orders.map((o) => `<div class="fo-it">${artTag(o.item, 26, `<i style="background:${ITEMS[o.item].color}"></i>`)}<div class="fo-m"><b>${ITEMS[o.item].name} ×${o.need}</b><div class="fo-bar"><i style="width:${(o.got / o.need) * 100}%"></i></div></div><span class="fo-p">${o.got}/${o.need}</span><span class="fo-r">+$${o.reward}</span></div>`).join("");
    }
  }
  function renderUpg() {
    const key = JSON.stringify([g.up, Object.keys(UPGRADES).map((k) => g.money >= upCost(g.up[k] || 0))]);
    if (key !== ugKey) {
      ugKey = key;
      ug.innerHTML = `<div class="fo-h">🔧 升級<small>花錢讓機器變快；每級價格翻倍，最高 Lv${MAX_LV}</small></div><div class="fu-g">` + Object.entries(UPGRADES).map(([k, u]) => {
        const lv = g.up[k] || 0, max = lv >= MAX_LV, c = upCost(lv);
        return `<button data-up="${k}" ${max || g.money < c ? "disabled" : ""}><b>${u.name} Lv${lv}</b><small>${u.desc}</small><em>${max ? "已滿級" : "$" + c}</em></button>`;
      }).join("") + `</div>`;
    }
  }
  let btnKey = "";
  function hudButtons() {
    const n = (g.land || 0) + 1, max = n >= LANDS.length;
    const key = [g.money >= (max ? 0 : LAND_COST[n]), g.land, undoStack.length, Math.floor(g.money / 5)].join();   // 錢的變化每 $5 才更新一次工具列的灰色
    if (key === btnKey) return; btnKey = key;
    const lb = $(".fland");
    lb.textContent = max ? "🗺️ 地已最大" : `🗺️ 擴地 $${LAND_COST[n]}（${LANDS[n][0]}×${LANDS[n][1]}）`;
    lb.disabled = max || g.money < LAND_COST[n];
    $(".fundo").disabled = !undoStack.length;
    bar.querySelectorAll("button").forEach((b) => { const k = KINDS[b.dataset.k]; b.classList.toggle("poor", !!k && g.money < k.cost); });
  }
  let priceDone = false;
  function hud() {
    $(".fmoney").textContent = `💰 ${g.money}`;
    if (!priceDone) { priceDone = true; $(".fprice").innerHTML = Object.entries(ITEMS).map(([k, it]) => `<span>${artTag(k, 18, `<i style="background:${it.color}"></i>`)}${it.name} $${it.value}</span>`).join(""); }
    const t = performance.now() - msgAt < 2500 ? msg : "";
    const el = $(".fstat"); el.textContent = t || `每分鐘出貨 $${perMinute(g)}　累計出貨 $${g.shipped}`; el.classList.toggle("warn", !!t);
    renderInfo(); renderPower(); renderOrders(); renderUpg(); renderMs();
    hudButtons();
    if (g.note) { say(g.note); g.note = ""; }
  }

  // ---- 主迴圈：固定 10 tick/秒
  function frame(now) {
    if (closed) return;
    acc += Math.min(1000, now - last) * SPEEDS[spi][0]; last = now;
    for (let n = 0; acc >= 100 && n < 60; n++) { step(g); acc -= 100; }
    if (acc > 400) acc = 0;
    draw(); hud();
    if (now - saveAt > 5000) { saveAt = now; persist(); }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  function cleanup() { closed = true; cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); persist(); }
  return cleanup;
}
