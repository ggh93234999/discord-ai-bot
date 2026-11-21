// 水墨江湖（MMORPG）：所有數值表放這裡——職業、技能、怪物、地圖、裝備、商店。
// 規則與隨機都在伺服器（world.js），前端只畫。改數值只要改這個檔案。

export const LV_CAP = 60;
// 升到下一級要的經驗
export const expNeed = (lv) => Math.round(30 * Math.pow(lv, 1.7));

// ---------------------------------------------------------------- 職業
// hp/mp/atk/def：[1 級, 每級增加]；aspd：普攻間隔（秒）；range：普攻距離（格）；spd：移動速度（格/秒）
export const CLASSES = {
  sword: { name: "劍客", desc: "近戰、血厚防高，適合衝前面扛怪", hp: [70, 15], mp: [20, 3], atk: [8, 2.3], def: [3, 1.3], aspd: 1.0, range: 1.4, spd: 3.6 },
  mage: { name: "術士", desc: "遠程法術、範圍傷害，還能幫隊友回血", hp: [45, 9], mp: [45, 6], atk: [10, 2.9], def: [1, 0.7], aspd: 1.3, range: 5, spd: 3.4 },
  archer: { name: "弓手", desc: "遠程連射、攻速快，單體輸出最高", hp: [52, 11], mp: [30, 4], atk: [9, 2.5], def: [2, 0.9], aspd: 0.85, range: 6, spd: 3.8 },
};

// ---------------------------------------------------------------- 轉職（25 級，每個職業二選一）
// 數值加成：hp/mp/atk/def/spd 是倍數，aspd 是攻擊間隔倍數（越小越快），crit/range 直接加
export const ADV_LV = 25;
export const ADV = {
  jx: { base: "sword", name: "劍仙", desc: "快劍連斬、暴擊高，御劍飛行來去自如", mod: { atk: 1.12, crit: 10, aspd: 0.88, hp: 0.95 } },
  bd: { base: "sword", name: "霸刀", desc: "重刀大範圍、血厚防高，專門扛王", mod: { hp: 1.25, def: 1.25, atk: 1.04 } },
  ts: { base: "mage", name: "天師", desc: "雷法控場、太極護體幫全隊回血減傷", mod: { mp: 1.2, hp: 1.12, def: 1.15 } },
  ft: { base: "mage", name: "焚天", desc: "火系爆發、燃燒持續傷害，打得最痛", mod: { atk: 1.16, crit: 5 } },
  ss: { base: "archer", name: "神射", desc: "射程最遠、單發爆傷，專打王", mod: { atk: 1.12, crit: 8, range: 2 } },
  ly: { base: "archer", name: "獵影", desc: "毒霧陷阱、影步機動、連弩連射", mod: { aspd: 0.85, spd: 1.1, crit: 5 } },
};
export const ADV_SKILLS = {
  jx: [
    { id: "yujian", name: "御劍飛行", lv: 25, mp: 30, cd: 9, type: "dir", range: 7, w: 1.3, mult: 3.0, dash: true, pierce: true, desc: "踩著飛劍往滑鼠方向衝 7 格，路上的敵人都被斬中（3 倍）" },
    { id: "guanghan", name: "一劍光寒", lv: 30, mp: 32, cd: 8, type: "dir", range: 10, w: 1.0, spd: 20, mult: 4.2, pierce: true, desc: "揮出一道寒光，穿透 10 格內所有敵人（4.2 倍）" },
    { id: "wanjian", name: "萬劍歸宗", lv: 38, mp: 50, cd: 18, type: "ground", range: 7, r: 3.2, mult: 1.5, ticks: 4, delay: 0.3, desc: "萬劍從天而降，範圍 3.2 格，落 4 次（每次 1.5 倍）" },
  ],
  bd: [
    { id: "zhanyue", name: "刀氣斬月", lv: 25, mp: 30, cd: 8, type: "dir", range: 7, w: 2.2, spd: 12, mult: 2.8, pierce: true, desc: "劈出一道寬大的月牙刀氣，穿透路上所有敵人（2.8 倍）" },
    { id: "mingwang", name: "不動明王", lv: 30, mp: 30, cd: 24, type: "self", r: 5, taunt: true, buff: ["mingwang", 8], desc: "8 秒內受到的傷害減少 60%，並把 5 格內的怪全部引過來" },
    { id: "bawang", name: "霸王卸甲", lv: 38, mp: 48, cd: 16, type: "self", r: 3.4, mult: 1.6, hits: 4, stun: 1.2, desc: "掄刀狂轉，砍身邊 3.4 格的敵人 4 下（每下 1.6 倍），暈眩 1.2 秒" },
  ],
  ts: [
    { id: "zhenyao", name: "鎮妖符", lv: 25, mp: 30, cd: 12, type: "target", range: 7, mult: 2.4, stun: 3, dot: [0.8, 4], desc: "對指定的敵人貼鎮妖符（2.4 倍），暈眩 3 秒，之後 4 秒每秒 0.8 倍" },
    { id: "taiji", name: "太極護體", lv: 30, mp: 45, cd: 22, type: "self", r: 6, heal: 0.35, pbuff: ["shield", 8], desc: "自己和 6 格內的隊友回 35% 生命，8 秒內受到的傷害減少 40%" },
    { id: "wulei", name: "五雷正法", lv: 38, mp: 52, cd: 15, type: "ground", range: 8, r: 3.4, mult: 2.2, ticks: 3, stun: 0.6, delay: 0.35, desc: "連降三道天雷，範圍 3.4 格（每道 2.2 倍），每道暈眩 0.6 秒" },
  ],
  ft: [
    { id: "sanmei", name: "三昧真火", lv: 25, mp: 34, cd: 9, type: "target", range: 7, mult: 4.5, dot: [1.0, 4], desc: "以三昧真火焚燒指定的敵人（4.5 倍），之後 4 秒每秒再燒 1 倍" },
    { id: "fenghuang", name: "鳳凰涅槃", lv: 30, mp: 40, cd: 10, type: "dir", range: 10, w: 1.6, spd: 12, mult: 3.2, pierce: true, dot: [0.6, 3], desc: "放出火鳳凰往滑鼠方向飛，燒穿路上所有敵人（3.2 倍）並燃燒 3 秒" },
    { id: "huohai", name: "焚天火海", lv: 38, mp: 60, cd: 20, type: "ground", range: 8, r: 4, mult: 1.4, ticks: 5, delay: 0.3, desc: "在滑鼠位置掀起一片火海，範圍 4 格，燒 5 次（每次 1.4 倍）" },
  ],
  ss: [
    { id: "chuanyun", name: "穿雲神箭", lv: 25, mp: 30, cd: 9, type: "dir", range: 14, w: 0.7, spd: 24, mult: 4.6, pierce: true, desc: "拉滿弓射出一箭，射程 14 格、穿透所有敵人（4.6 倍）" },
    { id: "yingyan", name: "鷹眼", lv: 30, mp: 25, cd: 25, type: "self", buff: ["eagle", 10], desc: "10 秒內攻擊力提高 25%、暴擊率提高 25%" },
    { id: "liuxing", name: "流星箭雨", lv: 38, mp: 50, cd: 18, type: "ground", range: 10, r: 3.6, mult: 1.5, ticks: 4, delay: 0.4, desc: "對 10 格內的滑鼠位置降下流星箭雨，範圍 3.6 格，落 4 次（每次 1.5 倍）" },
  ],
  ly: [
    { id: "lianhuan", name: "連環弩", lv: 25, mp: 30, cd: 8, type: "target", range: 8, mult: 0.8, hits: 7, desc: "對指定的敵人連射 7 發弩箭（每發 0.8 倍）" },
    { id: "yingbu", name: "影步", lv: 30, mp: 24, cd: 10, type: "dir", range: 6, w: 1.0, mult: 1.8, dash: true, pierce: true, buff: ["gale", 4], desc: "化成影子往滑鼠方向衝 6 格（路上 1.8 倍），之後 4 秒移動和攻擊都快 40%" },
    { id: "duwu", name: "毒霧陷阱", lv: 38, mp: 44, cd: 16, type: "ground", range: 8, r: 3.2, mult: 0.8, slow: [0.5, 4], dot: [0.9, 5], delay: 0.2, desc: "在滑鼠位置放毒霧陷阱，範圍 3.2 格（0.8 倍），緩速 50%、之後 5 秒每秒 0.9 倍毒傷" },
  ],
};

