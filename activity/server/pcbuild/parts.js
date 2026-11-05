// 零件規格解析 + 兩家商店同一零件的自動配對
export const CATS = ["cpu", "mb", "ram", "ssd", "gpu", "case", "psu", "cooler"];

const BRANDS = [
  ["asus", /華碩|ASUS|ROG|TUF|PRIME/i], ["gigabyte", /技嘉|GIGABYTE|AORUS/i], ["msi", /微星|MSI/i], ["asrock", /華擎|ASROCK/i],
  ["corsair", /海盜船|CORSAIR/i], ["kingston", /金士頓|KINGSTON|FURY/i], ["crucial", /美光|CRUCIAL|MICRON/i], ["adata", /威剛|ADATA|XPG/i],
  ["team", /十銓|TEAMGROUP|T-?FORCE/i], ["gskill", /芝奇|G\.?SKILL/i], ["samsung", /三星|SAMSUNG/i], ["wd", /WD|威騰|WESTERN/i],
  ["seagate", /希捷|SEAGATE/i], ["sandisk", /SANDISK/i], ["seasonic", /海韻|SEASONIC/i], ["silverstone", /銀欣|SILVERSTONE/i],
  ["coolermaster", /酷碼|COOLER ?MASTER/i], ["thermalright", /利民|THERMALRIGHT/i], ["nzxt", /恩傑|NZXT/i], ["lianli", /聯力|LIAN ?LI/i],
  ["thermaltake", /曜越|THERMALTAKE/i], ["jonsbo", /喬思伯|JONSBO/i], ["deepcool", /九州風神|DEEPCOOL/i], ["superflower", /振華|SUPER ?FLOWER/i],
  ["fsp", /全漢|FSP/i], ["montech", /君主|MONTECH/i], ["antec", /安鈦克|ANTEC/i], ["phanteks", /追風者|PHANTEKS/i], ["cougar", /美洲獅|COUGAR/i],
  ["galax", /影馳|GALAX|GALAKURO/i], ["sapphire", /藍寶石|SAPPHIRE/i], ["powercolor", /撼訊|POWERCOLOR/i], ["xfx", /訊景|XFX/i],
  ["zotac", /索泰|ZOTAC/i], ["maxsun", /銘瑄|MAXSUN/i], ["colorful", /七彩虹|COLORFUL/i], ["palit", /同德|PALIT/i], ["inno3d", /映眾|INNO3D/i],
  ["leadtek", /麗台|LEADTEK/i], ["pny", /必恩威|PNY/i], ["noctua", /貓頭鷹|NOCTUA/i], ["idcooling", /ID-?COOLING/i], ["darkflash", /大飛|DARKFLASH/i],
  ["fractal", /FRACTAL/i], ["hyte", /HYTE/i], ["enermax", /保銳|ENERMAX/i], ["delta", /台達|DELTA/i], ["biostar", /映泰|BIOSTAR/i],
  ["intel", /INTEL/i], ["amd", /^AMD/i],
];
function brandOf(s) {
  let best = null, bi = 1e9;
  for (const [b, re] of BRANDS) { const m = s.match(re); if (m && m.index < bi) { bi = m.index; best = b; } }
  return best || "";
}

const STOP = new Set(["WIFI", "WI", "FI", "GAMING", "EDITION", "BLACK", "WHITE", "THE", "AND", "WITH", "GB", "INTEL", "AMD", "NVIDIA", "GEFORCE", "RADEON", "DDR", "SSD", "PCIE", "M", "2", "X", "RGB", "ARGB", "TRAY", "BOX", "OC", "TW", "MIT"]);
function normCap(s) { return s.replace(/(\d+)\s*GB\b/g, "$1G").replace(/(\d+)\s*TB\b/g, "$1T"); }
function tokens(s) {
  const u = normCap(s.toUpperCase().replace(/[　-鿿｛｝（）【】，。／、]/g, " "));
  return u.split(/[^A-Z0-9]+/).filter((t) => t && !STOP.has(t));
}
const hasDigit = (t) => /\d/.test(t);

