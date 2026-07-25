# 반응형 레이아웃 (RESPONSIVE.md)

320px ~ 2560px, 두 테마(기본 우드 / `body.theme-excel`), 두 게임(오목 15×15 / 오델로 8×8),
두 모드(로컬 2인 / 온라인 대전 + 채팅 카드)에서 **요소 겹침 0 · 가로 스크롤 0** 을 보장한다.

---

## 1. 핵심 원칙 — 보드는 뷰포트가 아니라 컨테이너를 따른다

### 이전 (버그의 근본 원인)

```css
:root { --board-size: min(80vw, 560px); }
.board { width: var(--board-size); height: var(--board-size); }
```

보드 크기가 **뷰포트**에서 나왔기 때문에 자기가 들어갈 그리드 열의 실제 폭을 전혀 몰랐다.
`.page{max-width:1200px;padding:28px 20px}` + `.layout{grid-template-columns:280px minmax(320px,1fr) 300px;gap:22px}`
조합에서 1280px 뷰포트의 가운데 열은 약 516~536px 인데 보드는 560px 를 그려서
열을 44px 넘쳤고, 그 결과 좌우 패널을 침범하고 `box-shadow` 가 패널 위로 번졌다.

### 이후

```css
.board-area { width: 100%; min-width: 0; display: flex; justify-content: center; }
.board-flip { width: 100%; max-width: var(--board-max); }
.board      { width: 100%; max-width: var(--board-max); aspect-ratio: 1 / 1; height: auto; }
```

* 보드 폭 = **부모 열 폭의 100%**, 상한만 `--board-max`(560px).
  → **어떤 브레이크포인트에서도 자기 열을 넘칠 수 없다.**
* `aspect-ratio: 1/1` + 전역 `box-sizing: border-box` → 보더박스가 항상 정사각형.
* 기존 프레임 룩(`padding: 5%` + 내부 보드)은 그대로 유지.
  `.board-inner{width:100%;height:100%}` 는 `aspect-ratio` 가 부모 높이를 **확정값**으로
  만들어 주기 때문에 정상 동작한다 (측정값: inner 가 항상 정사각형, 오차 < 1.5px).
* `box-shadow` 를 `0 12px 34px` → `0 10px 22px` 로 줄여 좌우 22px 갭 안에서 끝나도록 함
  (블러가 패널 위로 번지지 않음).

### JS 연동 (필수)

`innerSize()` 가 `boardInner.getBoundingClientRect().width` 를 읽어 돌/선/마커를 **px** 로 배치하므로,
컨테이너 기인 크기 변화(채팅 카드 등장 / 테마 전환 / 게임 전환 / 폰트 로드)에서
`window resize` 이벤트가 발생하지 않아 재렌더가 누락될 수 있다.

`public/game.js` 에 **`ResizeObserver`** 추가:

* `boardInner` 를 관찰, `requestAnimationFrame` 으로 디바운스.
* 무한 루프 가드: 반올림한 폭이 **실제로 달라졌을 때만** `renderBoard()` 호출
  (`lastInnerW` 비교).
* 기존 `window.addEventListener('resize')` 는 그대로 유지(80ms 디바운스, 가드 리셋).

---

## 2. 브레이크포인트 사다리

CSS 는 **모바일 우선**(기본 = 1열 스택)이고, 3열은 실제로 들어갈 때만 켠다.
Chrome 은 미디어 쿼리를 `window.innerWidth`(클래식 스크롤바 포함) 기준으로 평가한다 — 실측 확인.

| 구간 | 조건 | 레이아웃 | 주요 변경 |
|---|---|---|---|
| **WIDE** | `min-width: 1240px` | 3열 `280px · minmax(0,1fr) · 300px`, gap 22px | `.panel{max-width:none}`, `.board-area{order:0}`, `.page{padding-top:18px}` |
| **BASE** | ~1239px | 1열 스택 (보드 → 왼쪽 패널 → 오른쪽 패널) | `.board-area{order:-1}`, `.panel{max-width:var(--stack-max)=560px; margin:0 auto}` |
| **MEDIUM** | `max-width: 900px` | 1열 | `--page-pad-x: 16px`, `.layout{gap:18px}`, 헤더 여백 축소 |
| **SMALL** | `max-width: 640px` | 1열 | 엑셀 리본 축소(12px), 시트탭 축소, **`.status-right` 숨김**, 기보 240px / 채팅 170px |
| **XS** | `max-width: 560px` | 1열 | `--page-pad-x: 12px`, `--excel-head-fs: 9px`, 카드/버튼/타이틀/엑셀 크롬 패딩 축소 |
| **XXS** | `max-width: 380px` | 1열 | `--excel-head-fs: 8px`, 리본 11px, `.name-box` 44px, 토글 축소 |

