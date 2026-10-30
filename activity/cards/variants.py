import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
STYLE = ("traditional Chinese ink wash landscape painting, sumi-e on aged xuan rice paper, mostly black ink and soft gray washes with only a very faint pale gold tint, "
         "elegant Song dynasty shanshui style, vertical scroll composition, generous empty white mist space, subtle paper grain, one small red seal stamp, no text, no letters, no border, no rainbow, no bright colors, ")
V = [
 "the legendary immortal Mount Kunlun: a single colossal sheer peak rising from a sea of swirling mist, its summit disappearing into clouds, a tiny celestial palace with curved roofs on the peak, a few cranes flying, deep misty layers, ethereal and sacred",
 "Mount Kunlun as an immortal realm: several floating mountain peaks drifting in the clouds with thin waterfalls falling into mist, small pavilions and pine trees on the cliffs, a pale glowing moon behind the mist, cranes flying, quiet and mystical",
 "Mount Kunlun, the abode of immortals: towering jagged peaks emerging from a flowing river of clouds, a stone stairway climbing up to a tiny temple gate in the sky, auspicious cloud swirls, one small figure of an immortal in robes standing on the cliff edge, ethereal light mist",
 "Mount Kunlun paradise: ink-wash peaks layered in receding mist, a jade pool at the foot with a few peach blossoms drawn in pale ink, a phoenix soaring above the summit trailing mist, subtle luminous glow around the top peak, serene and otherworldly",
]
for k, p in enumerate(V, 1):
    out = os.path.join(D, f"variants/kl_{k}.jpg"); t0 = time.time()
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": "draw-qwen-fast", "prompt": STYLE + p, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
            it = json.load(urllib.request.urlopen(req, timeout=400))["data"][0]
            raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
            Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(k, f"{time.time()-t0:.0f}s", flush=True); break
        except Exception as e:
            print(k, "err", str(e)[:100], flush=True); time.sleep(5)
