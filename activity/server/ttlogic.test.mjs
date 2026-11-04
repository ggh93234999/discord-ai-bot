import { WebSocket } from "ws";
const room = "ttlogic" + Date.now();
const mk = (name) => new Promise((ok) => { const ws = new WebSocket("ws://127.0.0.1:3101/ws"); ws.msgs = []; ws.on("message", (d) => ws.msgs.push(JSON.parse(d))); ws.on("open", () => { ws.send(JSON.stringify({ t: "ttjoin", room, name })); ok(ws); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);
const a = await mk("甲"), b = await mk("乙"); await wait(300);
a.send(JSON.stringify({ t: "ttstart" })); await wait(300);
a.send(JSON.stringify({ t: "ttclear", atk: 4, label: "tetris" })); await wait(200);
console.log("乙待接 =", last(b, "ttpend").pending);                       // [0,4]
b.send(JSON.stringify({ t: "ttclear", atk: 1 })); await wait(200);          // 乙攻擊 1 先抵銷自己的待接 → [0,3]
console.log("乙攻擊 1 後 =", last(a, "ttpend").pending);
b.send(JSON.stringify({ t: "ttlock", cleared: false })); await wait(200);   // 乙沒消行落地 → 收到 3 行垃圾
console.log("乙收到垃圾 =", last(b, "ttgarb"), "待接 =", last(a, "ttpend").pending);
a.send(JSON.stringify({ t: "ttlock", cleared: false })); await wait(150);
console.log("甲沒有待接，不該收到垃圾 =", last(a, "ttgarb"));
b.send(JSON.stringify({ t: "ttdead" })); await wait(200);
const s = last(a, "ttstate"); console.log("狀態", s.state, "贏家", s.winner, "勝場", s.wins);
a.send(JSON.stringify({ t: "ttagain" })); await wait(200);
console.log("再來一局後", last(a, "ttstate").state);
a.close(); b.close(); setTimeout(() => process.exit(0), 200);
