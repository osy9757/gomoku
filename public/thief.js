/*
 * thief.js — 도둑잡기(2~6인) 결정적 상태 기계
 * 브라우저(window.Thief)와 Node(require)에서 함께 쓰는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크/난수 의존 없음).
 *   - 온라인: 서버가 이 엔진을 돌리고 각 클라이언트에는 viewFor() 결과만 보낸다.
 *   - 로컬(핫시트): 클라이언트가 같은 엔진을 직접 돌린다.
 * 셔플은 호출자 책임(createHand 에 이미 섞인 덱을 넘긴다) → 엔진은 완전히 결정적.
 * indianpoker.js 와 같은 공개 API 모양(createHand/apply/leave/viewFor/nextHand)을
 * 유지해서 테이블 방(좌석제 2~6인) 코드 경로를 그대로 재사용한다.
 *
 * ── 카드 ──────────────────────────────────────────────
 *   덱 = 표준 52장(cards.js makeDeck) + 조커 1장 = 53장.
 *   조커는 { r: 0, s: -1 } 이다. r=0 은 어떤 랭크와도 짝이 되지 않으므로
 *   "짝이 없는 단 한 장" 이라는 이 게임의 전제가 자료구조 수준에서 보장된다.
 *
 * ── 진행 ──────────────────────────────────────────────
 *   1) 딜러 왼쪽(시계방향 다음) 좌석부터 라운드 로빈으로 53장을 **전부** 나눈다.
 *      53 은 2~6 어느 인원으로도 나누어떨어지지 않으므로 손패 수가 고르지 않은
 *      것이 정상이다.
 *   2) [첫 정리] 각자 손에 든 같은 랭크 페어를 전부 버린다.
 *      · 같은 랭크가 2장이면 1쌍, 4장이면 2쌍을 버린다.
 *      · 3장(트리플)이면 1쌍만 버리고 1장을 남긴다.
 *      · 어느 장을 남길지는 결정적이어야 한다 → 손패 순서에서 **앞에서부터**
 *        2장씩 버리고, 홀수로 남는 1장은 맨 뒤의 것이 남는다.
 *      이 정리로 손이 비면 그 자리에서 곧바로 탈출한다(탈출 순서에 기록).
 *   3) [차례] 차례인 사람은 **시계방향 다음 활성 좌석**(= 뽑을 대상)의
 *      펼쳐진 손패에서 카드 한 장을 인덱스로 뽑는다.
 *      · 뽑은 카드가 내 손패의 카드와 랭크가 같으면 그 두 장을 즉시 버린다.
 *      · 뽑은 사람의 손이 비면 탈출. 뽑힌 사람의 손이 비어도 탈출.
 *      · 차례는 **뽑힌 사람**에게 넘어간다(표준 진행). 뽑힌 사람이 탈출했다면
 *        그 다음 활성 좌석으로 넘어간다.
 *   4) [섞기] 지금 뽑히는 쪽(대상)은 뽑히기 **전에** 자기 손패 순서를 한 번
 *      뒤섞을 수 있다(미끼 섞기). 한 차례에 한 번만 가능하다.
 *      무작위성은 호출자 책임이다 — 엔진은 순열 배열을 받아 그대로 적용한다.
 *      (온라인에서는 서버가 자기 RNG 로 순열을 만들어 넣는다)
 *   5) [종료] 활성 좌석이 1명만 남으면 그 사람이 도둑(패자)이다.
 *      모든 일반 카드는 짝이 있으므로 마지막 한 손에는 조커만 남는다.
 *
 * ── 규칙 결정 사항 (문서화) ───────────────────────────
 *   · 손패 정렬은 화면(클라이언트)의 몫이다. 엔진은 뽑기 인덱스의 의미가
 *     흔들리지 않도록 "진짜 순서"를 그대로 유지한다.
 *   · 뽑은 카드는 짝이 없으면 손패 **맨 뒤**에 붙는다.
 *   · 손패에는 절대 페어가 남지 않는다(첫 정리 + 뽑을 때마다 정리). 그래서
 *     뽑은 카드와 짝이 되는 카드는 있어도 하나뿐이고, 그 하나는 손패 순서에서
 *     가장 앞의 것이다.
 *   · [퇴장] leave() 한 좌석의 카드는 판에서 사라진다. 단 조커만은 사라지지
 *     않고 시계방향 다음 활성 좌석의 손패 **맨 뒤**(index = 손패 길이)로 옮겨
 *     간다. 조커가 사라지면 아무도 도둑이 되지 않아 판이 끝나지 않기 때문이다.
 *     - 옮겨졌다는 사실은 로그에 남기지 않는다(누가 조커를 들었는지가 새어
 *       나가면 게임 자체가 무너진다). 다만 손패 수가 1장 늘어나는 것까지는
 *       감출 수 없다 — 퇴장은 예외 상황이므로 이 정도는 감수한다.
 *     - 사라진 카드의 짝이 다른 손에 남으면 그 카드는 영영 짝을 못 만나는
 *       '고아 카드'가 된다. 종료 조건을 "활성 좌석 1명"으로 두었으므로
 *       고아 카드가 있어도 판은 반드시 끝난다(도둑이 조커와 함께 들고 있다).
 *   · 로그에는 어떤 카드 값도 담기지 않는다. 뽑힌 사람은 무엇을 뺏겼는지
 *     알지만 나머지 사람들은 알면 안 되기 때문이다. 그래서 '페어 버림' 은
 *     랭크 없이 쌍 수만 적는다.
 *   · 한 판이 곧 한 경기다(칩/베팅이 없다). 판이 끝나면 matchOver 도 함께
 *     true 가 되어 테이블 방의 '새 경기' 흐름을 그대로 탄다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cards.js'));
  } else {
    root.Thief = factory(root.Cards);
  }
})(typeof self !== 'undefined' ? self : this, function (Cards) {
  'use strict';

  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 6;
  var START_CHIPS = 0;              // 칩 개념이 없다 (테이블 방 공용 코드 호환용)
  var JOKER_RANK = 0, JOKER_SUIT = -1;

  function newJoker() { return { r: JOKER_RANK, s: JOKER_SUIT }; }
  function isJoker(c) { return !!c && c.r === JOKER_RANK; }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fill(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
  // from 의 "다음" 좌석부터 시계방향 한 바퀴 (from 자신은 맨 마지막)
  function seatOrder(n, from) {
    var a = [];
    for (var i = 1; i <= n; i++) a.push((from + i) % n);
    return a;
  }
  function emit(s, ev) { s.log.push(ev); return ev; }

  // 52장 + 조커 1장 = 53장
  function makeDeck() {
    return Cards.makeDeck().concat([newJoker()]);
  }

  // ── 상태 조회 ──────────────────────────────────────────
  function isActive(s, p) {
    if (typeof p !== 'number' || p < 0 || p >= s.players) return false;
    return !s.escaped[p] && !s.left[p];
  }
  function activeSeats(s) {
    var a = [];
    for (var i = 0; i < s.players; i++) if (isActive(s, i)) a.push(i);
    return a;
  }
  // from 다음(시계방향)의 첫 활성 좌석. from 자신은 마지막에만 검사된다.
  function firstActive(s, from) {
    var ord = seatOrder(s.players, from);
    for (var i = 0; i < ord.length; i++) if (isActive(s, ord[i])) return ord[i];
    return null;
  }
  // 지금 차례인 사람이 뽑을 대상 = 시계방향 다음 활성 좌석 (자기 자신 제외)
  function targetOf(s) {
    if (s.turn === null || s.turn === undefined) return null;
    var ord = seatOrder(s.players, s.turn);
    for (var i = 0; i < ord.length; i++) {
      if (ord[i] !== s.turn && isActive(s, ord[i])) return ord[i];
    }
    return null;
  }
  function isHandOver(s) { return !!(s && s.over); }
  function handCounts(s) {
    return s.hands.map(function (h) { return h.cards.length; });
  }
  // 좌석이 조커를 들고 있으면 그 카드, 아니면 null
  function jokerOf(s, p) {
    if (typeof p !== 'number' || !s.hands[p]) return null;
    var f = s.hands[p].cards.filter(isJoker)[0];
    return f ? { r: f.r, s: f.s } : null;
  }

  // ── 첫 정리 (손패의 모든 랭크 페어 버리기) ──────────────
  // 앞에서부터 2장씩 버린다 → 트리플이면 맨 뒤 1장이 남는다.
  // 반환: 버린 쌍 수
  function discardPairs(hand) {
    var byRank = {};
    hand.cards.forEach(function (c, i) {
      var k = String(c.r);
      if (!byRank[k]) byRank[k] = [];
      byRank[k].push(i);
    });
    var drop = {};
    var pairs = 0;
    Object.keys(byRank).forEach(function (k) {
      if (Number(k) === JOKER_RANK) return;     // 조커는 짝이 없다
      var idx = byRank[k];
      var np = Math.floor(idx.length / 2);
      pairs += np;
      for (var i = 0; i < np * 2; i++) drop[idx[i]] = true;
    });
    hand.cards = hand.cards.filter(function (c, i) { return !drop[i]; });
    return pairs;
  }

  // ── 탈출 판정 ──────────────────────────────────────────
  function escapeIf(s, p) {
    if (!isActive(s, p)) return false;
    if (s.hands[p].cards.length > 0) return false;
    s.escaped[p] = true;
    s.escapeOrder.push(p);
    emit(s, { t: 'escape', p: p });
    return true;
  }
  // 여러 좌석을 정해진 순서로 훑는다 (배분 순서 = 딜러 다음부터)
  function checkEscapes(s, order) {
    var ord = order || seatOrder(s.players, s.dealer);
    ord.forEach(function (p) { escapeIf(s, p); });
  }

  // ── 종료 판정 ──────────────────────────────────────────
  function checkEnd(s) {
    if (s.over) return;
    var act = activeSeats(s);
    if (act.length > 1) return;
    var loser = act.length ? act[0] : null;
    s.over = true;
    s.matchOver = true;          // 한 판이 곧 한 경기다
    s.matchWinner = null;        // 승자가 아니라 "도둑"을 가리는 게임이다
    s.phase = 'over';
    s.turn = null;
    s.target = null;
    s.shuffled = false;
    s.result = {
      loser: loser,
      escapeOrder: s.escapeOrder.slice(),
      joker: jokerOf(s, loser),
      cards: loser === null ? [] : s.hands[loser].cards.map(function (c) {
        return { r: c.r, s: c.s };
      })
    };
    emit(s, { t: 'end', loser: loser, escapeOrder: s.escapeOrder.slice() });
  }

  // ── 생성 ───────────────────────────────────────────────
  function createHand(opts) {
    opts = opts || {};
    var i;
    var n = opts.players | 0;
    if (!n) n = MIN_PLAYERS;
    if (n < MIN_PLAYERS) n = MIN_PLAYERS;
    if (n > MAX_PLAYERS) n = MAX_PLAYERS;
    var deckOrder = (opts.deckOrder || makeDeck()).slice();
    var dealer = opts.dealer | 0;
    if (dealer < 0 || dealer >= n) dealer = 0;

    var hands = [];
    for (i = 0; i < n; i++) hands.push({ cards: [] });

    var s = {
      gameNo: opts.gameNo || 1,
      players: n,
      dealer: dealer,
      deck: deckOrder,
      hands: hands,
      chips: fill(n, START_CHIPS),  // 칩은 쓰지 않지만 공용 화면 코드가 참조한다
      escaped: fill(n, false),
      escapeOrder: [],
      left: fill(n, false),
      turn: null,
      target: null,
      shuffled: false,
      // 직전에 뽑힌 카드 — viewFor 가 "뽑은 본인에게만" 실어 준다.
      // 본인은 어차피 손에 쥐어 본 카드라 새로 아는 것이 없고, 짝이 맞아
      // 바로 버려진 경우에도 무엇이었는지 화면에 보여 줄 수 있다.
      lastDraw: null,
      phase: 'draw',
      pot: 0,
      over: false,
      matchOver: false,
      matchWinner: null,
      result: null,
      log: []
    };

    // 딜러 왼쪽부터 시계방향 라운드 로빈으로 덱을 전부 나눈다
    var ord = seatOrder(n, dealer);
    for (i = 0; i < deckOrder.length; i++) {
      var c = deckOrder[i];
      hands[ord[i % n]].cards.push({ r: c.r, s: c.s });
    }
    var dealEvent = emit(s, {
      t: 'deal', players: n, dealer: dealer,
      dealt: deckOrder.length, counts: handCounts(s)
    });

    // 첫 정리 (각자 페어를 전부 버린다)
    var pairs = [];
    for (i = 0; i < n; i++) pairs.push(discardPairs(hands[i]));
    emit(s, { t: 'clean', counts: pairs });

    // 여기서 손이 빈 사람은 곧바로 탈출
    checkEscapes(s, ord);

    s.turn = firstActive(s, dealer);   // 선 = 딜러 왼쪽 (탈출했으면 그 다음)
    dealEvent.first = s.turn;          // 딜러는 배분 순서 기준일 뿐, 화면에는 "선"을 알려 준다
    s.target = targetOf(s);
    s.shuffled = false;
    checkEnd(s);
    return s;
  }

  // ── 액션 ───────────────────────────────────────────────
  function err(state, message) { return { state: state, events: [], error: message }; }
  function done(state, s, from) { return { state: s, events: s.log.slice(from) }; }

  function apply(state, p, action) {
    if (!state) return err(state, '상태 없음');
    if (state.over) return err(state, '이미 끝난 판입니다');
    if (typeof p !== 'number' || p < 0 || p >= state.players) return err(state, '잘못된 플레이어');
    if (!action || typeof action.type !== 'string') return err(state, '잘못된 액션');
    if (action.type === 'draw') return applyDraw(state, p, action);
    if (action.type === 'shuffle') return applyShuffle(state, p, action);
    return err(state, '알 수 없는 액션');
  }

  // 뽑기: 대상의 손패 index 번째 카드를 가져온다
  function applyDraw(state, p, action) {
    if (state.turn !== p) return err(state, '당신의 차례가 아닙니다');
    var t = state.target;
    if (t === null) return err(state, '뽑을 상대가 없습니다');
    var idx = action.index;
    if (typeof idx !== 'number' || !isFinite(idx) || idx !== Math.floor(idx)) {
      return err(state, '잘못된 카드 위치');
    }
    if (idx < 0 || idx >= state.hands[t].cards.length) return err(state, '잘못된 카드 위치');

    var s = clone(state);
    var from = s.log.length;
    var card = s.hands[t].cards.splice(idx, 1)[0];
    var hand = s.hands[p].cards;
    s.lastDraw = { p: p, from: t, card: { r: card.r, s: card.s }, paired: false };
    var match = -1;
    if (!isJoker(card)) {
      for (var i = 0; i < hand.length; i++) {
        if (hand[i].r === card.r) { match = i; break; }
      }
    }
    if (match >= 0) {
      hand.splice(match, 1);      // 짝 맞은 두 장(손패의 것 + 뽑은 것)을 버린다
      s.lastDraw.paired = true;
      emit(s, { t: 'draw', p: p, from: t, paired: true });
      emit(s, { t: 'pair', p: p, pairs: 1 });
    } else {
      hand.push(card);            // 짝이 없으면 맨 뒤에 붙인다
      emit(s, { t: 'draw', p: p, from: t, paired: false });
    }

    // 탈출: 뽑은 사람 먼저, 그 다음 뽑힌 사람
    escapeIf(s, p);
    escapeIf(s, t);

    // 차례는 뽑힌 사람에게. 탈출했다면 그 다음 활성 좌석으로.
    s.turn = isActive(s, t) ? t : firstActive(s, t);
    s.target = targetOf(s);
    s.shuffled = false;           // 섞기 제한은 차례마다 초기화된다
    checkEnd(s);
    return done(state, s, from);
  }

  // 미끼 섞기: 지금 뽑히는 쪽만, 한 차례에 한 번만
  function applyShuffle(state, p, action) {
    if (state.target !== p) return err(state, '지금 패를 섞을 수 있는 좌석이 아닙니다');
    if (state.shuffled) return err(state, '이번 차례에는 이미 섞었습니다');
    var len = state.hands[p].cards.length;
    var perm = action.perm;
    if (!Array.isArray(perm) || perm.length !== len) return err(state, '잘못된 섞기 순서');
    var seen = {}, i, k;
    for (i = 0; i < len; i++) {
      k = perm[i];
      if (typeof k !== 'number' || k !== Math.floor(k) || k < 0 || k >= len || seen[k]) {
        return err(state, '잘못된 섞기 순서');
      }
      seen[k] = true;
    }
    var s = clone(state);
    var from = s.log.length;
    var old = s.hands[p].cards;
    var next = [];
    for (i = 0; i < len; i++) next.push(old[perm[i]]);
    s.hands[p].cards = next;
    s.shuffled = true;
    emit(s, { t: 'shuffle', p: p });   // 카드 정보는 절대 담지 않는다
    return done(state, s, from);
  }

  // ── 퇴장 (접속 종료) ───────────────────────────────────
  function leave(state, seat) {
    if (!state) return { error: '상태 없음' };
    if (typeof seat !== 'number' || seat < 0 || seat >= state.players) {
      return { error: '잘못된 좌석' };
    }
    if (state.left[seat]) return { state: state, events: [] };
    var s = clone(state);
    var from = s.log.length;
    s.left[seat] = true;
    emit(s, { t: 'leave', p: seat });
    if (!s.over) {
      var hand = s.hands[seat].cards;
      var hadJoker = hand.some(isJoker);
      s.hands[seat].cards = [];
      if (hadJoker) {
        var to = firstActive(s, seat);
        // 조커는 다음 활성 좌석의 손패 맨 뒤로 (로그에는 남기지 않는다)
        if (to !== null) s.hands[to].cards.push(newJoker());
      }
      checkEscapes(s);
      if (s.turn === null || s.turn === seat || !isActive(s, s.turn)) {
        s.turn = firstActive(s, seat);
      }
      s.target = targetOf(s);
      s.shuffled = false;
      checkEnd(s);
    }
    return { state: s, events: s.log.slice(from) };
  }

  // ── 다음 판 ────────────────────────────────────────────
  function nextHand(state, deckOrder) {
    if (!state) return { error: '상태 없음' };
    if (!state.over) return { error: '아직 판이 끝나지 않았습니다' };
    var n = state.players;
    return createHand({
      players: n,
      deckOrder: deckOrder || makeDeck(),
      dealer: (state.dealer + 1) % n,
      gameNo: (state.gameNo || 1) + 1
    });
  }

  // ── 시점별 뷰 ──────────────────────────────────────────
  // 내 손패만 보이고, 남의 손패는 "장수" 만 보인다(전부 null).
  // p 가 좌석 번호가 아니면(null) 전원을 가린다 — 로컬 핫시트 가리개 화면.
  // 판이 끝나면 전원 공개한다 (남아 있는 카드는 도둑의 조커뿐이다).
  function viewFor(state, p) {
    var v = clone(state);
    delete v.deck;
    v.deckLeft = 0;                       // 도둑잡기는 남는 덱이 없다
    var mine = (typeof p === 'number' && p >= 0 && p < state.players) ? p : null;
    v.me = mine;
    v.counts = handCounts(state);
    v.inPlay = v.counts.reduce(function (a, b) { return a + b; }, 0);
    if (!state.over) {
      for (var q = 0; q < state.players; q++) {
        if (mine !== null && q === mine) continue;
        v.hands[q].cards = v.hands[q].cards.map(function () { return null; });
      }
    }
    // 직전에 뽑은 카드는 그것을 뽑은 본인에게만 실린다 (나머지는 null)
    v.lastDraw = (state.lastDraw && mine !== null && state.lastDraw.p === mine)
      ? state.lastDraw : null;
    v.canDraw = !state.over && mine !== null && state.turn === mine;
    v.canShuffle = !state.over && mine !== null && state.target === mine && !state.shuffled;
    v.options = [];                       // 카드 게임 공용 화면 코드 호환용
    return v;
  }

  // ── 로그 문구 ──────────────────────────────────────────
  // 어떤 문구에도 카드 값(랭크/무늬)이 들어가지 않는다.
  function defaultNames(n) {
    var a = [];
    for (var i = 0; i < (n || MAX_PLAYERS); i++) a.push('P' + (i + 1));
    return a;
  }
  function describeEvent(ev, names) {
    if (!ev) return '';
    var N = names || defaultNames(ev.players);
    function nm(i) { return N[i] || ('P' + (i + 1)); }
    switch (ev.t) {
      case 'deal':
        var first = typeof ev.first === 'number' ? ev.first : (ev.dealer + 1) % ev.players;
        return ev.dealt + '장을 ' + ev.players + '명에게 모두 나눴습니다 · 선: ' +
          nm(first);
      case 'clean':
        return '첫 정리 — ' + (ev.counts || []).map(function (c, i) {
          return nm(i) + ' ' + c + '쌍';
        }).join(' · ');
      case 'draw':
        return nm(ev.p) + ' → ' + nm(ev.from) + '의 카드를 뽑음';
      case 'pair':
        return nm(ev.p) + ' 페어 ' + (ev.pairs || 1) + '쌍 버림';
      case 'shuffle':
        return nm(ev.p) + '이(가) 패를 섞었습니다';
      case 'escape':
        return nm(ev.p) + ' 탈출!';
      case 'leave':
        return nm(ev.p) + ' 퇴장';
      case 'end':
        return ev.loser === null ? '판 종료 (남은 사람 없음)' : ('도둑: ' + nm(ev.loser));
      default:
        return '';
    }
  }

  return {
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    START_CHIPS: START_CHIPS,
    JOKER_RANK: JOKER_RANK,
    JOKER_SUIT: JOKER_SUIT,
    isJoker: isJoker,
    makeDeck: makeDeck,
    createHand: createHand,
    createGame: createHand,
    apply: apply,
    leave: leave,
    nextHand: nextHand,
    viewFor: viewFor,
    isHandOver: isHandOver,
    activeSeats: activeSeats,
    isActive: isActive,
    targetOf: targetOf,
    handCounts: handCounts,
    jokerOf: jokerOf,
    describeEvent: describeEvent
  };
});
