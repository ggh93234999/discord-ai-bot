#!/usr/bin/env python3
"""從 Liquipedia 的世界賽頁面整理每隊的賽區與賽區種子，寫到 activity/public/teams/seeds.json（OddsPapi 隊名 → {region, seed, note}）。
只打 1 次 API（遵守他們的規則：帶 User-Agent）。用法：python3 scripts/fetch_lol_seeds.py [頁面名，預設 World Championship/2026]
"""
import gzip, json, os, re, sys, urllib.parse, urllib.request

UA = "discord-activity-logo-fetch/1.0 (personal hobby bot)"
PAGE = sys.argv[1] if len(sys.argv) > 1 else "World Championship/2026"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "teams", "seeds.json")
# Liquipedia 隊名 → OddsPapi 隊名（不一樣的才需要寫）
NAMES = {"Gen.G Esports": "Gen.g Esports", "Top Esports": "TOP Esports", "LYON": "Lyon Gaming", "Movistar KOI": "Movistar Koi",
         "Secret Whales": "Team Secret Whales", "CTBC Flying Oyster": "Ctbc Flying Oyster", "LOS": "Los", "Anyone's Legend": "Anyones Legend"}

u = "https://liquipedia.net/leagueoflegends/api.php?" + urllib.parse.urlencode(
    {"action": "query", "titles": PAGE, "prop": "revisions", "rvprop": "content", "rvslots": "main", "format": "json"})
d = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "gzip"}), timeout=40).read()
try: d = gzip.decompress(d)
except Exception: pass
txt = list(json.loads(d)["query"]["pages"].values())[0]["revisions"][0]["slots"]["main"]["*"]
seg = txt[txt.index("==Participating Teams=="):]
info = {}
for part in re.split(r"\{\{Opponent\|", seg)[1:]:
    name = re.match(r"([^\n|]+)", part).group(1).strip()
    q = re.search(r"\|qualification=\{\{Qualification\|([^}]*)\}\}", part)
    if not q: continue
    page = re.search(r"page=([^|]+)", q.group(1)); pl = re.search(r"placement=(\d+)", q.group(1))
    if not page: continue
    pg = page.group(1).strip()
    region = pg.split("/")[0]
    note = ""
    if region == "Mid-Season Invitational":                       # MSI 冠軍：賽區看備註裡連到哪個聯賽
        note = "MSI 冠軍"
        m = re.search(r"\[\[(\w+)/20\d\d", part[part.find("notes="):]); region = m.group(1) if m else "MSI"
        pl = None
    info[NAMES.get(name, name)] = {"region": region, "seed": int(pl.group(1)) if pl else None, "note": note}
# 賽區種子：同一賽區內照頁面上出現的順序排（頁面本來就依種子順序列；LPL 的 4 個名額來自不同資格賽，各自的 placement 會重複，不能直接用）
cnt = {}
for v in info.values():
    cnt[v["region"]] = cnt.get(v["region"], 0) + 1
    v["seed"] = cnt[v["region"]]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(info, open(OUT, "w"), ensure_ascii=False, indent=1)
for k, v in info.items(): print(k, v)
