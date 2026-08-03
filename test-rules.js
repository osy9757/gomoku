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

// ============================================================
// 카드 공용 모듈(cards.js) — 덱 / 표기 / 족보 판정
// 카드 표기: {r:2..14, s:0..3}  (14=A, s: 0♠ 1♥ 2♦ 3♣)
// ============================================================
const Cards = require('./public/cards.js');
const SP = 0, HE = 1, DI = 2, CL = 3;
function cd(r, s) { return { r: r, s: s }; }
// '족보(카테고리) + 타이브레이크' 를 한 줄 문자열로 (비교 실패 시 디버깅용)
function handKey(h) { return h.cat + '|' + h.tiebreak.join(','); }

// (k-a) 덱: 52장, 중복 없음, 무늬별 13장, 랭크 2..14
(function () {
  const d = Cards.makeDeck();
  const seen = {};
  let dup = false, rangeOk = true;
  const bySuit = [0, 0, 0, 0];
  d.forEach(function (c) {
    const k = c.r + ':' + c.s;
    if (seen[k]) dup = true;
    seen[k] = true;
    bySuit[c.s]++;
    if (c.r < 2 || c.r > 14) rangeOk = false;
  });
  assert('(k-a) 덱 52장 / 중복 없음 / 무늬별 13장 / 랭크 2..14',
    d.length === 52 && !dup && rangeOk &&
    bySuit.every(function (n) { return n === 13; }));
})();

// (k-b) shuffle: 주입 rng 로 결정적, 원본 불변, 구성은 동일
(function () {
  const d = Cards.makeDeck();
  let seed = 42;
  const rng = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const a = Cards.shuffle(d, rng);
  seed = 42;
  const b = Cards.shuffle(d, rng);
  const same = a.every(function (c, i) { return c.r === b[i].r && c.s === b[i].s; });
  const untouched = d[0].r === 2 && d[0].s === 0 && d.length === 52;
  const key = function (x) { return x.map(function (c) { return c.r + ':' + c.s; }).sort().join(' '); };
  assert('(k-b) shuffle 결정적 + 원본 불변 + 구성 동일',
    same && untouched && key(a) === key(d) && a.length === 52);
})();

// (k-c) 카드 표기 / 색
(function () {
  assert('(k-c) cardText ♠A ♥10 ♦J ♣2 + 빨강 판정',
    Cards.cardText(cd(14, SP)) === '♠A' &&
    Cards.cardText(cd(10, HE)) === '♥10' &&
    Cards.cardText(cd(11, DI)) === '♦J' &&
    Cards.cardText(cd(2, CL)) === '♣2' &&
    Cards.isRed(cd(3, HE)) === true && Cards.isRed(cd(3, DI)) === true &&
    Cards.isRed(cd(3, SP)) === false && Cards.isRed(cd(3, CL)) === false);
})();

// (k-d) 스트레이트: A-2-3-4-5 는 최약(하이=5), 10-J-Q-K-A 는 최강(하이=14)
(function () {
  const low = Cards.evalBest5([cd(14, SP), cd(2, HE), cd(3, DI), cd(4, CL), cd(5, SP)]);
  const high = Cards.evalBest5([cd(10, SP), cd(11, HE), cd(12, DI), cd(13, CL), cd(14, SP)]);
  assert('(k-d) 스트레이트 A-low(하이 5) / A-high(하이 14)',
    low.cat === 4 && low.tiebreak[0] === 5 &&
    high.cat === 4 && high.tiebreak[0] === 14 &&
    Cards.compareHands(high, low) === 1 && Cards.compareHands(low, high) === -1);
})();

// (k-e) 플러시 > 스트레이트
(function () {
  const flush = Cards.evalBest5([cd(2, HE), cd(5, HE), cd(9, HE), cd(11, HE), cd(13, HE)]);
  const st = Cards.evalBest5([cd(10, SP), cd(11, HE), cd(12, DI), cd(13, CL), cd(14, SP)]);
  assert('(k-e) 플러시(5) > 스트레이트(4)',
    flush.cat === 5 && st.cat === 4 && Cards.compareHands(flush, st) === 1);
})();

// (k-f) 풀하우스끼리: 트리플 우선, 트리플 같으면 페어로 비교
(function () {
  const a = Cards.evalBest5([cd(9, SP), cd(9, HE), cd(9, DI), cd(2, CL), cd(2, SP)]);   // 999 22
  const b = Cards.evalBest5([cd(8, SP), cd(8, HE), cd(8, DI), cd(14, CL), cd(14, SP)]); // 888 AA
  const c = Cards.evalBest5([cd(9, SP), cd(9, HE), cd(9, CL), cd(5, CL), cd(5, SP)]);   // 999 55
  assert('(k-f) 풀하우스 타이브레이크(트리플 우선 → 페어)',
    a.cat === 6 && b.cat === 6 && c.cat === 6 &&
    Cards.compareHands(a, b) === 1 &&      // 999 > 888
    Cards.compareHands(c, a) === 1 &&      // 같은 999 → 55 > 22
    handKey(a) === '6|9,2');
})();

// (k-g) 투페어: 높은 페어 → 낮은 페어 → 키커
(function () {
  const a = Cards.evalBest5([cd(13, SP), cd(13, HE), cd(4, DI), cd(4, CL), cd(9, SP)]);  // KK 44 9
  const b = Cards.evalBest5([cd(13, DI), cd(13, CL), cd(4, SP), cd(4, HE), cd(7, SP)]);  // KK 44 7
  const c = Cards.evalBest5([cd(13, DI), cd(13, CL), cd(3, SP), cd(3, HE), cd(14, SP)]); // KK 33 A
  assert('(k-g) 투페어 키커 비교',
    a.cat === 2 && handKey(a) === '2|13,4,9' &&
    Cards.compareHands(a, b) === 1 &&       // 키커 9 > 7
    Cards.compareHands(a, c) === 1 &&       // 낮은 페어 4 > 3 (키커 A 무시)
    Cards.compareHands(b, a) === -1);
})();

