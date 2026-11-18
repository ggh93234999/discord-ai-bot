// 零件漲跌榜：看原價屋、欣亞哪些零件漲價、哪些降價。資料來自伺服器 /api/pc/moves（價格歷史是 /配電腦 定時抓取時記下的）。
// 台灣習慣：紅色＝漲、綠色＝跌。
import "./pcbuild.css";
import { pim, wirePim } from "./pcimg.js";
import { CAT_NAME } from "../shared/pcrules.js";

const ICON = { cpu: "🧠", mb: "🔌", gpu: "🎮", ram: "💾", ssd: "💿", psu: "⚡", case: "🗄️", cooler: "❄️" };
const CATS = ["cpu", "mb", "gpu", "ram", "ssd", "psu", "case", "cooler"];
const PERIODS = [[1, "1 天"], [3, "3 天"], [7, "7 天"], [30, "30 天"], [0, "全部"]];
const STORES = [["", "兩家"], ["c", "原價屋"], ["s", "欣亞"]];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const dt = (t) => { const d = new Date(t * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function mountPcMoves(root, { env, back }) {
  root.innerHTML = `
    <div class="game pcb pcm">
      <header><button class="back">← 選單</button><h2>零件漲跌榜</h2><span class="hdr"><span class="pcb-ts"></span></span></header>
      <div class="pcb-body">
        <div class="pcb-status">載入中…</div>
        <section class="pcm-ctl" hidden>
          <div class="pcm-row"><span>期間</span><div class="pcm-seg" data-k="days"></div></div>
          <div class="pcm-row"><span>店家</span><div class="pcm-seg" data-k="store"></div></div>
          <div class="pcm-row"><span>排序</span><div class="pcm-seg" data-k="sort"></div></div>
          <div class="pcm-chips"></div>
        </section>
        <section class="pcm-sum" hidden></section>
        <div class="pcm-cols" hidden>
          <section class="pcm-col down"><h3>📉 降價</h3><div class="pcm-list"></div></section>
          <section class="pcm-col up"><h3>📈 漲價</h3><div class="pcm-list"></div></section>
        </div>
        <p class="note pcm-note" hidden></p>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  $(".back").addEventListener("click", back);
  const url = (p) => { if (env.inDiscord) return `/.proxy/${p}`; const u = new URL(p, location.href); return u.pathname + u.search; };

  wirePim(root, url);
  let data = null, days = ls.get("pcm_days", 7), store = ls.get("pcm_store", ""), sort = ls.get("pcm_sort", "pct"), cat = "", shown = { up: 20, down: 20 };
  if (!PERIODS.some((p) => p[0] === days)) days = 7;
  const SORTS = [["pct", "幅度 %"], ["amt", "金額"]];

  async function load() {
    $(".pcb-status").hidden = false; $(".pcb-status").textContent = "載入中…";
    try {
      data = await (await fetch(url("api/pc/moves?days=" + days))).json();
      if (data.err) throw new Error(data.err);
    } catch (e) { $(".pcb-status").textContent = "讀取失敗，請稍後再試"; return; }
    $(".pcb-status").hidden = true;
    $(".pcb-ts").textContent = data.ts ? "更新 " + dt(data.ts) : "";
    shown = { up: 20, down: 20 };
    render();
  }

  function seg(el, list, cur, onPick) {
    el.innerHTML = list.map(([v, n]) => `<button class="${v === cur ? "on" : ""}" data-v="${v}">${n}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.v)));
  }

  function render() {
    $(".pcm-ctl").hidden = false; $(".pcm-sum").hidden = false; $(".pcm-cols").hidden = false;
    seg($('[data-k="days"]'), PERIODS, days, (v) => { days = Number(v); ls.set("pcm_days", days); load(); });
    seg($('[data-k="store"]'), STORES, store, (v) => { store = v; ls.set("pcm_store", store); shown = { up: 20, down: 20 }; render(); });
    seg($('[data-k="sort"]'), SORTS, sort, (v) => { sort = v; ls.set("pcm_sort", sort); render(); });
    $(".pcm-chips").innerHTML = [["", "全部"], ...CATS.map((c) => [c, `${ICON[c]} ${CAT_NAME[c] || c}`])].map(([v, n]) => `<button class="${v === cat ? "on" : ""}" data-v="${v}">${n}</button>`).join("");
    $(".pcm-chips").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { cat = b.dataset.v; shown = { up: 20, down: 20 }; render(); }));

    // 價格一次變成 2.5 倍以上或 4 成以下，幾乎都是店家標錯價或抓到別的商品，不放進榜單
    const odd = (m) => m.to / m.from > 2.5 || m.to / m.from < 0.4;
    const all0 = data.moves.filter((m) => (!store || m.st === store) && (!cat || m.cat === cat));
    const oddN = all0.filter(odd).length;
    const mv = all0.filter((m) => !odd(m)).map((m) => ({ ...m, d: m.to - m.from, pct: ((m.to - m.from) / m.from) * 100 }));
    const ups = mv.filter((m) => m.d > 0), downs = mv.filter((m) => m.d < 0);
    const key = (m) => Math.abs(sort === "amt" ? m.d : m.pct);
    ups.sort((a, b) => key(b) - key(a)); downs.sort((a, b) => key(b) - key(a));

    // 全部追蹤數（受店家／類別篩選；不變的數量要從總數算）
    const trackedAll = Object.entries(data.cats).filter(([c]) => !cat || c === cat);
    const same = store ? null : trackedAll.reduce((s, [, v]) => s + v.same, 0);
    const trackedN = store ? null : trackedAll.reduce((s, [, v]) => s + v.up + v.down + v.same, 0);
    const avg = (arr) => (arr.length ? arr.reduce((s, m) => s + m.pct, 0) / arr.length : 0);
    // 各類別漲跌件數（圖）
    const byCat = CATS.map((c) => { const a = mv.filter((m) => m.cat === c); return { c, up: a.filter((m) => m.d > 0).length, down: a.filter((m) => m.d < 0).length }; });
    const mx = Math.max(1, ...byCat.map((x) => Math.max(x.up, x.down)));
    $(".pcm-sum").innerHTML = `
      <div class="pcm-tiles">
        <div class="t down"><b>${downs.length}</b><span>降價</span><em>${downs.length ? "平均 " + avg(downs).toFixed(1) + "%" : "—"}</em></div>
        <div class="t up"><b>${ups.length}</b><span>漲價</span><em>${ups.length ? "平均 +" + avg(ups).toFixed(1) + "%" : "—"}</em></div>
        <div class="t"><b>${same == null ? "—" : same}</b><span>沒變</span><em>${trackedN == null ? "" : "共追蹤 " + trackedN}</em></div>
      </div>
      <div class="pcm-bars">${byCat.map((x) => `<div class="pcm-bar"><span class="l">${ICON[x.c]} ${CAT_NAME[x.c] || x.c}</span>
        <span class="half left"><i style="width:${(x.down / mx) * 100}%"></i><em>${x.down || ""}</em></span>
        <span class="half right"><i style="width:${(x.up / mx) * 100}%"></i><em>${x.up || ""}</em></span></div>`).join("")}
        <div class="pcm-bleg"><span>← 降價件數</span><span>漲價件數 →</span></div></div>`;

    const row = (m) => `<div class="pcm-it ${m.d > 0 ? "up" : "down"}" data-id="${esc(m.id)}" tabindex="0" role="button">
      <div class="nm"><span class="st ${m.st}">${m.st === "c" ? "原價屋" : "欣亞"}</span><span class="cat">${ICON[m.cat] || ""}</span>${esc(m.name)}</div>
      <div class="pr"><s>${money(m.from)}</s> → <b>${money(m.to)}</b></div>
      <div class="dl"><b>${m.d > 0 ? "▲" : "▼"} ${money(Math.abs(m.d))}</b><span>${m.d > 0 ? "+" : ""}${m.pct.toFixed(1)}%</span></div>
      <div class="ds">${dt(m.at)} → ${dt(m.to_at)}${m.n > 1 ? `　變動 ${m.n} 次` : ""}</div></div>`;
    for (const [k, arr] of [["down", downs], ["up", ups]]) {
      const box = $(`.pcm-col.${k} .pcm-list`);
      box.innerHTML = arr.length ? arr.slice(0, shown[k]).map(row).join("") + (arr.length > shown[k] ? `<button class="more" data-k="${k}">再看更多（還有 ${arr.length - shown[k]} 筆）</button>` : "") : `<p class="pcm-empty">${k === "down" ? "這段時間沒有降價的零件" : "這段時間沒有漲價的零件"}</p>`;
      box.querySelector(".more")?.addEventListener("click", () => { shown[k] += 30; render(); });
      box.querySelectorAll(".pcm-it").forEach((el) => {
        const open = () => detail(mv.find((m) => m.id === el.dataset.id));
        el.addEventListener("click", open);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      });
    }
    const days0 = data.first ? Math.max(1, Math.round((data.last - data.first) / 86400)) : 0;
    $(".pcm-note").hidden = false;
    $(".pcm-note").textContent = `價格每 4 小時抓一次，只有價格變動才會記一筆。目前累積了約 ${days0} 天的紀錄${data.first ? "（從 " + dt(data.first) + " 開始）" : ""}，所以「期間」選得再長也只看得到這麼多。下架再重新上架的不算漲跌。${oddN ? `另外有 ${oddN} 筆價格暴增暴跌 2.5 倍以上，多半是標錯價或抓錯商品，已排除。` : ""}`;
  }

  // 點開單一零件：價格走勢圖 + 每次變動的時間與價錢
  async function detail(m) {
    if (!m) return;
    root.querySelector(".pcm-dlg")?.remove();
    const dlg = document.createElement("div");
    dlg.className = "pcm-dlg";
    dlg.innerHTML = `<div class="pcm-card" role="dialog">
      <button class="x" aria-label="關閉">✕</button>
      <div class="hd">${pim(url, [m.id], m.name)}<div><span class="st ${m.st}">${m.st === "c" ? "原價屋" : "欣亞"}</span> ${ICON[m.cat] || ""} ${esc(m.name)}</div></div>
      <div class="bd">載入中…</div></div>`;
    root.querySelector(".pcm").appendChild(dlg);
    const close = () => dlg.remove();
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    dlg.querySelector(".x").addEventListener("click", close);
    const bd = dlg.querySelector(".bd");
    let h = [];
    try { const r = await (await fetch(url("api/pc/hist?ids=" + encodeURIComponent(m.id)))).json(); h = r[m.id] || []; } catch {}
    if (!h.length) { bd.textContent = "沒有這項零件的價格紀錄"; return; }
    const ps = h.map((x) => x[1]), lo = Math.min(...ps), hi = Math.max(...ps), cur = ps[ps.length - 1];
    const t0 = h[0][0], t1 = h[h.length - 1][0], W = 320, H = 110, pad = 6;
    const X = (t) => pad + (t1 === t0 ? (W - 2 * pad) / 2 : ((t - t0) / (t1 - t0)) * (W - 2 * pad));
    const Y = (p) => pad + (hi === lo ? (H - 2 * pad) / 2 : (1 - (p - lo) / (hi - lo)) * (H - 2 * pad));
    // 階梯線：價格在下一次變動前維持不變
    let d = `M${X(h[0][0]).toFixed(1)},${Y(h[0][1]).toFixed(1)}`;
    for (let i = 1; i < h.length; i++) d += `H${X(h[i][0]).toFixed(1)}V${Y(h[i][1]).toFixed(1)}`;
    d += `H${(W - pad).toFixed(1)}`;
    const rows = h.map((x, i) => { const df = i ? x[1] - h[i - 1][1] : 0; return `<tr><td>${dt(x[0])}</td><td>${money(x[1])}</td><td class="${df > 0 ? "up" : df < 0 ? "down" : ""}">${i ? (df > 0 ? "▲ " : "▼ ") + money(Math.abs(df)) : "首次記錄"}</td></tr>`; }).reverse().join("");
    bd.innerHTML = `<div class="pcm-stats"><div><span>目前</span><b>${money(cur)}</b></div><div><span>最低</span><b class="down">${money(lo)}</b></div><div><span>最高</span><b class="up">${money(hi)}</b></div></div>
      <svg viewBox="0 0 ${W} ${H}" class="pcm-spark" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#6aa8ff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="pcm-axis"><span>${dt(t0)}</span><span>${dt(t1)}</span></div>
      <table class="pcm-tbl"><thead><tr><th>時間</th><th>價格</th><th>變動</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  load();
}
