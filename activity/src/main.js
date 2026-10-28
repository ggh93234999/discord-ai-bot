import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./sfx.js";
import "./fx.js";
import "./style.css";
import { mountGomoku, wsUrl } from "./gomoku.js";
import { mountConnect4 } from "./connect4.js";
import { mountReversi } from "./reversi.js";
import { mountSlots } from "./slots.js";
import { mountCasino } from "./casino.js";
import { mountBoard } from "./chessui.js";
import { mountPinball } from "./pinball.js";
import { mountFactory } from "./factory.js";
import { mountPoker } from "./poker.js";
import { mountMahjong } from "./mahjong.js";
import { mountBridge } from "./bridge.js";
import { mountBigtwo } from "./bigtwo.js";
import { mountAvalon } from "./avalon.js";
import { mountTheater } from "./theater.js";
import { mountSpectateLobby } from "./spectate.js";
import { mountLolBet } from "../lolbet/client.js";
import { mountForgeBoard } from "./forgeboard.js";
import { mountDown } from "./stairs.js";
import { mountFarm } from "./farm.js";
import { mountGallery } from "./gallery.js";
import { iconHtml } from "./iconart.js";
import "./gamebg.css";

// 可選遊戲（檔案不存在就不顯示選單項目；這些檔案不放進公開 repo）
const optional = import.meta.glob(["./pikachu_online.js", "./lf2.js"], { eager: true });
const mountPikachuOnline = optional["./pikachu_online.js"]?.mountPikachuOnline;
const mountLf2 = optional["./lf2.js"]?.mountLf2;

// ---------- Discord SDK（在 Discord 裡才啟動；一般瀏覽器開也能玩）
const clientId = import.meta.env.VITE_CLIENT_ID;
const params = new URLSearchParams(location.search);
const inDiscord = params.has("frame_id");
// 手機版 Discord 會在 Activity 最上面蓋一條「大笨bot／退出」的列，會把「← 選單」擋住：手機上的 Discord 內多留一段頂端空間（?dcm=1 可以在一般瀏覽器測試）
if ((inDiscord && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) || params.has("dcm")) document.documentElement.classList.add("dcm");
let sdk = null;
export const env = { inDiscord, instanceId: params.get("instance_id") || params.get("room") || "local-test" };

if (inDiscord && clientId) {
  sdk = new DiscordSDK(clientId);
  env.instanceId = sdk.instanceId || env.instanceId; env.sdk = sdk; env.clientId = clientId; env.guildId = sdk.guildId;
  sdk.ready().catch(() => {});
}

const app = document.getElementById("app");

// 回報「我現在在玩哪個遊戲」（給大笨bot 回答「大家在玩什麼」；只傳伺服器 id、遊戲代號和名稱）
let presWs = null, presGame = "menu", presTimer = 0;
function presSend() {
  if (!presWs || presWs.readyState !== 1) return;
  let name = ""; try { name = localStorage.getItem("pokername") || ""; } catch {}
  if (env.session && !presWs._auth) { presWs._auth = true; presWs.send(JSON.stringify({ t: "bauth", token: env.session.token })); }
  presWs.send(JSON.stringify({ t: "hpres", gid: env.guildId || "", game: presGame, name }));
}
function presConnect() {
  try {
    presWs = new WebSocket(wsUrl(env.inDiscord));
    presWs.onopen = presSend;
    presWs.onclose = () => { presWs = null; clearTimeout(presTimer); presTimer = setTimeout(presConnect, 5000); };
    presWs.onerror = () => {};
  } catch {}
}
function presence(game) { presGame = game; presSend(); }
presConnect();
setInterval(() => presSend(), 60000);

