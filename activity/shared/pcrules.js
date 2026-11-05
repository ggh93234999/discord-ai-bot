// 配電腦的規則：相容性檢查、功率估算、依預算自動推薦。前端（Activity）和伺服器（給 bot 用）共用。
// part = { id, cat, brand, name, sp:{...}, c:{p,..}|null, s:{p,..}|null }；sel = { cpu: part, mb: part, ... }
export const CAT_LIST = ["cpu", "mb", "gpu", "ram", "ssd", "psu", "case", "cooler"];
export const CAT_NAME = { cpu: "處理器", mb: "主機板", gpu: "顯示卡", ram: "記憶體", ssd: "固態硬碟", psu: "電源供應器", case: "機殼", cooler: "散熱器" };
const FORM = ["ITX", "M-ATX", "ATX", "E-ATX"];

export function priceOf(p, mode = "min") {
  if (!p) return null;
  const c = p.c ? p.c.p : null, s = p.s ? p.s.p : null;
  if (mode === "c") return c;
  if (mode === "s") return s;
  if (c == null) return s;
  if (s == null) return c;
  return Math.min(c, s);
}
export function cheaper(p) {
  if (!p || !p.c || !p.s) return p && p.c ? "c" : p && p.s ? "s" : "";
  return p.c.p === p.s.p ? "=" : p.c.p < p.s.p ? "c" : "s";
}

export function needWatts(sel) {
  const cpu = sel.cpu && sel.cpu.sp ? sel.cpu.sp.peak || 100 : 100;
  const gpu = sel.gpu && sel.gpu.sp ? sel.gpu.sp.watts || 0 : 0;
  const base = cpu + gpu + 100;                              // 主機板／風扇／硬碟等
  return Math.ceil((base * 1.25) / 50) * 50;                 // 留 25% 餘裕
}
export function estWatts(sel) {
  const cpu = sel.cpu && sel.cpu.sp ? sel.cpu.sp.peak || 100 : 0;
  const gpu = sel.gpu && sel.gpu.sp ? sel.gpu.sp.watts || 0 : 0;
  return cpu + gpu + (sel.cpu || sel.gpu ? 100 : 0);
}

// 回傳 [{lv:"err"|"warn"|"ok", msg, cats:[...]}]
export function check(sel) {
  const out = [];
  const add = (lv, msg, cats) => out.push({ lv, msg, cats });
  const { cpu, mb, ram, gpu, psu, ssd, cooler } = sel, cs = sel.case;
  if (cpu && mb) {
    const a = cpu.sp.socket, b = mb.sp.socket;
    if (a && b && a !== b) add("err", `處理器是 ${a} 腳位，主機板是 ${b}，插不進去`, ["cpu", "mb"]);
    else if (a && b) add("ok", `CPU 與主機板腳位相符（${a}）`, ["cpu", "mb"]);
  }
  if (mb && ram) {
    const a = mb.sp.ddr, b = ram.sp.ddr;
    if (a && b && a !== b) add("err", `主機板吃 DDR${a}，記憶體是 DDR${b}`, ["mb", "ram"]);
    else if (a && b) add("ok", `記憶體規格相符（DDR${a}）`, ["mb", "ram"]);
    else add("warn", "主機板的 DDR 世代無法判斷，請自己確認", ["mb", "ram"]);
  }
  if (mb && cs) {
    if (cs.sp.form < mb.sp.form) add("err", `主機板是 ${FORM[mb.sp.form]}，機殼最大只支援 ${FORM[cs.sp.form]}`, ["mb", "case"]);
    else add("ok", `主機板放得進機殼（${FORM[mb.sp.form]}）`, ["mb", "case"]);
  }
  if (cpu && !cpu.sp.igpu && !gpu) add("err", "這顆處理器沒有內顯，需要再選一張顯示卡才有畫面", ["cpu", "gpu"]);
  if (cpu && cpu.sp.tray && !cooler) add("warn", "散裝處理器不附風扇，記得選散熱器", ["cpu", "cooler"]);
  else if (cpu && !cooler && !cpu.sp.cooler) add("warn", "還沒選散熱器（這顆處理器不附風扇或沒寫明）", ["cpu", "cooler"]);
  if (ssd && ssd.sp.iface === "sata" && !sel.hdd) add("warn", "這顆是 2.5 吋 SATA SSD，速度比 M.2 慢很多", ["ssd"]);
  if (psu && (cpu || gpu)) {
    const need = needWatts(sel), w = psu.sp.watts || 0;
    if (w && w < need) add("err", `預估需要約 ${need}W 的電源，這顆只有 ${w}W`, ["psu", "cpu", "gpu"]);
    else if (w) add("ok", `電源瓦數足夠（建議 ${need}W 以上，這顆 ${w}W）`, ["psu"]);
  }
  if (psu && cs && psu.sp.sfx && !cs.sp.sfx) add("warn", "SFX 小電源放進一般機殼需要轉接架", ["psu", "case"]);
  if (cs && psu && cs.sp.sfx && !psu.sp.sfx) add("err", "SFX 機殼要用 SFX 電源", ["psu", "case"]);
  if (cooler && cooler.sp.aio && cooler.sp.rad && cs && cs.sp.form < 1 && cooler.sp.rad >= 280) add("warn", "小機殼不一定裝得下 280/360 水冷排，請查機殼規格", ["cooler", "case"]);
  return out;
}