// ---------------------------------------------------------------- 技能
// 每個職業 8 招，等級到了就學會，玩家自己挑 3 招放到 Q、E、R。
// type：self＝放在自己身上／身邊；target＝指定一隻怪；dir＝朝滑鼠方向（投射物或衝刺）；ground＝打在滑鼠位置（有距離上限）
// range：施放距離（target／ground）或飛行距離（dir）；r：範圍半徑；w：投射物寬度；mult：攻擊力倍數；hits：連打幾下
// pierce：穿透；dash：衝刺過去（leap：跳到範圍中心）；slow：[緩速比例, 秒]；stun：暈眩秒數；dot：[每秒倍數, 秒]；buff：[種類, 秒]
export const SKILLS = {
  sword: [
    { id: "sweep", name: "橫掃千軍", lv: 1, mp: 6, cd: 5, type: "self", r: 2.2, mult: 1.6, desc: "砍身邊 2 格內所有敵人（1.6 倍）" },
    { id: "thrust", name: "破軍突刺", lv: 3, mp: 12, cd: 8, type: "dir", range: 5, w: 1.1, mult: 2.6, dash: true, pierce: true, desc: "朝滑鼠方向衝刺 5 格，路上的敵人都被刺中（2.6 倍）" },
    { id: "guard", name: "金鐘罩", lv: 5, mp: 12, cd: 18, type: "self", buff: ["guard", 6], desc: "6 秒內受到的傷害減半" },
    { id: "qi", name: "劍氣", lv: 8, mp: 14, cd: 6, type: "dir", range: 7, w: 1.0, spd: 14, mult: 1.8, pierce: true, desc: "朝滑鼠方向揮出一道劍氣，穿透路上所有敵人（1.8 倍）" },
    { id: "cleave", name: "斬鐵", lv: 10, mp: 16, cd: 7, type: "target", range: 2.2, mult: 3.6, stun: 0.8, desc: "對指定的敵人重斬（3.6 倍），暈眩 0.8 秒" },
    { id: "whirl", name: "旋風斬", lv: 14, mp: 22, cd: 10, type: "self", r: 2.6, mult: 0.9, hits: 3, desc: "原地旋轉，連砍身邊 2.6 格內的敵人 3 下（每下 0.9 倍）" },
    { id: "roar", name: "怒吼", lv: 18, mp: 18, cd: 25, type: "self", buff: ["rage", 8], desc: "8 秒內攻擊力提高 30%" },
    { id: "leap", name: "天外飛仙", lv: 22, mp: 28, cd: 14, type: "ground", range: 6, r: 2.4, mult: 2.8, leap: true, desc: "跳到滑鼠位置（6 格內）砸地，範圍 2.4 格（2.8 倍）" },
  ],
  mage: [
    { id: "fire", name: "火符", lv: 1, mp: 7, cd: 3, type: "target", range: 6, mult: 2.0, desc: "對指定的敵人放一張火符（2 倍）" },
    { id: "ice", name: "冰錐", lv: 3, mp: 9, cd: 5, type: "dir", range: 8, w: 0.7, spd: 13, mult: 1.7, slow: [0.45, 2.5], desc: "朝滑鼠方向射出冰錐，打中第一個敵人（1.7 倍）並緩速 45%" },
    { id: "heal", name: "回春術", lv: 5, mp: 16, cd: 10, type: "self", heal: 0.3, r: 5, desc: "自己和 5 格內的隊友回 30% 生命" },
    { id: "thunder", name: "五雷陣", lv: 8, mp: 24, cd: 8, type: "ground", range: 7, r: 2.6, mult: 2.4, delay: 0.35, desc: "在滑鼠位置落雷（7 格內），範圍 2.6 格（2.4 倍）" },
    { id: "dragon", name: "火龍", lv: 12, mp: 26, cd: 9, type: "dir", range: 8, w: 1.2, spd: 11, mult: 2.3, pierce: true, desc: "放出一條火龍往滑鼠方向衝，燒穿路上所有敵人（2.3 倍）" },
    { id: "seal", name: "定身符", lv: 15, mp: 18, cd: 12, type: "target", range: 6, mult: 1.0, stun: 2.5, desc: "對指定的敵人貼定身符，暈眩 2.5 秒（1 倍）" },
    { id: "shield", name: "護體真氣", lv: 18, mp: 20, cd: 20, type: "self", buff: ["shield", 8], desc: "8 秒內受到的傷害減少 40%" },
    { id: "inferno", name: "天火燎原", lv: 22, mp: 34, cd: 16, type: "ground", range: 7, r: 3.2, mult: 1.3, ticks: 3, delay: 0.3, desc: "在滑鼠位置降下天火，範圍 3.2 格，燒 3 次（每次 1.3 倍）" },
  ],
  archer: [
    { id: "triple", name: "連珠箭", lv: 1, mp: 6, cd: 4, type: "target", range: 7, mult: 0.9, hits: 3, desc: "對指定的敵人連射 3 箭（每箭 0.9 倍）" },
    { id: "pierce", name: "穿雲箭", lv: 3, mp: 10, cd: 6, type: "dir", range: 10, w: 0.6, spd: 18, mult: 2.2, pierce: true, desc: "朝滑鼠方向射出一箭，穿透路上所有敵人（2.2 倍）" },
    { id: "gale", name: "疾風步", lv: 5, mp: 12, cd: 16, type: "self", buff: ["gale", 6], desc: "6 秒內移動和攻擊都快 40%" },
    { id: "rain", name: "萬箭齊發", lv: 8, mp: 22, cd: 9, type: "ground", range: 8, r: 2.8, mult: 1.9, delay: 0.4, desc: "對滑鼠位置射下箭雨（8 格內），範圍 2.8 格（1.9 倍）" },
    { id: "spread", name: "散射", lv: 12, mp: 18, cd: 7, type: "dir", range: 7, w: 0.5, spd: 16, mult: 1.1, arrows: 5, spread: 40, desc: "朝滑鼠方向扇形射出 5 箭，每箭打中第一個敵人（1.1 倍）" },
    { id: "swallow", name: "燕返", lv: 15, mp: 10, cd: 8, type: "dir", range: 4, w: 0.8, dash: true, mult: 0, desc: "朝滑鼠方向翻身閃避 4 格" },
    { id: "poison", name: "毒箭", lv: 18, mp: 16, cd: 8, type: "target", range: 7, mult: 1.0, dot: [0.6, 5], desc: "射出毒箭（1 倍），之後 5 秒每秒再受 0.6 倍毒傷" },
    { id: "net", name: "天羅地網", lv: 22, mp: 26, cd: 14, type: "ground", range: 8, r: 3, mult: 1.2, slow: [0.6, 3], desc: "在滑鼠位置撒下大網，範圍 3 格（1.2 倍），緩速 60% 3 秒" },
  ],
};
export const SLOT_N = 4;            // Q W E R（轉職後多一格 F）

