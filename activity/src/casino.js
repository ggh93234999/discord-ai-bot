// 賭場小遊戲：擲硬幣、骰子、21 點、賽馬。結果由伺服器決定，這裡只負責選項與演出。
// 模式和老虎機一樣：練習模式（練習幣）／賭注模式（Discord 授權後動用機器人錢包的真代幣）。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";

const BETS = [10, 50, 100, 500];
const ERR = {
  insufficient: "代幣不夠，選小一點的賭注", bot_down: "機器人暫時連不上，稍後再試", need_login: "要先登入才能用賭注模式",
  no_guild: "找不到伺服器，請聯絡管理員", bad_amount: "賭注不合法", error: "發生錯誤，再試一次",
};
const TITLES = { coin: "擲硬幣", dice: "骰子", bj: "21 點", horse: "賽馬" };
const HINTS = {
  coin: "猜正反面，猜中拿回 2 倍（賺 1 倍），猜錯輸光",
  dice: "你和莊家各擲兩顆骰子比點數，大的贏（拿回 2 倍），一樣退錢",
  bj: "點數最接近 21 不爆牌就贏；贏拿 2 倍，Blackjack 拿 2.5 倍，平手退錢",
  horse: "選一匹馬下注，賠率 = 中了拿回的倍數（含本金）；每次開跑馬匹狀態都不同",
};
const dieFace = (n) => "⚀⚁⚂⚃⚄⚅"[n - 1];

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

    let ws = null, closed = false, retry = 0, bet = 50, busy = false, wantReal = false;
    let mode = "practice", session = env.session || null, practiceBal = null, realBal = null;
    let pick = "heads", horseCard = null, horseIdx = -1, inHand = false, raced = false;
    const timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const real = () => mode === "real";
    const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => {
        retry = 0; send({ t: "cjoin" });
        if (session) send({ t: "bauth", token: session.token });
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "cinit") { practiceBal = m.balance; showBalance(); statusEl.textContent = "選賭注，開始吧"; if (game === "horse" && !horseCard) send({ t: "chorse", a: "card" }); }
        else if (m.t === "cres") onRes(m);
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
      resetBtn.hidden = real() || !(practiceBal != null && practiceBal < Math.min(...BETS) && !inHand);
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
      showBalance();
      statusEl.textContent = m === "real" ? `賭注模式：${session ? session.name : ""}，用的是真代幣！` : "練習模式：選賭注，開始吧";
    }
    function askConfirm(text, onYes) {
      confirmEl.hidden = false; $(".ctext").textContent = text;
      $(".cyes").onclick = () => { confirmEl.hidden = true; onYes(); };
      $(".cno").onclick = () => { confirmEl.hidden = true; statusEl.textContent = "已取消"; };
    }
    modeBtns.forEach((b) => b.addEventListener("click", () => {
      if (busy || inHand) return;
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
      b.addEventListener("click", () => { if (busy || inHand) return; bet = v; markBets(); });
      betsEl.append(b);
    });
    const markBets = () => betsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", Number(b.dataset.v) === bet));
    markBets();
    resetBtn.addEventListener("click", () => send({ t: "creset" }));

    const btn = (label, cls, fn) => { const b = document.createElement("button"); b.className = "spin " + (cls || ""); b.textContent = label; b.addEventListener("click", fn); return b; };
    const money = (n) => n.toLocaleString();
    function resultLine(m) {
      const net = m.back - m.bet;
      return m.back > m.bet ? `🎉 +${money(net)}（拿回 ${money(m.back)}）` : m.back === m.bet ? `🤝 退回 ${money(m.bet)}` : `😢 -${money(m.bet)}`;
    }

    // ---- 畫面
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
        if (!inHand) ctl.append(btn("🃏 發牌", "", () => { busy = true; stage.querySelector(".cresult")?.remove(); send({ t: "cbj", a: "deal", bet, real: real() }); }));
        else ctl.append(btn("➕ 要牌", "", () => send({ t: "cbj", a: "hit" })), btn("✋ 停牌", "alt", () => send({ t: "cbj", a: "stand" })));
      } else if (game === "horse") {
        if (raced) { ctl.append(btn("🏇 下一場", "", () => { if (!horseCard) { statusEl.textContent = "馬匹準備中…"; return; } raced = false; stage.innerHTML = ""; horseIdx = -1; statusEl.textContent = "選一匹馬"; draw(); })); return; }
        horseList();
        ctl.append(btn("🏁 開跑", "", startRace), btn("🔄 換一批馬", "alt", () => { if (!busy) { horseCard = null; horseIdx = -1; stage.innerHTML = ""; send({ t: "chorse", a: "card" }); } }));
      }
      ctl.querySelectorAll(".spin").forEach((b) => (b.disabled = busy && !inHand));
    }
    function play(o) { if (busy) return; busy = true; draw(); statusEl.textContent = "…"; send({ t: "cplay", bet, real: real(), ...o }); }

    // ---- 結果
    function onRes(m) {
      setBal(m);
      if (m.g === "coin") coinAnim(m);
      else if (m.g === "dice") diceAnim(m);
      else if (m.g === "bj") bjShow(m);
      else if (m.g === "horse") {
        if (m.card) {
          horseCard = m; horseIdx = -1;
          if (!raced) horseList();   // 剛跑完時保留結果畫面，按「下一場」才換馬
        } else raceAnim(m);
      }
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

    // ---- 賽馬
    function horseList() {
      if (!horseCard) { stage.innerHTML = ""; return; }
      if (stage.querySelector(".track")) return;
      stage.innerHTML = `<div class="hlist">${horseCard.names.map((n, i) =>
        `<button class="hrow ${horseIdx === i ? "sel" : ""}" data-i="${i}"><b>${i + 1}</b><span>${n}</span><em>${horseCard.forms[i]}</em><i>賠率 ${horseCard.odds[i]}</i></button>`).join("")}</div>`;
      stage.querySelectorAll(".hrow").forEach((r) => r.addEventListener("click", () => { if (busy) return; horseIdx = Number(r.dataset.i); horseList(); }));
    }
    function startRace() {
      if (busy) return;
      if (!horseCard || horseIdx < 0) { statusEl.textContent = "先點一匹馬再開跑"; return; }
      busy = true; draw(); statusEl.textContent = "…";
      send({ t: "chorse", a: "bet", id: horseCard.id, idx: horseIdx, bet, real: real() });
    }
    function raceAnim(m) {
      const names = horseCard.names;
      stage.innerHTML = `<div class="track">${names.map((n, i) => `<div class="lane ${i === m.idx ? "mine" : ""}"><span class="ln">${i + 1} ${n}</span><span class="hz" data-i="${i}" style="left:0">🐎</span><span class="fin">🏁</span></div>`).join("")}</div>`;
      const hz = [...stage.querySelectorAll(".hz")], start = performance.now(), W = () => stage.querySelector(".lane").clientWidth - 90;
      const seed = names.map(() => Math.random() * 6);
      statusEl.textContent = "🏇 開跑！";
      (function frame() {
        if (closed) return;
        const t = performance.now() - start; let all = true;
        hz.forEach((h, i) => {
          const p = Math.min(1, t / m.times[i]), wob = p < 1 ? Math.sin(t / 180 + seed[i]) * 0.02 : 0;
          h.style.left = Math.max(0, Math.min(1, p * p * 0.35 + p * 0.65 + wob)) * W() + "px";
          if (p < 1) all = false;
        });
        if (!all) requestAnimationFrame(frame);
        else {
          const win = m.win;
          stage.insertAdjacentHTML("beforeend", `<div class="cresult ${m.back ? "win" : "lose"}">🏆 ${win + 1} 號 ${names[win]} 奪冠！你押 ${m.idx + 1} 號（賠率 ${m.odds[m.idx]}）　${resultLine(m)}${m.payfail ? "（派彩失敗，請聯絡管理員）" : ""}</div>`);
          statusEl.textContent = "再來一場？"; busy = false; horseCard = null; horseIdx = -1; raced = true;
          send({ t: "chorse", a: "card" }); draw();
        }
      })();
    }
    connect();
    draw();
    return () => { closed = true; timers.forEach(clearTimeout); try { ws.close(); } catch {} };
  };
}
