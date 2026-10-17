# Discord AI 機器人（大笨bot）

讀取頻道的歷史訊息當上下文，用本地模型（例如 Qwen，經 LiteLLM 的 OpenAI 相容 API）回覆。
機器人本體跑在 Linux 伺服器上（systemd 服務 `discord-bot`），連到你設定的模型 API（`LLM_BASE_URL`）。
Discord 機器人只需要「往外連」Discord，不用開任何連接埠。

## 快速開始（自己架一隻）

### 1. 需要什麼
- Python 3.11 以上
- 系統要裝 `ffmpeg`（放音樂用）和 `node`（yt-dlp 解 YouTube 用）。Ubuntu／Debian：`sudo apt install ffmpeg nodejs`
- 一個 **OpenAI 相容的模型 API**：本機的 Ollama、LiteLLM、vLLM，或 OpenAI、DeepSeek 等線上服務都行
- 一個 Discord 機器人帳號（下一步）

### 2. 建立 Discord 機器人並拿到 token
1. 到 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**，取名字。
2. 左邊 **Bot** 頁 → **Reset Token** → 複製出現的 token（只會顯示一次）。**這就是 `DISCORD_TOKEN`，等同機器人的密碼，不要貼到任何公開的地方。**
3. 同一頁往下找到 **Privileged Gateway Intents**，打開 **Message Content Intent**（沒開機器人讀不到訊息內容）。
4. 左邊 **General Information** 複製 **Application ID**（也就是 client id）。
5. 邀請機器人進你的伺服器：把下面「邀請連結」裡的 `YOUR_CLIENT_ID` 換成剛才的 Application ID，用瀏覽器打開、選伺服器、同意。

### 3. 安裝與設定
```bash
git clone https://github.com/ggh93234999/discord-ai-bot.git
cd discord-ai-bot
python3 -m venv .venv
source .venv/bin/activate          # Windows：.venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # Windows：copy .env.example .env
```
然後用文字編輯器打開 `.env`，**把金鑰填在這裡**（這個檔案已被 `.gitignore` 擋住，不會被 git 上傳；千萬不要把它傳給別人或貼到聊天室）：

| 變數 | 填什麼 |
|---|---|
| `DISCORD_TOKEN` | 上一步複製的機器人 token |
| `LLM_BASE_URL` | 模型 API 位址，要含 `/v1`。Ollama：`http://localhost:11434/v1`；LiteLLM：`http://localhost:4000/v1`；OpenAI：`https://api.openai.com/v1` |
| `LLM_API_KEY` | 模型 API 的金鑰。Ollama 不檢查，隨便填一個非空字串（例如 `ollama`）即可 |
| `LLM_MODEL` | 模型名稱，要跟 API 那邊的名稱一樣，例如 `qwen3:8b`、`gpt-4o-mini` |
| `DEEPSEEK_API_KEY` | 選填，只有想用 `/餘額` 查 DeepSeek 餘額才需要 |
| `ADMIN_USER_IDS` | 選填，除了機器人擁有者以外，還有誰能用 `/模型` 切模型（Discord 使用者 ID，逗號分隔） |

其他選填設定都有預設值，說明寫在 `.env.example` 裡。

### 4. 啟動
```bash
python bot.py
```
看到「已同步斜線指令」就成功了。到 Discord 打 `/` 就能看到指令（第一次可能要等一兩分鐘，或按 Ctrl+R 重新整理）。
語音和聊天都在這一個程式裡，**不需要對外開任何連接埠**，機器人只是主動連出去 Discord 和你的模型 API。

要長期運作的話，可以用 systemd：參考 `discord-bot.service.example`，改掉使用者和路徑後放到 `/etc/systemd/system/`，再 `sudo systemctl enable --now discord-bot`。

