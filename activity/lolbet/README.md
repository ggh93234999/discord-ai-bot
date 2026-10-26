# 世界賽運彩（lolbet）

英雄聯盟世界賽單場勝負下注。**整個功能都在這個資料夾**，世界賽結束（預計 2026-11-16）後可以照下面步驟移除。

## 資料夾內容

| 檔案 | 用途 |
| --- | --- |
| `server.js` | 伺服器：OddsPapi 賠率、Liquipedia 賽果、下注與結算、額度控管 |
| `client.js` | 前端：賽程卡片、下注面板、歷史、他人下注、排行榜 |
| `lolbet.css` | 這個功能的樣式（含賭場最上面的大卡片） |
| `lol-bg.jpg` | 大卡片背景圖 |
| `teams/` | 隊伍資料：`index.json`（隊名→圖檔）、`seeds.json`（賽區與種子）、`*.png` 隊徽 |
| `scripts/` | 抓隊徽、抓賽區種子的 Python 腳本 |
| `lolbet.env` | **金鑰與設定**（`ODDSPAPI_KEY`、`LOLBET_*`），不進 git，權限 600 |
| `lolbet.env.example` | 設定範例 |
| `state.json` | 賠率快取、API 呼叫次數、賽果、注單處理狀態，不進 git |

## 外面只有這三個接點

1. `server/server.js`：`import { handleLol, lolClose } from "../lolbet/server.js"`、處理 `lolget|lolbet|lolhist` 訊息的那一行，以及連線關閉時的 `lolClose(ws)`。
2. `src/main.js`：`import { mountLolBet } from "../lolbet/client.js"`，以及賭場清單裡 `id: "lolbet"` 的那一項。
3. `src/main.js` 卡片 class 用到 `g.cls`（只有這個功能用，留著無妨）。

## 移除步驟

1. **先處理未結算的注單**：確認 `state.json` 裡沒有 `open`／`unpaid` 的注單（沒結算完就移除，玩家的代幣不會退）。
2. 刪掉上面三個接點。
3. 刪掉整個 `activity/lolbet/` 資料夾（金鑰跟著一起沒了）。
4. 到 oddspapi.io 後台把金鑰停用或重新產生。
5. `npm run build`，再 `sudo systemctl restart discord-activity`。