`.page { max-width: 1320px }` (엑셀 테마도 1180px → 1320px 로 통일).

### 왜 1240px 인가

3열이 켜지는 최소 폭에서 가운데 열이 **실제 560px 보드**를 담아야 한다.

```
콘텐츠 폭 = 1240 - (스크롤바 15) - (좌우 패딩 40) = 1185
가운데 열 = 1185 - 280 - 300 - (22 × 2) = 561  ≥ 560  ✓
```

스크롤바가 없는 환경(macOS 오버레이)에서는 576px 로 더 여유롭다.
스크롤바가 17px 인 환경이면 가운데 열이 559px 이 되지만, 보드가 컨테이너를 따르므로
559px 로 **알아서 줄어들 뿐 넘치지 않는다.** (컨테이너 기준 사이징의 이점)

### 실측 보드 폭 (기본 테마 / 온라인 모드 / 클래식 스크롤바 15px)

| 뷰포트 | 열 구성 | 보드 |
|---|---|---|
| 320 | `281px` | 281 |
| 390 | `351px` | 351 |
| 560 | `521px` | 521 |
| 640 | `593px` | 560 (상한) |
| 900 | `853px` | 560 |
| 1239 | `1184px` | 560 |
| **1240** | `280px 561px 300px` | 560 |
| 1280 | `280px 601px 300px` | 560 |
| 1360+ | `280px 656px 300px` | 560 |

---

## 3. 테마 토글 (`#themeToggle`)

**이전:** `position: fixed; top:14px; right:16px` → 항상 `.site-header` 박스 위에 떠 있었고,
엑셀 테마에서는 타이틀바/리본을 덮었다 (좁은 폭에서 데이터/검토/보기 탭 위에 얹힘).

**이후:** `position: static` 으로 바꾸고 `index.html` 에서 `.page` 안 최상단 `.toolbar` 로 이동.

```html
<div class="page">
  <div class="toolbar"><button id="themeToggle" class="theme-toggle">…</button></div>
  <header class="site-header">…
```

* 문서 흐름 안에 있으므로 **구조적으로 어떤 요소와도 겹칠 수 없다.**
* 엑셀 테마에서는 `.excel-chrome` 바로 아래에 놓여 리본/타이틀바를 절대 침범하지 않는다.
* ≤560px 12px 폰트, ≤380px 11px 로 축소. 실측: 320px 에서 79×28px, 모든 폭에서
  `elementFromPoint(center)` 가 버튼 자신을 반환(= 클릭 가능).
* `id` 는 그대로라 `game.js` 의 `$('themeToggle')` 바인딩은 변경 없음.

---

## 4. 엑셀 테마 반응형

### 리본 — 줄바꿈 금지, 가로 스크롤

```css
.excel-ribbon {
  display: flex; flex-wrap: nowrap;
  overflow-x: auto; overflow-y: hidden;
  overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;
  scrollbar-width: none; -ms-overflow-style: none;
}
.excel-ribbon::-webkit-scrollbar { width: 0; height: 0; display: none; }
.ribbon-tab { flex: 0 0 auto; white-space: nowrap; }
```

* `white-space: nowrap` 이 **"페이지 레이아웃" 중간 줄바꿈**을 막는다.
* 스크롤바는 시각적으로 완전히 숨김(Firefox/WebKit/구 Edge 모두).
* `.excel-chrome { overflow: hidden }` 로 리본의 가로 오버플로가 **문서 가로 스크롤을 만들지 않게** 격리.
* 실측 320px: 리본 `scrollWidth 355 / clientWidth 305` → 가로 스크롤 가능, **1줄 유지**, 탭 내부 줄바꿈 없음.

### 타이틀바 / 수식 입력줄 / 시트탭 / 상태바

| 요소 | 처리 |
|---|---|
| `.excel-titlebar` | `flex-wrap:nowrap`; `.excel-title` 은 `min-width:0` + `ellipsis`, `.excel-winbtns` 는 `flex:0 0 auto` |
| `.excel-formula` | `flex-wrap:nowrap`; `.name-box` 고정, `.fx-input` 은 `flex:1 1 auto; min-width:0; nowrap; ellipsis` |
| `.sheet-tabs` | `nowrap` + `overflow-x:auto` + 스크롤바 숨김, `.sheet-tab{flex:0 0 auto;nowrap}` |
| `.status-bar` | `nowrap`; `.status-left` 고정, `.status-right` 는 `ellipsis` + **`max-width:640px` 에서 `display:none`** (준비 텍스트와 충돌 방지) |

