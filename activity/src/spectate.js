// 旁觀大廳：列出現在有人在玩的賭場房間（所有 Activity 都看得到），按一下就進去同步旁觀。
import { wsUrl } from "./gomoku.js";
import { mountPoker } from "./poker.js";
import { mountCasino } from "./casino.js";

const GAMES = { slots: ["🎰", "老虎機"], coin: ["🪙", "擲硬幣"], dice: ["🎲", "骰子"], bj: ["🃏", "21 點"], horse: ["🏇", "賽馬"], poker: ["♠️", "德州撲克"] };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PHASE = { bet: "下注中", run: "比賽中", result: "公布結果" };

export function mountSpectateLobby(root, { env, back }) {
  let ws = null, closed = false, retry = 0, timer = 0, inner = null, rooms = [], skew = 0;

  function showLobby() {
    root.innerHTML = `
      <div class="game slots spectlobby">
        <header><button class="back">← 選單</button><h2>👀 旁觀大廳</h2><span></span></header>
        <div class="hint">現在有人在玩的賭場房間。按一下就能進去同步看（只能看，不能下注）。</div>
        <div class="roomlist"></div>
      </div>`;
    root.querySelector(".back").addEventListener("click", () => { destroy(); back(); });
    render();
  }
  function render() {
    const box = root.querySelector(".roomlist"); if (!box) return;
    if (!rooms.length) { box.innerHTML = `<div class="mempty">目前沒有人在玩。有人開始玩老虎機、21 點、賽馬等遊戲時，房間會出現在這裡。</div>`; return; }
    box.innerHTML = rooms.map((r, i) => {
      const [icon, name] = GAMES[r.game] || ["🎲", r.game];
      const mine = r.id === env.instanceId ? "<span class='tagmine'>你的房間</span>" : "";
      const extra = r.horse ? `<span class="tag">${PHASE[r.horse.phase] || ""}${r.horse.bets ? `・${r.horse.bets} 注` : ""}</span>` : "";
      return `<button class="roomcard" data-i="${i}"><div class="rtop"><b>${icon} ${name}</b>${mine}${extra}<em>${r.players.length} 人玩${r.watchers ? `・${r.watchers} 人看` : ""}</em></div>
        <div class="rplayers">${r.players.map((p) => `<span>${p.real ? "💰" : "🎮"} ${esc(p.name)}${p.playing ? " ✋" : ""}</span>`).join("")}</div></button>`;
    }).join("");
    box.querySelectorAll(".roomcard").forEach((b) => b.addEventListener("click", () => enter(rooms[Number(b.dataset.i)])));
  }
  function enter(r) {
    clearInterval(timer); try { ws.close(); } catch {}
    ws = null;
    root.innerHTML = "";
    inner = (r.game === "poker" ? mountPoker({ spectate: { room: r.id } }) : mountCasino(r.game, { spectate: { room: r.id } }))(root, { env, back: () => { if (inner) inner(); inner = null; connect(); showLobby(); } });
  }

  function connect() {
    ws = new WebSocket(wsUrl(env.inDiscord));
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "clist" })); clearInterval(timer); timer = setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "clist" })); }, 2500); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "clist") { rooms = m.rooms; render(); } };
    ws.onclose = () => { clearInterval(timer); if (!closed && !inner) setTimeout(connect, Math.min(5000, 700 * ++retry)); };
    ws.onerror = () => {};
  }
  function destroy() { closed = true; clearInterval(timer); if (inner) inner(); try { ws && ws.close(); } catch {} }
  showLobby(); connect();
  return destroy;
}
