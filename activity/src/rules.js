// 賭場各遊戲的規則說明（和機器人 /規則 的內容一致）。標題列右邊加一顆「📖 規則」，按了展開／收起。
const COMMON = `<h4>代幣</h4><ul>
<li>代幣和機器人的是同一本帳：在伺服器聊天、掛語音都會賺，每分鐘最多 +10。</li>
<li>🎮 練習模式：用練習幣（1000 起），不碰真代幣，隨便玩。</li>
<li>💰 賭注模式：要在 Discord 裡授權確認身分，輸贏會真的加減你的代幣。可下注 10 / 50 / 100 / 500。</li></ul>`;

export const RULES = {
  coin: `<h4>擲硬幣</h4><ul>
<li>先選正面或反面，按「擲」。</li>
<li>猜中：拿回 2 倍賭注（淨賺 1 倍）；猜錯：賭注沒了。</li>
<li>機率各 50%，伺服器用真亂數決定。</li></ul>${COMMON}`,
  dice: `<h4>骰子</h4><ul>
<li>你和莊家各擲兩顆骰子，加總比大小。</li>
<li>你比較大：拿回 2 倍賭注；一樣大：賭注退回；比較小：賭注沒了。</li></ul>${COMMON}`,
  bj: `<h4>21 點</h4><ul>
<li>發牌後你有兩張牌，莊家一張明牌、一張蓋牌。點數最接近 21、又不超過的人贏。</li>
<li>2～10 照點數，J Q K 算 10，A 算 11 或 1（自動選對你有利的）。</li>
<li>你可以「要牌」或「停牌」；超過 21 就爆牌，直接輸。</li>
<li>你停牌後，莊家 16 點以下一定補牌，17 點以上停牌。</li>
<li>贏：拿回 2 倍賭注；平手：退回賭注；輸：賭注沒了。</li>
<li>開局就是 21 點（Blackjack）：拿回 2.5 倍賭注（淨賺 1.5 倍）。</li>
<li>沒有雙倍下注和分牌。玩到一半離開或斷線，會自動停牌並結算。</li></ul>${COMMON}`,
  horse: `<h4>賽馬</h4><ul>
<li>每場有 6 匹馬，各自有狀態（🔥 絕佳 ～ 🤕 低迷），狀態和能力決定獲勝機率。</li>
<li>點一匹馬、選賭注，按「開跑」。只能押「第一名」。</li>
<li>賠率 = 押中拿回的倍數（含本金）。賠率 = 0.95 ÷ 獲勝機率，所以熱門馬賠率低、冷門馬賠率高（莊家抽 5%）。</li>
<li>押中：拿回 賭注 × 賠率（無條件捨去）；沒中：賭注沒了。</li>
<li>這裡是一個人一場，不是機器人 /賽馬 那種全頻道一起押的賽事。</li></ul>${COMMON}`,
  slots: `<h4>老虎機</h4><ul>
<li><b>3 格（單排）</b>：三個一樣拿回 🍒 2 倍／🍋 2.5 倍／💎 3.2 倍；只有兩個一樣，賭注退回；其他沒中。</li>
<li><b>3×3（9 格）</b>：8 條線（3 橫 3 直 2 對角），每條線 3 格一樣就中。每條線拿回 🍒 1.2／🍋 1.6／🔔 2／💎 2.8 倍，多條線的倍率會累加。</li>
<li><b>4×4（16 格）</b>：10 條線（4 橫 4 直 2 對角），整條 4 格一樣才中。每條線拿回 🍒 2／🍋 2.5／💎 3.2 倍，多條線會累加。</li>
<li>結果由伺服器用真亂數決定，賠率和機器人 /老虎機 一樣。</li></ul>${COMMON}`,
};

export function attachRules(root, key) {
  const head = root.querySelector("header");
  const b = document.createElement("button");
  b.className = "rulesbtn"; b.textContent = "📖 規則";
  const box = document.createElement("div");
  box.className = "rulesbox"; box.hidden = true; box.innerHTML = RULES[key] || "";
  b.addEventListener("click", () => { box.hidden = !box.hidden; });
  head.append(b);
  head.insertAdjacentElement("afterend", box);
}
