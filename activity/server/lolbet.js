// 英雄聯盟世界賽運彩：賠率同步 OddsPapi（Pinnacle 盤口），用 bot 的虛擬幣下注單場勝負。
// 賠率每幾分鐘更新一次，開賽前鎖盤；賽果出來後自動派彩（賠率以下注當下為準）。
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ENV, botSettle, botPay, betLimit } from "./bet.js";

const KEY = ENV.ODDSPAPI_KEY || "";
const BASE = "https://api.oddspapi.io/v4";
const TOURNAMENT = Number(ENV.LOLBET_TOURNAMENT) || 2549;           // 2549 = World Championship
const BOOK = ENV.LOLBET_BOOKMAKER || "pinnacle";
// ---- OddsPapi 免費方案總共只有 250 次呼叫：BUDGET 是「從現在起」這個模組最多能用幾次（已用掉的已先扣）。
// 其中 RESERVE 次專門留給「結算賽果」，賠率／賽程更新只能動用剩下的，並平均分配到整個世界賽結束（END）。
const BUDGET = Number(ENV.LOLBET_BUDGET) || 195;
const RESERVE = Number(ENV.LOLBET_RESERVE) || 45;
const END = Date.parse(ENV.LOLBET_END || "2026-11-16T00:00:00+08:00");
const LOCK_MS = 60 * 1000;                                           // 開賽前 1 分鐘鎖盤
const VOID_AFTER = 3 * 24 * 3600 * 1000;                             // 開賽後 3 天還沒結果就退款
const MAX_PER_FIXTURE = 5;                                           // 每人每場最多下注總額 = 單注上限 × 5
const SFILE = fileURLToPath(new URL("./lolbet_state.json", import.meta.url));

export const lolEnabled = () => !!KEY;

async function fetchJson(path, params, prio) {
  if (!st.api) st.api = { used: 0 };
  if (st.api.used >= BUDGET || (!prio && st.api.used >= BUDGET - RESERVE)) throw new Error("quota");
  st.api.used++; save();                                      // 先記帳再呼叫（失敗也算一次，寧可高估）
  const q = new URLSearchParams({ ...params, apiKey: KEY });
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(`${BASE}/${path}?${q}`, { signal: ac.signal });
    if (!r.ok) throw new Error(`OddsPapi ${path} http ${r.status}`);
    return await r.json();
  } finally { clearTimeout(to); }
}
export const _deps = { settle: botSettle, pay: botPay, fetchJson };

let st = { bets: [], seq: 0 };
try { st = { bets: [], seq: 0, ...JSON.parse(fs.readFileSync(SFILE, "utf8")) }; } catch {}
const save = () => { try { fs.writeFileSync(SFILE, JSON.stringify(st)); } catch (e) { console.log("世界賽運彩存檔失敗", e.message); } };

