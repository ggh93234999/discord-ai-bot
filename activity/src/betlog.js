// 賭博紀錄面板：每一把的賭注、拿回多少、輸贏，加上累計統計。
// 練習模式的紀錄存在這個瀏覽器（localStorage）；賭注模式的紀錄存在伺服器、依 Discord 身分，換裝置也在。
const G = { slots: ["🎰", "老虎機"], coin: ["🪙", "擲硬幣"], dice: ["🎲", "骰子"], bj: ["🃏", "21 點"], horse: ["🏇", "賽馬"], forge: ["⚒️", "鍛造"] };
const KEY = "betlog_practice";
const money = (n) => Math.round(n).toLocaleString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function loadPractice() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || "null"); if (o && Array.isArray(o.list)) return o; } catch {}
  return { stats: { n: 0, bet: 0, back: 0, wins: 0 }, list: [] };
}
function savePractice(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} }

export function createBetLog(host, { send }) {
  const box = document.createElement("div");
  box.className = "betlog";
  box.innerHTML = `<div class="bl-h"><b>📜 賭博紀錄</b><span class="bl-mode"></span><button class="bl-clr" hidden>清除</button><button class="bl-tg">收合</button></div>
    <div class="bl-body"><div class="bl-stats"></div><div class="bl-list"></div></div>`;
  host.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const modeEl = $(".bl-mode"), clr = $(".bl-clr"), tg = $(".bl-tg"), body = $(".bl-body"), statsEl = $(".bl-stats"), listEl = $(".bl-list");
  let real = false, practice = loadPractice(), realLog = null;

  const cur = () => (real ? realLog : practice);
  function render() {
    box.classList.toggle("real", real);
    modeEl.textContent = real ? "賭注模式（真代幣）" : "練習模式";
    clr.hidden = real;
    const c = cur();
    if (!c) { statsEl.textContent = "讀取中…"; listEl.innerHTML = ""; return; }
    const s = c.stats, net = s.back - s.bet;
    statsEl.innerHTML = s.n
      ? `共 <b>${money(s.n)}</b> 把　總賭注 <b>${money(s.bet)}</b>　淨損益 <b class="${net >= 0 ? "w" : "l"}">${net >= 0 ? "+" : ""}${money(net)}</b>　勝率 <b>${Math.round(s.wins * 100 / s.n)}%</b>`
      : "還沒有紀錄，玩一把就會出現在這裡。";
    listEl.innerHTML = c.list.slice().reverse().slice(0, 40).map((e) => {
      const net = e.back - e.bet, [icon, name] = G[e.g] || ["🎲", e.g];
      return `<div class="bl-r"><span class="t">${hhmm(e.ts)}</span><span class="g">${icon} ${name}${e.label ? `<em>${esc(e.label)}</em>` : ""}</span><span class="b">${money(e.bet)} → ${money(e.back)}</span><b class="${net > 0 ? "w" : net < 0 ? "l" : ""}">${net > 0 ? "+" : ""}${money(net)}</b></div>`;
    }).join("");
  }
  const add = (c, e) => {
    c.stats.n++; c.stats.bet += e.bet; c.stats.back += e.back; if (e.back > e.bet) c.stats.wins++;
    c.list.push(e); if (c.list.length > 100) c.list.shift();
  };
  tg.addEventListener("click", () => { body.hidden = !body.hidden; tg.textContent = body.hidden ? "展開" : "收合"; });
  // 兩段確認：Discord 內嵌畫面會擋掉 confirm() 對話框，所以改成「再按一次確認」
  let armed = 0;
  clr.addEventListener("click", () => {
    if (armed) { clearTimeout(armed); armed = 0; clr.textContent = "清除"; practice = { stats: { n: 0, bet: 0, back: 0, wins: 0 }, list: [] }; savePractice(practice); render(); return; }
    clr.textContent = "再按一次確認清除";
    armed = setTimeout(() => { armed = 0; clr.textContent = "清除"; }, 3000);
  });
  render();

  return {
    // 處理伺服器送來的 clog；不是紀錄訊息就回傳 false
    onMsg(m) {
      if (m.t !== "clog") return false;
      if (m.all) { realLog = { stats: m.stats, list: m.list }; }
      else if (m.e) {
        if (m.e.real) { if (!realLog) realLog = { stats: { n: 0, bet: 0, back: 0, wins: 0 }, list: [] }; add(realLog, m.e); }
        else { add(practice, m.e); savePractice(practice); }
      }
      render(); return true;
    },
    setMode(r) { real = !!r; if (real && !realLog) send({ t: "clogq" }); else if (real) send({ t: "clogq" }); render(); },
    destroy() { box.remove(); },
  };
}
