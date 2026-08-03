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
const Cards = require('./public/cards.js');
const Poker = require('./public/sevenpoker.js');

// 지원 종목 (게임 생성/변경에서 공용으로 쓰는 화이트리스트)
const GAMES = ['omok', 'othello', 'connect4', 'matpoker'];
function normGame(g) {
  return GAMES.indexOf(g) !== -1 ? g : null;
}
// 카드 게임(보드가 없는 종목)
function isCardGame(g) {
  return g === 'matpoker';
}

// 방의 게임 종류에 맞는 규칙 모듈 반환
function gameModule(game) {
  if (game === 'othello') return Othello;
  if (game === 'connect4') return Connect4;
  return Rules;
}
function colorToStr(c) {
  return c === Rules.BLACK ? 'black' : 'white';
}

// ── 맞포커(2인 세븐포커) ──────────────────────────────────
// 좌석: 흑=0(P1, 방장·첫 딜러), 백=1(P2). 카드 게임에서는 색을 좌석
// 식별자로만 쓰고 화면에는 절대 흑돌/백돌로 표시하지 않는다(클라 담당).
function seatOfColor(color) {
  return color === Rules.BLACK ? 0 : 1;
}
function seatOf(room, ws) {
  const me = playerOf(room, ws);
  return me ? seatOfColor(me.color) : null;
}
// 암호학적 난수로 셔플 (엔진은 결정적이고, 무작위성은 서버가 책임진다)
function secureRandom() {
  return crypto.randomInt(0, 0x40000000) / 0x40000000;
}
function shuffledDeck() {
  return Cards.shuffle(Cards.makeDeck(), secureRandom);
}
// 새 매치(칩 1000 리셋). 방 생성/참가/게임 변경/재대국에서 호출.
function startPokerMatch(room) {
  room.poker = Poker.createHand({
    deckOrder: shuffledDeck(),
    chips: [Poker.START_CHIPS, Poker.START_CHIPS],
    dealer: 0
  });
}
// 상태가 바뀔 때마다 각 플레이어에게 "그 사람 시점" 만 보낸다.
// events 는 양쪽에 동일하게 가는 공개 로그(히든 카드 정보가 없다).
function sendPokerState(room, events) {
  if (!room.poker) return;
  room.players.forEach((p) => {
    const seat = seatOfColor(p.color);
    send(p.ws, {
      type: 'pokerState',
      seat: seat,
      view: Poker.viewFor(room.poker, seat),
      events: events || []
    });
  });
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

function resetRoomBoard(room) {
  var M = gameModule(room.game);
  room.board = M.createBoard();
  room.turn = M.BLACK;
  room.moves = [];
  // 카드 게임은 보드 대신 엔진 상태를 새 매치로 리셋한다(칩 1000).
  if (isCardGame(room.game)) startPokerMatch(room);
  else room.poker = null;
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
        // 카드 게임은 "방장 = P1 = 첫 딜러" 가 고정이라 색 선택을 무시한다.
        if (isCardGame(game)) creatorColor = Rules.BLACK;
        const code = genCode();
        const room = {
          code: code,
          game: game,
          rule: rule,
          board: M.createBoard(),
          turn: M.BLACK,
          moves: [],
          poker: null,
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
        // 카드 게임은 두 번째 플레이어가 들어온 시점에 첫 판을 돌린다.
        if (isCardGame(room.game)) {
          startPokerMatch(room);
          sendPokerState(room, room.poker.log.slice());
        }
        break;
      }

      // ── 맞포커 액션 ────────────────────────────────────
      // 모든 판정은 서버가 한다. 클라이언트는 자기 시점 뷰만 받는다.
      case 'pokerAction': {
        const room = rooms.get(ws.roomCode);
        if (!room || !isCardGame(room.game)) return;
        const seat = seatOf(room, ws);
        if (seat === null) return;
        const action = msg.action || {};
        if (!room.poker) return;

        // '다음 판' 은 양쪽 누구나 보낼 수 있고, 이미 다음 판이 시작됐으면
        // 아무 일도 하지 않는다(멱등).
        if (action.type === 'nextHand') {
          if (!Poker.isHandOver(room.poker)) return;
          if (room.poker.matchOver) {
            send(ws, { type: 'invalid', reason: 'poker', message: '매치가 종료되었습니다' });
            return;
          }
          const nh = Poker.nextHand(room.poker, shuffledDeck());
          if (nh.error) return;
          room.poker = nh;
          sendPokerState(room, room.poker.log.slice());
          return;
        }

        const res = Poker.apply(room.poker, seat, action);
        if (res.error) {
          send(ws, { type: 'invalid', reason: 'poker', message: res.error });
          return;
        }
        room.poker = res.state;
        sendPokerState(room, res.events);
        break;
      }

      case 'move': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isCardGame(room.game)) return;  // 카드 게임에는 착수가 없다
        const me = playerOf(room, ws);
        if (!me) return;
        if (me.color !== room.turn) return; // 내 차례 아님
        const r = msg.row | 0;
        const c = msg.col | 0;

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
        broadcast(room, { type: 'move', row: r, col: c, color: colorStr, win: win });
        break;
      }

      case 'chat': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const me = playerOf(room, ws);
        if (!me) return;
        let text = (msg.text || '').toString().slice(0, 500);
        const from = me.color === Rules.BLACK ? 'black' : 'white';
        broadcast(room, { type: 'chat', text: text, from: from });
        break;
      }

      case 'undoRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isCardGame(room.game)) return;  // 카드 게임은 무르기 없음
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'undoRequest' });
        break;
      }

      case 'undoResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (msg.accept) {
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
              counts: Othello.counts(room.board)
            });
          } else {
            if (room.moves.length > 0) {
              const last = room.moves.pop();
              room.board[last.row][last.col] = Rules.EMPTY;
              room.turn = last.color; // 무른 사람 차례로 복귀
            }
            broadcast(room, { type: 'undo' });
          }
        } else {
          const opp = opponentOf(room, ws);
          if (opp) send(opp.ws, { type: 'undoRejected' });
        }
        break;
      }

      case 'swapRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        // 카드 게임에는 돌 색이 없다(좌석은 고정) → 요청 자체를 무시
        if (isCardGame(room.game)) return;
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'swapRequest' });
        break;
      }

      case 'swapResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (isCardGame(room.game)) return;
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
        const game = normGame(msg.game);
        if (!game) return;              // 알 수 없는 종목
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
        const target = room.pendingGame;
        room.pendingGame = null;        // 응답 한 번으로 요청은 소멸
        if (msg.accept) {
          if (!target || target === room.game) return; // 대기 중인 요청 없음
          if (room.moves.length > 0) return;           // 착수 이후 변경 거부(무시)
          // 색은 유지(흑 선착), 보드/턴/기보만 새 종목 기준으로 리셋.
          // 맞포커로/에서 바뀌면 엔진 상태도 새 매치(칩 1000)로 리셋된다.
          room.game = target;
          resetRoomBoard(room);
          broadcast(room, { type: 'gameChanged', game: room.game, turn: 'black' });
          if (isCardGame(room.game)) sendPokerState(room, room.poker.log.slice());
        } else {
          const opp = opponentOf(room, ws);
          if (opp) send(opp.ws, { type: 'gameChangeRejected' });
        }
        break;
      }

      case 'restartRequest': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'restartRequest' });
        break;
      }

      case 'restartResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (msg.accept) {
          resetRoomBoard(room);
          // 색 교대. 단 카드 게임에서 색은 "좌석"이므로 교대하지 않는다
          // (재대국 = 칩 1000 으로 되돌린 완전히 새로운 매치).
          if (!isCardGame(room.game)) {
            room.players.forEach((p) => {
              p.color = p.color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
            });
          }
          room.players.forEach((p) => {
            send(p.ws, {
              type: 'restart',
              color: p.color === Rules.BLACK ? 'black' : 'white',
              turn: 'black'
            });
          });
          if (isCardGame(room.game)) sendPokerState(room, room.poker.log.slice());
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
    const opp = opponentOf(room, ws);
    // 맞포커: 판이 진행 중이었다면 나간 쪽을 다이 처리해서 남은 사람이
    // 팟을 가져가게 한 뒤(정산된 뷰를 한 번 더 보낸다) 퇴장을 알린다.
    if (opp && isCardGame(room.game) && room.poker && !Poker.isHandOver(room.poker)) {
      const leaver = seatOf(room, ws);
      if (leaver !== null) {
        const res = Poker.apply(room.poker, leaver, { type: 'die' });
        if (!res.error) {
          room.poker = res.state;
        } else {
          // 베팅 단계가 아니면(매장/오픈 중) 팟을 그대로 남은 사람에게 준다
          const w = leaver === 0 ? 1 : 0;
          room.poker.chips[w] += room.poker.pot;
          room.poker.result = {
            winner: w, split: false, amount: room.poker.pot,
            folded: leaver, revealed: false, hands: [null, null]
          };
          room.poker.pot = 0;
          room.poker.over = true;
          room.poker.phase = 'folded';
          room.poker.toAct = null;
          room.poker.log.push({ t: 'fold', p: leaver, winner: w, amount: room.poker.result.amount });
        }
        const seat = seatOfColor(opp.color);
        send(opp.ws, {
          type: 'pokerState',
          seat: seat,
          view: Poker.viewFor(room.poker, seat),
          events: [room.poker.log[room.poker.log.length - 1]]
        });
      }
    }
    if (opp) send(opp.ws, { type: 'opponentLeft' });
    rooms.delete(room.code);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('오목 서버 실행 중: http://localhost:' + PORT);
});

module.exports = { app, server };
