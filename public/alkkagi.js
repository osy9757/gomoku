/*
 * alkkagi.js — 알까기 공용 물리/규칙 모듈
 * 브라우저(window.Alkkagi)와 Node(require)에서 함께 쓰는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크 의존 없음). rules.js / connect4.js 와 같은 패턴.
 *
 * ── 왜 "결정적(deterministic)" 이어야 하는가 ────────────────────
 * 온라인 대전에서 네트워크로 오가는 것은 **손가락 한 번(치는 벡터)** 뿐이다.
 * 서버는 그 벡터로 시뮬레이션을 돌려 권위 있는 최종 상태를 만들고,
 * 두 클라이언트는 같은 벡터를 각자 로컬에서 다시 굴려 "애니메이션"을 그린다.
 * 그러므로 같은 상태 + 같은 입력은 어떤 자바스크립트 엔진에서도
 * 비트 단위로 같은 결과를 내야 한다. 이를 위해:
 *
 *   · 고정 시간 간격(dt = 1/120초). 프레임 레이트와 무관하다.
 *   · 시뮬레이션 안에서 Math.random 을 절대 쓰지 않는다.
 *   · 시뮬레이션 안에서 Math.sin/cos/atan2/hypot/pow 를 쓰지 않는다.
 *     (초월함수는 엔진마다 마지막 자리가 다를 수 있다.)
 *     충돌 해석에 필요한 것은 +,-,*,/ 와 Math.sqrt 뿐인데,
 *     이 다섯 연산은 IEEE 754 가 "정확히 반올림"을 요구하므로 안전하다.
 *   · 입력은 각도가 아니라 (vx, vy) 원시 벡터로 받는다 → 삼각함수 불필요.
 *   · 충돌 쌍은 항상 배열 인덱스 순서(i < j)로 훑는다 → 순서 의존 없음.
 *
 * ── 좌표계 ─────────────────────────────────────────────────────
 * 판은 0..1000 x 0..1000 의 정규화 좌표다(화면 픽셀이 아니다).
 * y 는 화면과 같은 방향(아래로 증가). 흑은 아래쪽, 백은 위쪽에서 시작한다.
 * 렌더링은 이 좌표에 배율만 곱한다 — 창 크기가 물리에 영향을 주지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Alkkagi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 프로토콜 색은 다른 종목과 동일하게 흑=1 / 백=2
  var BLACK = 1;
  var WHITE = 2;

  var BOARD = 1000;          // 판 한 변 (정규화 단위)
  var RADIUS = 28;           // 돌 반지름 (지름 56 = 판의 5.6%)
  var DT = 1 / 120;          // 고정 시간 간격 (초)
  var MAX_TICKS = 960;       // 8초 상한 (8 * 120). 넘으면 강제로 멈춘다.
  var MAX_POWER = 1200;      // 치는 속도 상한 (단위/초)
  var MIN_POWER = 30;        // 이 아래는 "친 것"으로 치지 않는다
  var FRICTION = 700;        // 마찰 감속 (단위/초^2, 선형)
  var RESTITUTION = 0.92;    // 반발 계수 (질량 동일)
  var SLEEP_EPS = 2;         // 이 속도 아래면 정지로 간주

  // 최대 파워로 쳤을 때 이동 거리 = v^2 / (2*FRICTION) = 1028.6
  // → 판(1000)을 겨우 가로지르는 정도. 한 번에 판 밖까지 날아가 버리지 않고,
  //   마주 본 돌을 밀어낼 힘은 남는다.

  var ROW_COUNT = 5;         // 한 줄에 놓는 돌 수
  var ROW_X = [100, 300, 500, 700, 900];   // 좌우 대칭 배치
  var BLACK_Y = 880;         // 흑: 아래쪽 줄
  var WHITE_Y = 120;         // 백: 위쪽 줄

  function other(color) { return color === BLACK ? WHITE : BLACK; }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // ── 상태 ────────────────────────────────────────────────────
  // {
  //   stones: [{ id, owner, x, y, vx, vy, alive }],   // 인덱스 순서 고정
  //   turn:   BLACK | WHITE,
  //   winner: BLACK | WHITE | null,
  //   over:   boolean
  // }
  function createGame() {
    var stones = [];
    var i;
    for (i = 0; i < ROW_COUNT; i++) {
      stones.push({ id: i, owner: BLACK, x: ROW_X[i], y: BLACK_Y, vx: 0, vy: 0, alive: true });
    }
    for (i = 0; i < ROW_COUNT; i++) {
      stones.push({
        id: ROW_COUNT + i, owner: WHITE, x: ROW_X[i], y: WHITE_Y, vx: 0, vy: 0, alive: true
      });
    }
    return { stones: stones, turn: BLACK, winner: null, over: false };
  }

  // 서버/클라 공용 별칭 — 다른 종목의 규칙 모듈과 같은 이름으로 방을 만들 수 있게.
  // (server.js 의 gameModule(game).createBoard() 경로를 그대로 재사용한다)
  function createBoard() { return createGame(); }

  // 아래 두 함수는 화면 코드에서도 부른다. 종목 전환 도중(보드가 아직
  // 알까기 상태로 바뀌기 전) 호출될 수 있어 방어적으로 만든다.
  function findStone(state, id) {
    if (!state || !state.stones) return null;
    for (var i = 0; i < state.stones.length; i++) {
      if (state.stones[i].id === id) return state.stones[i];
    }
    return null;
  }

  function count(state, owner) {
    if (!state || !state.stones) return 0;
    var n = 0;
    for (var i = 0; i < state.stones.length; i++) {
      var s = state.stones[i];
      if (s.alive && s.owner === owner) n++;
    }
    return n;
  }

  function clone(state) {
    var stones = [];
    for (var i = 0; i < state.stones.length; i++) {
      var s = state.stones[i];
      stones.push({
        id: s.id, owner: s.owner, x: s.x, y: s.y, vx: s.vx, vy: s.vy, alive: !!s.alive
      });
    }
    return {
      stones: stones,
      turn: state.turn,
      winner: (state.winner === BLACK || state.winner === WHITE) ? state.winner : null,
      over: !!state.over
    };
  }

  // 네트워크/스냅샷용 순수 JSON 값. 속도까지 담는다 —
  // 8초 상한에 걸려 돌이 아직 움직이는 채로 끝난 판도 그대로 이어져야 한다.
  function serialize(state) {
    var stones = [];
    for (var i = 0; i < state.stones.length; i++) {
      var s = state.stones[i];
      stones.push({
        id: s.id, owner: s.owner, x: s.x, y: s.y, vx: s.vx, vy: s.vy, alive: !!s.alive
      });
    }
    return {
      stones: stones,
      turn: state.turn === WHITE ? WHITE : BLACK,
      winner: (state.winner === BLACK || state.winner === WHITE) ? state.winner : null,
      over: !!state.over
    };
  }

  function deserialize(data) {
    var src = (data && data.stones) || [];
    var stones = [];
    for (var i = 0; i < src.length; i++) {
      var s = src[i] || {};
      stones.push({
        id: isNum(s.id) ? s.id : i,
        owner: s.owner === WHITE ? WHITE : BLACK,
        x: isNum(s.x) ? s.x : 0,
        y: isNum(s.y) ? s.y : 0,
        vx: isNum(s.vx) ? s.vx : 0,
        vy: isNum(s.vy) ? s.vy : 0,
        alive: s.alive !== false
      });
    }
    return {
      stones: stones,
      turn: (data && data.turn) === WHITE ? WHITE : BLACK,
      winner: (data && (data.winner === BLACK || data.winner === WHITE)) ? data.winner : null,
      over: !!(data && data.over)
    };
  }

  // ── 입력 ────────────────────────────────────────────────────
  // 치는 힘은 모듈 안에서 자른다. 클라이언트가 보낸 값을 절대 믿지 않는다.
  function clampVector(vx, vy) {
    var x = isNum(vx) ? vx : 0;
    var y = isNum(vy) ? vy : 0;
    var mag = Math.sqrt(x * x + y * y);
    if (mag <= MAX_POWER || mag === 0) return { vx: x, vy: y };
    var k = MAX_POWER / mag;
    return { vx: x * k, vy: y * k };
  }

  function power(vx, vy) {
    return Math.sqrt(vx * vx + vy * vy);
  }

  // 서버 권위 판정 = 클라이언트 사전 판정 (같은 함수를 양쪽이 쓴다)
  function validateFlick(state, color, stoneId, vx, vy) {
    if (!state) return { ok: false, reason: 'no-game' };
    if (state.over) return { ok: false, reason: 'finished' };
    if (color !== state.turn) return { ok: false, reason: 'not-your-turn' };
    var s = findStone(state, stoneId);
    if (!s) return { ok: false, reason: 'no-stone' };
    if (!s.alive) return { ok: false, reason: 'dead-stone' };
    if (s.owner !== color) return { ok: false, reason: 'not-your-stone' };
    if (!isNum(vx) || !isNum(vy)) return { ok: false, reason: 'bad-vector' };
    if (power(vx, vy) < MIN_POWER) return { ok: false, reason: 'too-weak' };
    return { ok: true };
  }

  // ── 시뮬레이션 ──────────────────────────────────────────────
  // 한 틱의 순서: 이동 → 판 밖 판정 → 충돌 → 마찰/정지.
  // 이 순서를 바꾸면 결과가 달라지므로 절대 건드리지 않는다.
  function tick(sim) {
    var stones = sim.state.stones;
    var n = stones.length;
    var i, j, s;

    // 1) 등속 이동
    for (i = 0; i < n; i++) {
      s = stones[i];
      if (!s.alive) continue;
      s.x += s.vx * DT;
      s.y += s.vy * DT;
    }

    // 2) 중심이 판 경계를 넘으면 즉시 아웃
    for (i = 0; i < n; i++) {
      s = stones[i];
      if (!s.alive) continue;
      if (s.x < 0 || s.x > BOARD || s.y < 0 || s.y > BOARD) {
        s.alive = false;
        s.vx = 0;
        s.vy = 0;
        sim.events.push({ t: 'out', id: s.id, owner: s.owner, tick: sim.ticks + 1 });
      }
    }

    // 3) 충돌 (질량 동일, 반발계수 RESTITUTION). 쌍은 인덱스 오름차순 고정.
    var minD = RADIUS * 2;
    for (i = 0; i < n; i++) {
      var a = stones[i];
      if (!a.alive) continue;
      for (j = i + 1; j < n; j++) {
        var b = stones[j];
        if (!b.alive) continue;
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        if (d2 === 0) continue;          // 완전 동일 좌표 = 법선을 정의할 수 없다
        var d = Math.sqrt(d2);
        var nx = dx / d;
        var ny = dy / d;
        // 서로 다가오는 중일 때만 충격량을 준다 (달라붙음 방지)
        var sep = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (sep < 0) {
          var imp = -(1 + RESTITUTION) * sep / 2;   // 질량 1 두 개
          a.vx -= imp * nx;
          a.vy -= imp * ny;
          b.vx += imp * nx;
          b.vy += imp * ny;
        }
        // 겹친 만큼 절반씩 밀어내 정확히 맞닿게 한다
        var push = (minD - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }

    // 4) 마찰(선형 감속) + 정지 판정
    var drop = FRICTION * DT;
    for (i = 0; i < n; i++) {
      s = stones[i];
      if (!s.alive) continue;
      var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      if (sp <= drop || sp < SLEEP_EPS) {
        s.vx = 0;
        s.vy = 0;
        continue;
      }
      var k = (sp - drop) / sp;
      s.vx *= k;
      s.vy *= k;
      if (Math.sqrt(s.vx * s.vx + s.vy * s.vy) < SLEEP_EPS) {
        s.vx = 0;
        s.vy = 0;
      }
    }

    sim.ticks += 1;
  }

  function allAsleep(state) {
    for (var i = 0; i < state.stones.length; i++) {
      var s = state.stones[i];
      if (s.alive && (s.vx !== 0 || s.vy !== 0)) return false;
    }
    return true;
  }

  // 시뮬레이션이 끝났을 때의 뒷정리: 승패 판정 + 차례 교대.
  // simulate() 와 step() 이 같은 함수를 쓰므로 두 경로의 결과는 항상 같다.
  function finish(sim) {
    if (sim.finished) return;
    sim.finished = true;
    sim.done = true;
    var st = sim.state;
    var b = count(st, BLACK);
    var w = count(st, WHITE);
    var winner = null;
    if (b === 0 && w === 0) {
      // 한 번의 치기로 양쪽이 다 나갔다 → 친 쪽이 진다 (자멸 우선)
      winner = other(sim.flicker);
    } else if (b === 0) {
      winner = WHITE;
    } else if (w === 0) {
      winner = BLACK;
    }
    st.winner = winner;
    st.over = winner !== null;
    // 차례는 결과와 무관하게 항상 교대한다 (한 번 치면 상대 차례)
    st.turn = other(sim.flicker);
  }

  // 클라이언트 애니메이션용 단계 실행기.
  // begin() 으로 시뮬레이터를 만들고 step() 을 반복하면
  // simulate() 와 완전히 같은 최종 상태에 도달한다.
  function begin(state, input) {
    var sim = {
      state: clone(state),
      events: [],
      ticks: 0,
      done: false,
      finished: false,
      maxTicks: MAX_TICKS,
      flicker: state.turn,
      stoneId: input ? input.stoneId : null
    };
    var v = clampVector(input ? input.vx : 0, input ? input.vy : 0);
    var s = findStone(sim.state, input ? input.stoneId : null);
    if (s && s.alive) {
      s.vx = v.vx;
      s.vy = v.vy;
    }
    return sim;
  }

  function step(sim) {
    if (!sim.done) {
      tick(sim);
      if (allAsleep(sim.state) || sim.ticks >= sim.maxTicks) finish(sim);
    }
    return {
      positions: sim.state.stones,
      events: sim.events,
      ticks: sim.ticks,
      done: sim.done
    };
  }

  // 서버 권위 계산 (그리고 테스트/검증용). 원본 상태는 건드리지 않는다.
  function simulate(state, input) {
    var sim = begin(state, input);
    while (!sim.done) step(sim);
    return { finalState: sim.state, events: sim.events, ticks: sim.ticks };
  }

  return {
    BLACK: BLACK,
    WHITE: WHITE,
    BOARD: BOARD,
    RADIUS: RADIUS,
    DT: DT,
    MAX_TICKS: MAX_TICKS,
    MAX_POWER: MAX_POWER,
    MIN_POWER: MIN_POWER,
    FRICTION: FRICTION,
    RESTITUTION: RESTITUTION,
    SLEEP_EPS: SLEEP_EPS,
    ROW_X: ROW_X,
    other: other,
    createGame: createGame,
    createBoard: createBoard,
    findStone: findStone,
    count: count,
    clone: clone,
    serialize: serialize,
    deserialize: deserialize,
    clampVector: clampVector,
    power: power,
    validateFlick: validateFlick,
    begin: begin,
    step: step,
    simulate: simulate
  };
});
