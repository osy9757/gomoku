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

  console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
