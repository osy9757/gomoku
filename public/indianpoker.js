/*
 * indianpoker.js — 인디언포커(2~6인) 결정적 상태 기계
 * 브라우저(window.IndianPoker)와 Node(require)에서 함께 쓰는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크/난수 의존 없음).
 *   - 온라인: 서버가 이 엔진을 돌리고 각 클라이언트에는 viewFor() 결과만 보낸다.
 *   - 로컬(핫시트): 클라이언트가 같은 엔진을 직접 돌린다.
 * 셔플은 호출자 책임(createHand 에 이미 섞인 덱을 넘긴다) → 엔진은 완전히 결정적.
 *
 * 칩·팟·베팅 규칙은 세븐포커와 완전히 같다. 그래서 그 부분은 새로 쓰지 않고
 * sevenpoker.js 가 내보내는 betting 헬퍼를 그대로 공유한다(단일 출처).
 * 이 파일이 책임지는 것은 "카드 규칙" 뿐이다.
 *
 * ── 카드 ──────────────────────────────────────────────
 *   덱 = 1~10 두 벌 = 20장. 무늬가 없으므로 카드는 { r: 1..10 } 하나뿐이다.
 *   각자 딱 한 장을 받는다. 그리고 이 게임의 핵심:
 *     "남의 카드는 다 보이지만 내 카드만 못 본다" (포커와 정반대 마스킹)
 *
 * ── 진행 ──────────────────────────────────────────────
 *   1) 앤티 10씩 자동 → 팟 = 10 x 참가 인원
 *   2) 딜러 다음 좌석부터 시계방향으로 한 장씩 (총 1장씩)
 *   3) 베팅 1라운드 — 선은 딜러 왼쪽(시계방향 다음) 좌석
 *   4) 쇼다운: 숫자가 가장 높은 사람이 이긴다
 *
 * ── 규칙 결정 사항 (문서화) ───────────────────────────
 *   · 액션(체크/삥/콜/하프/따당/다이)의 금액 산식과 라운드당 레이즈 4회 상한,
 *     올인 캡 · 언콜드 벳 반환 · 사이드 팟 층 계산은 세븐포커와 동일하다.
 *   · 베팅은 단 한 라운드다. 액션 가능한 좌석이 1명 이하가 되면(전원 올인 등)
 *     베팅 없이 곧바로 쇼다운으로 간다.
 *   · 다이가 이어져 남은 참가자가 1명이 되면 그 사람이 팟 전부를 가져가고
 *     카드는 공개하지 않는다. 인디언포커에서 "공개하지 않는다"는 곧
 *     "승자도 자기 카드가 무엇이었는지 끝내 알 수 없다" 는 뜻이다
 *     (남의 카드는 판 내내 공개돼 있었으므로 새로 공개할 것이 없다).
 *   · 쇼다운은 숫자만 비교한다. 무늬가 없으므로 같은 숫자면 무조건 분배이고,
 *     나누어떨어지지 않는 나머지 칩은 딜러 다음 좌석부터 시계방향으로 1칩씩 준다.
 *   · [10 폴드 벌칙] 10 을 들고 다이하면 판이 끝날 때 그 사실이 공개되고
 *     벌금 10 을 팟에 더 낸다(남은 칩보다 많으면 남은 칩 전부). 벌금은 팟이
 *     지급되기 "전"에 더해지므로 그대로 승자에게 간다. 벌금을 낸 사람은
 *     그 시점에 자기 카드가 10 이었다는 것을 알게 되므로 본인 시점에서도 공개된다.
 *     퇴장(leave)으로 자동 다이된 좌석은 이미 칩을 회수했으므로 벌칙에서 제외한다.
 *   · 다음 판: 딜러는 칩이 남은 다음 좌석으로 이동한다. 칩이 0인 좌석은
 *     그 판에 참가하지 않고(파산) 카드도 받지 않는다.
 *     칩을 가진 좌석이 1명만 남으면 매치 종료(최종 우승).
 *   · 로그에는 판이 끝나기 전까지 어떤 카드 값도 담기지 않는다.
 *     (로그는 전원에게 그대로 방송되므로, 값이 담기면 "내 카드"가 새어 나간다)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sevenpoker.js'));
  } else {
    root.IndianPoker = factory(root.SevenPoker);
  }
})(typeof self !== 'undefined' ? self : this, function (Poker) {
  'use strict';

  var B = Poker.betting;            // 베팅 공용 헬퍼 (세븐포커와 공유)
  var ANTE = B.ANTE;                // 10
  var MAX_RAISES = B.MAX_RAISES;    // 4
  var START_CHIPS = B.START_CHIPS;  // 1000
  var MAX_PLAYERS = B.MAX_PLAYERS;  // 6
  var MIN_CARD = 1, MAX_CARD = 10;
  var PENALTY_CARD = 10;            // 이 카드를 들고 다이하면
  var PENALTY = 10;                 // 이만큼 벌금

  var clone = B.clone, fill = B.fill, emit = B.emit;
  var seatOrder = B.seatOrder, activeSeats = B.activeSeats, canAct = B.canAct;
  var nextActor = B.nextActor, payIn = B.payIn;

  // 1~10 두 벌 = 20장. 무늬가 없으므로 { r } 만 갖는다.
  function makeDeck() {
    var deck = [];
    for (var k = 0; k < 2; k++) {
      for (var v = MIN_CARD; v <= MAX_CARD; v++) deck.push({ r: v });
    }
    return deck;
  }

  // ── 생성 ───────────────────────────────────────────────
  function createHand(opts) {
    opts = opts || {};
    var i;
    var deckOrder = (opts.deckOrder || makeDeck()).slice();
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
      dealtCount: 0,
      dealer: dealer,
      chips: chips,
      pot: 0,
      committed: fill(n, 0),
      bets: fill(n, 0),
      acted: fill(n, false),
      raises: 0,
      lastRaise: 0,
      round: 1,               // 베팅 라운드는 하나뿐이다
      street: 1,              // 각자에게 배분된 카드 장수 (항상 1)
      hands: hands,
      phase: 'bet',           // bet | showdown | folded
      toAct: null,
      folded: out.slice(),    // 파산/퇴장 좌석은 처음부터 판 밖
      allIn: fill(n, false),
      out: out,
      left: left,
      penalized: fill(n, false),  // 10 벌칙을 받은 좌석 (본인에게만 카드 공개)
      revealed: false,
      over: false,
      result: null,
      matchOver: false,
      matchWinner: null,
      log: []
    };

    // 앤티 (칩이 모자라면 남은 전부)
    var seats = 0;
    for (i = 0; i < n; i++) {
      if (s.out[i]) continue;
      payIn(s, i, ANTE);
      seats += 1;
    }
    s.bets = fill(n, 0);      // 앤티는 베팅 라운드의 일부가 아니다
    emit(s, {
      t: 'hand', no: s.handNo, dealer: dealer, players: n,
      ante: ANTE, seats: seats, total: s.pot
    });
    // 한 장씩 배분: 딜러 다음 좌석부터 시계방향
    seatOrder(n, dealer).forEach(function (p) {
      if (!s.out[p]) dealTo(s, p);
    });
    emit(s, { t: 'deal' });   // 카드 값은 절대 로그에 담지 않는다
    beginRound(s);
    return s;
  }

  function dealTo(s, p) {
    var card = s.deck[s.dealtCount++];
    if (!card) throw new Error('덱 소진');
    s.hands[p].cards.push({ r: card.r });
    return card;
  }

  // 좌석의 카드 값 (없으면 null)
  function cardOf(s, p) {
    var h = s.hands[p];
    return (h && h.cards[0]) ? h.cards[0].r : null;
  }

  // ── 조회 헬퍼 ──────────────────────────────────────────
  function isHandOver(s) { return !!(s && s.over); }
  function toCall(s, p) { return B.toCall(s, p); }
  function actionOptions(s, p) { return B.actionOptions(s, p); }

  // 선(先) = 딜러 왼쪽(시계방향 다음) 좌석. 액션할 수 없으면 그 다음 좌석.
  function firstToAct(s) {
    var ord = seatOrder(s.players, s.dealer);
    for (var i = 0; i < ord.length; i++) if (canAct(s, ord[i])) return ord[i];
    return null;
  }

  // ── 액션 적용 ──────────────────────────────────────────
  // 반환: { state, events } — 불법이면 { state(원본), events: [], error }
  function apply(state, p, action) {
    if (!state || state.over) return err(state, '이미 끝난 판입니다');
    if (typeof p !== 'number' || p < 0 || p >= state.players) return err(state, '잘못된 플레이어');
    if (!action || typeof action.type !== 'string') return err(state, '잘못된 액션');
    if (state.folded[p]) return err(state, '이미 판에서 빠졌습니다');
    if (action.type === 'nextHand') return err(state, '아직 판이 끝나지 않았습니다');
    var s = clone(state);
    var from = s.log.length;
    var t = action.type;

    if (s.phase !== 'bet') return err(state, '지금은 베팅할 수 없습니다');
    if (s.toAct !== p) return err(state, '당신의 차례가 아닙니다');
    var opt = B.findOption(s, p, t);
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

  function afterPassive(s, p) {
    s.acted[p] = true;
    if (B.roundClosed(s)) closeRound(s);
    else s.toAct = nextActor(s, p);
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
      if (B.roundClosed(s)) closeRound(s);
      else if (s.toAct === p) s.toAct = nextActor(s, p);
    }
  }

  // 베팅 라운드 시작. 액션 가능한 좌석이 1명 이하면 베팅 없이 쇼다운으로.
  function beginRound(s) {
    s.bets = fill(s.players, 0);
    s.acted = fill(s.players, false);
    s.raises = 0;
    s.lastRaise = 0;
    var act = activeSeats(s);
    if (act.length <= 1) { finishByFold(s, act.length ? act[0] : null, null); return; }
    var able = act.filter(function (i) { return !s.allIn[i]; });
    if (able.length <= 1) { closeRound(s); return; }
    s.phase = 'bet';
    s.toAct = firstToAct(s);
  }

  function closeRound(s) {
    B.refundExcess(s);
    s.toAct = null;
    showdown(s);
  }

  // ── 10 폴드 벌칙 ───────────────────────────────────────
  // 판이 끝나는 시점에 한 번만 적용한다. 벌금은 팟이 지급되기 전에 더해지고,
  // committed 에도 반영되므로 사이드 팟 층 계산에 자연스럽게 흡수된다.
  // (기여자가 폴드한 좌석뿐인 위쪽 층은 buildPots 가 아래 층에 합쳐 준다)
  function applyPenalties(s) {
    var list = [];
    for (var i = 0; i < s.players; i++) {
      if (!s.folded[i] || s.out[i] || s.left[i]) continue;
      if (cardOf(s, i) !== PENALTY_CARD) continue;
      var amt = Math.max(0, Math.min(PENALTY, s.chips[i]));
      s.chips[i] -= amt;
      s.committed[i] += amt;
      s.pot += amt;
      s.penalized[i] = true;
      list.push({ p: i, amount: amt });
      emit(s, { t: 'penalty', p: i, card: PENALTY_CARD, amount: amt });
    }
    return list;
  }

  // ── 종료 ───────────────────────────────────────────────
  // 다이가 이어져 한 명만 남았다 → 팟 전부. 카드는 공개하지 않는다.
  function finishByFold(s, w, folder) {
    var penalties = applyPenalties(s);
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
      revealed: false, cards: fill(s.players, null), hands: fill(s.players, null),
      pots: [], payouts: payouts, penalties: penalties
    };
    emit(s, { t: 'fold', p: folder, winner: w, amount: amount });
    settleEnd(s);
  }

  // 쇼다운: 숫자가 높은 쪽이 이긴다 (동점이면 분배)
  function showdown(s) {
    var i, k;
    var penalties = applyPenalties(s);
    var act = activeSeats(s);
    var cards = fill(s.players, null);
    act.forEach(function (p) { cards[p] = cardOf(s, p); });

    var pots = B.buildPots(s);
    var payouts = fill(s.players, 0);
    var total = 0;
    pots.forEach(function (layer) {
      var winners = [];
      layer.eligible.forEach(function (p) {
        if (cards[p] === null) return;
        if (!winners.length) { winners = [p]; return; }
        if (cards[p] > cards[winners[0]]) winners = [p];
        else if (cards[p] === cards[winners[0]]) winners.push(p);
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
      revealed: true, cards: cards, hands: fill(s.players, null),
      pots: pots, payouts: payouts, penalties: penalties
    };
    emit(s, {
      t: 'showdown', winner: winner, split: split, amount: total,
      cards: cards, winners: paid
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
      deckOrder: deckOrder || makeDeck(),
      players: n,
      chips: state.chips.slice(),
      left: state.left.slice(),
      dealer: dealer,
      handNo: state.handNo + 1
    });
  }

  // ── 시점별 뷰 ──────────────────────────────────────────
  // 포커와 정반대다: "내 카드만" 가리고 남의 카드는 그대로 보여 준다.
  // p 가 좌석 번호가 아니면(null) 전원을 가린다 — 로컬 핫시트의 차례 넘기기 화면.
  function cardVisible(state, q, viewer) {
    if (state.out[q]) return false;             // 카드 자체가 없다
    if (state.revealed) return true;            // 쇼다운 = 전원 공개
    if (viewer === null) return false;          // 가리개 시점 / 다이 종료
    if (q !== viewer) return true;              // 남의 카드는 판 내내 공개
    return !!state.penalized[q];                // 내 카드는 10 벌칙으로만 공개
  }

  function viewFor(state, p) {
    var v = clone(state);
    delete v.deck;
    v.deckLeft = state.deck.length - state.dealtCount;
    var mine = (typeof p === 'number' && p >= 0 && p < state.players) ? p : null;
    v.me = mine;
    for (var q = 0; q < state.players; q++) {
      if (!cardVisible(state, q, mine)) {
        v.hands[q].cards = v.hands[q].cards.map(function () { return null; });
      }
    }
    v.options = mine === null ? [] : actionOptions(state, mine);
    return v;
  }

  // ── 로그 문구 ──────────────────────────────────────────
  // 판이 끝나기 전에는 어떤 문구에도 카드 값이 들어가지 않는다.
  var ACT_LABEL = B.ACT_LABEL;
  function describeEvent(ev, names) {
    if (!ev) return '';
    var N = names || B.defaultNames(ev.players);
    function nm(i) { return N[i] || ('P' + (i + 1)); }
    switch (ev.t) {
      case 'hand':
        return '앤티 ' + ev.ante + ' × ' + ev.seats +
          ' (' + ev.no + '판 · 딜러 ' + nm(ev.dealer) + ')';
      case 'deal': return '각자 1장씩 — 내 카드만 볼 수 없습니다';
      case 'act':
        return nm(ev.p) + ': ' + (ACT_LABEL[ev.action] || ev.action) +
          (ev.amount ? ' (' + ev.amount + ')' : '') + (ev.allIn ? ' 올인' : '');
      case 'refund': return nm(ev.p) + ' 초과분 ' + ev.amount + ' 반환';
      case 'penalty':
        return nm(ev.p) + ', ' + ev.card + '을 들고 다이! 벌금 ' + ev.amount;
      case 'fold':
        return ev.winner === null ? nm(ev.p) + ' 다이'
          : nm(ev.winner) + ' 승 (다른 참가자 다이) +' + ev.amount;
      case 'showdown': {
        var shown = [];
        (ev.cards || []).forEach(function (c, i) {
          if (c !== null && c !== undefined) shown.push(nm(i) + '(' + c + ')');
        });
        var head = '쇼다운: ' + shown.join(' vs ') + ' → ';
        if (ev.split) return head + '팟 분배 (' + (ev.winners || []).map(nm).join(', ') + ')';
        return head + nm(ev.winner) + ' 승 +' + ev.amount;
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
    PENALTY_CARD: PENALTY_CARD,
    PENALTY: PENALTY,
    makeDeck: makeDeck,
    createHand: createHand,
    apply: apply,
    leave: leave,
    viewFor: viewFor,
    nextHand: nextHand,
    isHandOver: isHandOver,
    actionOptions: actionOptions,
    activeSeats: activeSeats,
    toCall: toCall,
    cardOf: cardOf,
    firstToAct: firstToAct,
    describeEvent: describeEvent
  };
});
