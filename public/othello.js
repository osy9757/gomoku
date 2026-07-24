/*
 * othello.js — 오델로(리버시, Othello/Reversi) 공용 규칙 모듈
 * 브라우저(window.Othello)와 Node(require)에서 함께 사용하는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크 의존 없음). rules.js 와 동일한 패턴.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Othello = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOARD_SIZE = 8;
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;

  // 8 방향 (가로/세로/대각)
  var DIRECTIONS = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function opponent(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  // 초기 배치: (3,3)=백, (3,4)=흑, (4,3)=흑, (4,4)=백. 흑 선공.
  function createBoard() {
    var b = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      var row = [];
      for (var c = 0; c < BOARD_SIZE; c++) row.push(EMPTY);
      b.push(row);
    }
    b[3][3] = WHITE;
    b[3][4] = BLACK;
    b[4][3] = BLACK;
    b[4][4] = WHITE;
    return b;
  }

  function cloneBoard(board) {
    var b = [];
    for (var r = 0; r < BOARD_SIZE; r++) b.push(board[r].slice());
    return b;
  }

  // (r,c)에 color를 두었을 때 뒤집히는 상대 돌 좌표 목록 [[r,c],...]
  function flipsFor(board, r, c, color) {
    if (!inBounds(r, c) || board[r][c] !== EMPTY) return [];
    var opp = opponent(color);
    var flipped = [];
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var dr = DIRECTIONS[d][0], dc = DIRECTIONS[d][1];
      var line = [];
      var i = r + dr, j = c + dc;
      while (inBounds(i, j) && board[i][j] === opp) {
        line.push([i, j]);
        i += dr; j += dc;
      }
      if (line.length > 0 && inBounds(i, j) && board[i][j] === color) {
        for (var k = 0; k < line.length; k++) flipped.push(line[k]);
      }
    }
    return flipped;
  }

  // color가 둘 수 있는 합법 착수 목록 [{row,col},...]
  function legalMoves(board, color) {
    var moves = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) continue;
        if (flipsFor(board, r, c, color).length > 0) moves.push({ row: r, col: c });
      }
    }
    return moves;
  }

  // 착수 적용. 합법이면 { board: 다음보드(사본), flipped:[[r,c],...] }, 아니면 null.
  function applyMove(board, r, c, color) {
    var flipped = flipsFor(board, r, c, color);
    if (flipped.length === 0) return null;
    var next = cloneBoard(board);
    next[r][c] = color;
    for (var k = 0; k < flipped.length; k++) {
      next[flipped[k][0]][flipped[k][1]] = color;
    }
    return { board: next, flipped: flipped };
  }

  function hasAnyMove(board, color) {
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) continue;
        if (flipsFor(board, r, c, color).length > 0) return true;
      }
    }
    return false;
  }

  function counts(board) {
    var black = 0, white = 0;
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === BLACK) black++;
        else if (board[r][c] === WHITE) white++;
      }
    }
    return { black: black, white: white };
  }

  // 양측 모두 둘 곳이 없으면 종료
  function isGameOver(board) {
    return !hasAnyMove(board, BLACK) && !hasAnyMove(board, WHITE);
  }

  // 1(흑승) | 2(백승) | 0(무승부)
  function winner(board) {
    var c = counts(board);
    if (c.black > c.white) return BLACK;
    if (c.white > c.black) return WHITE;
    return 0;
  }

  return {
    BOARD_SIZE: BOARD_SIZE,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    DIRECTIONS: DIRECTIONS,
    inBounds: inBounds,
    opponent: opponent,
    createBoard: createBoard,
    cloneBoard: cloneBoard,
    flipsFor: flipsFor,
    legalMoves: legalMoves,
    applyMove: applyMove,
    hasAnyMove: hasAnyMove,
    counts: counts,
    isGameOver: isGameOver,
    winner: winner
  };
});