// (k-h) 포카드 > 풀하우스, 포카드끼리는 랭크 → 키커
(function () {
  const q = Cards.evalBest5([cd(7, SP), cd(7, HE), cd(7, DI), cd(7, CL), cd(3, SP)]);
  const q2 = Cards.evalBest5([cd(7, SP), cd(7, HE), cd(7, DI), cd(7, CL), cd(14, SP)]);
  const fh = Cards.evalBest5([cd(14, SP), cd(14, HE), cd(14, DI), cd(13, CL), cd(13, SP)]);
  assert('(k-h) 포카드(7) > 풀하우스(6), 키커 비교',
    q.cat === 7 && fh.cat === 6 && Cards.compareHands(q, fh) === 1 &&
    handKey(q2) === '7|7,14' && Cards.compareHands(q2, q) === 1);
})();

// (k-i) 스트레이트 플러시 (A-low 포함) 가 최강
(function () {
  const sf = Cards.evalBest5([cd(5, HE), cd(6, HE), cd(7, HE), cd(8, HE), cd(9, HE)]);
  const steel = Cards.evalBest5([cd(14, DI), cd(2, DI), cd(3, DI), cd(4, DI), cd(5, DI)]);
  const quad = Cards.evalBest5([cd(14, SP), cd(14, HE), cd(14, DI), cd(14, CL), cd(2, SP)]);
  assert('(k-i) 스트레이트플러시(8) > 포카드(7), A-low SF 하이=5',
    sf.cat === 8 && sf.tiebreak[0] === 9 &&
    steel.cat === 8 && steel.tiebreak[0] === 5 &&
    Cards.compareHands(sf, quad) === 1 && Cards.compareHands(steel, sf) === -1);
})();

// (k-j) 완전히 같은 랭크 구성 → 0 (무늬 타이브레이크 없음 = 분배)
(function () {
  const a = Cards.evalBest5([cd(14, SP), cd(13, SP), cd(9, SP), cd(5, HE), cd(2, DI)]);
  const b = Cards.evalBest5([cd(14, HE), cd(13, DI), cd(9, CL), cd(5, SP), cd(2, CL)]);
  assert('(k-j) 동일 랭크 프로필 → 무승부(0)',
    a.cat === 0 && Cards.compareHands(a, b) === 0 && Cards.compareHands(b, a) === 0);
})();

// (k-k) 6~7장에서 최선의 5장 선택
(function () {
  // 7장: ♠A ♠K ♠Q ♠J ♠10 + ♥A ♦A  -> 로열(=A high 스트레이트 플러시)
  const seven = Cards.evalBest5([cd(14, SP), cd(13, SP), cd(12, SP), cd(11, SP), cd(10, SP), cd(14, HE), cd(14, DI)]);
  // 6장: 999 KK 2 -> 풀하우스 999 KK
  const six = Cards.evalBest5([cd(9, SP), cd(9, HE), cd(9, DI), cd(13, CL), cd(13, SP), cd(2, HE)]);
  assert('(k-k) 6~7장 중 최선의 5장',
    seven.cat === 8 && seven.tiebreak[0] === 14 &&
    six.cat === 6 && handKey(six) === '6|9,13');
})();

// (k-l) 족보 한글 이름
(function () {
  assert('(k-l) 족보 한글 이름',
    Cards.catName(0) === '하이카드' && Cards.catName(1) === '원페어' &&
    Cards.catName(2) === '투페어' && Cards.catName(3) === '트리플' &&
    Cards.catName(4) === '스트레이트' && Cards.catName(5) === '플러시' &&
    Cards.catName(6) === '풀하우스' && Cards.catName(7) === '포카드' &&
    Cards.catName(8) === '스트레이트플러시');
})();

// ============================================================
// 맞포커(2인 세븐포커) 엔진 검증 — public/sevenpoker.js
//   딜 순서: 비딜러부터 한 장씩 번갈아 (4장씩) → 5/6/7번째도 비딜러 먼저
//   4장 중 1장 매장(버림) → 남은 3장 중 1장 오픈 → 베팅 4라운드
// ============================================================
const Poker = require('./public/sevenpoker.js');

// 시나리오용 고정 덱 (dealer=1 → 비딜러 P0 이 먼저 받는다)
//  P0: ♠A ♥A ♦A ♣2(버림) + ♠K ♥K ♦3  -> 풀하우스 A/K
//  P1: ♠Q ♥Q ♦J ♣3(버림) + ♠J ♥9 ♦8  -> 투페어 Q/J (키커 9)
const DECK = [
  cd(14, SP), cd(12, SP),   // 1번째: P0, P1
  cd(14, HE), cd(12, HE),   // 2번째
  cd(14, DI), cd(11, DI),   // 3번째
  cd(2, CL), cd(3, CL),     // 4번째 (둘 다 버릴 카드)
  cd(13, SP), cd(11, SP),   // 5번째 (오픈)
  cd(13, HE), cd(9, HE),    // 6번째 (오픈)
  cd(3, DI), cd(8, DI)      // 7번째 (히든)
];

function step(st, p, action) {
  const r = Poker.apply(st, p, action);
  if (r.error) throw new Error('불법 액션(' + JSON.stringify(action) + '): ' + r.error);
  return r.state;
}
function opt(st, p, type) {
  return Poker.actionOptions(st, p).find(function (o) { return o.type === type; });
}

