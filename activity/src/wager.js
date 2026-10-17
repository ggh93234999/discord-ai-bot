// 棋類對賭面板（五子棋、四連棋共用）。只有要賭的人才需要 Discord 授權，不賭照樣隨便玩。
const AMOUNTS = [10, 50, 100, 500];
const ERR = {
  need_login: "要先登入才能對賭",
  not_player: "只有對戰的雙方能對賭",
  bad_amount: "賭注不合法",
  already: "已經有賭注了",
  not_fresh: "棋局已經開始，要等下一局才能對賭",
  need_opponent: "要兩位玩家都到了才能提出",
  same_user: "不能跟自己對賭",
  no_offer: "這筆賭注已經不存在",
  opp_broke: "對方的代幣不夠",
  you_broke: "你的代幣不夠",
  bot_down: "機器人暫時連不上，稍後再試",
  no_guild: "找不到伺服器",
  changed: "座位有變動，賭注取消（錢已退回）",
};

// 登入並取得憑證；憑證存在 env.session，各遊戲共用
export async function ensureSession(env, say) {
  if (env.session) return env.session;
  if (!env.inDiscord || !env.sdk) throw new Error("對賭要在 Discord 裡開啟 Activity 才能用");
  say("請在 Discord 跳出的視窗按「授權」…");
  await env.sdk.ready();
  const { code } = await env.sdk.commands.authorize({
    client_id: env.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"],
  });
  say("確認身分中…");
  const r = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("你不是這個伺服器的成員，不能對賭");
  if (!r.ok || !j.token) throw new Error("登入失敗（" + (j.error || r.status) + "）");
  env.session = { token: j.token, name: j.name };
  return env.session;
}

// getWs()：目前的 WebSocket；getSt()：最新的房間狀態
export function createWager(root, { env, getWs, getSt }) {
  const el = root.querySelector(".wager");
  let note = "", authed = false, loggingIn = false;
  const send = (o) => { const ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const say = (t) => { note = t; update(); };

  async function login(then) {
    if (loggingIn) return;
    loggingIn = true;
    try {
      await ensureSession(env, say);
      note = "登入中…";
      pendingThen = then || null;
      send({ t: "bauth", token: env.session.token });
    } catch (e) { note = e.message || "授權沒有完成"; }
    loggingIn = false; update();
  }
  let pendingThen = null;

  function onOpen() {                       // 每次（重新）連線後
    authed = false;
    if (env.session) send({ t: "bauth", token: env.session.token });
  }
  function onMsg(m) {
    if (m.t === "bauthed") {
      if (m.ok) { authed = true; note = ""; if (pendingThen) { const f = pendingThen; pendingThen = null; f(); } }
      else { authed = false; env.session = null; pendingThen = null; note = "登入已失效，請重新登入"; }
      update();
    } else if (m.t === "werr") { note = ERR[m.error] || "發生錯誤：" + m.error; update(); }
  }

  function btn(label, fn, cls = "") {
    const b = document.createElement("button"); b.textContent = label; b.className = cls; b.addEventListener("click", fn); return b;
  }
  function line(text) { const d = document.createElement("div"); d.className = "wline"; d.textContent = text; return d; }

  function update() {
    const st = getSt();
    el.innerHTML = "";
    if (!st) return;
    el.className = "wager" + (st.wager && !st.wager.settled ? " live" : "");
    const player = st.you !== "s";
    if (st.wresult) {
      const r = st.wresult;
      el.append(line(r.winner === "d" ? `🤝 平手，雙方各退回 ${r.amount} 代幣` : `🏆 ${r.name} 贏得 ${r.amount * 2} 代幣（對方輸了 ${r.amount}）`));
    } else if (st.wager) {
      el.append(line(`💰 對賭中：${st.wager.names.b} vs ${st.wager.names.w}，每人押 ${st.wager.amount}，贏家拿走 ${st.wager.amount * 2}`));
      if (player) el.append(line("中途斷線超過 30 秒、或認輸，就算輸掉賭注"));
    } else if (st.busy) {
      el.append(line("💰 正在扣押金…"));
    } else if (st.offer) {
      const o = st.offer;
      if (st.you === o.by) {
        el.append(line(`💰 你提出 ${o.amount} 代幣對賭，等對手接受…`), btn("取消", () => send({ t: "wcancel" })));
      } else if (player) {
        el.append(line(`💰 ${o.name} 想跟你賭 ${o.amount} 代幣（輸贏各 ${o.amount}）`));
        const acc = () => send({ t: "waccept" });
        el.append(btn("接受對賭", () => (authed ? acc() : login(acc)), "yes"), btn("拒絕", () => send({ t: "wcancel" })));
      } else el.append(line(`💰 ${o.name} 提出 ${o.amount} 代幣對賭`));
    } else if (player && st.moves === 0 && !st.winner && st.players.b && st.players.w) {
      if (!env.inDiscord || !env.sdk) { /* 在一般瀏覽器開，不顯示對賭 */ }
      else if (!authed) {
        el.append(btn("💰 想對賭？登入", () => login()), line("不賭的話直接下棋就好，不用登入"));
      } else {
        el.append(line("💰 對賭：選金額，對手同意後開始"));
        for (const n of AMOUNTS) el.append(btn(String(n), () => send({ t: "woffer", amount: n })));
      }
    }
    if (note) el.append(line(note));
  }
  return { update, onOpen, onMsg };
}
