# Stage 2 — 캘린더 UI (월↔주 전환 + 디자인 토큰)

> **선행**: Stage 1 완료 및 머지
> **브랜치**: `stage-2-calendar-ui`
> **목적**: 앱의 얼굴을 만든다. 마스터 §5의 디자인 시스템을 코드로 구현하고, 월간↔주간 인터랙티브 전환을 완성한다.

---

## 0. 이 스테이지에서 하지 않는 것

- 반복 일정 표시 (Stage 5) — 단일 일정만 그린다
- 시간표 격자 (Stage 5)
- 알람 설정 UI (Stage 3)
- 통계 차트 (Stage 7)
- 라이트 테마 (Stage 8) — 다크만

---

## 1. 작업 순서

### 1-1. 디자인 토큰 구현 (`src/ui/tokens/`)

마스터 §5.2를 그대로 코드화한다.

```
tokens/
  colors.ts     bg/surface/accent/palette 8종
  typography.ts display/title/body/caption/micro
  spacing.ts    4의 배수
  radius.ts     sm/md/lg/full
  motion.ts     spring / springSoft / springSnappy
  index.ts
```

**규칙: 컴포넌트에서 색상 리터럴(`'#fff'`) 사용 금지.** 린트 룰로 막는다.
`useTheme()` 훅을 만들어 두되, Stage 2에서는 다크 값만 반환한다 (Stage 8에서 라이트 추가).

### 1-2. 폰트

- Pretendard Variable을 `expo-font`로 로드
- 숫자가 나오는 모든 곳에 `fontVariant: ['tabular-nums']` — 시각·날짜가 흔들리지 않게
- 스플래시가 폰트 로딩을 기다리도록 `expo-splash-screen` 연동

### 1-3. 기본 컴포넌트 (`src/ui/components/`)

```
Text          토큰 기반 variant prop ('display'|'title'|'body'|...)
Surface       카드 컨테이너
Button        primary / ghost / danger
Sheet         하단 시트 (@gorhom/bottom-sheet)
Skeleton      로딩 자리표시자
ColorDot      일정 색상 점
Haptics       expo-haptics 래퍼 (selection / impact / success)
```

### 1-4. ★ 월간 ↔ 주간 인터랙티브 전환

**이 스테이지의 핵심이자 난이도의 대부분이다.**

요구사항:
- 버튼 토글이 아니라 **세로 드래그를 따라 실시간으로 변형**된다
- 위로 끌면 월간 → 주간으로 접히고, 아래로 끌면 펼쳐진다
- 손을 떼면 스프링으로 가까운 상태에 스냅
- **전 과정이 UI 스레드에서 실행** (JS 스레드 개입 0)

구현 지침:
- `Gesture.Pan()` + `useSharedValue(progress: 0~1)`
- 월간 그리드의 높이를 `interpolate(progress)`로 조절
- 선택된 주(week row)만 남고 나머지 행이 `opacity`·`translateY`로 사라짐
- 스냅: `withSpring(progress > 0.5 ? 1 : 0, spring)`
- **`runOnJS` 호출은 스냅 완료 후 상태 동기화 1회만.** 드래그 중 호출 금지 — 여기서 프레임이 깨진다
- 캘린더 그리드는 미리 렌더해두고 레이아웃만 변형한다. 드래그 중 리마운트가 일어나면 끝장

검증: **개발자 옵션의 GPU 렌더링 프로파일을 켜고 드래그** → 초록선(16ms) 아래 유지.
삼성 120Hz 기기에서는 8.3ms가 목표.

### 1-5. 캘린더 화면 구성

```
/calendar
  ├ 헤더        2026년 8월  ·  오늘 버튼  ·  검색
  ├ 요일 라벨    일 월 화 수 목 금 토
  ├ 그리드      월간 ↔ 주간 (드래그 전환)
  │   각 날짜 셀: 날짜 숫자 + 일정 색상 점 최대 3개 + (+N)
  └ 하단 시트   선택한 날의 일정 목록 (FlashList)
```

