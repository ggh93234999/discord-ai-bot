// 阿瓦隆（5～10 人，沒有計時，每個公開畫面由玩家按「下一步」才往下走）。
// 好人要完成 3 次任務成功；壞人要 3 次任務失敗，或連續 5 次隊伍被否決。好人完成 3 次後，刺客有一次機會刺殺梅林。
// 角色：梅林、刺客一定有；可選派西維爾＋莫甘娜、莫德雷德、奧伯倫。其餘是忠臣（好）或爪牙（壞）。
// 電腦會補位、斷線的人也由電腦代打。伺服器負責發身分、判定和電腦；前端只畫畫面。沒有點數，只分勝負。
import { randomInt, randomBytes } from "node:crypto";

const MAXP = 10, MINP = 5;
const GOOD_N = { 5: 3, 6: 4, 7: 4, 8: 5, 9: 6, 10: 6 };
const QUEST = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5] };
export const ROLE_NAME = { merlin: "梅林", percival: "派西維爾", servant: "亞瑟的忠臣", assassin: "刺客", morgana: "莫甘娜", mordred: "莫德雷德", oberon: "奧伯倫", minion: "莫德雷德的爪牙" };
const EVIL_ROLES = new Set(["assassin", "morgana", "mordred", "oberon", "minion"]);
const isEvil = (r) => EVIL_ROLES.has(r);
const BOT_MS = [900, 1800];
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "亞瑟", "胖虎", "蘭斯", "高文"];
const DEFAULT_CFG = { n: 5, percival: true, mordred: false, oberon: false };

const out = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
const nameOf = (ws) => ws.avname || ws.user?.name || "玩家";
const tables = new Map();
const now = () => Date.now();
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function newTable(id) {
  return { id, members: new Set(), players: [], started: false, phase: "wait", cfg: { ...DEFAULT_CFG }, g: null, log: "等玩家入座…", botHist: new Set(), emptyAt: 0 };
}
function getTable(id) { if (!tables.has(id)) tables.set(id, newTable(id)); return tables.get(id); }
function pickBotName(t) {
  const used = new Set(t.players.map((p) => p.name));
  let pool = BOT_NAMES.filter((n) => !used.has("🤖" + n) && !t.botHist.has(n));
  if (!pool.length) { t.botHist.clear(); pool = BOT_NAMES.filter((n) => !used.has("🤖" + n)); }
  const n = pool[randomInt(pool.length)] || "電腦"; t.botHist.add(n); return "🤖" + n;
}
const mkP = (o) => ({ ws: null, pid: null, bot: false, name: "", ...o });
const isAuto = (p) => p.bot || !p.ws;

// ---------------------------------------------------------------- 開局、身分
function assignRoles(n, cfg) {
  const evilN = n - GOOD_N[n], goodN = GOOD_N[n];
  const evil = ["assassin"];
  if (cfg.percival && evil.length < evilN) evil.push("morgana");
  if (cfg.mordred && evil.length < evilN) evil.push("mordred");
  if (cfg.oberon && evil.length < evilN) evil.push("oberon");
  while (evil.length < evilN) evil.push("minion");
  const good = ["merlin"];
  if (evil.includes("morgana") && good.length < goodN) good.push("percival");
  while (good.length < goodN) good.push("servant");
  return shuffle([...good, ...evil]);
}
function startGame(t) {
  const want = Math.max(MINP, Math.min(MAXP, Math.max(t.cfg.n, t.players.length)));
  while (t.players.length < want) t.players.push(mkP({ bot: true, name: pickBotName(t) }));
  const n = t.players.length;
  t.g = { n, roles: assignRoles(n, t.cfg), leader: randomInt(n), round: 0, rejects: 0, results: [], fails: [], team: [], votes: {}, qvotes: {}, voteRes: null, questRes: null, sus: Array(n).fill(0), botAt: 0, winner: null, why: "", assassin: -1, target: -1 };
  t.started = true; t.final = null; t.phase = "team";
  t.log = `開始！${n} 人（好人 ${GOOD_N[n]}、壞人 ${n - GOOD_N[n]}）。身分只有你自己看得到，按住「看我的身分」`;
  setBot(t);
}
const setBot = (t) => { if (t.g) t.g.botAt = now() + BOT_MS[0] + randomInt(BOT_MS[1] - BOT_MS[0]); };
const questSize = (g) => QUEST[g.n][g.round];
const needFails = (g) => (g.n >= 7 && g.round === 3 ? 2 : 1);
const pname = (t, i) => t.players[i]?.name || "";