// (p-a) 딜/앤티/매장/오픈 + viewFor 마스킹
(function () {
  let s = Poker.createHand({ deckOrder: DECK, chips: [1000, 1000], dealer: 1 });
  assert('(p-a1) 앤티 10씩 → 팟 20, 칩 990',
    s.pot === 20 && s.chips[0] === 990 && s.chips[1] === 990 && s.phase === 'discard');
  assert('(p-a2) 4장씩 배분 (비딜러 P0 먼저)',
    s.hands[0].cards.length === 4 && s.hands[1].cards.length === 4 &&
    s.hands[0].cards[0].r === 14 && s.hands[0].cards[0].s === SP &&
    s.hands[1].cards[0].r === 12 && s.hands[1].cards[0].s === SP);

  s = step(s, 0, { type: 'discard', index: 3 });
  assert('(p-a3) 한쪽만 버려도 아직 discard 단계',
    s.phase === 'discard' && s.hands[0].cards.length === 3 &&
    s.hands[0].buried.r === 2 && s.hands[1].cards.length === 4);
  // 같은 사람이 두 번 버릴 수 없다
  assert('(p-a4) 중복 매장 거부', !!Poker.apply(s, 0, { type: 'discard', index: 0 }).error);
  s = step(s, 1, { type: 'discard', index: 3 });
  assert('(p-a5) 양쪽 매장 완료 → open 단계',
    s.phase === 'open' && s.hands[1].buried.r === 3 && s.hands[1].cards.length === 3);

  // 오픈 전에는 베팅 불가
  assert('(p-a6) 오픈 전 베팅 거부', !!Poker.apply(s, 0, { type: 'check' }).error);

  s = step(s, 0, { type: 'open', index: 0 });   // ♠A
  s = step(s, 1, { type: 'open', index: 2 });   // ♦J
  assert('(p-a7) 오픈 완료 → 베팅 1라운드, 오픈 최고 카드(♠A) 보유자 선행',
    s.phase === 'bet' && s.round === 1 && s.toAct === 0);

  // viewFor: 상대 히든은 null, 오픈은 보인다
  const v0 = Poker.viewFor(s, 0);
  const v1 = Poker.viewFor(s, 1);
  assert('(p-a8) viewFor: 상대 히든 카드는 null',
    v0.hands[1].cards[0] === null && v0.hands[1].cards[1] === null &&
    v0.hands[1].cards[2] && v0.hands[1].cards[2].r === 11 && v0.hands[1].cards[2].open === true);
  assert('(p-a9) viewFor: 내 카드는 전부 보인다',
    v0.hands[0].cards.every(function (c) { return c && c.r; }) &&
    v0.hands[0].buried.r === 2);
  assert('(p-a10) viewFor: 상대의 매장 카드는 절대 보이지 않는다 + 덱 비공개',
    v0.hands[1].buried === null && v1.hands[0].buried === null &&
    v0.deck === undefined && v1.deck === undefined);
  assert('(p-a11) viewFor 는 원본을 건드리지 않는다(깊은 복사)',
    s.hands[1].cards[0] !== null && s.hands[1].cards[0].r === 12);
})();

// (p-b) 베팅 산식: 삥 / 하프 / 따당 / 콜, 팟 누적
(function () {
  let s = Poker.createHand({ deckOrder: DECK, chips: [1000, 1000], dealer: 1 });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 1, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'open', index: 0 });
  s = step(s, 1, { type: 'open', index: 2 });

  // 차례가 아닌 쪽의 액션은 거부
  assert('(p-b0) 차례 아닌 플레이어 액션 거부', !!Poker.apply(s, 1, { type: 'check' }).error);

  // 팟 20 상태에서 삥 = 앤티(10)
  assert('(p-b1) 삥 금액 = 10', opt(s, 0, 'bbing').amount === 10);
  s = step(s, 0, { type: 'bbing' });
  assert('(p-b2) 삥 후 팟 30 / 콜 금액 10', s.pot === 30 && opt(s, 1, 'call').amount === 10);

  // 하프 = 콜(10) + floor(팟30/2)=15 → 25
  assert('(p-b3) 하프 = 콜 + 팟의 절반 (10+15=25)', opt(s, 1, 'half').amount === 25);
  s = step(s, 1, { type: 'half' });
  assert('(p-b4) 하프 후 팟 55', s.pot === 55 && s.chips[1] === 965);

  // 따당 = 콜(15) + 직전 레이즈(15)의 2배(30) = 45
  assert('(p-b5) 따당 = 콜 + 직전 레이즈 x2 (15+30=45)', opt(s, 0, 'ttadang').amount === 45);
  s = step(s, 0, { type: 'ttadang' });
  assert('(p-b6) 따당 후 팟 100', s.pot === 100 && s.chips[0] === 935);

  // 콜로 라운드 종료 → 5번째 카드(오픈) 배분 + 2라운드
  s = step(s, 1, { type: 'call' });
  assert('(p-b7) 콜로 1라운드 종료 → 팟 130 / 칩 935',
    s.pot === 130 && s.chips[0] === 935 && s.chips[1] === 935);
  assert('(p-b8) 5번째 카드 오픈 배분 → 2라운드',
    s.round === 2 && s.hands[0].cards.length === 4 && s.hands[1].cards.length === 4 &&
    s.hands[0].cards[3].open === true && s.hands[0].cards[3].r === 13 &&
    s.hands[1].cards[3].r === 11 && s.hands[1].cards[3].open === true);
  assert('(p-b9) 2라운드 선행도 오픈 최고(♠A) 보유자', s.toAct === 0);

  // 체크-체크로 라운드 종료 (팟 불변) → 6번째 카드
  assert('(p-b10) 미결 베팅 없으면 체크 가능 / 콜 불가',
    opt(s, 0, 'check').enabled === true && opt(s, 0, 'call').enabled === false);
  s = step(s, 0, { type: 'check' });
  s = step(s, 1, { type: 'check' });
  assert('(p-b11) 체크-체크 → 팟 유지 + 3라운드 + 6번째 오픈',
    s.pot === 130 && s.round === 3 && s.hands[0].cards.length === 5 &&
    s.hands[0].cards[4].open === true && s.hands[1].cards[4].r === 9);

  // 하프(선베팅) = floor(130/2) = 65
  assert('(p-b12) 미결 베팅 없을 때 하프 = 팟의 절반(65)', opt(s, 0, 'half').amount === 65);
  s = step(s, 0, { type: 'half' });
  s = step(s, 1, { type: 'call' });
  assert('(p-b13) 3라운드 종료 → 팟 260 / 칩 870',
    s.pot === 260 && s.chips[0] === 870 && s.chips[1] === 870);
  assert('(p-b14) 7번째 카드는 히든 배분 → 4라운드',
    s.round === 4 && s.hands[0].cards.length === 6 &&
    s.hands[0].cards[5].open === false && s.hands[1].cards[5].open === false);
  // 상대 시점에서 7번째 카드는 null
  assert('(p-b15) 히든 7번째 카드는 상대에게 null',
    Poker.viewFor(s, 1).hands[0].cards[5] === null);

  // (p-c) 레이즈 4회 상한
  s = step(s, 0, { type: 'bbing' });      // 1
  s = step(s, 1, { type: 'ttadang' });    // 2  (콜10 + 20 = 30)
  s = step(s, 0, { type: 'ttadang' });    // 3  (콜20 + 40 = 60)
  s = step(s, 1, { type: 'ttadang' });    // 4  (콜40 + 80 = 120)
  assert('(p-c1) 레이즈 4회 후 추가 레이즈 불가',
    s.raises === 4 &&
    opt(s, 0, 'half').enabled === false && opt(s, 0, 'ttadang').enabled === false &&
    opt(s, 0, 'bbing').enabled === false && opt(s, 0, 'call').enabled === true);
  assert('(p-c2) 상한 초과 레이즈는 에러', !!Poker.apply(s, 0, { type: 'half' }).error);
  assert('(p-c3) 4라운드 콜 금액 80', opt(s, 0, 'call').amount === 80);

  // (p-d) 쇼다운: 풀하우스 > 투페어
  s = step(s, 0, { type: 'call' });
  assert('(p-d1) 핸드 종료 + 쇼다운', Poker.isHandOver(s) === true && s.phase === 'showdown');
  assert('(p-d2) 팟 560 을 P0 이 획득',
    s.result.winner === 0 && s.result.split === false && s.result.amount === 560);
  assert('(p-d3) 족보: P0 풀하우스 / P1 투페어',
    s.result.hands[0].cat === 6 && s.result.hands[1].cat === 2 &&
    Cards.catName(s.result.hands[0].cat) === '풀하우스');
  assert('(p-d4) 칩 정산 (1280 : 720, 총합 보존)',
    s.chips[0] === 1280 && s.chips[1] === 720 && s.chips[0] + s.chips[1] === 2000);
  assert('(p-d5) 각자 7장 받아 6장 보유 (1장 매장) + 덱 14장 소모',
    s.hands[0].cards.length === 6 && s.hands[1].cards.length === 6 &&
    s.hands[0].buried !== null && s.dealtCount === 14);
  assert('(p-d6) 쇼다운 후에는 상대 히든도 공개(매장 카드는 계속 비공개)',
    Poker.viewFor(s, 1).hands[0].cards.every(function (c) { return c && c.r; }) &&
    Poker.viewFor(s, 1).hands[0].buried === null);
  assert('(p-d7) 파산 없음 → 매치 계속', s.matchOver === false);

  // (p-e) 다음 판: 딜러 교대 + 칩 승계 + 재앤티
  const n = Poker.nextHand(s, DECK);
  assert('(p-e1) 딜러 교대(1 → 0)', n.dealer === 0 && s.dealer === 1);
  assert('(p-e2) 칩 승계 + 앤티 10씩',
    n.chips[0] === 1270 && n.chips[1] === 710 && n.pot === 20 && n.phase === 'discard');
  assert('(p-e3) 딜러가 바뀌면 배분 순서도 바뀐다(비딜러 P1 이 먼저)',
    n.hands[1].cards[0].r === 14 && n.hands[0].cards[0].r === 12);
  assert('(p-e4) 판 번호 증가', n.handNo === s.handNo + 1);
  assert('(p-e5) 종료 전에는 nextHand 불가', !!Poker.nextHand(n, DECK).error);
})();

