// 擲骰子／擲硬幣的 3D 桌面（three.js）。結果由伺服器決定，這裡只負責「讓東西真的滾過去、停在指定的那一面」。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const COINURL = {};
for (const [pth, url] of Object.entries(import.meta.glob("./dice-art/coin_*.png", { eager: true, query: "?url", import: "default" }))) COINURL[pth.split("/").pop().slice(5, -4)] = url;

// 骰子六個面的法線與點數（對面加起來 7）：BoxGeometry 的材質順序是 +x −x +y −y +z −z
const FACE = [[1, 0, 0, 3], [-1, 0, 0, 4], [0, 1, 0, 1], [0, -1, 0, 6], [0, 0, 1, 2], [0, 0, -1, 5]];
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
const SCHEME = { you: { base: "#f3eee0", edge: "#d8d0bb", pip: "#17171a", one: "#c9252c" }, bank: { base: "#a8222a", edge: "#7d161d", pip: "#fbf4e2", one: "#fbf4e2" } };

function faceTex(v, sc) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
  const g = x.createRadialGradient(128, 112, 20, 128, 128, 190); g.addColorStop(0, sc.base); g.addColorStop(1, sc.edge);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (const [px, py] of PIPS[v]) {
    const cx = 128 + px * 56, cy = 128 + py * 56, r = v === 1 ? 40 : 26, col = v === 1 ? sc.one : sc.pip;
    const pg = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r); pg.addColorStop(0, col); pg.addColorStop(1, "rgba(0,0,0,0.55)");
    x.fillStyle = "rgba(0,0,0,0.35)"; x.beginPath(); x.arc(cx, cy + 2, r + 2, 0, 7); x.fill();                     // 凹洞的邊
    x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.fillStyle = pg; x.globalAlpha = 0.45; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function feltTex() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 360; const x = c.getContext("2d");
  const g = x.createRadialGradient(256, 160, 30, 256, 180, 330); g.addColorStop(0, "#2f7a4c"); g.addColorStop(0.6, "#1f5a37"); g.addColorStop(1, "#0f3322");
  x.fillStyle = g; x.fillRect(0, 0, 512, 360);
  const im = x.getImageData(0, 0, 512, 360), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }       // 絨布的細紋
  x.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function coinFallback(label) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
  const g = x.createRadialGradient(110, 100, 10, 128, 128, 140); g.addColorStop(0, "#fff0a0"); g.addColorStop(0.6, "#e0b22c"); g.addColorStop(1, "#9a6c10");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); x.strokeStyle = "#7a520c"; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.stroke();
  x.fillStyle = "#7a520c"; x.font = "bold 110px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 128, 134);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const ease = (p) => 1 - (1 - p) * (1 - p), arc = (u) => 4 * u * (1 - u);
// 落下、彈跳三次的高度（p 0..1）：先從 H0 掉下來，再彈 .9、.28、.08
function bounceY(p, H0, base) {
  if (p < 0.45) { const u = p / 0.45; return base + (H0 - base) * (1 - u * u); }
  if (p < 0.72) return base + 0.9 * arc((p - 0.45) / 0.27);
  if (p < 0.88) return base + 0.28 * arc((p - 0.72) / 0.16);
  return base + 0.08 * arc((p - 0.88) / 0.12);
}
const rnd = (a, b) => a + Math.random() * (b - a);

