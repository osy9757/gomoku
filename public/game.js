/* ============================================================
   game.js — 오목 클라이언트 (보드/규칙UI/모드/웹소켓/채팅/테마)
   rules.js(window.Rules)에 순수 규칙 로직 의존.
   ============================================================ */
(function () {
  'use strict';

  var R = window.Rules;
  var O = window.Othello;
  var C = window.Connect4;
  var AK = window.Alkkagi;      // 알까기 물리 엔진 (서버와 완전히 동일한 모듈)
  var K = window.Cards;         // 카드 공용 유틸 (덱/표기/족보)
  var P = window.SevenPoker;    // 세븐포커 엔진 (로컬 핫시트에서 직접 구동)
  var IP = window.IndianPoker;  // 인디언포커 엔진 (공개 API 모양이 P 와 같다)
  var TH = window.Thief;        // 도둑잡기 엔진 (공개 API 모양이 P 와 같다)
  var BLACK = R.BLACK, WHITE = R.WHITE, EMPTY = R.EMPTY; // 세 게임 공통 (1,2,0)
  // 보드는 더 이상 정사각이 아니다 (사목 6행 x 7열).
  // 행/열을 따로 들고 다닌다. 오목/오델로는 ROWS === COLS.
  var ROWS = R.BOARD_SIZE, COLS = R.BOARD_SIZE;
  var STAR_POINTS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
  // 오델로 보드 표식 위치(격자 교차점 기준)
  var OTHELLO_DOTS = [[2, 2], [2, 6], [6, 2], [6, 6]];

  // 지원 종목 (순서 = 선택 UI 표시 순서)
  var GAMES = ['omok', 'othello', 'connect4', 'alkkagi', 'poker', 'indian', 'thief'];
  var GAME_LABEL = {
    omok: '오목', othello: '오델로', connect4: '사목', alkkagi: '알까기',
    poker: '포커', indian: '인디언포커', thief: '도둑잡기'
  };
  // 예전 버전에서 저장된 종목 이름 → 지금 이름.
  // '맞포커'(1:1 세븐포커)는 포커 2인으로 흡수됐다. 옛 설정이 남아 있어도
  // 포커로 조용히 옮겨 준다(사라진 종목 이름으로 화면이 깨지지 않게).
  var LEGACY_GAMES = { matpoker: 'poker' };
  function migrateGame(g) {
    return (g && LEGACY_GAMES[g]) || g;
  }
  // 카드 게임: 보드 대신 카드 테이블(#cardTable)을 쓰는 종목.
  // 이 종목들은 모두 좌석이 2~6인인 테이블 종목이기도 하다(온라인은 좌석제 방).
  // 두 목록이 갈라지지 않도록 같은 배열을 공유한다 — 2인 포커가 곧 헤즈업이다.
  var CARD_GAMES = ['poker', 'indian', 'thief'];
  var TABLE_GAMES = CARD_GAMES;
  function isCardGame(g) { return CARD_GAMES.indexOf(g || state.game) !== -1; }
  function isTableGame(g) { return TABLE_GAMES.indexOf(g || state.game) !== -1; }
  // 인디언포커: 마스킹이 정반대라 카드 렌더링/문구가 따로 필요하다
  function isIndian(g) { return (g || state.game) === 'indian'; }
  // 도둑잡기: 칩/베팅이 없고 "남의 패에서 한 장 뽑기"가 전부인 종목
  function isThief(g) { return (g || state.game) === 'thief'; }
  // 현재 종목의 카드 엔진 (세븐포커 / 인디언포커 / 도둑잡기)
  function cardEngine(g) {
    if (isIndian(g)) return IP;
    if (isThief(g)) return TH;
    return P;
  }
  function PE() { return cardEngine(); }
  // '게임 바꾸기'로 고를 수 있는 종목 (테이블 방 종목은 2인 방에서 못 바꾼다)
  var CHANGEABLE_GAMES = GAMES.filter(function (g) {
    return TABLE_GAMES.indexOf(g) === -1;
  });
  var SEAT_MIN = 2, SEAT_MAX = 6, SEAT_DEFAULT = 3;

  // 알까기: 격자에 두는 게임이 아니라 "돌을 튕기는" 물리 게임.
  // state.board 에 격자 대신 물리 상태(돌 좌표 목록)가 들어간다.
  function isAlk(g) { return (g || state.game) === 'alkkagi'; }

  // 현재 게임의 규칙 모듈
  function curMod() {
    if (state.game === 'othello') return O;
    if (state.game === 'connect4') return C;
    if (state.game === 'alkkagi') return AK;
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
  function normGame(g) {
    var m = migrateGame(g);
    return GAMES.indexOf(m) !== -1 ? m : 'omok';
  }
  // 종목이 여러 개이므로 "반대 종목"은 하나가 아니라 목록이다.
  function otherGames(g) {
    var cur = normGame(g);
    return CHANGEABLE_GAMES.filter(function (x) { return x !== cur; });
  }
  function gameName(g) { return GAME_LABEL[normGame(g)]; }
  // 좌석 이름 (카드 게임 전용 — 포커/인디언포커 2~6인).
  // 온라인에서는 내 좌석만 '나', 나머지는 '플레이어 N'
  // (좌석이 여러 개라 '상대'로는 구분이 안 된다)
  function seatName(i) {
    if (state.online && state.poker.seat === i) return '나';
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
    // 알까기 전용 상태 (판 자체는 state.board 에 들어 있다)
    alk: {
      anim: null,      // 진행 중인 시뮬레이션 애니메이션
      aim: null,       // 내가 당기는 중인 조준 {stoneId, vx, vy}
      oppAim: null,    // 상대가 당기는 중인 조준 (표시 전용)
      pending: false   // 온라인: 서버 응답을 기다리는 동안 입력 잠금
    },
    // 카드 게임(포커 / 인디언포커) 전용 상태
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
      tableStarted: false, // 온라인: 매치가 시작됐는가
      // 도둑잡기 전용: 내 손패의 변화(뽑기/짝 버리기) 연출용 추적
      thief: { prev: [], seat: -1, ready: false, added: null, out: [], timer: null },
      reveal: null    // 로컬 핫시트: 뽑은 결과를 본인에게 보여 주는 중인 좌석
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
  // 칩 아이콘 (인라인 SVG — 이모지 대신 아이콘 체계와 통일)
  var COIN_ICO = '<svg class="ico" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="4" stroke-width="1.2" opacity="0.6"/></svg>';
  function setChips(el, n) { el.innerHTML = COIN_ICO + ' ' + Number(n); }
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

  // ── 알까기 렌더링 ─────────────────────────────────────
  // 돌 위치는 물리 좌표(0..1000)에서 온다. 화면 크기는 배율일 뿐이라
  // 창을 줄여도(ResizeObserver → renderBoard) 판이 그대로 따라 줄어든다.
  // 엑셀 테마에서는 헤더(첫 행/열)를 뺀 셀 영역이 곧 판이 된다.
  function alkPlayArea() {
    var size = innerSize(), vsize = innerHeight();
    if (state.theme === 'excel') {
      var ux = size / (COLS + 1), uy = vsize / (ROWS + 1);
      return { ox: ux, oy: uy, w: size - ux, h: vsize - uy };
    }
    return { ox: 0, oy: 0, w: size, h: vsize };
  }
  function alkGeom(x, y) {
    var a = alkPlayArea();
    return {
      x: a.ox + x / AK.BOARD * a.w,
      y: a.oy + y / AK.BOARD * a.h,
      d: 2 * AK.RADIUS / AK.BOARD * Math.min(a.w, a.h)
    };
  }
  // 화면 좌표(보드 내부 px) → 물리 좌표
  function alkFromPx(px, py) {
    var a = alkPlayArea();
    return {
      x: (px - a.ox) / (a.w || 1) * AK.BOARD,
      y: (py - a.oy) / (a.h || 1) * AK.BOARD
    };
  }

  function renderAlkStones() {
    usePieceKind('alk');
    var stones = (state.board && state.board.stones) || [];
    var live = Object.create(null);
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (!s.alive) continue;
      var key = 'a' + s.id;
      var g = alkGeom(s.x, s.y);
      var el = pieceEls[key];
      if (!el) {
        el = document.createElement('div');
        el.setAttribute('data-key', key);
        el.setAttribute('data-color', String(s.owner));
        el.className = 'stone alk ' + colorStr(s.owner);
        setPieceGeom(el, g);
        pieceEls[key] = el;
        stonesLayer.appendChild(el);
        if (!state.alk.anim) playEnter(el);   // 굴러가는 중에는 진입 연출 없음
      } else {
        setPieceGeom(el, g);
      }
      live[key] = true;
    }
    alkDropOutPieces(live);
  }

  // 판 밖으로 나간 돌: 즉시 지우지 않고 잠깐 튕겨 나가는 연출 후 제거한다.
  function alkDropOutPieces(live) {
    Object.keys(pieceEls).forEach(function (k) {
      if (live[k]) return;
      var el = pieceEls[k];
      delete pieceEls[k];
      if (!el) return;
      el.classList.add('alk-out');
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    });
  }

  // ── 조준선(슬링샷 화살표) ─────────────────────────────
  // 내가 당기는 중이면 내 조준을, 아니면 상대가 보내 온 조준을 그린다.
  // 화면 표시 전용이라 atan2 를 써도 된다 (시뮬레이션에는 절대 쓰지 않는다).
  var alkAimEl = null;
  function alkClearAimEl() {
    if (alkAimEl && alkAimEl.parentNode) alkAimEl.parentNode.removeChild(alkAimEl);
    alkAimEl = null;
  }
  function renderAlkAim() {
    if (!isAlk()) { alkClearAimEl(); return; }
    var d = state.alk.aim || state.alk.oppAim;
    var s = d ? AK.findStone(state.board, d.stoneId) : null;
    if (!d || !s || !s.alive) { alkClearAimEl(); return; }
    if (!alkAimEl || !alkAimEl.parentNode) {
      alkAimEl = document.createElement('div');
      alkAimEl.className = 'alk-aim';
      markersLayer.appendChild(alkAimEl);
    }
    var g = alkGeom(s.x, s.y);
    var area = alkPlayArea();
    var ratio = Math.min(1, AK.power(d.vx, d.vy) / AK.MAX_POWER);
    var len = g.d * 0.5 + Math.min(area.w, area.h) * 0.3 * ratio;
    var deg = Math.atan2(d.vy, d.vx) * 180 / Math.PI;
    alkAimEl.style.left = g.x + 'px';
    alkAimEl.style.top = g.y + 'px';
    alkAimEl.style.width = len + 'px';
    alkAimEl.style.transform = 'translate(0, -50%) rotate(' + deg + 'deg)';
    alkAimEl.setAttribute('data-power', ratio > 0.7 ? 'high' : (ratio > 0.35 ? 'mid' : 'low'));
    alkAimEl.classList.toggle('opp', !state.alk.aim);
  }

  function renderAlkkagi() {
    renderAlkStones();
    renderAlkAim();
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
    } else if (state.game === 'alkkagi') {
      // 격자(오목과 같은 15x15)는 장식이고, 돌은 물리 좌표 위에 얹힌다
      renderAlkkagi();
    } else {
      renderStones();
      renderMarkers();
    }
  }

  // ============================================================
  // 사이드바 / 정보 갱신
  // ============================================================
  // 카드 게임: 엔진 뷰에서 "판 종료" 를 사이드바 공용 상태로 옮긴다.
  // 좌석 목록(#seatList)을 따로 그리므로 흑/백 turn 은 건드리지 않는다.
  function syncPokerTurn() {
    var v = state.poker.view;
    state.gameOver = !!(v && v.over);
  }

  // 판/매치 결과 한 줄 요약 (포커 전용 — 좌석이 여럿이라 문구가 다르다)
  function pokerResultShort(v) {
    if (!v || !v.over || !v.result) return null;
    // 도둑잡기는 승자가 아니라 "도둑"을 가린다
    if (isThief()) {
      return v.result.loser === null ? '판 종료' : ('도둑 ' + seatName(v.result.loser));
    }
    if (v.matchOver) {
      return (v.matchWinner === null ? '' : seatName(v.matchWinner) + ' ') + '최종 우승';
    }
    var r = v.result;
    if (r.split) return '팟 분배';
    if (r.winner === null) return '판 종료';
    return seatName(r.winner) + ' 승리';
  }

  // 좌석 목록 (플레이어 정보 카드) — 카드 게임에서 2칸짜리 카드를 대신한다
  function renderSeatList() {
    var host = $('seatList');
    if (!host) return;
    if (!isCardGame()) { host.innerHTML = ''; return; }
    var v = state.poker.view;
    var n = pokerSeatCount();
    var actor = pokerActor(v);
    host.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var st = pokerSeatState(v, i);
      var row = document.createElement('div');
      row.className = 'seat-row' + (actor === i ? ' active' : '') +
        (pokerSeatGone(v, i) ? ' gone' : '');
      row.setAttribute('data-seat', String(i));
      var icon = document.createElement('span');
      icon.className = 'stone-icon small ' + (i % 2 ? 'white' : 'black');
      var nm = document.createElement('span');
      nm.className = 'seat-name';
      nm.textContent = seatName(i) +
        (state.online && state.poker.hostSeat === i ? ' (방장)' : '') +
        (!isThief() && v && v.dealer === i ? ' · 딜러' : '');
      var sst = document.createElement('span');
      sst.className = 'seat-state';
      sst.textContent = st || (actor === i ? '생각 중...' : '');
      var chips = document.createElement('span');
      chips.className = 'seat-chips';
      // 도둑잡기는 칩이 없다 → 남은 손패 수를 보여 준다
      if (isThief()) chips.textContent = seatCardCount(v, i) + '장';
      else setChips(chips, v ? v.chips[i] : seatLobbyChips(i));
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
    return PE().START_CHIPS;
  }
  // 도둑잡기 좌석의 남은 손패 수 (뷰가 없으면 로비가 알려 준 값)
  function seatCardCount(v, i) {
    if (v) return thiefCount(v, i);
    var list = state.poker.lobby;
    for (var k = 0; k < list.length; k++) {
      if (list[k].seat === i && typeof list[k].cards === 'number') return list[k].cards;
    }
    return 0;
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
      if (isThief()) {
        // 칩이 없는 종목 — 남은 손패 수로 대체한다
        $('chipsBlack').textContent = seatCardCount(pv, 0) + '장';
        $('chipsWhite').textContent = seatCardCount(pv, 1) + '장';
      } else {
        var pchips = pv ? pv.chips : [PE().START_CHIPS, PE().START_CHIPS];
        setChips($('chipsBlack'), pchips[0]);
        setChips($('chipsWhite'), pchips[1]);
      }
    } else {
      $('timerBlack').textContent = fmtTime(state.times[BLACK]);
      $('timerWhite').textContent = fmtTime(state.times[WHITE]);
    }

    // 현재 차례 (카드 게임은 좌석 이름)
    if (isCardGame()) {
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
    if (isCardGame()) {
      var tv = state.poker.view;
      if (tv && tv.over) gs = pokerResultShort(tv);
      else if (state.online && !state.started) gs = '대기 중';
    } else if (state.winner === 0) gs = '무승부';
    else if (state.winner === BLACK) gs = colorName(BLACK) + ' 승리';
    else if (state.winner === WHITE) gs = colorName(WHITE) + ' 승리';
    $('gameStateText').textContent = gs;

    // 점수 표시 (오델로: 돌 개수 / 알까기: 판에 남은 돌 개수)
    var scoreRow = $('scoreRow');
    if (scoreRow) {
      if (isAlk()) {
        scoreRow.hidden = false;
        $('scoreBlack').textContent = AK.count(state.board, BLACK);
        $('scoreWhite').textContent = AK.count(state.board, WHITE);
      } else if (state.game === 'othello') {
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
    // 돌 바꾸기는 카드 게임에 의미가 없다(좌석 고정) → 항상 숨김
    var canSwap = state.online && state.started && !state.gameOver &&
      state.moves.length === 0 && !card;
    var btn = $('btnSwap');
    if (btn) btn.style.display = canSwap ? '' : 'none';
    // 게임 바꾸기: 카드 게임(테이블 방)은 좌석/칩이 종목에 묶여 있어 아예 숨긴다.
    var canChange = card ? false : canSwap;
    var row = $('gameChangeRow');
    if (row) row.style.display = canChange ? '' : 'none';
    syncGameChangeOptions();
    renderTableLobby();
  }

  // ── 포커 테이블 로비 (방 안 참가자 목록 + 방장 시작 버튼) ──
  function renderTableLobby() {
    var box = $('tableLobbyBox');
    if (!box) return;
    var show = isCardGame() && state.online && state.inRoom;
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
      // 도둑잡기는 칩 대신 손패 수 (아직 시작 전이면 아무것도 적지 않는다)
      if (isThief()) c.textContent = typeof p.cards === 'number' ? (p.cards + '장') : '';
      else setChips(c, p.chips);
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
      else ptxt = pokerResultShort(pv) ||
        (pokerActor(pv) === null ? '준비' : seatName(pokerActor(pv)) + ' 차례');
      left.textContent = ptxt;
      var PNB = ' ';
      right.textContent = (isThief()
        ? '내 카드: ' + seatCardCount(pv, pokerMyIndex()) + '장'
        : '내 칩: ' + (pv ? pv.chips[pokerMyIndex()] : PE().START_CHIPS)) +
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
    if (isAlk()) {
      // 알까기는 "판에 남은 돌"이 곧 점수다
      right.textContent = '흑 ' + AK.count(state.board, BLACK) + ' : ' +
        AK.count(state.board, WHITE) + ' 백' + NB + NB + NB + NB + '100%';
    } else if (state.game === 'othello') {
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
    // 카드 게임: 수식 입력줄에 팟을 =POT(240) 형태로 노출한다.
    // 도둑잡기는 팟이 없으니 판에 남은 카드 수를 =CARDS(5) 로 보여 준다.
    if (isCardGame()) {
      var pv = state.poker.view;
      nb.textContent = 'B2';
      if (isThief()) fx.textContent = pv ? '=CARDS(' + pv.inPlay + ')' : '';
      else fx.textContent = pv ? '=POT(' + pv.pot + ')' : '';
      return;
    }
    // 알까기: 마지막 치기를 =FLICK("흑돌") 로 노출한다 (좌표가 없는 종목)
    if (isAlk()) {
      var lf = state.moves.length ? state.moves[state.moves.length - 1] : null;
      nb.textContent = lf ? lf.cell : 'A1';
      fx.textContent = lf ? '=FLICK("' + colorName(lf.color) + '")' : '';
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

    // 알까기: 좌표 대신 "무엇이 몇 개 나갔는가"를 적는다
    if (isAlk()) {
      state.moves.forEach(function (mv, i) {
        var row = document.createElement('div');
        row.className = 'move-row' + (i === state.moves.length - 1 ? ' latest' : '');
        var num = document.createElement('span');
        num.className = 'move-num';
        num.textContent = circled(i + 1);
        var icon = document.createElement('span');
        icon.className = 'stone-icon small ' + colorStr(mv.color);
        var name = document.createElement('span');
        name.textContent = colorName(mv.color);
        var note = document.createElement('span');
        note.className = 'log-text alk-note';
        note.textContent = alkMoveText(mv);
        row.appendChild(num); row.appendChild(icon); row.appendChild(name); row.appendChild(note);
        list.appendChild(row);
      });
      list.scrollTop = list.scrollHeight;
      return;
    }

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
    // 끝난 판에서도 무를 수 있다 — 종료 상태를 지우고 이어서 진행
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
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
    // 끝난 판이었어도 무르기로 되살아난다 (종료 표시/모달 정리)
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
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
  // 알까기 (Alkkagi)
  // ------------------------------------------------------------
  // 한 수 = "돌 하나를 어느 방향으로 얼마나 세게 튕기는가" 하나뿐이다.
  //  · 로컬  — 클라이언트가 직접 시뮬레이션을 돌리고 그 결과가 곧 판이다.
  //  · 온라인 — 벡터만 서버로 보낸다. 서버가 파워를 자르고 권위 있는 최종
  //    상태를 만들어 방송하면, 두 클라이언트가 같은 벡터를 로컬에서 다시
  //    굴려 애니메이션을 그리고(결정적이므로 화면이 같다) 끝나면 서버가
  //    보낸 final 로 스냅한다. 어떤 이유로도 두 화면이 갈리지 않는다.
  // ============================================================
  var ALK_PULL_MAX = 300;     // 이만큼(물리 단위) 당기면 최대 파워
  var ALK_MIN_RATIO = 0.06;   // 이보다 짧게 당기고 놓으면 취소로 본다
  var ALK_AIM_MS = 100;       // 조준 중계 주기 (~10Hz)

  function alkFresh() {
    state.alk.anim = null;
    state.alk.aim = null;
    state.alk.oppAim = null;
    state.alk.pending = false;
    alkDrag = null;
    alkClearAimEl();
  }

  // 지금 내가 돌을 튕길 수 있는가
  function alkCanAct() {
    if (!isAlk()) return false;
    if (state.alk.anim || state.alk.pending) return false;
    if (state.gameOver) return false;
    if (state.online) {
      if (!state.started) return false;
      return state.turn === colorNum(state.myColor);
    }
    return true;   // 로컬 핫시트: 지금 차례인 쪽이 자기 돌을 튕긴다
  }
  function alkMyColor() {
    return state.online ? colorNum(state.myColor) : state.turn;
  }
  // 누른 지점에서 가장 가까운 "내 돌" (조금 넉넉하게 잡는다)
  function alkPickStone(p) {
    var stones = (state.board && state.board.stones) || [];
    var grab = AK.RADIUS * 1.35;
    var best = null, bestD2 = grab * grab;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (!s.alive || s.owner !== alkMyColor()) continue;
      var dx = s.x - p.x, dy = s.y - p.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { best = s; bestD2 = d2; }
    }
    return best;
  }

  // 기보 표기용 셀 이름 (엑셀 테마 이름 상자에도 쓴다)
  function alkCellLabel(snap, id) {
    var list = (snap && snap.stones) || [];
    var s = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) s = list[i];
    if (!s) return 'A1';
    var c = Math.floor(s.x / AK.BOARD * COLS);
    var r = Math.floor(s.y / AK.BOARD * ROWS);
    if (c < 0) c = 0; if (c > COLS - 1) c = COLS - 1;
    if (r < 0) r = 0; if (r > ROWS - 1) r = ROWS - 1;
    return String.fromCharCode(65 + c) + (r + 1);
  }

  // 기보 한 줄: '알까기 — 백돌 1개 아웃' / '알까기 — 아웃 없음'
  function alkMoveText(mv) {
    var outs = mv.outs || [];
    var mine = 0;
    outs.forEach(function (o) { if (o.owner === mv.color) mine++; });
    var opp = outs.length - mine;
    var parts = [];
    if (opp) parts.push(colorName(otherColor(mv.color)) + ' ' + opp + '개 아웃');
    if (mine) parts.push('자기 돌 ' + mine + '개 아웃');
    if (!parts.length) parts.push('아웃 없음');
    return '알까기 — ' + parts.join(', ');
  }

  // ── 애니메이션 ────────────────────────────────────────
  // 시뮬레이션은 120Hz 고정이고 화면은 rAF 주기다. 흐른 시간만큼 틱을 돌린다.
  function alkAnimate(input, finalSer, onDone) {
    var sim = AK.begin(state.board, input);
    state.alk.aim = null;
    state.alk.oppAim = null;
    state.alk.anim = { sim: sim, final: finalSer || null, onDone: onDone || null, last: 0, acc: 0 };
    state.board = sim.state;     // 굴러가는 중간 상태를 그대로 그린다
    renderAlkkagi();
    updateSidebar();
    window.requestAnimationFrame(alkFrame);
  }
  function alkFrame(ts) {
    var a = state.alk.anim;
    if (!a) return;
    if (!a.last) a.last = ts;
    var dt = (ts - a.last) / 1000;
    a.last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;    // 탭 전환 등으로 크게 밀리면 잘라낸다
    a.acc += dt;
    var steps = 0;
    while (a.acc >= AK.DT && !a.sim.done && steps < 120) {
      AK.step(a.sim);
      a.acc -= AK.DT;
      steps++;
    }
    renderAlkkagi();
    updateSidebar();
    if (!a.sim.done) { window.requestAnimationFrame(alkFrame); return; }
    alkFinishAnim();
  }
  // 애니메이션 종료: 권위 있는 최종 상태로 스냅한 뒤 뒷처리를 넘긴다.
  function alkFinishAnim() {
    var a = state.alk.anim;
    if (!a) return;
    state.alk.anim = null;
    state.board = a.final ? AK.deserialize(a.final) : a.sim.state;
    renderAlkkagi();
    if (a.onDone) a.onDone();
  }

  // 한 수 확정: 기보 기록 + 승패/차례 반영
  function alkCommit(color, stoneId, snapshot, events, finalState) {
    var outs = [];
    (events || []).forEach(function (e) {
      if (e && e.t === 'out') outs.push({ id: e.id, owner: e.owner });
    });
    state.moves.push({
      kind: 'flick',
      color: color,
      stoneId: stoneId,
      snapshot: snapshot,      // 무르기용 (치기 직전 상태)
      outs: outs,
      cell: alkCellLabel(snapshot, stoneId)
    });
    state.alk.pending = false;
    var w = (finalState && finalState.winner) || null;
    if (w === BLACK || w === WHITE) {
      state.gameOver = true;
      state.winner = w;
      renderBoard();
      updateSidebar();
      renderMoveList();
      showResultModal(w);
      return;
    }
    state.turn = finalState ? finalState.turn : otherColor(color);
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // ── 치기 (로컬/온라인 공통 입구) ───────────────────────
  function alkFire(stoneId, vx, vy) {
    var v = AK.clampVector(vx, vy);
    var color = alkMyColor();
    var chk = AK.validateFlick(state.board, color, stoneId, v.vx, v.vy);
    if (!chk.ok) {
      if (chk.reason === 'too-weak') toast('조금 더 세게 당겨 주세요');
      return;
    }
    if (state.online) {
      // 서버가 계산한 결과가 돌아오면 그때 양쪽이 같이 굴린다
      state.alk.pending = true;
      wsSend({ type: 'move', kind: 'flick', stoneId: stoneId, vx: v.vx, vy: v.vy });
      return;
    }
    var snap = AK.serialize(state.board);
    var res = AK.simulate(state.board, { stoneId: stoneId, vx: v.vx, vy: v.vy });
    var finalSer = AK.serialize(res.finalState);
    alkAnimate({ stoneId: stoneId, vx: v.vx, vy: v.vy }, finalSer, function () {
      alkCommit(color, stoneId, snap, res.events, res.finalState);
    });
  }

  // 서버 방송 반영 (친 사람 화면도 이 경로로 애니메이션을 시작한다)
  function applyRemoteFlick(msg) {
    if (state.alk.anim) alkFinishAnim();   // 혹시 남아 있던 애니메이션 정리
    var color = colorNum(msg.color);
    var snap = AK.serialize(state.board);
    var input = { stoneId: msg.stoneId | 0, vx: Number(msg.vx), vy: Number(msg.vy) };
    var finalSer = msg.final || null;
    var events = msg.events || [];
    alkAnimate(input, finalSer, function () {
      alkCommit(color, input.stoneId, snap, events,
        finalSer ? AK.deserialize(finalSer) : null);
    });
  }

  // ── 무르기 ────────────────────────────────────────────
  function localUndoAlk() {
    if (state.alk.anim) { toast('돌이 아직 구르고 있습니다'); return; }
    if (!state.moves.length) return;
    var last = state.moves.pop();
    state.board = AK.deserialize(last.snapshot);
    state.turn = last.color;      // 무른 사람 차례로 복귀
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    state.alk.aim = null;
    state.alk.oppAim = null;
    state.alk.pending = false;
    hideModal();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }
  // 서버가 수락한 무르기: 전체 상태를 그대로 받는다 (역재생이 불가능한 물리라서)
  function remoteUndoAlk(msg) {
    if (state.alk.anim) alkFinishAnim();
    if (msg.state) state.board = AK.deserialize(msg.state);
    if (state.moves.length) state.moves.pop();
    if (msg.turn) state.turn = colorNum(msg.turn);
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    state.alk.aim = null;
    state.alk.oppAim = null;
    state.alk.pending = false;
    hideModal();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // ── 조준 드래그 (마우스/터치 공용 — Pointer Events) ─────
  // 새총처럼 "당긴 반대 방향"으로 날아간다. 당긴 길이가 곧 파워다.
  var alkDrag = null;
  function alkPointFromEvent(e) {
    var rect = clickOverlay.getBoundingClientRect();
    return alkFromPx(e.clientX - rect.left, e.clientY - rect.top);
  }
  function alkSendAim() {
    if (!state.online || !state.started || !alkDrag) return;
    var a = state.alk.aim;
    if (!a) return;
    var now = Date.now();
    if (alkDrag.aimAt && now - alkDrag.aimAt < ALK_AIM_MS) return;
    if (alkDrag.aimVx === a.vx && alkDrag.aimVy === a.vy) return;   // 변한 게 없으면 안 보낸다
    alkDrag.aimAt = now;
    alkDrag.aimVx = a.vx;
    alkDrag.aimVy = a.vy;
    wsSend({ type: 'aim', stoneId: a.stoneId, dx: a.vx, dy: a.vy });
  }
  function alkEndDrag(fire) {
    if (!alkDrag) return;
    var d = alkDrag;
    alkDrag = null;
    state.alk.aim = null;
    renderAlkAim();
    if (state.online && state.started) wsSend({ type: 'aim', clear: true });
    if (!fire) return;
    var mag = AK.power(d.vx, d.vy);
    if (mag < AK.MAX_POWER * ALK_MIN_RATIO || mag < AK.MIN_POWER) return;  // 취소
    alkFire(d.id, d.vx, d.vy);
  }

  clickOverlay.addEventListener('pointerdown', function (e) {
    if (!isAlk()) return;
    if (!alkCanAct()) {
      if (state.online && state.started && !state.gameOver &&
          state.turn !== colorNum(state.myColor)) toast('상대 차례입니다');
      return;
    }
    var s = alkPickStone(alkPointFromEvent(e));
    if (!s) return;
    var p = alkPointFromEvent(e);
    alkDrag = { id: s.id, ox: p.x, oy: p.y, vx: 0, vy: 0, aimAt: 0, pid: e.pointerId };
    state.alk.aim = null;
    try { clickOverlay.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  });

  clickOverlay.addEventListener('pointermove', function (e) {
    if (!alkDrag || e.pointerId !== alkDrag.pid) return;
    var p = alkPointFromEvent(e);
    var pullX = alkDrag.ox - p.x;      // 당긴 반대 방향으로 날아간다
    var pullY = alkDrag.oy - p.y;
    var pull = Math.sqrt(pullX * pullX + pullY * pullY);
    if (pull < 1e-6) {
      alkDrag.vx = 0; alkDrag.vy = 0;
      state.alk.aim = null;
      renderAlkAim();
      return;
    }
    var ratio = Math.min(1, pull / ALK_PULL_MAX);
    var k = AK.MAX_POWER * ratio / pull;
    alkDrag.vx = pullX * k;
    alkDrag.vy = pullY * k;
    state.alk.aim = { stoneId: alkDrag.id, vx: alkDrag.vx, vy: alkDrag.vy };
    renderAlkAim();
    alkSendAim();
    e.preventDefault();
  });

  clickOverlay.addEventListener('pointerup', function (e) {
    if (!alkDrag || e.pointerId !== alkDrag.pid) return;
    alkEndDrag(true);
    e.preventDefault();
  });
  clickOverlay.addEventListener('pointercancel', function () { alkEndDrag(false); });
  // Escape 로 조준 취소 (결과 모달 닫기와 겹치지 않는다 — 드래그 중일 때만)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (alkDrag) alkEndDrag(false);
  });

  // ============================================================
  // 카드 게임 (포커 2~6인 / 인디언포커 2~6인)
  //   2인 포커가 곧 헤즈업(1:1)이다 — 좌석 수만 다를 뿐 경로는 하나다.
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
    var t = state.poker.thief;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; }
    t.prev = []; t.seat = -1; t.ready = false; t.added = null; t.out = [];
    state.poker.reveal = null;
    thiefClearReveal();
    hideGate();
  }

  // 뷰/상태에서 "지금 결정해야 하는 사람". 없으면 null.
  // 마스킹된 뷰에서도 동작한다 (카드 장수와 오픈 여부는 공개 정보).
  // 좌석 수만큼 훑는다. 폴드/파산/퇴장한 좌석은 결정할 것이 없다.
  function pokerActor(v) {
    if (!v || v.over) return null;
    var n = v.hands.length, i;
    // 도둑잡기: 지금 뽑을 차례인 좌석 하나뿐이다 (뷰/전체 상태 모두 turn 을 갖는다)
    if (isThief()) return typeof v.turn === 'number' ? v.turn : null;
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
  // 좌석이 이번 판에서 빠졌는가 (다이 / 파산 / 퇴장 · 도둑잡기는 탈출 / 퇴장)
  function pokerSeatGone(v, i) {
    if (!v) return false;
    if (isThief()) return !!((v.escaped && v.escaped[i]) || (v.left && v.left[i]));
    return !!(v.folded && v.folded[i]);
  }
  // 좌석 상태 라벨 (없으면 null)
  function pokerSeatState(v, i) {
    if (!v) return null;
    if (v.left && v.left[i]) return '퇴장';
    if (isThief()) {
      if (v.escaped && v.escaped[i]) {
        var k = (v.escapeOrder || []).indexOf(i);
        return k === -1 ? '탈출' : ('탈출 ' + (k + 1) + '위');
      }
      if (v.over && v.result && v.result.loser === i) return '도둑';
      return null;
    }
    if (v.out && v.out[i]) return '파산';
    if (v.folded && v.folded[i]) return '다이';
    return null;
  }
  // 좌석의 남은 손패 수 (도둑잡기 — 뷰의 counts 를 우선 쓴다)
  function thiefCount(v, i) {
    if (!v) return 0;
    if (v.counts && typeof v.counts[i] === 'number') return v.counts[i];
    return (v.hands && v.hands[i]) ? v.hands[i].cards.length : 0;
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
    if (isThief()) return false;    // 도둑잡기는 "남의 패"를 고른다 (thiefCanDraw)
    if (v.phase === 'discard') return v.hands[me].cards.length === 4;
    if (v.phase === 'open') return !pokerHasOpen(v, me);
    return false;
  }

  // ── 로그 ──────────────────────────────────────────────
  function circled(n) {
    return (n >= 1 && n <= 20) ? String.fromCharCode(0x245F + n) : ('(' + n + ')');
  }
  function appendPokerEvents(events) {
    // 새 판의 머리글 이벤트 (도둑잡기는 배분, 나머지는 앤티)
    var HEAD = isThief() ? 'deal' : 'hand';
    (events || []).forEach(function (ev) {
      var text = PE().describeEvent(ev, seatNames());
      if (!text) return;
      if (ev.t === HEAD) state.poker.seq = 0;
      state.poker.seq += 1;
      state.poker.log.push({ text: text, seq: state.poker.seq, head: ev.t === HEAD });
    });
  }

  // ── 렌더링 ────────────────────────────────────────────
  function clearCardTable() {
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
        (opts.mine && card.open ? ' mine-open' : '') +
        (opts.won ? ' won' : '');
      cell.textContent = K.cardText(card);
      el.appendChild(makeCorner('tl', card));
      el.appendChild(makeCorner('br', card));
    }
    el.appendChild(cell);
    return el;
  }

  // 인디언포커 카드 한 장.
  //  · 남의 카드 = 앞면(숫자만). 10 은 살짝 강조한다.
  //  · 내 카드 = 뒷면 '?' — 나만 내 카드를 볼 수 없다는 것이 이 게임의 전부다.
  //    (card 가 null 이면 볼 수 없는 카드다. 뷰가 이미 가려서 보내 주므로
  //     값이 DOM 에 들어올 방법 자체가 없다.)
  function makeIndianCardEl(card, mine) {
    var el = document.createElement('div');
    var num = document.createElement('span');
    num.className = 'ip-num';
    var cell = document.createElement('span');
    cell.className = 'pc-cell';        // 엑셀 테마에서만 보이는 셀 텍스트
    if (!card) {
      el.className = 'pcard ip back' + (mine ? ' mine' : '');
      num.textContent = '?';
      cell.textContent = '###';
    } else {
      el.className = 'pcard ip' + (card.r === IP.PENALTY_CARD ? ' ten' : '');
      num.textContent = String(card.r);
      cell.textContent = String(card.r);
    }
    el.appendChild(num);
    el.appendChild(cell);
    return el;
  }

  // ── 도둑잡기 카드 ─────────────────────────────────────
  // 조커 아트: 손으로 좌표를 잡은 광대 모자(방울 3개) — 어떤 기성 이미지도
  // 쓰지 않는다. 세 갈래로 늘어진 뿔 + 끝의 방울 + 머리띠가 전부다.
  var JOKER_ART =
    '<svg class="pc-joker-art" viewBox="0 0 40 44" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M20 28C11 26 6 19 7 12"/>' +
    '<path d="M20 28C20 19 20 13 20 8"/>' +
    '<path d="M20 28C29 26 34 19 33 12"/>' +
    '<circle cx="7" cy="9" r="2.6" fill="currentColor" stroke="none"/>' +
    '<circle cx="20" cy="5" r="2.6" fill="currentColor" stroke="none"/>' +
    '<circle cx="33" cy="9" r="2.6" fill="currentColor" stroke="none"/>' +
    '<rect x="7" y="28" width="26" height="7" rx="3.5" fill="currentColor" stroke="none"/>' +
    '</svg>';

  // 조커 한 장. 엑셀 테마에서는 '★JOKER' 셀 텍스트로 바뀐다.
  function makeJokerCardEl() {
    var el = document.createElement('div');
    el.className = 'pcard joker';
    var art = document.createElement('span');
    art.className = 'pc-joker';
    art.innerHTML = JOKER_ART;
    var label = document.createElement('span');
    label.className = 'pc-joker-label';
    label.textContent = '★ JOKER';
    var cell = document.createElement('span');
    cell.className = 'pc-cell';
    cell.textContent = '★JOKER';
    el.appendChild(art);
    el.appendChild(label);
    el.appendChild(cell);
    return el;
  }

  // 도둑잡기 카드 한 장 (card 가 null 이면 뒷면 = 남의 패)
  function makeThiefCardEl(card) {
    if (!card) return makeCardEl(null, {});
    if (card.r === TH.JOKER_RANK) return makeJokerCardEl();
    return makeCardEl(card, {});
  }

  function thiefKey(c) { return c ? (c.r + '/' + c.s) : '?'; }
  function thiefFromKey(k) {
    var a = String(k).split('/');
    return { r: Number(a[0]), s: Number(a[1]) };
  }

  // 내 손패의 "표시 순서". 엔진은 뽑기 인덱스를 위해 진짜 순서를 유지하므로
  // 정렬은 화면에서만 한다 (data-idx 에는 진짜 인덱스를 그대로 남긴다).
  // 조커가 맨 앞, 그 다음 무늬 → 랭크 순.
  function thiefSorted(cards) {
    var arr = cards.map(function (c, i) { return { c: c, i: i }; });
    arr.sort(function (a, b) {
      if (!a.c || !b.c) return a.i - b.i;
      var aj = a.c.r === TH.JOKER_RANK ? 0 : 1;
      var bj = b.c.r === TH.JOKER_RANK ? 0 : 1;
      if (aj !== bj) return aj - bj;
      if (a.c.s !== b.c.s) return a.c.s - b.c.s;
      if (a.c.r !== b.c.r) return a.c.r - b.c.r;
      return a.i - b.i;
    });
    return arr;
  }

  // 지금 이 화면의 주인이 idx 좌석의 패에서 한 장 뽑을 수 있는가
  function thiefCanDrawFrom(v, idx) {
    if (!v || v.over) return false;
    var me = pokerMyIndex();
    if (v.turn !== me || v.target !== idx) return false;
    // 온라인은 서버가 내려 준 "내 시점" 뷰여야 하고,
    // 로컬 핫시트는 가리개를 넘긴 뒤여야 한다.
    if (state.online) return v.me === me;
    return state.poker.viewer === me;
  }

  // 내 손패가 어떻게 변했는지(뽑아 온 카드 / 짝지어 버린 카드) 계산한다.
  // 같은 뷰로 다시 그리면 차이가 없으므로 연출이 두 번 재생되지 않는다.
  function thiefTrackHand(v, me) {
    var t = state.poker.thief;
    var mineView = !!(v && v.me === me && v.hands && v.hands[me]);
    var keys = mineView ? v.hands[me].cards.map(thiefKey) : [];
    if (!mineView || !t.ready || t.seat !== me) {
      t.prev = keys;
      t.seat = me;
      t.ready = mineView;
      t.added = null;
      t.out = [];
      return;
    }
    var pool = t.prev.slice();
    var added = null;
    keys.forEach(function (k) {
      var p = pool.indexOf(k);
      if (p === -1) added = k;
      else pool.splice(p, 1);
    });
    t.prev = keys;
    t.added = added;
    // 사라진 카드는 짝지어 버린 2장뿐이다 (그 이상이면 새 판이므로 연출 없음)
    t.out = pool.length && pool.length <= 2 ? pool.slice() : [];
    // 짝이 맞아 곧바로 버려진 경우, 뽑아 온 카드는 손패에 들어온 적이 없다.
    // 뷰가 "나에게만" 실어 준 lastDraw 로 그 한 장을 채워 두 장이 함께 사라지게 한다.
    if (t.out.length === 1 && v.lastDraw && v.lastDraw.paired && v.lastDraw.p === me) {
      t.out.push(thiefKey(v.lastDraw.card));
    }
    if (t.out.length) {
      if (t.timer) clearTimeout(t.timer);
      t.timer = setTimeout(function () {
        t.timer = null;
        t.out = [];
        t.added = null;
        if (isThief()) renderCardTable();
      }, 460);
    }
  }

  function renderThiefHand(host, v, idx, mine) {
    host.innerHTML = '';
    if (!v) return;
    var t = state.poker.thief;
    if (mine && v.me === idx) {
      // 내 패 — 앞면. 정렬해서 보여 주되 뽑기 인덱스는 진짜 순서를 쓴다.
      thiefSorted(v.hands[idx].cards).forEach(function (o) {
        var el = makeThiefCardEl(o.c);
        el.setAttribute('data-idx', String(o.i));
        if (t.added && thiefKey(o.c) === t.added) el.classList.add('just-drawn');
        host.appendChild(el);
      });
      // 짝지어 버린 2장은 잠깐 남겨 두고 사라지게 한다
      t.out.forEach(function (k) {
        var el = makeThiefCardEl(thiefFromKey(k));
        el.classList.add('pair-out');
        host.appendChild(el);
      });
      return;
    }
    // 남의 패 — 장수만큼 뒷면. 내 차례이고 이 좌석이 뽑을 대상이면 클릭 가능.
    var n = thiefCount(v, idx);
    var pickable = thiefCanDrawFrom(v, idx);
    for (var i = 0; i < n; i++) {
      var back = makeThiefCardEl(v.hands[idx].cards[i] || null);
      back.setAttribute('data-idx', String(i));
      if (pickable) {
        back.classList.add('selectable');
        (function (k) {
          back.addEventListener('click', function () { thiefDraw(k); });
        })(i);
      }
      host.appendChild(back);
    }
  }

  // 라벨이 붙은 카드 묶음 하나 ('비공개 · 나만 봄' / '공개 · 상대에게 보임').
  function makeCardGroup(label, extraClass) {
    var g = document.createElement('div');
    g.className = 'pc-group' + (extraClass ? ' ' + extraClass : '');
    var l = document.createElement('span');
    l.className = 'pc-group-label';
    l.textContent = label;
    g.appendChild(l);
    return g;
  }

  function renderHandCards(host, v, idx, mine, pickable) {
    if (isThief()) { renderThiefHand(host, v, idx, mine); return; }
    host.innerHTML = '';
    if (!v) return;
    var indian = isIndian();
    var cards = v.hands[idx].cards;

    function buildCardEl(card, i) {
      var el = indian ? makeIndianCardEl(card, mine) : makeCardEl(card, { mine: mine });
      el.setAttribute('data-idx', String(i));
      if (pickable) {
        el.classList.add('selectable');
        el.addEventListener('click', function () { pokerPick(i); });
      }
      return el;
    }

    // 내 카드이고 (인디언포커 제외), 오픈된 카드가 하나라도 있으면
    // '비공개' / '공개' 두 묶음으로 나눠 보여준다. 오픈 전(매장/오픈 선택 단계)에는
    // 지금처럼 한 줄로만 보여줘 선택 UX 를 그대로 유지한다.
    var showGroups = mine && !indian && cards.some(function (c) { return c && c.open; });

    if (!showGroups) {
      cards.forEach(function (card, i) {
        host.appendChild(buildCardEl(card, i));
      });
      return;
    }

    var hiddenGroup = makeCardGroup('비공개 · 나만 봄');
    var openGroup = makeCardGroup('공개 · 상대에게 보임', 'pc-group-open');
    cards.forEach(function (card, i) {
      var el = buildCardEl(card, i);
      (card && card.open ? openGroup : hiddenGroup).appendChild(el);
    });
    // 각 묶음은 라벨(span) 한 개를 이미 갖고 있으므로 childElementCount > 1 이어야
    // 실제 카드가 들어 있는 것이다. flex-grow 를 카드 수에 비례시켜
    // 두 묶음의 카드 폭이 동일해지도록 한다 (.pcard 는 flex:1 1 0).
    var nHidden = hiddenGroup.childElementCount - 1;
    var nOpen = openGroup.childElementCount - 1;
    hiddenGroup.style.flex = nHidden + ' 1 0%';
    openGroup.style.flex = nOpen + ' 1 0%';
    if (nHidden > 0) host.appendChild(hiddenGroup);
    if (nOpen > 0) host.appendChild(openGroup);
  }

  function pokerPhaseText(v) {
    if (!v) return '';
    if (v.over) return '판 종료';
    if (isThief()) {
      var alive = 0;
      for (var i = 0; i < v.players; i++) if (!pokerSeatGone(v, i)) alive += 1;
      return '남은 사람 ' + alive + '명';
    }
    if (isIndian()) return v.phase === 'bet' ? '베팅 (내 카드는 볼 수 없습니다)' : '';
    if (v.phase === 'discard') return '매장 (1장 버리기)';
    if (v.phase === 'open') return '오픈 (1장 공개)';
    if (v.phase === 'bet') return v.round + '라운드 베팅';
    return '';
  }

  // 인디언포커: 승부는 족보가 아니라 숫자 하나다 ('10 vs 7' 형태)
  function indianCardsText(v, winners) {
    var cards = (v.result && v.result.cards) || [];
    var win = [], rest = [];
    cards.forEach(function (c, i) {
      if (c === null || c === undefined) return;
      if (winners.indexOf(i) !== -1) win.push(c);
      else rest.push(c);
    });
    if (!win.length) return '';
    rest.sort(function (a, b) { return b - a; });
    return win[0] + (rest.length ? ' vs ' + rest.join(', ') : '');
  }
  // 팟을 실제로 받은 좌석 목록 (분배면 여러 명)
  function pokerWinners(r) {
    var list = [];
    (r.payouts || []).forEach(function (amt, i) { if (amt > 0) list.push(i); });
    if (!list.length && r.winner !== null && r.winner !== undefined) list = [r.winner];
    return list;
  }
  // 벌칙 요약 ('플레이어 3 벌금 10')
  function penaltyText(v) {
    var ps = (v.result && v.result.penalties) || [];
    if (!ps.length) return '';
    return ps.map(function (x) {
      return seatName(x.p) + ' 벌금 ' + x.amount;
    }).join(' · ');
  }

  // 도둑잡기: 탈출 순서 한 줄 ('플레이어 2 → 플레이어 1')
  function thiefEscapeText(v) {
    var ord = (v.result && v.result.escapeOrder) || v.escapeOrder || [];
    return ord.map(seatName).join(' → ');
  }
  function thiefResultText(v) {
    if (!v || !v.over || !v.result) return '';
    if (v.result.loser === null) return '판 종료';
    var esc = thiefEscapeText(v);
    return '도둑: ' + seatName(v.result.loser) + (esc ? ' · 탈출 ' + esc : '');
  }

  function pokerResultText(v) {
    if (!v || !v.over || !v.result) return '';
    var r = v.result;
    if (isThief()) return thiefResultText(v);
    if (isIndian()) {
      var ws = pokerWinners(r);
      var pen = penaltyText(v);
      var body;
      if (r.split) body = '팟 ' + r.amount + ' 분배 (' + ws.map(seatName).join(', ') + ')';
      else if (!ws.length) body = '판 종료';
      else if (!r.revealed) body = seatName(ws[0]) + ' 승 (다른 참가자 다이) +' + r.amount;
      else body = seatName(ws[0]) + ' 승 (' + indianCardsText(v, ws) + ') +' + r.amount;
      return body + (pen ? ' · ' + pen : '');
    }
    if (r.split) return '무승부 — 팟 ' + r.amount + ' 분배';
    var name = seatName(r.winner);
    if (!r.revealed) return name + ' 승 (상대 다이) +' + r.amount;
    var cat = r.hands[r.winner] ? K.catName(r.hands[r.winner].cat) : '';
    return name + ' 승 (' + cat + ') +' + r.amount;
  }

  // ── 도둑잡기 액션 바 ──────────────────────────────────
  // 버튼은 '패 섞기' 하나뿐이다 (뽑기는 상대 카드를 직접 누른다).
  //  · 온라인 — 지금 뽑히는 쪽(대상)에게만 보인다.
  //  · 로컬 핫시트 — 대상이 옆에서 눌러 주면 된다. 자기 패를 섞는 것이라
  //    화면(뽑는 사람 시점)에는 어떤 정보도 드러나지 않는다.
  function renderThiefActions(host, v, me) {
    if (!v) { addHint(host, state.online ? waitingHint() : ''); return; }
    if (v.over) { addHint(host, thiefResultText(v)); return; }
    var gated = !state.online && state.poker.viewer === null;
    var target = typeof v.target === 'number' ? v.target : null;
    var turn = typeof v.turn === 'number' ? v.turn : null;
    // 로컬: 방금 뽑은 사람에게 결과를 보여 주는 중 (다음 사람은 아직 보면 안 된다)
    if (!state.online && state.poker.reveal === me) {
      addHint(host, '가져온 카드를 확인하세요');
      return;
    }
    if (gated) addHint(host, '차례를 넘기는 중...');
    else if (turn === me) addHint(host, seatName(target) + '의 패에서 카드를 1장 뽑으세요');
    else addHint(host, seatName(turn) + '이(가) ' + seatName(target) + '의 패에서 뽑는 중...');

    var canShuffle = target !== null && !v.shuffled &&
      (state.online ? v.me === target : !gated);
    if (!canShuffle) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ct-btn';
    btn.setAttribute('data-action', 'shuffle');
    btn.textContent = state.online ? '패 섞기' : (seatName(target) + ' 패 섞기');
    btn.addEventListener('click', function () { thiefShuffle(); });
    host.appendChild(btn);
  }

  function renderActionBar(v, me) {
    var host = $('ctActions');
    host.innerHTML = '';
    if (isThief()) { renderThiefActions(host, v, me); return; }
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
      } else {
        addHint(host, '다른 참가자가 카드를 고르는 중...');
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

  // 온라인 대기 문구 (테이블 방은 방장의 시작을 기다린다)
  function waitingHint() {
    if (!state.inRoom) return '';
    if (state.poker.lobby.length < 2) return '다른 참가자를 기다리는 중...';
    return state.poker.isHost ? '\'게임 시작\'을 누르면 시작합니다' : '방장이 시작하기를 기다리는 중...';
  }

  // ── 좌석 포드 (포커 / 인디언포커 2~6인) ─────────────────
  // 내 좌석은 항상 아래(#ctMine), 나머지는 시계방향으로 위쪽 그리드에 놓는다.
  // 2인이면 위 1칸 + 아래 1칸 = 옛 맞포커와 같은 1:1 배치가 된다.
  function makeSeatPod(v, i, isMe, actor) {
    var pod = document.createElement('div');
    var stateLabel = pokerSeatState(v, i);
    var isDrawTarget = isThief() && v && !v.over && v.target === i;
    pod.className = 'ct-pod' + (isMe ? ' me' : '') +
      (actor === i ? ' turn' : '') + (pokerSeatGone(v, i) ? ' gone' : '') +
      (isThief() && v && v.over && v.result && v.result.loser === i ? ' thief-loser' : '') +
      (isDrawTarget ? ' draw-target' : '');
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
    if (!isThief() && v && v.dealer === i) {
      var dl = document.createElement('span');
      dl.className = 'ct-pod-tag';
      dl.textContent = '딜러';
      head.appendChild(dl);
    }
    // 도둑잡기: 지금 카드를 뽑히는 대상 좌석 — 본인이면 다르게 안내한다
    if (isDrawTarget) {
      var db = document.createElement('span');
      db.className = 'ct-pod-draw-badge';
      db.textContent = isMe ? '내 패에서 뽑는 중' : '여기서 뽑기';
      head.appendChild(db);
    }
    if (stateLabel) {
      var st = document.createElement('span');
      st.className = 'ct-pod-state';
      st.textContent = stateLabel;
      head.appendChild(st);
    }
    var chips = document.createElement('span');
    chips.className = 'ct-pod-chips';
    if (isThief()) chips.textContent = seatCardCount(v, i) + '장';
    else setChips(chips, v ? v.chips[i] : (state.online ? seatLobbyChips(i) : PE().START_CHIPS));
    head.appendChild(chips);
    pod.appendChild(head);

    var cards = document.createElement('div');
    cards.className = 'ct-pod-cards';
    pod.appendChild(cards);
    if (v) renderHandCards(cards, v, i, isMe, isMe && pokerCanPick(v, i));
    return pod;
  }

  function renderCardTable() {
    var v = state.poker.view;
    var me = pokerMyIndex();
    var n = pokerSeatCount();
    var actor = pokerActor(v);
    if (isThief()) thiefTrackHand(v, me);
    var opps = $('ctOpps');
    opps.innerHTML = '';
    for (var k = 1; k < n; k++) {
      opps.appendChild(makeSeatPod(v, (me + k) % n, false, actor));
    }
    var mine = $('ctMine');
    mine.innerHTML = '';
    mine.appendChild(makeSeatPod(v, me, true, actor));
    // 도둑잡기에는 팟이 없다 — 대신 판에 남은 카드 수를 가운데에 둔다
    $('ctPot').textContent = isThief()
      ? ('남은 카드 ' + (v ? v.inPlay : 0) + '장')
      : ('팟 ' + (v ? v.pot : 0));
    $('ctPhase').textContent = pokerPhaseText(v);
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
    state.poker.view = PE().viewFor(state.poker.local, actor);
    renderCardTable();
    updateSidebar();
  });

  // ── 로컬 진행 ─────────────────────────────────────────
  // 종목별 덱 (인디언포커는 1~10 두 벌 = 20장)
  function localDeck() {
    if (isIndian()) return K.shuffle(IP.makeDeck());
    if (isThief()) return K.shuffle(TH.makeDeck());
    return K.shuffle(K.makeDeck());
  }

  function localStartPokerMatch() {
    pokerFresh();
    hideModal();                 // 파산 모달에서 '새 게임' 으로 들어올 수 있다
    var deck = localDeck();
    var n = state.poker.count;      // 로컬 핫시트 인원 (2~6). 2면 헤즈업.
    var chips = [];
    for (var i = 0; i < n; i++) chips.push(PE().START_CHIPS);
    state.poker.local = PE().createHand({
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
    var n = PE().nextHand(st, localDeck());
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
      state.poker.view = PE().viewFor(st, null);   // 쇼다운이면 엔진이 이미 공개 상태
      renderCardTable();
      updateSidebar();
      renderMoveList();
      showPokerResultModal();
      return;
    }
    var actor = pokerActor(st);
    if (actor === null) return;
    if (state.poker.viewer === actor) {
      state.poker.view = PE().viewFor(st, actor);
      hideGate();
    } else {
      // 아직 확인 전 → 양쪽 히든을 모두 가린 화면 + 가리개
      state.poker.viewer = null;
      state.poker.view = PE().viewFor(st, null);
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
        toast('아직 시작되지 않았습니다');
        return;
      }
      wsSend({ type: 'pokerAction', action: action });
      return;
    }
    var st = state.poker.local;
    var actor = state.poker.viewer;
    if (!st || actor === null) return;
    var res = PE().apply(st, actor, action);
    if (res.error) { toast(res.error); return; }
    state.poker.local = res.state;
    appendPokerEvents(res.events);
    // 도둑잡기는 "무엇을 뽑았는지" 를 뽑은 본인이 봐야 한다.
    // 곧바로 가리면 자기가 가져온 카드를 영영 못 보므로 잠깐 보여 준 뒤 가린다.
    if (isThief()) { thiefRevealThenGate(actor); return; }
    state.poker.viewer = null;      // 결정할 때마다 다시 가린다
    pokerLocalSync();
  }

  // 로컬 핫시트 전용: 뽑은 결과(가져온 카드 / 짝지어 버린 두 장)를 본인에게
  // 잠깐 보여 주고, 그 다음에 가리개를 띄워 차례를 넘긴다.
  var thiefRevealTimer = null;
  function thiefClearReveal() {
    if (thiefRevealTimer) { clearTimeout(thiefRevealTimer); thiefRevealTimer = null; }
  }
  function thiefRevealThenGate(actor) {
    var st = state.poker.local;
    thiefClearReveal();
    state.poker.reveal = null;
    if (!st || st.over) { state.poker.viewer = null; pokerLocalSync(); return; }
    state.poker.reveal = actor;
    state.poker.viewer = actor;
    state.poker.view = TH.viewFor(st, actor);
    renderCardTable();
    updateSidebar();
    renderMoveList();
    thiefRevealTimer = setTimeout(function () {
      thiefRevealTimer = null;
      state.poker.reveal = null;
      state.poker.viewer = null;
      pokerLocalSync();
    }, 1000);
  }

  function pokerPick(index) {
    var v = state.poker.view;
    if (!v) return;
    var me = pokerMyIndex();
    if (!pokerCanPick(v, me)) return;
    pokerAct({ type: v.phase === 'discard' ? 'discard' : 'open', index: index });
  }

  // ── 도둑잡기 전용 입력 ─────────────────────────────────
  // 뽑기: 대상 좌석의 뒷면 카드를 눌렀을 때. 액션 경로는 포커와 같다.
  function thiefDraw(index) {
    var v = state.poker.view;
    if (!thiefCanDrawFrom(v, v ? v.target : -1)) return;
    pokerAct({ type: 'draw', index: index });
  }

  // 무작위 순열 (로컬 전용 — 온라인은 서버가 자기 난수로 만든다)
  function randomPerm(len) {
    var a = [], i, j, t;
    for (i = 0; i < len; i++) a.push(i);
    for (i = len - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      if (j > i) j = i;
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 미끼 섞기. 섞는 주체는 "지금 뽑히는 쪽"이라 차례 주인과 다르다.
  // 그래서 로컬에서는 pokerAct(차례 주인 기준)를 타지 않고 직접 적용하고,
  // 가리개도 다시 띄우지 않는다 (뽑는 사람의 차례는 그대로다).
  function thiefShuffle() {
    var v = state.poker.view;
    if (!v || v.over || typeof v.target !== 'number' || v.shuffled) return;
    if (state.online) {
      if (v.me !== v.target) { toast('지금은 섞을 수 없습니다'); return; }
      wsSend({ type: 'pokerAction', action: { type: 'shuffle' } });
      return;
    }
    var st = state.poker.local;
    if (!st || st.over) return;
    var target = st.target;
    var res = TH.apply(st, target, {
      type: 'shuffle', perm: randomPerm(st.hands[target].cards.length)
    });
    if (res.error) { toast(res.error); return; }
    state.poker.local = res.state;
    appendPokerEvents(res.events);
    state.poker.view = TH.viewFor(res.state, state.poker.viewer);
    renderCardTable();
    updateSidebar();
    renderMoveList();
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
    if (v && v.matchOver) {
      if (!state.online) { localStartPokerMatch(); return; }
      if (!state.poker.isHost) { toast('방장만 새 경기를 시작할 수 있습니다'); return; }
      wsSend({ type: 'newMatch' });
      hideModal();
      return;
    }
    // 모달은 "다음 판을 시작하기 전에" 닫는다. 새 판이 시작하자마자 끝나는
    // 경우(앤티만으로 올인 → 액션 가능한 좌석이 1명 이하 → 즉시 쇼다운)에는
    // localNextPokerHand() 안에서 결과 모달이 다시 열리는데, 여기서 뒤늦게
    // hideModal() 을 부르면 그 모달을 도로 닫아 화면이 멈춘 것처럼 보인다.
    hideModal();
    if (state.online) wsSend({ type: 'pokerAction', action: { type: 'nextHand' } });
    else localNextPokerHand();
  }

  // 인디언포커 결과 모달 ('플레이어 1 승리! (10 vs 7)')
  function showIndianResultModal() {
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
      $('resultModal').hidden = false;
      return;
    }
    var ws = pokerWinners(r);
    var names = ws.map(seatName).join(', ');
    var cards = r.revealed ? indianCardsText(v, ws) : '';
    title.textContent = ws.length > 1
      ? '팟 분배 — ' + names + (cards ? ' (' + cards + ')' : '')
      : (names ? names + ' 승리!' + (cards ? ' (' + cards + ')' : '') : '판 종료');
    var pen = penaltyText(v);
    msg.textContent = '팟 ' + r.amount + (r.revealed ? '' : ' (전원 다이 — 카드 비공개)') +
      (pen ? ' · ' + pen : '') + ' · 칩 ' + chipsTxt.join(' · ');
    setPlayAgainLabel('다음 판');
    $('resultModal').hidden = false;
  }

  // 포커(2~6인) 결과 모달. 2인이면 "상대 다이 / 1:1 쇼다운" 문구가 된다.
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

  // 도둑잡기 결과 모달 — 조커 카드 한 장 + 탈출 순서
  function showThiefResultModal() {
    var v = state.poker.view;
    var r = v.result;
    var stone = $('modalStone'), title = $('modalTitle'), msg = $('modalMessage');
    var extra = $('modalExtra');
    stone.hidden = true;
    if (extra) {
      extra.innerHTML = '';
      extra.hidden = false;
      var card = makeJokerCardEl();
      card.classList.add('modal-card-face');
      extra.appendChild(card);
    }
    if (r.loser === null) {
      title.textContent = '판 종료';
      msg.textContent = '남은 사람이 없습니다.';
    } else {
      var mine = state.online && r.loser === state.poker.seat;
      title.textContent = '도둑: ' + seatName(r.loser);
      var esc = thiefEscapeText(v);
      msg.textContent = (mine ? '조커가 끝까지 남았습니다. ' : '') +
        (esc ? '탈출 순서 — ' + esc : '아무도 탈출하지 못했습니다');
    }
    setPlayAgainLabel(state.online && !state.poker.isHost ? '방장 대기' : '새 경기');
    $('resultModal').hidden = false;
  }

  function showPokerResultModal() {
    var v = state.poker.view;
    if (!v || !v.over || !v.result) return;
    // 카드 게임 모달은 예전 그대로다 (닫기 버튼 없음 / 배경·Escape 닫기 없음)
    setResultModalKind('card');
    if (isThief()) showThiefResultModal();
    else if (isIndian()) showIndianResultModal();
    else showPokerTableModal();
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
    if (isAlk()) return;         // 알까기는 클릭이 아니라 드래그(조준)로 둔다
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
  // 결과 모달의 성격을 정한다.
  //   'board' — 오목/오델로/사목: [닫기][새 게임]. 배경/Escape 로도 닫힌다.
  //             닫아도 판(최종 국면 + 승리선 + 기보 + 상태)은 그대로 남고,
  //             무르기로 이어 둘 수 있다.
  //   'card'  — 포커/인디언포커: 기존 그대로 [다음 판]/[새 경기] 하나뿐.
  //             실수로 닫으면 다시 열 길이 없으므로 배경/Escape 닫기도 없다.
  function setResultModalKind(kind) {
    var modal = $('resultModal');
    var close = $('btnCloseResult');
    modal.setAttribute('data-kind', kind);
    if (close) close.hidden = kind !== 'board';
    // 추가 영역(도둑잡기의 조커 카드)은 매번 비우고 시작한다
    var extra = $('modalExtra');
    if (extra) { extra.innerHTML = ''; extra.hidden = true; }
  }
  function isBoardResultModal() {
    var modal = $('resultModal');
    return !modal.hidden && modal.getAttribute('data-kind') === 'board';
  }
  // 결과 모달만 치운다 (게임 상태는 손대지 않는다)
  function closeResultModal() {
    if (!isBoardResultModal()) return;
    hideModal();
  }

  function showResultModal(winner, counts) {
    var modal = $('resultModal');
    var stone = $('modalStone'), title = $('modalTitle'), msg = $('modalMessage');
    setResultModalKind('board');
    setPlayAgainLabel('새 게임');
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
    alkFresh();
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
    if (isAlk()) { localUndoAlk(); return; }
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

  // 무르기는 게임이 끝난 뒤에도 쓸 수 있다 (보드 게임 한정).
  // 마지막 수를 물리면 판이 되살아나 그대로 이어서 둘 수 있다.
  $('btnUndo').addEventListener('click', function () {
    if (isCardGame()) { toast('카드 게임에서는 무르기가 없습니다'); return; }
    if (state.online) {
      if (!state.started) { toast('상대를 기다리는 중입니다'); return; }
      if (!state.moves.length) { toast('무를 수가 없습니다'); return; }
      wsSend({ type: 'undoRequest' });
      toast('상대에게 무르기를 요청했습니다');
    } else {
      if (!state.moves.length) { toast('무를 수가 없습니다'); return; }
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

  // ── 결과 모달 닫기 (보드 게임 전용) ──────────────────────
  // 게임이 끝나도 초기화를 강요하지 않는다. 닫으면 최종 국면이 그대로
  // 남고, 무르기로 마지막 수를 물러 이어 둘 수 있다.
  $('btnCloseResult').addEventListener('click', function () {
    closeResultModal();
  });
  // 어두운 배경(모달 카드 바깥) 클릭
  $('resultModal').addEventListener('click', function (e) {
    if (e.target !== this) return;    // 카드 안쪽 클릭은 무시
    closeResultModal();
  });
  // Escape
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (!isBoardResultModal()) return;
    closeResultModal();
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
    document.body.classList.toggle('game-othello', state.game === 'othello');
    document.body.classList.toggle('game-connect4', state.game === 'connect4');
    document.body.classList.toggle('game-alkkagi', isAlk());
    document.body.classList.toggle('game-poker', state.game === 'poker');
    document.body.classList.toggle('game-indian', isIndian());
    document.body.classList.toggle('game-thief', isThief());
    document.body.classList.toggle('game-table', card);

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
    // 카드 테이블 내부: 좌석 포드(내 자리 + 나머지 좌석)
    $('ctOpps').hidden = !card;
    $('ctMine').hidden = !card;
    // 카드 게임은 타이머 대신 칩을 표시한다
    $('timerBlack').hidden = card;
    $('timerWhite').hidden = card;
    $('chipsBlack').hidden = !card;
    $('chipsWhite').hidden = !card;
    // 카드 게임은 좌석이 2~6개라 고정 2칸 대신 좌석 목록을 쓴다
    $('playerBlack').hidden = card;
    $('playerWhite').hidden = card;
    $('seatList').hidden = !card;
    if (!card) $('seatList').innerHTML = '';
    // 인원 선택은 로컬 카드 게임에서만 (온라인은 방에 앉은 사람 수가 인원이다)
    var seatRow = $('seatCountRow');
    if (seatRow) seatRow.hidden = !(card && !state.online);
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
    var subText = card ? '온라인 2~6인 테이블' : '온라인 2인용 대국';
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
    alkFresh();                 // 조준선/애니메이션도 남기지 않는다
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
        if (msg.game === 'alkkagi' || (!msg.game && isAlk())) {
          applyRemoteFlick(msg);
        } else if (msg.game === 'othello' || (!msg.game && state.game === 'othello')) {
          applyRemoteMoveOthello(msg);
        } else if (msg.game === 'connect4' || (!msg.game && state.game === 'connect4')) {
          applyRemoteMoveConnect4(msg);
        } else {
          applyRemoteMove(msg.row, msg.col, msg.color, msg.win);
        }
        break;

      case 'invalid':
        // 알까기: 서버가 거절하면 입력 잠금을 반드시 풀어 준다
        state.alk.pending = false;
        if (msg.reason === 'poker') toast(msg.message || '지금 할 수 없는 액션입니다');
        else if (msg.reason === 'forbidden' && msg.ftype) toast(R.FORBIDDEN_LABEL[msg.ftype] || '금수입니다');
        else if (msg.reason === 'illegal') toast('둘 수 없는 자리입니다');
        else if (msg.reason === 'column-full') toast('그 열은 가득 찼습니다');
        else if (msg.reason === 'finished') toast('끝난 대국입니다. 무르기나 새 게임을 이용하세요');
        else if (msg.reason === 'not-your-stone') toast('자기 돌만 칠 수 있습니다');
        else if (msg.reason === 'dead-stone') toast('이미 판 밖으로 나간 돌입니다');
        else if (msg.reason === 'too-weak') toast('조금 더 세게 당겨 주세요');
        else if (msg.reason === 'not-your-turn') toast('상대 차례입니다');
        break;

      // 알까기: 상대가 지금 조준 중인 방향 (표시 전용)
      case 'aim':
        if (!isAlk()) break;
        state.alk.oppAim = msg.clear ? null : {
          stoneId: msg.stoneId | 0,
          vx: Number(msg.dx) || 0,
          vy: Number(msg.dy) || 0
        };
        renderAlkAim();
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
        if (msg.game === 'alkkagi' || isAlk()) {
          remoteUndoAlk(msg);
        } else if (msg.game === 'othello' || state.game === 'othello') {
          remoteUndoOthello(msg);
        } else {
          remoteUndo(msg);
        }
        addChatSystem(msg.revived
          ? '무르기가 적용되어 대국을 이어서 진행합니다.'
          : '무르기가 적용되었습니다.');
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
        // 재대국(합의)은 2인 방 전용이다 — 카드 게임(테이블 방)의 '새 경기'는
        // 방장이 newMatch 로 시작하므로 이 경로로 오지 않는다.
        addChatSystem('새 게임을 시작합니다. 색이 교대되었습니다.');
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
    alkFresh();
    hideModal();
    // 카드 게임은 서버가 곧바로 pokerState 를 내려주므로 화면만 비워 둔다
    if (isCardGame()) pokerFresh();
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 서버가 수락한 무르기 반영 (오목/사목).
  // 끝난 판에서 온 무르기면 종료 상태까지 지워 판을 되살린다(부활).
  // 차례는 서버가 알려 준 값을 우선한다 — 양쪽 화면이 절대 갈리지 않게.
  function remoteUndo(msg) {
    var last = state.moves.length ? state.moves.pop() : null;
    if (last) state.board[last.row][last.col] = EMPTY;
    state.gameOver = false;
    state.winner = null;
    state.winStones = [];
    hideModal();
    if (msg && msg.turn) state.turn = colorNum(msg.turn);
    else if (last) state.turn = last.color;
    renderBoard();
    updateSidebar();
    renderMoveList();
  }

  // 테이블 방 입장 (방 만들기 / 참가 공통 — 포커 / 인디언포커)
  function enterTableRoom(msg, created) {
    state.game = isTableGame(msg.game) ? msg.game : 'poker';
    state.roomCode = msg.code;
    state.myColor = null;
    state.started = false;
    state.poker.seat = msg.seat | 0;
    state.poker.isHost = !!msg.isHost;
    state.poker.tableStarted = false;
    state.poker.lobby = [];
    localStorage.setItem('omok_game', state.game);
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
    if (e.isComposing || e.keyCode === 229) return;
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
    if (e.isComposing || e.keyCode === 229) return;
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
    $('themeLabel').textContent = theme === 'excel' ? '테마: 엑셀' : '테마: 기본';
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
    // 사라진 종목('맞포커')이 저장돼 있으면 포커로 옮겨 준다 (LEGACY_GAMES)
    var savedGame = migrateGame(localStorage.getItem('omok_game'));
    if (GAMES.indexOf(savedGame) !== -1) {
      state.game = savedGame;
      localStorage.setItem('omok_game', savedGame);   // 옛 이름은 정리해 둔다
    }
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
