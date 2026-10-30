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
("嫦娥","SSR","人物","Chang'e the moon goddess depicted as a modern stunning beautiful East Asian woman, contemporary idol-like glamorous face with large bright eyes, delicate nose, soft lips and flawless smooth skin, fashionable elegant makeup, long glossy dark hair partly flowing in the wind with a few jade hairpins, a gentle alluring smile, wearing a flowing modern-styled fantasy gown in pale blue and silver with sheer floating sleeves and ribbons, floating gracefully upward in front of a huge full moon, a small jade rabbit beside her, osmanthus blossoms, semi-realistic portrait illustration with ink wash background, romantic and dreamy","偷服仙藥,飛升月宮,一世清冷。"),
("崑崙仙山","SSR","山水","the sacred immortal mountain Kunlun, a celestial paradise: towering jade-green peaks floating above a vast sea of luminous clouds, radiant golden-white heavenly light breaking through the clouds, multi-colored auspicious clouds and glowing mist swirling around the peaks, floating islands, cascading waterfalls falling from the sky, palaces and pavilions with curved roofs and pagodas perched on the cliffs, divine cranes and a phoenix flying in the light, a rainbow halo around the summit, pink peach blossom trees, shimmering golden sparkles, ethereal, dreamy, mystical and otherworldly atmosphere of immortals","萬山之祖,諸神所居,凡人不得見。"),
("九尾狐","SR","神獸","a graceful nine-tailed fox sitting under a blossoming tree at night, tails fanned out","千年修行,九尾既成,能迷人心魄。"),
("白澤","SR","神獸","Baize, the mythical Chinese beast from the Yellow Emperor legend: the body of a large lion-like beast with a full flowing mane, a long white beard like a wise elder, two curved horns on the head, a human-like intelligent face, additional eyes along its chest and flanks (nine eyes in total), strong clawed legs, standing on a misty mountain at Mount Dongheng, ancient and wise, majestic","通曉萬物,識盡天下妖怪之名。"),
("玄武","SR","神獸","the Black Tortoise Xuanwu, giant turtle entwined with a serpent, rising from dark water","北方守護,龜蛇合體,沉穩不可撼動。"),
("白虎","SR","神獸","a fierce white tiger leaping in a bamboo forest, bold strokes, dynamic","西方守護,殺伐之氣,百獸皆避。"),
("劍仙","SR","人物","a lone sword immortal in billowing robes standing on a mountain peak, sword in hand, wind-swept","一劍光寒,千里取人頭顱於談笑間。"),
("紅衣俠女","SR","人物","a female swordswoman in a flowing red robe mid-motion among falling plum petals","一襲紅衣,劍出無悔,江湖路遠。"),
("軒轅劍","SR","器物","the ancient legendary sword Xuanyuan standing upright, glowing faintly, with clouds and ancient bronze patterns","黃帝所佩,斬妖除魔,神器之首。"),
("蓬萊雲海","SR","山水","legendary Penglai island floating in a sea of mist, pine trees, distant pavilions, sunrise","海上仙山,雲霧深處,有人長生。"),
("飛流瀑布","SR","山水","a huge waterfall plunging from a cliff into mist, ancient pines clinging to rocks, tiny scholar watching","飛流直下三千尺,疑是銀河落九天。"),
("深山古道","SR","山水","a winding mountain path with a lone traveler and donkey, layered misty peaks","人跡罕至,唯有雲與松為伴。"),
("饕餮","R","神獸","Taotie, the ancient Chinese gluttonous monster: a gigantic head with no lower body, huge bulging round eyes, curved ram-like horns, an enormous gaping mouth full of sharp fangs, swirling spiral patterns on its face like Shang dynasty bronze ware, devouring everything around it, ominous black mist and bones, fearsome and savage","貪食之獸,吞盡一切,連自己也吞下。"),
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
("燭龍","SSR","神獸","Zhulong the torch dragon, a colossal red serpentine dragon with a human face, whose open eye brings daylight, coiling around a dark mountain, flames and cosmic mist","睜眼為晝,閉眼為夜,吹氣成冬,呼氣成夏。"),
("鯤鵬","SSR","神獸","Kunpeng, a gigantic fish transforming into a gigantic roc bird rising from the northern sea, wings covering the sky, huge waves","北冥有魚,化而為鳥,怒而飛,其翼若垂天之雲。"),
("西王母","SSR","人物","Xiwangmu the Queen Mother of the West, in elaborate immortal robes with a phoenix crown, holding a peach, sitting on clouds with cranes","崑崙之主,掌不死之藥,蟠桃三千年一熟。"),
("盤古","SSR","人物","Pangu the primordial giant splitting chaos with a great axe, egg-shaped chaos cracking, light and darkness separating, mountains forming","開天闢地,身化山川日月。"),
("瑤池仙境","SSR","山水","the Jade Pool paradise, a luminous lake surrounded by floating peaks, pavilions, peach trees and cranes, auspicious clouds","仙人宴飲之處,一滴水也有靈氣。"),
("青龍","SR","神獸","the Azure Dragon of the East, a green-tinged dragon coiling through clouds above the sea","東方守護,春之神,行雲布雨。"),
("朱雀","SR","神獸","the Vermilion Bird of the South, a crimson fire bird with long tail feathers spread wide","南方守護,夏之神,烈焰是它的羽毛。"),
("窮奇","SR","神獸","the fearsome qiongqi, a winged tiger-like beast with spiky fur and fangs, prowling in storm","生有雙翼,專吃好人,是最兇的惡獸。"),
("精衛","SR","神獸","Jingwei, a small bird with a pebble in its beak flying over stormy sea toward waves","銜西山木石,以填東海,不死不休。"),
("後羿","SR","人物","Hou Yi the divine archer drawing a huge bow aiming at suns in the sky, wind-swept robes, on a mountain peak","射落九日,救蒼生於焦土。"),
("夸父","SR","人物","Kuafu the giant chasing the sun across a vast desert horizon, staff in hand, tiny sun in the sky","與日逐走,渴死前化為桃林。"),
("鍾馗","SR","人物","Zhong Kui the demon-slayer with fierce bearded face, official hat, sword raised, ghosts fleeing around him","捉鬼天師,一身正氣,百鬼避讓。"),
("照妖鏡","SR","器物","a magical ancient demon-revealing mirror glowing faintly, reflecting a monstrous shadow, ornate frame","鏡裡的影子,比人還誠實。"),
("青銅鼎","SR","器物","an ancient bronze ding tripod cauldron with taotie patterns and rising incense smoke, mist","國之重器,問鼎者天下人共逐之。"),
("赤壁江山","SR","山水","the Red Cliff river scene, steep cliffs over a wide river, a single sailboat under a pale moon","大江東去,浪淘盡千古風流人物。"),
("夔","R","神獸","the one-legged thunder beast Kui, an ox-like creature with no horns drumming thunder, mist and rain","一足之獸,出入水必有風雨,聲如雷。"),
("狻猊","R","神獸","a suanni lion-dragon beast sitting calmly with curled mane, incense smoke from its mouth","龍之九子,喜靜好坐,常伴香爐。"),
("書生","R","人物","a young scholar with a bookcase on his back crossing a wooden bridge in light rain, carrying an umbrella","十年寒窗,只為一榜功名。"),
("繡女","R","人物","a lady embroidering on a balcony beside blooming peonies, delicate brush strokes","針線之間,繡出的是心事。"),
("武僧","R","人物","a Shaolin monk in a martial stance with a staff on a stone courtyard, motion blur","禪武合一,一棍震山河。"),
("醫者","R","人物","a village physician with a medicine box examining herbs, a stream and mountain behind","懸壺濟世,救人不問貴賤。"),
("棋士","R","人物","two elders playing go beneath a pine tree on a mountain top, tea on a stone table","一局終了,山中已千年。"),
("酒仙","R","人物","a drunken poet leaning on a rock with a wine jar, laughing, moon above","舉杯邀明月,對影成三人。"),
("詩人","R","人物","a poet in robes writing a poem on a cliff beside a waterfall, brush in hand","筆落驚風雨,詩成泣鬼神。"),
("玉璽","R","器物","an imperial jade seal with a dragon handle on a silk cushion","受命於天,既壽永昌。"),
("羅盤","R","器物","an ancient Chinese feng shui luopan compass with concentric rings on a table","指南針只指方向,不指前途。"),
("竹簡","R","器物","bamboo slips bound with string, unrolled partly, a brush and ink stone beside them","字字句句,都是先人留下的話。"),
("雪嶺","R","山水","snow-covered mountain ridge with bare pines and a tiny hut, large blank sky","千山雪壓,一點炊煙。"),
("桃花源","R","山水","a hidden valley of blooming peach trees beside a stream with a small cave entrance and thatched houses","忽逢桃花林,夾岸數百步,中無雜樹。"),
("煙雨江南","R","山水","a misty Jiangnan water town with stone bridges, willows, boats and white-walled houses in light rain","小橋流水,煙雨朦朧。"),
("白鷺","N","神獸","a white egret standing in shallow water with reeds","一行白鷺上青天。"),
("山雀","N","神獸","a small tit bird on a bamboo branch","枝頭輕巧,不問世事。"),
("小狐","N","神獸","a young fox cub sitting in tall grass looking up at the moon","還沒學會修煉,先學會好奇。"),
("野鴨","N","神獸","a pair of mandarin ducks floating on a pond among lotus","鴛鴦戲水,不羨仙。"),
("蝴蝶","N","神獸","a butterfly resting on a peony flower","莊周夢蝶,蝶夢莊周。"),
("青蛙","N","神獸","a green frog on a lotus leaf in rain","雨一下,蛙聲連成一片。"),
("燕子","N","神獸","a swallow flying beneath willow branches in spring rain","舊時王謝堂前燕,飛入尋常百姓家。"),
("松鼠","N","神獸","a squirrel on a pine branch holding a pine cone","把冬天的糧食藏好了嗎?"),
("洗衣婦","N","人物","a woman washing clothes by a stream with a wooden paddle, willows","溪邊的日子,簡單而長。"),
("轎夫","N","人物","two sedan chair bearers carrying a palanquin on a mountain path","一肩挑起別人的路。"),
("更夫","N","人物","a night watchman with a lantern and a bamboo clapper walking an empty alley","天乾物燥,小心火燭。"),
("貨郎","N","人物","a traveling peddler with a pole carrying hanging goods and a rattle drum","搖鼓一響,孩子們全跑出來。"),
("硯台","N","器物","an inkstone with ink pool and a brush","墨香來自日復一日的研磨。"),
("折扇","N","器物","a folding fan half open with a painted bamboo scene","一扇在手,風雅自來。"),
("算盤","N","器物","an abacus on a wooden counter","撥一撥,帳就清了。"),
("花瓶","N","器物","a celadon vase with a single plum branch","一枝獨秀,不需多。"),
("竹籃","N","器物","a woven bamboo basket with herbs and a sickle","進山採藥,日落而歸。"),
("蘭花","N","山水","an orchid with long curving leaves and delicate flowers, a few bold strokes","空谷幽蘭,不為無人而不香。"),
("竹石","N","山水","bamboo growing beside a gnarled rock, few strokes, lots of white","咬定青山不放鬆。"),
("秋楓","N","山水","a maple tree with falling leaves beside a stream","霜葉紅於二月花。"),
]
assert len(C) == 100, len(C)
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