// 玩家 i 看得到哪些人
function knowledge(t, i) {
  const g = t.g, r = g.roles[i], names = (f) => shuffle(g.roles.map((x, k) => (k !== i && f(x) ? k : -1)).filter((k) => k >= 0)).map((k) => pname(t, k));
  if (r === "merlin") return { text: "你看得到這些壞人（莫德雷德除外）：", names: names((x) => isEvil(x) && x !== "mordred") };
  if (r === "percival") return { text: "這兩人之中一個是梅林、一個是莫甘娜：", names: names((x) => x === "merlin" || x === "morgana") };
  if (isEvil(r) && r !== "oberon") return { text: "你的壞人同伴（奧伯倫除外）：", names: names((x) => isEvil(x) && x !== "oberon") };
  if (r === "oberon") return { text: "你是壞人，但不知道同伴是誰，他們也不知道你。", names: [] };
  return { text: "你什麼都看不到，靠推理找出壞人。", names: [] };
}

// ---------------------------------------------------------------- 流程
function propose(t, i, ids) {
  const g = t.g;
  if (t.phase !== "team" || g.leader !== i || !Array.isArray(ids)) return false;
  const team = [...new Set(ids.map(Number))].filter((k) => Number.isInteger(k) && k >= 0 && k < g.n);
  if (team.length !== questSize(g)) return false;
  g.team = team.sort((a, b) => a - b); g.votes = {}; g.voteRes = null; t.phase = "vote";
  t.log = `${pname(t, i)} 提出隊伍：${team.map((k) => pname(t, k)).join("、")}。全部人投票`;
  setBot(t); return true;
}
function doVote(t, i, ok) {
  const g = t.g; if (t.phase !== "vote" || g.votes[i] !== undefined) return false;
  g.votes[i] = !!ok;
  if (Object.keys(g.votes).length === g.n) {
    const yes = Object.values(g.votes).filter(Boolean).length, pass = yes * 2 > g.n;
    g.voteRes = { votes: Array.from({ length: g.n }, (_, k) => g.votes[k]), yes, no: g.n - yes, pass };
    t.phase = "voteres";
    t.log = pass ? `隊伍通過（${yes} 贊成／${g.n - yes} 反對）` : `隊伍被否決（${yes} 贊成／${g.n - yes} 反對）`;
  }
  setBot(t); return true;
}
function doQuestVote(t, i, ok) {
  const g = t.g; if (t.phase !== "quest" || !g.team.includes(i) || g.qvotes[i] !== undefined) return false;
  if (!isEvil(g.roles[i])) ok = true;                                    // 好人只能讓任務成功
  g.qvotes[i] = !!ok;
  if (Object.keys(g.qvotes).length === g.team.length) {
    const fails = Object.values(g.qvotes).filter((x) => !x).length, success = fails < needFails(g);
    g.results.push(success ? "s" : "f"); g.fails.push(fails);
    if (fails) for (const k of g.team) g.sus[k] += fails / g.team.length;
    g.questRes = { round: g.round, success, fails, size: g.team.length, team: g.team.slice() };
    t.phase = "questres";
    t.log = `第 ${g.round + 1} 次任務${success ? "成功" : "失敗"}（${fails} 張失敗票）`;
  }
  setBot(t); return true;
}
function next(t) {
  const g = t.g;
  if (t.phase === "voteres") {
    if (g.voteRes.pass) { g.rejects = 0; g.qvotes = {}; t.phase = "quest"; t.log = `任務隊伍出發：${g.team.map((k) => pname(t, k)).join("、")} 各自選成功或失敗`; }
    else {
      g.rejects++;
      if (g.rejects >= 5) return finish(t, "evil", "連續 5 次隊伍被否決，壞人獲勝");
      g.leader = (g.leader + 1) % g.n; g.team = []; t.phase = "team"; t.log = `${pname(t, g.leader)} 當隊長，重新提出隊伍（連續否決 ${g.rejects} 次）`;
    }
  } else if (t.phase === "questres") {
    const s = g.results.filter((x) => x === "s").length, f = g.results.length - s;
    if (f >= 3) return finish(t, "evil", "3 次任務失敗，壞人獲勝");
    if (s >= 3) {
      g.assassin = g.roles.indexOf("assassin"); t.phase = "assassin"; t.log = `好人完成 3 次任務！刺客 ${pname(t, g.assassin)} 有一次機會刺殺梅林`;
    } else { g.round++; g.leader = (g.leader + 1) % g.n; g.team = []; g.questRes = null; t.phase = "team"; t.log = `第 ${g.round + 1} 次任務：${pname(t, g.leader)} 當隊長，要選 ${questSize(g)} 人`; }
  } else return false;
  setBot(t); return true;
}
function assassinate(t, i, target) {
  const g = t.g; if (t.phase !== "assassin" || g.assassin !== i || !Number.isInteger(target) || target < 0 || target >= g.n || isEvil(g.roles[target])) return false;
  g.target = target;
  const hit = g.roles[target] === "merlin";
  return finish(t, hit ? "evil" : "good", hit ? `刺客刺中梅林（${pname(t, target)}），壞人逆轉獲勝` : `刺客刺錯人（${pname(t, target)} 不是梅林），好人獲勝`);
}
function finish(t, winner, why) {
  const g = t.g; g.winner = winner; g.why = why; t.phase = "end"; t.started = false;
  t.log = why; return true;
}
function reset(t) {                                        // 結束後回到大廳（保留座位，離線的人移除）
  t.players = t.players.filter((p) => !p.bot && p.ws);
  t.phase = "wait"; t.started = false; t.g = null; t.log = "再來一場？";
}

