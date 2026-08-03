/*
 * sevenpoker.js — 맞포커(2인 세븐포커) 결정적 상태 기계
 * 브라우저(window.SevenPoker)와 Node(require)에서 함께 쓰는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크/난수 의존 없음).
 *   - 온라인: 서버가 이 엔진을 돌리고 각 클라이언트에는 viewFor() 결과만 보낸다.
 *   - 로컬(핫시트): 클라이언트가 같은 엔진을 직접 돌린다.
 * 셔플은 호출자 책임(createHand 에 이미 섞인 덱을 넘긴다) → 엔진은 완전히 결정적.
 *
 * ── 진행 ──────────────────────────────────────────────
 *   1) 앤티 10씩 자동 → 팟 20
 *   2) 4장씩 배분 (비딜러부터 한 장씩 번갈아)
 *   3) 'discard' — 각자 4장 중 1장을 매장(buried). 서로 순서 무관, 각 1회.
 *   4) 'open'    — 각자 남은 3장 중 1장을 오픈.
 *   5) 베팅 1라운드 → 5번째 카드(오픈) → 2라운드 → 6번째 카드(오픈) →
 *      3라운드 → 7번째 카드(히든) → 4라운드 → 쇼다운
 *   총 7장을 받아 1장은 매장되므로 손에는 6장이 남고, 그 6장 중
 *   최선의 5장으로 승부한다(evalBest5).
 *
 * ── 규칙 결정 사항 (문서화) ───────────────────────────
 *   · 선(먼저 액션)은 매 베팅 라운드마다 "오픈된 카드가 가장 높은 쪽".
 *     오픈 카드를 내림차순으로 늘어놓고 앞에서부터 비교하며, 완전히
 *     동점이면 딜러의 반대편(비딜러)이 먼저 액션한다. 무늬로는 가리지 않는다.
 *   · 삥 = 앤티와 같은 10, 라운드의 첫 베팅으로만 가능.
 *   · 하프 = 콜 금액 + floor(현재 팟 / 2). 최소 10(삥). 팟은 액션 시점 기준이며
 *     이미 이번 라운드에 들어간 칩도 팟에 포함되어 있다.
 *   · 따당 = 콜 금액 + (직전 베팅/레이즈 금액 x 2).
 *   · 레이즈(삥/하프/따당)는 한 라운드에 최대 4회.
 *   · 스택을 넘는 금액은 자동으로 "남은 칩 전부(올인)"가 된다.
 *     한쪽이 올인이면 남은 카드는 베팅 없이 끝까지 배분한다.
 *     매칭되지 않은 초과분은 라운드 종료 시 즉시 반환한다(팟 캡).
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

  // 상태는 순수 JSON (카드/숫자/불리언/배열) 이라 이 복사로 충분하다.
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function other(p) { return p === 0 ? 1 : 0; }

  // ── 생성 ───────────────────────────────────────────────
  function createHand(opts) {
    opts = opts || {};
    var deckOrder = (opts.deckOrder || Cards.makeDeck()).slice();
    var chips = [
      opts.chips ? opts.chips[0] : START_CHIPS,
      opts.chips ? opts.chips[1] : START_CHIPS
    ];
    var dealer = opts.dealer ? 1 : 0;
    var s = {
      handNo: opts.handNo || 1,
      deck: deckOrder,
      dealtCount: 0,          // 덱에서 뽑아 쓴 장수
      dealer: dealer,
      chips: chips,
      pot: 0,
      committed: [0, 0],      // 이번 판에 넣은 총액 (팟 캡/반환 계산용)
      bets: [0, 0],           // 이번 라운드에 넣은 금액
      acted: [false, false],  // 이번 라운드에 액션했는지
      raises: 0,
      lastRaise: 0,           // 직전 베팅/레이즈 크기 (따당 계산용)
      round: 0,               // 1..4 (베팅 라운드 번호)
      street: 4,              // 각자에게 배분된 카드 장수 (4 → 7)
      hands: [
        { cards: [], buried: null },
        { cards: [], buried: null }
      ],
      phase: 'discard',       // discard | open | bet | showdown | folded
      toAct: null,
      folded: [false, false],
      allIn: [false, false],
      revealed: false,        // 쇼다운으로 패가 공개됐는지
      over: false,
      result: null,
      matchOver: false,
      matchWinner: null,
      log: []
    };
    emit(s, { t: 'hand', no: s.handNo, dealer: dealer });
    // 앤티 (칩이 모자라면 남은 전부)
    payIn(s, 0, ANTE);
    payIn(s, 1, ANTE);
    emit(s, { t: 'ante', p: 0, amount: s.committed[0] });
    emit(s, { t: 'ante', p: 1, amount: s.committed[1] });
    s.bets = [0, 0];          // 앤티는 베팅 라운드의 일부가 아니다
    // 4장씩 배분: 비딜러부터 한 장씩 번갈아
    for (var k = 0; k < 4; k++) {
      dealTo(s, other(dealer), false);
      dealTo(s, dealer, false);
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
  function toCall(s, p) { return Math.max(0, s.bets[other(p)] - s.bets[p]); }
  function isHandOver(s) { return !!s.over; }
  function openCards(s, p) {
    return s.hands[p].cards.filter(function (c) { return c.open; })
      .map(function (c) { return c.r; })
      .sort(function (a, b) { return b - a; });
  }
  // 오픈 카드가 높은 쪽이 선. 완전 동점이면 비딜러.
  function firstToAct(s) {
    var a = openCards(s, 0), b = openCards(s, 1);
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x > y ? 0 : 1;
    }
    return other(s.dealer);
  }
  function hasDiscarded(s, p) { return s.hands[p].buried !== null; }
  function hasOpened(s, p) {
    return s.hands[p].cards.some(function (c) { return c.open; });
  }

  // ── 액션 목록 (UI 버튼 + 합법성 판정의 단일 출처) ────────
  function actionOptions(s, p) {
    var can = s.phase === 'bet' && !s.over && s.toAct === p;
    var tc = toCall(s, p);
    var chips = s.chips[p];
    var roomToRaise = s.raises < MAX_RAISES && !s.allIn[other(p)] && chips > tc;
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
    if (p !== 0 && p !== 1) return err(state, '잘못된 플레이어');
    if (!action || typeof action.type !== 'string') return err(state, '잘못된 액션');
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
      if (hasDiscarded(s, 0) && hasDiscarded(s, 1)) s.phase = 'open';
      return done(state, s, from);
    }

    if (t === 'open') {
      if (s.phase !== 'open') return err(state, '지금은 카드를 오픈할 수 없습니다');
      if (hasOpened(s, p)) return err(state, '이미 카드를 오픈했습니다');
      var oi = action.index | 0;
      if (oi < 0 || oi >= s.hands[p].cards.length) return err(state, '잘못된 카드 번호');
      s.hands[p].cards[oi].open = true;
      emit(s, { t: 'open', p: p, card: { r: s.hands[p].cards[oi].r, s: s.hands[p].cards[oi].s } });
      if (hasOpened(s, 0) && hasOpened(s, 1)) beginRound(s);
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
      s.folded[p] = true;
      emit(s, { t: 'act', p: p, action: 'die', amount: 0, allIn: false });
      finishByFold(s, p);
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
      // 상대가 응답해야 한다
      s.acted = [false, false];
      s.acted[p] = true;
      s.toAct = other(p);
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
    var matched = s.bets[0] === s.bets[1];
    var bothActed = s.acted[0] && s.acted[1];
    if (bothActed && (matched || s.allIn[0] || s.allIn[1])) closeRound(s);
    else s.toAct = other(p);
  }

  // 매칭되지 않은 초과분 반환 (팟 캡)
  function refundExcess(s) {
    var d = s.committed[0] - s.committed[1];
    if (d === 0) return;
    var hi = d > 0 ? 0 : 1;
    var amt = Math.abs(d);
    s.chips[hi] += amt;
    s.pot -= amt;
    s.committed[hi] -= amt;
    emit(s, { t: 'refund', p: hi, amount: amt });
  }

  function closeRound(s) {
    refundExcess(s);
    s.toAct = null;
    if (s.street >= 7) { showdown(s); return; }
    // 다음 카드 배분 (5,6번째는 오픈 / 7번째는 히든), 비딜러 먼저
    s.street += 1;
    var open = s.street === 5 || s.street === 6;
    var c0 = dealTo(s, other(s.dealer), open);
    var c1 = dealTo(s, s.dealer, open);
    var cards = [];
    cards[other(s.dealer)] = open ? { r: c0.r, s: c0.s } : null;
    cards[s.dealer] = open ? { r: c1.r, s: c1.s } : null;
    emit(s, { t: 'deal', street: s.street, open: open, cards: cards });
    beginRound(s);
  }

  // 베팅 라운드 시작. 한쪽이라도 올인이면 베팅 없이 다음 카드로 넘어간다.
  function beginRound(s) {
    s.bets = [0, 0];
    s.acted = [false, false];
    s.raises = 0;
    s.lastRaise = 0;
    if (s.allIn[0] || s.allIn[1]) { closeRound(s); return; }
    s.phase = 'bet';
    s.round = s.street - 3;      // 4장 → 1라운드, 7장 → 4라운드
    s.toAct = firstToAct(s);
    emit(s, { t: 'round', n: s.round });
  }

  // ── 종료 ───────────────────────────────────────────────
  function finishByFold(s, p) {
    var w = other(p);
    var amount = s.pot;
    s.chips[w] += amount;
    s.pot = 0;
    s.phase = 'folded';
    s.toAct = null;
    s.over = true;
    s.revealed = false;
    s.result = {
      winner: w, split: false, amount: amount, folded: p,
      revealed: false, hands: [null, null]
    };
    emit(s, { t: 'fold', p: p, winner: w, amount: amount });
    checkMatchOver(s);
  }

  function bestOf(s, p) {
    var cards = s.hands[p].cards.map(function (c) { return { r: c.r, s: c.s }; });
    var res = Cards.evalBest5(cards);
    return { cat: res.cat, tiebreak: res.tiebreak, name: Cards.catName(res.cat) };
  }

  function showdown(s) {
    var h0 = bestOf(s, 0), h1 = bestOf(s, 1);
    var cmp = Cards.compareHands(h0, h1);
    var amount = s.pot;
    var winner = null, split = false;
    if (cmp > 0) { winner = 0; s.chips[0] += amount; }
    else if (cmp < 0) { winner = 1; s.chips[1] += amount; }
    else {
      split = true;
      // 팟은 항상 매칭된 금액의 합 → 짝수라 정확히 반씩 나뉜다
      s.chips[0] += Math.floor(amount / 2);
      s.chips[1] += amount - Math.floor(amount / 2);
    }
    s.pot = 0;
    s.phase = 'showdown';
    s.toAct = null;
    s.over = true;
    s.revealed = true;
    s.result = {
      winner: winner, split: split, amount: amount, folded: null,
      revealed: true, hands: [h0, h1]
    };
    emit(s, {
      t: 'showdown', winner: winner, split: split, amount: amount,
      cats: [h0.cat, h1.cat]
    });
    checkMatchOver(s);
  }

  function checkMatchOver(s) {
    if (s.chips[0] <= 0 || s.chips[1] <= 0) {
      s.matchOver = true;
      s.matchWinner = s.chips[0] <= 0 ? 1 : 0;
      emit(s, { t: 'match', winner: s.matchWinner });
    }
  }

  // ── 다음 판 ────────────────────────────────────────────
  // 딜러 교대 + 칩 승계 + 재앤티. 판이 끝나지 않았거나 매치가 끝났으면 error.
  function nextHand(state, deckOrder) {
    if (!state) return { error: '상태 없음' };
    if (!state.over) return { error: '아직 판이 끝나지 않았습니다' };
    if (state.matchOver) return { error: '매치가 종료되었습니다' };
    return createHand({
      deckOrder: deckOrder || Cards.makeDeck(),
      chips: [state.chips[0], state.chips[1]],
      dealer: other(state.dealer),
      handNo: state.handNo + 1
    });
  }

  // ── 시점별 뷰 ──────────────────────────────────────────
  // p 의 시점. 상대의 히든 카드는 null, 상대의 매장 카드도 항상 null,
  // 덱은 통째로 제거한다. p 가 0/1 이 아니면 양쪽 모두 가린다
  // (로컬 핫시트에서 "차례 넘기기" 화면에 쓴다).
  function viewFor(state, p) {
    var v = clone(state);
    delete v.deck;
    v.deckLeft = state.deck.length - state.dealtCount;
    v.me = (p === 0 || p === 1) ? p : null;
    [0, 1].forEach(function (q) {
      var mine = (q === p);
      var reveal = mine || (state.revealed && !state.folded[q]);
      if (!reveal) {
        v.hands[q].cards = v.hands[q].cards.map(function (c) {
          return c.open ? c : null;
        });
      }
      if (!mine) v.hands[q].buried = null;
    });
    v.options = (p === 0 || p === 1) ? actionOptions(state, p) : [];
    return v;
  }

  // ── 로그 문구 ──────────────────────────────────────────
  var ACT_LABEL = {
    check: '체크', bbing: '삥', call: '콜', half: '하프', ttadang: '따당', die: '다이'
  };
  function describeEvent(ev, names) {
    var N = names || ['P1', 'P2'];
    switch (ev.t) {
      case 'hand': return ev.no + '판 시작 (딜러: ' + N[ev.dealer] + ')';
      case 'ante': return N[ev.p] + ' 앤티 ' + ev.amount;
      case 'discard': return N[ev.p] + ' 카드 매장';
      case 'open': return N[ev.p] + ' 오픈 ' + Cards.cardText(ev.card);
      case 'round': return ev.n + '라운드 베팅';
      case 'deal':
        if (!ev.open) return ev.street + '번째 카드 (히든)';
        return ev.street + '번째 카드 ' +
          Cards.cardText(ev.cards[0]) + ' / ' + Cards.cardText(ev.cards[1]);
      case 'act':
        return N[ev.p] + ' ' + (ACT_LABEL[ev.action] || ev.action) +
          (ev.amount ? ' (' + ev.amount + ')' : '') + (ev.allIn ? ' 올인' : '');
      case 'refund': return N[ev.p] + ' 초과분 ' + ev.amount + ' 반환';
      case 'fold': return N[ev.winner] + ' 승 (상대 다이) +' + ev.amount;
      case 'showdown':
        if (ev.split) return '쇼다운: 무승부 (' + Cards.catName(ev.cats[0]) + ') 팟 분배';
        return '쇼다운: ' + N[ev.winner] + ' 승 (' +
          Cards.catName(ev.cats[ev.winner]) + ') +' + ev.amount;
      case 'match': return '매치 종료 — ' + N[ev.winner] + ' 승리';
      default: return '';
    }
  }

  return {
    ANTE: ANTE,
    MAX_RAISES: MAX_RAISES,
    START_CHIPS: START_CHIPS,
    createHand: createHand,
    apply: apply,
    viewFor: viewFor,
    nextHand: nextHand,
    isHandOver: isHandOver,
    actionOptions: actionOptions,
    toCall: toCall,
    firstToAct: firstToAct,
    hasDiscarded: hasDiscarded,
    hasOpened: hasOpened,
    describeEvent: describeEvent
  };
});
