# Stage 9 — 홈 화면 위젯 (네이티브 코틀린)

> **선행**: Stage 8 완료 및 머지
> **브랜치**: `stage-9-widget`
> **목적**: 앱을 열지 않고도 오늘 일정을 본다. **이 프로젝트에서 유일하게 네이티브 코틀린을 직접 작성하는 스테이지다.**

---

## 0. 먼저 알아야 할 것

**React Native는 위젯을 그릴 수 없다.** 안드로이드 위젯은 별도 프로세스에서 `RemoteViews`로 렌더링되며, JS 런타임이 존재하지 않는다.

따라서 구조는 이렇게 된다:

```
[RN/JS]  데이터 계산  →  SharedPreferences에 JSON write
                              ↓
[Kotlin] AppWidgetProvider  →  읽어서 RemoteViews로 그리기
```

**JS는 데이터만 내보내고, 그리기는 전적으로 코틀린이 한다.**

난이도가 높고 디버깅이 불편하므로 마지막에 배치했다. 여기서 막혀도 앱은 이미 완성품이다.

---

## 1. 작업 순서

### 1-1. 네이티브 코드 배치 전략

Expo의 prebuild는 `android/` 폴더를 재생성할 수 있으므로, **네이티브 코드를 `android/`에 직접 두면 날아간다.**

두 가지 선택지:
- **A. config plugin으로 파일 주입** (권장) — `plugins/withChronaWidget.ts`가 코틀린 파일·레이아웃 XML·매니페스트 항목을 복사·주입. prebuild에 안전
- **B. `android/`를 git에 커밋하고 prebuild를 더 이상 돌리지 않음** — 간단하지만 이후 plugin 추가가 불편

**A로 간다.** 소스는 `native/android/` 아래 두고 plugin이 복사한다.

### 1-2. JS → SharedPreferences 브릿지

```ts
// src/native/widget.ts
export async function pushWidgetData(): Promise<void>
```

내보낼 데이터:
```json
{
  "updatedAt": "2026-08-23T09:00:00Z",
  "today": "8월 23일 일요일",
  "events": [
    { "time": "14:00", "title": "알고리즘 스터디", "color": "#6C7BFF", "allDay": false }
  ],
  "nextClass": { "label": "화 1교시 · 자료구조", "time": "내일 09:00", "room": "새빛관 401" },
  "tasks": [
    { "dday": "D-1", "title": "운영체제 과제", "urgent": true }
  ]
}
```

**호출 시점 (마스터 §6):**
- 일정/과제/시간표 CRUD 성공 시
- 자정 앵커 발화 시
- 앱 포그라운드 진입 시

→ 즉, **`rescheduleAll()`의 마지막 단계에 끼워넣는다.** Stage 3에서 no-op으로 남겨둔 훅을 채운다.

write 후 반드시 위젯 갱신 브로드캐스트를 보낸다:
```kotlin
AppWidgetManager.getInstance(ctx).notifyAppWidgetViewDataChanged(...)
```

`react-native-shared-preferences` 같은 라이브러리를 쓰거나, 간단한 네이티브 모듈을 직접 작성한다.

### 1-3. 위젯 2종

**① 오늘 일정 리스트 (4x2 이상)**
```
┌──────────────────────────────┐
│ 8월 23일 일요일          ⟳    │
│ ┃ 14:00  알고리즘 스터디       │
│ ┃ 19:00  저녁 약속            │
│ ┃ 종일    보고서 마감          │
└──────────────────────────────┘
```
- `ListView` + `RemoteViewsService` (스크롤 가능한 위젯)
- 항목 탭 → 해당 일정 상세로 딥링크
- 빈 날: "오늘 일정이 없어요"

**② 콤팩트 (2x2)**
```
┌────────────┐
│  다음 수업  │
│  09:00     │
│  자료구조   │
│  ─────     │
│  D-1 과제  │
└────────────┘
```

### 1-4. 코틀린 구현 요소

