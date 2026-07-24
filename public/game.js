/* ============================================================
   game.js — 오목 클라이언트 (보드/규칙UI/모드/웹소켓/채팅/테마)
   rules.js(window.Rules)에 순수 규칙 로직 의존.
   ============================================================ */
(function () {
  'use strict';

  var R = window.Rules;
  var O = window.Othello;
  var BLACK = R.BLACK, WHITE = R.WHITE, EMPTY = R.EMPTY; // 오목/오델로 공통 (1,2,0)
  var SIZE = R.BOARD_SIZE;          // 현재 게임 보드 크기 (오목 15 / 오델로 8)
  var STAR_POINTS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
  // 오델로 보드 표식 위치(격자 교차점 기준)
  var OTHELLO_DOTS = [[2, 2], [2, 6], [6, 2], [6, 6]];

  // 현재 게임의 규칙 모듈
  function curMod() { return state.game === 'othello' ? O : R; }
  function newBoard() { return curMod().createBoard(); }
  function boardSize() { return state.game === 'othello' ? O.BOARD_SIZE : R.BOARD_SIZE; }
  function otherColor(c) { return c === BLACK ? WHITE : BLACK; }

  // ── DOM ────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var boardInner = $('boardInner');
  var canvas = $('boardCanvas');
  var ctx = canvas.getContext('2d');
  var stonesLayer = $('stonesLayer');
  var markersLayer = $('markersLayer');
  var excelHeaders = $('excelHeaders');
  var boardCells = $('boardCells');
  var clickOverlay = $('clickOverlay');
  var boardFlip = $('boardFlip');

  // ── 상태 ────────────────────────────────────────────────
  var state = {
    mode: 'local',        // 'local' | 'online'
    game: 'omok',         // 'omok' | 'othello'
    rule: 'renju',        // 'renju' | 'free'
    theme: 'default',     // 'default' | 'excel'
    board: R.createBoard(),
    moves: [],            // 오목: {row,col,color} / 오델로: {kind:'move',row,col,color,flipped}|{kind:'pass',color}
    turn: BLACK,
    gameOver: false,
    winner: null,         // BLACK/WHITE/0(무승부)/null
    winStones: [],
    lastFlipped: [],      // 오델로: 직전 착수로 뒤집힌 좌표 (플립 애니메이션용)
    othelloCounts: { black: 2, white: 2 },
    times: { 1: 0, 2: 0 }, // 초 단위
    // online
    ws: null,
    connected: false,
    myColor: null,        // 'black'|'white'
    roomCode: null,
    online: false,
    started: false,
    intentionalClose: false
  };

  // 엑셀 테마 단위(%) — 헤더 1 + 셀 SIZE
  function excelUnit() { return 100 / (SIZE + 1); }

  // ============================================================
  // 유틸
  // ============================================================
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function colorStr(c) { return c === BLACK ? 'black' : 'white'; }
  function colorNum(s) { return s === 'black' ? BLACK : WHITE; }
  function coordLabel(row, col) {
    if (state.game === 'othello') {
      // 오델로 표준 표기: a-h(소문자) + 1-8 (위에서 아래로)
      return String.fromCharCode(97 + col) + (row + 1);
    }
    return String.fromCharCode(65 + col) + (SIZE - row);
  }
  // 엑셀 테마 전용: 화면에 보이는 행 헤더(1..N, 위에서 아래로)를 그대로 반영
  function excelCoordLabel(row, col) {
    return String.fromCharCode(65 + col) + (row + 1);
  }
  // 기보/하이라이트용: 마지막 실제 착수(패스 제외)
  function lastRealMove() {
    for (var i = state.moves.length - 1; i >= 0; i--) {
      var m = state.moves[i];
      if (state.game === 'othello') {
        if (m.kind === 'move') return m;
      } else {
        return m;
      }
    }
    return null;
  }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ============================================================
  // 보드 렌더링
  // ============================================================
  function innerSize() {
    return boardInner.getBoundingClientRect().width || 0;
  }

  function drawLines() {
    var size = innerSize();
    if (!size) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    if (state.game === 'othello') {
      // 8x8 셀 격자 (칸 기준). 진한 녹색 라인.
      var ocell = size / SIZE;
      ctx.strokeStyle = 'rgba(12,60,30,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var oi = 0; oi <= SIZE; oi++) {
        var op = Math.round(oi * ocell) + 0.5;
        ctx.moveTo(op, 0.5); ctx.lineTo(op, size - 0.5);
        ctx.moveTo(0.5, op); ctx.lineTo(size - 0.5, op);
      }
      ctx.stroke();
      // 표식 점 (격자 교차점)
      ctx.fillStyle = 'rgba(8,45,22,0.9)';
      OTHELLO_DOTS.forEach(function (d) {
        ctx.beginPath();
        ctx.arc(d[1] * ocell, d[0] * ocell, Math.max(2.5, ocell * 0.09), 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    var cell = size / (SIZE - 1);
    ctx.strokeStyle = 'rgba(60,40,20,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < SIZE; i++) {
      var p = Math.round(i * cell) + 0.5;
      ctx.moveTo(p, 0.5); ctx.lineTo(p, size - 0.5);
      ctx.moveTo(0.5, p); ctx.lineTo(size - 0.5, p);
    }
    ctx.stroke();
    // 화점
    ctx.fillStyle = 'rgba(50,32,15,0.9)';
    STAR_POINTS.forEach(function (sp) {
      ctx.beginPath();
      ctx.arc(sp[1] * cell, sp[0] * cell, Math.max(2.5, cell * 0.11), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function buildExcelGrid() {
    excelHeaders.innerHTML = '';
    boardCells.innerHTML = '';
    var U = excelUnit();
    // 모서리
    var corner = document.createElement('div');
    corner.className = 'col-head';
    corner.style.left = '0'; corner.style.top = '0';
    corner.style.width = U + '%'; corner.style.height = U + '%';
    excelHeaders.appendChild(corner);
    // 열 헤더 A..(A+SIZE-1)
    for (var c = 0; c < SIZE; c++) {
      var ch = document.createElement('div');
      ch.className = 'col-head';
      ch.style.left = (U * (c + 1)) + '%';
      ch.style.top = '0';
      ch.style.width = U + '%'; ch.style.height = U + '%';
      ch.textContent = String.fromCharCode(65 + c);
      excelHeaders.appendChild(ch);
    }
    // 행 헤더 1..SIZE
    for (var r = 0; r < SIZE; r++) {
      var rh = document.createElement('div');
      rh.className = 'row-head';
      rh.style.left = '0';
      rh.style.top = (U * (r + 1)) + '%';
      rh.style.width = U + '%'; rh.style.height = U + '%';
      rh.textContent = (r + 1);
      excelHeaders.appendChild(rh);
    }
    // 셀
    var last = lastRealMove();
    for (var rr = 0; rr < SIZE; rr++) {
      for (var cc = 0; cc < SIZE; cc++) {
        var cellDiv = document.createElement('div');
        cellDiv.className = 'grid-cell';
        if (last && last.row === rr && last.col === cc) cellDiv.className += ' last-move';
        cellDiv.style.left = (U * (cc + 1)) + '%';
        cellDiv.style.top = (U * (rr + 1)) + '%';
        cellDiv.style.width = U + '%';
        cellDiv.style.height = U + '%';
        boardCells.appendChild(cellDiv);
      }
    }
  }

  // (row,col) -> 픽셀 중심 {x,y,d(지름)}
  function stoneGeom(row, col) {
    var size = innerSize();
    if (state.theme === 'excel') {
      var u = size / (SIZE + 1);
      return {
        x: u * (col + 1.5),
        y: u * (row + 1.5),
        d: u * (state.game === 'othello' ? 0.8 : 0.68)
      };
    }
    if (state.game === 'othello') {
      var ocell = size / SIZE;
      return { x: (col + 0.5) * ocell, y: (row + 0.5) * ocell, d: ocell * 0.8 };
    }
    var cell = size / (SIZE - 1);
    return { x: col * cell, y: row * cell, d: cell * 0.9 };
  }

  function renderStones() {
    stonesLayer.innerHTML = '';
    var winSet = {};
    state.winStones.forEach(function (w) { winSet[w.row + ',' + w.col] = true; });
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = state.board[r][c];
        if (v === EMPTY) continue;
        var g = stoneGeom(r, c);
        var el = document.createElement('div');
        el.className = 'stone ' + colorStr(v);
        if (winSet[r + ',' + c]) el.className += ' win';
        el.style.left = g.x + 'px';
        el.style.top = g.y + 'px';
        el.style.width = g.d + 'px';
        el.style.height = g.d + 'px';
        stonesLayer.appendChild(el);
      }
    }
    // 마지막 착수 점 (기본 테마)
    if (state.theme !== 'excel' && state.moves.length && !state.winStones.length) {
      var last = state.moves[state.moves.length - 1];
      var lg = stoneGeom(last.row, last.col);
      var dot = document.createElement('div');
      dot.className = 'last-dot';
      dot.style.left = lg.x + 'px';
      dot.style.top = lg.y + 'px';
      stonesLayer.appendChild(dot);
    }
  }

  function shouldShowForbidden() {
    if (state.rule !== 'renju' || state.gameOver) return false;
    if (state.turn !== BLACK) return false;
    if (state.online) {
      return state.started && state.myColor === 'black';
    }
    return true;
  }

  function renderMarkers() {
    markersLayer.innerHTML = '';
    if (!shouldShowForbidden()) return;
    var pts = R.forbiddenPoints(state.board, 'renju');
    var size = innerSize();
    pts.forEach(function (p) {
      var g = stoneGeom(p.row, p.col);
      var m = document.createElement('div');
      m.className = 'forbidden-mark';
      m.textContent = '✕';
      m.style.left = g.x + 'px';
      m.style.top = g.y + 'px';
      m.style.fontSize = Math.max(10, size / (SIZE - 1) * 0.5) + 'px';
      markersLayer.appendChild(m);
    });
  }

  // ── 오델로 렌더링 ─────────────────────────────────────
  function renderDiscs() {
    stonesLayer.innerHTML = '';
    var flipSet = {};
    (state.lastFlipped || []).forEach(function (f) { flipSet[f[0] + ',' + f[1]] = true; });
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = state.board[r][c];
        if (v === EMPTY) continue;
        var g = stoneGeom(r, c);
        var el = document.createElement('div');
        el.className = 'disc ' + colorStr(v);
        if (flipSet[r + ',' + c]) el.className += ' flip';
        el.style.left = g.x + 'px';
        el.style.top = g.y + 'px';
        el.style.width = g.d + 'px';
        el.style.height = g.d + 'px';
        stonesLayer.appendChild(el);
      }
    }
    // 마지막 착수 표식 (기본 테마)
    if (state.theme !== 'excel') {
      var last = lastRealMove();
      if (last) {
        var lg = stoneGeom(last.row, last.col);
        var mk = document.createElement('div');
        mk.className = 'othello-last';
        mk.style.left = lg.x + 'px';
        mk.style.top = lg.y + 'px';
        mk.style.width = lg.d + 'px';
        mk.style.height = lg.d + 'px';
        stonesLayer.appendChild(mk);
      }
    }
  }

  function shouldShowOthelloHints() {
    if (state.gameOver) return false;
    if (state.online) {
      return state.started && state.turn === colorNum(state.myColor);
    }
    return true;
  }

  function renderOthelloHints() {
    markersLayer.innerHTML = '';
    if (!shouldShowOthelloHints()) return;
    var moves = O.legalMoves(state.board, state.turn);
    moves.forEach(function (m) {
      var g = stoneGeom(m.row, m.col);
      var dot = document.createElement('div');
      dot.className = 'move-hint';
      dot.style.left = g.x + 'px';
      dot.style.top = g.y + 'px';
      dot.style.width = (g.d * 0.32) + 'px';
      dot.style.height = (g.d * 0.32) + 'px';
      markersLayer.appendChild(dot);
    });
  }

  function renderBoard() {
    if (state.theme === 'excel') {
      buildExcelGrid();
    } else {
      drawLines();
    }
    if (state.game === 'othello') {
      renderDiscs();
      renderOthelloHints();
    } else {
      renderStones();
      renderMarkers();
    }
  }

  // ============================================================
  // 사이드바 / 정보 갱신
  // ============================================================
  function updateSidebar() {
    // 플레이어 카드 active
    $('playerBlack').classList.toggle('active', !state.gameOver && state.turn === BLACK);
    $('playerWhite').classList.toggle('active', !state.gameOver && state.turn === WHITE);

    // 상태 텍스트
    function pstat(color) {
      if (state.gameOver) return '게임 종료';
      if (!state.started && state.online) return '대기 중';
      return state.turn === color ? '생각 중...' : '대기 중';
    }
    $('statusBlack').textContent = pstat(BLACK);
    $('statusWhite').textContent = pstat(WHITE);

    // 타이머
    $('timerBlack').textContent = fmtTime(state.times[BLACK]);
    $('timerWhite').textContent = fmtTime(state.times[WHITE]);

    // 현재 차례
    $('turnStone').className = 'stone-icon small ' + colorStr(state.turn);
    $('turnText').textContent = state.turn === BLACK ? '흑돌' : '백돌';

    // 게임 상태
    var gs = '진행 중';
    if (state.winner === 0) gs = '무승부';
    else if (state.winner === BLACK) gs = '흑돌 승리';
    else if (state.winner === WHITE) gs = '백돌 승리';
    $('gameStateText').textContent = gs;

    // 오델로 점수 표시
    var scoreRow = $('scoreRow');
    if (scoreRow) {
      if (state.game === 'othello') {
        scoreRow.hidden = false;
        var cnt = O.counts(state.board);
        state.othelloCounts = cnt;
        $('scoreBlack').textContent = cnt.black;
        $('scoreWhite').textContent = cnt.white;
      } else {
        scoreRow.hidden = true;
      }
    }

    // 온라인 태그
    if (state.online && state.started) {
      var meBlack = state.myColor === 'black';
      $('tagBlack').textContent = meBlack ? '(나)' : '(상대)';
      $('tagWhite').textContent = meBlack ? '(상대)' : '(나)';
    } else {
      $('tagBlack').textContent = '';
      $('tagWhite').textContent = '';
    }

    // 돌 바꾸기 버튼 (온라인 && 시작됨 && 착수 전 && 진행 중)
    updateSwapButton();

    // 엑셀 수식바
    updateExcelFormula();
  }

  function updateSwapButton() {
    var btn = $('btnSwap');
    if (!btn) return;
    var canSwap = state.online && state.started && !state.gameOver && state.moves.length === 0;
    btn.style.display = canSwap ? '' : 'none';
  }

  function setColorSelectDisabled(disabled) {
    Array.prototype.slice.call(document.querySelectorAll('input[name="myColor"]')).forEach(function (r) {
      r.disabled = disabled;
    });
  }

  function updateExcelFormula() {
    var nb = $('excelNameBox'), fx = $('excelFormula');
    if (!nb || !fx) return;
    var last = lastRealMove();
    if (last) {
      var lbl = excelCoordLabel(last.row, last.col);
      nb.textContent = lbl;
      var fn = state.game === 'othello' ? 'OTHELLO' : 'OMOK';
      fx.textContent = '=' + fn + '("' + (last.color === BLACK ? '흑돌' : '백돌') + '","' + lbl + '")';
    } else {
      nb.textContent = 'A1';
      fx.textContent = '';
    }
  }

  function renderMoveList() {
    var list = $('moveList');
    var empty = $('moveEmpty');
    // 기존 move-row 제거
    Array.prototype.slice.call(list.querySelectorAll('.move-row')).forEach(function (n) { n.remove(); });
    if (!state.moves.length) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    var seq = 0;
    state.moves.forEach(function (mv, i) {
      var row = document.createElement('div');
      row.className = 'move-row' + (i === state.moves.length - 1 ? ' latest' : '');
      var num = document.createElement('span');
      num.className = 'move-num';
      var icon = document.createElement('span');
      icon.className = 'stone-icon small ' + colorStr(mv.color);
      var name = document.createElement('span');
      var coord = document.createElement('span');
      coord.className = 'move-coord';

      if (state.game === 'othello' && mv.kind === 'pass') {
        num.textContent = '··';
        name.textContent = mv.color === BLACK ? '흑돌' : '백돌';
        coord.textContent = '패스';
      } else {
        seq++;
        num.textContent = (seq < 10 ? '0' : '') + seq + '.';
        name.textContent = mv.color === BLACK ? '흑돌' : '백돌';
        var label = coordLabel(mv.row, mv.col);
        if (state.game === 'othello' && mv.flipped) {
          label += ' (+' + mv.flipped.length + ')';
        }
        coord.textContent = label;
      }
      row.appendChild(num); row.appendChild(icon); row.appendChild(name); row.appendChild(coord);
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
  }

  // ============================================================
  // 타이머
  // ============================================================
  setInterval(function () {
    if (state.gameOver) return;
    if (state.online && !state.started) return;
    if (state.mode === 'local' && !state.moves.length && state.turn === BLACK) {
      // 로컬은 시작 전에도 흑 시간 흐름 허용 (선택). 여기선 첫 착수 전에도 카운트.
    }
    state.times[state.turn] = (state.times[state.turn] || 0) + 1;
    $('timerBlack').textContent = fmtTime(state.times[BLACK]);
    $('timerWhite').textContent = fmtTime(state.times[WHITE]);
  }, 1000);

  // ============================================================
  // 게임 로직 (공통)
  // ============================================================
  function getWinningStones(board, r, c, color, rule) {
    var res = [];
    for (var d = 0; d < R.DIRECTIONS.length; d++) {
      var dr = R.DIRECTIONS[d][0], dc = R.DIRECTIONS[d][1];
      var cells = [{ row: r, col: c }];
      var i = r + dr, j = c + dc;
      while (i >= 0 && i < SIZE && j >= 0 && j < SIZE && board[i][j] === color) { cells.push({ row: i, col: j }); i += dr; j += dc; }
      i = r - dr; j = c - dc;
      while (i >= 0 && i < SIZE && j >= 0 && j < SIZE && board[i][j] === color) { cells.push({ row: i, col: j }); i -= dr; j -= dc; }
      var need = (rule === 'renju' && color === BLACK) ? (cells.length === 5) : (cells.length >= 5);
      if (need) return cells;
    }
    return res;
  }

  function applyMove(row, col, color) {
    state.board[row][col] = color;
    state.moves.push({ row: row, col: col, color: color });
  }

  function finishWin(row, col, color) {
    state.gameOver = true;
    state.winner = color;
    state.winStones = getWinningStones(state.board, row, col, color, state.rule);
    renderBoard();
    updateSidebar();
    showResultModal(color);
  }

  function finishDraw() {
    state.gameOver = true;
    state.winner = 0;
    updateSidebar();
    showResultModal(0);
  }

  // ── 오델로 로직 ───────────────────────────────────────
  function finishOthello(winner, cnt) {
    state.gameOver = true;
    state.winner = winner;
    if (cnt) state.othelloCounts = cnt;
    renderBoard();
    updateSidebar();
    showResultModal(winner, state.othelloCounts);
  }

  // 오델로 로컬 착수
  function tryLocalPlaceOthello(row, col) {
    if (state.gameOver) return;
    var color = state.turn;
    var res = O.applyMove(state.board, row, col, color);
    if (!res) { toast('둘 수 없는 자리입니다'); return; }
    state.board = res.board;
    state.lastFlipped = res.flipped;
    state.moves.push({ kind: 'move', row: row, col: col, color: color, flipped: res.flipped });
    advanceOthelloTurn(color);
  }

  // 착수 후 턴 전환 + 패스/종료 처리 (mover = 방금 둔 색)
  function advanceOthelloTurn(mover) {
    var opp = otherColor(mover);
    var oppHas = O.hasAnyMove(state.board, opp);
    var meHas = O.hasAnyMove(state.board, mover);
    if (!oppHas && !meHas) {
      finishOthello(O.winner(state.board), O.counts(state.board));
      renderMoveList();
      return;
    }
    if (!oppHas) {
      // 상대가 둘 곳 없음 -> 패스, 턴 유지
      state.moves.push({ kind: 'pass', color: opp });
      state.turn = mover;
      toast('상대가 둘 곳이 없어 차례를 넘깁니다');
    } else {
      state.turn = opp;
    }
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 오델로 원격 착수 반영
  function applyRemoteMoveOthello(msg) {
    var color = colorNum(msg.color);
    state.board[msg.row][msg.col] = color;
    (msg.flipped || []).forEach(function (f) { state.board[f[0]][f[1]] = color; });
    state.lastFlipped = msg.flipped || [];
    state.moves.push({ kind: 'move', row: msg.row, col: msg.col, color: color, flipped: msg.flipped || [] });
    if (msg.passed) {
      var pc = colorNum(msg.passColor);
      state.moves.push({ kind: 'pass', color: pc });
      if (pc === colorNum(state.myColor)) toast('둘 곳이 없어 차례가 넘어갑니다');
    }
    if (msg.over) {
      finishOthello(msg.winner, msg.counts);
      renderMoveList();
      return;
    }
    state.turn = colorNum(msg.nextTurn);
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 오델로 로컬 무르기 (뒤집힘 복원)
  function localUndoOthello() {
    while (state.moves.length && state.moves[state.moves.length - 1].kind === 'pass') {
      state.moves.pop();
    }
    if (!state.moves.length) return;
    var m = state.moves.pop();
    var opp = otherColor(m.color);
    state.board[m.row][m.col] = EMPTY;
    (m.flipped || []).forEach(function (f) { state.board[f[0]][f[1]] = opp; });
    state.turn = m.color;
    state.lastFlipped = [];
    state.gameOver = false;
    state.winner = null;
    hideModal();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 오델로 원격 무르기 (서버 권위 보드 반영)
  function remoteUndoOthello(msg) {
    if (msg.board) {
      state.board = msg.board;
    }
    // 기보 미러링: 후행 패스 + 실착수 1개 제거
    while (state.moves.length && state.moves[state.moves.length - 1].kind === 'pass') {
      state.moves.pop();
    }
    if (state.moves.length) state.moves.pop();
    state.turn = msg.turn ? colorNum(msg.turn) : state.turn;
    state.lastFlipped = [];
    state.gameOver = false;
    state.winner = null;
    hideModal();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 로컬 착수 시도
  function tryLocalPlace(row, col) {
    if (state.gameOver) return;
    if (state.board[row][col] !== EMPTY) return;
    if (state.rule === 'renju' && state.turn === BLACK) {
      var t = R.forbiddenType(state.board, row, col);
      if (t) { toast(R.FORBIDDEN_LABEL[t]); return; }
    }
    var color = state.turn;
    applyMove(row, col, color);
    var win = R.checkWinAt(state.board, row, col, color, state.rule);
    if (win) { finishWin(row, col, color); renderMoveList(); return; }
    if (state.moves.length === SIZE * SIZE) { finishDraw(); renderMoveList(); return; }
    state.turn = color === BLACK ? WHITE : BLACK;
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 온라인 원격 착수 반영
  function applyRemoteMove(row, col, cstr, win) {
    var color = colorNum(cstr);
    applyMove(row, col, color);
    if (win) { finishWin(row, col, color); renderMoveList(); return; }
    if (state.moves.length === SIZE * SIZE) { finishDraw(); renderMoveList(); return; }
    state.turn = color === BLACK ? WHITE : BLACK;
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // ============================================================
  // 클릭 처리
  // ============================================================
  function overlayToCell(e) {
    var rect = clickOverlay.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var size = rect.width;
    if (state.theme === 'excel') {
      var u = size / (SIZE + 1);
      if (x < u || y < u) return null; // 헤더 영역
      var col = Math.floor((x - u) / u);
      var row = Math.floor((y - u) / u);
      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
      return { row: row, col: col };
    }
    if (state.game === 'othello') {
      var ocell = size / SIZE;
      var oc = Math.floor(x / ocell);
      var orow = Math.floor(y / ocell);
      if (orow < 0 || orow >= SIZE || oc < 0 || oc >= SIZE) return null;
      return { row: orow, col: oc };
    }
    var cell = size / (SIZE - 1);
    var col2 = Math.round(x / cell);
    var row2 = Math.round(y / cell);
    if (row2 < 0 || row2 >= SIZE || col2 < 0 || col2 >= SIZE) return null;
    return { row: row2, col: col2 };
  }

  clickOverlay.addEventListener('click', function (e) {
    var cell = overlayToCell(e);
    if (!cell) return;
    if (state.online) {
      if (!state.started || state.gameOver) return;
      if (state.turn !== colorNum(state.myColor)) { toast('상대 차례입니다'); return; }
      if (state.game === 'othello') {
        if (O.flipsFor(state.board, cell.row, cell.col, state.turn).length === 0) {
          toast('둘 수 없는 자리입니다');
          return;
        }
        wsSend({ type: 'move', row: cell.row, col: cell.col });
        return;
      }
      if (state.board[cell.row][cell.col] !== EMPTY) return;
      if (state.rule === 'renju' && state.turn === BLACK) {
        var t = R.forbiddenType(state.board, cell.row, cell.col);
        if (t) { toast(R.FORBIDDEN_LABEL[t]); return; }
      }
      wsSend({ type: 'move', row: cell.row, col: cell.col });
    } else {
      if (state.game === 'othello') {
        tryLocalPlaceOthello(cell.row, cell.col);
      } else {
        tryLocalPlace(cell.row, cell.col);
      }
    }
  });

  // ============================================================
  // 모달 / 토스트
  // ============================================================
  function showResultModal(winner, counts) {
    var modal = $('resultModal');
    var stone = $('modalStone'), title = $('modalTitle'), msg = $('modalMessage');
    var scoreStr = '';
    if (state.game === 'othello' && counts) {
      scoreStr = ' (' + counts.black + ' : ' + counts.white + ')';
    }
    if (winner === 0) {
      stone.className = 'modal-stone draw';
      title.textContent = '무승부!' + scoreStr;
      msg.textContent = state.game === 'othello'
        ? '돌 개수가 같습니다. 막상막하의 승부였네요.'
        : '바둑판이 가득 찼습니다. 우열을 가리지 못했네요.';
    } else {
      stone.className = 'modal-stone ' + colorStr(winner);
      title.textContent = (winner === BLACK ? '흑돌' : '백돌') + ' 승리!' + scoreStr;
      if (state.online) {
        var iWon = state.myColor === colorStr(winner);
        msg.textContent = iWon ? '축하합니다! 승리하셨습니다.' : '아쉽네요. 다음 판을 노려보세요.';
      } else {
        msg.textContent = '멋진 대국이었습니다.';
      }
    }
    modal.hidden = false;
  }
  function hideModal() { $('resultModal').hidden = true; }

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 1600);
  }

  // ============================================================
  // 리셋 / 무르기 / 새 게임
  // ============================================================
  function resetGameState(swapColorsInfo) {
    state.board = newBoard();
    state.moves = [];
    state.turn = BLACK;
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    state.lastFlipped = [];
    state.times = { 1: 0, 2: 0 };
    hideModal();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  function localNewGame() {
    resetGameState();
  }

  function flipReset(afterFn) {
    boardFlip.classList.add('flipping');
    setTimeout(function () {
      if (afterFn) afterFn();
      boardFlip.classList.remove('flipping');
    }, 800);
  }

  function localUndo() {
    if (state.game === 'othello') { localUndoOthello(); return; }
    if (!state.moves.length) return;
    var last = state.moves.pop();
    state.board[last.row][last.col] = EMPTY;
    // 게임 종료 상태였다면 재개
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    hideModal();
    state.turn = last.color; // 무른 사람 차례로 복귀
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // ============================================================
  // 버튼 바인딩
  // ============================================================
  $('btnNewGame').addEventListener('click', function () {
    if (state.online) {
      if (!state.started) { toast('상대를 기다리는 중입니다'); return; }
      wsSend({ type: 'restartRequest' });
      toast('상대에게 새 게임을 요청했습니다');
    } else {
      localNewGame();
    }
  });

  $('btnUndo').addEventListener('click', function () {
    if (state.online) {
      if (!state.started || !state.moves.length) return;
      wsSend({ type: 'undoRequest' });
      toast('상대에게 무르기를 요청했습니다');
    } else {
      localUndo();
    }
  });

  $('btnReset').addEventListener('click', function () {
    if (state.online) {
      if (!state.started) { toast('상대를 기다리는 중입니다'); return; }
      wsSend({ type: 'restartRequest' });
      toast('상대에게 새 게임을 요청했습니다');
      return;
    }
    flipReset(function () { resetGameState(); });
  });

  $('btnPlayAgain').addEventListener('click', function () {
    if (state.online) {
      wsSend({ type: 'restartRequest' });
      toast('상대에게 새 게임을 요청했습니다');
      hideModal();
    } else {
      localNewGame();
    }
  });

  // ============================================================
  // 규칙 선택
  // ============================================================
  Array.prototype.slice.call(document.querySelectorAll('input[name="rule"]')).forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (state.online) return; // 온라인은 방 생성자가 결정
      state.rule = radio.value;
      localStorage.setItem('omok_rule', state.rule);
      renderBoard();
    });
  });

  function applyRuleUI() {
    var radios = document.querySelectorAll('input[name="rule"]');
    Array.prototype.slice.call(radios).forEach(function (rr) {
      rr.checked = rr.value === state.rule;
      rr.disabled = state.online;
    });
  }

  // ============================================================
  // 게임 선택 (오목 / 오델로)
  // ============================================================
  Array.prototype.slice.call(document.querySelectorAll('input[name="game"]')).forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (state.online) return; // 온라인은 방 생성자가 결정
      if (radio.value === state.game) return;
      setGame(radio.value);
    });
  });

  function applyGameUI() {
    var radios = document.querySelectorAll('input[name="game"]');
    Array.prototype.slice.call(radios).forEach(function (rr) {
      rr.checked = rr.value === state.game;
      rr.disabled = state.online;
    });
  }

  // 게임 종류에 따른 레이아웃/보드 크기/타이틀 반영 (리셋은 별도)
  function applyGameLayout() {
    SIZE = boardSize();
    document.body.classList.toggle('game-othello', state.game === 'othello');
    var ruleRow = $('ruleRow');
    if (ruleRow) ruleRow.hidden = (state.game === 'othello');
    var title = document.querySelector('.site-title');
    var sub = document.querySelector('.site-subtitle');
    if (title) title.textContent = state.game === 'othello' ? '오델로' : '오목';
    if (sub) sub.textContent = '온라인 2인용 대국';
    document.title = (state.game === 'othello' ? '오델로' : '오목') + ' · 온라인 2인용 대국';
    applyGameUI();
  }

  // 게임 전환 (로컬): 레이아웃 적용 후 현재 판 리셋
  function setGame(game) {
    state.game = game;
    localStorage.setItem('omok_game', game);
    applyGameLayout();
    resetGameState();
  }

  // ============================================================
  // 모드 탭
  // ============================================================
  Array.prototype.slice.call(document.querySelectorAll('.mode-tab')).forEach(function (tab) {
    tab.addEventListener('click', function () {
      var mode = tab.getAttribute('data-mode');
      if (mode === state.mode) return;
      switchMode(mode);
    });
  });

  function switchMode(mode) {
    // 온라인 -> 로컬 전환 시 소켓 정리
    if (state.mode === 'online' && mode === 'local') {
      closeSocket();
    }
    state.mode = mode;
    state.online = (mode === 'online');
    Array.prototype.slice.call(document.querySelectorAll('.mode-tab')).forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-mode') === mode);
    });
    $('onlineLobby').hidden = (mode !== 'online');
    $('chatCard').hidden = (mode !== 'online');
    if (mode === 'online') {
      state.started = false;
      state.myColor = null;
      state.roomCode = null;
      $('roomInfo').hidden = true;
      resetLobbyActions();
    }
    applyRuleUI();
    applyGameUI();
    resetGameState();
  }

  function resetLobbyActions() {
    $('btnCreateRoom').disabled = false;
    $('btnJoinRoom').disabled = false;
    $('joinCodeInput').disabled = false;
    setColorSelectDisabled(false);
  }

  // ============================================================
  // 온라인 / WebSocket
  // ============================================================
  function wsUrl() {
    return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
  }

  function connectSocket(onOpen) {
    if (state.ws && state.connected) { if (onOpen) onOpen(); return; }
    state.intentionalClose = false;
    var ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.onopen = function () {
      state.connected = true;
      if (onOpen) onOpen();
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleServerMessage(msg);
    };
    ws.onclose = function () {
      state.connected = false;
      if (!state.intentionalClose && state.online) {
        $('roomStatusText').textContent = '연결 끊김';
        toast('서버 연결이 끊겼습니다');
      }
    };
    ws.onerror = function () {};
  }

  function closeSocket() {
    state.intentionalClose = true;
    if (state.ws) { try { state.ws.close(); } catch (e) {} }
    state.ws = null;
    state.connected = false;
    state.started = false;
  }

  function wsSend(obj) {
    if (state.ws && state.connected) state.ws.send(JSON.stringify(obj));
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'created':
        state.myColor = msg.color; // black
        state.roomCode = msg.code;
        state.rule = msg.rule;
        if (msg.game) { state.game = msg.game; applyGameLayout(); }
        applyRuleUI();
        resetGameStateKeepOnline();
        $('roomInfo').hidden = false;
        $('roomCodeText').textContent = msg.code;
        $('roomStatusText').textContent = '상대를 기다리는 중...';
        $('btnCreateRoom').disabled = true;
        $('btnJoinRoom').disabled = true;
        $('joinCodeInput').disabled = true;
        setColorSelectDisabled(true);
        break;

      case 'joined':
        state.myColor = msg.color; // white
        state.roomCode = msg.code;
        state.rule = msg.rule;
        if (msg.game) { state.game = msg.game; applyGameLayout(); }
        applyRuleUI();
        resetGameStateKeepOnline();
        $('roomInfo').hidden = false;
        $('roomCodeText').textContent = msg.code;
        $('btnCreateRoom').disabled = true;
        $('btnJoinRoom').disabled = true;
        $('joinCodeInput').disabled = true;
        setColorSelectDisabled(true);
        break;

      case 'start':
        state.started = true;
        state.rule = msg.rule;
        if (msg.game) { state.game = msg.game; applyGameLayout(); }
        state.turn = BLACK;
        applyRuleUI();
        resetGameStateKeepOnline();
        $('roomStatusText').textContent = '대국 시작! ' +
          (state.myColor === 'black' ? '당신은 흑돌입니다.' : '당신은 백돌입니다.');
        addChatSystem('상대가 입장했습니다. 대국을 시작합니다.');
        break;

      case 'move':
        if (msg.game === 'othello' || state.game === 'othello') {
          applyRemoteMoveOthello(msg);
        } else {
          applyRemoteMove(msg.row, msg.col, msg.color, msg.win);
        }
        break;

      case 'invalid':
        if (msg.reason === 'forbidden' && msg.ftype) toast(R.FORBIDDEN_LABEL[msg.ftype] || '금수입니다');
        else if (msg.reason === 'illegal') toast('둘 수 없는 자리입니다');
        break;

      case 'chat':
        addChatBubble(msg.text, msg.from === state.myColor);
        break;

      case 'undoRequest':
        showConfirm('상대가 무르기를 요청했습니다. 수락할까요?', function (ok) {
          wsSend({ type: 'undoResponse', accept: ok });
          if (!ok) addChatSystem('무르기를 거절했습니다.');
        });
        break;

      case 'undo':
        if (msg.game === 'othello' || state.game === 'othello') {
          remoteUndoOthello(msg);
        } else {
          remoteUndo();
        }
        addChatSystem('무르기가 적용되었습니다.');
        break;

      case 'undoRejected':
        toast('상대가 무르기를 거절했습니다');
        break;

      case 'swapRequest':
        showConfirm('상대가 돌 바꾸기를 요청했습니다. 수락하시겠습니까?', function (ok) {
          wsSend({ type: 'swapResponse', accept: ok });
          if (!ok) addChatSystem('돌 바꾸기를 거절했습니다.');
        });
        break;

      case 'swapped':
        state.myColor = msg.color;
        state.turn = BLACK;
        // 착수 전이므로 보드는 비어있음. 색/라벨/금수표시 갱신.
        renderBoard();
        updateSidebar();
        addChatSystem('돌을 바꿨습니다. (나: ' + (state.myColor === 'black' ? '흑돌' : '백돌') + ')');
        $('roomStatusText').textContent = '대국 시작! ' +
          (state.myColor === 'black' ? '당신은 흑돌입니다.' : '당신은 백돌입니다.');
        break;

      case 'swapRejected':
        toast('상대가 거절했습니다');
        break;

      case 'restartRequest':
        showConfirm('상대가 새 게임을 요청했습니다. 수락할까요?', function (ok) {
          wsSend({ type: 'restartResponse', accept: ok });
          if (!ok) addChatSystem('새 게임을 거절했습니다.');
        });
        break;

      case 'restart':
        state.myColor = msg.color;
        state.turn = BLACK;
        resetGameStateKeepOnline();
        addChatSystem('새 게임을 시작합니다. 색이 교대되었습니다.');
        $('roomStatusText').textContent = '대국 시작! ' +
          (state.myColor === 'black' ? '당신은 흑돌입니다.' : '당신은 백돌입니다.');
        break;

      case 'restartRejected':
        toast('상대가 새 게임을 거절했습니다');
        break;

      case 'opponentLeft':
        state.started = false;
        addChatSystem('상대가 퇴장했습니다.');
        toast('상대가 나갔습니다');
        $('roomStatusText').textContent = '상대가 나갔습니다. 로비로 돌아가세요.';
        break;

      case 'error':
        toast(msg.message || '오류가 발생했습니다');
        break;

      default:
        break;
    }
  }

  function resetGameStateKeepOnline() {
    state.board = newBoard();
    state.moves = [];
    state.turn = BLACK;
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    state.lastFlipped = [];
    state.times = { 1: 0, 2: 0 };
    hideModal();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  function remoteUndo() {
    if (!state.moves.length) return;
    var last = state.moves.pop();
    state.board[last.row][last.col] = EMPTY;
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    hideModal();
    state.turn = last.color;
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 방 만들기 / 참가
  $('btnCreateRoom').addEventListener('click', function () {
    var rule = document.querySelector('input[name="rule"]:checked').value;
    var colorEl = document.querySelector('input[name="myColor"]:checked');
    var color = colorEl ? colorEl.value : 'black';
    state.rule = rule;
    var game = state.game;
    connectSocket(function () {
      wsSend({ type: 'create', rule: rule, color: color, game: game });
    });
  });

  $('btnSwap').addEventListener('click', function () {
    if (!state.online || !state.started) return;
    if (state.gameOver || state.moves.length > 0) {
      toast('이미 착수하여 돌을 바꿀 수 없습니다');
      return;
    }
    wsSend({ type: 'swapRequest' });
    toast('상대에게 돌 바꾸기를 요청했습니다');
  });

  $('btnJoinRoom').addEventListener('click', function () {
    var code = $('joinCodeInput').value.toUpperCase().trim();
    if (code.length !== 6) { toast('6자리 코드를 입력하세요'); return; }
    connectSocket(function () {
      wsSend({ type: 'join', code: code });
    });
  });

  $('btnCopyCode').addEventListener('click', function () {
    var code = $('roomCodeText').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast('코드를 복사했습니다'); },
        function () { toast('복사 실패'); });
    } else {
      toast('코드: ' + code);
    }
  });

  $('joinCodeInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('btnJoinRoom').click();
  });

  // ============================================================
  // 채팅
  // ============================================================
  function addChatBubble(text, isMe) {
    var list = $('chatList');
    var b = document.createElement('div');
    b.className = 'chat-bubble ' + (isMe ? 'me' : 'them');
    b.innerHTML = esc(text);
    list.appendChild(b);
    list.scrollTop = list.scrollHeight;
  }
  function addChatSystem(text) {
    var list = $('chatList');
    var b = document.createElement('div');
    b.className = 'chat-system';
    b.innerHTML = esc(text);
    list.appendChild(b);
    list.scrollTop = list.scrollHeight;
  }
  function sendChat() {
    var input = $('chatInput');
    var text = input.value.trim();
    if (!text) return;
    if (!state.online || !state.connected) { toast('온라인 대전에서만 사용할 수 있습니다'); return; }
    wsSend({ type: 'chat', text: text.slice(0, 500) });
    input.value = '';
  }
  $('btnSendChat').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChat();
  });

  // ============================================================
  // 확인 다이얼로그 (간단 구현 - 토스트+버튼 대신 confirm 사용)
  // ============================================================
  function showConfirm(message, cb) {
    // 브라우저 confirm 사용 (동기). 온라인 상호작용 단순화.
    var ok = window.confirm(message);
    cb(ok);
  }

  // ============================================================
  // 테마
  // ============================================================
  function applyTheme(theme) {
    state.theme = theme;
    document.body.classList.toggle('theme-excel', theme === 'excel');
    $('themeToggle').textContent = '🎨 테마: ' + (theme === 'excel' ? '엑셀' : '기본');
    localStorage.setItem('omok_theme', theme);
    // 보드 재렌더 (동일 경로)
    renderBoard();
    updateSidebar();
  }
  $('themeToggle').addEventListener('click', function () {
    applyTheme(state.theme === 'excel' ? 'default' : 'excel');
  });

  // ============================================================
  // 언어 선택 (드롭다운)
  // ============================================================
  var langSelect = $('langSelect');
  if (langSelect) {
    document.addEventListener('click', function (e) {
      if (langSelect.hasAttribute('open') && !langSelect.contains(e.target)) {
        langSelect.removeAttribute('open');
      }
    });
    var langOptionKo = $('langOptionKo');
    if (langOptionKo) {
      langOptionKo.addEventListener('click', function () {
        langSelect.removeAttribute('open');
      });
    }
  }

  // ============================================================
  // 리사이즈
  // ============================================================
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderBoard, 80);
  });

  // ============================================================
  // 초기화
  // ============================================================
  function init() {
    // 저장된 설정 복원
    var savedRule = localStorage.getItem('omok_rule');
    if (savedRule === 'free' || savedRule === 'renju') state.rule = savedRule;
    var savedGame = localStorage.getItem('omok_game');
    if (savedGame === 'othello' || savedGame === 'omok') state.game = savedGame;
    var savedTheme = localStorage.getItem('omok_theme');

    // 저장된 게임에 맞춰 보드/레이아웃 초기화
    SIZE = boardSize();
    state.board = newBoard();

    // 푸터
    var year = new Date().getFullYear();
    $('footerText').textContent = '© ' + year + ' 오목 미니 게임 온라인 플레이 | 친구를 초대하여 무료로 2인용 오목 게임을 즐겨보세요!';

    applyRuleUI();
    applyGameLayout();
    if (savedTheme === 'excel') applyTheme('excel');
    else applyTheme('default');

    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 폰트/레이아웃 안정화 후 렌더
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
  window.addEventListener('load', function () { renderBoard(); });
})();
