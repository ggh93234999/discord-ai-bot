// 遊玩統計網頁（獨立服務，只給內網看）
//   （網址：http://內網IP:3120/ ，由 Apache 轉到這裡）
//   /              → 網頁
//   /api/users     → 有紀錄的人
//   /api/stats?u=ID&days=30
// 只聽 127.0.0.1，由 Apache 的內網專用站台（Listen 3120，Require ip 限內網，跟 open-webui 一樣）轉過來；
// 自己也再擋一次：來源不是內網位址就拒絕。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, listUsers, meta, query, dayLine, rangeLine, dayStartMs } from "./stats.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PLAYSTATS_PORT || 3121);
const HOST = process.env.PLAYSTATS_HOST || "127.0.0.1";

function isPrivate(addr) {
  const a = String(addr || "").replace(/^::ffff:/, "");
  if (a === "::1") return true;
  const m = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}

http.createServer((req, res) => {
  if (!isPrivate(req.socket.remoteAddress)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }); return void res.end("只開放內網");
  }
  const u = new URL(req.url, "http://x");
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  try {
    if (u.pathname === "/api/users") return json(200, listUsers());
    if (u.pathname === "/api/meta") return json(200, meta());
    if (u.pathname === "/api/query" || u.pathname === "/api/day" || u.pathname === "/api/days") {
      // 篩選條件：u=玩家ID（可重複）、g=遊戲名稱（可重複）、from/to=日期 YYYY-MM-DD（含）、h=時段 "22-2"、wd=星期 "0,1,2"（一=0）
      const us = u.searchParams.getAll("u").filter((x) => /^\d{5,25}$/.test(x)), gs = u.searchParams.getAll("g").map((x) => x.slice(0, 120)).filter(Boolean);
      const f = { users: us.length ? new Set(us) : null, games: gs.length ? new Set(gs) : null, from: null, to: null, h1: null, h2: null, wd: null };
      const from = dayStartMs(u.searchParams.get("from")), to = dayStartMs(u.searchParams.get("to"));
      if (from != null) f.from = from;
      if (to != null) f.to = to + 24 * 3600 * 1000;
      const h = /^(\d{1,2})-(\d{1,2})$/.exec(u.searchParams.get("h") || "");
      if (h && +h[1] <= 24 && +h[2] <= 24) { f.h1 = +h[1] % 24; f.h2 = +h[2] % 24; }
      const wd = (u.searchParams.get("wd") || "").split(",").filter((x) => x.trim() !== "").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if (wd.length && wd.length < 7) f.wd = new Set(wd);
      if (u.pathname === "/api/days") { const r = rangeLine(f); return json(r.error ? 400 : 200, r); }
      if (u.pathname === "/api/day") { const r = dayLine(f, u.searchParams.get("d") || ""); return json(r.error ? 400 : 200, r); }
      return json(200, query(f));
    }
    if (u.pathname === "/api/stats") {
      const id = u.searchParams.get("u") || "";
      if (!/^\d{5,25}$/.test(id)) return json(400, { error: "缺少使用者" });
      const days = Math.max(0, Math.min(3650, Number(u.searchParams.get("days") ?? 30) || 0));
      return json(200, summarize(id, days));
    }
    if (u.pathname === "/" || u.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return void res.end(fs.readFileSync(path.join(HERE, "index.html")));
    }
    res.writeHead(404); res.end();
  } catch (e) { json(500, { error: String(e.message || e) }); }
}).listen(PORT, HOST, () => console.log(`playstats http://${HOST}:${PORT}`));
