import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
STYLE = ("traditional Chinese ink wash painting, sumi-e on aged xuan rice paper, expressive black ink brushwork with soft gray washes, "
         "vertical portrait composition, subtle paper grain, one small red seal stamp, no text, no letters, no border, ")
V = [
 "Bifang, the mythical fire crane of Chinese legend, an elegant long-necked crane-like bird with a sharp beak, standing gracefully on a single slender leg exactly like a resting crane with the other leg naturally tucked up under its feathers, so the pose looks natural and balanced, long flowing tail feathers, small ink flames licking along its wings and tail, red-tinged crest, dark pine mountain in mist behind it, anatomically coherent bird",
 "Bifang, the one-legged fire bird of Chinese mythology, a majestic crane with long neck, white and blue-gray feathers edged with red flame patterns, wings half spread, balanced on its single leg on a rock, small ink-wash flames curling from its wing tips, elegant natural bird anatomy, misty mountains, graceful and sacred",
]
for k, p in enumerate(V, 1):
    out = os.path.join(D, f"variants/bf_{k}.jpg"); t0 = time.time()
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": "draw-qwen-fast", "prompt": STYLE + p, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
            it = json.load(urllib.request.urlopen(req, timeout=400))["data"][0]
            raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
            Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(k, f"{time.time()-t0:.0f}s", flush=True); break
        except Exception as e:
            print(k, "err", str(e)[:100], flush=True); time.sleep(5)
