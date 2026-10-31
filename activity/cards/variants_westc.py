# 西方卡重畫（單一序列、逾時 20 分鐘，避免多個工作同時排隊造成逾時）：結果存 variants/r{編號}.jpg
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
STYLE = ("East Asian ink wash painting (sumi-e) technique on aged paper applied to a Western European subject, expressive black ink brushwork with soft gray washes, "
         "vertical portrait composition, lots of negative space, subtle paper grain, one small red seal stamp, no text, no letters, no border, monochrome ink only, ")
J = [
 ("113_c1", "a centaur from Greek mythology, a hybrid creature: from the waist up a bearded muscular MAN with a human head, human chest and two human arms drawing a bow; the man's waist joins seamlessly into the shoulders of a horse's body, so below the human waist there is a horse's barrel chest, four horse legs and a horse tail; the creature has ONLY ONE head which is the human head, there is NO horse head and NO horse neck, no saddle, no rider, galloping through a forest, ancient Greek style"),
 ("113_c2", "side view of a centaur, human-horse hybrid: a man's torso and bearded human head rise upward from where a horse's neck would be, in the place of the horse's head and neck, the rest is a chestnut horse body with four legs and a swishing tail, the human holds a spear, only one head (human), no horse head anywhere, like an ancient Greek vase painting rendered in ink, standing on a rocky hillside with cypress trees"),
 ("113_c3", "a majestic centaur in profile galloping, the human torso with long hair and beard emerging from the front of a horse body at the chest, no horse neck and no horse head, human arms holding a bow raised, four horse hooves off the ground, horse tail streaming, single creature with a human head only, misty mountains"),
]
for cid, p in J:
    out = os.path.join(D, f"variants/c{cid}.jpg"); t0 = time.time()
    if os.path.exists(out): continue
    try:
        req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": "draw-qwen-fast", "prompt": STYLE + p, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        it = json.load(urllib.request.urlopen(req, timeout=1200))["data"][0]
        raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
        Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(cid, f"{time.time()-t0:.0f}s", flush=True)
    except Exception as e:
        print(cid, "err", str(e)[:100], flush=True)
