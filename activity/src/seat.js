// 觀眾席：棋類與皮卡丘排球可以先當觀眾（不佔座位、不會直接下場），想玩再按「上場對戰」；打完或沒開局時也能「回觀眾席」。
// 「進房先當觀眾」的選擇會記在瀏覽器裡，之後進任何雙人遊戲都先在觀眾席。
export function specFirst() { try { return localStorage.getItem("specfirst") === "1"; } catch { return false; } }
function setSpecFirst(v) { try { localStorage.setItem("specfirst", v ? "1" : "0"); } catch {} }

export function createSeat(root, { getWs, getSt }) {
  const box = document.createElement("div");
  box.className = "seatbar";
  box.innerHTML = `<button class="sit" hidden>🪑 上場對戰</button><button class="stand" hidden>👀 回觀眾席</button>
    <label class="sp"><input type="checkbox"> 進房先當觀眾</label>`;
  const anchor = root.querySelector(".actions");
  (anchor || root.querySelector(".game")).insertAdjacentElement(anchor ? "afterend" : "beforeend", box);
  const sit = box.querySelector(".sit"), stand = box.querySelector(".stand"), cb = box.querySelector("input");
  cb.checked = specFirst();
  cb.addEventListener("change", () => setSpecFirst(cb.checked));
  const send = (t) => { const ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t })); };
  sit.addEventListener("click", () => send("sit"));
  stand.addEventListener("click", () => send("stand"));
  return {
    update() {
      const st = getSt(); if (!st) return;
      sit.hidden = !st.canSit; stand.hidden = !st.canStand;
    },
  };
}
