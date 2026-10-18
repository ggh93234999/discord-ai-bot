// 日本立直麻將計分：役、翻、符、點數。牌桌流程在 mahjong.js，牌的編碼和拆牌在 mjcore.js。
// 沒有赤寶牌；雙倍役滿不另計（一律當一倍役滿，可以疊加不同的役滿）。
import { toCounts, decomps, isChiitoi, isKokushi, isHonor, isYaochu, isTerminal, isDragon, isWind, doraOf, suitOf, numOf } from "./mjcore.js";

// 副露（吃碰槓）轉成面子：{ k: "chow"|"pung"|"kan", t, open }
export function meldSet(m) {
  if (m.k === "chi") return { k: "chow", t: Math.min(...m.tiles), open: true };
  if (m.k === "pon") return { k: "pung", t: m.tiles[0], open: true };
  return { k: "kan", t: m.tiles[0], open: m.k !== "ankan" };
}
const GREEN = new Set([19, 20, 21, 23, 25, 32]);
const setTiles = (s) => (s.k === "chow" ? [s.t, s.t + 1, s.t + 2] : [s.t, s.t, s.t]);
const isTrip = (s) => s.k === "pung" || s.k === "kan";

export function basePoints(han, fu, yakuman) {
  if (yakuman) return { base: 8000 * yakuman, label: yakuman > 1 ? `${yakuman} 倍役滿` : "役滿" };
  if (han >= 13) return { base: 8000, label: "累計役滿" };
  if (han >= 11) return { base: 6000, label: "三倍滿" };
  if (han >= 8) return { base: 4000, label: "倍滿" };
  if (han >= 6) return { base: 3000, label: "跳滿" };
  const b = fu * 2 ** (2 + han);
  if (han >= 5 || b >= 2000) return { base: 2000, label: "滿貫" };
  return { base: b, label: "" };
}
const up100 = (x) => Math.ceil(x / 100) * 100;
// 點數：ron 給放銃者付的總額；tsumo 給 [莊家付, 閒家付]（莊家自摸時兩個數一樣）
export function payments(base, dealer, tsumo) {
  if (!tsumo) return { ron: up100(base * (dealer ? 6 : 4)) };
  if (dealer) { const x = up100(base * 2); return { tsumo: [x, x] }; }
  return { tsumo: [up100(base * 2), up100(base)] };
}

