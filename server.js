/*
 * server.js — 오목 게임 서버
 * - Express: ./public 정적 서빙 (포트 3000, PORT 환경변수 override)
 * - ws: 동일 HTTP 서버의 /ws 경로에서 온라인 방/채팅 처리
 * 규칙 로직은 public/rules.js 를 공유해서 서버 권위 검증에 사용.
 */
'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const WebSocket = require('ws');
const Rules = require('./public/rules.js');
const Othello = require('./public/othello.js');
const Connect4 = require('./public/connect4.js');
const Alkkagi = require('./public/alkkagi.js');
const Cards = require('./public/cards.js');
const Poker = require('./public/sevenpoker.js');
const Indian = require('./public/indianpoker.js');
const Thief = require('./public/thief.js');

// 지원 종목 (게임 생성/변경에서 공용으로 쓰는 화이트리스트)
const GAMES = ['omok', 'othello', 'connect4', 'alkkagi', 'poker', 'indian', 'thief'];
// 테이블 방(2~6인 좌석제) 종목 = 카드 엔진을 쓰는 종목.
// 포커는 2명이 앉으면 그대로 헤즈업(1:1)이 된다 — 예전의 별도 종목이었던
// '맞포커'는 포커 2인으로 흡수됐다.
const TABLE_GAMES = ['poker', 'indian', 'thief'];
// '게임 바꾸기'로 전환할 수 있는 종목
// (2인 방 전용 — 테이블 방 종목은 좌석/칩 구조가 달라 제외한다)
const CHANGEABLE_GAMES = GAMES.filter((g) => TABLE_GAMES.indexOf(g) === -1);
function normGame(g) {
  return GAMES.indexOf(g) !== -1 ? g : null;
}
// 테이블 방(2~6인 좌석제)
const TABLE_CAPACITY = 6;
function isTableGame(g) {
  return TABLE_GAMES.indexOf(g) !== -1;
}
function isTableRoom(room) {
  return !!room && isTableGame(room.game);
}
// 종목별 카드 엔진. 세 엔진 모두 공개 API 모양(createHand/apply/leave/viewFor/
// nextHand/isHandOver)이 같아서 테이블 방 코드 경로 전체를 엔진만 바꿔 끼워 쓴다.
function cardEngine(game) {
  if (game === 'indian') return Indian;
  if (game === 'thief') return Thief;
  return Poker;
}
function roomEngine(room) {
  return cardEngine(room && room.game);
}

// 방의 게임 종류에 맞는 규칙 모듈 반환
// 방의 게임 종류에 맞는 규칙 모듈 반환.
// 알까기는 격자 보드가 아니라 물리 상태(돌 좌표 목록)를 room.board 에 담는다.
// createBoard()/BLACK 이름을 맞춰 두었기 때문에 방 생성/리셋 경로는 그대로 쓴다.
function gameModule(game) {
  if (game === 'othello') return Othello;
  if (game === 'connect4') return Connect4;
  if (game === 'alkkagi') return Alkkagi;
  return Rules;
}
function colorToStr(c) {
  return c === Rules.BLACK ? 'black' : 'white';
}

