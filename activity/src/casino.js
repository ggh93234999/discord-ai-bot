// 賭場小遊戲：擲硬幣、骰子、21 點、賽馬（賽馬是全房一起押）。結果由伺服器決定，這裡只負責選項與演出。
// 模式和老虎機一樣：練習模式（練習幣）／賭注模式（Discord 授權後動用機器人錢包的真代幣）。
// 每個遊戲下方有「👀 同房玩家」旁觀面板。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { createWatch } from "./watch.js";
import { addBetInput } from "./betinput.js";

const BETS = [10, 50, 100, 500];
const ERR = {
  insufficient: "代幣不夠，選小一點的賭注", bot_down: "機器人暫時連不上，稍後再試", need_login: "要先登入才能用賭注模式",
  no_guild: "找不到伺服器，請聯絡管理員", bad_amount: "賭注不合法", closed: "這一場已經截止下注了", already: "這一場你已經下過注了",
  error: "發生錯誤，再試一次",
};
const TITLES = { coin: "擲硬幣", dice: "骰子", bj: "21 點", horse: "賽馬" };
const HINTS = {
  coin: "猜正反面，猜中拿回 2 倍（賺 1 倍），猜錯輸光",
  dice: "你和莊家各擲兩顆骰子比點數，大的贏（拿回 2 倍），一樣退錢",
  bj: "點數最接近 21 不爆牌就贏；贏拿 2 倍，Blackjack 拿 2.5 倍，平手退錢",
  horse: "全房一起押：下注時間內選馬下注，時間到大家一起看比賽，押中拿 賭注×賠率",
};
const dieFace = (n) => "⚀⚁⚂⚃⚄⚅"[n - 1];
const money = (n) => n.toLocaleString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountCasino(game) {
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots casino">
        <header><button class="back">← 選單</button><h2>${TITLES[game]}</h2><span class="watch"></span></header>
        <div class="modebar">
          <button class="mode on" data-m="practice">🎮 練習模式</button>
          <button class="mode" data-m="real">💰 賭注模式</button>
        </div>
        <div class="confirm" hidden>
          <div class="ctext"></div>
          <div class="cbtns"><button class="cyes">確定開啟</button><button class="cno">取消</button></div>
        </div>
        <div class="status">連線中…</div>
        <div class="cstage"></div>
        <div class="hint">${HINTS[game]}</div>
        <div class="bar">
          <div class="bal"><span class="ballabel">練習幣</span> <b>--</b></div>
          <div class="bets"></div>
        </div>
        <div class="cctl"></div>
        <div class="actions"><button class="reset" hidden>補充練習幣</button></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), stage = $(".cstage"), ctl = $(".cctl"), balEl = $(".bal b"), resetBtn = $(".reset");
    const gameEl = $(".casino"), confirmEl = $(".confirm"), betsEl = $(".bets");
    $(".back").addEventListener("click", back);
    attachRules(root, game);
    const watch = createWatch(gameEl);

    let ws = null, closed = false, retry = 0, bet = 50, busy = false, wantReal = false, you = null;
    let mode = "practice", session = env.session || null, practiceBal = null, realBal = null;
    let pick = "heads", inHand = false;
    let hs = null, skew = 0, horseSel = -1, raf = 0, tickTimer = 0;     // 賽馬狀態
    const timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const real = () => mode === "real";
    const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => {
        retry = 0; send({ t: "cjoin", game, room: env.instanceId });
        if (session) send({ t: "bauth", token: session.token });
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "cinit") { practiceBal = m.balance; you = m.you; watch.setYou(you); showBalance(); statusEl.textContent = game === "horse" ? "選一匹馬，下注吧" : "選賭注，開始吧"; }
        else if (m.t === "cwho") watch.update(m.list);
        else if (m.t === "cres") onRes(m);
        else if (m.t === "hstate") onHorse(m);
        else if (m.t === "cbal") { if (m.balance != null) { if (m.real) realBal = m.balance; else practiceBal = m.balance; showBalance(); } if (m.payfail) statusEl.textContent = "派彩失敗，請聯絡管理員"; }
        else if (m.t === "cerr") onErr(m);
        else if (m.t === "bauthed") onAuthed(m);
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; later(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }

    const cur = () => (real() ? realBal : practiceBal);
    function showBalance() {
      const b = cur();
      balEl.textContent = b == null ? "--" : b.toLocaleString();
      resetBtn.hidden = real() || !(practiceBal != null && practiceBal < 1 && !inHand);
      if (typeof markBets === "function") markBets();
    }
    function setBal(m) { if (m.balance == null) return; if (m.real) realBal = m.balance; else practiceBal = m.balance; showBalance(); }
    function onErr(m) {
      busy = false; if (m.balance != null) { if (real()) realBal = m.balance; else practiceBal = m.balance; showBalance(); }
      statusEl.textContent = ERR[m.error] || ERR.error; draw();
    }

    // ---- 模式切換／登入（和老虎機相同）
    const modeBtns = root.querySelectorAll(".mode");
    function setMode(m) {
      mode = m;
      modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.m === m));
      gameEl.classList.toggle("realmode", m === "real");
      $(".ballabel").textContent = m === "real" ? "💰 代幣" : "練習幣";
      showBalance(); draw();
      statusEl.textContent = m === "real" ? `賭注模式：${session ? session.name : ""}，用的是真代幣！` : "練習模式：選賭注，開始吧";
    }
    function askConfirm(text, onYes) {
      confirmEl.hidden = false; $(".ctext").textContent = text;
      $(".cyes").onclick = () => { confirmEl.hidden = true; onYes(); };
      $(".cno").onclick = () => { confirmEl.hidden = true; statusEl.textContent = "已取消"; };
    }
    modeBtns.forEach((b) => b.addEventListener("click", () => {
      if (busy || inHand || myBet()) return;
      if (b.dataset.m === "practice") { setMode("practice"); return; }
      if (real()) return;
      if (!env.inDiscord || !env.sdk) { statusEl.textContent = "賭注模式要在 Discord 裡開啟這個 Activity 才能用（要確認你的 Discord 身分）"; return; }
      askConfirm("賭注模式會用到你在機器人那邊的真代幣，輸贏都會算數。要開啟嗎？（第一次會跳出 Discord 授權視窗）", login);
    }));
    async function login() {
      try {
        if (!session) {
          statusEl.textContent = "請在 Discord 跳出的視窗按「授權」…";
          await env.sdk.ready();
          const { code } = await env.sdk.commands.authorize({ client_id: env.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"] });
          statusEl.textContent = "確認身分中…";
          const r = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
          const j = await r.json().catch(() => ({}));
          if (r.status === 403) { statusEl.textContent = "你不是這個伺服器的成員，不能用賭注模式"; return; }
          if (!r.ok || !j.token) { statusEl.textContent = "登入失敗，請再試一次（" + (j.error || r.status) + "）"; return; }
          session = { token: j.token, name: j.name }; env.session = session;
        }
        wantReal = true; send({ t: "bauth", token: session.token });
      } catch (e) { statusEl.textContent = "授權沒有完成：" + ((e && (e.message || e.code)) || "未知錯誤"); }
    }
    function onAuthed(m) {
      if (!m.ok) {
        session = null; env.session = null;
        if (wantReal) { wantReal = false; statusEl.textContent = m.error === "bot_down" ? ERR.bot_down : "登入已失效，請重新開啟賭注模式"; }
        if (real()) setMode("practice");
        return;
      }
      realBal = m.balance; session.name = m.name || session.name;
      if (wantReal) { wantReal = false; setMode("real"); } else showBalance();
    }

    BETS.forEach((v) => {
      const b = document.createElement("button"); b.textContent = v; b.dataset.v = v;
      b.addEventListener("click", () => { if (busy || inHand || myBet()) return; bet = v; markBets(); draw(); });
      betsEl.append(b);
    });
    const bi = addBetInput(betsEl, { getBet: () => bet, setBet: (n) => { bet = n; markBets(); draw(); }, getBal: () => cur(), locked: () => busy || inHand || !!myBet() });
    const markBets = () => { betsEl.querySelectorAll("button[data-v]").forEach((b) => b.classList.toggle("sel", Number(b.dataset.v) === bet)); bi.refresh(BETS); };
    markBets();
    resetBtn.addEventListener("click", () => send({ t: "creset" }));

    const btn = (label, cls, fn) => { const b = document.createElement("button"); b.className = "spin " + (cls || ""); b.textContent = label; b.addEventListener("click", fn); return b; };
    function resultLine(m) {
      const net = m.back - m.bet;
      return m.back > m.bet ? `🎉 +${money(net)}（拿回 ${money(m.back)}）` : m.back === m.bet ? `🤝 退回 ${money(m.bet)}` : `😢 -${money(m.bet)}`;
    }

    // ---- 控制鈕
    function draw() {
      ctl.innerHTML = "";
      if (game === "coin") {
        const row = document.createElement("div"); row.className = "cpick";
        for (const [v, l] of [["heads", "正面"], ["tails", "反面"]]) {
          const b = document.createElement("button"); b.textContent = l; b.className = pick === v ? "sel" : "";
          b.addEventListener("click", () => { if (!busy) { pick = v; draw(); } }); row.append(b);
        }
        ctl.append(row, btn("🪙 擲！", "", () => play({ g: "coin", pick })));
      } else if (game === "dice") ctl.append(btn("🎲 擲骰", "", () => play({ g: "dice" })));
      else if (game === "bj") {
        if (!inHand) ctl.append(btn("🃏 發牌", "", () => { busy = true; stage.querySelector(".cresult")?.remove(); draw(); send({ t: "cbj", a: "deal", bet, real: real() }); }));
        else ctl.append(btn("➕ 要牌", "", () => send({ t: "cbj", a: "hit" })), btn("✋ 停牌", "alt", () => send({ t: "cbj", a: "stand" })));
      } else if (game === "horse") {
        const canBet = hs && hs.phase === "bet" && !myBet();
        const label = !hs ? "連線中…" : myBet() ? `✅ 已下注 ${myBet().bet} 押 ${myBet().idx + 1} 號` : hs.phase === "bet" ? (horseSel < 0 ? "先點一匹馬" : `💰 下注 ${bet} 押 ${horseSel + 1} 號`) : hs.phase === "run" ? "比賽進行中…" : "下一場即將開始…";
        const b = btn(label, "", () => { if (canBet && horseSel >= 0) { busy = true; draw(); send({ t: "chorse", a: "bet", id: hs.id, idx: horseSel, bet, real: real() }); } });
        b.disabled = !(canBet && horseSel >= 0) || busy; ctl.append(b);
      }
      ctl.querySelectorAll(".spin").forEach((b) => { if (game !== "horse") b.disabled = busy && !inHand; });
    }
    function play(o) { if (busy) return; busy = true; draw(); statusEl.textContent = "…"; send({ t: "cplay", bet, real: real(), ...o }); }

    // ---- 結果
    function onRes(m) {
      setBal(m);
      if (m.g === "coin") coinAnim(m);
      else if (m.g === "dice") diceAnim(m);
      else if (m.g === "bj") bjShow(m);
    }
    function coinAnim(m) {
      stage.innerHTML = `<div class="coin flip">🪙</div>`;
      later(() => {
        stage.innerHTML = `<div class="coin">${m.res === "heads" ? "🟡 正面" : "⚪ 反面"}</div><div class="cresult ${m.back ? "win" : "lose"}">${m.res === m.pick ? "猜中了！" : "猜錯了…"} ${resultLine(m)}</div>`;
        busy = false; statusEl.textContent = "再來一把？"; draw();
      }, 900);
    }
    function diceAnim(m) {
      stage.innerHTML = `<div class="dice"><div><small>你</small><span class="d">🎲</span><span class="d">🎲</span></div><div><small>莊家</small><span class="d">🎲</span><span class="d">🎲</span></div></div>`;
      const ds = stage.querySelectorAll(".d"); ds.forEach((d) => d.classList.add("roll"));
      later(() => {
        const vals = [...m.me, ...m.bot];
        ds.forEach((d, i) => { d.classList.remove("roll"); d.textContent = dieFace(vals[i]); });
        const a = m.me[0] + m.me[1], b = m.bot[0] + m.bot[1];
        stage.insertAdjacentHTML("beforeend", `<div class="cresult ${m.back > m.bet ? "win" : m.back === m.bet ? "" : "lose"}">你 ${a} 點 vs 莊家 ${b} 點　${resultLine(m)}</div>`);
        busy = false; statusEl.textContent = "再來一把？"; draw();
      }, 800);
    }
    function cardsHtml(list, hideSecond) {
      return list.map((c) => `<span class="pcard ${/♥|♦/.test(c) ? "red" : ""}">${c}</span>`).join("") + (hideSecond ? `<span class="pcard back">?</span>` : "");
    }
    function bjShow(m) {
      inHand = !m.done; busy = false;
      let html = `<div class="bjrow"><small>莊家${m.done ? `（${m.dv} 點）` : ""}</small><div>${m.done ? cardsHtml(m.dealer) : cardsHtml([m.dealerUp], true)}</div></div>
        <div class="bjrow"><small>你（${m.pv} 點）</small><div>${cardsHtml(m.player)}</div></div>`;
      if (m.done) {
        html += `<div class="cresult ${m.back > m.bet ? "win" : m.back === m.bet ? "" : "lose"}">${m.text} ${resultLine(m)}${m.payfail ? "（派彩失敗，請聯絡管理員）" : ""}</div>`;
        statusEl.textContent = "再來一局？";
      } else statusEl.textContent = "要牌或停牌";
      stage.innerHTML = html; showBalance(); draw();
    }

    // ---- 賽馬（全房一起押）
    const myBet = () => (hs && you ? hs.bets.find((b) => b.id === you) : null);
    function onHorse(m) {
      const newRound = !hs || hs.id !== m.id;
      hs = m; skew = m.now - Date.now(); busy = false;
      if (newRound) { horseSel = -1; stage.innerHTML = ""; }
      renderHorse(); draw();
    }
    const serverNow = () => Date.now() + skew;
    function renderHorse() {
      if (!hs) return;
      cancelAnimationFrame(raf); clearInterval(tickTimer);
      const mine = myBet(), tot = hs.bets.reduce((a, b) => a + b.bet, 0);
      const per = hs.names.map((_, i) => hs.bets.filter((b) => b.idx === i).length);
      const head = hs.phase === "bet" ? `第 ${hs.no} 場　<b class="cd">--</b> 秒後截止下注` : hs.phase === "run" ? `第 ${hs.no} 場　🏇 比賽進行中！` : `第 ${hs.no} 場　🏆 ${esc(hs.names[hs.win])} 奪冠！`;
      let html = `<div class="hhead">${head}</div>`;
      if (hs.phase === "bet") {
        html += `<div class="hlist">${hs.names.map((n, i) =>
          `<button class="hrow ${horseSel === i ? "sel" : ""} ${mine && mine.idx === i ? "mine" : ""}" data-i="${i}"><b>${i + 1}</b><span>${esc(n)}</span><em>${hs.forms[i]}${per[i] ? `　👥${per[i]}` : ""}</em><i>賠率 ${hs.odds[i]}</i></button>`).join("")}</div>`;
      } else {
        html += `<div class="track">${hs.names.map((n, i) => `<div class="lane ${mine && mine.idx === i ? "mine" : ""}"><span class="ln">${i + 1} ${esc(n)}</span><span class="hz" data-i="${i}" style="left:0">🐎</span><span class="fin">🏁</span></div>`).join("")}</div>`;
      }
      html += `<div class="hbets"><h4>本場下注${hs.bets.length ? `（${hs.bets.length} 人，共 ${money(tot)}）` : ""}</h4>${hs.bets.length ? hs.bets.map((b) => {
        const res = hs.phase === "result" ? (b.back > 0 ? `<b class="w">+${money(b.back - b.bet)}</b>` : `<b class="l">-${money(b.bet)}</b>`) : "";
        return `<div class="hb ${b.id === you ? "me" : ""}"><span>${b.real ? "💰" : "🎮"} ${esc(b.name)}${b.id === you ? "（你）" : ""}</span><span>押 ${b.idx + 1} 號 ${esc(hs.names[b.idx])}　${money(b.bet)}</span>${res}</div>`;
      }).join("") : `<div class="mempty">還沒有人下注。你可以當第一個，或等朋友下注後旁觀比賽。</div>`}</div>`;
      stage.innerHTML = html;
      stage.querySelectorAll(".hrow").forEach((r) => r.addEventListener("click", () => { if (busy || myBet() || hs.phase !== "bet") return; horseSel = Number(r.dataset.i); renderHorse(); draw(); }));
      if (hs.phase === "bet") {
        const cd = stage.querySelector(".cd");
        const tick = () => { const s = Math.max(0, Math.ceil((hs.closeAt - serverNow()) / 1000)); cd.textContent = s; if (!hs.bets.length && s === 0) cd.textContent = "等人下注"; };
        tick(); tickTimer = setInterval(tick, 250);
        statusEl.textContent = mine ? "已下注，等開跑" : "選馬、選賭注，按下注";
      } else animateRace();
    }
    function animateRace() {
      const hz = [...stage.querySelectorAll(".hz")], lane = stage.querySelector(".lane");
      const width = () => lane.clientWidth - 90;
      const frame = () => {
        if (closed || !hs || hs.phase === "bet") return;
        const t = serverNow() - hs.startAt; let all = true;
        hz.forEach((h, i) => {
          const p = Math.max(0, Math.min(1, t / hs.times[i])), wob = p > 0 && p < 1 ? Math.sin(t / 180 + i * 1.7) * 0.02 : 0;
          h.style.left = Math.max(0, Math.min(1, p * p * 0.35 + p * 0.65 + wob)) * width() + "px";
          if (p < 1) all = false;
        });
        if (!all) raf = requestAnimationFrame(frame);
      };
      frame();
      const mine = myBet();
      if (hs.phase === "run") statusEl.textContent = "🏇 開跑！";
      else statusEl.textContent = mine ? (mine.back > 0 ? `🎉 押中了！+${money(mine.back - mine.bet)}` : `😢 沒押中 -${money(mine.bet)}`) : `🏆 ${hs.names[hs.win]} 奪冠`;
    }
    const onResize = () => { if (hs && hs.phase !== "bet") renderHorse(); };
    window.addEventListener("resize", onResize);

    connect();
    draw();
    return () => { closed = true; window.removeEventListener("resize", onResize); cancelAnimationFrame(raf); clearInterval(tickTimer); timers.forEach(clearTimeout); watch.destroy(); try { ws.close(); } catch {} };
  };
}
