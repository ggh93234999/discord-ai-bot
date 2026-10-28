// 阿瓦隆（5～10 人，沒有計時）：身分、投票、任務、刺殺都在伺服器（server/avalon.js），這裡只畫畫面和送操作。
import { wsUrl } from "./gomoku.js";
import { attachRules } from "./rules.js";
import { roleArt } from "./avart.js";

const GOOD_N = { 5: 3, 6: 4, 7: 4, 8: 5, 9: 6, 10: 6 };
// 依人數和勾選的角色算出每種角色的數量（和伺服器 assignRoles 同一套規則）
function composition(n, c) {
  const goodN = GOOD_N[n], evilN = n - goodN, evil = ["刺客"];
  if (c.percival && evil.length < evilN) evil.push("莫甘娜");
  if (c.mordred && evil.length < evilN) evil.push("莫德雷德");
  if (c.oberon && evil.length < evilN) evil.push("奧伯倫");
  const good = ["梅林"];
  if (evil.includes("莫甘娜") && good.length < goodN) good.push("派西維爾");
  const cnt = (list, fill, total) => [...list, ...Array(total - list.length).fill(fill)].reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {});
  const fmt = (m) => Object.entries(m).map(([r, k]) => `${r}${k > 1 ? ` ×${k}` : ""}`).join("、");
  return { goodN, evilN, good: fmt(cnt(good, "亞瑟的忠臣", goodN)), evil: fmt(cnt(evil, "爪牙", evilN)) };
}
const ABIL = {
  "梅林": "好人。知道所有壞人是誰（莫德雷德除外）。要藏好，別被刺客認出來。",
  "派西維爾": "好人。看得到梅林和莫甘娜兩個人，但分不出誰是誰。",
  "亞瑟的忠臣": "好人。沒有特殊能力，靠討論和投票判斷。",
  "刺客": "壞人。好人完成 3 次任務後，可以刺殺一人，刺中梅林就反敗為勝。",
  "莫甘娜": "壞人。在派西維爾眼中和梅林一樣，會冒充梅林。",
  "莫德雷德": "壞人。梅林看不到他。",
  "奧伯倫": "壞人。不認識其他壞人，其他壞人也不認識他。",
  "爪牙": "壞人。知道同伴是誰（奧伯倫除外）。",
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function getPid() { try { let p = localStorage.getItem("avpid"); if (!p) { p = Math.random().toString(36).slice(2, 10); localStorage.setItem("avpid", p); } return p; } catch { return Math.random().toString(36).slice(2, 10); } }
const lsName = () => { try { return localStorage.getItem("pokername") || ""; } catch { return ""; } };

export function mountAvalon(opts = {}) {
  const spectate = opts.spectate || null;
  return function (root, { env, back }) {
    root.innerHTML = `
      <div class="game slots mj av">
        <header><button class="back">← 選單</button><h2>阿瓦隆</h2><span class="watch"></span></header>
        <div class="status">連線中…</div>
        <div class="avbody"></div>
        <div class="avlog"></div>
      </div>`;
    attachRules(root.querySelector(".game"), "avalon");
    const $ = (s) => root.querySelector(s);
    const statusEl = $(".status"), body = $(".avbody"), logEl = $(".avlog"), watchEl = $(".watch");
    let ws = null, closed = false, retry = 0, st = null, sel = new Set(), selKey = "", showRole = false;
    const pid = getPid();
    const room = spectate ? spectate.room : env.instanceId;
    const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    $(".back").addEventListener("click", () => { cleanup(); back(); });

    function connect() {
      ws = new WebSocket(wsUrl(env.inDiscord));
      ws.onopen = () => { retry = 0; send({ t: "avjoin", room, spectate: !!spectate, pid, name: lsName() }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "avstate") { st = m; render(); }
        else if (m.t === "averr") statusEl.textContent = m.error === "full" ? "座位滿了" : "這個操作現在不能做";
      };
      ws.onclose = () => { if (closed) return; statusEl.textContent = "連線中斷，重新連線…"; setTimeout(connect, Math.min(5000, 700 * ++retry)); };
      ws.onerror = () => {};
    }
    const nm = (i) => esc(st.players[i]?.name || "");
    const seated = () => st.you >= 0;
    const act = (o) => send({ t: "avact", ...o });

    function render() {
      watchEl.textContent = st.watchers ? `👀 ${st.watchers}` : "";
      logEl.textContent = st.log || "";
      if (st.phase === "wait") renderLobby(); else renderGame();
    }

    // ---------------- 大廳
    function renderLobby() {
      const me = seated(), c = st.cfg;
      const list = st.players.map((p) => `<div class="avp${p.i === st.you ? " me" : ""}"><b>${esc(p.name)}</b>${p.away ? "（離線）" : ""}${me && p.bot ? `<button class="mdel" data-del="${p.i}">✕</button>` : ""}</div>`).join("") || `<div class="mempty">還沒有人入座</div>`;
      let cfg = "";
      if (me && !spectate) {
        const chk = (k, label) => `<label><input type="checkbox" class="cf-${k}"${c[k] ? " checked" : ""}> ${label}</label>`;
        cfg = `<div class="mjcfg"><label>人數 <select class="cf-n">${[5, 6, 7, 8, 9, 10].map((v) => `<option value="${v}"${Math.max(c.n, st.players.length) === v ? " selected" : ""}>${v} 人</option>`).join("")}</select></label>
          ${chk("percival", "派西維爾＋莫甘娜")}${chk("mordred", "莫德雷德")}${chk("oberon", "奧伯倫")}${st.llmOk ? chk("llm", "電腦用 AI 思考（較慢）") : ""}</div>
          <div class="btbtns"><button class="mb ghost addbot"${st.players.length >= st.maxp ? " disabled" : ""}>＋電腦</button><button class="mb start">▶ 開始（不足人數由電腦補）</button></div>`;
      } else if (!spectate) cfg = `<div class="mempty">點「入座」加入，5～10 人，不夠的人數由電腦補。</div>`;
      const total = Math.max(c.n, st.players.length), cp = composition(total, c);
      const comp = `<div class="avcomp"><b>${total} 人局</b>：<span class="g">好人 ${cp.goodN} 人（${cp.good}）</span><span class="e">壞人 ${cp.evilN} 人（${cp.evil}）</span></div>`;
      const names = (str) => str.split("、").map((x) => x.replace(/ ×\d+$/, ""));
      const row = (r, cls) => `<div class="avab ${cls}">${roleArt(r) ? `<img class="avmini" src="${roleArt(r)}" alt="">` : ""}<div><b>${r}</b> ${ABIL[r] || ""}</div></div>`;
      const ab = `<div class="avabil">${names(cp.good).map((r) => row(r, "g")).join("")}${names(cp.evil).map((r) => row(r, "e")).join("")}${[["mordred", "莫德雷德"], ["oberon", "奧伯倫"]].filter(([k, r]) => c[k] && !cp.evil.includes(r)).map(([, r]) => `<div class="avab off"><b>${r}</b>此人數壞人名額不足，這局不會出現。</div>`).join("")}</div>`;
      body.innerHTML = `<div class="avlobby"><div class="avplist">${list}</div>${comp}${ab}${!me && !spectate ? `<button class="mb sit">入座</button>` : ""}${cfg}<small>沒有計時：每個公開的畫面（投票結果、任務結果）都要有人按「下一步」才會繼續。身分只有自己看得到。</small>${me && !spectate ? `<button class="mb ghost stand">離座</button>` : ""}</div>`;
      statusEl.textContent = spectate ? "👀 旁觀中，等開局" : `等開局（${st.players.length} 人入座）`;
      const q = (s) => body.querySelector(s);
      q(".sit") && q(".sit").addEventListener("click", () => send({ t: "avsit" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "avstand" }));
      q(".addbot") && q(".addbot").addEventListener("click", () => send({ t: "avaddbot" }));
      q(".start") && q(".start").addEventListener("click", () => send({ t: "avstart" }));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => send({ t: "avdelbot", seat: Number(b.dataset.del) })));
      const sendCfg = () => send({ t: "avcfg", n: Number(q(".cf-n").value), percival: q(".cf-percival").checked, mordred: q(".cf-mordred").checked, oberon: q(".cf-oberon").checked, llm: q(".cf-llm") ? q(".cf-llm").checked : false });
      ["n", "percival", "mordred", "oberon", "llm"].forEach((k) => q(".cf-" + k) && q(".cf-" + k).addEventListener("change", sendCfg));
    }

    // ---------------- 遊戲中
    function track() {
      const dots = st.sizes.map((sz, r) => {
        const res = st.results[r], cur = r === st.round && st.phase !== "end";
        return `<div class="avq${res === "s" ? " ok" : res === "f" ? " bad" : ""}${cur ? " cur" : ""}"><b>${res === "s" ? "✔" : res === "f" ? "✘" : sz}</b>${st.need2 && r === 3 ? `<i>要 2 張失敗</i>` : `<i>${sz} 人</i>`}</div>`;
      }).join("");
      const rej = Array.from({ length: 5 }, (_, k) => `<span class="avrj${k < st.rejects ? " on" : ""}"></span>`).join("");
      return `<div class="avtrack">${dots}</div><div class="avrej">連續否決 ${rej}（滿 5 次壞人贏）</div>`;
    }
    function players(opts2 = {}) {
      const { pickable, voteRes } = opts2;
      return `<div class="avgrid">${st.players.map((p) => {
        const nt = loadNote();
        const inTeam = st.team.includes(p.i), chosen = sel.has(p.i);
        const voted = st.voted && st.voted.includes(p.i), qd = st.qdone && st.qdone.includes(p.i);
        const vr = voteRes ? voteRes.votes[p.i] : undefined;
        return `<div class="avpl${p.i === st.you ? " me" : ""}${p.i === st.leader ? " leader" : ""}${inTeam && st.phase !== "team" ? " inteam" : ""}${chosen ? " chosen" : ""}${pickable ? " pick" : ""}" data-i="${p.i}">
          <div>${p.i === st.leader ? "👑 " : ""}<b>${esc(p.name)}</b>${p.away ? "（離線）" : ""}</div>
          <button class="avmk${nt.marks[p.i] ? " on m" + nt.marks[p.i] : ""}" data-i="${p.i}" title="點一下換標記（只有你看得到）">${MK[nt.marks[p.i] || 0] || "🏷 標記"}</button>
          <div class="avtag">${vr !== undefined ? (vr ? "👍 贊成" : "👎 反對") : voted ? "已投票" : qd ? "已出牌" : inTeam && st.phase !== "team" ? "任務隊員" : chosen ? "已選" : ""}</div></div>`;
      }).join("")}</div>`;
    }
    function roleCard() {
      if (!st.me || spectate) return "";
      const m = st.me;
      const known = m.names.length ? `<div>${esc(m.text)} <b>${m.names.map(esc).join("、")}</b></div>` : `<div>${esc(m.text)}</div>`;
      return `<div class="avrole${m.evil ? " evil" : ""}"><button class="mb ghost avshow">${showRole ? "🙈 藏起來" : "👁 看我的身分"}</button>${showRole ? `<div class="avrc">${roleArt(m.roleName) ? `<img class="avpor" src="${roleArt(m.roleName)}" alt="">` : ""}<h3>${esc(m.roleName)}（${m.evil ? "壞人" : "好人"}）</h3>${known}</div>` : ""}</div>`;
    }
    function panel() {
      const me = st.you, lead = st.leader === me, ph = st.phase, k = st.sizes[st.round];
      const nextBtn = seated() ? `<button class="mb avnext">下一步 ▶</button>` : "";
      if (ph === "team") {
        if (!seated()) return `<div class="mhint">${nm(st.leader)} 選隊伍中…</div>`;
        return lead ? `<div class="mhint">你是隊長：點玩家選出 ${k} 人（可以選自己），再按提出隊伍。已選 ${sel.size}/${k}</div><button class="mb avprop"${sel.size === k ? "" : " disabled"}>提出隊伍</button>` : `<div class="mhint">等 ${nm(st.leader)} 選出 ${k} 人的隊伍…</div>`;
      }
      if (ph === "vote") {
        const mine = st.myVote;
        if (!seated()) return `<div class="mhint">投票中（${st.voted.length}/${st.n}）</div>`;
        return mine === undefined ? `<div class="mhint">要不要讓這支隊伍出任務？（過半贊成才通過）</div><div class="btbtns"><button class="mb avv yes" data-ok="1">👍 贊成</button><button class="mb avv no" data-ok="0">👎 反對</button></div>` : `<div class="mhint">你投了${mine ? "贊成" : "反對"}，等其他人（${st.voted.length}/${st.n}）…</div>`;
      }
      if (ph === "voteres") return `<div class="avres ${st.voteRes.pass ? "ok" : "bad"}">${st.voteRes.pass ? "隊伍通過" : "隊伍被否決"}　👍 ${st.voteRes.yes}　👎 ${st.voteRes.no}</div>${nextBtn}`;
      if (ph === "quest") {
        const inT = st.team.includes(me);
        if (!inT || !seated()) return `<div class="mhint">任務隊員選擇中（${st.qdone.length}/${st.team.length}）…</div>`;
        if (st.myQ !== undefined) return `<div class="mhint">你已經出牌，等其他隊員（${st.qdone.length}/${st.team.length}）…</div>`;
        return `<div class="mhint">你是任務隊員：選成功或失敗（好人只能選成功）</div><div class="btbtns"><button class="mb avq-ok yes" data-ok="1">✔ 成功</button><button class="mb avq-ok no" data-ok="0"${st.me.evil ? "" : " disabled"}>✘ 失敗</button></div>`;
      }
      if (ph === "questres") { const r = st.questRes; return `<div class="avres ${r.success ? "ok" : "bad"}">第 ${r.round + 1} 次任務${r.success ? "成功" : "失敗"}（${r.fails} 張失敗票）</div>${nextBtn}`; }
      if (ph === "assassin") {
        if (st.you === st.assassin) return `<div class="mhint">好人完成 3 次任務！你是刺客：點出你認為的梅林，按「刺殺」。</div><button class="mb avkill"${sel.size === 1 ? "" : " disabled"}>🗡 刺殺</button>`;
        return `<div class="mhint">刺客 ${nm(st.assassin)} 正在決定刺殺誰…</div>`;
      }
      return "";
    }
    function endHTML() {
      const e = st.end;
      const rows = e.roles.map((r) => `<div class="avrow ${r.evil ? "evil" : "good"}${r.i === e.target ? " hit" : ""}">${roleArt(r.role) ? `<img class="avmini" src="${roleArt(r.role)}" alt="">` : ""}<b>${esc(r.name)}</b><span>${esc(r.role)}${r.i === e.target ? "（被刺殺）" : ""}</span></div>`).join("");
      return `<div class="mresult avend ${e.winner === "good" ? "ok" : "bad"}"><h3>${e.winner === "good" ? "好人獲勝！" : "壞人獲勝！"}</h3><div>${esc(e.why)}</div><div class="avroles">${rows}</div>${tokHTML(e.tok, true)}${seated() ? `<div class="btbtns"><button class="mb avagain">再來一場</button><button class="mb ghost avlobby">回大廳</button></div>` : ""}</div>`;
    }
    const tokHTML = (k, full) => !k ? "" : `<small class="avtok">🤖 AI 用量：${k.calls} 次思考　輸入 ${k.in.toLocaleString()}　輸出 ${k.out.toLocaleString()}　共 ${(k.in + k.out).toLocaleString()} tokens${k.fail ? `　（失敗 ${k.fail} 次改用規則）` : ""}${full && k.by && k.by.length ? "<br>" + k.by.map((b) => `${esc(b.name)} ${b.calls} 次 ${(b.in + b.out).toLocaleString()}`).join("　") : ""}</small>`;
    let histOpen = false, pendG = false;
    // 私人筆記：只存在自己的瀏覽器，別人和伺服器都看不到（每一局各自一份）
    const MK = ["", "✅ 好人", "❌ 壞人", "❓ 可疑", "🧙 梅林?"];
    const noteKey = () => "avnote:" + (st.gid || "x");
    const loadNote = () => { try { const o = JSON.parse(localStorage.getItem(noteKey()) || "{}"); return { marks: o.marks || {}, text: o.text || "" }; } catch { return { marks: {}, text: "" }; } };
    const saveNote = (o) => { try { localStorage.setItem(noteKey(), JSON.stringify(o)); } catch {} };
    function noteHTML() {
      const n = loadNote();
      return `<details class="avnote"${n.text ? " open" : ""}><summary>📝 我的筆記（只有你看得到）</summary><textarea class="avnote-ta" maxlength="600" placeholder="例如：第 2 次小明投反對，可能是壞人…">${esc(n.text)}</textarea></details>`;
    }
    function rosterHTML() {
      const EV = new Set(["刺客", "莫甘娜", "莫德雷德", "奧伯倫", "莫德雷德的爪牙"]);
      const cnt = (arr) => Object.entries(arr.reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {})).map(([r, k]) => `${esc(r)}${k > 1 ? ` ×${k}` : ""}`).join("、");
      const g = st.roleList.filter((r) => !EV.has(r)), e = st.roleList.filter((r) => EV.has(r));
      return `<div class="avcomp avroster2"><span class="g">好人 ${g.length} 人：${cnt(g)}</span><span class="e">壞人 ${e.length} 人：${cnt(e)}</span></div>`;
    }
    function histHTML() {
      const h = st.hist || []; if (!h.length) return "";
      const nm = (i) => esc(st.players[i]?.name || "?");
      const chips = (arr, cls) => arr.length ? arr.map((i) => `<span class="avchip ${cls || ""}">${nm(i)}</span>`).join("") : `<span class="avnone">無</span>`;
      const rounds = [...new Set(h.map((e) => e.round))].reverse();
      const body = rounds.map((r) => {
        const es = h.filter((e) => e.round === r), qr = es.find((e) => e.q)?.q;
        const head = `<div class="avrh">第 ${r + 1} 次任務${qr ? `<span class="${qr.success ? "ok" : "bad"}">${qr.success ? "成功" : "失敗"}（${qr.fails} 張失敗票）</span>` : `<span class="pend">進行中</span>`}</div>`;
        const cards = es.slice().reverse().map((e) => {
          const yes = [], no = []; e.votes.forEach((v, i) => (v ? yes : no).push(i));
          return `<div class="avh ${e.pass ? "ok" : "bad"}"><div class="avht"><b>第 ${e.no} 次提案</b><em>${e.pass ? "✅ 通過" : "❌ 否決"}（${yes.length}：${no.length}）</em></div>
            <div class="avhr"><span>隊長</span><div>${chips([e.leader], "ld")}</div></div>
            <div class="avhr"><span>隊伍</span><div>${chips(e.team, "tm")}</div></div>
            <div class="avhr"><span>👍 贊成</span><div>${chips(yes, "y")}</div></div>
            <div class="avhr"><span>👎 反對</span><div>${chips(no, "n")}</div></div></div>`;
        }).join("");
        return `<div class="avround">${head}${cards}</div>`;
      }).join("");
      return `<details class="avhist"${histOpen ? " open" : ""}><summary>📜 投票紀錄（${h.length} 次提案）</summary>${body}</details>`;
    }
    function chatHTML() {
      const ch = st.chat || []; if (!ch.length && !seated()) return "";
      const rows = ch.map((c) => `<div class="avcl${c.i === st.you ? " me" : ""}"><b>${esc(c.name)}</b>${esc(c.text)}</div>`).join("") || `<div class="avnone">還沒有人說話</div>`;
      return `<div class="avchat"><div class="avchl">${rows}</div>${seated() && !spectate ? `<div class="avchi"><input class="avchat-in" maxlength="60" placeholder="跟大家說句話…"><button class="mb avchat-go">送出</button></div>` : ""}</div>`;
    }
    function renderGame() {
      const ae = document.activeElement, keepChat = ae && ae.classList && ae.classList.contains("avchat-in") ? { v: ae.value, s: ae.selectionStart } : null;
      if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("avnote-ta")) { pendG = true; return; }
      const key = st.phase + "|" + st.round + "|" + st.leader + "|" + st.rejects;
      if (key !== selKey) { selKey = key; sel = new Set(); }
      const pickable = (st.phase === "team" && st.leader === st.you) || (st.phase === "assassin" && st.you === st.assassin);
      const vres = st.phase === "voteres" ? st.voteRes : null;
      body.innerHTML = `${track()}${st.phase === "end" ? "" : players({ pickable, voteRes: vres })}${st.phase === "end" ? endHTML() : panel()}${st.thinking && st.thinking.length && st.phase !== "end" ? `<div class="mhint avthink">🤖 AI 思考中：${st.thinking.map((k) => esc(st.players[k]?.name || "")).join("、")}…</div>` : ""}${chatHTML()}${st.phase !== "end" ? tokHTML(st.tok) : ""}${roleCard()}${noteHTML()}${histHTML()}${rosterHTML()}${seated() && st.phase !== "end" && !spectate ? `<div class="mfoot"><button class="mb ghost stand">離座（電腦接手）</button></div>` : ""}${!seated() && !spectate && st.phase !== "end" ? `<div class="mhint">想加入？可以接手電腦：${st.players.map((p) => (p.bot ? `<button class="mb ghost" data-sit="${p.i}">接手 ${esc(p.name)}</button>` : "")).join("")}</div>` : ""}`;
      statusEl.textContent = st.phase === "end" ? "阿瓦隆　結束" : `阿瓦隆　第 ${st.round + 1} 次任務　隊長 ${st.players[st.leader]?.name || ""}`;
      const hd = body.querySelector(".avhist"); if (hd) hd.addEventListener("toggle", () => { histOpen = hd.open; });
      body.querySelectorAll(".avmk").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const n = loadNote(), i = Number(b.dataset.i); n.marks[i] = ((n.marks[i] || 0) + 1) % MK.length; if (!n.marks[i]) delete n.marks[i]; saveNote(n); renderGame(); }));
      const cl = body.querySelector(".avchl"); if (cl) cl.scrollTop = cl.scrollHeight;
      const ci = body.querySelector(".avchat-in"), cg = body.querySelector(".avchat-go");
      if (ci && keepChat) { ci.value = keepChat.v; ci.focus(); try { ci.setSelectionRange(keepChat.s, keepChat.s); } catch {} }
      const sendChat = () => { const v = ci.value.trim(); if (v) { send({ t: "avchat", text: v }); ci.value = ""; } };
      if (cg) cg.addEventListener("click", sendChat);
      if (ci) { ci.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } }); }
      const ta = body.querySelector(".avnote-ta"); if (ta) {
        ta.addEventListener("input", () => { const n = loadNote(); n.text = ta.value; saveNote(n); });
        ta.addEventListener("blur", () => { if (pendG) { pendG = false; renderGame(); } });
      }
      const q = (s) => body.querySelector(s);
      if (pickable) body.querySelectorAll(".avpl.pick").forEach((el) => el.addEventListener("click", () => {
        const i = Number(el.dataset.i);
        if (st.phase === "assassin") { sel = new Set([i]); } else if (sel.has(i)) sel.delete(i); else if (sel.size < st.sizes[st.round]) sel.add(i);
        renderGame();
      }));
      q(".avprop") && q(".avprop").addEventListener("click", () => act({ a: "team", ids: [...sel] }));
      q(".avkill") && q(".avkill").addEventListener("click", () => act({ a: "kill", target: [...sel][0] }));
      body.querySelectorAll(".avv").forEach((b) => b.addEventListener("click", () => act({ a: "vote", ok: b.dataset.ok === "1" })));
      body.querySelectorAll(".avq-ok").forEach((b) => b.addEventListener("click", () => act({ a: "quest", ok: b.dataset.ok === "1" })));
      q(".avnext") && q(".avnext").addEventListener("click", () => act({ a: "next" }));
      q(".avshow") && q(".avshow").addEventListener("click", () => { showRole = !showRole; renderGame(); });
      q(".avagain") && q(".avagain").addEventListener("click", () => send({ t: "avstart" }));
      q(".avlobby") && q(".avlobby").addEventListener("click", () => send({ t: "avlobby" }));
      q(".stand") && q(".stand").addEventListener("click", () => send({ t: "avstand" }));
      body.querySelectorAll("[data-sit]").forEach((el) => el.addEventListener("click", () => send({ t: "avsit", seat: Number(el.dataset.sit) })));
    }
    function cleanup() { closed = true; try { ws && ws.close(); } catch {} }
    connect();
    return cleanup;
  };
}
