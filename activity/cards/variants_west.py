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
 113: [  # 人馬 SR
  "a Greek centaur, a single mythical creature: the bare muscular torso, head and arms of a bearded man grow directly out of the shoulders of a galloping horse body in place of the horse's neck and head, so it has a human chest and two human arms but four horse legs and a horse tail, the human arms draw a long bow, wind in the long hair, running through a misty forest, NOT a rider sitting on a horse, one continuous body",
  "a powerful centaur in full side view mid-gallop, human upper body with broad chest and a flowing beard rising from the front of a chestnut horse's body where the horse neck would be, holding a spear in one hand, four strong horse legs kicking up dust, long horse tail, ancient Greek hills with cypress trees, man and horse fused into one creature with no saddle and no rider",
  "a wise centaur standing calmly in a mountain meadow, a bearded man's torso and head emerging from a horse's body at the shoulders, holding a bow lowered in one hand, horse legs and tail, a quiver on the human back, pine trees and mist, drawn anatomically as one being, the human waist joins the horse's withers",
 ],
 136: [  # 獨眼巨人 R
  "the giant Cyclops Polyphemus, a colossal one-eyed giant with exactly ONE single large round eye in the center of his forehead and no other eyes, a flat brow above the eye, a big nose and mouth under it, huge muscular body in a rough animal skin, sitting at a mountain cave mouth holding a boulder, tiny sheep and a tiny man at his feet to show his enormous size",
  "a towering Cyclops giant with one big eye in the middle of the forehead (only one eye, the forehead has just that single eye, the face has no eyes on the sides), thick eyebrow, wild hair and beard, carrying a huge club, standing over a tiny sailing ship and tiny sailors on the shore to show how gigantic he is, rocky coast and cave",
  "a one-eyed giant Cyclops: a single enormous round eye centered on the forehead, nothing else where eyes normally are, rough stone-like skin, broad shoulders, holding up a big rock over his head, small flock of sheep and a small hut beside his knees to show his scale, mountain cave behind him",
 ],
}
for cid, ps in V.items():
    for k, p in enumerate(ps, 1):
        out = os.path.join(D, f"variants/w{cid}_{k}.jpg"); t0 = time.time()
        prompt = STYLE + COLOR["SR" if cid == 113 else "R"] + ", " + p
        for attempt in range(3):
            try:
                req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
                it = json.load(urllib.request.urlopen(req, timeout=400))["data"][0]
                raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
                Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(cid, k, f"{time.time()-t0:.0f}s", flush=True); break
            except Exception as e:
                print(cid, k, "err", str(e)[:100], flush=True); time.sleep(5)
