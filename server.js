/*
 * server.js — 오목 게임 서버
 * - Express: ./public 정적 서빙 (포트 3000, PORT 환경변수 override)
 * - ws: 동일 HTTP 서버의 /ws 경로에서 온라인 방/채팅 처리
 * 규칙 로직은 public/rules.js 를 공유해서 서버 권위 검증에 사용.
 */
'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const Rules = require('./public/rules.js');
const Othello = require('./public/othello.js');

// 방의 게임 종류에 맞는 규칙 모듈 반환
function gameModule(game) {
  return game === 'othello' ? Othello : Rules;
}
function colorToStr(c) {
  return c === Rules.BLACK ? 'black' : 'white';
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
        const game = msg.game === 'othello' ? 'othello' : 'omok';
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
        const code = genCode();
        const room = {
          code: code,
          game: game,
          rule: rule,
          board: M.createBoard(),
          turn: M.BLACK,
          moves: [],
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
        break;
      }

      case 'move': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const me = playerOf(room, ws);
        if (!me) return;
        if (me.color !== room.turn) return; // 내 차례 아님
        const r = msg.row | 0;
        const c = msg.col | 0;

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
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'swapRequest' });
        break;
      }

      case 'swapResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
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
        const game = msg.game === 'othello' ? 'othello' : (msg.game === 'omok' ? 'omok' : null);
        if (!game) return;              // 알 수 없는 종목
        if (game === room.game) return; // 현재와 같은 종목
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'gameChangeRequest', game: game });
        break;
      }

      case 'gameChangeResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (msg.accept) {
          if (room.moves.length > 0) return; // 착수 이후 변경 거부(무시)
          // 두 종목뿐이므로 토글. 색은 유지(흑 선착), 보드/턴/기보만 새 종목 기준으로 리셋.
          room.game = room.game === 'othello' ? 'omok' : 'othello';
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
        const opp = opponentOf(room, ws);
        if (opp) send(opp.ws, { type: 'restartRequest' });
        break;
      }

      case 'restartResponse': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (msg.accept) {
          resetRoomBoard(room);
          // 색 교대
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