// ---------------------------------------------------------------- 怪物
// 數值由等級算（monStats），這裡只放外觀、行為和倍率。agg：主動攻擊距離（0＝被打才還手）
export const MONS = {
  rat: { name: "竹鼠", lv: 1, agg: 0, shape: "rat", hpm: 0.8 },
  hare: { name: "野兔精", lv: 3, agg: 0, shape: "hare" },
  snake: { name: "竹葉青", lv: 5, agg: 3, shape: "snake", atkm: 1.1 },
  monkey: { name: "山魈", lv: 7, agg: 4, shape: "monkey" },
  wolf: { name: "山狼", lv: 9, agg: 4.5, shape: "wolf", spdm: 1.2 },
  golem: { name: "石精", lv: 11, agg: 0, shape: "golem", hpm: 1.8, spdm: 0.6, defm: 1.6 },
  vulture: { name: "禿鷲", lv: 13, agg: 5, shape: "bird", spdm: 1.3, hpm: 0.85 },
  bandit: { name: "山賊", lv: 15, agg: 5, shape: "bandit", atkm: 1.15 },
  zombie: { name: "殭屍", lv: 17, agg: 4, shape: "zombie", hpm: 1.3, spdm: 0.7 },
  wisp: { name: "鬼火", lv: 19, agg: 5, shape: "wisp", hpm: 0.8, atkm: 1.25, spdm: 1.2 },
  terra: { name: "陶俑", lv: 22, agg: 4, shape: "terra", hpm: 1.4, defm: 1.5, spdm: 0.8 },
  scorp: { name: "屍蠍", lv: 24, agg: 5, shape: "scorp", atkm: 1.2 },
  // 王：數值另外放大，會定時放範圍重擊（先出現警示圈，跑出圈外就不會被打到）
  b_bamboo: { name: "竹妖", lv: 10, agg: 5, shape: "bamboo", boss: true, hpm: 30, atkm: 1.6, defm: 1.3, spdm: 0.8, respawn: 10 * 60 },
  b_tiger: { name: "白額虎王", lv: 18, agg: 6, shape: "tiger", boss: true, hpm: 40, atkm: 1.7, defm: 1.4, spdm: 0.9, respawn: 15 * 60 },
  b_corpse: { name: "屍王", lv: 28, agg: 6, shape: "corpse", boss: true, hpm: 55, atkm: 1.8, defm: 1.5, spdm: 0.8, respawn: 20 * 60 },
  // 雪嶺 25–35
  snowfox: { name: "雪狐", lv: 26, agg: 5, shape: "snowfox", spdm: 1.3, hpm: 0.9 },
  yeti: { name: "雪猿", lv: 28, agg: 4, shape: "yeti", hpm: 1.6, defm: 1.3, spdm: 0.8 },
  iceghost: { name: "冰魄", lv: 31, agg: 5, shape: "iceghost", atkm: 1.25, hpm: 0.85, spdm: 1.1 },
  assassin: { name: "雪衣刺客", lv: 33, agg: 6, shape: "assassin", atkm: 1.3, hpm: 0.9, spdm: 1.3 },
  b_snow: { name: "冰魄雪妖", lv: 38, agg: 6, shape: "snow", boss: true, hpm: 65, atkm: 1.85, defm: 1.5, spdm: 0.8, respawn: 20 * 60 },
  // 火焰山 35–45
  salamander: { name: "火蜥", lv: 36, agg: 4, shape: "salamander", atkm: 1.1 },
  firecrow: { name: "火鴉", lv: 38, agg: 5, shape: "firecrow", spdm: 1.35, hpm: 0.8, atkm: 1.15 },
  lavagolem: { name: "熔岩巨人", lv: 41, agg: 3, shape: "lavagolem", hpm: 1.9, defm: 1.7, spdm: 0.6 },
  fireimp: { name: "赤焰鬼", lv: 43, agg: 6, shape: "fireimp", atkm: 1.3, spdm: 1.2 },
  b_qilin: { name: "火麒麟", lv: 48, agg: 6, shape: "qilin", boss: true, hpm: 75, atkm: 1.9, defm: 1.55, spdm: 0.95, respawn: 25 * 60 },
  // 魔教總壇 45–55
  cultist: { name: "魔教弟子", lv: 46, agg: 5, shape: "cultist", atkm: 1.15 },
  bat: { name: "血蝠", lv: 48, agg: 6, shape: "bat", spdm: 1.4, hpm: 0.8, atkm: 1.2 },
  shadow: { name: "影武者", lv: 51, agg: 6, shape: "shadow", atkm: 1.35, spdm: 1.3, hpm: 0.9 },
  general: { name: "魔教煞將", lv: 54, agg: 5, shape: "general", hpm: 1.7, defm: 1.6, atkm: 1.2, spdm: 0.8 },
  // 鎖妖塔（副本）：等級跟著隊伍走，這裡的 lv 只是預設
  foxspirit: { name: "狐妖", lv: 30, agg: 6, shape: "foxspirit", atkm: 1.15 },
  b_fox: { name: "九尾妖狐", lv: 33, agg: 9, shape: "fox", boss: true, hpm: 40, atkm: 1.8, defm: 1.4, spdm: 1.0, respawn: 0 },
  b_lord: { name: "魔教教主", lv: 58, agg: 7, shape: "lord", boss: true, hpm: 90, atkm: 2.0, defm: 1.6, spdm: 1.0, respawn: 30 * 60 },
};
export const monStats = (k) => monStatsDef(MONS[k]);
export function monStatsDef(d) {
  const L = d.lv;
  return {
    hp: Math.round((40 + 22 * L + 0.3 * L * L) * (d.hpm || 1)),
    atk: Math.round((6 + 2.6 * L) * (d.atkm || 1)),
    def: Math.round((1 + 1.1 * L) * (d.defm || 1)),
    exp: Math.round((expNeed(L) / 18) * (d.boss ? 25 : (d.hpm || 1))),
    gold: d.boss ? 30 * L : Math.max(1, Math.round(0.7 * L + 1)),
    spd: 2.2 * (d.spdm || 1),
    aspd: d.boss ? 1.6 : 1.5,
  };
}

