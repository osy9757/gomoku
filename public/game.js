/* ============================================================
   game.js — 오목 클라이언트 (보드/규칙UI/모드/웹소켓/채팅/테마)
   rules.js(window.Rules)에 순수 규칙 로직 의존.
   ============================================================ */
(function () {
  'use strict';

  var R = window.Rules;
  var O = window.Othello;
  var C = window.Connect4;
  var K = window.Cards;         // 카드 공용 유틸 (덱/표기/족보)
  var P = window.SevenPoker;    // 맞포커 엔진 (로컬 핫시트에서 직접 구동)
  var BLACK = R.BLACK, WHITE = R.WHITE, EMPTY = R.EMPTY; // 세 게임 공통 (1,2,0)
  // 보드는 더 이상 정사각이 아니다 (사목 6행 x 7열).
  // 행/열을 따로 들고 다닌다. 오목/오델로는 ROWS === COLS.
  var ROWS = R.BOARD_SIZE, COLS = R.BOARD_SIZE;
  var STAR_POINTS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
  // 오델로 보드 표식 위치(격자 교차점 기준)
  var OTHELLO_DOTS = [[2, 2], [2, 6], [6, 2], [6, 6]];

  // 지원 종목 (순서 = 선택 UI 표시 순서)
  var GAMES = ['omok', 'othello', 'connect4', 'matpoker', 'poker'];
  var GAME_LABEL = {
    omok: '오목', othello: '오델로', connect4: '사목',
    matpoker: '맞포커', poker: '포커'
  };
  // 카드 게임: 보드 대신 카드 테이블(#cardTable)을 쓰는 종목
  var CARD_GAMES = ['matpoker', 'poker'];
  function isCardGame(g) { return CARD_GAMES.indexOf(g || state.game) !== -1; }
  // 테이블 게임: 좌석이 2~6인인 종목 (온라인은 좌석제 방)
  function isTableGame(g) { return (g || state.game) === 'poker'; }
  // '게임 바꾸기'로 고를 수 있는 종목 (포커는 좌석제라 2인 방에서 못 바꾼다)
  var CHANGEABLE_GAMES = GAMES.filter(function (g) { return g !== 'poker'; });
  var SEAT_MIN = 2, SEAT_MAX = 6, SEAT_DEFAULT = 3;

  // 현재 게임의 규칙 모듈
  function curMod() {
    if (state.game === 'othello') return O;
    if (state.game === 'connect4') return C;
    return R;
  }
  function newBoard() { return curMod().createBoard(); }
  function boardRows(g) {
    g = g || state.game;
    if (g === 'othello') return O.BOARD_SIZE;
    if (g === 'connect4') return C.ROWS;
    return R.BOARD_SIZE;
  }
  function boardCols(g) {
    g = g || state.game;
    if (g === 'othello') return O.BOARD_SIZE;
    if (g === 'connect4') return C.COLS;
    return R.BOARD_SIZE;
  }
  function otherColor(c) { return c === BLACK ? WHITE : BLACK; }
  // 게임 종류 관련 라벨 (게임 바꾸기 UI 공용)
  function normGame(g) { return GAMES.indexOf(g) !== -1 ? g : 'omok'; }
  // 종목이 여러 개이므로 "반대 종목"은 하나가 아니라 목록이다.
  function otherGames(g) {
    var cur = normGame(g);
    return CHANGEABLE_GAMES.filter(function (x) { return x !== cur; });
  }
  function gameName(g) { return GAME_LABEL[normGame(g)]; }
  // 좌석 이름 (카드 게임 전용).
  //  · 맞포커(2인) — 온라인은 나/상대, 로컬은 플레이어 1/2
  //  · 포커(2~6인) — 온라인은 내 좌석만 '나', 나머지는 '플레이어 N'
  //    (좌석이 여러 개라 '상대'로는 구분이 안 된다)
  function seatName(i) {
    if (isTableGame()) {
      if (state.online && state.poker.seat === i) return '나';
      return '플레이어 ' + (i + 1);
    }
    if (state.online && state.poker.seat !== null) {
      return i === state.poker.seat ? '나' : '상대';
    }
    return '플레이어 ' + (i + 1);
  }
  // 공용 로그/모달에서 쓰는 이름 목록 (좌석 수만큼)
  function seatNames() {
    var n = pokerSeatCount();
    var a = [];
    for (var i = 0; i < n; i++) a.push('플레이어 ' + (i + 1));
    return a;
  }
  // 현재 좌석 수 (뷰가 있으면 뷰 기준, 없으면 로컬 인원 선택 값)
  function pokerSeatCount() {
    var v = state.poker.view;
    if (v && v.players) return v.players;
    if (!isTableGame()) return 2;
    if (state.online) return Math.max(1, state.poker.lobby.length);
    return state.poker.count;
  }
  // 돌 이름: 사목은 빨강/노랑, 카드 게임은 좌석 이름
  // (카드 게임에서는 흑돌/백돌이라는 말이 절대 화면에 나오면 안 된다)
  function colorName(c) {
    if (isCardGame()) return seatName(c === BLACK ? 0 : 1);
    if (state.game === 'connect4') return c === BLACK ? '빨강' : '노랑';
    return c === BLACK ? '흑돌' : '백돌';
  }

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
    game: 'omok',         // 'omok' | 'othello' | 'connect4'
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
    // 맞포커(카드 게임) 전용 상태
    poker: {
      local: null,     // 로컬 모드에서만: 엔진 전체 상태 (양쪽 패를 다 안다)
      view: null,      // 화면에 그리는 "시점 뷰" (상대 히든은 null)
      seat: 0,         // 온라인: 내 좌석 / 로컬: 0 기준
      viewer: null,    // 로컬 핫시트: 지금 화면을 봐도 되는 사람 (null = 전원 가림)
      gateFor: null,   // 가리개가 기다리는 플레이어
      log: [],         // 액션 로그 [{text, seq}]
      seq: 0,          // 판 안에서의 로그 번호 (판이 바뀌면 1부터)
      // 포커(2~6인) 전용
      count: SEAT_DEFAULT,  // 로컬 핫시트 인원 (2~6)
      lobby: [],       // 온라인 테이블 방 참가자 [{seat,name,isHost,chips}]
      hostSeat: 0,     // 온라인: 방장 좌석
      isHost: false,   // 온라인: 내가 방장인가
      canStart: false, // 온라인: 지금 시작할 수 있는가
      tableStarted: false  // 온라인: 매치가 시작됐는가
    },
    // online
    ws: null,
    connected: false,
    myColor: null,        // 'black'|'white'
    roomCode: null,
    online: false,
    inRoom: false,        // 온라인: 방을 만들었거나 참가한 상태(=설정 잠김)
    started: false,
    intentionalClose: false
  };

  // 엑셀 테마 단위(%) — 헤더 1칸 + 셀 COLS/ROWS.
  // 보드가 정사각이 아닐 수 있으므로 가로/세로 단위를 따로 계산한다.
  function excelUnitX() { return 100 / (COLS + 1); }
  function excelUnitY() { return 100 / (ROWS + 1); }

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
    if (state.game === 'connect4') {
      // 사목: 열 A-G + 행 1-6 (엑셀처럼 위에서 아래로). 맨 아랫줄이 6.
      return String.fromCharCode(65 + col) + (row + 1);
    }
    return String.fromCharCode(65 + col) + (ROWS - row);
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
  // 사목처럼 보드가 정사각이 아닌 경우를 위해 높이도 따로 잰다.
  function innerHeight() {
    return boardInner.getBoundingClientRect().height || 0;
  }

  function drawLines() {
    var size = innerSize();
    var vsize = innerHeight();
    if (!size || !vsize) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = vsize * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = vsize + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, vsize);

    if (state.game === 'connect4') {
      // 파란 판에 뚫린 "구멍"을 밝은 원으로 그린다. 돌은 그 위에 얹힌다.
      var cw = size / COLS, chh = vsize / ROWS;
      var hr = Math.min(cw, chh) * 0.40;
      for (var cr = 0; cr < ROWS; cr++) {
        for (var ccc = 0; ccc < COLS; ccc++) {
          var cx = (ccc + 0.5) * cw, cy = (cr + 0.5) * chh;
          ctx.beginPath();
          ctx.arc(cx, cy, hr, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(232, 240, 252, 0.95)';
          ctx.fill();
          ctx.lineWidth = Math.max(1, hr * 0.12);
          ctx.strokeStyle = 'rgba(12, 42, 92, 0.35)';
          ctx.stroke();
        }
      }
      return;
    }

    if (state.game === 'othello') {
      // 8x8 셀 격자 (칸 기준). 진한 녹색 라인.
      var ocell = size / COLS;
      ctx.strokeStyle = 'rgba(12,60,30,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var oi = 0; oi <= COLS; oi++) {
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

    var cell = size / (COLS - 1);
    ctx.strokeStyle = 'rgba(60,40,20,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < COLS; i++) {
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
    // 가로/세로 단위를 분리 (사목은 8열 x 7행이라 정사각이 아니다)
    var UX = excelUnitX(), UY = excelUnitY();
    // 모서리
    var corner = document.createElement('div');
    corner.className = 'col-head';
    corner.style.left = '0'; corner.style.top = '0';
    corner.style.width = UX + '%'; corner.style.height = UY + '%';
    excelHeaders.appendChild(corner);
    // 열 헤더 A..(A+COLS-1)
    for (var c = 0; c < COLS; c++) {
      var ch = document.createElement('div');
      ch.className = 'col-head';
      ch.style.left = (UX * (c + 1)) + '%';
      ch.style.top = '0';
      ch.style.width = UX + '%'; ch.style.height = UY + '%';
      ch.textContent = String.fromCharCode(65 + c);
      excelHeaders.appendChild(ch);
    }
    // 행 헤더 1..ROWS
    for (var r = 0; r < ROWS; r++) {
      var rh = document.createElement('div');
      rh.className = 'row-head';
      rh.style.left = '0';
      rh.style.top = (UY * (r + 1)) + '%';
      rh.style.width = UX + '%'; rh.style.height = UY + '%';
      rh.textContent = (r + 1);
      excelHeaders.appendChild(rh);
    }
    // 셀
    var last = lastRealMove();
    for (var rr = 0; rr < ROWS; rr++) {
      for (var cc = 0; cc < COLS; cc++) {
        var cellDiv = document.createElement('div');
        cellDiv.className = 'grid-cell';
        if (last && last.row === rr && last.col === cc) cellDiv.className += ' last-move';
        cellDiv.style.left = (UX * (cc + 1)) + '%';
        cellDiv.style.top = (UY * (rr + 1)) + '%';
        cellDiv.style.width = UX + '%';
        cellDiv.style.height = UY + '%';
        boardCells.appendChild(cellDiv);
      }
    }
  }

  // (row,col) -> 픽셀 중심 {x,y,d(지름)}
  // 보드가 정사각이 아닐 수 있으므로 가로/세로 셀 크기를 따로 구하고,
  // 돌 지름은 둘 중 작은 쪽을 기준으로 잡아 항상 칸 안에 들어가게 한다.
  function stoneGeom(row, col) {
    var size = innerSize(), vsize = innerHeight();
    if (state.theme === 'excel') {
      var ux = size / (COLS + 1), uy = vsize / (ROWS + 1);
      var ratio = state.game === 'omok' ? 0.68 : 0.8;
      return {
        x: ux * (col + 1.5),
        y: uy * (row + 1.5),
        d: Math.min(ux, uy) * ratio
      };
    }
    if (state.game === 'connect4') {
      var cw = size / COLS, chh = vsize / ROWS;
      return { x: (col + 0.5) * cw, y: (row + 0.5) * chh, d: Math.min(cw, chh) * 0.8 };
    }
    if (state.game === 'othello') {
      var ocell = size / COLS;
      return { x: (col + 0.5) * ocell, y: (row + 0.5) * ocell, d: ocell * 0.8 };
    }
    var cell = size / (COLS - 1);
    return { x: col * cell, y: row * cell, d: cell * 0.9 };
  }

  // ── 돌/디스크 키(keyed) 기반 diff 렌더링 ────────────────
  // 매 렌더마다 stonesLayer 를 비우고 다시 만들면, .stone 에 걸린 진입
  // 애니메이션(stone-in)이 판 위의 모든 돌에서 다시 재생되어 화면이
  // 통째로 깜빡인다(착수/리사이즈/테마 전환/승리 표시 전부). 그래서
  // (row,col) 키로 기존 요소를 찾아 위치·클래스만 갱신하고,
  // 정말로 새로 생긴 돌에만 진입 애니메이션을 준다.
  var pieceEls = Object.create(null);    // 'r,c' -> Element
  var pieceKind = '';                    // 'stone' | 'disc' | 'c4' | ''
  var overlayEls = Object.create(null);  // 'last-dot' | 'othello-last' | 'c4-last' -> Element
  // 진입 애니메이션 이름 (종류별). playEnter 가 종료 감지에 사용한다.
  var ENTER_ANIMS = ['stone-in', 'disc-in', 'c4-drop'];

  function clearPieces() {
    stonesLayer.innerHTML = '';
    pieceEls = Object.create(null);
    overlayEls = Object.create(null);
    pieceKind = '';
  }

  // 오목 <-> 오델로 처럼 요소 종류 자체가 바뀌면 레이어를 비우고 새로 시작
  function usePieceKind(kind) {
    if (pieceKind !== kind) {
      clearPieces();
      pieceKind = kind;
    }
  }

  function setPieceGeom(el, g) {
    el.style.left = g.x + 'px';
    el.style.top = g.y + 'px';
    el.style.width = g.d + 'px';
    el.style.height = g.d + 'px';
  }

  // 새로 만든 요소에만 진입 애니메이션(.enter). 끝나면 클래스를 떼어
  // 이후 클래스 변화(.win 부여/해제 등)로 다시 재생되지 않게 한다.
  function playEnter(el) {
    el.classList.add('enter');
    var done = function (e) {
      if (e && ENTER_ANIMS.indexOf(e.animationName) === -1) return;
      el.classList.remove('enter');
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
    // 진입 애니메이션이 아예 없는 환경(엑셀 테마 / 모션 최소화)에서는
    // animationend 가 오지 않는다. 그대로 두면 나중에 테마를 바꾸는 순간
    // .enter 가 살아 있어 뒤늦게 튀어나오므로, 두 프레임 뒤에 실제로
    // 애니메이션이 도는지 확인하고 돌지 않으면 즉시 클래스를 뗀다.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var running = true;
        if (typeof el.getAnimations === 'function') {
          running = el.getAnimations().some(function (a) {
            return ENTER_ANIMS.indexOf(a.animationName) !== -1;
          });
        }
        if (!running) done();
        else setTimeout(function () { done(); }, 600);   // animationend 유실 대비
      });
    });
  }

  // 이미 존재하는 요소에서 CSS 애니메이션을 다시 재생하려면
  // 클래스 제거 → 리플로우 강제 → 재부여 순서가 필요하다.
  function replayFlip(el) {
    el.classList.remove('flip');
    void el.offsetWidth;               // 리플로우 강제 (애니메이션 리셋)
    el.classList.add('flip');
    if (!el.__flipBound) {
      el.__flipBound = true;
      el.addEventListener('animationend', function (e) {
        if (e.animationName === 'disc-flip') el.classList.remove('flip');
      });
    }
  }

  // live 에 없는 칸(무르기/새 게임 등으로 비워진 칸)의 요소 제거
  function dropStalePieces(live) {
    Object.keys(pieceEls).forEach(function (k) {
      if (live[k]) return;
      var el = pieceEls[k];
      if (el && el.parentNode) el.parentNode.removeChild(el);
      delete pieceEls[k];
    });
  }

  // 마지막 착수 표식(.last-dot / .othello-last)도 재사용한다.
  function updateOverlay(cls, show, g, sized) {
    var el = overlayEls[cls];
    if (!show) {
      if (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
        delete overlayEls[cls];
      }
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      overlayEls[cls] = el;
      stonesLayer.appendChild(el);
    }
    el.style.left = g.x + 'px';
    el.style.top = g.y + 'px';
    if (sized) {
      el.style.width = g.d + 'px';
      el.style.height = g.d + 'px';
    }
  }

  function renderStones() {
    usePieceKind('stone');
    var winSet = {};
    state.winStones.forEach(function (w) { winSet[w.row + ',' + w.col] = true; });
    var live = Object.create(null);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = state.board[r][c];
        if (v === EMPTY) continue;
        var key = r + ',' + c;
        var g = stoneGeom(r, c);
        var won = !!winSet[key];
        var el = pieceEls[key];
        if (!el) {
          el = document.createElement('div');
          el.setAttribute('data-key', key);
          el.setAttribute('data-color', String(v));
          el.className = 'stone ' + colorStr(v) + (won ? ' win' : '');
          setPieceGeom(el, g);
          pieceEls[key] = el;
          stonesLayer.appendChild(el);
          // 승리 돌은 기존 동작대로 승리 펄스만 재생한다
          if (!won) playEnter(el);
        } else {
          if (el.getAttribute('data-color') !== String(v)) {
            el.setAttribute('data-color', String(v));
            el.classList.toggle('black', v === BLACK);
            el.classList.toggle('white', v === WHITE);
          }
          el.classList.toggle('win', won);
          setPieceGeom(el, g);
        }
        live[key] = true;
      }
    }
    dropStalePieces(live);
    // 마지막 착수 점 (기본 테마)
    var showDot = state.theme !== 'excel' && !!state.moves.length && !state.winStones.length;
    var last = showDot ? state.moves[state.moves.length - 1] : null;
    updateOverlay('last-dot', !!last, last ? stoneGeom(last.row, last.col) : null, false);
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
      m.style.fontSize = Math.max(10, size / (COLS - 1) * 0.5) + 'px';
      markersLayer.appendChild(m);
    });
  }

  // ── 오델로 렌더링 ─────────────────────────────────────
  function renderDiscs() {
    usePieceKind('disc');
    var flipSet = {};
    (state.lastFlipped || []).forEach(function (f) { flipSet[f[0] + ',' + f[1]] = true; });
    var live = Object.create(null);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = state.board[r][c];
        if (v === EMPTY) continue;
        var key = r + ',' + c;
        var g = stoneGeom(r, c);
        var el = pieceEls[key];
        if (!el) {
          el = document.createElement('div');
          el.setAttribute('data-key', key);
          el.setAttribute('data-color', String(v));
          el.className = 'disc ' + colorStr(v);
          setPieceGeom(el, g);
          pieceEls[key] = el;
          stonesLayer.appendChild(el);
          playEnter(el);
        } else {
          if (el.getAttribute('data-color') !== String(v)) {
            el.setAttribute('data-color', String(v));
            el.classList.toggle('black', v === BLACK);
            el.classList.toggle('white', v === WHITE);
            // 색이 "실제로" 바뀐 돌만 뒤집기 애니메이션.
            // 직전 착수로 뒤집힌 칸에 한정 (무르기/서버 동기화는 즉시 반영)
            if (flipSet[key]) replayFlip(el);
          }
          setPieceGeom(el, g);
        }
        live[key] = true;
      }
    }
    dropStalePieces(live);
    // 마지막 착수 표식 (기본 테마)
    var last = state.theme !== 'excel' ? lastRealMove() : null;
    updateOverlay('othello-last', !!last, last ? stoneGeom(last.row, last.col) : null, true);
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

  // ── 사목 렌더링 ───────────────────────────────────────
  // 오델로와 동일한 keyed diff 를 쓴다. 새로 떨어진 돌만 낙하 애니메이션이
  // 재생되고, 이미 놓인 돌은 요소가 그대로 재사용되어 깜빡이지 않는다.
  function renderConnect4() {
    usePieceKind('c4');
    var winSet = {};
    state.winStones.forEach(function (w) { winSet[w.row + ',' + w.col] = true; });
    var live = Object.create(null);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = state.board[r][c];
        if (v === EMPTY) continue;
        var key = r + ',' + c;
        var g = stoneGeom(r, c);
        var won = !!winSet[key];
        var el = pieceEls[key];
        if (!el) {
          el = document.createElement('div');
          el.setAttribute('data-key', key);
          el.setAttribute('data-color', String(v));
          el.className = 'c4-disc ' + colorStr(v) + (won ? ' win' : '');
          setPieceGeom(el, g);
          // 낙하 시작 위치: 그 열의 판 위쪽 바깥
          el.style.setProperty('--drop-from', (-(g.y + g.d)) + 'px');
          pieceEls[key] = el;
          stonesLayer.appendChild(el);
          playEnter(el);
        } else {
          if (el.getAttribute('data-color') !== String(v)) {
            el.setAttribute('data-color', String(v));
            el.classList.toggle('black', v === BLACK);
            el.classList.toggle('white', v === WHITE);
          }
          el.classList.toggle('win', won);
          setPieceGeom(el, g);
          el.style.setProperty('--drop-from', (-(g.y + g.d)) + 'px');
        }
        live[key] = true;
      }
    }
    dropStalePieces(live);
    var last = state.theme !== 'excel' ? lastRealMove() : null;
    updateOverlay('c4-last', !!last, last ? stoneGeom(last.row, last.col) : null, true);
  }

  function shouldShowConnect4Hints() {
    if (state.gameOver) return false;
    if (state.online) {
      return state.started && state.turn === colorNum(state.myColor);
    }
    return true;
  }

  // 각 열이 "떨어질 자리"를 옅게 표시한다 (오델로 합법수 힌트와 같은 요소).
  function renderConnect4Hints() {
    markersLayer.innerHTML = '';
    if (!shouldShowConnect4Hints()) return;
    C.legalColumns(state.board).forEach(function (m) {
      var g = stoneGeom(m.row, m.col);
      var dot = document.createElement('div');
      dot.className = 'move-hint';
      dot.style.left = g.x + 'px';
      dot.style.top = g.y + 'px';
      dot.style.width = (g.d * 0.42) + 'px';
      dot.style.height = (g.d * 0.42) + 'px';
      markersLayer.appendChild(dot);
    });
  }

  function renderBoard() {
    // 카드 게임은 보드를 그리지 않는다 (중앙 영역이 통째로 카드 테이블이다)
    if (isCardGame()) { renderCardTable(); return; }
    if (state.theme === 'excel') {
      buildExcelGrid();
    } else {
      drawLines();
    }
    if (state.game === 'othello') {
      renderDiscs();
      renderOthelloHints();
    } else if (state.game === 'connect4') {
      renderConnect4();
      renderConnect4Hints();
    } else {
      renderStones();
      renderMarkers();
    }
  }

  // ============================================================
  // 사이드바 / 정보 갱신
  // ============================================================
  // 카드 게임: 엔진 뷰에서 "현재 차례/종료" 를 사이드바 공용 상태로 옮긴다.
  // (turn 은 돌 색이 아니라 좌석 0/1 을 BLACK/WHITE 로 대응시킨 것뿐이다)
  function syncPokerTurn() {
    var v = state.poker.view;
    state.gameOver = !!(v && v.over);
    // 좌석이 2개인 경우에만 흑/백 두 칸짜리 사이드바에 대응시킨다.
    // 포커(2~6인)는 좌석 목록을 따로 그리므로 turn 을 건드리지 않는다.
    if (isTableGame()) return;
    var actor = pokerActor(v);
    if (actor !== null) state.turn = actor === 1 ? WHITE : BLACK;
  }

  // 판/매치 결과 한 줄 요약 (포커 전용 — 좌석이 여럿이라 문구가 다르다)
  function pokerResultShort(v) {
    if (!v || !v.over || !v.result) return null;
    if (v.matchOver) {
      return (v.matchWinner === null ? '' : seatName(v.matchWinner) + ' ') + '최종 우승';
    }
    var r = v.result;
    if (r.split) return '팟 분배';
    if (r.winner === null) return '판 종료';
    return seatName(r.winner) + ' 승리';
  }

  // 좌석 목록 (플레이어 정보 카드) — 포커에서 2칸짜리 카드를 대신한다
  function renderSeatList() {
    var host = $('seatList');
    if (!host) return;
    if (!isTableGame()) { host.innerHTML = ''; return; }
    var v = state.poker.view;
    var n = pokerSeatCount();
    var actor = pokerActor(v);
    host.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var st = pokerSeatState(v, i);
      var row = document.createElement('div');
      row.className = 'seat-row' + (actor === i ? ' active' : '') + (st ? ' gone' : '');
      row.setAttribute('data-seat', String(i));
      var icon = document.createElement('span');
      icon.className = 'stone-icon small ' + (i % 2 ? 'white' : 'black');
      var nm = document.createElement('span');
      nm.className = 'seat-name';
      nm.textContent = seatName(i) +
        (state.online && state.poker.hostSeat === i ? ' (방장)' : '') +
        (v && v.dealer === i ? ' · 딜러' : '');
      var sst = document.createElement('span');
      sst.className = 'seat-state';
      sst.textContent = st || (actor === i ? '생각 중...' : '');
      var chips = document.createElement('span');
      chips.className = 'seat-chips';
      chips.textContent = '🪙 ' + (v ? v.chips[i] : seatLobbyChips(i));
      row.appendChild(icon);
      row.appendChild(nm);
      row.appendChild(sst);
      row.appendChild(chips);
      host.appendChild(row);
    }
  }
  function seatLobbyChips(i) {
    var list = state.poker.lobby;
    for (var k = 0; k < list.length; k++) if (list[k].seat === i) return list[k].chips;
    return P.START_CHIPS;
  }

  function updateSidebar() {
    if (isCardGame()) syncPokerTurn();

    // 플레이어 카드 active
    $('playerBlack').classList.toggle('active', !state.gameOver && state.turn === BLACK);
    $('playerWhite').classList.toggle('active', !state.gameOver && state.turn === WHITE);

    // 상태 텍스트
    function pstat(color) {
      if (state.gameOver) return isCardGame() ? '판 종료' : '게임 종료';
      if (!state.started && state.online) return '대기 중';
      return state.turn === color ? '생각 중...' : '대기 중';
    }
    $('statusBlack').textContent = pstat(BLACK);
    $('statusWhite').textContent = pstat(WHITE);

    // 타이머 / 칩 (카드 게임은 타이머 대신 칩을 보여준다)
    if (isCardGame()) {
      var pv = state.poker.view;
      var pchips = pv ? pv.chips : [P.START_CHIPS, P.START_CHIPS];
      $('chipsBlack').textContent = '🪙 ' + pchips[0];
      $('chipsWhite').textContent = '🪙 ' + pchips[1];
    } else {
      $('timerBlack').textContent = fmtTime(state.times[BLACK]);
      $('timerWhite').textContent = fmtTime(state.times[WHITE]);
    }

    // 현재 차례 (포커는 좌석 이름)
    if (isTableGame()) {
      var tac = pokerActor(state.poker.view);
      $('turnStone').className = 'stone-icon small ' + (tac !== null && tac % 2 ? 'white' : 'black');
      $('turnText').textContent = tac === null ? '—' : seatName(tac);
    } else {
      $('turnStone').className = 'stone-icon small ' + colorStr(state.turn);
      $('turnText').textContent = colorName(state.turn);
    }

    // 플레이어 카드 이름 (사목은 빨강/노랑)
    $('nameBlack').textContent = colorName(BLACK);
    $('nameWhite').textContent = colorName(WHITE);

    // 게임 상태
    var gs = '진행 중';
    if (isTableGame()) {
      var tv = state.poker.view;
      if (tv && tv.over) gs = pokerResultShort(tv);
      else if (state.online && !state.started) gs = '대기 중';
    } else if (isCardGame()) {
      var pvw = state.poker.view;
      if (pvw && pvw.over && pvw.result) {
        if (pvw.matchOver) gs = seatName(pvw.matchWinner) + ' 최종 승리';
        else if (pvw.result.split) gs = '무승부 (팟 분배)';
        else gs = seatName(pvw.result.winner) + ' 승리';
      } else if (state.online && !state.started) {
        gs = '대기 중';
      }
    } else if (state.winner === 0) gs = '무승부';
    else if (state.winner === BLACK) gs = colorName(BLACK) + ' 승리';
    else if (state.winner === WHITE) gs = colorName(WHITE) + ' 승리';
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

    // 돌 바꾸기 / 게임 바꾸기 버튼 (온라인 && 시작됨 && 착수 전 && 진행 중)
    updateSwapButton();

    // 포커 좌석 목록
    renderSeatList();

    // 엑셀 수식바 / 상태바
    updateExcelFormula();
    updateExcelStatusBar();
  }

  // 방 안에서만 쓰는 합의형 컨트롤(돌 바꾸기 / 게임 바꾸기)의 표시 조건은 동일하다.
  // 종목이 3개라 "다음 종목"이 하나로 정해지지 않으므로, 나머지 두 종목을
  // 셀렉트로 고른 뒤 "변경 요청" 버튼을 누르는 형태로 만든다.
  function updateSwapButton() {
    var card = isCardGame();
    var table = isTableGame();
    // 돌 바꾸기는 카드 게임에 의미가 없다(좌석 고정) → 항상 숨김
    var canSwap = state.online && state.started && !state.gameOver &&
      state.moves.length === 0 && !card;
    var btn = $('btnSwap');
    if (btn) btn.style.display = canSwap ? '' : 'none';
    // 게임 바꾸기: 포커 테이블 방은 좌석/칩이 종목에 묶여 있어 아예 숨긴다.
    var canChange = table ? false : (card ? (state.online && state.started) : canSwap);
    var row = $('gameChangeRow');
    if (row) row.style.display = canChange ? '' : 'none';
    syncGameChangeOptions();
    renderTableLobby();
  }

  // ── 포커 테이블 로비 (방 안 참가자 목록 + 방장 시작 버튼) ──
  function renderTableLobby() {
    var box = $('tableLobbyBox');
    if (!box) return;
    var show = isTableGame() && state.online && state.inRoom;
    box.hidden = !show;
    if (!show) return;
    var list = $('tablePlayerList');
    list.innerHTML = '';
    state.poker.lobby.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'table-player';
      row.setAttribute('data-seat', String(p.seat));
      var nm = document.createElement('span');
      nm.className = 'tp-name';
      nm.textContent = p.name + (p.seat === state.poker.seat ? ' (나)' : '');
      row.appendChild(nm);
      if (p.isHost) {
        var h = document.createElement('span');
        h.className = 'tp-host';
        h.textContent = '방장';
        row.appendChild(h);
      }
      var c = document.createElement('span');
      c.className = 'tp-chips';
      c.textContent = '🪙 ' + p.chips;
      row.appendChild(c);
      list.appendChild(row);
    });
    $('tableLobbyCount').textContent = state.poker.lobby.length + ' / ' + SEAT_MAX;
    var btn = $('btnStartMatch');
    btn.hidden = !state.poker.isHost;
    btn.disabled = !state.poker.canStart;
    btn.textContent = state.poker.tableStarted ? '새 경기' : '게임 시작';
    var hint = $('tableLobbyHint');
    if (state.poker.isHost) {
      hint.textContent = state.poker.canStart
        ? (state.poker.tableStarted ? '' : '준비되면 시작하세요')
        : (state.poker.tableStarted ? '진행 중입니다' : '2명 이상 모이면 시작할 수 있습니다');
    } else {
      hint.textContent = state.poker.tableStarted
        ? '진행 중입니다' : '방장이 시작하기를 기다리는 중입니다';
    }
  }

  // 셀렉트 옵션을 "현재 종목을 뺀 나머지"로 맞춘다 (선택값은 가능한 한 유지).
  function syncGameChangeOptions() {
    var sel = $('gameChangeSelect');
    if (!sel) return;
    var others = otherGames(state.game);
    var same = sel.options.length === others.length;
    if (same) {
      for (var i = 0; i < others.length; i++) {
        if (sel.options[i].value !== others[i]) { same = false; break; }
      }
    }
    if (same) return;
    var prev = sel.value;
    sel.innerHTML = '';
    others.forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g;
      opt.textContent = gameName(g);
      sel.appendChild(opt);
    });
    if (others.indexOf(prev) !== -1) sel.value = prev;
  }

  function setColorSelectDisabled(disabled) {
    Array.prototype.slice.call(document.querySelectorAll('input[name="myColor"]')).forEach(function (r) {
      r.disabled = disabled;
    });
  }

  // 온라인에서 게임/규칙/내 돌 선택이 잠기는 조건.
  //  - 로비(방 생성/참가 전): 방 생성자가 종목·규칙·색을 고를 수 있어야 하므로 열려 있다.
  //  - 방 안(생성/참가 후): 방 설정이 확정됐으므로 잠근다.
  function roomLocked() { return state.online && state.inRoom; }

  // 방 입장/퇴장에 따라 설정 컨트롤(게임/규칙/내 돌)의 잠금을 한 번에 반영
  function setRoomLocked(locked) {
    state.inRoom = !!locked;
    setColorSelectDisabled(roomLocked());
    applyGameUI();
    applyRuleUI();
    applySeatCountUI();
  }

  // 엑셀 상태바(하단): 게임 상태/차례를 "평범한 엑셀 상태바 텍스트"로 노출
  function updateExcelStatusBar() {
    var left = $('statusLeft'), right = $('statusRight');
    if (!left || !right) return;

    // 카드 게임: 왼쪽 "누구 차례", 오른쪽 "내 칩"
    if (isCardGame()) {
      var pv = state.poker.view;
      var ptxt;
      if (state.online && !state.started) ptxt = '준비';
      else if (isTableGame()) ptxt = pokerResultShort(pv) ||
        (pokerActor(pv) === null ? '준비' : seatName(pokerActor(pv)) + ' 차례');
      else if (pv && pv.over && pv.result) {
        if (pv.matchOver) ptxt = seatName(pv.matchWinner) + ' 최종 승리';
        else if (pv.result.split) ptxt = '무승부 (팟 분배)';
        else ptxt = seatName(pv.result.winner) + ' 승리';
      } else {
        var ac = pokerActor(pv);
        ptxt = ac === null ? '준비' : (seatName(ac) + ' 차례');
      }
      left.textContent = ptxt;
      var PNB = ' ';
      right.textContent = '내 칩: ' + (pv ? pv.chips[pokerMyIndex()] : P.START_CHIPS) +
        PNB + PNB + PNB + PNB + '100%';
      return;
    }

    var txt;
    if (state.gameOver) {
      if (state.winner === 0) txt = '무승부';
      else if (state.winner === BLACK) txt = colorName(BLACK) + ' 승리';
      else if (state.winner === WHITE) txt = colorName(WHITE) + ' 승리';
      else txt = '준비';
    } else if (state.online && !state.started) {
      txt = '준비';
    } else {
      txt = colorName(state.turn) + ' 차례';
    }
    left.textContent = txt;

    var NB = '\u00a0';   // NBSP (엑셀 상태바 간격)
    if (state.game === 'othello') {
      var c = state.othelloCounts || { black: 0, white: 0 };
      right.textContent = '흑: ' + c.black + NB + NB + '백: ' + c.white +
        NB + NB + NB + NB + '100%';
    } else {
      right.textContent = '합계: 0' + NB + NB + '평균: 0' + NB + NB +
        '개수: ' + state.moves.length + NB + NB + NB + NB + '100%';
    }
  }

  function updateExcelFormula() {
    var nb = $('excelNameBox'), fx = $('excelFormula');
    if (!nb || !fx) return;
    // 카드 게임: 수식 입력줄에 팟을 =POT(240) 형태로 노출한다
    if (isCardGame()) {
      var pv = state.poker.view;
      nb.textContent = 'B2';
      fx.textContent = pv ? '=POT(' + pv.pot + ')' : '';
      return;
    }
    var last = lastRealMove();
    if (last) {
      var lbl = excelCoordLabel(last.row, last.col);
      nb.textContent = lbl;
      var fn = state.game === 'othello' ? 'OTHELLO' : (state.game === 'connect4' ? 'CONNECT4' : 'OMOK');
      fx.textContent = '=' + fn + '("' + colorName(last.color) + '","' + lbl + '")';
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

    // 카드 게임: 기보 대신 액션 로그를 그린다 (빈 상태 문구는 그대로)
    if (isCardGame()) {
      var log = state.poker.log;
      if (!log.length) { empty.style.display = ''; return; }
      empty.style.display = 'none';
      log.forEach(function (e, i) {
        var row = document.createElement('div');
        row.className = 'move-row' + (i === log.length - 1 ? ' latest' : '') +
          (e.head ? ' log-head' : '');
        var num = document.createElement('span');
        num.className = 'move-num';
        num.textContent = circled(e.seq);
        var txt = document.createElement('span');
        txt.className = 'log-text';
        txt.textContent = e.text;
        row.appendChild(num);
        row.appendChild(txt);
        list.appendChild(row);
      });
      list.scrollTop = list.scrollHeight;
      return;
    }

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
        name.textContent = colorName(mv.color);
        coord.textContent = '패스';
      } else {
        seq++;
        num.textContent = (seq < 10 ? '0' : '') + seq + '.';
        name.textContent = colorName(mv.color);
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
    if (isCardGame()) return;   // 카드 게임에는 착수 시간 개념이 없다
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
      while (i >= 0 && i < ROWS && j >= 0 && j < COLS && board[i][j] === color) { cells.push({ row: i, col: j }); i += dr; j += dc; }
      i = r - dr; j = c - dc;
      while (i >= 0 && i < ROWS && j >= 0 && j < COLS && board[i][j] === color) { cells.push({ row: i, col: j }); i -= dr; j -= dc; }
      var need = (rule === 'renju' && color === BLACK) ? (cells.length === 5) : (cells.length >= 5);
      if (need) return cells;
    }
    return res;
  }

  function applyMove(row, col, color) {
    state.board[row][col] = color;
    state.moves.push({ row: row, col: col, color: color });
  }

  function finishWin(row, col, color, winCells) {
    state.gameOver = true;
    state.winner = color;
    state.winStones = winCells || (state.game === 'connect4'
      ? (C.checkWinAt(state.board, row, col, color) || [])
      : getWinningStones(state.board, row, col, color, state.rule));
    renderBoard();
    updateSidebar();
    showResultModal(color);
  }

  function finishDraw() {
    state.gameOver = true;
    state.winner = 0;
    renderBoard();      // 마지막 착수까지 그린 뒤 종료 표시 (사목 42수 만원)
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
    if (state.moves.length === ROWS * COLS) { finishDraw(); renderMoveList(); return; }
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
    if (state.moves.length === ROWS * COLS) { finishDraw(); renderMoveList(); return; }
    state.turn = color === BLACK ? WHITE : BLACK;
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // ── 사목 로직 ─────────────────────────────────────────
  // 착수 단위는 "열". 착지 행은 중력으로 결정된다.
  function tryLocalPlaceConnect4(col) {
    if (state.gameOver) return;
    var color = state.turn;
    var res = C.applyMove(state.board, col, color);
    if (!res) { toast('그 열은 가득 찼습니다'); return; }
    state.board = res.board;
    state.moves.push({ row: res.row, col: col, color: color });
    finishConnect4Ply(res.row, col, color);
  }

  // 온라인: 서버가 계산한 착지 행을 그대로 반영 (양쪽 화면이 항상 같다)
  function applyRemoteMoveConnect4(msg) {
    var color = colorNum(msg.color);
    var row = msg.row | 0, col = msg.col | 0;
    state.board[row][col] = color;
    state.moves.push({ row: row, col: col, color: color });
    if (msg.win) {
      finishWin(row, col, color, (msg.winCells && msg.winCells.length) ? msg.winCells : null);
      renderMoveList();
      return;
    }
    if (msg.draw) { finishDraw(); renderMoveList(); return; }
    state.turn = msg.nextTurn ? colorNum(msg.nextTurn) : otherColor(color);
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 착수 후 승/무/턴 처리 (로컬 전용)
  function finishConnect4Ply(row, col, color) {
    var cells = C.checkWinAt(state.board, row, col, color);
    if (cells) { finishWin(row, col, color, cells); renderMoveList(); return; }
    if (C.isFull(state.board)) { finishDraw(); renderMoveList(); return; }
    state.turn = otherColor(color);
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // ============================================================
  // 맞포커(카드 게임)
  // ------------------------------------------------------------
  // 엔진(sevenpoker.js)은 로컬/온라인이 똑같이 쓴다.
  //   · 로컬 핫시트 — 클라이언트가 엔진을 직접 돌리고, 비공개 결정을 하기
  //     전마다 전체 화면 가리개를 띄운다. 가리개가 떠 있는 동안에는
  //     "아무도 아닌 시점"(viewFor(state, null)) 으로 그려서 양쪽 히든이
  //     모두 뒷면이 되게 한다.
  //   · 온라인 — 서버가 엔진을 돌리고 각자 자기 시점 뷰만 받는다.
  //     클라이언트는 상대의 히든 카드를 애초에 갖고 있지 않다(null).
  // ============================================================
  var POKER_ACTIONS = [
    { type: 'check', label: '체크' },
    { type: 'bbing', label: '삥' },
    { type: 'call', label: '콜' },
    { type: 'half', label: '하프' },
    { type: 'ttadang', label: '따당' },
    { type: 'die', label: '다이' }
  ];

  function pokerFresh() {
    state.poker.local = null;
    state.poker.view = null;
    state.poker.viewer = null;
    state.poker.gateFor = null;
    state.poker.log = [];
    state.poker.seq = 0;
    if (!state.online) state.poker.seat = 0;
    hideGate();
  }

  // 뷰/상태에서 "지금 결정해야 하는 사람". 없으면 null.
  // 마스킹된 뷰에서도 동작한다 (카드 장수와 오픈 여부는 공개 정보).
  // 좌석 수만큼 훑는다. 폴드/파산/퇴장한 좌석은 결정할 것이 없다.
  function pokerActor(v) {
    if (!v || v.over) return null;
    var n = v.hands.length, i;
    if (v.phase === 'discard') {
      for (i = 0; i < n; i++) {
        if (!pokerSeatGone(v, i) && v.hands[i].cards.length === 4) return i;
      }
      return null;
    }
    if (v.phase === 'open') {
      for (i = 0; i < n; i++) {
        if (!pokerSeatGone(v, i) && !pokerHasOpen(v, i)) return i;
      }
      return null;
    }
    if (v.phase === 'bet') return v.toAct;
    return null;
  }
  function pokerHasOpen(v, i) {
    return v.hands[i].cards.some(function (c) { return c && c.open; });
  }
  // 좌석이 이번 판에서 빠졌는가 (다이 / 파산 / 퇴장)
  function pokerSeatGone(v, i) { return !!(v.folded && v.folded[i]); }
  // 좌석 상태 라벨 (없으면 null)
  function pokerSeatState(v, i) {
    if (!v) return null;
    if (v.left && v.left[i]) return '퇴장';
    if (v.out && v.out[i]) return '파산';
    if (v.folded && v.folded[i]) return '다이';
    return null;
  }
  // 화면 아래쪽("내 자리")에 놓을 좌석
  function pokerMyIndex() {
    if (state.online) return state.poker.seat || 0;
    if (state.poker.viewer !== null) return state.poker.viewer;
    if (state.poker.gateFor !== null) return state.poker.gateFor;
    return 0;
  }
  // 지금 이 화면의 주인이 매장/오픈 카드를 고를 수 있는가
  function pokerCanPick(v, me) {
    if (!v || v.over || v.me !== me) return false;
    if (v.phase === 'discard') return v.hands[me].cards.length === 4;
    if (v.phase === 'open') return !pokerHasOpen(v, me);
    return false;
  }

  // ── 로그 ──────────────────────────────────────────────
  function circled(n) {
    return (n >= 1 && n <= 20) ? String.fromCharCode(0x245F + n) : ('(' + n + ')');
  }
  function appendPokerEvents(events) {
    (events || []).forEach(function (ev) {
      var text = P.describeEvent(ev, isTableGame() ? seatNames() : ['P1', 'P2']);
      if (!text) return;
      if (ev.t === 'hand') state.poker.seq = 0;
      state.poker.seq += 1;
      state.poker.log.push({ text: text, seq: state.poker.seq, head: ev.t === 'hand' });
    });
  }

  // ── 렌더링 ────────────────────────────────────────────
  function clearCardTable() {
    $('ctOppCards').innerHTML = '';
    $('ctMyCards').innerHTML = '';
    $('ctOpps').innerHTML = '';
    $('ctMine').innerHTML = '';
    $('ctActions').innerHTML = '';
    $('ctPot').textContent = '팟 0';
    $('ctPhase').textContent = '';
  }

  function makeCorner(cls, card) {
    var wrap = document.createElement('span');
    wrap.className = 'pc-corner ' + cls;
    var r = document.createElement('span');
    r.className = 'pc-rank';
    r.textContent = K.rankText(card.r);
    var s = document.createElement('span');
    s.className = 'pc-suit';
    s.textContent = K.suitSymbol(card.s);
    wrap.appendChild(r);
    wrap.appendChild(s);
    return wrap;
  }

  // 카드 한 장. card 가 null 이면 뒷면(상대 히든).
  function makeCardEl(card, opts) {
    var el = document.createElement('div');
    var cell = document.createElement('span');
    cell.className = 'pc-cell';        // 엑셀 테마에서만 보이는 '♠A' / '###'
    if (!card) {
      el.className = 'pcard back';
      cell.textContent = '###';        // 숨겨진 수식처럼 보이는 회색 셀
    } else {
      el.className = 'pcard' + (K.isRed(card) ? ' red' : '') +
        (opts.mine && !card.open ? ' mine-hidden' : '') +
        (opts.won ? ' won' : '');
      cell.textContent = K.cardText(card);
      el.appendChild(makeCorner('tl', card));
      el.appendChild(makeCorner('br', card));
    }
    el.appendChild(cell);
    return el;
  }

  function renderHandCards(host, v, idx, mine, pickable) {
    host.innerHTML = '';
    if (!v) return;
    v.hands[idx].cards.forEach(function (card, i) {
      var el = makeCardEl(card, { mine: mine });
      el.setAttribute('data-idx', String(i));
      if (pickable) {
        el.classList.add('selectable');
        el.addEventListener('click', function () { pokerPick(i); });
      }
      host.appendChild(el);
    });
  }

  function pokerPhaseText(v) {
    if (!v) return '';
    if (v.over) return '판 종료';
    if (v.phase === 'discard') return '매장 (1장 버리기)';
    if (v.phase === 'open') return '오픈 (1장 공개)';
    if (v.phase === 'bet') return v.round + '라운드 베팅';
    return '';
  }

  function pokerResultText(v) {
    if (!v || !v.over || !v.result) return '';
    var r = v.result;
    if (r.split) return '무승부 — 팟 ' + r.amount + ' 분배';
    var name = seatName(r.winner);
    if (!r.revealed) return name + ' 승 (상대 다이) +' + r.amount;
    var cat = r.hands[r.winner] ? K.catName(r.hands[r.winner].cat) : '';
    return name + ' 승 (' + cat + ') +' + r.amount;
  }

  function renderActionBar(v, me) {
    var host = $('ctActions');
    host.innerHTML = '';
    if (!v) {
      addHint(host, state.online ? waitingHint() : '');
      return;
    }
    if (v.over) {
      addHint(host, pokerResultText(v));
      return;
    }
    if (v.phase === 'discard' || v.phase === 'open') {
      if (pokerCanPick(v, me)) {
        addHint(host, v.phase === 'discard' ? '버릴 카드를 선택' : '오픈할 카드를 선택');
      } else if (v.me === null) {
        addHint(host, '차례를 넘기는 중...');
      } else if (isTableGame()) {
        addHint(host, '다른 참가자가 카드를 고르는 중...');
      } else {
        addHint(host, '상대가 카드를 고르는 중...');
      }
      return;
    }
    // 베팅: 6개 버튼을 항상 그리고 합법적인 것만 활성화한다
    var opts = (v.me === me && v.options && v.options.length) ? v.options : null;
    POKER_ACTIONS.forEach(function (def) {
      var o = opts ? opts.filter(function (x) { return x.type === def.type; })[0] : null;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ct-btn' + (def.type === 'die' ? ' danger' : '');
      btn.setAttribute('data-action', def.type);
      btn.textContent = def.label + (o && o.amount ? ' (' + o.amount + ')' : '');
      btn.disabled = !(o && o.enabled);
      btn.addEventListener('click', function () { pokerAct({ type: def.type }); });
      host.appendChild(btn);
    });
  }

  function addHint(host, text) {
    var s = document.createElement('span');
    s.className = 'ct-hint';
    s.textContent = text;
    host.appendChild(s);
  }

  // 온라인 대기 문구 (포커 테이블 방은 방장의 시작을 기다린다)
  function waitingHint() {
    if (!isTableGame()) return '상대를 기다리는 중...';
    if (!state.inRoom) return '';
    if (state.poker.lobby.length < 2) return '다른 참가자를 기다리는 중...';
    return state.poker.isHost ? '\'게임 시작\'을 누르면 시작합니다' : '방장이 시작하기를 기다리는 중...';
  }

  // ── 포커(2~6인) 좌석 포드 ──────────────────────────────
  // 내 좌석은 항상 아래(#ctMine), 나머지는 시계방향으로 위쪽 그리드에 놓는다.
  function makeSeatPod(v, i, isMe, actor) {
    var pod = document.createElement('div');
    var stateLabel = pokerSeatState(v, i);
    pod.className = 'ct-pod' + (isMe ? ' me' : '') +
      (actor === i ? ' turn' : '') + (stateLabel ? ' gone' : '');
    pod.setAttribute('data-seat', String(i));

    var head = document.createElement('div');
    head.className = 'ct-pod-head';
    var name = document.createElement('span');
    name.className = 'ct-pod-name';
    name.textContent = seatName(i);
    head.appendChild(name);
    if (state.online && state.poker.hostSeat === i) {
      var host = document.createElement('span');
      host.className = 'ct-pod-tag';
      host.textContent = '방장';
      head.appendChild(host);
    }
    if (v && v.dealer === i) {
      var dl = document.createElement('span');
      dl.className = 'ct-pod-tag';
      dl.textContent = '딜러';
      head.appendChild(dl);
    }
    if (stateLabel) {
      var st = document.createElement('span');
      st.className = 'ct-pod-state';
      st.textContent = stateLabel;
      head.appendChild(st);
    }
    var chips = document.createElement('span');
    chips.className = 'ct-pod-chips';
    chips.textContent = '🪙 ' +
      (v ? v.chips[i] : (state.online ? seatLobbyChips(i) : P.START_CHIPS));
    head.appendChild(chips);
    pod.appendChild(head);

    var cards = document.createElement('div');
    cards.className = 'ct-pod-cards';
    pod.appendChild(cards);
    if (v) renderHandCards(cards, v, i, isMe, isMe && pokerCanPick(v, i));
    return pod;
  }

  function renderPokerTable() {
    var v = state.poker.view;
    var me = pokerMyIndex();
    var n = pokerSeatCount();
    var actor = pokerActor(v);
    var opps = $('ctOpps');
    opps.innerHTML = '';
    for (var k = 1; k < n; k++) {
      opps.appendChild(makeSeatPod(v, (me + k) % n, false, actor));
    }
    var mine = $('ctMine');
    mine.innerHTML = '';
    mine.appendChild(makeSeatPod(v, me, true, actor));
    $('ctPot').textContent = '팟 ' + (v ? v.pot : 0);
    $('ctPhase').textContent = pokerPhaseText(v);
    renderActionBar(v, me);
  }

  function renderCardTable() {
    if (isTableGame()) { renderPokerTable(); return; }
    var v = state.poker.view;
    var me = pokerMyIndex();
    var opp = me === 0 ? 1 : 0;
    var chips = v ? v.chips : [P.START_CHIPS, P.START_CHIPS];
    var dealer = v ? v.dealer : 0;
    $('ctMyName').textContent = seatName(me) + (dealer === me ? ' · 딜러' : '');
    $('ctOppName').textContent = seatName(opp) + (dealer === opp ? ' · 딜러' : '');
    $('ctMyChips').textContent = '🪙 ' + chips[me];
    $('ctOppChips').textContent = '🪙 ' + chips[opp];
    $('ctPot').textContent = '팟 ' + (v ? v.pot : 0);
    $('ctPhase').textContent = pokerPhaseText(v);
    var pickable = pokerCanPick(v, me);
    renderHandCards($('ctOppCards'), v, opp, false, false);
    renderHandCards($('ctMyCards'), v, me, true, pickable);
    renderActionBar(v, me);
  }

  // ── 가리개 (로컬 핫시트) ───────────────────────────────
  function showGate(actor) {
    state.poker.gateFor = actor;
    $('gateTitle').textContent = seatName(actor) + ' 차례입니다';
    $('gateOverlay').hidden = false;
  }
  function hideGate() {
    state.poker.gateFor = null;
    $('gateOverlay').hidden = true;
  }
  $('btnGateConfirm').addEventListener('click', function () {
    var actor = state.poker.gateFor;
    if (actor === null || !state.poker.local) { hideGate(); return; }
    hideGate();
    state.poker.viewer = actor;
    state.poker.view = P.viewFor(state.poker.local, actor);
    renderCardTable();
    updateSidebar();
  });

  // ── 로컬 진행 ─────────────────────────────────────────
  function localStartPokerMatch() {
    pokerFresh();
    hideModal();                 // 파산 모달에서 '새 게임' 으로 들어올 수 있다
    var deck = K.shuffle(K.makeDeck());
    var n = isTableGame() ? state.poker.count : 2;
    var chips = [];
    for (var i = 0; i < n; i++) chips.push(P.START_CHIPS);
    state.poker.local = P.createHand({
      deckOrder: deck,
      players: n,
      chips: chips,
      dealer: 0
    });
    appendPokerEvents(state.poker.local.log);
    pokerLocalSync();
  }

  function localNextPokerHand() {
    var st = state.poker.local;
    if (!st || !st.over) return;
    if (st.matchOver) { localStartPokerMatch(); return; }
    var n = P.nextHand(st, K.shuffle(K.makeDeck()));
    if (n.error) { toast(n.error); return; }
    state.poker.local = n;
    state.poker.viewer = null;
    hideModal();
    appendPokerEvents(n.log);
    pokerLocalSync();
  }

  // 로컬: 상태를 화면에 반영하고, 다음 비공개 결정 전에 가리개를 띄운다
  function pokerLocalSync() {
    var st = state.poker.local;
    if (!st) return;
    if (st.over) {
      state.poker.viewer = null;
      hideGate();
      state.poker.view = P.viewFor(st, null);   // 쇼다운이면 엔진이 이미 공개 상태
      renderCardTable();
      updateSidebar();
      renderMoveList();
      showPokerResultModal();
      return;
    }
    var actor = pokerActor(st);
    if (actor === null) return;
    if (state.poker.viewer === actor) {
      state.poker.view = P.viewFor(st, actor);
      hideGate();
    } else {
      // 아직 확인 전 → 양쪽 히든을 모두 가린 화면 + 가리개
      state.poker.viewer = null;
      state.poker.view = P.viewFor(st, null);
      showGate(actor);
    }
    renderCardTable();
    updateSidebar();
    renderMoveList();
  }

  // ── 액션 전송 (로컬/온라인 공통 입구) ───────────────────
  function pokerAct(action) {
    if (state.online) {
      if (!state.started) {
        toast(isTableGame() ? '아직 시작되지 않았습니다' : '상대를 기다리는 중입니다');
        return;
      }
      wsSend({ type: 'pokerAction', action: action });
      return;
    }
    var st = state.poker.local;
    var actor = state.poker.viewer;
    if (!st || actor === null) return;
    var res = P.apply(st, actor, action);
    if (res.error) { toast(res.error); return; }
    state.poker.local = res.state;
    state.poker.viewer = null;      // 결정할 때마다 다시 가린다
    appendPokerEvents(res.events);
    pokerLocalSync();
  }

  function pokerPick(index) {
    var v = state.poker.view;
    if (!v) return;
    var me = pokerMyIndex();
    if (!pokerCanPick(v, me)) return;
    pokerAct({ type: v.phase === 'discard' ? 'discard' : 'open', index: index });
  }

  // 온라인: 서버가 보낸 내 시점 뷰를 그대로 반영
  function applyPokerState(msg) {
    state.poker.seat = msg.seat;
    state.poker.view = msg.view;
    state.poker.viewer = null;
    hideGate();
    appendPokerEvents(msg.events);
    renderCardTable();
    updateSidebar();
    renderMoveList();
    if (msg.view && msg.view.over) showPokerResultModal();
    else hideModal();
  }

  // '다음 판' / '새 게임'
  function pokerPlayAgain() {
    var v = state.poker.view;
    if (isTableGame()) {
      if (v && v.matchOver) {
        if (!state.online) { localStartPokerMatch(); return; }
        if (!state.poker.isHost) { toast('방장만 새 경기를 시작할 수 있습니다'); return; }
        wsSend({ type: 'newMatch' });
        hideModal();
        return;
      }
      if (state.online) wsSend({ type: 'pokerAction', action: { type: 'nextHand' } });
      else localNextPokerHand();
      hideModal();
      return;
    }
    if (state.online) {
      if (v && v.matchOver) {
        wsSend({ type: 'restartRequest' });
        toast('상대에게 새 매치를 요청했습니다');
      } else {
        wsSend({ type: 'pokerAction', action: { type: 'nextHand' } });
      }
      hideModal();
      return;
    }
    if (v && v.matchOver) localStartPokerMatch();
    else localNextPokerHand();
  }

  // 포커(2~6인) 결과 모달. 좌석이 여럿이라 문구/칩 요약이 다르다.
  function showPokerTableModal() {
    var v = state.poker.view;
    var r = v.result;
    var stone = $('modalStone'), title = $('modalTitle'), msg = $('modalMessage');
    stone.hidden = true;
    var n = pokerSeatCount();
    var chipsTxt = [];
    for (var i = 0; i < n; i++) chipsTxt.push(seatName(i) + ' ' + v.chips[i]);
    if (v.matchOver) {
      title.textContent = '최종 우승 — ' +
        (v.matchWinner === null ? '무승부' : seatName(v.matchWinner));
      msg.textContent = '칩 ' + chipsTxt.join(' · ');
      setPlayAgainLabel(state.online && !state.poker.isHost ? '방장 대기' : '새 경기');
    } else {
      var winners = [];
      (r.payouts || []).forEach(function (amt, i) { if (amt > 0) winners.push(i); });
      if (!winners.length && r.winner !== null) winners = [r.winner];
      var names = winners.map(seatName).join(', ');
      var cat = (r.revealed && winners.length === 1 && r.hands[winners[0]])
        ? ' (' + K.catName(r.hands[winners[0]].cat) + ')' : '';
      title.textContent = winners.length > 1
        ? '팟 분배 — ' + names
        : (names ? names + ' 승리!' + cat : '판 종료');
      msg.textContent = '팟 ' + r.amount + (r.revealed ? '' : ' (전원 다이)') +
        ' · 칩 ' + chipsTxt.join(' · ');
      setPlayAgainLabel('다음 판');
    }
    $('resultModal').hidden = false;
  }

  function showPokerResultModal() {
    var v = state.poker.view;
    if (!v || !v.over || !v.result) return;
    if (isTableGame()) { showPokerTableModal(); return; }
    var stone = $('modalStone'), title = $('modalTitle'), msg = $('modalMessage');
    stone.hidden = true;                 // 카드 게임에는 돌 아이콘이 없다
    var r = v.result;
    var amounts = '칩 ' + seatName(0) + ' ' + v.chips[0] + ' · ' + seatName(1) + ' ' + v.chips[1];
    if (v.matchOver) {
      var loser = v.matchWinner === 0 ? 1 : 0;
      title.textContent = '게임 종료 — ' + seatName(loser) + ' 파산';
      msg.textContent = seatName(v.matchWinner) + ' 최종 승리! ' + amounts;
      setPlayAgainLabel('새 게임');
    } else {
      if (r.split) {
        title.textContent = '무승부! (팟 분배)';
      } else {
        var cat = (r.revealed && r.hands[r.winner]) ? ' (' + K.catName(r.hands[r.winner].cat) + ')' : '';
        title.textContent = seatName(r.winner) + ' 승리!' + cat;
      }
      msg.textContent = '팟 ' + r.amount + (r.revealed ? '' : ' (상대 다이)') + ' · ' + amounts;
      setPlayAgainLabel('다음 판');
    }
    $('resultModal').hidden = false;
  }

  function setPlayAgainLabel(text) {
    var el = $('playAgainLabel');
    if (el) el.textContent = text;
  }

  // ============================================================
  // 클릭 처리
  // ============================================================
  function overlayToCell(e) {
    var rect = clickOverlay.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var size = rect.width, vsize = rect.height;
    if (state.theme === 'excel') {
      var ux = size / (COLS + 1), uy = vsize / (ROWS + 1);
      if (x < ux || y < uy) return null; // 헤더 영역
      var col = Math.floor((x - ux) / ux);
      var row = Math.floor((y - uy) / uy);
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
      return { row: row, col: col };
    }
    if (state.game === 'connect4') {
      var ccw = size / COLS, cch = vsize / ROWS;
      var c4c = Math.floor(x / ccw);
      var c4r = Math.floor(y / cch);
      if (c4r < 0 || c4r >= ROWS || c4c < 0 || c4c >= COLS) return null;
      return { row: c4r, col: c4c };
    }
    if (state.game === 'othello') {
      var ocell = size / COLS;
      var oc = Math.floor(x / ocell);
      var orow = Math.floor(y / ocell);
      if (orow < 0 || orow >= ROWS || oc < 0 || oc >= COLS) return null;
      return { row: orow, col: oc };
    }
    var cell = size / (COLS - 1);
    var col2 = Math.round(x / cell);
    var row2 = Math.round(y / cell);
    if (row2 < 0 || row2 >= ROWS || col2 < 0 || col2 >= COLS) return null;
    return { row: row2, col: col2 };
  }

  clickOverlay.addEventListener('click', function (e) {
    if (isCardGame()) return;    // 카드 게임에는 보드 착수가 없다
    var cell = overlayToCell(e);
    if (!cell) return;
    if (state.online) {
      if (!state.started || state.gameOver) return;
      if (state.turn !== colorNum(state.myColor)) { toast('상대 차례입니다'); return; }
      if (state.game === 'connect4') {
        // 열만 보내고 착지 행은 서버가 정한다
        if (C.dropRow(state.board, cell.col) < 0) { toast('그 열은 가득 찼습니다'); return; }
        wsSend({ type: 'move', col: cell.col });
        return;
      }
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
      } else if (state.game === 'connect4') {
        tryLocalPlaceConnect4(cell.col);   // 열 안 아무 곳이나 클릭하면 그 열로 떨어진다
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
    stone.hidden = false;          // 카드 게임에서 숨겼을 수 있다
    var scoreStr = '';
    if (state.game === 'othello' && counts) {
      scoreStr = ' (' + counts.black + ' : ' + counts.white + ')';
    }
    if (winner === 0) {
      stone.className = 'modal-stone draw';
      title.textContent = '무승부!' + scoreStr;
      msg.textContent = state.game === 'othello'
        ? '돌 개수가 같습니다. 막상막하의 승부였네요.'
        : (state.game === 'connect4'
          ? '판이 가득 찼습니다. 우열을 가리지 못했네요.'
          : '바둑판이 가득 찼습니다. 우열을 가리지 못했네요.');
    } else {
      stone.className = 'modal-stone ' + colorStr(winner);
      title.textContent = colorName(winner) + ' 승리!' + scoreStr;
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
    // 카드 게임은 보드가 아니라 "매치"를 새로 시작한다 (칩 1000 리셋).
    if (isCardGame()) {
      pokerFresh();
      if (!state.online) { localStartPokerMatch(); return; }
      renderCardTable();
      updateSidebar();
      renderMoveList();
      return;
    }
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
  // 포커 테이블 방: '새 게임/재설정' = 방장의 '새 경기'
  function tableNewMatch() {
    if (!state.poker.isHost) { toast('방장만 새 경기를 시작할 수 있습니다'); return; }
    if (state.poker.lobby.length < 2) { toast('2명 이상이어야 시작할 수 있습니다'); return; }
    wsSend({ type: state.poker.tableStarted ? 'newMatch' : 'startMatch' });
  }

  $('btnNewGame').addEventListener('click', function () {
    if (state.online) {
      if (isTableGame()) { tableNewMatch(); return; }
      if (!state.started) { toast('상대를 기다리는 중입니다'); return; }
      wsSend({ type: 'restartRequest' });
      toast('상대에게 새 게임을 요청했습니다');
    } else {
      localNewGame();
    }
  });

  $('btnUndo').addEventListener('click', function () {
    if (isCardGame()) { toast('카드 게임에서는 무르기가 없습니다'); return; }
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
      if (isTableGame()) { tableNewMatch(); return; }
      if (!state.started) { toast('상대를 기다리는 중입니다'); return; }
      wsSend({ type: 'restartRequest' });
      toast('상대에게 새 게임을 요청했습니다');
      return;
    }
    flipReset(function () { resetGameState(); });
  });

  $('btnPlayAgain').addEventListener('click', function () {
    // 카드 게임: '다음 판'(같은 매치 계속) 또는 '새 게임'(파산 후)
    if (isCardGame()) { pokerPlayAgain(); return; }
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
      if (roomLocked()) return; // 방 안에서는 방 생성 시 정해진 규칙을 따른다
      state.rule = radio.value;
      localStorage.setItem('omok_rule', state.rule);
      renderBoard();
    });
  });

  function applyRuleUI() {
    var radios = document.querySelectorAll('input[name="rule"]');
    Array.prototype.slice.call(radios).forEach(function (rr) {
      rr.checked = rr.value === state.rule;
      rr.disabled = roomLocked();
    });
  }

  // ============================================================
  // 게임 선택 (오목 / 오델로)
  // ============================================================
  Array.prototype.slice.call(document.querySelectorAll('input[name="game"]')).forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (roomLocked()) return; // 방 안에서는 방 생성 시 정해진 종목을 따른다
      if (radio.value === state.game) return;
      setGame(radio.value);
    });
  });

  function applyGameUI() {
    var radios = document.querySelectorAll('input[name="game"]');
    Array.prototype.slice.call(radios).forEach(function (rr) {
      rr.checked = rr.value === state.game;
      rr.disabled = roomLocked();
    });
  }

  // 게임 종류에 따른 레이아웃/보드 크기/타이틀 반영 (리셋은 별도)
  function applyGameLayout() {
    ROWS = boardRows();
    COLS = boardCols();
    var card = isCardGame();
    var table = isTableGame();
    document.body.classList.toggle('game-othello', state.game === 'othello');
    document.body.classList.toggle('game-connect4', state.game === 'connect4');
    document.body.classList.toggle('game-matpoker', state.game === 'matpoker');
    document.body.classList.toggle('game-poker', table);

    // 중앙 영역 교체: 보드 ↔ 카드 테이블. 넘어가는 쪽의 DOM 은 완전히 비운다
    // (돌/셀/힌트가 남아 있으면 다음 종목 화면에 유령처럼 남는다).
    $('boardFlip').hidden = card;
    $('cardTable').hidden = !card;
    if (card) {
      clearPieces();
      markersLayer.innerHTML = '';
      boardCells.innerHTML = '';
      excelHeaders.innerHTML = '';
    } else {
      clearCardTable();
      hideGate();
    }
    // 카드 테이블 내부: 맞포커(고정 2칸) ↔ 포커(좌석 포드) 배타 표시
    $('ctDuoOpp').hidden = table;
    $('ctDuoMe').hidden = table;
    $('ctOpps').hidden = !table;
    $('ctMine').hidden = !table;
    // 카드 게임은 타이머 대신 칩을 표시한다
    $('timerBlack').hidden = card;
    $('timerWhite').hidden = card;
    $('chipsBlack').hidden = !card && !table;
    $('chipsWhite').hidden = !card && !table;
    // 포커는 좌석이 2~6개라 고정 2칸 대신 좌석 목록을 쓴다
    $('playerBlack').hidden = table;
    $('playerWhite').hidden = table;
    $('seatList').hidden = !table;
    if (!table) $('seatList').innerHTML = '';
    // 인원 선택은 로컬 포커에서만 (온라인은 방에 앉은 사람 수가 인원이다)
    var seatRow = $('seatCountRow');
    if (seatRow) seatRow.hidden = !(table && !state.online);
    // 내 돌(색) 선택은 카드 게임에 의미가 없다 (좌석은 방장=P1 고정)
    var colorRow = $('colorSelectRow');
    if (colorRow) colorRow.hidden = card;
    // 결과 모달의 기본 라벨 복구 (카드 게임에서만 '다음 판'으로 바뀐다)
    if (!card) setPlayAgainLabel('다시 하기');

    var ruleRow = $('ruleRow');
    // 규칙(렌주룰) 선택은 오목에만 해당된다
    if (ruleRow) ruleRow.hidden = (state.game !== 'omok');
    var title = document.querySelector('.site-title');
    var sub = document.querySelector('.site-subtitle');
    var subText = table ? '온라인 2~6인 테이블' : '온라인 2인용 대국';
    if (title) title.textContent = gameName(state.game);
    if (sub) sub.textContent = subText;
    document.title = gameName(state.game) + ' · ' + subText;
    applyGameUI();
    refreshRibbonMenu();   // 엑셀 테마: 규칙 행(수식 탭) 표시 여부가 바뀜
  }

  // 게임 전환 (로컬): 레이아웃 적용 후 현재 판 리셋
  function setGame(game) {
    state.game = game;
    localStorage.setItem('omok_game', game);
    pokerFresh();               // 이전 카드 상태(칩/로그/뷰)를 완전히 버린다
    applyGameLayout();
    // resetGameState 안에서 카드 게임이면 첫 판까지 시작한다
    // (온라인은 서버가 pokerState 로 내려준다)
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
    refreshRibbonMenu();   // 엑셀 테마: 열려 있는 "데이터" 패널 내용이 바뀜
  }

  // 로비를 "대기 상태"로 되돌린다 (모드 진입 / 상대 퇴장 / 연결 끊김).
  // 방 설정(게임·규칙·내 돌)도 다시 고를 수 있어야 한다.
  function resetLobbyActions() {
    $('btnCreateRoom').disabled = false;
    $('btnJoinRoom').disabled = false;
    $('joinCodeInput').disabled = false;
    // 포커 테이블 방 상태도 함께 비운다 (다음 방 입장에 새어 나가지 않게)
    state.poker.lobby = [];
    state.poker.isHost = false;
    state.poker.canStart = false;
    state.poker.tableStarted = false;
    state.poker.hostSeat = 0;
    setRoomLocked(false);
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
        // 방이 사라졌으므로 로비를 다시 열어 준다 (설정 선택 포함)
        state.started = false;
        state.roomCode = null;
        $('roomStatusText').textContent = '연결 끊김';
        toast('서버 연결이 끊겼습니다');
        resetLobbyActions();
        updateSidebar();
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
    state.inRoom = false;
  }

  function wsSend(obj) {
    if (state.ws && state.connected) state.ws.send(JSON.stringify(obj));
  }

  // 방 입장/재시작 안내 문구. 카드 게임에서는 흑돌/백돌 대신 좌석으로 말한다.
  function roomStartText() {
    if (isCardGame()) {
      return '대국 시작! 당신은 P' + (state.myColor === 'black' ? 1 : 2) + ' 입니다.';
    }
    return '대국 시작! ' +
      (state.myColor === 'black' ? '당신은 흑돌입니다.' : '당신은 백돌입니다.');
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'created':
        if (isTableGame(msg.game)) { enterTableRoom(msg, true); break; }
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
        setRoomLocked(true);
        break;

      case 'joined':
        if (isTableGame(msg.game)) { enterTableRoom(msg, false); break; }
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
        setRoomLocked(true);
        break;

      case 'start':
        state.started = true;
        state.rule = msg.rule;
        if (msg.game) { state.game = msg.game; applyGameLayout(); }
        state.turn = BLACK;
        applyRuleUI();
        resetGameStateKeepOnline();
        $('roomStatusText').textContent = roomStartText();
        addChatSystem('상대가 입장했습니다. 대국을 시작합니다.');
        break;

      // 포커 테이블: 참가자 목록/방장/시작 가능 여부
      case 'tableLobby': {
        if (!isTableGame()) break;
        state.poker.lobby = msg.players || [];
        state.poker.hostSeat = typeof msg.hostSeat === 'number' ? msg.hostSeat : 0;
        state.poker.canStart = !!msg.canStart;
        state.poker.tableStarted = !!msg.started;
        var mineRow = state.poker.lobby.filter(function (p) {
          return p.seat === state.poker.seat;
        })[0];
        state.poker.isHost = mineRow ? !!mineRow.isHost : false;
        if (!msg.started) {
          // 매치가 없거나 끝나고 로비로 돌아온 상태 → 테이블을 비운다
          state.started = false;
          state.poker.view = null;
          hideModal();
          $('roomStatusText').textContent = state.poker.lobby.length < 2
            ? '참가자를 기다리는 중...'
            : (state.poker.isHost ? '시작할 수 있습니다' : '방장이 시작하기를 기다리는 중...');
        }
        if (msg.notice) addChatSystem(msg.notice);
        renderCardTable();
        updateSidebar();
        renderMoveList();
        break;
      }

      case 'tableStart':
        state.started = true;
        state.poker.seat = msg.seat;
        state.poker.isHost = !!msg.isHost;
        state.poker.tableStarted = true;
        state.poker.log = [];
        state.poker.seq = 0;
        hideModal();
        $('roomStatusText').textContent = '게임 시작! 당신은 플레이어 ' + (msg.seat + 1) + ' 입니다.';
        addChatSystem(msg.players + '명으로 게임을 시작합니다.');
        break;

      case 'tableNotice':
        addChatSystem(msg.text);
        toast(msg.text);
        break;

      // 카드 게임: 서버가 매 변화마다 "내 시점 뷰" + 공용 로그를 내려준다
      case 'pokerState':
        if (!isCardGame()) break;
        applyPokerState(msg);
        break;

      case 'move':
        if (msg.game === 'othello' || (!msg.game && state.game === 'othello')) {
          applyRemoteMoveOthello(msg);
        } else if (msg.game === 'connect4' || (!msg.game && state.game === 'connect4')) {
          applyRemoteMoveConnect4(msg);
        } else {
          applyRemoteMove(msg.row, msg.col, msg.color, msg.win);
        }
        break;

      case 'invalid':
        if (msg.reason === 'poker') toast(msg.message || '지금 할 수 없는 액션입니다');
        else if (msg.reason === 'forbidden' && msg.ftype) toast(R.FORBIDDEN_LABEL[msg.ftype] || '금수입니다');
        else if (msg.reason === 'illegal') toast('둘 수 없는 자리입니다');
        else if (msg.reason === 'column-full') toast('그 열은 가득 찼습니다');
        break;

      case 'chat':
        if (isTableGame()) {
          addChatBubble(msg.text, msg.seat === state.poker.seat, msg.from);
        } else {
          addChatBubble(msg.text, msg.from === state.myColor);
        }
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
        $('roomStatusText').textContent = roomStartText();
        break;

      case 'swapRejected':
        toast('상대가 거절했습니다');
        break;

      case 'gameChangeRequest': {
        var reqGame = normGame(msg.game);
        showConfirm('상대가 ' + gameName(reqGame) + '(으)로 게임 변경을 요청했습니다. 수락하시겠습니까?', function (ok) {
          wsSend({ type: 'gameChangeResponse', accept: ok });
          if (!ok) addChatSystem('게임 변경을 거절했습니다.');
        });
        break;
      }

      case 'gameChanged':
        // 색은 그대로, 종목만 교체. 로컬 종목 전환과 동일한 경로(setGame)를 재사용한다.
        // (setGame -> applyGameLayout: 보드 크기/타이틀/규칙행 + resetGameState: 판/기보/턴 리셋)
        setGame(normGame(msg.game));
        state.turn = msg.turn === 'white' ? WHITE : BLACK;
        renderBoard();
        updateSidebar();
        addChatSystem('게임을 ' + gameName(state.game) + '(으)로 바꿨습니다.');
        break;

      case 'gameChangeRejected':
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
        addChatSystem(isCardGame()
          ? '새 매치를 시작합니다. 칩이 1000으로 초기화되었습니다.'
          : '새 게임을 시작합니다. 색이 교대되었습니다.');
        $('roomStatusText').textContent = roomStartText();
        break;

      case 'restartRejected':
        toast('상대가 새 게임을 거절했습니다');
        break;

      case 'opponentLeft':
        // 서버는 상대가 나가면 방을 없앤다 → 로비는 다시 대기 상태(설정 선택 가능)
        state.started = false;
        state.roomCode = null;
        addChatSystem('상대가 퇴장했습니다.');
        toast('상대가 나갔습니다');
        $('roomStatusText').textContent = '상대가 나갔습니다. 로비로 돌아가세요.';
        resetLobbyActions();
        updateSidebar();
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
    // 카드 게임은 서버가 곧바로 pokerState 를 내려주므로 화면만 비워 둔다
    if (isCardGame()) pokerFresh();
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

  // 포커 테이블 방 입장 (방 만들기 / 참가 공통)
  function enterTableRoom(msg, created) {
    state.game = 'poker';
    state.roomCode = msg.code;
    state.myColor = null;
    state.started = false;
    state.poker.seat = msg.seat | 0;
    state.poker.isHost = !!msg.isHost;
    state.poker.tableStarted = false;
    state.poker.lobby = [];
    localStorage.setItem('omok_game', 'poker');
    applyGameLayout();
    resetGameStateKeepOnline();
    $('roomInfo').hidden = false;
    $('roomCodeText').textContent = msg.code;
    $('roomStatusText').textContent = created
      ? '방을 만들었습니다. 참가자를 기다리는 중...'
      : '입장했습니다. 당신은 플레이어 ' + (state.poker.seat + 1) + ' 입니다.';
    $('btnCreateRoom').disabled = true;
    $('btnJoinRoom').disabled = true;
    $('joinCodeInput').disabled = true;
    setRoomLocked(true);
  }

  $('btnStartMatch').addEventListener('click', function () {
    if (!state.online || !isTableGame()) return;
    if (!state.poker.isHost) { toast('방장만 시작할 수 있습니다'); return; }
    if (state.poker.lobby.length < 2) { toast('2명 이상이어야 시작할 수 있습니다'); return; }
    wsSend({ type: state.poker.tableStarted ? 'newMatch' : 'startMatch' });
  });

  // 로컬 핫시트 인원 (2~6)
  Array.prototype.slice.call(document.querySelectorAll('input[name="seatCount"]')).forEach(function (radio) {
    radio.addEventListener('change', function () {
      var n = parseInt(radio.value, 10);
      if (!(n >= SEAT_MIN && n <= SEAT_MAX)) return;
      if (n === state.poker.count) return;
      state.poker.count = n;
      localStorage.setItem('omok_seats', String(n));
      if (isTableGame() && !state.online) {
        localStartPokerMatch();
        renderCardTable();
        updateSidebar();
        renderMoveList();
      }
    });
  });
  function applySeatCountUI() {
    Array.prototype.slice.call(document.querySelectorAll('input[name="seatCount"]')).forEach(function (r) {
      r.checked = parseInt(r.value, 10) === state.poker.count;
      r.disabled = roomLocked();
    });
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

  $('btnGameChange').addEventListener('click', function () {
    if (!state.online || !state.started) return;
    if (state.gameOver || state.moves.length > 0) {
      toast('이미 착수하여 게임을 바꿀 수 없습니다');
      return;
    }
    var sel = $('gameChangeSelect');
    var target = sel && sel.value ? normGame(sel.value) : otherGames(state.game)[0];
    if (target === state.game) { toast('이미 그 게임입니다'); return; }
    wsSend({ type: 'gameChangeRequest', game: target });
    toast(gameName(target) + '(으)로 변경을 요청했습니다');
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
  function addChatBubble(text, isMe, who) {
    var list = $('chatList');
    var b = document.createElement('div');
    b.className = 'chat-bubble ' + (isMe ? 'me' : 'them');
    // 좌석이 여럿인 방(포커)에서는 누가 말했는지 함께 보여준다
    b.innerHTML = (who && !isMe ? '<span class="chat-who">' + esc(who) + '</span>' : '') +
      esc(text);
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
  // 엑셀 리본 메뉴 (테마 위장)
  // ------------------------------------------------------------
  // 엑셀 테마에서는 좌/우 패널을 통째로 감추고, 그 안에 있던 "진짜" 컨트롤
  // 노드를 리본 탭 드롭다운으로 **물리적으로 이동**시킨다.
  //   - 복제(clone) 금지: id 중복 / 핸들러 이중 발화를 만들지 않는다.
  //   - 이동 전에 {노드, 원래 부모, 원래 다음 형제}를 문서 순서대로 기록해 두고,
  //     기본 테마로 돌아올 때 역순으로 insertBefore 하여 원래 구조를 정확히 복원한다.
  //     (역순 복원이면 "다음 형제"도 이미 제자리에 있으므로 순서가 어긋나지 않는다.)
  // ============================================================
  var RIBBON_MENUS = [
    // key,  탭 라벨(마크업의 data-menu 와 매칭), 그 탭에 들어갈 컨트롤(표시 순서)
    { key: 'file',    items: ['btnReset', 'langCard'] },
    { key: 'home',    items: [] },   // 홈: 기본 활성 탭 (아무것도 열지 않음)
    { key: 'insert',  items: ['gameSelectRow', 'seatCountRow', 'btnNewGame'] },
    { key: 'layout',  items: ['themeToggle'] },
    { key: 'formula', items: ['ruleRow'] },
    { key: 'data',    items: ['modeTabs', 'onlineLobby', 'chatCard'] },
    { key: 'review',  items: ['recordCard', 'btnUndo'] },
    { key: 'view',    items: ['playerInfoCard', 'gameInfoCard'] }
  ];

  var ribbon = { built: false, moved: false, open: null, records: [] };

  function ribbonTabs() {
    return Array.prototype.slice.call(document.querySelectorAll('.ribbon-tab'));
  }
  function ribbonTab(key) {
    return document.querySelector('.ribbon-tab[data-menu="' + key + '"]');
  }
  function ribbonPanel(key) {
    return document.getElementById('ribbonMenu-' + key);
  }
  // 클릭 지점이 리본 탭/드롭다운 내부인지 (Element.closest 대체)
  function inAnyRibbonUI(node) {
    while (node && node.nodeType === 1) {
      if (node.classList &&
          (node.classList.contains('ribbon-menu') || node.classList.contains('ribbon-tab'))) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  function buildRibbonMenus() {
    if (ribbon.built) return;
    var host = $('ribbonMenus');
    if (!host) return;
    RIBBON_MENUS.forEach(function (m) {
      if (!m.items.length) return;          // 홈은 패널이 없다
      var p = document.createElement('div');
      p.className = 'ribbon-menu';
      p.id = 'ribbonMenu-' + m.key;
      p.setAttribute('data-menu', m.key);
      p.hidden = true;
      var note = document.createElement('p');
      note.className = 'ribbon-note';
      note.textContent = '표시할 항목이 없습니다.';
      note.hidden = true;
      p.appendChild(note);                  // 이동된 노드는 항상 note 앞에 삽입
      host.appendChild(p);
    });
    ribbonTabs().forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-menu');
        setRibbonMenu(ribbon.open === key ? null : key);
      });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          var key = tab.getAttribute('data-menu');
          setRibbonMenu(ribbon.open === key ? null : key);
        }
      });
    });
    // 바깥 클릭 / Escape 로 닫기
    document.addEventListener('click', function (e) {
      if (!ribbon.open) return;
      if (inAnyRibbonUI(e.target)) return;
      setRibbonMenu(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ribbon.open) setRibbonMenu(null);
    });
    // 리본이 가로 스크롤되면 탭 위치가 달라지므로 패널도 따라 움직인다
    var rb = document.querySelector('.excel-ribbon');
    if (rb) {
      rb.addEventListener('scroll', function () {
        if (ribbon.open) positionRibbonMenu(ribbon.open);
      });
    }
    ribbon.built = true;
  }

  // 열려 있는 패널의 내용/폭이 바뀌었을 때 (모드 전환, 게임 전환, 리사이즈 등)
  function refreshRibbonMenu() {
    if (!ribbon || !ribbon.open) return;
    updateRibbonNote(ribbon.open);
    positionRibbonMenu(ribbon.open);
  }

  // 열려 있는 패널을 클릭한 탭 아래(가능하면 탭 왼쪽 기준)에 맞춘다.
  // 패널은 문서 흐름 안에 있으므로 margin-left 만 조정하고,
  // 오른쪽으로 넘치지 않도록 (호스트 폭 - 패널 폭) 으로 클램프한다.
  function positionRibbonMenu(key) {
    var host = $('ribbonMenus'), p = ribbonPanel(key), tab = ribbonTab(key);
    if (!host || !p || !tab) return;
    p.style.marginLeft = '0px';
    var hostRect = host.getBoundingClientRect();
    var pw = p.getBoundingClientRect().width;
    var offset = tab.getBoundingClientRect().left - hostRect.left;
    var max = Math.max(0, hostRect.width - pw);
    var left = Math.max(0, Math.min(offset, max));
    p.style.marginLeft = Math.round(left) + 'px';
  }

  // 패널 안에 보이는 컨트롤이 하나도 없으면 안내문을 띄운다.
  function updateRibbonNote(key) {
    var p = ribbonPanel(key);
    if (!p) return;
    var note = p.querySelector('.ribbon-note');
    if (!note) return;
    var visible = false;
    Array.prototype.slice.call(p.children).forEach(function (ch) {
      if (ch === note) return;
      if (!ch.hidden && ch.style.display !== 'none') visible = true;
    });
    note.hidden = visible;
  }

  function setRibbonMenu(key) {
    if (!ribbon.built) return;
    if (key === 'home') key = null;
    RIBBON_MENUS.forEach(function (m) {
      var p = ribbonPanel(m.key);
      if (p) p.hidden = (m.key !== key);
    });
    ribbonTabs().forEach(function (t) {
      var tk = t.getAttribute('data-menu');
      var on = key ? (tk === key) : (tk === 'home');
      t.classList.toggle('active', on);
      t.setAttribute('aria-expanded', (key && tk === key) ? 'true' : 'false');
    });
    ribbon.open = key;
    if (key) {
      updateRibbonNote(key);
      positionRibbonMenu(key);
    }
  }

  // 컨트롤 → 리본 패널로 이동
  function moveControlsIntoRibbon() {
    if (ribbon.moved) return;
    buildRibbonMenus();
    var targets = [];
    RIBBON_MENUS.forEach(function (m) {
      m.items.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && ribbonPanel(m.key)) targets.push({ el: el, menu: m.key });
      });
    });
    // 복원용 기록 (문서 순서로 정렬 → 복원은 역순)
    var records = targets.map(function (t) {
      return { el: t.el, parent: t.el.parentNode, next: t.el.nextSibling };
    });
    records.sort(function (a, b) {
      var pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    ribbon.records = records;
    // 실제 이동 (메뉴 정의 순서 = 화면 표시 순서)
    targets.forEach(function (t) {
      var p = ribbonPanel(t.menu);
      p.insertBefore(t.el, p.querySelector('.ribbon-note'));
    });
    ribbon.moved = true;
    var chrome = $('excelChrome');
    if (chrome) chrome.setAttribute('aria-hidden', 'false');
    setRibbonMenu(null);
  }

  // 리본 패널 → 원래 자리로 복원
  function restoreControlsFromRibbon() {
    if (!ribbon.moved) return;
    setRibbonMenu(null);
    for (var i = ribbon.records.length - 1; i >= 0; i--) {
      var r = ribbon.records[i];
      if (!r.parent) continue;
      // next 가 이미 다른 곳으로 옮겨졌을 가능성 방어 (역순 복원이면 발생하지 않음)
      var next = (r.next && r.next.parentNode === r.parent) ? r.next : null;
      r.parent.insertBefore(r.el, next);
    }
    ribbon.records = [];
    ribbon.moved = false;
    var chrome = $('excelChrome');
    if (chrome) chrome.setAttribute('aria-hidden', 'true');
  }

  // ============================================================
  // 테마
  // ============================================================
  function applyTheme(theme) {
    state.theme = theme;
    document.body.classList.toggle('theme-excel', theme === 'excel');
    // 엑셀 테마에서는 리본 메뉴 안에 놓이므로 이모지 없이 "엑셀스러운" 라벨을 쓴다
    $('themeToggle').textContent = theme === 'excel' ? '테마: 엑셀' : '🎨 테마: 기본';
    localStorage.setItem('omok_theme', theme);
    // 컨트롤 위치(패널 ↔ 리본 메뉴) 전환
    if (theme === 'excel') moveControlsIntoRibbon();
    else restoreControlsFromRibbon();
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
  // ------------------------------------------------------------
  // 보드 크기는 컨테이너에서 나오므로, 창 크기가 그대로여도
  // (채팅 카드 등장 / 테마 전환 / 게임 전환 / 폰트 로드) 보드가 바뀔 수 있다.
  // window resize 만으로는 이런 경우를 잡지 못하므로 ResizeObserver 를 함께 사용한다.
  // ============================================================
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { lastInnerW = -1; lastInnerH = -1; renderBoard(); }, 80);
    refreshRibbonMenu();   // 리본 드롭다운 좌우 클램프 재계산
  });

  // ── ResizeObserver: 컨테이너 기인 크기 변화 대응 ──────────
  var lastInnerW = -1;      // 마지막으로 렌더한 boardInner 폭(px, 반올림)
  var lastInnerH = -1;      // 높이도 함께 본다 (사목은 정사각이 아니라 비율이 바뀐다)
  var roScheduled = false;  // rAF 디바운스
  if (typeof window.ResizeObserver === 'function') {
    var ro = new window.ResizeObserver(function () {
      if (roScheduled) return;
      roScheduled = true;
      window.requestAnimationFrame(function () {
        roScheduled = false;
        var box = boardInner.getBoundingClientRect();
        var w = Math.round(box.width), h = Math.round(box.height);
        // 무한 루프 방지: 실제로 크기가 달라졌을 때만 재렌더한다.
        // (재렌더는 boardInner 안의 절대배치 자식만 바꾸므로 boardInner 자체 크기는
        //  변하지 않지만, 혹시 모를 되먹임을 위해 가드를 둔다.)
        if (!w || !h || (w === lastInnerW && h === lastInnerH)) return;
        lastInnerW = w; lastInnerH = h;
        renderBoard();
      });
    });
    try { ro.observe(boardInner); } catch (e) { /* noop */ }
  }

  // ============================================================
  // 레이아웃 자가 진단 (개발/검증용, UI 없음)
  //   window.__layoutAudit() -> { vw, vh, hScroll, overlaps: [{a,b,ox,oy}] }
  //   - 화면에 보이는 주요 블록끼리 바운딩 박스 교차를 검사
  //   - 양 축 모두 2px 초과로 겹칠 때만 보고
  //   - 조상/자손 관계인 쌍은 제외
  // ============================================================
  var AUDIT_SELECTORS = [
    '.board', '.card-table', '.panel', '.card', '#themeToggle',
    '.excel-chrome', '.excel-bottom', '.site-header',
    '.ribbon-menu',
    '#toast'          // 떠 있는 동안 다른 블록을 덮지 않는지 (숨김 상태면 자동 제외)
  ];

  function auditName(el, sel, seen) {
    var base = sel;
    if (el.id) base = sel + '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) base = sel + '(' + cls + ')';
    }
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? base + '[' + (seen[base] - 1) + ']' : base;
  }

  // 스크롤/클리핑 조상(overflow != visible)에 의해 실제로 보이는 사각형.
  // 리본 드롭다운(max-height + overflow-y:auto)처럼 잘려 있는 자식이
  // "화면에는 안 보이는데 좌표상 아래 요소와 겹치는" 오탐을 막는다.
  function auditRect(el) {
    var r = el.getBoundingClientRect();
    var box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    var p = el.parentElement;
    while (p && p !== document.documentElement) {
      var cs = window.getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        var pr = p.getBoundingClientRect();
        if (cs.overflowX !== 'visible') {
          box.left = Math.max(box.left, pr.left);
          box.right = Math.min(box.right, pr.right);
        }
        if (cs.overflowY !== 'visible') {
          box.top = Math.max(box.top, pr.top);
          box.bottom = Math.min(box.bottom, pr.bottom);
        }
      }
      p = p.parentElement;
    }
    box.width = box.right - box.left;
    box.height = box.bottom - box.top;
    return box;
  }

  function auditVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = auditRect(el);
    return r.width > 0 && r.height > 0;
  }

  function layoutAudit() {
    var els = [], rects = [], names = [], seen = {};
    AUDIT_SELECTORS.forEach(function (sel) {
      var found = document.querySelectorAll(sel);
      Array.prototype.slice.call(found).forEach(function (el) {
        if (els.indexOf(el) !== -1) return;   // 중복 매칭 방지
        if (!auditVisible(el)) return;
        els.push(el);
        rects.push(auditRect(el));
        names.push(auditName(el, sel, seen));
      });
    });

    var overlaps = [];
    for (var i = 0; i < els.length; i++) {
      for (var j = i + 1; j < els.length; j++) {
        var a = els[i], b = els[j];
        if (a.contains(b) || b.contains(a)) continue;   // 조상/자손 제외
        var ra = rects[i], rb = rects[j];
        var ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        var oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 2 && oy > 2) {
          overlaps.push({
            a: names[i], b: names[j],
            ox: Math.round(ox * 100) / 100,
            oy: Math.round(oy * 100) / 100
          });
        }
      }
    }

    var de = document.documentElement;
    // 열려 있는 리본 드롭다운이 좌우로 넘치지 않는지 (부가 정보)
    var menu = null;
    if (ribbon && ribbon.open) {
      var mp = ribbonPanel(ribbon.open);
      if (mp) {
        var mr = mp.getBoundingClientRect();
        menu = {
          open: ribbon.open,
          left: Math.round(mr.left),
          right: Math.round(mr.right),
          inView: mr.left >= -0.5 && mr.right <= window.innerWidth + 0.5
        };
      }
    }
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      hScroll: de.scrollWidth > window.innerWidth,
      overlaps: overlaps,
      menu: menu
    };
  }
  window.__layoutAudit = layoutAudit;

  // ============================================================
  // 초기화
  // ============================================================
  function init() {
    // 저장된 설정 복원
    var savedRule = localStorage.getItem('omok_rule');
    if (savedRule === 'free' || savedRule === 'renju') state.rule = savedRule;
    var savedGame = localStorage.getItem('omok_game');
    if (GAMES.indexOf(savedGame) !== -1) state.game = savedGame;
    var savedSeats = parseInt(localStorage.getItem('omok_seats'), 10);
    if (savedSeats >= SEAT_MIN && savedSeats <= SEAT_MAX) state.poker.count = savedSeats;
    applySeatCountUI();
    var savedTheme = localStorage.getItem('omok_theme');

    // 저장된 게임에 맞춰 보드/레이아웃 초기화
    ROWS = boardRows();
    COLS = boardCols();
    state.board = newBoard();

    // 푸터
    var year = new Date().getFullYear();
    $('footerText').textContent = '© ' + year + ' 오목 미니 게임 온라인 플레이 | 친구를 초대하여 무료로 2인용 오목 게임을 즐겨보세요!';

    applyRuleUI();
    applyGameLayout();
    // 카드 게임으로 복원됐다면 로컬 매치를 바로 시작한다
    if (isCardGame() && !state.online) localStartPokerMatch();
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
