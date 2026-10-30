// UNO（練習點數）：發牌、判定、計分、電腦都在伺服器（server/uno.js），這裡只畫畫面和送操作。牌面全部用 CSS 畫，沒有用任何圖檔。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";

const COLOR = ["r", "y", "g", "b"], CNAME = ["紅", "黃", "綠", "藍"];
const colorOf = (c) => ((c %= 108) < 100 ? Math.floor(c / 25) : 4);
const kindOf = (c) => { c %= 108; if (c >= 104) return "f"; if (c >= 100) return "w"; const k = c % 25; return k <= 18 ? "n" : k <= 20 ? "s" : k <= 22 ? "r" : "d"; };
const numOf = (c) => { const k = (c % 108) % 25; return k === 0 ? 0 : Math.ceil(k / 2); };
const SYM = { s: "⊘", r: "⇄", d: "+2", w: "★", f: "+4" };
const face = (c) => (kindOf(c) === "n" ? String(numOf(c)) : SYM[kindOf(c)]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function card(c, cls = "", attrs = "", colorOverride = -1) {
  if (c == null || c < 0) return `<span class="uc back ${cls}" ${attrs}><em>UNO</em></span>`;
  const col = colorOverride >= 0 ? COLOR[colorOverride] : colorOf(c) === 4 ? "k" : COLOR[colorOf(c)];
  const f = face(c), six = kindOf(c) === "n" && (numOf(c) === 6 || numOf(c) === 9) ? " ul" : "";
  return `<span class="uc c${col} ${cls}" ${attrs}><i>${f}</i><b class="${six}">${f}</b><u>${f}</u></span>`;
}
function getPid() { try { let p = localStorage.getItem("unpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("unpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); } }
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountUno(opts = {}) {
  const spectate = opts.spectate || null;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots mj br bt un">
        <header><button class="back">← 選單</button><h2>UNO</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        <div class="brbody"></div>
        <div class="brlog"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "uno");
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), body = $(".brbody"), logEl = $(".brlog"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, timer = 0, pickWild = -1;
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "unjoin", room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "unstate") { st = m; st.at = Date.now() - m.now; if (st.phase !== "play") pickWild = -1; render(); }
        else if (m.t === "unerr") { statusEl.textContent = m.error === "full" ? "座位滿了" : m.error === "need2" ? "至少要 2 人才能開始（可以加電腦）" : m.error === "called" ? "他有喊 UNO，抓錯了" : m.error === "none" ? "現在抓不到" : "這張現在不能出"; }
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    const nm = (i) => esc(st.seats[i]?.name || "");

    function render() {
      watchEl.textContent = st.watchers ? `👀 ${st.watchers}` : "";
      logEl.textContent = st.log || "";
      if (st.phase === "wait" || st.phase === "end") renderLobby(); else renderTable();
      tickStatus();
    }

    // ---------------- 開打前
    function renderLobby() {
      const seated = st.you >= 0;
      const seats = Array.from({ length: 8 }, (_, i) => {
        const s = st.seats[i];
        if (!s) return `<div class="unls empty">${spectate ? "空位" : !seated ? `<button class="mb" data-sit="${i}">入座</button>` : `<button class="mb ghost" data-bot="${i}">＋電腦</button>`}</div>`;
        return `<div class="unls${i === st.you ? " me" : ""}"><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}${seated && s.bot ? `<button class="mdel" data-del="${i}">✕</button>` : ""}</div>`;
      }).join("");
      const nSeat = st.seats.filter(Boolean).length;
      let cfg = "";
      const c = st.cfg;
      if (seated && !spectate) {
        cfg = `<div class="mjcfg"><label>長度 <select class="cf-len">${st.lens.map((v) => `<option value="${v}"${c.len === v ? " selected" : ""}>${v} 手</option>`).join("")}</select></label>
          <label>每點 <select class="cf-base">${st.stakes.map((v) => `<option value="${v}"${c.base === v ? " selected" : ""}>${v} 點</option>`).join("")}</select></label>
          <label><input type="checkbox" class="cf-stack"${c.stack ? " checked" : ""}> 可疊加 +2／+4</label>
          <label><input type="checkbox" class="cf-chal"${c.challenge ? " checked" : ""}> +4 可質疑</label></div>
          <button class="mb start"${nSeat < 2 ? " disabled" : ""}>▶ 開始（${nSeat} 人）</button>${nSeat < 2 ? `<div class="mempty">至少要 2 人，可以按「＋電腦」補人。</div>` : ""}`;
      } else if (!spectate) cfg = `<div class="mempty">點「入座」坐下，2～8 人，可以加電腦。</div>`;
      const fin = st.final ? `<div class="mjfinal"><h3>牌局結束</h3>${st.final.map((r, k) => `<div class="fr${k === 0 ? " top" : ""}"><b>${esc(r.name)}</b><em>${r.points.toLocaleString()}</em></div>`).join("")}</div>` : "";
      body.innerHTML = `${fin}<div class="brlobby"><div class="unseats">${seats}</div>${cfg}<small>每人 10,000 點，練習用，不會動到代幣。每人 7 張，2～8 人，先出完的人贏（標準 UNO 規則，詳見右上角說明）；贏的人收其他人手上剩的牌點（數字＝面值、功能牌 20、變色牌 50）× 每點點數。</small>${seated && !spectate ? `<button class="mb ghost stand">離座</button>` : ""}</div>`;
      statusEl.textContent = spectate ? "👀 旁觀中，等開局" : st.phase === "end" ? "按開始再來一場" : "等玩家入座";
      body.querySelectorAll("[data-sit]").forEach((b) => b.addEventListener("click", () => send({ t: "unsit", seat: Number(b.dataset.sit) })));
      body.querySelectorAll("[data-bot]").forEach((b) => b.addEventListener("click", () => send({ t: "unaddbot", seat: Number(b.dataset.bot) })));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "undelbot", seat: Number(b.dataset.del) })));
      const q = (s) => body.querySelector(s);
      q(".start") && q(".start").addEventListener("click", () => send({ t: "unstart" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "unstand" }));
      const sendCfg = () => send({ t: "uncfg", len: Number(q(".cf-len").value), base: Number(q(".cf-base").value), stack: q(".cf-stack").checked, challenge: q(".cf-chal").checked });
      q(".cf-stack") && q(".cf-stack").addEventListener("change", sendCfg);
      q(".cf-chal") && q(".cf-chal").addEventListener("change", sendCfg);
      q(".cf-len") && q(".cf-len").addEventListener("change", sendCfg);
      q(".cf-base") && q(".cf-base").addEventListener("change", sendCfg);
    }

    // ---------------- 牌桌
    function seatBox(i) {
      const s = st.seats[i]; if (!s) return "";
      const turn = st.phase === "play" && st.turn === i;
      const backs = i === st.you ? "" : `<span class="brcnt"><span class="uc back xs"></span>${s.count}</span>`;
      const uno = st.phase === "play" && s.count === 1 && st.unoSeat === i ? `<span class="unobadge">UNO!</span>` : "";
      const catchBtn = st.phase === "play" && st.you >= 0 && !spectate && i !== st.you && s.count === 1 && st.unoSeat !== i ? `<button class="mb ghost uncatch" data-catch="${i}">抓！沒喊 UNO</button>` : "";
      return `<div class="unseat${turn ? " turn" : ""}${st.you === i ? " me" : ""}">
        <div class="brname"><b>${esc(s.name)}</b>${s.away ? "（離線）" : ""}</div>
        <div class="brsub">${backs}<em>${s.points.toLocaleString()}</em>${uno}</div>${catchBtn}
      </div>`;
    }
    function midHTML() {
      if (st.top == null) return `<div class="brmid"></div>`;
      const play = st.phase === "play";
      const dot = `<span class="uncolor c${COLOR[st.color]}" title="目前顏色：${CNAME[st.color]}"></span>`;
      const dir = play ? `<span class="undir">${st.dir > 0 ? "↻" : "↺"}</span>` : "";
      const info = play && st.last ? (st.last.card >= 0 ? `${nm(st.last.seat)} 出牌` : `${nm(st.last.seat)} 抽牌`) : "";
      return `<div class="brmid"><div class="brinfo"><div class="brct">${info}</div><div class="brtimer"></div></div>
        <div class="unpiles"><div class="undeck"><span class="uc back"><em>UNO</em></span><small>${st.deck ?? ""}</small></div>${card(st.top, "big top", "", st.color)}<div class="unside">${dot}${dir}</div></div></div>`;
    }
    function resultHTML(r) {
      const deltas = r.deltas.map((d, i) => `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${nm(i)} ${d > 0 ? "+" : ""}${d.toLocaleString()}</span>`).join("");
      const left = r.hands.map((h, i) => (i === r.winner ? "" : `<div class="btleft"><span>${nm(i)}（剩 ${h.length} 張，${r.pts[i]} 點）</span><div>${h.map((c) => card(c, "xs")).join("")}</div></div>`)).join("");
      return `<div class="mresult brres"><h3>第 ${r.handNo} 手　${nm(r.winner)} 贏了！</h3><div class="mdelta">${deltas}</div>${left}${r.gameOver ? "<div class='mrl'>這場打完了，馬上公布名次</div>" : ""}</div>`;
    }

    function renderTable() {
      const you = st.you, me = you >= 0 ? st.seats[you] : null, play = st.phase === "play";
      const n = st.seats.length, from = you >= 0 ? you : 0;
      const opps = Array.from({ length: n - (you >= 0 ? 1 : 0) }, (_, k) => (from + (you >= 0 ? k + 1 : k)) % n);     // 從我的下家開始，照出牌順序排
      let below = !play && st.result ? resultHTML(st.result) : `<div class="btspacer"></div>`;
      if (play && me) {
        const myTurn = st.turn === you, can = new Set(st.playable || []);
        const hand = `<div class="brhand bthand unhand${myTurn ? " act" : ""}">${(st.hand || []).map((c) => card(c, `big${myTurn && can.has(c) ? " can" : ""}`, `data-c="${c}"`)).join("")}</div>`;
        const pd = st.pend;
        const tip = pd ? (myTurn ? `${nm(pd.from)} 出了 ${pd.kind === "f" ? "+4" : "+2"}，累計要抽 ${pd.total} 張：${can.size ? "可以疊一張" : "你沒有可疊的牌"}${pd.canChal ? "、質疑，" : "，"}或全部抽起來` : `${nm(pd.victim)} 要決定：累計 ${pd.total} 張（疊／質疑／抽）`)
          : myTurn ? (st.drawn != null ? "抽到能出的牌了，點亮著的牌出牌（沒有「過」，一定要出）" : can.size ? "輪到你：點一張亮著的牌，或按「抽牌」" : "你沒有牌可以出，按「抽牌」") : `等 ${nm(st.turn)} 出牌…`;
        const callBtn = (st.hand.length === 2 && myTurn && !pd) || (st.hand.length === 1 && st.unoSeat !== you) ? `<button class="mb uncall">UNO！</button>` : "";
        const btns = myTurn || callBtn ? `<div class="btbtns">${st.canAccept ? `<button class="mb unacc">抽 ${pd.total} 張</button>` : ""}${st.canAccept && pd.canChal ? `<button class="mb ghost unchal">質疑 +4</button>` : ""}${callBtn}${st.canDraw ? `<button class="mb undraw">抽牌</button>` : ""}${st.canPass ? `<button class="mb ghost unpass">過</button>` : ""}</div>` : "";
        const pick = pickWild >= 0 ? `<div class="unpick"><b>選新的顏色</b><div>${[0, 1, 2, 3].map((k) => `<button class="uncolor c${COLOR[k]} big" data-col="${k}">${CNAME[k]}</button>`).join("")}</div><button class="mb ghost unpx">取消</button></div>` : "";
        below = `<div class="mhint">${tip}</div>${hand}${btns}${pick}`;
      } else if (play) {
        below = `<div class="mhint">${spectate ? "👀 旁觀中（看不到手牌）" : `還沒入座。可以點電腦的位置接手：${st.seats.map((s, i) => (s && s.bot ? `<button class="mb ghost" data-sit="${i}">接手 ${esc(s.name)}</button>` : "")).join("")}`}</div>`;
      }
      body.innerHTML = `<div class="untable"><div class="unopps">${opps.map(seatBox).join("")}</div>${midHTML()}${you >= 0 ? `<div class="unme">${seatBox(you)}</div>` : ""}</div>${below}${me && !spectate ? `<div class="mfoot"><button class="mb ghost stand">離座（電腦接手）</button></div>` : ""}`;
      body.querySelectorAll(".unhand .uc.can").forEach((el) => el.addEventListener("click", () => {
        const c = Number(el.dataset.c);
        if (colorOf(c) === 4) { pickWild = c; renderTable(); return; }
        send({ t: "unact", a: "play", card: c });
      }));
      body.querySelectorAll("[data-col]").forEach((el) => el.addEventListener("click", () => { const c = pickWild; pickWild = -1; send({ t: "unact", a: "play", card: c, color: Number(el.dataset.col) }); }));
      const px = body.querySelector(".unpx"); px && px.addEventListener("click", () => { pickWild = -1; renderTable(); });
      const ac = body.querySelector(".unacc"); ac && ac.addEventListener("click", () => send({ t: "unact", a: "accept" }));
      const ch = body.querySelector(".unchal"); ch && ch.addEventListener("click", () => send({ t: "unact", a: "challenge" }));
      const uc = body.querySelector(".uncall"); uc && uc.addEventListener("click", () => send({ t: "uncall" }));
      body.querySelectorAll("[data-catch]").forEach((el) => el.addEventListener("click", () => send({ t: "uncatch", seat: Number(el.dataset.catch) })));
      const dr = body.querySelector(".undraw"); dr && dr.addEventListener("click", () => send({ t: "unact", a: "draw" }));
      const ps = body.querySelector(".unpass"); ps && ps.addEventListener("click", () => send({ t: "unact", a: "pass" }));
      body.querySelectorAll("[data-sit]").forEach((el) => el.addEventListener("click", () => send({ t: "unsit", seat: Number(el.dataset.sit) })));
      const sb = body.querySelector(".stand"); sb && sb.addEventListener("click", () => send({ t: "unstand" }));
    }
    function tickStatus() {
      if (!st) return;
      const myTurn = st.phase === "play" && st.you >= 0 && st.turn === st.you;
      document.body.classList.toggle("mj-myturn", myTurn);
      if (st.phase === "wait" || st.phase === "end") return;
      const n = Date.now() - st.at;
      if (st.phase === "result") { statusEl.textContent = `第 ${st.handNo} 手結束　下一手 ${Math.max(0, Math.ceil((st.nextAt - n) / 1000))} 秒`; return; }
      const left = st.deadline ? Math.max(0, Math.ceil((st.deadline - n) / 1000)) : 0;
      statusEl.textContent = `UNO　第 ${st.handNo} / ${st.cfg.len} 手　${myTurn ? "輪到你" : `輪到 ${st.seats[st.turn]?.name || ""}`}`;
      const tEl = body.querySelector(".brtimer");
      if (tEl) { tEl.textContent = myTurn && left ? `⏱ ${left}` : ""; tEl.classList.toggle("urgent", myTurn && left <= 5); }
    }
    function cleanup() { closed = true; clearInterval(timer); document.body.classList.remove("mj-myturn"); try { ws && ws.close(); } catch {} }
    timer = setInterval(tickStatus, 250);
    connect();
    return cleanup;
  };
}
