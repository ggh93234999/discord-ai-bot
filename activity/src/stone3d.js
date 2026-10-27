// 賭石的 3D 原石：用 three.js 畫，可以拖曳旋轉、滾輪／雙指縮放。
// 外觀只由伺服器給的「外表線索」決定（場口顏色、松花、蟒帶、霧、癬、裂、窗口），看不到裡面。
// 切面是伺服器依石頭內部算出的 48×48 格子（共用 shared/stonegeo.js 的座標），這裡只負責畫。
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mulberry, hash3, fbm, shapeParams, surfacePoint, AXES, GRID, GS, OUT, planeBasis } from "../shared/stonegeo.js";

// 翡翠等級（1 綠絲石 … 8 帝王綠）在切面上的顏色
export const TIER_COL = ["#7a7468", "#b9c4ac", "#a8c79c", "#86c488", "#5db878", "#a7e0cc", "#3fc968", "#1fc46e", "#08d878"];
const ROCK = "#7d7769", HAZE = "#d9d5c6", CRACK = "#2e2a27";

// AI 畫的材質（128px，鏡像重複取樣所以沒有接縫）：t0 岩石切面、t1–t8 各等級翡翠、skin 外皮顆粒。還沒載入完就退回程式算的雜訊。
const TEXD = {};
for (const [pth, url] of Object.entries(import.meta.glob("./stone-art/{t[0-8],skin}.png", { eager: true, query: "?url", import: "default" }))) {
  const k = pth.split("/").pop().slice(0, -4), im = new Image();
  im.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 128, 128); TEXD[k] = x.getImageData(0, 0, 128, 128).data; };
  im.src = url;
}
const mir = (v) => { v = ((v % 2) + 2) % 2; return v > 1 ? 2 - v : v; };
const texAt = (k, u, v) => { const d = TEXD[k]; if (!d) return null; const o = (Math.min(127, Math.floor(mir(v) * 128)) * 128 + Math.min(127, Math.floor(mir(u) * 128))) * 4; return [d[o], d[o + 1], d[o + 2]]; };
const skinLum = (d) => {                                // 三向取樣，球面上不會有接縫；回傳 0..1，約 0.5 為平均
  if (!TEXD.skin) return 0.5;
  const wx = Math.abs(d[0]) ** 4, wy = Math.abs(d[1]) ** 4, wz = Math.abs(d[2]) ** 4, L = (u, v) => { const t = texAt("skin", u, v); return (t[0] * 0.3 + t[1] * 0.59 + t[2] * 0.11) / 255; };
  return (wx * L((d[1] + 1) * 1.1, (d[2] + 1) * 1.1) + wy * L((d[0] + 1) * 1.1, (d[2] + 1) * 1.1) + wz * L((d[0] + 1) * 1.1, (d[1] + 1) * 1.1)) / (wx + wy + wz);
};

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const D = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function buildStone(p) {                         // p: { ...pub, cuts:[{axis,pos}], lod }
  const g = new THREE.Group(), P = shapeParams(p.seed), sd = p.seed;
  let geo = new THREE.IcosahedronGeometry(1, p.lod || 6); geo.deleteAttribute("normal"); geo.deleteAttribute("uv"); geo = mergeVertices(geo);
  const a = geo.attributes.position, cols = new Float32Array(a.count * 3);
  const c0 = new THREE.Color(p.cols?.[0] || "#a08a5a"), c1 = new THREE.Color(p.cols?.[1] || "#8a7048");
  const dark = new THREE.Color("#221d1a"), speck = new THREE.Color("#b5bf4c"), pale = new THREE.Color("#dccfa9");
  const band = p.band, pine = p.pine, haze = p.haze, xian = p.xian || [], cracks = p.cracks || [], cuts = p.cuts || [];
  const bn = band ? band.n : null, pd = pine ? pine.dir : null, hd = haze ? haze.dir : null, hcol = haze ? new THREE.Color(haze.col) : null;
  const d = [0, 0, 0], v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < a.count; i++) {
    v.set(a.getX(i), a.getY(i), a.getZ(i)).normalize(); d[0] = v.x; d[1] = v.y; d[2] = v.z;
    let bd = 9;
    if (bn) bd = Math.abs(d[0] * bn[0] + d[1] * bn[1] + d[2] * bn[2] + 0.1 * (fbm(d[0] * 3, d[1] * 3, d[2] * 3, sd + 3, 2) - 0.5));
    const ridge = band && bd < band.w ? 0.035 * (1 - bd / band.w) : 0;                // 蟒帶是凸起的一圈
    const sp = surfacePoint(P, d, true); const pt = [sp[0] * (1 + ridge), sp[1] * (1 + ridge), sp[2] * (1 + ridge)];
    a.setXYZ(i, pt[0], pt[1], pt[2]);
    const grain = fbm(d[0] * 22, d[1] * 22, d[2] * 22, sd + 11, 2), blotch = fbm(d[0] * 3, d[1] * 3, d[2] * 3, sd + 5, 3);
    c.copy(c0).lerp(c1, blotch).multiplyScalar(0.55 + 0.9 * grain + 0.25 * (blotch - 0.5)).multiplyScalar(0.9 + 0.2 * hash3(i, 3, 7, sd));
    c.multiplyScalar(0.72 + 0.56 * skinLum(d));                                      // 外皮的沙粒顆粒（AI 畫的材質）
    if (blotch > 0.64) c.lerp(pale, (blotch - 0.64) * 1.2);                           // 風化發白
    if (hd) { const h = smooth(0.62, 0.9, d[0] * hd[0] + d[1] * hd[1] + d[2] * hd[2]) * (0.55 + 0.45 * fbm(d[0] * 6, d[1] * 6, d[2] * 6, sd + 91, 2)); if (h > 0) c.lerp(hcol, 0.62 * h); }   // 霧：一片淡淡的顏色罩在皮上
    if (pd) {                                                                          // 松花：黃綠小點，集中在某一側
      const near = smooth(0.45, 0.95, d[0] * pd[0] + d[1] * pd[1] + d[2] * pd[2]), s = fbm(d[0] * 34, d[1] * 34, d[2] * 34, sd + 57, 1);
      if (s > 0.9 - 0.2 * near * (0.4 + (pine.str || 0.3))) c.lerp(speck, 0.8);
    }
    for (const x of xian) { const k = smooth(0.9, 0.96, d[0] * x[0] + d[1] * x[1] + d[2] * x[2]) * (0.6 + 0.8 * fbm(d[0] * 9, d[1] * 9, d[2] * 9, sd + 33, 2)); if (k > 0.35) c.lerp(dark, Math.min(0.9, k)); }   // 癬：黑一塊
    for (const k of cracks) {                                                          // 表面的裂：平面切過皮的那條線
      const e = Math.abs(pt[0] * k.n[0] + pt[1] * k.n[1] + pt[2] * k.n[2] - k.d);
      if (e < 0.013 && Math.hypot(pt[0] - k.cc[0], pt[1] - k.cc[1], pt[2] - k.cc[2]) < k.cr) c.lerp(dark, 0.85 * (1 - e / 0.013));
    }
    if (band && bd < band.w) c.lerp(new THREE.Color("#4b4a3a"), 0.75 * (1 - bd / band.w));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 })));
  if (p.win) {                                                                          // 窗口：貼在表面的一小片磨亮平面，顏色是那個點裡面的東西
    const dir = p.win.dir, sp = surfacePoint(P, dir, false), nrm = new THREE.Vector3(dir[0] / (P.sx * P.sx), dir[1] / (P.sy * P.sy), dir[2] / (P.sz * P.sz)).normalize();
    const col = p.win.code >= 1 && p.win.code <= 8 ? TIER_COL[p.win.code] : "#8c877b";
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), new THREE.MeshStandardMaterial({ color: col, roughness: 0.1, metalness: 0.05, emissive: col, emissiveIntensity: p.win.code >= 4 ? 0.3 : 0.05, side: THREE.DoubleSide }));
    m.position.set(sp[0], sp[1], sp[2]).addScaledVector(nrm, 0.012); m.lookAt(m.position.clone().add(nrm)); g.add(m);
  }
  for (const k of p.marks || []) {                                                      // 你探過的位置：擦皮磨開的小窗，打燈照出的光
    const sp = surfacePoint(P, k.dir, false), nrm = new THREE.Vector3(k.dir[0] / (P.sx * P.sx), k.dir[1] / (P.sy * P.sy), k.dir[2] / (P.sz * P.sz)).normalize();
    let m;
    if (k.kind === "rub") {
      const col = k.code >= 1 && k.code <= 8 ? TIER_COL[k.code] : "#8c877b";
      m = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.1, emissive: col, emissiveIntensity: k.code >= 4 ? 0.3 : 0.05, side: THREE.DoubleSide }));
    } else if (k.level === 0) {
      m = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.15, 24), new THREE.MeshBasicMaterial({ color: 0x777777, side: THREE.DoubleSide }));
    } else {
      const col = k.q >= 5 ? 0x35e08a : k.q >= 3 ? 0x9fe0b0 : 0xeef0dc;
      m = new THREE.Mesh(new THREE.CircleGeometry(0.1 + 0.07 * k.level, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 + 0.15 * k.level, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    }
    m.position.set(sp[0], sp[1], sp[2]).addScaledVector(nrm, 0.015); m.lookAt(m.position.clone().add(nrm)); g.add(m);
  }
  g.scale.setScalar(0.85 + 0.22 * (p.size || 1));
  return g;
}