// part 放進 sel 後，有沒有跟「已選的其他零件」衝突
export function fits(sel, part) {
  const t = { ...sel, [part.cat]: part };
  return !check(t).some((x) => x.lv === "err" && x.cats.includes(part.cat) && !x.msg.includes("內顯"));
}

// ---------- 自動推薦 ----------
const RATIO = {
  game: { cpu: 0.17, gpu: 0.36, mb: 0.1, ram: 0.08, ssd: 0.08, psu: 0.07, case: 0.06, cooler: 0.05 },
  office: { cpu: 0.28, gpu: 0, mb: 0.15, ram: 0.12, ssd: 0.15, psu: 0.08, case: 0.1, cooler: 0.06 },
  create: { cpu: 0.26, gpu: 0.22, mb: 0.11, ram: 0.13, ssd: 0.1, psu: 0.07, case: 0.06, cooler: 0.05 },
};
export const USE_NAME = { game: "遊戲", office: "文書／上網", create: "剪片／繪圖" };

const JUNK = /滑鼠墊|Game Pass|點數|提醒|風扇|支架|轉接|濾網|延長|線材|防塵|硬碟盒|抽取|擋板|螺絲|貼紙|燈條|燈帶|機殼門/;
const p0 = (p) => Math.min(p.c ? p.c.p : 1e9, p.s ? p.s.p : 1e9);
function usable(cat, p, use, budget) {
  const sp = p.sp;
  if (p.c && p.c.t && !p.s) return false;                    // 只有預購／缺貨的
  switch (cat) {
    case "cpu": return !!sp.socket && !sp.tray && /^(AM[45]|1700|1851)$/.test(sp.socket) && (use !== "office" || true);
    case "mb": return !!sp.socket && sp.ddr > 0 && /^(AM[45]|1700|1851)$/.test(sp.socket);
    case "gpu": return sp.chipOk && sp.watts >= 100 && sp.vram >= 8;
    case "ram": return !sp.sodimm && sp.ddr >= 4 && sp.cap >= (use === "office" || budget < 45000 ? 16 : 32) && (sp.sticks === 2 || sp.cap >= 32) && sp.sticks <= 2 && sp.speed >= 3200;
    case "ssd": return sp.iface === "m2" && sp.cap >= (use === "office" || budget < 40000 ? 500 : 1000) && sp.gen >= 3;
    case "psu": return sp.watts >= 450 && !sp.sfx;
    case "case": return sp.form >= 1 && !sp.sfx && p0(p) >= 1000 && !JUNK.test(p.name);
    case "cooler": return p0(p) >= 300 && !JUNK.test(p.name) && !/風扇$|扣具|支架|貼片/.test(p.name);
  }
  return true;
}

