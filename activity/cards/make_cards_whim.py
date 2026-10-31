# 異想天開題材的水墨抽卡 50 張（編號 251～300）：python3 make_cards_whim.py [編號 ...]（不給編號就補齊缺的，依稀有度由高到低畫）
# 圖存在 img/NNN.jpg，卡牌資料在 cards_whim.json。逾時 20 分鐘、一張一張依序畫（不要同時開多個）
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
MODEL = os.environ.get("CARD_MODEL", "draw-qwen-fast")
STYLE = ("whimsical surreal dreamlike scene, impossible and playful imagination, painted in East Asian ink wash (sumi-e) technique on aged paper, expressive black ink brushwork with soft gray washes, "
         "vertical portrait composition, lots of negative space, subtle paper grain, one small red seal stamp, no text, no letters, no border, ")
COLOR = {"N": "monochrome ink only", "R": "ink with faint pale teal wash", "SR": "ink with touches of vermilion red wash", "SSR": "ink with brilliant gold leaf and vermilion accents, dramatic, majestic, highly detailed"}
# (名稱, 稀有度, 類別, 英文畫面, 簡介)
W = [
# ---- SSR 5
("酣睡山","SSR","風景","a mountain that is actually a gigantic sleeping giant lying on his back, his belly covered with villages and forests, snoring clouds rising from his nose, tiny birds nesting in his beard","整座山其實是個睡著的巨人,打呼就是山風。"),
("天上海","SSR","風景","an entire ocean hanging upside down in the sky above a desert, fish and whales swimming overhead, ships sailing on the underside, rain of water drops falling onto sand dunes","海掛在天上,沙漠抬頭就能看魚。"),
("吞雲象","SSR","幻獸","a colossal elephant inhaling clouds with its trunk and breathing out rain, small gardens and a tiny pagoda growing on its back, mist all around","把雲吸進去,再用鼻子下成雨。"),
("夢境館長","SSR","人物","a tall elegant lady curator whose enormous hair is a bookshelf of glowing jars each holding a tiny dream, birds and moths flying among them, long robe trailing into a starry floor","她的頭髮是書架,每個罐子裡都住著一個夢。"),
("萬門之鑰","SSR","器物","a key as tall as a tower standing in a desert, each tooth of the key is a different tiny door leading to a different world, clouds and stairs around it","每一個齒,都開得了一個不同的世界。"),
# ---- SR 10
("茶壺龍","SR","幻獸","a small dragon living inside a big teapot, its head sticking out of the spout breathing steam that forms clouds, teacups scattered around","在壺裡睡覺,一發脾氣就冒煙。"),
("階梯蛇","SR","幻獸","a huge snake whose coiled body forms a spiral staircase climbing into the clouds, tiny people climbing its scales","一圈一圈盤上去,爬到頂就是天。"),
("雨傘章魚","SR","幻獸","an octopus whose eight tentacles each hold an open umbrella, walking down a rainy cobbled street at night","下雨天,牠每一隻手都有傘。"),
("偷月賊","SR","人物","a thief in a striped shirt climbing a tall ladder to steal the moon, putting it in a sack, the night sky dark and surprised below him","梯子再長一點點,月亮就是他的了。"),
("影子裁縫","SR","人物","a tailor sewing a person's long shadow with a huge needle and thread on a rooftop at dusk, scissors and shadow cloth hanging on a line","幫人把走丟的影子縫回腳下。"),
("釣星客","SR","人物","an old fisherman sitting on a tall rooftop fishing for stars with a very long rod and a lantern, a basket full of tiny glowing stars","夜夜垂釣,魚簍裡裝的都是星星。"),
("口袋海","SR","器物","a coat pocket opened to reveal a tiny ocean inside with waves, a small ship and a whale, a hand holding the pocket, spray in the air","隨身帶著一片海,想家時拿出來看。"),
("心願羅盤","SR","器物","a brass compass whose needle points not north but to a glowing heart-shaped light, held in a hand over a misty valley","指的不是北方,是你最想去的地方。"),
("長腿茶館","SR","風景","a wooden teahouse standing on four enormous long stilt-like chicken legs striding across a misty plain, lanterns swinging, steam from its chimney","茶館自己會走,客人跟著它到處喝茶。"),
("雲端郵局","SR","風景","a post office on top of a cloud with fleets of paper airplanes and balloons delivering letters, a ladder down to the earth","信是用紙飛機和氣球送的。"),
# ---- R 15
("泡泡鯊","R","幻獸","a shark swimming inside a huge soap bubble floating in the sky above rooftops, rainbow sheen on the bubble","困在泡泡裡,卻一點也不著急。"),
("掃星馬","R","幻獸","a horse whose long tail is a broom, sweeping fallen stars into a pile at the foot of a hill at dawn","每天早上,把掉下來的星星掃成一堆。"),
("郵筒犬","R","幻獸","a dog shaped like a red mailbox with a slot mouth and a flag tail, letters flying out as it bounds along a road","張開嘴,信就一封封掉出來。"),
("樹屋龜","R","幻獸","a giant tortoise with a whole treehouse village on its shell, rope bridges and lanterns, walking slowly through a swamp","背上的村子,是牠走了一千年的路。"),
("傘菇蝸牛","R","幻獸","a snail carrying a giant mushroom as its shell house with a tiny door and chimney, crossing a mossy log in rain","背著蘑菇屋出門,下雨最舒服。"),
("氣球郵差","R","人物","a postman carried through the sky by a bunch of balloons delivering letters to rooftop mailboxes, a bag over his shoulder","風往哪吹,信就往哪送。"),
("鬍子園丁","R","人物","an old gardener whose long beard grows flowers and vines, watering them with a small can in a quiet garden","他的鬍子比花圃開得還好。"),
("迷宮設計師","R","人物","a labyrinth designer lost inside his own enormous hedge maze, holding a rolled blueprint upside down, a bird above laughing","設計得太好,連自己也出不來。"),
("雲端理髮師","R","人物","a barber standing on a ladder trimming a fluffy cloud with scissors and comb, cloud hair falling like snow below","幫天上的雲修剪,掉下來的是雪。"),
("飛行靴","R","器物","a pair of leather boots with small feathered wings flying by themselves above rooftops, laces trailing","穿的人還沒決定去哪,靴子已經飛走了。"),
("季節抽屜","R","器物","an old wooden dresser whose four open drawers each show a different season landscape, spring blossoms, summer sea, autumn leaves, winter snow","拉開一格,就是一整個季節。"),
("長頸水壺","R","器物","a kettle with a giraffe-long neck and spout reaching up to pour tea into a cup on a high shelf, steam curling","為了倒茶,把脖子伸得老長。"),
("蒲公英森林","R","風景","a forest of giant dandelions as tall as trees, their seeds carrying tiny houses floating away in the wind, a small path below","一陣風吹過,整片森林就搬家了。"),
("巨人棋盤","R","風景","a valley laid out like a giant chessboard with tiny houses and towers as pieces, a huge hand hovering overhead","每個村子,都是棋盤上一顆棋子。"),
("昇雨村","R","風景","a village where rain falls upward from the ground into the sky, villagers holding umbrellas upside down, puddles rising","這裡的雨,從地上往天上下。"),
# ---- N 20
("彈簧兔","N","幻獸","a rabbit with a coil spring for legs bouncing high above grass","一蹬就是三尺高。"),
("鬍子鳥","N","幻獸","a small bird with a huge curly mustache perched on a branch looking serious","一副很有學問的樣子。"),
("影子貓","N","幻獸","a cat sitting by itself while its shadow walks away in a different direction along a wall","影子,有時候自己出去逛逛。"),
("琴弦蟲","N","幻獸","a caterpillar shaped like a violin crawling on a leaf, strings vibrating softly","爬過的地方,會留下淡淡的音。"),
("氣球魚","N","幻獸","a fish shaped like a round balloon floating through the air with a tiny string trailing","吸飽了氣,就浮到天上。"),
("打盹魔法師","N","人物","a sleepy wizard in a long hat dozing on a rock while sparks from his staff make tiny flowers around him","睡夢中施的魔法最有趣。"),
("蝸牛郵差","N","人物","a postman riding a giant snail with a mailbag on its shell on a country road","慢慢送,但一定送到。"),
("浴缸船長","N","人物","a tiny captain in a hat sailing a bathtub across a pond with a toy flag and a duck crew","在池塘上航行,勇敢得不得了。"),
("泡泡畫家","N","人物","a painter blowing colorful bubbles that become paintings floating in the air, an easel on a hill","畫是吹出來的,一戳就破。"),
("墨水瓶屋","N","器物","a small house built inside a giant ink bottle with a tiny door and window, a quill sticking out like a chimney","住在瓶子裡,連夢都是黑色的。"),
("鉛筆階梯","N","器物","a giant pencil leaning on a wall with steps carved into it, a tiny person climbing up","一階一階,往紙的邊緣爬。"),
("鑰匙孔窗","N","器物","a large keyhole in a wall showing a bright garden on the other side, a small door ajar","從鑰匙孔看出去,是另一個世界。"),
("哭泣蠟燭","N","器物","a candle shedding long wax tears that become tiny puddles of flowers on a table","越亮,就越會哭。"),
("浮空茶杯","N","器物","a teacup floating in the air with steam curling and a tiny saucer orbiting like a moon","喝茶的人,還沒到。"),
("紐扣太陽","N","器物","a giant button hanging in the sky like the sun with thread holes, stitched on a pale cloth sky","天空是塊布,太陽是顆鈕扣。"),
("傾斜村","N","風景","a village built on an extremely steep tilted hillside, houses leaning at angles with laundry lines hanging sideways","一半的屋子,都在斜著睡覺。"),
("雲上稻田","N","風景","terraced rice paddies floating on clouds with a tiny farmer and a water buffalo","雲收割了,就是白色的稻。"),
("窗外海","N","風景","a single wall standing in a desert with a window in it showing a calm ocean on the other side","走過這面牆,就是海。"),
("螺旋塔","N","風景","a tall tower twisting like a corkscrew into the sky with tiny windows and a flag at the top","轉著圈長出來的塔。"),
("彩虹滑梯","N","風景","a rainbow serving as a giant slide down from a cloud to a pond with a tiny child sliding down","滑下去,就到了水邊。"),
]
assert len(W) == 50, len(W)
assert [sum(1 for c in W if c[1] == r) for r in ("SSR", "SR", "R", "N")] == [5, 10, 15, 20]
data = [{"id": 251 + i, "name": n, "rarity": r, "type": t, "prompt": p, "desc": d, "set": "whim"} for i, (n, r, t, p, d) in enumerate(W)]
json.dump(data, open(os.path.join(D, "cards_whim.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
if os.environ.get("ONLY_JSON"): sys.exit(0)
order = {"SSR": 0, "SR": 1, "R": 2, "N": 3}
want = [int(x) for x in sys.argv[1:]] or [c["id"] for c in sorted(data, key=lambda c: (order[c["rarity"]], c["id"])) if not os.path.exists(os.path.join(D, f"img/{c['id']}.jpg"))]
for cid in want:
    c = data[cid - 251]; out = os.path.join(D, f"img/{cid}.jpg"); t0 = time.time()
    prompt = STYLE + COLOR[c["rarity"]] + ", " + c["prompt"]
    try:
        req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        it = json.load(urllib.request.urlopen(req, timeout=1200))["data"][0]
        raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
        Image.open(io.BytesIO(raw)).convert("RGB").resize((512, 768), Image.LANCZOS).save(out, quality=86)
        print(cid, c["name"], f"{time.time()-t0:.0f}s", flush=True)
    except Exception as e:
        print(cid, c["name"], "err", str(e)[:100], flush=True)
