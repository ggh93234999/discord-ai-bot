// 遊玩統計網頁（獨立服務，只給內網看）：http://內網IP:3120/
//   /              → 網頁
//   /api/users     → 有紀錄的人
//   /api/stats?u=ID&days=30
// 只接受內網位址（127.x、10.x、172.16–31.x、192.168.x）；經過反向代理（有 X-Forwarded-For）的一律拒絕，所以不會被不小心放到外網。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, listUsers } from "./stats.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PLAYSTATS_PORT || 3120);
const HOST = process.env.PLAYSTATS_HOST || "0.0.0.0";

function isPrivate(addr) {
  const a = String(addr || "").replace(/^::ffff:/, "");
  if (a === "::1") return true;
  const m = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}

http.createServer((req, res) => {
  if (!isPrivate(req.socket.remoteAddress) || req.headers["x-forwarded-for"] || req.headers["forwarded"]) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }); return void res.end("只開放內網");
  }
  const u = new URL(req.url, "http://x");
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  try {
    if (u.pathname === "/api/users") return json(200, listUsers());
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