- 좌우 스와이프로 이전/다음 달(또는 주) 이동 — 3페이지 캐러셀 방식(prev/current/next 미리 렌더)
- 오늘 날짜는 `accent` 링, 선택 날짜는 채워진 원
- 하단 시트는 3단계 스냅포인트 (peek / half / full)

### 1-6. 일정 목록 아이템

```
[색상 바]  09:00  알고리즘 스터디
           10:30  ~ 12:00 · 산학협력관 302
```
- 종일 일정은 상단에 별도 칩 행으로 분리
- FlashList + `estimatedItemSize`
- 진입 시 stagger (항목당 20ms, `entering={FadeInDown.delay(i*20)}`)

### 1-7. 일정 상세/편집 (`/event/[id]`)

- 생성/수정 공용. `id === 'new'`면 생성 모드
- 필드: 제목 / 종일 토글 / 시작·종료 / 카테고리 / 색상 / 장소 / 메모
- 시각 선택은 `@react-native-community/datetimepicker` (One UI 네이티브 피커)
- **종일 토글을 켜면 시각 필드가 날짜 필드로 전환** — 마스터 §7.2 규칙을 UI에서도 강제
- 저장 시 낙관적 업데이트 + 햅틱
- 삭제는 확인 다이얼로그 후 soft delete

### 1-8. 타임라인 뷰 (선택한 날)

하단 시트 full 상태에서 세로 타임그리드:
- 시간축 0~24시, 현재 시각에 `accent` 라인
- 겹치는 일정은 가로로 분할
- 진입 시 현재 시각 위치로 자동 스크롤

### 1-9. 로딩·빈 상태

- 스피너 금지. **스켈레톤**만 사용
- 빈 날: 조용한 일러스트 없이 텍스트 한 줄 + 추가 버튼

---

## 2. 검증

| # | 항목 | 통과 기준 |
|---|---|---|
| 1 | 월↔주 드래그 전환 | 손가락을 따라 부드럽게, 끊김 없음 |
| 2 | GPU 프로파일 | 드래그 중 프레임 드롭 없음 |
| 3 | 좌우 스와이프 | 달/주 이동 시 깜빡임 없음 |
| 4 | 일정 CRUD | 캘린더에 즉시 반영 |
| 5 | 종일 토글 | 시각 → 날짜 필드 전환, 저장 후 날짜 유지 |
| 6 | 하단 시트 3단 스냅 | 자연스럽게 |
| 7 | 오프라인 | 캐시로 렌더링됨 |
| 8 | 다크 배경에서 색상 팔레트 8종 | 구분 가능하고 눈 안 아픔 |
| 9 | 화면 이탈 시 애니메이션 정지 | `useFocusEffect` 동작 |

---

## 3. DoD

- [ ] 색상 리터럴이 컴포넌트에 하나도 없음 (린트 통과)
- [ ] 모든 애니메이션이 Reanimated worklet (JS 스레드 애니메이션 0)
- [ ] 드래그 중 `runOnJS` 호출 없음 (코드로 확인)
- [ ] 검증 9개 전부 통과
- [ ] 스크린 레코딩으로 전환 애니메이션 확인 (사용자에게 제출)
- [ ] `docs/ARCHITECTURE.md`에 토큰 구조와 전환 구현 방식 기록

---

## 4. 사용자에게 물어야 할 것

1. 앱 첫 화면을 캘린더로 할지 홈으로 할지 (홈은 Stage 4에서 생김 — 임시로 캘린더 권장)
2. 주 시작 요일 (일요일 / 월요일)
3. 월↔주 전환의 기본 상태 (월간 시작 / 주간 시작)

---

## 5. 다음으로 넘길 항목

- 반복 일정 표시 (Stage 5)
- 라이트 테마 (Stage 8)
- 검색 화면 (Stage 8 또는 별도)