// ---- 切面圖：把伺服器的 48×48 格子畫成一張圖（石頭外面透明）。row 0 = 平面座標 b=-GS，col 0 = a=-GS
export function gridCanvas(b64, seed, px = 192) {
  const bin = atob(b64), g = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) g[i] = bin.charCodeAt(i);
  const c = document.createElement("canvas"); c.width = c.height = px; const x = c.getContext("2d"), im = x.createImageData(px, px);
  const col = (h) => { const k = new THREE.Color(h); return [k.r * 255, k.g * 255, k.b * 255]; };
  const pal = TIER_COL.map(col); pal[0] = col(ROCK); const hz = col(HAZE), ck = col(CRACK);
  for (let y = 0; y < px; y++) for (let xx = 0; xx < px; xx++) {
    const gi = Math.min(GRID - 1, Math.floor(xx / px * GRID)), gj = Math.min(GRID - 1, Math.floor(y / px * GRID)), code = g[gj * GRID + gi], o = (y * px + xx) * 4;
    if (code === OUT) { im.data[o + 3] = 0; continue; }
    const base = code === 9 ? ck : code === 10 ? hz : pal[code];
    const n = fbm(xx / px * 9, y / px * 9, 3, seed + code * 7, 3), fine = hash3(xx, y, 5, seed);
    let k = code === 0 ? 0.7 + 0.5 * n + 0.15 * fine : code === 10 ? 0.85 + 0.25 * n : 0.62 + 0.75 * n + 0.08 * fine;   // 翡翠有雲霧般的深淺
    const tx = code <= 8 ? texAt("t" + code, xx / px * 2 + (seed % 97) / 97, y / px * 2 + (seed % 89) / 89) : null;   // AI 畫的材質：混進顏色，等級的色調仍由伺服器格子決定
    if (tx) { const w = code === 0 ? 0.45 : 0.62; im.data[o] = Math.min(255, base[0] * k * (1 - w) + tx[0] * w); im.data[o + 1] = Math.min(255, base[1] * k * (1 - w) + tx[1] * w); im.data[o + 2] = Math.min(255, base[2] * k * (1 - w) + tx[2] * w); im.data[o + 3] = 255; continue; }
    im.data[o] = Math.min(255, base[0] * k); im.data[o + 1] = Math.min(255, base[1] * k); im.data[o + 2] = Math.min(255, base[2] * k); im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const o = document.createElement("canvas"); o.width = o.height = px; const y = o.getContext("2d"); y.filter = `blur(${Math.max(1, px / 110)}px)`; y.drawImage(c, 0, 0); return o;   // 輕微模糊，去掉格子感
}
function capMesh(b64, seed, axis, pos, dbl = true) {
  const n = AXES[axis], [u, w] = planeBasis(n), tex = new THREE.CanvasTexture(gridCanvas(b64, seed, 256));
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * GS, 2 * GS), new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22, transparent: true, alphaTest: 0.5, roughness: 0.28, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.08, envMapIntensity: 1.1, side: dbl ? THREE.DoubleSide : THREE.FrontSide }));
  m.matrixAutoUpdate = false; m.matrix.makeBasis(D(u), D(w), D(n)).setPosition(n[0] * pos, n[1] * pos, n[2] * pos); return m;
}