// (p-f) 다이(폴드): 상대가 팟을 가져가고 패는 공개되지 않는다
(function () {
  let s = Poker.createHand({ deckOrder: DECK, chips: [1000, 1000], dealer: 1 });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 1, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'open', index: 0 });
  s = step(s, 1, { type: 'open', index: 2 });
  s = step(s, 0, { type: 'half' });          // 팟20 → 10 베팅(최소 삥), 팟 30
  s = step(s, 1, { type: 'die' });
  assert('(p-f1) 다이 → 즉시 종료, 상대가 팟 획득',
    Poker.isHandOver(s) === true && s.result.winner === 0 &&
    s.result.amount === 30 && s.result.folded === 1);
  assert('(p-f2) 다이 시 칩 정산 (1010 : 990)',
    s.chips[0] === 1010 && s.chips[1] === 990 && s.chips[0] + s.chips[1] === 2000);
  assert('(p-f3) 다이는 패를 공개하지 않는다',
    s.result.revealed === false &&
    Poker.viewFor(s, 1).hands[0].cards[1] === null &&
    Poker.viewFor(s, 0).hands[1].cards[0] === null);
})();

// (p-g) 올인 캡 + 초과분 반환 + 이후 베팅 없이 끝까지 배분, 파산 시 매치 종료
(function () {
  let s = Poker.createHand({ deckOrder: DECK, chips: [1000, 60], dealer: 1 });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 1, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'open', index: 0 });
  s = step(s, 1, { type: 'open', index: 2 });
  assert('(p-g0) 앤티 후 칩 990 : 50', s.chips[0] === 990 && s.chips[1] === 50);

  s = step(s, 0, { type: 'half' });        // 팟20 → 하프 10 (최소 삥), 팟 30
  s = step(s, 1, { type: 'ttadang' });     // 콜10 + 20 = 30, 팟 60, 칩 20
  assert('(p-g1) 따당 후 P1 칩 20', s.chips[1] === 20 && s.pot === 60);
  s = step(s, 0, { type: 'half' });        // 콜20 + floor(60/2)=30 → 50, 팟 110
  assert('(p-g2) 하프 후 팟 110 / 콜 요구 30 > 잔여 20',
    s.pot === 110 && opt(s, 1, 'call').amount === 20);
  s = step(s, 1, { type: 'call' });        // 20 올인 (10 부족)
  // 올인 콜로 라운드가 닫히면 초과분 반환 → 남은 카드 배분 → 쇼다운까지
  // 한 번의 apply 안에서 모두 진행된다. 반환은 로그로 확인한다.
  const refund = s.log.filter(function (e) { return e.t === 'refund'; });
  assert('(p-g3) 올인 콜 → 매칭 안 된 초과분 10 을 P0 에게 반환',
    s.allIn[1] === true && refund.length === 1 &&
    refund[0].p === 0 && refund[0].amount === 10);
  assert('(p-g4) 올인 이후 베팅 없이 7장까지 배분 → 즉시 쇼다운',
    Poker.isHandOver(s) === true && s.phase === 'showdown' &&
    s.hands[0].cards.length === 6 && s.hands[1].cards.length === 6);
  assert('(p-g5) 승자(P0)가 캡된 팟 120 획득',
    s.result.winner === 0 && s.result.amount === 120 &&
    s.chips[0] === 1060 && s.chips[1] === 0);
  assert('(p-g6) 칩 총량 보존 (1060)', s.chips[0] + s.chips[1] === 1060);
  assert('(p-g7) 파산 → 매치 종료 + 매치 승자',
    s.matchOver === true && s.matchWinner === 0);
  assert('(p-g8) 매치 종료 후 nextHand 불가', !!Poker.nextHand(s, DECK).error);
})();

