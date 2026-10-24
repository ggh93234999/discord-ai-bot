// 自由 AI 圖創區：用跟機器人相同的畫圖模型（LiteLLM）畫圖，圖只顯示在這個頁面，不傳到 Discord。
// - 每個 Discord 伺服器（guild）各有一份：分類、圖片、聊天紀錄；同一個伺服器不同頻道開的 Activity 看到的是同一份。
// - 要先用 Discord 登入（bauth），而且登入時 Discord 回報的伺服器清單裡要有這個 guild，才能看或畫。
// - 畫圖一次一張、每人同時只能有一張在排、全部最多排 IMAGE_MAX_QUEUE（預設 4）張；內容只擋「涉及未成年人的性內容」。
// - 「跟大笨bot說話」會問機器人（內部 API /gallery/chat），它可以回話、也可以叫這裡畫圖。
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ENV, botGalleryChat } from "./bet.js";

const dir = fileURLToPath(new URL(".", import.meta.url));
const DATA = ENV.GALLERY_DIR || path.join(dir, "gallery_data");
const DBFILE = path.join(DATA, "gallery.json");
const PY = ENV.OPENCC_PYTHON || "/home/ggh93234999/.venvs/discord-bot/bin/python";
const THUMB_PY = path.join(dir, "gallery_thumb.py");
const MAX_IMGS = Number(ENV.GALLERY_MAX_IMAGES || 400);           // 每個伺服器最多留幾張，超過就刪最舊的
const MAX_QUEUE = Number(ENV.IMAGE_MAX_QUEUE || 4);
const PAGE = 36, CHAT_KEEP = 80, MAX_CATS = 24;
const DEFAULT_CATS = ["風景", "人物", "動物", "奇幻", "迷因", "隨便畫"];

const SIZES = { square: "768x768", landscape: "1344x768", portrait: "768x1344" };
const BIG = {
  large: { square: "1280x1280", landscape: "1920x1088", portrait: "1088x1920" },
  huge: { square: "2048x2048", landscape: "2048x1152", portrait: "1152x2048" },
};
const MODELS = { fast: ENV.IMAGE_MODEL_FAST || "draw-klein", clean: ENV.IMAGE_MODEL_CLEAN || "draw-qwen-fast" };

// 內容限制（和 imagegen.py 的 check_prompt 相同）：只擋「性內容 + 未成年人」的組合
const SEX = /裸|露點|露奶|乳頭|乳暈|胸部走光|陰莖|陰道|陰部|生殖器|性交|做愛|交配|口交|自慰|強暴|性愛|性感內衣|情趣|色情|成人向|限制級|18禁|nsfw|nude|naked|topless|porn|hentai|erotic|sex|genital|nipple|penis|vagina|lingerie|fetish|bdsm|explicit|lewd|ecchi|cum\b|orgasm/i;
const MINOR = /未成年|小孩|孩子|兒童|幼童|幼女|幼兒|少女|少年|小學生|國中生|高中生|蘿莉|正太|學生妹|女童|男童|嬰兒|\b(child|children|kid|kids|minor|underage|loli|lolita|shota|toddler|teen|teenager|schoolgirl|schoolboy|young girl|young boy|preteen)\b/i;
const blocked = (...t) => { const s = t.filter(Boolean).join(" "); return SEX.test(s) && MINOR.test(s); };

fs.mkdirSync(DATA, { recursive: true });
let db = { g: {} };
try { db = { g: {}, ...JSON.parse(fs.readFileSync(DBFILE, "utf8")) }; } catch {}
let saveT = 0;
const save = (now = false) => {
  const w = () => { try { fs.writeFileSync(DBFILE, JSON.stringify(db)); } catch (e) { console.log("圖創區存檔失敗", e.message); } };
  if (now) { clearTimeout(saveT); w(); return; }
  clearTimeout(saveT); saveT = setTimeout(w, 800);
};

function guildOf(gid, create = true) {
  let g = db.g[gid];
  if (!g && create) {
    g = db.g[gid] = { cats: DEFAULT_CATS.map((name, i) => ({ id: "c" + (i + 1), name })), seq: DEFAULT_CATS.length, imgs: [], chat: {} };
    save();
  }
  return g;
}

