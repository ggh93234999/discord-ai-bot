# 西方題材的水墨抽卡 100 張（編號 101～200）：python3 make_cards_west.py [編號 ...]（不給編號就補齊缺的，依稀有度由高到低畫）
# 圖存在 img/NNN.jpg，卡牌資料在 cards_west.json
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
MODEL = os.environ.get("CARD_MODEL", "draw-qwen-fast")
STYLE = ("East Asian ink wash painting (sumi-e) technique on aged paper applied to a Western European subject, expressive black ink brushwork with soft gray washes, "
         "vertical portrait composition, lots of negative space, subtle paper grain, one small red seal stamp, no text, no letters, no border, ")
COLOR = {"N": "monochrome ink only", "R": "ink with faint pale blue-gray wash", "SR": "ink with touches of crimson red wash", "SSR": "ink with brilliant gold leaf and crimson accents, dramatic, majestic, highly detailed"}

V = {
 107: ["Odin the one-eyed Norse god with a long gray beard and a wide-brimmed hat, wearing a Norse chainmail shirt, a fur-trimmed cloak and leather bracers, holding the spear Gungnir, two ravens on his shoulders, storm clouds, Viking-age Scandinavian look, European features, no lamellar armor, no East Asian armor"],
 141: ["a medieval English forest archer in a green hooded tunic with a leather belt and a feathered cap, tall leather boots, drawing a longbow in an oak forest, European features, Robin Hood style, no East Asian clothing"],
 143: ["a medieval European alchemist, a Caucasian man with a long beard and a pointed cap and a long robe, surrounded by glass flasks, an athanor furnace and old books in a cluttered workshop, European features, no topknot, no East Asian clothing"],
 147: ["a medieval European blacksmith, Caucasian man with short hair, leather apron over a rolled-sleeve linen shirt, hammering a glowing sword on an anvil, sparks flying, forge fire, European features, no topknot, no kimono"],
 174: ["a European shepherd in a woolen cap and a long cloak holding a shepherd's crook, with sheep and a sheepdog on a green hill with a low stone wall, European features, no conical straw hat, no East Asian clothing"],
 176: ["a European sailor with a beard and a knit cap in a striped shirt and canvas trousers pulling a rope on the deck of a tall ship, Caucasian features"],
 179: ["a European farm woman in a white linen bonnet, long dress and apron carrying a basket of wheat in a wheat field, Caucasian features, no straw hat, no East Asian clothing"],
 181: ["a European miller in a flat cap, linen shirt and apron dusted with flour carrying a flour sack in front of a Dutch windmill, Caucasian features, no East Asian clothing"],
 182: ["an old European scholar with a long white beard, round spectacles, a fur-trimmed robe and a velvet cap, reading a huge book by candlelight in a study, Caucasian features, no topknot, no East Asian robe"],
}
for cid, ps in V.items():
    for k, p in enumerate(ps, 1):
        out = os.path.join(D, f"variants/r{cid}.jpg"); t0 = time.time()
        prompt = STYLE + COLOR["SSR" if cid == 107 else "R"] + ", " + p
        for attempt in range(3):
            try:
                req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
                it = json.load(urllib.request.urlopen(req, timeout=400))["data"][0]
                raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
                Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(cid, k, f"{time.time()-t0:.0f}s", flush=True); break
            except Exception as e:
                print(cid, k, "err", str(e)[:100], flush=True); time.sleep(5)
