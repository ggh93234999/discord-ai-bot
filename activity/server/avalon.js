// 阿瓦隆（5～10 人，沒有計時，每個公開畫面由玩家按「下一步」才往下走）。
// 好人要完成 3 次任務成功；壞人要 3 次任務失敗，或連續 5 次隊伍被否決。好人完成 3 次後，刺客有一次機會刺殺梅林。
// 角色：梅林、刺客一定有；可選派西維爾＋莫甘娜、莫德雷德、奧伯倫。其餘是忠臣（好）或爪牙（壞）。
// 電腦會補位、斷線的人也由電腦代打。伺服器負責發身分、判定和電腦；前端只畫畫面。沒有點數，只分勝負。
import { randomInt, randomBytes } from "node:crypto";
import { ENV } from "./bet.js";
import fs from "node:fs";

const MAXP = 10, MINP = 5;
const GOOD_N = { 5: 3, 6: 4, 7: 4, 8: 5, 9: 6, 10: 6 };
const QUEST = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5] };
export const ROLE_NAME = { merlin: "梅林", percival: "派西維爾", servant: "亞瑟的忠臣", assassin: "刺客", morgana: "莫甘娜", mordred: "莫德雷德", oberon: "奧伯倫", minion: "莫德雷德的爪牙" };
const EVIL_ROLES = new Set(["assassin", "morgana", "mordred", "oberon", "minion"]);
const isEvil = (r) => EVIL_ROLES.has(r);
const BOT_MS = [900, 1800];
const BOT_NAMES = ["阿發", "小明", "老王", "花花", "阿牛", "小美", "豆豆", "阿嬤", "亞瑟", "胖虎", "蘭斯", "高文"];
const DEFAULT_CFG = { n: 5, percival: true, mordred: false, oberon: false, llm: false };

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
  t.g = { n, roles: assignRoles(n, t.cfg), leader: randomInt(n), round: 0, rejects: 0, gid: randomBytes(4).toString("hex"), chat: [], results: [], fails: [], hist: [], team: [], votes: {}, qvotes: {}, voteRes: null, questRes: null, sus: Array(n).fill(0), botAt: 0, winner: null, why: "", assassin: -1, target: -1 };
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
    g.hist.push({ round: g.round, no: g.rejects + 1, leader: g.leader, team: g.team.slice(), votes: g.voteRes.votes.slice(), pass });
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
    { const h = g.hist[g.hist.length - 1]; if (h) h.q = { success, fails }; }
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
function botActRule(t, i) {
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

// ---------------------------------------------------------------- 電腦用 LLM 思考（大廳勾「電腦用 AI」才會用；失敗或太慢就退回上面的規則）
// 模型位址／金鑰沿用機器人的 .env（LLM_BASE_URL、LLM_API_KEY），可用 AVALON_LLM_MODEL 指定模型，沒設就用 LLM_MODEL。
const LLM_URL = String(ENV.AVALON_LLM_BASE_URL || ENV.LLM_BASE_URL || "").replace(/\/+$/, "");
const LLM_KEY = ENV.AVALON_LLM_API_KEY || ENV.LLM_API_KEY || "";
const STATE_FILE = new URL("../../state.json", import.meta.url);
// 模型：AVALON_LLM_MODEL > 機器人目前用的模型（/模型 切換後存在 state.json）> LLM_MODEL
function llmModel() {
  if (ENV.AVALON_LLM_MODEL) return ENV.AVALON_LLM_MODEL;
  try { const m = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).model; if (m) return String(m); } catch {}
  return ENV.LLM_MODEL || "";
}
const LLM_EFFORT = ENV.AVALON_LLM_REASONING ?? "none";      // 思考模式（none＝不思考，省錢又快）
const LLM_TIMEOUT = Number(ENV.AVALON_LLM_TIMEOUT || 60) * 1000;
export const llmEnabled = () => !!(LLM_URL && llmModel());
const RULES_TXT = "阿瓦隆規則：好人要 3 次任務成功；壞人要 3 次任務失敗、或連續 5 次隊伍被否決、或好人完成 3 次後刺客刺中梅林。隊長選指定人數的隊伍，所有人公開投贊成／反對（過半贊成才通過）。通過後隊員各出『成功』或『失敗』牌，好人只能出成功，壞人可以出失敗。任務只要有失敗票就失敗（7 人以上的第 4 次要 2 張）。";
const say = (t, i, text) => { const g = t.g, s = String(text || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 80); if (!g || !s) return; g.chat.push({ i, name: pname(t, i), text: s, round: g.round }); if (g.chat.length > 80) g.chat.shift(); };
function llmPrompt(t, i, mode) {
  const g = t.g, role = g.roles[i], evil = isEvil(role), kn = knowledge(t, i);
  const nm = (k) => `${k}號${pname(t, k)}`;
  const hist = g.hist.map((h) => `任務${h.round + 1}第${h.no}次提案：隊長${nm(h.leader)}，隊伍[${h.team.map(nm).join("、")}]，贊成[${h.votes.map((v, k) => (v ? nm(k) : null)).filter(Boolean).join("、") || "無"}]，反對[${h.votes.map((v, k) => (v ? null : nm(k))).filter(Boolean).join("、") || "無"}]，${h.pass ? "通過" : "否決"}${h.q ? `，任務${h.q.success ? "成功" : "失敗"}（${h.q.fails}張失敗）` : ""}`).join("\n") || "（還沒有紀錄）";
  const sys = `你在玩桌遊阿瓦隆，扮演玩家「${pname(t, i)}」（${i}號）。${RULES_TXT}\n你的身分：${ROLE_NAME[role]}（${evil ? "壞人" : "好人"}）。${kn.text}${kn.names.length ? kn.names.join("、") : ""}\n玩家：${t.players.map((p, k) => nm(k)).join("、")}（共 ${g.n} 人）。\n像真人一樣判斷：好人要從投票和任務結果找壞人；壞人要藏好身分、可以偶爾幫好人、爭取信任；梅林不能太明顯。說話規則：say 是公開發言，所有人都聽得到，像真人隨口說，口語、簡短、不要每次都說；壞人可以說謊或誤導，但不能直接說出自己的身分；好人也不要直接洩漏自己的特殊身分（梅林尤其要小心）；可以回應別人剛說的話。只輸出一個 JSON，不要多餘文字。`;
  const talk = g.chat.slice(-12).map((c) => `${c.i}號${c.name}：${c.text}`).join("\n") || "（還沒有人說話）";
  const state = `公開討論（最近的發言，大家都看得到）：\n${talk}\n\n目前第 ${g.round + 1} 次任務（需 ${questSize(g)} 人，${needFails(g) > 1 ? "要 2 張失敗票才失敗" : "1 張失敗票就失敗"}），已成功 ${g.results.filter((x) => x === "s").length} 次、失敗 ${g.results.filter((x) => x !== "s").length} 次，連續否決 ${g.rejects} 次，隊長是 ${nm(g.leader)}。\n歷史紀錄：\n${hist}`;
  let hint = "";
  if (evil) {
    const okN = g.results.filter((x) => x === "s").length, flN = g.results.length - okN;
    const mates = (t.phase === "vote" || t.phase === "quest") ? g.team.filter((k) => isEvil(g.roles[k])) : [];
    const L = ["【壞人戰術，務必照做】"];
    L.push(`・壞人要靠『任務失敗 3 次』或『連續 5 次否決』贏。現在好人成功 ${okN} 次、失敗 ${flN} 次、連續否決 ${g.rejects} 次。`);
    if (t.phase === "vote") {
      L.push(mates.length ? `・這隊有壞人（${mates.map(nm).join("、")}），可以贊成並讓他出失敗。` : "・這隊全是好人，好人只能出成功，這隊通過只會幫好人加分：通常應該反對（除非是第一輪、需要偽裝，或你反對太多次已被懷疑）。");
      if (okN >= 2 && !mates.length) L.push("・好人只差 1 次成功就贏任務了，全是好人的隊必須反對！");
      if (flN >= 2 && mates.length) L.push("・只差 1 次失敗就贏了，這隊有壞人，贊成並出失敗。");
      if (g.rejects >= 2) L.push(`・已連續否決 ${g.rejects} 次，再否決到 5 次壞人直接獲勝，所以不管隊伍如何都傾向反對（但第 5 次提案若你想偽裝才贊成）。`);
    }
    if (t.phase === "quest") {
      if (okN >= 2 || flN >= 2) L.push("・這是關鍵任務（好人再成功一次就贏任務，或壞人再失敗一次就贏），必須出失敗！");
      else L.push("・第一、二次任務可以視情況先出成功偽裝，但別一直偽裝到被逼到牆角；若隊上只有你一個壞人，出失敗會暴露你，要評估。");
    }
    if (t.phase === "team") L.push("・選隊時盡量把自己或壞人同伴放進去；好人只差 1 次成功時，隊伍裡一定要有壞人。");
    hint = L.join("\n") + "\n";
  }
  let ask;
  if (mode === "talk") ask = t.phase === "team"
    ? `現在隊長 ${nm(g.leader)} 準備選隊伍，還沒決定。請先在公開討論發言：根據前面任務與投票的結果，說說你覺得該帶誰、不該帶誰、或你懷疑誰，要點名並給理由（40 字內）；也可以回應別人剛說的話，不要重複別人說過的。${evil ? "你是壞人，要裝成好人、可以引導大家選到對你有利的隊伍。" : ""}只輸出 {"say":"你的發言"}`
    : `隊長 ${nm(g.leader)} 提出隊伍 [${g.team.map(nm).join("、")}]，大家還沒投票。請先在公開討論發言：你贊成還是反對這隊、為什麼，要點名具體的人或引用前面的任務／投票結果（40 字內）；可以回應別人剛說的話或質疑某人，不要重複別人說過的。${evil ? "你是壞人，要裝成好人。" : ""}只輸出 {"say":"你的發言"}`;
  else if (t.phase === "team") ask = `你是隊長，選 ${questSize(g)} 人（可以包含自己）。輸出 {"team":[號碼,...],"reason":"一句話（只有你自己知道）","say":"對大家說的一句話（20 字內，可以空字串）"}`;
  else if (t.phase === "vote") ask = `隊長 ${nm(g.leader)} 提出隊伍 [${g.team.map(nm).join("、")}]。${g.rejects >= 4 ? "（這是第 5 次提案，再否決壞人就贏了）" : ""}輸出 {"approve":true或false,"reason":"一句話（只有你自己知道）","say":"已討論過了，除非立場改變，請留空字串"}`;
  else if (t.phase === "quest") ask = `你在任務隊伍裡 [${g.team.map(nm).join("、")}]。${evil ? "你可以出成功或失敗。" : "你是好人，只能出成功。"}輸出 {"success":true或false,"reason":"一句話（只有你自己知道）","say":"可以空字串"}`;
  else ask = `好人完成了 3 次任務，你是刺客，要刺殺你認為是梅林的好人（不能選壞人）。可選：${g.roles.map((r, k) => (isEvil(r) ? null : nm(k))).filter(Boolean).join("、")}。輸出 {"target":號碼,"reason":"一句話","say":"可以空字串"}`;
  return [{ role: "system", content: sys }, { role: "user", content: `${state}\n\n${hint}${ask}` }];
}
async function llmDecide(t, i, mode) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), LLM_TIMEOUT);
  try {
    const r = await fetch(LLM_URL + "/chat/completions", {
      method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", ...(LLM_KEY ? { Authorization: "Bearer " + LLM_KEY } : {}) },
      body: JSON.stringify({ model: llmModel(), messages: llmPrompt(t, i, mode), temperature: 0.8, max_tokens: 400, stream: false, ...(LLM_EFFORT ? { reasoning_effort: LLM_EFFORT } : {}) }),
    });
    if (!r.ok) throw new Error("http " + r.status + " " + String(await r.text().catch(() => "")).slice(0, 160));
    const j = await r.json(), txt = String(j?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "");
    const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error("no json");
    const u = j.usage || {}; (t.g.tok ||= { calls: 0, fail: 0, in: 0, out: 0, by: {} });
    const tk = t.g.tok, ti = Number(u.prompt_tokens) || 0, to2 = Number(u.completion_tokens) || 0; tk.calls++; tk.in += ti; tk.out += to2; (tk.by[i] ||= { calls: 0, in: 0, out: 0 }); tk.by[i].calls++; tk.by[i].in += ti; tk.by[i].out += to2;
    return JSON.parse(m[0]);
  } finally { clearTimeout(to); }
}
function llmApply(t, i, d) {
  const g = t.g;
  if (t.phase === "team") { const team = Array.isArray(d.team) ? d.team.map(Number) : []; return propose(t, i, team); }
  if (t.phase === "vote") return typeof d.approve === "boolean" ? doVote(t, i, d.approve) : false;
  if (t.phase === "quest") { if (typeof d.success !== "boolean") return false; return doQuestVote(t, i, isEvil(g.roles[i]) ? d.success : true); }
  if (t.phase === "assassin") return assassinate(t, i, Number(d.target));
  return false;
}
function discussStep(t) {                                  // 先討論再決定：回傳 true 表示討論結束
  const g = t.g, key = `${t.phase}|${g.round}|${g.rejects}|${g.hist.length}`;
  let d = g.disc;
  if (!d || d.key !== key) {
    let sp = [];
    for (let k = 0; k < g.n; k++) if (isAuto(t.players[k]) && !(t.phase === "team" && k === g.leader)) sp.push(k);
    for (let k = sp.length - 1; k > 0; k--) { const r = randomInt(k + 1); [sp[k], sp[r]] = [sp[r], sp[k]]; }
    d = g.disc = { key, queue: sp.slice(0, 4), busy: false, end: 0 };
    if (!d.queue.length) d.end = now();
  }
  if (d.busy) return false;
  if (d.queue.length) {
    const i = d.queue.shift(); d.busy = true; (g.llmBusy ||= {})[i] = key; push(t);
    (async () => {
      try { const r = await llmDecide(t, i, "talk"); if (t.g === g && g.disc === d && typeof r.say === "string") say(t, i, r.say); }
      catch (e) { if (t.g === g) (g.tok ||= { calls: 0, fail: 0, in: 0, out: 0, by: {} }).fail++; console.log("阿瓦隆 討論失敗：", e && e.message); }
      finally { if (t.g === g) { delete g.llmBusy[i]; if (g.disc === d) { d.busy = false; if (!d.queue.length) d.end = now() + 2500; } try { push(t); } catch {} } }
    })();
    return false;
  }
  return d.end > 0 && now() >= d.end;
}
function botAct(t, i) {
  if (!t.cfg.llm || !llmEnabled()) return botActRule(t, i);
  const g = t.g; g.llmBusy ||= {};
  const key = `${t.phase}|${g.round}|${g.rejects}|${g.hist.length}`;
  if (g.llmBusy[i] === key) return false;                  // 這個人這一步已經在想了
  g.llmBusy[i] = key; push(t);
  (async () => {
    let done = false;
    try { const d = await llmDecide(t, i); done = llmApply(t, i, d); if (done && t.g === g && typeof d.say === "string") say(t, i, d.say); console.log(`阿瓦隆 AI ${pname(t, i)}（${g.roles[i]}）${t.phase}：${JSON.stringify(d).slice(0, 160)}${done ? "" : "（不合法，改用規則）"}`); } catch (e) { if (t.g === g) (g.tok ||= { calls: 0, fail: 0, in: 0, out: 0, by: {} }).fail++; console.log("阿瓦隆 LLM 失敗，改用規則：", e && e.message); }
    if (t.g !== g) return;                                  // 這局已經結束或重開
    if (!done && `${t.phase}|${g.round}|${g.rejects}|${g.hist.length}` === key) { try { done = botActRule(t, i); } catch {} }
    delete g.llmBusy[i];
    if (done) { try { setBot(t); push(t); } catch {} }
  })();
  return false;
}

