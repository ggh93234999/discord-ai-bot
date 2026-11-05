// 機箱風道熱像：獨立的 3D 流體／熱傳模擬頁（airflow-sim.html），用 iframe 嵌進來。
import simUrl from "./airflow-sim.html?url";

export function mountAirflow(root, { back }) {
  root.innerHTML = `
    <div class="game airflow">
      <header><button class="back">← 選單</button><h2>機箱風道熱像</h2><span class="hdr"></span></header>
      <iframe class="afframe" title="機箱風道熱像" src="${simUrl}" allow="fullscreen"></iframe>
    </div>`;
  root.querySelector(".back").addEventListener("click", back);
}