// ---------------------------------------------------------------- 地圖
// 地圖用固定種子產生（每次開伺服器都一樣）。spawns：[怪物, 數量]；portals：走到那一格就傳送
export const MAPS = {
  town: { name: "長安城", w: 48, h: 36, seed: 11, town: true, theme: "town", spawns: [], layout: true,
    portals: [{ x: 47, y: 17, to: "bamboo", tx: 2, ty: 18, label: "竹林 →" }] },
  bamboo: { name: "竹林", w: 52, h: 38, seed: 23, theme: "bamboo", lvl: "1–8 級",
    spawns: [["rat", 9], ["hare", 8], ["snake", 7], ["monkey", 6]], boss: "b_bamboo",
    portals: [{ x: 0, y: 18, to: "town", tx: 45, ty: 17, label: "← 長安城" }, { x: 51, y: 20, to: "mount", tx: 2, ty: 22, label: "荒山 →" }] },
  mount: { name: "荒山", w: 56, h: 42, seed: 37, theme: "mount", lvl: "8–16 級",
    spawns: [["wolf", 9], ["golem", 7], ["vulture", 7], ["bandit", 7]], boss: "b_tiger",
    portals: [{ x: 0, y: 22, to: "bamboo", tx: 49, ty: 20, label: "← 竹林" }, { x: 55, y: 18, to: "tomb", tx: 2, ty: 20, label: "古墓 →" }] },
  tomb: { name: "古墓", w: 54, h: 40, seed: 53, theme: "tomb", lvl: "16–25 級",
    spawns: [["zombie", 9], ["wisp", 7], ["terra", 7], ["scorp", 7]], boss: "b_corpse",
    portals: [{ x: 0, y: 20, to: "mount", tx: 53, ty: 18, label: "← 荒山" }, { x: 53, y: 18, to: "snow", tx: 2, ty: 20, label: "雪嶺 →" }] },
  snow: { name: "雪嶺", w: 54, h: 40, seed: 61, theme: "snow", lvl: "25–35 級",
    spawns: [["snowfox", 9], ["yeti", 7], ["iceghost", 7], ["assassin", 7]], boss: "b_snow",
    portals: [{ x: 0, y: 20, to: "tomb", tx: 51, ty: 18, label: "← 古墓" }, { x: 53, y: 22, to: "fire", tx: 2, ty: 21, label: "火焰山 →" }] },
  fire: { name: "火焰山", w: 56, h: 42, seed: 71, theme: "fire", lvl: "35–45 級",
    spawns: [["salamander", 9], ["firecrow", 7], ["lavagolem", 7], ["fireimp", 7]], boss: "b_qilin",
    portals: [{ x: 0, y: 21, to: "snow", tx: 51, ty: 22, label: "← 雪嶺" }, { x: 55, y: 20, to: "demon", tx: 2, ty: 21, label: "魔教總壇 →" }] },
  demon: { name: "魔教總壇", w: 56, h: 42, seed: 83, theme: "demon", lvl: "45–55 級",
    spawns: [["cultist", 9], ["bat", 7], ["shadow", 7], ["general", 7]], boss: "b_lord",
    portals: [{ x: 0, y: 21, to: "fire", tx: 53, ty: 20, label: "← 火焰山" }] },
};
// 城裡的 NPC
export const NPCS = [
  { id: "n_smith", name: "鐵匠鋪・老王", x: 41.5, y: 9.7, kind: "smith", say: "刀劍衣甲，童叟無欺。要強化、洗詞條、重鑄也找我。" },
  { id: "n_bank", name: "錢莊・匯通號", x: 6, y: 9.7, kind: "bank", say: "銀兩、代幣，一兩換一枚。" },
  { id: "n_store", name: "倉庫・萬寶庫", x: 12.5, y: 9.7, kind: "store", say: "東西放我這兒，同一個帳號的每個角色都拿得到。" },
  { id: "n_temple", name: "城隍廟・廟祝", x: 26.6, y: 8.9, kind: "temple", say: "誠心上香，城隍爺每天都會賜一次福。" },
  { id: "n_inn", name: "客棧・醉仙樓", x: 34.5, y: 9.7, kind: "inn", say: "客官吃點什麼？吃飽了打怪更有力氣。" },
  { id: "n_herb", name: "藥鋪・回春堂", x: 6, y: 31, kind: "herb", say: "受傷了？來兩顆還丹吧。" },
  { id: "n_casino", name: "賭坊・如意坊", x: 12.5, y: 31, kind: "casino", say: "買定離手！大還是小？" },
  { id: "n_guide", name: "說書人", x: 33.5, y: 31, kind: "guide", say: "往東出城是竹林，再往東是荒山、古墓，古墓再過去是雪嶺、火焰山，最深處是魔教總壇。各處都有一隻大王，記得找人一起打。" },
  { id: "n_post", name: "驛站・車夫", x: 41.5, y: 31, kind: "post", say: "客官要去哪？去過的地方，我都送得到。" },
  { id: "n_tower", name: "鎖妖塔・守塔人", x: 5.5, y: 22, kind: "tower", say: "塔裡鎮著上千妖魔，最上層是九尾妖狐。組好隊再進去。" },
  { id: "n_arena", name: "擂台主", x: 18.2, y: 14.6, kind: "arena", say: "想切磋？在城裡點別人選「擂台切磋」，我來當公證。" },
  { id: "n_bounty", name: "懸賞榜・捕快", x: 29.2, y: 14.6, kind: "bounty", say: "最近城外不太平，幫忙除掉一些妖物，官府有賞。" },
  { id: "n_rank", name: "江湖榜", x: 20.2, y: 14.5, kind: "rank", say: "江湖兒女，名字刻上石碑，流傳千古。" },
];
// 主城格局：建築（擋路，各有自己的圖）、裝飾（block＝擋路）、擂台木台的位置、路
export const TOWN = {
  roads: [[1, 17, 46, 18], [23, 8, 24, 33], [3, 10, 44, 11], [3, 32, 44, 33], [5, 19, 6, 23],
    // 每棟建築門口的鋪面，接到街上
    [4, 9, 7, 9], [11, 9, 14, 9], [20, 8, 27, 8], [33, 9, 36, 9], [40, 9, 43, 9], [4, 30, 7, 31], [11, 30, 14, 31], [32, 30, 35, 31], [40, 30, 43, 31], [3, 21, 7, 21]],
  plaza: { x: 23.5, y: 17.5, r: 4.6 },
  pond: { x: 40.5, y: 22, r: 2.1 },
  buildings: [
    { x0: 3, y0: 3, x1: 8, y1: 8, art: "t_bank" }, { x0: 10, y0: 3, x1: 15, y1: 8, art: "t_store" },
    { x0: 19, y0: 2, x1: 28, y1: 7, art: "t_temple" }, { x0: 32, y0: 3, x1: 37, y1: 8, art: "t_inn" }, { x0: 39, y0: 3, x1: 44, y1: 8, art: "t_forge" },
    { x0: 3, y0: 25, x1: 8, y1: 29, art: "t_herb" }, { x0: 10, y0: 25, x1: 15, y1: 29, art: "t_casino" },
    { x0: 31, y0: 25, x1: 36, y1: 29, art: "t_tea" }, { x0: 39, y0: 25, x1: 44, y1: 29, art: "t_stable" },
    { x0: 3, y0: 13, x1: 7, y1: 20, art: "t_pagoda", tall: 1 },
  ],
  stage: { x0: 9, y0: 12, x1: 16, y1: 16 },
  deco: [
    ["e_cauldron", 23.5, 15.2, 1.9, 1.9, 0], ["d_stelebase", 20.2, 13.9, 0, 0, 1], ["d_notice", 29.2, 13.8, 1.8, 1.9, 1],
    ["d_well", 20, 21.6, 1.5, 1.6, 1], ["d_willow", 18.6, 27.6, 2.8, 3.6, 1], ["d_willow", 28.6, 27.6, 2.8, 3.6, 1], ["d_willow", 1.8, 11.5, 2.6, 3.4, 1],
    ["d_tree", 37.6, 14.6, 3.2, 3.8, 1], ["d_tree", 10.6, 22.6, 3, 3.6, 1],
    ["d_lion", 45.2, 15.6, 1.3, 1.5, 1], ["d_lion", 45.2, 20.6, 1.3, 1.5, 1],
    ["d_lamp", 8.4, 16.4, 0.9, 2.2, 1], ["d_lamp", 16, 19.8, 0.9, 2.2, 1], ["d_lamp", 31, 16.2, 0.9, 2.2, 1], ["d_lamp", 37, 19.8, 0.9, 2.2, 1], ["d_lamp", 43, 16.2, 0.9, 2.2, 1], ["d_lamp", 22, 31.2, 0.9, 2.2, 1], ["d_lamp", 26, 31.2, 0.9, 2.2, 1],
    ["d_cart", 33.8, 14.8, 1.8, 1.5, 1], ["d_crates", 16.8, 9.4, 1.6, 1.5, 1], ["d_crates", 30.4, 22.2, 1.6, 1.5, 1], ["d_crates", 45, 9.4, 1.5, 1.4, 1],
    ["d_table", 36.6, 22.4, 2, 1.8, 1], ["d_table", 29.6, 31, 2, 1.8, 1],
    ["d_flowers", 20.6, 9.4, 1.4, 1.1, 0], ["d_flowers", 29.4, 9.4, 1.4, 1.1, 0], ["d_flowers", 8.8, 31.4, 1.3, 1.1, 0], ["d_flowers", 37.6, 31.4, 1.3, 1.1, 0],
    ["d_dicetable", 16.6, 30.8, 1.8, 1.5, 1], ["e_plum1", 26.6, 21.8, 2.2, 2.6, 1], ["e_plum2", 2.2, 24, 2.2, 2.6, 1],
  ],
  // 城裡走來走去的路人（只在畫面上，沒有互動）
  folk: ["f_vendor", "f_child", "f_scholar", "f_lady", "f_old", "f_monk", "f_cat", "f_dog", "f_chicken", "f_child", "f_scholar"],
};
export const TOWN_SPAWN = { x: 23.5, y: 20.5 };
// 驛站傳送：去過的地圖才能傳，到不同地圖的車資（回長安城免費）
export const WARP_COST = { town: 0, bamboo: 10, mount: 30, tomb: 60, snow: 100, fire: 160, demon: 240 };

