/*
 * cards.js — 카드 게임 공용 모듈 (덱 / 표기 / 족보 판정)
 * 브라우저(window.Cards)와 Node(require)에서 함께 쓰는 UMD 래퍼.
 * 순수 로직만 포함 (DOM/네트워크 의존 없음). othello.js 와 동일한 패턴.
 *
 * 카드 표현: { r: 2..14, s: 0..3 }
 *   r  — 랭크. 11=J, 12=Q, 13=K, 14=A (A 는 스트레이트에서만 1 로도 쓰인다)
 *   s  — 무늬. 0=♠ 1=♥ 2=♦ 3=♣  (♥♦ 가 빨강)
 *
 * 족보(cat) 0~8 과 타이브레이크 배열의 규약:
 *   0 하이카드         [r1..r5 내림차순]
 *   1 원페어           [페어, 키커1, 키커2, 키커3]
 *   2 투페어           [높은페어, 낮은페어, 키커]
 *   3 트리플           [트리플, 키커1, 키커2]
 *   4 스트레이트       [최고랭크]  (A-2-3-4-5 는 5, 10-J-Q-K-A 는 14)
 *   5 플러시           [r1..r5 내림차순]
 *   6 풀하우스         [트리플, 페어]
 *   7 포카드           [포카드, 키커]
 *   8 스트레이트플러시 [최고랭크]
 * 같은 cat 이면 타이브레이크를 앞에서부터 비교한다.
 *
 * [의도된 단순화] 랭크 구성이 완전히 같으면 0(무승부)이다.
 * 무늬로 우열을 가리지 않는다 — 실제 세븐포커에서 쓰이는 무늬 서열
 * (♦<♥<♣<♠ 등)은 지역/하우스 룰마다 달라서 채택하지 않고,
 * 대신 팟을 정확히 절반씩 나누는 "스플릿"으로 처리한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cards = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUIT_SYMBOLS = ['♠', '♥', '♦', '♣']; // ♠ ♥ ♦ ♣
  var SUIT_NAMES = ['스페이드', '하트', '다이아', '클럽'];
  var RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var CAT_NAMES = [
    '하이카드', '원페어', '투페어', '트리플', '스트레이트',
    '플러시', '풀하우스', '포카드', '스트레이트플러시'
  ];

  function rankText(r) {
    return RANK_TEXT[r] || String(r);
  }
  function suitSymbol(s) {
    return SUIT_SYMBOLS[s] || '';
  }
  // 빨강 무늬(하트/다이아) 여부 — 화면 색상 결정용
  function isRed(card) {
    return !!card && (card.s === 1 || card.s === 2);
  }
  // '♠A' 형태의 표기 (엑셀 테마의 셀 텍스트로도 그대로 쓴다)
  function cardText(card) {
    if (!card) return '';
    return suitSymbol(card.s) + rankText(card.r);
  }
  function catName(cat) {
    return CAT_NAMES[cat] || '';
  }

  // 52장 덱 (무늬 오름차순 → 랭크 오름차순)
  function makeDeck() {
    var deck = [];
    for (var s = 0; s < 4; s++) {
      for (var r = 2; r <= 14; r++) deck.push({ r: r, s: s });
    }
    return deck;
  }

  // Fisher-Yates. 원본을 건드리지 않고 섞인 "새 배열"을 돌려준다.
  // rng 를 주입할 수 있어 테스트/서버에서 결정적으로 쓸 수 있다.
  function shuffle(deck, rng) {
    var rand = rng || Math.random;
    var a = deck.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      if (j > i) j = i;                 // rand() 가 1 을 반환하는 구현 방어
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ── 족보 판정 ──────────────────────────────────────────

  // 정확히 5장에 대한 판정
  function eval5(cards) {
    var i;
    var ranks = [];
    for (i = 0; i < 5; i++) ranks.push(cards[i].r);
    ranks.sort(function (a, b) { return b - a; });

    var flush = true;
    for (i = 1; i < 5; i++) if (cards[i].s !== cards[0].s) { flush = false; break; }

    // 랭크별 개수 → [{r, n}] 을 (개수 내림 → 랭크 내림) 으로 정렬.
    // 이 정렬 하나로 포카드/풀하우스/투페어/원페어의 타이브레이크가 모두 나온다.
    var cnt = {};
    for (i = 0; i < 5; i++) cnt[ranks[i]] = (cnt[ranks[i]] || 0) + 1;
    var groups = [];
    Object.keys(cnt).forEach(function (k) { groups.push({ r: Number(k), n: cnt[k] }); });
    groups.sort(function (a, b) { return (b.n - a.n) || (b.r - a.r); });

    // 스트레이트: 서로 다른 랭크 5개가 연속이거나 A-2-3-4-5
    var straightHigh = null;
    if (groups.length === 5) {
      var uniq = groups.map(function (g) { return g.r; });
      uniq.sort(function (a, b) { return b - a; });
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
        straightHigh = 5;               // A 를 1 로 쓰는 최약 스트레이트
      }
    }

    if (flush && straightHigh !== null) return { cat: 8, tiebreak: [straightHigh] };
    if (groups[0].n === 4) return { cat: 7, tiebreak: [groups[0].r, groups[1].r] };
    if (groups[0].n === 3 && groups[1].n === 2) return { cat: 6, tiebreak: [groups[0].r, groups[1].r] };
    if (flush) return { cat: 5, tiebreak: ranks.slice() };
    if (straightHigh !== null) return { cat: 4, tiebreak: [straightHigh] };
    if (groups[0].n === 3) return { cat: 3, tiebreak: [groups[0].r, groups[1].r, groups[2].r] };
    if (groups[0].n === 2 && groups[1].n === 2) {
      return { cat: 2, tiebreak: [groups[0].r, groups[1].r, groups[2].r] };
    }
    if (groups[0].n === 2) {
      return { cat: 1, tiebreak: [groups[0].r, groups[1].r, groups[2].r, groups[3].r] };
    }
    return { cat: 0, tiebreak: ranks.slice() };
  }

  // a 가 강하면 1, 약하면 -1, 완전히 같으면 0
  function compareHands(a, b) {
    if (a.cat !== b.cat) return a.cat > b.cat ? 1 : -1;
    var n = Math.max(a.tiebreak.length, b.tiebreak.length);
    for (var i = 0; i < n; i++) {
      var x = a.tiebreak[i] || 0, y = b.tiebreak[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  // 5~7장 중 최선의 5장. { cat, tiebreak, cards(최선의 5장) }
  function evalBest5(cards) {
    if (!cards || cards.length < 5) throw new Error('evalBest5: 5장 이상 필요');
    var n = cards.length;
    var best = null;
    for (var a = 0; a < n - 4; a++) {
      for (var b = a + 1; b < n - 3; b++) {
        for (var c = b + 1; c < n - 2; c++) {
          for (var d = c + 1; d < n - 1; d++) {
            for (var e = d + 1; e < n; e++) {
              var five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              var res = eval5(five);
              if (!best || compareHands(res, best) > 0) {
                res.cards = five;
                best = res;
              }
            }
          }
        }
      }
    }
    return best;
  }

  return {
    SUIT_SYMBOLS: SUIT_SYMBOLS,
    SUIT_NAMES: SUIT_NAMES,
    CAT_NAMES: CAT_NAMES,
    rankText: rankText,
    suitSymbol: suitSymbol,
    isRed: isRed,
    cardText: cardText,
    catName: catName,
    makeDeck: makeDeck,
    shuffle: shuffle,
    eval5: eval5,
    evalBest5: evalBest5,
    compareHands: compareHands
  };
});
