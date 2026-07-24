/* rules.js 동작 검증 스크립트 */
const Rules = require('./public/rules.js');
const { BLACK, WHITE, EMPTY } = Rules;

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name); }
}

function board() { return Rules.createBoard(); }
function put(b, r, c, color) { b[r][c] = color; }
function line(b, r, cStart, n, color, dr, dc) {
  for (let k = 0; k < n; k++) b[r + k * dr][cStart + k * dc] = color;
}

// (a) 5-in-row 승리 감지
(function () {
  const b = board();
  put(b, 7, 3, BLACK); put(b, 7, 4, BLACK); put(b, 7, 5, BLACK); put(b, 7, 6, BLACK);
  const win = Rules.checkWinAt(b, 7, 7, BLACK, 'renju') && (b[7][7] = BLACK, true);
  assert('(a) 흑 5목 승리 감지', win);
})();

// (b) 흑 장목(overline) 금수
(function () {
  const b = board();
  // 좌우로 5개, 가운데 착수시 6목 -> 장목 금수
  put(b, 7, 3, BLACK); put(b, 7, 4, BLACK); put(b, 7, 5, BLACK);
  put(b, 7, 7, BLACK); put(b, 7, 8, BLACK);
  const t = Rules.forbiddenType(b, 7, 6); // 놓으면 3,4,5,6,7,8 = 6목
  assert('(b) 흑 장목 금수', t === 'overline');
})();

// (c) 백 장목은 승리
(function () {
  const b = board();
  put(b, 7, 3, WHITE); put(b, 7, 4, WHITE); put(b, 7, 5, WHITE);
  put(b, 7, 7, WHITE); put(b, 7, 8, WHITE);
  b[7][6] = WHITE; // 6목
  const win = Rules.checkWinAt(b, 7, 6, WHITE, 'renju');
  const blackWouldWin = Rules.checkWinAt(b, 7, 6, BLACK, 'renju');
  assert('(c) 백 장목 승리', win === true && blackWouldWin === false);
})();

// (d) 3-3 금수
(function () {
  const b = board();
  // 가로 열린 3: (7,5),(7,6) + 착수(7,7)
  put(b, 7, 5, BLACK); put(b, 7, 6, BLACK);
  // 세로 열린 3: (5,7),(6,7) + 착수(7,7)
  put(b, 5, 7, BLACK); put(b, 6, 7, BLACK);
  const t = Rules.forbiddenType(b, 7, 7);
  assert('(d) 3-3 금수', t === 'three-three');
})();

// (e) 4-4 금수
(function () {
  const b = board();
  // 가로 4: (7,4),(7,5),(7,6) + 착수(7,7)
  put(b, 7, 4, BLACK); put(b, 7, 5, BLACK); put(b, 7, 6, BLACK);
  // 세로 4: (4,7),(5,7),(6,7) + 착수(7,7)
  put(b, 4, 7, BLACK); put(b, 5, 7, BLACK); put(b, 6, 7, BLACK);
  const t = Rules.forbiddenType(b, 7, 7);
  assert('(e) 4-4 금수', t === 'four-four');
})();

// (f) 5 우선 (금수보다 5목 우선)
(function () {
  const b = board();
  // 가로로 정확히 5를 만드는 착수인데 동시에 세로로 4-4/3-3 유발되게 구성
  // 가로: (7,3),(7,4),(7,5),(7,6) + 착수(7,7) = 5목
  put(b, 7, 3, BLACK); put(b, 7, 4, BLACK); put(b, 7, 5, BLACK); put(b, 7, 6, BLACK);
  // 세로 4 + 대각 4 -> 4-4 이지만 5목이 우선
  put(b, 4, 7, BLACK); put(b, 5, 7, BLACK); put(b, 6, 7, BLACK);
  put(b, 4, 4, BLACK); put(b, 5, 5, BLACK); put(b, 6, 6, BLACK);
  const t = Rules.forbiddenType(b, 7, 7);
  b[7][7] = BLACK;
  const win = Rules.checkWinAt(b, 7, 7, BLACK, 'renju');
  assert('(f) 5목 우선(금수 아님)', t === null && win === true);
})();

// 추가: 자유룰에서는 흑도 장목 승리, 금수 없음
(function () {
  const b = board();
  put(b, 7, 5, BLACK); put(b, 7, 6, BLACK);
  put(b, 5, 7, BLACK); put(b, 6, 7, BLACK);
  const pts = Rules.forbiddenPoints(b, 'free');
  assert('(추가) 자유룰 금수 없음', pts.length === 0);
})();

console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
