"""執行時產生的資料統一放在 data/：
  data/records/  存檔與狀態（錢包、設定、農場…，掉了會出事的資料）
  data/logs/     事件流水與紀錄（轉帳帳本、動作紀錄、播放紀錄…）
舊版把檔案直接放在專案根目錄；第一次用新路徑時，如果新位置沒有、舊位置有，就自動搬過去（一次性）。
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RECORDS = DATA / "records"
LOGS = DATA / "logs"


def _place(folder: Path, name: str) -> Path:
    p = folder / name
    p.parent.mkdir(parents=True, exist_ok=True)
    old = ROOT / name
    try:
        if not p.exists() and old.exists():
            shutil.move(str(old), str(p))
    except OSError as e:
        print(f"[paths] 搬移舊資料失敗 {name}: {e!r}")
    return p


def record(name: str) -> Path:
    return _place(RECORDS, name)


def logfile(name: str) -> Path:
    return _place(LOGS, name)


def internal_key(create: bool = False) -> str:
    """機器人 ↔ Activity 後端共用的內部金鑰（INTERNAL_KEY）。
    讀取順序：環境變數 → 專案 .env → 舊版 activity/server/internal.key。
    create=True（只有機器人用）：全都沒有就自己產生一把，寫進 .env，架設的人不用手動設定。"""
    import os
    import secrets
    k = os.environ.get("INTERNAL_KEY", "").strip()
    if len(k) >= 32:
        return k
    envf = ROOT / ".env"
    try:
        for line in envf.read_text(encoding="utf-8-sig").splitlines():
            if line.strip().startswith("INTERNAL_KEY="):
                k = line.split("=", 1)[1].strip().strip('"').strip("'")
                if len(k) >= 32:
                    return k
    except OSError:
        pass
    try:
        k = (ROOT / "activity" / "server" / "internal.key").read_text().strip()
        if len(k) >= 32:
            return k
    except OSError:
        pass
    if not create:
        return ""
    k = secrets.token_hex(32)
    try:
        with open(envf, "a", encoding="utf-8") as f:
            f.write(("\n" if envf.exists() and not envf.read_text(encoding="utf-8").endswith("\n") else "") + f"INTERNAL_KEY={k}\n")
        os.environ["INTERNAL_KEY"] = k
    except OSError as e:
        print(f"[paths] 無法把 INTERNAL_KEY 寫進 .env：{e!r}")
        return ""
    return k
