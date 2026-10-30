// 英雄聯盟世界賽運彩：賠率同步 Pinnacle，單場勝負，用 bot 的虛擬幣下注。
import "./lolbet.css";
import { wsUrl } from "../src/gomoku.js";
import { ensureSession } from "../src/wager.js";
// 隊伍資料與圖標都放在 lolbet/teams/，由打包工具處理（不用 public/）
import logoIndex from "./teams/index.json";
import seedIndex from "./teams/seeds.json";
const LOGO_URLS = import.meta.glob("./teams/*.png", { eager: true, query: "?url", import: "default" });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n).toLocaleString();
const ERR = {
  need_login: "要先登入才能下注", stale: "賠率正在更新，請幾秒後再按一次", quota: "賠率資料來源額度已用完，暫停下注", closed: "這場已經截止下注", bad_amount: "金額不合法", odds_changed: "賠率剛剛變了，請看新賠率再下注",
  too_much: "這場你下的總額已達上限", insufficient: "代幣不夠", bot_down: "機器人暫時連不上，稍後再試", bad_request: "下注內容有誤",
};
// 隊伍圖標：lolbet/scripts/fetch_lol_logos.py 抓到 lolbet/teams/，index.json 是「隊名 → 檔名」。沒有圖的隊伍顯示縮寫圓章。
const logoIdx = logoIndex;
// 賽區與賽區種子：lolbet/scripts/fetch_lol_seeds.py 產生 lolbet/teams/seeds.json
const seedIdx = seedIndex;
const REGION = { LCK: "韓國", LPL: "中國", LCS: "北美", LEC: "歐洲", LCP: "亞太", CBLOL: "巴西" };
const seedTag = (name) => { const x = seedIdx && seedIdx[name]; return x ? `<small class="lbseed" title="${esc(REGION[x.region] || "")}賽區">${esc(x.region)} ${x.seed} 號種子${x.note ? "・" + esc(x.note) : ""}</small>` : ""; };
const logo = (name) => {
  const f = logoIdx && logoIdx[name];
  const u = f && LOGO_URLS["./teams/" + f];
  if (u) return `<img class="lblogo" src="${u}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'lblogo lbfb',textContent:'${esc(name).slice(0, 2).toUpperCase()}'}))">`;
  return `<span class="lblogo lbfb">${esc(name).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?"}</span>`;
};
const BSTAT = { open: "進行中", won: "贏了", lost: "輸了", void: "已退款", unpaid: "派彩中" };