// ---- 各分類規格 ----
const SOCK_BY_CHIPSET = [
  [/\b(A520|B550|X570|B450|X470|A320|B350|X370)\b/, "AM4"], [/\b(A620|B650E?|B840|B850|X670E?|X870E?)\b/, "AM5"],
  [/\b(H610|B660|H670|Z690|H770|B760|Z790)\b/, "1700"], [/\b(H810|B860|Z890|W880)\b/, "1851"], [/\b(H410|B460|H510|B560|Z590|Z490|H470)\b/, "1200"],
];
function sockOf(s) {
  const t = s.toUpperCase();
  const m = t.match(/\b(AM4|AM5|LGA ?1851|LGA ?1700|LGA ?1200|1851|1700|1200)\b/);
  if (m) return m[1].replace(/LGA ?/, "");
  for (const [re, so] of SOCK_BY_CHIPSET) if (re.test(t)) return so;
  return "";
}
const GPU_W = { RTX5090: 575, RTX5080: 360, RTX5070TI: 300, RTX5070: 250, RTX5060TI: 180, RTX5060: 145, RTX5050: 130, RTX4090: 450, RTX4080SUPER: 320, RTX4080: 320, RTX4070TISUPER: 285, RTX4070TI: 285, RTX4070SUPER: 220, RTX4070: 200, RTX4060TI: 165, RTX4060: 115, RTX3060: 170, RTX3050: 130, GTX1650: 75, GT1030: 30, GT730: 25, GT710: 20, RX9070XT: 304, RX9070GRE: 220, RX9070: 220, RX9060XT: 160, RX7900XTX: 355, RX7900XT: 315, RX7900GRE: 260, RX7800XT: 263, RX7700XT: 245, RX7650GRE: 190, RX7600XT: 190, RX7600: 165, ARCB580: 190, ARCB570: 150, ARCA770: 225, ARCA750: 225 };
const GPU_PERF = { RTX5090: 270, RTX5080: 190, RTX5070TI: 165, RTX5070: 135, RTX5060TI: 110, RTX5060: 90, RTX5050: 70, RTX4090: 220, RTX4080SUPER: 170, RTX4080: 165, RTX4070TISUPER: 150, RTX4070TI: 135, RTX4070SUPER: 130, RTX4070: 110, RTX4060TI: 85, RTX4060: 70, RTX3060: 60, RTX3050: 40, GTX1650: 30, RX9070XT: 160, RX9070: 145, RX9070GRE: 125, RX9060XT: 100, RX7900XTX: 175, RX7900XT: 155, RX7900GRE: 130, RX7800XT: 125, RX7700XT: 105, RX7650GRE: 80, RX7600XT: 78, RX7600: 65, ARCB580: 85, ARCB570: 70, ARCA770: 60, ARCA750: 55 };
function gpuChip(s) {
  const t = s.toUpperCase().replace(/-/g, " ");
  const m = t.match(/\b(RTX|GTX|GT|RX|ARC ?[AB])\s?(\d{3,4})\s?(TI ?SUPER|TI|SUPER|XTX|XT|GRE)?/);
  if (!m) return "";
  return (m[1] + m[2] + (m[3] || "")).replace(/\s/g, "");
}
function formLevel(s, dflt) {
  const t = s.toUpperCase();
  if (/E-?ATX|EATX/.test(t)) return 3;
  if (/(?<![A-Z\-])ATX/.test(t)) return 2;
  if (/M-?ATX|MATX|MICRO ?ATX/.test(t)) return 1;
  if (/ITX/.test(t)) return 0;
  return dflt;
}

