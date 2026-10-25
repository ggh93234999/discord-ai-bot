#!/usr/bin/env python3
"""下載世界賽隊伍圖標到 activity/public/teams/，並產生 index.json（OddsPapi 的隊名 → 檔名）。
資料來源 Liquipedia（遵守他們的 API 規則：帶 User-Agent、請求間隔 2 秒以上）。圖標只抓一次，之後從本機提供。
用法：python3 scripts/fetch_lol_logos.py
"""
import gzip, json, os, re, sys, time, urllib.parse, urllib.request

UA = "discord-activity-logo-fetch/1.0 (personal hobby bot)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "teams")
WIKI = "https://liquipedia.net/leagueoflegends/api.php"
# OddsPapi 的隊名 → Liquipedia 頁面名稱
TEAMS = {
    "Hanwha Life Esports": "Hanwha Life Esports", "Invictus Gaming": "Invictus Gaming", "TOP Esports": "Top Esports",
    "G2 Esports": "G2 Esports", "Movistar Koi": "Movistar KOI", "Dplus": "Dplus", "Gen.g Esports": "Gen.G Esports",
    "Lyon Gaming": "LYON", "Ctbc Flying Oyster": "CTBC Flying Oyster", "T1": "T1", "Bilibili Gaming": "Bilibili Gaming",
    "Karmine Corp": "Karmine Corp", "Los": "LOS", "Team Secret Whales": "Secret Whales", "Anyones Legend": "Anyone's Legend",
    "Team Liquid": "Team Liquid",
}
# 頁面抓不到或抓錯時，直接指定檔案名稱
FORCE = {"Movistar Koi": "Movistar KOI 2025 allmode.png"}
if len(sys.argv) > 1: TEAMS.update(json.loads(sys.argv[1]))      # 額外隊伍：'{"OddsPapi 名稱":"Liquipedia 頁面"}'


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    d = urllib.request.urlopen(r, timeout=40).read()
    try: d = gzip.decompress(d)
    except Exception: pass
    return d


def api(**p):
    p["format"] = "json"
    d = json.loads(get(WIKI + "?" + urllib.parse.urlencode(p)))
    time.sleep(2.2)
    return d


def slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


os.makedirs(OUT, exist_ok=True)
j = api(action="query", titles="|".join(TEAMS.values()), prop="revisions", rvprop="content", rvslots="main", redirects=1)
red = {x["from"]: x["to"] for x in j["query"].get("redirects", [])}
pages = {p["title"]: p for p in j["query"]["pages"].values()}
pick = {}
for k, t in TEAMS.items():
    p = pages.get(red.get(t, t))
    if not p or "revisions" not in p: print("找不到頁面", k, t); pick[k] = None; continue
    txt = p["revisions"][0]["slots"]["main"]["*"]
    d = re.search(r"\|\s*imagedark\s*=\s*([^\n|]+)", txt); n = re.search(r"\|\s*image\s*=\s*([^\n|]+)", txt)
    f = (d or n)                                   # 我們是深色介面：有深色版就用深色版
    pick[k] = f.group(1).strip() if f else None
for k, v in FORCE.items():
    if k in pick: pick[k] = v
# 頁面沒寫 image 的：從頁面上的圖片找 allmode／darkmode
for k, v in list(pick.items()):
    if v: continue
    t = red.get(TEAMS[k], TEAMS[k])
    r = api(action="query", titles=t, generator="images", gimlimit=50, prop="info")
    names = [x["title"][5:] for x in r.get("query", {}).get("pages", {}).values()]
    c = [n for n in names if re.search(r"(allmode|darkmode)", n) and not re.search(r"academy|challengers|fenix|karps", n, re.I)]
    c.sort(key=lambda n: (0 if "full" in n else 1, -int(re.search(r"(20\d\d)", n).group(1)) if re.search(r"(20\d\d)", n) else 0))
    pick[k] = c[0] if c else None
    print("備援", k, "->", pick[k])
files = {k: v for k, v in pick.items() if v}
ii = api(action="query", titles="|".join("File:" + v for v in files.values()), prop="imageinfo", iiprop="url")
urls = {}
for p in ii["query"]["pages"].values():
    if "imageinfo" in p: urls[p["title"][5:].replace("_", " ")] = p["imageinfo"][0]["url"]
index = {}
for k, v in files.items():
    u = urls.get(v.replace("_", " "))
    if not u: print("沒有檔案網址", k, v); continue
    fn = slug(k) + os.path.splitext(u.split("?")[0])[1]
    path = os.path.join(OUT, fn)
    if os.path.exists(path) and os.path.getsize(path) > 0: index[k] = fn; continue          # 已經有了就不重抓
    try:
        open(path, "wb").write(get(u))
        try:                                                                              # 縮小到 160px，手機載入比較快
            from PIL import Image
            im = Image.open(path); im.thumbnail((160, 160)); im.save(path, optimize=True)
        except Exception: pass
    except Exception as e: print("下載失敗", k, e); continue
    index[k] = fn; print("OK", k, "->", fn); time.sleep(2.2)
json.dump(index, open(os.path.join(OUT, "index.json"), "w"), ensure_ascii=False, indent=1)
print(len(index), "/", len(TEAMS))
