/* 온라인 WebSocket 흐름 검증 */
const WebSocket = require('ws');
const URL = 'ws://localhost:3457/ws';

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function open() { return new Promise((res) => { const w = new WebSocket(URL); w.on('open', () => res(w)); }); }
function next(ws) { return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString())))); }
function send(ws, o) { ws.send(JSON.stringify(o)); }

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
  console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
