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
  room.board = Rules.createBoard();
  room.turn = Rules.BLACK;
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
        const rule = msg.rule === 'free' ? 'free' : 'renju';
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
          rule: rule,
          board: Rules.createBoard(),
          turn: Rules.BLACK,
          moves: [],
          players: [{ ws: ws, color: creatorColor }]
        };
        rooms.set(code, room);
        ws.roomCode = code;
        send(ws, {
          type: 'created',
          code: code,
          color: creatorColor === Rules.BLACK ? 'black' : 'white',
          rule: rule
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
          color: joinColor === Rules.BLACK ? 'black' : 'white',
          rule: room.rule
        });
        // 양쪽에 시작 알림
        broadcast(room, {
          type: 'start',
          code: code,
          rule: room.rule,
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
        const v = Rules.validateMove(room.board, r, c, me.color, room.rule);
        if (!v.ok) {
          send(ws, { type: 'invalid', row: r, col: c, reason: v.reason, ftype: v.type || null });
          return;
        }
        room.board[r][c] = me.color;
        room.moves.push({ row: r, col: c, color: me.color });
        const colorStr = me.color === Rules.BLACK ? 'black' : 'white';
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
          if (room.moves.length > 0) {
            const last = room.moves.pop();
            room.board[last.row][last.col] = Rules.EMPTY;
            room.turn = last.color; // 무른 사람 차례로 복귀
          }
          broadcast(room, { type: 'undo' });
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
