// 遊玩統計：讀機器人記下的 gamelog.db（每場遊戲的開始、結束時間，只讀），整理成某個人的統計。
// 這個資料夾自己獨立，不依賴機器人和 Activity；只是讀同一個資料檔。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.GAMELOG_DB || path.resolve(HERE, "../data/records/gamelog.db");
const TZ_MS = 8 * 3600 * 1000;                       // 資料全是台北時間（+08:00）
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
let db = null;

function openDb() {
  if (db) return db;
  if (!fs.existsSync(DB_FILE)) return null;
  db = new DatabaseSync(DB_FILE, { readOnly: true });
  return db;
}

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (ms) => { const d = new Date(ms + TZ_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

export function summarize(uid, days, now = Date.now()) {
  const d = openDb();
  if (!d) return { error: "還沒有遊玩紀錄" };
  let hb = now;
  try { const r = d.prepare("SELECT value FROM meta WHERE key='heartbeat'").get(); if (r) hb = Math.min(now, Date.parse(r.value)); } catch {}
  const since = days > 0 ? now - days * DAY : 0;
  const rows = d.prepare('SELECT game, start, "end" AS end, user_name AS name FROM game_sessions WHERE user_id = ? ORDER BY start').all(BigInt(uid));
  const games = new Map();
  const byHour = Array.from({ length: 24 }, () => ({}));         // 每個小時、各遊戲秒數
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));   // 星期（一=0）× 小時
  const daily = new Map();
  const recent = [];
  let total = 0, count = 0, name = "", now_playing = [];
  for (const r of rows) {
    name = r.name || name;
    const s = Date.parse(r.start);
    const open = !r.end;
    const e = open ? hb : Date.parse(r.end);
    if (!(e > s)) continue;
    if (open && now - hb < 5 * 60 * 1000) now_playing.push(r.game);
    if (e < since) continue;
    const from = Math.max(s, since);
    count++;
    const g = games.get(r.game) || { game: r.game, sec: 0, sessions: 0, longest: 0, first: s, last: e };
    const secAll = Math.round((e - from) / 1000);
    g.sec += secAll; g.sessions++; g.longest = Math.max(g.longest, Math.round((e - s) / 1000)); g.first = Math.min(g.first, s); g.last = Math.max(g.last, e);
    games.set(r.game, g);
    total += secAll;
    recent.push({ game: r.game, start: r.start, end: open ? null : r.end, sec: Math.round((e - s) / 1000) });
    // 切成每小時（台北時間）累計
    for (let t = from; t < e;) {
      const local = t + TZ_MS;
      const hourStart = Math.floor(local / HOUR) * HOUR;
      const next = Math.min(e, hourStart + HOUR - TZ_MS);
      const sec = (next - t) / 1000;
      const dt = new Date(local);
      const hr = dt.getUTCHours(), wd = (dt.getUTCDay() + 6) % 7;
      byHour[hr][r.game] = (byHour[hr][r.game] || 0) + sec;
      heat[wd][hr] += sec;
      const k = dayKey(t);
      const day = daily.get(k) || {};
      day[r.game] = (day[r.game] || 0) + sec;
      daily.set(k, day);
      t = next;
    }
  }
  const list = [...games.values()].sort((a, b) => b.sec - a.sec);
  // 每天趨勢：連續列出日期（沒玩的天補空）
  const dayList = [];
  const nDays = days > 0 ? Math.min(days, 120) : Math.min(120, Math.max(1, Math.ceil((now - (rows.length ? Date.parse(rows[0].start) : now)) / DAY) + 1));
  for (let i = nDays - 1; i >= 0; i--) { const k = dayKey(now - i * DAY); dayList.push({ d: k, games: daily.get(k) || {} }); }
  const activeDays = new Set([...daily.keys()]).size;
  return {
    name, days, total, sessions: count, activeDays,
    games: list.map((g) => ({ ...g, first: new Date(g.first).toISOString(), last: new Date(g.last).toISOString() })),
    byHour: byHour.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))),
    heat: heat.map((r) => r.map(Math.round)),
    daily: dayList.map((x) => ({ d: x.d, games: Object.fromEntries(Object.entries(x.games).map(([k, v]) => [k, Math.round(v)])) })),
    recent: recent.slice(-40).reverse(),
    nowPlaying: [...new Set(now_playing)],
    since: rows.length ? rows[0].start : null,
  };
}

