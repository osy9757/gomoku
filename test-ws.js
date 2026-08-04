/* 온라인 WebSocket 흐름 검증 */
const WebSocket = require('ws');
const Othello = require('./public/othello.js');
const PORT = process.env.PORT || 3457;
const URL = 'ws://localhost:' + PORT + '/ws';

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function open() { return new Promise((res) => { const w = new WebSocket(URL); w.on('open', () => res(w)); }); }
function next(ws) { return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString())))); }
function send(ws, o) { ws.send(JSON.stringify(o)); }
// 소켓의 모든 메시지를 모으는 수집기 (브로드캐스트가 유실/뒤섞이지 않게)
function collect(ws) {
  const arr = [];
  ws.on('message', (d) => arr.push(JSON.parse(d.toString())));
  return arr;
}
// 조건을 만족하는 메시지가 도착할 때까지 대기 (내용으로 매칭 → 타이밍 경합 없음)
async function until(arr, pred, ms) {
  const limit = ms || 3000;
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const m = arr.find(pred);
    if (m) return m;
    await wait(10);
  }
  throw new Error('timeout: 기대한 메시지가 오지 않음');
}
const isMove = (r, c) => (m) => m.type === 'move' && m.row === r && m.col === c;
// 방 하나를 열고 (흑=생성자, 백=참가자) 두 소켓 + 수집기를 돌려준다
async function room(game, rule) {
  const black = await open();
  const bm = collect(black);
  send(black, { type: 'create', rule: rule || 'renju', color: 'black', game: game });
  const created = await until(bm, (m) => m.type === 'created');
  const white = await open();
  const wm = collect(white);
  send(white, { type: 'join', code: created.code });
  await until(wm, (m) => m.type === 'start');
  await until(bm, (m) => m.type === 'start');
  bm.length = 0; wm.length = 0;
  return { black, white, bm, wm, code: created.code };
}
// 오델로 방 하나를 열고 (흑=생성자, 백=참가자) 두 소켓 + 수집기를 돌려준다
async function othelloRoom() { return room('othello'); }
async function omokRoom(rule) { return room('omok', rule); }
// 사목 방
async function c4Room() { return room('connect4'); }
// 사목은 같은 열에 여러 번 떨어지므로 착지 행까지 봐야 메시지가 구분된다
const isDrop = (r, c) => (m) => m.type === 'move' && m.game === 'connect4' && m.row === r && m.col === c;