// ---- 在線的人（依伺服器分組）
const subs = new Map();      // gid -> Set<ws>
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "gl", ...o })); };
function broadcast(gid, o) {
  const set = subs.get(gid); if (!set) return;
  for (const ws of set) { if (ws.readyState !== 1) { set.delete(ws); continue; } out(ws, o); }
}
const catsView = (g) => g.cats.map((c) => ({ id: c.id, name: c.name, n: g.imgs.filter((x) => x.cat === c.id).length }));
const imgView = (x) => ({ id: x.id, cat: x.cat, uid: x.uid, name: x.name, prompt: x.prompt, orig: x.orig, w: x.w, h: x.h, ts: x.ts, ext: x.ext, via: x.via, q: x.q });

// ---- 畫圖佇列
const queue = [];            // 等待中的工作
let running = null;
const pending = new Set();   // 有工作在排或在畫的人（key = gid:uid）
function queueView(gid) {
  const jobs = [running, ...queue].filter((j) => j && j.gid === gid).map((j, i) => ({ name: j.name, run: j === running, smart: !!j.smart }));
  return { jobs, total: (running ? 1 : 0) + queue.length };
}
const pushQueue = (gid) => broadcast(gid, { a: "queue", ...queueView(gid) });

function enqueue(ws, job) {
  const key = job.gid + ":" + job.uid;
  if (pending.has(key)) return { error: "你上一張還在處理，等它好了再要下一張" };
  if ((running ? 1 : 0) + queue.length >= MAX_QUEUE) return { error: "畫圖排隊的人太多了，晚點再試" };
  pending.add(key);
  queue.push(job);
  pushQueue(job.gid);
  pump();
  return { ok: true, ahead: (running ? 1 : 0) + queue.length - 1 };
}

async function pump() {
  if (running || !queue.length) return;
  running = queue.shift();
  const job = running;
  pushQueue(job.gid);
  try {
    let prompt = job.prompt, orig = "";
    if (job.smart) {
      const ex = await expand(job.prompt, job.lang);
      if (ex) { orig = job.prompt; prompt = ex; }
    }
    const model = MODELS[job.quality] || MODELS.fast;
    const size = job.scale !== "normal" && BIG[job.scale] ? BIG[job.scale][job.shape] : SIZES[job.shape];
    const raw = await generate(model, prompt, size);
    const g = guildOf(job.gid);
    const id = randomBytes(8).toString("hex");
    const ext = raw[0] === 0xff ? "jpg" : "png";
    const gdir = path.join(DATA, job.gid);
    fs.mkdirSync(gdir, { recursive: true });
    fs.writeFileSync(path.join(gdir, `${id}.${ext}`), raw);
    await thumb(path.join(gdir, `${id}.${ext}`), path.join(gdir, `${id}_t.jpg`));
    const [w, h] = dims(raw);
    const x = { id, cat: job.cat, uid: job.uid, name: job.name, prompt, orig, w, h, ts: Date.now(), ext, via: job.via || "", q: job.quality };
    g.imgs.push(x);
    while (g.imgs.length > MAX_IMGS) removeImg(job.gid, g.imgs[0].id, true);
    save(true);
    broadcast(job.gid, { a: "img", img: imgView(x), cats: catsView(g) });
  } catch (e) {
    console.log("圖創區畫圖失敗：", e && e.message);
    broadcast(job.gid, { a: "fail", uid: job.uid, error: e && e.paused ? "畫圖服務目前暫停或連不上，晚點再試" : "這張畫失敗了，換個說法再試一次" });
  } finally {
    pending.delete(job.gid + ":" + job.uid);
    running = null;
    pushQueue(job.gid);
    setImmediate(pump);
  }
}

