import base64, io, json, os, sys, time, urllib.request, uuid
from PIL import Image
D=os.path.dirname(os.path.abspath(__file__))
env={}
for l in open(os.path.join(D,"../../.env"),encoding="utf8"):
    if "=" in l and not l.startswith("#"):
        k,v=l.strip().split("=",1); env[k]=v.strip().strip('"\'')
BASE,KEY=env["LLM_BASE_URL"].rstrip("/"),env["LLM_API_KEY"]
img=Image.open(os.path.join(D,"variants/bz_ref.png")).convert("RGB"); img.thumbnail((768,1152)); buf=io.BytesIO(); img.save(buf,"PNG"); data=buf.getvalue()
BASEP=("Repaint this white guardian lion divine beast Baize as a traditional Chinese ink wash painting (sumi-e) on aged xuan rice paper. Keep it clearly a Chinese guardian lion (qilin-like) beast: keep the lion face shape, lion muzzle, nose and beard, the same pose, body, two curved horns, cloud-pattern scales and clawed paws. Only soften the look: a calm, gentle, dignified expression with relaxed eyes and a closed mouth (not fierce, no bared teeth, fewer wrinkles on the face), and the mane is smooth, wavy and neatly flowing in long soft locks instead of tight curls. It must NOT look like a human, NOT like a goat or sheep. Expressive black ink brushwork with soft gray washes, the creature kept white, subtle paper grain, one small red seal stamp, no text. Background: ")
BG=["a rich ink landscape: tall steep misty mountain peaks in layers, an old twisted pine tree on the left, a waterfall from a cliff, swirling auspicious clouds, a small pavilion on a ridge, a flying crane in the sky",
    "a rich ink landscape: the beast on a mossy rock beside a mountain stream, layered misty mountains, a bent pine, bamboo, drifting clouds, a pale moon, a pagoda in the far distance"]
for k,bg in enumerate(BG,6):
    b=uuid.uuid4().hex
    def part(n,v,fn=None,ct=None):
        h=f'--{b}\r\nContent-Disposition: form-data; name="{n}"'+(f'; filename="{fn}"' if fn else "")+"\r\n"+(f"Content-Type: {ct}\r\n" if ct else "")+"\r\n"
        return h.encode()+(v if isinstance(v,bytes) else v.encode())+b"\r\n"
    body=part("model","edit-qwen-4")+part("prompt",BASEP+bg)+part("n","1")+part("image",data,"ref.png","image/png")+f"--{b}--\r\n".encode()
    t0=time.time()
    for a in range(3):
        try:
            req=urllib.request.Request(BASE+"/images/edits",body,{"Authorization":"Bearer "+KEY,"Content-Type":"multipart/form-data; boundary="+b})
            it=json.load(urllib.request.urlopen(req,timeout=500))["data"][0]
            raw=base64.b64decode(it["b64_json"]) if it.get("b64_json") else urllib.request.urlopen(it["url"]).read()
            Image.open(io.BytesIO(raw)).convert("RGB").save(os.path.join(D,f"variants/bz3_{k}.jpg"),quality=90); print(k,f"{time.time()-t0:.0f}s",flush=True); break
        except Exception as e: print(k,"err",str(e)[:100],flush=True); time.sleep(5)
