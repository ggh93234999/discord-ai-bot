# 遊玩帳（playstats）

獨立的遊玩統計網頁，只給內網看。資料讀的是機器人記下的 `data/records/gamelog.db`（只讀），本身不依賴機器人或 Activity。

- 網址：`http://內網IP:3120/`（埠號用環境變數 `PLAYSTATS_PORT` 改）
- 只接受內網位址（127.x、10.x、172.16–31.x、192.168.x）；有經過反向代理的請求一律拒絕，所以不要把它放到外網。
- 啟動：`node server.js`（Node 22 以上，用內建的 `node:sqlite`）
- 服務：`/etc/systemd/system/playstats.service`（範例見 `playstats.service.example`）
