// 一起看影片：同一個 Activity 房間的人同步看 YouTube 影片。
// 伺服器用 yt-dlp 把影片下載成 720p H.264 mp4 放在 video_cache/，再從 /api/tv/<id>.mp4 串流（支援 Range，可以拖進度）；
// 播放清單、播放／暫停／進度由伺服器統一管理，前端依伺服器時間校正，大家看到同一個畫面。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("./video_cache/", import.meta.url));
fs.mkdirSync(DIR, { recursive: true });
const YTDLP = process.env.YTDLP || "/home/ggh93234999/.venvs/discord-bot/bin/yt-dlp";
const MAX_DUR = 3 * 3600;                 // 最長 3 小時
const MAX_CACHE = 30 * 1024 ** 3;         // 快取上限 30 GB，超過就刪最久沒看的
const MAX_QUEUE = 30;
// 預設 720p（房間共用、大家先拿這個）；有人選別的畫質時才另外下載那個版本。都用 H.264（avc1），各平台都能播
const QUALS = [360, 480, 720, 1080];
const formatOf = (q) => `bv*[height<=${q}][vcodec^=avc1]+ba[ext=m4a]/b[height<=${q}][ext=mp4]/bv*[height<=${q}]+ba/b`;
const keyOf = (vid, q = 720) => (q === 720 ? vid : `${vid}.q${q}`);
const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
const nameOf = (ws) => ws.tname || ws.user?.name || "觀眾";
const VID_RE = /^[A-Za-z0-9_-]{11}$/;

const rooms = new Map();
function roomOf(id) {
  if (!rooms.has(id)) rooms.set(id, { id, members: new Set(), queue: [], cur: null, log: "", emptyAt: 0 });
  return rooms.get(id);
}

// ---------------------------------------------------------------- 影片資訊與下載
const files = (vid, q = 720) => path.join(DIR, keyOf(vid, q) + ".mp4");
const qWatch = new Map();                  // 「vid.q畫質」→ 等這個畫質的連線
function notifyQual(vid, q) {
  const set = qWatch.get(keyOf(vid, q)); if (!set) return;
  const st = statusOf(vid, q);
  for (const ws of set) out(ws, { t: "tqual", vid, q, ...st });
  if (st.status !== "downloading") qWatch.delete(keyOf(vid, q));
}
const meta = new Map();                    // vid → { title, dur }
const jobs = new Map();                    // vid → { status, pct, err, waiters:Set<room> }

