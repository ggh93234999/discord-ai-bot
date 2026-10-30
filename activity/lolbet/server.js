// 英雄聯盟世界賽運彩：賠率同步 OddsPapi（Pinnacle 盤口），用 bot 的虛擬幣下注單場勝負。
// 賠率每幾分鐘更新一次，開賽前鎖盤；賽果出來後自動派彩（賠率以下注當下為準）。
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ENV as ROOT_ENV, botSettle, botPay, betLimit } from "../server/bet.js";

// 這個功能自己的設定（含 OddsPapi 金鑰）放在 lolbet/lolbet.env，不混進專案的 .env；
// 移除功能時整個資料夾刪掉即可。同名變數以 lolbet.env 為準。
const LENV = (() => {
  const o = {};
  try {
    for (const line of fs.readFileSync(fileURLToPath(new URL("./lolbet.env", import.meta.url)), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) o[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {}
  return o;
})();
const ENV = { ...ROOT_ENV, ...LENV };

const KEYS = [ENV.ODDSPAPI_KEY, ENV.ODDSPAPI_KEY2].filter(Boolean);            // 第二組是備用：第一組讀不到（額度用完／被拒絕）就自動換第二組
const KEY = KEYS[0] || "";
const hide = (m) => KEYS.reduce((a, k) => a.split(k).join("***"), String(m));
const BASE = "https://api.oddspapi.io/v4";
const TOURNAMENT = Number(ENV.LOLBET_TOURNAMENT) || 2549;           // 2549 = World Championship
const BOOK = ENV.LOLBET_BOOKMAKER || "pinnacle";
// ---- OddsPapi 免費方案總共只有 250 次呼叫：BUDGET 是「從現在起」這個模組最多能用幾次（已用掉的已先扣）。
// 其中 RESERVE 次專門留給「結算賽果」，賠率／賽程更新只能動用剩下的，並平均分配到整個世界賽結束（END）。
const BUDGET = Number(ENV.LOLBET_BUDGET) || 195;
const RESERVE = Number(ENV.LOLBET_RESERVE) || 20;
const END = Date.parse(ENV.LOLBET_END || "2026-11-16T00:00:00+08:00");
const LOCK_MS = 60 * 1000;                                           // 開賽前 1 分鐘鎖盤
const VOID_AFTER = 3 * 24 * 3600 * 1000;                             // 開賽後 3 天還沒結果就退款
const MAX_PER_FIXTURE = 5;                                           // 每人每場最多下注總額 = 單注上限 × 5
const SFILE = fileURLToPath(new URL("./state.json", import.meta.url));

export const lolEnabled = () => KEYS.length > 0;

async function fetchJson(path, params, prio) {
  if (!st.api) st.api = { used: 0 };
  if (st.api.used >= BUDGET || (!prio && st.api.used >= BUDGET - RESERVE)) throw new Error("quota");
  st.api.used++; save();                                      // 先記帳再呼叫（失敗也算一次，寧可高估）
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000);
  try {
    let ki = Math.min(Number(st.api.key) || 0, KEYS.length - 1);
    for (let tries = 0; ; tries++) {
      const q = new URLSearchParams({ ...params, apiKey: KEYS[ki] });
      const r = await fetch(`${BASE}/${path}?${q}`, { signal: ac.signal });
      if (r.ok) return await r.json();
      const body = r.status === 200 ? "" : await r.text().catch(() => "");
      const bad = [401, 402, 403].includes(r.status) || ([429, 500].includes(r.status) && /quota|limit|exceed|authentic|api ?key|plan/i.test(body) && !/per second|too fast/i.test(body));
      if (bad && tries < KEYS.length - 1) {                                            // 這組金鑰讀不到（額度用完／驗證失敗）：換下一組再試
        ki = (ki + 1) % KEYS.length; st.api.key = ki; save();
        console.log(`世界賽運彩：金鑰被拒絕（http ${r.status}），改用第 ${ki + 1} 組`); continue;
      }
      throw new Error(`OddsPapi ${path} http ${r.status}`);
    }
  } finally { clearTimeout(to); }
}
export const _deps = { settle: botSettle, pay: botPay, fetchJson };

let st = { bets: [], seq: 0, results: {} };
try { st = { bets: [], seq: 0, results: {}, ...JSON.parse(fs.readFileSync(SFILE, "utf8")) }; } catch {}
const save = () => { try { fs.writeFileSync(SFILE, JSON.stringify(st)); } catch (e) { console.log("世界賽運彩存檔失敗", e.message); } };

let fixtures = new Map();     // fixtureId -> { id, home, away, start, statusId, statusName, hasOdds, oh, oa, suspended, score }
let updatedAt = 0, lastErr = "";
const watchers = new Set();
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// 從 Pinnacle 的盤口裡找「全場單場勝負」＝ market 181：outcome 181 是第 1 隊（participant1）贏、182 是第 2 隊贏。
// 注意不能用 bookmakerOutcomeId 的 home/away：那是 Pinnacle 自己的主客順序，有些場次跟隊伍順序是反的。
function pickMoneyline(markets) {
  const m = markets && markets["181"];
  if (!m || m.marketActive === false || !/\/0\/moneyline$/.test(String(m.bookmakerMarketId || ""))) return null;
  const a = m.outcomes && m.outcomes["181"] && m.outcomes["181"].players && m.outcomes["181"].players["0"];
  const b = m.outcomes && m.outcomes["182"] && m.outcomes["182"].players && m.outcomes["182"].players["0"];
  if (!a || !b || !(a.price > 1) || !(b.price > 1) || a.active === false || b.active === false) return null;
  return { oh: a.price, oa: b.price };
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function plan() {
  const now = Date.now(), used = (st.api && st.api.used) || 0;
  const left = Math.max(0, BUDGET - RESERVE - used);
  const daysLeft = Math.max(1, Math.ceil((END - now) / 864e5)), effDays = Math.max(1, Math.ceil(daysLeft * 0.7));   // 休賽日不用花
  const perDay = left / effDays;
  return { left, perDay, oddsMs: 6 * 3600e3, checkMs: clamp(864e5 / Math.max(0.1, perDay * 0.45), 75 * 60e3, 6 * 3600e3), dead: left <= 0 };
}
const POLL_MS_NOW = () => plan().oddsMs;
// ---- 省 API 用量：OddsPapi 有額度限制，所以只在「有人開著頁面」時才抓賠率（預設每 10 分鐘一次），
// 賽程名單每 3 小時或遇到沒看過的場次才抓，賽果只在有人下注、開賽一段時間後才去查（每場每 20 分鐘最多一次）。
let polling = false, fixturesAt = 0;
const FIX_TTL = 24 * 3600 * 1000, FIRST_CHECK = 35 * 60 * 1000;
let lastCheck = 0;

// 賽程名單：近 8 天每次都抓（賠率與狀態要新）；8 天以後到世界賽結束的「遠期」場次每 2 天才抓一次，
// 這樣畫面上能看到整個世界賽的賽程，又不會多花太多額度（OddsPapi 的 fixtures 一次最多 10 天）。
let farAt = 0, farMap = new Map();
const FAR_TTL = 48 * 3600 * 1000;
function mapFix(f, old) {
  return { id: f.fixtureId, home: f.participant1Name, away: f.participant2Name, start: Date.parse(f.startTime), statusId: f.statusId, statusName: f.statusName || "", hasOdds: !!f.hasOdds, oh: old?.oh, oa: old?.oa, suspended: old?.suspended, score: old?.score, chk: old?.chk };
}
async function loadFixtures(now, prio) {
  const fx = await _deps.fetchJson("fixtures", { sportId: 18, from: day(now - 86400000), to: day(now + 8 * 86400000) }, prio);
  const next = new Map();
  for (const f of Array.isArray(fx) ? fx : []) {
    if (f.tournamentId !== TOURNAMENT) continue;
    next.set(f.fixtureId, mapFix(f, fixtures.get(f.fixtureId)));
  }
  // 遠期場次：失敗不影響近期名單
  if (now - farAt > FAR_TTL && now + 8 * 86400000 < END + 86400000) {
    try {
      const far = new Map();
      for (let from = now + 8 * 86400000; from < END + 86400000; from += 10 * 86400000) {
        await new Promise((r) => setTimeout(r, 6000));          // 同一個介面連續呼叫太快會被 429
        const q = { sportId: 18, from: day(from), to: day(Math.min(from + 10 * 86400000, END + 86400000)) };
        let rows;
        try { rows = await _deps.fetchJson("fixtures", q, prio); }
        catch (e) {
          const m = String(e && e.message);
          if (/404/.test(m)) rows = [];            // 那段期間還沒有任何場次（淘汰賽對戰組合出來才會有）
          else if (!/429/.test(m)) throw e;
          else { await new Promise((r) => setTimeout(r, 10000)); rows = await _deps.fetchJson("fixtures", q, prio); }
        }
        for (const f of Array.isArray(rows) ? rows : []) if (f.tournamentId === TOURNAMENT) far.set(f.fixtureId, mapFix(f, fixtures.get(f.fixtureId)));
      }
      farMap = far; farAt = now;
    } catch (e) { console.log("世界賽運彩：遠期賽程抓取失敗", String(e && e.message || e).replace(KEY, "***").replace(KEYS[1] || "\0", "***").slice(0, 80)); }
  }
  for (const [id, f] of farMap) if (!next.has(id)) next.set(id, fixtures.get(id) || f);
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
  } catch (e) { lastErr = String(e && e.message || e).replace(KEY, "***").replace(KEYS[1] || "\0", "***").slice(0, 120); console.log("世界賽運彩同步失敗：", lastErr); }
  finally { polling = false; }
}

const isFinished = (f) => /finish|ended|complete/i.test(f.statusName || "") || f.statusId === 2;
const isVoid = (f) => /cancel|abandon|walkover|interrupt/i.test(f.statusName || "");

async function getScore(f) {
  if (f.score) return f.score;
  const j = await _deps.fetchJson("scores", { fixtureId: f.id }, true);
  const p = j && j.scores && j.scores.periods && (j.scores.periods.result || j.scores.periods.fulltime);
  if (p && Number.isFinite(p.participant1Score) && Number.isFinite(p.participant2Score)) {
    f.score = [p.participant1Score, p.participant2Score];
    st.results[f.id] = { id: f.id, home: f.home, away: f.away, start: f.start, score: f.score }; save();   // 比分記下來，之後顯示在「最近結果」
  }
  return f.score || null;
}

// 結算：贏的派彩、輸的標記、比賽取消或太久沒結果的退款。派彩失敗的留著，下一輪再試。
// ---- 賽果優先從 Liquipedia 的世界賽頁面拿（公開資料，不花 OddsPapi 額度）：瑞士輪頁面解析後依「兩隊＋開賽時間」對上場次。
// 頁面請求有間隔限制（每次至少隔 8 分鐘，且只有「有人在看或有人下注」時才抓）。抓不到（例如淘汰賽頁面格式不同）再退回 OddsPapi。
const execFileP = promisify(execFile);
const LP_ON = ENV.LOLBET_LP !== "0";
const LP_PAGES = (ENV.LOLBET_LP_PAGES || "World Championship/2026/Swiss Stage").split(",").map((x) => x.trim()).filter(Boolean);
const LP_UA = "discord-activity-lolbet/1.0 (personal hobby bot)";
const LP_ALIAS = { lyon: "lyongaming", secretwhales: "teamsecretwhales" };
const norm = (n) => { const k = String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return LP_ALIAS[k] || k; };
const sameTeam = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)))); };
let lp = { at: 0, list: [] };
function parseMatchlists(html) {
  const out = [];
  for (const block of html.split("brkts-matchlist-title").slice(1)) {                    // 每個區塊標題長得像「Round 4 Low Matches (Bo3)」：賽制 Bo1/Bo3/Bo5 在這裡
    const bm = block.slice(0, 600).match(/\(Bo(\d)\)/), bo = bm ? Number(bm[1]) : 0;
    for (const chunk of block.split('class="brkts-matchlist-match ').slice(1)) {
      const teams = [...chunk.matchAll(/brkts-matchlist-opponent[^"]*"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1].replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&"));
      const scores = [...chunk.matchAll(/brkts-matchlist-score[^"]*"[^>]*aria-label="[^"]*"><div class="brkts-matchlist-cell-content">\s*(\d*)\s*<\/div>/g)].map((m) => m[1]);
      const ts = chunk.match(/data-timestamp="(\d+)"/);
      if (teams.length < 2) continue;
      const sa = Number(scores[0] || 0), sb = Number(scores[1] || 0);
      // 打完才算：頁面要標出贏家，而且（賽制已知時）贏家要拿到過半場數。進行中的 1:0 不算結果。
      const done = scores.length >= 2 && scores[0] !== "" && scores[1] !== "" && sa !== sb && chunk.includes("brkts-matchlist-slot-winner") && (!bo || Math.max(sa, sb) >= (bo + 1) / 2);
      out.push({ a: teams[0], b: teams[1], sa, sb, ts: ts ? Number(ts[1]) * 1000 : 0, bo, done });
    }
  }
  return out;
}
async function lpFetch(now, force) {
  if (!LP_ON || !LP_PAGES.length) return;
  if (!force && now - lp.at < 8 * 60e3) return;
  lp.at = now;                                                  // 失敗也算一次，不要連續重試
  const list = [];
  for (const page of LP_PAGES) {
    const u = "https://liquipedia.net/leagueoflegends/api.php?" + new URLSearchParams({ action: "parse", page, prop: "text", format: "json", disablelimitreport: "1", disableeditsection: "1" }).toString();
    try {                                                       // 用 curl：這台伺服器上 node 的 fetch 連 Liquipedia 會逾時（curl 正常），而且對方要求 gzip
      const { stdout } = await execFileP("curl", ["-sS", "--compressed", "-m", "40", "-A", LP_UA, u], { maxBuffer: 32 * 1024 * 1024 });
      const j = JSON.parse(stdout); list.push(...parseMatchlists(String(j?.parse?.text?.["*"] || "")));
    } catch (e) { console.log("世界賽運彩 Liquipedia 抓取失敗：", page, String(e && e.message || e).slice(0, 120)); }
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  if (list.length) lp.list = list;
}
function lpFind(f, needDone) {
  for (const r of lp.list) {
    if (needDone && !r.done) continue;
    const fw = sameTeam(f.home, r.a) && sameTeam(f.away, r.b), bw = sameTeam(f.home, r.b) && sameTeam(f.away, r.a);
    if (!fw && !bw) continue;
    if (r.ts && Math.abs(r.ts - f.start) > 8 * 3600e3) continue;
    return { r, sc: fw ? [r.sa, r.sb] : [r.sb, r.sa] };
  }
  return null;
}
const lpMatch = (f) => { const x = lpFind(f, true); return x ? x.sc : null; };
function lpBoAll() { for (const f of fixtures.values()) { const x = lpFind(f, false); if (x && x.r.bo) f.bo = x.r.bo; } }
function lpApply(f) {                                           // 用 Liquipedia 的結果把這場標成已結束並記下比分
  const sc = lpMatch(f); if (!sc) return false;
  f.score = sc; f.statusId = 2; f.statusName = "Finished";
  st.results[f.id] = { id: f.id, home: f.home, away: f.away, start: f.start, score: sc }; save();
  return true;
}

let settling = false;
export const lolSettle = () => settleAll();
async function settleAll() {
  if (settling) return; settling = true;
  try {
    const now = Date.now();
    const started = [...fixtures.values()].filter((f) => !isFinished(f) && !isVoid(f) && now - f.start > 25 * 60e3 && now - f.start < 12 * 3600e3);
    const hasBet = (f) => st.bets.some((b) => b.fixtureId === f.id && b.status === "open");
    if (LP_ON && started.length && (watchers.size > 0 || started.some(hasBet))) { await lpFetch(now); for (const f of started) lpApply(f); }
    else if (LP_ON && watchers.size > 0) await lpFetch(now);       // 有人在看：也順便更新每場的賽制（Bo1/Bo3）
    if (LP_ON) lpBoAll();
    if (LP_ON && st.backfill) { await lpFetch(now, true); for (const f of fixtures.values()) if (isFinished(f) && !f.score && !st.results[f.id]) lpApply(f); }
    // OddsPapi 的狀態檢查只當備援：Liquipedia 在 3 小時內都沒給出結果的場次才用（例如淘汰賽頁面抓不到）
    const running = (f) => f && !isFinished(f) && !isVoid(f) && now - f.start > (LP_ON ? 3 * 3600e3 : FIRST_CHECK) && now - f.start < 12 * 3600e3;
    const due = st.bets.some((b) => b.status === "open" && running(fixtures.get(b.fixtureId))) || (watchers.size > 0 && [...fixtures.values()].some(running));
    if (due && now - lastCheck > plan().checkMs) { lastCheck = now; try { await loadFixtures(now, true); } catch (e) { console.log("世界賽運彩 賽果檢查失敗：", e && e.message); } }   // 一次呼叫就能更新所有場次的狀態
    let got = 0;
    for (const f of fixtures.values()) {                         // 剛打完的比賽（12 小時內）先查比分，顯示在「最近結果」；每輪最多 6 場
      if (got >= 6) break;
      if (!isFinished(f) || f.score || st.results[f.id] || (now - f.start > 12 * 3600e3 && !st.backfill)) continue;
      if (LP_ON && lpApply(f)) continue;
      if (st.api && st.api.used >= BUDGET - 8) break;             // 快沒額度了：只留給有注單的場次
      got++; try { await getScore(f); } catch {} await new Promise((r) => setTimeout(r, 1100));
    }
    if (st.backfill && !got) { st.backfill = false; save(); console.log("世界賽運彩 補比分完成"); }      // 一次性補抓舊場次比分（狀態檔設 backfill:true 觸發）
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
        if (sc) b.score = sc;
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
  return { id: f.id, home: f.home, away: f.away, start: f.start, bo: f.bo || null, state, oh: hasLine ? f.oh : null, oa: hasLine ? f.oa : null, score: f.score || (st.results[f.id] && st.results[f.id].score) || null, mine,
    all: st.bets.filter((b) => b.fixtureId === f.id && b.uid !== uid).map((b) => ({ name: b.name, side: b.side, amount: b.amount, odds: b.odds, status: b.status, payout: b.payout || 0 })) };   // 別人下的注（公開）
}
function viewFor(ws) {
  const uid = ws.user && ws.user.uid;
  const list = [...fixtures.values()].sort((a, b) => a.start - b.start).map((f) => fview(f, uid));
  for (const r of Object.values(st.results)) if (!fixtures.has(r.id)) list.unshift({ id: r.id, home: r.home, away: r.away, start: r.start, state: "finished", oh: null, oa: null, score: r.score, mine: [], all: [] });   // 已經掉出賽程視窗的舊場次
  list.sort((a, b) => a.start - b.start);
  const net = new Map();                                        // 輸贏榜：每人已結算的注單淨損益（贏＝派彩−本金，輸＝−本金，退款＝0）
  for (const b of st.bets) {
    if (b.status === "open" || b.status === "unpaid") continue;
    const k = b.uid, o = net.get(k) || { name: b.name, net: 0, n: 0, w: 0 };
    o.name = b.name; o.n++; if (b.status === "won") { o.net += (b.payout || 0) - b.amount; o.w++; } else if (b.status === "lost") o.net -= b.amount;
    net.set(k, o);
  }
  const board = [...net.values()].sort((a, b) => b.net - a.net).slice(0, 10);
  return { t: "lolstate", board, ok: lolEnabled(), now: Date.now(), updatedAt, err: lastErr ? 1 : 0, dead: plan().dead ? 1 : 0, every: Math.round(plan().oddsMs / 60000), limit: betLimit(), maxFixture: betLimit() * MAX_PER_FIXTURE, list, you: uid ? ws.user.name : null };
}
function pushAll() { for (const ws of watchers) send(ws, viewFor(ws)); }

export function lolClose(ws) { watchers.delete(ws); }

export async function handleLol(ws, m) {
  if (m.t === "lolget") { watchers.add(ws); send(ws, viewFor(ws)); if (Date.now() - updatedAt > POLL_MS_NOW()) lolPoll(); return true; }
  if (m.t === "lolhist") {
    const uid = ws.user && ws.user.uid;
    const list = uid ? st.bets.filter((b) => b.uid === uid).slice(-30).reverse().map((b) => ({ label: b.label, home: b.home || "", away: b.away || "", score: b.score || null, side: b.side, amount: b.amount, odds: b.odds, status: b.status, payout: b.payout || 0, at: b.at })) : [];
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
    const bet = { id: ++st.seq, uid: u.uid, name: u.name, fixtureId: f.id, label, home: f.home, away: f.away, side, amount, odds: cur, at: Date.now(), status: "open" };
    st.bets.push(bet); save();
    send(ws, { t: "lolres", ok: true, balance: r.balance, bet: { id: bet.id, side, amount, odds: cur } });
    send(ws, viewFor(ws));
  } finally { ws.lolbusy = false; }
  return true;
}

// 每分鐘看一次：有人在看且賠率過期就更新；有待結算的注單就檢查賽果（實際會不會打 API 由上面的間隔決定）
if (lolEnabled()) setInterval(() => {
  if (watchers.size && Date.now() - updatedAt > POLL_MS_NOW()) lolPoll();
  if (watchers.size || st.bets.some((b) => b.status === "open" || b.status === "unpaid")) { if (!fixtures.size && !polling) lolPoll().then(settleAll); else settleAll().then(() => { if (watchers.size) pushAll(); }); }
}, 60000).unref();