### 5. 常見問題
- **機器人在線上但不回話**：多半是 **Message Content Intent** 沒開（步驟 2-3），或 `LLM_BASE_URL` 連不到（看終端機的錯誤訊息）。
- **指令沒出現**：重新整理 Discord（Ctrl+R）；確認邀請連結有包含 `applications.commands`。
- **放音樂沒聲音／失敗**：確認系統有 `ffmpeg`，機器人有「連線」和「說話」權限；YouTube 常改版，`pip install -U yt-dlp` 通常就會好。
- **token 外洩了**：馬上回 Developer Portal 重新 **Reset Token**，舊的就失效，再把新的填進 `.env`。

## 什麼時候會回

- 私訊機器人
- 在頻道裡 @機器人，或直接回覆機器人的訊息
- 用 `/自動回覆 開` 開啟的頻道，任何人說話都回

其他機器人發的訊息一律不理，避免兩個機器人互相無限對話。
模型那台電腦關機或沒開模型時，機器人會回「模型那台電腦現在沒開或連不到」。

## 功能

- **看圖**：最近 4 則訊息裡的圖片（最多 4 張）會縮圖後一起送給模型。
- **天氣**：問天氣會用 Open-Meteo 查（免費、不用金鑰）。
- **上網**：需要即時資訊時，模型自己決定要不要用 DuckDuckGo 搜尋、打開網頁讀內容。
  查的時候會先出現「🔎 搜尋：…」，查完那則訊息會變成答案。
- **放音樂（YouTube）**：先進語音頻道，再用 `/播放 歌名或網址`，或直接說「@大笨bot 放周杰倫的晴天」「放點讀書的音樂」「下一首」。
  可以貼單首網址或整個播放清單（最多 50 首）。佇列播完 3 分鐘、或語音頻道沒人 1 分鐘，會自己離開。
  yt-dlp 建議定期更新（可參考 `update-ytdlp.sh.example` 設成每週的 crontab），YouTube 改版時通常更新就會好。
- **開頻道**（要叫它開的人本身要有「管理頻道」權限；機器人也要有「管理頻道」，臨時語音房再加「移動成員」）
  - `/開頻道 名稱 類型 [分類] [私人]`，或直接說「@大笨bot 幫我開一個叫 xxx 的語音頻道」
  - `/改頻道 [頻道] [新名稱] [分類]`：改名或搬到別的分類，也可以直接說「把大笨bot 語音頻道移到語音頻道分類」
  - `/關頻道 方式 [頻道] [隱藏]`：封存（鎖住、可還原）、解除封存、刪除（永久，會先跳確認按鈕）。
    用說的只能封存／解除封存，不能刪除。封存需要機器人另有「管理身分組」權限。
  - `/頻道狀態 [狀態] [頻道]`：設定語音頻道狀態（留空＝清除），也能直接說「把語音狀態改成 讀書中」。手動設定的狀態不會被歌名蓋掉。
  - `/臨時語音房 開`：建立「➕ 建立語音房」入口，有人進去就自動開一間他的房間並移過去，人走光自動刪掉