실측 320~2560px 전 구간에서 네 바 모두 **텍스트 1줄**, `scrollHeight == clientHeight`,
`scrollWidth == clientWidth` (문서 밖으로 삐져나오지 않음).

### 스프레드시트 보드

* 헤더/셀은 `%` 좌표 배치라 컨테이너와 함께 자동 스케일.
* 헤더 글자만 고정 px 였으므로 `--excel-head-fs` 변수화: 기본 10px → ≤560px 9px → ≤380px 8px.
  `line-height:1` + `overflow:hidden` 추가로 셀 밖으로 삐져나오지 않음.
* 실측: 320px(오목 15×15, 셀 ≈ 17.6px)에서도 헤더/셀/돌이 `board-inner` 밖으로 나가지 않음(escaped = 0).

### `.excel-chrome` / `.excel-bottom` 을 `static` 으로 되돌린 이유

두 요소는 각각 `position: sticky; top:0` 과 `position: sticky; bottom:0` 이었다.

* `.excel-bottom`(sticky bottom)은 문서가 뷰포트보다 길면 **스크롤 위치와 무관하게 항상**
  뷰포트 하단에 붙어 보드/카드 위를 덮었다 → 스크롤 0 에서도 겹침.
* `.excel-chrome`(sticky top)은 스크롤 0 에서는 문제없지만, 조금만 스크롤하면
  보드/패널/카드를 92px 높이로 덮었다 (실측: `excel/1280/y=200` 에서 5쌍 겹침).

"어떤 상황에서도 겹치지 않는다"를 만족시키기 위해 둘 다 문서 흐름(`position: static`)으로 되돌렸다.
위/아래 크롬이 문서를 액자처럼 감싸는 형태가 되어 엑셀 룩은 유지된다.
다시 고정하고 싶다면 `style.css` 의 해당 규칙 한 줄만 `sticky` 로 바꾸면 되며,
그 경우 스크롤 중 겹침은 sticky 의 정상 동작으로 감수해야 한다.

---

## 5. 그 밖에 고친 오버플로

| 대상 | 조치 |
|---|---|
| `.site-title` (56px / letter-spacing 8px) | `font-size: clamp(30px, 8vw, 56px)`, `letter-spacing: clamp(2px, 1.4vw, 8px)`, `overflow-wrap:anywhere` — 320px "오델로"도 안전 |
| `.site-subtitle` | `clamp(13px, 3.2vw, 16px)` |
| `.card` | `min-width:0; overflow-wrap:anywhere` |
| `.room-code` (6자리 코드) | `clamp(17px,5vw,22px)`, `min-width:0`, `overflow-wrap:anywhere`; 행은 `flex-wrap:wrap`, 복사 버튼 `flex:0 0 auto` |
| `.chat-bubble` / `.chat-system` | `overflow-wrap: anywhere` (공백 없는 긴 토큰 대응), 시스템 메시지 `max-width:100%` |
| `.move-row` / `.move-coord` | `min-width:0`, `overflow-wrap:anywhere`, `.move-num` 은 `flex:0 0 26px`(XXS 22px) |
| `.player-card` | `.player-meta{flex:1 1 auto;min-width:0}`, 타이머 `flex:0 0 auto; nowrap` |
| `.info-row` | `flex-wrap:wrap; gap:10px`, 라벨 `nowrap`, 값 `min-width:0` |
| 로비 — 내 돌 라디오 3개 | `.rule-select`/`.rule-options` 에 `flex-wrap:wrap`, `.rule-opt{white-space:nowrap}` |
| 로비 — 코드 입력 + 참가 | `.join-row{flex-wrap:wrap}`, input `flex:1 1 120px; min-width:0`, 버튼 `flex:0 0 auto` |
| 채팅 입력행 | 동일 패턴 (`flex:1 1 120px; min-width:0`) |
| 결과 모달 | 백드롭 `padding:16px`, 카드 `width:100%; max-width:340px; max-height:calc(100vh - 32px); overflow-y:auto`, 패딩/제목/본문 `clamp()` |
| 토스트 | `max-width: calc(100vw - 32px)`, `overflow-wrap:anywhere` |
| 그리드 | 3열을 `minmax(320px,1fr)` → `minmax(0,1fr)` 로 (min-content 로 인한 열 확장 차단) |
| 접근성 | `@media (prefers-reduced-motion: reduce)` 에서 보드 전환/돌 애니메이션 해제 |

