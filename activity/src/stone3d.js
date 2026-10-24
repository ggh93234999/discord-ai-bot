// 賭石的 3D 原石：用 three.js 畫，可以拖曳旋轉、滾輪／雙指縮放。
// 外觀只由伺服器給的「線索」決定（外皮等級 skinJ、窗口等級 windowJ、已切的切面等級 cuts），看不到真正的價值。
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// 各等級切面／窗口的顏色（0 廢石 … 8 帝王綠）
const TIER_COL = ["#8a8a84", "#a9b8a0", "#9fc296", "#7dbb7a", "#4fae6a", "#8fdcc0", "#2fc45a", "#12c46a", "#00d673"];
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 這顆石頭的形狀：球面方向 → 半徑（不規則、帶點扁）
function shapeOf(seed) {
  const r = mulberry(seed), waves = [];
  for (let i = 0; i < 7; i++) waves.push({ d: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), f: 1.2 + r() * 3.2, p: r() * 6.28, a: 0.05 + r() * 0.09 });
  const sx = 0.9 + r() * 0.35, sy = 0.65 + r() * 0.3, sz = 0.85 + r() * 0.3;
  return (dir) => {
    let rad = 1; for (const w of waves) rad += w.a * Math.sin(w.f * 3 * dir.dot(w.d) + w.p);
    return new THREE.Vector3(dir.x * sx, dir.y * sy, dir.z * sz).multiplyScalar(rad);
  };
}
const dirs = (seed, n) => { const r = mulberry(seed ^ 0x9e37); return Array.from({ length: n }, () => new THREE.Vector3(r() * 2 - 1, (r() * 2 - 1) * 0.6, r() * 2 - 1).normalize()); };

export function buildStone(p) {                       // p: { seed, size, skinJ, windowJ, cuts:[j...], opened: j|null }
  const g = new THREE.Group(), pos = shapeOf(p.seed);
  let geo = new THREE.IcosahedronGeometry(1, 5); geo.deleteAttribute("normal"); geo.deleteAttribute("uv"); geo = mergeVertices(geo);
  const a = geo.attributes.position, cols = new Float32Array(a.count * 3);
  const r = mulberry(p.seed + 7), skin = p.skinJ ?? 0, base = new THREE.Color("#6e655a"), green = new THREE.Color("#6f8a52"), speck = new THREE.Color("#8fae55"), band = new THREE.Color("#3f4a33");
  const tint = base.clone().lerp(green, Math.min(1, skin / 10)), bandOn = skin >= 4, bd = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
  const sp = [], n = 14 + skin * 10; for (let i = 0; i < n; i++) sp.push({ d: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), s: 0.12 + r() * 0.2 });
  const v = new THREE.Vector3();
  for (let i = 0; i < a.count; i++) {
    v.set(a.getX(i), a.getY(i), a.getZ(i)).normalize();
    const d = v.clone(), q = pos(d); a.setXYZ(i, q.x, q.y, q.z);
    const c = tint.clone().multiplyScalar(0.85 + 0.3 * Math.sin(d.x * 9 + d.y * 7) * Math.cos(d.z * 8));
    for (const s of sp) if (d.dot(s.d) > 1 - s.s * s.s * 0.5) c.lerp(speck, 0.6);                                           // 松花
    if (bandOn && Math.abs(d.dot(bd) + 0.12 * Math.sin(d.x * 6 + d.z * 5)) < 0.04 + skin * 0.008) c.lerp(band, 0.85);       // 蟒帶
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
  const opened = p.opened != null;
  const mat = opened
    ? new THREE.MeshPhysicalMaterial({ color: TIER_COL[p.opened], roughness: p.opened >= 5 ? 0.08 : 0.5, transmission: p.opened >= 5 ? 0.6 : 0, thickness: 1, emissive: TIER_COL[p.opened], emissiveIntensity: p.opened === 0 ? 0 : 0.18 + p.opened * 0.03 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  g.add(new THREE.Mesh(geo, mat));
  // 窗口與切面：貼在表面的一小片平面，顏色是該線索的等級
  const faces = [...(p.windowJ != null ? [{ j: p.windowJ, w: true }] : []), ...(p.cuts || []).map((j) => ({ j }))];
  const where = dirs(p.seed, 8);
  faces.forEach((f, i) => {
    const d = where[i % where.length], c = pos(d.clone()), nrm = d.clone();
    const m = new THREE.Mesh(new THREE.CircleGeometry(f.w ? 0.2 : 0.28, 28), new THREE.MeshStandardMaterial({ color: TIER_COL[f.j], roughness: 0.15, metalness: 0.05, emissive: TIER_COL[f.j], emissiveIntensity: f.j >= 4 ? 0.35 : 0.08, side: THREE.DoubleSide }));
    m.position.copy(c.multiplyScalar(1.004)); m.lookAt(m.position.clone().add(nrm));
    g.add(m);
  });
  g.scale.setScalar(0.75 + 0.35 * (p.size || 1));
  return g;
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
  const loop = () => { if (dead) return; raf = requestAnimationFrame(loop); ctl.update(); renderer.render(scene, cam); };
  loop();
  const dispose3 = (o) => o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
  return {
    el: renderer.domElement,
    show(p) { if (cur) { scene.remove(cur); dispose3(cur); } cur = buildStone(p); scene.add(cur); },
    resize() { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); },
    // 縮圖：把一顆石頭畫成小圖（用同一個 renderer，畫完還原）
    thumb(p, px = 120) {
      const s = new THREE.Scene(); s.add(new THREE.AmbientLight(0xffffff, 0.8)); const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(3, 4, 5); s.add(dl);
      const st = buildStone(p); st.rotation.y = 0.6; s.add(st);
      const c = new THREE.PerspectiveCamera(40, 1, 0.1, 50); c.position.set(0, 0.6, 4.4); c.lookAt(0, 0, 0);
      const prev = renderer.getSize(new THREE.Vector2()); renderer.setSize(px, px, false); renderer.render(s, c);
      const url = renderer.domElement.toDataURL("image/png"); dispose3(st);
      renderer.setSize(prev.x, prev.y, false); return url;
    },
    destroy() { dead = true; cancelAnimationFrame(raf); ctl.dispose(); if (cur) dispose3(cur); renderer.dispose(); renderer.domElement.remove(); },
  };
}