// (p-h) 스플릿: 완전히 같은 족보면 팟을 절반씩 나눈다
(function () {
  // 양쪽 모두 ♠?/♥? 로 동일 랭크 구성 (무늬만 다름) → 무승부
  const D = [
    cd(14, SP), cd(14, HE),
    cd(13, SP), cd(13, HE),
    cd(9, SP), cd(9, HE),
    cd(2, CL), cd(2, DI),     // 버릴 카드
    cd(5, SP), cd(5, HE),
    cd(7, SP), cd(7, HE),
    cd(3, SP), cd(3, HE)
  ];
  let s = Poker.createHand({ deckOrder: D, chips: [500, 500], dealer: 1 });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 1, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'open', index: 0 });
  s = step(s, 1, { type: 'open', index: 0 });
  // 오픈 카드가 동점(A) → 비딜러(P0)가 선행
  assert('(p-h1) 오픈 카드 동점이면 비딜러 선행', s.toAct === 0 && s.dealer === 1);
  for (let i = 0; i < 4; i++) {
    s = step(s, s.toAct, { type: 'check' });
    s = step(s, s.toAct, { type: 'check' });
  }
  assert('(p-h2) 스플릿 판정',
    Poker.isHandOver(s) === true && s.result.split === true && s.result.winner === null);
  assert('(p-h3) 팟 20 을 10씩 분배', s.chips[0] === 500 && s.chips[1] === 500);
})();

// ============================================================
// 포커(N인 세븐포커, 2~6인) 엔진 검증 — public/sevenpoker.js
//   딜 순서: 딜러 다음 좌석부터 시계방향 (4장씩)
//   선(先): 오픈 카드가 가장 높은 좌석 (완전 동점이면 좌석 번호가 작은 쪽)
//   액션 순서: 선부터 시계방향, 폴드/올인 좌석은 건너뜀
// ============================================================

// 3인용 고정 덱 (dealer=2 → 배분 순서 P0, P1, P2)
//  P0: ♠A ♥A ♦A ♣2(버림) + ♠K ♥K ♦3  -> 풀하우스 A/K
//  P1: ♠Q ♥Q ♦J ♣3(버림) + ♠J ♥9 ♦8  -> 투페어 Q/J (키커 9)
//  P2: ♠7 ♥7 ♦4 ♣5(버림) + ♠4 ♥2 ♦6  -> 투페어 7/4 (키커 6)
const DECK3 = [
  cd(14, SP), cd(12, SP), cd(7, SP),     // 1번째: P0, P1, P2
  cd(14, HE), cd(12, HE), cd(7, HE),     // 2번째
  cd(14, DI), cd(11, DI), cd(4, DI),     // 3번째
  cd(2, CL), cd(3, CL), cd(5, CL),       // 4번째 (전원 버릴 카드)
  cd(13, SP), cd(11, SP), cd(4, SP),     // 5번째 (오픈)
  cd(13, HE), cd(9, HE), cd(2, HE),      // 6번째 (오픈)
  cd(3, DI), cd(8, DI), cd(6, DI)        // 7번째 (히든)
];
// 세 좌석이 매장/오픈까지 마친 3인 판을 만든다 (오픈: P0 ♠A, P1 ♦J, P2 ♠7)
function open3(chips, dealer, deck) {
  let s = Poker.createHand({
    players: 3, deckOrder: deck || DECK3,
    chips: chips || [1000, 1000, 1000], dealer: dealer === undefined ? 2 : dealer
  });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 1, { type: 'discard', index: 3 });
  s = step(s, 2, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'open', index: 0 });
  s = step(s, 1, { type: 'open', index: 2 });
  s = step(s, 2, { type: 'open', index: 0 });
  return s;
}

// (n-a) 3인 배분/앤티/단계 진행 + 마스킹
(function () {
  let s = Poker.createHand({ players: 3, deckOrder: DECK3, chips: [1000, 1000, 1000], dealer: 2 });
  assert('(n-a1) 3인 앤티 10씩 → 팟 30 / 칩 990',
    s.players === 3 && s.pot === 30 &&
    s.chips[0] === 990 && s.chips[1] === 990 && s.chips[2] === 990);
  assert('(n-a2) 3인 4장씩 배분 (딜러 다음 좌석 P0 부터)',
    s.dealtCount === 12 &&
    s.hands[0].cards.length === 4 && s.hands[1].cards.length === 4 &&
    s.hands[2].cards.length === 4 &&
    s.hands[0].cards[0].r === 14 && s.hands[1].cards[0].r === 12 &&
    s.hands[2].cards[0].r === 7);

  s = step(s, 2, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'discard', index: 3 });
  assert('(n-a3) 두 명만 매장하면 아직 discard 단계',
    s.phase === 'discard' && s.hands[1].cards.length === 4);
  s = step(s, 1, { type: 'discard', index: 3 });
  assert('(n-a4) 전원 매장 → open 단계',
    s.phase === 'open' && s.hands.every((h) => h.cards.length === 3));
  s = step(s, 0, { type: 'open', index: 0 });
  s = step(s, 1, { type: 'open', index: 2 });
  assert('(n-a5) 두 명만 오픈하면 아직 open 단계', s.phase === 'open');
  s = step(s, 2, { type: 'open', index: 0 });
  assert('(n-a6) 전원 오픈 → 1라운드 베팅, 오픈 최고(♠A) 좌석이 선',
    s.phase === 'bet' && s.round === 1 && s.toAct === 0);

  const v1 = Poker.viewFor(s, 1);
  assert('(n-a7) viewFor: 나 이외 모든 좌석의 히든이 null',
    v1.me === 1 &&
    v1.hands[0].cards.filter((c) => c === null).length === 2 &&
    v1.hands[2].cards.filter((c) => c === null).length === 2 &&
    v1.hands[1].cards.every((c) => c && c.r));
  assert('(n-a8) viewFor: 나 이외 모든 좌석의 매장 카드가 null + 덱 비공개',
    v1.hands[0].buried === null && v1.hands[2].buried === null &&
    v1.hands[1].buried.r === 3 && v1.deck === undefined && v1.deckLeft === DECK3.length - 12);
  const vnull = Poker.viewFor(s, null);
  assert('(n-a9) viewFor(null): 전원 히든 가림 (로컬 핫시트 가리개용)',
    vnull.me === null && vnull.options.length === 0 &&
    [0, 1, 2].every((i) => vnull.hands[i].cards.filter((c) => c === null).length === 2));
})();

