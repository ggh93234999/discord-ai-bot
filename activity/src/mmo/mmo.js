// 水墨江湖（MMORPG）前端：連線、點擊操作、畫面、介面。世界的規則全部在伺服器（server/games/mmo/）。
import "./mmo.css";
import { wsUrl } from "../gomoku.js";
import { TS, KAI, renderMap, drawPlayer, drawMob, bossAura, hpBar, label, nameTag, CLS_COLOR, RAR_COLOR, liquidStyle } from "./draw.js";
// 小王腳下的金色墨圈＋幾點飄起的金粉
function eliteAura(g, x, y, t, w) {
  const rx = w * 0.42 + 6, ry = rx * 0.36, pu = 0.5 + 0.5 * Math.sin(t / 380);
  g.save();
  g.strokeStyle = `rgba(176,122,26,${0.45 + 0.25 * pu})`; g.lineWidth = 2.4; g.beginPath(); g.ellipse(x, y + 2, rx, ry, 0, 0, 7); g.stroke();
  g.strokeStyle = "rgba(176,122,26,.22)"; g.lineWidth = 6; g.beginPath(); g.ellipse(x, y + 2, rx + 4, ry + 2, 0, 0, 7); g.stroke();
  for (let i = 0; i < 5; i++) { const ph = ((t / 1600 + i / 5) % 1), a = i * 1.26 + t / 2000; g.fillStyle = `rgba(214,160,50,${0.7 * (1 - ph)})`; g.beginPath(); g.arc(x + Math.cos(a) * rx * 0.8, y + 2 + Math.sin(a) * ry - ph * 40, 2.2, 0, 7); g.fill(); }
  g.restore();
}
import paperUrl from "../gacha-ui/paper.jpg";
import brushUrl from "../gacha-ui/brush.jpg";
import { art, artLoad, artUrl, drawArt, drawAnim, hasAnim, animMs, artReady, hasArt, MOB_ART, FLOAT, NPC_ART, SKILL_ART, itemArt } from "./art.js";
import townArt from "../gacha-ui/m_town.jpg";
import { ENH, REROLL, RECAST, SETS, SKILLS, ADV_SKILLS, ADV2_SKILLS } from "../../server/games/mmo/data.js";
// 所有技能的名字（單一技能冷卻詞條「cd_技能id」要顯示招式名，別的職業的招也要認得）
const SKNAME = {}; for (const L of [...Object.values(SKILLS), ...Object.values(ADV_SKILLS), ...Object.values(ADV2_SKILLS)]) for (const sk of L) SKNAME[sk.id] = sk.name;
import { snd, ambience, stopAmbience, sndOpt, setSnd } from "./sfx.js";
import { createVfx, vfxOpt, setVfx } from "./vfx.js";
import { SHEETFX } from "./sheetfx.js";
import { STORY } from "../../server/games/mmo/story.js";
import { SKFX, SK_EL, BOSSFX } from "./skfx.js";
const FIRE_SK = new Set(["fire", "dragon", "inferno", "sanmei", "fenghuang", "huohai"]), THUNDER_SK = new Set(["thunder", "wulei"]), ICE_SK = new Set(["ice"]);
import forestArt from "../gacha-ui/m_forest.jpg";
import sceneArt from "../gacha-ui/m_scenery.jpg";
import ruinArt from "../gacha-ui/m_ruin.jpg";

