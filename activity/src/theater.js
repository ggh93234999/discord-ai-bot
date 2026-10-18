// 一起看影片：同一個 Activity 的人同步看 YouTube。影片由伺服器下載後從 /api/tv/<id>.mp4 播放，
// 播放、暫停、進度、播放清單都在伺服器（server/theater.js），這裡依伺服器時間校正，誤差超過 1 秒就跳過去。
import { wsUrl } from "./gomoku.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const lsGet = (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export function mountTheater() {
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots theater">
        <header><button class="back">← 選單</button><h2>一起看影片</h2><span class="watch"></span></header>
        <div class="tvstage">
        <div class="tvwrap">
          <video class="tv" playsinline preload="auto"></video>
          <div class="tvempty">貼上 YouTube 連結或打關鍵字，加入清單後大家會一起看</div>
          <button class="tvunmute" hidden>🔊 點一下開始播放<small>（瀏覽器規定要先按一下才能放聲音）</small></button>
          <div class="tvload" hidden></div>
        </div>
        <div class="tvbar">
          <button class="tb play" title="播放／暫停">▶</button>
          <span class="tvtime">0:00 / 0:00</span>
          <input class="tvseek" type="range" min="0" max="1000" value="0" step="1">
          <button class="tb skip" title="跳過這部">⏭</button>
          <button class="tb mute" title="靜音">🔊</button>
          <input class="tvvol" type="range" min="0" max="100" value="${lsGet("tvvol", "80")}">
          <button class="tb full" title="全螢幕">⛶</button>
        </div>
        </div>
        <div class="tvnow"></div>
        <form class="tvadd"><input class="tvq" maxlength="300" placeholder="YouTube 網址，或直接打關鍵字搜尋" autocomplete="off"><button class="mb">加入清單</button></form>
        <div class="tvmsg"></div>
        <div class="tvqueue"></div>
        <div class="tvviewers"></div>
        <div class="tvname">名稱 <input class="tvnm" maxlength="20" placeholder="你的名稱"></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const video = $(".tv"), playBtn = $(".play"), seek = $(".tvseek"), timeEl = $(".tvtime"), nowEl = $(".tvnow"), msgEl = $(".tvmsg"),
      queueEl = $(".tvqueue"), viewersEl = $(".tvviewers"), unmute = $(".tvunmute"), loadEl = $(".tvload"), emptyEl = $(".tvempty"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, offset = 0, seeking = false, curSrc = "", blocked = false, timer = 0, startTimer = 0;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    const srcOf = (vid) => (env.inDiscord ? `/.proxy/api/tv/${vid}.mp4` : new URL(`api/tv/${vid}.mp4`, location.href).pathname);
    video.volume = Number(lsGet("tvvol", "80")) / 100;
    video.muted = lsGet("tvmute") === "1";
    $(".mute").textContent = video.muted ? "🔇" : "🔊";
    const nm = $(".tvnm"); nm.value = lsGet("pokername");
    nm.addEventListener("change", () => { const v = nm.value.trim(); lsSet("pokername", v); if (v) send({ t: "tname", name: v }); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "tjoin", room: env.instanceId, name: lsGet("pokername") }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "tstate") { st = m; offset = Date.now() - m.now; st.recv = Date.now(); render(); sync(); }
        else if (m.t === "terr") { msgEl.textContent = "⚠️ " + m.error; msgEl.className = "tvmsg err"; }
        else if (m.t === "tinfo") { msgEl.textContent = m.msg; msgEl.className = "tvmsg"; }
      };
      ws.onclose = () => { if (closed) return; msgEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    // 伺服器上「現在應該播到哪」
    const target = () => { const c = st && st.cur; if (!c) return 0; return c.pos + (c.playing ? (Date.now() - st.recv) / 1000 : 0); };

    function sync() {
      const c = st && st.cur;
      clearTimeout(startTimer);
      if (!c || c.status !== "ready") {
        if (!video.paused) video.pause();
        if (!c && curSrc) { video.removeAttribute("src"); video.load(); curSrc = ""; }
        return;
      }
      const src = srcOf(c.vid);
      if (curSrc !== src) { curSrc = src; video.src = src; video.load(); }
      const go = () => {
        const tg = target();
        if (tg < 0) { if (!video.paused) video.pause(); video.currentTime = 0; startTimer = setTimeout(sync, -tg * 1000); return; }   // 還沒到開始時間
        if (video.readyState >= 1 && Math.abs(video.currentTime - tg) > 1.0) video.currentTime = Math.min(tg, (c.dur || tg) - 0.2);
        if (c.playing && video.paused) {
          video.play().then(() => { blocked = false; unmute.hidden = true; }).catch(() => { blocked = true; unmute.hidden = false; });
        } else if (!c.playing && !video.paused) video.pause();
      };
      if (video.readyState >= 1) go(); else video.addEventListener("loadedmetadata", go, { once: true });
    }
    unmute.addEventListener("click", () => { unmute.hidden = true; blocked = false; sync(); });
    video.addEventListener("waiting", () => { loadEl.hidden = false; loadEl.textContent = "緩衝中…"; });
    video.addEventListener("playing", () => { loadEl.hidden = true; });
    video.addEventListener("canplay", () => { loadEl.hidden = true; });

    function render() {
      const c = st.cur;
      watchEl.textContent = st.viewers.length ? `👥 ${st.viewers.length}` : "";
      emptyEl.hidden = !!c;
      if (c && c.status !== "ready") { loadEl.hidden = false; loadEl.textContent = c.status === "error" ? "下載失敗" : `伺服器下載中… ${c.pct || 0}%`; }
      else if (c && !video.paused) loadEl.hidden = true;
      if (!c) loadEl.hidden = true;
      nowEl.innerHTML = c ? `▶ <b>${esc(c.title)}</b><small>（${esc(c.by)} 點的）</small>` : (st.log ? `<small>${esc(st.log)}</small>` : "");
      playBtn.textContent = c && c.playing ? "⏸" : "▶";
      queueEl.innerHTML = st.queue.length ? `<div class="tvqh">接下來（${st.queue.length}）</div>` + st.queue.map((q, i) => `
        <div class="tvqi"><span class="n">${i + 1}</span><span class="tt">${esc(q.title)}<small>${fmt(q.dur)}・${esc(q.by)}${q.status === "downloading" ? `・下載 ${q.pct}%` : q.status === "ready" ? "・✅ 已就緒" : q.status === "error" ? "・❌ 失敗" : ""}</small></span>
        ${i ? `<button class="tb up" data-k="${q.key}" title="移到下一部">⤒</button>` : ""}<button class="tb rm" data-k="${q.key}" title="移除">✕</button></div>`).join("") : "";
      queueEl.querySelectorAll(".rm").forEach((b) => b.addEventListener("click", () => send({ t: "tremove", key: b.dataset.k })));
      queueEl.querySelectorAll(".up").forEach((b) => b.addEventListener("click", () => send({ t: "tup", key: b.dataset.k })));
      viewersEl.textContent = st.viewers.length ? "一起看的人：" + st.viewers.join("、") : "";
    }
    function tick() {
      const c = st && st.cur;
      const dur = c ? c.dur || video.duration || 0 : 0;
      const pos = c ? (c.status === "ready" && video.readyState >= 1 ? video.currentTime : Math.max(0, target())) : 0;
      timeEl.textContent = `${fmt(pos)} / ${fmt(dur)}`;
      if (!seeking) seek.value = dur ? Math.round((pos / dur) * 1000) : 0;
      // 播放中定時檢查誤差（伺服器 5 秒推一次，這裡每秒自己算）
      if (c && c.playing && c.status === "ready" && !video.paused && video.readyState >= 2 && target() > 0 && Math.abs(video.currentTime - target()) > 1.5) video.currentTime = target();
    }
    playBtn.addEventListener("click", () => { const c = st && st.cur; if (!c) return; if (blocked) { unmute.click(); } send({ t: c.playing ? "tpause" : "tplay" }); });
    $(".skip").addEventListener("click", () => { if (st && st.cur) send({ t: "tskip" }); });
    seek.addEventListener("input", () => { seeking = true; });
    seek.addEventListener("change", () => { seeking = false; const c = st && st.cur; if (c && c.dur) send({ t: "tseek", pos: (Number(seek.value) / 1000) * c.dur }); });
    $(".mute").addEventListener("click", () => { video.muted = !video.muted; lsSet("tvmute", video.muted ? "1" : "0"); $(".mute").textContent = video.muted ? "🔇" : "🔊"; });
    $(".tvvol").addEventListener("input", (e) => { video.volume = Number(e.target.value) / 100; lsSet("tvvol", e.target.value); if (video.muted && video.volume > 0) $(".mute").click(); });
    // 全螢幕：先試瀏覽器原生全螢幕；Discord 內嵌畫面常常不允許，就改用「把影片鋪滿整個活動視窗」，
    // 再搭配 Discord 自己的活動全螢幕／彈出視窗按鈕，就是真正的全螢幕。
    const stage = $(".tvstage"), fullBtn = $(".full");
    let idleT = 0;
    const isFs = () => stage.classList.contains("fs");
    const showBar = () => { stage.classList.remove("idle"); clearTimeout(idleT); if (isFs()) idleT = setTimeout(() => stage.classList.add("idle"), 2500); };
    function enterFs() {
      stage.classList.add("fs"); document.body.classList.add("tv-fs"); fullBtn.textContent = "🗗"; fullBtn.title = "離開全螢幕"; showBar();
      const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (req && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) { try { const p = req.call(stage); if (p && p.catch) p.catch(() => {}); } catch {} }
    }
    function exitFs() {
      stage.classList.remove("fs", "idle"); document.body.classList.remove("tv-fs"); fullBtn.textContent = "⛶"; fullBtn.title = "全螢幕"; clearTimeout(idleT);
      if (document.fullscreenElement || document.webkitFullscreenElement) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {} }
    }
    fullBtn.addEventListener("click", () => (isFs() ? exitFs() : enterFs()));
    video.addEventListener("dblclick", () => (isFs() ? exitFs() : enterFs()));
    stage.addEventListener("mousemove", showBar);
    stage.addEventListener("touchstart", showBar, { passive: true });
    const onFsChange = () => { if (!(document.fullscreenElement || document.webkitFullscreenElement) && isFs() && stage.dataset.native === "1") exitFs(); stage.dataset.native = document.fullscreenElement ? "1" : ""; };
    document.addEventListener("fullscreenchange", onFsChange);
    const onKey = (e) => { if (e.key === "Escape" && isFs()) exitFs(); };
    document.addEventListener("keydown", onKey);
    $(".tvadd").addEventListener("submit", (e) => { e.preventDefault(); const q = $(".tvq").value.trim(); if (!q) return; send({ t: "tadd", q }); $(".tvq").value = ""; msgEl.className = "tvmsg"; });
    function cleanup() { document.removeEventListener("fullscreenchange", onFsChange); document.removeEventListener("keydown", onKey); document.body.classList.remove("tv-fs"); closed = true; clearInterval(timer); clearTimeout(startTimer); try { video.pause(); video.removeAttribute("src"); video.load(); } catch {} try { ws && ws.close(); } catch {} }
    $(".back").addEventListener("click", () => { cleanup(); back(); });
    timer = setInterval(tick, 500);
    connect();
    return cleanup;
  };
}