// (n-b) 액션 순서: 선부터 시계방향, 폴드하면 그 좌석을 건너뛴다
(function () {
  let s = open3();
  assert('(n-b1) 1라운드 선 = P0', s.toAct === 0);
  s = step(s, 0, { type: 'bbing' });
  assert('(n-b2) 삥 후 차례는 시계방향 다음(P1)', s.toAct === 1 && s.pot === 40);
  assert('(n-b3) 차례가 아닌 좌석(P2)의 액션은 거부',
    !!Poker.apply(s, 2, { type: 'call' }).error);
  s = step(s, 1, { type: 'call' });
  assert('(n-b4) 두 명이 콜해도 P2 가 남았으면 라운드가 끝나지 않는다',
    s.toAct === 2 && s.round === 1 && s.pot === 50);
  s = step(s, 2, { type: 'call' });
  assert('(n-b5) 전원 콜 → 라운드 종료 + 5번째 카드(오픈) 배분',
    s.round === 2 && s.pot === 60 && s.street === 5 &&
    s.hands.every((h) => h.cards.length === 4 && h.cards[3].open === true));
  assert('(n-b6) 2라운드 선도 오픈 최고(♠A♠K) 좌석', s.toAct === 0);

  s = step(s, 0, { type: 'half' });          // 콜0 + 팟30 = 30
  assert('(n-b7) 하프 = 팟의 절반(30) → 팟 90', s.pot === 90 && s.toAct === 1);
  s = step(s, 1, { type: 'die' });
  assert('(n-b8) 다이한 좌석은 순서에서 빠진다 (P1 → P2 로 건너뜀)',
    s.folded[1] === true && s.toAct === 2 &&
    Poker.activeSeats(s).join(',') === '0,2');
  s = step(s, 2, { type: 'call' });
  assert('(n-b9) 남은 두 명이 매칭 → 라운드 종료 / 팟 120', s.pot === 120 && s.round === 3);
  assert('(n-b10) 폴드한 좌석은 카드를 더 받지 않는다',
    s.hands[0].cards.length === 5 && s.hands[2].cards.length === 5 &&
    s.hands[1].cards.length === 4 && s.dealtCount === 17);
  assert('(n-b11) 폴드한 좌석은 액션할 수 없다',
    !!Poker.apply(s, 1, { type: 'check' }).error);

  s = step(s, 0, { type: 'check' });
  s = step(s, 2, { type: 'check' });
  s = step(s, 0, { type: 'check' });
  s = step(s, 2, { type: 'check' });
  assert('(n-b12) 쇼다운: 풀하우스 P0 이 팟 120 획득',
    Poker.isHandOver(s) === true && s.phase === 'showdown' &&
    s.result.winner === 0 && s.result.amount === 120 && s.result.split === false);
  assert('(n-b13) 폴드한 좌석의 패는 평가/공개되지 않는다',
    s.result.hands[1] === null && s.result.hands[0].cat === 6 && s.result.hands[2].cat === 2);
  assert('(n-b14) 칩 정산 (1070 / 980 / 950, 총합 3000)',
    s.chips[0] === 1070 && s.chips[1] === 980 && s.chips[2] === 950 &&
    s.chips[0] + s.chips[1] + s.chips[2] === 3000);
  const vw = Poker.viewFor(s, 1);
  assert('(n-b15) 쇼다운 공개는 폴드하지 않은 좌석만',
    vw.hands[0].cards.every((c) => c && c.r) &&
    vw.hands[2].cards.every((c) => c && c.r));
  assert('(n-b16) 다음 판: 딜러가 시계방향으로 이동 (2 → 0)',
    Poker.nextHand(s, DECK3).dealer === 0);
})();

// (n-c) 전원 다이: 마지막 한 명이 팟 전부 (패 비공개)
(function () {
  let s = open3();
  s = step(s, 0, { type: 'half' });
  s = step(s, 1, { type: 'die' });
  assert('(n-c1) 한 명이 다이해도 판은 계속된다',
    s.over === false && s.toAct === 2);
  s = step(s, 2, { type: 'die' });
  assert('(n-c2) 마지막 한 명만 남으면 즉시 종료 + 팟 전부 획득',
    Poker.isHandOver(s) === true && s.phase === 'folded' &&
    s.result.winner === 0 && s.result.amount === 45 && s.result.revealed === false);
  assert('(n-c3) 다이 종료는 아무 패도 공개하지 않는다',
    s.revealed === false &&
    Poker.viewFor(s, 1).hands[0].cards.some((c) => c === null) &&
    Poker.viewFor(s, 0).hands[2].cards.some((c) => c === null));
  assert('(n-c4) 칩 정산 (1020 / 990 / 990)',
    s.chips.join(',') === '1020,990,990' &&
    s.chips[0] + s.chips[1] + s.chips[2] === 3000);
})();

