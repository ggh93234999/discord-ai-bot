// 賭場小遊戲（擲硬幣、骰子、21 點、賽馬）。結果全部由伺服器決定，前端只負責演出。
// 練習模式：每條連線一份練習幣；賭注模式：用 bauth 綁定的 Discord 身分，動用機器人錢包的真代幣。
import { randomInt, randomBytes } from "node:crypto";
import { botSettle, botPay } from "./bet.js";

export const CASINO_BETS = [10, 50, 100, 500];
const PRACTICE_START = 1000;
const rnd = (n) => randomInt(n);                 // 0..n-1，真亂數
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---- 錢包：real=true 走機器人，否則練習幣
async function stake(ws, real, bet, why) {
  if (real) {
    const u = ws.user; if (!u) return { ok: false, error: "need_login" };
    try { return await botSettle(u.uid, u.name, bet, 0, why); } catch { return { ok: false, error: "bot_down" }; }
  }
  const bal = ws.cprac ?? PRACTICE_START;
  if (bal < bet) return { ok: false, error: "insufficient", balance: bal };
  ws.cprac = bal - bet;
  return { ok: true, balance: ws.cprac };
}
async function pay(ws, real, amount, why) {
  if (amount <= 0) return { ok: true, balance: real ? undefined : ws.cprac };
  if (real) {
    const u = ws.user;
    try { return await botPay(u.uid, u.name, amount, why); } catch (e) { console.log("派彩失敗", u.uid, amount, why); return { ok: false, error: "bot_down" }; }
  }
  ws.cprac = (ws.cprac ?? PRACTICE_START) + amount;
  return { ok: true, balance: ws.cprac };
}
// 一步完成的小遊戲：押注和派彩一次結算
async function settleOnce(ws, real, bet, back, why) {
  if (real) {
    const u = ws.user; if (!u) return { ok: false, error: "need_login" };
    try { return await botSettle(u.uid, u.name, bet, back, why); } catch { return { ok: false, error: "bot_down" }; }
  }
  const bal = ws.cprac ?? PRACTICE_START;
  if (bal < bet) return { ok: false, error: "insufficient", balance: bal };
  ws.cprac = bal - bet + back;
  return { ok: true, balance: ws.cprac };
}

// ---- 21 點
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠️", "♥️", "♦️", "♣️"];
function handValue(h) {
  let t = 0, a = 0;
  for (const [r] of h) { if (r === "A") { t += 11; a++; } else if ("JQK".includes(r)) t += 10; else t += Number(r); }
  while (t > 21 && a) { t -= 10; a--; }
  return t;
}
const cardTxt = (c) => c[1] + c[0];

// ---- 賽馬
const HORSE_POOL = ["赤兔", "烏騅", "的盧", "絕影", "爪黃飛電", "踏雪", "照夜玉獅子", "追風", "青驄", "黃驃", "驊騮", "飛黃"];
const FORMS = [["🔥 絕佳", 7], ["😀 良好", 3], ["😐 普通", 0], ["😓 欠佳", -4], ["🤕 低迷", -8]];
const FORM_W = [10, 30, 35, 18, 7];
function pickWeighted(w) { let r = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1; }
function newRaceCard() {
  const names = shuffle([...HORSE_POOL]).slice(0, 6);
  const forms = names.map(() => FORMS[pickWeighted(FORM_W)]);
  const str = names.map((_, i) => 0.4 * (55 + rnd(41)) + 0.3 * (55 + rnd(41)) + 0.3 * (55 + rnd(41)) + forms[i][1]);
  const m = Math.max(...str), ex = str.map((x) => Math.exp((x - m) / 14)), tot = ex.reduce((a, b) => a + b, 0);
  const probs = ex.map((x) => x / tot);
  return { id: randomBytes(6).toString("hex"), names, forms: forms.map((f) => f[0]), probs, odds: probs.map((p) => Math.max(1.1, Math.round(0.95 / p * 10) / 10)) };
}
function raceOrder(probs) {     // 依機率一名一名抽出名次
  const left = probs.map((p, i) => [i, p]), order = [];
  while (left.length) { const k = pickWeighted(left.map((x) => x[1])); order.push(left[k][0]); left.splice(k, 1); }
  return order;
}

const ERRMSG = { need_login: "need_login", insufficient: "insufficient", bot_down: "bot_down" };
const fail = (ws, r, extra = {}) => ws.send(JSON.stringify({ t: "cerr", error: ERRMSG[r.error] || r.error || "error", balance: r.balance, ...extra }));
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