export function extract(cat, it) {
  const text = `${it.name} ${it.spec || ""}`;
  const all = `${it.grp || ""} ${text}`;
  const brand = brandOf(it.name);
  const sp = {};
  if (cat === "cpu") {
    sp.socket = sockOf(it.grp || "") || (() => {
      const n = it.name.toUpperCase();
      if (/ULTRA/.test(n)) return "1851";
      const m = n.match(/I[3579]-?(\d{4,5})/);
      if (m) { const g = m[1].length === 5 ? +m[1].slice(0, 2) : +m[1].slice(0, 1); return g >= 12 ? "1700" : g >= 10 ? "1200" : ""; }
      const r = n.match(/R(?:YZEN)?\s?[3579]\s?(\d{4})/);
      if (r) return +r[1] >= 7000 || /^8\d{3}F/.test(r[1]) ? "AM5" : "AM4";
      return "";
    })();
    const w = text.match(/(\d{2,3})\s?W/i);
    const k = /\d{4,5}K|\d{3}K|X3D|\d{4}X\b/i.test(it.name);
    sp.tdp = w ? +w[1] : k ? 125 : 65;
    sp.peak = Math.round(sp.tdp * (/INTEL|CORE|I[3579]-/i.test(it.name) && k ? 2 : 1.4));
    sp.igpu = !(/無內顯/.test(text) || /\d{4,5}K?F\b/i.test(it.name) || /\d{3}KF\b/i.test(it.name));
    const m = it.name.toUpperCase().match(/I([3579])-?(\d{4,5}[A-Z]{0,2})/), u = it.name.toUpperCase().match(/ULTRA\s?([3579])\s?(\d{3}[A-Z]{0,2}(?:\s?PLUS)?)/), r = it.name.toUpperCase().match(/R(?:YZEN)?\s?([3579])\s?(\d{4,5}(?:X3D2?|[A-Z]{0,3}))/);
    const model = m ? "I" + m[1] + "-" + m[2] : u ? "U" + u[1] + "-" + u[2].replace(/\s/g, "") : r ? "R" + r[1] + "-" + r[2] : "";
    sp.model = model;
    sp.tray = /散裝|TRAY/i.test(text);
    sp.key = model ? model + (sp.tray ? "T" : "B") : "";
    sp.cooler = /含風扇|附風扇|原廠風扇|有風扇/.test(text) && !/無風扇/.test(text);
  } else if (cat === "mb") {
    sp.socket = sockOf(it.grp || "") || sockOf(text);
    const d = (it.grp || "").match(/DDR([45])/) || text.toUpperCase().match(/DDR ?([45])|\bD([45])\b/);
    sp.ddr = d ? +(d[1] || d[2]) : sp.socket === "AM4" || sp.socket === "1200" ? 4 : sp.socket === "AM5" || sp.socket === "1851" ? 5 : 0;
    const model = (it.name.toUpperCase().match(/\b[A-Z]\d{3}[A-Z]?\d?M?\b/) || [""])[0];
    sp.form = formLevel(text, /[A-Z]\d{3}[A-Z]?M\b|-M\b|M-?ATX|MICRO/i.test(it.name) ? 1 : 2);
    sp.chipset = model;
  } else if (cat === "ram") {
    const d = all.toUpperCase().match(/DDR([345])/);
    sp.ddr = d ? +d[1] : 0;
    const t = normCap(text.toUpperCase());
    let cap = 0, n = 1, m;
    if ((m = t.match(/(\d{1,3})G\s*[\*X×]\s*(\d)/))) { cap = +m[1] * +m[2]; n = +m[2]; }
    else if ((m = t.match(/(\d)\s*[\*X×]\s*(\d{1,3})G/))) { cap = +m[1] * +m[2]; n = +m[1]; }
    else if ((m = t.match(/(\d{1,3})G/))) cap = +m[1];
    if (/雙通道|雙條|KIT|2條/.test(text) && n === 1 && cap && !/\*|X\d/.test(t)) n = 2;
    sp.cap = cap; sp.sticks = n;
    const sm = t.match(/DDR[345][- ]?(\d{4,5})/) || t.match(/(\d{4,5})\s?MHZ/) || t.match(/\b(\d{4,5})\b/);
    sp.speed = sm ? +sm[1] : 0;
    sp.sodimm = /筆記型|SO-?DIMM|NB/i.test(all);
  } else if (cat === "ssd") {
    const m = normCap(text.toUpperCase()).match(/(\d+(?:\.\d+)?)\s?([TG])\b/);
    sp.cap = m ? Math.round(+m[1] * (m[2] === "T" ? 1000 : 1)) : 0;
    sp.iface = /SATA/i.test(it.grp || "") ? "sata" : "m2";
    const g = all.match(/Gen ?([345])|PCIe ?([345])/i);
    sp.gen = g ? +(g[1] || g[2]) : 0;
  } else if (cat === "gpu") {
    sp.chip = gpuChip(it.grp || "") || gpuChip(it.name);
    const gm = (it.grp || "").match(/(\d{1,2})\s?G/i);
    let v = gm ? +gm[1] : 0;
    if (!v) { const tk = tokens(it.name).find((x) => /^[A-Z]?\d{1,2}G$/.test(x)); if (tk) v = +tk.replace(/\D/g, ""); }
    sp.vram = v;
    sp.watts = GPU_W[sp.chip] || (sp.chip ? 150 : 0);
    sp.perf = GPU_PERF[sp.chip] || 0;
    sp.chipOk = !!sp.perf && !/工作站|專業|Quadro|RTX ?A\d/i.test(it.name);
  } else if (cat === "case") {
    sp.form = formLevel(text, 2);
    sp.sfx = /SFX/.test(it.grp || "") || /SFX/i.test(it.name);
  } else if (cat === "psu") {
    const m = text.match(/(\d{3,4})\s?W/i);
    sp.watts = m ? +m[1] : 0;
    sp.rate = (text.match(/鈦金|白金|金牌|銀牌|銅牌|白牌|80\+/) || [""])[0];
    sp.sfx = /SFX/.test(it.grp || "") || /SFX/i.test(it.name);
  } else if (cat === "cooler") {
    const t = all.toUpperCase();
    sp.aio = /水冷|AIO|LCD|\b(240|280|360|420)\b/.test(t) && !/塔|AIR|空冷/.test(t) ? 1 : 0;
    const r = t.match(/\b(120|140|240|280|360|420)\b/);
    sp.rad = r && sp.aio ? +r[1] : 0;
  }
  return { brand, sp };
}