export function mountLolBet(root, { env, back }) {
  let ws = null, closed = false, retry = 0, st = null, session = env.session || null, balance = null;
  let sel = null, amount = 100, note = "", busy = false, hist = null, showHist = false;
  const timers = [];

  root.innerHTML = `
    <div class="game lolbet">
      <header><button class="back">← 選單</button><h2>🏆 世界賽運彩</h2><span class="lbbal"></span></header>
      <div class="lbinfo">英雄聯盟世界賽，單場勝負。賠率同步自 Pinnacle 的盤口。賠率資料來源有呼叫次數限制，為了撐完整個世界賽，更新頻率很低（約每幾個小時一次，只有比賽快開始且有人開著頁面才更新）；下注後賠率以下注當下為準，開賽前 1 分鐘截止，賽果出來自動派彩。用的是 bot 的虛擬代幣，打平或比賽取消會退款。</div>
      <div class="lbauth"></div>
      <div class="lbsheet" hidden></div>
      <div class="lbnote"></div>
      <div class="lblist"></div>
      <div class="lbhist"></div>
    </div>`;
  const $ = (q) => root.querySelector(q);
  $(".back").addEventListener("click", () => { destroy(); back(); });

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; if (session) send({ t: "bauth", token: session.token }); send({ t: "lolget" }); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "lolstate") { st = m; render(); }
      else if (m.t === "bauthed") onAuthed(m);
      else if (m.t === "lolres") onRes(m);
      else if (m.t === "lolhist") { hist = m.list; renderHist(); }
    };
    ws.onclose = () => { if (closed) return; note = "連線中斷，重新連線…"; renderNote(); timers.push(setTimeout(connect, Math.min(5000, 700 * ++retry))); };
    ws.onerror = () => {};
  }
  function onAuthed(m) {
    if (!m.ok) { session = null; env.session = null; note = m.error === "bot_down" ? ERR.bot_down : "登入已失效，請重新登入"; }
    else { balance = m.balance; if (session) session.name = m.name || session.name; note = ""; send({ t: "lolget" }); }
    renderAuth(); renderNote();
  }
  async function login() {
    try {
      const s = await ensureSession(env, (t) => { note = t; renderNote(); });
      session = s; send({ t: "bauth", token: s.token });
    } catch (e) { note = (e && e.message) || "登入失敗"; renderNote(); }
  }
  function onRes(m) {
    busy = false;
    if (m.ok) { balance = m.balance; sel = null; note = `✅ 下注成功：${money(m.bet.amount)} 賠率 ${m.bet.odds}`; if (showHist) send({ t: "lolhist" }); }
    else {
      note = "❌ " + (ERR[m.error] || m.error) + (m.error === "odds_changed" ? `（新賠率 ${m.odds}）` : m.error === "bad_amount" && m.limit ? `（單注上限 ${money(m.limit)}）` : m.error === "too_much" ? `（每場上限 ${money(m.limit)}，已下 ${money(m.have)}）` : "");
      if (m.balance != null) balance = m.balance;
    }
    render();
  }

  const fmtTime = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fmtAgo = (ms) => { if (!ms) return "尚未同步"; const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 90 ? "剛剛" : Math.round(s / 60) + " 分鐘前"; };
  const findF = (id) => st && st.list.find((f) => f.id === id);

  function renderAuth() {
    const el = $(".lbauth");
    $(".lbbal").textContent = session && balance != null ? "💰 " + money(balance) : "";
    el.innerHTML = session ? `<span class="lbme">👤 ${esc(session.name || "")}</span>` : `<button class="lblogin">用 Discord 登入才能下注</button>`;
    const b = el.querySelector(".lblogin"); if (b) b.addEventListener("click", login);
  }
  function renderNote() { $(".lbnote").textContent = note; }

  function card(f) {
    const mine = f.mine.map((b) => `<div class="lbmine ${b.status}">我押 ${esc(b.side === "home" ? f.home : f.away)}　${money(b.amount)} × ${b.odds}　${BSTAT[b.status] || b.status}${b.status === "won" || b.status === "void" ? ` +${money(b.payout)}` : ""}</div>`).join("");
    const others = (f.all && f.all.length) ? `<div class="lball"><b>👥 大家的注（${f.all.length}）</b>${f.all.map((b) => `<div class="lbo ${b.status}">${esc(b.name)} 押 ${esc(b.side === "home" ? f.home : f.away)}　${money(b.amount)} × ${b.odds}　${BSTAT[b.status] || b.status}${b.status === "won" ? ` +${money(b.payout - b.amount)}` : b.status === "lost" ? ` -${money(b.amount)}` : ""}</div>`).join("")}</div>` : "";
    const score = f.score ? `<b class="lbsc">${f.score[0]} : ${f.score[1]}</b>` : `<i>vs</i>`;
    const winner = f.state === "finished" && f.score && f.score[0] !== f.score[1] ? (f.score[0] > f.score[1] ? 0 : 1) : -1;
    const open = f.state === "open";
    const btn = (side, name, odds, w) => `<button class="lbteam${sel && sel.id === f.id && sel.side === side ? " on" : ""}${w ? " win" : ""}" data-f="${f.id}" data-s="${side}" ${open ? "" : "disabled"}>${logo(name)}<span>${esc(name)}</span>${seedTag(name)}${odds ? `<em>${odds}</em>` : ""}</button>`;
    const tag = { open: "可下注", live: "已截止／進行中", finished: "已結束", void: "取消", closed: "暫無盤口" }[f.state];
    return `<div class="lbcard ${f.state}"><div class="lbtop"><span>${fmtTime(f.start)}${f.bo ? `<b class="lbbo">Bo${f.bo}</b>` : ""}</span><span class="lbtag">${tag}</span></div>
      <div class="lbrow">${btn("home", f.home, f.oh, winner === 0)}${score}${btn("away", f.away, f.oa, winner === 1)}</div>${mine}${others}</div>`;
  }

  function render() {
    renderAuth(); renderNote();
    const el = $(".lblist");
    if (!st) { el.innerHTML = `<div class="mempty">載入中…</div>`; return; }
    if (!st.ok) { el.innerHTML = `<div class="mempty">世界賽運彩尚未啟用（伺服器沒有設定賠率來源）。</div>`; return; }
    const g = (s) => st.list.filter((f) => s.includes(f.state));
    const sec = (title, arr) => arr.length ? `<h3 class="lbh">${title}</h3>${arr.map(card).join("")}` : "";
    const fin = g(["finished", "void"]).reverse().slice(0, 8);
    el.innerHTML = (st.list.length ? "" : `<div class="mempty">目前沒有世界賽場次。</div>`)
      + sec("可下注", g(["open"])) + sec("已截止／進行中", g(["live"])) + sec("賽程・尚未開盤", g(["closed"])) + sec("最近結果", fin)
      + (st.board && st.board.length ? `<h3 class="lbh">🏅 輸贏榜（已結算的注單）</h3><div class="lbboard">${st.board.map((r, i) => `<div class="lbrank"><span>${i + 1}</span><b>${esc(r.name)}</b><em class="${r.net >= 0 ? "up" : "down"}">${r.net >= 0 ? "+" : ""}${money(r.net)}</em><small>${r.w}／${r.n} 贏</small></div>`).join("")}</div>` : "")
      + `<div class="lbfoot">賠率更新：${fmtAgo(st.updatedAt)}${st.dead ? "（資料來源額度已用完，賠率不再更新，暫停下注）" : st.err ? "（最近一次同步失敗，賠率可能不是最新）" : `（目前約每 ${st.every >= 120 ? Math.round(st.every / 60) + " 小時" : st.every + " 分鐘"}更新一次）`}　單注上限 ${money(st.limit)}，每場合計上限 ${money(st.maxFixture)}</div>`
      + `<button class="lbhbtn">${showHist ? "收起" : "我的注單紀錄"}</button>`;
    el.querySelectorAll(".lbteam").forEach((b) => b.addEventListener("click", () => {
      if (b.disabled) return; sel = { id: b.dataset.f, side: b.dataset.s }; note = ""; render(); renderSheet();
    }));
    el.querySelector(".lbhbtn").addEventListener("click", () => { showHist = !showHist; if (showHist) send({ t: "lolhist" }); render(); renderHist(); });
    if (sel) { const f = findF(sel.id); if (!f || f.state !== "open") { sel = null; } }
    renderSheet();
  }

  // 下注單固定放在上面，賠率更新重畫清單時不會洗掉輸入
  let sheetKey = "";
  function renderSheet() {
    const el = $(".lbsheet");
    if (!sel) { el.hidden = true; el.innerHTML = ""; sheetKey = ""; return; }
    const f = findF(sel.id); if (!f) { el.hidden = true; return; }
    const odds = sel.side === "home" ? f.oh : f.oa, name = sel.side === "home" ? f.home : f.away;
    const key = sel.id + sel.side + odds;
    if (key !== sheetKey) {
      sheetKey = key; el.hidden = false;
      el.innerHTML = `<div class="lbsl">押 ${logo(name)}<b>${esc(name)}</b> 贏　賠率 <b>${odds}</b><button class="lbx">✕</button></div>
        <div class="lbamts">${[10, 50, 100, 500].map((n) => `<button data-n="${n}">${n}</button>`).join("")}<input class="lbin" type="number" min="1" step="1" inputmode="numeric" placeholder="自訂"></div>
        <div class="lbpay"></div><button class="lbgo">確認下注</button>`;
      el.querySelector(".lbx").addEventListener("click", () => { sel = null; render(); });
      el.querySelectorAll(".lbamts button").forEach((b) => b.addEventListener("click", () => { amount = Number(b.dataset.n); el.querySelector(".lbin").value = ""; upd(); }));
      el.querySelector(".lbin").addEventListener("input", (e) => { const n = Math.floor(Number(e.target.value)); if (n >= 1) { amount = n; upd(); } });
      el.querySelector(".lbgo").addEventListener("click", () => {
        if (!session) { login(); return; }
        if (busy) return; busy = true; note = "下注中…"; renderNote(); upd();
        send({ t: "lolbet", fixtureId: sel.id, side: sel.side, amount, odds });
      });
    }
    upd();
    function upd() {
      el.querySelectorAll(".lbamts button").forEach((b) => b.classList.toggle("sel", Number(b.dataset.n) === amount));
      el.querySelector(".lbpay").textContent = `下注 ${money(amount)}，贏了拿回 ${money(Math.floor(amount * odds))}（淨賺 ${money(Math.floor(amount * odds) - amount)}）`;
      const go = el.querySelector(".lbgo"); go.disabled = busy; go.textContent = session ? (busy ? "處理中…" : "確認下注") : "先登入";
    }
  }

  function renderHist() {
    const el = $(".lbhist");
    if (!showHist) { el.innerHTML = ""; return; }
    if (!session) { el.innerHTML = `<div class="mempty">登入後才看得到注單。</div>`; return; }
    if (!hist) { el.innerHTML = `<div class="mempty">載入中…</div>`; return; }
    const row = (b) => {
      const [h, a] = b.home ? [b.home, b.away] : (b.label || " vs ").split(" vs "), mine = b.side === "home" ? h : a;
      const res = b.score ? ` ${b.score[0]}:${b.score[1]}（${b.score[0] > b.score[1] ? h : a} 勝）` : "";
      return `<div class="lbmine ${b.status}">${fmtTime(b.at)}　${esc(h)} vs ${esc(a)}${res}<br>押 ${esc(mine)}　${money(b.amount)} × ${b.odds}　${BSTAT[b.status] || b.status}${b.payout && b.status !== "lost" ? ` +${money(b.payout)}` : ""}</div>`;
    };
    el.innerHTML = hist.length ? hist.map(row).join("") : `<div class="mempty">還沒有注單。</div>`;
  }

  function destroy() { closed = true; timers.forEach(clearTimeout); clearInterval(tick); try { ws && ws.close(); } catch {} }
  const tick = setInterval(() => { if (st && !sel) render(); }, 30000);   // 讓「幾分鐘前」和開賽時間保持新鮮
  const lw = setInterval(() => { if (logoIdx && seedIdx) { clearInterval(lw); render(); } }, 300); timers.push(lw);
  render(); connect();
  return destroy;
}