// (n-d) 사이드 팟: 스택 100 / 300 / 1000, 서로 다른 금액으로 올인
//   최종 기여: P0 100, P1 300, P2 300 (P2 의 초과분은 반환)
//   층1 = 100 x 3 = 300 (자격 P0,P1,P2) / 층2 = 200 x 2 = 400 (자격 P1,P2)
(function () {
  let s = open3([100, 300, 1000], 2);
  assert('(n-d0) 앤티 후 칩 90 / 290 / 990 / 팟 30',
    s.chips[0] === 90 && s.chips[1] === 290 && s.chips[2] === 990 && s.pot === 30);
  s = step(s, 0, { type: 'half' });        // 15 (팟30의 절반)
  s = step(s, 1, { type: 'ttadang' });     // 콜15 + 30 = 45
  s = step(s, 2, { type: 'half' });        // 콜45 + 45 = 90
  s = step(s, 0, { type: 'call' });        // 잔여 75 전부 → 올인 (10 부족)
  assert('(n-d1) 짧은 스택은 콜만으로 올인 (매칭 부족분은 사이드 팟으로)',
    s.allIn[0] === true && s.chips[0] === 0 && s.committed[0] === 100);
  s = step(s, 1, { type: 'ttadang' });     // 콜45 + 90 = 135
  s = step(s, 2, { type: 'call' });        // 90
  assert('(n-d2) 1라운드 종료 (반환 없음): 기여 100 / 190 / 190',
    s.round === 2 && s.committed[0] === 100 && s.committed[1] === 190 &&
    s.committed[2] === 190 && s.pot === 480);
  assert('(n-d3) 올인 좌석은 선이 될 수 없다 → 시계방향 다음(P1)', s.toAct === 1);
  s = step(s, 1, { type: 'half' });        // 잔여 110 전부 → 올인
  assert('(n-d4) 두 번째 올인', s.allIn[1] === true && s.chips[1] === 0);
  s = step(s, 2, { type: 'call' });        // 110
  assert('(n-d5) 액션 가능 좌석이 1명뿐이면 베팅 없이 7장까지 배분 → 쇼다운',
    Poker.isHandOver(s) === true && s.phase === 'showdown' && s.street === 7);
  assert('(n-d6) 최종 기여 100 / 300 / 300, 팟 700',
    s.committed[0] === 100 && s.committed[1] === 300 && s.committed[2] === 300 &&
    s.result.amount === 700);
  const pots = s.result.pots;
  assert('(n-d7) 사이드 팟 2층 생성',
    pots.length === 2 &&
    pots[0].amount === 300 && pots[0].eligible.join(',') === '0,1,2' &&
    pots[1].amount === 400 && pots[1].eligible.join(',') === '1,2', JSON.stringify(pots));
  assert('(n-d8) 층1(300)은 최강 풀하우스 P0, 층2(400)은 남은 둘 중 강한 P1',
    pots[0].winners.join(',') === '0' && pots[1].winners.join(',') === '1');
  assert('(n-d9) 층별 정확한 분배: P0 300 / P1 400 / P2 0',
    s.result.payouts.join(',') === '300,400,0', s.result.payouts);
  assert('(n-d10) 최종 칩 300 / 400 / 700 (총합 1400 보존)',
    s.chips.join(',') === '300,400,700' &&
    s.chips[0] + s.chips[1] + s.chips[2] === 1400);
  assert('(n-d11) 여러 층에서 다른 승자가 나오면 단독 승자가 아니다',
    s.result.winner === null && s.result.split === true);
  assert('(n-d12) 파산 두 명 → 매치 계속 (칩 보유 2명)', s.matchOver === false);
})();

// (n-e) 같은 층 안에서의 스플릿 (랭크가 완전히 같은 두 좌석)
//   P0: 풀하우스 A/K (100 올인) / P1, P2: 투페어 Q,J + 9 (랭크 동일)
(function () {
  const DECK3S = [
    cd(14, SP), cd(12, SP), cd(12, CL),
    cd(14, HE), cd(12, HE), cd(12, DI),
    cd(14, DI), cd(11, DI), cd(11, CL),
    cd(2, CL), cd(3, CL), cd(5, HE),
    cd(13, SP), cd(11, SP), cd(11, HE),
    cd(13, HE), cd(9, HE), cd(9, CL),
    cd(3, DI), cd(8, DI), cd(8, CL)
  ];
  let s = open3([100, 300, 1000], 2, DECK3S);
  s = step(s, 0, { type: 'half' });
  s = step(s, 1, { type: 'ttadang' });
  s = step(s, 2, { type: 'half' });
  s = step(s, 0, { type: 'call' });
  s = step(s, 1, { type: 'ttadang' });
  s = step(s, 2, { type: 'call' });
  s = step(s, 1, { type: 'half' });
  s = step(s, 2, { type: 'call' });
  assert('(n-e1) 층1(300)은 P0 단독, 층2(400)은 동점 두 좌석이 분배',
    s.result.pots[0].winners.join(',') === '0' &&
    s.result.pots[1].winners.join(',') === '1,2', JSON.stringify(s.result.pots));
  assert('(n-e2) 스플릿 분배: P0 300 / P1 200 / P2 200',
    s.result.payouts.join(',') === '300,200,200', s.result.payouts);
  assert('(n-e3) 칩 총량 보존 (1400)',
    s.chips[0] + s.chips[1] + s.chips[2] === 1400 &&
    s.chips.join(',') === '300,200,900');
})();

// (n-f) 파산/딜러 로테이션: 칩 0 좌석은 다음 판에 앉지 않고 딜러도 건너뛴다
(function () {
  // 배분 순서 [P1, P2, P0] (dealer=0)
  //  P0: ♠A ♥A ♦A ♣2(버림) + ♠K ♥K ♦4 -> 풀하우스
  //  P1: ♠2 ♥4 ♦6 ♣8(버림) + ♠9 ♥J ♦K -> 하이카드 (칩 20 뿐)
  //  P2: ♠3 ♥5 ♦7 ♣9(버림) + ♠Q ♥10 ♦2 -> 하이카드
  const DECKB = [
    cd(2, SP), cd(3, SP), cd(14, SP),
    cd(4, HE), cd(5, HE), cd(14, HE),
    cd(6, DI), cd(7, DI), cd(14, DI),
    cd(8, CL), cd(9, CL), cd(2, CL),
    cd(9, SP), cd(12, SP), cd(13, SP),
    cd(11, HE), cd(10, HE), cd(13, HE),
    cd(13, DI), cd(2, DI), cd(4, DI)
  ];
  let s = Poker.createHand({ players: 3, deckOrder: DECKB, chips: [1000, 20, 1000], dealer: 0 });
  assert('(n-f0) 딜러 다음 좌석(P1)부터 배분', s.hands[1].cards[0].r === 2 && s.dealer === 0);
  s = step(s, 1, { type: 'discard', index: 3 });
  s = step(s, 2, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'open', index: 0 });   // ♠A
  s = step(s, 1, { type: 'open', index: 2 });   // ♦6
  s = step(s, 2, { type: 'open', index: 2 });   // ♦7
  s = step(s, 0, { type: 'bbing' });            // 10
  s = step(s, 1, { type: 'call' });             // 잔여 10 → 올인
  assert('(n-f1) 앤티 후 잔여 10 을 콜하면 올인', s.allIn[1] === true && s.chips[1] === 0);
  s = step(s, 2, { type: 'call' });
  let guard = 0;
  while (!s.over && guard++ < 12) s = step(s, s.toAct, { type: 'check' });
  assert('(n-f2) 올인 좌석이 남아 있어도 나머지는 계속 베팅한다', s.over === true);
  assert('(n-f3) P1 파산 (칩 0) + 파산 로그',
    s.chips[1] === 0 && s.log.some((e) => e.t === 'bust' && e.p === 1));
  assert('(n-f4) 칩 보유 2명 → 매치 계속', s.matchOver === false);
  const n = Poker.nextHand(s, DECKB);
  assert('(n-f5) 딜러는 칩이 없는 좌석을 건너뛴다 (0 → 2)', n.dealer === 2, n.dealer);
  assert('(n-f6) 파산 좌석은 다음 판에 앉지 않는다 (카드/앤티 없음)',
    n.out[1] === true && n.folded[1] === true &&
    n.hands[1].cards.length === 0 && n.pot === 20);
  assert('(n-f7) 파산 좌석을 건너뛰고 배분 (딜러 2 → P0 부터)',
    n.hands[0].cards.length === 4 && n.hands[2].cards.length === 4 &&
    n.dealtCount === 8);
  assert('(n-f8) 파산 좌석은 액션할 수 없다', !!Poker.apply(n, 1, { type: 'discard', index: 0 }).error);
})();