// ---------------------------------------------------------------- 裝備
export const SLOTS = { weapon: "武器", armor: "衣服", acc: "飾品" };
export const TIERS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];         // 裝備等級（需求等級）
const WNAME = {
  sword: ["木劍", "青銅劍", "精鋼劍", "龍泉劍", "湛盧劍", "軒轅劍", "寒霜劍", "赤霄劍", "七星劍", "太阿劍", "純鈞劍", "誅仙劍"],
  mage: ["桃木杖", "青竹杖", "紫檀杖", "玄鐵杖", "崑崙杖", "太乙杖", "冰魄杖", "朱雀杖", "九霄杖", "伏魔杖", "通天杖", "混元杖"],
  archer: ["竹弓", "牛角弓", "鐵胎弓", "雕翎弓", "落日弓", "射天弓", "霜月弓", "烈陽弓", "穿雲弓", "破軍弓", "驚鴻弓", "后羿弓"],
};
const ANAME = ["布衣", "皮甲", "鎖子甲", "明光鎧", "山文甲", "金縷衣", "雪蠶衣", "火浣袍", "玄武甲", "麒麟鎧", "天蠶寶衣", "混元戰甲"];
const CNAME = ["草繩結", "銅錢串", "玉佩", "護身符", "夜明珠", "崑崙玉", "冰心玉", "火龍珠", "定海珠", "如意環", "舍利子", "女媧石"];
export const RAR = [
  { name: "普通", mult: 1, aff: 0 },
  { name: "精良", mult: 1.2, aff: 1 },
  { name: "稀有", mult: 1.45, aff: 2 },
  { name: "傳說", mult: 1.8, aff: 3 },
];
// 隨機詞條：大小跟裝備等級走
export const AFFIX = {
  atk: { name: "攻擊", v: (t) => Math.round(2 + 1.2 * t) },
  def: { name: "防禦", v: (t) => Math.round(1 + 0.8 * t) },
  hp: { name: "生命", v: (t) => Math.round(12 + 6 * t) },
  mp: { name: "法力", v: (t) => Math.round(6 + 3 * t) },
  crit: { name: "暴擊%", v: (t) => Math.round(2 + t / 6) },
  aspd: { name: "攻速%", v: (t) => Math.round(3 + t / 5) },
};
export const STAT_NAME = { atk: "攻擊", def: "防禦", hp: "生命", mp: "法力", crit: "暴擊%", aspd: "攻速%" };
export function baseItem(slot, tier, cls) {
  const ti = TIERS.indexOf(tier), t = tier;
  if (slot === "weapon") return { name: WNAME[cls][ti], st: { atk: Math.round(4 + 3 * t) } };
  if (slot === "armor") return { name: ANAME[ti], st: { def: Math.round(2 + 1.6 * t), hp: Math.round(10 + 6 * t) } };
  return { name: CNAME[ti], st: { hp: Math.round(8 + 4 * t), mp: Math.round(5 + 2 * t), crit: 2 + Math.floor(t / 8) } };
}
// 價格：商店賣普通裝；回收價是價值的 25%
export const itemValue = (tier, r) => Math.round((25 + 18 * Math.pow(tier, 1.45)) * RAR[r].mult * (1 + 0.25 * r));
export const SELL_RATE = 0.25;

