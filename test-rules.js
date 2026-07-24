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

// ============================================================
// 오델로(Othello / 리버시) 규칙 검증
// 좌표 표기: a-h(열) + 1-8(행, 위→아래). d3 = (row 2, col 3)
// ============================================================
const Othello = require('./public/othello.js');
const OB = Othello.BLACK, OW = Othello.WHITE, OE = Othello.EMPTY;

function movesKey(list) {
  return list.map(function (m) { return m.row + ',' + m.col; }).sort().join(' ');
}

// (o-a) 초기 흑 합법 착수 = d3,c4,f5,e6 정확히
(function () {
  const b = Othello.createBoard();
  const moves = Othello.legalMoves(b, OB);
  // d3=(2,3), c4=(3,2), f5=(4,5), e6=(5,4)
  const expected = movesKey([{ row: 2, col: 3 }, { row: 3, col: 2 }, { row: 4, col: 5 }, { row: 5, col: 4 }]);
  assert('(o-a) 오델로 초기 흑 합법수 d3,c4,f5,e6', movesKey(moves) === expected);
})();

// (o-b) 초기 백돌/흑돌 개수 = 2:2
(function () {
  const b = Othello.createBoard();
  const c = Othello.counts(b);
  assert('(o-b) 초기 2:2', c.black === 2 && c.white === 2);
})();

// (o-c) d3 착수 시 d4 뒤집힘
(function () {
  const b = Othello.createBoard();
  const res = Othello.applyMove(b, 2, 3, OB); // d3
  // d4 = (3,3)
  const flippedD4 = res && res.flipped.some(function (f) { return f[0] === 3 && f[1] === 3; });
  const onlyOne = res && res.flipped.length === 1;
  const placed = res && res.board[2][3] === OB && res.board[3][3] === OB;
  // 원본 보드는 불변
  const unchanged = b[3][3] === OW;
  assert('(o-c) d3 착수 -> d4 1개 뒤집힘, 원본 불변', flippedD4 && onlyOne && placed && unchanged);
})();

// (o-d) 합법이 아닌 착수는 null (뒤집을 돌 없음)
(function () {
  const b = Othello.createBoard();
  const bad = Othello.applyMove(b, 0, 0, OB); // a1 - 인접 상대돌 없음
  const occupied = Othello.applyMove(b, 3, 3, OB); // 이미 백돌 존재
  assert('(o-d) 비합법 착수 거부(null)', bad === null && occupied === null);
})();

// (o-e) 패스 상황: 한쪽만 둘 곳이 없는 경우
(function () {
  // 흑이 우측 하단 구석만 차지하고 백은 둘 곳이 없는 인위적 보드
  const b = [];
  for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push(OE); b.push(row); }
  // 흑으로 상단 채우고 백 하나 -> 백이 둘 곳 없게
  b[0][0] = OB; b[0][1] = OW; // 백은 뒤집을 라인이 없음
  const blackHas = Othello.hasAnyMove(b, OB); // (0,2)에 두면 (0,1) 뒤집힘
  const whiteHas = Othello.hasAnyMove(b, OW);
  assert('(o-e) 패스: 흑은 둘 수 있고 백은 없음', blackHas === true && whiteHas === false);
})();

// (o-f) 종료 + 승자 개수 판정
(function () {
  // 보드 전체를 흑으로 채우면 양측 착수 불가 -> 종료, 흑 승
  const b = [];
  for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push(OB); b.push(row); }
  b[0][0] = OW; b[0][1] = OW; // 백 2개
  const over = Othello.isGameOver(b);
  const w = Othello.winner(b);
  const c = Othello.counts(b);
  assert('(o-f) 만원 종료 & 흑 승(62:2)', over === true && w === OB && c.black === 62 && c.white === 2);
})();

// (o-g) 무승부 판정 (32:32)
(function () {
  const b = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) row.push(r < 4 ? OB : OW);
    b.push(row);
  }
  const w = Othello.winner(b);
  const c = Othello.counts(b);
  assert('(o-g) 32:32 무승부', w === 0 && c.black === 32 && c.white === 32);
})();

console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