function run(args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, ["--js-runtimes", "node", "--no-warnings", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let outBuf = "", errBuf = "";
    p.stdout.on("data", (d) => { outBuf += d; if (onLine) for (const l of String(d).split(/\r|\n/)) if (l.trim()) onLine(l); });
    p.stderr.on("data", (d) => { errBuf += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(outBuf) : reject(new Error((errBuf.split("\n").filter((l) => l.includes("ERROR")).pop() || errBuf.slice(-200) || `yt-dlp 結束碼 ${code}`).replace(/^ERROR:\s*/, "")))));
  });
}
function parseTarget(s) {
  s = String(s || "").trim().slice(0, 300);
  if (!s) return null;
  if (VID_RE.test(s)) return { url: "https://www.youtube.com/watch?v=" + s };
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return { url: "https://www.youtube.com/watch?v=" + m[1] };
  if (/^https?:\/\//i.test(s)) return null;                             // 其他網站先不支援
  return { url: "ytsearch1:" + s, search: true };
}
// 從 yt-dlp 的資訊挑出可用字幕：人工字幕全收（最多 10 種），自動字幕只收原語言那一份
const LANG_ZH = { "zh-Hant": "中文（繁體）", "zh-TW": "中文（台灣）", "zh-HK": "中文（香港）", "zh-Hans": "中文（簡體）", "zh-CN": "中文（中國）", zh: "中文",
  en: "英文", "en-US": "英文（美國）", "en-GB": "英文（英國）", ja: "日文", ko: "韓文", es: "西班牙文", "es-419": "西班牙文（拉美）", fr: "法文", de: "德文", "de-DE": "德文",
  "pt-BR": "葡萄牙文（巴西）", th: "泰文", vi: "越南文", id: "印尼文", ru: "俄文" };
const langName = (k) => LANG_ZH[k] || LANG_ZH[k.split("-")[0]] || k;
function pickSubs(j) {
  const out = [];
  for (const k of Object.keys(j.subtitles || {}).filter((k) => k !== "live_chat").slice(0, 10)) out.push({ lang: k, name: langName(k), auto: false });
  const a = j.automatic_captions || {};
  const orig = Object.keys(a).find((k) => k.endsWith("-orig"));
  if (orig) out.push({ lang: orig, name: langName(orig.replace(/-orig$/, "")) + "（自動產生）", auto: true });
  // 只用 YouTube 影片本身的字幕：上傳者提供的字幕＋YouTube 依原語言自動產生的字幕；不用 YouTube 的「自動翻譯」（常被限流 429）
  return out;
}
function qualsOf(j) {
  const hs = (j.formats || []).filter((f) => /^avc1/.test(f.vcodec || "") && f.height).map((f) => f.height);
  const max = hs.length ? Math.max(...hs) : 720;
  const q = QUALS.filter((h) => h <= Math.max(max, 360));
  return q.length ? q : [720];
}
async function lookup(target) {
  const txt = await run(["-J", "--no-playlist", "--flat-playlist", target.url]);
  let j = JSON.parse(txt);
  if (j._type === "playlist") j = (j.entries || [])[0];
  if (!j || !j.id) throw new Error("找不到影片");
  if (j.is_live || j.live_status === "is_live" || j.live_status === "is_upcoming") throw new Error("直播或還沒開始的影片不能播");
  let dur = Number(j.duration) || 0;
  let title = j.title || j.id;
  let subs = pickSubs(j);
  let j2 = null;
  if (target.search) {                                                  // 搜尋結果只有簡略資訊，再查一次
    const d = JSON.parse(await run(["-J", "--no-playlist", "https://www.youtube.com/watch?v=" + j.id]));
    j2 = d;
    dur = Number(d.duration) || dur; title = d.title || title; subs = pickSubs(d);
  }
  if (dur > MAX_DUR) throw new Error(`影片太長（上限 ${MAX_DUR / 3600} 小時）`);
  const quals = qualsOf(target.search ? j2 || j : j);
  meta.set(j.id, { title, dur, subs, quals });
  return { vid: j.id, title, dur, subs, quals };
}
function download(vid, q = 720) {
  const key = keyOf(vid, q);
  if (fs.existsSync(files(vid, q))) { touch(vid, q); return; }
  if (jobs.has(key) && jobs.get(key).status === "downloading") return;
  const job = { status: "downloading", pct: 0, phase: 0, lastP: 0, err: "" };
  jobs.set(key, job);
  const tmp = path.join(DIR, key + ".part.%(ext)s");
  const notify = (v) => (q === 720 ? pushVid(v) : notifyQual(v, q));   // 720p 通知整個房間，其他畫質只通知要的人
  let lastPush = 0;
  run(["-f", formatOf(q), "--merge-output-format", "mp4", "--no-playlist", "--newline", "--no-part",
       "--postprocessor-args", "ffmpeg:-movflags +faststart", "-o", tmp, "https://www.youtube.com/watch?v=" + vid], (line) => {
    const m = line.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      const p = Number(m[1]);
      if (p < job.lastP - 50) job.phase++;                              // 影像下載完換聲音
      job.lastP = p;
      job.pct = Math.min(99, job.phase ? 90 + p / 10 : p * 0.9);
      if (Date.now() - lastPush > 1000) { lastPush = Date.now(); notify(vid); }
    } else if (/Merger|Fixup|ffmpeg/i.test(line)) { job.pct = 99; notify(vid); }
  }).then(() => {
    const done = fs.existsSync(path.join(DIR, key + ".part.mp4")) ? key + ".part.mp4" : fs.readdirSync(DIR).find((f) => f.startsWith(key + ".part.") && f.endsWith(".mp4"));
    if (!done) throw new Error("下載完成但找不到檔案");
    fs.renameSync(path.join(DIR, done), files(vid, q));
    for (const f of fs.readdirSync(DIR)) if (f.startsWith(key + ".part.")) try { fs.unlinkSync(path.join(DIR, f)); } catch {}
    job.status = "ready"; job.pct = 100;
    cleanCache();
    notify(vid);
  }).catch((e) => {
    job.status = "error"; job.err = String(e.message || e).slice(0, 120);
    for (const f of fs.readdirSync(DIR)) if (f.startsWith(key + ".part.")) try { fs.unlinkSync(path.join(DIR, f)); } catch {}
    console.log("影片下載失敗", key, job.err);
    notify(vid);
  });
}
const statusOf = (vid, q = 720) => { if (fs.existsSync(files(vid, q))) return { status: "ready", pct: 100 }; const j = jobs.get(keyOf(vid, q)); return j ? { status: j.status, pct: Math.round(j.pct), err: j.err } : { status: "queued", pct: 0 }; };
function touch(vid, q = 720) { const f = files(vid, q); try { const t = new Date(); fs.utimesSync(f, t, t); } catch {} }
function cleanCache() {
  const inUse = new Set();
  for (const r of rooms.values()) { if (r.cur) inUse.add(r.cur.vid); for (const q of r.queue) inUse.add(q.vid); }
  for (const f of fs.readdirSync(DIR)) if (f.endsWith(".vtt") && !fs.existsSync(path.join(DIR, f.slice(0, 11) + ".mp4")) && !inUse.has(f.slice(0, 11))) try { fs.unlinkSync(path.join(DIR, f)); } catch {}
  const list = fs.readdirSync(DIR).filter((f) => /^[A-Za-z0-9_-]{11}(\.q\d{3,4})?\.mp4$/.test(f)).map((f) => { const st = fs.statSync(path.join(DIR, f)); return { f, size: st.size, t: st.mtimeMs }; });
  let total = list.reduce((s, x) => s + x.size, 0);
  for (const x of list.sort((a, b) => a.t - b.t)) {
    if (total <= MAX_CACHE) break;
    if (inUse.has(x.f.slice(0, 11))) continue;
    try { fs.unlinkSync(path.join(DIR, x.f)); total -= x.size; } catch {}
  }
}

