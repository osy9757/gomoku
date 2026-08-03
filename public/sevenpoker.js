/*
 * sevenpoker.js — 세븐포커(2~6인) 결정적 상태 기계
 * 브라우저(window.SevenPoker)와 Node(require)에서 함께 쓰는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크/난수 의존 없음).
 *   - 온라인: 서버가 이 엔진을 돌리고 각 클라이언트에는 viewFor() 결과만 보낸다.
 *   - 로컬(핫시트): 클라이언트가 같은 엔진을 직접 돌린다.
 * 셔플은 호출자 책임(createHand 에 이미 섞인 덱을 넘긴다) → 엔진은 완전히 결정적.
 *
 * 좌석은 0..N-1 이고 N=2 이면 기존 맞포커(1:1)와 동일하게 동작한다.
 * (배열 상태 · 이벤트 · result 모양 · 공개 API 모두 2인 경로에서 그대로다)
 *
 * ── 진행 ──────────────────────────────────────────────
 *   1) 앤티 10씩 자동 → 팟 = 10 x 참가 인원
 *   2) 4장씩 배분 (딜러 다음 좌석부터 시계방향으로 한 장씩)
 *   3) 'discard' — 각자 4장 중 1장을 매장(buried). 순서 무관, 각 1회.
 *   4) 'open'    — 각자 남은 3장 중 1장을 오픈. 순서 무관, 각 1회.
 *   5) 베팅 1라운드 → 5번째 카드(오픈) → 2라운드 → 6번째 카드(오픈) →
 *      3라운드 → 7번째 카드(히든) → 4라운드 → 쇼다운
 *   총 7장을 받아 1장은 매장되므로 손에는 6장이 남고, 그 6장 중
 *   최선의 5장으로 승부한다(evalBest5).
 *
 * ── 규칙 결정 사항 (문서화) ───────────────────────────
 *   · 선(먼저 액션)은 매 베팅 라운드마다 "오픈된 카드가 가장 높은 쪽".
 *     오픈 카드를 내림차순으로 늘어놓고 앞에서부터 비교하며, 완전히
 *     동점이면 좌석 번호가 작은 쪽이 먼저 액션한다. 무늬로는 가리지 않는다.
 *     (2인에서 딜러=1 이면 기존과 동일하게 비딜러(0)가 선이다.)
 *     선이 올인이라 액션할 수 없으면 시계방향으로 다음 가능한 좌석이 선이 된다.
 *   · 액션 순서는 선부터 시계방향(좌석 번호 +1, N 에서 0 으로 순환).
 *     폴드/올인한 좌석은 건너뛴다.
 *   · 라운드 종료 = 액션 가능한(폴드X·올인X) 모든 좌석이 한 번 이상 액션했고
 *     베팅액이 최고액과 같아졌을 때. 그 시점에 매칭되지 않은 초과분은
 *     최고 기여자에게 즉시 반환한다(언콜드 벳 반환).
 *   · 삥 = 앤티와 같은 10, 라운드의 첫 베팅으로만 가능.
 *   · 하프 = 콜 금액 + floor(현재 팟 / 2). 최소 10(삥).
 *   · 따당 = 콜 금액 + (직전 베팅/레이즈 금액 x 2).
 *   · 레이즈(삥/하프/따당)는 한 라운드에 최대 4회 (좌석 공유 카운터).
 *   · 스택을 넘는 금액은 자동으로 "남은 칩 전부(올인)"가 된다.
 *     액션 가능한 좌석이 1명 이하로 줄면 남은 카드는 베팅 없이 끝까지 배분한다.
 *   · 사이드 팟: 각 올인 금액이 하나의 "층"을 만든다. 층의 금액은 그 층까지
 *     기여한 모든 좌석(폴드 포함)의 기여분 합이고, 그 층을 가져갈 자격은
 *     "그 층까지 기여했으면서 폴드하지 않은" 좌석에게만 있다. 층마다 따로
 *     최선의 패를 비교하고, 동점이면 균등 분배한다. 나누어떨어지지 않는
 *     나머지 칩은 딜러 다음 좌석부터 시계방향으로 1칩씩 준다.
 *   · 폴드가 이어져 남은 참가자가 1명이 되면 즉시 그 사람이 팟 전부를 가져가고
 *     패는 공개하지 않는다.
 *   · 다음 판: 딜러는 칩이 남은 다음 좌석으로 이동한다. 칩이 0인 좌석은
 *     그 판에 참가하지 않고(파산) 카드도 받지 않는다.
 *     칩을 가진 좌석이 1명만 남으면 매치 종료(최종 우승).
 *   · 접속 종료(퇴장)는 leave() 로 처리한다. 진행 중이면 자동 다이,
 *     남은 칩은 게임에서 빠진다(칩 총량 보존이 깨지는 유일한 경우).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cards.js'));
  } else {
    root.SevenPoker = factory(root.Cards);
  }
})(typeof self !== 'undefined' ? self : this, function (Cards) {
  'use strict';

  var ANTE = 10;              // 앤티 = 삥의 크기 = 최소 베팅
  var MAX_RAISES = 4;         // 라운드당 레이즈 상한
  var START_CHIPS = 1000;     // 매치 시작 칩
  var MAX_PLAYERS = 6;        // 한 테이블 최대 인원

  // 상태는 순수 JSON (카드/숫자/불리언/배열) 이라 이 복사로 충분하다.
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fill(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }

  // 딜러(from) 다음 좌석부터 시계방향 전체 순서 (마지막이 from 자신)
  function seatOrder(n, from) {
    var list = [];
    for (var k = 1; k <= n; k++) list.push((from + k) % n);
    return list;
  }

  // ── 생성 ───────────────────────────────────────────────
  function createHand(opts) {
    opts = opts || {};
    var i;
    var deckOrder = (opts.deckOrder || Cards.makeDeck()).slice();
    var n = opts.players | 0;
    if (!n) n = (opts.chips && opts.chips.length) ? opts.chips.length : 2;
    if (n < 2) n = 2;
    if (n > MAX_PLAYERS) n = MAX_PLAYERS;
    var chips = [];
    for (i = 0; i < n; i++) {
      chips.push(opts.chips && typeof opts.chips[i] === 'number' ? opts.chips[i] : START_CHIPS);
    }
    var left = [];
    for (i = 0; i < n; i++) left.push(!!(opts.left && opts.left[i]));
    // 칩이 없는 좌석은 이번 판에 참가하지 않는다 (파산/퇴장)
    var out = [];
    for (i = 0; i < n; i++) out.push(chips[i] <= 0);
    var dealer = opts.dealer | 0;
    if (dealer < 0 || dealer >= n) dealer = 0;
    if (out[dealer]) {
      var ord = seatOrder(n, dealer);
      for (i = 0; i < ord.length; i++) if (!out[ord[i]]) { dealer = ord[i]; break; }
    }
    var hands = [];
    for (i = 0; i < n; i++) hands.push({ cards: [], buried: null });

    var s = {
      handNo: opts.handNo || 1,
      players: n,
      deck: deckOrder,
      dealtCount: 0,          // 덱에서 뽑아 쓴 장수
      dealer: dealer,
      chips: chips,
      pot: 0,
      committed: fill(n, 0),  // 이번 판에 넣은 총액 (사이드 팟/반환 계산용)
      bets: fill(n, 0),       // 이번 라운드에 넣은 금액
      acted: fill(n, false),  // 이번 라운드에 액션했는지
      raises: 0,
      lastRaise: 0,           // 직전 베팅/레이즈 크기 (따당 계산용)
      round: 0,               // 1..4 (베팅 라운드 번호)
      street: 4,              // 각자에게 배분된 카드 장수 (4 → 7)
      hands: hands,
      phase: 'discard',       // discard | open | bet | showdown | folded
      toAct: null,
      folded: out.slice(),    // 파산/퇴장 좌석은 처음부터 판 밖
      allIn: fill(n, false),
      out: out,               // 파산(칩 0) — 이번 판 미참가
      left: left,             // 퇴장(접속 종료)
      revealed: false,        // 쇼다운으로 패가 공개됐는지
      over: false,
      result: null,
      matchOver: false,
      matchWinner: null,
      log: []
    };
    emit(s, { t: 'hand', no: s.handNo, dealer: dealer, players: n });
    // 앤티 (칩이 모자라면 남은 전부)
    for (i = 0; i < n; i++) {
      if (s.out[i]) continue;
      payIn(s, i, ANTE);
      emit(s, { t: 'ante', p: i, amount: s.committed[i] });
    }
    s.bets = fill(n, 0);      // 앤티는 베팅 라운드의 일부가 아니다
    // 4장씩 배분: 딜러 다음 좌석부터 한 장씩 돌아가며
    var order = seatOrder(n, dealer);
    for (var k = 0; k < 4; k++) {
      for (i = 0; i < order.length; i++) {
        if (!s.out[order[i]]) dealTo(s, order[i], false);
      }
    }
    return s;
  }

  function emit(s, ev) { s.log.push(ev); return ev; }

  function dealTo(s, p, open) {
    var card = s.deck[s.dealtCount++];
    if (!card) throw new Error('덱 소진');
    s.hands[p].cards.push({ r: card.r, s: card.s, open: !!open });
    return card;
  }

  // 칩을 팟에 넣는다(스택 상한 → 올인). 실제로 들어간 금액 반환.
  function payIn(s, p, amount) {
    var amt = Math.max(0, Math.min(amount, s.chips[p]));
    s.chips[p] -= amt;
    s.committed[p] += amt;
    s.bets[p] += amt;
    s.pot += amt;
    if (s.chips[p] === 0) s.allIn[p] = true;
    return amt;
  }

  // ── 조회 헬퍼 ──────────────────────────────────────────
  function activeSeats(s) {
    var a = [];
    for (var i = 0; i < s.players; i++) if (!s.folded[i]) a.push(i);
    return a;
  }
  function canAct(s, p) { return !s.folded[p] && !s.allIn[p]; }
  function maxBet(s) {
    var m = 0;
    for (var i = 0; i < s.players; i++) if (!s.folded[i] && s.bets[i] > m) m = s.bets[i];
    return m;
  }
  function toCall(s, p) { return Math.max(0, maxBet(s) - s.bets[p]); }
  function isHandOver(s) { return !!s.over; }
  function openCards(s, p) {
    return s.hands[p].cards.filter(function (c) { return c.open; })
      .map(function (c) { return c.r; })
      .sort(function (a, b) { return b - a; });
  }
  // 오픈 카드 비교 (a 가 높으면 1, 낮으면 -1, 완전 동점이면 0)
  function cmpOpen(s, a, b) {
    var x = openCards(s, a), y = openCards(s, b);
    var n = Math.max(x.length, y.length);
    for (var i = 0; i < n; i++) {
      var u = x[i] || 0, v = y[i] || 0;
      if (u !== v) return u > v ? 1 : -1;
    }
    return 0;
  }
  // 오픈 카드가 가장 높은 좌석이 선. 완전 동점이면 좌석 번호가 작은 쪽.
  // 그 좌석이 올인이면 시계방향 다음 액션 가능 좌석.
  function firstToAct(s) {
    var act = activeSeats(s);
    if (!act.length) return null;
    var best = act[0];
    for (var k = 1; k < act.length; k++) {
      if (cmpOpen(s, act[k], best) > 0) best = act[k];
    }
    return canAct(s, best) ? best : nextActor(s, best);
  }
  function nextActor(s, from) {
    for (var k = 1; k <= s.players; k++) {
      var i = (from + k) % s.players;
      if (canAct(s, i)) return i;
    }
    return null;
  }
  function hasDiscarded(s, p) { return s.hands[p].buried !== null; }
  function hasOpened(s, p) {
    return s.hands[p].cards.some(function (c) { return c.open; });
  }
  // 폴드/파산 좌석은 "이미 끝난 것"으로 본다 (단계 진행 판정용)
  function discardDone(s, p) { return s.folded[p] || hasDiscarded(s, p); }
  function openDone(s, p) { return s.folded[p] || hasOpened(s, p); }
  function allDone(s, fn) {
    for (var i = 0; i < s.players; i++) if (!fn(s, i)) return false;
    return true;
  }

  // ── 액션 목록 (UI 버튼 + 합법성 판정의 단일 출처) ────────
  function actionOptions(s, p) {
    if (!s || p < 0 || p >= s.players) return [];
    var can = s.phase === 'bet' && !s.over && s.toAct === p;
    var tc = toCall(s, p);
    var chips = s.chips[p];
    // 레이즈는 "응답할 수 있는 상대"가 최소 한 명 있어야 의미가 있다
    var canRespond = activeSeats(s).some(function (i) { return i !== p && !s.allIn[i]; });
    var roomToRaise = s.raises < MAX_RAISES && canRespond && chips > tc;
    var half = Math.max(ANTE, Math.floor(s.pot / 2));
    var td = s.lastRaise * 2;
    return [
      { type: 'check', label: '체크', amount: 0, enabled: can && tc === 0 },
      {
        type: 'bbing', label: '삥', amount: Math.min(ANTE, chips),
        enabled: can && tc === 0 && s.lastRaise === 0 && roomToRaise
      },
      { type: 'call', label: '콜', amount: Math.min(tc, chips), enabled: can && tc > 0 && chips > 0 },
      { type: 'half', label: '하프', amount: Math.min(tc + half, chips), enabled: can && roomToRaise },
      {
        type: 'ttadang', label: '따당', amount: Math.min(tc + td, chips),
        enabled: can && s.lastRaise > 0 && roomToRaise
      },
      { type: 'die', label: '다이', amount: 0, enabled: can }
    ];
  }
  function findOption(s, p, type) {
    var list = actionOptions(s, p);
    for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
    return null;
  }

  // ── 액션 적용 ──────────────────────────────────────────
  // 반환: { state, events } — 불법이면 { state(원본), events: [], error }
  function apply(state, p, action) {
    if (!state || state.over) return err(state, '이미 끝난 판입니다');
    if (typeof p !== 'number' || p < 0 || p >= state.players) return err(state, '잘못된 플레이어');
    if (!action || typeof action.type !== 'string') return err(state, '잘못된 액션');
    if (state.folded[p]) return err(state, '이미 판에서 빠졌습니다');
    var s = clone(state);
    var from = s.log.length;
    var t = action.type;

    if (t === 'discard') {
      if (s.phase !== 'discard') return err(state, '지금은 카드를 버릴 수 없습니다');
      if (hasDiscarded(s, p)) return err(state, '이미 카드를 버렸습니다');
      var di = action.index | 0;
      if (di < 0 || di >= s.hands[p].cards.length) return err(state, '잘못된 카드 번호');
      var burned = s.hands[p].cards.splice(di, 1)[0];
      s.hands[p].buried = { r: burned.r, s: burned.s };
      emit(s, { t: 'discard', p: p });
      if (allDone(s, discardDone)) s.phase = 'open';
      return done(state, s, from);
    }

    if (t === 'open') {
      if (s.phase !== 'open') return err(state, '지금은 카드를 오픈할 수 없습니다');
      if (hasOpened(s, p)) return err(state, '이미 카드를 오픈했습니다');
      var oi = action.index | 0;
      if (oi < 0 || oi >= s.hands[p].cards.length) return err(state, '잘못된 카드 번호');
      s.hands[p].cards[oi].open = true;
      emit(s, { t: 'open', p: p, card: { r: s.hands[p].cards[oi].r, s: s.hands[p].cards[oi].s } });
      if (allDone(s, openDone)) beginRound(s);
      return done(state, s, from);
    }

    if (t === 'nextHand') return err(state, '아직 판이 끝나지 않았습니다');

    // ── 베팅 액션 ──
    if (s.phase !== 'bet') return err(state, '지금은 베팅할 수 없습니다');
    if (s.toAct !== p) return err(state, '당신의 차례가 아닙니다');
    var opt = findOption(s, p, t);
    if (!opt) return err(state, '알 수 없는 액션');
    if (!opt.enabled) return err(state, '지금 할 수 없는 액션입니다');

    if (t === 'die') {
      emit(s, { t: 'act', p: p, action: 'die', amount: 0, allIn: false });
      foldSeat(s, p);
      return done(state, s, from);
    }

    if (t === 'check') {
      emit(s, { t: 'act', p: p, action: 'check', amount: 0, allIn: false });
      afterPassive(s, p);
      return done(state, s, from);
    }

    if (t === 'call') {
      var paidC = payIn(s, p, opt.amount);
      emit(s, { t: 'act', p: p, action: 'call', amount: paidC, allIn: s.allIn[p] });
      afterPassive(s, p);
      return done(state, s, from);
    }

    // 삥 / 하프 / 따당 = 공격적 액션
    var before = toCall(s, p);
    var paid = payIn(s, p, opt.amount);
    var raisePart = Math.max(0, paid - before);
    if (raisePart > 0) {
      s.raises += 1;
      s.lastRaise = raisePart;
    }
    emit(s, { t: 'act', p: p, action: t, amount: paid, allIn: s.allIn[p] });
    if (raisePart > 0) {
      // 나머지 좌석이 다시 응답해야 한다
      s.acted = fill(s.players, false);
      s.acted[p] = true;
      s.toAct = nextActor(s, p);
      if (s.toAct === null) closeRound(s);
    } else {
      // 올인이라 레이즈가 되지 못하고 콜에 그친 경우
      afterPassive(s, p);
    }
    return done(state, s, from);
  }

  function err(state, message) { return { state: state, events: [], error: message }; }
  function done(state, s, from) { return { state: s, events: s.log.slice(from) }; }

  // 체크/콜 뒤 라운드 종료 판정
  function afterPassive(s, p) {
    s.acted[p] = true;
    if (roundClosed(s)) closeRound(s);
    else s.toAct = nextActor(s, p);
  }

  // 액션 가능한 모든 좌석이 액션했고 베팅액이 같아졌는가
  function roundClosed(s) {
    var act = activeSeats(s);
    if (act.length <= 1) return true;
    var m = maxBet(s);
    for (var k = 0; k < act.length; k++) {
      var i = act[k];
      if (s.allIn[i]) continue;         // 올인은 더 낼 수 없다
      if (!s.acted[i] || s.bets[i] !== m) return false;
    }
    return true;
  }

  // 폴드 처리 (다이/퇴장 공용)
  function foldSeat(s, p) {
    s.folded[p] = true;
    var act = activeSeats(s);
    if (act.length <= 1) {
      finishByFold(s, act.length ? act[0] : null, p);
      return;
    }
    if (s.phase === 'bet') {
      s.acted[p] = true;
      if (roundClosed(s)) closeRound(s);
      else if (s.toAct === p) s.toAct = nextActor(s, p);
    } else if (s.phase === 'discard') {
      if (allDone(s, discardDone)) s.phase = 'open';
    } else if (s.phase === 'open') {
      if (allDone(s, openDone)) beginRound(s);
    }
  }

  // 매칭되지 않은 초과분 반환 (언콜드 벳). 남아 있는 참가자 기준으로
  // 1등 기여액이 2등보다 크면 그 차액은 아무도 받을 수 없는 돈이다.
  function refundExcess(s) {
    var act = activeSeats(s);
    if (act.length <= 1) return;
    var sorted = act.slice().sort(function (a, b) { return s.committed[b] - s.committed[a]; });
    var hi = sorted[0];
    var d = s.committed[hi] - s.committed[sorted[1]];
    if (d <= 0) return;
    s.chips[hi] += d;
    s.pot -= d;
    s.committed[hi] -= d;
    emit(s, { t: 'refund', p: hi, amount: d });
  }

  function closeRound(s) {
    refundExcess(s);
    s.toAct = null;
    if (s.street >= 7) { showdown(s); return; }
    // 다음 카드 배분 (5,6번째는 오픈 / 7번째는 히든), 딜러 다음 좌석부터
    s.street += 1;
    var open = s.street === 5 || s.street === 6;
    var cards = [];
    seatOrder(s.players, s.dealer).forEach(function (i) {
      if (s.folded[i]) return;             // 폴드한 좌석은 더 받지 않는다
      var c = dealTo(s, i, open);
      cards[i] = open ? { r: c.r, s: c.s } : null;
    });
    emit(s, { t: 'deal', street: s.street, open: open, cards: cards });
    beginRound(s);
  }

  // 베팅 라운드 시작. 액션 가능한 좌석이 1명 이하면 베팅 없이 다음 카드로.
  function beginRound(s) {
    s.bets = fill(s.players, 0);
    s.acted = fill(s.players, false);
    s.raises = 0;
    s.lastRaise = 0;
    var able = activeSeats(s).filter(function (i) { return !s.allIn[i]; });
    if (able.length <= 1) { closeRound(s); return; }
    s.phase = 'bet';
    s.round = s.street - 3;      // 4장 → 1라운드, 7장 → 4라운드
    s.toAct = firstToAct(s);
    emit(s, { t: 'round', n: s.round });
  }

  // ── 종료 ───────────────────────────────────────────────
  function finishByFold(s, w, folder) {
    var amount = s.pot;
    var payouts = fill(s.players, 0);
    if (w !== null) {
      s.chips[w] += amount;
      payouts[w] = amount;
    }
    s.pot = 0;
    s.phase = 'folded';
    s.toAct = null;
    s.over = true;
    s.revealed = false;
    s.result = {
      winner: w, split: false, amount: amount, folded: folder,
      revealed: false, hands: fill(s.players, null),
      pots: [], payouts: payouts
    };
    emit(s, { t: 'fold', p: folder, winner: w, amount: amount });
    settleEnd(s);
  }

  function bestOf(s, p) {
    var cards = s.hands[p].cards.map(function (c) { return { r: c.r, s: c.s }; });
    var res = Cards.evalBest5(cards);
    return { cat: res.cat, tiebreak: res.tiebreak, name: Cards.catName(res.cat) };
  }

  // 사이드 팟 층 계산. committed 기준(반환 이후)이라 "실제로 매칭된 돈"만 남는다.
  function buildPots(s) {
    var i, levels = [];
    for (i = 0; i < s.players; i++) {
      if (s.committed[i] > 0 && levels.indexOf(s.committed[i]) === -1) levels.push(s.committed[i]);
    }
    levels.sort(function (a, b) { return a - b; });
    var pots = [], prev = 0;
    levels.forEach(function (L) {
      var amount = 0, elig = [];
      for (i = 0; i < s.players; i++) {
        var c = Math.min(s.committed[i], L) - Math.min(s.committed[i], prev);
        if (c > 0) amount += c;
        if (s.committed[i] >= L && !s.folded[i]) elig.push(i);
      }
      if (amount > 0) pots.push({ amount: amount, eligible: elig, winners: [] });
      prev = L;
    });
    // 자격자가 없는 층(그 층까지 낸 사람이 전부 폴드)은 바로 아래 층에 합친다.
    // (위 층의 자격자는 아래 층에서도 자격이 있으므로 이런 층은 항상 맨 위에 생긴다)
    for (i = pots.length - 1; i >= 0; i--) {
      if (pots[i].eligible.length === 0) {
        if (i > 0) pots[i - 1].amount += pots[i].amount;
        pots.splice(i, 1);
      }
    }
    return pots;
  }

  function showdown(s) {
    var i, k;
    var act = activeSeats(s);
    var hands = fill(s.players, null);
    act.forEach(function (p) { hands[p] = bestOf(s, p); });

    var pots = buildPots(s);
    var payouts = fill(s.players, 0);
    var total = 0;
    pots.forEach(function (layer) {
      var winners = [];
      layer.eligible.forEach(function (p) {
        if (!hands[p]) return;
        if (!winners.length) { winners = [p]; return; }
        var c = Cards.compareHands(hands[p], hands[winners[0]]);
        if (c > 0) winners = [p];
        else if (c === 0) winners.push(p);
      });
      if (!winners.length) return;
      layer.winners = winners;
      var share = Math.floor(layer.amount / winners.length);
      var rem = layer.amount - share * winners.length;
      winners.forEach(function (w) { payouts[w] += share; });
      // 나머지 칩은 딜러 다음 좌석부터 시계방향으로 1칩씩
      var ord = seatOrder(s.players, s.dealer).filter(function (x) {
        return winners.indexOf(x) !== -1;
      });
      for (k = 0; k < rem; k++) payouts[ord[k % ord.length]] += 1;
      total += layer.amount;
    });
    for (i = 0; i < s.players; i++) s.chips[i] += payouts[i];

    var paid = [];
    for (i = 0; i < s.players; i++) if (payouts[i] > 0) paid.push(i);
    var winner = paid.length === 1 ? paid[0] : null;
    var split = paid.length > 1;

    s.pot = 0;
    s.phase = 'showdown';
    s.toAct = null;
    s.over = true;
    s.revealed = true;
    s.result = {
      winner: winner, split: split, amount: total, folded: null,
      revealed: true, hands: hands, pots: pots, payouts: payouts
    };
    var cats = fill(s.players, null);
    for (i = 0; i < s.players; i++) if (hands[i]) cats[i] = hands[i].cat;
    emit(s, {
      t: 'showdown', winner: winner, split: split, amount: total,
      cats: cats, winners: paid
    });
    settleEnd(s);
  }

  // 판이 끝난 직후: 파산 표시 + 매치 종료 판정
  function settleEnd(s) {
    for (var i = 0; i < s.players; i++) {
      if (!s.out[i] && !s.left[i] && s.chips[i] <= 0) emit(s, { t: 'bust', p: i });
    }
    checkMatchOver(s);
  }

  // 칩을 가진 좌석이 1명 이하가 되면 매치 종료
  function checkMatchOver(s) {
    if (s.matchOver) return;
    var alive = [];
    for (var i = 0; i < s.players; i++) if (s.chips[i] > 0) alive.push(i);
    if (alive.length <= 1) {
      s.matchOver = true;
      s.matchWinner = alive.length ? alive[0] : null;
      emit(s, { t: 'match', winner: s.matchWinner });
    }
  }

  // ── 퇴장 (접속 종료) ───────────────────────────────────
  // 진행 중이면 자동 다이 + 남은 칩은 게임에서 제거한다.
  function leave(state, seat) {
    if (!state) return { error: '상태 없음' };
    if (typeof seat !== 'number' || seat < 0 || seat >= state.players) {
      return { error: '잘못된 좌석' };
    }
    if (state.left[seat]) return { state: state, events: [] };
    var s = clone(state);
    var from = s.log.length;
    s.left[seat] = true;
    s.chips[seat] = 0;
    emit(s, { t: 'leave', p: seat });
    if (!s.over && !s.folded[seat]) foldSeat(s, seat);
    if (s.over) checkMatchOver(s);
    return { state: s, events: s.log.slice(from) };
  }

  // ── 다음 판 ────────────────────────────────────────────
  // 딜러는 칩이 남은 다음 좌석으로. 칩 승계 + 재앤티.
  function nextHand(state, deckOrder) {
    if (!state) return { error: '상태 없음' };
    if (!state.over) return { error: '아직 판이 끝나지 않았습니다' };
    if (state.matchOver) return { error: '매치가 종료되었습니다' };
    var n = state.players;
    var dealer = state.dealer;
    var ord = seatOrder(n, state.dealer);
    for (var i = 0; i < ord.length; i++) {
      if (state.chips[ord[i]] > 0) { dealer = ord[i]; break; }
    }
    return createHand({
      deckOrder: deckOrder || Cards.makeDeck(),
      players: n,
      chips: state.chips.slice(),
      left: state.left.slice(),
      dealer: dealer,
      handNo: state.handNo + 1
    });
  }

  // ── 시점별 뷰 ──────────────────────────────────────────
  // p 의 시점. 다른 좌석의 히든/매장 카드는 null, 덱은 통째로 제거한다.
  // p 가 좌석 번호가 아니면 모두 가린다
  // (로컬 핫시트에서 "차례 넘기기" 화면에 쓴다).
  function viewFor(state, p) {
    var v = clone(state);
    delete v.deck;
    v.deckLeft = state.deck.length - state.dealtCount;
    var mine = (typeof p === 'number' && p >= 0 && p < state.players) ? p : null;
    v.me = mine;
    for (var q = 0; q < state.players; q++) {
      var own = (q === mine);
      var reveal = own || (state.revealed && !state.folded[q]);
      if (!reveal) {
        v.hands[q].cards = v.hands[q].cards.map(function (c) {
          return c.open ? c : null;
        });
      }
      if (!own) v.hands[q].buried = null;
    }
    v.options = mine === null ? [] : actionOptions(state, mine);
    return v;
  }

  // ── 로그 문구 ──────────────────────────────────────────
  var ACT_LABEL = {
    check: '체크', bbing: '삥', call: '콜', half: '하프', ttadang: '따당', die: '다이'
  };
  function defaultNames(n) {
    var a = [];
    for (var i = 0; i < (n || 2); i++) a.push('P' + (i + 1));
    return a;
  }
  function describeEvent(ev, names) {
    var N = names || defaultNames(ev && ev.players);
    function nm(i) { return N[i] || ('P' + (i + 1)); }
    switch (ev.t) {
      case 'hand': return ev.no + '판 시작 (딜러: ' + nm(ev.dealer) + ')';
      case 'ante': return nm(ev.p) + ' 앤티 ' + ev.amount;
      case 'discard': return nm(ev.p) + ' 카드 매장';
      case 'open': return nm(ev.p) + ' 오픈 ' + Cards.cardText(ev.card);
      case 'round': return ev.n + '라운드 베팅';
      case 'deal': {
        if (!ev.open) return ev.street + '번째 카드 (히든)';
        var parts = [];
        (ev.cards || []).forEach(function (c) { if (c) parts.push(Cards.cardText(c)); });
        return ev.street + '번째 카드 ' + parts.join(' / ');
      }
      case 'act':
        return nm(ev.p) + ' ' + (ACT_LABEL[ev.action] || ev.action) +
          (ev.amount ? ' (' + ev.amount + ')' : '') + (ev.allIn ? ' 올인' : '');
      case 'refund': return nm(ev.p) + ' 초과분 ' + ev.amount + ' 반환';
      case 'fold':
        return ev.winner === null ? nm(ev.p) + ' 다이'
          : nm(ev.winner) + ' 승 (다른 참가자 다이) +' + ev.amount;
      case 'showdown': {
        if (ev.split) {
          var ws = (ev.winners || []).map(nm).join(', ');
          return '쇼다운: 팟 분배 (' + ws + ')';
        }
        return '쇼다운: ' + nm(ev.winner) + ' 승 (' +
          Cards.catName(ev.cats[ev.winner]) + ') +' + ev.amount;
      }
      case 'bust': return nm(ev.p) + ' 파산';
      case 'leave': return nm(ev.p) + ' 퇴장';
      case 'match': return '매치 종료 — ' + nm(ev.winner) + ' 최종 우승';
      default: return '';
    }
  }

  return {
    ANTE: ANTE,
    MAX_RAISES: MAX_RAISES,
    START_CHIPS: START_CHIPS,
    MAX_PLAYERS: MAX_PLAYERS,
    createHand: createHand,
    apply: apply,
    leave: leave,
    viewFor: viewFor,
    nextHand: nextHand,
    isHandOver: isHandOver,
    actionOptions: actionOptions,
    activeSeats: activeSeats,
    toCall: toCall,
    firstToAct: firstToAct,
    hasDiscarded: hasDiscarded,
    hasOpened: hasOpened,
    describeEvent: describeEvent
  };
});