- **斜線指令**
  - `/播放 <歌曲>`、`/跳過`、`/暫停`、`/繼續`、`/停止`、`/佇列`、`/隨機`
  - 放歌時會在點歌的頻道貼一個**播放面板**：正在播放＋進度條（15 秒更新一次）、接下來的歌和總長度、播完會顯示「✅ 歌單播完了」，離開時顯示「👋 已離開」。面板被聊天洗上去時，換歌會自動重貼到最下面；`/佇列` 也能把它叫到最下面。按鈕：⏯️ 暫停/繼續、⏭️ 跳過、🔀 隨機、⏹️ 停止。
  - 放歌時語音頻道狀態會自動顯示「🎶 歌名」，播完或離開時還原。
  - `/插播 <歌曲> [立刻播]`（英文 `/playnext`）：插歌。預設插到「下一首」；「立刻播」選開就馬上播並跳過現在這首。也可以直接說「插一首周杰倫的晴天」，AI 會用 music 工具的 `position`（end／next／now）
  - `/移除 <編號或歌名>`：從佇列拿掉某一首；`/清空佇列`：接下來的全拿掉（現在這首放完）
  - `/歷史`：看播放紀錄（每首播過的歌自動記在 `play_history.json`）；`/隨機循環 開|關`：懶得選歌時，從紀錄隨機一直放，佇列空了自動補 5 首（避開最近播過的）；也可以直接跟機器人說「隨便放」
  - `/投票 <題目> <選項1> <選項2> [選項3~5] [分鐘]`：按鈕投票，每人一票可改票，時間到公布結果（重開機器人後進行中的投票會失效）；`/抽籤 <選項> [人數]`：從一串選項隨機抽；`/亂數 <最小> <最大> [數量] [不重複]`：隨機抽數字（也可以直接跟機器人說「8到80隨機一個」，他會呼叫 random_number 工具，不會自己編）；`/狀態`：看模型連線、延遲、啟動多久、有沒有在放歌（程式在 `extras.py`）
  - `/模型 [模型名稱]`：看或切換 AI 模型（只有機器人擁有者能切；切之前會先試打一次，選擇存在 state.json）。線上模型（如 deepseek）計費，內容陣列壓成純文字（圖片照送，deepseek 看得懂圖），不送 Ollama 專用參數（keep_alive），但仍會送 reasoning_effort（`REMOTE_REASONING_EFFORT`，預設 none，因為 DeepSeek 不帶參數會思考、多花 3~4 倍費用）；`.env` 可加 `ADMIN_USER_IDS`（逗號分隔）讓其他人也能切、`LOCAL_MODELS`（逗號分隔）標示哪些是本機模型。`/狀態` 會顯示今天和近 7 天各模型的呼叫次數與 token（程式在 `models.py`）
  - **中英指令共存**：每個中文指令都有一個英文名字的版本（例如 `/播放` = `/play`、`/投票` = `/poll`、`/亂數` = `/random`），做一樣的事；對照表在 `aliases.py` 的 `TABLE`，新增指令時記得在那裡加一行。`/help` 會顯示每個指令的英文名
  - `/餘額`：查 DeepSeek 帳戶剩多少錢（只有機器人擁有者能查，結果頻道裡大家看得到；需在 `.env` 加 `DEEPSEEK_API_KEY=`，用 DeepSeek 官方的 /user/balance 查）
  - `/help`：看所有指令
  - `/總結 [則數] [重點]`：總結最近的對話（預設 100 則，最多 500）
  - `/重置`：讓機器人忘掉這個頻道到目前為止的對話
  - `/自動回覆 開|關`：這個頻道要不要每則都回（需要「管理頻道」權限）

## 調整

- **個性和說話方式**：改 `system_prompt.txt`，存檔後下一則回覆就生效，不用重開。
  （上網工具的使用規則和現在時間是程式自動加在後面的，不用寫在這裡。）
- **其他設定**在 `.env`，改完要 `sudo systemctl restart discord-bot`：
  - `HISTORY_LIMIT`：往回讀幾則訊息。越多越懂前後文，但模型處理越久。
  - `REASONING_EFFORT`：`none` 最快；想要它多想一下改 `low` / `medium` / `high`。
  - `MAX_TOKENS`：每次回覆長度上限。
  - `WEB_TOOLS=off`：關掉上網／天氣。
  - `IMAGE_LOOKBACK`、`MAX_IMAGES`、`IMAGE_MAX_SIDE`：看圖的範圍、張數、縮圖大小。

## 常用指令（在伺服器上）

