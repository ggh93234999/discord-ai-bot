import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";
import { mountGomoku } from "./gomoku.js";
import { mountConnect4 } from "./connect4.js";
import { mountPikachu } from "./pikachu.js";
import { mountPikachuOnline } from "./pikachu_online.js";
import { mountSlots } from "./slots.js";

// ---------- Discord SDK（在 Discord 裡才啟動；一般瀏覽器開也能玩）
const clientId = import.meta.env.VITE_CLIENT_ID;
const params = new URLSearchParams(location.search);
const inDiscord = params.has("frame_id");
let sdk = null;
export const env = { inDiscord, instanceId: params.get("instance_id") || params.get("room") || "local-test" };

if (inDiscord && clientId) {
  sdk = new DiscordSDK(clientId);
  env.instanceId = sdk.instanceId || env.instanceId;
  sdk.ready().catch(() => {});
}

const app = document.getElementById("app");

const GAMES = [
  { id: "gomoku", icon: "⚫", name: "五子棋", desc: "兩人對戰，先連五子獲勝", mount: mountGomoku },
  { id: "c4", icon: "🔴", name: "四連棋", desc: "兩人對戰，棋子往下掉，先連四顆獲勝", mount: mountConnect4 },
  { id: "pika", icon: "⚡", name: "皮卡丘排球", desc: "單人對電腦，經典 1997 排球", mount: mountPikachu },
  { id: "slots", icon: "🎰", name: "老虎機", desc: "轉輪拉霸，練習模式隨便玩", mount: mountSlots },
  { id: "pika2", icon: "⚡", name: "皮卡丘排球 2P", desc: "兩人連線對戰，伺服器運算", mount: mountPikachuOnline },
];

function showMenu() {
  app.innerHTML = `
    <div class="menu">
      <h1>遊戲間</h1>
      <div class="cards">
        ${GAMES.map((g) => `<button class="card" data-g="${g.id}"><span class="icon">${g.icon}</span><b>${g.name}</b><small>${g.desc}</small></button>`).join("")}
      </div>
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