// ---------------------------------------------------------------- 電腦
function botAct(t, i) {
  const g = t.g, role = g.roles[i], evil = isEvil(role);
  if (t.phase === "team" && g.leader === i) {
    const k = questSize(g), pool = shuffle([...Array(g.n).keys()].filter((x) => x !== i)).sort((a, b) => (evil || role === "merlin" ? 0 : g.sus[a] - g.sus[b]));
    let team = [i];
    if (evil) { const mates = pool.filter((x) => isEvil(g.roles[x]) && x !== i); if (mates.length && Math.random() < 0.55 && k > 2) team.push(mates[0]); }
    for (const x of pool) { if (team.length >= k) break; if (!team.includes(x)) team.push(x); }
    return propose(t, i, team.slice(0, k));
  }
  if (t.phase === "vote" && g.votes[i] === undefined) {
    const withEvil = g.team.filter((x) => isEvil(g.roles[x])).length;
    let ok;
    if (g.rejects >= 4) ok = !evil;                                           // 第 5 次：好人一定贊成
    else if (evil) ok = withEvil > 0 ? Math.random() < 0.9 : Math.random() < 0.3;
    else if (role === "merlin") ok = withEvil === 0;                           // 梅林知道誰壞
    else { const sus = g.team.reduce((a, x) => a + (x === i ? 0 : g.sus[x]), 0); ok = sus >= 0.6 ? false : g.team.includes(i) || Math.random() < 0.8; }
    return doVote(t, i, ok);
  }
  if (t.phase === "quest" && g.team.includes(i) && g.qvotes[i] === undefined) {
    const mates = g.team.filter((x) => isEvil(g.roles[x])).length;
    const wins = g.results.filter((x) => x === "s").length, losses = g.results.length - wins;
    const ok = !(evil && (losses >= 2 || wins >= 2 || Math.random() < (mates > 1 ? 0.3 : g.results.length === 0 ? 0.3 : 0.55)));
    return doQuestVote(t, i, ok);
  }
  if (t.phase === "assassin" && g.assassin === i) {
    const known = new Set([...g.roles.keys()].filter((x) => isEvil(g.roles[x])));
    const goods = [...g.roles.keys()].filter((x) => !known.has(x));
    return assassinate(t, i, goods[randomInt(goods.length)]);
  }
  return false;
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.players.findIndex((p) => p.ws === ws && !ws.avspec), g = t.g;
  const v = { t: "avstate", phase: t.phase, started: t.started, cfg: t.cfg, you, log: t.log, now: now(), watchers: [...t.members].filter((w) => w.avspec).length, maxp: MAXP, minp: MINP,
    players: t.players.map((p, i) => ({ i, name: p.name, bot: p.bot, away: !p.bot && !p.ws })) };
  if (g) {
    Object.assign(v, { n: g.n, leader: g.leader, round: g.round, rejects: g.rejects, results: g.results, fails: g.fails, sizes: QUEST[g.n], need2: g.n >= 7, team: g.team, goodN: GOOD_N[g.n] });
    const waiting = [];
    if (t.phase === "vote") v.voted = Object.keys(g.votes).map(Number);
    if (t.phase === "quest") v.qdone = Object.keys(g.qvotes).map(Number);
    if (t.phase === "voteres") v.voteRes = g.voteRes;
    if (t.phase === "questres") v.questRes = g.questRes;
    if (t.phase === "assassin") v.assassin = g.assassin;
    v.roleList = [...g.roles].sort().map((r) => ROLE_NAME[r]);
    if (you >= 0) {
      const r = g.roles[you]; v.me = { role: r, roleName: ROLE_NAME[r], evil: isEvil(r), ...knowledge(t, you) };
      if (t.phase === "vote") v.myVote = g.votes[you];
      if (t.phase === "quest") v.myQ = g.qvotes[you];
    }
    if (t.phase === "end") { v.end = { winner: g.winner, why: g.why, roles: g.roles.map((r, i) => ({ i, name: pname(t, i), role: ROLE_NAME[r], evil: isEvil(r) })), target: g.target }; }
  }
  return v;
}
function push(t) { for (const ws of t.members) out(ws, view(t, ws)); }
export function listAvalonTables() {
  const res = [];
  for (const t of tables.values()) {
    const hum = t.players.filter((p) => !p.bot);
    if (!hum.length) continue;
    res.push({ game: "avalon", id: t.id, players: hum.map((s) => ({ name: s.name, real: false, playing: false })), watchers: [...t.members].filter((w) => w.avspec).length, bots: t.players.length - hum.length });
  }
  return res;
}

