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

// ============================================================
// 사목(Connect Four) 규칙 검증
// 보드 6행 x 7열. 착수는 "열" 선택 -> 그 열의 가장 아래 빈 칸에 떨어진다.
// 좌표 표기: A-G(열) + 1-6(행, 위→아래). D6 = (row 5, col 3) = 맨 아랫줄
// ============================================================
const C4 = require('./public/connect4.js');
const CB = C4.BLACK, CW = C4.WHITE, CE = C4.EMPTY;

function c4board() { return C4.createBoard(); }
// 열 순서대로 번갈아 떨어뜨린다. cols = [열...], 시작색 지정
function c4play(board, cols, startColor) {
  let color = startColor || CB;
  let last = null;
  cols.forEach(function (col) {
    const res = C4.applyMove(board, col, color);
    if (!res) throw new Error('사목 테스트: 둘 수 없는 열 ' + col);
    board = res.board;
    last = { row: res.row, col: col, color: color };
    color = color === CB ? CW : CB;
  });
  return { board: board, last: last };
}

// (c-a) 보드 크기 6x7, 초기 전부 빈칸
(function () {
  const b = c4board();
  let empty = true;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) if (b[r][c] !== CE) empty = false;
  assert('(c-a) 사목 보드 6행 7열 & 초기 공백',
    C4.ROWS === 6 && C4.COLS === 7 && b.length === 6 && b[0].length === 7 && empty);
})();

// (c-b) 첫 착수는 맨 아랫줄(row 5)에 떨어진다
(function () {
  const b = c4board();
  const row = C4.dropRow(b, 3);
  const res = C4.applyMove(b, 3, CB);
  assert('(c-b) 첫 착수는 바닥(row 5)에 착지 + 원본 불변',
    row === 5 && res && res.row === 5 && res.board[5][3] === CB && b[5][3] === CE);
})();

// (c-c) 같은 열에 쌓인다 (아래에서 위로)
(function () {
  let b = c4board();
  const r = c4play(b, [3, 3, 3], CB);
  b = r.board;
  assert('(c-c) 같은 열 쌓기 5,4,3',
    b[5][3] === CB && b[4][3] === CW && b[3][3] === CB && r.last.row === 3);
})();

// (c-d) 가득 찬 열은 무효 (dropRow -1, applyMove null)
(function () {
  let b = c4board();
  b = c4play(b, [0, 0, 0, 0, 0, 0], CB).board;   // 6개 = 열 가득
  assert('(c-d) 가득 찬 열 무효',
    C4.dropRow(b, 0) === -1 && C4.applyMove(b, 0, CB) === null && C4.dropRow(b, 1) === 5);
})();

// (c-e) 가로 4목 승리 + 승리 칸 4개 반환
(function () {
  let b = c4board();
  // 흑 0,1,2,3 / 백은 다른 열 위쪽에 쌓이지 않도록 6번 열 사용
  b = c4play(b, [0, 6, 1, 6, 2, 6, 3], CB).board;
  const cells = C4.checkWinAt(b, 5, 3, CB);
  const key = cells && cells.map(function (x) { return x.row + ',' + x.col; }).sort().join(' ');
  assert('(c-e) 가로 4목 승리 + 승리칸',
    !!cells && cells.length === 4 && key === '5,0 5,1 5,2 5,3');
})();

// (c-f) 세로 4목 승리
(function () {
  let b = c4board();
  b = c4play(b, [2, 3, 2, 3, 2, 3, 2], CB).board;
  const cells = C4.checkWinAt(b, 2, 2, CB);
  const key = cells && cells.map(function (x) { return x.row + ',' + x.col; }).sort().join(' ');
  assert('(c-f) 세로 4목 승리 + 승리칸',
    !!cells && cells.length === 4 && key === '2,2 3,2 4,2 5,2');
})();

// (c-g) 대각 ↗ (오른쪽 위로) 4목 승리
(function () {
  let b = c4board();
  // 흑이 (5,0),(4,1),(3,2),(2,3) 을 만들도록 구성
  // 열0: 흑            -> (5,0)
  // 열1: 백,흑          -> (4,1)
  // 열2: 백,백,흑       -> (3,2)
  // 열3: 백,흑,백,흑    -> (2,3)
  const b0 = c4board();
  const put = function (bd, col, color) { const r = C4.applyMove(bd, col, color); return r.board; };
  let x = b0;
  x = put(x, 0, CB);
  x = put(x, 1, CW); x = put(x, 1, CB);
  x = put(x, 2, CW); x = put(x, 2, CW); x = put(x, 2, CB);
  x = put(x, 3, CW); x = put(x, 3, CB); x = put(x, 3, CW); x = put(x, 3, CB);
  const cells = C4.checkWinAt(x, 2, 3, CB);
  const key = cells && cells.map(function (v) { return v.row + ',' + v.col; }).sort().join(' ');
  assert('(c-g) 대각 ↗ 4목 승리', !!cells && cells.length === 4 && key === '2,3 3,2 4,1 5,0');
})();

// (c-h) 대각 ↘ (오른쪽 아래로) 4목 승리
(function () {
  const put = function (bd, col, color) { const r = C4.applyMove(bd, col, color); return r.board; };
  let x = c4board();
  // 흑이 (2,0),(3,1),(4,2),(5,3)
  x = put(x, 0, CW); x = put(x, 0, CW); x = put(x, 0, CW); x = put(x, 0, CB);
  x = put(x, 1, CW); x = put(x, 1, CW); x = put(x, 1, CB);
  x = put(x, 2, CW); x = put(x, 2, CB);
  x = put(x, 3, CB);
  const cells = C4.checkWinAt(x, 2, 0, CB);
  const key = cells && cells.map(function (v) { return v.row + ',' + v.col; }).sort().join(' ');
  assert('(c-h) 대각 ↘ 4목 승리', !!cells && cells.length === 4 && key === '2,0 3,1 4,2 5,3');
})();

// (c-i) 4목이 아니면 null
(function () {
  let b = c4board();
  b = c4play(b, [0, 6, 1, 6, 2, 6], CB).board;   // 흑 3개 (5,0)(5,1)(5,2)
  assert('(c-i) 3목은 승리 아님', C4.checkWinAt(b, 5, 2, CB) === null);
})();

// (c-j) 5목 이상도 승리 (연속 4 이상)
(function () {
  const b = c4board();
  for (let c = 0; c < 5; c++) b[5][c] = CB;
  const cells = C4.checkWinAt(b, 5, 2, CB);
  assert('(c-j) 5연속도 승리(4 이상)', !!cells && cells.length === 5);
})();

// (c-k) 만원(42칸) 무승부 판정
(function () {
  const b = c4board();
  assert('(c-k0) 빈 보드는 isFull=false', C4.isFull(b) === false);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) b[r][c] = (r + c) % 2 ? CB : CW;
  assert('(c-k) 42칸 만원 -> isFull', C4.isFull(b) === true && C4.legalColumns(b).length === 0);
})();

// (c-l) legalColumns: 가득 찬 열 제외 + 착지 행 정보
(function () {
  let b = c4board();
  b = c4play(b, [0, 0, 0, 0, 0, 0], CB).board;
  const ls = C4.legalColumns(b);
  const cols = ls.map(function (x) { return x.col; }).join(',');
  const first = ls[0];
  assert('(c-l) 합법 열 목록(가득 찬 0열 제외) + 착지행',
    cols === '1,2,3,4,5,6' && first.col === 1 && first.row === 5);
})();

console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