```
native/android/
  ChronaWidgetProvider.kt        AppWidgetProvider (리스트형)
  ChronaCompactProvider.kt       AppWidgetProvider (콤팩트)
  ChronaWidgetService.kt         RemoteViewsService
  ChronaWidgetFactory.kt         RemoteViewsFactory — SharedPreferences 읽고 아이템 생성
  res/layout/widget_list.xml
  res/layout/widget_list_item.xml
  res/layout/widget_compact.xml
  res/xml/widget_list_info.xml   AppWidgetProviderInfo
  res/xml/widget_compact_info.xml
```

**RemoteViews의 제약을 반드시 지킬 것:**
- 사용 가능한 View가 제한적이다 (`LinearLayout`, `FrameLayout`, `TextView`, `ImageView`, `ListView`, `Button` 등). ConstraintLayout 불가
- 커스텀 View 불가
- **Pretendard 폰트 사용 불가** — 시스템 폰트로 대체하거나, 텍스트를 비트맵으로 그리는 편법(비권장)
- 색상은 `res/values/colors.xml`에 별도 정의 (JS 토큰과 수동 동기화 — 값을 문서에 기록해둘 것)
- 다크/라이트는 `values-night/`로 분기

### 1-5. 딥링크

위젯 탭 → 앱의 특정 화면으로:
```
chrona://event/<id>
chrona://calendar?date=<yyyy-mm-dd>
chrona://timer
```
`PendingIntent`로 연결. `FLAG_IMMUTABLE` 필수 (Android 12+).

### 1-6. 갱신 주기

- `updatePeriodMillis`는 **0으로 둔다.** 안드로이드 위젯 자동 갱신은 최소 30분이고 배터리를 먹는다
- 갱신은 전적으로 앱이 보내는 브로드캐스트로만 (마스터 §6)
- 단, 자정 앵커가 확실히 도는지 확인할 것 — 이게 하루 한 번 갱신을 보장한다

---

## 2. 검증

| # | 항목 | 통과 기준 |
|---|---|---|
| 1 | 위젯 2종 배치 | 홈 화면에 추가됨 |
| 2 | 오늘 일정 표시 | 앱과 내용 일치 |
| 3 | 일정 추가 → 위젯 | 즉시 반영 |
| 4 | 자정 넘김 | 새 날짜로 갱신 |
| 5 | 앱 종료 상태 | 위젯 정상 표시 |
| 6 | **재부팅 후** | 위젯 유지, 데이터 표시 |
| 7 | 항목 탭 | 해당 일정으로 딥링크 |
| 8 | 빈 날 | 빈 상태 문구 |
| 9 | 다크/라이트 | 시스템 테마 따름 |
| 10 | 배터리 | 위젯 추가 전후 소모 차이 없음 (하루 관찰) |
| 11 | prebuild 재실행 | 위젯 코드가 살아남음 (config plugin 검증) |

**11번이 config plugin 방식을 택한 이유다. 반드시 확인할 것.**

---

## 3. DoD

- [ ] 네이티브 코드가 config plugin으로 주입됨 (`android/` 직접 편집 없음)
- [ ] `pushWidgetData()`가 `rescheduleAll()` 마지막 단계에 연결됨
- [ ] `updatePeriodMillis = 0`
- [ ] 위젯 색상값이 `docs/ARCHITECTURE.md`에 JS 토큰과 대응표로 기록됨
- [ ] 검증 11개 통과
- [ ] prebuild 재실행 후에도 정상 동작

---

## 4. 사용자에게 물어야 할 것

1. 위젯 2종 다 만들지, 하나만 만들지 (리스트형이 더 유용)
2. 위젯 크기 선호 (4x2 / 4x4)
3. 이 스테이지는 난이도가 높으니, 막히면 중단하고 Stage 10으로 넘어갈지

---

## 5. 다음으로 넘길 항목

- 없음. 여기까지가 앱의 끝이다.