// ---------------------------------------------------------------- 計時（只有電腦和離線玩家會被代打，真人沒有時限）
function autoNext(t) { return !t.players.some((p) => p.ws && !p.bot); }   // 沒有任何真人在線就自動往下
function tick() {
  const n = now();
  for (const [key, t] of [...tables.entries()]) {
    if (!t.members.size) { if (n - (t.emptyAt || (t.emptyAt = n)) > 120000) tables.delete(key); continue; }
    t.emptyAt = 0;
    if (!t.started || !t.g) continue;
    const g = t.g;
    try {
      if (n < g.botAt) continue;
      let acted = false;
      if (t.phase === "team") acted = isAuto(t.players[g.leader]) && botAct(t, g.leader);
      else if (t.phase === "vote") { const i = t.players.findIndex((p, k) => isAuto(p) && g.votes[k] === undefined); if (i >= 0) acted = botAct(t, i); }
      else if (t.phase === "quest") { const i = g.team.find((k) => isAuto(t.players[k]) && g.qvotes[k] === undefined); if (i !== undefined) acted = botAct(t, i); }
      else if (t.phase === "assassin") acted = isAuto(t.players[g.assassin]) && botAct(t, g.assassin);
      else if ((t.phase === "voteres" || t.phase === "questres") && autoNext(t)) acted = next(t);
      if (acted) { setBot(t); push(t); }
    } catch (e) { console.log("阿瓦隆錯誤", e && e.stack); }
  }
}
setInterval(tick, 200).unref();

