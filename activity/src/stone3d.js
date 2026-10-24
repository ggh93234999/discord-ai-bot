// 賭石的 3D 原石：用 three.js 畫，可以拖曳旋轉、滾輪／雙指縮放。
// 外觀只由伺服器給的「線索」決定（外皮等級 skinJ、窗口等級 windowJ、已切的切面等級 cuts），看不到真正的價值。
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// 各等級切面／窗口的顏色（0 廢石 … 8 帝王綠）
const TIER_COL = ["#8a8a84", "#a9b8a0", "#9fc296", "#7dbb7a", "#4fae6a", "#8fdcc0", "#2fc45a", "#12c46a", "#00d673"];
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 3D 值雜訊（同一顆石頭固定）：做出粗糙的砂皮和凹凸
const hash3 = (x, y, z, sd) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(sd | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z, sd) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
  const l = (a, b, t) => a + (b - a) * t, h = (i, j, k) => hash3(xi + i, yi + j, zi + k, sd);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy), l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
const fbm = (x, y, z, sd, oct = 4) => { let a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, z * f, sd + i * 17); a *= 0.5; f *= 2.1; } return t; };

// 這顆石頭的形狀：圓潤的河床卵石，帶一點扁、一點凹凸，表面是砂粒
function shapeOf(seed) {
  const r = mulberry(seed), sx = 0.95 + r() * 0.3, sy = 0.62 + r() * 0.25, sz = 0.8 + r() * 0.25;
  const lump = 0.2 + r() * 0.16, rid = 0.05 + r() * 0.06;
  return (dir, fine = true) => {
    const rad = 1 + lump * (fbm(dir.x * 1.7 + 5, dir.y * 1.7 + 5, dir.z * 1.7 + 5, seed, 3) - 0.5) * 2 + rid * (fbm(dir.x * 4.5, dir.y * 4.5, dir.z * 4.5, seed + 41, 3) - 0.5) + (fine ? 0.035 * (fbm(dir.x * 13, dir.y * 13, dir.z * 13, seed + 99, 3) - 0.5) : 0);
    return new THREE.Vector3(dir.x * sx, dir.y * sy, dir.z * sz).multiplyScalar(rad);
  };
}
const dirs = (seed, n) => { const r = mulberry(seed ^ 0x9e37); return Array.from({ length: n }, () => new THREE.Vector3(r() * 2 - 1, (r() * 2 - 1) * 0.6, r() * 2 - 1).normalize()); };
// 原石外皮的底色：黃沙皮、黃褐、鐵鏽紅、灰褐、黑烏沙（每顆固定一種，和價值無關）
const SKINS = ["#b39a6e", "#a8844f", "#8b5a3a", "#6e655a", "#4a3d33", "#a0865c", "#7a6446"];