// 消耗品
export const POTIONS = {
  hp1: { name: "小還丹", hp: 60, price: 8 },
  hp2: { name: "大還丹", hp: 240, price: 30, lv: 10 },
  hp3: { name: "九轉還魂丹", hp: 600, price: 80, lv: 18 },
  mp1: { name: "清心散", mp: 40, price: 10 },
  mp2: { name: "凝神散", mp: 140, price: 36, lv: 10 },
  hp4: { name: "天王護心丹", hp: 1500, price: 180, lv: 30 },
  mp3: { name: "玉露瓊漿", mp: 380, price: 90, lv: 30 },
  tp: { name: "回城符", tp: true, price: 15 },
  // 強化材料（疊在背包裡，跟藥一樣；在鐵匠買，也會從怪身上掉）
  ore: { name: "玄鐵", mat: 1, price: 40, d: "強化裝備等級用" },
  jade: { name: "靈玉", mat: 1, price: 300, d: "洗詞條用" },
  recast: { name: "重鑄石", mat: 1, price: 1200, d: "重鑄提升品質用" },
};

// ---------------------------------------------------------------- 鍛造（鐵匠）
// 強化：+0 → +12，每一級加基礎數值 8%；從 +7 以上強化失敗會掉一級（不會爆裝）
export const ENH = {
  max: 12, drop: 7, bonus: 0.08,
  rate: [100, 95, 90, 82, 74, 66, 58, 48, 40, 32, 25, 18],       // 從 +e 強化到 +(e+1) 的成功率（%）
  gold: (t, e) => Math.round((20 + 8 * Math.pow(t, 1.3)) * (1 + e * 0.6)),
  ore: (e) => 1 + Math.floor(e / 3),
};
// 洗詞條：詞條數量照品質，種類和數值重抽（數值 ±30%）
export const REROLL = { jade: 1, gold: (t) => Math.round(30 + 6 * t) };
// 重鑄：有機率把品質往上提一階（不會往下掉），成功的話詞條也一起重抽
export const RECAST = { stone: 1, gold: (t) => Math.round(80 + 15 * t), up: [50, 25, 8] };
export const POTION_CD = 1.2;     // 吃藥的冷卻（秒）

