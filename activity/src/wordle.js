// Wordle（單人）
const WORDS = `about above actor admit adopt adult after again agent agree ahead alarm album alert alike alive allow alone along alter among anger angle angry apart apple apply arena argue arise armor array aside asset avoid awake award aware badly baker basic beach began begin being below bench birth black blame blank blind block blood board boost brain brand bread break brick brief bring broad brown build burst buyer cable candy carry catch cause chain chair chart chase cheap check chest chief child choir civil claim class clean clear click climb clock close cloud coach coast color count court cover crack craft crash crazy cream crime cross crowd crown curve daily dance death delay depth doubt dozen draft drama dream dress drink drive early earth eight elite empty enemy enjoy enter equal error event every exact exist extra faith false fault fiber field fifth fifty fight final first flame flash fleet floor focus force frame fresh front fruit funny ghost giant given glass globe grace grade grain grand grant grass great green gross group guard guess guest guide happy heart heavy hello honey horse hotel house human hurry ideal image index inner input issue joint judge juice knife known label large laser later laugh layer learn least leave legal lemon level light limit local logic loose lover lower lucky lunch magic major maker march match maybe mayor meant media metal might minor model money month moral motor mount mouse mouth movie music naked nerve never newly night noble noise north novel nurse ocean offer often order other ought outer owner paint panel paper party peace phase phone photo piano piece pilot pitch place plain plane plant plate point pound power press price pride prime print prior prize proof proud prove queen quick quiet quite radio raise range rapid ratio reach react ready realm refer relax reply right river robot rough round route royal rural salad scale scene scope score sense serve seven shake shall shape share sharp sheet shelf shell shift shine shirt shock shoot shore short shown sight silly since sixth sixty skill sleep slice slide small smart smile smoke snake solid solve sorry sound south space spare speak speed spend spice split sport staff stage stair stand start state steam steel stick still stock stone store storm story strip study style sugar suite super sweet table taste teach thank their theme there these thick thing think third those three throw tiger tight title today topic total touch tough tower track trade trail train treat trend trial tribe trick truck truly trust truth twice under union unity until upper urban usage usual valid value video virus visit vital voice waste watch water wheel where which while white whole whose woman world worry worth would wound write wrong young youth zebra`.split(/\s+/);

const ROWS = 6, COLS = 5;
const rank = { x: 0, y: 1, g: 2 };

function score(guess, ans) {
  const res = Array(COLS).fill("x");
  const left = ans.split("");
  for (let i = 0; i < COLS; i++) if (guess[i] === ans[i]) { res[i] = "g"; left[i] = null; }
  for (let i = 0; i < COLS; i++) {
    if (res[i] === "x") {
      const j = left.indexOf(guess[i]);
      if (j !== -1) { res[i] = "y"; left[j] = null; }
    }
  }
  return res;
}

export function mountWordle(root, { back }) {
  root.innerHTML = `
    <div class="game wordle">
      <header><button class="back">← 選單</button><h2>WORDLE</h2><span></span></header>
      <div class="msg"></div>
      <div class="wboard"></div>
      <div class="kb"></div>
      <button class="again" hidden>再玩一局</button>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const board = $(".wboard"), kb = $(".kb"), msg = $(".msg"), again = $(".again");
  $(".back").addEventListener("click", back);

  let answer, row, col, over;
  const keyState = {};
  const tile = (r, c) => board.children[r].children[c];

  function buildBoard() {
    board.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "wrow";
      for (let c = 0; c < COLS; c++) { const t = document.createElement("div"); t.className = "tile"; rowEl.appendChild(t); }
      board.appendChild(rowEl);
    }
  }
  function buildKeyboard() {
    kb.innerHTML = "";
    for (const line of ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"]) {
      const r = document.createElement("div"); r.className = "krow";
      for (const ch of line) {
        const b = document.createElement("button");
        b.className = "key" + (ch === "+" || ch === "-" ? " wide" : "");
        b.dataset.k = ch === "+" ? "enter" : ch === "-" ? "back" : ch;
        b.textContent = ch === "+" ? "Enter" : ch === "-" ? "⌫" : ch;
        b.addEventListener("click", () => press(b.dataset.k));
        r.appendChild(b);
      }
      kb.appendChild(r);
    }
  }
  function reveal(r, guess, res) {
    for (let c = 0; c < COLS; c++) {
      const t = tile(r, c);
      t.style.animationDelay = `${c * 0.25}s`;
      t.classList.add(res[c]);
      const k = guess[c];
      if (!(k in keyState) || rank[res[c]] > rank[keyState[k]]) keyState[k] = res[c];
    }
    setTimeout(() => {
      for (const [k, v] of Object.entries(keyState)) {
        const el = kb.querySelector(`[data-k="${k}"]`);
        if (el) { el.classList.remove("g", "y", "x"); el.classList.add(v); }
      }
    }, COLS * 250 + 200);
  }
  function press(k) {
    if (over) return;
    if (k === "enter") return submit();
    if (k === "back") {
      if (col > 0) { col--; const t = tile(row, col); t.textContent = ""; t.classList.remove("filled"); }
      return;
    }
    if (/^[a-z]$/.test(k) && col < COLS) { const t = tile(row, col); t.textContent = k; t.classList.add("filled"); col++; }
  }
  function submit() {
    if (col < COLS) {
      const el = board.children[row];
      el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
      msg.textContent = "字母不夠，要 5 個";
      return;
    }
    const guess = Array.from({ length: COLS }, (_, c) => tile(row, c).textContent).join("");
    reveal(row, guess, score(guess, answer));
    msg.textContent = "";
    if (guess === answer) {
      over = true;
      setTimeout(() => { msg.textContent = `🎉 第 ${row + 1} 次猜中了！`; again.hidden = false; }, COLS * 250 + 300);
      return;
    }
    row++; col = 0;
    if (row >= ROWS) {
      over = true;
      setTimeout(() => { msg.textContent = `😢 答案是 ${answer.toUpperCase()}`; again.hidden = false; }, COLS * 250 + 300);
    }
  }
  function newGame() {
    answer = WORDS[Math.floor(Math.random() * WORDS.length)];
    row = 0; col = 0; over = false;
    for (const k of Object.keys(keyState)) delete keyState[k];
    buildBoard(); buildKeyboard();
    again.hidden = true;
    msg.textContent = "猜一個 5 個字母的英文單字";
  }
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") press("enter");
    else if (e.key === "Backspace") press("back");
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
  };
  document.addEventListener("keydown", onKey);
  again.addEventListener("click", newGame);
  newGame();
  return () => document.removeEventListener("keydown", onKey);
}
