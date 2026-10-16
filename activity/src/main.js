import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";
import { mountWordle } from "./wordle.js";
import { mountGomoku } from "./gomoku.js";

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
  { id: "wordle", icon: "🟩", name: "Wordle", desc: "單人猜字，6 次機會", mount: mountWordle },
  { id: "gomoku", icon: "⚫", name: "五子棋", desc: "兩人對戰，先連五子獲勝", mount: mountGomoku },
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