// 切開後的石頭：每一刀把「你選的那一塊」分成兩塊（座標軸對齊的盒子）。每塊用裁切平面剪出來，沿各刀的法線方向稍微拉開，露出切面。
// p.cuts = [{piece, lo, hi, axis, pos, grid}]（lo／hi 是切出來兩塊的編號），p.sold = 已賣掉（不顯示）的塊。
const N3 = (c) => new THREE.Vector3(...AXES[c.axis]);
export const GAP = 0.09;
function makeSplit(p, lod) {
  const cuts = p.cuts || [], sold = new Set(p.sold || []);
  const base = buildStone({ ...p, cuts: [], lod: cuts.length ? Math.min(lod || 6, 5) : lod }), sc = base.scale.x;
  const boxes = new Map([[0, { anc: [] }]]);
  cuts.forEach((c, ci) => {
    const par = boxes.get(c.piece); if (!par) return; par.split = true;
    boxes.set(c.lo, { anc: [...par.anc, { ci, axis: c.axis, sg: -1, pos: c.pos }] }); boxes.set(c.hi, { anc: [...par.anc, { ci, axis: c.axis, sg: 1, pos: c.pos }] });
  });
  const root = new THREE.Group(), leaves = [];
  for (const [id, bx] of boxes) {
    if (bx.split || sold.has(id)) continue;
    const h = base.clone(true); h.traverse((x) => { if (x.material) x.material = x.material.clone(); });
    const planes = bx.anc.map((e) => new THREE.Plane(N3(e).multiplyScalar(e.sg), 0));
    h.traverse((x) => { if (x.material) x.material.clippingPlanes = planes; });
    bx.anc.forEach((e, i) => { const cap = capMesh(cuts[e.ci].grid, p.seed, e.axis, e.pos); cap.material.clippingPlanes = planes.filter((_, j) => j !== i); h.add(cap); });
    root.add(h); leaves.push({ id, h, anc: bx.anc, planes });
  }
  const setGaps = (g) => {
    for (const lf of leaves) {
      const off = new THREE.Vector3(); lf.anc.forEach((e) => off.addScaledVector(N3(e), e.sg * g[e.ci]));
      lf.h.position.copy(off);
      lf.planes.forEach((pl, i) => { pl.constant = -(lf.anc[i].sg * lf.anc[i].pos * sc) - pl.normal.dot(off); });
    }
  };
  const highlight = (id) => { for (const lf of leaves) { const m = lf.h.children[0]?.material; if (m && m.emissive) m.emissive.set(lf.id === id ? 0x2a5a6a : 0x000000); } };
  const api = { root, sc, leaves, setGaps, highlight, n: cuts.length, P: shapeParams(p.seed) };
  setGaps(cuts.map(() => GAP * sc));
  return api;
}

