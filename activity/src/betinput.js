// 自訂賭注：在預設金額按鈕旁邊加一個數字輸入框和「全押」鈕。
// opts: { getBet, setBet(n), getBal() → 目前餘額或 null, locked() → 這時不能改（轉動中、已下注…） }
export function addBetInput(container, opts) {
  const wrap = document.createElement("span");
  wrap.className = "betcustom";
  wrap.innerHTML = `<input class="betin" type="number" min="1" step="1" inputmode="numeric" placeholder="自訂"><button class="allin" title="把目前餘額全部押上">全押</button>`;
  container.append(wrap);
  const input = wrap.querySelector(".betin"), allin = wrap.querySelector(".allin");
  input.addEventListener("input", () => {
    if (opts.locked && opts.locked()) { refresh(); return; }
    const n = Math.floor(Number(input.value));
    if (Number.isFinite(n) && n >= 1) opts.setBet(Math.min(n, 1_000_000));
  });
  input.addEventListener("blur", refresh);
  allin.addEventListener("click", () => {
    if (opts.locked && opts.locked()) return;
    const b = opts.getBal && opts.getBal();
    if (b != null && b >= 1) opts.setBet(Math.min(b, 1_000_000));
  });
  function refresh(presets = []) {
    const bet = opts.getBet();
    const custom = !(Array.isArray(presets) ? presets : []).includes(bet);
    input.classList.toggle("sel", custom);
    if (document.activeElement !== input) input.value = custom ? String(bet) : "";
    const b = opts.getBal && opts.getBal();
    allin.classList.toggle("sel", b != null && bet === b);
  }
  return { refresh, input };
}