// ---------------------------------------------------------------- 錢莊（跟大笨bot 錢包互換，1 兩 = 1 代幣）
export const BANK_DAILY_OUT = 5000;   // 每人每天最多把多少兩換成代幣（防止打怪印鈔）
export const BANK_MAX_IN = 100000;    // 單次最多存入
export const INV_MAX = 30;
export const PARTY_MAX = 4;
export const DEATH_EXP_LOSS = 0.05;   // 死掉扣這一級經驗的 5%

// ---------------------------------------------------------------- 鎖妖塔（副本）
// 隊伍一起進（隊員要在長安城），怪的等級跟隊伍平均等級走；三波小怪＋九尾妖狐；每個帳號每天 3 次
export const TOWER = {
  minLv: 20, daily: 3, time: 10 * 60,
  waves: [8, 10, 8], elites: 2, hpm: 1.3, eliteHpm: 4,
  pool: ["foxspirit", "zombie", "wisp", "iceghost", "shadow", "bat", "fireimp", "assassin"],
  legend: 25,          // 打倒九尾妖狐：每人一件稀有以上，這個機率（%）是傳說
};
// 擂台：兩個人都在長安城、互相同意才開打；不會掉東西、不扣經驗；記勝負
export const ARENA = { countdown: 3, time: 3 * 60, dmg: 0.5 };