// ── 카드 게임(포커 / 인디언포커) ──────────────────────────
// 좌석 번호는 테이블 방의 고정 좌석(p.seat)이다. 2인 방(오목/오델로/사목)에는
// 카드 게임이 없으므로 색으로 좌석을 유추할 일이 없다.
function seatOf(room, ws) {
  const me = playerOf(room, ws);
  if (!me || typeof me.seat !== 'number') return null;
  return me.seat;
}
// 암호학적 난수로 셔플 (엔진은 결정적이고, 무작위성은 서버가 책임진다)
function secureRandom() {
  return crypto.randomInt(0, 0x40000000) / 0x40000000;
}
// 종목별 덱. 인디언포커는 1~10 두 벌(20장), 도둑잡기는 52장 + 조커(53장),
// 나머지는 표준 52장.
function shuffledDeck(game) {
  let base;
  if (game === 'indian') base = Indian.makeDeck();
  else if (game === 'thief') base = Thief.makeDeck();
  else base = Cards.makeDeck();
  return Cards.shuffle(base, secureRandom);
}
// 도둑잡기 '패 섞기': 순열은 서버가 자기 난수로 만든다 (엔진은 결정적이라
// 순열을 직접 받는다). Fisher-Yates 로 0..len-1 의 순열 하나를 돌려준다.
function randomPermutation(len) {
  const a = [];
  for (let i = 0; i < len; i++) a.push(i);
  for (let i = len - 1; i > 0; i--) {
    let j = Math.floor(secureRandom() * (i + 1));
    if (j > i) j = i;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
// 상태가 바뀔 때마다 각 플레이어에게 "그 사람 시점" 만 보낸다.
// events 는 전원에게 동일하게 가는 공개 로그(히든 카드 정보가 없다).
function sendPokerState(room, events) {
  if (!room.poker) return;
  const E = roomEngine(room);
  room.players.forEach((p) => {
    send(p.ws, {
      type: 'pokerState',
      seat: p.seat,
      view: E.viewFor(room.poker, p.seat),
      events: events || []
    });
  });
}

// ── 포커 테이블 방(2~6인) ────────────────────────────────
// 좌석은 0..N-1 로 연속이며, 매치가 시작되기 전(로비)에는 입퇴장마다
// 0 부터 다시 채워 넣는다(연속성 보장). 매치 중에는 절대 바뀌지 않는다
// (엔진 상태가 좌석 번호로 인덱싱되어 있다).
function seatLabel(seat) {
  return '플레이어 ' + (seat + 1);
}
function reseatTable(room) {
  room.players.forEach((p, i) => { p.seat = i; });
  room.hostSeat = room.players.length ? room.players[0].seat : 0;
}
function freeSeat(room) {
  for (let i = 0; i < TABLE_CAPACITY; i++) {
    if (!room.players.some((p) => p.seat === i)) return i;
  }
  return -1;
}
function tableChips(room, seat) {
  if (room.poker && typeof room.poker.chips[seat] === 'number') return room.poker.chips[seat];
  return roomEngine(room).START_CHIPS;
}
// 도둑잡기에는 칩이 없다. 대신 좌석 목록에 "남은 손패 수"를 보낸다.
// (다른 종목에서는 null 이라 화면이 예전 그대로 칩만 그린다)
function tableCards(room, seat) {
  if (room.game !== 'thief' || !room.poker || !room.poker.hands[seat]) return null;
  return room.poker.hands[seat].cards.length;
}
// 로비 상태 방송. 입장/퇴장/시작/매치 종료 등 모든 변화에서 호출한다.
function sendTableLobby(room, notice) {
  const started = !!room.started;
  const players = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      seat: p.seat,
      name: seatLabel(p.seat),
      isHost: p.seat === room.hostSeat,
      chips: tableChips(room, p.seat),
      cards: tableCards(room, p.seat)
    }));
  const matchOver = !!(room.poker && room.poker.matchOver);
  broadcast(room, {
    type: 'tableLobby',
    code: room.code,
    players: players,
    hostSeat: room.hostSeat,
    capacity: TABLE_CAPACITY,
    started: started,
    canStart: players.length >= 2 && (!started || matchOver),
    notice: notice || null
  });
}
function tableNotice(room, text) {
  broadcast(room, { type: 'tableNotice', text: text });
}
// 새 매치(칩 1000 리셋). 좌석은 0..N-1 로 정리한 뒤 첫 판을 돌린다.
function startTableMatch(room) {
  reseatTable(room);
  const E = roomEngine(room);
  const n = room.players.length;
  const chips = [];
  for (let i = 0; i < n; i++) chips.push(E.START_CHIPS);
  room.started = true;
  room.poker = E.createHand({
    players: n,
    deckOrder: shuffledDeck(room.game),
    chips: chips,
    dealer: 0
  });
  room.players.forEach((p) => {
    send(p.ws, { type: 'tableStart', seat: p.seat, players: n, isHost: p.seat === room.hostSeat });
  });
  sendTableLobby(room);
  sendPokerState(room, room.poker.log.slice());
}

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ── 방 관리 ────────────────────────────────────────────────
// rooms: code -> { code, rule, board, turn, moves, players:[{ws,color}] }
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자(I,O,0,1) 제외
function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(room, obj) {
  room.players.forEach((p) => send(p.ws, obj));
}

