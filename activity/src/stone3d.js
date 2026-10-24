// 賭石的 3D 原石：用 three.js 畫，可以拖曳旋轉、滾輪／雙指縮放。
// 外觀只由伺服器給的「外表線索」決定（場口顏色、松花、蟒帶、霧、癬、裂、窗口），看不到裡面。
// 切面是伺服器依石頭內部算出的 48×48 格子（共用 shared/stonegeo.js 的座標），這裡只負責畫。
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mulberry, hash3, fbm, shapeParams, surfacePoint, AXES, GRID, GS, OUT, planeBasis } from "../shared/stonegeo.js";

// 翡翠等級（1 綠絲石 … 8 帝王綠）在切面上的顏色
export const TIER_COL = ["#7a7468", "#b9c4ac", "#a8c79c", "#86c488", "#5db878", "#a7e0cc", "#3fc968", "#1fc46e", "#08d878"];
const ROCK = "#7d7769", HAZE = "#d9d5c6", CRACK = "#2e2a27";

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
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })));
  if (p.win) {                                                                          // 窗口：貼在表面的一小片磨亮平面，顏色是那個點裡面的東西
    const dir = p.win.dir, sp = surfacePoint(P, dir, false), nrm = new THREE.Vector3(dir[0] / (P.sx * P.sx), dir[1] / (P.sy * P.sy), dir[2] / (P.sz * P.sz)).normalize();
    const col = p.win.code >= 1 && p.win.code <= 8 ? TIER_COL[p.win.code] : "#8c877b";
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), new THREE.MeshStandardMaterial({ color: col, roughness: 0.1, metalness: 0.05, emissive: col, emissiveIntensity: p.win.code >= 4 ? 0.3 : 0.05, side: THREE.DoubleSide }));
    m.position.set(sp[0], sp[1], sp[2]).addScaledVector(nrm, 0.012); m.lookAt(m.position.clone().add(nrm)); g.add(m);
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
    im.data[o] = Math.min(255, base[0] * k); im.data[o + 1] = Math.min(255, base[1] * k); im.data[o + 2] = Math.min(255, base[2] * k); im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const o = document.createElement("canvas"); o.width = o.height = px; const y = o.getContext("2d"); y.filter = `blur(${Math.max(1, px / 110)}px)`; y.drawImage(c, 0, 0); return o;   // 輕微模糊，去掉格子感
}
function capMesh(b64, seed, axis, pos, dbl = true) {
  const n = AXES[axis], [u, w] = planeBasis(n), tex = new THREE.CanvasTexture(gridCanvas(b64, seed, 256));
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * GS, 2 * GS), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.2, metalness: 0.02, side: dbl ? THREE.DoubleSide : THREE.FrontSide }));
  m.matrixAutoUpdate = false; m.matrix.makeBasis(D(u), D(w), D(n)).setPosition(n[0] * pos, n[1] * pos, n[2] * pos); return m;
}

// 切開後的石頭：n 刀 → 最多 2^n 塊，每塊用裁切平面剪出來，並沿各刀的法線方向稍微拉開，露出切面
const N3 = (c) => new THREE.Vector3(...AXES[c.axis]);
export const GAP = 0.09;
function makeSplit(p, lod) {
  const cuts = p.cuts || [], base = buildStone({ ...p, cuts: [], lod: cuts.length ? Math.min(lod || 6, 5) : lod }), sc = base.scale.x, k = cuts.length;
  if (!k) return { root: base, sc, setGaps() {} };
  const root = new THREE.Group(), pieces = [];
  for (let m = 0; m < (1 << k); m++) {
    const sg = cuts.map((_, i) => ((m >> i) & 1 ? 1 : -1)), h = base.clone(true);
    h.traverse((x) => { if (x.material) x.material = x.material.clone(); });
    const planes = sg.map((si, i) => new THREE.Plane(N3(cuts[i]).multiplyScalar(si), 0));
    h.traverse((x) => { if (x.material) x.material.clippingPlanes = planes; });
    cuts.forEach((c, i) => { const cap = capMesh(c.grid, p.seed, c.axis, c.pos); cap.material.clippingPlanes = planes.filter((_, j) => j !== i); h.add(cap); });
    root.add(h); pieces.push({ h, sg, planes });
  }
  const setGaps = (g) => {
    for (const pc of pieces) {
      const off = new THREE.Vector3(); pc.sg.forEach((si, i) => off.addScaledVector(N3(cuts[i]), si * g[i]));
      pc.h.position.copy(off);
      pc.planes.forEach((pl, i) => { pl.constant = -(pc.sg[i] * cuts[i].pos * sc) - pl.normal.dot(off); });
    }
  };
  setGaps(cuts.map(() => GAP * sc));
  return { root, sc, setGaps };
}