// ---------------------------------------------------------------- 主城新 NPC
export const STASH_MAX = 60;            // 倉庫格數（整個帳號共用）
// 客棧：吃了 30 分鐘有效，一次只能一道（新的蓋掉舊的）；價格跟等級走
export const FOODS = {
  wine: { name: "女兒紅", d: "經驗 +20%", buff: "exp", v: 0.2 },
  pork: { name: "東坡肉", d: "攻擊 +10%", buff: "atk", v: 0.1 },
  soup: { name: "佛跳牆", d: "掉寶率 +30%", buff: "drop", v: 0.3 },
};
export const FOOD_MIN = 30;
export const foodPrice = (lv) => 20 + lv * 8;
// 城隍廟：每個帳號每天祈福一次，抽一支籤（機率加總 100）
export const BLESS = [
  { k: "exp", p: 38, name: "天官賜福", slip: "上籤", d: "一小時內經驗 +30%", buff: "exp", v: 0.3, min: 60 },
  { k: "gold", p: 25, name: "財神眷顧", slip: "中籤", d: "得到一筆銀兩" },
  { k: "drop", p: 20, name: "文昌開運", slip: "上籤", d: "一小時內掉寶率 +30%", buff: "drop", v: 0.3, min: 60 },
  { k: "jade", p: 12, name: "太上護佑", slip: "中籤", d: "得到靈玉 ×2" },
  { k: "big", p: 5, name: "大吉大利", slip: "上上籤", d: "重鑄石 ×1，一小時內經驗 +50%", buff: "exp", v: 0.5, min: 60 },
];
// 賭坊：擲三顆骰子比大小（11–17 大、4–10 小，豹子莊家通吃），押豹子賠 24 倍
export const DICE = { min: 10, max: 20000, triplePay: 24 };
// 懸賞榜：每個帳號每天 3 個任務
export const BOUNTY_N = 3;