export function createViewer(container) {
  const W = () => container.clientWidth || 320, H = () => Math.round(Math.min(W() * 0.8, 300));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H());
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 50);
  cam.position.set(0, 0.6, 4.6);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  const shc = document.createElement("canvas"); shc.width = shc.height = 128; { const x = shc.getContext("2d"), g = x.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.0; scene.add(shadow);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const l1 = new THREE.DirectionalLight(0xffffff, 1.5); l1.position.set(3, 4, 5); scene.add(l1);
  const l2 = new THREE.DirectionalLight(0x9fd0ff, 0.5); l2.position.set(-4, -1, -3); scene.add(l2);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.enableDamping = true; ctl.enablePan = false; ctl.minDistance = 2.4; ctl.maxDistance = 8; ctl.autoRotate = true; ctl.autoRotateSpeed = 1.2;
  ctl.addEventListener("start", () => { ctl.autoRotate = false; });
  let cur = null, raf = 0, dead = false, prev = null, sel = null, pickCb = null, down = null;
  const el = renderer.domElement, ray = new THREE.Raycaster();
  el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener("pointerup", (e) => {                                             // 點一下（不是拖曳）→ 取石頭表面那一點，換成方向
    if (!pickCb || !down || !cur || cur.n) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) return;
    const r = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), cam);
    const mesh = cur.leaves[0]?.h.children[0]; if (!mesh) return;
    const hit = ray.intersectObject(mesh)[0]; if (!hit) return;
    const lp = mesh.worldToLocal(hit.point.clone()), P = cur.P, d = [lp.x / P.sx, lp.y / P.sy, lp.z / P.sz], L = Math.hypot(...d) || 1;
    pickCb(d.map((x) => x / L));
  });
  renderer.localClippingEnabled = true;
  const tickers = new Set();
  const loop = () => { if (dead) return; raf = requestAnimationFrame(loop); const now = performance.now(); for (const f of [...tickers]) f(now); ctl.update(); renderer.render(scene, cam); };
  loop();
  const dispose3 = (o) => o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) { x.material.map?.dispose(); x.material.dispose(); } });
  return {
    el: renderer.domElement,
    show(p) { this.preview(null); if (cur) { scene.remove(cur.root); dispose3(cur.root); } cur = makeSplit(p, p.lod); scene.add(cur.root); if (sel != null) cur.highlight(sel); },
    highlight(id) { sel = id; cur?.highlight(id); },
    pickMode(cb) { pickCb = cb || null; el.style.cursor = cb ? "crosshair" : ""; },
    // 預覽刀的位置：一片半透明的平面，範圍是選到的那一塊（box = {lo, hi}，石頭座標）
    preview(axis, pos, box) {
      if (prev) { scene.remove(prev); dispose3(prev); prev = null; }
      if (axis == null || !cur) return;
      const n = AXES[axis], [u, w] = planeBasis(n), sc = cur.sc;
      const rng = (v) => { const k = [0, 1, 2].find((i) => Math.abs(v[i]) > 0.5), lo = Math.max(box ? box.lo[k] : -GS, -GS), hi = Math.min(box ? box.hi[k] : GS, GS); return v[k] > 0 ? [lo, hi] : [-hi, -lo]; };
      const [a0, a1] = rng(u), [b0, b1] = rng(w);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xdff8ff })));
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      m.matrixAutoUpdate = false;
      m.matrix.makeBasis(D(u), D(w), D(n)).scale(new THREE.Vector3(sc * (a1 - a0), sc * (b1 - b0), sc)).setPosition(sc * (n[0] * pos + u[0] * ca + w[0] * cb), sc * (n[1] * pos + u[1] * ca + w[1] * cb), sc * (n[2] * pos + u[2] * ca + w[2] * cb));
      prev = m; scene.add(m);
    },
    // 切石動畫：刀片掃過 → 那一塊沿切面分開、拉得更開露出真正的切面 → 留一道小縫停著。p 是切之前的石頭，cutObj 是這一刀
    cut(p, pAfter, cutObj) {
      return new Promise((resolve) => {
        if (!cur) return resolve();
        this.preview(null); ctl.autoRotate = false; ctl.target.set(0, 0, 0);
        const n = N3(cutObj), side = new THREE.Vector3().crossVectors(N3(cutObj), new THREE.Vector3(0, 1, 0)); if (side.length() < 0.1) side.set(1, 0, 0); side.normalize();
        cam.position.copy(side.multiplyScalar(2.9)).addScaledVector(n, 2.3).add(new THREE.Vector3(0, 1.1, 0)); ctl.update();
        const d = cutObj.pos, sc = cur.sc, old = (p.cuts || []).length;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.03), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55 }));
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); scene.add(blade);
        const NP = 90, pp = new Float32Array(NP * 3), vel = [], uu = planeBasis([n.x, n.y, n.z]);
        for (let i = 0; i < NP; i++) { const a = (Math.random() * 2 - 1) * 1.0, b = (Math.random() * 2 - 1) * 0.7, p0 = new THREE.Vector3().addScaledVector(D(uu[0]), a).addScaledVector(D(uu[1]), b).addScaledVector(n, sc * d); pp.set([p0.x, p0.y, p0.z], i * 3); vel.push(new THREE.Vector3((Math.random() - 0.5) * 0.02, Math.random() * 0.012, (Math.random() - 0.5) * 0.02).addScaledVector(n, (Math.random() - 0.5) * 0.01)); }
        const mg = new THREE.BufferGeometry(); mg.setAttribute("position", new THREE.BufferAttribute(pp, 3));
        const mist = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xdff6ff, size: 0.045, transparent: true, opacity: 0, depthWrite: false })); scene.add(mist);
        const t0 = performance.now(), ease = (x) => x * x * (3 - 2 * x); let phase = 0, nx = null;
        const f = (now) => {
          const t = now - t0;
          if (t < 2200) { mist.material.opacity = t < 700 ? (t / 700) * 0.85 : Math.max(0, 0.85 * (1 - (t - 700) / 1500)); const a = mg.attributes.position; for (let i = 0; i < NP; i++) a.setXYZ(i, a.getX(i) + vel[i].x, a.getY(i) + vel[i].y, a.getZ(i) + vel[i].z); a.needsUpdate = true; }
          else if (mist.parent) { scene.remove(mist); mg.dispose(); mist.material.dispose(); }
          if (t < 800) blade.position.copy(n).multiplyScalar(sc * d + (-1.6 + 3.2 * ease(t / 800)));
          else if (phase === 0) {
            phase = 1; scene.remove(blade);
            scene.remove(cur.root); dispose3(cur.root); nx = cur = makeSplit({ ...pAfter }, 5); scene.add(cur.root); if (sel != null) cur.highlight(sel);
          }
          if (phase === 1) {
            const k = t < 1500 ? ease((t - 800) / 700) : t < 3300 ? 1 : 1 - ease(Math.min(1, (t - 3300) / 600));
            nx.setGaps(Array.from({ length: old + 1 }, (_, i) => (i < old ? GAP * sc : GAP * sc + (0.8 * sc - GAP * sc) * k)));
            if (t >= 3900) { tickers.delete(f); resolve(); }
          }
        };
        tickers.add(f);
      });
    },
    resize() { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); },
    // 縮圖：把一顆石頭畫成小圖（用同一個 renderer，畫完還原）
    thumb(p, px = 120) {
      const s = new THREE.Scene(); s.add(new THREE.AmbientLight(0xffffff, 0.8)); const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(3, 4, 5); s.add(dl);
      const st = buildStone({ ...p, cuts: [], lod: 4 }); st.rotation.y = 0.6; s.add(st);
      const c = new THREE.PerspectiveCamera(40, 1, 0.1, 50); c.position.set(0, 0.6, 4.4); c.lookAt(0, 0, 0);
      const pv = renderer.getSize(new THREE.Vector2()); renderer.setSize(px, px, false); renderer.render(s, c);
      const url = renderer.domElement.toDataURL("image/png"); dispose3(st);
      renderer.setSize(pv.x, pv.y, false); return url;
    },
    sectionCanvas: gridCanvas,
    destroy() { dead = true; cancelAnimationFrame(raf); ctl.dispose(); if (cur) dispose3(cur.root); renderer.dispose(); renderer.domElement.remove(); },
  };
}