// ---- 配對 ----
const COLORS = [["b", /黑|BLACK|\bBK\b/i], ["w", /白|WHITE|\bWH\b|\bICE\b/i], ["p", /粉|PINK/i], ["r", /紅|RED/], ["u", /藍|BLUE/i], ["g", /綠|GREEN/i], ["s", /銀|SILVER/i], ["y", /灰|GRAY|GREY/i], ["v", /紫|PURPLE/i]];
const SERIES = [/FURY/, /BEAST/, /RENEGADE/, /IMPACT/, /VENGEANCE/, /DOMINATOR/, /TRIDENT/, /RIPJAWS/, /KVR|VALUE ?RAM/, /LANCER/, /SPECTRIX/, /CRAS/, /BOLT/, /MANTA/, /T-?FORCE|DELTA/, /XPG/, /\bPRO\b/, /ECC|REG|RDIMM/];
function sim(cat, a, b) {
  if (a.brand && b.brand && a.brand !== b.brand) return 0;
  if (cat === "cpu") return a.sp.key && a.sp.key === b.sp.key ? 1 : 0;
  const gc = (s) => cat !== "gpu" ? s : s.toUpperCase().replace(/-/g, " ").replace(/\b(RTX|GTX|GT|RX|ARC ?[AB])\s?(\d{3,4})\s?(TI ?SUPER|TI|SUPER|XTX|XT|GRE)?/, (m0, p, n, x) => " " + (p + n + (x || "")).replace(/\s/g, "") + " ");
  const A = tokens(gc(a.name)), B = tokens(gc(b.name));
  if (cat !== "ram" && cat !== "ssd") {                      // 同型號的不同顏色（黑／白／粉…）不是同一個零件
    const col = (n) => { const set = new Set(); for (const [k, re] of COLORS) if (re.test(n)) set.add(k); return set; };
    const ca = col(a.name), cb = col(b.name);
    if (ca.size && cb.size && ![...ca].some((k) => cb.has(k))) return 0;
  }
  if (cat === "mb") {                                        // 有無 WIFI 是不同型號
    const wf = (n) => /WI-?FI|無線/i.test(n);
    if (wf(a.name) !== wf(b.name)) return 0;
  }
  if (cat === "ram") {                                       // 不同系列（FURY / VALUERAM / VENGEANCE…）不能混
    for (const re of SERIES) if (re.test(a.name.toUpperCase()) !== re.test(b.name.toUpperCase())) return 0;
  }
  const dA = new Set(A.filter(hasDigit)), dB = new Set(B.filter(hasDigit));
  if (!dA.size || !dB.size) return 0;
  const inter = [...dA].filter((x) => dB.has(x));
  if (!inter.some((x) => x.length >= 3)) return 0;
  const cap = (s) => [...s].filter((x) => /^\d+[GT]$/.test(x)).sort().join();
  if (cap(dA) !== cap(dB) && cap(dA) && cap(dB)) return 0;
  // 記憶體、SSD：欣亞的名稱常多帶一堆規格字（Gen4、讀速…），用「較短的那邊全部出現在另一邊」判斷；其他分類要求幾乎一樣
  const loose = cat === "ram" || cat === "ssd";
  const jd = inter.length / (loose ? Math.min(dA.size, dB.size) : Math.max(dA.size, dB.size));
  if (jd < (loose ? 0.99 : 0.75) || (loose && inter.length < 2)) return 0;
  if (!loose) {                                             // 沒有數字的型號字（TX / PX、AORUS / ELITE）也不能互相矛盾
    const al = (L) => new Set(L.filter((t) => !hasDigit(t) && t.length >= 2));
    const xa = al(A), xb = al(B), [sm, bg] = xa.size <= xb.size ? [xa, xb] : [xb, xa];
    if ([...sm].some((t) => !bg.has(t))) return 0;
  }
  const sA = new Set(A), sB = new Set(B);
  const ia = [...sA].filter((x) => sB.has(x)).length;
  const jall = ia / Math.max(sA.size, sB.size);
  // 其他規格不能衝突
  const s1 = a.sp, s2 = b.sp;
  if (cat === "gpu" && (s1.chip !== s2.chip || (s1.vram && s2.vram && s1.vram !== s2.vram))) return 0;
  if (cat === "mb" && s1.ddr && s2.ddr && s1.ddr !== s2.ddr) return 0;
  if (cat === "ram" && ((s1.cap && s2.cap && s1.cap !== s2.cap) || (s1.ddr && s2.ddr && s1.ddr !== s2.ddr))) return 0;
  if (cat === "psu" && s1.watts && s2.watts && s1.watts !== s2.watts) return 0;
  if (cat === "ssd" && s1.cap && s2.cap && s1.cap !== s2.cap) return 0;
  return 0.8 * jd + 0.2 * jall;
}

export function matchCat(cat, cs, ss) {
  const cand = [];
  for (let i = 0; i < cs.length; i++) for (let j = 0; j < ss.length; j++) {
    const v = sim(cat, cs[i], ss[j]);
    if (v >= (cat === "cpu" ? 1 : 0.6)) cand.push([v, i, j]);
  }
  cand.sort((x, y) => y[0] - x[0]);
  const ui = new Set(), uj = new Set(), pairs = [];
  for (const [, i, j] of cand) { if (ui.has(i) || uj.has(j)) continue; ui.add(i); uj.add(j); pairs.push([cs[i], ss[j]]); }
  cs.forEach((c, i) => { if (!ui.has(i)) pairs.push([c, null]); });
  ss.forEach((s, j) => { if (!uj.has(j)) pairs.push([null, s]); });
  return pairs;
}
