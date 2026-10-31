# 原創虛構題材的水墨抽卡 50 張（編號 201～250）：python3 make_cards_orig.py [編號 ...]（不給編號就補齊缺的，依稀有度由高到低畫）
# 圖存在 img/NNN.jpg，卡牌資料在 cards_orig.json。逾時 20 分鐘、一張一張依序畫（不要同時開多個，會互相排隊逾時）
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
env = {}
for l in open(os.path.join(D, "../../.env"), encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); env[k] = v.strip().strip('"\'')
BASE, KEY = env["LLM_BASE_URL"].rstrip("/"), env["LLM_API_KEY"]
MODEL = os.environ.get("CARD_MODEL", "draw-qwen-fast")
STYLE = ("imaginative original fantasy scene in East Asian ink wash painting (sumi-e) technique on aged paper, expressive black ink brushwork with soft gray washes, "
         "vertical portrait composition, lots of negative space, subtle paper grain, one small red seal stamp, no text, no letters, no border, ")
COLOR = {"N": "monochrome ink only", "R": "ink with faint pale teal wash", "SR": "ink with touches of vermilion red wash", "SSR": "ink with brilliant gold leaf and vermilion accents, dramatic, majestic, highly detailed"}
# (名稱, 稀有度, 類別, 英文畫面, 簡介)
W = [
# ---- SSR 5
("星鯨","SSR","幻獸","a colossal whale swimming through the night sky among stars, its body drawn with constellation lines, tiny villages with lanterns on its back, clouds as waves","馱著整片夜空漫遊的巨鯨,背上住著守星人。"),
("時間之樹","SSR","風景","a gigantic ancient tree whose leaves are round clock faces, falling leaves drifting upward, roots in a still mirror lake, tiny figure at its foot","每片葉子是一個時辰,落葉的地方時間倒流。"),
("月影女王","SSR","人物","a queen in a long gown made of the phases of the moon standing on a mirror-like lake, crown of crescent horns, her reflection a different figure","她的長裙是月相,倒影裡站著另一個她。"),
("天樞浮城","SSR","風景","a floating city of pagodas, bridges and towers on a cloud island held by great chains and sails, airships docking, waterfalls falling off the edge into mist","飄在雲上的城,以鎖鏈與風帆維繫。"),
("無名之書","SSR","器物","a huge open book on a stone altar whose pages are living ink, ink creatures and rivers climbing out of the pages into the air","書頁是活的墨,翻開哪頁,就會有東西爬出來。"),
# ---- SR 10
("霧鹿","SR","幻獸","a tall stag made of drifting mist with branching antlers that hold glowing paper lanterns, walking through a misty forest","鹿角掛著燈籠,霧起時才現身。"),
("燈籠水母","SR","幻獸","a large jellyfish floating in the air like a lantern, glowing bell and long trailing tentacles, over a dark valley with fireflies","夜裡順風漂浮,所到之處亮起微光。"),
("鐘樓鴞","SR","幻獸","an owl with clockwork brass wings and gear-filled chest perched on an old clock tower at midnight","每敲一下鐘,牠的齒輪就轉一圈。"),
("墨匠","SR","人物","a painter in a wide sleeved robe with a giant brush painting a living tiger and waves into the air from his brush strokes","筆下所畫,皆會活過來。"),
("風語者","SR","人物","a figure in a robe made of many colorful kites, hair streaming, standing on a cliff listening to the wind, birds around","聽得懂風說的每一句話。"),
("守夜機偶","SR","人物","a tall clockwork automaton with a lantern for a head holding a staff, walking through a sleeping town at night","燈籠是頭,走遍小鎮,夜夜守望。"),
("倒影鏡","SR","器物","an ornate standing mirror in a ruined hall showing a bright different world instead of the room, mist at its base","鏡裡的世界,和這裡不一樣。"),
("紙船燈","SR","器物","a paper boat holding a lit candle floating down a dark river carrying tiny wishes, lotus-like glow","載著願望,順水流向看不見的地方。"),
("倒懸瀑布","SR","風景","a waterfall flowing upward from a pool into the sky, rocks and mist, tiny bridge and pavilion beside it","水從地上流向天,反過來看世界。"),
("鯨骨橋","SR","風景","a giant whale skeleton forming a bridge across a deep canyon with small lanterns hung along the ribs and travelers crossing","巨鯨的遺骨,成了兩岸之間的橋。"),
# ---- R 15
("墨貓","R","幻獸","a cat whose body is made of flowing black ink, tail trailing ink droplets, sitting on a stack of old books","碰到的紙,都會留下爪印。"),
("銅鱗魚","R","幻獸","a koi with bronze metallic scales swimming through the air among clouds and bamboo","在雲裡游,不在水裡游。"),
("雲羊","R","幻獸","a sheep whose wool is a fluffy cloud grazing on a mountain top, a small rainbow above","下雨前,牠的毛會變灰。"),
("蘑菇精","R","幻獸","a tiny mushroom spirit with a large cap hat holding a small lantern in a mossy forest","雨後長出來,天亮就不見。"),
("燈蛾","R","幻獸","a giant moth with softly glowing patterned wings resting on a branch in a dark forest","翅膀的花紋,每晚都不一樣。"),
("提燈少女","R","人物","a young girl with a large paper lantern walking down a misty stone path in the night","她的燈,只照得到回家的路。"),
("流浪鐘表匠","R","人物","a wandering clockmaker pulling a cart full of clocks and gears along a country road, a bird on his hat","修得好各式各樣的鐘,唯獨修不好時間。"),
("星象師","R","人物","an astronomer with a brass astrolabe and long telescope on a tower top under a starry sky with constellations drawn in the clouds","每顆星的脾氣,他都記得。"),
("渡船人","R","人物","a ferryman poling a small boat with a lantern at the bow through a misty river at dusk","擺渡的不只是人,也有心事。"),
("星砂瓶","R","器物","a glass bottle filled with glowing star sand on a wooden table, tiny stars floating out of the cork","倒出來的,是一小撮夜空。"),
("發條蝴蝶","R","器物","a clockwork butterfly with brass gear wings and a winding key resting on a flower","上一次發條,能飛一整個下午。"),
("傘中雨","R","器物","an umbrella with a small rainstorm swirling inside it, droplets falling upward, held by a hand","收起來之前,記得先把雨倒掉。"),
("雲海書店","R","風景","a small bookshop with a lantern on a cliff edge above a sea of clouds, stacks of books outside, a tiny cat on the steps","要翻過雲海,才找得到的書店。"),
("螢火谷","R","風景","a deep valley filled with thousands of fireflies and a winding stream, mist and dark hills","夏夜,整座山谷會呼吸。"),
("浮島群","R","風景","a group of small floating islands with single trees and waterfalls connected by rope bridges in a pale sky","島與島之間,只靠繩橋相連。"),
# ---- N 20
("銀魚","N","幻獸","a silver fish leaping from a calm pond with ripples","一躍,便是一道光。"),
("小雲龍","N","幻獸","a tiny dragon made of cloud curling around a mountain peak","還沒長大,只會下毛毛雨。"),
("苔蘚熊","N","幻獸","a bear covered in thick green moss sleeping among ferns","睡得太久,身上長了一座森林。"),
("紙鶴","N","幻獸","a paper crane coming alive and flying over a quiet lake","折得夠用心,它就會飛。"),
("蛙燈","N","幻獸","a frog with a small glowing lamp on its head sitting on a lily pad","夜裡替迷路的螢火蟲帶路。"),
("賣夢人","N","人物","a dream seller with a tall backpack of glowing jars walking through a night street","一罐一個夢,童叟無欺。"),
("撐葉小孩","N","人物","a small child holding a huge leaf as an umbrella standing in the rain","一片葉子,就是一把傘。"),
("老茶師","N","人物","an old tea master with a long beard sitting beside a tiny stove and tea set under a pine","茶涼了,故事才開始。"),
("風箏少年","N","人物","a boy running on a hill flying a big colorful kite shaped like a fish","線的另一頭,是整片天空。"),
("風鈴","N","器物","a wind chime of small bells and glass hanging from a roof in a breeze","風來了,它才說話。"),
("空燈籠","N","器物","an empty paper lantern hanging on a bare branch at dusk","等著有人,把光放進去。"),
("舊地圖","N","器物","an old folded map with faded ink lines and a compass on a table","上面的地方,有些已經不存在了。"),
("墨錠","N","器物","an ink stick and an inkstone with a brush on a wooden table","磨一磨,世界就黑得很好看。"),
("紙風車","N","器物","a small paper pinwheel spinning in the wind in a grass field","小小的風,也能轉一個夏天。"),
("骨笛","N","器物","a bone flute lying on a mossy stone with a thin curl of mist","吹出來的,是很遠的聲音。"),
("霧中石階","N","風景","a long stone staircase climbing into thick mist with a single lantern","往上走,看不見盡頭。"),
("湖面月影","N","風景","a calm lake with the moon reflected and a tiny boat, reeds on the shore","月亮掉進了湖裡。"),
("雨巷","N","風景","a narrow rainy alley with wet cobblestones and a glowing window and an umbrella","雨落在巷子裡,有點孤單。"),
("雲間梯田","N","風景","terraced fields on a mountain slope above the clouds with a small hut","種田的人,住在雲上。"),
("孤島小舟","N","風景","a tiny island with one tree and a small boat tied at the shore on a still sea at dawn","一棵樹,一艘船,一整片海。"),
]
assert len(W) == 50, len(W)
assert [sum(1 for c in W if c[1] == r) for r in ("SSR", "SR", "R", "N")] == [5, 10, 15, 20]
data = [{"id": 201 + i, "name": n, "rarity": r, "type": t, "prompt": p, "desc": d, "set": "orig"} for i, (n, r, t, p, d) in enumerate(W)]
json.dump(data, open(os.path.join(D, "cards_orig.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
if os.environ.get("ONLY_JSON"): sys.exit(0)
order = {"SSR": 0, "SR": 1, "R": 2, "N": 3}
want = [int(x) for x in sys.argv[1:]] or [c["id"] for c in sorted(data, key=lambda c: (order[c["rarity"]], c["id"])) if not os.path.exists(os.path.join(D, f"img/{c['id']}.jpg"))]
for cid in want:
    c = data[cid - 201]; out = os.path.join(D, f"img/{cid}.jpg"); t0 = time.time()
    prompt = STYLE + COLOR[c["rarity"]] + ", " + c["prompt"]
    try:
        req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        it = json.load(urllib.request.urlopen(req, timeout=1200))["data"][0]
        raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
        Image.open(io.BytesIO(raw)).convert("RGB").resize((512, 768), Image.LANCZOS).save(out, quality=86)
        print(cid, c["name"], f"{time.time()-t0:.0f}s", flush=True)
    except Exception as e:
        print(cid, c["name"], "err", str(e)[:100], flush=True)
