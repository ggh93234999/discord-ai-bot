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
# (名稱, 稀有度, 類別, 英文畫面, 簡介)
W = [
# ---- SSR 10
("獨角獸","SSR","幻獸","a majestic white unicorn rearing in a misty enchanted forest, long spiral horn glowing, flowing mane","純潔之獸,獨角能淨化一切毒與污穢。"),
("不死鳥","SSR","幻獸","a phoenix rising from flames with wide spread wings and long trailing tail feathers","燃盡自己,再從灰燼中重生。"),
("巨龍","SSR","幻獸","a colossal Western dragon with bat wings coiled on a mountain of treasure, breathing fire, castle ruins below","盤踞寶山的火龍,勇者與貪婪者的終點。"),
("克拉肯","SSR","幻獸","the giant kraken sea monster dragging a sailing ship down with huge tentacles in a stormy sea","深海巨怪,觸手一揮,船隻沉沒。"),
("亞瑟王","SSR","人物","King Arthur raising the sword Excalibur in a misty lake, the Lady of the Lake's hand beneath the water","拔出石中劍的王,圓桌騎士之首。"),
("雅典娜","SSR","人物","the goddess Athena in helmet and robe holding a spear and shield with an owl on her shoulder, Greek temple behind","智慧與戰爭女神,守護城邦與英雄。"),
("奧丁","SSR","人物","Odin the one-eyed Norse god with long beard, wide hat and spear Gungnir, two ravens on his shoulders, storm clouds","眾神之父,以一隻眼換取智慧。"),
("聖杯","SSR","器物","the Holy Grail chalice radiating light on an altar among ancient stone arches","傳說中的聖杯,尋得者得永生。"),
("亞特蘭提斯","SSR","風景","the sunken city of Atlantis with columns and domes glowing under deep ocean waves, fish swimming through ruins","沉入海底的古老文明,只留下傳說。"),
("奧林帕斯山","SSR","風景","Mount Olympus peak above the clouds with a grand Greek temple of the gods, golden light","眾神居住的山巔,雲端之上。"),
# ---- SR 20
("獅鷲","SR","幻獸","a griffin with eagle head and wings and a lion body perched on a cliff","鷹首獅身,守護寶藏與王權。"),
("九頭蛇","SR","幻獸","the nine-headed Hydra rising from a swamp, heads hissing","砍掉一個頭,又長出兩個。"),
("人馬","SR","幻獸","a centaur archer with a bow galloping through a forest","半人半馬的智者與戰士。"),
("美人魚","SR","幻獸","a mermaid sitting on a sea rock combing her hair in moonlight, waves","歌聲迷人,引航海者入海。"),
("狼人","SR","幻獸","a werewolf howling at a full moon on a hilltop, torn clothes","月圓之夜,野獸甦醒。"),
("斯芬克斯","SR","幻獸","the Sphinx with a woman's face and lion body lying before pyramids at dusk","以謎語為關,答錯者死。"),
("女巫","SR","人物","a witch in a pointed hat stirring a cauldron with a black cat, swirling smoke","深夜熬藥的魔法使者。"),
("騎士","SR","人物","a knight in full plate armor holding a sword and kite shield, standing in a field with a banner","誓言與榮譽,披甲而行。"),
("維京戰士","SR","人物","a Viking warrior with a horned-free helmet, round shield and axe on a longship prow, stormy fjord","駕長船出海的北方戰士。"),
("吸血鬼","SR","人物","a pale vampire count in a long cloak standing before a gothic castle under a full moon, bats","永生者,畏懼日光與銀。"),
("梅林","SR","人物","the wizard Merlin with a long beard and staff conjuring a magic spark in a stone tower","王的導師,通曉預言與魔法。"),
("美杜莎","SR","人物","Medusa with hair of snakes and a stern gaze, stone statues around her","一眼石化,英雄需以盾鏡擊敗。"),
("海盜船長","SR","人物","a pirate captain with a tricorn hat, cutlass and parrot on the deck of a ship in the wind","七海之上,無人能管的船長。"),
("雷神之錘","SR","器物","the hammer Mjolnir glowing with lightning on a rock, storm clouds","只有配得上的人,才舉得起來。"),
("潘朵拉的盒子","SR","器物","Pandora's box slightly open with dark smoke escaping and a tiny glowing light inside","打開之後,災厄散落人間,只剩希望。"),
("特洛伊木馬","SR","器物","the giant wooden Trojan horse before the walls of Troy at dusk","一份禮物,攻破堅城。"),
("水晶球","SR","器物","a fortune-teller's crystal ball on a table with a candle and tarot cards","看見的,也許是未來。"),
("古堡","SR","風景","a gothic castle with towers on a cliff in swirling mist and crows","霧中孤堡,藏著幾百年的故事。"),
("巨石陣","SR","風景","Stonehenge standing stones on a grassy plain at sunrise","人類最早的星象之謎。"),
("哥德大教堂","SR","風景","a towering gothic cathedral with flying buttresses and spires rising into clouds","向天空伸展的石頭祈禱。"),
# ---- R 29
("牛頭怪","R","幻獸","a Minotaur with a bull head and muscular body in a stone labyrinth","迷宮深處的怪物。"),
("地精","R","幻獸","a mischievous goblin with pointy ears crouching with a coin bag","貪財又愛惡作劇的小東西。"),
("巨魔","R","幻獸","a huge troll with a club under a stone bridge in a forest","橋下收過路費的巨人。"),
("精靈","R","幻獸","a graceful elf with a long bow and pointed ears standing in an ancient forest","長壽的林中種族,箭術無雙。"),
("幽靈","R","幻獸","a ghost in a tattered white sheet floating in a ruined hall with a candle","徘徊在舊宅裡的未了心願。"),
("獨眼巨人","R","幻獸","a Cyclops with a single eye holding a boulder at a cave mouth","只有一隻眼睛,卻很難騙。"),
("天馬","R","幻獸","Pegasus the winged white horse flying over clouds","由海神之子化成,載英雄上天。"),
("石像鬼","R","幻獸","a stone gargoyle perched on a cathedral rooftop with wings folded, rain","夜裡守著教堂,白天化為石頭。"),
("巨狼","R","幻獸","a giant gray wolf with glowing eyes in a snowy pine forest","北歐傳說裡吞日的狼。"),
("吟遊詩人","R","人物","a bard with a lute singing under a tree in a village square","四處流浪,歌裡藏著各地故事。"),
("弓箭手","R","人物","a forest archer in a hood drawing a longbow in the woods","百步穿楊的森林俠客。"),
("修士","R","人物","a monk in a hooded robe copying a manuscript with a quill by candlelight in a scriptorium","抄寫與祈禱,守著知識。"),
("鍊金術士","R","人物","an alchemist with flasks and a furnace in a cluttered workshop","想把鉛變成金,也想找長生。"),
("火槍手","R","人物","a musketeer with a feathered hat and rapier saluting in a street","一人為眾,眾人為一。"),
("皇后","R","人物","a queen in a long gown with a crown standing in a grand hall with tall windows","統治的人,也有孤獨。"),
("小丑","R","人物","a court jester with a bell cap and mask juggling in a hall","唯一敢對國王說實話的人。"),
("鐵匠","R","人物","a blacksmith hammering a glowing sword on an anvil, sparks flying","打造武器與命運。"),
("魔法書","R","器物","an ancient thick spellbook open on a table with glowing runes and a candle","寫滿禁忌咒語的厚書。"),
("魔杖","R","器物","a wizard's wand with sparkling light trails on a dark table","小小一根木枝,能做大事。"),
("騎士盾牌","R","器物","a battered kite shield with a lion crest leaning against a stone wall","每道刮痕都是一場戰役。"),
("羽毛筆","R","器物","a quill pen in an inkwell next to a parchment scroll and a candle","筆尖落處,歷史成文。"),
("沙漏","R","器物","an hourglass with falling sand on a wooden table, dim light","時間從不等人。"),
("騎士頭盔","R","器物","a knight's helm with a plume on a stone ledge, mist behind","空蕩的頭盔,守著誓言。"),
("燈塔","R","風景","a lighthouse on a rocky coast in a storm with a beam of light cutting through rain","為迷航的船指路。"),
("風車","R","風景","an old windmill on a grassy hill under big clouds","風來了,日子就轉起來。"),
("橡樹森林","R","風景","an ancient oak forest with twisted trunks and mist and a faint path","傳說裡精靈與女巫的家。"),
("峽灣","R","風景","a Nordic fjord with steep cliffs, still water and a tiny boat","冰河切出來的深藍水道。"),
("羅馬競技場","R","風景","the Roman Colosseum ruins at sunset with crows","曾經萬人歡呼,如今只剩風聲。"),
("石橋小鎮","R","風景","a medieval stone bridge over a river with a small half-timbered town in mist","河上有橋,橋邊有炊煙。"),
# ---- N 41
("渡鴉","N","幻獸","a raven perched on a bare branch","烏黑的使者,傳遞凶兆與消息。"),
("貓頭鷹","N","幻獸","an owl on a branch at night with a full moon","智慧的象徵,夜裡看得最清。"),
("黑貓","N","幻獸","a black cat sitting on a fence with a crescent moon","女巫的夥伴。"),
("紅狐","N","幻獸","a red fox trotting through snow","狡猾又機靈。"),
("雄鹿","N","幻獸","a stag with large antlers standing in a misty forest","森林的王。"),
("天鵝","N","幻獸","a white swan gliding on a calm lake with reeds","優雅,也傳說會在臨終時歌唱。"),
("白馬","N","幻獸","a white horse standing in a meadow under a big sky","騎士最忠誠的夥伴。"),
("棕熊","N","幻獸","a brown bear standing by a river catching a fish","森林裡的大力士。"),
("野豬","N","幻獸","a wild boar in an autumn forest","兇猛的森林獵物。"),
("蝙蝠","N","幻獸","a bat hanging upside down from a branch at dusk","夜裡的飛行者。"),
("毒蛇","N","幻獸","a coiled snake on a stone","一口咬下,不留餘地。"),
("獵鷹","N","幻獸","a falcon perched on a gloved hand","貴族打獵的夥伴。"),
("刺蝟","N","幻獸","a hedgehog in autumn leaves","一身刺,心卻軟。"),
("兔子","N","幻獸","a rabbit sitting in tall grass","跳進洞裡,就是另一個世界。"),
("牧羊人","N","人物","a shepherd with a crook and a few sheep on a hill","守著羊群看天色。"),
("麵包師","N","人物","a baker pulling bread from a wood oven in a small shop","天沒亮就開始忙。"),
("水手","N","人物","a sailor in a striped shirt pulling a rope on a ship deck","一生都在浪上。"),
("修女","N","人物","a nun in a habit walking in a cloister with a lantern","安靜的祈禱者。"),
("獵人","N","人物","a hunter with a hat and rifle and a dog in the forest","與山林為伍。"),
("農婦","N","人物","a farm woman carrying a basket of wheat in a field","一年忙到頭的收成。"),
("小提琴手","N","人物","a violinist playing in a street under a lamp","拉出一整座城市的夜。"),
("磨坊主","N","人物","a miller carrying a sack of flour near a windmill","風吹來的麵粉。"),
("老學者","N","人物","an old scholar with spectacles reading a huge book by candlelight","一輩子讀不完的書。"),
("小公主","N","人物","a young princess in a simple dress looking out a tower window","塔上的小小期待。"),
("燈夫","N","人物","a lamplighter with a pole lighting a street lamp at dusk","把夜晚一盞盞點亮。"),
("蠟燭","N","器物","a single burning candle in a brass holder","一點微光,足夠看路。"),
("古董鑰匙","N","器物","an ornate antique key on a table","開得了什麼門,誰也不知道。"),
("懷錶","N","器物","an open pocket watch on a chain","滴答的是時間,也是回憶。"),
("橡木酒桶","N","器物","a wooden wine barrel in a cellar","醞釀一年又一年。"),
("馬燈","N","器物","an old lantern with a glowing flame hanging on a hook","夜路上的一點暖光。"),
("長弓","N","器物","a longbow and a few arrows leaning on a wall","拉滿的是力氣,也是耐心。"),
("航海羅盤","N","器物","a brass compass on an old sea map","不管風往哪吹,針只指向北。"),
("地球儀","N","器物","an antique globe on a wooden stand","世界,在手裡轉了一圈。"),
("玫瑰","N","器物","a single rose with thorns lying on a table","美麗的,也是帶刺的。"),
("麥田","N","風景","a golden wheat field with wind and a lone tree","風吹過,像海浪。"),
("薰衣草田","N","風景","a lavender field with rows to the horizon","紫色的香氣一直鋪到天邊。"),
("秋日森林","N","風景","an autumn forest with falling leaves and a quiet path","落葉鋪成路。"),
("雪山小屋","N","風景","a small wooden cabin in snow-covered mountains with a chimney smoke","風雪裡的一盞燈。"),
("石拱橋","N","風景","an old stone arch bridge over a stream with moss","走過了很多人的橋。"),
("海邊懸崖","N","風景","a sea cliff with waves crashing and seagulls","浪打在崖上,從不停歇。"),
("墓園月夜","N","風景","an old cemetery with crooked crosses under a moon, mist","安靜,卻不孤單。"),
]
assert len(W) == 100, len(W)
assert sum(1 for c in W if c[1] == "SSR") == 10 and sum(1 for c in W if c[1] == "SR") == 20 and sum(1 for c in W if c[1] == "R") == 29 and sum(1 for c in W if c[1] == "N") == 41
data = [{"id": 101 + i, "name": n, "rarity": r, "type": t, "prompt": p, "desc": d, "set": "west"} for i, (n, r, t, p, d) in enumerate(W)]
json.dump(data, open(os.path.join(D, "cards_west.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
if os.environ.get("ONLY_JSON"): sys.exit(0)
order = {"SSR": 0, "SR": 1, "R": 2, "N": 3}
want = [int(x) for x in sys.argv[1:]] or [c["id"] for c in sorted(data, key=lambda c: (order[c["rarity"]], c["id"])) if not os.path.exists(os.path.join(D, f"img/{c['id']}.jpg"))]
for cid in want:
    c = data[cid - 101]; out = os.path.join(D, f"img/{cid}.jpg"); t0 = time.time()
    prompt = STYLE + COLOR[c["rarity"]] + ", " + c["prompt"]
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + "/images/generations", json.dumps({"model": MODEL, "prompt": prompt, "size": "768x1152", "n": 1}).encode(), {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
            it = json.load(urllib.request.urlopen(req, timeout=400))["data"][0]
            raw = base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
            Image.open(io.BytesIO(raw)).convert("RGB").resize((512, 768), Image.LANCZOS).save(out, quality=86)
            print(cid, c["name"], f"{time.time()-t0:.0f}s", flush=True); break
        except Exception as e:
            print(cid, c["name"], "err", str(e)[:100], flush=True); time.sleep(5)