const AREA_ART = { town: townArt, bamboo: forestArt, mount: sceneArt, tomb: ruinArt };
const AREA_BOSS = { snow: "b_snow", fire: "b_qilin", demon: "b_lord", tower: "b_fox", sea: "b_dragon", kunlun: "b_kaiming", hell: "b_yama", heaven: "b_erlang" };     // 新地圖的地區卡用王的圖
const GLYPH = { sweep: "掃", guard: "罩", thrust: "刺", fire: "火", heal: "春", thunder: "雷", triple: "珠", gale: "風", rain: "雨" };
const CLS_GLYPH = { sword: "劍", mage: "術", archer: "弓" };
const paperImg = new Image(); paperImg.src = paperUrl;
const brushImg = new Image(); brushImg.src = brushUrl;
const USE_PROPS = ["e_bamboo1", "e_rock1", "e_pine1", "e_plum1", "e_grave1", "e_house1", "e_gate"].every(hasArt);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => Number(n || 0).toLocaleString();
const STAT = { atk: "攻擊", def: "防禦", hp: "生命", mp: "法力", crit: "暴擊%", aspd: "攻速%", ls: "吸血%", thorn: "反傷%", cdmg: "暴擊傷害%", dodge: "閃避%", ms: "移速%", pen: "破甲%", cdr: "冷卻縮減%" };
const SPST = ["ls", "thorn", "cdmg", "dodge", "ms", "pen", "cdr"];       // 特效詞條（顯示成金色）
const RAR = ["普通", "精良", "稀有", "傳說"];
const RAR_AFF = [0, 1, 2, 3];
const SLOT = { weapon: "武器", helm: "頭冠", armor: "衣服", belt: "腰帶", boots: "鞋子", acc: "飾品", ring: "戒指" };
const CLS = { sword: "劍客", mage: "術士", archer: "弓手" };
const ADVN = { jx: "劍仙", bd: "霸刀", ts: "天師", ft: "焚天", ss: "神射", ly: "獵影", sj: "劍聖", tj: "天劍", dh: "刀皇", xl: "修羅", zr: "真人", tl: "通靈", yd: "炎帝", jy: "九幽", jn: "箭神", pj: "破軍", ys: "影殺", jg: "機關" };
const KEYS = "QWERFD";
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
          <div class="mo-bar xp"><i></i><span></span></div>
        </div>
        <div class="mo-buffs"></div>
      </div>
      <div class="mo-party"></div>
      <div class="mo-right">
        <canvas class="mo-mini" width="132" height="96"></canvas>
        <div class="mo-mapname"></div>
        <div class="mo-gold"></div>
        <div class="mo-btns"><button data-open="bag">行囊 <kbd>B</kbd></button><button data-open="skills">技能 <kbd>K</kbd></button><button data-open="help">說明</button><button data-open="set" title="音量、特效品質">設定</button><button class="mo-switch" title="回到選角色畫面">換角</button></div>
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
  if (hasArt("e_titlebg")) startEl.style.setProperty("--titlebg", `url(${artUrl("e_titlebg")})`);      // 登入、選角、建角都用同一張山水當背景

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
  // ------------------------------------------------------------ 地上的掉落物
  let loot = [], lava = null;
  const LOOT_COL = ["#e6dfcc", "#86d6a6", "#93b4ff", "#ff9f5e"];          // 普通／精良／稀有／傳說（地上的字，深色底上看得清楚）
  const lootCol = (l) => (!l.mine ? "#8d877a" : l.set ? "#f0c95a" : LOOT_COL[l.r || 0]);
  function drawLoot(l, t) {
    const x = l.x * TS, y = l.y * TS, age = t - l.t0, pop = Math.min(1, age / 260), drop = (1 - pop) * 22, col = lootCol(l);
    if (l.mine && (l.r >= 2 || l.set)) {       // 稀有以上：一道光柱
      const gr = g.createLinearGradient(x, y - 70, x, y); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, col + "88");
      g.fillStyle = gr; g.fillRect(x - 5 - Math.sin(t / 300) * 1.5, y - 70, 10 + Math.sin(t / 300) * 3, 70);
    }
    g.fillStyle = "rgba(22,20,15,.22)"; g.beginPath(); g.ellipse(x, y + 2, 11, 4, 0, 0, 7); g.fill();
    const name = l.p ? (l.p.startsWith("hp") ? "i_hp" : l.p.startsWith("mp") ? "i_mp" : l.p === "tp" ? "i_tp" : "i_" + l.p) : l.s === "weapon" ? (l.c === "mage" ? "i_staff" : l.c === "archer" ? "i_bow" : "i_sword") : l.s === "armor" ? "i_armor" : "i_acc";
    if (!drawArt(g, name, x, y - drop + Math.sin(t / 500 + l.id) * 1.5, 30, 30, { alpha: l.mine ? 1 : 0.6 })) { g.fillStyle = col; g.beginPath(); g.arc(x, y - 8 - drop, 6, 0, 7); g.fill(); }
    // 名字牌
    g.font = `600 12px ${KAI}`; const tw = g.measureText(l.n).width + 12, ly = y - 44 - drop;
    g.fillStyle = "rgba(22,20,15,.72)"; g.beginPath(); g.roundRect(x - tw / 2, ly - 9, tw, 18, 3); g.fill();
    if (l.mine && l.r >= 3) { g.strokeStyle = col; g.lineWidth = 1; g.stroke(); }
    g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(l.n, x, ly + 0.5); g.textBaseline = "alphabetic";
    l._lw = tw / TS;
  }
  function hitLoot(w) {
    let best = null, bd = 1e9;
    for (const l of loot) {
      const onLabel = Math.abs(w.x - l.x) < (l._lw || 1.5) / 2 && w.y > l.y - 44 / TS - 0.25 && w.y < l.y - 44 / TS + 0.25;
      const d = Math.hypot(w.x - l.x, w.y - (l.y - 0.25));
      if ((onLabel || d < 0.5) && d < bd) { bd = d; best = l; }
    }
    return best;
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
      case "npcs": if (map) map.npcs = m.npcs || []; return;          // 副本裡新出現的 NPC（打完王的出口傳送門）
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
      case "npc": if (!npcOpen || npcOpen.id !== m.id) { npcTab = "buy"; forgeSel = null; } npcOpen = m; pendingNpc = null;
        if (m.kind === "story" && m.story) { const ok = m.story.list.find((x) => x.st === "ok"); storyCh = ok ? ok.i : null; storyPage = 0; }
        openPanel("npc"); return;
      case "storyok": snd.success(); toast(`聽完第 ${m.i + 1} 回：+${money(m.exp)} 經驗、+${money(m.gold)} 兩`); if (npcOpen && npcOpen.kind === "story") { npcOpen.story = m.story; storyCh = null; if (openP === "npc") renderNpc(); } return;
      case "npcup": if (npcOpen) { Object.assign(npcOpen, m); if (m.slipAnim) npcOpen.anim = performance.now(); if (openP === "npc") renderNpc(); } return;
      case "dice": diceRes = m; diceRoll = performance.now(); if (openP === "npc") { renderNpc(); setTimeout(() => { if (openP === "npc" && npcOpen && npcOpen.kind === "casino") renderNpc(); snd[m.win > 0 ? "coin" : "fail"](); }, 750); } snd.click(); return;
      case "forged": forgeFx = m; snd.anvil(); (m.ok ? snd.success : snd.fail)(); return;
      case "bank": if (npcOpen) { Object.assign(npcOpen, { tokens: m.tokens, used: m.used, cap: m.cap, ...(m.pool != null ? { pool: m.pool, poolIn: m.poolIn } : {}) }); if (openP === "npc") renderNpc(); } return;
      case "walkto": pendingNpc = m.id; return;
      case "inst": { if (m.lava) lava = { x: m.lava.x, v: m.lava.v, t0: performance.now() }; const el = $(".mo-mapname span"); if (el) { el.textContent = m.text; el.classList.add("inst"); } if (m.text === "開打！" || m.text.startsWith("通關")) { if (!el || el.dataset.last !== m.text) snd.gong(); } if (el) el.dataset.last = m.text; return; }
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
      startEl.innerHTML = `<div class="mo-logo">水墨江湖<small>選一位俠客，踏入江湖</small></div><div class="mo-sheet mo-chars"><h2>選擇角色</h2>
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
    mapCv = mk(); loot = []; lava = null; V.clear();
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
  // 小地圖比例：一般地圖整張塞得下；太長（副本走廊）就讓短邊填滿，長邊跟著自己捲動
  const miniScale = () => { const fit = Math.min(mini.width / map.w, mini.height / map.h), fill = Math.max(mini.width / map.w, mini.height / map.h); return fill / fit > 1.6 ? Math.min(fill, fit * 3.2) : fit; };
  function makeMini() {
    const s = miniScale(); miniBase = document.createElement("canvas"); miniBase.width = Math.ceil(map.w * s); miniBase.height = Math.ceil(map.h * s);
    miniBase.getContext("2d").drawImage(mapCv, 0, 0, map.w * s, map.h * s);
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
    if (m.loot) { const old = new Map(loot.map((l) => [l.id, l])); loot = m.loot.map((l) => ({ ...l, t0: old.has(l.id) ? old.get(l.id).t0 : t })); }
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
      case "warn": case "wline": case "wcone": case "wring": return snd.warn(near);
      case "bsk": return ["icicle", "breath", "tide", "whirl"].includes(f.s) ? snd.ice(near) : ["charge", "nova"].includes(f.s) ? snd.fire(near) : ["eye", "trident"].includes(f.s) ? snd.thunder(near) : ["leaves", "foxfire", "blink", "chain"].includes(f.s) ? snd.whoosh(near) : snd.boom(near);
      case "slam": return snd.boom(near);
    }
  }
  function float(x, y, text, col, size = 15, life = 900) { floaters.push({ x, y, text, col, size, t0: performance.now(), life }); }
  // 放技能的瞬間：腳下炸開一圈氣勁＋身上一閃（顏色照職業），讓「出招」看得出來
  const CAST_RGB = { sword: "150,190,230", jx: "150,195,235", sj: "170,215,240", tj: "150,200,235", bd: "196,70,44", dh: "214,160,60", xl: "190,40,36", mage: "230,190,90", ts: "220,190,90", zr: "160,170,255", tl: "230,200,110", ft: "255,130,50", yd: "255,120,40", jy: "110,220,190", archer: "240,200,110", ss: "245,205,120", jn: "255,215,120", pj: "250,130,60", ly: "150,120,190", ys: "140,100,190", jg: "200,170,110" };
  // 水面、熔岩會動：水偶爾閃一下光、熔岩冒泡＋光一明一暗（只畫畫面裡的格子）
  function liquidFx(g, t) {
    if (vfxOpt().q === "l") return;
    if (!map._liq) { map._liq = []; for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] == 2) map._liq.push([i % map.w, Math.floor(i / map.w), (i * 2654435761 % 1000) / 1000]); }
    if (!map._liq.length) return;
    const LQ = liquidStyle(map.theme), x0 = view.ox - view.vw / 2 - 1, x1 = view.ox + view.vw / 2 + 1, y0 = view.oy - view.vh / 2 - 1, y1 = view.oy + view.vh / 2 + 1;
    g.save();
    for (const [cx, cy, ph] of map._liq) {
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      const px = (cx + 0.2 + ph * 0.6) * TS, py = (cy + 0.25 + ((ph * 7) % 1) * 0.5) * TS;
      if (LQ.lava) {
        const k = ((t / 1000 + ph * 9) % 2.6) / 2.6;          // 冒泡：慢慢鼓起來、破掉
        if (k < 0.5) { const r = 2 + k * 9; g.globalAlpha = 0.65; g.fillStyle = `rgba(${LQ.glow},1)`; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.globalAlpha = 0.5; g.strokeStyle = "rgba(60,24,10,1)"; g.lineWidth = 1; g.stroke(); }
        else if (k < 0.6) { g.globalAlpha = (0.6 - k) * 6; g.strokeStyle = `rgba(${LQ.glow},1)`; g.lineWidth = 1.4; g.beginPath(); g.arc(px, py, 7 + (k - 0.5) * 90, 0, 7); g.stroke(); }
        if (ph < 0.3) { const a = 0.16 + 0.12 * Math.sin(t / 700 + ph * 20); const gr = g.createRadialGradient(px, py, 0, px, py, TS * 0.9); gr.addColorStop(0, `rgba(${LQ.glow},${a})`); gr.addColorStop(1, `rgba(${LQ.glow},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(px - TS, py - TS, TS * 2, TS * 2); }
      } else if (ph < 0.45) {
        const a = Math.pow(Math.max(0, Math.sin(t / 1300 + ph * 40)), 6) * 0.7;      // 水面閃光：一下下就好
        if (a > 0.02) { g.globalAlpha = a; g.strokeStyle = "rgba(255,255,250,1)"; g.lineWidth = 1.4; g.lineCap = "round"; const dx = Math.sin(t / 2000 + ph * 10) * 4; g.beginPath(); g.moveTo(px - 7 + dx, py); g.quadraticCurveTo(px + dx, py - 2, px + 7 + dx, py); g.stroke(); }
      }
    }
    g.restore();
  }
  function castFx(f, a) {
    const md = meta[f.a], rgb = (md && (CAST_RGB[md.ad] || CAST_RGB[md.c])) || "220,200,150", mine = f.a === myId;
    if (!mine && vfxOpt().others && vfxOpt().q !== "h") return;
    const x = a.x * TS, y = a.y * TS;
    V.ring(x, y + 2, 46, rgb, 360, 7);
    V.p({ tex: "glow", rgb, x, y: y - 30, s0: 40, s1: 120, a0: 0.75, a1: 0, life: 300, blend: "a" });
    V.emit(10, mine, (i, k) => { const an = (i / k) * 6.28; return { tex: "glow", rgb, x: x + Math.cos(an) * 14, y: y + Math.sin(an) * 6, z: 4, vx: Math.cos(an) * 2.2, vy: Math.sin(an) * 1, vz: 1.6 + Math.random() * 1.6, g: 0.05, drag: 0.05, s0: 10, s1: 2, a0: 0.9, a1: 0, life: 420, blend: "a" }; });
  }
  function onFx(f, t) {
    const a = posOf(f.a), b = posOf(f.b), mine = f.a === myId;
    sound(f, a, b);
    if ((f.k === "h" || f.k === "m" || f.k === "sk") && a) { const ea = ents.get(f.a); if (ea) { ea.atkT = t; if (f.k === "sk") { ea.castT = t; castFx(f, a); } const tx = b ? b.x : f.x; if (tx != null && Math.abs(tx - a.x) > 0.05) ea.face = tx > a.x ? 1 : -1; } }
    switch (f.k) {
      case "h": case "s": {
        if (!b) return;
        { const eb = ents.get(f.b); if (eb && a) { eb.kbT = t; eb.kbD = b.x >= a.x ? 1 : -1; } }
        V.hit(b.x * TS, b.y * TS, f.k === "s" ? SK_EL[f.s] || "ink" : "ink", !!f.c, mine, f.k === "s" ? 1.2 : 1);
        if (f.c && mine) shake = Math.max(shake, 5);
        if (f.k === "h" && a) {
          const md0 = meta[f.a], cls = md0 && md0.c, ang = Math.atan2(b.y - a.y, b.x - a.x), lim = mine || !vfxOpt().others;
          if (md0 && md0.k === "p" && (lim || Math.random() < 0.4)) {
            if (cls === "archer") { const tr = V.trail({ w: 2, rgb: "22,20,15", a: 0.5, keep: 140 }); V.actor({ life: 130, update: (tt, k) => { tr.add((a.x + (b.x - a.x) * k) * TS, (a.y + (b.y - a.y) * k) * TS, 30); if (k >= 1) tr.done = true; }, draw: (g2, tt, k) => V.drawTex(g2, "x_arrow", null, (a.x + (b.x - a.x) * k) * TS, (a.y + (b.y - a.y) * k) * TS - 30, 36, ang, 1, "s") }); }
            else if (cls === "mage") V.actor({ life: 180, draw: (g2, tt, k) => { const x = (a.x + (b.x - a.x) * k) * TS, y = (a.y + (b.y - a.y) * k) * TS - 30 - Math.sin(k * Math.PI) * 14; V.drawTex(g2, "glow", "90,180,150", x, y, 34, 0, 0.8, "a"); V.drawTex(g2, "dot", "40,110,90", x, y, 10, 0, 1, "s"); } });
            else V.slash(b.x * TS - Math.cos(ang) * 12, b.y * TS - 30, ang + (Math.random() < 0.5 ? -0.6 : 0.6), f.c ? 110 : 76, null, 210, { flip: Math.random() < 0.5, a: 0.85 });
          } else fx.push({ k: RANGED[cls] ? (cls === "mage" ? "orb" : "arrow") : "slash", a, b, t0: t, life: RANGED[cls] ? 220 : 260 });
        }
        floaters.push({ x: b.x + (Math.random() - 0.5) * 0.5, y: b.y - 1.1, text: String(f.d), col: f.c ? "#b5342a" : mine ? "#16140f" : "#6d675b", size: f.c ? 24 : mine ? 18 : 13, t0: t, life: f.c ? 1100 : 850, crit: !!f.c, kai: true });
        return;
      }
      case "m": if (!b) return; float(b.x, b.y - 1.6, "-" + f.d, "#b5342a", 16); { const eb = ents.get(f.b); if (eb && a) { eb.kbT = t; eb.kbD = b.x >= a.x ? 1 : -1; } } V.hit(b.x * TS, b.y * TS, "blood", false, f.b === myId, 0.7); if (f.b === myId) shake = Math.max(shake, 6); return;
      case "sk": {
        if (SHEETFX[f.s] && vfxOpt().q !== "l") { try { SHEETFX[f.s](skCtx(f), f); } catch {} }      // 招牌技能：疊上 AI 逐格特效
        if (SKFX[f.s]) { SKFX[f.s](skCtx(f), f); return; }
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
      case "tick": if (SKFX[f.s]) return; fx.push({ k: "tick", s: f.s, x: f.x, y: f.y, r: f.r, t0: t, life: 520 }); burst(f.x, f.y - 0.3, 12, f.s === "inferno" ? "181,52,42" : "22,20,15", 1.4); return;
      case "dot": if (b) {
        const el = SK_EL[f.s] || "poison", x = b.x * TS, y = b.y * TS;
        float(b.x + 0.3, b.y - 1.0, String(f.d), el === "fire" ? "#c0582a" : el === "thunder" ? "#3a4f86" : "#3f7a2c", 13, 800);
        if (el === "fire") V.emit(4, mine, () => ({ tex: "x_flame", x: x + (Math.random() - 0.5) * 24, y, z: 4, vz: 1.2 + Math.random(), s0: 18, s1: 5, a0: 0.9, fin: 0.2, life: 380 }));
        else V.emit(3, mine, () => ({ tex: "x_mist", x: x + (Math.random() - 0.5) * 24, y, z: 20, vz: 0.4, rot: Math.random() * 6.28, s0: 18, s1: 36, a0: 0.45, life: 600 }));
      } return;
      case "heal": if (b) { if (f.d) float(b.x, b.y - 1.3, "+" + f.d, "#3f7a52", 15); if (f.m) float(b.x + 0.3, b.y - 1.0, "+" + f.m, "#3a4f86", 13); fx.push({ k: "heal", b, t0: t, life: 600 }); } return;
      case "lvl": if (b) { floaters.push({ x: b.x, y: b.y - 2.3, text: "升級", col: "#a8832a", size: 30, t0: t, life: 1800, kai: true }); fx.push({ k: "lvl", b, t0: t, life: 1400 }); burst(b.x, b.y - 1, 24, "168,131,42", 1.6); } return;
      case "kill": if (b) {
        fx.push({ k: "ink", b, t0: t, life: 800 }); const ed = ents.get(f.b); if (ed) ed.dieT = t;
        const big = meta[f.b] && (meta[f.b].boss ? 3 : meta[f.b].el ? 1.8 : 1), x = b.x * TS, y = b.y * TS;
        V.emit(10 * big, true, () => ({ tex: "x_bloom", x: x + (Math.random() - 0.5) * 30 * big, y, z: 10 + Math.random() * 30 * big, vz: 0.3 + Math.random() * 0.9, vx: (Math.random() - 0.5) * 1.2, drag: 0.03, s0: 16 * big, s1: 46 * big, a0: 0.5, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.03, life: 650 + Math.random() * 400 }));
        V.emit(8 * big, true, () => { const a2 = Math.random() * 6.28, v = 1 + Math.random() * 3; return { tex: "dot", x, y, z: 20, vx: Math.cos(a2) * v, vy: Math.sin(a2) * v * 0.5, vz: 1 + Math.random() * 2, g: 0.25, s0: 6, s1: 2, a0: 0.9, life: 500 }; });
        V.decal({ tex: "x_splat", x, y, w: 50 * big, rot: Math.random() * 6.28, a: 0.3, life: 2400 });
        if (big >= 3) { shake = Math.max(shake, 8 * Math.max(0.3, nearMe(b.x, b.y))); V.ring(x, y, 4 * TS, "22,20,15", 700, 10); }
      } return;
      case "gold": if (mine && b) float(b.x + 0.4, b.y - 0.6, `+${f.d} 兩`, "#a8832a", 13, 1100); return;
      case "loot": if (b) float(b.x, b.y - 0.3, f.n, RAR_COLOR[f.r || 0], 14, 1500); if (mine) addChat({ sys: true, text: `獲得「${f.n}」` }); return;
      case "warn": fx.push({ k: "warn", b: { x: f.x, y: f.y }, r: f.r, t0: t, life: f.t, c: f.c }); return;
      case "wline": case "wcone": case "wring": fx.push({ ...f, t0: t, life: f.t }); return;      // 王的預警：直線、扇形、環形
      case "bsk": if (BOSSFX[f.s]) BOSSFX[f.s](bossCtx(), f); return;
      case "petshot": if (SHEETFX[f.s + "_shot"] && vfxOpt().q === "h") { try { SHEETFX[f.s + "_shot"](skCtx(f), f); } catch {} } if (SKFX[f.s + "_shot"]) SKFX[f.s + "_shot"](skCtx(f), f); return;     // 召喚物（劍陣、神將、砲台）出手
      case "wcol": case "wrow": fx.push({ ...f, t0: t, life: f.t }); return;          // 箭陣／滾石的警示
      case "arrows": fx.push({ ...f, t0: t, life: 420 }); shake = Math.max(shake, 3); return;
      case "boulder": fx.push({ ...f, t0: t, life: f.dur + 200 }); return;
      case "pzone": case "izone": fx.push({ ...f, t0: t, life: f.dur }); return;
      case "safe": fx.push({ ...f, t0: t, life: f.t + 400 }); snd.warn(1); return;
      case "slam": fx.push({ k: "slam", b: { x: f.x, y: f.y }, r: f.r, t0: t, life: 450 }); shake = Math.max(shake, 11 * Math.max(0.3, nearMe(f.x, f.y))); burst(f.x, f.y, 18, "22,20,15", 2.2);
        V.ring(f.x * TS, f.y * TS, f.r * TS, "22,20,15", 420, 9); V.dust(f.x * TS, f.y * TS, f.r * TS * 0.8, 8, true); V.decal({ tex: "x_crack", x: f.x * TS, y: f.y * TS, w: f.r * TS * 1.5, rot: Math.random() * 6.28, a: 0.5, life: 2200 }); return;
      case "die": if (f.b === myId) $(".mo-dead").hidden = false; return;
      case "miss": if (b) float(b.x, b.y - 1.6, "閃避", "#3a4f86", 15, 700); return;
      case "tidewave": {
        flashC = "110,160,200"; flash = Math.max(flash, 0.7); shake = Math.max(shake, 10);
        const e = ents.get(myId); if (e) V.emit(40, true, () => { const a = Math.random() * 6.28, d = Math.random() * 9 * TS; return { tex: Math.random() < 0.5 ? "x_mist" : "dot", rgb: Math.random() < 0.5 ? "120,170,200" : "220,236,244", x: e.x * TS + Math.cos(a) * d, y: e.y * TS + Math.sin(a) * d * 0.6, z: 10, vx: 3 + Math.random() * 3, vz: 1 + Math.random() * 3, g: 0.15, rot: Math.random() * 6.28, s0: 20 + Math.random() * 30, s1: 60, a0: 0.6, life: 700 + Math.random() * 400 }; });
        return;
      }
    }
  }

  // ------------------------------------------------------------ 墨點飛濺（打擊感）
  let sparks = [], flash = 0, flashC = "250,248,240", stopUntil = 0, stopCd = 0;
  // 特效引擎：頓幀（打中的瞬間畫面停一下）有冷卻，避免連打時一直卡
  const V = createVfx({ stop: (ms) => { const t = performance.now(); if (t > stopCd) { stopUntil = t + ms; stopCd = t + 280; } } });
  // 王的招式：離自己越近震得越大
  const nearMe = (x, y) => { const e = ents.get(myId); return e ? Math.max(0, 1 - Math.hypot(e.x - x, e.y - y) / 10) : 0; };
  const bossCtx = () => ({ V, TS, pos: (id) => posOf(id), mine: true, near: nearMe, shake: (n) => { shake = Math.max(shake, n); }, flash: (rgb, a) => { flashC = rgb; flash = Math.max(flash, a); }, stop: (ms) => V.hooks.stop(ms) });
  const skCtx = (f) => ({ V, TS, drawArt, pos: (id) => posOf(id), mine: f.a === myId, shake: (n) => { shake = Math.max(shake, n); }, flash: (rgb, a) => { flashC = rgb; flash = Math.max(flash, a); }, stop: (ms) => V.hooks.stop(ms) });
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
    if (t < stopUntil) return;                 // 頓幀：這幾十毫秒保持上一格畫面
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
    liquidFx(g, t);
    for (const p of map.portals) label(g, p.x * TS + TS / 2, p.y * TS - TS * 0.95, p.label, "#b5342a", 13, true);
    // 點地上的漣漪
    if (clickMark && t - clickMark.t0 < 500) { const k = (t - clickMark.t0) / 500; g.strokeStyle = `rgba(22,20,15,${0.6 * (1 - k)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(clickMark.x * TS, clickMark.y * TS, 6 + 14 * k, (6 + 14 * k) * 0.45, 0, 0, 7); g.stroke(); }
    // 目標圈（朱砂）
    const tg = me && me.tgt && ents.get(me.tgt);
    if (tg) { const r = (meta[tg.id] && meta[tg.id].boss ? 30 : meta[tg.id] && meta[tg.id].el ? 23 : 17) ; g.strokeStyle = "rgba(181,52,42,.85)"; g.lineWidth = 2.2; g.setLineDash([5, 4]); g.lineDashOffset = -t / 40; g.beginPath(); g.ellipse(tg.x * TS, tg.y * TS + 2, r, r * 0.42, 0, 0, 7); g.stroke(); g.setLineDash([]); }
    if (aiming && meE && mouseW && !me.dead) drawAim(meE, aiming.s, mouseW);
    // 底層特效（警示圈）
    groundFx(t);
    for (const f of fx) if (f.k === "warn") { const k = Math.min(1, (t - f.t0) / f.life), col = f.c === "g" ? "70,140,60" : f.c === "b" ? "70,120,190" : "181,52,42"; inkWarn(f.b.x * TS, f.b.y * TS, f.r * TS, col, k, Math.round(f.b.x * 7 + f.b.y * 13)); }
    for (const f of fx) if (f.k === "wline" || f.k === "wcone" || f.k === "wring") tele(f, t);
    V.update(t); V.draw(g, t, "g");           // 特效：地面層（殘痕、法陣、光環）
    // 人物、怪物、NPC 依 y 排序
    const list = [];
    for (const e of ents.values()) list.push(e);
    for (const n of map.npcs) list.push({ npc: n, x: n.x, y: n.y });
    for (const f of folk) { stepFolk(f, t); list.push({ folk: f, x: f.x, y: f.y }); }
    for (const l of loot) list.push({ loot: l, x: l.x, y: l.y - 0.01 });
    if (mapCv.props) for (const p of mapCv.props) { const px = p.x / TS, py = p.y / TS; if (Math.abs(px - ox) < vw / 2 + 4 && py > oy - vh / 2 - 1 && py - p.h / TS < oy + vh / 2 + 1) list.push({ prop: p, x: px, y: py }); }
    list.sort((a, b) => a.y - b.y);
    const ysl = V.sorted(t); let yi = 0;          // 貼地的特效跟人物一起排前後
    for (const e of list) {
      const x = e.x * TS, y = e.y * TS;
      while (yi < ysl.length && ysl[yi].y <= y) V.drawOne(g, ysl[yi++], t);
      if (e.prop) {
        const p = e.prop; let alpha = 1;
        if (meE && p.y > meE.y * TS + 2 && Math.abs(meE.x * TS - p.x) < p.w * 0.42 && meE.y * TS > p.y - p.h * 0.9) alpha = 0.42;   // 擋到自己就半透明
        drawArt(g, p.n, p.x, p.y, p.w, p.h, { face: p.face, alpha, tone: p.n.startsWith("t_") || p.n === "e_hall" || p.n.startsWith("e_house") ? "b" : "d" });
        continue;
      }
      if (Math.abs(e.x - ox) > vw / 2 + 3 || Math.abs(e.y - oy) > vh / 2 + 3) continue;
      if (e.loot) { drawLoot(e.loot, t); continue; }
      if (e.folk && PET[e.folk.art] && hasAnim(`a_${PET[e.folk.art].key}_walk`)) {
        const f = e.folk, P = PET[f.art], A = `a_${P.key}_${f.moving ? "walk" : "idle"}`;
        g.fillStyle = "rgba(22,20,15,.18)"; g.beginPath(); g.ellipse(x, y + 2, 13 * P.sz, 4.5 * P.sz, 0, 0, 7); g.fill();
        if (!drawAnim(g, A, x, y + 3, TS * P.sz, TS * P.sz * 0.85, { face: f.face, t: t + f.ph * 997, ref: f.moving ? P.walkRef : f.art })) drawArt(g, f.art, x, y + 3, TS * P.sz, TS * P.sz * 0.85, { face: f.face });
        continue;
      }
      if (e.folk) { const f = e.folk, small = FOLK_SMALL[f.art]; g.fillStyle = "rgba(22,20,15,.18)"; g.beginPath(); g.ellipse(x, y + 2, small ? 11 : 16, small ? 4 : 6, 0, 0, 7); g.fill(); drawArt(g, f.art, x, y + 3 - (f.moving ? Math.abs(Math.sin(t / 110 + f.ph)) * 2.2 : 0), small ? TS * 0.9 : TS * 1.35, small ? TS * 0.75 : TS * 1.7, { face: f.face, sy: f.moving ? 1 : 1 + Math.sin(t / 800 + f.ph) * 0.01 }); continue; }
      if (e.npc && hasArt(e.npc.art || NPC_ART[e.npc.kind])) {
        const NA = e.npc.art || NPC_ART[e.npc.kind], face = meE && Math.abs(meE.x - e.x) > 0.2 ? (meE.x > e.x ? 1 : -1) : 1, isStory = e.npc.kind === "story";
        g.fillStyle = "rgba(22,20,15,.22)"; g.beginPath(); g.ellipse(x, y + 2, 20, 7, 0, 0, 7); g.fill();
        if (!drawAnim(g, e.npc.anim || `a_${e.npc.kind}_idle`, x, y + 4, TS * 1.7, TS * 2, { face, t: t + x * 7, ref: NA })) drawArt(g, NA, x, y + 4, TS * 1.7, TS * 2, { face, sy: 1 + Math.sin(t / 700 + x) * 0.008 });
        label(g, x, y - TS * 2 - 6, e.npc.name, isStory ? "#2c5d6b" : "#b5342a", 13, true);
        const bob = Math.sin(t / 300) * 2;
        if (isStory) {      // 說故事的人：輪到他講下一回（而且等級夠）就冒金色的「！」，不然只有一個淡淡的「…」
          const nx = me && STORY[me.story || 0], ready = nx && nx.npc === e.npc.id && me.lv >= nx.lv, my = y - TS * 2 - 26 + bob;
          if (ready) { g.fillStyle = "#c9962a"; g.beginPath(); g.arc(x, my - 4, 11, 0, 7); g.fill(); g.strokeStyle = "#fff8e6"; g.lineWidth = 2; g.stroke(); g.fillStyle = "#fffaf0"; g.font = `700 16px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("！", x, my - 3); g.textBaseline = "alphabetic"; }
          else { g.fillStyle = "rgba(44,93,107,.7)"; g.font = `700 14px ${KAI}`; g.textAlign = "center"; g.fillText("…", x, my); }
        } else { g.fillStyle = "#b5342a"; g.beginPath(); g.moveTo(x, y - TS * 2 - 18 + bob); g.lineTo(x - 5, y - TS * 2 - 26 + bob); g.lineTo(x + 5, y - TS * 2 - 26 + bob); g.closePath(); g.fill(); }
        continue;
      }
      if (e.npc) { const face = meE && Math.abs(meE.x - e.x) > 0.2 ? (meE.x > e.x ? 1 : -1) : 1; drawPlayer(g, x, y, null, t, { npc: e.npc.kind, face }); label(g, x, y - 54, e.npc.name, "#b5342a", 12, true); const bob = Math.sin(t / 300) * 2; g.fillStyle = "#b5342a"; g.beginPath(); g.moveTo(x, y - 62 + bob); g.lineTo(x - 5, y - 70 + bob); g.lineTo(x + 5, y - 70 + bob); g.closePath(); g.fill(); continue; }
      const md = meta[e.id]; if (!md) continue;
      const atk = e.atkT && t - e.atkT < 280 ? (t - e.atkT) / 280 : 0, hurt = e.hurtT && t - e.hurtT < 130;
      const alpha = e.gone ? Math.max(0, 1 - (t - e.gone) / 500) : 1; g.globalAlpha = alpha;
      if (md.k === "p") {
        const isMe = e.id === myId, mate = me && md.pt && party.some((q) => q.id === e.id);
        if (e.fl & 8) g.globalAlpha = isMe ? 0.45 : 0.18;      // 影遁：自己看得到半透明，別人幾乎看不到
        if (e.fl & 2) { g.strokeStyle = "rgba(168,131,42,.8)"; g.lineWidth = 2.5; g.beginPath(); g.ellipse(x, y - 18, 20, 26, 0, 0, 7); g.stroke(); }
        if (e.fl & 4) { g.strokeStyle = "rgba(64,96,90,.5)"; g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const yy = y - 8 - i * 10; g.beginPath(); g.moveTo(x - 18 - ((t / 4 + i * 20) % 20), yy); g.lineTo(x - 30 - ((t / 4 + i * 20) % 20), yy); g.stroke(); } }
        if (e.fl & 64) { g.strokeStyle = "rgba(90,150,200,.8)"; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y + 2, 24, 9, 0, 0, 7); g.stroke(); }
        if (isMe) { g.strokeStyle = "rgba(181,52,42,.6)"; g.lineWidth = 1.8; g.beginPath(); g.ellipse(x, y + 2, 22, 8, 0, 0, 7); g.stroke(); }
        let top = y - 54;
        const pk = md.ad && hasArt("p_" + md.ad) ? md.ad : md.c;      // 轉職後換外觀
        if (hasArt("p_" + pk)) {
          const dead = !!(e.fl & 1), walk = e.moving ? Math.sin(t / 85) : 0, kb = e.kbT && t - e.kbT < 160 ? (1 - (t - e.kbT) / 160) * 5 * e.kbD : 0;
          g.fillStyle = "rgba(22,20,15,.25)"; g.beginPath(); g.ellipse(x, y + 2, 19, 7, 0, 0, 7); g.fill();
          const A_ATK = `a_${pk}_atk`, A_WALK = `a_${pk}_walk`, A_IDLE = `a_${pk}_idle`, face = e.face || 1;
          const atkLen = hasAnim(A_ATK) ? animMs(A_ATK) : 0, inAtk = atkLen && e.atkT && t - e.atkT < atkLen;
          const A_CAST = `a_${pk}_cast`, castLen = hasAnim(A_CAST) ? animMs(A_CAST) : 0, inCast = castLen && e.castT && t - e.castT < castLen;      // 放技能：專屬的施法動作（比普攻大）
          let drawn = null;
          if (!dead && inCast) drawn = drawAnim(g, A_CAST, x + kb, y + 4, TS * 2.1, TS * 1.95, { face, t: t - e.castT, hurt, ref: "p_" + pk });
          else if (!dead && inAtk) drawn = drawAnim(g, A_ATK, x + kb, y + 4, TS * 2.1, TS * 1.95, { face, t: t - e.atkT, hurt, ref: "p_" + pk });
          else if (!dead && e.moving && hasAnim(A_WALK)) drawn = drawAnim(g, A_WALK, x + kb, y + 4 - Math.abs(walk) * 2, TS * 2.1, TS * 1.95, { face, t: t + e.id * 37, hurt, ref: "p_" + pk });
          else if (!dead && !e.moving && hasAnim(A_IDLE)) drawn = drawAnim(g, A_IDLE, x + kb, y + 4, TS * 2.1, TS * 1.95, { face, t: t + e.id * 37, hurt, ref: "p_" + pk });
          // 施法動作剛播完：最後一格慢慢淡掉疊在站姿上（AI 動畫的收尾姿勢常跟站姿不一樣，直接切會「跳」一下）
          if (drawn && !dead && !inCast && castLen && e.castT && t - e.castT < castLen + 170) drawAnim(g, A_CAST, x + kb, y + 4, TS * 2.1, TS * 1.95, { face, t: castLen - 1, ref: "p_" + pk, alpha: 1 - (t - e.castT - castLen) / 170 });
          if (!drawn) {
            const name = atk > 0 && atk < 0.9 && hasArt(`p_${pk}_atk`) ? `p_${pk}_atk` : "p_" + pk;
            drawArt(g, name, x + kb + (atk ? Math.sin(atk * Math.PI) * 6 * face : 0), y + 4 - Math.abs(walk) * 3, TS * 2.1, TS * 1.95,
              { face, rot: dead ? -1.45 * face : walk * 0.035, alpha: dead ? 0.5 : 1, hurt, sy: e.moving ? 1 : 1 + Math.sin(t / 650) * 0.01 });
          }
          top = y - TS * 1.95 - 4;
        } else drawPlayer(g, x, y, md.c, t, { moving: e.moving, dead: !!(e.fl & 1), face: e.face || 1, atk, hurt });
        if (e.fl & 32) { for (let i = 0; i < 3; i++) { const a = t / 250 + i * 2.1; g.fillStyle = "#d9a632"; g.beginPath(); g.arc(x + Math.cos(a) * 15, top - 26 + Math.sin(a) * 4, 3.2, 0, 7); g.fill(); } if (isMe) label(g, x, top - 36, "暈眩", "#b5342a", 14, true); }
        nameTag(g, x, top - 12, md.n, md.lv, isMe ? "#16140f" : mate ? "#3f7a52" : "#4d493f", isMe);
        hpBar(g, x, top - 6, 44, e.hp, "#c0392b");
        hpBar(g, x, top + 1, 44, e.mpp ?? 100, "#3a5fb0");
      } else {
        const s = md.boss ? 2.1 : md.el ? 1.45 : 1, A0 = MOB_ART[md.s], A = A0 && md.el ? [A0[0], A0[1] * 1.45, A0[2] * 1.45] : A0;
        if (md.boss) bossAura(g, x, y, t, s);
        if (md.el) eliteAura(g, x, y, t, A ? A[1] * TS : 40);
        let top = y - (md.boss ? 86 : md.el ? 60 : 42);
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
        else if (md.el) { label(g, x, top - 9, `${md.n}`, "#8a5a10", 16, true, KAI); }
        else nameTag(g, x, top - 7, md.n, md.lv, (e.fl & 8) ? "#7a2a22" : "#4d493f", false);
        hpBar(g, x, top, md.boss ? 90 : md.el ? 56 : 36, e.hp, md.el ? "#b07a1a" : "#c0392b");
        if (e.fl & 16) label(g, x, top - 22, "蓄力！", "#b5342a", 16, true);
      }
      if (e.say && t - e.sayT < 4500) bubble(g, x, y - (md.k === "p" ? 70 : 60), e.say);
      g.globalAlpha = 1;
    }
    while (yi < ysl.length) V.drawOne(g, ysl[yi++], t);
    // 上層特效
    fx = fx.filter((f) => t - f.t0 < f.life);
    for (const f of fx) drawFx(f, t);
    drawSparks(t, Math.min(3, (t - (frame.lt || t)) / 16.7)); frame.lt = t;
    drawFxLayer(t);                           // 特效：上層（粒子、刀光、投射物），帶墨暈
    floaters = floaters.filter((f) => t - f.t0 < f.life);
    for (const f of floaters) {
      const k = (t - f.t0) / f.life, pop = k < 0.15 ? 1 + 0.5 * (1 - k / 0.15) : 1, x = f.x * TS, y = f.y * TS - k * 36;
      g.globalAlpha = 1 - k * k;
      if (f.crit) { g.save(); g.translate(x - f.size * 0.95, y - f.size * 0.38); g.rotate(-0.12); g.fillStyle = "#b5342a"; g.beginPath(); g.roundRect(-9, -9, 18, 18, 2); g.fill(); g.fillStyle = "#f6efe0"; g.font = `700 13px ${KAI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("暴", 0, 1); g.textBaseline = "alphabetic"; g.restore(); }
      label(g, x, y, f.text, f.col, Math.round(f.size * pop), true, f.kai ? KAI : undefined);
      g.globalAlpha = 1;
    }
    atmosphere(t);
    if (flash > 0) { g.fillStyle = `rgba(${flashC},${flash * 0.5})`; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - 0.12); }
    // 小地圖
    if (miniBase) {
      const s = miniScale(), mw = map.w * s, mh = map.h * s;
      const mx = mw <= mini.width ? (mini.width - mw) / 2 : -Math.max(0, Math.min(mw - mini.width, (meE ? meE.x : map.w / 2) * s - mini.width / 2));
      const my = mh <= mini.height ? (mini.height - mh) / 2 : -Math.max(0, Math.min(mh - mini.height, (meE ? meE.y : map.h / 2) * s - mini.height / 2));
      mg.setTransform(1, 0, 0, 1, 0, 0); mg.fillStyle = "#e8e1cf"; mg.fillRect(0, 0, mini.width, mini.height);
      mg.setTransform(1, 0, 0, 1, Math.round(mx), Math.round(my)); mg.drawImage(miniBase, 0, 0);
      for (const e of ents.values()) { const md = meta[e.id]; if (!md) continue; mg.fillStyle = e.id === myId ? "#b5342a" : md.k === "p" ? "#3a4f86" : md.boss ? "#7a2a22" : md.el ? "#b07a1a" : "rgba(22,20,15,.45)"; const r = e.id === myId || md.boss ? 2.6 : md.el ? 2.1 : 1.4; mg.beginPath(); mg.arc(e.x * s, e.y * s, r, 0, 7); mg.fill(); }
      mg.strokeStyle = "rgba(22,20,15,.5)"; mg.strokeRect((ox - vw / 2) * s, (oy - vh / 2) * s, vw * s, vh * s);
      for (const n of map.npcs || []) if (n.kind === "exit") { mg.fillStyle = "#6a3c8c"; mg.beginPath(); mg.arc(n.x * s, n.y * s, 3, 0, 7); mg.fill(); }
      mg.setTransform(1, 0, 0, 1, 0, 0);
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
    else if (th === "sea") Object.assign(P, { y: anywhere ? Math.random() * H : H + 20, vx: (Math.random() - 0.5) * 0.3, vy: -0.5 - Math.random() * 0.8, sz: 2 + Math.random() * 4, a: 0.35 + Math.random() * 0.3, ph: Math.random() * 6 });
    else if (th === "kunlun") Object.assign(P, { x: anywhere ? Math.random() * W : -400, y: Math.random() * H, vx: 0.15 + Math.random() * 0.25, vy: 0, sz: 200 + Math.random() * 240, a: 0.2 + Math.random() * 0.12 });
    else if (th === "heaven") Object.assign(P, { y: anywhere ? Math.random() * H : H + 20, vx: (Math.random() - 0.5) * 0.3, vy: -0.25 - Math.random() * 0.4, sz: 1.4 + Math.random() * 2, a: 0.5 + Math.random() * 0.4, ph: Math.random() * 6 });
    else if (th === "fire" || th === "demon") Object.assign(P, { y: anywhere ? Math.random() * H : H + 20, vx: (Math.random() - 0.5) * 0.5, vy: -0.4 - Math.random() * 0.7, sz: 1.4 + Math.random() * 2.2, a: 0.5 + Math.random() * 0.45, ph: Math.random() * 6 });
    else Object.assign(P, { y: anywhere ? Math.random() * H : H + 20, vx: (Math.random() - 0.5) * 0.2, vy: -0.15 - Math.random() * 0.3, sz: 2 + Math.random() * 2.5, a: 0.5 + Math.random() * 0.4, ph: Math.random() * 6 });
    return P;
  }
  function atmosphere(t) {
    const dt = Math.min(3, lastT ? (t - lastT) / 16.7 : 1); lastT = t;
    const th = map.theme, want = th === "bamboo" ? 22 : th === "town" ? 14 : th === "mount" || th === "kunlun" ? 5 : th === "snow" ? 60 : th === "fire" ? 26 : th === "sea" ? 30 : th === "heaven" ? 24 : 16;
    while (parts.length < want) parts.push(newPart(th, !partsInit));
    partsInit = true;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of parts) {
      p.x += p.vx * dt + (th === "bamboo" ? Math.sin(t / 700 + p.r) * 0.3 : 0); p.y += p.vy * dt; p.r += p.vr * dt;
      if (th === "bamboo") { g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = `rgba(32,56,46,${p.a})`; g.beginPath(); g.moveTo(-p.sz / 2, 0); g.quadraticCurveTo(0, -p.sz * 0.22, p.sz / 2, 0); g.quadraticCurveTo(0, p.sz * 0.16, -p.sz / 2, 0); g.fill(); g.restore(); }
      else if (th === "town") { g.fillStyle = `rgba(190,80,70,${p.a})`; g.beginPath(); g.ellipse(p.x, p.y, p.sz, p.sz * 0.6, p.r, 0, 7); g.fill(); }
      else if (th === "snow") { g.fillStyle = `rgba(255,255,255,${p.a})`; g.beginPath(); g.arc(p.x + Math.sin(t / 600 + p.r * 3) * 6, p.y, p.sz, 0, 7); g.fill(); }
      else if (th === "fire" || th === "demon") { const fl = 0.6 + 0.4 * Math.sin(t / 120 + p.ph); g.fillStyle = th === "fire" ? `rgba(255,${120 + Math.floor(p.ph * 15)},40,${p.a * fl})` : `rgba(170,30,30,${p.a * fl})`; g.beginPath(); g.arc(p.x + Math.sin(t / 400 + p.ph) * 4, p.y, p.sz, 0, 7); g.fill(); }
      else if (th === "sea") { g.strokeStyle = `rgba(230,244,248,${p.a})`; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x + Math.sin(t / 500 + p.ph) * 5, p.y, p.sz, 0, 7); g.stroke(); }
      else if (th === "heaven") { const fl = 0.6 + 0.4 * Math.sin(t / 250 + p.ph); g.fillStyle = `rgba(230,190,90,${p.a * fl})`; g.beginPath(); g.arc(p.x + Math.sin(t / 600 + p.ph) * 4, p.y, p.sz, 0, 7); g.fill(); }
      else if (th === "mount" || th === "kunlun") { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.sz); gr.addColorStop(0, `rgba(248,244,232,${p.a})`); gr.addColorStop(1, "rgba(248,244,232,0)"); g.fillStyle = gr; g.fillRect(p.x - p.sz, p.y - p.sz * 0.4, p.sz * 2, p.sz * 0.8); }
      else { const fl = 0.6 + 0.4 * Math.sin(t / 200 + p.ph); const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.sz * 4); gr.addColorStop(0, `rgba(170,240,220,${p.a * fl})`); gr.addColorStop(1, "rgba(120,200,180,0)"); g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.sz * 4, 0, 7); g.fill(); }
    }
    parts = parts.filter((p) => p.x > -500 && p.x < W + 500 && p.y > -40 && p.y < H + 40);
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(40,30,15,0)"); vg.addColorStop(1, th === "tomb" || th === "tower" ? "rgba(20,16,10,.5)" : th === "snow" ? "rgba(90,110,130,.22)" : th === "fire" ? "rgba(120,30,10,.32)" : th === "demon" ? "rgba(60,10,10,.45)" : th === "sea" ? "rgba(20,60,80,.32)" : th === "hell" ? "rgba(40,10,40,.5)" : th === "heaven" ? "rgba(160,130,60,.16)" : th === "kunlun" ? "rgba(60,90,80,.2)" : "rgba(60,44,20,.24)");
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
  // 上層特效先畫到另一張畫布，再疊一層縮小放大的柔邊（像墨滲進紙裡暈開），最後才貼回主畫面
  let fxCv = null, fxG = null, fxSm = null;
  function drawFxLayer(t) {
    const st = V.stats(); if (!st.p && !st.a && !st.t) return;
    if (!fxCv || fxCv.width !== cv.width || fxCv.height !== cv.height) {
      fxCv = document.createElement("canvas"); fxCv.width = cv.width; fxCv.height = cv.height; fxG = fxCv.getContext("2d");
      fxSm = document.createElement("canvas"); fxSm.width = Math.max(1, cv.width >> 2); fxSm.height = Math.max(1, cv.height >> 2);
    }
    fxG.setTransform(1, 0, 0, 1, 0, 0); fxG.clearRect(0, 0, fxCv.width, fxCv.height);
    fxG.setTransform(g.getTransform()); fxG.imageSmoothingEnabled = true;
    V.draw(fxG, t, "t");
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    if (vfxOpt().q !== "l") { const sg = fxSm.getContext("2d"); sg.clearRect(0, 0, fxSm.width, fxSm.height); sg.drawImage(fxCv, 0, 0, fxSm.width, fxSm.height); g.globalAlpha = 0.45; g.drawImage(fxSm, 0, 0, cv.width, cv.height); }
    g.globalAlpha = 1; g.drawImage(fxCv, 0, 0); g.restore();
  }
  // 毛筆邊：把一條路徑切成小段，每段粗細、濃淡都不一樣，像毛筆畫的
  const nz = (i) => { const v = Math.sin(i * 12.9898) * 43758.5453; return v - Math.floor(v); };
  function brushPath(pts, closed, col, seed, wid = 2.2) {
    const P = closed ? [...pts, pts[0]] : pts;
    g.lineCap = "round";
    for (let i = 1; i < P.length; i++) { const n = nz(seed + i); g.strokeStyle = `rgba(${col},${0.45 + 0.45 * n})`; g.lineWidth = wid * (0.6 + 0.9 * nz(seed + i * 3.1)); g.beginPath(); g.moveTo(P[i - 1][0], P[i - 1][1]); g.lineTo(P[i][0], P[i][1]); g.stroke(); }
  }
  const circlePts = (x, y, r, a0 = 0, a1 = Math.PI * 2) => { const n = Math.max(14, Math.round(Math.abs(a1 - a0) * r / 9)), o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } return o; };
  // 圓形預警：中間淡、邊緣濃的淡彩，再用毛筆勾一圈；k＝蓄力進度
  function inkWarn(x, y, r, col, k, seed) {
    const gr = g.createRadialGradient(x, y, r * 0.15, x, y, r); gr.addColorStop(0, `rgba(${col},${0.03 + 0.06 * k})`); gr.addColorStop(0.7, `rgba(${col},${0.08 + 0.14 * k})`); gr.addColorStop(1, `rgba(${col},${0.2 + 0.22 * k})`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    if (k > 0.02) { g.fillStyle = `rgba(${col},${0.08 + 0.12 * k})`; g.beginPath(); g.arc(x, y, r * k, 0, 7); g.fill(); }
    brushPath(circlePts(x, y, r), true, col, seed, 2.6);
  }
  // 王的預警：直線（撲擊、衝鋒、狐火）、扇形（吐息、葉風）、環形（踏火、吸星）
  const TCOL = { g: "70,140,60", b: "70,120,190", p: "130,60,140" };
  function tele(f, t) {
    const k = Math.min(1, (t - f.t0) / f.life), col = TCOL[f.c] || "181,52,42", x = f.x * TS, y = f.y * TS, seed = Math.round(f.x * 7 + f.y * 13 + (f.a || f.dx || 0) * 5);
    g.save();
    if (f.k === "wline") {
      const L = f.len * TS, Wd = f.w * TS; g.translate(x, y); g.rotate(Math.atan2(f.dy, f.dx));
      const gr = g.createLinearGradient(0, -Wd / 2, 0, Wd / 2); gr.addColorStop(0, `rgba(${col},${0.22 + 0.2 * k})`); gr.addColorStop(0.5, `rgba(${col},${0.05 + 0.08 * k})`); gr.addColorStop(1, `rgba(${col},${0.22 + 0.2 * k})`);
      g.fillStyle = gr; g.fillRect(0, -Wd / 2, L, Wd); g.fillStyle = `rgba(${col},${0.08 + 0.12 * k})`; g.fillRect(0, -Wd / 2, L * k, Wd);
      const n = Math.max(4, Math.round(L / 14)), top = [], bot = []; for (let i = 0; i <= n; i++) { top.push([L * i / n, -Wd / 2]); bot.push([L * i / n, Wd / 2]); }
      brushPath(top, false, col, seed, 2.4); brushPath(bot, false, col, seed + 50, 2.4);
    } else if (f.k === "wcone") {
      const Rr = f.r * TS, a0 = f.a - f.arc / 2, a1 = f.a + f.arc / 2;
      const gr = g.createRadialGradient(x, y, 0, x, y, Rr); gr.addColorStop(0, `rgba(${col},0.04)`); gr.addColorStop(1, `rgba(${col},${0.2 + 0.22 * k})`);
      g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.arc(x, y, Rr, a0, a1); g.closePath(); g.fill();
      g.fillStyle = `rgba(${col},${0.08 + 0.12 * k})`; g.beginPath(); g.moveTo(x, y); g.arc(x, y, Rr * k, a0, a1); g.closePath(); g.fill();
      brushPath([[x, y], ...circlePts(x, y, Rr, a0, a1), [x, y]], false, col, seed, 2.4);
    } else {
      const r0 = f.r0 * TS, r1 = f.r1 * TS;
      g.fillStyle = `rgba(${col},${0.1 + 0.22 * k})`; g.beginPath(); g.arc(x, y, r1, 0, 7); if (r0 > 0) { g.moveTo(x + r0, y); g.arc(x, y, r0, 0, 7); } g.fill("evenodd");
      brushPath(circlePts(x, y, r1), true, col, seed, 2.6); if (r0 > 0) brushPath(circlePts(x, y, r0), true, col, seed + 30, 2);
    }
    g.restore();
  }
  // 副本地面效果：岩漿、毒氣、冰封區、安全圈、箭陣與滾石的警示
  function groundFx(t) {
    if (lava) {
      const lx = (lava.x + lava.v * (t - lava.t0) / 1000) * TS;
      if (lx > 0) {
        const gr = g.createLinearGradient(lx - TS * 6, 0, lx, 0); gr.addColorStop(0, "rgba(150,30,10,.85)"); gr.addColorStop(0.75, "rgba(220,80,20,.8)"); gr.addColorStop(1, "rgba(255,170,60,.65)");
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
        for (let y = 0; y <= map.h * TS; y += 12) g.lineTo(lx + Math.sin(y / 30 + t / 300) * 10 + Math.sin(y / 11 + t / 170) * 4, y);
        g.lineTo(0, map.h * TS); g.closePath(); g.fill();
        g.fillStyle = "rgba(255,200,80,.35)"; for (let i = 0; i < 14; i++) { const bx = (lx - ((t / 7 + i * 97) % (TS * 6))), by = ((i * 173 + t / 20) % (map.h * TS)); g.beginPath(); g.arc(bx, by, 3 + (i % 3), 0, 7); g.fill(); }
      }
    }
    for (const f of fx) {
      const k = Math.min(1, (t - f.t0) / f.life);
      if (f.k === "pzone" || f.k === "izone") {
        const x = f.x * TS, y = f.y * TS, r = f.r * TS, a = Math.min(1, (t - f.t0) / 250) * (1 - Math.max(0, (k - 0.85) / 0.15));
        const gr = g.createRadialGradient(x, y, r * 0.1, x, y, r); const c = f.k === "pzone" ? "80,150,60" : "150,200,235";
        gr.addColorStop(0, `rgba(${c},${0.55 * a})`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        g.fillStyle = `rgba(${c},${0.35 * a})`; for (let i = 0; i < 6; i++) { const aa = i + t / 900, rr = r * (0.3 + 0.5 * ((i * 37 % 10) / 10)); g.beginPath(); g.arc(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr - (f.k === "pzone" ? ((t / 20 + i * 30) % 30) : 0), 6, 0, 7); g.fill(); }
      } else if (f.k === "safe") {
        for (const [px, py] of f.pts) { const x = px * TS, y = py * TS, r = f.r * TS; g.fillStyle = `rgba(230,190,70,${0.25 + 0.15 * Math.sin(t / 120)})`; g.strokeStyle = "rgba(230,190,70,.95)"; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); label(g, x, y - r - 6, "安全", "#a8832a", 14, true); }
        g.fillStyle = `rgba(90,20,60,${0.18 * k})`; g.fillRect(0, 0, map.w * TS, map.h * TS);
      } else if (f.k === "wcol") {
        const x0 = (f.x - f.w / 2) * TS, w = f.w * TS; g.fillStyle = `rgba(181,52,42,${0.12 + 0.2 * k})`; g.fillRect(x0, 0, w, map.h * TS);
        g.strokeStyle = "rgba(181,52,42,.7)"; g.lineWidth = 2; g.setLineDash([8, 6]); g.strokeRect(x0, 0, w, map.h * TS); g.setLineDash([]);
      } else if (f.k === "wrow") {
        const xa = Math.min(f.x0, f.x1) * TS, xb = Math.max(f.x0, f.x1) * TS, y = f.y * TS; g.fillStyle = `rgba(181,52,42,${0.12 + 0.2 * k})`; g.fillRect(xa, y - TS * 0.55, xb - xa, TS * 1.1);
        g.fillStyle = "rgba(181,52,42,.8)"; const d = Math.sign(f.x1 - f.x0); for (let i = 0; i < 3; i++) { const ax = (f.x0 + d * (1 + i * 2)) * TS; g.beginPath(); g.moveTo(ax + d * 10, y); g.lineTo(ax - d * 4, y - 8); g.lineTo(ax - d * 4, y + 8); g.closePath(); g.fill(); }
      }
    }
  }
  function drawFx(f, t) {
    const k = (t - f.t0) / f.life, P = (p) => [p.x * TS, p.y * TS - (USE_PROPS ? 40 : 18)];
    g.lineCap = "round";
    switch (f.k) {
      case "arrows": { g.strokeStyle = "#16140f"; g.lineWidth = 2; for (let i = 0; i < 18; i++) { const x = (f.x - f.w / 2 + ((i * 0.37) % 1) * f.w) * TS, y = ((i * 211) % (map.h * TS)) * (0.2 + 0.8 * k) + k * 60; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 22); g.stroke(); } return; }
      case "boulder": { const kk = Math.min(1, (t - f.t0) / f.dur), x = (f.x0 + (f.x1 - f.x0) * kk) * TS, y = f.y * TS; g.fillStyle = "rgba(22,20,15,.25)"; g.beginPath(); g.ellipse(x, y + 4, 24, 8, 0, 0, 7); g.fill(); if (!drawArt(g, "d_boulder", x, y + 6, TS * 1.4, TS * 1.4, { rot: (f.x1 > f.x0 ? 1 : -1) * kk * 9 })) { g.fillStyle = "#6d675b"; g.beginPath(); g.arc(x, y - 18, 22, 0, 7); g.fill(); } if (kk < 1) shake = Math.max(shake, 2); return; }
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
    $(".mo-name").textContent = me.name; $(".mo-lv").textContent = `${me.lv} 級・${ADVN[me.adv2] || ADVN[me.adv] || CLS[me.cls] || ""}`;
    const face = $(".mo-face");
    const fk = me.adv && hasArt("p_" + me.adv) ? me.adv : me.cls;
    if (hasArt("p_" + fk)) { face.classList.add("pic"); face.style.backgroundImage = `url(${artUrl("p_" + fk)})`; face.querySelector("span").textContent = ""; }
    else face.querySelector("span").textContent = CLS_GLYPH[me.cls] || "俠";
    const bar = (sel, v, max, txt) => { const el = $(sel); el.querySelector("i").style.width = Math.max(0, Math.min(100, v / max * 100)) + "%"; const s = el.querySelector("span"); if (s) s.textContent = txt; };
    bar(".mo-bar.hp", me.hp, me.st.hp, `${me.hp} / ${me.st.hp}`);
    bar(".mo-bar.mp", me.mp, me.st.mp, `${me.mp} / ${me.st.mp}`);
    bar(".mo-bar.xp", me.exp, me.need || 1);
    $(".mo-bar.xp").title = `經驗 ${me.exp} / ${me.need}`;
    { const xs = $(".mo-bar.xp span"); if (xs) xs.textContent = me.lv >= 100 ? "滿級" : `經驗 ${Math.floor((me.exp / (me.need || 1)) * 1000) / 10}%`; }
    $(".mo-gold").textContent = `${money(me.gold)} 兩`;
    $(".mo-dead").hidden = !me.dead;
    { const SB = { guard: "金鐘罩", gale: "疾風", rage: "怒吼", shield: "護體", eagle: "鷹眼", mingwang: "明王", bati: "霸體", berserk: "修羅", barrier: "結界", hawk: "神眼", stealth: "影遁" }, chips = [];
      for (const b of me.buffs || []) chips.push(`<span class="mo-buff ${b.k}" title="${esc(b.d)}">${esc(b.n)}<small>${Math.ceil(b.left / 60)} 分</small></span>`);
      for (const [k, v] of Object.entries(me.buff || {})) if (v > 0 && SB[k]) chips.push(`<span class="mo-buff sk">${SB[k]}<small>${Math.ceil(v / 1000)} 秒</small></span>`);
      const el = $(".mo-buffs"), html = chips.join(""); if (el.innerHTML !== html) el.innerHTML = html; }
    if (me.skills || me.inv) skillBar();
    else updatePots();
  }
  const potCount = (kind) => (me && me.inv ? me.inv.filter((x) => x.p && (kind === "tp" ? x.p === "tp" : x.p.startsWith(kind))).reduce((s, x) => s + x.q, 0) : 0);
  // 技能欄照鍵盤上的位置排：Q W E R，接著 D、F（D 在 F 左邊）；按鍵綁定不變（F＝一轉那格、D＝二轉那格）
  const keyOrder = (n) => { const o = Array.from({ length: n }, (_, i) => i); if (n >= 6) { o[4] = 5; o[5] = 4; } return o; };
  const slotSkills = () => (me && me.slots ? me.slots : []).map((id) => (me.skills || []).find((x) => x.id === id) || null);
  function skillBar() {
    const el = $(".mo-skills"), sl = slotSkills();
    el.innerHTML = keyOrder((me.slots || [0, 0, 0]).length).map((i) => {
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
    // 冷卻：整顆變暗＋順時針掃回來，中間大字剩幾秒（不到 1 秒顯示小數）；轉好的瞬間閃一圈；魔不夠時變藍灰
    for (const s of me.skills) {
      const btn = root.querySelector(`.mo-sk[data-sk="${s.id}"]`); if (!btn) continue; const b = btn.querySelector(".cd");
      const left = (cdEnd[s.id] || 0) - t, on = left > 0;
      b.style.setProperty("--p", on ? Math.min(1, left / (s.cd * 1000)) : 0);
      const txt = on ? (left < 1000 ? (left / 1000).toFixed(1) : String(Math.ceil(left / 1000))) : "";
      if (b.textContent !== txt) b.textContent = txt;
      if (btn.classList.contains("oncd") && !on) { btn.classList.remove("ready"); void btn.offsetWidth; btn.classList.add("ready"); }
      btn.classList.toggle("oncd", on);
      btn.classList.toggle("nomp", me.mp < s.mp);
    }
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
  function render() { if (openP === "bag") renderBag(); else if (openP === "npc") renderNpc(); else if (openP === "trade") renderTrade(); else if (openP === "help") renderHelp(); else if (openP === "set") renderSet(); else if (openP === "skills") renderSkills(); }
  const statLine = (st) => Object.entries(st || {}).map(([k, v]) => k.startsWith("cd_") ? `<b class="mo-skcd">「${esc(SKNAME[k.slice(3)] || k.slice(3))}」冷卻 −${v}%</b>` : SPST.includes(k) ? `<b class="mo-sp">${STAT[k]} +${v}</b>` : `${STAT[k]} +${v}`).join("　");
  const eqLine = (it) => statLine(it.st) + (it.eb ? `　<span class="mo-enhst">強化 ${statLine(it.eb)}</span>` : "");
  const itemName = (it) => it.p ? POT[it.p] || it.p : it.n;
  const icon = (it) => { const n = itemArt(it); return hasArt(n) ? `<img class="mo-ii" src="${artUrl(n)}" alt="">` : ""; };
  const itemCell = (it, extra = "") => it ? (it.p ? `<button class="mo-it pot" data-u="${it.p}" ${extra}>${icon(it)}<span><b>${esc(POT[it.p] || it.p)}</b><small>×${it.q}</small></span></button>`
    : `<button class="mo-it" data-u="${it.u}" style="--r:${RAR_COLOR[it.r]}${setOf(it) ? `;--sc:${setOf(it).col}` : ""}" ${extra}>${icon(it)}<span><b${it.set ? ' class="mo-setn"' : ""}>${it.lock ? "🔒" : ""}${it.e ? `<em class="mo-enh">+${it.e}</em>` : ""}${esc(it.n)}</b><small>${setTag(it)}${RAR[it.r]}・${it.t}級${it.c && me && it.c !== me.cls ? "・" + CLS[it.c] : ""}</small></span></button>`) : "";
  // 圖示方塊：品質＝邊框顏色、左上強化、右下數量、左下金角＝套裝；名字放在提示（點開看詳細）
  // 套裝：每個地區一個印章字＋顏色（SETS 的 ch／col／area），格子左下角蓋印、底部帶一點那個顏色
  const SET_ORDER = ["bamboo", "tiger", "corpse", "frost", "flame", "demon", "tower", "sea", "kunlun", "hell", "heaven"];
  const setOf = (it) => (it && it.set && SETS[it.set]) || null;
  const setTag = (it) => { const S = setOf(it); return S ? `${S.area}「${S.name}」套裝・` : it.set ? "套裝・" : ""; };
  const tileName = (it) => it.p ? `${POT[it.p] || it.p} ×${it.q}` : `${it.e ? `+${it.e} ` : ""}${it.n}（${setTag(it)}${RAR[it.r]}・${SLOT[it.s]}・${it.t} 級）`;
  const tile = (it, extra = "", on = false) => {
    if (!it) return "";
    const n = itemArt(it), img = hasArt(n) ? `<img src="${artUrl(n)}" alt="">` : `<b class="g">${esc((it.p ? POT[it.p] || it.p : it.n).slice(0, 1))}</b>`;
    const S = setOf(it);
    return `<button class="mo-tile${it.p ? " pot" : ` r${it.r}`}${S ? " set" : ""}${on ? " on" : ""}" data-u="${it.u || it.p}" title="${esc(tileName(it))}" aria-label="${esc(tileName(it))}" style="--r:${it.p ? "rgba(22,20,15,.28)" : RAR_COLOR[it.r]}${S ? `;--sc:${S.col}` : ""}" ${extra}>${img}${it.e ? `<em class="e">+${it.e}</em>` : ""}${it.lock ? `<i class="lk">🔒</i>` : ""}${it.p ? `<i class="q">${it.q}</i>` : ""}${it.set ? `<i class="st">${S ? S.ch : "套"}</i>` : ""}${!it.p && it.c && me && it.c !== me.cls ? `<i class="x">✕</i>` : ""}</button>`;
  };
  let bagSel = null;          // 行囊裡目前點開的那一件（重畫時保留）
  // 行囊分頁：全部／裝備／藥品／材料
  let bagTab = "all";
  let bagSlot = "all";        // 「裝備」分頁裡的部位篩選
  const BAG_TABS = [["all", "全部"], ["eq", "裝備"], ["set", "套裝"], ["pot", "藥品"], ["mat", "材料"]];
  const inTab = (it, tab) => tab === "all" || (tab === "eq" ? !it.p : tab === "set" ? !it.p && !!it.set : tab === "mat" ? !!(it.p && MAT[it.p]) : !!(it.p && !MAT[it.p]));
  // 行囊格子：「裝備」依部位分組、「套裝」依地區分組（組標題跨整排）
  function bagGrid() {
    const L = me.inv.filter((it) => inTab(it, bagTab)), T = (it) => tile(it, "", bagSel === (it.u || it.p));
    if (bagTab === "eq") {
      const slots = bagSlot === "all" ? Object.keys(SLOT) : [bagSlot];
      const out = slots.map((k) => { const g = L.filter((x) => x.s === k); return g.length ? `${bagSlot === "all" ? `<h5 class="mo-igrp">${SLOT[k]}<small>${g.length}</small></h5>` : ""}${g.map(T).join("")}` : ""; }).join("");
      return out || `<p class="mo-dim mo-iempty">${bagSlot === "all" ? "行囊裡沒有裝備。" : `行囊裡沒有${SLOT[bagSlot]}。`}</p>`;
    }
    if (bagTab === "set") {
      const worn = (k) => Object.values(me.eq).filter((x) => x && x.set === k).length;
      const keys = [...SET_ORDER, ...Object.keys(SETS).filter((k) => !SET_ORDER.includes(k))].filter((k) => L.some((x) => x.set === k) || worn(k));
      const out = keys.map((k) => { const S = SETS[k], g = L.filter((x) => x.set === k);
        return `<div class="mo-setgrp" style="--sc:${S.col}"><i class="mo-seal">${S.ch}</i><b>「${esc(S.name)}」</b><small>${esc(S.area)}・已穿 ${worn(k)} 件・行囊 ${g.length} 件</small></div>${g.map(T).join("")}`; }).join("");
      return out || `<p class="mo-dim mo-iempty">還沒有套裝。副本、鎖妖塔和野外大王會掉，每個地區一套。</p>`;
    }
    return L.map(T).join("") + (bagTab === "all" ? Array.from({ length: Math.max(0, (me.bag || 30) - me.inv.length) }, () => `<span class="mo-tile nil"></span>`).join("") : "");
  }
  // 數值有上限（暴擊 60%、吸血 15%…）：到頂的標「上限」，滑上去看裝備實際加了多少
  // 暴擊是最後的總上限；其他特效詞條是「裝備＋套裝」的上限，職業本身的加成另外算（所以總數可能比上限高）
  const capSt = (st, k, name, cls) => { const o = st.over && st.over[k]; return `<span class="${cls}${o ? " mo-capped" : ""}"${o ? ` title="${k === "crit" ? "全部" : "裝備、套裝"}加起來 ${o[0]}%，上限 ${o[1]}%，超過的部分沒有效果"` : ""}>${name} <b>${st[k]}%</b>${o ? `<em>${k === "crit" ? "" : "裝備"}已滿：加到 ${o[0]}%・上限 ${o[1]}%</em>` : ""}</span>`; };
  function renderBag(detailU) {
    if (!me || !me.inv) return;
    if (detailU !== undefined) bagSel = detailU;
    const st = me.st, det = bagSel && (me.inv.find((x) => (x.u || x.p) === bagSel) || Object.values(me.eq).find((x) => x && x.u === bagSel));
    if (bagSel && !det) bagSel = null;      // 那件已經不在了（賣掉、交易出去）
    panel.innerHTML = `<div class="mo-sheet mo-bag"><header><h3>行囊</h3><button class="mo-x" data-act="close">✕</button></header>
      <div class="mo-stats"><span>攻擊 <b>${st.atk}</b></span><span>防禦 <b>${st.def}</b></span><span>生命 <b>${st.hp}</b></span><span>法力 <b>${st.mp}</b></span>${capSt(st, "crit", "暴擊", "")}<span>攻速 <b>${st.aspd}s</b></span>${SPST.filter((k) => st[k]).map((k) => capSt(st, k, STAT[k].replace("%", ""), "mo-sp")).join("")}${Object.entries(st.skcd || {}).map(([k, v]) => `<span class="mo-skcd${v > 50 ? " mo-capped" : ""}" title="只對這一招有效，同一招最多 −50%">「${esc(SKNAME[k.slice(3)] || k.slice(3))}」冷卻 <b>−${Math.min(50, v)}%</b>${v > 50 ? `<em>已滿：加到 ${v}%・上限 50%</em>` : ""}</span>`).join("")}<span>銀兩 <b class="mo-goldv">${money(me.gold)}</b></span></div>
      <div class="mo-eq dolls">${Object.entries(SLOT).map(([k, n]) => { const it = me.eq[k]; return `<div class="mo-eqs"><em>${n}</em>${it ? tile(it, 'data-eq="' + k + '"', bagSel === it.u) : `<span class="mo-tile nil"></span>`}<small style="color:${it ? RAR_COLOR[it.r] : "var(--ink3)"}">${it ? esc(it.n.replace(/^.+?・/, "")) : "—"}</small></div>`; }).join("")}</div>
      ${sellMode ? `<p class="mo-dim">賣東西：點一樣東西就賣掉（回收價是價值的 25%）。<button class="mo-link" data-act="nosell">不賣了</button></p>` : ""}
      <div class="mo-bagbar"><span class="mo-tabs">${BAG_TABS.map(([k, n]) => `<button data-btab="${k}" class="${bagTab === k ? "on" : ""}">${n}<small>${k === "all" ? "" : me.inv.filter((x) => inTab(x, k)).length}</small></button>`).join("")}</span>
        <span class="mo-bagops"><b class="mo-bagn${me.inv.length >= (me.bag || 30) ? " full" : ""}">${me.inv.length}/${me.bag || 30}</b><button data-act="sortinv" title="依部位、品質、等級排好，同種的藥和材料疊在一起">整理</button>${me.bagCost ? `<button data-act="bagup" title="行囊 +10 格">擴充 <small>${money(me.bagCost)} 兩</small></button>` : ""}</span></div>
      ${bagTab === "eq" ? `<div class="mo-chips">${[["all", "全部"], ...Object.entries(SLOT)].map(([k, n]) => { const c = me.inv.filter((x) => !x.p && (k === "all" || x.s === k)).length; return `<button data-bslot="${k}" class="${bagSlot === k ? "on" : ""}"${c || k === "all" ? "" : " disabled"}>${n}${c ? `<small>${c}</small>` : ""}</button>`; }).join("")}</div>` : ""}
      <div class="mo-inv tiles">${bagGrid()}</div>
      ${sellAllRow()}
      ${det ? detail(det) : `<p class="mo-dim">點一件東西看詳細。武器、衣服、飾品點了可以換上。</p>`}</div>`;
  }
  // 一鍵賣裝：顯示每一檔會賣幾件、拿多少錢（鎖住的、強化過的、傳說不算）
  function sellAllRow() {
    const can = (r) => me.inv.filter((x) => !x.p && x.r <= r && !x.lock && !(x.e > 0) && !x.set);
    const btn = (r, label) => { const l = can(r); return `<button data-sellall="${r}"${l.length ? "" : " disabled"}>${label}<small>${l.length} 件・${money(l.reduce((s, x) => s + Math.max(1, Math.floor(x.v * 0.25)), 0))} 兩</small></button>`; };
    return `<div class="mo-sellall"><span>一鍵賣裝</span>${btn(0, "普通")}${btn(1, "精良以下")}${btn(2, "稀有以下")}</div>`;
  }
  function setInfo(it) {      // 套裝：穿了幾件、2／3 件的加成（有效的亮起來）
    const S = it.set && SETS[it.set]; if (!S) return "";
    const n = Object.values(me.eq).filter((x) => x && x.set === it.set).length;
    return `<p class="mo-setbox" style="--sc:${S.col}"><i class="mo-seal">${S.ch}</i><b class="mo-setn">${esc(S.area)}「${esc(S.name)}」套裝 已穿 ${n} 件</b>（${esc(S.from)}）<br><small class="${n >= 2 ? "on" : ""}">2 件：${esc(S.d2)}</small>　<small class="${n >= 3 ? "on" : ""}">3 件：${esc(S.d3)}</small>${S.d5 ? `<br><small class="${n >= 5 ? "on" : ""}">5 件：${esc(S.d5)}</small>` : ""}</p>`;
  }
  function detail(it) {
    const worn = !it.p && me.eq[it.s] && me.eq[it.s].u === it.u;
    const cmp = !it.p && !worn && me.eq[it.s] ? `<p class="mo-dim">現在穿的：${esc(me.eq[it.s].n)}（${statLine(me.eq[it.s].st)}）</p>` : "";
    return `<div class="mo-det"><h4 style="color:${it.p ? "#16140f" : RAR_COLOR[it.r]}">${it.e ? `+${it.e} ` : ""}${esc(itemName(it))}${it.p ? ` ×${it.q}` : `<small>${setTag(it)}${RAR[it.r]}・${SLOT[it.s]}・需要 ${it.t} 級</small>`}</h4>
      ${it.p ? (MAT[it.p] ? `<p class="mo-dim">鍛造材料：拿去長安城鐵匠那裡強化、洗詞條、重鑄。</p>` : "") : `<p>${eqLine(it)}</p>${setInfo(it)}${cmp}`}
      <div class="mo-row">${worn ? `<button data-unequip="${it.s}">卸下</button>` : `${MAT[it.p] ? "" : `<button class="mo-pri" data-use="${it.u || it.p}">${it.p ? "使用" : "換上"}</button>`}`}
      ${it.p ? "" : `<button data-lock="${it.u}">${it.lock ? "解鎖" : "🔒 鎖定"}</button>`}
      ${!worn && !it.lock ? `<button data-sell="${it.u || it.p}">賣掉${it.p ? "" : `（${money(Math.max(1, Math.floor(it.v * 0.25)))} 兩）`}</button>` : ""}
      ${trade && !worn ? `<button data-tadd="${it.u || it.p}">放進交易</button>` : ""}</div></div>`;
  }
  // ------------------------------------------------------------ 鐵匠：鍛造
  let npcTab = "buy", forgeSel = null, forgeFx = null, smithSlot = "all", forgeSlot = "all";
  // 部位分類鈕（買裝備、鍛造共用）
  const slotChips = (cur, attr, extra = []) => `<div class="mo-chips">${[["all", "全部"], ...extra, ...Object.entries(SLOT)].map(([k, n]) => `<button data-${attr}="${k}" class="${cur === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  function smithBuy(n) {
    const row = (it) => { const ic = itemArt({ s: it.s, c: me.cls }); return `<div class="mo-si${me && it.lv > me.lv ? " lock" : ""}"><span class="mo-sin">${hasArt(ic) ? `<img class="mo-ii" src="${artUrl(ic)}" alt="">` : ""}<span><b>${esc(it.n)}</b><small>${it.t} 級・${statLine(it.st)}</small></span></span><button data-buy="${it.k}">${money(it.price)} 兩</button></div>`; };
    const slots = smithSlot === "all" ? Object.keys(SLOT) : [smithSlot];
    const body = slots.map((k) => { const L = n.shop.filter((x) => x.s === k).sort((a, b) => a.t - b.t); return L.length ? `${smithSlot === "all" ? `<h5 class="mo-grp">${SLOT[k]}</h5>` : ""}${L.map(row).join("")}` : ""; }).join("");
    return slotChips(smithSlot, "sslot") + `<div class="mo-shop">${body || `<p class="mo-dim">沒有這個部位的裝備</p>`}</div><div class="mo-row"><button data-act="sell">賣東西</button></div>`;
  }
  const mats = (k) => me.inv.filter((x) => x.p === k).reduce((s, x) => s + x.q, 0);
  function matsView(n) {
    return `<div class="mo-shop">${(n.mats || []).map((s) => `<div class="mo-si"><span>${hasArt("i_" + s.k) ? `<img class="mo-ii" src="${artUrl("i_" + s.k)}" alt="">` : ""}<b>${esc(s.n)}</b><small>${esc(s.d)}・身上 ${mats(s.k)} 個</small></span><span class="mo-qty"><button data-buy="${s.k}" data-n="1">${money(s.price)} 兩</button><button data-buy="${s.k}" data-n="10">×10</button></span></div>`).join("")}</div>
      <p class="mo-dim">玄鐵怪物常掉，靈玉偶爾掉，打王一定有玄鐵、有機會拿到靈玉和重鑄石。</p>`;
  }
  function forgeView() {
    const all0 = [...Object.values(me.eq).filter(Boolean), ...me.inv.filter((x) => !x.p)];
    const it = all0.find((x) => x.u === forgeSel) || null;
    const worn = (x) => Object.values(me.eq).some((y) => y && y.u === x.u);
    const all = all0.filter((x) => forgeSlot === "all" || (forgeSlot === "worn" ? worn(x) : x.s === forgeSlot));
    const list = slotChips(forgeSlot, "fslot", [["worn", "穿著的"]]) + `<div class="mo-flist">${all.length ? "" : `<p class="mo-dim">沒有這個部位的裝備</p>`}${all.map((x) => `<button class="mo-fit${x.u === forgeSel ? " on" : ""}" data-fsel="${x.u}" style="--r:${RAR_COLOR[x.r]}">${icon(x)}<span>${x.e ? `<em class="mo-enh">+${x.e}</em>` : ""}${esc(x.n)}${worn(x) ? "<i>穿著</i>" : ""}</span></button>`).join("") || `<p class="mo-dim">身上沒有裝備</p>`}</div>`;
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
  const modLine = (M) => Object.entries(M).map(([k, v]) => SPST.includes(k) ? `${STAT[k].replace("%", "")} +${v}%` : k === "crit" ? `暴擊 +${v}%` : k === "range" ? `射程 +${v}` : k === "aspd" ? `攻速 +${Math.round((1 / v - 1) * 100)}%` : `${MODN[k]} ${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`).join("・");
  function advView(n) {
    if (!n.adv) return "";
    if (n.myAdv && n.adv2) {          // 一轉過了：看二轉
      if (n.myAdv2) { const a = n.adv2.find((x) => x.k === n.myAdv2); return a ? `<p class="mo-dim">你已經是<b>${esc(a.n)}</b>了，江湖路已經走到頂。</p>` : ""; }
      const can2 = me && me.lv >= n.adv2Lv;
      return `<h4 class="mo-advh">二轉・${n.adv2Lv} 級</h4><div class="mo-advs">${n.adv2.map((a) => `<div class="mo-adv">${hasArt("p_" + a.k) ? `<img src="${artUrl("p_" + a.k)}" alt="">` : ""}<div><h4>${esc(a.n)}</h4><p>${esc(a.d)}</p><small>${modLine(a.mod)}</small>
        <ul>${a.skills.map((s) => `<li><b>${esc(s.name)}</b>（${s.lv} 級）${esc(s.desc)}</li>`).join("")}</ul>
        <button class="mo-pri" data-advance2="${a.k}"${can2 ? "" : " disabled"}>${can2 ? `二轉成${esc(a.n)}` : `${n.adv2Lv} 級才能二轉`}</button></div></div>`).join("")}</div>
      <p class="mo-dim">二轉後技能欄再多一格（D），選了就不能換。</p>`;
    }
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
    return `<div class="mo-store"><div><h4 class="mo-sub">行囊（點一下放進倉庫）</h4><div class="mo-inv small tiles">${me.inv.map((it) => tile(it, `data-sput="${it.u || it.p}"`)).join("") || `<p class="mo-dim">空的</p>`}</div></div>
      <div><h4 class="mo-sub">倉庫 ${st.length} / ${n.max}（點一下拿出來）</h4><div class="mo-inv small tiles">${st.map((it) => tile(it, `data-stake="${it.u || it.p}"`)).join("") || `<p class="mo-dim">空的</p>`}</div></div></div>
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
  // ------------------------------------------------------------ 主線故事「乾坤筆」：一頁一頁翻，最後一頁「聽完了」才領獎勵
  let storyCh = null, storyPage = 0;
  function storySay(n) {
    const S = n.story; if (!S) return "……";
    if (S.list.some((x) => x.st === "ok")) return "坐，聽我說段故事。";
    if (S.next && S.next.here && me && me.lv < S.next.lv) return `這段故事，等你 ${S.next.lv} 級再來聽吧。`;
    if (S.list.every((x) => x.st === "done")) return "我知道的都說給你聽了。路上小心。";
    return "（他看了你一眼，搖搖頭）還沒到我說話的時候。";
  }
  function storyBody(n) {
    const S = n.story; if (!S) return "";
    if (storyCh != null) {
      const ch = S.list.find((x) => x.i === storyCh);
      if (ch && ch.pages) {
        const pg = Math.max(0, Math.min(storyPage, ch.pages.length - 1)), last = pg >= ch.pages.length - 1, PA = n.art || "";
        return `<div class="mo-story-read">${hasArt(PA) ? `<img class="mo-story-pic" src="${artUrl(PA)}" alt="">` : ""}
          <div class="mo-story-text"><h4>第 ${ch.i + 1} 回・${esc(ch.title)}</h4><p>${esc(ch.pages[pg])}</p></div></div>
          <div class="mo-story-foot"><small>${pg + 1} / ${ch.pages.length}</small>${pg > 0 ? `<button data-spg="-1">上一頁</button>` : ""}
          ${!last ? `<button class="mo-pri" data-spg="1">繼續 ▸</button>` : ch.st === "ok" ? `<button class="mo-pri" data-sdone="${ch.i}">聽完了（+${money(ch.exp)} 經驗・+${money(ch.gold)} 兩）</button>` : `<button class="mo-pri" data-sback="1">回到目錄</button>`}</div>`;
      }
      storyCh = null;
    }
    const rows = S.list.map((ch) => `<div class="mo-story-row ${ch.st}"><span><b>第 ${ch.i + 1} 回・${ch.st === "locked" ? "？？？" : esc(ch.title)}</b><small>${ch.st === "done" ? "聽過了" : ch.st === "ok" ? `可以聽・聽完 +${money(ch.exp)} 經驗、+${money(ch.gold)} 兩` : ch.st === "lv" ? `${ch.lv} 級才能聽` : "還沒輪到"}</small></span>${ch.st === "ok" ? `<button class="mo-pri" data-sopen="${ch.i}">聽故事</button>` : ch.st === "done" ? `<button data-sopen="${ch.i}">再聽一次</button>` : ""}</div>`).join("");
    const nx = S.next;
    const hint = !nx ? `<p class="mo-dim">「乾坤筆」的故事你全部聽完了。</p>` : nx.here ? "" : `<p class="mo-dim">主線下一回：第 ${nx.i + 1} 回「${esc(nx.title)}」，去${esc(nx.map)}找「${esc(nx.npc)}」${me && me.lv < nx.lv ? `（${nx.lv} 級）` : ""}。</p>`;
    return `<div class="mo-story">${rows}${hint}<p class="mo-dim">主線「乾坤筆」進度 ${S.at} / ${S.total}</p></div>`;
  }
  function renderNpc() {
    const n = npcOpen; if (!n) return;
    let body = "";
    if (n.kind === "smith") body = `<div class="mo-tabs"><button data-tab="buy"${npcTab === "buy" ? ' class="on"' : ""}>買裝備</button><button data-tab="forge"${npcTab === "forge" ? ' class="on"' : ""}>鍛造</button><button data-tab="mats"${npcTab === "mats" ? ' class="on"' : ""}>材料</button></div>` + (npcTab === "forge" ? forgeView() : npcTab === "mats" ? matsView(n) : smithBuy(n));
    else if (n.kind === "herb") body = `<div class="mo-shop">${n.shop.map((s) => `<div class="mo-si${me && s.lv > me.lv ? " lock" : ""}"><span><b>${esc(s.n)}</b><small>${esc(s.d)}${s.lv > 1 ? `・${s.lv}級` : ""}・${s.price} 兩</small></span><span class="mo-qty"><button data-buy="${s.k}" data-n="1">×1</button><button data-buy="${s.k}" data-n="10">×10</button></span></div>`).join("")}</div><div class="mo-row"><button data-act="sell">賣東西</button></div>`;
    else if (n.kind === "bank") body = n.real ? `<div class="mo-bank"><p>你的代幣：<b>${n.tokens == null ? "（查不到）" : money(n.tokens)}</b>　身上銀兩：<b>${money(me ? me.gold : 0)}</b></p>
        <p class="mo-dim">1 兩 = 1 代幣。代幣換銀兩一次最多 ${money(n.maxIn || 1000000)}。</p>
        <div class="mo-bankq"><div><span>今天的額度</span><b>${money(Math.max(0, n.cap - n.used))}</b><small>每天 ${money(n.cap)}・已用 ${money(n.used)}</small></div>
          <div><span>歷史存入額度</span><b>${money(n.pool || 0)}</b><small>以前用代幣換進 ${money(n.poolIn || 0)} 兩</small></div></div>
        <p class="mo-dim">銀兩換代幣：先扣今天的額度，超過的再扣歷史存入額度（用掉就少了，不會每天重來）。現在最多可以換 <b>${money(Math.max(0, n.cap - n.used) + (n.pool || 0))}</b> 兩。</p>
        <label class="mo-field">金額<input type="number" class="mo-amt" min="1" step="1" value="100"></label>
        <div class="mo-row"><button class="mo-pri" data-bank="in">代幣 → 銀兩</button><button data-bank="out">銀兩 → 代幣</button></div></div>`
      : `<p>錢莊要用 Discord 登入才能用（角色要綁在你的帳號上）。</p><p class="mo-dim">回選單重新進來時選「用 Discord 登入」。</p>`;
    else if (n.kind === "post" || n.kind === "stone") body = `<div class="mo-shop">${(n.warps || []).map((w) => `<div class="mo-si${w.ok ? "" : " lock"}"><span><b>${esc(w.n)}</b><small>${esc(w.lvl)}${w.ok ? "" : "・還沒去過，要先走過去一次"}</small></span><button data-warp="${w.k}"${w.ok ? "" : " disabled"}>${w.cost ? `${w.cost} 兩` : "免費"}・傳送</button></div>`).join("")}</div>
      ${n.recall ? `<div class="mo-row"><button class="mo-pri" data-recall="1">回到上次的地點（${esc(n.recall)}）</button></div>` : ""}
      <p class="mo-dim">去過的地方才能傳送。在野外用回城符回城後，城裡再按 3（或用回城符）就能免費回到原地。</p>`;
    else if (n.kind === "tower") { const T = n.tower, C = n.climb || {}; const S = SETS.tower; body = `<div class="mo-tower"><p>鎖妖塔一層一層往上爬，<b>每 5 層一隻王</b>（竹妖、虎王、屍王、雪妖、麒麟、教主、九尾妖狐，再往上是東海龍王、開明獸、閻羅王、二郎神），越高怪越強。每清一層回 25% 血魔。</p>
        <ul><li>${C.minLv} 級以上，隊長帶隊（隊員要在長安城才會一起進去）</li><li>限時 ${C.time} 分鐘，倒下就回城</li><li>王層掉寶（有機會掉<b class="mo-setn" style="--sc:${S.col}">「${S.name}」套裝</b>，越高層越好）；最高層數會刻上江湖榜</li></ul>
        <p>你的最高紀錄：<b>第 ${C.best} 層</b>　今天還能進 <b>${C.left}</b> / ${C.daily} 次${T.team > 1 ? `・隊伍 ${T.team} 人` : "・單人"}</p>
        <div class="mo-row"><button class="mo-pri" data-tower="1"${C.left > 0 && T.lead && me && me.lv >= C.minLv ? "" : " disabled"}>${!T.lead ? "要由隊長帶隊" : me && me.lv < C.minLv ? `${C.minLv} 級才能進` : C.left > 0 ? "進入鎖妖塔" : "今天的次數用完了"}</button></div></div>`; }
    else if (n.kind === "dungeon") { const G = n.dg; body = `<div class="mo-tower"><p>${esc(G.desc)}</p>
        <p class="mo-setbox" style="--sc:${G.set.col}"><i class="mo-seal">${G.set.ch}</i><b class="mo-setn">${esc(G.set.area)}「${esc(G.set.name)}」套裝</b>（任何部位都可能掉）<br><small>2 件：${esc(G.set.d2)}　3 件：${esc(G.set.d3)}${G.set.d5 ? `　5 件：${esc(G.set.d5)}` : ""}</small></p>
        <div class="mo-diffs">${G.diffs.map((x) => `<button class="mo-diff d-${x.k}" data-dg="${G.key}" data-diff="${x.k}"${G.left > 0 && G.lead && me && me.lv >= x.lv ? "" : " disabled"}><b>${x.n}</b><small>${x.lv} 級以上</small><small>套裝 ${x.setP}%・傳說 ${x.legend}%</small></button>`).join("")}</div>
        <p>${G.daily ? `今天還能進 <b>${G.left}</b> / ${G.daily} 次` : "不限次數"}${G.team > 1 ? `・隊伍 ${G.team} 人（隊員要在入口附近）` : "・單人（建議組隊）"}${G.lead ? "" : "・<b>要由隊長帶隊</b>"}</p></div>`; }
    else if (n.kind === "arena") { const A = n.arena; body = `<p>在長安城點其他玩家選「擂台切磋」，對方同意就上擂台。打到對方剩 0 就贏，3 分鐘到了血量高的贏。不掉東西、不扣經驗。擂台上的傷害另外壓低（單下、短時間內都有上限），不會一招秒人。</p>
        <p>你的戰績：<b>${A.me.w}</b> 勝 <b>${A.me.l}</b> 敗</p>
        <h4 class="mo-sub">擂台榜</h4>${A.top.length ? `<ol class="mo-top">${A.top.map((r) => `<li><b>${esc(r.n)}</b><span>${r.w} 勝 ${r.l} 敗</span></li>`).join("")}</ol>` : `<p class="mo-dim">還沒有人上過擂台。</p>`}`; }
    else if (n.kind === "store") body = storeView(n);
    else if (n.kind === "bounty") body = bountyView(n);
    else if (n.kind === "inn") body = innView(n);
    else if (n.kind === "temple") body = templeView(n);
    else if (n.kind === "casino") body = casinoView(n);
    else if (n.kind === "rank") body = rankView(n);
    else if (n.kind === "story") body = storyBody(n);
    else if (n.kind === "guide") body = advView(n) + `<p class="mo-dim">竹林 1–8 級、荒山 8–16 級、古墓 16–25 級、雪嶺 25–35 級、火焰山 35–45 級、魔教總壇 45–55 級。每張圖各有一隻王，打倒後按傷害分寶，記得揪人一起打。王蓄力時腳下會出現紅圈，快跑出去。</p>`;
    else body = "";
    const PA = n.art || NPC_ART[n.kind], pic = hasArt(PA) ? `<img class="mo-npcpic" src="${artUrl(PA)}" alt="">` : "";
    const say = n.kind === "story" ? storySay(n) : n.say;
    panel.innerHTML = `<div class="mo-sheet mo-npc${n.kind === "story" ? " mo-npc-story" : ""}"><header><h3>${esc(n.name)}</h3><button class="mo-x" data-act="close">✕</button></header>${storyCh != null && n.kind === "story" ? "" : `<div class="mo-npchead">${pic}<p class="mo-say-npc">「${esc(say)}」</p></div>`}${body}</div>`;
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
      <p>${esc(s.desc)}</p><small>${s.mp} 法力・冷卻 ${s.cd0 && s.cd < s.cd0 ? `<b class="mo-cdfast">${s.cd} 秒</b>（原本 ${s.cd0}）` : `${s.cd} 秒`}${extra}</small>
      ${assign && !lock ? `<div class="mo-assign">放到：${keyOrder((me.slots || []).length).map((i) => `<button data-sid="${s.id}" data-slot="${i}" class="${slot === i ? "on" : ""}">${KEYS[i]}</button>`).join("")}</div>` : ""}</div></div>`;
  };
  function renderSkills() {
    if (!me || !me.skills) return;
    const n = me.skills.filter((s) => s.lv <= me.lv).length;
    const ns = (me.slots || []).length;
    panel.innerHTML = `<div class="mo-sheet"><header><h3>技能・${ADVN[me.adv2] || ADVN[me.adv] || CLS[me.cls] || ""}</h3><button class="mo-x" data-act="close">✕</button></header>
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
  function renderSet() {
    const so = sndOpt();
    panel.innerHTML = `<div class="mo-sheet"><header><h3>設定</h3><button class="mo-x" data-act="close">✕</button></header>
      <div class="mo-snd">
        <div class="mo-sndrow"><span>技能音效</span><button data-snd="fx" class="${so.fx ? "on" : ""}">${so.fx ? "開" : "關"}</button><input type="range" min="0" max="100" step="1" value="${Math.round(so.fxv * 100)}" data-vol="fxv"${so.fx ? "" : " disabled"}><b class="mo-volv">${Math.round(so.fxv * 100)}</b></div>
        <div class="mo-sndrow"><span>背景環境音</span><button data-snd="amb" class="${so.amb ? "on" : ""}">${so.amb ? "開" : "關"}</button><input type="range" min="0" max="100" step="1" value="${Math.round(so.ambv * 100)}" data-vol="ambv"${so.amb ? "" : " disabled"}><b class="mo-volv">${Math.round(so.ambv * 100)}</b></div>
        <small>右下角的 🔊 是所有遊戲共用的總音量；這裡的兩條只調水墨江湖。</small>
        <div class="mo-sndrow"><span>特效品質</span><span class="mo-vfxq">${[["h", "高"], ["m", "中"], ["l", "低"]].map(([k, n]) => `<button data-vfxq="${k}" class="${vfxOpt().q === k ? "on" : ""}">${n}</button>`).join("")}</span></div>
        <div class="mo-sndrow"><span>他人特效</span><button data-vfxo="1" class="${vfxOpt().others ? "on" : ""}">${vfxOpt().others ? "減少" : "全部"}</button><small>手機卡的話：品質調低、他人特效選「減少」</small></div></div>
</div>`;
  }
  function renderHelp() {
    panel.innerHTML = `<div class="mo-sheet"><header><h3>怎麼玩</h3><button class="mo-x" data-act="close">✕</button></header>
      <p class="mo-help-set">音量和特效品質在右上角的「設定」。</p>
      <ul class="mo-help"><li>操作跟 LOL 一樣：<b>左鍵（或右鍵）點地面走路，按住不放會一直跟著滑鼠走</b>；點怪物會自己走過去打，打死前會一直普攻。按 S 停下來，方向鍵也可以走。</li><li>技能：每個職業 8 招（轉職後再多 3 招），按 K（或右上「技能」）挑招放到 <b>Q、W、E、R</b>（一轉多一格 F、二轉再多一格 D）。施放照滑鼠位置：按住技能鍵會出現範圍指示，對準後放開就放；也可以點技能鈕再點地圖。招式分四種——指定（滑鼠指著怪）、指向（朝滑鼠方向射出或衝刺）、範圍（打在滑鼠位置）、自身。手機上點技能鈕會朝目前的目標放。</li>
      <li>藥：鍵盤 1 吃回血的藥、2 吃回魔的藥、3 用回城符。5 秒沒戰鬥會快速回血。</li><li>點其他玩家可以邀請組隊或交易。隊友在附近一起打怪，經驗平分還有加成。</li>
      <li>城裡：鐵匠買裝備、藥鋪買藥、錢莊換代幣。行囊裡隨時可以賣東西，下面有「一鍵賣裝」；想留著的裝備點開按「鎖定」就不會被賣掉。</li>
      <li>鍛造（鐵匠的「鍛造」分頁）：強化 +1～+12 加基礎數值（+7 以上失敗會掉一級）、用靈玉洗詞條、用重鑄石把品質往上提。材料打怪會掉，鐵匠也有賣。</li>
      <li>城裡其他 NPC：倉庫（同帳號的角色共用，互相轉東西）、懸賞榜捕快（每天 3 個任務）、客棧（吃了 30 分鐘有加成）、城隍廟（每天祈福抽一支籤）、賭坊（擲骰比大小）、江湖榜（各種排行）。</li>
      <li>多角色：每個帳號最多 4 個角色，等級各自練；銀兩和倉庫整個帳號共用，裝備和技能各自分開。右上「換角」回到選角畫面。</li>
      <li>轉職：25 級去找說書人，每個職業二選一，學 3 招新招、多一格技能欄（F）。</li>
      <li>鎖妖塔：城西的守塔人，20 級以上組隊一層一層往上爬，每 5 層一隻王，越高越難，每天 3 次；最高層數會刻上江湖榜。</li>
      <li>副本：古墓、雪嶺、火焰山、魔教總壇、東海龍宮、崑崙仙山、幽冥地府、九重天宮都有副本入口，分普通、困難、地獄，掉套裝，次數不限，打完走出口傳送門離開。</li>
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
    if (d.btab) { bagTab = d.btab; return renderBag(); }
    if (d.bslot) { bagSlot = d.bslot; return renderBag(); }
    if (d.spg) { storyPage += Number(d.spg); snd.page ? snd.page() : null; return renderNpc(); }
    if (d.sopen != null) { storyCh = Number(d.sopen); storyPage = 0; return renderNpc(); }
    if (d.sback) { storyCh = null; return renderNpc(); }
    if (d.sdone != null) return send({ a: "story", i: Number(d.sdone) });
    if (d.act === "sortinv") return send({ a: "sortinv" });
    if (d.act === "bagup") return send({ a: "bagup" });
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
    if (d.advance2) { closePanel(); return send({ a: "advance2", k: d.advance2 }); }
    if (d.tower) { closePanel(); return send({ a: "tower" }); }
    if (d.dg) { closePanel(); return send({ a: "dungeon", key: d.dg, diff: d.diff }); }
    if (d.snd) { setSnd(d.snd, !sndOpt()[d.snd]); return renderSet(); }
    if (d.vfxq) { setVfx("q", d.vfxq); return renderSet(); }
    if (d.vfxo) { setVfx("others", !vfxOpt().others); return renderSet(); }
    if (d.fsel) { forgeSel = d.fsel; forgeFx = null; return renderNpc(); }
    if (d.sslot) { smithSlot = d.sslot; return renderNpc(); }
    if (d.fslot) { forgeSlot = d.fslot; return renderNpc(); }
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
      const r = md.boss ? 1.5 : md.el ? 1.05 : 0.75, d = Math.hypot(e.x - w.x, (e.y - 0.45 * (md.boss ? 2 : md.el ? 1.45 : 1)) - w.y);
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
    const wq = toWorld(ev.clientX, ev.clientY), h = hitLoot(wq) ? { npc: 1 } : hit(wq), want = !h ? "ground" : h.npc ? "npc" : h.md.k === "m" ? "mob" : "player";
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
    const lt = hitLoot(w);
    if (lt) { send({ a: "loot", id: lt.id }); clickMark = { x: lt.x, y: lt.y, t0: performance.now() }; return; }
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
    else if (["q", "w", "e", "r", "f", "d"].includes(k) && me.skills) {       // 按下：顯示範圍；放開：施放（自身技能按下就放）
      if (k === "f" && (me.slots || []).length < 5) return;
      if (k === "d" && (me.slots || []).length < 6) return;
      const s = slotSkills()["qwerfd".indexOf(k)];
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

  if (new URLSearchParams(location.search).has("mmodebug")) window.__mmo = { send, ents, meta, get me() { return me; }, get map() { return map; }, get folk() { return folk; }, get loot() { return loot; }, get fx() { return fx; }, get V() { return V; }, castSk };
  start();
  frame();
  return () => { closed = true; stopAmbience(); cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", releaseAll); clearInterval(dirTimer); try { ws && ws.close(); } catch {} };
}
