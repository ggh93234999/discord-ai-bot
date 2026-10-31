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
 140: [
  "a medieval European bard (minstrel) wearing a feathered cap, a laced doublet tunic with slashed sleeves, hose and leather boots and a short cloak, playing a European lute and singing in a village square with half-timbered houses, clearly Western medieval clothing, no kimono, no hanfu, no Asian robe",
  "a wandering Renaissance troubadour in a feathered beret, puff-sleeved shirt, vest, tights and pointed boots, strumming a round-backed lute under an old oak tree beside a stone well, medieval European village behind, strictly European costume",
 ],
}
for cid, ps in V.items():
    for k, p in enumerate(ps, 1):
        out = os.path.join(D, f"variants/w{cid}_{k}.jpg"); t0 = time.time()
        prompt = STYLE + COLOR["R"] + ", " + p
        for attempt in range(3):
            try:
                req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
                it = json.load(urllib.request.urlopen(req, timeout=400))["data"][0]
                raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
                Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(cid, k, f"{time.time()-t0:.0f}s", flush=True); break
            except Exception as e:
                print(cid, k, "err", str(e)[:100], flush=True); time.sleep(5)
