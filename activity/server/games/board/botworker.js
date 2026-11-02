// 電腦對手的搜尋放在獨立執行緒，避免卡住主程式的 60Hz 遊戲迴圈。
import { parentPort } from "node:worker_threads";
import { pickMove, LEVELS } from "./botengine.js";

parentPort.on("message", ({ id, game, st, level }) => {
  try { parentPort.postMessage({ id, move: pickMove(game, st, LEVELS[level] || LEVELS[2]) }); }
  catch (e) { parentPort.postMessage({ id, error: String((e && e.message) || e) }); }
});