export function createViewer(container) {
  const W = () => container.clientWidth || 320, H = () => Math.round(Math.min(W() * 0.8, 300));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H());
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 50);
  cam.position.set(0, 0.6, 4.6);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const l1 = new THREE.DirectionalLight(0xffffff, 1.5); l1.position.set(3, 4, 5); scene.add(l1);
  const l2 = new THREE.DirectionalLight(0x9fd0ff, 0.5); l2.position.set(-4, -1, -3); scene.add(l2);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.enableDamping = true; ctl.enablePan = false; ctl.minDistance = 2.4; ctl.maxDistance = 8; ctl.autoRotate = true; ctl.autoRotateSpeed = 1.2;
  ctl.addEventListener("start", () => { ctl.autoRotate = false; });
  let cur = null, raf = 0, dead = false, prev = null;
  renderer.localClippingEnabled = true;
  const tickers = new Set();
  const loop = () => { if (dead) return; raf = requestAnimationFrame(loop); const now = performance.now(); for (const f of [...tickers]) f(now); ctl.update(); renderer.render(scene, cam); };
  loop();
  const dispose3 = (o) => o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) { x.material.map?.dispose(); x.material.dispose(); } });
  return {
    el: renderer.domElement,
    show(p) { this.preview(null); if (cur) { scene.remove(cur.root); dispose3(cur.root); } cur = makeSplit(p, p.lod); scene.add(cur.root); },
    // 預覽刀的位置：一片半透明的平面穿過石頭（座標是石頭的本地座標，要乘上石頭的縮放）
    preview(axis, pos) {
      if (prev) { scene.remove(prev); dispose3(prev); prev = null; }
      if (axis == null || !cur) return;
      const n = AXES[axis], [u, w] = planeBasis(n), sc = cur.sc;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * GS * 0.9, 2 * GS * 0.9), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xdff8ff })));
      m.matrixAutoUpdate = false; m.matrix.makeBasis(D(u), D(w), D(n)).scale(new THREE.Vector3(sc, sc, sc)).setPosition(n[0] * pos * sc, n[1] * pos * sc, n[2] * pos * sc);
      prev = m; scene.add(m);
    },
    // 切石動畫：刀片掃過 → 石頭沿切面分開、拉得更開露出真正的切面 → 留一道小縫停著。p 是切之前的石頭，cutObj = {axis,pos,grid} 是這一刀
    cut(p, pAfter, cutObj) {
      return new Promise((resolve) => {
        if (!cur) return resolve();
        this.preview(null); ctl.autoRotate = false; cam.position.set(1.2, 0.8, 4.6); ctl.target.set(0, 0, 0); ctl.update();
        const n = N3(cutObj), d = cutObj.pos, sc = cur.sc, old = (p.cuts || []).length;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.03), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55 }));
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); scene.add(blade);
        const t0 = performance.now(), ease = (x) => x * x * (3 - 2 * x); let phase = 0, nx = null;
        const f = (now) => {
          const t = now - t0;
          if (t < 800) blade.position.copy(n).multiplyScalar(sc * d + (-1.6 + 3.2 * ease(t / 800)));
          else if (phase === 0) {
            phase = 1; scene.remove(blade);
            scene.remove(cur.root); dispose3(cur.root); nx = cur = makeSplit({ ...p, cuts: [...(p.cuts || []), cutObj] }, 5); scene.add(cur.root);
          }
          if (phase === 1) {
            const k = t < 1500 ? ease((t - 800) / 700) : t < 3300 ? 1 : 1 - ease(Math.min(1, (t - 3300) / 600));
            const gaps = Array.from({ length: old + 1 }, (_, i) => (i < old ? GAP * sc : GAP * sc + (0.8 * sc - GAP * sc) * k));
            nx.setGaps(gaps);
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
