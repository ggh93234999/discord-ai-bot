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
