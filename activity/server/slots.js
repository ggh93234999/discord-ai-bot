// 老虎機（伺服器端）：用密碼學亂數決定結果，前端只負責演出。
// 圖案與倍率要和機器人的 economy.py（SLOT_TRIPLE / GRID_PAY）保持一致。
import { randomInt } from "node:crypto";

export const KINDS = {
  1: { rows: 1, cols: 3, syms: ["🍒", "🍋", "🔔", "🍇", "🍀", "💎"], pay: { "🍒": 5, "🍋": 8, "🔔": 12, "🍇": 15, "🍀": 25, "💎": 50 }, pair: 1 },
  3: { rows: 3, cols: 3, syms: ["🍒", "🍋", "🔔", "💎"], pay: { "🍒": 1.2, "🍋": 1.6, "🔔": 2, "💎": 2.8 } },
  4: { rows: 4, cols: 4, syms: ["🍒", "🍋", "💎"], pay: { "🍒": 2, "🍋": 2.5, "💎": 3.2 } },
};

function lines(n) {
  const L = [];
  for (let r = 0; r < n; r++) L.push(Array.from({ length: n }, (_, c) => [r, c]));
  for (let c = 0; c < n; c++) L.push(Array.from({ length: n }, (_, r) => [r, c]));
  L.push(Array.from({ length: n }, (_, i) => [i, i]), Array.from({ length: n }, (_, i) => [i, n - 1 - i]));
  return L;
}

export function spin(kind) {
  const k = KINDS[kind];
  const grid = Array.from({ length: k.rows }, () => Array.from({ length: k.cols }, () => k.syms[randomInt(k.syms.length)]));
  let mult = 0, wins = [], note = "";
  if (kind === 1) {
    const g = grid[0], uniq = new Set(g);
    if (uniq.size === 1) { mult = k.pay[g[0]]; wins.push({ sym: g[0], line: [[0, 0], [0, 1], [0, 2]], x: mult }); note = `三個 ${g[0]}！`; }
    else if (uniq.size === 2) { mult = k.pair; note = "兩個一樣，賭注退回"; }
  } else {
    for (const line of lines(k.rows)) {
      const a = grid[line[0][0]][line[0][1]];
      if (line.every(([r, c]) => grid[r][c] === a)) { mult += k.pay[a]; wins.push({ sym: a, line, x: k.pay[a] }); }
    }
  }
  return { grid, mult, wins, note };
}