// ---------------------------------------------------------------- 房間狀態
const posOf = (cur) => (cur ? Math.min(cur.dur || Infinity, cur.pos + (cur.playing ? ((Date.now() - cur.at) / 1000) * (cur.rate || 1) : 0)) : 0);
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
function view(r) {
  const c = r.cur;
  return {
    t: "tstate", now: Date.now(), log: r.log,
    cur: c ? { key: c.key, vid: c.vid, title: c.title, dur: c.dur, by: c.by, playing: c.playing, pos: posOf(c), rate: c.rate || 1, subs: c.subs || [], quals: c.quals || [720], ...statusOf(c.vid) } : null,
    queue: r.queue.map((q) => ({ key: q.key, vid: q.vid, title: q.title, dur: q.dur, by: q.by, ...statusOf(q.vid) })),
    viewers: [...r.members].map(nameOf),
  };
}
function push(r) { const v = view(r); for (const ws of r.members) out(ws, v); }
function pushVid(vid) { for (const r of rooms.values()) if ((r.cur && r.cur.vid === vid) || r.queue.some((q) => q.vid === vid)) { advance(r); push(r); } }
// 換下一部：目前沒有影片、或目前這部看完了，就把清單第一部（下載好的）拿出來播
function advance(r) {
  if (r.cur && r.cur.playing && posOf(r.cur) >= r.cur.dur - 0.5 && r.cur.dur) { r.log = `《${r.cur.title}》播完了`; r.cur = null; }
  if (!r.cur && r.queue.length) {
    const q = r.queue.shift();
    r.cur = { ...q, playing: false, pos: 0, at: Date.now(), rate: 1, waitReady: true };
    download(q.vid);
  }
  if (r.cur && r.cur.waitReady && statusOf(r.cur.vid).status === "ready") {   // 下載好了才開始播
    r.cur.waitReady = false; r.cur.playing = true; r.cur.pos = 0; r.cur.at = Date.now() + 1500;   // 留 1.5 秒讓大家載入
    r.log = `開始播放《${r.cur.title}》`;
  }
  if (r.cur && statusOf(r.cur.vid).status === "error") { r.log = `《${r.cur.title}》下載失敗：${statusOf(r.cur.vid).err}`; r.cur = null; advance(r); }
  // 清單裡接下來兩部先下載
  for (const q of r.queue.slice(0, 2)) download(q.vid);
}
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (!r.members.size) { if (!r.emptyAt) r.emptyAt = now; if (now - r.emptyAt > 30 * 60000) rooms.delete(id); continue; }
    r.emptyAt = 0;
    const before = r.cur;
    advance(r);
    if (r.cur !== before) push(r);
  }
}, 1000).unref();
setInterval(() => { for (const r of rooms.values()) if (r.cur && r.cur.playing) push(r); }, 5000).unref();   // 定期校正

