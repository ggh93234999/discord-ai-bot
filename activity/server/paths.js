// 執行時產生的資料統一放在專案根目錄的 data/（跟機器人共用）：
//   data/records/activity/  存檔與狀態（農場、鍛造、抽卡、賭場暫存、圖創區…）
//   data/logs/activity/     事件流水（賭場流水）
// 舊版放在 activity/server/ 底下；第一次用新路徑時，新位置沒有、舊位置有，就自動搬過去（一次性）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.resolve(SERVER, "../../data");

function place(kind, name) {
  const p = path.join(DATA_ROOT, kind, "activity", name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    const old = path.join(SERVER, name);
    if (!fs.existsSync(p) && fs.existsSync(old)) fs.renameSync(old, p);
  } catch (e) { console.warn("搬移舊資料失敗", name, e.message); }
  return p;
}
export const arec = (name) => place("records", name);
export const alog = (name) => place("logs", name);
export const botRecord = (name) => path.join(DATA_ROOT, "records", name);   // 機器人那邊的存檔（唯讀參考用）
export const arecDir = (name) => place("records", name);                    // 整個資料夾（例如圖創區的圖）也一樣會從舊位置搬過來
