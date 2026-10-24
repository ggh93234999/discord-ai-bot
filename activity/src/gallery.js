// 圖創區：大家用 AI 畫圖、分類收在這個頁面裡（不會傳到 Discord）。每個 Discord 伺服器各一份，同一個伺服器不同頻道開的 Activity 看到的是同一份。
// 要先用 Discord 登入（伺服器端會確認你在這個伺服器裡）。畫圖、聊天、分類、圖庫都由伺服器處理，這裡只畫畫面和送指令。
import { wsUrl } from "./gomoku.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const p2 = (n) => String(n).padStart(2, "0");
function when(ts) {
  const d = new Date(ts), n = new Date(), hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
const ERR = {
  need_login: "要先用 Discord 登入", relogin: "登入資料過期了，請重新登入", not_member: "你不在這個伺服器裡，不能用這裡的圖創區", bad_guild: "找不到這個伺服器（要在伺服器的頻道裡開啟 Activity）",
  not_joined: "還沒進到圖創區，請重新整理", bad_cat: "找不到這個分類", bad_name: "分類名字不能空白", max_cats: "分類已經滿了（最多 24 個）", dup_cat: "已經有同名的分類",
  cat_not_empty: "這個分類裡還有圖，不能刪", last_cat: "至少要留一個分類", not_yours: "只能刪自己畫的圖", empty: "先寫要畫什麼",
  blocked: "這個我不能畫（涉及未成年人的不當內容）", slow_down: "說慢一點，等幾秒再送",
};
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

export function mountGallery(root, { env, back }) {
  root.innerHTML = `
    <div class="game gl">
      <header><button class="back">← 選單</button><h2>🎨 圖創區</h2><span></span></header>
      <div class="gl-status"></div>
      <div class="gl-login" hidden></div>
      <div class="gl-main" hidden>
        <div class="gl-cats"></div>
        <div class="gl-tabs"><button data-t="lib" class="on">🖼️ 圖庫</button><button data-t="new">✏️ 畫圖</button><button data-t="chat">💬 大笨bot</button></div>
        <div class="gl-queue"></div>
        <div class="gl-pane" data-p="lib"></div>
        <div class="gl-pane" data-p="new" hidden></div>
        <div class="gl-pane" data-p="chat" hidden></div>
      </div>
      <div class="gl-box" hidden></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const statusEl = $(".gl-status"), loginEl = $(".gl-login"), mainEl = $(".gl-main"), catsEl = $(".gl-cats"), queueEl = $(".gl-queue"), boxEl = $(".gl-box");
  const panes = { lib: $('[data-p="lib"]'), new: $('[data-p="new"]'), chat: $('[data-p="chat"]') };
  $(".back").addEventListener("click", () => { destroy(); back(); });

  let ws = null, closed = false, retry = 0, session = env.session || null, wantLogin = false;
  let me = null, cats = [], cat = null, imgs = [], more = false, chat = [], tab = "lib", queue = { jobs: [], total: 0 }, joined = false;
  const gidOf = () => (env.guildId ? String(env.guildId) : "");
  const imgUrl = (x, thumb) => { const f = `${x.id}${thumb ? "_t.jpg" : "." + x.ext}`; const p = `api/gallery/img/${gidOf()}/${f}`; return env.inDiscord ? `/.proxy/${p}` : new URL(p, location.href).pathname; };
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "gl", ...o }));
  const say = (t) => { statusEl.textContent = t; };

  // ---- 連線與登入
  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; if (session) ws.send(JSON.stringify({ t: "bauth", token: session.token })); else showLogin(); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "bauthed") return onAuthed(m);
      if (m.t === "gl") onGl(m);
    };
    ws.onclose = () => { joined = false; if (!closed) { say("連線中斷，重新連線…"); setTimeout(connect, Math.min(5000, 700 * ++retry)); } };
    ws.onerror = () => {};
  }
  function showLogin(msg) {
    mainEl.hidden = true; loginEl.hidden = false;
    const ok = env.inDiscord && env.sdk && gidOf();
    loginEl.innerHTML = ok
      ? `<p>${esc(msg || "圖創區是這個伺服器的成員一起用的畫圖空間。要先用 Discord 登入，讓伺服器確認你在這個伺服器裡。")}</p><button class="gl-go">用 Discord 登入</button>`
      : `<p>圖創區要在 Discord 的伺服器頻道裡開啟這個 Activity 才能用（要確認你的 Discord 身分和所在的伺服器）。</p>`;
    const b = loginEl.querySelector(".gl-go"); if (b) b.addEventListener("click", login);
    say("");
  }
  async function login() {
    try {
      if (!session) {
        say("請在 Discord 跳出的視窗按「授權」…");
        await env.sdk.ready();
        const { code } = await env.sdk.commands.authorize({ client_id: env.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"] });
        say("確認身分中…");
        const r = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 403) { say("你不是這個伺服器的成員，不能使用"); return; }
        if (!r.ok || !j.token) { say("登入失敗，請再試一次（" + (j.error || r.status) + "）"); return; }
        session = { token: j.token, name: j.name }; env.session = session;
      }
      wantLogin = true; ws.send(JSON.stringify({ t: "bauth", token: session.token }));
    } catch (e) { say("授權沒有完成：" + ((e && (e.message || e.code)) || "未知錯誤")); }
  }
  function onAuthed(m) {
    if (!m.ok && m.error !== "bot_down") { session = null; env.session = null; showLogin(wantLogin ? "登入已失效，請再登入一次" : ""); wantLogin = false; return; }
    wantLogin = false;
    if (!gidOf()) { showLogin(); return; }
    send({ a: "join", gid: gidOf() });
  }

  // ---- 伺服器訊息
  function onGl(m) {
    if (m.a === "err") {
      if (m.error === "relogin") { session = null; env.session = null; showLogin("登入資料過期了，請重新登入"); return; }
      return say(m.error === "text" ? m.text : (ERR[m.error] || "發生錯誤，再試一次"));
    }
    if (m.a === "state") {
      joined = true; me = m.me; cats = m.cats; queue = m;
      loginEl.hidden = true; mainEl.hidden = false; say("");
      const saved = LS.get("gl_cat_" + gidOf());
      cat = (cats.find((c) => c.id === saved) || cats[0] || {}).id;
      drawCats(); drawQueue(); drawAll(); loadCat(); return;
    }
    if (m.a === "queue") { queue = m; drawQueue(); return; }
    if (m.a === "queued") { say(m.ahead ? `排進去了，前面還有 ${m.ahead} 張` : "開始畫了，約 30 秒～1 分鐘"); return; }
    if (m.a === "fail") { if (m.uid === me) say("❌ " + m.error); return; }
    if (m.a === "cats") { cats = m.cats; if (m.removed === cat) { cat = cats[0].id; loadCat(); } drawCats(); return; }
    if (m.a === "list") {
      if (m.cat !== cat) return;
      imgs = m.append ? imgs.concat(m.imgs) : m.imgs; more = m.more;
      if (m.chat) chat = m.chat;
      drawLib(); if (!m.append) drawChat(); return;
    }
    if (m.a === "img") {
      cats = m.cats; drawCats();
      if (m.img.cat === cat) { imgs.unshift(m.img); drawLib(); }
      if (m.img.uid === me) say("🎨 畫好了！" + (m.img.cat === cat ? "" : "（在別的分類）"));
      return;
    }
    if (m.a === "del") { cats = m.cats; drawCats(); imgs = imgs.filter((x) => x.id !== m.id); drawLib(); if (boxEl.dataset.id === m.id) closeBox(); return; }
    if (m.a === "chat") { if (m.cat === cat) { chat.push(m.msg); if (chat.length > 80) chat.shift(); addChatLine(m.msg); } return; }
  }
  function loadCat() { imgs = []; chat = []; more = false; drawLib(); drawChat(); if (cat) send({ a: "list", cat }); }

  // ---- 畫面
  function drawCats() {
    catsEl.innerHTML = cats.map((c) => `<button class="gl-cat${c.id === cat ? " on" : ""}" data-c="${c.id}">${esc(c.name)}<small>${c.n}</small></button>`).join("")
      + `<button class="gl-cat add" title="新增分類">＋</button>`;
    catsEl.querySelectorAll(".gl-cat:not(.add)").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.c === cat) return; cat = b.dataset.c; LS.set("gl_cat_" + gidOf(), cat); drawCats(); loadCat(); drawNewHint();
    }));
    catsEl.querySelector(".add").addEventListener("click", () => {
      boxEl.hidden = false; boxEl.dataset.id = "";
      boxEl.innerHTML = `<div class="gl-dlg"><b>新增分類</b><input class="gl-newcat" maxlength="12" placeholder="分類名字（最多 12 字）"><div class="gl-row"><button class="gl-yes">新增</button><button class="gl-no">取消</button></div>${cats.find((c) => c.id === cat && !c.n) ? `<button class="gl-delcat">刪除目前這個空分類「${esc(cats.find((c) => c.id === cat).name)}」</button>` : ""}</div>`;
      const inp = boxEl.querySelector(".gl-newcat"); inp.focus();
      const ok = () => { const name = inp.value.trim(); if (name) send({ a: "addcat", name }); closeBox(); };
      boxEl.querySelector(".gl-yes").addEventListener("click", ok);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      boxEl.querySelector(".gl-no").addEventListener("click", closeBox);
      const dc = boxEl.querySelector(".gl-delcat"); if (dc) dc.addEventListener("click", () => { send({ a: "delcat", cat }); closeBox(); });
    });
  }
  function drawQueue() {
    const j = queue.jobs || [];
    queueEl.textContent = j.length ? "🎨 " + j.map((x) => `${x.name}${x.run ? " 正在畫" : " 排隊中"}`).join("、") : "";
  }
  function drawAll() { drawNew(); drawChat(); drawLib(); }
  function drawLib() {
    const p = panes.lib;
    if (!imgs.length) { p.innerHTML = `<p class="gl-empty">${cat ? "這個分類還沒有圖。到「✏️ 畫圖」畫第一張，或在「💬 大笨bot」叫它畫！" : ""}</p>`; return; }
    p.innerHTML = `<div class="gl-grid">${imgs.map((x) => `<button class="gl-th" data-id="${x.id}" title="${esc(x.prompt)}"><img loading="lazy" src="${imgUrl(x, true)}" alt=""><small>${esc(x.name)}</small></button>`).join("")}</div>${more ? `<button class="gl-more">看更多</button>` : ""}`;
    p.querySelectorAll(".gl-th").forEach((b) => b.addEventListener("click", () => openBox(imgs.find((x) => x.id === b.dataset.id))));
    const mb = p.querySelector(".gl-more"); if (mb) mb.addEventListener("click", () => send({ a: "list", cat, before: imgs[imgs.length - 1].ts }));
  }
  function openBox(x) {
    if (!x) return;
    boxEl.hidden = false; boxEl.dataset.id = x.id;
    boxEl.innerHTML = `<div class="gl-lb"><img src="${imgUrl(x, false)}" alt=""><div class="gl-info"><b>${esc(x.name)}</b>・${when(x.ts)}${x.via === "bot" ? "・請大笨bot畫" : ""}${x.w ? `・${x.w}×${x.h}` : ""}
      ${x.orig ? `<p><small>原句：</small>${esc(x.orig)}</p><p><small>擴寫後：</small>${esc(x.prompt)}</p>` : `<p>${esc(x.prompt)}</p>`}
      <div class="gl-row"><button class="gl-use">用這個提示詞畫</button><a class="gl-open" target="_blank" rel="noopener" href="${imgUrl(x, false)}">開啟原圖</a>${x.uid === me ? `<button class="gl-del">刪除</button>` : ""}<button class="gl-no">關閉</button></div></div></div>`;
    boxEl.querySelector(".gl-no").addEventListener("click", closeBox);
    boxEl.querySelector(".gl-use").addEventListener("click", () => { closeBox(); setTab("new"); const ta = panes.new.querySelector(".gl-prompt"); if (ta) { ta.value = x.orig || x.prompt; ta.focus(); } });
    const d = boxEl.querySelector(".gl-del"); if (d) d.addEventListener("click", () => { if (!d.dataset.sure) { d.dataset.sure = "1"; d.textContent = "再按一次確定刪除（刪了找不回來）"; return; } send({ a: "del", id: x.id }); closeBox(); });
    const o = boxEl.querySelector(".gl-open");
    if (env.sdk && env.sdk.commands && env.sdk.commands.openExternalLink) o.addEventListener("click", (e) => { e.preventDefault(); env.sdk.commands.openExternalLink({ url: new URL(o.getAttribute("href"), location.href).href }); });
  }
  function closeBox() { boxEl.hidden = true; boxEl.dataset.id = ""; boxEl.innerHTML = ""; }
  boxEl.addEventListener("click", (e) => { if (e.target === boxEl) closeBox(); });

  function drawNew() {
    panes.new.innerHTML = `
      <div class="gl-form">
        <div class="gl-hint gl-newhint"></div>
        <textarea class="gl-prompt" maxlength="600" rows="4" placeholder="想畫什麼？中文英文都可以，例如：戴帽子的柴犬在雪地裡"></textarea>
        <div class="gl-opts">
          <label>形狀<select class="o-shape"><option value="square">正方形</option><option value="landscape">橫式</option><option value="portrait">直式</option></select></label>
          <label>大小<select class="o-scale"><option value="normal">一般</option><option value="large">大圖</option><option value="huge">超大圖（長邊 2048）</option></select></label>
          <label>畫質<select class="o-q"><option value="fast">快速</option><option value="clean">構圖與文字較乾淨</option></select></label>
        </div>
        <label class="gl-smart"><input type="checkbox" class="o-smart"> 智慧擴寫（先把一句話擴成完整提示詞，多等 10～30 秒）</label>
        <label class="gl-lang">擴寫語言<select class="o-lang"><option value="en">英文</option><option value="zh">中文</option></select></label>
        <button class="gl-draw">🎨 畫</button>
        <p class="gl-hint">大圖和超大圖只有「快速」畫質支援，一張約 40 秒～1 分半。一次只畫一張，每人同時只能排一張。</p>
      </div>`;
    const f = panes.new, scale = f.querySelector(".o-scale"), q = f.querySelector(".o-q");
    scale.addEventListener("change", () => { if (scale.value !== "normal") q.value = "fast"; });
    q.addEventListener("change", () => { if (q.value !== "fast" && scale.value !== "normal") scale.value = "normal"; });
    f.querySelector(".gl-draw").addEventListener("click", () => {
      const prompt = f.querySelector(".gl-prompt").value.trim();
      if (!prompt) { say("先寫要畫什麼"); return; }
      send({ a: "draw", cat, prompt, shape: f.querySelector(".o-shape").value, scale: scale.value, quality: q.value, smart: f.querySelector(".o-smart").checked, lang: f.querySelector(".o-lang").value });
    });
    drawNewHint();
  }
  function drawNewHint() { const h = panes.new.querySelector(".gl-newhint"); const c = cats.find((x) => x.id === cat); if (h) h.textContent = c ? `畫好的圖會放進「${c.name}」分類，這個伺服器的成員都看得到。` : ""; }

  function drawChat() {
    panes.chat.innerHTML = `<div class="gl-log"></div><div class="gl-say"><input class="gl-in" maxlength="500" placeholder="跟大笨bot說話，或叫它畫圖：幫我畫一隻戴帽子的柴犬"><button class="gl-sendbtn">送出</button></div>
      <p class="gl-hint">大笨bot畫的圖會放進目前的分類，不會傳到 Discord。這裡的對話是這個分類裡的人共用的。</p>`;
    const log = panes.chat.querySelector(".gl-log"); log.innerHTML = chat.map(lineHtml).join(""); log.scrollTop = log.scrollHeight;
    const inp = panes.chat.querySelector(".gl-in");
    const go = () => { const t = inp.value.trim(); if (!t) return; send({ a: "chat", cat, text: t }); inp.value = ""; };
    panes.chat.querySelector(".gl-sendbtn").addEventListener("click", go);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) go(); });
  }
  const lineHtml = (x) => `<div class="gl-line${x.bot ? " bot" : x.uid === me ? " mine" : ""}"><b>${esc(x.name)}</b><span>${esc(x.text)}</span><small>${when(x.ts)}</small></div>`;
  function addChatLine(x) { const log = panes.chat.querySelector(".gl-log"); if (!log) return; log.insertAdjacentHTML("beforeend", lineHtml(x)); log.scrollTop = log.scrollHeight; }

  function setTab(t) {
    tab = t;
    root.querySelectorAll(".gl-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    for (const k of Object.keys(panes)) panes[k].hidden = k !== t;
  }
  root.querySelectorAll(".gl-tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.t)));

  function destroy() { closed = true; try { ws && ws.close(); } catch {} }
  drawNew(); drawChat();
  say("連線中…");
  connect();
  return destroy;
}