// ctx：hand（含胡的那張）、melds、win、tsumo、seatW、roundW（0~3）、riichi（0/1/2=雙立直）、ippatsu、haitei、houtei、rinshan、chankan、tenhou、chiihou、dora、ura（指示牌陣列）
// 回傳 null（不能胡：沒有胡牌形或沒有役）或 { han, fu, yaku: [[名稱, 翻]], yakuman, base, label }
export function scoreJP(ctx) {
  const c = toCounts(ctx.hand);
  const menzen = ctx.melds.every((m) => m.k === "ankan");
  const mSets = ctx.melds.map(meldSet);
  const allTiles = [...ctx.hand, ...ctx.melds.flatMap((m) => m.tiles)];
  const seatT = 27 + ctx.seatW, roundT = 27 + ctx.roundW;
  const ac = toCounts(allTiles);
  const suits = new Set(allTiles.filter((t) => !isHonor(t)).map(suitOf));
  const hasHonor = allTiles.some(isHonor);
  let best = null;
  const consider = (r) => { if (!r) return; const s = r.yakuman * 1e9 + basePoints(r.han, r.fu, r.yakuman).base * 10 + r.han; if (!best || s > best._s) best = { ...r, _s: s }; };

  // 共通的情境役
  function situational(list, ym) {
    if (ctx.tenhou) ym.push(["天和", 1]);
    if (ctx.chiihou) ym.push(["地和", 1]);
    if (ctx.riichi === 2) list.push(["雙立直", 2]); else if (ctx.riichi) list.push(["立直", 1]);
    if (ctx.riichi && ctx.ippatsu) list.push(["一發", 1]);
    if (menzen && ctx.tsumo) list.push(["門前清自摸和", 1]);
    if (ctx.haitei && ctx.tsumo) list.push(["海底摸月", 1]);
    if (ctx.houtei && !ctx.tsumo) list.push(["河底撈魚", 1]);
    if (ctx.rinshan) list.push(["嶺上開花", 1]);
    if (ctx.chankan) list.push(["搶槓", 1]);
  }
  function colorYaku(list, ym) {
    if (!hasHonor && suits.size === 1) list.push(["清一色", menzen ? 6 : 5]);
    else if (hasHonor && suits.size === 1) list.push(["混一色", menzen ? 3 : 2]);
    if (allTiles.every(isHonor)) ym.push(["字一色", 1]);
    if (allTiles.every(isTerminal)) ym.push(["清老頭", 1]);
    if (allTiles.every((t) => GREEN.has(t))) ym.push(["綠一色", 1]);
    if (allTiles.every((t) => !isYaochu(t))) list.push(["斷么九", 1]);
  }
  function finish(list, ym, fu) {
    if (ym.length) return { han: 0, fu: 0, yaku: ym.map(([n]) => [n, "役滿"]), yakuman: ym.length };
    const yakuHan = list.reduce((s, x) => s + x[1], 0);
    if (!yakuHan) return null;                                   // 沒有役不能胡
    let dora = 0, ura = 0;
    for (const ind of ctx.dora) dora += ac[doraOf(ind)] || 0;
    if (ctx.riichi) for (const ind of ctx.ura) ura += ac[doraOf(ind)] || 0;
    if (dora) list.push(["寶牌", dora]);
    if (ura) list.push(["裏寶牌", ura]);
    return { han: list.reduce((s, x) => s + x[1], 0), fu, yaku: list, yakuman: 0 };
  }

  // 國士無雙
  if (!ctx.melds.length && isKokushi(c)) { const ym = [["國士無雙", 1]]; situational([], ym); consider({ han: 0, fu: 0, yaku: ym.map(([n]) => [n, "役滿"]), yakuman: ym.length }); }
  // 七對子
  if (!ctx.melds.length && isChiitoi(c)) {
    const list = [["七對子", 2]], ym = [];
    situational(list, ym); colorYaku(list, ym);
    if (allTiles.every(isYaochu) && !allTiles.every(isHonor)) list.push(["混老頭", 2]);
    consider(finish(list, ym, 25));
  }
  // 一般型：4 面子 1 雀頭
  for (const d of decomps(c)) {
    if (d.sets.length + mSets.length !== 4) continue;
    // 胡的那張可能在哪個位置（雀頭／某個門前面子），各算一次取最大
    const places = [];
    if (d.pair === ctx.win) places.push({ at: -1, wait: "tanki" });
    d.sets.forEach((s, i) => {
      if (s.k === "pung" && s.t === ctx.win) places.push({ at: i, wait: "shanpon" });
      if (s.k === "chow" && ctx.win >= s.t && ctx.win <= s.t + 2) {
        const pos = ctx.win - s.t, n = numOf(s.t);
        let w = "ryanmen";
        if (pos === 1) w = "kanchan";
        else if ((pos === 2 && n === 1) || (pos === 0 && n === 7)) w = "penchan";
        places.push({ at: i, wait: w });
      }
    });
    for (const pl of places) {
      const closed = d.sets.map((s, i) => ({ ...s, open: false, ronDone: !ctx.tsumo && i === pl.at && s.k === "pung" }));
      const sets = [...closed, ...mSets];
      const list = [], ym = [];
      situational(list, ym); colorYaku(list, ym);
      const chows = sets.filter((s) => s.k === "chow"), trips = sets.filter(isTrip);
      const concealedTrips = trips.filter((s) => !s.open && !s.ronDone).length;
      const kans = sets.filter((s) => s.k === "kan").length;
      const pairYakuhai = isDragon(d.pair) || d.pair === seatT || d.pair === roundT;
      // 役滿
      const dragonTrips = trips.filter((s) => isDragon(s.t)).length, windTrips = trips.filter((s) => isWind(s.t)).length;
      if (dragonTrips === 3) ym.push(["大三元", 1]);
      if (windTrips === 4) ym.push(["大四喜", 1]);
      else if (windTrips === 3 && isWind(d.pair)) ym.push(["小四喜", 1]);
      if (concealedTrips === 4) ym.push(["四暗刻", 1]);
      if (kans === 4) ym.push(["四槓子", 1]);
      if (menzen && !ctx.melds.length && suits.size === 1 && !hasHonor) {
        const s0 = [...suits][0] * 9, k = c.slice(s0, s0 + 9);
        if (k[0] >= 3 && k[8] >= 3 && k.every((x) => x >= 1)) ym.push(["九蓮寶燈", 1]);
      }
      // 一般役
      const pinfu = menzen && chows.length === 4 && !pairYakuhai && pl.wait === "ryanmen";
      if (pinfu) list.push(["平和", 1]);
      if (menzen) {
        const keys = chows.map((s) => s.t).sort((a, b) => a - b);
        let pairs = 0; for (let i = 0; i + 1 < keys.length; i++) if (keys[i] === keys[i + 1]) { pairs++; i++; }
        if (pairs === 2) list.push(["二盃口", 3]); else if (pairs === 1) list.push(["一盃口", 1]);
      }
      for (const s of trips) {
        if (s.t === 31) list.push(["役牌 白", 1]);
        if (s.t === 32) list.push(["役牌 發", 1]);
        if (s.t === 33) list.push(["役牌 中", 1]);
        if (s.t === seatT) list.push(["自風", 1]);
        if (s.t === roundT) list.push(["場風", 1]);
      }
      const nums = (k) => sets.filter((s) => (k === "chow" ? s.k === "chow" : isTrip(s)) && !isHonor(s.t));
      for (let n = 0; n < 9; n++) {
        if ([0, 1, 2].every((su) => nums("chow").some((s) => s.t === su * 9 + n))) { list.push(["三色同順", menzen ? 2 : 1]); break; }
      }
      for (let n = 0; n < 9; n++) {
        if ([0, 1, 2].every((su) => nums("trip").some((s) => s.t === su * 9 + n))) { list.push(["三色同刻", 2]); break; }
      }
      for (let su = 0; su < 3; su++) if ([0, 3, 6].every((o) => chows.some((s) => s.t === su * 9 + o))) { list.push(["一氣通貫", menzen ? 2 : 1]); break; }
      if (trips.length === 4) list.push(["對對和", 2]);
      if (concealedTrips === 3) list.push(["三暗刻", 2]);
      if (kans === 3) list.push(["三槓子", 2]);
      if (dragonTrips === 2 && isDragon(d.pair)) list.push(["小三元", 2]);
      const groupTiles = [...sets.map(setTiles), [d.pair, d.pair]];
      if (allTiles.every(isYaochu) && hasHonor && !allTiles.every(isHonor)) list.push(["混老頭", 2]);
      else if (chows.length && groupTiles.every((g) => g.some(isYaochu))) {
        if (!hasHonor && groupTiles.every((g) => g.some(isTerminal))) list.push(["純全帶么九", menzen ? 3 : 2]);
        else list.push(["混全帶么九", menzen ? 2 : 1]);
      }
      // 符
      let fu;
      if (pinfu && ctx.tsumo) fu = 20;
      else if (pinfu) fu = 30;
      else {
        fu = 20;
        if (menzen && !ctx.tsumo) fu += 10;
        if (ctx.tsumo) fu += 2;
        if (["kanchan", "penchan", "tanki"].includes(pl.wait)) fu += 2;
        if (isDragon(d.pair)) fu += 2;
        if (d.pair === seatT) fu += 2;
        if (d.pair === roundT) fu += 2;
        for (const s of trips) {
          let f = 2;
          if (isYaochu(s.t)) f *= 2;
          if (!s.open && !s.ronDone) f *= 2;
          if (s.k === "kan") f *= 4;
          fu += f;
        }
        fu = Math.ceil(fu / 10) * 10;
        if (fu === 20 && !menzen) fu = 30;                       // 副露的平和形榮和也是 30 符
      }
      consider(finish(list, ym, fu));
    }
  }
  if (!best) return null;
  const bp = basePoints(best.han, best.fu, best.yakuman);
  delete best._s;
  return { ...best, base: bp.base, label: bp.label };
}