// ---------------------------------------------------------------- 連線
export function theaterClose(ws) {
  const r = ws.troom; if (!r) return;
  r.members.delete(ws); ws.troom = null; push(r);
}
export async function handleTheater(ws, m) {
  if (m.t === "tjoin") {
    if (ws.troom) theaterClose(ws);
    const r = roomOf(String(m.room || "default").slice(0, 80));
    if (cleanName(m.name)) ws.tname = cleanName(m.name);
    ws.troom = r; r.members.add(ws); push(r); return true;
  }
  const r = ws.troom; if (!r) return true;
  const who = nameOf(ws);
  if (m.t === "tqual") {
    const q = Number(m.q), vid = String(m.vid || "");
    if (!QUALS.includes(q) || !VID_RE.test(vid) || !(r.cur && r.cur.vid === vid)) return true;
    const st = statusOf(vid, q);
    if (st.status === "ready") return out(ws, { t: "tqual", vid, q, ...st }), true;
    if (!qWatch.has(keyOf(vid, q))) qWatch.set(keyOf(vid, q), new Set());
    qWatch.get(keyOf(vid, q)).add(ws);
    download(vid, q);
    out(ws, { t: "tqual", vid, q, ...statusOf(vid, q) });
    return true;
  }
  if (m.t === "tname") { const n = cleanName(m.name); if (n) { ws.tname = n; push(r); } return true; }
  if (m.t === "tadd") {
    if (r.queue.length >= MAX_QUEUE) return out(ws, { t: "terr", error: "清單滿了" }), true;
    const target = parseTarget(m.q);
    if (!target) return out(ws, { t: "terr", error: "看不懂這個網址，請貼 YouTube 影片連結或打關鍵字" }), true;
    if (ws.tbusy) return true;
    ws.tbusy = true; out(ws, { t: "tinfo", msg: "查詢影片中…" });
    try {
      const info = await lookup(target);
      r.queue.push({ key: randomBytes(4).toString("hex"), ...info, by: who });
      r.log = `${who} 加入《${info.title}》`;
      download(info.vid);
      advance(r); push(r);
      out(ws, { t: "tinfo", msg: "" });
    } catch (e) { out(ws, { t: "terr", error: String(e.message || e).slice(0, 120) }); }
    finally { ws.tbusy = false; }
    return true;
  }
  const c = r.cur;
  if (m.t === "tplay" && c && !c.waitReady) { if (!c.playing) { c.pos = Math.max(0, posOf(c)); c.at = Date.now(); c.playing = true; r.log = `${who} 按了播放`; } }
  else if (m.t === "tpause" && c && !c.waitReady) { if (c.playing) { c.pos = Math.max(0, posOf(c)); c.at = Date.now(); c.playing = false; r.log = `${who} 按了暫停`; } }
  else if (m.t === "tseek" && c && !c.waitReady) {
    const p = Number(m.pos);
    if (!Number.isFinite(p)) return true;
    c.pos = Math.max(0, Math.min(c.dur || p, p)); c.at = Date.now();
    r.log = `${who} 跳到 ${Math.floor(c.pos / 60)}:${String(Math.floor(c.pos % 60)).padStart(2, "0")}`;
  } else if (m.t === "tspeed" && c) {
    const v = Number(m.rate); if (!RATES.includes(v)) return true;
    c.pos = Math.max(0, posOf(c)); c.at = Date.now(); c.rate = v; r.log = `${who} 把速度調成 ${v} 倍`;
  } else if (m.t === "tskip" && c) { r.log = `${who} 跳過《${c.title}》`; r.cur = null; advance(r); }
  else if (m.t === "tremove") { const k = r.queue.findIndex((q) => q.key === m.key); if (k >= 0) { r.log = `${who} 移除《${r.queue[k].title}》`; r.queue.splice(k, 1); } }
  else if (m.t === "tup") { const k = r.queue.findIndex((q) => q.key === m.key); if (k > 0) { const [x] = r.queue.splice(k, 1); r.queue.unshift(x); r.log = `${who} 把《${x.title}》移到下一部`; download(x.vid); } }
  else return true;
  push(r);
  return true;
}

