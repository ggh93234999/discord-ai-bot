// 賭注模式：Discord OAuth 登入、登入憑證（session）、和機器人內部 API 的溝通。
// 密鑰（DISCORD_CLIENT_SECRET）只從 server/.env 讀，不會被傳到前端或寫進記錄。
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

function loadEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return out;
}

const dir = fileURLToPath(new URL(".", import.meta.url));
const ENV = { ...loadEnv(dir + ".env"), ...process.env };
const CLIENT_ID = ENV.DISCORD_CLIENT_ID || "1560169041493102594";
const CLIENT_SECRET = ENV.DISCORD_CLIENT_SECRET || "";
export const GUILD_ID = ENV.ACTIVITY_GUILD_ID || "1560169531777744938";
const BOT_API = ENV.BOT_API || "http://127.0.0.1:3107";
let INTERNAL_KEY = "";
try { INTERNAL_KEY = fs.readFileSync(dir + "internal.key", "utf8").trim(); } catch {}

export const betEnabled = () => !!(CLIENT_SECRET && INTERNAL_KEY);

// ---- 登入憑證：隨機字串 → 玩家身分，只存在記憶體，12 小時過期
const sessions = new Map();
const SESSION_MS = 12 * 3600 * 1000;
export function getSession(token) {
  const s = sessions.get(String(token || ""));
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  return s;
}
setInterval(() => { for (const [k, s] of sessions) if (s.exp < Date.now()) sessions.delete(k); }, 600000).unref();

// ---- 機器人內部 API
async function bot(path, body) {
  const r = await fetch(BOT_API + path, {
    method: "POST", headers: { "X-Key": INTERNAL_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  return r.json();
}
export const botInfo = (uid) => bot("/wallet/info", { gid: GUILD_ID, uid });
export const botSettle = (uid, name, bet, back, why) => bot("/wallet/settle", { gid: GUILD_ID, uid, name, bet, back, why });
export const botPay = (uid, name, amount, why) => bot("/wallet/pay", { gid: GUILD_ID, uid, name, amount, why });

// ---- HTTP：POST /api/token { code } → { token, name }
const hits = new Map();   // 每個來源 IP 每分鐘最多 8 次
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 8;
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function discord(path, token) {
  const r = await fetch("https://discord.com/api/v10" + path, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

export async function handleApi(req, res) {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/api/token") {
    if (!betEnabled()) return json(res, 503, { error: "bet_disabled" });
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "";
    if (limited(ip)) return json(res, 429, { error: "too_many" });
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 2000) return json(res, 413, { error: "too_large" }); }
    let code;
    try { code = String(JSON.parse(body).code || ""); } catch { return json(res, 400, { error: "bad_request" }); }
    if (!code || code.length > 200) return json(res, 400, { error: "bad_request" });
    try {
      const tr = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code }),
        signal: AbortSignal.timeout(8000),
      });
      const tok = await tr.json();
      if (!tr.ok || !tok.access_token) { console.log("OAuth 換 token 失敗：", tr.status, tok.error || ""); return json(res, 401, { error: "oauth_failed" }); }
      const me = await discord("/users/@me", tok.access_token);
      let member = false;
      try { member = (await discord("/users/@me/guilds", tok.access_token)).some((g) => g.id === GUILD_ID); } catch {}
      // 用完就撤銷，不留著 access token
      fetch("https://discord.com/api/v10/oauth2/token/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, token: tok.access_token }),
      }).catch(() => {});
      if (!member) return json(res, 403, { error: "not_member" });
      const name = me.global_name || me.username || me.id;
      const token = randomBytes(24).toString("hex");
      sessions.set(token, { uid: me.id, name, exp: Date.now() + SESSION_MS });
      return json(res, 200, { token, name });
    } catch (e) {
      console.log("OAuth 流程錯誤：", e.message);
      return json(res, 502, { error: "upstream" });
    }
  }
  json(res, 404, { error: "not_found" });
}
