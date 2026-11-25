// 水墨江湖（MMORPG）：所有數值表放這裡——職業、技能、怪物、地圖、裝備、商店。
// 規則與隨機都在伺服器（world.js），前端只畫。改數值只要改這個檔案。

export const LV_CAP = 100;
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
  // ---- 60～100 級：東海龍宮、崑崙仙山、幽冥地府、九重天宮
  shrimp: { name: "蝦兵", lv: 61, agg: 5, shape: "shrimp", hpm: 0.9, spdm: 1.2 },
  crab: { name: "蟹將", lv: 63, agg: 4, shape: "crab", hpm: 1.7, defm: 1.7, spdm: 0.7 },
  merman: { name: "鮫人", lv: 66, agg: 5, shape: "merman", atkm: 1.15 },
  yaksha: { name: "巡海夜叉", lv: 68, agg: 6, shape: "yaksha", atkm: 1.3, spdm: 1.2 },
  crane: { name: "仙鶴", lv: 71, agg: 5, shape: "crane", spdm: 1.35, hpm: 0.85, atkm: 1.1 },
  ape: { name: "白猿", lv: 73, agg: 5, shape: "ape", hpm: 1.3, atkm: 1.15 },
  jadegolem: { name: "玉石傀儡", lv: 76, agg: 3, shape: "jadegolem", hpm: 1.9, defm: 1.8, spdm: 0.6 },
  daoist: { name: "守山道人", lv: 78, agg: 6, shape: "daoist", atkm: 1.3 },
  ghostsoldier: { name: "鬼卒", lv: 81, agg: 5, shape: "ghostsoldier" },
  oxhead: { name: "牛頭", lv: 83, agg: 5, shape: "oxhead", hpm: 1.5, atkm: 1.2, defm: 1.3 },
  horseface: { name: "馬面", lv: 86, agg: 6, shape: "horseface", atkm: 1.3, spdm: 1.2 },
  wraith: { name: "冤魂", lv: 88, agg: 6, shape: "wraith", hpm: 0.85, atkm: 1.35, spdm: 1.2 },
  soldier: { name: "天兵", lv: 91, agg: 5, shape: "soldier", defm: 1.3 },
  leigong: { name: "雷公", lv: 93, agg: 6, shape: "leigong", atkm: 1.35, spdm: 1.3 },
  tianjiang: { name: "天將", lv: 96, agg: 6, shape: "tianjiang", hpm: 1.4, atkm: 1.3 },
  jinjia: { name: "金甲神", lv: 98, agg: 4, shape: "jinjia", hpm: 2, defm: 1.9, spdm: 0.7 },
  b_dragon: { name: "東海龍王", lv: 73, agg: 7, shape: "dragon", boss: true, hpm: 95, atkm: 2.0, defm: 1.6, spdm: 0.9, respawn: 30 * 60 },
  b_kaiming: { name: "開明獸", lv: 83, agg: 7, shape: "kaiming", boss: true, hpm: 100, atkm: 2.05, defm: 1.65, spdm: 1.0, respawn: 30 * 60 },
  b_yama: { name: "閻羅王", lv: 93, agg: 7, shape: "yama", boss: true, hpm: 110, atkm: 2.1, defm: 1.7, spdm: 0.95, respawn: 30 * 60 },
  b_erlang: { name: "二郎神", lv: 100, agg: 8, shape: "erlang", boss: true, hpm: 130, atkm: 2.2, defm: 1.75, spdm: 1.05, respawn: 40 * 60 },
  e_shrimp: { name: "蝦兵統領", lv: 66, agg: 6, shape: "shrimp", elite: true, hpm: 9, atkm: 1.7, defm: 1.4, spdm: 1.2, respawn: 240 },
  e_crab: { name: "蟹將軍", lv: 67, agg: 5, shape: "crab", elite: true, hpm: 13, atkm: 1.6, defm: 1.9, spdm: 0.7, respawn: 240 },
  e_yaksha: { name: "夜叉頭目", lv: 70, agg: 7, shape: "yaksha", elite: true, hpm: 9, atkm: 1.9, defm: 1.4, spdm: 1.2, respawn: 240 },
  e_crane: { name: "千年仙鶴", lv: 75, agg: 6, shape: "crane", elite: true, hpm: 9, atkm: 1.8, defm: 1.4, spdm: 1.35, respawn: 240 },
  e_jadegolem: { name: "玉髓傀儡", lv: 78, agg: 5, shape: "jadegolem", elite: true, hpm: 13, atkm: 1.6, defm: 2, spdm: 0.65, respawn: 240 },
  e_daoist: { name: "崑崙掌教", lv: 80, agg: 7, shape: "daoist", elite: true, hpm: 10, atkm: 1.9, defm: 1.45, respawn: 240 },
  e_oxhead: { name: "牛頭統領", lv: 85, agg: 6, shape: "oxhead", elite: true, hpm: 12, atkm: 1.8, defm: 1.6, respawn: 240 },
  e_horseface: { name: "馬面統領", lv: 88, agg: 7, shape: "horseface", elite: true, hpm: 10, atkm: 1.9, defm: 1.45, spdm: 1.2, respawn: 240 },
  e_wraith: { name: "厲鬼", lv: 90, agg: 7, shape: "wraith", elite: true, hpm: 9, atkm: 2, defm: 1.4, spdm: 1.2, respawn: 240 },
  e_leigong: { name: "雷部正神", lv: 95, agg: 7, shape: "leigong", elite: true, hpm: 10, atkm: 2, defm: 1.45, spdm: 1.3, respawn: 240 },
  e_tianjiang: { name: "天兵統帥", lv: 97, agg: 7, shape: "tianjiang", elite: true, hpm: 12, atkm: 1.9, defm: 1.6, respawn: 240 },
  e_jinjia: { name: "金甲力士", lv: 100, agg: 5, shape: "jinjia", elite: true, hpm: 14, atkm: 1.8, defm: 2, spdm: 0.7, respawn: 240 },
  // 小王（精英）：每張野外地圖三隻，固定在自己的巢穴，4 分鐘重生；有範圍重擊，必掉裝備
  e_rat: { name: "竹鼠王", lv: 6, agg: 5, shape: "rat", elite: true, hpm: 9, atkm: 1.5, defm: 1.3, respawn: 240 },
  e_hare: { name: "玉兔仙", lv: 7, agg: 5, shape: "hare", elite: true, hpm: 9, atkm: 1.5, defm: 1.3, spdm: 1.2, respawn: 240 },
  e_monkey: { name: "山魈王", lv: 9, agg: 6, shape: "monkey", elite: true, hpm: 9, atkm: 1.6, defm: 1.35, respawn: 240 },
  e_wolf: { name: "獨眼狼王", lv: 14, agg: 6, shape: "wolf", elite: true, hpm: 9, atkm: 1.6, defm: 1.35, spdm: 1.2, respawn: 240 },
  e_golem: { name: "石精老祖", lv: 15, agg: 5, shape: "golem", elite: true, hpm: 12, atkm: 1.5, defm: 1.8, spdm: 0.7, respawn: 240 },
  e_bandit: { name: "山賊頭子", lv: 17, agg: 6, shape: "bandit", elite: true, hpm: 9, atkm: 1.7, defm: 1.35, respawn: 240 },
  e_zombie: { name: "殭屍將軍", lv: 22, agg: 6, shape: "zombie", elite: true, hpm: 11, atkm: 1.6, defm: 1.4, spdm: 0.8, respawn: 240 },
  e_terra: { name: "千年陶將", lv: 24, agg: 5, shape: "terra", elite: true, hpm: 11, atkm: 1.6, defm: 1.8, spdm: 0.85, respawn: 240 },
  e_scorp: { name: "屍蠍后", lv: 26, agg: 6, shape: "scorp", elite: true, hpm: 9, atkm: 1.75, defm: 1.4, respawn: 240 },
  e_snowfox: { name: "九命雪狐", lv: 31, agg: 6, shape: "snowfox", elite: true, hpm: 9, atkm: 1.7, defm: 1.35, spdm: 1.3, respawn: 240 },
  e_yeti: { name: "雪猿王", lv: 33, agg: 5, shape: "yeti", elite: true, hpm: 12, atkm: 1.6, defm: 1.6, spdm: 0.85, respawn: 240 },
  e_assassin: { name: "雪衣刺客首領", lv: 35, agg: 7, shape: "assassin", elite: true, hpm: 9, atkm: 1.85, defm: 1.35, spdm: 1.3, respawn: 240 },
  e_salamander: { name: "火蜥王", lv: 41, agg: 6, shape: "salamander", elite: true, hpm: 10, atkm: 1.7, defm: 1.4, respawn: 240 },
  e_lavagolem: { name: "熔岩巨靈", lv: 44, agg: 5, shape: "lavagolem", elite: true, hpm: 13, atkm: 1.6, defm: 1.9, spdm: 0.65, respawn: 240 },
  e_fireimp: { name: "赤焰鬼王", lv: 46, agg: 7, shape: "fireimp", elite: true, hpm: 9, atkm: 1.9, defm: 1.4, spdm: 1.2, respawn: 240 },
  e_bat: { name: "血蝠王", lv: 51, agg: 7, shape: "bat", elite: true, hpm: 9, atkm: 1.8, defm: 1.4, spdm: 1.4, respawn: 240 },
  e_shadow: { name: "影武者頭目", lv: 54, agg: 7, shape: "shadow", elite: true, hpm: 10, atkm: 1.9, defm: 1.45, spdm: 1.3, respawn: 240 },
  e_general: { name: "魔教護法", lv: 56, agg: 6, shape: "general", elite: true, hpm: 13, atkm: 1.8, defm: 1.8, spdm: 0.85, respawn: 240 },
};
export const monStats = (k) => monStatsDef(MONS[k]);
export function monStatsDef(d) {
  const L = d.lv;
  return {
    hp: Math.round((40 + 22 * L + 0.3 * L * L) * (d.hpm || 1)),
    atk: Math.round((6 + 2.6 * L) * (d.atkm || 1)),
    def: Math.round((1 + 1.1 * L) * (d.defm || 1)),
    exp: Math.round((expNeed(L) / 18) * (d.boss ? 25 : d.elite ? 6 : (d.hpm || 1))),
    gold: d.boss ? 30 * L : d.elite ? 8 * L : Math.max(1, Math.round(0.7 * L + 1)),
    spd: 2.2 * (d.spdm || 1),
    aspd: d.boss ? 1.6 : 1.5,
  };
}