function dims(raw) {
  try {
    if (raw[0] === 0x89) return [raw.readUInt32BE(16), raw.readUInt32BE(20)];
    let i = 2;                                  // JPEG：找 SOF 區段
    while (i < raw.length) {
      if (raw[i] !== 0xff) { i++; continue; }
      const m = raw[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [raw.readUInt16BE(i + 7), raw.readUInt16BE(i + 5)];
      i += 2 + raw.readUInt16BE(i + 2);
    }
  } catch {}
  return [0, 0];
}

const llmBase = () => String(ENV.IMAGE_BASE_URL || ENV.LLM_BASE_URL || "http://localhost:4000/v1").replace(/\/+$/, "");
const llmKey = () => ENV.IMAGE_API_KEY || ENV.LLM_API_KEY || "";
const llmHeaders = () => ({ "Content-Type": "application/json", ...(llmKey() ? { Authorization: "Bearer " + llmKey() } : {}) });

async function generate(model, prompt, size) {
  let r;
  try {
    r = await fetch(llmBase() + "/images/generations", {
      method: "POST", headers: llmHeaders(), body: JSON.stringify({ model, prompt, size, n: 1 }), signal: AbortSignal.timeout(900_000),
    });
  } catch (e) { const err = new Error("連不上畫圖服務：" + e.message); err.paused = true; throw err; }
  const body = await r.json().catch(() => ({}));
  if (r.status >= 500 || [404, 408, 429].includes(r.status)) { const err = new Error("畫圖服務 HTTP " + r.status); err.paused = true; throw err; }
  if (!r.ok) throw new Error("HTTP " + r.status + " " + JSON.stringify(body).slice(0, 200));
  const b64 = body && body.data && body.data[0] && body.data[0].b64_json;
  if (!b64) throw new Error("回傳裡沒有圖片");
  return Buffer.from(b64, "base64");
}

// 把一句話擴寫成完整的畫圖提示詞（prompt-writer 小模型，CPU 約 10～30 秒）；失敗就回 null，用原句畫
async function expand(idea, lang) {
  try {
    const r = await fetch(llmBase() + "/chat/completions", {
      method: "POST", headers: llmHeaders(), signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({ model: ENV.IMAGE_PROMPT_MODEL || "prompt-writer", max_tokens: 500,
        messages: [{ role: "user", content: idea + (lang === "zh" ? "\n\n（請用繁體中文寫出完整的畫圖提示詞，不要用英文。）" : "") }] }),
    });
    const d = await r.json();
    const t = String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "")
      .replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^["“”]+|["“”]+$/g, "").trim();
    return t ? t.slice(0, 1200) : null;
  } catch { return null; }
}

function thumb(src, dst) {
  return new Promise((resolve) => execFile(PY, [THUMB_PY, src, dst], { timeout: 30_000 }, () => resolve()));
}

function removeImg(gid, id, quiet = false) {
  const g = db.g[gid]; if (!g) return false;
  const i = g.imgs.findIndex((x) => x.id === id); if (i < 0) return false;
  const [x] = g.imgs.splice(i, 1);
  for (const f of [`${x.id}.${x.ext}`, `${x.id}_t.jpg`]) { try { fs.unlinkSync(path.join(DATA, gid, f)); } catch {} }
  if (!quiet) { save(true); broadcast(gid, { a: "del", id, cat: x.cat, cats: catsView(g) }); }
  return true;
}

// ---- HTTP：/api/gallery/img/<guild>/<id>.png|jpg 或 <id>_t.jpg（檔名是隨機的，當作只有看過頁面的人知道的連結）
export function serveGallery(req, res) {
  const m = /^\/api\/gallery\/img\/(\d{5,25})\/([0-9a-f]{16}(?:_t)?\.(?:png|jpg))(?:\?.*)?$/.exec(req.url || "");
  if (!m) return false;
  const f = path.join(DATA, m[1], m[2]);
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": m[2].endsWith(".png") ? "image/png" : "image/jpeg", "Content-Length": st.size, "Cache-Control": "private, max-age=86400" });
    fs.createReadStream(f).pipe(res);
  });
  return true;
}

