import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";
import { mountGomoku } from "./gomoku.js";
import { mountConnect4 } from "./connect4.js";
import { mountReversi } from "./reversi.js";
import { mountSlots } from "./slots.js";
import { mountCasino } from "./casino.js";
import { mountSpectateLobby } from "./spectate.js";
import { mountDown } from "./stairs.js";

// 可選遊戲（檔案不存在就不顯示選單項目；這些檔案不放進公開 repo）
const optional = import.meta.glob(["./pikachu_online.js", "./lf2.js"], { eager: true });
const mountPikachuOnline = optional["./pikachu_online.js"]?.mountPikachuOnline;
const mountLf2 = optional["./lf2.js"]?.mountLf2;

// ---------- Discord SDK（在 Discord 裡才啟動；一般瀏覽器開也能玩）
const clientId = import.meta.env.VITE_CLIENT_ID;
const params = new URLSearchParams(location.search);
const inDiscord = params.has("frame_id");
let sdk = null;
export const env = { inDiscord, instanceId: params.get("instance_id") || params.get("room") || "local-test" };

if (inDiscord && clientId) {
  sdk = new DiscordSDK(clientId);
  env.instanceId = sdk.instanceId || env.instanceId; env.sdk = sdk; env.clientId = clientId; env.guildId = sdk.guildId;
  sdk.ready().catch(() => {});
}

const app = document.getElementById("app");

// cat：選單分類；players：人數標籤
const CATS = [
  { id: "board", icon: "♟️", name: "棋類", note: "雙人對戰，可以對賭代幣" },
  { id: "action", icon: "🎮", name: "動作・競技", note: "即時對戰／闖關" },
  { id: "casino", icon: "🎰", name: "賭場", note: "練習幣或真代幣，每個遊戲裡都有 📖 規則" },
];
const GAMES = [
  { id: "gomoku", cat: "board", icon: "⚫", name: "五子棋", players: "2 人", desc: "先連五子獲勝", mount: mountGomoku },
  { id: "c4", cat: "board", icon: "🔴", name: "四連棋", players: "2 人", desc: "棋子往下掉，先連四顆", mount: mountConnect4 },
  { id: "rv", cat: "board", icon: "⚪", name: "黑白棋", players: "2 人", desc: "夾住對方的棋就翻面", mount: mountReversi },
  { id: "down", cat: "action", icon: "🪜", name: "小朋友下樓梯", players: "1–4 人", desc: "往下踩樓梯別被刺扎到", mount: mountDown },
  { id: "pika2", cat: "action", icon: "⚡", name: "皮卡丘排球 2P", players: "2 人", desc: "連線對戰", mount: mountPikachuOnline },
  { id: "lf2", cat: "action", icon: "🥋", name: "小朋友齊打交", players: "最多 8 人", desc: "連線對戰／闖關", mount: mountLf2 },
  { id: "slots", cat: "casino", icon: "🎰", name: "老虎機", players: "1 人", desc: "3 格／3×3／4×4 拉霸", mount: mountSlots },
  { id: "bj", cat: "casino", icon: "🃏", name: "21 點", players: "1 人", desc: "跟莊家比點數，Blackjack 賠 2.5 倍", mount: mountCasino("bj") },
  { id: "horse", cat: "casino", icon: "🏇", name: "賽馬", players: "1 人", desc: "選馬看賠率，跑贏拿回賠率倍", mount: mountCasino("horse") },
  { id: "dice", cat: "casino", icon: "🎲", name: "骰子", players: "1 人", desc: "跟莊家比兩顆骰子點數", mount: mountCasino("dice") },
  { id: "coin", cat: "casino", icon: "🪙", name: "擲硬幣", players: "1 人", desc: "猜正反面，猜中翻倍", mount: mountCasino("coin") },
  { id: "spectate", cat: "casino", icon: "👀", name: "旁觀大廳", players: "不限", desc: "看有哪些房間在玩，按下去同步旁觀", mount: mountSpectateLobby },
].filter((g) => typeof g.mount === "function");

function showMenu() {
  const card = (g) => `<button class="card" data-g="${g.id}"><span class="icon">${g.icon}</span><b>${g.name}</b><em>${g.players}</em><small>${g.desc}</small></button>`;
  app.innerHTML = `
    <div class="menu">
      <h1>遊戲間</h1>
      ${CATS.map((c) => {
        const list = GAMES.filter((g) => g.cat === c.id);
        return list.length ? `<section class="cat"><h2>${c.icon} ${c.name}<small>${c.note}</small></h2><div class="cards">${list.map(card).join("")}</div></section>` : "";
      }).join("")}
    </div>`;
  app.querySelectorAll(".card").forEach((b) => {
    b.addEventListener("click", () => start(b.dataset.g));
  });
}

let cleanup = null;
function start(id) {
  const g = GAMES.find((x) => x.id === id);
  app.innerHTML = "";
  cleanup = g.mount(app, { env, back: () => { if (cleanup) cleanup(); cleanup = null; showMenu(); } }) || null;
}

showMenu();
