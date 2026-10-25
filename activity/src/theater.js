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
          <input class="tvseek" type="range" min="0" max="1000" value="0" step="1">
          <button class="tb play" title="播放／暫停">▶</button>
          <button class="tb skip" title="跳過這部">⏭</button>
          <button class="tb mute" title="靜音">🔊</button>
          <input class="tvvol" type="range" min="0" max="100" step="1" value="${lsGet("tvvol2", "60")}" title="音量 ${lsGet("tvvol2", "60")}%">
          <span class="tvtime">0:00 / 0:00</span>
          <select class="tvres" title="畫質（只影響自己）"><option value="720">720p</option></select>
          <select class="tvrate" title="播放速度（大家一起變）">${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => `<option value="${r}"${r === 1 ? " selected" : ""}>${r}x</option>`).join("")}</select>
          <select class="tvcc" title="字幕（只影響自己）"><option value="">字幕 關</option></select>
          ${env.inDiscord ? `<button class="tb ext" title="在瀏覽器開啟（可以真正全螢幕，一樣同步）">🌐</button>` : ""}
          <button class="tb full" title="全螢幕">⛶</button>
        </div>
        </div>
        <div class="tvnow"></div>
        <form class="tvadd"><input class="tvq" maxlength="300" placeholder="YouTube 網址，或直接打關鍵字搜尋" autocomplete="off"><button class="mb">加入清單</button></form>
        <div class="tvmsg"></div>
        <div class="tvqueue"></div>
        <div class="tvviewers"></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const video = $(".tv"), playBtn = $(".play"), seek = $(".tvseek"), timeEl = $(".tvtime"), nowEl = $(".tvnow"), msgEl = $(".tvmsg"),
      queueEl = $(".tvqueue"), viewersEl = $(".tvviewers"), unmute = $(".tvunmute"), loadEl = $(".tvload"), emptyEl = $(".tvempty"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, offset = 0, seeking = false, curSrc = "", curVid = "", blocked = false, timer = 0, startTimer = 0;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    // 畫質：預設 720p；選別的畫質時請伺服器準備，準備好才切過去（從同一秒接著播）
    const qReady = new Set();
    // 想要的畫質（預設 1080p）；影片沒有就自動往下選最高的
    let wantQ = Number(lsGet("tvres", "1080")) || 1080;
    const effQ = (c) => { const qs = (c.quals && c.quals.length ? c.quals : [720]).slice().sort((a, b) => a - b); return qs.filter((q) => q <= wantQ).pop() || qs[0]; };
    const mainOf = (c) => c.q || 720;                                  // 伺服器先下載的主要畫質
    const useQ = (c) => { const e = effQ(c); return e === mainOf(c) || !qReady.has(c.vid + "|" + e) ? mainOf(c) : e; };
    const fileOf = (vid, q) => (q === 720 ? `${vid}.mp4` : `${vid}.q${q}.mp4`);
    const srcOf = (c) => { const f = fileOf(c.vid, useQ(c)); return env.inDiscord ? `/.proxy/api/tv/${f}` : new URL(`api/tv/${f}`, location.href).pathname; };
    let qAsked = "";
    function askQual(c) {
      const e = effQ(c), k = c.vid + "|" + e;
      if (e === mainOf(c) || qReady.has(k) || qAsked === k) return;
      qAsked = k; send({ t: "tqual", vid: c.vid, q: e });
    }
    const volOf = (v) => Math.pow(Math.max(0, Math.min(100, Number(v) || 0)) / 100, 3);
    video.volume = volOf(lsGet("tvvol2", "60"));
    video.muted = lsGet("tvmute") === "1";
    $(".mute").textContent = video.muted ? "🔇" : "🔊";

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "tjoin", room: env.instanceId, name: lsGet("pokername") }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "tstate") { st = m; offset = Date.now() - m.now; st.recv = Date.now(); render(); sync(); }
        else if (m.t === "terr") { msgEl.textContent = "⚠️ " + m.error; msgEl.className = "tvmsg err"; }
        else if (m.t === "tqual") {
          if (m.status === "ready") { qReady.add(m.vid + "|" + m.q); if (st && st.cur && st.cur.vid === m.vid && m.q === effQ(st.cur)) { msgEl.textContent = ""; sync(); } }
          else if (m.status === "downloading") { msgEl.className = "tvmsg"; msgEl.textContent = `${m.q}p 準備中… ${m.pct || 0}%（先用 ${st && st.cur ? mainOf(st.cur) : 720}p 播）`; }
          else if (m.status === "error") { msgEl.className = "tvmsg err"; msgEl.textContent = `⚠️ ${m.q}p 下載失敗，維持 720p`; }
        }
        else if (m.t === "tinfo") { msgEl.textContent = m.msg; msgEl.className = "tvmsg"; }
      };
      ws.onclose = () => { if (closed) return; msgEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    // 伺服器上「現在應該播到哪」
    const target = () => { const c = st && st.cur; if (!c) return 0; return c.pos + (c.playing ? ((Date.now() - st.recv) / 1000) * (c.rate || 1) : 0); };

    function sync() {
      const c = st && st.cur;
      clearTimeout(startTimer);
      if (!c || c.status !== "ready") {
        if (!video.paused) video.pause();
        if (!c && curSrc) { video.removeAttribute("src"); video.load(); curSrc = ""; }
        return;
      }
      const src = srcOf(c);
      if (curSrc !== src) {
        const sameVid = curVid === c.vid;
        curSrc = src; curVid = c.vid; video.src = src; video.load();
        if (!sameVid) ccFor = "";                                      // 換畫質時字幕不用重抓
      }
      if (video.playbackRate !== (c.rate || 1)) video.playbackRate = c.rate || 1;
      setupCC(c); setupRes(c); askQual(c);
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

    // ---- 字幕（每個人自己選，記住偏好語言）
    let ccFor = "";
    const ccSel = $(".tvcc"), rateSel = $(".tvrate");
    const subSrc = (vid, lang) => (env.inDiscord ? `/.proxy/api/tv/sub/${vid}/${lang}.vtt` : new URL(`api/tv/sub/${vid}/${lang}.vtt`, location.href).pathname);
    let trackSeq = 0, blobUrl = "";
    async function setTrack(vid, lang) {
      const my = ++trackSeq;
      for (const t of [...video.querySelectorAll("track")]) t.remove();
      for (const tt of video.textTracks) tt.mode = "disabled";
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ""; }
      if (!lang) { msgEl.textContent = ""; return; }
      msgEl.className = "tvmsg"; msgEl.textContent = "字幕載入中…";
      // 伺服器還在下載或翻譯時回 202，過幾秒再問
      for (let k = 0; k < 120 && my === trackSeq; k++) {
        let r;
        try { r = await fetch(subSrc(vid, lang)); } catch { await new Promise((z) => setTimeout(z, 3000)); continue; }
        if (my !== trackSeq) return;
        if (r.status === 202) { msgEl.textContent = "字幕下載中…"; await new Promise((z) => setTimeout(z, 3000)); continue; }
        if (!r.ok) { msgEl.textContent = "⚠️ " + ((await r.text().catch(() => "")) || "這個字幕抓不到") ; msgEl.className = "tvmsg err"; return; }
        blobUrl = URL.createObjectURL(new Blob([await r.text()], { type: "text/vtt" }));
        const tr = document.createElement("track");
        tr.kind = "subtitles"; tr.srclang = "zh"; tr.label = lang; tr.src = blobUrl; tr.default = true;
        tr.addEventListener("load", () => { tr.track.mode = "showing"; });
        video.appendChild(tr);
        tr.track.mode = "showing";
        msgEl.textContent = "";
        return;
      }
    }
    function setupCC(c) {
      const sig = c.vid + "|" + (c.subs || []).map((x) => x.lang).join(",");
      if (ccFor === sig) return;
      ccFor = sig;
      const subs = c.subs || [];
      ccSel.innerHTML = `<option value="">${subs.length ? "字幕 關" : "沒有字幕"}</option>` + subs.map((x) => `<option value="${esc(x.lang)}">${esc(x.name)}</option>`).join("");
      const pref = lsGet("tvcc");
      const pick = pref ? subs.find((x) => x.lang === pref) || subs.find((x) => x.lang.split("-")[0] === pref.split("-")[0]) : null;
      ccSel.value = pick ? pick.lang : "";
      setTrack(c.vid, ccSel.value);
    }
    const resSel = $(".tvres");
    let resFor = "";
    function setupRes(c) {
      const sig = c.vid + "|" + (c.quals || []).join(",");
      if (resFor === sig) return;
      resFor = sig;
      const qs = c.quals && c.quals.length ? c.quals : [720];
      resSel.innerHTML = qs.map((q) => `<option value="${q}">${q}p${q === 720 ? "" : ""}</option>`).join("");
      resSel.value = String(effQ(c));
    }
    resSel.addEventListener("change", () => { wantQ = Number(resSel.value); lsSet("tvres", String(wantQ)); const c = st && st.cur; if (c) { if (effQ(c) === mainOf(c)) msgEl.textContent = ""; askQual(c); sync(); } });
    ccSel.addEventListener("change", () => { const c = st && st.cur; lsSet("tvcc", ccSel.value); if (c) setTrack(c.vid, ccSel.value); });
    rateSel.addEventListener("change", () => { if (st && st.cur) send({ t: "tspeed", rate: Number(rateSel.value) }); });
    const extBtn = $(".ext");
    if (extBtn) extBtn.addEventListener("click", () => {
      const url = `${import.meta.env.VITE_PUBLIC_URL || "https://mh.hy0936.com.tw/wordle/"}?room=${encodeURIComponent(env.instanceId)}&g=theater`;
      try { env.sdk.commands.openExternalLink({ url }); } catch { window.open(url, "_blank"); }
    });

    function render() {
      const c = st.cur;
      if (c && document.activeElement !== rateSel) rateSel.value = String(c.rate || 1);
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
    const volEl = $(".tvvol");
    const setVol = (v) => { v = Math.max(0, Math.min(100, Math.round(v))); volEl.value = v; volEl.title = `音量 ${v}%`; video.volume = volOf(v); lsSet("tvvol2", String(v)); if (video.muted && v > 0) $(".mute").click(); };
    volEl.addEventListener("input", () => setVol(volEl.value));
    // 滑鼠滾輪微調（每格 2%）
    volEl.addEventListener("wheel", (e) => { e.preventDefault(); setVol(Number(volEl.value) + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
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
    let clickT = 0;
    const wrapEl = $(".tvwrap");
    wrapEl.addEventListener("click", (e) => {
      if (e.target.closest(".tvunmute")) return;
      clearTimeout(clickT);
      if (e.detail > 1) return;
      clickT = setTimeout(() => playBtn.click(), 230);
    });
    wrapEl.addEventListener("dblclick", (e) => { if (e.target.closest(".tvunmute")) return; clearTimeout(clickT); isFs() ? exitFs() : enterFs(); });
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
