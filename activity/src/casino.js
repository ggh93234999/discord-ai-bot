// 賭場小遊戲：擲硬幣、骰子、21 點、賽馬（賽馬是全房一起押）。結果由伺服器決定，這裡只負責選項與演出。
// 模式和老虎機一樣：練習模式（練習幣）／賭注模式（Discord 授權後動用機器人錢包的真代幣）。
// 每個遊戲下方有「👀 同房玩家」旁觀面板。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { createWatch, entryHtml } from "./watch.js";
import { createBetLog } from "./betlog.js";
import { addBetInput } from "./betinput.js";
import { horseCards } from "./horsecards.js";
import { createForge } from "./forgeui.js";

const BETS = [10, 50, 100, 500];
const ERR = {
  insufficient: "代幣不夠，選小一點的賭注", bot_down: "機器人暫時連不上，稍後再試", need_login: "要先登入才能用賭注模式",
  no_guild: "找不到伺服器，請聯絡管理員", bad_amount: "賭注不合法", closed: "這一場已經截止下注了", already: "這一場你已經下過注了",
  error: "發生錯誤，再試一次", 
};
const TITLES = { coin: "擲硬幣", dice: "骰子", bj: "21 點", horse: "賽馬", slots: "老虎機", forge: "鍛造" };
const HINTS = {
  coin: "猜正反面，猜中拿回 2 倍（賺 1 倍），猜錯輸光",
  dice: "你和莊家各擲兩顆骰子比點數，大的贏（拿回 2 倍），一樣退錢",
  bj: "點數最接近 21 不爆牌就贏；贏拿 2 倍，Blackjack 拿 2.5 倍，平手退錢",
  forge: "每升一階要付鍛造費，有機率成功，也可能劍碎（全部歸零）；階數越高賣價越高，隨時可以賣掉。共 100 階，劍會幫你存起來",
  horse: "全房一起押：下注時間內選馬下注，時間到大家一起看比賽，押中拿 賭注×賠率",
};
const dieFace = (n) => "⚀⚁⚂⚃⚄⚅"[n - 1];
const money = (n) => n.toLocaleString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountCasino(game, opts = {}) {
  const spectate = opts.spectate || null;       // { room } → 旁觀別人的房間，不能玩
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots casino">
        <header><button class="back">← 選單</button><h2>${spectate ? "👀 旁觀 · " : ""}${TITLES[game]}</h2><span class="watch"></span></header>
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
    const watch = spectate ? { setYou() {}, update() {}, destroy() {} } : createWatch(gameEl);
    if (spectate) gameEl.classList.add("spectating");
    const blog = spectate ? { onMsg: () => false, setMode() {}, destroy() {} } : createBetLog(gameEl, { send: (o) => send(o) });
    let specList = [], specSel = null, specSig = "";

    let ws = null, closed = false, retry = 0, bet = 50, busy = false, wantReal = false, you = null;
    let mode = "practice", session = env.session || null, practiceBal = null, realBal = null;
    let pick = "heads", inHand = false;
    let hs = null, skew = 0, horseSel = -1, raf = 0, tickTimer = 0;     // 賽馬狀態
    const timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const real = () => mode === "real";
    const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

    const forgePid = () => { try { let p = localStorage.getItem("forgepid"); if (!p) { p = Math.random().toString(36).slice(2, 12); localStorage.setItem("forgepid", p); } return p; } catch { return "x" + Math.random().toString(36).slice(2, 10); } };
    const forge = game === "forge" && !spectate ? createForge({ stage, ctl, statusEl, send: (o) => send(o), getReal: () => real(), setBal: (m) => setBal(m), pid: forgePid() }) : null;
    if (game === "forge") gameEl.classList.add("forge");

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => {
        retry = 0; send({ t: "cjoin", game, room: spectate ? spectate.room : env.instanceId, spectate: !!spectate });
        if (session) send({ t: "bauth", token: session.token });
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (blog.onMsg(m)) return;
        if (m.t === "cinit") { practiceBal = m.balance; you = m.you; watch.setYou(you); showBalance(); statusEl.textContent = spectate ? "旁觀中" : game === "horse" ? "選一匹馬，下注吧" : game === "forge" ? "鍛一把好劍吧" : "選賭注，開始吧"; if (forge) forge.refresh(); }
        else if (m.t === "fstate") { if (forge) forge.onState(m); }
        else if (m.t === "fres") { if (forge) forge.onRes(m); }
        else if (m.t === "cwho") { watch.update(m.list); if (spectate) specUpdate(m); }
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
      busy = false; if (forge) forge.busyReset(); if (m.balance != null) { if (real()) realBal = m.balance; else practiceBal = m.balance; showBalance(); }
      statusEl.textContent = ERR[m.error] || ERR.error; draw();
    }

    // ---- 模式切換／登入（和老虎機相同）
    const modeBtns = root.querySelectorAll(".mode");
    function setMode(m) {
      mode = m;
      modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.m === m));
      gameEl.classList.toggle("realmode", m === "real"); blog.setMode(m === "real");
      $(".ballabel").textContent = m === "real" ? "💰 代幣" : "練習幣";
      showBalance(); draw(); if (forge) forge.refresh();
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
      if (game === "forge") return;
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
    // 畫面分三塊：標題（倒數）、主區（馬匹清單或跑道）、下注名單。各塊只在內容真的變了才重畫，避免閃爍和版面跳動。
    const myBet = () => (hs && you ? hs.bets.find((b) => b.id === you) : null);
    let hsig = { main: "", bets: "", round: "" };
    let rcv = null, rctx = null, rW = 340, rH = 332, rparts = [], rseed = [], rconf = "";
    function onHorse(m) {
      const first = !hs || hs.id !== m.id;
      hs = m; skew = m.now - Date.now(); busy = false;
      if (first) { horseSel = -1; }
      renderHorse(); draw();
    }
    const serverNow = () => Date.now() + skew;
    const bar5 = (v) => { const n = Math.max(0, Math.min(5, Math.round((v - 40) / 11))); return "▰".repeat(n) + "▱".repeat(5 - n); };
    function horseInfo(i) {
      const f = hs.info && hs.info[i]; if (!f) return "";
      const rec = f.races ? `${f.races} 戰 ${f.wins} 勝（${Math.floor(f.wins * 100 / f.races)}%）` : "新馬，還沒有戰績";
      return `<div class="hd"><span class="coat" style="background:${f.coat || "#999"}"></span><b>${esc(f.style || "")}</b>　${esc(f.blurb || "")}<br>速度 ${bar5(f.spd)} ${f.spd}　耐力 ${bar5(f.sta)} ${f.sta}　爆發 ${bar5(f.bst)} ${f.bst}<br>戰績 ${rec}　近 5 場：${f.last.length ? f.last.join("、") : "—"}</div>`;
    }
    function renderHorse() {
      if (!hs) return;
      const mine = myBet(), tot = hs.bets.reduce((a, b) => a + b.bet, 0);
      const per = hs.names.map((_, i) => hs.bets.filter((b) => b.idx === i).length);
      const roundKey = hs.id + hs.phase;
      if (!stage.querySelector(".hmain")) stage.innerHTML = `<div class="hhead"></div><div class="hmain"></div><div class="hbets"></div>`;
      const head = stage.querySelector(".hhead"), main = stage.querySelector(".hmain"), betsBox = stage.querySelector(".hbets");

      head.innerHTML = hs.phase === "bet" ? `第 ${hs.no} 場　<b class="cd">--</b>` : hs.phase === "run" ? `第 ${hs.no} 場　🏇 比賽進行中！` : `第 ${hs.no} 場　🏆 ${esc(hs.names[hs.win])} 奪冠！`;

      const msig = hs.phase === "bet" ? ["bet", hs.id, horseSel, mine ? mine.idx : -1, per.join()].join("|") : ["track", hs.id, mine ? mine.idx : -1].join("|");
      if (msig !== hsig.main) {
        hsig.main = msig;
        if (hs.phase === "bet") {
          main.innerHTML = horseCards(hs, { sel: horseSel, mine, per });
          main.querySelectorAll(".hcard").forEach((r) => r.addEventListener("click", () => { if (busy || myBet() || hs.phase !== "bet") return; horseSel = Number(r.dataset.i); renderHorse(); draw(); }));
        } else {
          main.innerHTML = `<canvas class="rcv"></canvas>`; rcv = main.querySelector("canvas"); sizeRace(); initRace();
        }
      }

      const bsig = JSON.stringify([hs.phase, hs.bets.map((b) => [b.id, b.idx, b.bet, b.back]), you]);
      if (bsig !== hsig.bets) {
        hsig.bets = bsig;
        betsBox.innerHTML = `<h4>本場下注${hs.bets.length ? `（${hs.bets.length} 人，共 ${money(tot)}）` : ""}</h4>${hs.bets.length ? hs.bets.map((b) => {
          const res = hs.phase === "result" ? (b.back > 0 ? `<b class="w">+${money(b.back - b.bet)}</b>` : `<b class="l">-${money(b.bet)}</b>`) : "";
          return `<div class="hb ${b.id === you ? "me" : ""}"><span class="hn">${b.real ? "💰" : "🎮"} ${esc(b.name)}${b.id === you ? "（你）" : ""}</span><span class="hp">${b.idx + 1}號 ${esc(hs.names[b.idx])}　${money(b.bet)}</span>${res}</div>`;
        }).join("") : `<div class="mempty">還沒有人下注。時間到不管有沒有人下注都會開跑，你可以當第一個，或純看比賽。</div>`}`;
      }

      clearInterval(tickTimer);
      if (hs.phase === "bet") {
        const cd = head.querySelector(".cd");
        const tick = () => { const sec = Math.max(0, Math.ceil((hs.closeAt - serverNow()) / 1000)); cd.textContent = sec === 0 ? "開跑中…" : `${sec} 秒後截止`; };
        tick(); tickTimer = setInterval(tick, 500);
        statusEl.textContent = spectate ? "旁觀中：下注時間到就開跑" : mine ? "已下注，等開跑" : "選馬、選賭注，按下注";
      }
      if (hs.phase !== "bet") {
        if (roundKey !== hsig.round) { hsig.round = roundKey; cancelAnimationFrame(raf); animateRace(); }
        const m = myBet();
        statusEl.textContent = hs.phase === "run" ? "🏇 開跑！" : m ? (m.back > 0 ? `🎉 押中了！+${money(m.back - m.bet)}` : `😢 沒押中 -${money(m.bet)}`) : `🏆 ${hs.names[hs.win]} 奪冠`;
      } else hsig.round = "";
    }
    // ---- 賽道：canvas 畫的。每匹馬有固定的毛色與跑法（逃馬／先行／穩定／追込／爆發），腿部有完整的奔馳動作；
    // 名次仍由伺服器決定，跑法只是決定「在同一個終點時間前」怎麼跑（誰起跑快、誰後段追上）。
    const SILK = ["#e53935", "#1e88e5", "#fdd835", "#43a047", "#8e24aa", "#fb8c00"];
    const EMO = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    let rph = [];
    function sizeRace() {
      if (!rcv) return;
      rW = rcv.parentElement.clientWidth || 340; rH = 332;
      const d = window.devicePixelRatio || 1;
      rcv.style.width = rW + "px"; rcv.style.height = rH + "px"; rcv.width = Math.round(rW * d); rcv.height = Math.round(rH * d);
      rctx = rcv.getContext("2d"); rctx.setTransform(d, 0, 0, d, 0, 0);
    }
    function initRace() {      // 用場次 id 當種子，每個人看到同樣的起伏
      let h = 2166136261; for (const ch of hs.id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      const rng = () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      rseed = hs.names.map(() => ({ k: 2 + Math.floor(rng() * 2), phi: rng(), a: 0.16 + rng() * 0.16 }));
      rph = hs.names.map(() => rng() * 6.28);
      rparts = [];
    }
    // 跑法：把時間比例 u(0..1) 換成路程比例（都是遞增、起點 0、終點 1）
    const SHAPE = {
      "逃馬": (u) => 0.62 * (1 - Math.pow(1 - u, 1.7)) + 0.38 * u,
      "先行": (u) => 0.4 * (1 - Math.pow(1 - u, 1.4)) + 0.6 * u,
      "追込": (u) => 0.62 * Math.pow(u, 1.8) + 0.38 * u,
      "爆發": (u) => 0.5 * Math.pow(u, 2.6) + 0.5 * u,
    };
    const styleOf = (i) => (hs.info && hs.info[i] && hs.info[i].style) || "穩定";
    function prog(i, t) {
      const u0 = Math.max(0, Math.min(1, t / hs.times[i])), q = rseed[i];
      const u = (SHAPE[styleOf(i)] || ((x) => x))(u0);
      const f = u + q.a * (Math.sin(2 * Math.PI * (q.k * u + q.phi)) - Math.sin(2 * Math.PI * q.phi)) / (2 * Math.PI * q.k);
      const g = Math.max(0, Math.min(1, f));
      return g * g * 0.18 + g * 0.82;            // 起跑稍慢，之後加速
    }
    // 一匹馬（朝右）。S = 大小（約等於馬長），ph = 步伐相位，run = 是否在跑
    function drawHorse(c, cx, cy, S, ph, run, coat, mane, silk, num) {
      const k = (v) => v * S, OUT = "rgba(0,0,0,.5)";
      const limb = (x1, y1, x2, y2, w, col) => {
        c.lineCap = "round"; c.strokeStyle = OUT; c.lineWidth = k(w + 0.022); c.beginPath(); c.moveTo(k(x1), k(y1)); c.lineTo(k(x2), k(y2)); c.stroke();
        c.strokeStyle = col; c.lineWidth = k(w); c.beginPath(); c.moveTo(k(x1), k(y1)); c.lineTo(k(x2), k(y2)); c.stroke();
      };
      c.save(); c.translate(cx, cy);
      const bob = run ? -Math.abs(Math.sin(ph + 0.4)) * 0.05 * S : 0, pitch = run ? Math.sin(ph + 0.9) * 0.055 : 0;
      c.translate(0, bob); c.rotate(pitch);
      c.lineJoin = "round";
      const shade = (col, f) => { const n = parseInt(col.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const m = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${m(r)},${m(g)},${m(b)})`; };
      const far = shade(coat, 0.72);
      const leg = (hx, hy, off, col, hind) => {
        const a = ph + off * 6.283, sw = run ? Math.sin(a) : 0, lift = run ? Math.max(0, Math.sin(a + 1.2)) : 0;
        const th1 = sw * 0.8 + (hind ? -0.05 : 0.05);
        const th2 = hind ? th1 + 0.25 - lift * 1.05 : th1 - lift * 1.15 - 0.08;
        const kx = hx + Math.sin(th1) * 0.2, ky = hy + Math.cos(th1) * 0.2, fx = kx + Math.sin(th2) * 0.2, fy = ky + Math.cos(th2) * 0.2;
        limb(hx, hy, kx, ky, 0.07, col); limb(kx, ky, fx, fy, 0.045, col);
        c.fillStyle = "#222"; c.beginPath(); c.arc(k(fx), k(fy), k(0.03), 0, 7); c.fill();
        return [fx, fy];
      };
      // 尾巴
      const tw = run ? Math.sin(ph - 0.7) * 0.06 : 0.01;
      c.strokeStyle = mane; c.lineWidth = k(0.06); c.lineCap = "round"; c.beginPath(); c.moveTo(k(-0.3), k(-0.07)); c.quadraticCurveTo(k(-0.45), k(-0.12 + tw), k(-0.55), k(0.05 + tw * 2)); c.stroke();
      // 遠側的腿
      const feet = [leg(-0.21, 0.07, 0.12, far, true), leg(0.2, 0.08, 0.57, far, false)];
      // 身體
      c.fillStyle = coat; c.strokeStyle = OUT; c.lineWidth = k(0.022);
      c.beginPath(); c.ellipse(0, 0, k(0.31), k(0.14), 0, 0, 7); c.fill(); c.stroke();
      // 脖子與頭（跑的時候頭會上下點）
      const hb = run ? Math.sin(ph + 1.6) * 0.03 : 0;
      limb(0.2, -0.04, 0.35, -0.22 + hb * 0.5, 0.13, coat);
      c.save(); c.translate(k(0.44), k(-0.25 + hb)); c.rotate(0.72);
      c.fillStyle = coat; c.beginPath(); c.ellipse(0, 0, k(0.115), k(0.05), 0, 0, 7); c.fill(); c.stroke();
      c.restore();
      c.fillStyle = coat; c.beginPath(); c.moveTo(k(0.38), k(-0.3 + hb)); c.lineTo(k(0.405), k(-0.38 + hb)); c.lineTo(k(0.43), k(-0.3 + hb)); c.closePath(); c.fill(); c.stroke();   // 耳朵
      c.fillStyle = "#111"; c.beginPath(); c.arc(k(0.455), k(-0.285 + hb), k(0.011), 0, 7); c.fill();
      // 鬃毛
      const mw = run ? Math.sin(ph + 0.2) * 0.04 : 0;
      c.strokeStyle = mane; c.lineWidth = k(0.05); c.beginPath(); c.moveTo(k(0.31), k(-0.31 + hb)); c.quadraticCurveTo(k(0.2 - mw), k(-0.26), k(0.12 - mw * 1.5), k(-0.1)); c.stroke();
      // 近側的腿
      leg(-0.24, 0.07, 0.0, coat, true); leg(0.22, 0.08, 0.45, coat, false);
      // 馬衣（號碼布）與騎師
      c.fillStyle = silk; c.strokeStyle = OUT; c.lineWidth = k(0.015);
      c.beginPath(); c.rect(k(-0.1), k(-0.15), k(0.2), k(0.1)); c.fill(); c.stroke();
      c.fillStyle = "#fff"; c.font = `bold ${Math.max(8, k(0.085))}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(num), 0, k(-0.1));
      const jb = run ? Math.sin(ph + 0.5) * 0.012 : 0;
      limb(-0.02, -0.14, 0.12, -0.28 + jb, 0.075, silk);
      limb(0.11, -0.27 + jb, 0.29, -0.25 + hb, 0.025, "#eee");
      c.fillStyle = "#f3c9a0"; c.beginPath(); c.arc(k(0.17), k(-0.325 + jb), k(0.038), 0, 7); c.fill();
      c.fillStyle = silk; c.beginPath(); c.arc(k(0.17), k(-0.335 + jb), k(0.043), Math.PI, 0); c.fill();
      c.restore();
      return feet;
    }
    function drawRace(t, dt) {
      const c = rctx; if (!c || !rseed.length) return;
      const n = hs.names.length, top = 36, laneH = (rH - top - 8) / n, x0 = 96, x1 = rW - 74, len = x1 - x0, sq = laneH / 4;
      const tmax = Math.max(...hs.times), mine = myBet(), running = t >= 0 && t < tmax + 1600;
      c.clearRect(0, 0, rW, rH);
      c.fillStyle = "#17241a"; c.fillRect(0, 0, rW, top);
      for (let k = 0; k < rW / 11; k++) {          // 看台上的觀眾
        c.fillStyle = SILK[k % 6]; c.globalAlpha = 0.8;
        c.beginPath(); c.arc(6 + k * 11, top - 9 - (running ? Math.abs(Math.sin(t / 160 + k)) * 3 : 0), 3.5, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
      for (let i = 0; i < n; i++) {
        const y = top + i * laneH;
        c.fillStyle = i % 2 ? "#2f6b33" : "#37793b"; c.fillRect(0, y, rW, laneH);
        c.fillStyle = "rgba(255,255,255,.06)";
        for (let x = -((t > 0 ? t * 0.12 : 0) % 40); x < rW; x += 40) c.fillRect(x, y + 2, 20, laneH - 4);     // 草地條紋往後捲，有速度感
        c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(0, y, rW, 1);
      }
      c.fillRect(0, top + n * laneH, rW, 1);
      c.strokeStyle = "rgba(255,255,255,.25)"; c.setLineDash([4, 5]); c.lineWidth = 1;
      for (const f of [0.25, 0.5, 0.75]) { const x = x0 + f * len; c.beginPath(); c.moveTo(x, top); c.lineTo(x, top + n * laneH); c.stroke(); }
      c.setLineDash([]);
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.moveTo(x0 - 2, top); c.lineTo(x0 - 2, top + n * laneH); c.stroke();   // 起跑線
      for (let r = 0; r < n * 4; r++) for (let k = 0; k < 2; k++) { c.fillStyle = (r + k) % 2 ? "#111" : "#fff"; c.fillRect(x1 + k * sq, top + r * sq, sq, sq); }   // 終點方格旗
      const ps = hs.names.map((_, i) => prog(i, t));
      let lead = 0; ps.forEach((p, i) => { if (p > ps[lead]) lead = i; });
      if (hs.order && t >= Math.min(...hs.times)) lead = hs.order[0];        // 已經有馬衝線，領先的就是冠軍
      // 由上往下畫，下面的馬蓋在上面的馬前面
      for (let i = 0; i < n; i++) {
        const p = ps[i], yc = top + i * laneH + laneH / 2, info = hs.info && hs.info[i] || {};
        const after = Math.max(0, t - hs.times[i]), run = t >= 0 && after < 1500;                  // 衝線後再滑行一小段、慢慢停下來
        const slide = after > 0 ? (1 - Math.pow(1 - Math.min(1, after / 1500), 2)) * 46 : 0;
        const x = x0 + p * len + slide;
        // 步頻跟著當下的速度走
        const v = t >= 0 && p < 1 ? (prog(i, t + 60) - p) / 60 * hs.times[i] : after < 1500 ? Math.max(0, 1 - after / 1500) : 0;
        rph[i] += dt * 6.283 * (run ? 1.6 + 1.5 * Math.max(0.3, Math.min(2.2, v)) : 0);
        if (mine && mine.idx === i) { c.strokeStyle = "#e0a526"; c.lineWidth = 2; c.strokeRect(1, top + i * laneH + 1, rW - 2, laneH - 2); }
        const S = laneH * 1.02;
        if (run && Math.random() < 70 * dt) rparts.push({ x: x - S * 0.3, y: yc + S * 0.38, vx: -35 - Math.random() * 45, vy: -Math.random() * 20, life: 0.55, max: 0.55, r: 2 + Math.random() * 2.5, dust: 1 });
        drawHorse(c, x, yc - S * 0.04, S, rph[i], run, info.coat || "#a9754b", info.mane || "#2a1a10", SILK[i % 6], i + 1);
        // 左邊：名次獎牌／號碼 + 名字 + 跑法
        c.textAlign = "left"; c.textBaseline = "middle";
        const pl = hs.order && p >= 1 ? hs.order.indexOf(i) : -1;
        if (pl >= 0 && pl < 3) { c.font = "15px " + EMO; c.fillStyle = "#fff"; c.fillText(["🥇", "🥈", "🥉"][pl], 3, yc); }
        else { c.font = "bold 12px sans-serif"; c.fillStyle = SILK[i % 6]; c.fillText(pl >= 0 ? `${pl + 1}.` : String(i + 1), 6, yc); }
        c.font = "12px sans-serif"; c.fillStyle = "rgba(255,255,255,.9)"; c.fillText(`${hs.names[i]}${mine && mine.idx === i ? " ★" : ""}`, 24, yc - 6);
        c.font = "10px sans-serif"; c.fillStyle = "rgba(255,255,255,.55)"; c.fillText(info.style || "", 24, yc + 8);
        if (i === lead && t > 0 && t < tmax && p > 0.04) { c.font = "15px " + EMO; c.textAlign = "center"; c.fillText("👑", x + S * 0.1, yc - S * 0.62); }
      }
      if (t < 0) { c.fillStyle = "rgba(0,0,0,.45)"; c.fillRect(0, top, rW, n * laneH); c.fillStyle = "#fff"; c.font = "bold 28px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("預備…", rW / 2, top + n * laneH / 2); }
      else if (t < tmax) {                                                         // 轉播字幕
        const left = Math.round((1 - ps[lead]) * 100);
        c.fillStyle = "#fff"; c.font = "bold 13px sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
        c.fillText(`🎙 領先：${lead + 1}號 ${hs.names[lead]}　${left > 85 ? "起跑！" : left > 15 ? `距終點 ${left}%` : "衝刺！"}`, 8, 12);
      }
      const tw = Math.min(...hs.times);                                           // 冠軍衝線：噴彩帶
      if (t >= tw && rconf !== hs.id && t - tw < 2500) {
        rconf = hs.id; const wi = hs.order ? hs.order[0] : lead, yc = top + wi * laneH + laneH / 2;
        for (let k = 0; k < 70; k++) rparts.push({ x: x1, y: yc, vx: -120 + Math.random() * 240, vy: -140 - Math.random() * 160, life: 1.6, max: 1.6, r: 3, col: SILK[k % 6] });
      }
      for (const q of rparts) {
        q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; if (!q.dust) q.vy += 380 * dt;
        c.globalAlpha = Math.max(0, q.life / q.max) * (q.dust ? 0.5 : 1); c.fillStyle = q.dust ? "#d7c9a3" : q.col;
        c.beginPath(); if (q.dust) c.arc(q.x, q.y, q.r, 0, 7); else c.rect(q.x, q.y, 5, 3); c.fill();
      }
      c.globalAlpha = 1; rparts = rparts.filter((q) => q.life > 0);
      if (hs.phase === "result" || t >= tmax) {                                    // 結束後在賽道上顯示冠軍
        c.fillStyle = "rgba(0,0,0,.5)"; c.fillRect(0, 0, rW, 24); c.fillStyle = "#ffd54a"; c.font = "bold 14px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(`🏆 ${hs.names[hs.win]} 奪冠`, rW / 2, 12);
      }
    }
    function animateRace() {
      let last = performance.now();
      const frame = (ts) => {
        if (closed || !hs || hs.phase === "bet" || !rcv) return;
        const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
        const t = serverNow() - hs.startAt;
        drawRace(t, dt);
        if (t < Math.max(...hs.times) + 400 || rparts.length) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    const onResize = () => { sizeRace(); if (hs && hs.phase !== "bet" && rseed.length) drawRace(serverNow() - hs.startAt, 0); };
    window.addEventListener("resize", onResize);

    // ---- 旁觀：選一位玩家，同步看他的牌桌（賽馬直接看整場）
    function specUpdate(m) {
      if (game === "horse") { $(".watch").textContent = m.watchers ? `👀 ${m.watchers} 人旁觀` : ""; return; }
      specList = m.list;
      if (!specList.find((p) => p.id === specSel)) specSel = specList.length ? specList[0].id : null;
      const sig = JSON.stringify([specSel, specList.map((p) => [p.id, p.name, p.real, p.last, p.hand])]);
      if (sig === specSig) return;
      const prev = specSig; specSig = sig;
      const cur = specList.find((p) => p.id === specSel);
      stage.innerHTML = `<div class="specchips">${specList.map((p) => `<button class="chip ${p.id === specSel ? "sel" : ""}" data-id="${p.id}">${p.real ? "💰" : "🎮"} ${esc(p.name)}</button>`).join("") || "<span class='mempty'>房間裡的人都離開了</span>"}</div>` +
        (cur ? `<div class="spectable${prev ? " fresh" : ""}">${entryHtml(cur)}</div>` : "");
      stage.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { specSel = c.dataset.id; specSig = ""; specUpdate({ list: specList, watchers: 0 }); }));
      $(".watch").textContent = m.watchers ? `👀 ${m.watchers} 人旁觀` : "";
    }

    connect();
    draw();
    return () => { closed = true; window.removeEventListener("resize", onResize); cancelAnimationFrame(raf); clearInterval(tickTimer); timers.forEach(clearTimeout); watch.destroy(); blog.destroy(); try { ws.close(); } catch {} };
  };
}