---

## 6. 자가 진단 헬퍼 — `window.__layoutAudit()`

`public/game.js` 에 정의(UI 없음, 프로덕션 무해). 콘솔에서 바로 호출:

```js
window.__layoutAudit()
// → { vw: 1280, vh: 800, hScroll: false, overlaps: [] }
```

* 검사 대상: `.board`, 각 `.panel`, 각 `.card`, `#themeToggle`,
  `.excel-chrome`, `.excel-bottom`, `.site-header`
* **보이는 요소만** (`display:none` / `visibility:hidden` / `opacity:0` / 크기 0 제외 —
  `[hidden]` 인 채팅 카드·엑셀 크롬은 자동 제외)
* 쌍별 바운딩박스 교차. **양 축 모두 2px 초과**로 겹칠 때만 보고.
* `a.contains(b) || b.contains(a)` 인 조상/자손 쌍은 제외.
* `hScroll` = `document.documentElement.scrollWidth > window.innerWidth`
* `overlaps[i]` = `{ a, b, ox, oy }` (a/b 는 사람이 읽을 수 있는 선택자 라벨, ox/oy 는 겹침 px)

---

## 7. 검증 방법과 결과

puppeteer/playwright 는 설치하지 않았다. 대신 **이미 설치돼 있는 `ws` 패키지로 CDP 클라이언트를
직접 작성**해 시스템의 Google Chrome 을 `--headless=new` 로 구동하고 실제 레이아웃을 측정했다.

측정 매트릭스: **26개 폭 × 2 테마 × 2 게임 × 2 모드 = 208 조합** (온라인 모드는 채팅 카드 표시 + 방 코드 + 긴 채팅 메시지 주입).

각 조합에서 확인한 것:

1. `__layoutAudit().overlaps.length === 0`
2. `documentElement.scrollWidth <= window.innerWidth` **및** `<= documentElement.clientWidth` (엄격)
3. 보드 정사각 (`|w-h| ≤ 1.5px`), `board.width ≤ boardArea.width`
4. 돌 / 디스크 / 금수 마커 / 힌트 / 엑셀 셀·헤더가 `board-inner` 밖으로 나가지 않음
5. `.card` / `.panel` / `.board` 가 `.page` 콘텐츠 박스를 벗어나지 않음
6. 기본 테마에서 캔버스 픽셀 크기 == `board-inner` 실측 폭 (재렌더 동기화)
7. 페이지 JS 예외 0건

**결과: 208/208 PASS** (클래식 스크롤바 15px 환경, 오버레이 스크롤바 환경 모두).

추가 검증:

* **엑셀 크롬 1줄 유지** — 25개 폭에서 리본/타이틀바/수식줄/시트탭/상태바 모두 1줄, 줄바꿈 0, `status-right` 는 640px 경계에서 정확히 토글 → ALL PASS
* **테마 토글 클릭 가능성** — 두 테마 × 25개 폭에서 `elementFromPoint` 히트 테스트 → ALL PASS
* **스크롤 상태 겹침** — 두 테마 × 3폭 × `scrollY ∈ {0, 200, 최대}` → 겹침 0
* **결과 모달** — 두 테마 × 6폭(320px/568px 세로 포함)에서 뷰포트 안에 완전히 수납 → ALL PASS
* **ResizeObserver** — 창 크기를 바꾸지 않고 `--board-max` 만 288px 로 축소했을 때
  `board-inner` 498 → 253px, 캔버스도 `253.219px` 로 **재렌더됨**(윈도우 resize 이벤트 없이).
  복원 시에도 498px 로 재렌더. 돌은 항상 보드 안. 4개 테마×게임 조합 모두 통과.
* **클릭 → 셀 매핑 회귀** — 2테마 × 2게임 × 9폭에서 계산된 셀 중앙을 클릭 →
  기록된 좌표가 정확히 일치(오목 `D8,E8,F8,A15,O1` / 오델로 `d3,c3,c4,c5`),
  렌더된 돌의 셀 중앙 오차 **최대 0.02px** → ALL PASS

기존 테스트:

```
node --check public/game.js   → OK
node test-rules.js            → 14 passed, 0 failed
PORT=3459 node test-ws.js     → 31 passed, 0 failed
```

`server.js`, `rules.js`, `othello.js`, 통신 프로토콜, `Dockerfile`, `docker-compose.yml` 은 변경하지 않았다.
