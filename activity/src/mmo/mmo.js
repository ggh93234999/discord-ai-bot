// 水墨江湖（MMORPG）前端：連線、點擊操作、畫面、介面。世界的規則全部在伺服器（server/games/mmo/）。
import "./mmo.css";
import { wsUrl } from "../gomoku.js";
import { TS, KAI, renderMap, drawPlayer, drawMob, bossAura, hpBar, label, nameTag, CLS_COLOR, RAR_COLOR } from "./draw.js";
import paperUrl from "../gacha-ui/paper.jpg";
import brushUrl from "../gacha-ui/brush.jpg";
import { art, artLoad, artUrl, drawArt, drawAnim, hasAnim, animMs, artReady, hasArt, MOB_ART, FLOAT, NPC_ART, SKILL_ART, itemArt } from "./art.js";
import townArt from "../gacha-ui/m_town.jpg";
import { ENH, REROLL, RECAST } from "../../server/games/mmo/data.js";
import { snd, ambience, stopAmbience, sndOpt, setSnd } from "./sfx.js";
const FIRE_SK = new Set(["fire", "dragon", "inferno", "sanmei", "fenghuang", "huohai"]), THUNDER_SK = new Set(["thunder", "wulei"]), ICE_SK = new Set(["ice"]);
import forestArt from "../gacha-ui/m_forest.jpg";
import sceneArt from "../gacha-ui/m_scenery.jpg";
import ruinArt from "../gacha-ui/m_ruin.jpg";

const AREA_ART = { town: townArt, bamboo: forestArt, mount: sceneArt, tomb: ruinArt };
const AREA_BOSS = { snow: "b_snow", fire: "b_qilin", demon: "b_lord", tower: "b_fox" };     // 新地圖的地區卡用王的圖
const GLYPH = { sweep: "掃", guard: "罩", thrust: "刺", fire: "火", heal: "春", thunder: "雷", triple: "珠", gale: "風", rain: "雨" };
const CLS_GLYPH = { sword: "劍", mage: "術", archer: "弓" };
const paperImg = new Image(); paperImg.src = paperUrl;
const brushImg = new Image(); brushImg.src = brushUrl;
const USE_PROPS = ["e_bamboo1", "e_rock1", "e_pine1", "e_plum1", "e_grave1", "e_house1", "e_gate"].every(hasArt);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n || 0).toLocaleString();
const STAT = { atk: "攻擊", def: "防禦", hp: "生命", mp: "法力", crit: "暴擊%", aspd: "攻速%" };
const RAR = ["普通", "精良", "稀有", "傳說"];
const RAR_AFF = [0, 1, 2, 3];
const SLOT = { weapon: "武器", armor: "衣服", acc: "飾品" };
const CLS = { sword: "劍客", mage: "術士", archer: "弓手" };
const ADVN = { jx: "劍仙", bd: "霸刀", ts: "天師", ft: "焚天", ss: "神射", ly: "獵影" };
const KEYS = "QWERF";
const POT = { hp1: "小還丹", hp2: "大還丹", hp3: "九轉還魂丹", hp4: "天王護心丹", mp1: "清心散", mp2: "凝神散", mp3: "玉露瓊漿", tp: "回城符", ore: "玄鐵", jade: "靈玉", recast: "重鑄石", token: "鎖妖令" };
const MAT = { ore: 1, jade: 1, recast: 1, token: 1 };
const RANGED = { mage: 1, archer: 1 };
const pidOf = () => { try { let p = localStorage.getItem("mmopid"); if (!p) { p = Math.random().toString(36).slice(2, 12); localStorage.setItem("mmopid", p); } return p; } catch { return "x" + Math.random().toString(36).slice(2, 10); } };