let fixtures = new Map();     // fixtureId -> { id, home, away, start, statusId, statusName, hasOdds, oh, oa, suspended, score }
let updatedAt = 0, lastErr = "";
const watchers = new Set();
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// 從 Pinnacle 的盤口裡找「全場單場勝負」（路徑結尾 /0/moneyline，id 通常是 181）
function pickMoneyline(markets) {
  if (!markets) return null;
  let best = null;
  for (const [mid, m] of Object.entries(markets)) {
    const bm = String(m.bookmakerMarketId || "");
    if (!/\/0\/moneyline$/.test(bm) || m.marketActive === false) continue;
    const out = Object.values(m.outcomes || {}).map((o) => o.players && o.players["0"]).filter(Boolean);
    const h = out.find((o) => o.bookmakerOutcomeId === "home"), a = out.find((o) => o.bookmakerOutcomeId === "away");
    if (h && a && h.price > 1 && a.price > 1 && h.active !== false && a.active !== false) { if (!best || mid === "181") best = { oh: h.price, oa: a.price }; }
  }
  return best;
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function plan() {
  const now = Date.now(), used = (st.api && st.api.used) || 0;
  const left = Math.max(0, BUDGET - RESERVE - used);
  const daysLeft = Math.max(1, Math.ceil((END - now) / 864e5)), effDays = Math.max(1, Math.ceil(daysLeft * 0.7));   // 休賽日不用花
  const perDay = left / effDays;
  return { left, perDay, oddsMs: clamp(864e5 / Math.max(0.1, perDay * 0.4), 90 * 60e3, 8 * 3600e3), checkMs: clamp(864e5 / Math.max(0.1, perDay * 0.45), 75 * 60e3, 6 * 3600e3), dead: left <= 0 };
}
const POLL_MS_NOW = () => plan().oddsMs;
// ---- 省 API 用量：OddsPapi 有額度限制，所以只在「有人開著頁面」時才抓賠率（預設每 10 分鐘一次），
// 賽程名單每 3 小時或遇到沒看過的場次才抓，賽果只在有人下注、開賽一段時間後才去查（每場每 20 分鐘最多一次）。
let polling = false, fixturesAt = 0;
const FIX_TTL = 24 * 3600 * 1000, FIRST_CHECK = 35 * 60 * 1000;
let lastCheck = 0;

async function loadFixtures(now, prio) {
  const fx = await _deps.fetchJson("fixtures", { sportId: 18, from: day(now - 86400000), to: day(now + 8 * 86400000) }, prio);
  const next = new Map();
  for (const f of Array.isArray(fx) ? fx : []) {
    if (f.tournamentId !== TOURNAMENT) continue;
    const old = fixtures.get(f.fixtureId);
    next.set(f.fixtureId, { id: f.fixtureId, home: f.participant1Name, away: f.participant2Name, start: Date.parse(f.startTime), statusId: f.statusId, statusName: f.statusName || "", hasOdds: !!f.hasOdds, oh: old?.oh, oa: old?.oa, suspended: old?.suspended, score: old?.score, chk: old?.chk });
  }
  for (const [id, f] of fixtures) if (!next.has(id) && st.bets.some((b) => b.fixtureId === id && (b.status === "open" || b.status === "unpaid"))) next.set(id, f);   // 還有人下注的場次要留著好結算
  fixtures = next; fixturesAt = now;
}

export async function lolPoll() {
  if (!lolEnabled() || polling) return;
  polling = true;
  try {
    const now = Date.now();
    if (!fixtures.size || now - fixturesAt > FIX_TTL) await loadFixtures(now);
    const soon = [...fixtures.values()].some((f) => !isFinished(f) && !isVoid(f) && f.start > now - 6 * 3600e3 && f.start - now < 30 * 3600e3);
    if (!soon) { updatedAt = now; lastErr = ""; pushAll(); return; }      // 30 小時內沒有比賽就不抓賠率
    const od = await _deps.fetchJson("odds-by-tournaments", { bookmaker: BOOK, tournamentIds: String(TOURNAMENT), oddsFormat: "decimal" });
    const list = Array.isArray(od) ? od : [];
    if (list.some((o) => !fixtures.has(o.fixtureId)) && now - fixturesAt > 6 * 3600e3) await loadFixtures(now);   // 出現新場次：補抓一次名單
    const seen = new Set();
    for (const o of list) {
      const f = fixtures.get(o.fixtureId); if (!f) continue;
      if (o.statusId !== undefined) f.statusId = o.statusId;
      if (typeof o.hasOdds === "boolean") f.hasOdds = o.hasOdds;
      const bo = o.bookmakerOdds && o.bookmakerOdds[BOOK]; if (!bo) continue;
      const ml = pickMoneyline(bo.markets);
      f.suspended = !!bo.suspended || !ml;
      if (ml) { f.oh = ml.oh; f.oa = ml.oa; }
      seen.add(o.fixtureId);
    }
    for (const f of fixtures.values()) if (!seen.has(f.id)) f.suspended = true;
    updatedAt = now; lastErr = "";
    pushAll();
  } catch (e) { lastErr = String(e && e.message || e).replace(KEY, "***").slice(0, 120); console.log("世界賽運彩同步失敗：", lastErr); }
  finally { polling = false; }
}

const isFinished = (f) => /finish|ended|complete/i.test(f.statusName || "") || f.statusId === 2;
const isVoid = (f) => /cancel|abandon|walkover|interrupt/i.test(f.statusName || "");

async function getScore(f) {
  if (f.score) return f.score;
  const j = await _deps.fetchJson("scores", { fixtureId: f.id }, true);
  const p = j && j.scores && j.scores.periods && (j.scores.periods.result || j.scores.periods.fulltime);
  if (p && Number.isFinite(p.participant1Score) && Number.isFinite(p.participant2Score)) f.score = [p.participant1Score, p.participant2Score];
  return f.score || null;
}

// 結算：贏的派彩、輸的標記、比賽取消或太久沒結果的退款。派彩失敗的留著，下一輪再試。
let settling = false;
export const lolSettle = () => settleAll();
async function settleAll() {
  if (settling) return; settling = true;
  try {
    const now = Date.now();
    const due = st.bets.some((b) => { const f = fixtures.get(b.fixtureId); return b.status === "open" && f && !isFinished(f) && !isVoid(f) && now - f.start > FIRST_CHECK; });
    if (due && now - lastCheck > plan().checkMs) { lastCheck = now; try { await loadFixtures(now, true); } catch (e) { console.log("世界賽運彩 賽果檢查失敗：", e && e.message); } }   // 一次呼叫就能更新所有場次的狀態
    for (const b of st.bets) {
      if (b.status !== "open" && b.status !== "unpaid") continue;
      let f = fixtures.get(b.fixtureId);
      if (!f && b.status === "open") {                            // 重啟後賽程視窗已不含這場：單獨查一次
        try { const x = await _deps.fetchJson("fixture", { fixtureId: b.fixtureId }, true); if (x && x.fixtureId) { f = { id: x.fixtureId, home: x.participant1Name, away: x.participant2Name, start: Date.parse(x.startTime), statusId: x.statusId, statusName: x.statusName || "", hasOdds: false }; fixtures.set(f.id, f); } } catch {}
      }
      let outcome = null;                                         // "win" | "lose" | "void"
      if (b.status === "unpaid") outcome = b.pending;
      else if (f && isVoid(f)) outcome = "void";
      else if (f && isFinished(f)) {
        const sc = await getScore(f).catch(() => null);
        if (sc && sc[0] !== sc[1]) outcome = (sc[0] > sc[1]) === (b.side === "home") ? "win" : "lose";
        else if (sc && sc[0] === sc[1]) outcome = "void";
      } else if (now - (f ? f.start : b.at) > VOID_AFTER) outcome = "void";
      if (!outcome) continue;
      if (outcome === "lose") { b.status = "lost"; b.payout = 0; b.doneAt = now; continue; }
      const amt = outcome === "win" ? Math.floor(b.amount * b.odds) : b.amount;
      let ok = false;
      try { const r = await _deps.pay(b.uid, b.name, amt, outcome === "win" ? `世界賽運彩 ${b.label} 贏` : `世界賽運彩 ${b.label} 退款`); ok = !!(r && r.ok); } catch {}
      if (ok) { b.status = outcome === "win" ? "won" : "void"; b.payout = amt; b.doneAt = now; delete b.pending; }
      else { b.status = "unpaid"; b.pending = outcome; b.payout = amt; console.log("世界賽運彩派彩失敗，稍後重試", b.uid, amt); }
    }
    save();
  } finally { settling = false; }
}

function fview(f, uid) {
  const now = Date.now();
  const hasLine = f.oh > 1 && f.oa > 1;
  let state = "closed";
  if (isFinished(f)) state = "finished"; else if (isVoid(f)) state = "void";
  else if (f.statusId !== 0 && f.statusId !== null) state = "live";
  else if (f.start - LOCK_MS <= now) state = "live";
  else if (hasLine && !f.suspended && f.hasOdds) state = "open";
  const mine = uid ? st.bets.filter((b) => b.uid === uid && b.fixtureId === f.id).map((b) => ({ id: b.id, side: b.side, amount: b.amount, odds: b.odds, status: b.status, payout: b.payout || 0 })) : [];
  return { id: f.id, home: f.home, away: f.away, start: f.start, state, oh: hasLine ? f.oh : null, oa: hasLine ? f.oa : null, score: f.score || null, mine };
}
function viewFor(ws) {
  const uid = ws.user && ws.user.uid;
  const list = [...fixtures.values()].sort((a, b) => a.start - b.start).map((f) => fview(f, uid));
  return { t: "lolstate", ok: lolEnabled(), now: Date.now(), updatedAt, err: lastErr ? 1 : 0, dead: plan().dead ? 1 : 0, every: Math.round(plan().oddsMs / 60000), limit: betLimit(), maxFixture: betLimit() * MAX_PER_FIXTURE, list, you: uid ? ws.user.name : null };
}
function pushAll() { for (const ws of watchers) send(ws, viewFor(ws)); }

export function lolClose(ws) { watchers.delete(ws); }

export async function handleLol(ws, m) {
  if (m.t === "lolget") { watchers.add(ws); send(ws, viewFor(ws)); if (Date.now() - updatedAt > POLL_MS_NOW()) lolPoll(); return true; }
  if (m.t === "lolhist") {
    const uid = ws.user && ws.user.uid;
    const list = uid ? st.bets.filter((b) => b.uid === uid).slice(-30).reverse().map((b) => ({ label: b.label, side: b.side, amount: b.amount, odds: b.odds, status: b.status, payout: b.payout || 0, at: b.at })) : [];
    send(ws, { t: "lolhist", list }); return true;
  }
  if (m.t !== "lolbet") return false;
  const err = (error, extra) => { send(ws, { t: "lolres", ok: false, error, ...extra }); return true; };
  const u = ws.user; if (!u) return err("need_login");
  if (ws.lolbusy) return true;
  ws.lolbusy = true;
  try {
    const f = fixtures.get(String(m.fixtureId)); const amount = Number(m.amount), side = m.side === "away" ? "away" : m.side === "home" ? "home" : "";
    if (!f || !side) return err("bad_request");
    if (fview(f, u.uid).state !== "open") return err("closed");
    if (plan().dead) return err("quota");
    if (Date.now() - updatedAt > POLL_MS_NOW() * 1.6 + 600e3) { lolPoll(); return err("stale"); }       // 賠率太舊，先更新再下注
    if (!Number.isInteger(amount) || amount < 1 || amount > betLimit()) return err("bad_amount", { limit: betLimit() });
    const cur = side === "home" ? f.oh : f.oa;
    if (Math.abs(Number(m.odds) - cur) > 0.0005) return err("odds_changed", { odds: cur });
    const have = st.bets.filter((b) => b.uid === u.uid && b.fixtureId === f.id && b.status !== "void").reduce((s, b) => s + b.amount, 0);
    if (have + amount > betLimit() * MAX_PER_FIXTURE) return err("too_much", { limit: betLimit() * MAX_PER_FIXTURE, have });
    const label = `${f.home} vs ${f.away}`;
    let r; try { r = await _deps.settle(u.uid, u.name, amount, 0, `世界賽運彩 ${label}`); } catch { return err("bot_down"); }
    if (!r || !r.ok) return err((r && r.error) || "insufficient", { balance: r && r.balance });
    if (f.start - LOCK_MS <= Date.now()) { try { await _deps.pay(u.uid, u.name, amount, "世界賽運彩 鎖盤退款"); } catch {} return err("closed"); }   // 扣款期間剛好鎖盤：退款
    const bet = { id: ++st.seq, uid: u.uid, name: u.name, fixtureId: f.id, label, side, amount, odds: cur, at: Date.now(), status: "open" };
    st.bets.push(bet); save();
    send(ws, { t: "lolres", ok: true, balance: r.balance, bet: { id: bet.id, side, amount, odds: cur } });
    send(ws, viewFor(ws));
  } finally { ws.lolbusy = false; }
  return true;
}

// 每分鐘看一次：有人在看且賠率過期就更新；有待結算的注單就檢查賽果（實際會不會打 API 由上面的間隔決定）
if (lolEnabled()) setInterval(() => {
  if (watchers.size && Date.now() - updatedAt > POLL_MS_NOW()) lolPoll();
  if (st.bets.some((b) => b.status === "open" || b.status === "unpaid")) { if (!fixtures.size && !polling) lolPoll().then(settleAll); else settleAll().then(() => { if (watchers.size) pushAll(); }); }
}, 60000).unref();