export function createTable(container) {
  const W = () => container.clientWidth || 340, H = () => Math.round(Math.min(W() * 0.66, 320));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement); renderer.domElement.style.cssText = "width:100%;height:auto;border-radius:12px;display:block";
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(36, W() / H(), 0.1, 60);
  cam.position.set(0, 8.2, 6.4); cam.lookAt(0, 0, 0.2);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); scene.environmentIntensity = 0.55;
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2); sun.position.set(-3, 9, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6; sun.shadow.camera.far = 24; sun.shadow.radius = 5; sun.shadow.bias = -0.0006;
  scene.add(sun);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(16, 11), new THREE.MeshStandardMaterial({ map: feltTex(), roughness: 0.95, metalness: 0 }));
  table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
  let items = [], raf = 0, dead = false, anims = [];
  const clearItems = () => { for (const m of items) { scene.remove(m); m.traverse((o) => { if (o.geometry) o.geometry.dispose(); const mt = o.material; if (mt) (Array.isArray(mt) ? mt : [mt]).forEach((q) => { q.map && q.map.dispose(); q.dispose(); }); }); } items = []; };
  const frame = (ts) => {
    raf = 0; if (dead) return;
    const t = ts / 1000; anims = anims.filter((a) => { const p = Math.min(1, Math.max(0, (t - a.t0) / a.dur)); a.step(p); if (p >= 1) { a.done && a.done(); return false; } return true; });
    renderer.render(scene, cam); if (anims.length) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };
  const run = (dur, step, done) => { anims.push({ t0: performance.now() / 1000, dur, step, done }); kick(); };

  // ---- 骰子：kinds[i] = "you" | "bank"；vals[i] 1..6
  function rollDice(vals, kinds) {
    clearItems(); const spots = [[-1.2, 1.5], [0.9, 1.9], [-1.0, -1.6], [1.2, -1.2]];
    const geo = new RoundedBoxGeometry(1, 1, 1, 5, 0.12);
    return new Promise((resolve) => {
      let left = vals.length;
      vals.forEach((v, i) => {
        const mats = FACE.map(([, , , n]) => new THREE.MeshPhysicalMaterial({ map: faceTex(n, SCHEME[kinds[i]]), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
        const m = new THREE.Mesh(geo.clone(), mats); m.castShadow = true; scene.add(m); items.push(m);
        const f = FACE.find((q) => q[3] === v), qFin = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Vector3(0, 1, 0));
        qFin.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(0, 6.283)));
        const axis = new THREE.Vector3(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)).normalize(), th0 = rnd(8, 13) * (Math.random() < 0.5 ? -1 : 1);
        const [tx, tz] = spots[i % 4], sx = tx * 0.4 + rnd(-1, 1), sz = 5.4, H0 = rnd(2.6, 3.4), dur = rnd(1.35, 1.7), delay = i * 0.07;
        const qs = new THREE.Quaternion(); m.visible = false;
        const start = performance.now() / 1000 + delay;
        anims.push({ t0: start, dur, step: (p) => {
          m.visible = true; const e = ease(Math.min(1, p / 0.92));
          m.position.set(sx + (tx - sx) * e, bounceY(p, H0, 0.5), sz + (tz - sz) * e);
          qs.setFromAxisAngle(axis, th0 * Math.pow(1 - p, 1.7)); m.quaternion.copy(qs).multiply(qFin);
        }, done: () => { if (--left === 0) resolve(); } });
      });
      kick();
    });
  }
  // ---- 硬幣：res = "heads" | "tails"
  function flipCoin(res) {
    clearItems();
    const mk = (side, label) => { const t = COINURL[side] ? new THREE.TextureLoader().load(COINURL[side], () => kick()) : coinFallback(label); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const edge = new THREE.MeshStandardMaterial({ color: 0xe8b832, metalness: 0.8, roughness: 0.3, emissive: 0x4a3200, emissiveIntensity: 0.4 });
    const face = (t) => new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.32, metalness: 0.55, roughness: 0.3 });
    const topT = mk("heads", "正"), botT = mk("tails", "反"); botT.center.set(0.5, 0.5); botT.rotation = Math.PI;
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.19, 72), [edge, face(topT), face(botT)]); coin.castShadow = true; scene.add(coin); items.push(coin);
    const N = 7, fin = N * Math.PI * 2 + (res === "tails" ? Math.PI : 0), yaw = rnd(0, 6.283), wob = rnd(0.1, 0.22), dur = 2.1;
    return new Promise((resolve) => {
      const q = new THREE.Quaternion(), qx = new THREE.Quaternion(), qy = new THREE.Quaternion(), qz = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
      run(dur, (p) => {
        const air = 0.62;                                                  // 前 62% 的時間在空中
        let y, ang;
        if (p < air) { const u = p / air; y = 0.1 + 3.1 * arc(u); ang = fin * 0.93 * u; }
        else { const u = (p - air) / (1 - air); y = 0.1 + (u < 0.5 ? 0.45 * arc(u / 0.5) : u < 0.8 ? 0.12 * arc((u - 0.5) / 0.3) : 0.03 * arc((u - 0.8) / 0.2)); ang = fin * (0.93 + 0.07 * ease(Math.min(1, u * 1.4))); }
        const z = 2.4 - 2.2 * Math.min(1, p / air);
        coin.position.set(0.2 * Math.sin(p * 3), y, z);
        const settle = 1 - p;
        qx.setFromAxisAngle(X, ang); qz.setFromAxisAngle(Z, wob * Math.sin(p * 20) * settle * settle); qy.setFromAxisAngle(Y, yaw + p * 1.5 * settle);
        coin.quaternion.copy(qy).multiply(qz).multiply(qx);
      }, resolve);
    });
  }
  const resize = () => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); kick(); };
  const clear = () => { clearItems(); kick(); };
  const destroy = () => { dead = true; cancelAnimationFrame(raf); clearItems(); renderer.dispose(); renderer.domElement.remove(); };
  renderer.render(scene, cam);
  return { el: renderer.domElement, rollDice, flipCoin, resize, clear, destroy };
}
