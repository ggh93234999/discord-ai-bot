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
const CLIENT_ID = ENV.DISCORD_CLIENT_ID || ENV.VITE_CLIENT_ID || "";
const CLIENT_SECRET = ENV.DISCORD_CLIENT_SECRET || "";
export const GUILD_ID = ENV.ACTIVITY_GUILD_ID || "";
const BOT_API = ENV.BOT_API || "http://127.0.0.1:3107";
// 內部金鑰：INTERNAL_KEY（.env，由機器人第一次啟動時自動產生）；舊版 internal.key 檔仍可用。
// 沒讀到就每次重讀，這樣機器人晚一步產生也不用重啟 Activity。
let INTERNAL_KEY = String(ENV.INTERNAL_KEY || "").trim();
function loadKey() {
  if (INTERNAL_KEY.length >= 32) return INTERNAL_KEY;
  try { INTERNAL_KEY = String(loadEnv(dir + "../../.env").INTERNAL_KEY || "").trim(); } catch {}
  if (INTERNAL_KEY.length < 32) { try { INTERNAL_KEY = fs.readFileSync(dir + "internal.key", "utf8").trim(); } catch {} }
  return INTERNAL_KEY.length >= 32 ? INTERNAL_KEY : "";
}

// 玩家目前在哪個伺服器開的 Activity（登入時記下；沒記錄就用預設伺服器）
const userGid = new Map();
export const gidOf = (uid) => userGid.get(String(uid)) || GUILD_ID;

export const internalKey = () => loadKey();
export const betEnabled = () => !!(CLIENT_SECRET && loadKey());

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
    method: "POST", headers: { "X-Key": loadKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  return r.json();
}
// 圖創區：問機器人這句話要怎麼回、要不要畫圖（語言模型可能要想一陣子）
export async function botGalleryModels() {
  const r = await fetch(BOT_API + "/gallery/models", { method: "POST", headers: { "X-Key": loadKey(), "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  return r.json();
}
export async function botGalleryChat(gid, uid, name, cat, text, history, model = "") {
  const r = await fetch(BOT_API + "/gallery/chat", {
    method: "POST", headers: { "X-Key": loadKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ gid, uid, name, cat, text, history, model }), signal: AbortSignal.timeout(160_000),
  });
  return r.json();
}
// 機器人還沒更新前，settle 單筆上限是 1000；更新後 /wallet/info 會回報 max_bet
export let maxBet = 1000;
export const betLimit = () => maxBet;
export const botInfo = async (uid) => { const r = await bot("/wallet/info", { gid: gidOf(uid), uid }); if (r && r.max_bet) maxBet = r.max_bet; return r; };
// 鍛造身分組：告訴機器人這個人現在手上每把劍的階數（機器人負責建立／指派／移除身分組）
export const botRole = (uid, tiers) => bot("/forge/role", { gid: gidOf(uid), uid, tiers });
export const botSettle = (uid, name, bet, back, why) => bot("/wallet/settle", { gid: gidOf(uid), uid, name, bet, back, why });
// 派彩：優先用機器人的 /wallet/pay；機器人還沒更新（沒有這個介面）時，改用 settle 湊出同樣的淨額（押 1 拿回 amount+1）
export async function botPay(uid, name, amount, why) {
  try {
    const r = await bot("/wallet/pay", { gid: gidOf(uid), uid, name, amount, why });
    if (r && (r.ok || r.error === "no_guild" || r.error === "bad_amount")) return r;
  } catch {}
  // 備援：settle 規定 back ≤ bet×100，所以押 b、拿回 amount+b，淨額剛好是 amount（要玩家至少有 b 個代幣）
  const b = Math.max(1, Math.ceil(amount / 99));
  if (b > 1000) return { ok: false, error: "bad_amount" };
  return bot("/wallet/settle", { gid: gidOf(uid), uid, name, bet: b, back: amount + b, why });
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
    let code, wantGid = "";
    try { const j = JSON.parse(body); code = String(j.code || ""); wantGid = /^\d{5,25}$/.test(String(j.gid || "")) ? String(j.gid) : ""; } catch { return json(res, 400, { error: "bad_request" }); }
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
      let member = false, guilds = [], adminGuilds = [];
      try {
        const gl = await discord("/users/@me/guilds", tok.access_token);
        guilds = gl.map((g) => String(g.id)); member = guilds.includes(wantGid || GUILD_ID);
        // 伺服器管理員：擁有者，或有「管理員」(0x8) 或「管理伺服器」(0x20) 權限（圖創區的模型設定用）
        adminGuilds = gl.filter((g) => g.owner || (BigInt(g.permissions || 0) & 0x28n) !== 0n).map((g) => String(g.id));
      } catch {}
      // 用完就撤銷，不留著 access token
      fetch("https://discord.com/api/v10/oauth2/token/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, token: tok.access_token }),
      }).catch(() => {});
      if (!member) return json(res, 403, { error: "not_member" });
      const name = me.global_name || me.username || me.id;
      const token = randomBytes(24).toString("hex");
      const gid = wantGid || GUILD_ID;
      userGid.set(String(me.id), gid);
      sessions.set(token, { uid: me.id, name, guilds, adminGuilds, gid, exp: Date.now() + SESSION_MS });
      return json(res, 200, { token, name });
    } catch (e) {
      console.log("OAuth 流程錯誤：", e.message);
      return json(res, 502, { error: "upstream" });
    }
  }
  json(res, 404, { error: "not_found" });
}