// 回傳 { sel, total, notes[] }；mode: "c" 只買原價屋、"s" 只買欣亞、"min" 混搭最省
export function recommend(parts, budget, use = "game", mode = "min", locked = {}) {
  const ratio = { ...(RATIO[use] || RATIO.game) };
  if (use === "office" && locked.cpu && !locked.cpu.sp.igpu && !locked.gpu) ratio.gpu = 0.2;   // 鎖定的 CPU 沒內顯 → 一定要配顯卡
  const pool = {};
  for (const cat of CAT_LIST) {
    pool[cat] = (parts[cat] || []).filter((p) => priceOf(p, mode) != null && usable(cat, p, use, budget)).sort((a, b) => priceOf(a, mode) - priceOf(b, mode));
  }
  const notes = [];
  const sel = {};
  let spent = 0;
  for (const [c, p] of Object.entries(locked)) if (p) { sel[c] = p; spent += priceOf(p, mode) ?? priceOf(p); }
  const free = (c) => !locked[c];
  // 沒鎖的分類平分剩下的預算（比例照用途）
  const freeSum = CAT_LIST.filter((c) => free(c) && ratio[c]).reduce((a, c) => a + ratio[c], 0) || 1;
  const avail = budget - spent;
  const share = (c) => (avail * ratio[c]) / freeSum;
  const price = (p) => priceOf(p, mode);
  const minOf = (cat) => (pool[cat][0] ? price(pool[cat][0]) : 0);
  const order = ["cpu", "gpu", "psu", "mb", "ram", "ssd", "case", "cooler"];
  if (use === "office") {
    // 文書機：先選有內顯的 CPU，不選顯卡
    pool.cpu = pool.cpu.filter((p) => p.sp.igpu);
  }
  const gscore = (p) => p.sp.perf * 100 + Math.min(p.sp.vram, 24);
  const rest = (i) => order.slice(i + 1).reduce((s, c) => s + (!free(c) || (c === "gpu" && !ratio.gpu) ? 0 : minOf(c)), 0);
  let carry = 0;
  order.forEach((cat, i) => {
    if (!free(cat) || (cat === "gpu" && !ratio.gpu)) return;
    let cap = Math.min(share(cat) + carry, budget - spent - rest(i));
    let cands = pool[cat].filter((p) => fits(sel, p));
    if (cat === "psu") {
      const need = needWatts(sel);
      const ok = cands.filter((p) => p.sp.watts >= need);
      if (ok.length) cands = ok; else notes.push(`找不到 ${need}W 以上的電源，預算可能太低`);
      const gold = cands.filter((p) => /金|鈦/.test(p.sp.rate || "") && price(p) <= Math.max(cap, 0));
      cands = gold.length ? gold : cands;
      const pick = cands.filter((p) => price(p) <= cap).sort((a, b) => price(a) - price(b))[0] || cands[0];
      if (pick) { sel[cat] = pick; spent += price(pick); carry = 0; }
      return;
    }
    if (!cands.length) { notes.push(`找不到適合的${CAT_NAME[cat]}`); return; }
    let within = cands.filter((p) => price(p) <= cap);
    let pick;
    if (!within.length) pick = cands[0];
    else if (cat === "gpu") {
      within.sort((a, b) => gscore(b) - gscore(a) || price(a) - price(b));
      pick = within[0];
    } else {
      const cs = (p) => price(p) * (cat === "cpu" && use === "game" && /X3D/.test(p.sp.model || "") ? 1.6 : 1);
      within.sort((a, b) => cs(b) - cs(a));
      pick = within[0];
    }
    sel[cat] = pick; spent += price(pick); carry = cat === "cpu" ? Math.max(0, cap - price(pick)) : 0;
  });
  // 剩下的錢：優先升級顯卡（文書機升級 CPU）
  for (let guard = 0; guard < 20; guard++) {
    const cat = ratio.gpu && free("gpu") ? "gpu" : free("cpu") ? "cpu" : "";
    if (!cat || !sel[cat]) break;
    const cur = sel[cat], left = budget - spent;
    const score = (p) => (cat === "gpu" ? gscore(p) : price(p));
    const ups = pool[cat].filter((p) => score(p) > score(cur) && price(p) - price(cur) <= left && fits({ ...sel }, p)).sort((a, b) => score(a) - score(b));
    if (!ups.length) break;
    const next = ups[0];
    const t = { ...sel, [cat]: next };
    if (cat === "gpu" && sel.psu && sel.psu.sp.watts < needWatts(t)) {
      if (!free("psu")) break;
      const p2 = pool.psu.filter((p) => p.sp.watts >= needWatts(t)).sort((a, b) => price(a) - price(b))[0];
      if (!p2 || price(next) - price(cur) + price(p2) - price(sel.psu) > left) break;
      spent += price(p2) - price(sel.psu); sel.psu = p2;
    }
    spent += price(next) - price(cur); sel[cat] = next;
  }
  const total = CAT_LIST.reduce((s, c) => s + (sel[c] ? price(sel[c]) : 0), 0);
  if (total > budget) notes.push("預算偏低，已是能找到最便宜的組合，仍略超出");
  return { sel, total, notes };
}

export function totals(sel) {
  const t = { c: 0, s: 0, min: 0, missC: [], missS: [] };
  for (const cat of CAT_LIST) {
    const p = sel[cat];
    if (!p) continue;
    if (p.c) t.c += p.c.p; else t.missC.push(cat);
    if (p.s) t.s += p.s.p; else t.missS.push(cat);
    t.min += priceOf(p, "min");
  }
  return t;
}
