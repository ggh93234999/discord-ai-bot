// 台灣 16 張麻將計台。牌桌流程在 mahjong.js，牌的編碼和拆牌在 mjcore.js。
// 莊家、連莊的台數跟「誰付錢」有關，在 mahjong.js 結算時另外加（dealerTai）。
import { toCounts, decomps, isHonor, isDragon, isWind, suitOf, numOf } from "./mjcore.js";
import { meldSet } from "./mjjp.js";

const isTrip = (s) => s.k === "pung" || s.k === "kan";

// 莊家 1 台；連 N 拉 N：再加 2N 台（只有莊家胡牌或莊家付錢時才算）
export function dealerTai(lian) { const l = [["莊家", 1]]; if (lian > 0) l.push([`連${lian}拉${lian}`, lian * 2]); return l; }

// ctx：hand（含胡的那張）、melds、win、tsumo、seatW、roundW（0~3，門風／圈風）、flowers、haitei、houtei、rinshan、chankan、tenhou、chiihou、waitsN（聽幾種牌）
// 回傳 null（不是胡牌形）或 { tai, list: [[名稱, 台]] }（0 台也可以胡，俗稱屁胡）
export function scoreTW(ctx) {
  const c = toCounts(ctx.hand);
  const mSets = ctx.melds.map(meldSet);
  const exposed = ctx.melds.filter((m) => m.k !== "ankan").length;
  const menqing = exposed === 0;
  const allTiles = [...ctx.hand, ...ctx.melds.flatMap((m) => m.tiles)];
  const suits = new Set(allTiles.filter((t) => !isHonor(t)).map(suitOf));
  const hasHonor = allTiles.some(isHonor);
  const seatT = 27 + ctx.seatW, roundT = 27 + ctx.roundW;
  let best = null;

  for (const d of decomps(c)) {
    if (d.sets.length + mSets.length !== 5) continue;
    const places = [];
    if (d.pair === ctx.win) places.push({ at: -1, wait: "tanki" });
    d.sets.forEach((s, i) => {
      if (s.k === "pung" && s.t === ctx.win) places.push({ at: i, wait: "shanpon" });
      if (s.k === "chow" && ctx.win >= s.t && ctx.win <= s.t + 2) {
        const pos = ctx.win - s.t, n = numOf(s.t);
        places.push({ at: i, wait: pos === 1 ? "kanchan" : (pos === 2 && n === 1) || (pos === 0 && n === 7) ? "penchan" : "ryanmen" });
      }
    });
    for (const pl of places) {
      const sets = [...d.sets.map((s, i) => ({ ...s, open: false, ronDone: !ctx.tsumo && i === pl.at && s.k === "pung" })), ...mSets];
      const list = [];
      const add = (n, v) => list.push([n, v]);
      if (ctx.tenhou) add("天胡", 24);
      if (ctx.chiihou) add("地胡", 16);
      if (menqing && ctx.tsumo) add("門清自摸", 3);
      else if (menqing) add("門清", 1);
      else if (ctx.tsumo) add("自摸", 1);
      const trips = sets.filter(isTrip), chows = sets.filter((s) => s.k === "chow");
      const dragonTrips = trips.filter((s) => isDragon(s.t)).length, windTrips = trips.filter((s) => isWind(s.t)).length;
      const allHonor = allTiles.every(isHonor);
      // 三元牌
      if (dragonTrips === 3) add("大三元", 8);
      else if (dragonTrips === 2 && isDragon(d.pair)) add("小三元", 4);
      else for (const s of trips) if (isDragon(s.t)) add(["白板", "青發", "紅中"][s.t - 31], 1);
      // 風牌
      if (windTrips === 4) add("大四喜", 16);
      else if (windTrips === 3 && isWind(d.pair)) add("小四喜", 8);
      else for (const s of trips) {
        if (s.t === roundT) add("圈風", 1);
        if (s.t === seatT) add("門風", 1);
      }
      // 花色
      if (allHonor) add("字一色", 16);
      else if (!hasHonor && suits.size === 1) add("清一色", 8);
      else if (hasHonor && suits.size === 1) add("混一色", 4);
      // 刻子
      if (trips.length === 5 && !allHonor) add("碰碰胡", 4);
      const conc = trips.filter((s) => !s.open && !s.ronDone).length;
      if (conc >= 5) add("五暗刻", 8); else if (conc === 4) add("四暗刻", 5); else if (conc === 3) add("三暗刻", 2);
      // 平胡：沒有花、沒有字、全部順子、聽兩面、不是自摸
      const pinghu = !ctx.flowers.length && !hasHonor && chows.length === 5 && !ctx.tsumo && pl.wait === "ryanmen" && ctx.waitsN >= 2;
      if (pinghu) add("平胡", 2);
      // 全求人：五組都是吃碰明槓、單吊、別人放槍
      if (exposed === 5 && !ctx.tsumo && pl.wait === "tanki") add("全求人", 2);
      else if (ctx.waitsN === 1) add("獨聽", 1);
      // 情境
      if (ctx.haitei && ctx.tsumo) add("海底撈月", 1);
      if (ctx.houtei && !ctx.tsumo) add("河底撈魚", 1);
      if (ctx.rinshan) add("槓上開花", 1);
      if (ctx.chankan) add("搶槓", 1);
      // 花牌
      flowerTai(ctx.flowers, ctx.seatW).forEach((x) => list.push(x));
      const tai = list.reduce((s, x) => s + x[1], 0);
      if (!best || tai > best.tai) best = { tai, list };
    }
  }
  return best;
}

// 正花（跟門風同位置的花）各 1 台；春夏秋冬或梅蘭竹菊湊齊一組叫花槓，2 台（不再另算那組的正花）
export function flowerTai(flowers, seatW) {
  const l = [], f = new Set(flowers);
  const seasons = [34, 35, 36, 37].every((x) => f.has(x)), plants = [38, 39, 40, 41].every((x) => f.has(x));
  if (seasons) l.push(["春夏秋冬", 2]); else if (f.has(34 + seatW)) l.push(["正花 " + "春夏秋冬"[seatW], 1]);
  if (plants) l.push(["梅蘭竹菊", 2]); else if (f.has(38 + seatW)) l.push(["正花 " + "梅蘭竹菊"[seatW], 1]);
  return l;
}
