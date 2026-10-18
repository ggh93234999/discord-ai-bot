import { defineConfig } from "vite";

// base: "./" 讓打包後的資源用相對路徑，Discord 的 proxy 才找得到
export default defineConfig({ base: "./", server: { allowedHosts: true }, build: { assetsInlineLimit: 0 } });