// ---------------------------------------------------------------- 字幕檔（/api/tv/sub/<id>/<語言>.vtt，第一次要時才下載）
const subJobs = new Map();
function fetchSub(vid, lang) {
  const f = path.join(DIR, `${vid}.${lang}.vtt`);
  if (fs.existsSync(f)) return Promise.resolve(f);
  const k = vid + "|" + lang;
  if (!subJobs.has(k)) {
    const auto = !(meta.get(vid)?.subs || []).some((x) => x.lang === lang && !x.auto);
    const p = run(["--skip-download", auto ? "--write-auto-subs" : "--write-subs", "--sub-langs", lang, "--sub-format", "vtt", "--no-playlist",
                   "-o", path.join(DIR, vid), "https://www.youtube.com/watch?v=" + vid])
      .then(() => {
        if (!fs.existsSync(f)) throw new Error("沒有這個字幕");
        if (/^zh-(Hans|CN)$/.test(lang)) return toTraditional(f).then(() => f);   // 簡體字幕轉成繁體
        return f;
      })
      .finally(() => setTimeout(() => subJobs.delete(k), 60000));
    p.catch(() => {});
    subJobs.set(k, p);
  }
  return subJobs.get(k);
}
function toTraditional(f) {
  const py = process.env.OPENCC_PYTHON || "/home/ggh93234999/.venvs/discord-bot/bin/python";
  return new Promise((resolve) => {
    const p = spawn(py, ["-c", "import sys,opencc;p=sys.argv[1];t=open(p,encoding='utf-8').read();open(p,'w',encoding='utf-8').write(opencc.OpenCC('s2tw').convert(t))", f]);
    p.on("close", () => resolve()); p.on("error", () => resolve());
  });
}
export async function serveSub(req, res) {
  const m = new URL(req.url, "http://x").pathname.match(/^\/api\/tv\/sub\/([A-Za-z0-9_-]{11})\/([A-Za-z0-9-]{1,20})\.vtt$/);
  if (!m) return false;
  try {
    const job = fetchSub(m[1], m[2]);
    const f = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), 8000))]);
    if (!f) {                                                           // 還在下載／翻譯：回 202，前端過幾秒再問
      res.writeHead(202, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ working: true }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-cache" });
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end(String(e.message || e).slice(0, 100)); }
  return true;
}

// ---------------------------------------------------------------- 影片檔（/api/tv/<id>.mp4，支援 Range）
export function serveVideo(req, res) {
  const m = new URL(req.url, "http://x").pathname.match(/^\/api\/tv\/([A-Za-z0-9_-]{11})(?:\.q(\d{3,4}))?\.mp4$/);
  if (!m) return false;
  const q = m[2] ? Number(m[2]) : 720;
  if (!QUALS.includes(q)) { res.writeHead(404); res.end(); return true; }
  const f = files(m[1], q);
  let st;
  try { st = fs.statSync(f); } catch { res.writeHead(404); res.end(); return true; }
  const size = st.size, range = req.headers.range;
  const head = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" };
  if (range) {
    const mm = range.match(/bytes=(\d*)-(\d*)/);
    let start = mm && mm[1] ? Number(mm[1]) : 0, end = mm && mm[2] ? Number(mm[2]) : size - 1;
    if (mm && !mm[1] && mm[2]) { start = size - Number(mm[2]); end = size - 1; }
    if (start >= size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return true; }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end(), true;
    fs.createReadStream(f, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...head, "Content-Length": size });
    if (req.method === "HEAD") return res.end(), true;
    fs.createReadStream(f).pipe(res);
  }
  touch(m[1], q);
  return true;
}