// 有紀錄的人：名稱、總時數、最後一次玩的時間（時數多的排前面）
export function listUsers() {
  const d = openDb();
  if (!d) return [];
  const rows = d.prepare(`SELECT CAST(user_id AS TEXT) AS id, MAX(user_name) AS name, SUM(COALESCE(seconds, 0)) AS sec, MAX(start) AS last, COUNT(*) AS n FROM game_sessions GROUP BY user_id ORDER BY sec DESC`).all();
  return rows.map((r) => ({ id: String(r.id), name: r.name || String(r.id), sec: Number(r.sec), last: r.last, sessions: Number(r.n) }));
}

// ====================================================================== 組合篩選查詢（新）
// 篩選條件 f：users / games（Set，null＝全部）、from / to（毫秒，台北時間的日界線；to 不含）、
// h1 / h2（時段：h1 點到 h2 點，h1 > h2 表示跨午夜，例如 22→2；沒給＝全天）、wd（星期 Set，一=0）。
// 時段和星期是「逐小時切開」後再篩，所以跨時段的場次只會算到符合的那幾分鐘。

export function dayStartMs(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}

function loadAll(now) {
  const d = openDb();
  if (!d) return null;
  let hb = now;
  try { const r = d.prepare("SELECT value FROM meta WHERE key='heartbeat'").get(); if (r) hb = Math.min(now, Date.parse(r.value)); } catch {}
  const rows = d.prepare('SELECT CAST(user_id AS TEXT) AS uid, game, start, "end" AS end, user_name AS name FROM game_sessions ORDER BY start').all();
  const names = new Map(), list = [];
  for (const r of rows) {
    names.set(r.uid, r.name || names.get(r.uid) || r.uid);
    const s = Date.parse(r.start), open = !r.end, e = open ? hb : Date.parse(r.end);
    if (!(e > s)) continue;
    list.push({ uid: r.uid, game: r.game, s, e, open });
  }
  return { list, names, hb };
}

// 篩選用的選項：有哪些人、哪些遊戲、資料從哪天到哪天、現在誰在玩什麼
export function meta(now = Date.now()) {
  const a = loadAll(now);
  if (!a) return { error: "還沒有遊玩紀錄" };
  const us = new Map(), gs = new Map();
  let first = Infinity, last = 0;
  const playing = [];
  for (const x of a.list) {
    const sec = (x.e - x.s) / 1000;
    const u = us.get(x.uid) || { id: x.uid, name: a.names.get(x.uid), sec: 0, sessions: 0, last: 0, games: new Map() };
    u.sec += sec; u.sessions++; u.last = Math.max(u.last, x.e); us.set(x.uid, u);
    u.games.set(x.game, (u.games.get(x.game) || 0) + sec);
    const g = gs.get(x.game) || { game: x.game, sec: 0, sessions: 0, users: new Set() };
    g.sec += sec; g.sessions++; g.users.add(x.uid); gs.set(x.game, g);
    first = Math.min(first, x.s); last = Math.max(last, x.e);
    if (x.open && now - a.hb < 5 * 60 * 1000) playing.push({ id: x.uid, name: a.names.get(x.uid), game: x.game, since: new Date(x.s).toISOString() });
  }
  return {
    users: [...us.values()].sort((p, q) => q.sec - p.sec).map((u) => ({ ...u, sec: Math.round(u.sec), last: new Date(u.last).toISOString(),
      games: [...u.games].sort((p, q) => q[1] - p[1]).map(([game, sec]) => ({ game, sec: Math.round(sec) })) })),
    games: [...gs.values()].sort((p, q) => q.sec - p.sec).map((g) => ({ game: g.game, sec: Math.round(g.sec), sessions: g.sessions, users: g.users.size })),
    first: a.list.length ? dayKey(first) : null, last: a.list.length ? dayKey(last) : null, today: dayKey(now),
    nowPlaying: playing,
  };
}