// cat：選單分類；players：人數標籤
const CATS = [
  { id: "life", icon: "🌱", name: "經營", note: "獨立玩法：種菜、鍛造，賺代幣" },
  { id: "casino", icon: "🎰", name: "賭場", note: "1 人對莊，練習幣或真代幣，每個遊戲裡都有 📖 規則" },
  { id: "table", icon: "🀄", name: "牌桌", note: "多人牌類與桌遊，可加電腦補位" },
  { id: "board", icon: "♟️", name: "棋類", note: "雙人對戰，可以對賭代幣" },
  { id: "action", icon: "🎮", name: "動作", note: "即時對戰／闖關" },
  { id: "media", icon: "🎬", name: "影音創作", note: "一起看影片、AI 畫圖" },
];
const GAMES = [
  { id: "gomoku", cat: "board", icon: "⚫", name: "五子棋", players: "2 人", desc: "先連五子獲勝", mount: mountGomoku },
  { id: "c4", cat: "board", icon: "🔴", name: "四連棋", players: "2 人", desc: "棋子往下掉，先連四顆", mount: mountConnect4 },
  { id: "rv", cat: "board", icon: "⚪", name: "黑白棋", players: "2 人", desc: "夾住對方的棋就翻面", mount: mountReversi },
  { id: "chess", cat: "board", icon: "♞", name: "西洋棋", players: "2 人", desc: "完整規則：王車易位、吃過路兵、升變", mount: mountBoard("chess") },
  { id: "xq", cat: "board", icon: "帥", name: "象棋", players: "2 人", desc: "楚河漢界，將死或困斃對方", mount: mountBoard("xq") },
  { id: "down", cat: "action", icon: "🪜", name: "小朋友下樓梯", players: "1–4 人", desc: "往下踩樓梯別被刺扎到", mount: mountDown },
  { id: "pinball", cat: "action", icon: "🎱", name: "彈珠台", players: "1 人", desc: "左右擋板接球，撞彈跳器拿分，3 顆球", mount: mountPinball },
  { id: "pika2", cat: "action", icon: "⚡", name: "皮卡丘排球 2P", players: "2 人", desc: "連線對戰", mount: mountPikachuOnline },
  { id: "lf2", cat: "action", icon: "🥋", name: "小朋友齊打交", players: "最多 8 人", desc: "連線對戰／闖關", mount: mountLf2 },
  { id: "lolbet", cat: "casino", wide: true, cls: "lolcard", icon: "🏆", name: "世界賽運彩", players: "全服共用", desc: "英雄聯盟世界賽單場勝負，賠率同步真實盤口", mount: mountLolBet },
  { id: "slots", cat: "casino", icon: "🎰", name: "老虎機", players: "1 人", desc: "3 格／3×3／4×4 拉霸", mount: mountSlots },
  { id: "poker", cat: "table", icon: "♠️", name: "德州撲克", players: "2–6 人", desc: "練習籌碼，可加電腦玩家，其他人可旁觀", mount: mountPoker() },
  { id: "mjtw", cat: "table", icon: "🀄", name: "台灣麻將", players: "4 人（可補電腦）", desc: "16 張、花牌、台數計分，練習點數", mount: mountMahjong("tw") },
  { id: "mjjp", cat: "table", icon: "🀅", name: "日本麻將", players: "4 人（可補電腦）", desc: "立直、寶牌、役與符翻計分，練習點數", mount: mountMahjong("jp") },
  { id: "bridge", cat: "table", icon: "🂡", name: "橋牌", players: "4 人（可補電腦）", desc: "台灣簡易橋牌：叫王、吃墩，兩人一隊，練習點數", mount: mountBridge() },
  { id: "bigtwo", cat: "table", icon: "🂮", name: "大老二", players: "4 人（可補電腦）", desc: "台灣玩法：單張、對子、順子、葫蘆、鐵支、同花順和一條龍，先出完的贏，練習點數", mount: mountBigtwo() },
  { id: "avalon", cat: "table", icon: "🗡️", name: "阿瓦隆", players: "5–10 人（可補電腦）", desc: "好人與壞人的推理：組隊、投票、出任務，沒有計時，按「下一步」才繼續", mount: mountAvalon() },
  { id: "stone", cat: "casino", icon: "💎", name: "賭石", players: "1 人", desc: "買整顆原石、一塊塊切開看裡面，每塊各自賣給收購商", mount: mountCasino("stone") },
  { id: "bj", cat: "casino", icon: "🃏", name: "21 點", players: "1 人", desc: "跟莊家比點數，Blackjack 賠 2.5 倍", mount: mountCasino("bj") },
  { id: "theater", cat: "media", wide: true, icon: "📺", name: "一起看影片", players: "不限", desc: "貼 YouTube 連結或打關鍵字，房間裡的人同步播放、暫停、拖進度", mount: mountTheater() },
  { id: "gallery", cat: "media", wide: true, icon: "🎨", name: "圖創區", players: "不限（每個伺服器一份）", desc: "用 AI 畫圖、分類收藏，也能請大笨bot畫；圖只放在這個頁面，不會傳到 Discord", mount: mountGallery },
  { id: "farm", cat: "life", wide: true, icon: "🌱", name: "種菜", players: "1 人（可拜訪）", desc: "作物照真實時間長大，收成賣代幣；成熟的菜 5 分鐘後朋友可以來偷", mount: mountFarm },
  { id: "forge", cat: "life", wide: true, icon: "⚒️", name: "鍛造", players: "1 人", desc: "每階付鍛造費，可能劍碎；賣劍拿錢，共 100 階", mount: mountCasino("forge") },
  { id: "factory", cat: "life", wide: true, cls: "factorycard", icon: "🏭", name: "自動化工廠", players: "1 人", desc: "挖礦、熔鍊、組裝，用傳送帶把產品送去出貨口換錢（原型）", mount: mountFactory },
  { id: "forgeboard", cat: "life", icon: "🏆", name: "神兵榜", players: "不限", desc: "全服最高階的劍排行，看誰的劍最強", mount: mountForgeBoard },
  { id: "horse", cat: "casino", icon: "🏇", name: "賽馬", players: "全服共用", desc: "選馬看賠率，跑贏拿回賠率倍", mount: mountCasino("horse") },
  { id: "dice", cat: "casino", icon: "🎲", name: "骰子", players: "1 人", desc: "跟莊家比兩顆骰子點數", mount: mountCasino("dice") },
  { id: "coin", cat: "casino", icon: "🪙", name: "擲硬幣", players: "1 人", desc: "猜正反面，猜中翻倍", mount: mountCasino("coin") },
  { id: "spectate", cat: "casino", icon: "👀", name: "旁觀大廳", players: "不限", desc: "看有哪些房間在玩，按下去同步旁觀", mount: mountSpectateLobby },
].filter((g) => typeof g.mount === "function");