// ---------------------------------------------------------------- 畫面資料
function view(t, ws) {
  const you = t.players.findIndex((p) => p.ws === ws && !ws.avspec), g = t.g;
  const v = { t: "avstate", phase: t.phase, started: t.started, cfg: t.cfg, you, log: t.log, now: now(), watchers: [...t.members].filter((w) => w.avspec).length, maxp: MAXP, minp: MINP, llmOk: llmEnabled(),
    players: t.players.map((p, i) => ({ i, name: p.name, bot: p.bot, away: !p.bot && !p.ws })) };
  if (g) {
    Object.assign(v, { n: g.n, leader: g.leader, round: g.round, rejects: g.rejects, results: g.results, fails: g.fails, sizes: QUEST[g.n], need2: g.n >= 7, team: g.team, goodN: GOOD_N[g.n] });
    const waiting = [];
    if (t.phase === "vote") v.voted = Object.keys(g.votes).map(Number);
    if (t.phase === "quest") v.qdone = Object.keys(g.qvotes).map(Number);
    if (t.phase === "voteres") v.voteRes = g.voteRes;
    if (t.phase === "questres") v.questRes = g.questRes;
    if (t.phase === "assassin") v.assassin = g.assassin;
    v.hist = g.hist; v.gid = g.gid; v.thinking = Object.keys(g.llmBusy || {}).map(Number); v.chat = g.chat.slice(-40); v.tok = g.tok ? { calls: g.tok.calls, fail: g.tok.fail, in: g.tok.in, out: g.tok.out } : null;
    v.roleList = [...g.roles].sort().map((r) => ROLE_NAME[r]);
    if (you >= 0) {
      const r = g.roles[you]; v.me = { role: r, roleName: ROLE_NAME[r], evil: isEvil(r), ...knowledge(t, you) };
      if (t.phase === "vote") v.myVote = g.votes[you];
      if (t.phase === "quest") v.myQ = g.qvotes[you];
    }
    if (t.phase === "end") { v.end = { winner: g.winner, why: g.why, roles: g.roles.map((r, i) => ({ i, name: pname(t, i), role: ROLE_NAME[r], evil: isEvil(r) })), target: g.target, tok: g.tok ? { ...g.tok, by: Object.entries(g.tok.by).map(([k, o]) => ({ name: pname(t, Number(k)), ...o })) } : null }; console.log(g.tok ? `阿瓦隆 AI 這局共 ${g.tok.calls} 次，輸入 ${g.tok.in}、輸出 ${g.tok.out} tokens，失敗 ${g.tok.fail} 次` : ""); }
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
      if (t.cfg.llm && llmEnabled() && ((t.phase === "team" && isAuto(t.players[g.leader])) || t.phase === "vote") && !discussStep(t)) continue;
      if (t.phase === "team") acted = isAuto(t.players[g.leader]) && botAct(t, g.leader);
      else if (t.phase === "vote") { if (t.cfg.llm) { for (let k = 0; k < g.n; k++) if (isAuto(t.players[k]) && g.votes[k] === undefined) botAct(t, k); } else { const i = t.players.findIndex((p, k) => isAuto(p) && g.votes[k] === undefined); if (i >= 0) acted = botAct(t, i); } }
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
  } else if (m.t === "avchat") {
    if (mine < 0 || !t.g || !t.started) return true;
    const now2 = Date.now(); if (now2 - (ws.avchatAt || 0) < 800) return true; ws.avchatAt = now2;
    say(t, mine, m.text); push(t);
  } else if (m.t === "avname") {
    const nm = cleanName(m.name); if (!nm) return true;
    ws.avname = nm; if (mine >= 0) t.players[mine].name = nm; push(t);
  } else if (m.t === "avcfg") {
    if (mine < 0 || t.started) return true;
    const n = Number(m.n); if (n >= MINP && n <= MAXP) t.cfg.n = n;
    for (const k of ["percival", "mordred", "oberon"]) if (typeof m[k] === "boolean") t.cfg[k] = m[k];
    if (typeof m.llm === "boolean") t.cfg.llm = m.llm && llmEnabled();
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