// (n-g) 매치 종료: 칩을 가진 좌석이 1명만 남으면 최종 우승
(function () {
  const DECKC = [
    cd(2, SP), cd(14, SP),
    cd(3, HE), cd(14, HE),
    cd(4, DI), cd(14, DI),
    cd(5, CL), cd(2, CL),
    cd(7, SP), cd(13, SP),
    cd(9, HE), cd(13, HE),
    cd(11, DI), cd(3, DI)
  ];
  // P1 은 이미 파산(칩 0), P2 는 앤티로 올인이 되는 10칩
  let s = Poker.createHand({ players: 3, deckOrder: DECKC, chips: [500, 0, 10], dealer: 0 });
  assert('(n-g1) 앤티로 올인 → 팟 20 (파산 좌석은 앤티 없음)',
    s.pot === 20 && s.allIn[2] === true && s.chips[2] === 0 && s.out[1] === true);
  s = step(s, 2, { type: 'discard', index: 3 });
  s = step(s, 0, { type: 'discard', index: 3 });
  s = step(s, 2, { type: 'open', index: 0 });
  s = step(s, 0, { type: 'open', index: 0 });
  assert('(n-g2) 액션 가능 좌석이 1명 → 베팅 없이 쇼다운까지',
    Poker.isHandOver(s) === true && s.phase === 'showdown');
  assert('(n-g3) 남은 한 명이 팟 20 획득 → 최종 우승',
    s.chips[0] === 510 && s.matchOver === true && s.matchWinner === 0 &&
    s.log.some((e) => e.t === 'match' && e.winner === 0));
  assert('(n-g4) 매치 종료 후 nextHand 불가', !!Poker.nextHand(s, DECKC).error);
})();

// (n-h) 퇴장(leave): 자동 다이 + 남은 칩 제거, 판은 계속된다
(function () {
  let s = open3();
  s = step(s, 0, { type: 'bbing' });
  const r = Poker.leave(s, 1);
  assert('(n-h1) 퇴장은 에러가 아니며 로그를 남긴다',
    !r.error && r.events.some((e) => e.t === 'leave' && e.p === 1));
  s = r.state;
  assert('(n-h2) 퇴장 좌석은 다이 처리 + 퇴장 표시 + 칩 제거',
    s.left[1] === true && s.folded[1] === true && s.chips[1] === 0);
  assert('(n-h3) 퇴장해도 남은 두 명으로 판이 이어진다',
    s.over === false && s.toAct === 2 && Poker.activeSeats(s).join(',') === '0,2');
  s = step(s, 2, { type: 'call' });
  assert('(n-h4) 퇴장 좌석을 빼고 라운드가 정상 종료된다', s.round === 2 && s.pot === 50);
  assert('(n-h5) 퇴장 좌석의 중복 처리는 무시된다',
    Poker.leave(s, 1).events.length === 0);
  s = step(s, 0, { type: 'die' });
  assert('(n-h6) 남은 한 명이 팟 획득', s.over === true && s.result.winner === 2);
  const n = Poker.nextHand(s, DECK3);
  assert('(n-h7) 퇴장 표시는 다음 판에도 유지된다',
    n.left[1] === true && n.out[1] === true && n.hands[1].cards.length === 0);
})();

// (n-i) 6인 테이블도 같은 규칙으로 동작한다
(function () {
  const deck = Cards.makeDeck();
  let s = Poker.createHand({ players: 6, deckOrder: deck, dealer: 5 });
  assert('(n-i1) 6인: 앤티 60 / 24장 배분 / 딜러 다음(P0) 부터',
    s.players === 6 && s.pot === 60 && s.dealtCount === 24 &&
    s.chips.every((c) => c === 990) &&
    s.hands.every((h) => h.cards.length === 4));
  for (let i = 0; i < 6; i++) s = step(s, i, { type: 'discard', index: 0 });
  for (let i = 0; i < 6; i++) s = step(s, i, { type: 'open', index: 0 });
  assert('(n-i2) 6인: 전원 매장/오픈 후 1라운드', s.phase === 'bet' && s.round === 1);
  const order = [];
  let guard = 0;
  while (s.phase === 'bet' && s.round === 1 && guard++ < 10) {
    order.push(s.toAct);
    s = step(s, s.toAct, { type: 'check' });
  }
  assert('(n-i3) 6인: 선부터 시계방향으로 6명이 한 번씩 액션',
    order.length === 6 &&
    order.every((v, i) => i === 0 || v === (order[i - 1] + 1) % 6), order);
  assert('(n-i4) 6인: 전원 체크 → 2라운드 + 5번째 카드', s.round === 2 && s.street === 5);
  assert('(n-i5) 6인 상한 초과 요청은 6인으로 클램프',
    Poker.createHand({ players: 9 }).players === 6 &&
    Poker.createHand({ players: 1 }).players === 2);
})();

console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
