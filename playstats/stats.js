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
