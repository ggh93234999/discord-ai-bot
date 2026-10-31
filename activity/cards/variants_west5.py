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
 (136, "the giant Cyclops Polyphemus, a colossal one-eyed giant with exactly ONE single large round eye in the center of his forehead and no other eyes, a flat brow above the eye, a big nose and mouth under it, huge muscular body in a rough animal skin, sitting at a mountain cave mouth holding a boulder, tiny sheep and a tiny man at his feet to show his enormous size"),
 (157, "a Norwegian fjord: steep U-shaped glacier-carved granite walls plunging straight into narrow deep still water, snow-capped plateau on top, a thin waterfall dropping down the cliff, dark spruce and fir trees, a small red wooden fisherman's cabin with a pointed roof on the shore, a Viking-style wooden longship with a square sail on the water, low clouds, Scandinavian scenery, no Chinese karst peaks, no pine bonsai, no Chinese junk boat"),
 (141, "a medieval English forest archer in a green hooded tunic with a leather belt and a feathered cap, tall leather boots, drawing a longbow in an oak forest, European features, Robin Hood style, no East Asian clothing"),
 (143, "a medieval European alchemist, a Caucasian man with a long beard and a pointed cap and a long robe, surrounded by glass flasks, an athanor furnace and old books in a cluttered workshop, European features, no topknot, no East Asian clothing"),
 (147, "a medieval European blacksmith, Caucasian man with short hair, leather apron over a rolled-sleeve linen shirt, hammering a glowing sword on an anvil, sparks flying, forge fire, European features, no topknot, no kimono"),
 (174, "a European shepherd in a woolen cap and a long cloak holding a shepherd's crook, with sheep and a sheepdog on a green hill with a low stone wall, European features, no conical straw hat, no East Asian clothing"),
 (176, "a European sailor with a beard and a knit cap in a striped shirt and canvas trousers pulling a rope on the deck of a tall ship, Caucasian features"),
 (179, "a European farm woman in a white linen bonnet, long dress and apron carrying a basket of wheat in a wheat field, Caucasian features, no straw hat, no East Asian clothing"),
 (181, "a European miller in a flat cap, linen shirt and apron dusted with flour carrying a flour sack in front of a Dutch windmill, Caucasian features, no East Asian clothing"),
 (182, "an old European scholar with a long white beard, round spectacles, a fur-trimmed robe and a velvet cap, reading a huge book by candlelight in a study, Caucasian features, no topknot, no East Asian robe"),
]
for cid, p in J:
    out = os.path.join(D, f"variants/r{cid}.jpg"); t0 = time.time()
    if os.path.exists(out): continue
    try:
        req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": "draw-qwen-fast", "prompt": STYLE + p, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        it = json.load(urllib.request.urlopen(req, timeout=1200))["data"][0]
        raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
        Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(cid, f"{time.time()-t0:.0f}s", flush=True)
    except Exception as e:
        print(cid, "err", str(e)[:100], flush=True)
