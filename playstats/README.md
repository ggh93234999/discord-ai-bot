# 遊玩帳（playstats）

獨立的遊玩統計網頁，只給內網看。資料讀的是機器人記下的 `data/records/gamelog.db`（只讀），本身不依賴機器人或 Activity。

- 網址：`http://192.168.0.50:3120/`（Apache 內網專用站台，設定見 `playstats.apache.conf.example`，限 192.168.0.0/24 和 VPN 10.66.0.0/24）
- 程式本身只聽 127.0.0.1:3121（`PLAYSTATS_PORT` 可改），並且再擋一次非內網來源。路由器有 DMZ，所以絕對不要直接開放 3121 或讓 Apache 站台對外。
- 啟動：`node server.js`（Node 22 以上，用內建的 `node:sqlite`）
- 服務：`/etc/systemd/system/playstats.service`（範例見 `playstats.service.example`）