const hourOk = (f, hr) => f.h1 == null || f.h2 == null || f.h1 === f.h2 || (f.h1 < f.h2 ? hr >= f.h1 && hr < f.h2 : hr >= f.h1 || hr < f.h2);

export function query(f, now = Date.now()) {
  const a = loadAll(now);
  if (!a) return { error: "還沒有遊玩紀錄" };
  const lo = f.from ?? 0, hi = f.to ?? now + DAY;
  const games = new Map(), users = new Map(), daily = new Map(), recent = [];
  const byHour = Array.from({ length: 24 }, () => ({}));
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let total = 0, count = 0, longest = null, firstMs = Infinity;
  for (const x of a.list) {
    if (f.users && !f.users.has(x.uid)) continue;
    if (f.games && !f.games.has(x.game)) continue;
    const from = Math.max(x.s, lo), end = Math.min(x.e, hi);
    if (!(end > from)) continue;
    let got = 0;
    for (let t = from; t < end;) {
      const local = t + TZ_MS;
      const hourStart = Math.floor(local / HOUR) * HOUR;
      const next = Math.min(end, hourStart + HOUR - TZ_MS);
      const dt = new Date(local), hr = dt.getUTCHours(), wd = (dt.getUTCDay() + 6) % 7;
      if (hourOk(f, hr) && (!f.wd || f.wd.has(wd))) {
        const sec = (next - t) / 1000;
        byHour[hr][x.game] = (byHour[hr][x.game] || 0) + sec;
        heat[wd][hr] += sec;
        const k = dayKey(t), day = daily.get(k) || {};
        day[x.game] = (day[x.game] || 0) + sec; daily.set(k, day);
        got += sec;
      }
      t = next;
    }
    if (got <= 0) continue;
    count++; total += got; firstMs = Math.min(firstMs, from);
    const g = games.get(x.game) || { game: x.game, sec: 0, sessions: 0, longest: 0, last: 0, users: new Set() };
    g.sec += got; g.sessions++; g.longest = Math.max(g.longest, got); g.last = Math.max(g.last, end); g.users.add(x.uid); games.set(x.game, g);
    const u = users.get(x.uid) || { id: x.uid, name: a.names.get(x.uid), sec: 0, sessions: 0, last: 0 };
    u.sec += got; u.sessions++; u.last = Math.max(u.last, end); users.set(x.uid, u);
    if (!longest || got > longest.sec) longest = { id: x.uid, name: a.names.get(x.uid), game: x.game, sec: Math.round(got), start: new Date(x.s).toISOString() };
    recent.push({ id: x.uid, name: a.names.get(x.uid), game: x.game, start: new Date(x.s).toISOString(), end: x.open ? null : new Date(x.e).toISOString(), sec: Math.round(got) });
  }
  // 每天趨勢：連續列出日期（沒玩的天補空），最多最近 120 天
  const dayList = [];
  if (daily.size || f.from != null) {
    const startMs = f.from != null ? f.from : firstMs, endMs = Math.min(f.to != null ? f.to - 1 : now, now + DAY);
    const nDays = Math.max(1, Math.min(120, Math.floor((dayStartMs(dayKey(endMs)) - dayStartMs(dayKey(startMs))) / DAY) + 1));
    const endDay = dayStartMs(dayKey(endMs));
    for (let i = nDays - 1; i >= 0; i--) { const k = dayKey(endDay - i * DAY); dayList.push({ d: k, games: Object.fromEntries(Object.entries(daily.get(k) || {}).map(([g, v]) => [g, Math.round(v)])) }); }
  }
  return {
    total: Math.round(total), sessions: count, activeDays: daily.size, longest,
    games: [...games.values()].sort((p, q) => q.sec - p.sec).map((g) => ({ game: g.game, sec: Math.round(g.sec), sessions: g.sessions, longest: Math.round(g.longest), users: g.users.size, last: new Date(g.last).toISOString() })),
    users: [...users.values()].sort((p, q) => q.sec - p.sec).map((u) => ({ id: u.id, name: u.name, sec: Math.round(u.sec), sessions: u.sessions, last: new Date(u.last).toISOString() })),
    byHour: byHour.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))),
    heat: heat.map((r) => r.map(Math.round)),
    daily: dayList,
    recent: recent.sort((p, q) => (q.start < p.start ? -1 : 1)).slice(0, 40),
  };
}

