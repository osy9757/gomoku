/*
 * connect4.js — 사목(Connect Four) 공용 규칙 모듈
 * 브라우저(window.Connect4)와 Node(require)에서 함께 사용하는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크 의존 없음). othello.js 와 동일한 패턴.
 *
 * 보드: 6행(ROWS) x 7열(COLS). 정사각이 아니다.
 * 착수: "열"을 고르면 그 열의 가장 아래 빈 칸으로 떨어진다(중력).
 * 승리: 가로/세로/대각 4개 이상 연속.
 * 색: 프로토콜은 다른 게임과 동일하게 BLACK(1)/WHITE(2) 를 쓰고,
 *     화면에는 빨강(선공)/노랑 으로 표시한다(표시 책임은 game.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Connect4 = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = 6;
  var COLS = 7;
  var WIN_LEN = 4;
  var EMPTY = 0;
  var BLACK = 1;   // 빨강 (선공)
  var WHITE = 2;   // 노랑

  // 4 방향: 가로, 세로, 대각(\), 반대각(/)
  var DIRECTIONS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function opponent(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function createBoard() {
    var b = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < COLS; c++) row.push(EMPTY);
      b.push(row);
    }
    return b;
  }

  function cloneBoard(board) {
    var b = [];
    for (var r = 0; r < ROWS; r++) b.push(board[r].slice());
    return b;
  }

  // col 에 돌을 떨어뜨렸을 때 착지하는 행. 열이 가득 찼거나 범위 밖이면 -1.
  function dropRow(board, col) {
    if (col < 0 || col >= COLS) return -1;
    for (var r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === EMPTY) return r;
    }
    return -1;
  }

  function isColumnFull(board, col) {
    return dropRow(board, col) === -1;
  }

  // 착수 적용(원본 불변). 합법이면 { board: 다음보드(사본), row: 착지행 }, 아니면 null.
  function applyMove(board, col, color) {
    var row = dropRow(board, col);
    if (row < 0) return null;
    var next = cloneBoard(board);
    next[row][col] = color;
    return { board: next, row: row };
  }

  // (r,c)에 color 가 놓인 보드에서 그 지점을 지나는 4개 이상 연속이 있으면
  // 그 줄의 칸 목록 [{row,col},...] 을, 없으면 null 을 반환한다.
  function checkWinAt(board, r, c, color) {
    if (!inBounds(r, c)) return null;
    if (board[r][c] !== color) return null;
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var dr = DIRECTIONS[d][0], dc = DIRECTIONS[d][1];
      var cells = [{ row: r, col: c }];
      var i = r + dr, j = c + dc;
      while (inBounds(i, j) && board[i][j] === color) { cells.push({ row: i, col: j }); i += dr; j += dc; }
      i = r - dr; j = c - dc;
      while (inBounds(i, j) && board[i][j] === color) { cells.push({ row: i, col: j }); i -= dr; j -= dc; }
      if (cells.length >= WIN_LEN) {
        cells.sort(function (a, b) { return (a.row - b.row) || (a.col - b.col); });
        return cells;
      }
    }
    return null;
  }

  // 둘 수 있는 열 목록 [{col, row(착지행)}, ...]
  function legalColumns(board) {
    var list = [];
    for (var c = 0; c < COLS; c++) {
      var r = dropRow(board, c);
      if (r >= 0) list.push({ col: c, row: r });
    }
    return list;
  }

  function isFull(board) {
    for (var c = 0; c < COLS; c++) {
      if (dropRow(board, c) >= 0) return false;
    }
    return true;
  }

  // 착수 유효성 (서버/클라 공용). { ok:true, row } 또는 { ok:false, reason }
  function validateMove(board, col) {
    if (col < 0 || col >= COLS) return { ok: false, reason: 'out-of-bounds' };
    var row = dropRow(board, col);
    if (row < 0) return { ok: false, reason: 'column-full' };
    return { ok: true, row: row };
  }

  return {
    ROWS: ROWS,
    COLS: COLS,
    WIN_LEN: WIN_LEN,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    DIRECTIONS: DIRECTIONS,
    inBounds: inBounds,
    opponent: opponent,
    createBoard: createBoard,
    cloneBoard: cloneBoard,
    dropRow: dropRow,
    isColumnFull: isColumnFull,
    applyMove: applyMove,
    checkWinAt: checkWinAt,
    legalColumns: legalColumns,
    isFull: isFull,
    validateMove: validateMove
  };
});