function opponentOf(room, ws) {
  return room.players.find((p) => p.ws !== ws);
}
function playerOf(room, ws) {
  return room.players.find((p) => p.ws === ws);
}

// 2인 방(오목/오델로/사목) 전용 — 테이블 방은 startTableMatch 로 리셋한다.
function resetRoomBoard(room) {
  var M = gameModule(room.game);
  room.board = M.createBoard();
  room.turn = M.BLACK;
  room.moves = [];
  room.poker = null;
  room.over = false;      // 종료 상태도 함께 지운다 (새 판은 항상 진행 중)
  room.winner = null;
}

// 판이 끝났다 / 되살아났다 (2인 보드 방 전용).
// 끝난 방은 착수를 받지 않지만 **없어지지는 않는다** — 무르기가 수락되면
// 되살아나 그대로 이어서 둘 수 있다.
function markRoomOver(room, winner) {
  room.over = true;
  room.winner = typeof winner === 'number' ? winner : null;
}
function reviveRoom(room) {
  const was = !!room.over;
  room.over = false;
  room.winner = null;
  return was;
}

wss.on('connection', (ws) => {
  ws.roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'create': {
        const game = normGame(msg.game) || 'omok';
        const rule = msg.rule === 'free' ? 'free' : 'renju';
        // ── 포커: 좌석제 테이블 방(최대 6인). 생성자 = 좌석 0 = 방장 ──
        if (isTableGame(game)) {
          const tcode = genCode();
          const troom = {
            code: tcode,
            game: game,
            rule: rule,
            board: null,
            turn: null,
            moves: [],
            poker: null,
            pendingGame: null,
            started: false,
            hostSeat: 0,
            players: [{ ws: ws, color: null, seat: 0 }]
          };
          rooms.set(tcode, troom);
          ws.roomCode = tcode;
          send(ws, {
            type: 'created',
            code: tcode,
            game: game,
            seat: 0,
            isHost: true,
            capacity: TABLE_CAPACITY
          });
          sendTableLobby(troom);
          break;
        }
        const M = gameModule(game);
        // 생성자 색 선호: 'black' | 'white' | 'random' (기본 black)
        let pref = msg.color;
        if (pref !== 'white' && pref !== 'black' && pref !== 'random') pref = 'black';
        let creatorColor;
        if (pref === 'random') {
          creatorColor = Math.random() < 0.5 ? Rules.BLACK : Rules.WHITE;
        } else {
          creatorColor = pref === 'white' ? Rules.WHITE : Rules.BLACK;
        }
        const code = genCode();
        const room = {
          code: code,
          game: game,
          rule: rule,
          board: M.createBoard(),
          turn: M.BLACK,
          moves: [],
          poker: null,
          over: false,         // 판이 끝났는가 (승/무). 무르기로 되살릴 수 있다.
          winner: null,        // 1/2/0(무승부)/null
          pendingGame: null,   // 합의 대기 중인 "바꿀 종목"
          players: [{ ws: ws, color: creatorColor }]
        };
        rooms.set(code, room);
        ws.roomCode = code;
        send(ws, {
          type: 'created',
          code: code,
          color: colorToStr(creatorColor),
          rule: rule,
          game: game
        });
        break;
      }

      case 'join': {
        const code = (msg.code || '').toString().toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: '존재하지 않는 방입니다' });
          return;
        }
        // ── 포커 테이블 방: 빈 좌석에 앉는다. 시작 후에는 입장 불가 ──
        if (isTableRoom(room)) {
          if (room.started) {
            send(ws, { type: 'error', message: '이미 시작된 방입니다' });
            return;
          }
          if (room.players.length >= TABLE_CAPACITY) {
            send(ws, { type: 'error', message: '방이 가득 찼습니다' });
            return;
          }
          const seat = freeSeat(room);
          room.players.push({ ws: ws, color: null, seat: seat });
          reseatTable(room);
          ws.roomCode = code;
          const mine = playerOf(room, ws);
          send(ws, {
            type: 'joined',
            code: code,
            game: room.game,
            seat: mine.seat,
            isHost: mine.seat === room.hostSeat,
            capacity: TABLE_CAPACITY
          });
          sendTableLobby(room, seatLabel(mine.seat) + ' 님이 입장했습니다');
          return;
        }
        if (room.players.length >= 2) {
          send(ws, { type: 'error', message: '방이 가득 찼습니다' });
          return;
        }
        // 참가자는 생성자의 반대 색
        const creator = room.players[0];
        const joinColor = creator.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
        room.players.push({ ws: ws, color: joinColor });
        ws.roomCode = code;
        send(ws, {
          type: 'joined',
          code: code,
          color: colorToStr(joinColor),
          rule: room.rule,
          game: room.game
        });
        // 양쪽에 시작 알림
        broadcast(room, {
          type: 'start',
          code: code,
          rule: room.rule,
          game: room.game,
          turn: 'black'
        });
        break;
      }

      // ── 포커 테이블: 매치 시작 / 새 경기 (방장 전용) ────
      case 'startMatch':
      case 'newMatch': {
        const room = rooms.get(ws.roomCode);
        if (!isTableRoom(room)) return;
        const seat = seatOf(room, ws);
        if (seat === null) return;
        if (seat !== room.hostSeat) {
          send(ws, { type: 'error', message: '방장만 시작할 수 있습니다' });
          return;
        }
        if (room.players.length < 2) {
          send(ws, { type: 'error', message: '2명 이상이어야 시작할 수 있습니다' });
          return;
        }
        if (room.started && room.poker && !room.poker.matchOver) {
          send(ws, { type: 'error', message: '이미 시작된 방입니다' });
          return;
        }
        startTableMatch(room);
        break;
      }

      // ── 카드 게임 액션 (포커 / 인디언포커 공용) ──
      // 모든 판정은 서버가 한다. 클라이언트는 자기 시점 뷰만 받는다.
      case 'pokerAction': {
        const room = rooms.get(ws.roomCode);
        if (!isTableRoom(room)) return;
        const E = roomEngine(room);
        const seat = seatOf(room, ws);
        if (seat === null) return;
        let action = msg.action || {};
        if (!room.poker) return;

        // 도둑잡기 '패 섞기': 클라이언트는 버튼만 누르고, 실제 섞는 순서는
        // 서버가 자기 난수로 만든다. 클라이언트가 순열을 보내오더라도 쓰지 않는다
        // (자기 패를 원하는 자리에 배치할 수 있으면 미끼 섞기가 무의미해진다).
        if (room.game === 'thief' && action.type === 'shuffle') {
          const hand = room.poker.hands[seat];
          action = { type: 'shuffle', perm: randomPermutation(hand ? hand.cards.length : 0) };
        }

        // '다음 판' 은 양쪽 누구나 보낼 수 있고, 이미 다음 판이 시작됐으면
        // 아무 일도 하지 않는다(멱등).
        if (action.type === 'nextHand') {
          if (!E.isHandOver(room.poker)) return;
          if (room.poker.matchOver) {
            send(ws, { type: 'invalid', reason: 'poker', message: '매치가 종료되었습니다' });
            return;
          }
          const nh = E.nextHand(room.poker, shuffledDeck(room.game));
          if (nh.error) return;
          room.poker = nh;
          sendPokerState(room, room.poker.log.slice());
          if (isTableRoom(room)) sendTableLobby(room);
          return;
        }

        const res = E.apply(room.poker, seat, action);
        if (res.error) {
          send(ws, { type: 'invalid', reason: 'poker', message: res.error });
          return;
        }
        room.poker = res.state;
        sendPokerState(room, res.events);
        // 테이블 방은 로비 목록에도 칩이 표시되므로 함께 갱신한다
        if (isTableRoom(room)) sendTableLobby(room);
        break;
      }

      case 'move': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;  // 카드 게임에는 착수가 없다
        const me = playerOf(room, ws);
        if (!me) return;
        // 끝난 판에는 둘 수 없다. 화면은 그대로 남고, 무르기(합의)나
        // 재대국으로만 다시 진행할 수 있다.
        if (room.over) {
          send(ws, { type: 'invalid', reason: 'finished' });
          return;
        }
        if (me.color !== room.turn) return; // 내 차례 아님
        const r = msg.row | 0;
        const c = msg.col | 0;

        // ── 알까기(Alkkagi) ───────────────────────────────
        // 메시지에는 "어느 돌을 어느 방향으로 얼마나 세게" 만 담긴다.
        // 서버가 파워를 자르고 결정적 시뮬레이션을 돌려 최종 상태를 만든다.
        // 두 클라이언트는 같은 입력을 로컬에서 다시 굴려 애니메이션만 그리고,
        // 끝나면 여기서 온 final 로 스냅한다(어떤 이유로도 화면이 갈리지 않게).
        if (room.game === 'alkkagi') {
          if (msg.kind !== 'flick') return;
          const sid = msg.stoneId | 0;
          const rawVx = Number(msg.vx), rawVy = Number(msg.vy);
          const chk = Alkkagi.validateFlick(room.board, me.color, sid, rawVx, rawVy);
          if (!chk.ok) {
            send(ws, { type: 'invalid', reason: chk.reason, stoneId: sid });
            return;
          }
          const v = Alkkagi.clampVector(rawVx, rawVy);   // 클라이언트 값은 믿지 않는다
          const before = Alkkagi.serialize(room.board);  // 무르기용 스냅샷
          const sim = Alkkagi.simulate(room.board, { stoneId: sid, vx: v.vx, vy: v.vy });
          room.board = sim.finalState;
          room.turn = sim.finalState.turn;
          room.moves.push({
            kind: 'flick', color: me.color, stoneId: sid,
            vx: v.vx, vy: v.vy, snapshot: before, events: sim.events
          });
          const awinner = sim.finalState.winner;
          if (awinner !== null) markRoomOver(room, awinner);
          broadcast(room, {
            type: 'move',
            game: 'alkkagi',
            kind: 'flick',
            stoneId: sid,
            vx: v.vx, vy: v.vy,
            color: colorToStr(me.color),
            final: Alkkagi.serialize(sim.finalState),
            events: sim.events,
            ticks: sim.ticks,
            winner: awinner,
            turn: colorToStr(sim.finalState.turn)
          });
          break;
        }

        // ── 사목(Connect Four) ────────────────────────────
        // 메시지는 열(col)만 담는다. 착지 행은 서버가 계산해서
        // 브로드캐스트에 담아 두 클라이언트가 동일하게 그리도록 한다.
        if (room.game === 'connect4') {
          const res = Connect4.applyMove(room.board, c, me.color);
          if (!res) {
            send(ws, { type: 'invalid', col: c, reason: 'column-full' });
            return;
          }
          room.board = res.board;
          room.moves.push({ row: res.row, col: c, color: me.color });
          const winCells = Connect4.checkWinAt(room.board, res.row, c, me.color);
          const draw = !winCells && Connect4.isFull(room.board);
          const opp = me.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
          if (!winCells && !draw) room.turn = opp;
          else markRoomOver(room, winCells ? me.color : 0);
          broadcast(room, {
            type: 'move',
            game: 'connect4',
            row: res.row, col: c,
            color: colorToStr(me.color),
            win: !!winCells,
            winCells: winCells || [],
            draw: draw,
            nextTurn: (winCells || draw) ? null : colorToStr(opp)
          });
          break;
        }

        if (room.game === 'othello') {
          const res = Othello.applyMove(room.board, r, c, me.color);
          if (!res) {
            const reason = room.board[r] && room.board[r][c] !== Othello.EMPTY ? 'occupied' : 'illegal';
            send(ws, { type: 'invalid', row: r, col: c, reason: reason });
            return;
          }
          room.board = res.board;
          room.moves.push({ kind: 'move', row: r, col: c, color: me.color, flipped: res.flipped });
          const colorStr = colorToStr(me.color);
          const opp = me.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
          const oppHas = Othello.hasAnyMove(room.board, opp);
          const meHas = Othello.hasAnyMove(room.board, me.color);
          let passed = false, over = false, winner = null;
          let nextColor;
          if (!oppHas && !meHas) {
            over = true;
            winner = Othello.winner(room.board);
            nextColor = null;
            markRoomOver(room, winner);
          } else if (!oppHas) {
            passed = true;
            room.turn = me.color;             // 상대가 패스, 턴 유지
            room.moves.push({ kind: 'pass', color: opp });
            nextColor = me.color;
          } else {
            room.turn = opp;
            nextColor = opp;
          }
          broadcast(room, {
            type: 'move',
            game: 'othello',
            row: r, col: c,
            color: colorStr,
            flipped: res.flipped,
            passed: passed,
            passColor: colorToStr(opp),
            over: over,
            winner: winner,
            counts: Othello.counts(room.board),
            nextTurn: nextColor === null ? null : colorToStr(nextColor)
          });
          break;
        }

        const v = Rules.validateMove(room.board, r, c, me.color, room.rule);
        if (!v.ok) {
          send(ws, { type: 'invalid', row: r, col: c, reason: v.reason, ftype: v.type || null });
          return;
        }
        room.board[r][c] = me.color;
        room.moves.push({ row: r, col: c, color: me.color });
        const colorStr = colorToStr(me.color);
        const win = Rules.checkWinAt(room.board, r, c, me.color, room.rule);
        room.turn = me.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
        // 오목의 무승부 = 판이 가득 참 (클라이언트와 같은 판정)
        const boardFull = !win && room.moves.length >= room.board.length * room.board[0].length;
        if (win || boardFull) markRoomOver(room, win ? me.color : 0);
        broadcast(room, { type: 'move', row: r, col: c, color: colorStr, win: win });
        break;
      }

      case 'chat': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const me = playerOf(room, ws);
        if (!me) return;
        let text = (msg.text || '').toString().slice(0, 500);
        // 테이블 방은 색이 없으므로 좌석 이름으로 말한다 ('플레이어 N').
        if (isTableRoom(room)) {
          broadcast(room, {
            type: 'chat', text: text, from: seatLabel(me.seat), seat: me.seat
          });
          break;
        }
        const from = me.color === Rules.BLACK ? 'black' : 'white';
        broadcast(room, { type: 'chat', text: text, from: from });
        break;
      }

      case 'undoRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;  // 카드 게임은 무르기 없음
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'undoRequest' });
        break;
      }

      case 'undoResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;
        if (msg.accept) {
          // 끝난 판이었다면 무르기가 방을 되살린다(부활).
          // 승부가 났다는 사실은 마지막 수에 붙어 있으므로, 그 수를
          // 물리는 것만으로 판은 다시 진행 중이 된다.
          const revived = reviveRoom(room);
          // 알까기: 착수 한 번이 물리 시뮬레이션 전체라 "역재생"이 불가능하다.
          // 대신 치기 직전 스냅샷을 그대로 되돌리고 전체 상태를 방송한다.
          if (room.game === 'alkkagi') {
            if (room.moves.length > 0) {
              const last = room.moves.pop();
              room.board = Alkkagi.deserialize(last.snapshot);
              room.turn = last.color;   // 무른 사람 차례로 복귀
            }
            broadcast(room, {
              type: 'undo',
              game: 'alkkagi',
              state: Alkkagi.serialize(room.board),
              turn: colorToStr(room.turn),
              over: false,
              revived: revived
            });
            break;
          }
          if (room.game === 'othello') {
            // 후행 패스 엔트리 제거 후 마지막 실착수 되돌리기
            while (room.moves.length > 0 && room.moves[room.moves.length - 1].kind === 'pass') {
              room.moves.pop();
            }
            if (room.moves.length > 0) {
              const last = room.moves.pop();
              const opp = last.color === Othello.BLACK ? Othello.WHITE : Othello.BLACK;
              room.board[last.row][last.col] = Othello.EMPTY;
              last.flipped.forEach(function (f) { room.board[f[0]][f[1]] = opp; });
              room.turn = last.color; // 무른 사람 차례로 복귀
            }
            broadcast(room, {
              type: 'undo',
              game: 'othello',
              board: room.board,
              turn: colorToStr(room.turn),
              counts: Othello.counts(room.board),
              over: false,
              revived: revived
            });
          } else {
            if (room.moves.length > 0) {
              const last = room.moves.pop();
              room.board[last.row][last.col] = Rules.EMPTY;
              room.turn = last.color; // 무른 사람 차례로 복귀
            }
            broadcast(room, {
              type: 'undo',
              game: room.game,
              turn: colorToStr(room.turn),
              over: false,
              revived: revived
            });
          }
        } else {
          const opp = opponentOf(room, ws);
          if (opp) send(opp.ws, { type: 'undoRejected' });
        }
        break;
      }

      // ── 알까기 조준 중계 (표시 전용) ─────────────────────
      // 상대가 지금 어느 돌을 어느 방향으로 당기고 있는지 실시간으로 보여 준다.
      // 게임 상태를 바꾸지 않으므로 검증할 것이 없다(방 소속만 확인).
      // 다만 드래그 중 초당 수십 개가 올 수 있어 가볍게 솎아낸다.
      case 'aim': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;
        if (room.game !== 'alkkagi') return;
        const me = playerOf(room, ws);
        if (!me) return;
        const opp = opponentOf(room, ws);
        if (!opp) return;
        if (msg.clear) {
          ws.aimAt = 0;   // 지우기는 항상 통과 (조준선이 남아 있으면 안 된다)
          send(opp.ws, { type: 'aim', clear: true, color: colorToStr(me.color) });
          return;
        }
        const now = Date.now();
        if (ws.aimAt && now - ws.aimAt < 30) return;   // ~30fps 상한
        ws.aimAt = now;
        send(opp.ws, {
          type: 'aim',
          stoneId: msg.stoneId | 0,
          dx: Number(msg.dx) || 0,
          dy: Number(msg.dy) || 0,
          color: colorToStr(me.color)
        });
        break;
      }

      case 'swapRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        // 카드 게임에는 돌 색이 없다(좌석은 고정) → 요청 자체를 무시
        if (isTableRoom(room)) return;
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'swapRequest' });
        break;
      }

      case 'swapResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;
        if (msg.accept) {
          if (room.moves.length > 0) return; // 착수 이후 스왑 거부(무시)
          // 두 플레이어 색 교대
          room.players.forEach((p) => {
            p.color = p.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
          });
          room.turn = Rules.BLACK;
          // restart와 동일하게 각자에게 자신의 새 색 전달
          room.players.forEach((p) => {
            send(p.ws, {
              type: 'swapped',
              color: p.color === Rules.BLACK ? 'black' : 'white',
              turn: 'black'
            });
          });
        } else {
          const opp = opponentOf(room, ws);
          if (opp) send(opp.ws, { type: 'swapRejected' });
        }
        break;
      }

      // ── 게임 바꾸기(합의) ─────────────────────────────
      // 돌 바꾸기(swap)와 동일한 요청/응답 구조. 색은 그대로 두고 종목만 바꾼다.
      case 'gameChangeRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        // 포커 테이블 방은 종목을 바꿀 수 없다 (좌석/칩이 종목에 묶여 있다)
        if (isTableRoom(room)) return;
        const game = normGame(msg.game);
        if (!game) return;              // 알 수 없는 종목
        if (CHANGEABLE_GAMES.indexOf(game) === -1) return;   // 포커로는 못 바꾼다
        if (game === room.game) return; // 현재와 같은 종목
        const opp = opponentOf(room, ws);
        if (!opp) return;
        // 종목이 3개 이상이므로 "토글"이 불가능하다. 수락 시 어떤 종목으로
        // 바꿀지 방에 기억해 둔다(요청은 항상 최신 것 하나만 유효).
        room.pendingGame = game;
        send(opp.ws, { type: 'gameChangeRequest', game: game });
        break;
      }

      case 'gameChangeResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;
        const target = room.pendingGame;
        room.pendingGame = null;        // 응답 한 번으로 요청은 소멸
        if (msg.accept) {
          if (!target || target === room.game) return; // 대기 중인 요청 없음
          if (room.moves.length > 0) return;           // 착수 이후 변경 거부(무시)
          // 색은 유지(흑 선착), 보드/턴/기보만 새 종목 기준으로 리셋.
          room.game = target;
          resetRoomBoard(room);
          broadcast(room, { type: 'gameChanged', game: room.game, turn: 'black' });
        } else {
          const opp = opponentOf(room, ws);
          if (opp) send(opp.ws, { type: 'gameChangeRejected' });
        }
        break;
      }

      case 'restartRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        // 테이블 방의 '새 경기'는 방장 전용(startMatch)이라 합의 절차가 없다
        if (isTableRoom(room)) return;
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'restartRequest' });
        break;
      }

      case 'restartResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isTableRoom(room)) return;
        if (msg.accept) {
          resetRoomBoard(room);
          // 색 교대 후 각자에게 자신의 새 색 전달
          room.players.forEach((p) => {
            p.color = p.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
          });
          room.players.forEach((p) => {
            send(p.ws, {
              type: 'restart',
              color: p.color === Rules.BLACK ? 'black' : 'white',
              turn: 'black'
            });
          });
        } else {
          const opp = opponentOf(room, ws);
          if (opp) send(opp.ws, { type: 'restartRejected' });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    // ── 포커 테이블 방 ────────────────────────────────────
    // 방은 남은 사람들을 위해 유지된다. 진행 중이면 나간 좌석을 자동 다이
    // 처리하고(그 좌석의 칩은 게임에서 빠진다) 남은 사람들끼리 계속한다.
    if (isTableRoom(room)) {
      const me = playerOf(room, ws);
      if (!me) return;
      const seat = me.seat;
      room.players = room.players.filter((p) => p.ws !== ws);
      if (room.players.length === 0) { rooms.delete(room.code); return; }

      if (!room.started) {
        // 로비 단계: 좌석을 다시 채우고(연속 좌석 유지) 방장도 재지정
        reseatTable(room);
        sendTableLobby(room, seatLabel(seat) + ' 님이 나갔습니다');
        return;
      }

      // 매치 진행 중
      if (room.poker) {
        const res = roomEngine(room).leave(room.poker, seat);
        if (!res.error) {
          room.poker = res.state;
          sendPokerState(room, res.events);
        }
      }
      if (seat === room.hostSeat) {
        room.hostSeat = room.players.reduce((m, p) => Math.min(m, p.seat), TABLE_CAPACITY);
        tableNotice(room, seatLabel(room.hostSeat) + ' 님이 방장이 되었습니다');
      }
      tableNotice(room, seatLabel(seat) + ' 님이 퇴장했습니다');
      if (room.players.length === 1) {
        // 혼자 남으면 매치를 끝내고 로비 상태로 되돌린다
        room.started = false;
        room.poker = null;
        reseatTable(room);
        sendTableLobby(room, '혼자 남아 로비로 돌아왔습니다');
      } else {
        sendTableLobby(room);
      }
      return;
    }

    // 2인 방(오목/오델로/사목): 한 명이 나가면 방을 없앤다.
    const opp = opponentOf(room, ws);
    if (opp) send(opp.ws, { type: 'opponentLeft' });
    rooms.delete(room.code);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('오목 서버 실행 중: http://localhost:' + PORT);
});

module.exports = { app, server };