// ---------------------------------------------------------------- 地圖
// 地圖用固定種子產生（每次開伺服器都一樣）。spawns：[怪物, 數量]；portals：走到那一格就傳送
export const MAPS = {
  town: { name: "長安城", w: 48, h: 36, seed: 11, town: true, theme: "town", spawns: [], layout: true,
    portals: [{ x: 47, y: 17, to: "bamboo", tx: 2, ty: 25, label: "竹林 →" }] },
  bamboo: { name: "竹林", w: 70, h: 50, seed: 23, theme: "bamboo", lvl: "1–8 級",
    spawns: [["rat", 15], ["hare", 14], ["snake", 12], ["monkey", 10]], boss: "b_bamboo", elites: ["e_rat", "e_hare", "e_monkey"],
    portals: [{ x: 0, y: 25, to: "town", tx: 45, ty: 17, label: "← 長安城" }, { x: 69, y: 27, to: "mount", tx: 2, ty: 29, label: "荒山 →" }] },
  mount: { name: "荒山", w: 74, h: 54, seed: 37, theme: "mount", lvl: "8–16 級",
    spawns: [["wolf", 15], ["golem", 12], ["vulture", 12], ["bandit", 12]], boss: "b_tiger", elites: ["e_wolf", "e_golem", "e_bandit"],
    portals: [{ x: 0, y: 29, to: "bamboo", tx: 67, ty: 27, label: "← 竹林" }, { x: 73, y: 25, to: "tomb", tx: 2, ty: 26, label: "古墓 →" }] },
  tomb: { name: "古墓", w: 72, h: 52, seed: 53, theme: "tomb", lvl: "16–25 級",
    spawns: [["zombie", 15], ["wisp", 12], ["terra", 12], ["scorp", 12]], boss: "b_corpse", elites: ["e_zombie", "e_terra", "e_scorp"],
    portals: [{ x: 0, y: 26, to: "mount", tx: 71, ty: 25, label: "← 荒山" }, { x: 71, y: 24, to: "snow", tx: 2, ty: 26, label: "雪嶺 →" }] },
  snow: { name: "雪嶺", w: 72, h: 52, seed: 61, theme: "snow", lvl: "25–35 級",
    spawns: [["snowfox", 15], ["yeti", 12], ["iceghost", 12], ["assassin", 12]], boss: "b_snow", elites: ["e_snowfox", "e_yeti", "e_assassin"],
    portals: [{ x: 0, y: 26, to: "tomb", tx: 69, ty: 24, label: "← 古墓" }, { x: 71, y: 28, to: "fire", tx: 2, ty: 28, label: "火焰山 →" }] },
  fire: { name: "火焰山", w: 76, h: 56, seed: 71, theme: "fire", lvl: "35–45 級",
    spawns: [["salamander", 15], ["firecrow", 12], ["lavagolem", 12], ["fireimp", 12]], boss: "b_qilin", elites: ["e_salamander", "e_lavagolem", "e_fireimp"],
    portals: [{ x: 0, y: 28, to: "snow", tx: 69, ty: 28, label: "← 雪嶺" }, { x: 75, y: 26, to: "demon", tx: 2, ty: 28, label: "魔教總壇 →" }] },
  demon: { name: "魔教總壇", w: 76, h: 56, seed: 83, theme: "demon", lvl: "45–55 級",
    spawns: [["cultist", 15], ["bat", 12], ["shadow", 12], ["general", 12]], boss: "b_lord", elites: ["e_bat", "e_shadow", "e_general"],
    portals: [{ x: 0, y: 28, to: "fire", tx: 73, ty: 26, label: "← 火焰山" }, { x: 75, y: 28, to: "sea", tx: 2, ty: 28, label: "東海龍宮 →" }] },
  sea: { name: "東海龍宮", w: 76, h: 56, seed: 97, theme: "sea", lvl: "60–70 級",
    spawns: [["shrimp", 15], ["crab", 12], ["merman", 12], ["yaksha", 12]], boss: "b_dragon", elites: ["e_shrimp", "e_crab", "e_yaksha"],
    portals: [{ x: 0, y: 28, to: "demon", tx: 73, ty: 28, label: "← 魔教總壇" }, { x: 75, y: 27, to: "kunlun", tx: 2, ty: 28, label: "崑崙仙山 →" }] },
  kunlun: { name: "崑崙仙山", w: 76, h: 56, seed: 101, theme: "kunlun", lvl: "70–80 級",
    spawns: [["crane", 14], ["ape", 13], ["jadegolem", 12], ["daoist", 12]], boss: "b_kaiming", elites: ["e_crane", "e_jadegolem", "e_daoist"],
    portals: [{ x: 0, y: 28, to: "sea", tx: 73, ty: 27, label: "← 東海龍宮" }, { x: 75, y: 29, to: "hell", tx: 2, ty: 28, label: "幽冥地府 →" }] },
  hell: { name: "幽冥地府", w: 76, h: 56, seed: 113, theme: "hell", lvl: "80–90 級",
    spawns: [["ghostsoldier", 15], ["oxhead", 12], ["horseface", 12], ["wraith", 12]], boss: "b_yama", elites: ["e_oxhead", "e_horseface", "e_wraith"],
    portals: [{ x: 0, y: 28, to: "kunlun", tx: 73, ty: 29, label: "← 崑崙仙山" }, { x: 75, y: 27, to: "heaven", tx: 2, ty: 28, label: "九重天宮 →" }] },
  heaven: { name: "九重天宮", w: 76, h: 56, seed: 127, theme: "heaven", lvl: "90–100 級",
    spawns: [["soldier", 15], ["leigong", 12], ["tianjiang", 12], ["jinjia", 12]], boss: "b_erlang", elites: ["e_leigong", "e_tianjiang", "e_jinjia"],
    portals: [{ x: 0, y: 28, to: "hell", tx: 73, ty: 27, label: "← 幽冥地府" }] },
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
  { id: "n_guide", name: "說書人", x: 33.5, y: 31, kind: "guide", say: "往東出城是竹林，再往東是荒山、古墓，古墓再過去是雪嶺、火焰山，最深處是魔教總壇。各處都有一隻大王，還有三隻小王守在自己的地盤，記得找人一起打。魔教總壇再往東，是東海龍宮、崑崙仙山、幽冥地府，最上面是九重天宮。" },
  { id: "n_post", name: "驛站・車夫", x: 42.5, y: 16.6, kind: "post", say: "客官要去哪？去過的地方，我都送得到。" },
  { id: "n_tower", name: "鎖妖塔・守塔人", x: 5.5, y: 22, kind: "tower", say: "塔裡鎮著上千妖魔，最上層是九尾妖狐。組好隊再進去。" },
  { id: "n_arena", name: "擂台主", x: 18.2, y: 14.6, kind: "arena", say: "想切磋？在城裡點別人選「擂台切磋」，我來當公證。" },
  { id: "n_bounty", name: "懸賞榜・捕快", x: 29.2, y: 14.6, kind: "bounty", say: "最近城外不太平，幫忙除掉一些妖物，官府有賞。" },
  { id: "n_rank", name: "江湖榜", x: 20.2, y: 14.5, kind: "rank", say: "江湖兒女，名字刻上石碑，流傳千古。" },
];
// 主城格局：建築（擋路，各有自己的圖）、裝飾（block＝擋路）、擂台木台的位置、路
export const TOWN = {
  roads: [[1, 17, 46, 18], [23, 8, 24, 33], [3, 10, 44, 11], [3, 32, 44, 33], [5, 19, 6, 23],
    // 每棟建築門口的鋪面，接到街上
    [4, 9, 7, 9], [11, 9, 14, 9], [20, 8, 27, 8], [33, 9, 36, 9], [40, 9, 43, 9], [4, 30, 7, 31], [11, 30, 14, 31], [32, 30, 35, 31], [41, 16, 43, 16], [3, 21, 7, 21]],
  plaza: { x: 23.5, y: 17.5, r: 4.6 },
  pond: { x: 40.5, y: 22, r: 2.1 },
  buildings: [
    { x0: 3, y0: 3, x1: 8, y1: 8, art: "t_bank" }, { x0: 10, y0: 3, x1: 15, y1: 8, art: "t_store" },
    { x0: 19, y0: 2, x1: 28, y1: 7, art: "t_temple" }, { x0: 32, y0: 3, x1: 37, y1: 8, art: "t_inn" }, { x0: 39, y0: 3, x1: 44, y1: 8, art: "t_forge" },
    { x0: 3, y0: 25, x1: 8, y1: 29, art: "t_herb" }, { x0: 10, y0: 25, x1: 15, y1: 29, art: "t_casino" },
    { x0: 31, y0: 25, x1: 36, y1: 29, art: "t_tea" }, { x0: 40, y0: 12, x1: 44, y1: 15, art: "t_stable" },
    { x0: 3, y0: 13, x1: 7, y1: 20, art: "t_pagoda", tall: 1 },
  ],
  stage: { x0: 9, y0: 12, x1: 16, y1: 16 },
  deco: [
    ["e_cauldron", 23.5, 15.2, 1.9, 1.9, 0], ["d_stelebase", 20.2, 13.9, 0, 0, 1], ["d_notice", 29.2, 13.8, 1.8, 1.9, 1],
    ["d_well", 20, 21.6, 1.5, 1.6, 1], ["d_willow", 18.6, 27.6, 2.8, 3.6, 1], ["d_willow", 28.6, 27.6, 2.8, 3.6, 1], ["d_willow", 1.8, 11.5, 2.6, 3.4, 1],
    ["d_tree", 37.6, 14.6, 3.2, 3.8, 1], ["d_tree", 10.6, 22.6, 3, 3.6, 1],
    ["d_lion", 45.2, 15.6, 1.3, 1.5, 1], ["d_lion", 45.2, 20.6, 1.3, 1.5, 1],
    ["d_lamp", 8.4, 16.4, 0.9, 2.2, 1], ["d_lamp", 16, 19.8, 0.9, 2.2, 1], ["d_lamp", 31, 16.2, 0.9, 2.2, 1], ["d_lamp", 37, 19.8, 0.9, 2.2, 1], ["d_lamp", 38.8, 16.2, 0.9, 2.2, 1], ["d_lamp", 22, 31.2, 0.9, 2.2, 1], ["d_lamp", 26, 31.2, 0.9, 2.2, 1],
    ["d_cart", 33.8, 14.8, 1.8, 1.5, 1], ["d_crates", 16.8, 9.4, 1.6, 1.5, 1], ["d_crates", 30.4, 22.2, 1.6, 1.5, 1], ["d_crates", 45, 9.4, 1.5, 1.4, 1],
    ["d_table", 36.6, 22.4, 2, 1.8, 1], ["d_table", 29.6, 31, 2, 1.8, 1],
    ["d_flowers", 20.6, 9.4, 1.4, 1.1, 0], ["d_flowers", 29.4, 9.4, 1.4, 1.1, 0], ["d_flowers", 8.8, 31.4, 1.3, 1.1, 0], ["d_flowers", 37.6, 31.4, 1.3, 1.1, 0],
    ["d_dicetable", 16.6, 30.8, 1.8, 1.5, 1], ["e_plum1", 26.6, 21.8, 2.2, 2.6, 1], ["e_plum2", 2.2, 24, 2.2, 2.6, 1],
    ["d_willow", 41.6, 28.4, 2.8, 3.6, 1], ["d_table", 39.4, 30.6, 2, 1.8, 1], ["d_flowers", 43.6, 30.8, 1.3, 1.1, 0],
  ],
  // 城裡走來走去的路人（只在畫面上，沒有互動）
  folk: ["f_vendor", "f_child", "f_scholar", "f_lady", "f_old", "f_monk", "f_cat", "f_dog", "f_chicken", "f_child", "f_scholar"],
};
export const TOWN_SPAWN = { x: 23.5, y: 20.5 };
// 驛站傳送：去過的地圖才能傳，到不同地圖的車資（回長安城免費）
export const WARP_COST = { town: 0, bamboo: 10, mount: 30, tomb: 60, snow: 100, fire: 160, demon: 240, sea: 320, kunlun: 400, hell: 480, heaven: 560 };