// ---------------------------------------------------------------- 連線
export function avalonClose(ws) {
  const t = ws.avtable; if (!t) return;
  t.members.delete(ws);
  const i = t.players.findIndex((p) => p.ws === ws);
  if (i >= 0) { t.players[i].ws = null; if (!t.started) t.players.splice(i, 1); }
  ws.avtable = null;
  push(t);
}
export function handleAvalon(ws, m) {
  if (m.t === "avjoin") {
    if (ws.avtable) avalonClose(ws);
    const t = getTable(String(m.room || "default").slice(0, 80));
    ws.avtable = t; ws.avspec = !!m.spectate; if (cleanName(m.name)) ws.avname = cleanName(m.name);
    ws.avpid = String(m.pid || "").slice(0, 40) || randomBytes(4).toString("hex");
    t.members.add(ws);
    if (!ws.avspec) { const p = t.players.find((x) => !x.bot && x.pid === ws.avpid); if (p) { p.ws = ws; p.name = nameOf(ws); } }
    push(t); return true;
  }
  const t = ws.avtable; if (!t) return false;
  if (ws.avspec) return true;
  const mine = t.players.findIndex((p) => p.ws === ws);
  if (m.t === "avsit") {
    if (mine >= 0) return true;
    if (t.started) {                                            // 進行中：接手一個電腦
      const i = Number(m.seat);
      if (t.players[i] && t.players[i].bot) { t.players[i] = mkP({ ws, pid: ws.avpid, name: nameOf(ws) }); t.log = `${nameOf(ws)} 接手電腦的位置`; push(t); }
      return true;
    }
    if (t.players.length >= MAXP) return out(ws, { t: "averr", error: "full" }), true;
    t.players.push(mkP({ ws, pid: ws.avpid, name: nameOf(ws) })); t.log = `${nameOf(ws)} 入座`; push(t);
  } else if (m.t === "avstand") {
    if (mine < 0) return true;
    const p = t.players[mine];
    if (t.started) { t.players[mine] = mkP({ bot: true, name: pickBotName(t) }); t.log = `${p.name} 離座，由 ${t.players[mine].name} 接手`; }
    else t.players.splice(mine, 1);
    push(t);
  } else if (m.t === "avaddbot") {
    if (mine < 0 || t.started || t.players.length >= MAXP) return true;
    t.players.push(mkP({ bot: true, name: pickBotName(t) })); push(t);
  } else if (m.t === "avdelbot") {
    const i = Number(m.seat);
    if (mine < 0 || t.started || !t.players[i] || !t.players[i].bot) return true;
    t.players.splice(i, 1); push(t);
  } else if (m.t === "avname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.avname = nm; if (mine >= 0) t.players[mine].name = nm; push(t);
  } else if (m.t === "avcfg") {
    if (mine < 0 || t.started) return true;
    const n = Number(m.n); if (n >= MINP && n <= MAXP) t.cfg.n = n;
    for (const k of ["percival", "mordred", "oberon"]) if (typeof m[k] === "boolean") t.cfg[k] = m[k];
    push(t);
  } else if (m.t === "avstart") {
    if (mine < 0 || t.started) return true;
    if (t.phase === "end") reset(t), t.players = t.players;       // 保險：結束畫面直接開新局
    startGame(t); push(t);
  } else if (m.t === "avlobby") {
    if (mine >= 0 && t.phase === "end") { reset(t); push(t); }
  } else if (m.t === "avact") {
    if (mine < 0 || !t.started) return true;
    const a = String(m.a || "");
    let ok = false;
    if (a === "team") ok = propose(t, mine, m.ids);
    else if (a === "vote") ok = doVote(t, mine, m.ok);
    else if (a === "quest") ok = doQuestVote(t, mine, m.ok);
    else if (a === "next") ok = next(t);
    else if (a === "kill") ok = assassinate(t, mine, Number(m.target));
    if (ok) push(t); else out(ws, { t: "averr", error: "illegal" });
  }
  return true;
}

// 測試用：全電腦打完一局，回傳勝負
export function _simGame(n = 5, cfg = {}) {
  const t = newTable("sim"); t.cfg = { ...DEFAULT_CFG, n, ...cfg };
  startGame(t);
  let steps = 0;
  while (t.phase !== "end" && steps < 3000) {
    const g = t.g; steps++;
    if (t.phase === "team") botAct(t, g.leader);
    else if (t.phase === "vote") { const i = [...Array(g.n).keys()].find((k) => g.votes[k] === undefined); botAct(t, i); }
    else if (t.phase === "quest") { const i = g.team.find((k) => g.qvotes[k] === undefined); botAct(t, i); }
    else if (t.phase === "assassin") botAct(t, g.assassin);
    else next(t);
  }
  return { steps, winner: t.g.winner, why: t.g.why, results: t.g.results.join("") };
}
