/*
 * rules.js — 오목(Gomoku) 공용 규칙 모듈
 * 브라우저(window.Rules)와 Node(require)에서 함께 사용하는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크 의존 없음).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Rules = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOARD_SIZE = 15;
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;

  // 4 방향: 가로, 세로, 대각(\), 반대각(/)
  var DIRECTIONS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function createBoard() {
    var b = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      var row = [];
      for (var c = 0; c < BOARD_SIZE; c++) row.push(EMPTY);
      b.push(row);
    }
    return b;
  }

  // (r,c)를 지나는 dir 방향 최대 연속 색 정보
  function runInfo(board, r, c, dr, dc) {
    var color = board[r][c];
    var len = 1;
    var i = r + dr, j = c + dc;
    while (inBounds(i, j) && board[i][j] === color) { len++; i += dr; j += dc; }
    var endOpen = inBounds(i, j) && board[i][j] === EMPTY;
    i = r - dr; j = c - dc;
    while (inBounds(i, j) && board[i][j] === color) { len++; i -= dr; j -= dc; }
    var startOpen = inBounds(i, j) && board[i][j] === EMPTY;
    return { len: len, startOpen: startOpen, endOpen: endOpen };
  }

  // (r,c)에 color가 놓였을 때 dir 방향 연속 개수
  function consecutive(board, r, c, dr, dc, color) {
    var len = 1;
    var i = r + dr, j = c + dc;
    while (inBounds(i, j) && board[i][j] === color) { len++; i += dr; j += dc; }
    i = r - dr; j = c - dc;
    while (inBounds(i, j) && board[i][j] === color) { len++; i -= dr; j -= dc; }
    return len;
  }

  /*
   * 실제 승리 판정: (r,c)에 color를 둔 뒤 승리인지.
   * 렌주룰에서 흑은 정확히 5, 백은 5 이상(장목 승리).
   * 자유룰은 흑/백 모두 5 이상 승리.
   */
  function checkWinAt(board, r, c, color, rule) {
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var len = consecutive(board, r, c, DIRECTIONS[d][0], DIRECTIONS[d][1], color);
      if (rule === 'renju' && color === BLACK) {
        if (len === 5) return true;
      } else {
        if (len >= 5) return true;
      }
    }
    return false;
  }

  // dir 방향으로 놓은 지점 근방 빈칸 후보 순회
  function forEachLineEmpty(board, r, c, dr, dc, cb) {
    for (var k = -5; k <= 5; k++) {
      if (k === 0) continue;
      var i = r + k * dr, j = c + k * dc;
      if (inBounds(i, j) && board[i][j] === EMPTY) cb(i, j);
    }
  }

  // (r,c)에 흑이 놓인 상태(호출 전 board에 BLACK 세팅됨) 기준 dir 방향 "열린 3" 여부
  // 정의: 이 라인에서 흑을 한 번 더 두어 "열린 4"(양끝 열린 정확히 4)를 만들 수 있으면 열린 3.
  function hasOpenThreeInDir(board, r, c, dr, dc) {
    var found = false;
    forEachLineEmpty(board, r, c, dr, dc, function (i, j) {
      if (found) return;
      board[i][j] = BLACK;
      var info = runInfo(board, r, c, dr, dc);
      if (info.len === 4 && info.startOpen && info.endOpen) found = true;
      board[i][j] = EMPTY;
    });
    return found;
  }

  // dir 방향의 "4" 개수 (0,1,2). 한 번 더 두면 정확히 5가 되는 형태.
  function foursInDir(board, r, c, dr, dc) {
    var base = runInfo(board, r, c, dr, dc);
    if (base.len >= 5) return 0; // 이미 5 이상 -> 4가 아님
    var comps = 0;
    forEachLineEmpty(board, r, c, dr, dc, function (i, j) {
      board[i][j] = BLACK;
      var info = runInfo(board, r, c, dr, dc);
      if (info.len === 5) comps++;
      board[i][j] = EMPTY;
    });
    if (comps === 0) return 0;
    // 열린 4(.XXXX.)는 완성점이 2개지만 하나의 4로 취급
    if (base.len === 4 && base.startOpen && base.endOpen) return 1;
    return comps >= 2 ? 2 : 1;
  }

  // (r,c)에 흑을 놓았다고 가정하고 라인 분석
  function analyzeBlack(board, r, c) {
    board[r][c] = BLACK;
    var five = false, overline = false, fours = 0, openThrees = 0;
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var dr = DIRECTIONS[d][0], dc = DIRECTIONS[d][1];
      var len = consecutive(board, r, c, dr, dc, BLACK);
      if (len === 5) five = true;
      if (len >= 6) overline = true;
      fours += foursInDir(board, r, c, dr, dc);
      if (hasOpenThreeInDir(board, r, c, dr, dc)) openThrees++;
    }
    board[r][c] = EMPTY;
    return { five: five, overline: overline, fours: fours, openThrees: openThrees };
  }

  /*
   * 흑의 (r,c) 착수가 금수인지 판정. 금수면 종류 문자열, 아니면 null.
   * 우선순위: 정확히 5(승리) > 장목 > 4-4 > 3-3
   */
  function forbiddenType(board, r, c) {
    if (!inBounds(r, c) || board[r][c] !== EMPTY) return null;
    var a = analyzeBlack(board, r, c);
    if (a.five) return null;            // 5 완성은 승리 -> 금수 아님
    if (a.overline) return 'overline';  // 장목
    if (a.fours >= 2) return 'four-four';
    if (a.openThrees >= 2) return 'three-three';
    return null;
  }

  // 렌주룰에서 흑 차례일 때 금수 지점 목록
  function forbiddenPoints(board, rule) {
    var pts = [];
    if (rule !== 'renju') return pts;
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === EMPTY) {
          var t = forbiddenType(board, r, c);
          if (t) pts.push({ row: r, col: c, type: t });
        }
      }
    }
    return pts;
  }

  var FORBIDDEN_LABEL = {
    'overline': '금수입니다 (장목)',
    'four-four': '금수입니다 (4-4)',
    'three-three': '금수입니다 (3-3)'
  };

  // 착수 유효성 종합 판정 (서버/클라 공용)
  // 반환: { ok:true } 또는 { ok:false, reason, type }
  function validateMove(board, r, c, color, rule) {
    if (!inBounds(r, c)) return { ok: false, reason: 'out-of-bounds' };
    if (board[r][c] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (rule === 'renju' && color === BLACK) {
      var t = forbiddenType(board, r, c);
      if (t) return { ok: false, reason: 'forbidden', type: t };
    }
    return { ok: true };
  }

  return {
    BOARD_SIZE: BOARD_SIZE,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    DIRECTIONS: DIRECTIONS,
    createBoard: createBoard,
    checkWinAt: checkWinAt,
    forbiddenType: forbiddenType,
    forbiddenPoints: forbiddenPoints,
    validateMove: validateMove,
    FORBIDDEN_LABEL: FORBIDDEN_LABEL
  };
});
