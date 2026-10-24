// 賭注模式：Discord OAuth 登入、登入憑證（session）、和機器人內部 API 的溝通。
// 密鑰（DISCORD_CLIENT_SECRET）從專案根目錄的 .env 讀（也相容舊的 server/.env），不會被傳到前端或寫進記錄。
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
export const ENV = { ...loadEnv(dir + ".env"), ...loadEnv(dir + "../../.env"), ...process.env };
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
// 圖創區：問機器人這句話要怎麼回、要不要畫圖（語言模型可能要想一陣子）
export async function botGalleryChat(gid, uid, name, cat, text, history) {
  const r = await fetch(BOT_API + "/gallery/chat", {
    method: "POST", headers: { "X-Key": INTERNAL_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ gid, uid, name, cat, text, history }), signal: AbortSignal.timeout(160_000),
  });
  return r.json();
}
// 機器人還沒更新前，settle 單筆上限是 1000；更新後 /wallet/info 會回報 max_bet
export let maxBet = 1000;
export const betLimit = () => maxBet;
export const botInfo = async (uid) => { const r = await bot("/wallet/info", { gid: GUILD_ID, uid }); if (r && r.max_bet) maxBet = r.max_bet; return r; };
// 鍛造身分組：告訴機器人這個人現在手上每把劍的階數（機器人負責建立／指派／移除身分組）
export const botRole = (uid, tiers) => bot("/forge/role", { gid: GUILD_ID, uid, tiers });
export const botSettle = (uid, name, bet, back, why) => bot("/wallet/settle", { gid: GUILD_ID, uid, name, bet, back, why });
// 派彩：優先用機器人的 /wallet/pay；機器人還沒更新（沒有這個介面）時，改用 settle 湊出同樣的淨額（押 1 拿回 amount+1）
export async function botPay(uid, name, amount, why) {
  try {
    const r = await bot("/wallet/pay", { gid: GUILD_ID, uid, name, amount, why });
    if (r && (r.ok || r.error === "no_guild" || r.error === "bad_amount")) return r;
  } catch {}
  // 備援：settle 規定 back ≤ bet×100，所以押 b、拿回 amount+b，淨額剛好是 amount（要玩家至少有 b 個代幣）
  const b = Math.max(1, Math.ceil(amount / 99));
  if (b > 1000) return { ok: false, error: "bad_amount" };
  return bot("/wallet/settle", { gid: GUILD_ID, uid, name, bet: b, back: amount + b, why });
}

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
      let member = false, guilds = [];
      try { guilds = (await discord("/users/@me/guilds", tok.access_token)).map((g) => String(g.id)); member = guilds.includes(GUILD_ID); } catch {}
      // 用完就撤銷，不留著 access token
      fetch("https://discord.com/api/v10/oauth2/token/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, token: tok.access_token }),
      }).catch(() => {});
      if (!member) return json(res, 403, { error: "not_member" });
      const name = me.global_name || me.username || me.id;
      const token = randomBytes(24).toString("hex");
      sessions.set(token, { uid: me.id, name, guilds, exp: Date.now() + SESSION_MS });
      return json(res, 200, { token, name });
    } catch (e) {
      console.log("OAuth 流程錯誤：", e.message);
      return json(res, 502, { error: "upstream" });
    }
  }
  json(res, 404, { error: "not_found" });
}