export function mountMmo(root, { env, back }) {
  root.innerHTML = `
  <div class="mmo">
    <canvas class="mo-cv"></canvas>
    <div class="mo-hud">
      <div class="mo-me">
        <button class="mo-back" title="回選單">←</button>
        <div class="mo-card">
          <div class="mo-face"><span></span></div>
          <div class="mo-nm"><b class="mo-name">連線中…</b><span class="mo-lv"></span></div>
          <div class="mo-bar hp"><i></i><span></span></div>
          <div class="mo-bar mp"><i></i><span></span></div>
          <div class="mo-bar xp"><i></i></div>
        </div>
        <div class="mo-buffs"></div>
      </div>
      <div class="mo-party"></div>
      <div class="mo-right">
        <canvas class="mo-mini" width="132" height="96"></canvas>
        <div class="mo-mapname"></div>
        <div class="mo-gold"></div>
        <div class="mo-btns"><button data-open="bag">行囊 <kbd>B</kbd></button><button data-open="skills">技能 <kbd>K</kbd></button><button data-open="help">說明</button><button class="mo-switch" title="回到選角色畫面">換角</button></div>
      </div>
      <div class="mo-target" hidden><b></b><div class="mo-bar tg"><i></i></div></div>
      <div class="mo-chat"><div class="mo-log"></div><form class="mo-say"><input maxlength="80" placeholder="說點什麼…（開頭打 /p 只給隊友看）" enterkeyhint="send"></form></div>
      <div class="mo-skills"></div>
      <div class="mo-toast"></div>
      <div class="mo-tip" hidden></div>
      <div class="mo-area" hidden><img alt=""><div><b></b><span></span></div></div>
      <div class="mo-dead" hidden>你倒下了……<small>5 秒後在長安城醒來</small></div>
    </div>
    <div class="mo-panel" hidden></div>
    <div class="mo-ask" hidden></div>
    <div class="mo-menu" hidden></div>
    <div class="mo-start" hidden></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const cv = $(".mo-cv"), g = cv.getContext("2d"), mini = $(".mo-mini"), mg = mini.getContext("2d");
  const panel = $(".mo-panel"), askEl = $(".mo-ask"), menuEl = $(".mo-menu"), startEl = $(".mo-start"), logEl = $(".mo-log"), toastEl = $(".mo-toast");

  let ws = null, closed = false, retry = 0, kicked = false, session = env.session || null, pickIdx = null, charsMsg = null;
  let me = null, myId = 0, map = null, mapCv = null, miniBase = null;
  const ents = new Map(), meta = {};
  // ------------------------------------------------------------ 城裡的路人：只在畫面上走來走去
  const FOLK_SMALL = { f_cat: 1, f_dog: 1, f_chicken: 1 };
  // 動物：走路／待機動畫、各自的習性（貓愛坐、狗會跟人、雞邊走邊啄）
  const PET = {
    f_cat: { key: "fcat", walkRef: "f_catw", sz: 0.95, spd: 1.3, idle: [4000, 12000], hop: [2, 5], follow: 0.25 },
    f_dog: { key: "fdog", walkRef: "f_dogw", sz: 1.25, spd: 2.1, idle: [2000, 6000], hop: [2, 6], follow: 0.55 },
    f_chicken: { key: "fchick", walkRef: "f_chickw", sz: 0.8, spd: 0.8, idle: [1500, 4000], hop: [0.8, 2.2], follow: 0 },
  };
  let folk = [];
  const walkT = (x, y) => { if (!map) return false; const ix = Math.floor(x), iy = Math.floor(y); if (ix < 1 || iy < 1 || ix >= map.w - 1 || iy >= map.h - 1) return false; const c = map.tiles[iy * map.w + ix]; return c === "0" || c === "3"; };
  function makeFolk(m) {
    if (!m.layout || !m.layout.folk) return [];
    const out = [];
    for (const art of m.layout.folk) {
      if (!hasArt(art)) continue;
      for (let k = 0; k < 60; k++) { const x = 2 + Math.random() * (m.w - 4), y = 3 + Math.random() * (m.h - 6); if (walkT(x, y) && !m.npcs.some((n) => Math.hypot(n.x - x, n.y - y) < 2)) { out.push({ art, x, y, tx: x, ty: y, wait: Math.random() * 3000, face: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 6, last: 0, spd: PET[art] ? PET[art].spd : 0.9 + Math.random() * 0.4 }); break; } }
    }
    return out;
  }
  const lineOk = (x0, y0, x1, y1) => { for (let s2 = 1; s2 <= 8; s2++) if (!walkT(x0 + (x1 - x0) * s2 / 8, y0 + (y1 - y0) * s2 / 8)) return false; return true; };
  function stepFolk(f, t) {
    const dt = f.last ? Math.min(0.1, (t - f.last) / 1000) : 0; f.last = t;
    const P = PET[f.art];
    if (f.follow) {        // 跟著某個玩家：一直把目標設在他旁邊，跟到了就停下來搖尾巴
      const e = ents.get(f.follow);
      if (!e || Math.hypot(e.x - f.x, e.y - f.y) > 10 || t > f.followEnd) f.follow = 0;
      else { const side = f.x < e.x ? -1 : 1; f.tx = e.x + side * 1.1; f.ty = e.y + 0.35; if (Math.hypot(f.tx - f.x, f.ty - f.y) < 0.25) { f.moving = false; if (Math.abs(e.x - f.x) > 0.05) f.face = e.x > f.x ? 1 : -1; return; } if (!lineOk(f.x, f.y, f.tx, f.ty)) f.follow = 0; }
    }
    if (f.wait > 0 && !f.follow) { f.wait -= dt * 1000; f.moving = false; return; }
    const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
    if (d < 0.08 && !f.follow) {          // 到了：停一下（貓坐、狗搖尾巴、雞啄地），再決定下一步
      f.moving = false;
      f.wait = P ? P.idle[0] + Math.random() * (P.idle[1] - P.idle[0]) : 1500 + Math.random() * 5000;
      if (P && P.follow && Math.random() < P.follow) {       // 附近有人：跑過去
        let best = null, bd = 7;
        for (const e of ents.values()) { const md = meta[e.id]; if (md && md.k === "p" && !e.gone) { const dd = Math.hypot(e.x - f.x, e.y - f.y); if (dd < bd) { bd = dd; best = e; } } }
        if (best) { f.follow = best.id; f.followEnd = t + 15000 + Math.random() * 20000; f.wait = 0; return; }
      }
      const hop = P ? P.hop : [2, 7];
      for (let k = 0; k < 12; k++) { const a = Math.random() * 6.28, r = hop[0] + Math.random() * (hop[1] - hop[0]), nx = f.x + Math.cos(a) * r, ny = f.y + Math.sin(a) * r; if (lineOk(f.x, f.y, nx, ny)) { f.tx = nx; f.ty = ny; break; } }
      return;
    }
    const spd = f.follow ? f.spd * 1.25 : f.spd;
    const st = Math.min(d, spd * dt); if (d > 0.001) { f.x += dx / d * st; f.y += dy / d * st; } f.moving = d > 0.05;
    if (Math.abs(dx) > 0.05) f.face = dx > 0 ? 1 : -1;
  }
  let fx = [], floaters = [], chat = [], party = [], trade = null, npcOpen = null, pendingNpc = null, openP = null, sellMode = false;
  let cam = { x: 0, y: 0 }, zoom = 1, W = 0, H = 0, dpr = 1, raf = 0, shake = 0, clickMark = null, cdEnd = {};

  // ------------------------------------------------------------ 連線
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "mo", ...o })); }
  function connect() {
    if (closed) return;
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => {
      retry = 0;
      if (session) ws.send(JSON.stringify({ t: "bauth", token: session.token }));
      send({ a: "hello", pid: pidOf(), name: session ? session.name : "", pick: pickIdx });
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "bauthed") { if (!m.ok && session) { session = null; env.session = null; toast("登入過期了，先用訪客身分進入"); } return; }
      if (m.t !== "mo") return;
      onMsg(m);
    };
    ws.onclose = () => { if (closed || kicked) return; $(".mo-name").textContent = "斷線，重新連線中…"; setTimeout(connect, Math.min(8000, 800 * 2 ** retry++)); };
  }
  function onMsg(m) {
    switch (m.a) {
      case "create": return showCreate(m);
      case "chars": return showChars(m);
      case "map": return onMap(m);
      case "s": return onSnap(m);
      case "me": {
        me = { ...me, ...m }; myId = m.id; cdFrom(m.cd); hud();
        // 只有背包／裝備真的有變才重畫面板（回血回魔每秒都會送狀態，每次重畫會把正在看的東西清掉）
        if (m.inv) { if (openP === "bag") renderBag(); if (openP === "trade") renderTrade(); if (openP === "npc" && npcOpen && ((npcOpen.kind === "smith" && npcTab !== "buy") || npcOpen.kind === "store")) renderNpc(); }
        else if (openP === "bag") { const gEl = panel.querySelector(".mo-goldv"); if (gEl) gEl.textContent = money(me.gold); }
        if (openP === "skills" && (m.skills || m.slots)) renderSkills();
        return;
      }
      case "sys": return addChat({ sys: true, text: m.text });
      case "chat": addChat(m); { const e = ents.get(m.id); if (e) { e.say = m.text; e.sayT = performance.now(); } } return;
      case "err": return toast(m.text);
      case "party": party = m.list || []; return renderParty();
      case "ask": return showAsk(m);
      case "trade": if (m.close) { trade = null; if (openP === "trade") closePanel(); return; } trade = m; openPanel("trade"); return;
      case "npc": if (!npcOpen || npcOpen.id !== m.id) { npcTab = "buy"; forgeSel = null; } npcOpen = m; pendingNpc = null; openPanel("npc"); return;
      case "npcup": if (npcOpen) { Object.assign(npcOpen, m); if (m.slipAnim) npcOpen.anim = performance.now(); if (openP === "npc") renderNpc(); } return;
      case "dice": diceRes = m; diceRoll = performance.now(); if (openP === "npc") { renderNpc(); setTimeout(() => { if (openP === "npc" && npcOpen && npcOpen.kind === "casino") renderNpc(); snd[m.win > 0 ? "coin" : "fail"](); }, 750); } snd.click(); return;
      case "forged": forgeFx = m; snd.anvil(); (m.ok ? snd.success : snd.fail)(); return;
      case "bank": if (npcOpen) { Object.assign(npcOpen, { tokens: m.tokens, used: m.used, cap: m.cap }); if (openP === "npc") renderNpc(); } return;
      case "walkto": pendingNpc = m.id; return;
      case "inst": { const el = $(".mo-mapname span"); if (el) { el.textContent = m.text; el.classList.add("inst"); } if (m.text === "開打！" || m.text.startsWith("通關")) { if (!el || el.dataset.last !== m.text) snd.gong(); } if (el) el.dataset.last = m.text; return; }
      case "kicked": kicked = true; toast("這個角色在別的地方登入了"); $(".mo-name").textContent = "已在別處登入"; return;
    }
  }
  function cdFrom(cd) { const t = performance.now(); cdEnd = {}; for (const [k, v] of Object.entries(cd || {})) cdEnd[k] = t + v; }

  // ------------------------------------------------------------ 開場：登入或訪客
  async function start() {
    $(".mo-name").textContent = "載入畫面中…";
    await artReady(6000);
    if (closed) return;
    $(".mo-name").textContent = "連線中…";
    if (session || !env.inDiscord || !env.sdk) { connect(); return; }
    startEl.hidden = false;
    startEl.innerHTML = `<div class="mo-sheet mo-intro"><h2>水墨江湖</h2><p>打怪、升級、組隊打王。</p>
      <p class="mo-dim">用 Discord 登入，角色會綁在你的帳號上，可以用<b>錢莊</b>把銀兩和大笨bot 代幣互換，也能跟其他人<b>交易</b>。</p>
      <div class="mo-row"><button class="mo-pri" data-go="login">用 Discord 登入</button><button data-go="guest">先用訪客玩</button></div></div>`;
    startEl.onclick = (e) => { const b = e.target.closest("[data-go]"); if (!b) return; if (b.dataset.go === "guest") { startEl.hidden = true; connect(); } else login(); };
  }
  async function login() {
    try {
      startEl.querySelector(".mo-dim").textContent = "請在 Discord 跳出的視窗按「授權」…";
      await env.sdk.ready();
      const { code } = await env.sdk.commands.authorize({ client_id: env.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"] });
      const r = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, gid: new URLSearchParams(location.search).get("guild_id") || "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) { startEl.querySelector(".mo-dim").textContent = r.status === 403 ? "你不是這個伺服器的成員" : "登入失敗，請再試一次（" + (j.error || r.status) + "）"; return; }
      session = { token: j.token, name: j.name }; env.session = session;
      startEl.hidden = true; connect();
    } catch (e) { startEl.querySelector(".mo-dim").textContent = "授權沒有完成：" + ((e && (e.message || e.code)) || "未知錯誤"); }
  }
  // ------------------------------------------------------------ 選角色（同一個帳號最多 4 隻，等級和銀兩共用）
  function showChars(m) {
    stopAmbience();
    charsMsg = m; pickIdx = null; me = null; map = null; ents.clear(); closePanel();
    startEl.hidden = false;
    let del = -1;
    const pic = (c) => { const k = hasArt("p_" + (c.adv || c.c)) ? "p_" + (c.adv || c.c) : "p_" + c.c; return hasArt(k) ? `<img src="${artUrl(k)}" alt="">` : `<span class="mo-chglyph">${CLS_GLYPH[c.c] || "俠"}</span>`; };
    const draw = () => {
      startEl.innerHTML = `<div class="mo-sheet mo-chars"><h2>選擇角色</h2>
        <p class="mo-chacc">銀兩 <b>${money(m.gold)}</b> 兩<small>每個角色各自練等級；銀兩和倉庫整個帳號共用；裝備、行囊、技能各自分開</small></p>
        <div class="mo-chlist">${m.list.map((c) => `<div class="mo-ch${c.i === m.last ? " last" : ""}" style="--c:${CLS_COLOR[c.c]}">
            <button class="mo-chpick" data-pick="${c.i}">${pic(c)}<b>${esc(c.n)}</b><span>${c.lv || 1} 級・${esc(c.advN || CLS[c.c] || "")}</span><small>${esc(c.map)}${c.w ? "・" + esc(c.w) : ""}</small></button>
            ${m.list.length > 1 ? `<button class="mo-chdel" data-del="${c.i}" title="刪除這個角色">×</button>` : ""}
            ${del === c.i ? `<div class="mo-chconfirm"><p>刪掉後裝備和行囊都會消失，不能復原。請輸入角色名字「${esc(c.n)}」確認：</p><input class="mo-delname" maxlength="12"><div class="mo-row"><button class="mo-danger" data-delok="${c.i}">刪除</button><button data-delno="1">取消</button></div></div>` : ""}
          </div>`).join("")}
          ${m.list.length < m.max ? `<button class="mo-ch mo-chnew" data-new="1"><span>＋</span><b>建立新角色</b><small>還可以建 ${m.max - m.list.length} 個</small></button>` : ""}
        </div></div>`;
      const inp = startEl.querySelector(".mo-delname"); if (inp) inp.focus();
    };
    draw();
    startEl.onclick = (e) => {
      const b = e.target.closest("[data-pick],[data-del],[data-delok],[data-delno],[data-new]"); if (!b) return;
      const d = b.dataset;
      if (d.pick != null) { pickIdx = Number(d.pick); send({ a: "pick", i: pickIdx }); startEl.hidden = true; return; }
      if (d.del != null) { del = Number(d.del); draw(); return; }
      if (d.delno) { del = -1; draw(); return; }
      if (d.delok != null) { send({ a: "delchar", i: Number(d.delok), name: startEl.querySelector(".mo-delname").value.trim() }); return; }
      if (d.new) showCreate({ real: m.real, name: "", classes: m.classes, back: true });
    };
  }
  function showCreate(m) {
    startEl.hidden = false;
    let cls = "sword";
    const draw = () => {
      startEl.innerHTML = `<div class="mo-sheet mo-create"><h2>建立角色</h2>
        <label class="mo-field">名字<input class="mo-cname" maxlength="12" value="${esc(m.name || "")}" placeholder="俠客名號"></label>
        <div class="mo-classes">${m.classes.map((c) => `<button class="mo-cls${c.k === cls ? " on" : ""}" data-cls="${c.k}" style="--c:${CLS_COLOR[c.k]}">${hasArt("p_" + c.k) ? `<img class="mo-clsimg" src="${artUrl("p_" + c.k)}" alt="">` : `<canvas width="64" height="64" data-k="${c.k}"></canvas>`}<b>${c.n}</b><span>${esc(c.d)}</span><small>${c.skills.join("・")}</small></button>`).join("")}</div>
        ${m.real ? "" : `<p class="mo-dim">訪客角色存在這台裝置上，不能用錢莊和交易。</p>`}
        ${m.back ? `<p class="mo-dim">新角色從 1 級開始練；銀兩和倉庫跟其他角色共用，可以用倉庫把裝備轉給新角色。</p>` : ""}
        <div class="mo-row">${m.back ? `<button data-go="back">← 回選角</button>` : ""}<button class="mo-pri" data-go="make">踏入江湖</button></div></div>`;
      startEl.querySelectorAll(".mo-cls canvas").forEach((c) => { const x = c.getContext("2d"); x.translate(32, 58); drawPlayer(x, 0, 0, c.dataset.k, 0, { s: 1.15 }); });
    };
    draw();
    startEl.onclick = (e) => {
      const c = e.target.closest("[data-cls]"); if (c) { const nm = startEl.querySelector(".mo-cname").value; cls = c.dataset.cls; draw(); startEl.querySelector(".mo-cname").value = nm; return; }
      if (e.target.closest("[data-go=back]")) { showChars(charsMsg); return; }
      if (e.target.closest("[data-go=make]")) { pickIdx = charsMsg ? charsMsg.list.length : 0; send({ a: "create", cls, name: startEl.querySelector(".mo-cname").value }); startEl.hidden = true; }
    };
  }

  // ------------------------------------------------------------ 地圖與快照
  function onMap(m) {
    if (map) snd.warp();
    map = m.map; myId = m.you;
    const mk = () => renderMap(map, { paper: paperImg, props: USE_PROPS, ground: art("g_" + (map.theme === "arena" ? "town" : map.theme)), path: art("g_path"), stage: art("e_arena"), stone: art("g_stone") });
    mapCv = mk();
    { const want = map; for (const n of ["g_stone", "e_arena", "g_" + map.theme]) { const im = artLoad(n); if (im && !(im.complete && im.naturalWidth)) im.addEventListener("load", () => { if (map === want) { mapCv = mk(); makeMini(); } }, { once: true }); } }      // 素材晚到：載好再重畫一次地圖
    ents.clear(); parts = []; partsInit = false; sparks = []; folk = makeFolk(map);
    if (!paperImg.complete) paperImg.onload = () => { if (map) { mapCv = mk(); makeMini(); } };
    areaCard(map); ambience(map.theme); fx = []; floaters = []; npcOpen = null; pendingNpc = null;
    if (openP === "npc") closePanel();
    makeMini();
    $(".mo-mapname").innerHTML = `<b>${esc(map.name)}</b>${map.lvl ? `<span>${esc(map.lvl)}</span>` : map.town ? "<span>安全區</span>" : ""}`;
    $(".mo-switch").disabled = !!map.inst;
    addChat({ sys: true, text: `來到了${map.name}。` });
  }
  function makeMini() {
    miniBase = document.createElement("canvas"); miniBase.width = mini.width; miniBase.height = mini.height;
    const s = Math.min(mini.width / map.w, mini.height / map.h); miniBase.getContext("2d").drawImage(mapCv, 0, 0, map.w * s, map.h * s);
  }
  let areaT = 0;
  function areaCard(mp) {
    const el = $(".mo-area"); el.querySelector("img").src = AREA_ART[mp.theme] || (hasArt(AREA_BOSS[mp.theme]) ? artUrl(AREA_BOSS[mp.theme]) : townArt);
    el.querySelector("b").textContent = mp.name; el.querySelector("span").textContent = mp.lvl || (mp.town ? "安全區" : "");
    el.hidden = false; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    clearTimeout(areaT); areaT = setTimeout(() => { el.hidden = true; }, 2800);
  }
  function onSnap(m) {
    const t = performance.now(), seen = new Set();
    Object.assign(meta, m.meta || {});
    for (const [id, x100, y100, hp, fl, mpp] of m.e) {
      seen.add(id);
      const x = x100 / 100, y = y100 / 100;
      let e = ents.get(id);
      if (!e) { e = { id, x, y, fx: x, fy: y, tx: x, ty: y, t0: t, hp, fl }; ents.set(id, e); }
      else { e.fx = e.x; e.fy = e.y; e.tx = x; e.ty = y; e.t0 = t; }
      e.moving = Math.hypot(e.tx - e.fx, e.ty - e.fy) > 0.01;
      if (Math.abs(e.tx - e.fx) > 0.01) e.face = e.tx > e.fx ? 1 : -1;
      if (hp < e.hp) e.hurtT = t;
      e.hp = hp; e.fl = fl; e.gone = 0; if (mpp != null) e.mpp = mpp;
    }
    for (const [id, e] of ents) if (!seen.has(id)) { if (!e.gone) e.gone = t; else if (t - e.gone > 500) ents.delete(id); }
    for (const f of m.fx) onFx(f, t);
  }
  const posOf = (id) => { const e = ents.get(id); return e ? { x: e.x, y: e.y } : null; };
  // 音效：跟自己有關的照原音量，別人的照距離變小聲（太遠就不播）
  function sound(f, a, b) {
    const meE = ents.get(myId); if (!meE) return;
    const at = b || a || (f.x != null ? { x: f.x, y: f.y } : null);
    const near = f.a === myId || f.b === myId ? 1 : at ? Math.max(0, 1 - Math.hypot(at.x - meE.x, at.y - meE.y) / 12) * 0.6 : 0;
    if (near <= 0.05) return;
    switch (f.k) {
      case "h": { if (f.c) return snd.crit(near); const cls = meta[f.a] && meta[f.a].c; return cls === "archer" ? snd.arrow(near) : cls === "mage" ? snd.orb(near) : snd.slash(near); }
      case "s": return f.c ? snd.crit(near) : snd.slash(near * 0.7);
      case "m": return snd.hurt(f.b === myId ? 1 : near * 0.6);
      case "kill": return snd.kill(near);
      case "sk": {
        if (f.type === "self") { const sk = me && me.skills && me.skills.find((x) => x.id === f.s); return f.s === "heal" || f.s === "taiji" ? snd.heal(near) : f.r ? snd.whoosh(near) : snd.buff(near); }
        if (FIRE_SK.has(f.s)) return setTimeout(() => snd.fire(near), f.t || 0);
        if (THUNDER_SK.has(f.s)) return setTimeout(() => snd.thunder(near), f.t || 0);
        if (ICE_SK.has(f.s)) return snd.ice(near);
        if (f.dash) return snd.whoosh(near);
        if (f.type === "ground") return setTimeout(() => snd.boom(near * 0.7), f.t || 0);
        const cls = meta[f.a] && meta[f.a].c; return cls === "archer" ? snd.arrow(near) : snd.whoosh(near);
      }
      case "tick": return FIRE_SK.has(f.s) ? snd.fire(near * 0.6) : THUNDER_SK.has(f.s) ? snd.thunder(near * 0.7) : snd.boom(near * 0.5);
      case "lvl": return f.b === myId ? snd.level() : null;
      case "gold": return f.a === myId ? snd.coin(0.8) : null;
      case "loot": return f.a === myId ? (f.r >= 2 ? snd.rare() : snd.loot()) : null;
      case "die": return f.b === myId ? snd.die() : null;
      case "warn": return snd.warn(near);
      case "slam": return snd.boom(near);
    }
  }
  function float(x, y, text, col, size = 15, life = 900) { floaters.push({ x, y, text, col, size, t0: performance.now(), life }); }
  function onFx(f, t) {
    const a = posOf(f.a), b = posOf(f.b), mine = f.a === myId;
    sound(f, a, b);
    if ((f.k === "h" || f.k === "m" || f.k === "sk") && a) { const ea = ents.get(f.a); if (ea) { ea.atkT = t; const tx = b ? b.x : f.x; if (tx != null && Math.abs(tx - a.x) > 0.05) ea.face = tx > a.x ? 1 : -1; } }
    switch (f.k) {
      case "h": case "s": {
        if (!b) return;
        { const eb = ents.get(f.b); if (eb && a) { eb.kbT = t; eb.kbD = b.x >= a.x ? 1 : -1; } }
        burst(b.x, b.y - 0.7, f.c ? 14 : 7, f.c ? "181,52,42" : "22,20,15", f.c ? 1.4 : 1);
        if (f.c && mine) shake = Math.max(shake, 5);
        if (f.k === "h" && a) { const cls = meta[f.a] && meta[f.a].c; fx.push({ k: RANGED[cls] ? (cls === "mage" ? "orb" : "arrow") : "slash", a, b, t0: t, life: RANGED[cls] ? 220 : 260 }); }
        floaters.push({ x: b.x + (Math.random() - 0.5) * 0.5, y: b.y - 1.1, text: String(f.d), col: f.c ? "#b5342a" : mine ? "#16140f" : "#6d675b", size: f.c ? 24 : mine ? 18 : 13, t0: t, life: f.c ? 1100 : 850, crit: !!f.c, kai: true });
        return;
      }
      case "m": if (!b) return; float(b.x, b.y - 1.6, "-" + f.d, "#b5342a", 16); { const eb = ents.get(f.b); if (eb && a) { eb.kbT = t; eb.kbD = b.x >= a.x ? 1 : -1; } } burst(b.x, b.y - 0.8, 5, "181,52,42", 0.8); if (f.b === myId) shake = Math.max(shake, 6); return;
      case "sk": {
        const caster = a || { x: f.x, y: f.y }, tb = f.b ? posOf(f.b) : null;
        let life = 650;
        if (f.type === "dir") life = f.dash ? 420 : (f.len / (f.spd || 14)) * 1000 + 220;
        else if (f.type === "ground") life = (f.t || 0) + 600 * ((f.ticks || 1) - 1) + 750;
        else if (f.s === "whirl") life = 900;
        else if (f.type === "target") life = 700;
        fx.push({ ...f, k: "sk", a: { x: caster.x, y: caster.y }, tb: tb ? { x: tb.x, y: tb.y } : { x: f.x, y: f.y }, t0: t, life });
        const later = (ms, fn) => setTimeout(fn, ms);
        if (f.s === "thunder") later(f.t || 0, () => { flash = 1; burst(f.x, f.y - 0.3, 22, "40,52,110", 2); });
        else if (f.type === "ground") later(f.t || 0, () => burst(f.x, f.y - 0.3, 18, f.s === "inferno" ? "181,52,42" : "22,20,15", 1.8));
        if (f.a === myId && f.type !== "self") shake = Math.max(shake, f.type === "ground" ? 5 : 3);
        if (f.dash && f.a === myId) shake = Math.max(shake, 4);
        return;
      }
      case "tick": fx.push({ k: "tick", s: f.s, x: f.x, y: f.y, r: f.r, t0: t, life: 520 }); burst(f.x, f.y - 0.3, 12, f.s === "inferno" ? "181,52,42" : "22,20,15", 1.4); return;
      case "dot": if (b) float(b.x + 0.3, b.y - 1.0, String(f.d), "#3f7a2c", 13, 800); return;
      case "heal": if (b) { if (f.d) float(b.x, b.y - 1.3, "+" + f.d, "#3f7a52", 15); if (f.m) float(b.x + 0.3, b.y - 1.0, "+" + f.m, "#3a4f86", 13); fx.push({ k: "heal", b, t0: t, life: 600 }); } return;
      case "lvl": if (b) { floaters.push({ x: b.x, y: b.y - 2.3, text: "升級", col: "#a8832a", size: 30, t0: t, life: 1800, kai: true }); fx.push({ k: "lvl", b, t0: t, life: 1400 }); burst(b.x, b.y - 1, 24, "168,131,42", 1.6); } return;
      case "kill": if (b) { fx.push({ k: "ink", b, t0: t, life: 800 }); burst(b.x, b.y - 0.5, 18, "22,20,15", 1.6); const ed = ents.get(f.b); if (ed) ed.dieT = t; } return;
      case "gold": if (mine && b) float(b.x + 0.4, b.y - 0.6, `+${f.d} 兩`, "#a8832a", 13, 1100); return;
      case "loot": if (b) float(b.x, b.y - 0.3, f.n, RAR_COLOR[f.r || 0], 14, 1500); if (mine) addChat({ sys: true, text: `獲得「${f.n}」` }); return;
      case "warn": fx.push({ k: "warn", b: { x: f.x, y: f.y }, r: f.r, t0: t, life: f.t }); return;
      case "slam": fx.push({ k: "slam", b: { x: f.x, y: f.y }, r: f.r, t0: t, life: 450 }); shake = Math.max(shake, 11); burst(f.x, f.y, 26, "22,20,15", 2.2); return;
      case "die": if (f.b === myId) $(".mo-dead").hidden = false; return;
    }
  }

  // ------------------------------------------------------------ 墨點飛濺（打擊感）
  let sparks = [], flash = 0;
  function burst(x, y, n, rgb, power = 1) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (1.5 + Math.random() * 3.5) * power; sparks.push({ x: x * TS, y: y * TS, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2 * power, r: 1.2 + Math.random() * 2.8 * Math.min(1.5, power), life: 380 + Math.random() * 360, t0: performance.now(), rgb }); }
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  }
  function drawSparks(t, dt) {
    sparks = sparks.filter((p) => t - p.t0 < p.life);
    for (const p of sparks) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.28 * dt; p.vx *= 0.96;
      const k = (t - p.t0) / p.life; g.fillStyle = `rgba(${p.rgb},${0.85 * (1 - k)})`;
      g.beginPath(); g.ellipse(p.x, p.y, p.r * (1 - k * 0.5), p.r * (1 - k * 0.5) * 0.8, 0, 0, 7); g.fill();
    }
  }
  // ------------------------------------------------------------ 畫面
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    zoom = Math.max(0.55, Math.min(1.25, W / ((W < 640 ? 11 : 18) * TS)));
  }
  const ro = new ResizeObserver(resize); ro.observe(cv); resize();
  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#e8e1cf"; g.fillRect(0, 0, cv.width, cv.height);
    if (!map || !mapCv) return;
    for (const e of ents.values()) { const k = Math.min(1, (t - e.t0) / 110); e.x = e.fx + (e.tx - e.fx) * k; e.y = e.fy + (e.ty - e.fy) * k; }
    const meE = ents.get(myId);
    if (meE) { cam.x += (meE.x - cam.x) * 0.25; cam.y += (meE.y - cam.y) * 0.25; if (Math.abs(meE.x - cam.x) > 8) { cam.x = meE.x; cam.y = meE.y; } }
    const vw = W / zoom / TS, vh = H / zoom / TS;
    const cx = Math.max(vw / 2, Math.min(map.w - vw / 2, cam.x)), cy = Math.max(vh / 2, Math.min(map.h - vh / 2, cam.y));
    const ox = map.w < vw ? map.w / 2 : cx, oy = map.h < vh ? map.h / 2 : cy;
    let sx = 0, sy = 0; if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; shake *= 0.85; if (shake < 0.5) shake = 0; }
    view = { ox, oy, vw, vh };
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, (W / 2 - ox * TS * zoom + sx) * dpr, (H / 2 - oy * TS * zoom + sy) * dpr);
    g.imageSmoothingEnabled = true;
    g.drawImage(mapCv, 0, 0);
    for (const p of map.portals) label(g, p.x * TS + TS / 2, p.y * TS - TS * 0.95, p.label, "#b5342a", 13, true);
    // 點地上的漣漪
    if (clickMark && t - clickMark.t0 < 500) { const k = (t - clickMark.t0) / 500; g.strokeStyle = `rgba(22,20,15,${0.6 * (1 - k)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(clickMark.x * TS, clickMark.y * TS, 6 + 14 * k, (6 + 14 * k) * 0.45, 0, 0, 7); g.stroke(); }
    // 目標圈（朱砂）
    const tg = me && me.tgt && ents.get(me.tgt);
    if (tg) { const r = (meta[tg.id] && meta[tg.id].boss ? 30 : 17) ; g.strokeStyle = "rgba(181,52,42,.85)"; g.lineWidth = 2.2; g.setLineDash([5, 4]); g.lineDashOffset = -t / 40; g.beginPath(); g.ellipse(tg.x * TS, tg.y * TS + 2, r, r * 0.42, 0, 0, 7); g.stroke(); g.setLineDash([]); }
    if (aiming && meE && mouseW && !me.dead) drawAim(meE, aiming.s, mouseW);
    // 底層特效（警示圈）
    for (const f of fx) if (f.k === "warn") { const k = Math.min(1, (t - f.t0) / f.life); g.fillStyle = `rgba(181,52,42,${0.12 + 0.18 * k})`; g.strokeStyle = "rgba(181,52,42,.8)"; g.lineWidth = 2; g.beginPath(); g.ellipse(f.b.x * TS, f.b.y * TS, f.r * TS * k, f.r * TS * k * 0.55, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(f.b.x * TS, f.b.y * TS, f.r * TS, f.r * TS * 0.55, 0, 0, 7); g.stroke(); }
    // 人物、怪物、NPC 依 y 排序
    const list = [];
    for (const e of ents.values()) list.push(e);
    for (const n of map.npcs) list.push({ npc: n, x: n.x, y: n.y });
    for (const f of folk) { stepFolk(f, t); list.push({ folk: f, x: f.x, y: f.y }); }
    if (mapCv.props) for (const p of mapCv.props) { const px = p.x / TS, py = p.y / TS; if (Math.abs(px - ox) < vw / 2 + 4 && py > oy - vh / 2 - 1 && py - p.h / TS < oy + vh / 2 + 1) list.push({ prop: p, x: px, y: py }); }
    list.sort((a, b) => a.y - b.y);
    for (const e of list) {
      const x = e.x * TS, y = e.y * TS;
      if (e.prop) {
        const p = e.prop; let alpha = 1;
        if (meE && p.y > meE.y * TS + 2 && Math.abs(meE.x * TS - p.x) < p.w * 0.42 && meE.y * TS > p.y - p.h * 0.9) alpha = 0.42;   // 擋到自己就半透明
        drawArt(g, p.n, p.x, p.y, p.w, p.h, { face: p.face, alpha, tone: p.n.startsWith("t_") || p.n === "e_hall" || p.n.startsWith("e_house") ? "b" : "d" });
        continue;
      }
      if (Math.abs(e.x - ox) > vw / 2 + 3 || Math.abs(e.y - oy) > vh / 2 + 3) continue;
      if (e.folk && PET[e.folk.art] && hasAnim(`a_${PET[e.folk.art].key}_walk`)) {
        const f = e.folk, P = PET[f.art], A = `a_${P.key}_${f.moving ? "walk" : "idle"}`;
        g.fillStyle = "rgba(22,20,15,.18)"; g.beginPath(); g.ellipse(x, y + 2, 13 * P.sz, 4.5 * P.sz, 0, 0, 7); g.fill();
        if (!drawAnim(g, A, x, y + 3, TS * P.sz, TS * P.sz * 0.85, { face: f.face, t: t + f.ph * 997, ref: f.moving ? P.walkRef : f.art })) drawArt(g, f.art, x, y + 3, TS * P.sz, TS * P.sz * 0.85, { face: f.face });
        continue;
      }
      if (e.folk) { const f = e.folk, small = FOLK_SMALL[f.art]; g.fillStyle = "rgba(22,20,15,.18)"; g.beginPath(); g.ellipse(x, y + 2, small ? 11 : 16, small ? 4 : 6, 0, 0, 7); g.fill(); drawArt(g, f.art, x, y + 3 - (f.moving ? Math.abs(Math.sin(t / 110 + f.ph)) * 2.2 : 0), small ? TS * 0.9 : TS * 1.35, small ? TS * 0.75 : TS * 1.7, { face: f.face, sy: f.moving ? 1 : 1 + Math.sin(t / 800 + f.ph) * 0.01 }); continue; }
      if (e.npc && hasArt(NPC_ART[e.npc.kind])) { const face = meE && Math.abs(meE.x - e.x) > 0.2 ? (meE.x > e.x ? 1 : -1) : 1; g.fillStyle = "rgba(22,20,15,.22)"; g.beginPath(); g.ellipse(x, y + 2, 20, 7, 0, 0, 7); g.fill(); if (!drawAnim(g, `a_${e.npc.kind}_idle`, x, y + 4, TS * 1.7, TS * 2, { face, t: t + x * 7, ref: NPC_ART[e.npc.kind] })) drawArt(g, NPC_ART[e.npc.kind], x, y + 4, TS * 1.7, TS * 2, { face, sy: 1 + Math.sin(t / 700 + x) * 0.008 }); label(g, x, y - TS * 2 - 6, e.npc.name, "#b5342a", 13, true); const bob = Math.sin(t / 300) * 2; g.fillStyle = "#b5342a"; g.beginPath(); g.moveTo(x, y - TS * 2 - 18 + bob); g.lineTo(x - 5, y - TS * 2 - 26 + bob); g.lineTo(x + 5, y - TS * 2 - 26 + bob); g.closePath(); g.fill(); continue; }
      if (e.npc) { const face = meE && Math.abs(meE.x - e.x) > 0.2 ? (meE.x > e.x ? 1 : -1) : 1; drawPlayer(g, x, y, null, t, { npc: e.npc.kind, face }); label(g, x, y - 54, e.npc.name, "#b5342a", 12, true); const bob = Math.sin(t / 300) * 2; g.fillStyle = "#b5342a"; g.beginPath(); g.moveTo(x, y - 62 + bob); g.lineTo(x - 5, y - 70 + bob); g.lineTo(x + 5, y - 70 + bob); g.closePath(); g.fill(); continue; }
      const md = meta[e.id]; if (!md) continue;
      const atk = e.atkT && t - e.atkT < 280 ? (t - e.atkT) / 280 : 0, hurt = e.hurtT && t - e.hurtT < 130;
      const alpha = e.gone ? Math.max(0, 1 - (t - e.gone) / 500) : 1; g.globalAlpha = alpha;
      if (md.k === "p") {
        const isMe = e.id === myId, mate = me && md.pt && party.some((q) => q.id === e.id);
        if (e.fl & 2) { g.strokeStyle = "rgba(168,131,42,.8)"; g.lineWidth = 2.5; g.beginPath(); g.ellipse(x, y - 18, 20, 26, 0, 0, 7); g.stroke(); }
        if (e.fl & 4) { g.strokeStyle = "rgba(64,96,90,.5)"; g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const yy = y - 8 - i * 10; g.beginPath(); g.moveTo(x - 18 - ((t / 4 + i * 20) % 20), yy); g.lineTo(x - 30 - ((t / 4 + i * 20) % 20), yy); g.stroke(); } }
        if (isMe) { g.strokeStyle = "rgba(181,52,42,.6)"; g.lineWidth = 1.8; g.beginPath(); g.ellipse(x, y + 2, 22, 8, 0, 0, 7); g.stroke(); }
        let top = y - 54;
        const pk = md.ad && hasArt("p_" + md.ad) ? md.ad : md.c;      // 轉職後換外觀
        if (hasArt("p_" + pk)) {
          const dead = !!(e.fl & 1), walk = e.moving ? Math.sin(t / 85) : 0, kb = e.kbT && t - e.kbT < 160 ? (1 - (t - e.kbT) / 160) * 5 * e.kbD : 0;
          g.fillStyle = "rgba(22,20,15,.25)"; g.beginPath(); g.ellipse(x, y + 2, 19, 7, 0, 0, 7); g.fill();
          const A_ATK = `a_${pk}_atk`, A_WALK = `a_${pk}_walk`, A_IDLE = `a_${pk}_idle`, face = e.face || 1;
          const atkLen = hasAnim(A_ATK) ? animMs(A_ATK) : 0, inAtk = atkLen && e.atkT && t - e.atkT < atkLen;
          let drawn = null;
          if (!dead && inAtk) drawn = drawAnim(g, A_ATK, x + kb, y + 4, TS * 2.1, TS * 1.95, { face, t: t - e.atkT, hurt, ref: "p_" + pk });
          else if (!dead && e.moving && hasAnim(A_WALK)) drawn = drawAnim(g, A_WALK, x + kb, y + 4 - Math.abs(walk) * 2, TS * 2.1, TS * 1.95, { face, t: t + e.id * 37, hurt, ref: "p_" + pk });
          else if (!dead && !e.moving && hasAnim(A_IDLE)) drawn = drawAnim(g, A_IDLE, x + kb, y + 4, TS * 2.1, TS * 1.95, { face, t: t + e.id * 37, hurt, ref: "p_" + pk });
          if (!drawn) {
            const name = atk > 0 && atk < 0.9 && hasArt(`p_${pk}_atk`) ? `p_${pk}_atk` : "p_" + pk;
            drawArt(g, name, x + kb + (atk ? Math.sin(atk * Math.PI) * 6 * face : 0), y + 4 - Math.abs(walk) * 3, TS * 2.1, TS * 1.95,
              { face, rot: dead ? -1.45 * face : walk * 0.035, alpha: dead ? 0.5 : 1, hurt, sy: e.moving ? 1 : 1 + Math.sin(t / 650) * 0.01 });
          }
          top = y - TS * 1.95 - 4;
        } else drawPlayer(g, x, y, md.c, t, { moving: e.moving, dead: !!(e.fl & 1), face: e.face || 1, atk, hurt });
        nameTag(g, x, top - 12, md.n, md.lv, isMe ? "#16140f" : mate ? "#3f7a52" : "#4d493f", isMe);
        hpBar(g, x, top - 6, 44, e.hp, "#c0392b");
        hpBar(g, x, top + 1, 44, e.mpp ?? 100, "#3a5fb0");
      } else {
        const s = md.boss ? 2.1 : 1, A = MOB_ART[md.s];
        if (md.boss) bossAura(g, x, y, t, s);
        let top = y - (md.boss ? 86 : 42);
        if (A && hasArt(A[0])) {
          const kb = e.kbT && t - e.kbT < 160 ? (1 - (t - e.kbT) / 160) * 7 * e.kbD : 0, fl = FLOAT[md.s] ? FLOAT[md.s] * TS + Math.sin(t / 300 + e.id) * 4 : 0;
          const lunge = atk ? Math.sin(atk * Math.PI) : 0, bob = Math.sin(t / 260 + e.id) * 1.5;
          g.fillStyle = `rgba(22,20,15,${fl ? 0.15 : 0.25})`; g.beginPath(); g.ellipse(x, y + 2, A[1] * TS * 0.32, A[1] * TS * 0.11, 0, 0, 7); g.fill();
          const mo = { face: e.face || 1, hurt, rot: e.gone ? Math.min(1, (t - e.gone) / 500) * 1.2 * (e.face || 1) : 0 };
          const MA = `a_${md.s}_atk`, MI = `a_${md.s}_idle`, mAtk = md.boss && hasAnim(MA) && e.atkT && t - e.atkT < animMs(MA);
          let dm = null;
          if (mAtk) dm = drawAnim(g, MA, x + kb, y + 3 - fl, A[1] * TS, A[2] * TS, { ...mo, t: t - e.atkT, ref: A[0] });
          else if (hasAnim(MI)) dm = drawAnim(g, MI, x + kb + lunge * 8 * mo.face, y + 3 - fl + (e.moving ? bob : 0), A[1] * TS, A[2] * TS, { ...mo, t: t + e.id * 53, sx: 1 + lunge * 0.08, sy: 1 - lunge * 0.06, ref: A[0] });
          if (!dm) drawArt(g, A[0], x + kb + lunge * 8 * mo.face, y + 3 - fl + bob, A[1] * TS, A[2] * TS, { ...mo, sx: 1 + lunge * 0.08, sy: 1 - lunge * 0.06 + (e.moving ? Math.abs(Math.sin(t / 110)) * 0.03 : 0) });
          top = y - A[2] * TS - fl + 2;
        } else drawMob(g, x, y, md.s, t, s, hurt, e.face || 1, atk);
        if (e.fl & 64) { g.strokeStyle = "rgba(90,150,200,.8)"; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y + 2, 20, 7, 0, 0, 7); g.stroke(); }
        if (e.fl & 32) { for (let i = 0; i < 3; i++) { const a = t / 250 + i * 2.1; g.fillStyle = "#d9a632"; g.beginPath(); g.arc(x + Math.cos(a) * 14, top - 22 + Math.sin(a) * 4, 3, 0, 7); g.fill(); } }
        if (md.boss) label(g, x, top - 10, `${md.n}`, "#b5342a", 20, true, KAI);
        else nameTag(g, x, top - 7, md.n, md.lv, (e.fl & 8) ? "#7a2a22" : "#4d493f", false);
        hpBar(g, x, top, md.boss ? 90 : 36, e.hp, "#c0392b");
        if (e.fl & 16) label(g, x, top - 22, "蓄力！", "#b5342a", 16, true);
      }
      if (e.say && t - e.sayT < 4500) bubble(g, x, y - (md.k === "p" ? 70 : 60), e.say);
      g.globalAlpha = 1;
    }
    // 上層特效
    fx = fx.filter((f) => t - f.t0 < f.life);
    for (const f of fx) drawFx(f, t);
    drawSparks(t, Math.min(3, (t - (frame.lt || t)) / 16.7)); frame.lt = t;
    floaters = floaters.filter((f) => t - f.t0 < f.life);
    for (const f of floaters) {
      const k = (t - f.t0) / f.life, pop = k < 0.15 ? 1 + 0.5 * (1 - k / 0.15) : 1, x = f.x * TS, y = f.y * TS - k * 36;
      g.globalAlpha = 1 - k * k;
      if (f.crit) { g.save(); g.translate(x - f.size * 0.95, y - f.size * 0.38); g.rotate(-0.12); g.fillStyle = "#b5342a"; g.beginPath(); g.roundRect(-9, -9, 18, 18, 2); g.fill(); g.fillStyle = "#f6efe0"; g.font = `700 13px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("暴", 0, 1); g.textBaseline = "alphabetic"; g.restore(); }
      label(g, x, y, f.text, f.col, Math.round(f.size * pop), true, f.kai ? KAI : undefined);
      g.globalAlpha = 1;
    }
    atmosphere(t);
    if (flash > 0) { g.fillStyle = `rgba(250,248,240,${flash * 0.5})`; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - 0.12); }
    // 小地圖
    if (miniBase) {
      mg.clearRect(0, 0, mini.width, mini.height); mg.drawImage(miniBase, 0, 0);
      const s = Math.min(mini.width / map.w, mini.height / map.h);
      for (const e of ents.values()) { const md = meta[e.id]; if (!md) continue; mg.fillStyle = e.id === myId ? "#b5342a" : md.k === "p" ? "#3a4f86" : md.boss ? "#7a2a22" : "rgba(22,20,15,.45)"; const r = e.id === myId || md.boss ? 2.6 : 1.4; mg.beginPath(); mg.arc(e.x * s, e.y * s, r, 0, 7); mg.fill(); }
      mg.strokeStyle = "rgba(22,20,15,.5)"; mg.strokeRect((ox - vw / 2) * s, (oy - vh / 2) * s, vw * s, vh * s);
    }
    // 走到 NPC 旁邊就自動打開
    if (pendingNpc && meE) { const n = map.npcs.find((q) => q.id === pendingNpc); if (n && Math.hypot(n.x - meE.x, n.y - meE.y) < 4) { send({ a: "npc", id: n.id }); pendingNpc = null; } }
    tickHud(t);
  }
  let view = { ox: 0, oy: 0, vw: 1, vh: 1 };
  // ------------------------------------------------------------ 氣氛：落葉、花瓣、山嵐、鬼火＋四周暈染（畫在螢幕座標）
  let parts = [], partsInit = false, lastT = 0;
  function newPart(th, anywhere) {
    const P = { th, x: Math.random() * W, y: anywhere ? Math.random() * H : -20, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.04 };
    if (th === "bamboo") Object.assign(P, { vx: -0.35 - Math.random() * 0.6, vy: 0.35 + Math.random() * 0.5, sz: 6 + Math.random() * 6, a: 0.35 + Math.random() * 0.3 });
    else if (th === "town") Object.assign(P, { vx: 0.2 + Math.random() * 0.5, vy: 0.25 + Math.random() * 0.4, sz: 2.2 + Math.random() * 2, a: 0.35 + Math.random() * 0.35 });
    else if (th === "mount") Object.assign(P, { x: anywhere ? Math.random() * W : -400, y: Math.random() * H, vx: 0.12 + Math.random() * 0.2, vy: 0, sz: 220 + Math.random() * 260, a: 0.16 + Math.random() * 0.12 });
    else if (th === "snow") Object.assign(P, { vx: -0.25 + Math.random() * 0.3, vy: 0.45 + Math.random() * 0.7, sz: 1.6 + Math.random() * 2.6, a: 0.55 + Math.random() * 0.4 });
    else if (th === "fire" || th === "demon") Object.assign(P, { y: anywhere ? Math.random() * H : H + 20, vx: (Math.random() - 0.5) * 0.5, vy: -0.4 - Math.random() * 0.7, sz: 1.4 + Math.random() * 2.2, a: 0.5 + Math.random() * 0.45, ph: Math.random() * 6 });
    else Object.assign(P, { y: anywhere ? Math.random() * H : H + 20, vx: (Math.random() - 0.5) * 0.2, vy: -0.15 - Math.random() * 0.3, sz: 2 + Math.random() * 2.5, a: 0.5 + Math.random() * 0.4, ph: Math.random() * 6 });
    return P;
  }
  function atmosphere(t) {
    const dt = Math.min(3, lastT ? (t - lastT) / 16.7 : 1); lastT = t;
    const th = map.theme, want = th === "bamboo" ? 22 : th === "town" ? 14 : th === "mount" ? 5 : th === "snow" ? 60 : th === "fire" ? 26 : 16;
    while (parts.length < want) parts.push(newPart(th, !partsInit));
    partsInit = true;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of parts) {
      p.x += p.vx * dt + (th === "bamboo" ? Math.sin(t / 700 + p.r) * 0.3 : 0); p.y += p.vy * dt; p.r += p.vr * dt;
      if (th === "bamboo") { g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = `rgba(32,56,46,${p.a})`; g.beginPath(); g.moveTo(-p.sz / 2, 0); g.quadraticCurveTo(0, -p.sz * 0.22, p.sz / 2, 0); g.quadraticCurveTo(0, p.sz * 0.16, -p.sz / 2, 0); g.fill(); g.restore(); }
      else if (th === "town") { g.fillStyle = `rgba(190,80,70,${p.a})`; g.beginPath(); g.ellipse(p.x, p.y, p.sz, p.sz * 0.6, p.r, 0, 7); g.fill(); }
      else if (th === "snow") { g.fillStyle = `rgba(255,255,255,${p.a})`; g.beginPath(); g.arc(p.x + Math.sin(t / 600 + p.r * 3) * 6, p.y, p.sz, 0, 7); g.fill(); }
      else if (th === "fire" || th === "demon") { const fl = 0.6 + 0.4 * Math.sin(t / 120 + p.ph); g.fillStyle = th === "fire" ? `rgba(255,${120 + Math.floor(p.ph * 15)},40,${p.a * fl})` : `rgba(170,30,30,${p.a * fl})`; g.beginPath(); g.arc(p.x + Math.sin(t / 400 + p.ph) * 4, p.y, p.sz, 0, 7); g.fill(); }
      else if (th === "mount") { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.sz); gr.addColorStop(0, `rgba(248,244,232,${p.a})`); gr.addColorStop(1, "rgba(248,244,232,0)"); g.fillStyle = gr; g.fillRect(p.x - p.sz, p.y - p.sz * 0.4, p.sz * 2, p.sz * 0.8); }
      else { const fl = 0.6 + 0.4 * Math.sin(t / 200 + p.ph); const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.sz * 4); gr.addColorStop(0, `rgba(170,240,220,${p.a * fl})`); gr.addColorStop(1, "rgba(120,200,180,0)"); g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.sz * 4, 0, 7); g.fill(); }
    }
    parts = parts.filter((p) => p.x > -500 && p.x < W + 500 && p.y > -40 && p.y < H + 40);
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(40,30,15,0)"); vg.addColorStop(1, th === "tomb" || th === "tower" ? "rgba(20,16,10,.5)" : th === "snow" ? "rgba(90,110,130,.22)" : th === "fire" ? "rgba(120,30,10,.32)" : th === "demon" ? "rgba(60,10,10,.45)" : "rgba(60,44,20,.24)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    // 整個畫面疊一層宣紙紋理：人物、建築、地面都染上同一張紙的質感，看起來才像畫在同一幅畫裡
    if (paperImg.complete && paperImg.naturalWidth) {
      if (!paperPat) { const pc = document.createElement("canvas"); pc.width = 576; pc.height = 864; pc.getContext("2d").drawImage(paperImg, 0, 0, 576, 864); paperPat = g.createPattern(pc, "repeat"); }
      g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = 0.13; g.fillStyle = paperPat;
      g.translate(-(cam.x * TS) % 576, -(cam.y * TS) % 864); g.fillRect(0, 0, W + 576, H + 864); g.restore();
    }
  }
  let paperPat = null;
  function bubble(g2, x, y, text) {
    g2.font = `13px "LXGW WenKai TC","Noto Serif TC",serif`;
    const s = text.length > 18 ? text.slice(0, 18) + "…" : text, w = g2.measureText(s).width + 14;
    g2.fillStyle = "rgba(244,238,222,.95)"; g2.strokeStyle = "rgba(22,20,15,.6)"; g2.lineWidth = 1;
    g2.beginPath(); g2.roundRect(x - w / 2, y - 22, w, 20, 3); g2.fill(); g2.stroke();
    g2.fillStyle = "#16140f"; g2.textAlign = "center"; g2.fillText(s, x, y - 7);
  }
  function drawFx(f, t) {
    const k = (t - f.t0) / f.life, P = (p) => [p.x * TS, p.y * TS - (USE_PROPS ? 40 : 18)];
    g.lineCap = "round";
    switch (f.k) {
      case "arrow": case "orb": { const [ax, ay] = P(f.a), [bx, by] = P(f.b), x = ax + (bx - ax) * k, y = ay + (by - ay) * k; if (f.k === "orb") { g.fillStyle = "rgba(64,140,120,.85)"; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } else { const a = Math.atan2(by - ay, bx - ax); g.strokeStyle = "#16140f"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a) * 16, y - Math.sin(a) * 16); g.stroke(); } return; }
      case "slash": {
        const [bx, by] = P(f.b);
        if (brushImg.complete) { g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = 1 - k; g.translate(bx, by - 8); g.rotate(-0.7 + k * 0.3); g.drawImage(brushImg, -38 + k * 10, -16, 76, 32); g.restore(); }
        else { const a0 = -2.5 + k * 0.8, a1 = -0.5 + k * 0.8; g.fillStyle = `rgba(22,20,15,${0.75 * (1 - k)})`; g.beginPath(); g.arc(bx, by, 20, a0, a1); g.arc(bx + 3, by + 3, 14, a1, a0, true); g.closePath(); g.fill(); }
        return;
      }
      case "heal": { const [bx, by] = P(f.b); g.strokeStyle = `rgba(63,122,82,${0.8 * (1 - k)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(bx, by + 18, 14 + 10 * k, (14 + 10 * k) * 0.4, 0, 0, 7); g.stroke(); for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(63,122,82,${1 - k})`; g.fillRect(bx - 12 + i * 6, by + 10 - k * 30 - (i % 2) * 8, 2, 6); } return; }
      case "lvl": { const [bx, by] = P(f.b); const col = g.createLinearGradient(0, by - 140, 0, by + 30); col.addColorStop(0, "rgba(232,200,110,0)"); col.addColorStop(1, `rgba(232,200,110,${0.45 * (1 - k)})`); g.fillStyle = col; g.fillRect(bx - 26 * (1 - k * 0.5), by - 140, 52 * (1 - k * 0.5), 170); for (let i = 0; i < 2; i++) { const kk = Math.min(1, k * 1.4 - i * 0.3); if (kk <= 0) continue; g.strokeStyle = `rgba(168,131,42,${1 - kk})`; g.lineWidth = 3; g.beginPath(); g.ellipse(bx, by + 18, 10 + 40 * kk, (10 + 40 * kk) * 0.45, 0, 0, 7); g.stroke(); } return; }
      case "ink": { const [bx, by] = P(f.b); g.fillStyle = `rgba(22,20,15,${0.35 * (1 - k)})`; g.beginPath(); g.ellipse(bx, by + 16, 10 + 14 * k, (10 + 14 * k) * 0.45, 0, 0, 7); g.fill(); g.fillStyle = `rgba(22,20,15,${0.6 * (1 - k)})`; for (let i = 0; i < 9; i++) { const a = i * 0.7 + (f.t0 % 7), r = 10 + 30 * k * (0.6 + (i % 3) * 0.25); g.beginPath(); g.arc(bx + Math.cos(a) * r, by + 10 + Math.sin(a) * r * 0.55 - 10 * Math.sin(k * Math.PI), (3.5 - (i % 3)) * (1 - k) + 0.8, 0, 7); g.fill(); } return; }
      case "slam": { const x = f.b.x * TS, y = f.b.y * TS; g.strokeStyle = `rgba(22,20,15,${0.8 * (1 - k)})`; g.lineWidth = 6 * (1 - k) + 1; g.beginPath(); g.ellipse(x, y, f.r * TS * (0.6 + 0.4 * k), f.r * TS * 0.55 * (0.6 + 0.4 * k), 0, 0, 7); g.stroke(); return; }
      case "sk": return drawSkill(f, k);
      case "tick": { const cx = f.x * TS, cy = f.y * TS, R = f.r * TS; g.fillStyle = `rgba(181,52,42,${0.25 * (1 - k)})`; g.beginPath(); g.arc(cx, cy, R * (0.7 + 0.3 * k), 0, 7); g.fill(); return; }
    }
  }
  // 技能特效：f.x/f.y＝起點或中心；f.dx/f.dy/f.len＝方向與長度；f.tb＝指定目標的位置；f.r＝範圍
  function brushArc(x, y, r, a0, n, alpha) { if (!brushImg.complete) return; g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = alpha; g.translate(x, y); for (let i = 0; i < n; i++) { g.save(); g.rotate(a0 + i * 0.6); g.drawImage(brushImg, r - 30, -14, 60, 28); g.restore(); } g.restore(); }
  function arrowAt(x, y, a, len = 20, col = "#16140f") { g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a) * len, y - Math.sin(a) * len); g.stroke(); g.fillStyle = col; g.beginPath(); g.moveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); g.lineTo(x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6); g.lineTo(x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6); g.fill(); }
  function drawSkill(f, k) {
    const el = performance.now() - f.t0, ax = f.a.x * TS, ay = f.a.y * TS - 30, H = 30;
    if (f.type === "dir" && !f.dash) {
      const fly = (f.len / (f.spd || 14)) * 1000, p = Math.min(1, el / fly), fade = el > fly ? 1 - (el - fly) / 220 : 1;
      const ox = f.x * TS, oy = f.y * TS - H, hx = ox + f.dx * f.len * TS * p, hy = oy + f.dy * f.len * TS * p, a = Math.atan2(f.dy, f.dx);
      g.globalAlpha = Math.max(0, fade);
      if (f.s === "qi") { g.save(); g.translate(hx, hy); g.rotate(a); g.fillStyle = "rgba(60,80,130,.75)"; g.beginPath(); g.arc(0, 0, 26, -1.2, 1.2); g.arc(-10, 0, 22, 1.1, -1.1, true); g.closePath(); g.fill(); g.restore(); g.strokeStyle = "rgba(60,80,130,.25)"; g.lineWidth = 14; g.beginPath(); g.moveTo(hx - f.dx * 60, hy - f.dy * 60); g.lineTo(hx, hy); g.stroke(); }
      else if (f.s === "ice") { g.save(); g.translate(hx, hy); g.rotate(a); g.fillStyle = "rgba(150,200,230,.95)"; g.strokeStyle = "#2b4a6b"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(14, 0); g.lineTo(-10, -6); g.lineTo(-6, 0); g.lineTo(-10, 6); g.closePath(); g.fill(); g.stroke(); g.restore(); g.strokeStyle = "rgba(200,230,250,.6)"; g.lineWidth = 5; g.beginPath(); g.moveTo(hx - f.dx * 40, hy - f.dy * 40); g.lineTo(hx, hy); g.stroke(); }
      else if (f.s === "dragon") { for (let i = 0; i < 9; i++) { const q = Math.max(0, p - i * 0.035), x = ox + f.dx * f.len * TS * q, y = oy + f.dy * f.len * TS * q + Math.sin(el / 60 + i) * 6, rr = (16 - i * 1.3); g.fillStyle = `rgba(${200 - i * 6},${70 + i * 12},40,${0.75 - i * 0.06})`; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); } }
      else arrowAt(hx, hy, a, f.s === "pierce" ? 30 : 20, f.s === "pierce" ? "#2b2620" : "#16140f");
      g.globalAlpha = 1; return;
    }
    if (f.type === "dir" && f.dash) {
      const ox = f.x * TS, oy = f.y * TS - H, ex = ox + f.dx * f.len * TS, ey = oy + f.dy * f.len * TS;
      g.strokeStyle = `rgba(22,20,15,${0.55 * (1 - k)})`; g.lineWidth = 16 * (1 - k) + 2; g.lineCap = "round"; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke();
      for (let i = 1; i <= 3; i++) { const q = i / 4; g.fillStyle = `rgba(22,20,15,${0.18 * (1 - k)})`; g.beginPath(); g.ellipse(ox + (ex - ox) * q, oy + (ey - oy) * q + 10, 14, 26, 0, 0, 7); g.fill(); }
      return;
    }
    if (f.type === "ground") {
      const cx = f.x * TS, cy = f.y * TS, R = f.r * TS, d = f.t || 0;
      if (el < d) { const q = el / d; g.fillStyle = `rgba(181,52,42,${0.1 + 0.15 * q})`; g.strokeStyle = "rgba(181,52,42,.7)"; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * q, 0, 7); g.fill(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); return; }
      const kk = Math.min(1, (el - d) / 650);
      if (f.s === "thunder") { g.fillStyle = `rgba(58,79,134,${0.2 * (1 - kk)})`; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.strokeStyle = `rgba(30,40,90,${1 - kk})`; g.lineWidth = 3; for (let i = 0; i < 4; i++) { let x = cx + (i - 1.5) * R * 0.45, y = cy - 200; g.beginPath(); g.moveTo(x, y); while (y < cy + (i % 2) * 10) { y += 22; x += (Math.random() - 0.5) * 22; g.lineTo(x, y); } g.stroke(); } }
      else if (f.s === "rain") { g.fillStyle = `rgba(22,20,15,${0.1 * (1 - kk)})`; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); for (let i = 0; i < 18; i++) { const a = i * 2.39, rr = R * Math.sqrt(((i * 37) % 17) / 17), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr - 70 * (1 - kk); g.globalAlpha = 1 - kk; arrowAt(x, y, Math.PI / 2, 16); } g.globalAlpha = 1; }
      else if (f.s === "inferno" || f.s === "net" || f.s === "leap") {
        g.fillStyle = f.s === "inferno" ? `rgba(181,52,42,${0.18 * (1 - kk * 0.5)})` : `rgba(22,20,15,${0.12 * (1 - kk)})`; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
        if (f.s === "net") { g.strokeStyle = `rgba(60,50,35,${0.8 * (1 - kk)})`; g.lineWidth = 1.4; for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(cx + i * R / 4 - R, cy - R); g.lineTo(cx + i * R / 4 + R, cy + R); g.moveTo(cx + i * R / 4 + R, cy - R); g.lineTo(cx + i * R / 4 - R, cy + R); g.stroke(); } g.beginPath(); g.arc(cx, cy, R, 0, 7); g.lineWidth = 2.5; g.stroke(); }
        else if (f.s === "leap") { g.strokeStyle = `rgba(22,20,15,${0.8 * (1 - kk)})`; g.lineWidth = 8 * (1 - kk) + 1; g.beginPath(); g.arc(cx, cy, R * (0.5 + 0.5 * kk), 0, 7); g.stroke(); brushArc(cx, cy - 10, R * 0.8, kk * 2, 6, 1 - kk); }
      }
      return;
    }
    if (f.type === "target") {
      const tx = f.tb.x * TS, ty = f.tb.y * TS - H, q = Math.min(1, k * 2.2), x = ax + (tx - ax) * q, y = ay + (ty - ay) * q, a = Math.atan2(ty - ay, tx - ax);
      if (f.s === "fire" || f.s === "seal") { if (q < 1) { g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2); g.fillStyle = f.s === "fire" ? "rgba(181,52,42,.95)" : "rgba(214,190,90,.95)"; g.fillRect(-5, -9, 10, 18); g.fillStyle = f.s === "fire" ? "#e9d27a" : "#a0261d"; g.fillRect(-1.5, -6, 3, 12); g.restore(); } else if (f.s === "fire") { g.fillStyle = `rgba(181,52,42,${0.5 * (1 - k)})`; g.beginPath(); g.arc(tx, ty, 30 * k + 8, 0, 7); g.fill(); } else { g.fillStyle = `rgba(214,190,90,${1 - k})`; g.fillRect(tx - 6, ty - 26, 12, 22); } }
      else if (f.s === "triple") { for (let i = 0; i < 3; i++) { const qq = Math.min(1, Math.max(0, k * 2.4 - i * 0.3)); if (qq > 0 && qq < 1) arrowAt(ax + (tx - ax) * qq, ay + (ty - ay) * qq, a); } }
      else if (f.s === "poison") { if (q < 1) arrowAt(x, y, a, 22, "#3f6b2c"); else { g.fillStyle = `rgba(80,140,60,${0.5 * (1 - k)})`; g.beginPath(); g.arc(tx, ty, 20 * k + 6, 0, 7); g.fill(); } }
      else if (f.s === "cleave") { brushArc(tx, ty, 18, -2.2 + k, 3, 1 - k); g.strokeStyle = `rgba(22,20,15,${0.7 * (1 - k)})`; g.lineWidth = 10 * (1 - k) + 2; g.beginPath(); g.moveTo(tx - 30, ty - 30); g.lineTo(tx + 26, ty + 22); g.stroke(); }
      return;
    }
    // 自身
    const sx = f.a.x * TS, sy = f.a.y * TS;
    if (f.s === "sweep") brushArc(sx, sy - 24, (f.r || 2.2) * TS * (0.6 + 0.4 * k), k * 5, 7, 1 - k);
    else if (f.s === "whirl") brushArc(sx, sy - 24, (f.r || 2.6) * TS * 0.8, k * 18, 8, 1 - k * k);
    else if (f.s === "guard" || f.s === "shield" || f.s === "roar") { const col = f.s === "guard" ? "168,131,42" : f.s === "shield" ? "64,140,110" : "181,52,42"; g.strokeStyle = `rgba(${col},${1 - k})`; g.lineWidth = 4; g.beginPath(); g.arc(sx, sy - 30, 22 + (f.s === "roar" ? 70 : 24) * k, 0, 7); g.stroke(); }
    else if (f.s === "gale") { g.strokeStyle = `rgba(64,96,90,${1 - k})`; g.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i + k * 4; g.beginPath(); g.arc(sx, sy - 28, 14 + 18 * k, a, a + 0.8); g.stroke(); } }
    else if (f.s === "heal") { g.strokeStyle = `rgba(63,122,82,${0.6 * (1 - k)})`; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 5 * TS * k, 0, 7); g.stroke(); }
  }
  // 瞄準指示（按住 Q／E／R 或點了技能鈕時）
  function drawAim(meE, s, w) {
    const px = meE.x * TS, py = meE.y * TS, mx = w.x * TS, my = w.y * TS;
    g.save(); g.lineWidth = 2; g.setLineDash([6, 5]);
    if (s.type === "target" || s.type === "ground") { g.strokeStyle = "rgba(181,52,42,.55)"; g.fillStyle = "rgba(181,52,42,.05)"; g.beginPath(); g.arc(px, py, s.range * TS, 0, 7); g.fill(); g.stroke(); }
    g.setLineDash([]);
    if (s.type === "dir") {
      let dx = mx - px, dy = my - py; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const a0 = Math.atan2(dy, dx), n = s.arrows || 1, sp = (s.spread || 0) * Math.PI / 180, len = s.range * TS, wd = Math.max(0.5, s.w || 0.8) * TS;
      for (let i = 0; i < n; i++) {
        const a = n > 1 ? a0 - sp / 2 + sp * i / (n - 1) : a0;
        g.save(); g.translate(px, py); g.rotate(a);
        g.fillStyle = "rgba(181,52,42,.16)"; g.strokeStyle = "rgba(181,52,42,.75)"; g.beginPath(); g.rect(0, -wd / 2, len, wd); g.fill(); g.stroke();
        g.fillStyle = "rgba(181,52,42,.6)"; g.beginPath(); g.moveTo(len + 12, 0); g.lineTo(len - 4, -wd / 2 - 4); g.lineTo(len - 4, wd / 2 + 4); g.closePath(); g.fill();
        g.restore();
      }
    } else if (s.type === "ground") {
      let cx = mx, cy = my; const d = Math.hypot(cx - px, cy - py);
      if (d > s.range * TS) { cx = px + (cx - px) / d * s.range * TS; cy = py + (cy - py) / d * s.range * TS; }
      g.fillStyle = "rgba(181,52,42,.2)"; g.strokeStyle = "rgba(181,52,42,.85)"; g.beginPath(); g.arc(cx, cy, s.r * TS, 0, 7); g.fill(); g.stroke();
    } else if (s.type === "target") {
      const h = hit(w), e = h && h.md && isFoe(h.md) ? h.e : null;
      if (e) { const ok = Math.hypot(e.x - meE.x, e.y - meE.y) <= s.range; g.strokeStyle = ok ? "rgba(181,52,42,.95)" : "rgba(120,110,95,.9)"; g.lineWidth = 3; g.beginPath(); g.ellipse(e.x * TS, e.y * TS + 2, 26, 11, 0, 0, 7); g.stroke(); if (!ok) label(g, e.x * TS, e.y * TS + 26, "太遠，會先走過去", "#7a2a22", 12, true); }
    } else if (s.r) { g.strokeStyle = "rgba(181,52,42,.6)"; g.fillStyle = "rgba(181,52,42,.08)"; g.beginPath(); g.arc(px, py, s.r * TS, 0, 7); g.fill(); g.stroke(); }
    g.restore();
  }

  // ------------------------------------------------------------ 介面
  function hud() {
    if (!me) return;
    $(".mo-name").textContent = me.name; $(".mo-lv").textContent = `${me.lv} 級・${me.adv ? ADVN[me.adv] : CLS[me.cls] || ""}`;
    const face = $(".mo-face");
    const fk = me.adv && hasArt("p_" + me.adv) ? me.adv : me.cls;
    if (hasArt("p_" + fk)) { face.classList.add("pic"); face.style.backgroundImage = `url(${artUrl("p_" + fk)})`; face.querySelector("span").textContent = ""; }
    else face.querySelector("span").textContent = CLS_GLYPH[me.cls] || "俠";
    const bar = (sel, v, max, txt) => { const el = $(sel); el.querySelector("i").style.width = Math.max(0, Math.min(100, v / max * 100)) + "%"; const s = el.querySelector("span"); if (s) s.textContent = txt; };
    bar(".mo-bar.hp", me.hp, me.st.hp, `${me.hp} / ${me.st.hp}`);
    bar(".mo-bar.mp", me.mp, me.st.mp, `${me.mp} / ${me.st.mp}`);
    bar(".mo-bar.xp", me.exp, me.need || 1);
    $(".mo-bar.xp").title = `經驗 ${me.exp} / ${me.need}`;
    $(".mo-gold").textContent = `${money(me.gold)} 兩`;
    $(".mo-dead").hidden = !me.dead;
    { const SB = { guard: "金鐘罩", gale: "疾風", rage: "怒吼", shield: "護體", eagle: "鷹眼", mingwang: "明王" }, chips = [];
      for (const b of me.buffs || []) chips.push(`<span class="mo-buff ${b.k}" title="${esc(b.d)}">${esc(b.n)}<small>${Math.ceil(b.left / 60)} 分</small></span>`);
      for (const [k, v] of Object.entries(me.buff || {})) if (v > 0 && SB[k]) chips.push(`<span class="mo-buff sk">${SB[k]}<small>${Math.ceil(v / 1000)} 秒</small></span>`);
      const el = $(".mo-buffs"), html = chips.join(""); if (el.innerHTML !== html) el.innerHTML = html; }
    if (me.skills || me.inv) skillBar();
    else updatePots();
  }
  const potCount = (kind) => (me && me.inv ? me.inv.filter((x) => x.p && (kind === "tp" ? x.p === "tp" : x.p.startsWith(kind))).reduce((s, x) => s + x.q, 0) : 0);
  const slotSkills = () => (me && me.slots ? me.slots : []).map((id) => (me.skills || []).find((x) => x.id === id) || null);
  function skillBar() {
    const el = $(".mo-skills"), sl = slotSkills();
    el.innerHTML = (me.slots || [0, 0, 0]).map((_, i) => {
      const s = sl[i];
      if (!s) return `<button class="mo-sk none" data-empty="${i}" aria-label="空的技能欄（${KEYS[i]}），按一下選技能"><b>＋</b><small>選技能</small><kbd>${KEYS[i]}</kbd></button>`;
      const ic = hasArt(SKILL_ART[s.id]);
      return `<button class="mo-sk${ic ? " ic" : ""}" data-sk="${s.id}" data-slot="${i}" ${ic ? `style="--ic:url(${artUrl(SKILL_ART[s.id])})"` : ""} aria-label="${esc(s.name)}（${KEYS[i]}）：${esc(s.desc)}"><b>${ic ? "" : GLYPH[s.id] || esc(s.name.slice(0, 1))}</b><small>${esc(s.name)}</small><kbd>${KEYS[i]}</kbd><i class="cd"></i></button>`;
    }).join("")
      + `<span class="mo-sep"></span><button class="mo-sk pot hp" data-q="hp" title="吃回血的藥（1）">${potIcon("i_hp", "血")}<small class="n"></small><kbd>1</kbd></button><button class="mo-sk pot mp" data-q="mp" title="吃回魔的藥（2）">${potIcon("i_mp", "魔")}<small class="n"></small><kbd>2</kbd></button><button class="mo-sk pot tp" data-q="tp" title="回城符：立刻回長安城（3）">${potIcon("i_tp", "城")}<small class="n"></small><kbd>3</kbd></button>`;
    updatePots();
  }
  const potIcon = (n, ch) => hasArt(n) ? `<img class="mo-pi" src="${artUrl(n)}" alt="${ch}">` : `<b>${ch}</b>`;
  function updatePots() {
    for (const k of ["hp", "mp", "tp"]) { const b = $(`.mo-sk.pot.${k} .n`); if (b) { const n = potCount(k); b.textContent = "×" + n; b.parentElement.classList.toggle("empty", !n && !(k === "tp" && me.inTown && me.recall)); } }
    const tp = $(".mo-sk.pot.tp");
    if (tp) { const back = me && me.inTown && me.recall; tp.classList.toggle("back", !!back); tp.title = back ? `回到上次的地點：${me.recall}（3，不扣回城符）` : "回城符：立刻回長安城，之後可再回到原地（3）"; const nEl = tp.querySelector(".n"); if (back && nEl) nEl.textContent = "返"; }
  }
  function tickHud(t) {
    if (!me || !me.skills) return;
    for (const s of me.skills) { const b = root.querySelector(`.mo-sk[data-sk="${s.id}"] .cd`); if (!b) continue; const left = (cdEnd[s.id] || 0) - t; b.style.setProperty("--p", left > 0 ? Math.min(1, left / (s.cd * 1000)) : 0); b.textContent = left > 0 ? Math.ceil(left / 1000) : ""; }
    const tg = me.tgt && ents.get(me.tgt), tEl = $(".mo-target");
    if (tg && meta[tg.id]) { tEl.hidden = false; tEl.querySelector("b").textContent = `${meta[tg.id].n}  Lv${meta[tg.id].lv}`; tEl.querySelector("i").style.width = tg.hp + "%"; } else tEl.hidden = true;
  }
  function renderParty() {
    $(".mo-party").innerHTML = party.length ? `<div class="mo-ph">隊伍 <button data-act="pleave">離開</button></div>` + party.filter((q) => q.id !== myId).map((q) => `<div class="mo-pm"><span>${esc(q.n)}${q.lead ? " ★" : ""} <small>Lv${q.lv} ${CLS[q.c] || ""}・${esc(q.map)}</small></span><div class="mo-bar tg"><i style="width:${q.hp}%"></i></div></div>`).join("") : "";
  }
  function addChat(m) {
    chat.push({ ...m, t: Date.now() }); if (chat.length > 60) chat.shift();
    logEl.innerHTML = chat.slice(-8).map((c) => c.sys ? `<p class="sys">${esc(c.text)}</p>` : `<p class="${c.ch === "party" ? "pt" : ""}"><b>${esc(c.n)}</b>${c.ch === "party" ? "（隊）" : ""}：${esc(c.text)}</p>`).join("");
    logEl.scrollTop = logEl.scrollHeight;
  }
  let toastT = 0;
  function toast(text) { toastEl.textContent = text; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2200); }
  function showAsk(m) {
    askEl.hidden = false;
    askEl.innerHTML = `<p><b>${esc(m.n)}</b> ${m.kind === "party" ? "邀請你組隊" : m.kind === "duel" ? "想跟你上擂台切磋（不掉東西、不扣經驗）" : "想跟你交易"}</p><div class="mo-row"><button class="mo-pri" data-yes>接受</button><button data-no>拒絕</button></div>`;
    askEl.onclick = (e) => { if (e.target.closest("[data-yes]")) send({ a: m.kind === "party" ? "pacc" : m.kind === "duel" ? "duelacc" : "tacc", id: m.from }); if (e.target.closest("[data-yes],[data-no]")) askEl.hidden = true; };
    clearTimeout(askEl._t); askEl._t = setTimeout(() => { askEl.hidden = true; }, 30000);
  }

  // ------------------------------------------------------------ 面板
  function openPanel(p) { if (p === "bag" && openP !== "bag") bagSel = null; openP = p; panel.hidden = false; render(); }
  function closePanel() { if (openP === "trade" && trade) send({ a: "tcancel" }); openP = null; panel.hidden = true; sellMode = false; }
  function render() { if (openP === "bag") renderBag(); else if (openP === "npc") renderNpc(); else if (openP === "trade") renderTrade(); else if (openP === "help") renderHelp(); else if (openP === "skills") renderSkills(); }
  const statLine = (st) => Object.entries(st || {}).map(([k, v]) => `${STAT[k]} +${v}`).join("　");
  const eqLine = (it) => statLine(it.st) + (it.eb ? `　<span class="mo-enhst">強化 ${statLine(it.eb)}</span>` : "");
  const itemName = (it) => it.p ? POT[it.p] || it.p : it.n;
  const icon = (it) => { const n = itemArt(it); return hasArt(n) ? `<img class="mo-ii" src="${artUrl(n)}" alt="">` : ""; };
  const itemCell = (it, extra = "") => it ? (it.p ? `<button class="mo-it pot" data-u="${it.p}" ${extra}>${icon(it)}<span><b>${esc(POT[it.p] || it.p)}</b><small>×${it.q}</small></span></button>`
    : `<button class="mo-it" data-u="${it.u}" style="--r:${RAR_COLOR[it.r]}" ${extra}>${icon(it)}<span><b>${it.lock ? "🔒" : ""}${it.e ? `<em class="mo-enh">+${it.e}</em>` : ""}${esc(it.n)}</b><small>${RAR[it.r]}・${it.t}級${it.c && me && it.c !== me.cls ? "・" + CLS[it.c] : ""}</small></span></button>`) : "";
  let bagSel = null;          // 行囊裡目前點開的那一件（重畫時保留）
  function renderBag(detailU) {
    if (!me || !me.inv) return;
    if (detailU !== undefined) bagSel = detailU;
    const st = me.st, det = bagSel && (me.inv.find((x) => (x.u || x.p) === bagSel) || Object.values(me.eq).find((x) => x && x.u === bagSel));
    if (bagSel && !det) bagSel = null;      // 那件已經不在了（賣掉、交易出去）
    panel.innerHTML = `<div class="mo-sheet mo-bag"><header><h3>行囊</h3><button class="mo-x" data-act="close">✕</button></header>
      <div class="mo-stats"><span>攻擊 <b>${st.atk}</b></span><span>防禦 <b>${st.def}</b></span><span>生命 <b>${st.hp}</b></span><span>法力 <b>${st.mp}</b></span><span>暴擊 <b>${st.crit}%</b></span><span>攻速 <b>${st.aspd}s</b></span><span>銀兩 <b class="mo-goldv">${money(me.gold)}</b></span></div>
      <div class="mo-eq">${Object.entries(SLOT).map(([k, n]) => `<div class="mo-slot"><em>${n}</em>${me.eq[k] ? itemCell(me.eq[k], 'data-eq="' + k + '"') : `<span class="mo-empty">（空）</span>`}</div>`).join("")}</div>
      ${sellMode ? `<p class="mo-dim">賣東西：點一樣東西就賣掉（回收價是價值的 25%）。<button class="mo-link" data-act="nosell">不賣了</button></p>` : ""}
      <div class="mo-inv">${me.inv.map((it) => itemCell(it)).join("")}${Array.from({ length: Math.max(0, 30 - me.inv.length) }, () => `<span class="mo-it nil"></span>`).join("")}</div>
      ${sellAllRow()}
      ${det ? detail(det) : `<p class="mo-dim">點一件東西看詳細。武器、衣服、飾品點了可以換上。</p>`}</div>`;
  }
  // 一鍵賣裝：顯示每一檔會賣幾件、拿多少錢（鎖住的、強化過的、傳說不算）
  function sellAllRow() {
    const can = (r) => me.inv.filter((x) => !x.p && x.r <= r && !x.lock && !(x.e > 0));
    const btn = (r, label) => { const l = can(r); return `<button data-sellall="${r}"${l.length ? "" : " disabled"}>${label}<small>${l.length} 件・${money(l.reduce((s, x) => s + Math.max(1, Math.floor(x.v * 0.25)), 0))} 兩</small></button>`; };
    return `<div class="mo-sellall"><span>一鍵賣裝</span>${btn(0, "普通")}${btn(1, "精良以下")}${btn(2, "稀有以下")}</div>`;
  }
  function detail(it) {
    const worn = !it.p && me.eq[it.s] && me.eq[it.s].u === it.u;
    const cmp = !it.p && !worn && me.eq[it.s] ? `<p class="mo-dim">現在穿的：${esc(me.eq[it.s].n)}（${statLine(me.eq[it.s].st)}）</p>` : "";
    return `<div class="mo-det"><h4 style="color:${it.p ? "#16140f" : RAR_COLOR[it.r]}">${it.e ? `+${it.e} ` : ""}${esc(itemName(it))}${it.p ? ` ×${it.q}` : `<small>${RAR[it.r]}・${SLOT[it.s]}・需要 ${it.t} 級</small>`}</h4>
      ${it.p ? (MAT[it.p] ? `<p class="mo-dim">鍛造材料：拿去長安城鐵匠那裡強化、洗詞條、重鑄。</p>` : "") : `<p>${eqLine(it)}</p>${cmp}`}
      <div class="mo-row">${worn ? `<button data-unequip="${it.s}">卸下</button>` : `${MAT[it.p] ? "" : `<button class="mo-pri" data-use="${it.u || it.p}">${it.p ? "使用" : "換上"}</button>`}`}
      ${it.p ? "" : `<button data-lock="${it.u}">${it.lock ? "解鎖" : "🔒 鎖定"}</button>`}
      ${!worn && !it.lock ? `<button data-sell="${it.u || it.p}">賣掉${it.p ? "" : `（${money(Math.max(1, Math.floor(it.v * 0.25)))} 兩）`}</button>` : ""}
      ${trade && !worn ? `<button data-tadd="${it.u || it.p}">放進交易</button>` : ""}</div></div>`;
  }
  // ------------------------------------------------------------ 鐵匠：鍛造
  let npcTab = "buy", forgeSel = null, forgeFx = null;
  const mats = (k) => me.inv.filter((x) => x.p === k).reduce((s, x) => s + x.q, 0);
  function matsView(n) {
    return `<div class="mo-shop">${(n.mats || []).map((s) => `<div class="mo-si"><span>${hasArt("i_" + s.k) ? `<img class="mo-ii" src="${artUrl("i_" + s.k)}" alt="">` : ""}<b>${esc(s.n)}</b><small>${esc(s.d)}・身上 ${mats(s.k)} 個</small></span><span class="mo-qty"><button data-buy="${s.k}" data-n="1">${money(s.price)} 兩</button><button data-buy="${s.k}" data-n="10">×10</button></span></div>`).join("")}</div>
      <p class="mo-dim">玄鐵怪物常掉，靈玉偶爾掉，打王一定有玄鐵、有機會拿到靈玉和重鑄石。</p>`;
  }
  function forgeView() {
    const all = [...Object.values(me.eq).filter(Boolean), ...me.inv.filter((x) => !x.p)];
    const it = all.find((x) => x.u === forgeSel) || null;
    const worn = (x) => Object.values(me.eq).some((y) => y && y.u === x.u);
    const list = `<div class="mo-flist">${all.map((x) => `<button class="mo-fit${x.u === forgeSel ? " on" : ""}" data-fsel="${x.u}" style="--r:${RAR_COLOR[x.r]}">${icon(x)}<span>${x.e ? `<em class="mo-enh">+${x.e}</em>` : ""}${esc(x.n)}${worn(x) ? "<i>穿著</i>" : ""}</span></button>`).join("") || `<p class="mo-dim">身上沒有裝備</p>`}</div>`;
    if (!it) return list + `<p class="mo-dim">選一件裝備。強化每升一級加基礎數值 8%，最高 +${ENH.max}；從 +${ENH.drop} 以上強化失敗會掉一級。</p>`;
    const e = it.e || 0, gE = ENH.gold(it.t, e), oE = ENH.ore(e), have = { ore: mats("ore"), jade: mats("jade"), recast: mats("recast") };
    const cost = (g, k, n2) => `<small class="${me.gold < g || have[k] < n2 ? "short" : ""}">${money(g)} 兩・${POT[k]} ${n2}（有 ${have[k]}）</small>`;
    const fxc = forgeFx && forgeFx.u === it.u ? (forgeFx.ok ? " ok" : " fail") : ""; forgeFx = null;
    return list + `<div class="mo-forge${fxc}">
      <h4 style="color:${RAR_COLOR[it.r]}">${e ? `+${e} ` : ""}${esc(it.n)}<small>${RAR[it.r]}・${SLOT[it.s]}・${it.t} 級</small></h4>
      <p>${eqLine(it)}</p>
      <div class="mo-fops">
        <div class="mo-fop"><b>強化 +${e} → +${Math.min(ENH.max, e + 1)}</b>${e >= ENH.max ? `<small>已經到頂</small>` : `<span>成功率 <em>${ENH.rate[e]}%</em>${e >= ENH.drop ? `<i class="warn">失敗會掉回 +${e - 1}</i>` : `<i>失敗不會掉級</i>`}</span>${cost(gE, "ore", oE)}<button class="mo-pri" data-forge="lv">強化</button>`}</div>
        <div class="mo-fop"><b>洗詞條</b>${it.r ? `<span>重抽 ${RAR_AFF[it.r]} 條詞條的種類和數值</span>${cost(REROLL.gold(it.t), "jade", REROLL.jade)}<button data-forge="aff">洗詞條</button>` : `<small>普通裝備沒有詞條</small>`}</div>
        <div class="mo-fop"><b>重鑄品質</b>${it.r < 3 ? `<span>${RECAST.up[it.r]}% 升為<em style="color:${RAR_COLOR[it.r + 1]}">${RAR[it.r + 1]}</em>，失敗品質不變</span>${cost(RECAST.gold(it.t), "recast", RECAST.stone)}<button data-forge="recast">重鑄</button>` : `<small>已經是傳說</small>`}</div>
      </div></div>`;
  }
  // 說書人：轉職
  const MODN = { hp: "生命", mp: "法力", atk: "攻擊", def: "防禦", spd: "移速" };
  const modLine = (M) => Object.entries(M).map(([k, v]) => k === "crit" ? `暴擊 +${v}%` : k === "range" ? `射程 +${v}` : k === "aspd" ? `攻速 +${Math.round((1 / v - 1) * 100)}%` : `${MODN[k]} ${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`).join("・");
  function advView(n) {
    if (!n.adv) return "";
    if (n.myAdv) { const a = n.adv.find((x) => x.k === n.myAdv); return a ? `<p class="mo-dim">你已經是<b>${esc(a.n)}</b>了。</p>` : ""; }
    const can = me && me.lv >= n.advLv;
    return `<div class="mo-advs">${n.adv.map((a) => `<div class="mo-adv">${hasArt("p_" + a.k) ? `<img src="${artUrl("p_" + a.k)}" alt="">` : ""}<div><h4>${esc(a.n)}</h4><p>${esc(a.d)}</p><small>${modLine(a.mod)}</small>
        <ul>${a.skills.map((s) => `<li><b>${esc(s.name)}</b>（${s.lv} 級）${esc(s.desc)}</li>`).join("")}</ul>
        <button class="mo-pri" data-advance="${a.k}"${can ? "" : " disabled"}>${can ? `轉職成${esc(a.n)}` : `${n.advLv} 級才能轉職`}</button></div></div>`).join("")}</div>
      <p class="mo-dim">轉職後多一格技能欄（Q W E R 之外再多一個 F），選了就不能換。想玩另一條路可以開新角色重新練。</p>`;
  }
  // ------------------------------------------------------------ 主城新 NPC 的面板
  let diceRes = null, diceRoll = 0, rankTab = 0;
  const DIE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  function storeView(n) {
    const st = n.stash || [];
    return `<div class="mo-store"><div><h4 class="mo-sub">行囊（點一下放進倉庫）</h4><div class="mo-inv small">${me.inv.map((it) => itemCell(it, `data-sput="${it.u || it.p}"`)).join("") || `<p class="mo-dim">空的</p>`}</div></div>
      <div><h4 class="mo-sub">倉庫 ${st.length} / ${n.max}（點一下拿出來）</h4><div class="mo-inv small">${st.map((it) => itemCell(it, `data-stake="${it.u || it.p}"`)).join("") || `<p class="mo-dim">空的</p>`}</div></div></div>
      <p class="mo-dim">倉庫是整個帳號共用的，換角色後一樣拿得到。藥和材料放進去會自動疊在一起。</p>`;
  }
  function bountyView(n) {
    return `<div class="mo-bty">${(n.bty || []).map((q) => `<div class="mo-btyq${q.done ? " done" : ""}${q.got ? " got" : ""}"><b>${esc(q.name)}</b>
        <div class="mo-bar tg"><i style="width:${Math.round(q.have / q.need * 100)}%"></i></div><small>${q.have} / ${q.need}・賞：${money(q.rw.exp)} 經驗、${money(q.rw.gold)} 兩、玄鐵 ×${q.rw.ore}${q.rw.jade ? `、靈玉 ×${q.rw.jade}` : ""}</small>
        ${q.got ? `<em>已領</em>` : q.done ? `<button class="mo-pri" data-bclaim="${q.i}">領賞</button>` : ""}</div>`).join("")}</div>
      <p class="mo-dim">每天換一批懸賞（整個帳號共用進度）。三個都領完，捕快會再多給一顆重鑄石${n.all ? "（今天已經拿過了）" : ""}。</p>`;
  }
  function innView(n) {
    return `${n.cur ? `<p>正在享用：<b>${esc(n.cur.n)}</b>（還有 ${Math.ceil(n.cur.left / 60)} 分鐘）</p>` : ""}
      <div class="mo-shop">${(n.foods || []).map((f) => `<div class="mo-si"><span><b>${esc(f.n)}</b><small>${n.min} 分鐘內${esc(f.d)}</small></span><button data-eat="${f.k}">${money(n.price)} 兩</button></div>`).join("")}</div>
      <p class="mo-dim">一次只能吃一道，點新的會蓋掉舊的。價錢跟等級走。換角色時效果留在原本的角色身上。</p>`;
  }
  function templeView(n) {
    const anim = n.anim && performance.now() - n.anim < 1600;
    if (anim) setTimeout(() => { if (openP === "npc" && npcOpen === n) renderNpc(); }, 1650);
    const res = n.last ? `<div class="mo-slip${anim ? " shake" : ""}">${anim ? "<b>搖籤中…</b>" : `<em>${esc(n.last.slip)}</em><b>${esc(n.last.name)}</b><small>${esc(n.last.d)}</small>`}</div>` : "";
    return `${res}${n.prayed ? `<p class="mo-dim">今天已經祈福過了，明天再來。</p>` : `<div class="mo-row"><button class="mo-pri" data-pray="1">上香祈福</button></div>`}
      <h4 class="mo-sub">可能抽到</h4><ul class="mo-odds">${(n.odds || []).map((o) => `<li><b>${esc(o.n)}</b>${esc(o.d)}<span>${o.p}%</span></li>`).join("")}</ul>
      <p class="mo-dim">每個帳號每天一次，經驗、掉寶加成整個帳號的角色都有效。</p>`;
  }
  function casinoView(n) {
    const D2 = n.dice, rolling = diceRes && performance.now() - diceRoll < 700;
    const faces = diceRes ? (rolling ? [1, 2, 3].map(() => DIE[1 + Math.floor(Math.random() * 6)]) : diceRes.d.map((v) => DIE[v])) : ["⚀", "⚀", "⚀"];
    const RES = { big: "大", small: "小", triple: "豹子" };
    return `<div class="mo-dice${rolling ? " roll" : ""}">${faces.map((f) => `<span>${f}</span>`).join("")}</div>
      ${diceRes && !rolling ? `<p class="mo-diceres ${diceRes.win > 0 ? "win" : "lose"}">${diceRes.sum} 點・${RES[diceRes.res]}　${diceRes.win > 0 ? `贏了 ${money(diceRes.win)} 兩！` : `輸了 ${money(-diceRes.win)} 兩`}</p>` : `<p class="mo-dim">三顆骰子加起來 11–17 是大、4–10 是小；三顆一樣（豹子）莊家通吃，押豹子中了賠 ${D2.triplePay} 倍。</p>`}
      <label class="mo-field">押注（${D2.min}～${money(D2.max)} 兩）<input type="number" class="mo-bet" min="${D2.min}" max="${D2.max}" step="10" value="${n.bet || 100}"></label>
      <div class="mo-row"><button class="mo-pri" data-dice="big">押大</button><button class="mo-pri" data-dice="small">押小</button><button data-dice="triple">押豹子</button></div>
      <p class="mo-dim">身上銀兩：${money(me.gold)} 兩。小賭怡情，大賭傷身。</p>`;
  }
  function rankView(n) {
    const R = n.ranks || [], tab = R[rankTab] || R[0];
    return `<div class="mo-tabs">${R.map((r, i) => `<button data-rtab="${i}"${i === rankTab ? ' class="on"' : ""}>${esc(r.name)}</button>`).join("")}</div>
      ${tab && tab.list.length ? `<ol class="mo-top">${tab.list.map((r) => `<li><b>${esc(r.n)}</b><span>${esc(r.v)}</span></li>`).join("")}</ol>` : `<p class="mo-dim">還沒有人上榜。</p>`}`;
  }
  function renderNpc() {
    const n = npcOpen; if (!n) return;
    let body = "";
    if (n.kind === "smith") body = `<div class="mo-tabs"><button data-tab="buy"${npcTab === "buy" ? ' class="on"' : ""}>買裝備</button><button data-tab="forge"${npcTab === "forge" ? ' class="on"' : ""}>鍛造</button><button data-tab="mats"${npcTab === "mats" ? ' class="on"' : ""}>材料</button></div>` + (npcTab === "forge" ? forgeView() : npcTab === "mats" ? matsView(n) : `<div class="mo-shop">${n.shop.map((s) => `<div class="mo-si${me && s.lv > me.lv ? " lock" : ""}"><span><b>${esc(s.n)}</b><small>${SLOT[s.s]}・${s.t}級・${statLine(s.st)}</small></span><button data-buy="${s.k}">${money(s.price)} 兩</button></div>`).join("")}</div><div class="mo-row"><button data-act="sell">賣東西</button></div>`);
    else if (n.kind === "herb") body = `<div class="mo-shop">${n.shop.map((s) => `<div class="mo-si${me && s.lv > me.lv ? " lock" : ""}"><span><b>${esc(s.n)}</b><small>${esc(s.d)}${s.lv > 1 ? `・${s.lv}級` : ""}・${s.price} 兩</small></span><span class="mo-qty"><button data-buy="${s.k}" data-n="1">×1</button><button data-buy="${s.k}" data-n="10">×10</button></span></div>`).join("")}</div><div class="mo-row"><button data-act="sell">賣東西</button></div>`;
    else if (n.kind === "bank") body = n.real ? `<div class="mo-bank"><p>你的代幣：<b>${n.tokens == null ? "（查不到）" : money(n.tokens)}</b>　身上銀兩：<b>${money(me ? me.gold : 0)}</b></p>
        <p class="mo-dim">1 兩 = 1 代幣。銀兩換代幣每天最多 ${money(n.cap)}（今天已換 ${money(n.used)}）。</p>
        <label class="mo-field">金額<input type="number" class="mo-amt" min="1" step="1" value="100"></label>
        <div class="mo-row"><button class="mo-pri" data-bank="in">代幣 → 銀兩</button><button data-bank="out">銀兩 → 代幣</button></div></div>`
      : `<p>錢莊要用 Discord 登入才能用（角色要綁在你的帳號上）。</p><p class="mo-dim">回選單重新進來時選「用 Discord 登入」。</p>`;
    else if (n.kind === "post" || n.kind === "stone") body = `<div class="mo-shop">${(n.warps || []).map((w) => `<div class="mo-si${w.ok ? "" : " lock"}"><span><b>${esc(w.n)}</b><small>${esc(w.lvl)}${w.ok ? "" : "・還沒去過，要先走過去一次"}</small></span><button data-warp="${w.k}"${w.ok ? "" : " disabled"}>${w.cost ? `${w.cost} 兩` : "免費"}・傳送</button></div>`).join("")}</div>
      ${n.recall ? `<div class="mo-row"><button class="mo-pri" data-recall="1">回到上次的地點（${esc(n.recall)}）</button></div>` : ""}
      <p class="mo-dim">去過的地方才能傳送。在野外用回城符回城後，城裡再按 3（或用回城符）就能免費回到原地。</p>`;
    else if (n.kind === "tower") { const T = n.tower; body = `<div class="mo-tower"><p>塔裡有三波妖魔，第三波有精英，最後是<b>九尾妖狐</b>。怪的等級跟著隊伍平均等級走，人越多怪越多、王越硬。</p>
        <ul><li>${T.minLv} 級以上，隊長帶隊（隊員要在長安城才會一起進去）</li><li>限時 ${T.time} 分鐘；倒下就回城，不能再進同一場</li><li>通關每人：稀有以上裝備一件（有機會是傳說）、玄鐵 ×5、靈玉 ×2、重鑄石 ×1、大量經驗和銀兩</li></ul>
        <p>今天還能進 <b>${T.left}</b> / ${T.daily} 次${T.team > 1 ? `・隊伍 ${T.team} 人` : "・單人"}</p>
        <div class="mo-row"><button class="mo-pri" data-tower="1"${T.left > 0 && T.lead && me && me.lv >= T.minLv ? "" : " disabled"}>${!T.lead ? "要由隊長帶隊" : me && me.lv < T.minLv ? `${T.minLv} 級才能進` : T.left > 0 ? "進入鎖妖塔" : "今天的次數用完了"}</button></div></div>`; }
    else if (n.kind === "arena") { const A = n.arena; body = `<p>在長安城點其他玩家選「擂台切磋」，對方同意就上擂台。打到對方剩 0 就贏，3 分鐘到了血量高的贏。不掉東西、不扣經驗，傷害是平常的一半。</p>
        <p>你的戰績：<b>${A.me.w}</b> 勝 <b>${A.me.l}</b> 敗</p>
        <h4 class="mo-sub">擂台榜</h4>${A.top.length ? `<ol class="mo-top">${A.top.map((r) => `<li><b>${esc(r.n)}</b><span>${r.w} 勝 ${r.l} 敗</span></li>`).join("")}</ol>` : `<p class="mo-dim">還沒有人上過擂台。</p>`}`; }
    else if (n.kind === "store") body = storeView(n);
    else if (n.kind === "bounty") body = bountyView(n);
    else if (n.kind === "inn") body = innView(n);
    else if (n.kind === "temple") body = templeView(n);
    else if (n.kind === "casino") body = casinoView(n);
    else if (n.kind === "rank") body = rankView(n);
    else if (n.kind === "guide") body = advView(n) + `<p class="mo-dim">竹林 1–8 級、荒山 8–16 級、古墓 16–25 級、雪嶺 25–35 級、火焰山 35–45 級、魔教總壇 45–55 級。每張圖各有一隻王，打倒後按傷害分寶，記得揪人一起打。王蓄力時腳下會出現紅圈，快跑出去。</p>`;
    else body = "";
    const pic = hasArt(NPC_ART[n.kind]) ? `<img class="mo-npcpic" src="${artUrl(NPC_ART[n.kind])}" alt="">` : "";
    panel.innerHTML = `<div class="mo-sheet mo-npc"><header><h3>${esc(n.name)}</h3><button class="mo-x" data-act="close">✕</button></header><div class="mo-npchead">${pic}<p class="mo-say-npc">「${esc(n.say)}」</p></div>${body}</div>`;
  }
  function renderTrade() {
    if (!trade || !me) return;
    const side = (s, mine) => `<div class="mo-tside${s.ok ? " ok" : ""}"><h4>${esc(s.n)}${s.ok ? " ✓ 已確認" : ""}</h4><div class="mo-tlist">${s.items.map((it) => `<div class="mo-tit" style="color:${it.p ? "#16140f" : RAR_COLOR[it.r]}">${esc(itemName(it))}${it.p ? " ×" + it.q : `<small>${statLine(it.st)}</small>`}${mine ? `<button data-tadd="${it.u || it.p}">拿回</button>` : ""}</div>`).join("") || `<p class="mo-dim">（還沒放東西）</p>`}</div><p>銀兩：<b>${money(s.gold)}</b></p></div>`;
    panel.innerHTML = `<div class="mo-sheet mo-trade"><header><h3>交易</h3><button class="mo-x" data-act="close">✕</button></header>
      <div class="mo-tgrid">${side(trade.me, true)}${side(trade.them, false)}</div>
      <label class="mo-field">我出的銀兩<input type="number" class="mo-tg" min="0" value="${trade.me.gold}"></label>
      <p class="mo-dim">從下面點東西放進交易。任何一方改了內容，兩邊都要重新確認。</p>
      <div class="mo-inv small">${me.inv.map((it) => itemCell(it, `data-tpick="${it.u || it.p}"`)).join("")}</div>
      <div class="mo-row"><button class="mo-pri" data-act="tok"${trade.me.ok ? " disabled" : ""}>確認交易</button><button data-act="close">取消</button></div></div>`;
  }
  const TYPE = { self: "自身", target: "指定：滑鼠指著怪放", dir: "指向：朝滑鼠方向放", ground: "範圍：打在滑鼠位置" };
  const skillCard = (s, assign) => {
    const lock = me.lv < s.lv, slot = (me.slots || []).indexOf(s.id), ic = hasArt(SKILL_ART[s.id]) ? `<img src="${artUrl(SKILL_ART[s.id])}" alt="">` : `<b class="g">${GLYPH[s.id] || ""}</b>`;
    const extra = s.type === "target" || s.type === "ground" ? `・距離 ${s.range} 格` : s.type === "dir" ? `・${s.dash ? "衝刺" : "射程"} ${s.range} 格` : "";
    return `<div class="mo-skc${lock ? " lock" : ""}">${ic}<div class="mo-skt"><h4>${esc(s.name)}${slot >= 0 ? ` <kbd>${KEYS[slot]}</kbd>` : ""}<span class="mo-ty t-${s.type}">${TYPE[s.type] || ""}</span>${lock ? `<em>${s.lv} 級學會</em>` : ""}</h4>
      <p>${esc(s.desc)}</p><small>${s.mp} 法力・冷卻 ${s.cd} 秒${extra}</small>
      ${assign && !lock ? `<div class="mo-assign">放到：${(me.slots || []).map((_, i) => `<button data-sid="${s.id}" data-slot="${i}" class="${slot === i ? "on" : ""}">${KEYS[i]}</button>`).join("")}</div>` : ""}</div></div>`;
  };
  function renderSkills() {
    if (!me || !me.skills) return;
    const n = me.skills.filter((s) => s.lv <= me.lv).length;
    const ns = (me.slots || []).length;
    panel.innerHTML = `<div class="mo-sheet"><header><h3>技能・${me.adv ? ADVN[me.adv] : CLS[me.cls] || ""}</h3><button class="mo-x" data-act="close">✕</button></header>
      ${me.advOk ? `<p class="mo-adv-tip">已經 25 級了，可以去長安城找<b>說書人</b>轉職，學新招式、多一格技能欄。</p>` : ""}
      <p class="mo-dim">已學會 ${n} / ${me.skills.length} 招，挑 ${ns} 招放到 ${KEYS.slice(0, ns).split("").join("、")}。按住技能鍵會顯示範圍，對準後放開就施放；也可以點技能鈕，再點地圖決定位置（按右鍵或 Esc 取消）。</p>
      <div class="mo-skl">${me.skills.map((s) => skillCard(s, true)).join("")}</div>
      <p class="mo-dim">普攻：點怪就會自動打，攻擊間隔 ${me.st.aspd} 秒、距離 ${me.st.range} 格。</p></div>`;
  }
  // 技能鈕的說明：滑鼠移上去（手機長按）跳出來
  const tipEl = $(".mo-tip"); let tipTimer = 0, tipLong = false;
  function showTip(btn) {
    const s = me && me.skills && me.skills.find((x) => x.id === btn.dataset.sk); if (!s) return;
    tipEl.innerHTML = skillCard(s, false); tipEl.hidden = false;
    const r = btn.getBoundingClientRect(), R = root.querySelector(".mmo").getBoundingClientRect();
    tipEl.style.left = Math.max(8, Math.min(R.width - tipEl.offsetWidth - 8, r.left - R.left + r.width / 2 - tipEl.offsetWidth / 2)) + "px";
    tipEl.style.top = (r.top - R.top - tipEl.offsetHeight - 8) + "px";
  }
  const skBar = $(".mo-skills");
  skBar.addEventListener("pointerover", (e) => { const b = e.target.closest("[data-sk]"); if (b && e.pointerType !== "touch") showTip(b); });
  skBar.addEventListener("pointerout", (e) => { if (e.pointerType !== "touch" && !e.relatedTarget?.closest?.("[data-sk]")) tipEl.hidden = true; });
  skBar.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-sk]"); if (!b || e.pointerType !== "touch") return; tipLong = false; clearTimeout(tipTimer); tipTimer = setTimeout(() => { tipLong = true; showTip(b); }, 450); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) skBar.addEventListener(ev, (e) => { if (e.pointerType === "touch") { clearTimeout(tipTimer); if (tipLong) setTimeout(() => { tipEl.hidden = true; }, 1600); } });
  function renderHelp() {
    const so = sndOpt();
    panel.innerHTML = `<div class="mo-sheet"><header><h3>怎麼玩</h3><button class="mo-x" data-act="close">✕</button></header>
      <div class="mo-snd">
        <div class="mo-sndrow"><span>技能音效</span><button data-snd="fx" class="${so.fx ? "on" : ""}">${so.fx ? "開" : "關"}</button><input type="range" min="0" max="100" step="1" value="${Math.round(so.fxv * 100)}" data-vol="fxv"${so.fx ? "" : " disabled"}><b class="mo-volv">${Math.round(so.fxv * 100)}</b></div>
        <div class="mo-sndrow"><span>背景環境音</span><button data-snd="amb" class="${so.amb ? "on" : ""}">${so.amb ? "開" : "關"}</button><input type="range" min="0" max="100" step="1" value="${Math.round(so.ambv * 100)}" data-vol="ambv"${so.amb ? "" : " disabled"}><b class="mo-volv">${Math.round(so.ambv * 100)}</b></div>
        <small>右下角的 🔊 是所有遊戲共用的總音量；這裡的兩條只調水墨江湖。</small></div>
      <ul class="mo-help"><li>操作跟 LOL 一樣：<b>左鍵（或右鍵）點地面走路，按住不放會一直跟著滑鼠走</b>；點怪物會自己走過去打，打死前會一直普攻。按 S 停下來，方向鍵也可以走。</li><li>技能：每個職業 8 招（轉職後再多 3 招），按 K（或右上「技能」）挑 4 招放到 <b>Q、W、E、R</b>（轉職後多一格 F）。施放照滑鼠位置：按住技能鍵會出現範圍指示，對準後放開就放；也可以點技能鈕再點地圖。招式分四種——指定（滑鼠指著怪）、指向（朝滑鼠方向射出或衝刺）、範圍（打在滑鼠位置）、自身。手機上點技能鈕會朝目前的目標放。</li>
      <li>藥：鍵盤 1 吃回血的藥、2 吃回魔的藥、3 用回城符。5 秒沒戰鬥會快速回血。</li><li>點其他玩家可以邀請組隊或交易。隊友在附近一起打怪，經驗平分還有加成。</li>
      <li>城裡：鐵匠買裝備、藥鋪買藥、錢莊換代幣。行囊裡隨時可以賣東西，下面有「一鍵賣裝」；想留著的裝備點開按「鎖定」就不會被賣掉。</li>
      <li>鍛造（鐵匠的「鍛造」分頁）：強化 +1～+12 加基礎數值（+7 以上失敗會掉一級）、用靈玉洗詞條、用重鑄石把品質往上提。材料打怪會掉，鐵匠也有賣。</li>
      <li>城裡其他 NPC：倉庫（同帳號的角色共用，互相轉東西）、懸賞榜捕快（每天 3 個任務）、客棧（吃了 30 分鐘有加成）、城隍廟（每天祈福抽一支籤）、賭坊（擲骰比大小）、江湖榜（各種排行）。</li>
      <li>多角色：每個帳號最多 4 個角色，等級各自練；銀兩和倉庫整個帳號共用，裝備和技能各自分開。右上「換角」回到選角畫面。</li>
      <li>轉職：25 級去找說書人，每個職業二選一，學 3 招新招、多一格技能欄（F）。</li>
      <li>鎖妖塔：城西的守塔人，20 級以上組隊進去打三波妖魔和九尾妖狐，每天 3 次，獎勵很好。</li>
      <li>擂台：在城裡點別人選「擂台切磋」，對方同意就開打，不掉東西、不扣經驗，城西的擂台主有排行榜。</li><li>傳送：長安城東邊的驛站車夫、和每張野外地圖入口的傳送石，可以直接傳到去過的地圖（付一點車資，回城免費）。回城符回城後，在城裡再按 3 可以免費回到原地；倒下後醒來也一樣。</li><li>死掉會扣一點經驗，回長安城復活。</li><li>聊天開頭打 <b>/p </b>只有隊友看得到。</li></ul></div>`;
  }
  panel.addEventListener("input", (e) => {       // 音量滑桿：拖的時候就即時套用
    const r = e.target.closest("input[data-vol]"); if (!r) return;
    const v = Number(r.value) / 100; setSnd(r.dataset.vol, v);
    const lab = r.parentElement.querySelector(".mo-volv"); if (lab) lab.textContent = r.value;
    if (r.dataset.vol === "fxv") snd.slash(1);
  });
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.act === "close") return closePanel();
    if (d.act === "sell") { sellMode = true; openP = "bag"; return renderBag(); }
    if (d.sellall != null) return send({ a: "sellall", r: Number(d.sellall) });
    if (d.lock) return send({ a: "lock", u: d.lock });
    if (d.act === "nosell") { sellMode = false; return renderBag(); }
    if (d.act === "tok") return send({ a: "tok" });
    if (d.sid) return send({ a: "slot", i: Number(d.slot), s: d.sid });
    if (d.buy) return send({ a: "buy", k: d.buy, n: Number(d.n || 1) });
    if (d.tab) { npcTab = d.tab; return renderNpc(); }
    if (d.sput) return send({ a: "stash", op: "put", u: d.sput });
    if (d.stake) return send({ a: "stash", op: "take", u: d.stake });
    if (d.bclaim != null) return send({ a: "bounty", i: Number(d.bclaim) });
    if (d.eat) return send({ a: "eat", k: d.eat });
    if (d.pray) { snd.gong(); return send({ a: "pray" }); }
    if (d.dice) { const bet = Number(panel.querySelector(".mo-bet").value); npcOpen.bet = bet; return send({ a: "dice", pick: d.dice, bet }); }
    if (d.rtab != null) { rankTab = Number(d.rtab); return renderNpc(); }
    if (d.advance) { closePanel(); return send({ a: "advance", k: d.advance }); }
    if (d.tower) { closePanel(); return send({ a: "tower" }); }
    if (d.snd) { setSnd(d.snd, !sndOpt()[d.snd]); return renderHelp(); }
    if (d.fsel) { forgeSel = d.fsel; forgeFx = null; return renderNpc(); }
    if (d.forge) return send({ a: "forge", u: forgeSel, op: d.forge });
    if (d.warp) { closePanel(); return send({ a: "warp", to: d.warp }); }
    if (d.recall) { closePanel(); return send({ a: "use", u: "tp" }); }
    if (d.bank) { const n = Math.floor(Number(panel.querySelector(".mo-amt").value)); if (n > 0) send({ a: "bank", op: d.bank, n }); return; }
    if (d.use) return send({ a: "use", u: d.use });
    if (d.unequip) return send({ a: "unequip", s: d.unequip });
    if (d.sell) return send({ a: "sell", u: d.sell });
    if (d.tadd || d.tpick) return send({ a: "tadd", u: d.tadd || d.tpick });
    if (d.u && openP === "bag") { if (sellMode && !d.eq) return send({ a: "sell", u: d.u }); return renderBag(d.u); }
  });
  panel.addEventListener("change", (e) => { if (e.target.classList.contains("mo-tg")) send({ a: "tgold", n: Math.max(0, Math.floor(Number(e.target.value) || 0)) }); });

  // ------------------------------------------------------------ 操作
  function toWorld(cx, cy) { const r = cv.getBoundingClientRect(); return { x: view.ox + (cx - r.left - W / 2) / zoom / TS, y: view.oy + (cy - r.top - H / 2) / zoom / TS }; }
  const isFoe = (md) => md.k === "m" || (map && map.pvp && md.k === "p");      // 擂台上玩家也是對手
  function hit(w) {
    let best = null, bd = 1e9;
    for (const e of ents.values()) {
      const md = meta[e.id]; if (!md || e.gone || e.id === myId) continue;
      const r = md.boss ? 1.5 : 0.75, d = Math.hypot(e.x - w.x, (e.y - 0.45 * (md.boss ? 2 : 1)) - w.y);
      if (d < r && d < bd + (md.k === "m" ? 0.2 : 0)) { bd = d; best = e; }
    }
    if (best) return { e: best, md: meta[best.id] };
    for (const n of (map && map.npcs) || []) if (Math.hypot(n.x - w.x, n.y - 0.5 - w.y) < 0.8) return { npc: n };
    return null;
  }
  // 滑鼠游標：一般是墨色箭頭，指到怪變紅劍、指到 NPC 變對話、指到玩家變藍色箭頭
  const svgCur = (svg, hx, hy) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, auto`;
  const CUR = {
    ground: svgCur(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><path d="M3 2 L30 15 L18 18.5 L24 31 L19.5 33 L13.5 20.5 L5 28 Z" fill="#16140f" stroke="#f6efe0" stroke-width="2.4" stroke-linejoin="round"/><circle cx="9" cy="10" r="2.6" fill="#c0392b"/></svg>`, 3, 2),
    player: svgCur(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><path d="M3 2 L30 15 L18 18.5 L24 31 L19.5 33 L13.5 20.5 L5 28 Z" fill="#2c4a8a" stroke="#f6efe0" stroke-width="2.4" stroke-linejoin="round"/></svg>`, 3, 2),
    mob: svgCur(`<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38"><g stroke="#f6efe0" stroke-width="2.4" stroke-linejoin="round"><path d="M3 3 L9 3 L27 21 L23 25 L5 7 Z" fill="#c0392b"/><path d="M20 28 L28 20 L31 23 L23 31 Z" fill="#16140f"/><path d="M27 27 L34 34" stroke="#16140f" stroke-width="5" stroke-linecap="round"/></g></svg>`, 3, 3),
    npc: svgCur(`<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38"><path d="M4 5 H33 V24 H17 L9 32 V24 H4 Z" fill="#f6efe0" stroke="#16140f" stroke-width="2.6" stroke-linejoin="round"/><circle cx="12" cy="14.5" r="2.2" fill="#c0392b"/><circle cx="18.5" cy="14.5" r="2.2" fill="#c0392b"/><circle cx="25" cy="14.5" r="2.2" fill="#c0392b"/></svg>`, 4, 5),
  };
  let curNow = "";
  cv.addEventListener("pointermove", (ev) => {
    if (map) mouseW = toWorld(ev.clientX, ev.clientY);
    if (!map || ev.pointerType === "touch") return;
    const h = hit(toWorld(ev.clientX, ev.clientY)), want = !h ? "ground" : h.npc ? "npc" : h.md.k === "m" ? "mob" : "player";
    if (want !== curNow) { curNow = want; cv.style.cursor = CUR[want]; }
  });
  cv.style.cursor = CUR.ground;
  cv.addEventListener("contextmenu", (ev) => { ev.preventDefault(); aiming = null; });
  cv.addEventListener("pointerdown", (ev) => {
    if (!map || !me) return;
    menuEl.hidden = true;
    const w = toWorld(ev.clientX, ev.clientY); mouseW = w;
    if (aiming) { if (ev.button === 2) { aiming = null; return; } const s = aiming.s; aiming = null; castAt(s, w); return; }
    if (ev.button !== 0 && ev.button !== 2) return;
    const h = hit(w);
    if (h && h.npc) { send({ a: "npc", id: h.npc.id }); return; }
    if (h && isFoe(h.md)) { send({ a: "atk", id: h.e.id }); me.tgt = h.e.id; return; }
    if (h && h.md.k === "p") { if (ev.button === 0) showMenu(ev, h.e, h.md); return; }
    send({ a: "move", x: w.x, y: w.y }); clickMark = { x: w.x, y: w.y, t0: performance.now() }; me.tgt = 0;
    if (ev.pointerType === "mouse") { holdMove = true; holdSent = w; }       // 按住不放：一直跟著滑鼠走
  });
  let holdMove = false, holdSent = null;
  for (const evn of ["pointerup", "pointercancel", "pointerleave"]) cv.addEventListener(evn, () => { holdMove = false; });
  setInterval(() => {
    if (!holdMove || !mouseW || !me || aiming) return;
    if (holdSent && Math.hypot(mouseW.x - holdSent.x, mouseW.y - holdSent.y) < 0.35) return;
    holdSent = { x: mouseW.x, y: mouseW.y }; send({ a: "move", x: mouseW.x, y: mouseW.y }); clickMark = { x: mouseW.x, y: mouseW.y, t0: performance.now() };
  }, 180);
  function showMenu(ev, e, md) {
    const r = root.querySelector(".mmo").getBoundingClientRect();
    menuEl.hidden = false; menuEl.style.left = Math.min(ev.clientX - r.left, r.width - 170) + "px"; menuEl.style.top = Math.min(ev.clientY - r.top, r.height - 120) + "px";
    menuEl.innerHTML = `<b>${esc(md.n)}</b><small>Lv${md.lv} ${ADVN[md.ad] || CLS[md.c] || ""}</small><button data-m="pinv">邀請組隊</button><button data-m="treq">交易</button>${map && map.id === "town" ? `<button data-m="duelreq">擂台切磋</button>` : ""}`;
    menuEl.onclick = (x) => { const b = x.target.closest("[data-m]"); if (b) { send({ a: b.dataset.m, id: e.id }); menuEl.hidden = true; } };
  }
  // 施放：照滑鼠位置；指定技能用滑鼠下的怪（沒有就用目前目標）
  let mouseW = null, aiming = null;
  const r2 = (v) => Math.round(v * 100) / 100;
  function castAt(s, w) {
    if (!s || !me) return;
    if (me.lv < s.lv) return toast(`${s.lv} 級才能用「${s.name}」`);
    if ((cdEnd[s.id] || 0) > performance.now()) return toast(`「${s.name}」還在冷卻`);
    if (me.mp < s.mp) return toast("法力不夠");
    const msg = { a: "skill", s: s.id };
    if (w) { msg.x = r2(w.x); msg.y = r2(w.y); }
    if (s.type === "target") { const h = w && hit(w); msg.id = h && h.md && isFoe(h.md) ? h.e.id : me.tgt || 0; if (!msg.id && !w) return toast("這招要指定一隻怪"); }
    send(msg);
  }
  function touchAim() { const tg = me.tgt && ents.get(me.tgt); return tg ? { x: tg.x, y: tg.y } : null; }
  $(".mo-skills").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !me) return;
    if (b.dataset.empty != null) { openPanel("skills"); return; }
    if (b.dataset.sk) {
      if (tipLong) { tipLong = false; return; }
      const s = me.skills.find((x) => x.id === b.dataset.sk); if (!s) return;
      if (s.type === "self") return castAt(s, null);
      if (e.pointerType === "touch" || lastPtr === "touch") return castAt(s, touchAim());
      aiming = aiming && aiming.s.id === s.id ? null : { s, click: true };       // 點技能鈕：進入瞄準，下一下點地圖施放
      return;
    }
    if (b.dataset.q === "tp") send({ a: "use", u: "tp" });
    else if (b.dataset.q) send({ a: "quaff", k: b.dataset.q });
  });
  let lastPtr = "mouse";
  root.addEventListener("pointerdown", (e) => { lastPtr = e.pointerType; }, true);
  function castSk(id) { const s = me.skills.find((x) => x.id === id); if (s) castAt(s, mouseW); }
  root.querySelector(".mo-btns").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (!b) return; if (openP === b.dataset.open) closePanel(); else openPanel(b.dataset.open); });
  root.querySelector(".mo-party").addEventListener("click", (e) => { if (e.target.closest("[data-act=pleave]")) send({ a: "pleave" }); });
  $(".mo-back").addEventListener("click", back);
  $(".mo-switch").addEventListener("click", () => send({ a: "switch" }));
  const sayIn = root.querySelector(".mo-say input");
  root.querySelector(".mo-say").addEventListener("submit", (e) => { e.preventDefault(); const v = sayIn.value.trim(); if (v) send({ a: "chat", text: v }); sayIn.value = ""; sayIn.blur(); });
  // 方向鍵：按住的方向鍵組成一個方向，改變時告訴伺服器；按著不放時每 0.4 秒再送一次（伺服器 1.2 秒沒收到就自己停）
  const held = new Set(); let dirSent = "", dirTimer = 0;
  const DIRK = { arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0] };      // 方向鍵走路（W 已經拿去放技能）
  function sendDir(force) {
    let x = 0, y = 0; for (const k of held) { x += DIRK[k][0]; y += DIRK[k][1]; }
    const key = x + "," + y;
    if (!force && key === dirSent) return;
    dirSent = key; send({ a: "dir", x, y });
    if (x || y) clickMark = null;
    clearInterval(dirTimer); if (x || y) dirTimer = setInterval(() => sendDir(true), 400);
  }
  function releaseAll() { if (held.size) { held.clear(); sendDir(); } }
  function onKey(e) {
    if (e.target === sayIn || (e.target.tagName === "INPUT")) { if (e.key === "Escape") sayIn.blur(); return; }
    if (!me) return;
    const k = e.key.toLowerCase();
    if (DIRK[k]) { e.preventDefault(); if (!held.has(k)) { held.add(k); sendDir(); } return; }
    if (e.repeat) return;
    if (k === "enter") { e.preventDefault(); releaseAll(); sayIn.focus(); }
    else if (k === "escape") { if (aiming) aiming = null; else if (!panel.hidden) closePanel(); else send({ a: "stop" }); }
    else if (k === "b" || k === "i") { if (openP === "bag") closePanel(); else openPanel("bag"); }
    else if (k === "k") { if (openP === "skills") closePanel(); else openPanel("skills"); }
    else if (k === "s") { send({ a: "stop" }); holdMove = false; clickMark = null; }
    else if (["q", "w", "e", "r", "f"].includes(k) && me.skills) {       // 按下：顯示範圍；放開：施放（自身技能按下就放）
      if (k === "f" && (me.slots || []).length < 5) return;
      const s = slotSkills()["qwerf".indexOf(k)];
      if (!s) { toast(`${k.toUpperCase()} 還沒放技能，按 K 選`); return; }
      if (s.type === "self") return castAt(s, null);
      aiming = { s, key: k };
    }
    else if (k === "1") { if (potCount("hp")) snd.potion(); send({ a: "quaff", k: "hp" }); }
    else if (k === "2") { if (potCount("mp")) snd.potion(); send({ a: "quaff", k: "mp" }); }
    else if (k === "3") send({ a: "use", u: "tp" });
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (DIRK[k] && held.delete(k)) sendDir();
    if (aiming && aiming.key === k) { const s = aiming.s; aiming = null; const meE = ents.get(myId); castAt(s, mouseW || (meE && { x: meE.x + 1, y: meE.y })); }
  }
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);

  if (new URLSearchParams(location.search).has("mmodebug")) window.__mmo = { send, ents, meta, get me() { return me; }, get map() { return map; }, get folk() { return folk; }, castSk };
  start();
  frame();
  return () => { closed = true; stopAmbience(); cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", releaseAll); clearInterval(dirTimer); try { ws && ws.close(); } catch {} };
}
