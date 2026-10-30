# 產生水墨抽卡的 50 張卡圖：python3 make_cards.py [編號 ...]（不給編號就補齊缺的）。圖存在 img/NN.jpg，卡牌資料在 cards.json
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
MODEL = os.environ.get("CARD_MODEL", "draw-qwen-fast")
STYLE = ("traditional Chinese ink wash painting, sumi-e on aged xuan rice paper, expressive black ink brushwork with soft gray washes, "
         "vertical portrait composition, lots of negative space, subtle paper grain, one small red seal stamp, no text, no letters, no border, ")
COLOR = {"N": "monochrome ink only", "R": "ink with faint pale teal wash", "SR": "ink with touches of vermilion red wash", "SSR": "ink with brilliant gold leaf and vermilion accents, dramatic, majestic, highly detailed"}
# (名稱, 稀有度, 類別, 英文畫面, 簡介)
C = [
("應龍","SSR","神獸","a winged Chinese dragon Yinglong soaring through storm clouds, lightning and rain, powerful coiling body","上古翼龍,能蓄水興雨,曾助黃帝戰蚩尤。"),
("鳳凰","SSR","神獸","a magnificent phoenix with long flowing tail feathers rising from flames and mist","百鳥之王,浴火而生,所過之處萬物回春。"),
("麒麟","SSR","神獸","a majestic qilin with scaled body and flowing mane standing on clouds beneath the moon","仁獸現世,天下太平。"),
("嫦娥","SSR","人物","Chang'e the moon goddess in flowing robes floating up toward a huge full moon, osmanthus branch","偷服仙藥,飛升月宮,一世清冷。"),
("崑崙仙山","SSR","山水","towering sacred Kunlun mountain peaks piercing sea of clouds, waterfalls, tiny pavilion on a cliff","萬山之祖,諸神所居,凡人不得見。"),
("九尾狐","SR","神獸","a graceful nine-tailed fox sitting under a blossoming tree at night, tails fanned out","千年修行,九尾既成,能迷人心魄。"),
("白澤","SR","神獸","the wise beast Baize, a lion-like creature with horns and extra eyes along its body, standing calmly","通曉萬物,識盡天下妖怪之名。"),
("玄武","SR","神獸","the Black Tortoise Xuanwu, giant turtle entwined with a serpent, rising from dark water","北方守護,龜蛇合體,沉穩不可撼動。"),
("白虎","SR","神獸","a fierce white tiger leaping in a bamboo forest, bold strokes, dynamic","西方守護,殺伐之氣,百獸皆避。"),
("劍仙","SR","人物","a lone sword immortal in billowing robes standing on a mountain peak, sword in hand, wind-swept","一劍光寒,千里取人頭顱於談笑間。"),
("紅衣俠女","SR","人物","a female swordswoman in a flowing red robe mid-motion among falling plum petals","一襲紅衣,劍出無悔,江湖路遠。"),
("軒轅劍","SR","器物","the ancient legendary sword Xuanyuan standing upright, glowing faintly, with clouds and ancient bronze patterns","黃帝所佩,斬妖除魔,神器之首。"),
("蓬萊雲海","SR","山水","legendary Penglai island floating in a sea of mist, pine trees, distant pavilions, sunrise","海上仙山,雲霧深處,有人長生。"),
("飛流瀑布","SR","山水","a huge waterfall plunging from a cliff into mist, ancient pines clinging to rocks, tiny scholar watching","飛流直下三千尺,疑是銀河落九天。"),
("深山古道","SR","山水","a winding mountain path with a lone traveler and donkey, layered misty peaks","人跡罕至,唯有雲與松為伴。"),
("饕餮","R","神獸","the fearsome taotie beast with big eyes, horns and gaping mouth, bronze-vessel pattern style","貪食之獸,吞盡一切,連自己也吞下。"),
("貔貅","R","神獸","a pixiu winged lion beast sitting with coins at its feet","吞金納財,只進不出。"),
("畢方","R","神獸","the one-legged crane-like fire bird Bifang with a beak, trailing small flames","一足之鳥,所到之處必有火災。"),
("青鸞","R","神獸","a graceful blue-green luan bird singing on a pine branch","鳳凰之屬,鳴聲清越,傳遞仙訊。"),
("刀客","R","人物","a rugged wandering blade master with broad saber, straw hat, standing in snow","一刀在手,萬里獨行。"),
("琴師","R","人物","a scholar playing a guqin zither under a pine tree beside a stream","高山流水,知音難覓。"),
("道士","R","人物","a Taoist priest with a whisk and gourd walking among mountain mist","煉丹問道,不問人間事。"),
("僧人","R","人物","a monk in robes with a walking staff crossing a stone bridge in rain","一缽一杖,行遍山川。"),
("漁翁","R","人物","an old fisherman in a straw cloak and hat fishing from a small boat on a still river","孤舟蓑笠翁,獨釣寒江雪。"),
("古琴","R","器物","an ancient guqin zither lying on a stone table with incense smoke curling","七弦清響,可通天地。"),
("銅鏡","R","器物","an ancient bronze mirror with ornate back, reflecting a faint moon","鏡中照見的,不只是容顏。"),
("竹林","R","山水","a tall dense bamboo forest in mist with a tiny pavilion","竹影搖風,清氣滿林。"),
("寒江獨釣","R","山水","a tiny boat alone on a vast empty river, snow-covered banks, huge white space","千山鳥飛絕,萬徑人蹤滅。"),
("古寺晨鐘","R","山水","a mountain temple with pagoda in morning mist and a hanging bronze bell","一聲鐘響,山中日月長。"),
("仙鶴","N","神獸","a red-crowned crane standing on one leg beside pine and rock","長壽之鳥,姿態悠然。"),
("錦鯉","N","神獸","two koi fish swirling in ink water with lotus leaf","魚躍龍門的第一步。"),
("白鹿","N","神獸","a white deer standing in a misty forest clearing","仙山靈獸,遇之者吉。"),
("玄貓","N","神獸","a black cat curled on a roof tile under the moon","夜裡的眼睛,什麼都看見了。"),
("寒鴉","N","神獸","a crow perched on a bare winter branch","枯藤老樹昏鴉。"),
("蟾蜍","N","神獸","a three-legged toad sitting on a coin beside a lotus leaf","月中蟾蜍,吐錢招財。"),
("書童","N","人物","a young scholar's boy servant carrying a stack of books and a lantern","跟著先生走遍天涯。"),
("樵夫","N","人物","a woodcutter carrying bundled firewood on a mountain trail","砍柴聽松,日子也夠了。"),
("牧童","N","人物","a young boy riding a water buffalo while playing a flute","牧童遙指杏花村。"),
("採蓮女","N","人物","a girl in a small boat gathering lotus in a pond","荷花深處,有人唱歌。"),
("說書人","N","人物","a storyteller at a teahouse table with a folding fan and gavel block","一塊驚堂木,說盡天下事。"),
("油紙傘","N","器物","an oil-paper umbrella leaning on a wall in the rain","雨巷深處,等一個人。"),
("毛筆","N","器物","a calligraphy brush resting on an ink stone with a drop of ink","一筆一畫,皆是功夫。"),
("酒葫蘆","N","器物","a wine gourd with a cord and a cup","一壺濁酒,盡歡而已。"),
("燈籠","N","器物","a paper lantern hanging from a bamboo pole in the night","夜路長,有光就不怕。"),
("竹笛","N","器物","a bamboo flute resting on a rock with a falling leaf","一曲短笛,山谷回聲。"),
("茶壺","N","器物","a small clay teapot with steam rising, a cup beside it","一壺清茶,半日浮生。"),
("梅花","N","山水","a plum blossom branch bending over snow, bold ink trunk","凌寒獨自開。"),
("荷塘","N","山水","a pond with lotus leaves and flowers in ink and wash","出淤泥而不染。"),
("紙鳶","N","器物","a paper kite in the shape of a swallow flying in a breezy sky above willows","春風一起,線在誰手。"),
("遠山松雲","N","山水","distant layered mountains with a lone pine in the foreground and drifting cloud","遠山如黛,松下聽雲。"),
]
assert len(C) == 50, len(C)
data = [{"id": i + 1, "name": n, "rarity": r, "type": t, "desc": d, "prompt": p} for i, (n, r, t, p, d) in enumerate(C)]
json.dump(data, open(os.path.join(D, "cards.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
want = [int(x) for x in sys.argv[1:]] or [c["id"] for c in data if not os.path.exists(os.path.join(D, f"img/{c['id']:02d}.jpg"))]
for cid in want:
    c = data[cid - 1]; out = os.path.join(D, f"img/{cid:02d}.jpg"); t0 = time.time()
    prompt = STYLE + COLOR[c["rarity"]] + ", " + c["prompt"]
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
            j = json.load(urllib.request.urlopen(req, timeout=400)); it = j["data"][0]
            raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
            Image.open(io.BytesIO(raw)).convert("RGB").save(out, quality=88); print(cid, c["name"], f"{time.time()-t0:.0f}s", flush=True); break
        except Exception as e:
            print(cid, "err", attempt, str(e)[:120], flush=True); time.sleep(5)