async function finishBj(ws, bj, why) {
  const pv = handValue(bj.player);
  while (handValue(bj.dealer) < 17 && pv <= 21) bj.dealer.push(bj.deck.pop());
  const dv = handValue(bj.dealer);
  let back = 0, text;
  if (bj.natural) { back = Math.floor(bj.bet * 2.5); text = "🌟 Blackjack！"; }
  else if (pv > 21) text = "💥 爆牌，輸了";
  else if (dv > 21 || pv > dv) { back = bj.bet * 2; text = "🎉 你贏了！"; }
  else if (pv === dv) { back = bj.bet; text = "🤝 平手，賭注退回"; }
  else text = "😢 莊家贏";
  ws.bj = null;
  const r = await pay(ws, bj.real, back, why);
  out(ws, { t: "cres", g: "bj", done: true, real: bj.real, bet: bj.bet, back, text,
            player: bj.player.map(cardTxt), pv, dealer: bj.dealer.map(cardTxt), dv, balance: r.balance, payfail: !r.ok });
}

export function casinoClose(ws) {
  if (ws.bj) finishBj(ws, ws.bj, "21點(斷線自動停牌)").catch(() => {});
}

export async function handleCasino(ws, m) {
  if (m.t === "cjoin") { ws.cprac = ws.cprac ?? PRACTICE_START; out(ws, { t: "cinit", balance: ws.cprac }); return true; }
  if (m.t === "creset") { if (!ws.bj) ws.cprac = PRACTICE_START; out(ws, { t: "cinit", balance: ws.cprac }); return true; }
  if (!["cplay", "cbj", "chorse"].includes(m.t)) return false;
  if (ws.cbusy) return true;
  ws.cbusy = true;
  try {
    const real = !!m.real, bet = Number(m.bet);
    const betOk = CASINO_BETS.includes(bet);
    if (m.t === "cplay") {
      if (!betOk) return true;
      if (m.g === "coin") {
        const pick = m.pick === "tails" ? "tails" : "heads", res = rnd(2) ? "heads" : "tails";
        const back = res === pick ? bet * 2 : 0;
        const r = await settleOnce(ws, real, bet, back, "擲硬幣");
        if (!r.ok) fail(ws, r); else out(ws, { t: "cres", g: "coin", real, bet, pick, res, back, balance: r.balance });
      } else if (m.g === "dice") {
        const me = [1 + rnd(6), 1 + rnd(6)], bot = [1 + rnd(6), 1 + rnd(6)];
        const a = me[0] + me[1], b = bot[0] + bot[1];
        const back = a > b ? bet * 2 : a === b ? bet : 0;
        const r = await settleOnce(ws, real, bet, back, "骰子");
        if (!r.ok) fail(ws, r); else out(ws, { t: "cres", g: "dice", real, bet, me, bot, back, balance: r.balance });
      }
    } else if (m.t === "cbj") {
      if (m.a === "deal") {
        if (ws.bj || !betOk) return true;
        const r = await stake(ws, real, bet, "21點");
        if (!r.ok) { fail(ws, r); return true; }
        const deck = []; for (const rk of RANKS) for (const s of SUITS) deck.push([rk, s]);
        shuffle(deck);
        const bj = { real, bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], natural: false };
        ws.bj = bj;
        if (handValue(bj.player) === 21) { bj.natural = true; await finishBj(ws, bj, "21點"); }
        else out(ws, { t: "cres", g: "bj", done: false, real, bet, player: bj.player.map(cardTxt), pv: handValue(bj.player), dealerUp: cardTxt(bj.dealer[0]), balance: r.balance });
      } else if (ws.bj && m.a === "hit") {
        const bj = ws.bj; bj.player.push(bj.deck.pop());
        const v = handValue(bj.player);
        if (v >= 21) await finishBj(ws, bj, "21點");
        else out(ws, { t: "cres", g: "bj", done: false, real: bj.real, bet: bj.bet, player: bj.player.map(cardTxt), pv: v, dealerUp: cardTxt(bj.dealer[0]) });
      } else if (ws.bj && m.a === "stand") await finishBj(ws, ws.bj, "21點");
    } else if (m.t === "chorse") {
      if (m.a === "card") {
        ws.race = newRaceCard();
        out(ws, { t: "cres", g: "horse", card: true, id: ws.race.id, names: ws.race.names, forms: ws.race.forms, odds: ws.race.odds });
      } else if (m.a === "bet") {
        const rc = ws.race, idx = Number(m.idx);
        if (!rc || m.id !== rc.id || !betOk || !Number.isInteger(idx) || idx < 0 || idx > 5) return true;
        ws.race = null;                                              // 一張馬票只能下一次
        const r = await stake(ws, real, bet, "賽馬");
        if (!r.ok) { ws.race = rc; fail(ws, r); return true; }
        const order = raceOrder(rc.probs), win = order[0];
        const back = idx === win ? Math.floor(bet * rc.odds[idx]) : 0;
        const times = Array(6).fill(0);                              // 各馬抵達終點的毫秒數（贏家最快）
        let t = 7000; order.forEach((h) => { times[h] = t; t += 250 + rnd(500); });
        const p = await pay(ws, real, back, "賽馬");
        out(ws, { t: "cres", g: "horse", done: true, real, bet, idx, win, order, times, odds: rc.odds, back, balance: p.balance ?? r.balance, payfail: !p.ok });
      }
    }
  } catch (e) { console.log("casino 錯誤", e && e.message); }
  finally { ws.cbusy = false; }
  return true;
}
