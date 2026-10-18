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
const FORMAT = "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b";
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
const files = (vid) => path.join(DIR, vid + ".mp4");
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
async function lookup(target) {
  const txt = await run(["-J", "--no-playlist", "--flat-playlist", target.url]);
  let j = JSON.parse(txt);
  if (j._type === "playlist") j = (j.entries || [])[0];
  if (!j || !j.id) throw new Error("找不到影片");
  if (j.is_live || j.live_status === "is_live" || j.live_status === "is_upcoming") throw new Error("直播或還沒開始的影片不能播");
  let dur = Number(j.duration) || 0;
  let title = j.title || j.id;
  if (!dur && target.search) {                                         // 搜尋結果只有簡略資訊，再查一次
    const d = JSON.parse(await run(["-J", "--no-playlist", "https://www.youtube.com/watch?v=" + j.id]));
    dur = Number(d.duration) || 0; title = d.title || title;
  }
  if (dur > MAX_DUR) throw new Error(`影片太長（上限 ${MAX_DUR / 3600} 小時）`);
  meta.set(j.id, { title, dur });
  return { vid: j.id, title, dur };
}
function download(vid) {
  if (fs.existsSync(files(vid))) { touch(vid); return; }
  if (jobs.has(vid) && jobs.get(vid).status === "downloading") return;
  const job = { status: "downloading", pct: 0, phase: 0, lastP: 0, err: "" };
  jobs.set(vid, job);
  const tmp = path.join(DIR, vid + ".part.%(ext)s");
  let lastPush = 0;
  run(["-f", FORMAT, "--merge-output-format", "mp4", "--no-playlist", "--newline", "--no-part",
       "--postprocessor-args", "ffmpeg:-movflags +faststart", "-o", tmp, "https://www.youtube.com/watch?v=" + vid], (line) => {
    const m = line.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      const p = Number(m[1]);
      if (p < job.lastP - 50) job.phase++;                              // 影像下載完換聲音
      job.lastP = p;
      job.pct = Math.min(99, job.phase ? 90 + p / 10 : p * 0.9);
      if (Date.now() - lastPush > 1000) { lastPush = Date.now(); pushVid(vid); }
    } else if (/Merger|Fixup|ffmpeg/i.test(line)) { job.pct = 99; pushVid(vid); }
  }).then(() => {
    const done = fs.existsSync(path.join(DIR, vid + ".part.mp4")) ? vid + ".part.mp4" : fs.readdirSync(DIR).find((f) => f.startsWith(vid + ".part.") && f.endsWith(".mp4"));
    if (!done) throw new Error("下載完成但找不到檔案");
    fs.renameSync(path.join(DIR, done), files(vid));
    for (const f of fs.readdirSync(DIR)) if (f.startsWith(vid + ".part.")) try { fs.unlinkSync(path.join(DIR, f)); } catch {}
    job.status = "ready"; job.pct = 100;
    cleanCache();
    pushVid(vid);
  }).catch((e) => {
    job.status = "error"; job.err = String(e.message || e).slice(0, 120);
    for (const f of fs.readdirSync(DIR)) if (f.startsWith(vid + ".part.")) try { fs.unlinkSync(path.join(DIR, f)); } catch {}
    console.log("影片下載失敗", vid, job.err);
    pushVid(vid);
  });
}
const statusOf = (vid) => { if (fs.existsSync(files(vid))) return { status: "ready", pct: 100 }; const j = jobs.get(vid); return j ? { status: j.status, pct: Math.round(j.pct), err: j.err } : { status: "queued", pct: 0 }; };
function touch(vid) { const f = files(vid); try { const t = new Date(); fs.utimesSync(f, t, t); } catch {} }
function cleanCache() {
  const inUse = new Set();
  for (const r of rooms.values()) { if (r.cur) inUse.add(r.cur.vid); for (const q of r.queue) inUse.add(q.vid); }
  const list = fs.readdirSync(DIR).filter((f) => /^[A-Za-z0-9_-]{11}\.mp4$/.test(f)).map((f) => { const st = fs.statSync(path.join(DIR, f)); return { f, size: st.size, t: st.mtimeMs }; });
  let total = list.reduce((s, x) => s + x.size, 0);
  for (const x of list.sort((a, b) => a.t - b.t)) {
    if (total <= MAX_CACHE) break;
    if (inUse.has(x.f.slice(0, 11))) continue;
    try { fs.unlinkSync(path.join(DIR, x.f)); total -= x.size; } catch {}
  }
}

// ---------------------------------------------------------------- 房間狀態
const posOf = (cur) => (cur ? Math.min(cur.dur || Infinity, cur.pos + (cur.playing ? (Date.now() - cur.at) / 1000 : 0)) : 0);
function view(r) {
  const c = r.cur;
  return {
    t: "tstate", now: Date.now(), log: r.log,
    cur: c ? { key: c.key, vid: c.vid, title: c.title, dur: c.dur, by: c.by, playing: c.playing, pos: posOf(c), ...statusOf(c.vid) } : null,
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
    r.cur = { ...q, playing: false, pos: 0, at: Date.now(), waitReady: true };
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
  } else if (m.t === "tskip" && c) { r.log = `${who} 跳過《${c.title}》`; r.cur = null; advance(r); }
  else if (m.t === "tremove") { const k = r.queue.findIndex((q) => q.key === m.key); if (k >= 0) { r.log = `${who} 移除《${r.queue[k].title}》`; r.queue.splice(k, 1); } }
  else if (m.t === "tup") { const k = r.queue.findIndex((q) => q.key === m.key); if (k > 0) { const [x] = r.queue.splice(k, 1); r.queue.unshift(x); r.log = `${who} 把《${x.title}》移到下一部`; download(x.vid); } }
  else return true;
  push(r);
  return true;
}

// ---------------------------------------------------------------- 影片檔（/api/tv/<id>.mp4，支援 Range）
export function serveVideo(req, res) {
  const m = new URL(req.url, "http://x").pathname.match(/^\/api\/tv\/([A-Za-z0-9_-]{11})\.mp4$/);
  if (!m) return false;
  const f = files(m[1]);
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
  touch(m[1]);
  return true;
}