export function buildStone(p) {                       // p: { seed, size, skinJ, windowJ, cuts:[j...], opened: j|null, lod }
  const g = new THREE.Group(), pos = shapeOf(p.seed);
  let geo = new THREE.IcosahedronGeometry(1, p.lod || 6); geo.deleteAttribute("normal"); geo.deleteAttribute("uv"); geo = mergeVertices(geo);
  const a = geo.attributes.position, cols = new Float32Array(a.count * 3);
  const r = mulberry(p.seed + 7), skin = p.skinJ ?? 0, sd = p.seed;
  const base = new THREE.Color(SKINS[Math.floor(r() * SKINS.length)]);
  const bd = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), bandW = 0.05 + r() * 0.04;
  const bandOn = skin >= 4 || r() < 0.12, bandCol = new THREE.Color("#4b4a3a"), speck = new THREE.Color("#a3ad4f"), dark = new THREE.Color("#241f1c"), pale = new THREE.Color("#d8c9a4");
  const v = new THREE.Vector3(), c = new THREE.Color(), q = new THREE.Vector3();
  for (let i = 0; i < a.count; i++) {
    v.set(a.getX(i), a.getY(i), a.getZ(i)).normalize();
    const d = v.clone(), band = bandOn ? Math.abs(d.dot(bd) + 0.1 * (fbm(d.x * 3, d.y * 3, d.z * 3, sd + 3, 2) - 0.5)) : 9;
    const ridge = bandOn && band < bandW ? 0.035 * (1 - band / bandW) : 0;           // 蟒帶是凸起的一圈
    q.copy(pos(d)); q.multiplyScalar(1 + ridge); a.setXYZ(i, q.x, q.y, q.z);
    const grain = fbm(d.x * 22, d.y * 22, d.z * 22, sd + 11, 2), blotch = fbm(d.x * 3, d.y * 3, d.z * 3, sd + 5, 3);
    c.copy(base).multiplyScalar(0.5 + 0.95 * grain + 0.3 * (blotch - 0.5)).multiplyScalar(0.88 + 0.24 * hash3(i, 3, 7, sd));
    if (blotch > 0.62) c.lerp(pale, (blotch - 0.62) * 1.4);                           // 風化發白
    const patch = fbm(d.x * 4.5, d.y * 4.5, d.z * 4.5, sd + 31, 3);
    if (patch > 0.64) c.lerp(dark, Math.min(0.85, (patch - 0.64) * 4));              // 黑癬
    if (skin >= 3) { const sp = fbm(d.x * 30, d.y * 30, d.z * 30, sd + 57, 1); if (sp > 0.8 - skin * 0.012) c.lerp(speck, 0.75); }   // 松花：黃綠小點
    const crk = Math.abs(fbm(d.x * 5.5, d.y * 5.5, d.z * 5.5, sd + 71, 3) - 0.5); if (crk < 0.012) c.lerp(dark, 0.85);                // 裂紋
    if (band < bandW) c.lerp(bandCol, 0.8 * (1 - band / bandW));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
  const opened = p.opened != null;
  const mat = opened
    ? new THREE.MeshPhysicalMaterial({ color: TIER_COL[p.opened], roughness: p.opened >= 5 ? 0.08 : 0.5, transmission: p.opened >= 5 ? 0.6 : 0, thickness: 1, emissive: TIER_COL[p.opened], emissiveIntensity: p.opened === 0 ? 0 : 0.18 + p.opened * 0.03 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  g.add(new THREE.Mesh(geo, mat));
  // 窗口與切面：貼在表面的一小片磨亮的平面，顏色是該線索的等級
  const faces = [...(p.windowJ != null ? [{ j: p.windowJ, w: true }] : []), ...(p.cuts || []).map((j) => ({ j }))];
  const where = dirs(p.seed, 8);
  faces.forEach((f, i) => {
    const d = where[i % where.length], cp = pos(d.clone(), false), nrm = d.clone();
    const m = new THREE.Mesh(new THREE.CircleGeometry(f.w ? 0.17 : 0.26, 32), new THREE.MeshStandardMaterial({ color: TIER_COL[f.j], roughness: 0.12, metalness: 0.05, emissive: TIER_COL[f.j], emissiveIntensity: f.j >= 4 ? 0.3 : 0.06, side: THREE.DoubleSide }));
    m.position.copy(cp.multiplyScalar(1.01)); m.lookAt(m.position.clone().add(nrm));
    g.add(m);
  });
  g.scale.setScalar(0.85 + 0.22 * (p.size || 1));
  return g;
}


// ---- 切石動畫用：切面貼圖與切面形狀
function capTexture(j, seed) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), r = mulberry(seed + j * 13);
  const base = new THREE.Color(TIER_COL[j]); const css = (col, k = 1) => `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
  x.fillStyle = j === 0 ? "#8d8b85" : css(base, 0.8); x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {                                    // 紋理：深淺不一的雲霧
    const px = r() * 256, py = r() * 256, rad = 8 + r() * 34, k = 0.65 + r() * 0.7;
    const gr = x.createRadialGradient(px, py, 0, px, py, rad); gr.addColorStop(0, css(base, j === 0 ? 0.9 + r() * 0.25 : k) .replace("rgb", "rgba").replace(")", ",0.55)")); gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr; x.beginPath(); x.arc(px, py, rad, 0, 6.3); x.fill();
  }
  if (j >= 1 && j <= 3) { x.fillStyle = "rgba(160,150,135,0.45)"; for (let i = 0; i < 40; i++) { x.beginPath(); x.arc(r() * 256, r() * 256, 4 + r() * 18, 0, 6.3); x.fill(); } }   // 低等級：灰白底夾雜綠
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function sectionCap(geo, n, d, j, seed) {
  const a = geo.attributes.position, pts = []; const v = new THREE.Vector3();
  for (let i = 0; i < a.count; i++) { v.set(a.getX(i), a.getY(i), a.getZ(i)); if (Math.abs(v.dot(n) - d) < 0.03) pts.push(v.clone()); }
  if (pts.length < 8) return null;
  const ctr = pts.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const u = new THREE.Vector3(0, 1, 0).cross(n).normalize(), w = n.clone().cross(u).normalize(), NB = 72, rad = new Array(NB).fill(0);
  for (const p of pts) { const q = p.clone().sub(ctr), x = q.dot(u), y = q.dot(w), b = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * NB) % NB; rad[b] = Math.max(rad[b], Math.hypot(x, y)); }
  for (let k = 0; k < NB; k++) if (!rad[k]) { let l = k, r2 = k; while (!rad[l % NB] && l > k - NB) l--; while (!rad[r2 % NB] && r2 < k + NB) r2++; rad[k] = (rad[(l + NB) % NB] + rad[r2 % NB]) / 2; }
  const R = Math.max(...rad), pos = [ctr.x, ctr.y, ctr.z], uv = [0.5, 0.5], idx = [];
  for (let k = 0; k < NB; k++) { const ang = ((k + 0.5) / NB) * 2 * Math.PI - Math.PI, rr = rad[k] * 0.985, p = ctr.clone().addScaledVector(u, Math.cos(ang) * rr).addScaledVector(w, Math.sin(ang) * rr); pos.push(p.x, p.y, p.z); uv.push(0.5 + (Math.cos(ang) * rr / R) * 0.5, 0.5 + (Math.sin(ang) * rr / R) * 0.5); idx.push(0, 1 + k, 1 + ((k + 1) % NB)); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: capTexture(j, seed), roughness: 0.18, metalness: 0.02, emissive: TIER_COL[j], emissiveIntensity: j >= 4 ? 0.22 : 0.04, side: THREE.DoubleSide }));
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
  let cur = null, raf = 0, dead = false;
  renderer.localClippingEnabled = true;
  const tickers = new Set();
  const loop = () => { if (dead) return; raf = requestAnimationFrame(loop); const now = performance.now(); for (const f of [...tickers]) f(now); ctl.update(); renderer.render(scene, cam); };
  loop();
  const dispose3 = (o) => o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
  return {
    el: renderer.domElement,
    show(p) { if (cur) { scene.remove(cur); dispose3(cur); } cur = buildStone(p); scene.add(cur); },
    // 切石動畫：刀片掃過 → 石頭從切面分成兩半、拉開露出切面 → 合回去。p 是切之前的石頭，pAfter 是切之後（多一片切面）
    cut(p, pAfter, j, idx = 0) {
      return new Promise((resolve) => {
        if (!cur) return resolve();
        ctl.autoRotate = false; cam.position.set(0, 0.5, 4.8); ctl.target.set(0, 0, 0); ctl.update();
        const r = mulberry(p.seed + 313 + idx * 7), sgn = r() < 0.5 ? -1 : 1;
        const n = new THREE.Vector3(sgn * (0.85 + r() * 0.2), 0.1 + r() * 0.15, 0.5 + r() * 0.15).normalize(), d = (r() - 0.5) * 0.3, sc = cur.scale.x;
        const geo = cur.children[0].geometry, cap = sectionCap(geo, n, d, j, p.seed + idx);
        const mkHalf = () => { const h = cur.clone(true); h.traverse((x) => { if (x.material) x.material = x.material.clone(); }); return h; };
        const A = mkHalf(), B = mkHalf(), pA = new THREE.Plane(n.clone(), 0), pB = new THREE.Plane(n.clone().negate(), 0);
        A.traverse((x) => { if (x.material) x.material.clippingPlanes = [pA]; }); B.traverse((x) => { if (x.material) x.material.clippingPlanes = [pB]; });
        if (cap) { B.add(cap); }
        const blade = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.03), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55 }));
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); scene.add(blade);
        const t0 = performance.now(), ease = (x) => x * x * (3 - 2 * x); let phase = 0;
        const setHalves = (o) => {
          A.position.copy(n).multiplyScalar(o); B.position.copy(n).multiplyScalar(-o);
          pA.constant = -(sc * d + o); pB.constant = sc * d - o;
        };
        const f = (now) => {
          const t = now - t0;
          if (t < 800) { blade.position.copy(n).multiplyScalar(-1.6 + 3.2 * ease(t / 800) + sc * d * 0); }
          else if (phase === 0) { phase = 1; scene.remove(blade); cur.visible = false; scene.add(A); scene.add(B); setHalves(0); }
          if (phase === 1) {
            const k = t < 1500 ? ease((t - 800) / 700) : t < 2700 ? 1 : 1 - ease(Math.min(1, (t - 2700) / 600));
            setHalves(0.8 * sc * k);
            if (t >= 3300) { tickers.delete(f); scene.remove(A); scene.remove(B); dispose3(A); dispose3(B); this.show(pAfter); resolve(); }
          }
        };
        tickers.add(f);
      });
    },
    resize() { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); },
    // 縮圖：把一顆石頭畫成小圖（用同一個 renderer，畫完還原）
    thumb(p, px = 120) {
      const s = new THREE.Scene(); s.add(new THREE.AmbientLight(0xffffff, 0.8)); const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(3, 4, 5); s.add(dl);
      const st = buildStone({ ...p, lod: 4 }); st.rotation.y = 0.6; s.add(st);
      const c = new THREE.PerspectiveCamera(40, 1, 0.1, 50); c.position.set(0, 0.6, 4.4); c.lookAt(0, 0, 0);
      const prev = renderer.getSize(new THREE.Vector2()); renderer.setSize(px, px, false); renderer.render(s, c);
      const url = renderer.domElement.toDataURL("image/png"); dispose3(st);
      renderer.setSize(prev.x, prev.y, false); return url;
    },
    destroy() { dead = true; cancelAnimationFrame(raf); ctl.dispose(); if (cur) dispose3(cur); renderer.dispose(); renderer.domElement.remove(); },
  };
}