function showMenu() {
  presence("menu"); delete document.body.dataset.game;
  const card = (g) => `<button class="card${g.wide ? " wide" : ""}${g.cls ? " " + g.cls : ""}" data-g="${g.id}"><span class="icon">${iconHtml(g.id, g.icon, g.name)}</span><b>${g.name}</b><em>${g.players}</em><small>${g.desc}</small></button>`;
  const tabs = CATS.filter((c) => GAMES.some((g) => g.cat === c.id));
  let tab = ""; try { tab = localStorage.getItem("menutab") || ""; } catch {}
  if (!tabs.some((c) => c.id === tab)) tab = tabs[0].id;
  const cur = tabs.find((c) => c.id === tab);
  app.innerHTML = `
    <div class="menu">
      <h1>遊戲間</h1>
      <div class="namebar"><label>👤 你的名稱 <input class="gname" maxlength="12" placeholder="輸入名稱，所有遊戲通用"></label><small>沒填的話，有登入就用你的 Discord 名稱，否則自動編號</small></div>
      <nav class="mtabs">${tabs.map((c) => `<button class="mtab${c.id === tab ? " on" : ""}" data-t="${c.id}"><span>${iconHtml("c_" + c.id, c.icon)}</span>${c.name}<i>${GAMES.filter((g) => g.cat === c.id).length}</i></button>`).join("")}</nav>
      <section class="cat"><h2>${iconHtml("c_" + cur.id, cur.icon)} ${cur.name}<small>${cur.note}</small></h2><div class="cards">${GAMES.filter((g) => g.cat === tab).map(card).join("")}</div></section>
    </div>`;
  const gn = app.querySelector(".gname");
  try { gn.value = localStorage.getItem("pokername") || ""; } catch {}
  gn.addEventListener("change", () => { const v = gn.value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12); gn.value = v; try { localStorage.setItem("pokername", v); } catch {} presSend(); });
  app.querySelectorAll(".mtab").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("menutab", b.dataset.t); } catch {} showMenu(); }));
  app.querySelectorAll(".card").forEach((b) => {
    b.addEventListener("click", () => start(b.dataset.g));
  });
}

let cleanup = null;
function start(id) {
  const g = GAMES.find((x) => x.id === id);
  presence(id); document.body.dataset.game = id;
  app.innerHTML = "";
  cleanup = g.mount(app, { env, back: () => { if (cleanup) cleanup(); cleanup = null; showMenu(); } }) || null;
  window.scrollTo(0, 0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0;     // 從滑到一半的選單點進來，遊戲畫面要從頂端開始（否則標題列會被捲掉）
}

// 網址帶 ?g=遊戲代號 就直接開那個遊戲（例如「一起看影片」的「在瀏覽器開啟」）
if (params.has("watch")) { env.watchHub = true; start("spectate"); } else { const g0 = params.get("g"); if (g0 && GAMES.some((x) => x.id === g0)) start(g0); else showMenu(); }

