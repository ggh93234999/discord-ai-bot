import { defineConfig } from "vite";

// base: "./" 讓打包後的資源用相對路徑，Discord 的 proxy 才找得到
// envDir：VITE_ 開頭的變數也從專案根目錄的 .env 讀，不用另外放一個 activity/.env
export default defineConfig({ envDir: "..", base: "./", server: { allowedHosts: true }, build: { assetsInlineLimit: 0 } });
