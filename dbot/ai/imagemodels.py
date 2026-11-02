"""畫圖／改圖用的模型設定：讀專案根目錄的 image_models.json（沒有就用 image_models.example.json）。
每個要架設的人複製 example 改成自己的模型即可；欄位說明寫在檔案開頭的 _說明／_欄位。"""
import json
import logging
from pathlib import Path

log = logging.getLogger("bot")
ROOT = Path(__file__).resolve().parents[2]
FILES = (ROOT / "image_models.json", ROOT / "image_models.example.json")
BUILTIN = {"generate": {"fast": {"model": "draw-klein", "label": "快速", "eta": 30, "big_sizes": True}},
           "edit": {"fast": {"model": "draw-klein", "label": "快速", "eta": 25}}, "prompt_writer": "prompt-writer", "gallery": ["fast"]}


def _entries(d) -> dict:
    out = {}
    for k, v in (d or {}).items():
        if str(k).startswith("_") or not isinstance(v, dict) or not str(v.get("model") or "").strip():
            continue
        out[str(k)] = {
            "model": str(v["model"]).strip(),
            "label": str(v.get("label") or k),
            "eta": int(v.get("eta") or 60),
            "timeout": int(v.get("timeout") or 900),
            "big_sizes": bool(v.get("big_sizes")),
            "human_only": bool(v.get("human_only")),
            "prompt_lang": "zh" if v.get("prompt_lang") == "zh" else "en",
            "hint": str(v.get("hint") or ""),
            "note": str(v.get("note") or ""),
        }
    return out


def load() -> dict:
    data = None
    for f in FILES:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            break
        except FileNotFoundError:
            continue
        except (OSError, ValueError) as e:
            log.warning("畫圖模型設定 %s 讀不了：%r", f.name, e)
    if data is None:
        data = BUILTIN
    gen, edit = _entries(data.get("generate")), _entries(data.get("edit"))
    if not gen or not edit:
        log.warning("畫圖模型設定缺 generate 或 edit，改用內建預設")
        gen, edit = _entries(BUILTIN["generate"]), _entries(BUILTIN["edit"])
    return {"generate": gen, "edit": edit,
            "prompt_writer": str(data.get("prompt_writer") or "prompt-writer").strip(),
            "gallery": [k for k in (data.get("gallery") or []) if k in gen and not gen[k]["human_only"]] or [next(iter(gen))]}