// 某一天的時間軸：每個人每一場（切到那一天的 0～24 點之間），秒數是從那天 00:00 起算
export function dayLine(f, dstr, now = Date.now()) {
  const a = loadAll(now);
  if (!a) return { error: "還沒有遊玩紀錄" };
  const ds = dayStartMs(dstr);
  if (ds == null) return { error: "日期格式不對" };
  const de = ds + DAY, per = new Map();
  for (const x of a.list) {
    if (f.users && !f.users.has(x.uid)) continue;
    if (f.games && !f.games.has(x.game)) continue;
    const from = Math.max(x.s, ds), end = Math.min(x.e, de);
    if (!(end > from)) continue;
    const u = per.get(x.uid) || { id: x.uid, name: a.names.get(x.uid), sec: 0, sessions: [] };
    u.sec += (end - from) / 1000;
    u.sessions.push({ game: x.game, s: Math.round((from - ds) / 1000), e: Math.round((end - ds) / 1000), open: x.open, start: new Date(x.s).toISOString(), end: x.open ? null : new Date(x.e).toISOString(), cutL: x.s < ds, cutR: x.e > de });
    per.set(x.uid, u);
  }
  return {
    d: dstr, nowSec: now >= ds && now < de ? Math.round((now - ds) / 1000) : null,
    users: [...per.values()].map((u) => ({ ...u, sec: Math.round(u.sec) })).sort((p, q) => p.sessions[0].s - q.sessions[0].s),
  };
}

// 多天時間軸：from～to 每一天一列，每列是那天 0～24 點裡的每一場（秒數從那天 00:00 起算）
export function rangeLine(f, now = Date.now()) {
  const a = loadAll(now);
  if (!a) return { error: "還沒有遊玩紀錄" };
  if (f.from == null || f.to == null) return { error: "要給日期範圍" };
  const nDays = Math.round((f.to - f.from) / DAY);
  if (nDays < 1 || nDays > 400) return { error: "日期範圍太大（最多 400 天）" };
  const days = [];
  for (let i = 0; i < nDays; i++) {
    const ds = f.from + i * DAY, d = dayKey(ds), wd = (new Date(ds + TZ_MS).getUTCDay() + 6) % 7;
    if (f.wd && !f.wd.has(wd)) continue;
    days.push({ d, wd, ds, sec: 0, sessions: [] });
  }
  for (const x of a.list) {
    if (f.users && !f.users.has(x.uid)) continue;
    if (f.games && !f.games.has(x.game)) continue;
    if (x.e <= f.from || x.s >= f.to) continue;
    for (const day of days) {
      const de = day.ds + DAY, from = Math.max(x.s, day.ds), end = Math.min(x.e, de);
      if (!(end > from)) continue;
      day.sec += (end - from) / 1000;
      day.sessions.push({ game: x.game, s: Math.round((from - day.ds) / 1000), e: Math.round((end - day.ds) / 1000), open: x.open, cutL: x.s < day.ds, cutR: x.e > de });
    }
  }
  const today = dayKey(now), nowSec = Math.round((now - dayStartMs(today)) / 1000);
  return { today, nowSec, days: days.map(({ ds, ...r }) => ({ ...r, sec: Math.round(r.sec) })).reverse() };   // 新的在上面
}