// ---------------------------------------------------------------- 裝備
export const SLOTS = { weapon: "武器", helm: "頭冠", armor: "衣服", belt: "腰帶", boots: "鞋子", acc: "飾品", ring: "戒指" };
export const TIERS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];         // 裝備等級（需求等級）
const WNAME = {
  sword: ["木劍", "青銅劍", "精鋼劍", "龍泉劍", "湛盧劍", "軒轅劍", "寒霜劍", "赤霄劍", "七星劍", "太阿劍", "純鈞劍", "誅仙劍", "龍吟劍", "斬蛟劍", "崑崙劍", "太虛劍", "幽冥劍", "斬魂劍", "天罡劍", "紫微劍"],
  mage: ["桃木杖", "青竹杖", "紫檀杖", "玄鐵杖", "崑崙杖", "太乙杖", "冰魄杖", "朱雀杖", "九霄杖", "伏魔杖", "通天杖", "混元杖", "龍骨杖", "鮫珠杖", "崑崙仙杖", "太虛杖", "幽冥杖", "攝魂杖", "天罡杖", "紫微杖"],
  archer: ["竹弓", "牛角弓", "鐵胎弓", "雕翎弓", "落日弓", "射天弓", "霜月弓", "烈陽弓", "穿雲弓", "破軍弓", "驚鴻弓", "后羿弓", "龍筋弓", "射蛟弓", "崑崙弓", "太虛弓", "幽冥弓", "追魂弓", "天罡弓", "紫微弓"],
};
const ANAME = ["布衣", "皮甲", "鎖子甲", "明光鎧", "山文甲", "金縷衣", "雪蠶衣", "火浣袍", "玄武甲", "麒麟鎧", "天蠶寶衣", "混元戰甲", "龍鱗甲", "鮫綃衣", "崑崙仙衣", "太虛道袍", "幽冥鎧", "閻羅袍", "天王甲", "紫微帝袍"];
const CNAME = ["草繩結", "銅錢串", "玉佩", "護身符", "夜明珠", "崑崙玉", "冰心玉", "火龍珠", "定海珠", "如意環", "舍利子", "女媧石", "龍珠", "避水珠", "崑崙仙玉", "太虛玉", "幽冥珠", "往生石", "天罡印", "紫微星"];
const HNAME = ["布巾", "皮帽", "銅盔", "鐵盔", "明光盔", "紫金冠", "雪蠶冠", "赤炎冠", "玄武盔", "麒麟盔", "天蠶冠", "混元冠", "龍鱗盔", "蛟龍冠", "崑崙玉冠", "仙鶴冠", "幽冥盔", "判官冠", "天王盔", "紫微帝冠"];
const BNAME = ["麻繩", "皮帶", "銅扣帶", "鐵環帶", "錦帶", "玉帶", "冰絲帶", "火鱗帶", "玄武帶", "麒麟帶", "天蠶帶", "混元帶", "龍筋帶", "鮫綃帶", "崑崙帶", "仙絛", "冥河帶", "黃泉帶", "天罡帶", "紫微帶"];
const SNAME = ["草鞋", "布鞋", "皮靴", "鐵靴", "快靴", "踏雲靴", "雪地靴", "火雲靴", "玄武靴", "麒麟靴", "天蠶靴", "混元靴", "分水靴", "踏浪靴", "凌雲靴", "步虛履", "冥行靴", "渡川靴", "天行靴", "紫微履"];
const GNAME = ["銅戒", "銀戒", "玉戒", "翡翠戒", "瑪瑙戒", "紫金戒", "冰魄戒", "赤焰戒", "玄冰戒", "麒麟戒", "鳳血戒", "混元戒", "龍珠戒", "鮫淚戒", "崑崙戒", "仙玉戒", "幽魂戒", "閻羅戒", "天罡戒", "紫微戒"];
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
  // 特效詞條（sp）：只出在精良以上，稀有、傳說比較常見
  ls: { name: "吸血%", sp: 1, v: (t) => Math.max(1, Math.round(1 + t / 30)) },
  thorn: { name: "反傷%", sp: 1, v: (t) => Math.round(4 + t / 8) },
  cdmg: { name: "暴擊傷害%", sp: 1, v: (t) => Math.round(8 + t / 2.5) },
  dodge: { name: "閃避%", sp: 1, v: (t) => Math.max(1, Math.round(2 + t / 25)) },
  ms: { name: "移速%", sp: 1, v: (t) => Math.round(3 + t / 15) },
  pen: { name: "破甲%", sp: 1, v: (t) => Math.round(5 + t / 5) },
  cdr: { name: "冷卻縮減%", sp: 1, v: (t) => Math.max(2, Math.round(3 + t / 18)) },
};
// 單一技能冷卻詞條（cd_技能id）：稀有、傳說裝備有機會多出一行「某招冷卻 -X%」，招式從撿到的人自己職業的技能裡抽；同一招最多 -max%
export const SKCD = { max: 50, v: (t) => Math.round(10 + t / 6), p: [0, 0.08, 0.25, 0.55] };
// 某職業（基本職業 key）所有學得到的技能：基本＋兩種一轉＋四種二轉
export const classSkills = (cls) => [...(SKILLS[cls] || []), ...Object.entries(ADV).filter(([, a]) => a.base === cls).flatMap(([k]) => [...(ADV_SKILLS[k] || []), ...Object.entries(ADV2).filter(([, b]) => b.base === k).flatMap(([k2]) => ADV2_SKILLS[k2] || [])])];
export const STAT_NAME = { atk: "攻擊", def: "防禦", hp: "生命", mp: "法力", crit: "暴擊%", aspd: "攻速%", ls: "吸血%", thorn: "反傷%", cdmg: "暴擊傷害%", dodge: "閃避%", ms: "移速%", pen: "破甲%", cdr: "冷卻縮減%" };
// 這些數值是「百分點」直接相加（套裝加成也是加），而且有上限
export const ADD_STAT = { crit: 60, aspd: 200, ls: 15, thorn: 60, cdmg: 150, dodge: 30, ms: 40, pen: 60, cdr: 35 };
// 掉寶時各部位的比重
export const SLOT_W = { weapon: 2, helm: 1.2, armor: 2, belt: 1, boots: 1.2, acc: 1, ring: 1 };
export function baseItem(slot, tier, cls) {
  const ti = TIERS.indexOf(tier), t = tier;
  if (slot === "weapon") return { name: WNAME[cls][ti], st: { atk: Math.round(4 + 3 * t) } };
  if (slot === "armor") return { name: ANAME[ti], st: { def: Math.round(2 + 1.6 * t), hp: Math.round(10 + 6 * t) } };
  if (slot === "helm") return { name: HNAME[ti], st: { def: Math.round(1 + 0.9 * t), hp: Math.round(6 + 3.5 * t) } };
  if (slot === "belt") return { name: BNAME[ti], st: { hp: Math.round(10 + 5 * t), mp: Math.round(4 + 2 * t) } };
  if (slot === "boots") return { name: SNAME[ti], st: { def: Math.round(1 + 0.6 * t), hp: Math.round(5 + 2.5 * t), ms: 3 + Math.floor(t / 12) } };
  if (slot === "ring") return { name: GNAME[ti], st: { atk: Math.round(2 + 1.4 * t), crit: 1 + Math.floor(t / 12) } };
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
  hp5: { name: "蟠桃仙露", hp: 4000, price: 420, lv: 60 },
  mp4: { name: "瑤池玉液", mp: 900, price: 220, lv: 60 },
  hp6: { name: "太上金丹", hp: 9000, price: 900, lv: 80 },
  mp5: { name: "九天甘霖", mp: 1800, price: 450, lv: 80 },
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
export const BANK_DAILY_OUT = 200000;   // 每人（整個帳號）每天最多把多少兩換成代幣（防止打怪印鈔）；超過的部分再扣「歷史存入」額度
export const BANK_MAX_IN = 1000000;     // 代幣換銀兩：單次最多換多少
export const INV_MAX = 30;
// 行囊擴充：每次 +10 格，最多 80 格；銀兩一次比一次貴
export const BAG_UP = { step: 10, max: 80, cost: [3000, 10000, 30000, 80000, 200000] };
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
// 擂台（PVP）：這遊戲攻擊相對血量很高，照打怪的公式會一招秒人，所以 PVP 另外壓：
// dmg＝傷害係數；crit＝PVP 暴擊倍數（暴傷詞條只算一半）；cap／capAtk＝技能／普攻單下最多打掉對方最大血量的幾成
// burst／win：同一個人 win 毫秒內最多被打掉 burst 成血，超過的部分只算 over（連放一堆技能也不會瞬間打死）
export const ARENA = { countdown: 3, time: 3 * 60, dmg: 0.1, crit: 1.4, cap: 0.12, capAtk: 0.06, burst: 0.15, win: 2000, over: 0.2, w: 34, h: 24 };

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

// 掉落物：打倒的人（和隊友）先保留幾秒，地上留多久
export const LOOT_OWN = 30;
export const LOOT_TTL = 120;

// ---------------------------------------------------------------- 副本
// 難度：怪的血量、攻擊倍數，進場等級要比副本基本等級多幾級；掉寶：套裝機率、傳說機率、最低品質
export const DIFF = [
  { k: "n", name: "普通", hp: 1, atk: 1, lv: 0, setP: 15, legend: 6, rarMin: 1, mats: 1 },
  { k: "h", name: "困難", hp: 1.8, atk: 1.35, lv: 5, setP: 35, legend: 14, rarMin: 2, mats: 2 },
  { k: "x", name: "地獄", hp: 3, atk: 1.8, lv: 10, setP: 60, legend: 28, rarMin: 2, mats: 3 },
];
// kind：trap＝陷阱闖關、phase＝王分階段、race＝岩漿追趕、raid＝團隊王（分身＋全場大招）
export const DUNGEONS = {
  crypt: { name: "古墓機關", lv: 20, map: "tomb", theme: "tomb", kind: "trap", set: "corpse", daily: 0, w: 74, h: 15,
    mobs: ["zombie", "terra", "wisp", "scorp"], boss: "b_corpse", bossName: "屍王真身", say: "墓裡機關還會動，進去的人十個回來三個。",
    desc: "一路往古墓深處闖：地上有箭陣、滾石、毒氣，地面先亮警示再觸發，看準了再過。最深處是屍王真身。" },
  icepal: { name: "雪嶺冰宮", lv: 35, map: "snow", theme: "snow", kind: "phase", set: "frost", daily: 0, w: 30, h: 22,
    mobs: ["iceghost", "snowfox"], boss: "b_snow", bossName: "冰宮之主", say: "冰宮的門開了，裡頭冷得連刀都會黏手。",
    desc: "冰宮之主有三個階段：血量 70% 開始召喚冰魄、地上冒出冰封區（踩到會緩速扣血）；35% 以下狂暴，重擊又快又痛。" },
  lavacave: { name: "火焰山熔洞", lv: 45, map: "fire", theme: "fire", kind: "race", set: "flame", daily: 0, w: 84, h: 13, time: 150,
    mobs: ["salamander", "fireimp", "lavagolem", "firecrow"], say: "熔洞裡的岩漿會追人，跑得慢就別進去。",
    desc: "岩漿從後面慢慢漫上來，被追上就會一直燙傷。一路往右衝，出口前的熔岩守將打倒才能出去，越快逃出去獎勵越好。" },
  sanctum: { name: "魔教秘境", lv: 55, map: "demon", theme: "demon", kind: "raid", set: "demon", daily: 0, w: 32, h: 24,
    mobs: ["shadow", "cultist"], boss: "b_lord", bossName: "魔教教主", say: "教主閉關的秘境，一個人進去就是送死。",
    desc: "最難的團隊王，建議 3～4 人。66% 召喚兩個分身（分身活著時教主幾乎打不動）；33% 以下每隔一段時間放「天魔解體」，只有亮起的安全圈裡不會被打中。" },
  crystal: { name: "龍宮・水晶宮", lv: 65, map: "sea", theme: "sea", kind: "tide", set: "sea", daily: 0, w: 32, h: 24,
    mobs: ["shrimp", "crab", "merman"], boss: "b_dragon", bossName: "東海龍王敖廣", say: "龍宮的大潮一來，站錯地方就會被沖走。",
    desc: "龍王坐鎮水晶宮。每隔一段時間大潮淹過整個大殿，只有四座珊瑚台安全——看到金色圈就跑上去；龍王血越少，潮來得越快。" },
  yaochi: { name: "崑崙・瑤池仙境", lv: 75, map: "kunlun", theme: "kunlun", kind: "waves", set: "kunlun", daily: 0, w: 30, h: 22, waves: 4,
    mobs: ["crane", "ape", "jadegolem", "daoist"], boss: "b_kaiming", bossName: "瑤池守護開明獸", say: "瑤池的守山妖獸一波接一波，撐得住才見得到開明獸。",
    desc: "守住瑤池：妖獸會一波一波從四周衝進來，撐過四波之後，開明獸親自現身。" },
  hell18: { name: "地府・十八層地獄", lv: 85, map: "hell", theme: "hell", kind: "trap", set: "hell", daily: 0, w: 80, h: 15,
    mobs: ["ghostsoldier", "oxhead", "horseface", "wraith"], boss: "b_yama", bossName: "閻羅天子", say: "十八層地獄，一層比一層深，走到底才見得到閻羅。",
    desc: "一路往地獄深處走：鬼箭、滾石、毒瘴，地面先亮警示再觸發。最深處是閻羅天子。" },
  lingxiao: { name: "天宮・凌霄寶殿", lv: 95, map: "heaven", theme: "heaven", kind: "raid", set: "heaven", daily: 0, w: 32, h: 24,
    mobs: ["soldier", "tianjiang", "jinjia"], boss: "b_erlang", bossName: "真君二郎神", cloneName: "二郎神法相",
    msg2: "二郎神：「法天象地！」——先打掉兩尊法相，法相還在時真君幾乎打不動。", msg3: "二郎神：「天眼開！」——看到金色安全圈就躲進去！", say: "凌霄寶殿上，二郎真君等著擅闖天庭的人。",
    desc: "最後的團隊王，建議 3～4 人。66% 現出兩尊法相（法相活著時真君幾乎打不動）；33% 以下每隔一段時間天眼全開，只有亮起的安全圈裡不會被打中。" },
};
export const DG_DAILY_ALL = true;      // 每個副本各自算次數（帳號共用）
// 套裝：每個副本一套（武器、衣服、飾品），穿 2 件、3 件有加成。hp/atk/def/mp 是百分比，crit/aspd 直接加
// ch：套裝印章上的字；area：哪個地區；col：印章／分類用的顏色（各地區分得出來）
export const SETS = {
  corpse: { ch: "屍", area: "古墓", col: "#6e6250", name: "屍王", from: "古墓機關・古墓屍王", b2: { hp: 0.1 }, b3: { def: 0.15, hp: 0.1 }, b5: { ls: 3, thorn: 15 }, d2: "生命 +10%", d3: "防禦 +15%、生命再 +10%", d5: "吸血 +3%、反傷 +15%" },
  frost: { ch: "寒", area: "雪嶺", col: "#4f93c2", name: "寒魄", from: "雪嶺冰宮・雪嶺雪妖", b2: { crit: 8 }, b3: { atk: 0.12, crit: 4 }, b5: { cdmg: 30, pen: 10 }, d2: "暴擊 +8%", d3: "攻擊 +12%、暴擊再 +4%", d5: "暴擊傷害 +30%、破甲 +10%" },
  flame: { ch: "炎", area: "火焰山", col: "#cc4a26", name: "赤炎", from: "火焰山熔洞・火焰山麒麟", b2: { atk: 0.08 }, b3: { aspd: 15, atk: 0.07 }, b5: { aspd: 10, cdmg: 20 }, d2: "攻擊 +8%", d3: "攻速 +15%、攻擊再 +7%", d5: "攻速再 +10%、暴擊傷害 +20%" },
  demon: { ch: "魔", area: "魔教總壇", col: "#8e2a55", name: "天魔", from: "魔教秘境・魔教教主", b2: { atk: 0.1, crit: 5 }, b3: { atk: 0.1, hp: 0.12, crit: 5 }, b5: { ls: 4, pen: 20 }, d2: "攻擊 +10%、暴擊 +5%", d3: "攻擊、生命 +10%／+12%、暴擊再 +5%", d5: "吸血 +4%、破甲 +20%" },
  tower: { ch: "鎮", area: "鎖妖塔", col: "#55606c", name: "鎮妖", from: "鎖妖塔", b2: { mp: 0.2, def: 0.08 }, b3: { hp: 0.12, atk: 0.06 }, b5: { dodge: 8, thorn: 20 }, d2: "法力 +20%、防禦 +8%", d3: "生命 +12%、攻擊 +6%", d5: "閃避 +8%、反傷 +20%" },
  bamboo: { ch: "竹", area: "竹林", col: "#4d8a33", name: "竹影", from: "竹林竹妖", b2: { ms: 8 }, b3: { dodge: 5 }, b5: { aspd: 12, ms: 6 }, d2: "移速 +8%", d3: "閃避 +5%", d5: "攻速 +12%、移速再 +6%" },
  sea: { ch: "龍", area: "東海龍宮", col: "#17698a", name: "龍鱗", from: "東海龍王", b2: { hp: 0.12 }, b3: { def: 0.12, thorn: 10 }, b5: { ls: 3, thorn: 15 }, d2: "生命 +12%", d3: "防禦 +12%、反傷 +10%", d5: "吸血 +3%、反傷再 +15%" },
  kunlun: { ch: "崑", area: "崑崙仙山", col: "#2f9c86", name: "崑崙", from: "崑崙開明獸", b2: { mp: 0.2 }, b3: { atk: 0.1, cdmg: 15 }, b5: { aspd: 12, crit: 6, cdr: 10 }, d2: "法力 +20%", d3: "攻擊 +10%、暴擊傷害 +15%", d5: "攻速 +12%、暴擊 +6%、冷卻縮減 10%" },
  hell: { ch: "冥", area: "幽冥地府", col: "#4b3f7a", name: "幽冥", from: "幽冥閻羅王", b2: { pen: 10 }, b3: { atk: 0.12 }, b5: { ls: 5, cdmg: 25 }, d2: "破甲 +10%", d3: "攻擊 +12%", d5: "吸血 +5%、暴擊傷害 +25%" },
  heaven: { ch: "罡", area: "九重天宮", col: "#c99a1c", name: "天罡", from: "九重天宮二郎神", b2: { atk: 0.08, def: 0.08 }, b3: { hp: 0.15, crit: 6 }, b5: { cdmg: 40, pen: 15 }, d2: "攻擊、防禦 +8%", d3: "生命 +15%、暴擊 +6%", d5: "暴擊傷害 +40%、破甲 +15%" },
  tiger: { ch: "虎", area: "荒山", col: "#c26f12", name: "虎嘯", from: "荒山白額虎王", b2: { atk: 0.06 }, b3: { cdmg: 20 }, b5: { pen: 15, crit: 6 }, d2: "攻擊 +6%", d3: "暴擊傷害 +20%", d5: "破甲 +15%、暴擊 +6%" },
};
// 野外大王有機會掉的套裝
export const BOSS_SET = { b_bamboo: "bamboo", b_tiger: "tiger", b_corpse: "corpse", b_snow: "frost", b_qilin: "flame", b_lord: "demon", b_dragon: "sea", b_kaiming: "kunlun", b_yama: "hell", b_erlang: "heaven" };
export const BOSS_SET_P = 10;          // 每個分到獎勵的人各自 10% 機率
// 鎖妖塔（爬塔）：一層一層往上，每 5 層一隻王；層數越高怪越強
export const CLIMB = { daily: 3, time: 15 * 60, minLv: 20, mobs: 6, perFloor: 0.09, bosses: ["b_bamboo", "b_tiger", "b_corpse", "b_snow", "b_qilin", "b_lord", "b_fox", "b_dragon", "b_kaiming", "b_yama", "b_erlang"], setP: 30 };

// ---------------------------------------------------------------- 二轉（60 級，每個一轉再二選一）
// mod：在一轉的加成之上再乘（hp/mp/atk/def/aspd/spd 是倍數；crit/range 和特效數值直接加）
export const ADV2_LV = 60;
export const ADV2 = {
  sj: { base: "jx", name: "劍聖", desc: "劍意爆發、暴擊極高，近身一念千斬", mod: { atk: 1.1, crit: 6, cdmg: 25 } },
  tj: { base: "jx", name: "天劍", desc: "御使飛劍，遠遠就能殺敵，還能布下劍陣", mod: { atk: 1.08, range: 2, mp: 1.15 } },
  dh: { base: "bd", name: "刀皇", desc: "重刀開天，範圍大、血厚，霸體不怕控制", mod: { hp: 1.15, def: 1.15, atk: 1.06 } },
  xl: { base: "bd", name: "修羅", desc: "嗜血狂戰，招招吸血，越打越兇", mod: { atk: 1.12, ls: 5, aspd: 0.9 } },
  zr: { base: "ts", name: "真人", desc: "九霄雷法控場，太乙結界護住全隊", mod: { mp: 1.2, def: 1.12, hp: 1.1 } },
  tl: { base: "ts", name: "通靈", desc: "召喚神將一起作戰，鈴聲驅邪暈敵", mod: { hp: 1.12, mp: 1.15, atk: 1.04 } },
  yd: { base: "ft", name: "炎帝", desc: "火系極限爆發，一把火燒一座城", mod: { atk: 1.15, cdmg: 20 } },
  jy: { base: "ft", name: "九幽", desc: "幽冥鬼火、詛咒敵人，持續傷害打到死", mod: { atk: 1.08, pen: 15, mp: 1.1 } },
  jn: { base: "ss", name: "箭神", desc: "射程最遠、單發最痛，殘血一箭斃命", mod: { atk: 1.12, crit: 8, range: 2 } },
  pj: { base: "ss", name: "破軍", desc: "爆裂火箭、大範圍轟炸，清怪最快", mod: { atk: 1.1, aspd: 0.92 } },
  ys: { base: "ly", name: "影殺", desc: "隱身背刺的刺客，瞬間爆發", mod: { atk: 1.08, crit: 10, dodge: 8, ms: 8 } },
  jg: { base: "ly", name: "機關", desc: "放機關砲台、地雷陣，讓機關替你打", mod: { atk: 1.06, def: 1.1, hp: 1.08 } },
};
// 新機制：blink＝瞬移到目標身邊；drain＝這招傷害的幾 % 回血；exec：[血量低於, 傷害倍數]；curse：[受到傷害增加, 秒]
// pet：召喚物 { follow 跟著人／固定在原地, dur 秒, every 毫秒打一次, r 範圍, mult 倍數, n 一次打幾隻 }
export const ADV2_SKILLS = {
  sj: [
    { id: "jianyi", name: "劍意斬", lv: 60, mp: 50, cd: 8, type: "dir", range: 9, w: 1.8, spd: 22, mult: 5.5, pierce: true, desc: "一道巨大劍意往前斬，穿透 9 格內所有敵人（5.5 倍）" },
    { id: "wuwo", name: "無我劍域", lv: 70, mp: 70, cd: 16, type: "self", r: 3.6, mult: 1.6, hits: 6, desc: "身邊 3.6 格化成劍域，連斬 6 下（每下 1.6 倍）" },
    { id: "qianzhan", name: "一念千斬", lv: 80, mp: 90, cd: 20, type: "target", range: 7, mult: 1.15, hits: 9, blink: true, stun: 0.5, desc: "瞬間閃到目標身邊連斬 9 下（每下 1.15 倍），暈眩 0.5 秒" },
  ],
  tj: [
    { id: "feijian", name: "飛劍穿心", lv: 60, mp: 48, cd: 7, type: "dir", range: 12, w: 0.9, spd: 18, mult: 3.2, pierce: true, arrows: 3, spread: 22, desc: "三把飛劍扇形射出，穿透 12 格（每把 3.2 倍）" },
    { id: "jianzhen", name: "周天劍陣", lv: 70, mp: 80, cd: 24, type: "self", pet: { follow: true, dur: 10, every: 350, r: 7, mult: 2, n: 2 }, desc: "十秒內身邊環繞劍陣，每 0.35 秒自動刺 7 格內兩個敵人（2 倍）" },
    { id: "zhuxie", name: "天劍誅邪", lv: 80, mp: 95, cd: 18, type: "ground", range: 10, r: 3.8, mult: 7.5, delay: 0.7, stun: 1, desc: "一把擎天巨劍從天而降，範圍 3.8 格（7.5 倍），暈眩 1 秒" },
  ],
  dh: [
    { id: "kaitian", name: "開天斬", lv: 60, mp: 52, cd: 9, type: "dir", range: 9, w: 3, spd: 14, mult: 4.6, pierce: true, desc: "劈出一道開天巨浪，寬 3 格、穿透 9 格（4.6 倍）" },
    { id: "bati", name: "霸體", lv: 70, mp: 60, cd: 28, type: "self", r: 5, taunt: true, buff: ["bati", 10], desc: "十秒內受到的傷害減半、王的暈眩無效，並把 5 格內的怪全引過來" },
    { id: "duanyue", name: "斷嶽", lv: 80, mp: 95, cd: 18, type: "ground", range: 7, r: 3.6, mult: 6.5, leap: true, exec: [0.3, 2], desc: "躍起砸地，範圍 3.6 格（6.5 倍）；血量低於 30% 的敵人傷害加倍" },
  ],
  xl: [
    { id: "xuewu", name: "血刃亂舞", lv: 60, mp: 48, cd: 9, type: "self", r: 2.8, mult: 1.35, hits: 5, drain: 15, desc: "雙刀亂舞砍身邊 5 下（每下 1.35 倍），傷害的 15% 變成自己的血" },
    { id: "shura", name: "修羅化身", lv: 70, mp: 60, cd: 26, type: "self", buff: ["berserk", 8], desc: "八秒內攻擊 +40%、攻速 +20%、吸血 +10%" },
    { id: "tulu", name: "嗜血屠戮", lv: 80, mp: 85, cd: 16, type: "dir", range: 7, w: 1.6, mult: 5, dash: true, pierce: true, drain: 25, desc: "化成血影衝過去（5 倍），傷害的 25% 回血" },
  ],
  zr: [
    { id: "shenlei", name: "九霄神雷", lv: 60, mp: 60, cd: 10, type: "ground", range: 9, r: 3.4, mult: 2.1, ticks: 4, delay: 0.4, stun: 0.5, desc: "連降四道神雷，範圍 3.4 格（每道 2.1 倍），每道暈眩 0.5 秒" },
    { id: "jiejie", name: "太乙結界", lv: 70, mp: 90, cd: 30, type: "self", r: 6, heal: 0.25, pbuff: ["barrier", 10], desc: "自己和 6 格內的隊友回 25% 生命，十秒內受到的傷害減半" },
    { id: "leiyu", name: "天罡雷獄", lv: 80, mp: 110, cd: 22, type: "ground", range: 9, r: 4.5, mult: 1.7, ticks: 6, delay: 0.5, slow: [0.5, 3], desc: "雷獄籠罩 4.5 格，落雷 6 次（每次 1.7 倍），緩速 50%" },
  ],
  tl: [
    { id: "shenjiang", name: "召喚神將", lv: 60, mp: 70, cd: 22, type: "self", pet: { follow: true, dur: 15, every: 800, r: 5, mult: 2.2, n: 1 }, desc: "召喚金甲神將護身 15 秒，每 0.8 秒砍 5 格內的敵人（2.2 倍）" },
    { id: "quxie", name: "驅邪鈴", lv: 70, mp: 60, cd: 14, type: "self", r: 5, mult: 2.6, stun: 1.5, desc: "搖響驅邪鈴，震 5 格內所有敵人（2.6 倍），暈眩 1.5 秒" },
    { id: "wanling", name: "萬靈護體", lv: 80, mp: 100, cd: 30, type: "self", r: 6, heal: 0.4, pbuff: ["shield", 10], desc: "萬靈護體：自己和 6 格內的隊友回 40% 生命，十秒內受到的傷害減少 40%" },
  ],
  yd: [
    { id: "yanlong", name: "炎龍破", lv: 60, mp: 58, cd: 9, type: "dir", range: 11, w: 1.8, spd: 13, mult: 5, pierce: true, dot: [1.2, 3], desc: "放出炎龍燒穿 11 格（5 倍），之後 3 秒每秒再燒 1.2 倍" },
    { id: "baoyan", name: "爆炎", lv: 70, mp: 70, cd: 12, type: "target", range: 8, mult: 7.5, dot: [1.5, 4], desc: "在敵人身上引爆烈焰（7.5 倍），之後 4 秒每秒 1.5 倍" },
    { id: "fencheng", name: "天火焚城", lv: 80, mp: 120, cd: 24, type: "ground", range: 10, r: 5, mult: 2.2, ticks: 5, delay: 0.6, desc: "天火燒遍 5 格，燒 5 次（每次 2.2 倍）" },
  ],
  jy: [
    { id: "guihuo", name: "幽冥鬼火", lv: 60, mp: 52, cd: 8, type: "dir", range: 9, w: 0.8, spd: 12, mult: 1.9, arrows: 5, spread: 50, dot: [0.8, 4], desc: "扇形放出五團鬼火（每團 1.9 倍），之後 4 秒每秒 0.8 倍" },
    { id: "zuzhou", name: "九幽詛咒", lv: 70, mp: 70, cd: 18, type: "ground", range: 9, r: 3.5, mult: 1, curse: [0.3, 8], slow: [0.3, 4], desc: "詛咒 3.5 格內的敵人：八秒內受到的傷害 +30%，緩速 30%" },
    { id: "huangquan", name: "黃泉引", lv: 80, mp: 110, cd: 22, type: "ground", range: 9, r: 4, mult: 1.5, ticks: 6, delay: 0.3, dot: [1, 5], desc: "引黃泉之水 4 格，打 6 次（每次 1.5 倍），每次都留 5 秒毒傷" },
  ],
  jn: [
    { id: "guanri", name: "貫日箭", lv: 60, mp: 55, cd: 9, type: "dir", range: 16, w: 0.8, spd: 30, mult: 6.5, pierce: true, desc: "一箭貫日，射程 16 格、穿透所有敵人（6.5 倍）" },
    { id: "shenyan", name: "神眼", lv: 70, mp: 50, cd: 28, type: "self", buff: ["hawk", 10], desc: "十秒內暴擊率 +40%、暴擊傷害 +50%" },
    { id: "luori", name: "落日神箭", lv: 80, mp: 90, cd: 16, type: "target", range: 15, mult: 10, exec: [0.25, 2], desc: "對 15 格內的敵人射出落日神箭（10 倍）；血量低於 25% 傷害加倍" },
  ],
  pj: [
    { id: "baolie", name: "爆裂箭", lv: 60, mp: 50, cd: 7, type: "ground", range: 10, r: 2.8, mult: 4.5, delay: 0.3, desc: "爆裂火箭射到滑鼠位置炸開，範圍 2.8 格（4.5 倍）" },
    { id: "huoyu", name: "火雨連營", lv: 70, mp: 80, cd: 18, type: "ground", range: 11, r: 4.5, mult: 1.9, ticks: 5, delay: 0.5, dot: [0.6, 3], desc: "火箭雨轟炸 4.5 格，五波（每波 1.9 倍），燃燒 3 秒" },
    { id: "pojun", name: "破軍一擊", lv: 80, mp: 95, cd: 18, type: "dir", range: 12, w: 2.5, spd: 16, mult: 6, pierce: true, stun: 1, desc: "拉滿巨弓轟出破軍一箭，寬 2.5 格、穿透 12 格（6 倍），暈眩 1 秒" },
  ],
  ys: [
    { id: "yingdun", name: "影遁", lv: 60, mp: 40, cd: 18, type: "self", buff: ["stealth", 5], desc: "化入陰影五秒：怪物看不到你，下一擊必定暴擊且 2.5 倍傷害" },
    { id: "jueying", name: "絕影刺", lv: 70, mp: 60, cd: 10, type: "target", range: 6, mult: 2.3, hits: 3, blink: true, desc: "閃到目標身後連刺 3 下（每下 2.3 倍）" },
    { id: "qianying", name: "千影殺", lv: 80, mp: 95, cd: 20, type: "self", r: 4, mult: 1.25, hits: 8, desc: "分出千道影子，在身邊 4 格亂刺 8 下（每下 1.25 倍）" },
  ],
  jg: [
    { id: "paotai", name: "連弩砲台", lv: 60, mp: 60, cd: 20, type: "self", pet: { follow: false, dur: 15, every: 400, r: 6, mult: 0.9, n: 1 }, desc: "在腳下架一座連弩砲台 15 秒，每 0.4 秒射 6 格內的敵人（0.9 倍）" },
    { id: "dilei", name: "地雷陣", lv: 70, mp: 65, cd: 14, type: "ground", range: 8, r: 3.2, mult: 5, delay: 1.2, stun: 1.2, desc: "在滑鼠位置埋地雷，1.2 秒後炸開（5 倍），暈眩 1.2 秒" },
    { id: "qianji", name: "千機弩陣", lv: 80, mp: 100, cd: 26, type: "self", pet: { follow: false, dur: 12, every: 250, r: 7, mult: 0.8, n: 2, slow: [0.3, 1] }, desc: "架起千機弩陣 12 秒，每 0.25 秒射 7 格內兩個敵人（0.8 倍）並緩速" },
  ],
};