```bash
sudo systemctl restart discord-bot   # 重開
sudo systemctl stop discord-bot      # 停
systemctl status discord-bot         # 狀態
journalctl -u discord-bot -f         # 即時 log
```

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `bot.py` | 主程式 |
| `music.py` | 音樂播放 |
| `channels.py` | 開頻道、臨時語音房 |
| `update-ytdlp.sh.example` | 每週自動更新 yt-dlp 的範例腳本（改路徑後用 crontab 跑） |
| `.env` | 設定與金鑰（只有自己讀得到，不要外傳） |
| `.env.example` | 設定範本 |
| `system_prompt.txt` | 機器人的個性設定 |
| `state.json` 等 | 執行時資料（自動回覆頻道、錢包、播放紀錄、馬匹資料…），程式自己維護，已被 `.gitignore` 排除 |
| `discord-bot.service.example` | systemd 服務檔範例（改使用者與路徑後裝到 /etc/systemd/system/） |
| `requirements.txt` | Python 套件（建議用虛擬環境） |
| `run.bat` | 在 Windows 上手動測試用（要連得到模型 API） |
| `_old_claude_api/` | 舊版備份 |

邀請連結（含斜線指令權限，把 `YOUR_CLIENT_ID` 換成 Discord Developer Portal 的 Application ID；權限值可依需要調整）：
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=281475265154064

## 代幣系統（economy.py）
- 賺：每分鐘最多 +10 🪙——在文字頻道發言，或掛在語音頻道（沒關耳機、不在 AFK 頻道）。新玩家起始 200。資料在 `wallet.json`，每個伺服器各自一本帳。
- 指令：`/規則`(rules) `/錢包`(wallet) `/排行`(leaderboard) `/轉帳`(pay) `/擲硬幣`(coinflip) `/骰子`(dice) `/老虎機`(slots) `/21點`(blackjack)。
- 老虎機：單排 3 格用 🍒🍋💎 三種圖案，三個一樣 2~3.2 倍，兩個一樣退錢（理論回報率約 95%）；21 點 Blackjack 賠 1.5 倍；其餘賭局公平。
- 21 點開局先扣賭注，機器人若在牌局中重啟，該局賭注會損失。
- `/發錢 對象 金額`（give）：機器人擁有者專用，直接發代幣。
- `/老虎機 賭注 [格數]`：3 格（單排）、9 格（3×3，8 條連線）、16 格（4×4，整排整欄加兩條對角線共 10 條，4 格一樣才算，3 種圖案）。多格版可同時中很多條，3×3 只有 🍒🍋🔔💎 四種圖案（約 41% 的把數會賺錢，三個一樣 1.2~2.8 倍）。各版本理論回報率都調在約 95%。
- `/賽馬 [等待秒數]`（horserace）：開一場賽馬，6 匹馬從 12 匹固定名單隨機出賽，每匹有速度／耐力／爆發數值（存 `horses.json`）、當天狀態和歷史戰績（出賽、勝場、近 5 場名次）。賠率 = 0.95 ÷ 勝率，勝率由能力＋狀態算出，所以強馬賠少、冷門賠多。按按鈕選馬、填賭注；每人一注，截止後播放跑道動畫並結算。機器人在比賽中途重啟，這場的賭注會損失。

## Discord Activity 小遊戲（`activity/`）
在語音頻道打開的內嵌遊戲視窗（Discord Embedded App SDK），目前有 Wordle（單人）和五子棋、四連棋、圓球排球（兩人，WebSocket 同步）。
- 前端：`activity/`（Vite 打包，`npm install && npm run build`，產物在 `activity/dist/`）。把 `VITE_CLIENT_ID` 寫進 `activity/.env`（Application ID，不是密鑰）。
- 後端：`activity/server/`（Node + ws，五子棋、四連棋房間，預設 `127.0.0.1:3101`，用 `node server.js` 或 systemd 常駐）。
- 對外：需要公開 HTTPS 網址。Developer Portal → Activities → URL Mappings 把 `/` 指到你放 `dist/` 的目錄；WebSocket 路徑 `/ws` 要轉到後端（Apache 用 `ProxyPass /你的路徑/ws http://127.0.0.1:3101/ws upgrade=websocket`）。
- 機器人端：Discord 開啟 Activities 後會自動建立入口指令 `/launch`；整批同步指令時必須把它一起帶上（`bot.py` 的 `sync_commands` 已處理）。
- 沒發佈的 Activity 只有擁有者和開發團隊成員能開。