(async () => {
  // 1. 방 생성
  const host = await open();
  send(host, { type: 'create', rule: 'renju' });
  const created = await next(host);
  assert('created 메시지 & 흑', created.type === 'created' && created.color === 'black' && created.code.length === 6);
  const code = created.code;

  // 2. 잘못된 코드 참가
  const bad = await open();
  send(bad, { type: 'join', code: 'ZZZZZZ' });
  const err = await next(bad);
  assert('없는 방 에러', err.type === 'error' && err.message === '존재하지 않는 방입니다');
  bad.close();

  // 3. 정상 참가 -> joined + 양쪽 start
  const guest = await open();
  const hostMsgs = [];
  host.on('message', (d) => hostMsgs.push(JSON.parse(d.toString())));
  send(guest, { type: 'join', code });
  const joined = await next(guest);
  assert('joined & 백', joined.type === 'joined' && joined.color === 'white');
  const gStart = await next(guest);
  assert('guest start', gStart.type === 'start' && gStart.rule === 'renju');
  await wait(100);
  assert('host start 수신', hostMsgs.some(m => m.type === 'start'));

  // 4. 착수: host(흑) 둔다
  const gMoves = [];
  guest.on('message', (d) => gMoves.push(JSON.parse(d.toString())));
  hostMsgs.length = 0;
  send(host, { type: 'move', row: 7, col: 7 });
  await wait(100);
  assert('host move 브로드캐스트', hostMsgs.some(m => m.type === 'move' && m.color === 'black' && m.row === 7));
  assert('guest move 수신', gMoves.some(m => m.type === 'move' && m.color === 'black'));

  // 5. 차례 아닌데 두기 시도 (host 다시) -> 무시됨(응답없음)
  hostMsgs.length = 0;
  send(host, { type: 'move', row: 8, col: 8 });
  await wait(80);
  assert('차례 아닌 착수 무시', !hostMsgs.some(m => m.type === 'move'));

  // 6. 채팅 (host -> 양쪽 브로드캐스트, HTML escape는 클라 담당이지만 text 전달 확인)
  gMoves.length = 0; hostMsgs.length = 0;
  send(host, { type: 'chat', text: '<b>안녕</b>' });
  await wait(80);
  assert('채팅 브로드캐스트 from black', gMoves.some(m => m.type === 'chat' && m.from === 'black' && m.text === '<b>안녕</b>'));

  // 7. 금수 착수 검증: 흑이 3-3 만들도록 서버 상태 구성은 복잡 -> 간단히 이미 둔 자리 재착수(occupied) 시도
  // guest(백) 차례임. 백이 (7,7) 이미 둔 자리 시도 -> invalid occupied
  gMoves.length = 0;
  send(guest, { type: 'move', row: 7, col: 7 });
  await wait(80);
  assert('점유된 칸 invalid', gMoves.some(m => m.type === 'invalid' && m.reason === 'occupied'));

  // 8. 무르기 흐름
  hostMsgs.length = 0; gMoves.length = 0;
  send(host, { type: 'undoRequest' });
  await wait(60);
  assert('상대에게 undoRequest 전달', gMoves.some(m => m.type === 'undoRequest'));
  send(guest, { type: 'undoResponse', accept: true });
  await wait(60);
  assert('undo 브로드캐스트', hostMsgs.some(m => m.type === 'undo') && gMoves.some(m => m.type === 'undo'));

  // 9. 재시작 흐름 + 색 교대
  hostMsgs.length = 0; gMoves.length = 0;
  send(host, { type: 'restartRequest' });
  await wait(60);
  send(guest, { type: 'restartResponse', accept: true });
  await wait(80);
  const hostRestart = hostMsgs.find(m => m.type === 'restart');
  const guestRestart = gMoves.find(m => m.type === 'restart');
  assert('restart 색 교대', hostRestart && guestRestart && hostRestart.color === 'white' && guestRestart.color === 'black');

  // 10. 연결 종료 -> opponentLeft
  hostMsgs.length = 0;
  guest.close();
  await wait(120);
  assert('opponentLeft 통지', hostMsgs.some(m => m.type === 'opponentLeft'));

  host.close();
  await wait(50);

  // 11. 색상 선택: 생성자가 백돌 선택 -> 생성자 백, 참가자 흑, 흑(참가자) 선착
  const h2 = await open();
  send(h2, { type: 'create', rule: 'renju', color: 'white' });
  const c2 = await next(h2);
  assert('white 선택 생성자 백', c2.type === 'created' && c2.color === 'white' && c2.code.length === 6);
  const h2Msgs = [];
  h2.on('message', (d) => h2Msgs.push(JSON.parse(d.toString())));
  const g2 = await open();
  const g2Msgs = [];
  g2.on('message', (d) => g2Msgs.push(JSON.parse(d.toString())));
  send(g2, { type: 'join', code: c2.code });
  await wait(80);
  const j2 = g2Msgs.find(m => m.type === 'joined');
  assert('참가자 흑', j2 && j2.color === 'black');
  const g2Start = g2Msgs.find(m => m.type === 'start');
  assert('start turn black', g2Start && g2Start.turn === 'black');
  // 백(생성자)이 먼저 두려하면 무시 (흑 차례)
  h2Msgs.length = 0;
  send(h2, { type: 'move', row: 3, col: 3 });
  await wait(60);
  assert('백(생성자) 선착 불가', !h2Msgs.some(m => m.type === 'move'));
  // 흑(참가자) 선착 성공
  h2Msgs.length = 0;
  send(g2, { type: 'move', row: 7, col: 7 });
  await wait(80);
  assert('흑(참가자) 선착', h2Msgs.some(m => m.type === 'move' && m.color === 'black' && m.row === 7));
  h2.close(); g2.close();
  await wait(80);

  // 12. 돌 바꾸기: 착수 전 요청/수락 -> 색 교대
  const h3 = await open();
  send(h3, { type: 'create', rule: 'renju', color: 'black' });
  const c3 = await next(h3);
  const h3Msgs = [];
  h3.on('message', (d) => h3Msgs.push(JSON.parse(d.toString())));
  const g3 = await open();
  const g3Msgs = [];
  g3.on('message', (d) => g3Msgs.push(JSON.parse(d.toString())));
  send(g3, { type: 'join', code: c3.code });
  await wait(80);
  h3Msgs.length = 0; g3Msgs.length = 0;
  send(h3, { type: 'swapRequest' });
  await wait(60);
  assert('상대에게 swapRequest 전달', g3Msgs.some(m => m.type === 'swapRequest'));
  send(g3, { type: 'swapResponse', accept: true });
  await wait(80);
  const hSwapped = h3Msgs.find(m => m.type === 'swapped');
  const gSwapped = g3Msgs.find(m => m.type === 'swapped');
  assert('swapped 색 교대', hSwapped && gSwapped && hSwapped.color === 'white' && gSwapped.color === 'black');
  // 스왑 후 흑(참가자) 선착
  h3Msgs.length = 0;
  send(g3, { type: 'move', row: 7, col: 7 });
  await wait(80);
  assert('스왑 후 흑(참가자) 선착', h3Msgs.some(m => m.type === 'move' && m.color === 'black'));
  h3.close(); g3.close();
  await wait(80);

  // 13. 돌 바꾸기: 착수 후 요청은 거부/무시(no-op)
  const h4 = await open();
  send(h4, { type: 'create', rule: 'renju', color: 'black' });
  const c4 = await next(h4);
  const h4Msgs = [];
  h4.on('message', (d) => h4Msgs.push(JSON.parse(d.toString())));
  const g4 = await open();
  const g4Msgs = [];
  g4.on('message', (d) => g4Msgs.push(JSON.parse(d.toString())));
  send(g4, { type: 'join', code: c4.code });
  await wait(80);
  // 흑(생성자) 착수
  send(h4, { type: 'move', row: 7, col: 7 });
  await wait(80);
  // 착수 후 스왑 요청 & 수락 -> swapped 없음
  h4Msgs.length = 0; g4Msgs.length = 0;
  send(g4, { type: 'swapRequest' });
  await wait(60);
  assert('착수 후 swapRequest 전달', h4Msgs.some(m => m.type === 'swapRequest'));
  send(h4, { type: 'swapResponse', accept: true });
  await wait(80);
  assert('착수 후 스왑 무시(no swapped)', !h4Msgs.some(m => m.type === 'swapped') && !g4Msgs.some(m => m.type === 'swapped'));
  h4.close(); g4.close();
  await wait(80);

  // ============================================================
  // 14. 오델로 방: create(game:'othello') -> join -> 흑 d3 착수
  //     좌표 d3 = (row 2, col 3), 뒤집힘 d4 = (row 3, col 3)
  // ============================================================
  const o1 = await open();
  send(o1, { type: 'create', rule: 'renju', color: 'black', game: 'othello' });
  const oc = await next(o1);
  assert('오델로 created game 필드', oc.type === 'created' && oc.game === 'othello' && oc.color === 'black');
  const o1Msgs = [];
  o1.on('message', (d) => o1Msgs.push(JSON.parse(d.toString())));
  const o2 = await open();
  const o2Msgs = [];
  o2.on('message', (d) => o2Msgs.push(JSON.parse(d.toString())));
  send(o2, { type: 'join', code: oc.code });
  await wait(100);
  const oJoined = o2Msgs.find(m => m.type === 'joined');
  assert('오델로 joined game 필드', oJoined && oJoined.game === 'othello' && oJoined.color === 'white');
  const oStart = o2Msgs.find(m => m.type === 'start');
  assert('오델로 start game 필드', oStart && oStart.game === 'othello');

  // 흑(생성자) d3=(2,3) 착수 -> 양쪽 move + flips 적용
  o1Msgs.length = 0; o2Msgs.length = 0;
  send(o1, { type: 'move', row: 2, col: 3 });
  await wait(100);
  const oMoveHost = o1Msgs.find(m => m.type === 'move');
  const oMoveGuest = o2Msgs.find(m => m.type === 'move');
  const flipD4 = (m) => m && m.flipped && m.flipped.some(f => f[0] === 3 && f[1] === 3) && m.flipped.length === 1;
  assert('오델로 host move + d4 flip', oMoveHost && oMoveHost.color === 'black' && flipD4(oMoveHost));
  assert('오델로 guest move + d4 flip', oMoveGuest && flipD4(oMoveGuest));
  assert('오델로 move counts/nextTurn', oMoveHost && oMoveHost.counts && oMoveHost.counts.black === 4 && oMoveHost.nextTurn === 'white');

  // 비합법 착수 (백이 a1=(0,0), 뒤집을 돌 없음) -> move 브로드캐스트 없음
  o1Msgs.length = 0; o2Msgs.length = 0;
  send(o2, { type: 'move', row: 0, col: 0 });
  await wait(80);
  assert('오델로 비합법 착수 무시', !o1Msgs.some(m => m.type === 'move') && o2Msgs.some(m => m.type === 'invalid'));

  o1.close(); o2.close();
  await wait(80);

  // ============================================================
  // 15. 오델로 패스: 상대가 둘 곳이 없으면 passed 로 알리고 턴을 유지한다
  //     수순 d3 c3 b3 b2 f5 a3 a1 c1 이후 흑은 둘 곳이 없다.
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    const SEQ = [[2, 3], [2, 2], [2, 1], [1, 1], [4, 5], [2, 0], [0, 0], [0, 2]];
    let board = Othello.createBoard();
    let last = null;
    for (let i = 0; i < SEQ.length; i++) {
      const mover = i % 2 === 0 ? black : white;
      const color = i % 2 === 0 ? Othello.BLACK : Othello.WHITE;
      send(mover, { type: 'move', row: SEQ[i][0], col: SEQ[i][1] });
      last = await until(bm, isMove(SEQ[i][0], SEQ[i][1]));
      await until(wm, isMove(SEQ[i][0], SEQ[i][1]));   // 양쪽 브로드캐스트 확인
      board = Othello.applyMove(board, SEQ[i][0], SEQ[i][1], color).board;
    }
    assert('오델로 패스: passed 플래그', last.passed === true, { passed: last.passed });
    assert('오델로 패스: 패스한 색 = 흑', last.passColor === 'black', last.passColor);
    assert('오델로 패스: 턴 유지(백)', last.nextTurn === 'white', last.nextTurn);
    assert('오델로 패스: 서버/로컬 보드 개수 일치',
      last.counts.black === Othello.counts(board).black &&
      last.counts.white === Othello.counts(board).white, last.counts);
    // 패스 직후 백이 연속으로 둘 수 있어야 한다
    const nm = Othello.legalMoves(board, Othello.WHITE)[0];
    send(white, { type: 'move', row: nm.row, col: nm.col });
    const after = await until(bm, isMove(nm.row, nm.col));
    assert('오델로 패스 후 백 연속 착수', after.color === 'white', after.color);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 16. 오델로 종료: 끝까지 두면 over/winner/counts 가 양쪽에 브로드캐스트된다
  //     (정책: 스캔 순서의 첫 합법수 — 결정적이라 결과가 고정된다)
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    let board = Othello.createBoard();
    let turn = Othello.BLACK;
    let over = null, guestOver = null, plies = 0;
    while (plies < 80) {
      const ms = Othello.legalMoves(board, turn);
      if (!ms.length) break;              // 서버 턴과 어긋나면 중단 (아래에서 검출)
      const mover = turn === Othello.BLACK ? black : white;
      send(mover, { type: 'move', row: ms[0].row, col: ms[0].col });
      const m = await until(bm, isMove(ms[0].row, ms[0].col), 5000);
      const mo = await until(wm, isMove(ms[0].row, ms[0].col), 5000);
      board = Othello.applyMove(board, ms[0].row, ms[0].col, turn).board;
      plies++;
      if (m.over) { over = m; guestOver = mo; break; }
      turn = m.nextTurn === 'black' ? Othello.BLACK : Othello.WHITE;
    }
    assert('오델로 종료: 60수에 over', over !== null && plies === 60, { plies: plies, over: !!over });
    assert('오델로 종료: 최종 집계 19:45',
      over && over.counts.black === 19 && over.counts.white === 45, over && over.counts);
    assert('오델로 종료: 승자 = 백(2)', over && over.winner === Othello.WHITE, over && over.winner);
    assert('오델로 종료: nextTurn null', over && over.nextTurn === null, over && over.nextTurn);
    assert('오델로 종료: 양쪽 동일 브로드캐스트',
      guestOver && guestOver.over === true && guestOver.counts.white === 45, guestOver && guestOver.counts);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 17. 오델로 무르기: 뒤집힌 돌까지 되돌린 서버 보드를 내려준다
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    send(black, { type: 'move', row: 2, col: 3 });   // d3
    await until(bm, isMove(2, 3));
    send(black, { type: 'undoRequest' });
    await until(wm, (m) => m.type === 'undoRequest');
    send(white, { type: 'undoResponse', accept: true });
    const ub = await until(bm, (m) => m.type === 'undo');
    const uw = await until(wm, (m) => m.type === 'undo');
    assert('오델로 undo: game 필드', ub.game === 'othello' && uw.game === 'othello', { b: ub.game, w: uw.game });
    assert('오델로 undo: 초기 배치로 복원',
      ub.board && ub.board[2][3] === 0 && ub.board[3][3] === Othello.WHITE &&
      ub.board[4][4] === Othello.WHITE && ub.board[3][4] === Othello.BLACK,
      ub.board && [ub.board[2][3], ub.board[3][3]]);
    assert('오델로 undo: 집계 2:2', ub.counts.black === 2 && ub.counts.white === 2, ub.counts);
    assert('오델로 undo: 무른 사람(흑) 차례', ub.turn === 'black', ub.turn);
    // 무르기 후 같은 자리에 다시 둘 수 있어야 한다
    wm.length = 0;
    send(black, { type: 'move', row: 2, col: 3 });
    const ag = await until(wm, isMove(2, 3));
    assert('오델로 undo 후 재착수', ag.color === 'black' && ag.counts.black === 4, ag.counts);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 18. 오델로 돌 바꾸기(착수 전) — 색만 교대, 흑이 여전히 선착
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    send(black, { type: 'swapRequest' });
    await until(wm, (m) => m.type === 'swapRequest');
    send(white, { type: 'swapResponse', accept: true });
    const sb = await until(bm, (m) => m.type === 'swapped');
    const sw = await until(wm, (m) => m.type === 'swapped');
    assert('오델로 스왑: 색 교대', sb.color === 'white' && sw.color === 'black', { b: sb.color, w: sw.color });
    // 새 흑(=원래 참가자)이 d3 착수 성공
    send(white, { type: 'move', row: 2, col: 3 });
    const m = await until(bm, isMove(2, 3));
    assert('오델로 스왑 후 새 흑 선착', m.color === 'black' && m.counts.black === 4, m.counts);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 19. 오델로 재대국 — 보드가 오델로 초기 배치로 리셋되고 색이 교대된다
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    send(black, { type: 'move', row: 2, col: 3 });
    await until(bm, isMove(2, 3));
    send(black, { type: 'restartRequest' });
    await until(wm, (m) => m.type === 'restartRequest');
    send(white, { type: 'restartResponse', accept: true });
    const rb = await until(bm, (m) => m.type === 'restart');
    const rw = await until(wm, (m) => m.type === 'restart');
    assert('오델로 재대국: 색 교대', rb.color === 'white' && rw.color === 'black', { b: rb.color, w: rw.color });
    // 새 흑(원 참가자)이 d3 두면 4:1 → 보드가 오델로 초기 배치로 리셋됐다는 뜻
    bm.length = 0;
    send(white, { type: 'move', row: 2, col: 3 });
    const m = await until(bm, isMove(2, 3));
    assert('오델로 재대국: 보드 초기화(4:1)', m.counts.black === 4 && m.counts.white === 1, m.counts);
    assert('오델로 재대국: 오델로 방 유지', m.game === 'othello', m.game);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 20. 게임 바꾸기(합의): 오목 방 -> 오델로 로 전환
  //     색은 유지, 보드는 오델로 초기 배치, 흑이 d3 착수 가능
  // ============================================================
  {
    const { black, white, bm, wm } = await omokRoom();
    // 잘못된 값 / 현재와 같은 종목은 무시된다
    send(black, { type: 'gameChangeRequest', game: 'chess' });
    send(black, { type: 'gameChangeRequest', game: 'omok' });
    await wait(80);
    assert('게임 변경: 잘못된 game 요청 무시',
      !wm.some((m) => m.type === 'gameChangeRequest'), wm.map((m) => m.type));

    send(black, { type: 'gameChangeRequest', game: 'othello' });
    const req = await until(wm, (m) => m.type === 'gameChangeRequest');
    assert('게임 변경: 상대에게 요청 전달 + game 필드', req.game === 'othello', req.game);
    assert('게임 변경: 요청자에게는 요청 미전달',
      !bm.some((m) => m.type === 'gameChangeRequest'), bm.map((m) => m.type));

    send(white, { type: 'gameChangeResponse', accept: true });
    const gb = await until(bm, (m) => m.type === 'gameChanged');
    const gw = await until(wm, (m) => m.type === 'gameChanged');
    assert('게임 변경: 양쪽 gameChanged 브로드캐스트',
      gb.game === 'othello' && gw.game === 'othello', { b: gb.game, w: gw.game });
    assert('게임 변경: turn=black', gb.turn === 'black' && gw.turn === 'black', gb.turn);

    // 색 유지 -> 원래 흑(생성자)이 그대로 흑. 오델로 d3=(2,3) 착수 & d4 뒤집힘
    bm.length = 0; wm.length = 0;
    send(black, { type: 'move', row: 2, col: 3 });
    const mv = await until(wm, isMove(2, 3));
    await until(bm, isMove(2, 3));
    assert('게임 변경 후 오델로 착수: 색 유지(흑=생성자)', mv.color === 'black', mv.color);
    assert('게임 변경 후 오델로 착수: game=othello + d4 flip',
      mv.game === 'othello' && mv.flipped.length === 1 &&
      mv.flipped[0][0] === 3 && mv.flipped[0][1] === 3, { g: mv.game, f: mv.flipped });
    assert('게임 변경 후 오델로 착수: 집계 4:1',
      mv.counts.black === 4 && mv.counts.white === 1, mv.counts);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 21. 게임 바꾸기: 착수 이후 요청/수락은 거부(no-op)
  // ============================================================
  {
    const { black, white, bm, wm } = await omokRoom();
    send(black, { type: 'move', row: 7, col: 7 });
    await until(bm, isMove(7, 7));
    bm.length = 0; wm.length = 0;
    send(black, { type: 'gameChangeRequest', game: 'othello' });
    await until(wm, (m) => m.type === 'gameChangeRequest');
    send(white, { type: 'gameChangeResponse', accept: true });
    await wait(120);
    assert('게임 변경: 착수 후 gameChanged 없음',
      !bm.some((m) => m.type === 'gameChanged') && !wm.some((m) => m.type === 'gameChanged'),
      bm.map((m) => m.type));
    // 방은 여전히 오목 — 백이 정상 착수 가능
    wm.length = 0; bm.length = 0;
    send(white, { type: 'move', row: 7, col: 8 });
    const mv = await until(bm, isMove(7, 8));
    assert('게임 변경 거부 후 오목 유지', mv.color === 'white' && mv.game === undefined, mv);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 22. 게임 바꾸기: 거절 -> 요청자에게만 gameChangeRejected
  // ============================================================
  {
    const { black, white, bm, wm } = await omokRoom();
    send(black, { type: 'gameChangeRequest', game: 'othello' });
    await until(wm, (m) => m.type === 'gameChangeRequest');
    send(white, { type: 'gameChangeResponse', accept: false });
    const rej = await until(bm, (m) => m.type === 'gameChangeRejected');
    assert('게임 변경 거절: 요청자 수신', !!rej);
    assert('게임 변경 거절: 거절자에겐 미전달',
      !wm.some((m) => m.type === 'gameChangeRejected'), wm.map((m) => m.type));
    assert('게임 변경 거절: gameChanged 없음',
      !bm.some((m) => m.type === 'gameChanged') && !wm.some((m) => m.type === 'gameChanged'));
    // 여전히 오목 방 — 흑 착수 정상
    bm.length = 0;
    send(black, { type: 'move', row: 7, col: 7 });
    const mv = await until(bm, isMove(7, 7));
    assert('게임 변경 거절 후 오목 착수 정상', mv.color === 'black', mv.color);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 23. 게임 바꾸기: 오델로 -> 오목 전환 후에도 렌주 금수 판정이 살아있다
  //     흑 (7,5)(7,6)(5,7)(6,7) 이후 (7,7) 은 3-3 금수
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    send(black, { type: 'gameChangeRequest', game: 'omok' });
    const req = await until(wm, (m) => m.type === 'gameChangeRequest');
    assert('게임 변경(오델로->오목): 요청 game 필드', req.game === 'omok', req.game);
    send(white, { type: 'gameChangeResponse', accept: true });
    const gb = await until(bm, (m) => m.type === 'gameChanged');
    await until(wm, (m) => m.type === 'gameChanged');
    assert('게임 변경(오델로->오목): gameChanged', gb.game === 'omok' && gb.turn === 'black', gb);

    const SEQ = [[7, 5], [0, 0], [7, 6], [0, 1], [5, 7], [0, 2], [6, 7], [0, 3]];
    for (let i = 0; i < SEQ.length; i++) {
      const mover = i % 2 === 0 ? black : white;
      send(mover, { type: 'move', row: SEQ[i][0], col: SEQ[i][1] });
      await until(bm, isMove(SEQ[i][0], SEQ[i][1]));
      await until(wm, isMove(SEQ[i][0], SEQ[i][1]));
    }
    bm.length = 0; wm.length = 0;
    send(black, { type: 'move', row: 7, col: 7 });
    const inv = await until(bm, (m) => m.type === 'invalid');
    assert('게임 변경 후 렌주 금수(3-3) 판정 유지',
      inv.reason === 'forbidden' && inv.ftype === 'three-three', inv);
    assert('게임 변경 후 금수는 브로드캐스트되지 않음',
      !wm.some((m) => m.type === 'move'), wm.map((m) => m.type));
    // 금수가 아닌 자리는 정상 착수
    send(black, { type: 'move', row: 10, col: 10 });
    const ok = await until(wm, isMove(10, 10));
    assert('게임 변경 후 정상 오목 착수', ok.color === 'black', ok.color);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 24. 사목 방: create(game:'connect4') -> join -> 열 낙하가 양쪽에 동일하게 반영
  // ============================================================
  {
    const c0 = await open();
    send(c0, { type: 'create', rule: 'renju', color: 'black', game: 'connect4' });
    const cc = await next(c0);
    assert('사목 created game 필드', cc.type === 'created' && cc.game === 'connect4' && cc.color === 'black');
    const c0m = collect(c0);
    const c1 = await open();
    const c1m = collect(c1);
    send(c1, { type: 'join', code: cc.code });
    const cJoined = await until(c1m, (m) => m.type === 'joined');
    assert('사목 joined game 필드', cJoined.game === 'connect4' && cJoined.color === 'white');
    const cStart = await until(c1m, (m) => m.type === 'start');
    assert('사목 start game 필드', cStart.game === 'connect4');
    await until(c0m, (m) => m.type === 'start');
    c0m.length = 0; c1m.length = 0;

    // 흑(빨강) D열(col 3) -> 바닥 row 5
    send(c0, { type: 'move', col: 3 });
    const d1 = await until(c0m, isDrop(5, 3));
    const d1g = await until(c1m, isDrop(5, 3));
    assert('사목 첫 낙하: 바닥(row 5) + 양쪽 동일',
      d1.color === 'black' && d1.nextTurn === 'white' &&
      d1g.row === 5 && d1g.col === 3, { h: d1.row, g: d1g.row });
    assert('사목 첫 낙하: 승리/무승부 아님', d1.win === false && d1.draw === false);

    // 백(노랑) 같은 열 -> row 4 로 쌓임
    send(c1, { type: 'move', col: 3 });
    const d2 = await until(c1m, isDrop(4, 3));
    await until(c0m, isDrop(4, 3));
    assert('사목 같은 열 쌓임(row 4)', d2.color === 'white' && d2.nextTurn === 'black', d2.row);

    // 차례 아닌 쪽 착수는 무시
    c0m.length = 0; c1m.length = 0;
    send(c1, { type: 'move', col: 1 });
    await wait(80);
    assert('사목 차례 아닌 착수 무시', !c0m.some((m) => m.type === 'move'));

    c0.close(); c1.close();
    await wait(60);
  }

  // ============================================================
  // 25. 사목: 가득 찬 열은 invalid(column-full), 브로드캐스트 없음
  // ============================================================
  {
    const { black, white, bm, wm } = await c4Room();
    // 0열에 6개 채우기 (흑/백 번갈아)
    for (let i = 0; i < 6; i++) {
      const mover = i % 2 === 0 ? black : white;
      send(mover, { type: 'move', col: 0 });
      await until(bm, isDrop(5 - i, 0));
      await until(wm, isDrop(5 - i, 0));
    }
    bm.length = 0; wm.length = 0;
    // 7번째 = 흑 차례, 가득 찬 열
    send(black, { type: 'move', col: 0 });
    const inv = await until(bm, (m) => m.type === 'invalid');
    assert('사목 가득 찬 열 invalid', inv.reason === 'column-full' && inv.col === 0, inv);
    assert('사목 가득 찬 열은 브로드캐스트 없음', !wm.some((m) => m.type === 'move'), wm.map((m) => m.type));
    // 다른 열은 정상
    send(black, { type: 'move', col: 1 });
    const ok = await until(wm, isDrop(5, 1));
    assert('사목 다른 열은 정상 착수', ok.color === 'black', ok.color);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 26. 사목 승리 브로드캐스트 (흑 가로 4목: 0,1,2,3열 바닥)
  // ============================================================
  {
    const { black, white, bm, wm } = await c4Room();
    const SEQ = [0, 6, 1, 6, 2, 6, 3];   // 흑 0,1,2,3 / 백 6열에 쌓기
    for (let i = 0; i < SEQ.length; i++) {
      const mover = i % 2 === 0 ? black : white;
      const expRow = SEQ[i] === 6 ? 5 - Math.floor(i / 2) : 5;
      send(mover, { type: 'move', col: SEQ[i] });
      await until(bm, isDrop(expRow, SEQ[i]));
      await until(wm, isDrop(expRow, SEQ[i]));
    }
    const win = bm.find((m) => m.type === 'move' && m.win === true);
    const winG = wm.find((m) => m.type === 'move' && m.win === true);
    const key = (m) => m.winCells.map((x) => x.row + ',' + x.col).sort().join(' ');
    assert('사목 승리 브로드캐스트(양쪽)', !!win && !!winG && win.color === 'black');
    assert('사목 승리 칸 4개 전달', win && key(win) === '5,0 5,1 5,2 5,3', win && win.winCells);
    assert('사목 승리 시 nextTurn null', win && win.nextTurn === null, win && win.nextTurn);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 27. 사목 무르기: 떨어진 돌이 사라지고 무른 사람 차례로 복귀
  // ============================================================
  {
    const { black, white, bm, wm } = await c4Room();
    send(black, { type: 'move', col: 3 });
    await until(bm, isDrop(5, 3));
    send(black, { type: 'undoRequest' });
    await until(wm, (m) => m.type === 'undoRequest');
    send(white, { type: 'undoResponse', accept: true });
    await until(bm, (m) => m.type === 'undo');
    await until(wm, (m) => m.type === 'undo');
    assert('사목 undo 양쪽 브로드캐스트', true);
    // 무르기 후 흑이 같은 열에 다시 두면 또 바닥(row 5)
    bm.length = 0; wm.length = 0;
    send(black, { type: 'move', col: 3 });
    const again = await until(wm, isDrop(5, 3));
    assert('사목 undo 후 재착수 바닥 복귀', again.color === 'black' && again.row === 5, again.row);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 28. 게임 바꾸기: 오목 -> 사목 (3종목 중 지정한 종목으로 정확히 전환)
  // ============================================================
  {
    const { black, white, bm, wm } = await omokRoom();
    send(black, { type: 'gameChangeRequest', game: 'connect4' });
    const req = await until(wm, (m) => m.type === 'gameChangeRequest');
    assert('게임 변경(오목->사목): 요청 game 필드', req.game === 'connect4', req.game);
    send(white, { type: 'gameChangeResponse', accept: true });
    const gb = await until(bm, (m) => m.type === 'gameChanged');
    const gw = await until(wm, (m) => m.type === 'gameChanged');
    assert('게임 변경(오목->사목): 양쪽 gameChanged',
      gb.game === 'connect4' && gw.game === 'connect4' && gb.turn === 'black', { b: gb.game, w: gw.game });
    // 색 유지 -> 원래 흑이 그대로 흑. 사목 낙하 동작
    bm.length = 0; wm.length = 0;
    send(black, { type: 'move', col: 2 });
    const mv = await until(wm, isDrop(5, 2));
    assert('게임 변경 후 사목 착수', mv.color === 'black' && mv.row === 5, mv);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 29. 게임 바꾸기: 사목 -> 오델로 (토글이 아니라 "요청한 종목"으로 간다)
  // ============================================================
  {
    const { black, white, bm, wm } = await c4Room();
    send(black, { type: 'gameChangeRequest', game: 'othello' });
    await until(wm, (m) => m.type === 'gameChangeRequest');
    send(white, { type: 'gameChangeResponse', accept: true });
    const gb = await until(bm, (m) => m.type === 'gameChanged');
    assert('게임 변경(사목->오델로): 요청한 종목으로 전환', gb.game === 'othello', gb.game);
    bm.length = 0;
    send(black, { type: 'move', row: 2, col: 3 });
    const mv = await until(bm, isMove(2, 3));
    assert('사목->오델로 후 오델로 규칙 동작', mv.game === 'othello' && mv.counts.black === 4, mv.counts);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 30. 게임 바꾸기: 대기 중인 요청 없이 온 수락은 무시된다
  // ============================================================
  {
    const { black, white, bm, wm } = await c4Room();
    send(white, { type: 'gameChangeResponse', accept: true });
    await wait(120);
    assert('게임 변경: 요청 없는 수락 무시',
      !bm.some((m) => m.type === 'gameChanged') && !wm.some((m) => m.type === 'gameChanged'));
    // 방은 여전히 사목
    send(black, { type: 'move', col: 4 });
    const mv = await until(wm, isDrop(5, 4));
    assert('요청 없는 수락 후에도 사목 유지', mv.game === 'connect4', mv.game);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 31. '맞포커(matpoker)' 는 더 이상 존재하지 않는 종목이다.
  //     포커 2인 방이 그 자리를 대신하므로(42·43번 시나리오),
  //     'matpoker' 는 알 수 없는 종목과 완전히 동일하게 취급된다.
  //     - create: 종목 화이트리스트에 없으므로 기본값(오목)으로 떨어진다
  //     - join:   그 방은 카드 방이 아니라 오목 방이다
  //     - 게임 바꾸기: 요청 자체가 상대에게 전달되지 않는다
  // ============================================================
  {
    const a = await open();
    const am = collect(a);
    send(a, { type: 'create', color: 'black', game: 'matpoker' });
    const cr = await until(am, (m) => m.type === 'created');
    assert("create game:'matpoker' 는 카드 방을 만들지 않는다 (오목 폴백)",
      cr.game === 'omok', cr.game);

    // 알 수 없는 종목('chess')과 완전히 같은 경로를 탄다
    const z = await open();
    const zm = collect(z);
    send(z, { type: 'create', color: 'black', game: 'chess' });
    const cz = await until(zm, (m) => m.type === 'created');
    assert("'matpoker' 는 알 수 없는 종목과 동일하게 처리된다",
      cz.game === cr.game, { matpoker: cr.game, unknown: cz.game });
    z.close();

    const b = await open();
    const bm = collect(b);
    send(b, { type: 'join', code: cr.code });
    const jn = await until(bm, (m) => m.type === 'joined');
    assert("join 도 'matpoker' 가 아니라 오목 방으로 들어간다", jn.game === 'omok', jn.game);
    await until(am, (m) => m.type === 'start');
    await wait(80);
    assert("'matpoker' 이름의 방에는 카드 상태(pokerState)가 오지 않는다",
      !am.some((m) => m.type === 'pokerState') && !bm.some((m) => m.type === 'pokerState'));

    // 실제로 오목이 동작한다 (카드 방이었다면 착수가 무시된다)
    am.length = 0; bm.length = 0;
    send(a, { type: 'move', row: 7, col: 7 });
    const mv = await until(bm, isMove(7, 7));
    assert("'matpoker' 폴백 방은 오목으로 동작한다", mv.color === 'black', mv);

    // 게임 바꾸기 대상에서도 사라졌다
    bm.length = 0;
    send(a, { type: 'gameChangeRequest', game: 'matpoker' });
    await wait(120);
    assert("게임 바꾸기: 'matpoker' 요청은 상대에게 전달되지 않는다",
      !bm.some((m) => m.type === 'gameChangeRequest'), bm.map((m) => m.type));

    // 뒤늦은 수락이 와도 종목이 바뀌지 않는다 (대기 중인 요청이 없다)
    am.length = 0; bm.length = 0;
    send(b, { type: 'gameChangeResponse', accept: true });
    await wait(120);
    assert("게임 바꾸기: 'matpoker' 수락도 무시된다",
      !am.some((m) => m.type === 'gameChanged') && !bm.some((m) => m.type === 'gameChanged'));

    a.close(); b.close();
    await wait(60);
  }

  // ============================================================
  // 포커 테이블 방 (2~6인)
  // ============================================================
  // n명이 앉은 포커 방을 만든다 (첫 번째가 방장 = 좌석 0)
  async function pokerTable(n, game) {
    const host = await open();
    const hm = collect(host);
    send(host, { type: 'create', game: game || 'poker' });
    const cr = await until(hm, (m) => m.type === 'created');
    const cl = [{ ws: host, box: hm, seat: cr.seat }];
    for (let i = 1; i < n; i++) {
      const w = await open();
      const box = collect(w);
      send(w, { type: 'join', code: cr.code });
      const jn = await until(box, (m) => m.type === 'joined');
      cl.push({ ws: w, box: box, seat: jn.seat });
    }
    // 마지막 입장이 전원에게 반영될 때까지 대기
    for (const c of cl) await until(c.box, (m) => m.type === 'tableLobby' && m.players.length === n);
    return { code: cr.code, created: cr, cl: cl };
  }
  const lastOf = (box, type) => {
    for (let i = box.length - 1; i >= 0; i--) if (box[i].type === type) return box[i];
    return null;
  };
  const seatView = (c) => { const m = lastOf(c.box, 'pokerState'); return m ? m.view : null; };
  // 공개 정보(팟/차례/단계)는 어느 좌석의 뷰에서 읽어도 같다
  const curView = (cl) => { for (const c of cl) { const v = seatView(c); if (v) return v; } return null; };
  // 좌석 seat 의 액션을 보내고 전원이 새 상태를 받을 때까지 기다린다
  async function tableAct(cl, seat, action) {
    const who = cl.find((c) => c.seat === seat);
    cl.forEach((c) => { c.box.length = 0; });
    send(who.ws, { type: 'pokerAction', action: action });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');
  }
  // 매장/오픈 단계를 전원이 통과하도록 진행
  async function tablePrepare(cl) {
    let v = seatView(cl[0]);
    for (const c of cl) {
      if (v.hands[c.seat].cards.length === 4) await tableAct(cl, c.seat, { type: 'discard', index: 0 });
    }
    for (const c of cl) {
      const cur = seatView(cl[0]);
      const has = cur.hands[c.seat].cards.some((x) => x && x.open);
      if (!has && !cur.folded[c.seat]) await tableAct(cl, c.seat, { type: 'open', index: 0 });
    }
  }

  // 36. 로비: 생성 / 참가 / 방장 / 시작 조건
  {
    const a = await open();
    const am = collect(a);
    send(a, { type: 'create', game: 'poker' });
    const cr = await until(am, (m) => m.type === 'created');
    assert('포커 방 생성: 좌석 0 + 방장 + 정원 6',
      cr.game === 'poker' && cr.seat === 0 && cr.isHost === true && cr.capacity === 6, cr);
    const lb1 = await until(am, (m) => m.type === 'tableLobby');
    assert('포커 로비: 생성 직후 1명 + 시작 불가',
      lb1.players.length === 1 && lb1.players[0].name === '플레이어 1' &&
      lb1.players[0].isHost === true && lb1.players[0].chips === 1000 &&
      lb1.canStart === false && lb1.started === false, lb1);

    am.length = 0;
    send(a, { type: 'startMatch' });
    const e1 = await until(am, (m) => m.type === 'error');
    assert('포커: 혼자서는 시작할 수 없다', e1.message === '2명 이상이어야 시작할 수 있습니다', e1);

    // B, C 입장 → 매번 전원에게 로비가 방송된다
    const b = await open(); const bm = collect(b);
    am.length = 0;
    send(b, { type: 'join', code: cr.code });
    const jb = await until(bm, (m) => m.type === 'joined');
    assert('포커 참가: 다음 빈 좌석 배정', jb.seat === 1 && jb.isHost === false, jb);
    const lb2a = await until(am, (m) => m.type === 'tableLobby' && m.players.length === 2);
    assert('포커 로비 방송: 기존 인원에게도 전달 + 2명이면 시작 가능',
      lb2a.canStart === true && lb2a.notice === '플레이어 2 님이 입장했습니다', lb2a);

    const c = await open(); const cm = collect(c);
    am.length = 0; bm.length = 0;
    send(c, { type: 'join', code: cr.code });
    await until(cm, (m) => m.type === 'joined');
    const lb3a = await until(am, (m) => m.type === 'tableLobby' && m.players.length === 3);
    const lb3b = await until(bm, (m) => m.type === 'tableLobby' && m.players.length === 3);
    assert('포커 로비: 3명 목록이 모두에게 동일하게 전달',
      JSON.stringify(lb3a.players) === JSON.stringify(lb3b.players) &&
      lb3a.players.map((p) => p.seat).join(',') === '0,1,2' &&
      lb3a.hostSeat === 0, lb3a.players);

    // 방장이 아닌 사람은 시작할 수 없다
    bm.length = 0;
    send(b, { type: 'startMatch' });
    const e2 = await until(bm, (m) => m.type === 'error');
    assert('포커: 방장이 아니면 시작 거부', e2.message === '방장만 시작할 수 있습니다', e2);

    // 방장이 시작 → 전원에게 자기 시점 뷰
    am.length = 0; bm.length = 0; cm.length = 0;
    send(a, { type: 'startMatch' });
    const pa = await until(am, (m) => m.type === 'pokerState');
    const pb = await until(bm, (m) => m.type === 'pokerState');
    const pc = await until(cm, (m) => m.type === 'pokerState');
    assert('포커 시작: 좌석별 뷰 + 3인 앤티 30',
      pa.seat === 0 && pb.seat === 1 && pc.seat === 2 &&
      pa.view.players === 3 && pa.view.pot === 30 &&
      pa.view.chips.join(',') === '990,990,990' && pa.view.phase === 'discard', pa.view.chips);
    assert('포커 시작: 각자 4장 + 딜러 0',
      pa.view.hands.every((h) => h.cards.length === 4) && pa.view.dealer === 0);
    const masked = [[pa, 0], [pb, 1], [pc, 2]].every(([m, seat]) =>
      m.view.hands[seat].cards.every((x) => x && x.r) &&
      [0, 1, 2].filter((j) => j !== seat)
        .every((j) => m.view.hands[j].cards.every((x) => x === null) &&
          m.view.hands[j].buried === null));
    assert('포커 마스킹: 각자 자기 카드만 보인다 (3인 전부)', masked);
    assert('포커 마스킹: 덱은 전송되지 않는다', pa.view.deck === undefined);
    const lbs = await until(am, (m) => m.type === 'tableLobby' && m.started === true);
    assert('포커 시작 후 로비: started=true / 추가 시작 불가', lbs.canStart === false);

    // 시작 후 입장 거부
    const d = await open(); const dm = collect(d);
    send(d, { type: 'join', code: cr.code });
    const e3 = await until(dm, (m) => m.type === 'error');
    assert('포커: 시작된 방에는 입장할 수 없다', e3.message === '이미 시작된 방입니다', e3);
    d.close();

    // 이미 시작된 방에서 방장이 다시 시작 요청 → 거부
    am.length = 0;
    send(a, { type: 'startMatch' });
    const e4 = await until(am, (m) => m.type === 'error');
    assert('포커: 진행 중 재시작 거부', e4.message === '이미 시작된 방입니다', e4);

    a.close(); b.close(); c.close();
    await wait(80);
  }

  // 37. 정원(6인) 초과 입장 거부
  {
    const t = await pokerTable(6);
    const lb = lastOf(t.cl[0].box, 'tableLobby');
    assert('포커: 6인까지 착석', lb.players.length === 6 &&
      lb.players.map((p) => p.seat).join(',') === '0,1,2,3,4,5', lb.players.length);
    const x = await open(); const xm = collect(x);
    send(x, { type: 'join', code: t.code });
    const e = await until(xm, (m) => m.type === 'error');
    assert('포커: 정원이 차면 입장 거부', e.message === '방이 가득 찼습니다', e);
    x.close();
    t.cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // 38. 4인 한 판 전체: 순서 강제 / 마스킹 / 쇼다운 칩 정산
  {
    const t = await pokerTable(4);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');
    assert('포커 4인: 앤티 40', seatView(cl[0]).pot === 40);

    await tablePrepare(cl);
    let v = seatView(cl[0]);
    assert('포커 4인: 전원 매장/오픈 후 1라운드 베팅',
      v.phase === 'bet' && v.round === 1 && v.toAct !== null, v.phase);

    // 차례가 아닌 좌석의 액션은 거부된다
    const wrong = cl.find((c) => c.seat !== v.toAct);
    wrong.box.length = 0;
    send(wrong.ws, { type: 'pokerAction', action: { type: 'check' } });
    const inv = await until(wrong.box, (m) => m.type === 'invalid');
    assert('포커: 차례가 아닌 좌석의 액션 거부',
      inv.reason === 'poker' && inv.message === '당신의 차례가 아닙니다', inv);
    assert('포커: 거부된 액션은 브로드캐스트되지 않는다',
      !wrong.box.some((m) => m.type === 'pokerState'));

    // 전원 체크로 4라운드를 통과 → 쇼다운
    let guard = 0;
    const order = [];
    while (guard++ < 40) {
      v = curView(cl);
      if (v.over || v.phase !== 'bet') break;
      if (v.round === 1) order.push(v.toAct);
      await tableAct(cl, v.toAct, { type: 'check' });
    }
    assert('포커 4인: 1라운드는 선부터 시계방향 4명',
      order.length === 4 &&
      order.every((s, i) => i === 0 || s === (order[i - 1] + 1) % 4), order);

    // 쇼다운 직전까지 다른 좌석의 히든이 보이면 안 된다 (라운드별로 확인해 왔다)
    const end = cl.map((c) => seatView(c));
    assert('포커 4인: 쇼다운 도달 (팟 40)',
      end[0].over === true && end[0].phase === 'showdown' && end[0].result.amount === 40,
      end[0].result);
    assert('포커 4인: 쇼다운에서 폴드하지 않은 좌석의 패가 전원에게 공개',
      end.every((v2) => v2.hands.every((h) => h.cards.every((x) => x && x.r))));
    assert('포커 4인: 매장 카드는 쇼다운 후에도 자기 것만 보인다',
      end.every((v2, i) => v2.hands.every((h, j) => (j === i) === (h.buried !== null))));
    const chips = end[0].chips;
    assert('포커 4인: 칩 총량 보존 (4000)',
      chips.reduce((x, y) => x + y, 0) === 4000, chips);
    assert('포커 4인: 팟 40 이 승자(들)에게 정확히 분배',
      end[0].result.payouts.reduce((x, y) => x + y, 0) === 40 &&
      end[0].result.payouts.every((p, i) => chips[i] === 990 + p), end[0].result.payouts);
    assert('포커 4인: 모든 좌석의 뷰에서 칩/팟이 동일',
      end.every((v2) => v2.chips.join(',') === chips.join(',') && v2.pot === 0));

    // 다음 판: 딜러 이동 + 칩 승계
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[2].ws, { type: 'pokerAction', action: { type: 'nextHand' } });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState' && m.view.handNo === 2);
    const n2 = seatView(cl[0]);
    assert('포커 4인: 다음 판은 누구나 시작 가능 + 딜러 이동(0 → 1)',
      n2.dealer === 1 && n2.pot === 40 && n2.handNo === 2 &&
      n2.chips.every((x, i) => x === chips[i] - 10), n2.chips);
    cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // 39. 진행 중 퇴장: 자동 다이 + 남은 사람들끼리 계속 / 방장 승계 / 혼자 남으면 로비
  {
    const t = await pokerTable(3);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');
    await tablePrepare(cl);
    assert('포커 퇴장 테스트: 베팅 단계 진입', seatView(cl[0]).phase === 'bet');

    // 좌석 2 가 접속을 끊는다
    cl[0].box.length = 0; cl[1].box.length = 0;
    cl[2].ws.close();
    const afterA = await until(cl[0].box, (m) => m.type === 'pokerState' && m.view.left[2] === true);
    await until(cl[1].box, (m) => m.type === 'pokerState' && m.view.left[2] === true);
    assert('포커 퇴장: 자동 다이 + 퇴장 표시 + 칩 제거',
      afterA.view.folded[2] === true && afterA.view.chips[2] === 0 &&
      afterA.view.over === false, afterA.view.chips);
    const nt = await until(cl[0].box, (m) => m.type === 'tableNotice');
    assert('포커 퇴장: 남은 사람에게 퇴장 알림',
      nt.text === '플레이어 3 님이 퇴장했습니다', nt);
    const lb = await until(cl[0].box, (m) => m.type === 'tableLobby');
    assert('포커 퇴장: 로비 목록에서 제거 (2명)',
      lb.players.length === 2 && lb.started === true, lb.players);
    assert('포커 퇴장: 퇴장 좌석은 액션 순서에서 빠진다',
      afterA.view.toAct !== 2 && afterA.view.toAct !== null);

    // 남은 두 명이 판을 마친다
    let guard = 0;
    while (guard++ < 40) {
      const v = curView(cl.slice(0, 2));
      if (v.over || v.phase !== 'bet') break;
      await tableAct(cl.slice(0, 2), v.toAct, { type: 'check' });
    }
    const fin = seatView(cl[0]);
    assert('포커 퇴장 후에도 판이 정상적으로 끝난다',
      fin.over === true && fin.result.amount === 30 &&
      fin.chips[0] + fin.chips[1] === 2010, fin.chips);

    // 방장(좌석 0) 퇴장 → 남은 최소 좌석이 방장
    cl[1].box.length = 0;
    cl[0].ws.close();
    const mig = await until(cl[1].box, (m) => m.type === 'tableNotice' && /방장/.test(m.text));
    assert('포커: 방장이 나가면 남은 최소 좌석이 방장이 된다',
      mig.text === '플레이어 2 님이 방장이 되었습니다', mig);
    const alone = await until(cl[1].box, (m) => m.type === 'tableLobby' && m.started === false);
    assert('포커: 혼자 남으면 로비 상태로 복귀 + 안내',
      alone.notice === '혼자 남아 로비로 돌아왔습니다' &&
      alone.canStart === false && alone.players.length === 1 &&
      alone.hostSeat === alone.players[0].seat, alone);
    cl[1].ws.close();
    await wait(80);
  }

  // 40. 채팅 / 게임·돌 바꾸기 차단
  {
    const t = await pokerTable(3);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[2].ws, { type: 'chat', text: '안녕하세요' });
    const ch0 = await until(cl[0].box, (m) => m.type === 'chat');
    const ch2 = await until(cl[2].box, (m) => m.type === 'chat');
    assert('포커 채팅: 좌석 이름으로 전원에게 전달',
      ch0.text === '안녕하세요' && ch0.from === '플레이어 3' && ch0.seat === 2 &&
      ch2.from === '플레이어 3', ch0);

    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'gameChangeRequest', game: 'omok' });
    send(cl[0].ws, { type: 'swapRequest' });
    send(cl[0].ws, { type: 'restartRequest' });
    send(cl[0].ws, { type: 'undoRequest' });
    await wait(120);
    assert('포커 테이블 방은 게임/돌 바꾸기·무르기·재대국 요청을 무시한다',
      !cl.some((c) => c.box.some((m) =>
        ['gameChangeRequest', 'swapRequest', 'restartRequest', 'undoRequest', 'gameChanged'].indexOf(m.type) !== -1)));
    // 2인 방에서는 포커로 바꿀 수 없다 (테이블 방이라 좌석 구조가 다르다)
    const duo = await omokRoom();
    duo.wm.length = 0;
    send(duo.black, { type: 'gameChangeRequest', game: 'poker' });
    await wait(120);
    assert('2인 방: 포커로의 게임 변경 요청은 무시된다',
      !duo.wm.some((m) => m.type === 'gameChangeRequest'));
    duo.black.close(); duo.white.close();
    cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // 41. 최종 우승 + 새 경기 (방장 전용, 칩 리셋, 좌석 유지)
  {
    const t = await pokerTable(2);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');

    // 한쪽이 파산할 때까지: 가능한 한 크게 베팅(하프) → 못 하면 콜 → 체크
    let guard = 0;
    while (guard++ < 400) {
      const v = seatView(cl[0]);
      if (v.matchOver) break;
      if (v.over) { await tableAct(cl, 0, { type: 'nextHand' }); continue; }
      if (v.phase === 'discard') {
        const s = v.hands.findIndex((h) => h.cards.length === 4);
        await tableAct(cl, s, { type: 'discard', index: 0 });
        continue;
      }
      if (v.phase === 'open') {
        const s = v.hands.findIndex((h) => h.cards.length === 3 && !h.cards.some((x) => x && x.open));
        await tableAct(cl, s, { type: 'open', index: 0 });
        continue;
      }
      if (v.phase === 'bet') {
        const me = cl.find((c) => c.seat === v.toAct);
        const opts = seatView(me).options;
        const pick = ['half', 'call', 'check'].find((tp) =>
          opts.some((o) => o.type === tp && o.enabled));
        await tableAct(cl, v.toAct, { type: pick });
        continue;
      }
      break;
    }
    const over = seatView(cl[0]);
    assert('포커 2인 테이블: 한쪽 파산 → 매치 종료 + 최종 우승자',
      over.matchOver === true && (over.matchWinner === 0 || over.matchWinner === 1) &&
      over.chips[over.matchWinner] === 2000 &&
      over.chips[over.matchWinner === 0 ? 1 : 0] === 0, over.chips);
    const lbEnd = lastOf(cl[0].box, 'tableLobby');
    assert('포커: 매치 종료 후 새 경기 가능 상태', lbEnd.canStart === true, lbEnd);

    // 방장이 아닌 사람의 새 경기 요청은 거부
    cl[1].box.length = 0;
    send(cl[1].ws, { type: 'newMatch' });
    const e = await until(cl[1].box, (m) => m.type === 'error');
    assert('포커: 새 경기도 방장 전용', e.message === '방장만 시작할 수 있습니다', e);

    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'newMatch' });
    const fresh0 = await until(cl[0].box, (m) => m.type === 'pokerState' && m.view.handNo === 1);
    const fresh1 = await until(cl[1].box, (m) => m.type === 'pokerState' && m.view.handNo === 1);
    assert('포커 새 경기: 칩 1000 리셋 + 1판부터 + 좌석 유지',
      fresh0.seat === 0 && fresh1.seat === 1 &&
      fresh0.view.chips.join(',') === '990,990' && fresh0.view.matchOver === false &&
      fresh0.view.dealer === 0, fresh0.view.chips);
    cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // ============================================================
  // 42. 포커 2인(헤즈업) — 옛 '맞포커' 를 그대로 대신한다.
  //     한 판 전체를 회선 위에서 검증한다.
  //     핵심 보안 성질: 쇼다운 전에는 상대 히든 카드가 반드시 null 이다.
  // ============================================================
  {
    const t = await pokerTable(2);
    const cl = t.cl;
    const A = cl[0], B = cl[1];
    assert('포커 2인: 좌석 0(방장·첫 딜러) / 좌석 1',
      A.seat === 0 && B.seat === 1 && t.created.isHost === true, t.created);
    cl.forEach((c) => { c.box.length = 0; });
    send(A.ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');
    const sa = lastOf(A.box, 'pokerState');
    const sb = lastOf(B.box, 'pokerState');
    assert('포커 2인: 좌석별 뷰 + 방장이 첫 딜러',
      sa.seat === 0 && sb.seat === 1 && sa.view.dealer === 0, { a: sa.seat, b: sb.seat });
    assert('포커 2인: 앤티 자동 + 팟 20 + 칩 990',
      sa.view.players === 2 && sa.view.pot === 20 && sa.view.chips.join(',') === '990,990',
      sa.view.chips);
    assert('포커 2인: 4장씩 배분 + discard 단계',
      sa.view.phase === 'discard' &&
      sa.view.hands[0].cards.length === 4 && sa.view.hands[1].cards.length === 4);
    assert('포커 2인 마스킹: 내 카드는 전부 보인다',
      sa.view.hands[0].cards.every((c) => c && c.r >= 2 && c.r <= 14));
    assert('포커 2인 마스킹: 상대 히든 카드는 전부 null (양쪽 모두)',
      sa.view.hands[1].cards.every((c) => c === null) &&
      sb.view.hands[0].cards.every((c) => c === null),
      { a: sa.view.hands[1].cards, b: sb.view.hands[0].cards });
    assert('포커 2인 마스킹: 덱은 전송되지 않는다',
      sa.view.deck === undefined && sb.view.deck === undefined && sa.view.deckLeft === 44);
    assert('포커 2인 마스킹: 상대 매장 카드 자리도 비어 있다',
      sa.view.hands[1].buried === null && sb.view.hands[0].buried === null);

    // 매장 -> 오픈
    await tableAct(cl, 0, { type: 'discard', index: 0 });
    assert('포커 2인: 한쪽만 버려도 아직 discard 단계',
      curView(cl).phase === 'discard' && curView(cl).hands[0].cards.length === 3);
    await tableAct(cl, 1, { type: 'discard', index: 0 });
    const ad = lastOf(A.box, 'pokerState');
    assert('포커 2인: 매장 후 3장 + open 단계',
      ad.view.phase === 'open' &&
      ad.view.hands[0].cards.length === 3 && ad.view.hands[1].cards.length === 3);
    assert('포커 2인: 내 매장 카드는 나에게만 보인다',
      ad.view.hands[0].buried && ad.view.hands[0].buried.r >= 2 &&
      ad.view.hands[1].buried === null);

    await tableAct(cl, 0, { type: 'open', index: 0 });
    await tableAct(cl, 1, { type: 'open', index: 0 });
    const betA = lastOf(A.box, 'pokerState');
    const betB = lastOf(B.box, 'pokerState');
    assert('포커 2인: 오픈 후 1라운드 베팅 시작',
      betA.view.phase === 'bet' && betA.view.round === 1 && betA.view.toAct !== null);
    assert('포커 2인: 오픈 카드는 상대에게 보인다 (나머지 2장은 null)',
      betA.view.hands[1].cards.filter((c) => c && c.open).length === 1 &&
      betA.view.hands[1].cards.filter((c) => c === null).length === 2);
    assert('포커 2인: 양쪽 뷰의 팟/칩은 동일',
      betA.view.pot === betB.view.pot &&
      betA.view.chips.join(',') === betB.view.chips.join(','));
    const first = betA.view.toAct;
    const firstC = cl.find((c) => c.seat === first);
    const secondC = cl.find((c) => c.seat !== first);
    const opts = seatView(firstC).options;
    assert('포커 2인: 액션 목록(하프 금액 = 콜 + 팟/2)',
      opts.length === 6 && opts.find((o) => o.type === 'half').amount === 10, opts);
    assert('포커 2인: 차례가 아닌 좌석의 뷰에는 액션이 없다',
      seatView(secondC).options.every((o) => o.enabled === false));

    // 턴 강제: 차례가 아닌 쪽의 액션은 거부된다
    secondC.box.length = 0;
    send(secondC.ws, { type: 'pokerAction', action: { type: 'check' } });
    const inv = await until(secondC.box, (m) => m.type === 'invalid');
    assert('포커 2인: 차례가 아닌 좌석의 액션 거부',
      inv.reason === 'poker' && inv.message === '당신의 차례가 아닙니다', inv);
    assert('포커 2인: 거부된 액션은 브로드캐스트되지 않는다',
      !secondC.box.some((m) => m.type === 'pokerState'));

    // 베팅 산식 + 로그 동기화
    await tableAct(cl, first, { type: 'bbing' });
    const p1 = lastOf(A.box, 'pokerState');
    const p1b = lastOf(B.box, 'pokerState');
    assert('포커 2인: 삥 10 → 팟 30', p1.view.pot === 30 && p1b.view.pot === 30);
    assert('포커 2인: 액션 로그가 양쪽에 동일하게 간다',
      JSON.stringify(p1.events) === JSON.stringify(p1b.events) &&
      p1.events.some((e) => e.t === 'act' && e.action === 'bbing' && e.amount === 10),
      p1.events);

    // 다이 → 상대가 팟을 가져가고, 패는 공개되지 않는다
    await tableAct(cl, secondC.seat, { type: 'die' });
    const endA = lastOf(A.box, 'pokerState');
    const endB = lastOf(B.box, 'pokerState');
    assert('포커 2인: 다이 → 베팅한 쪽이 팟 30 획득',
      endA.view.over === true && endA.view.result.winner === first &&
      endA.view.result.amount === 30 && endA.view.result.folded === secondC.seat,
      endA.view.result);
    assert('포커 2인: 다이는 패를 공개하지 않는다 (히든 여전히 null)',
      endA.view.result.revealed === false &&
      endA.view.hands[1].cards.some((c) => c === null) &&
      endB.view.hands[0].cards.some((c) => c === null));
    assert('포커 2인: 칩 정산 (승자 1010 / 패자 990)',
      endA.view.chips[first] === 1010 && endA.view.chips[secondC.seat] === 990,
      endA.view.chips);

    // 다음 판: 누가 보내도 되고, 두 번 보내도 한 판만 시작된다(멱등)
    cl.forEach((c) => { c.box.length = 0; });
    send(B.ws, { type: 'pokerAction', action: { type: 'nextHand' } });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState' && m.view.handNo === 2);
    const n1 = lastOf(A.box, 'pokerState');
    assert('포커 2인 다음 판: 딜러 교대 + 칩 승계 + 재앤티',
      n1.view.dealer === 1 && n1.view.handNo === 2 && n1.view.pot === 20 &&
      n1.view.chips[first] === 1000 && n1.view.phase === 'discard',
      { d: n1.view.dealer, c: n1.view.chips });
    A.box.length = 0;
    send(A.ws, { type: 'pokerAction', action: { type: 'nextHand' } });
    await wait(120);
    assert('포커 2인 다음 판 요청 멱등 (진행 중이면 무시)',
      !A.box.some((m) => m.type === 'pokerState'), A.box.map((m) => m.type));

    cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // ============================================================
  // 43. 포커 2인: 쇼다운까지 진행 — 칩이 판을 넘어 이어지고,
  //     쇼다운 순간에만 상대 히든 카드가 공개된다.
  //     이어서 상대 퇴장 → 남은 사람이 팟을 가져가고 로비로 돌아간다.
  // ============================================================
  {
    const t = await pokerTable(2);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');
    await tablePrepare(cl);

    // 4개 베팅 라운드를 전부 체크로 넘긴다 (팟 20 유지)
    let guard = 0;
    while (guard++ < 40) {
      const v = curView(cl);
      if (v.over || v.phase !== 'bet') break;
      await tableAct(cl, v.toAct, { type: 'check' });
    }
    const endA = seatView(cl[0]);
    const endB = seatView(cl[1]);
    assert('포커 2인: 쇼다운 도달 (팟 20, 체크로만 진행)',
      endA.over === true && endA.phase === 'showdown' && endA.result.amount === 20,
      endA.result);
    assert('포커 2인: 각자 6장 보유 (7장 받아 1장 매장)',
      endA.hands[0].cards.length === 6 && endA.hands[1].cards.length === 6);
    assert('포커 2인: 쇼다운에서 상대 히든 카드 공개',
      endA.hands[1].cards.every((c) => c && c.r) &&
      endB.hands[0].cards.every((c) => c && c.r));
    assert('포커 2인: 쇼다운 후에도 매장 카드는 비공개',
      endA.hands[1].buried === null && endB.hands[0].buried === null);
    assert('포커 2인: 쇼다운 결과에 양쪽 족보 포함',
      endA.result.hands[0] && endA.result.hands[1] &&
      typeof endA.result.hands[0].cat === 'number');
    const chips = endA.chips;
    assert('포커 2인: 칩 총량 보존 (2000)', chips[0] + chips[1] === 2000, chips);
    const winner = endA.result.split ? null : endA.result.winner;
    assert('포커 2인: 승자에게 팟 지급',
      endA.result.split ? (chips[0] === 1000 && chips[1] === 1000)
        : (chips[winner] === 1010), { w: winner, chips: chips });

    // 다음 판에서 칩이 이어진다
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[1].ws, { type: 'pokerAction', action: { type: 'nextHand' } });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState' && m.view.handNo === 2);
    const n = seatView(cl[0]);
    assert('포커 2인: 판을 넘겨도 칩이 이어진다 (앤티 10 차감)',
      n.chips[0] === chips[0] - 10 && n.chips[1] === chips[1] - 10, n.chips);

    // 상대 퇴장: 진행 중이던 판은 남은 사람이 팟을 가져간다
    cl[0].box.length = 0;
    cl[1].ws.close();
    const fin = await until(cl[0].box, (m) => m.type === 'pokerState' && m.view.over === true);
    assert('포커 2인: 상대 퇴장 → 남은 사람이 팟 획득',
      fin.view.result.winner === 0 && fin.view.result.amount === 20 &&
      fin.view.chips[0] === n.chips[0] + 20 && fin.view.left[1] === true,
      fin.view.chips);
    const alone = await until(cl[0].box, (m) => m.type === 'tableLobby' && m.started === false);
    assert('포커 2인: 혼자 남으면 로비 상태로 복귀',
      alone.notice === '혼자 남아 로비로 돌아왔습니다' && alone.players.length === 1,
      alone);
    cl[0].ws.close();
    await wait(80);
  }

  // ============================================================
  // 인디언포커 테이블 방 (2~6인)
  //   포커와 같은 테이블 방 코드 경로를 쓰되, 마스킹이 정반대다.
  //   "내 카드만 안 보이고 남의 카드는 다 보인다" 를 회선 위에서 검증한다.
  // ============================================================
  const indianTable = (n) => pokerTable(n, 'indian');
  // 좌석 seat 의 카드 값 — "다른 좌석의 뷰" 에서 읽는다 (그 좌석 본인은 못 본다)
  function peekCard(cl, seat) {
    for (const c of cl) {
      if (c.seat === seat) continue;
      const v = seatView(c);
      const card = v && v.hands[seat] && v.hands[seat].cards[0];
      if (card) return card.r;
    }
    return null;
  }
  // 전 좌석의 카드 값 (테스트는 전지적 시점을 조립할 수 있다)
  const peekAll = (cl) => cl.map((c) => peekCard(cl, c.seat));

  // 44. 로비 / 시작 / 좌석별 역마스킹
  {
    const t = await indianTable(3);
    const cl = t.cl;
    assert('인디언포커 방 생성: 테이블 방(좌석 0 · 방장 · 정원 6)',
      t.created.game === 'indian' && t.created.seat === 0 &&
      t.created.isHost === true && t.created.capacity === 6, t.created);
    const lb = lastOf(cl[0].box, 'tableLobby');
    assert('인디언포커 로비: 3명 · 시작 가능',
      lb.players.length === 3 && lb.canStart === true && lb.started === false, lb);

    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');
    const v0 = seatView(cl[0]);
    assert('인디언포커 시작: 앤티 30 · 각자 1장 · 바로 베팅',
      v0.pot === 30 && v0.chips.join(',') === '990,990,990' &&
      v0.hands.every((h) => h.cards.length === 1) &&
      v0.phase === 'bet' && v0.round === 1, v0.phase);
    assert('인디언포커: 선은 딜러(0) 왼쪽 좌석', v0.dealer === 0 && v0.toAct === 1);

    // 역마스킹: 내 카드만 null, 남의 카드는 값이 보인다
    const maskOk = cl.every((c) => {
      const v = seatView(c);
      if (v.hands[c.seat].cards[0] !== null) return false;
      return cl.every((o) => o.seat === c.seat ||
        (v.hands[o.seat].cards[0] && typeof v.hands[o.seat].cards[0].r === 'number'));
    });
    assert('인디언포커 마스킹: 내 카드만 null · 남의 카드는 전부 보인다 (3인 전부)', maskOk);
    assert('인디언포커: 덱은 전송되지 않는다', v0.deck === undefined && v0.deckLeft === 17);

    // 회선 위 원문 검사: 내 카드 값이 담긴 카드 객체가 아예 오지 않는다.
    // 카드 값은 JSON 에서 항상 {"r":N} 꼴이므로 이 부분 문자열만 보면 정확하다.
    // (같은 숫자를 상대가 들고 있으면 그 값은 정당하게 등장하므로 그때는
    //  자리 기준 검사만 한다 — 덱에 같은 숫자가 두 장씩 있기 때문이다)
    const all = peekAll(cl);
    let strict = 0, positional = 0;
    cl.forEach((c) => {
      const mine = all[c.seat];
      const raw = c.box.map((m) => JSON.stringify(m)).join('|');
      const twin = all.some((v, i) => i !== c.seat && v === mine);
      if (!twin) { if (raw.indexOf('"r":' + mine) === -1) strict++; }
      else if (c.box.every((m) => !m.view || m.view.hands[c.seat].cards[0] === null)) positional++;
    });
    assert('인디언포커: 판 종료 전 내 카드 값은 회선에 실려 오지 않는다',
      strict + positional === 3, { strict, positional, all });
    assert('인디언포커: 로그(전원 방송)에는 카드 값이 없다',
      cl.every((c) => c.box.every((m) => (m.events || []).every((e) =>
        e.card === undefined && e.cards === undefined))));

    // 차례가 아닌 좌석의 액션은 거부된다
    const wrong = cl.find((c) => c.seat !== v0.toAct);
    wrong.box.length = 0;
    send(wrong.ws, { type: 'pokerAction', action: { type: 'check' } });
    const inv = await until(wrong.box, (m) => m.type === 'invalid');
    assert('인디언포커: 차례가 아닌 좌석의 액션 거부',
      inv.reason === 'poker' && inv.message === '당신의 차례가 아닙니다', inv);
    assert('인디언포커: 거부된 액션은 브로드캐스트되지 않는다',
      !wrong.box.some((m) => m.type === 'pokerState'));

    // 시작 후 입장 거부
    const late = await open(); const lm = collect(late);
    send(late, { type: 'join', code: t.code });
    const e = await until(lm, (m) => m.type === 'error');
    assert('인디언포커: 시작된 방에는 입장할 수 없다', e.message === '이미 시작된 방입니다', e);
    late.close();

    // 한 판 완주: 삥 → 콜 → 콜 → 쇼다운
    await tableAct(cl, 1, { type: 'bbing' });
    assert('인디언포커: 삥 10 → 팟 40', curView(cl).pot === 40);
    await tableAct(cl, 2, { type: 'call' });
    await tableAct(cl, 0, { type: 'call' });
    const end = cl.map((c) => seatView(c));
    const best = Math.max.apply(null, all);
    assert('인디언포커: 전원 콜 → 쇼다운 (팟 60)',
      end[0].over === true && end[0].phase === 'showdown' && end[0].result.amount === 60,
      end[0].result);
    assert('인디언포커 쇼다운: 전원이 모든 카드를 본다 (자기 카드 포함)',
      end.every((v) => v.hands.every((h, i) => h.cards[0] && h.cards[0].r === all[i])),
      all);
    assert('인디언포커 쇼다운: 가장 높은 숫자가 이긴다',
      end[0].result.payouts.every((p, i) => p === 0 || all[i] === best) &&
      end[0].result.payouts.reduce((x, y) => x + y, 0) === 60, {
        cards: all, payouts: end[0].result.payouts
      });
    assert('인디언포커: 칩 정산 + 총량 보존',
      end[0].chips.every((c2, i) => c2 === 980 + end[0].result.payouts[i]) &&
      end[0].chips.reduce((x, y) => x + y, 0) === 3000, end[0].chips);
    assert('인디언포커: 모든 좌석의 뷰가 동일한 칩/팟을 본다',
      end.every((v) => v.pot === 0 && v.chips.join(',') === end[0].chips.join(',')));

    cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // 45. 10 폴드 벌칙 (10 이 나올 때까지 판을 돌려 실제로 재현한다)
  {
    const t = await indianTable(3);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');

    let done = null, guard = 0;
    while (guard++ < 40 && !done) {
      const cards = peekAll(cl);
      const ten = cards.indexOf(10);
      const before = seatView(cl[0]).chips.slice();
      if (ten === -1) {
        // 10 이 없는 판은 전원 체크로 빨리 끝내고 다음 판으로
        let g2 = 0;
        while (g2++ < 10) {
          const v = curView(cl);
          if (v.over || v.phase !== 'bet') break;
          await tableAct(cl, v.toAct, { type: 'check' });
        }
      } else {
        let g2 = 0;
        while (g2++ < 10) {
          const v = curView(cl);
          if (v.over || v.phase !== 'bet') break;
          await tableAct(cl, v.toAct, { type: v.toAct === ten ? 'die' : 'check' });
        }
        done = { ten: ten, before: before, cards: cards, view: seatView(cl[0]) };
        break;
      }
      const v = seatView(cl[0]);
      if (v.matchOver) break;
      await tableAct(cl, 0, { type: 'nextHand' });
    }

    assert('인디언포커: 10 을 든 좌석이 다이하는 판을 재현했다', !!done, guard);
    if (done) {
      const v = done.view;
      const pen = v.result.penalties;
      assert('인디언포커 벌칙: 10 을 들고 다이 → 벌금 10',
        pen.length === 1 && pen[0].p === done.ten && pen[0].amount === 10, pen);
      assert('인디언포커 벌칙: 벌금이 팟에 더해진 뒤 지급된다 (30 + 10 = 40)',
        v.result.amount === 40 &&
        v.result.payouts.reduce((x, y) => x + y, 0) === 40, v.result);
      // done.before 는 "앤티까지 낸 뒤" 의 칩이다 (판이 시작될 때 이미 앤티가 빠진다)
      assert('인디언포커 벌칙: 다이한 좌석은 앤티 10 + 벌금 10 을 낸다',
        v.chips[done.ten] === done.before[done.ten] - 10 &&
        v.committed[done.ten] === 20, {
          before: done.before, after: v.chips, committed: v.committed, ten: done.ten
        });
      assert('인디언포커 벌칙: 칩 총량은 보존된다 (3인 x 1000)',
        v.pot === 0 && v.chips.reduce((x, y) => x + y, 0) === 3000, v.chips);
      assert('인디언포커 벌칙: 로그로 전원에게 공개된다',
        cl.every((c) => c.box.some((m) => (m.events || []).some((e) =>
          e.t === 'penalty' && e.p === done.ten && e.card === 10))));
      assert('인디언포커 벌칙: 벌금을 낸 본인은 자기 카드를 알게 된다',
        seatView(cl.find((c) => c.seat === done.ten)).hands[done.ten].cards[0].r === 10);
    }
    cl.forEach((c) => c.ws.close());
    await wait(80);
  }

  // 46. 진행 중 퇴장 / 채팅 / 2인 방 종목 변경 차단
  {
    const t = await indianTable(3);
    const cl = t.cl;
    cl.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'startMatch' });
    for (const c of cl) await until(c.box, (m) => m.type === 'pokerState');

    cl[0].box.length = 0; cl[1].box.length = 0;
    cl[2].ws.close();
    const after = await until(cl[0].box, (m) => m.type === 'pokerState' && m.view.left[2] === true);
    assert('인디언포커 퇴장: 자동 다이 + 칩 제거 + 남은 사람끼리 계속',
      after.view.folded[2] === true && after.view.chips[2] === 0 &&
      after.view.over === false && after.view.toAct !== 2, after.view.chips);
    const nt = await until(cl[0].box, (m) => m.type === 'tableNotice');
    assert('인디언포커 퇴장: 남은 사람에게 알림',
      nt.text === '플레이어 3 님이 퇴장했습니다', nt);

    // 남은 두 명이 판을 마친다
    let guard = 0;
    const two = cl.slice(0, 2);
    while (guard++ < 10) {
      const v = curView(two);
      if (v.over || v.phase !== 'bet') break;
      await tableAct(two, v.toAct, { type: 'check' });
    }
    const fin = seatView(cl[0]);
    assert('인디언포커: 퇴장 후에도 판이 정상적으로 끝난다',
      fin.over === true && fin.result.amount === 30 &&
      fin.chips[0] + fin.chips[1] === 2010, fin.chips);
    assert('인디언포커: 퇴장 좌석에는 10 벌칙을 적용하지 않는다',
      fin.result.penalties.every((p) => p.p !== 2), fin.result.penalties);

    two.forEach((c) => { c.box.length = 0; });
    send(cl[1].ws, { type: 'chat', text: '인디언 안녕' });
    const ch = await until(cl[0].box, (m) => m.type === 'chat');
    assert('인디언포커 채팅: 좌석 이름으로 전달',
      ch.text === '인디언 안녕' && ch.from === '플레이어 2' && ch.seat === 1, ch);

    two.forEach((c) => { c.box.length = 0; });
    send(cl[0].ws, { type: 'gameChangeRequest', game: 'omok' });
    send(cl[0].ws, { type: 'swapRequest' });
    send(cl[0].ws, { type: 'undoRequest' });
    send(cl[0].ws, { type: 'restartRequest' });
    await wait(120);
    assert('인디언포커 테이블 방은 게임/돌 바꾸기·무르기·재대국 요청을 무시한다',
      !two.some((c) => c.box.some((m) =>
        ['gameChangeRequest', 'swapRequest', 'restartRequest', 'undoRequest', 'gameChanged']
          .indexOf(m.type) !== -1)));

    // 2인 방(오목)에서 인디언포커로는 바꿀 수 없다 (테이블 종목이라 좌석 구조가 다르다)
    const duo = await omokRoom();
    duo.wm.length = 0;
    send(duo.black, { type: 'gameChangeRequest', game: 'indian' });
    await wait(120);
    assert('2인 방: 인디언포커로의 게임 변경 요청은 무시된다',
      !duo.wm.some((m) => m.type === 'gameChangeRequest'));
    duo.black.close(); duo.white.close();
    two.forEach((c) => c.ws.close());
    await wait(80);
  }

  // ============================================================
  // 47. 종료 후 무르기(오목): 승리로 끝난 방을 무르기로 되살린다.
  //     게임이 끝나도 방이 잠기지 않는다 — 수락된 무르기는
  //     이긴 수를 물리고 양쪽에게 "부활" 을 알린다.
  // ============================================================
  {
    const { black, white, bm, wm } = await omokRoom('free');
    // 흑 (7,0)~(7,4) 5목 / 백은 0행에 흩어 둔다
    const BS = [[7, 0], [0, 0], [7, 1], [0, 1], [7, 2], [0, 2], [7, 3], [0, 3], [7, 4]];
    for (let i = 0; i < BS.length; i++) {
      const mover = i % 2 === 0 ? black : white;
      send(mover, { type: 'move', row: BS[i][0], col: BS[i][1] });
      await until(bm, isMove(BS[i][0], BS[i][1]));
      await until(wm, isMove(BS[i][0], BS[i][1]));
    }
    const winMsg = bm.find((m) => m.type === 'move' && m.win === true);
    assert('종료후 무르기(오목): 흑 5목 승리 브로드캐스트',
      !!winMsg && winMsg.color === 'black' && winMsg.row === 7 && winMsg.col === 4, winMsg);

    // 끝난 판에는 더 이상 둘 수 없다 (서버도 종료 상태를 안다)
    wm.length = 0; bm.length = 0;
    send(white, { type: 'move', row: 0, col: 4 });
    await wait(120);
    assert('종료후: 끝난 판 착수 거부(브로드캐스트 없음)',
      !bm.some((m) => m.type === 'move') && !wm.some((m) => m.type === 'move'));
    assert('종료후: 끝난 판 착수 invalid(finished)',
      wm.some((m) => m.type === 'invalid' && m.reason === 'finished'),
      wm.filter((m) => m.type === 'invalid'));

    // 진 쪽(백)이 무르기를 요청하고 이긴 쪽(흑)이 수락한다
    wm.length = 0; bm.length = 0;
    send(white, { type: 'undoRequest' });
    await until(bm, (m) => m.type === 'undoRequest');
    assert('종료후: 게임이 끝나도 무르기 요청이 전달된다', true);
    send(black, { type: 'undoResponse', accept: true });
    const ub = await until(bm, (m) => m.type === 'undo');
    const uw = await until(wm, (m) => m.type === 'undo');
    assert('종료후 무르기(오목): 양쪽 undo 수신', !!ub && !!uw);
    assert('종료후 무르기(오목): 부활 플래그',
      ub.revived === true && uw.revived === true && ub.over === false && uw.over === false,
      { b: ub.revived, w: uw.revived, o: ub.over });
    assert('종료후 무르기(오목): 무른 사람(흑) 차례로 복귀',
      ub.turn === 'black' && uw.turn === 'black', { b: ub.turn, w: uw.turn });
    assert('종료후 무르기(오목): game 필드', ub.game === 'omok', ub.game);

    // 되살아난 판에서 흑이 다른 자리에 두면 정상 수용된다
    bm.length = 0; wm.length = 0;
    send(black, { type: 'move', row: 9, col: 9 });
    const again = await until(wm, isMove(9, 9));
    assert('종료후 무르기(오목): 부활 후 재착수 수용',
      again.color === 'black' && again.win === false, { c: again.color, w: again.win });
    // 백도 이어서 둘 수 있다 (턴이 정상 순환한다)
    wm.length = 0; bm.length = 0;
    send(white, { type: 'move', row: 0, col: 4 });
    const wAgain = await until(bm, isMove(0, 4));
    assert('종료후 무르기(오목): 부활 후 상대도 이어서 둔다', wAgain.color === 'white', wAgain.color);
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 48. 종료 후 무르기(오델로): 60수로 끝난 판을 되살린다.
  //     뒤집힘까지 복원된 보드를 양쪽에 내려주고 다시 둘 수 있다.
  // ============================================================
  {
    const { black, white, bm, wm } = await othelloRoom();
    let board = Othello.createBoard();
    let turn = Othello.BLACK;
    let over = null, plies = 0;
    let beforeLast = null, lastMove = null, lastTurn = null;
    while (plies < 80) {
      const ms = Othello.legalMoves(board, turn);
      if (!ms.length) break;
      const mover = turn === Othello.BLACK ? black : white;
      beforeLast = board.map((r) => r.slice());
      lastMove = ms[0]; lastTurn = turn;
      send(mover, { type: 'move', row: ms[0].row, col: ms[0].col });
      const m = await until(bm, isMove(ms[0].row, ms[0].col), 5000);
      await until(wm, isMove(ms[0].row, ms[0].col), 5000);
      board = Othello.applyMove(board, ms[0].row, ms[0].col, turn).board;
      plies++;
      if (m.over) { over = m; break; }
      turn = m.nextTurn === 'black' ? Othello.BLACK : Othello.WHITE;
    }
    assert('종료후 무르기(오델로): 판이 끝났다', over !== null && over.over === true, plies);

    bm.length = 0; wm.length = 0;
    send(white, { type: 'move', row: 0, col: 0 });
    await wait(120);
    assert('종료후(오델로): 끝난 판 착수 거부',
      !bm.some((m) => m.type === 'move') &&
      wm.some((m) => m.type === 'invalid' && m.reason === 'finished'),
      wm.filter((m) => m.type === 'invalid'));

    bm.length = 0; wm.length = 0;
    send(white, { type: 'undoRequest' });
    await until(bm, (m) => m.type === 'undoRequest');
    send(black, { type: 'undoResponse', accept: true });
    const ob = await until(bm, (m) => m.type === 'undo');
    const ow = await until(wm, (m) => m.type === 'undo');
    assert('종료후 무르기(오델로): 부활 플래그',
      ob.revived === true && ow.revived === true && ob.over === false, { r: ob.revived, o: ob.over });
    const same = (a, b) => a.every((row, r) => row.every((v, c) => v === b[r][c]));
    assert('종료후 무르기(오델로): 뒤집힘까지 복원된 보드',
      ob.board && same(beforeLast, ob.board), ob.board && ob.board[lastMove.row][lastMove.col]);
    assert('종료후 무르기(오델로): 되돌린 자리는 빈 칸',
      ob.board[lastMove.row][lastMove.col] === Othello.EMPTY);
    assert('종료후 무르기(오델로): 집계도 복원',
      ob.counts.black === Othello.counts(beforeLast).black &&
      ob.counts.white === Othello.counts(beforeLast).white, ob.counts);
    assert('종료후 무르기(오델로): 무른 사람 차례로 복귀',
      ob.turn === (lastTurn === Othello.BLACK ? 'black' : 'white'), ob.turn);

    // 되살아난 판에서 같은 자리에 다시 둘 수 있다
    bm.length = 0; wm.length = 0;
    const remover = lastTurn === Othello.BLACK ? black : white;
    send(remover, { type: 'move', row: lastMove.row, col: lastMove.col });
    const re = await until(wm, isMove(lastMove.row, lastMove.col), 5000);
    assert('종료후 무르기(오델로): 부활 후 재착수 수용',
      re.color === (lastTurn === Othello.BLACK ? 'black' : 'white') && re.flipped.length > 0,
      { c: re.color, f: re.flipped && re.flipped.length });
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 49. 종료 후 무르기(사목): 4목으로 끝난 판도 되살아난다
  // ============================================================
  {
    const { black, white, bm, wm } = await c4Room();
    const SEQ = [0, 6, 1, 6, 2, 6, 3];   // 흑 바닥 0~3열 = 가로 4목
    for (let i = 0; i < SEQ.length; i++) {
      const mover = i % 2 === 0 ? black : white;
      const expRow = SEQ[i] === 6 ? 5 - Math.floor(i / 2) : 5;
      send(mover, { type: 'move', col: SEQ[i] });
      await until(bm, isDrop(expRow, SEQ[i]));
      await until(wm, isDrop(expRow, SEQ[i]));
    }
    bm.length = 0; wm.length = 0;
    send(white, { type: 'move', col: 5 });
    await wait(120);
    assert('종료후(사목): 끝난 판 착수 거부',
      !bm.some((m) => m.type === 'move') &&
      wm.some((m) => m.type === 'invalid' && m.reason === 'finished'));

    bm.length = 0; wm.length = 0;
    send(white, { type: 'undoRequest' });
    await until(bm, (m) => m.type === 'undoRequest');
    send(black, { type: 'undoResponse', accept: true });
    const cb = await until(bm, (m) => m.type === 'undo');
    const cw = await until(wm, (m) => m.type === 'undo');
    assert('종료후 무르기(사목): 부활 + 무른 사람(흑) 차례',
      cb.revived === true && cw.revived === true && cb.turn === 'black' && cb.over === false,
      { r: cb.revived, t: cb.turn });
    bm.length = 0; wm.length = 0;
    send(black, { type: 'move', col: 4 });
    const drop = await until(wm, isDrop(5, 4));
    assert('종료후 무르기(사목): 부활 후 재착수 수용',
      drop.color === 'black' && drop.win === false, { c: drop.color, w: drop.win });
    black.close(); white.close();
    await wait(60);
  }

  // ============================================================
  // 50. 종료 후 재대국(restart) 은 종료 상태를 깨끗이 지운다
  //     (무르기로 되살리지 않고 새 판으로 가는 경로)
  // ============================================================
  {
    const { black, white, bm, wm } = await omokRoom('free');
    const BS = [[7, 0], [0, 0], [7, 1], [0, 1], [7, 2], [0, 2], [7, 3], [0, 3], [7, 4]];
    for (let i = 0; i < BS.length; i++) {
      const mover = i % 2 === 0 ? black : white;
      send(mover, { type: 'move', row: BS[i][0], col: BS[i][1] });
      await until(bm, isMove(BS[i][0], BS[i][1]));
      await until(wm, isMove(BS[i][0], BS[i][1]));
    }
    bm.length = 0; wm.length = 0;
    send(white, { type: 'restartRequest' });
    await until(bm, (m) => m.type === 'restartRequest');
    send(black, { type: 'restartResponse', accept: true });
    const rb = await until(bm, (m) => m.type === 'restart');
    const rw = await until(wm, (m) => m.type === 'restart');
    assert('종료후 재대국: 색 교대', rb.color === 'white' && rw.color === 'black', { b: rb.color, w: rw.color });
    // 색이 바뀌었으므로 새 흑 = 이전 백 소켓
    bm.length = 0; wm.length = 0;
    send(white, { type: 'move', row: 7, col: 7 });
    const first = await until(bm, isMove(7, 7));
    assert('종료후 재대국: 새 판에서 정상 착수',
      first.color === 'black' && first.win === false, { c: first.color, w: first.win });
    black.close(); white.close();
    await wait(60);
  }

  console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