// ---- WebSocket
const lastChat = new Map();
export async function handleGallery(ws, m) {
  const a = m.a, u = ws.user;
  const err = (error) => out(ws, { a: "err", error });
  if (!u) return err("need_login");
  if (a === "join") {
    const gid = String(m.gid || "");
    if (!/^\d{5,25}$/.test(gid)) return err("bad_guild");
    if (!Array.isArray(u.guilds)) return err("relogin");           // 舊的登入憑證沒有伺服器清單，要重新授權
    if (!u.guilds.includes(gid)) return err("not_member");
    if (ws.glGid && subs.get(ws.glGid)) subs.get(ws.glGid).delete(ws);
    ws.glGid = gid;
    if (!subs.has(gid)) subs.set(gid, new Set());
    subs.get(gid).add(ws);
    const g = guildOf(gid);
    out(ws, { a: "state", me: u.uid, cats: catsView(g), ...queueView(gid) });
    return;
  }
  const gid = ws.glGid;
  if (!gid || !u.guilds || !u.guilds.includes(gid)) return err("not_joined");
  const g = guildOf(gid);
  const cat = g.cats.find((c) => c.id === m.cat);

  if (a === "list") {
    if (!cat) return err("bad_cat");
    const before = Number(m.before) || Infinity;
    const all = g.imgs.filter((x) => x.cat === cat.id && x.ts < before).sort((p, q) => q.ts - p.ts);
    const chat = before === Infinity ? (g.chat[cat.id] || []).slice(-40) : undefined;
    out(ws, { a: "list", cat: cat.id, imgs: all.slice(0, PAGE).map(imgView), more: all.length > PAGE, append: before !== Infinity, chat });
    return;
  }
  if (a === "addcat") {
    const name = String(m.name || "").trim().slice(0, 12);
    if (!name) return err("bad_name");
    if (g.cats.length >= MAX_CATS) return err("max_cats");
    if (g.cats.some((c) => c.name === name)) return err("dup_cat");
    g.cats.push({ id: "c" + (++g.seq), name }); save(true);
    broadcast(gid, { a: "cats", cats: catsView(g) });
    return;
  }
  if (a === "delcat") {
    if (!cat) return err("bad_cat");
    if (g.imgs.some((x) => x.cat === cat.id)) return err("cat_not_empty");
    if (g.cats.length <= 1) return err("last_cat");
    g.cats = g.cats.filter((c) => c.id !== cat.id); delete g.chat[cat.id]; save(true);
    broadcast(gid, { a: "cats", cats: catsView(g), removed: cat.id });
    return;
  }
  if (a === "del") {
    const x = g.imgs.find((i) => i.id === m.id);
    if (!x) return;
    if (x.uid !== u.uid) return err("not_yours");
    removeImg(gid, x.id);
    return;
  }
  if (a === "draw") {
    if (!cat) return err("bad_cat");
    const prompt = String(m.prompt || "").trim().slice(0, 600);
    if (!prompt) return err("empty");
    if (blocked(prompt)) return err("blocked");
    const r = enqueue(ws, jobOf(gid, cat, u, prompt, m, ""));
    if (r.error) return err_text(ws, r.error);
    out(ws, { a: "queued", ahead: r.ahead });
    return;
  }
  if (a === "chat") {
    if (!cat) return err("bad_cat");
    const text = String(m.text || "").trim().slice(0, 500);
    if (!text) return;
    if (Date.now() - (lastChat.get(u.uid) || 0) < 3000) return err("slow_down");
    lastChat.set(u.uid, Date.now());
    const log = g.chat[cat.id] || (g.chat[cat.id] = []);
    const add = (e) => { const x = { ts: Date.now(), ...e }; log.push(x); while (log.length > CHAT_KEEP) log.shift(); broadcast(gid, { a: "chat", cat: cat.id, msg: x }); return x; };
    add({ uid: u.uid, name: u.name, text });
    save();
    if (blocked(text)) { add({ bot: true, name: "大笨bot", text: "這個我不能畫（涉及未成年人的不當內容）。" }); save(); return; }
    try {
      const hist = log.slice(-13, -1).map((x) => ({ name: x.name, text: x.text, bot: !!x.bot }));
      const r = await botGalleryChat(gid, u.uid, u.name, cat.name, text, hist);
      if (!r || !r.ok) { add({ bot: true, name: "大笨bot", text: "我現在連不上，等一下再說一次～" }); save(); return; }
      let reply = String(r.reply || "").slice(0, 900);
      const draws = Array.isArray(r.draws) ? r.draws.slice(0, 1) : [];
      for (const d of draws) {
        const j = enqueue(ws, jobOf(gid, cat, u, String(d.prompt || "").slice(0, 600), d, "bot"));
        if (j.error) reply += `\n（沒有排進去：${j.error}）`;
      }
      add({ bot: true, name: "大笨bot", text: reply || "嗯？" });
      save();
    } catch (e) {
      console.log("圖創區對話失敗：", e && e.message);
      add({ bot: true, name: "大笨bot", text: "我現在連不上，等一下再說一次～" }); save();
    }
    return;
  }
}

const err_text = (ws, text) => out(ws, { a: "err", error: "text", text });
function jobOf(gid, cat, u, prompt, m, via) {
  return {
    gid, cat: cat.id, uid: u.uid, name: u.name, prompt, via,
    shape: SIZES[m.shape] ? m.shape : "square",
    scale: BIG[m.scale] ? m.scale : "normal",
    quality: BIG[m.scale] ? "fast" : (MODELS[m.quality] ? m.quality : "fast"),     // 大尺寸只有快速畫質支援
    smart: via ? false : !!m.smart, lang: m.lang === "zh" ? "zh" : "en",
  };
}
