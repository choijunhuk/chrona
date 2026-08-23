# Chrona — 마스터 개발 명세서

> **이 문서의 목적**
> Claude Code가 이 프로젝트 전체를 이해하기 위한 단일 기준 문서다.
> 모든 스테이지 작업은 이 문서의 규칙을 따른다. 이 문서와 충돌하는 판단은 하지 말고, 충돌이 발견되면 작업을 멈추고 사용자에게 보고한다.
> 각 스테이지의 구체적 지시는 `docs/stage-N-*.md`에 있다.

---

## 0. 프로젝트 개요

**Chrona**는 개인용 캘린더 + 알람시계 하이브리드 안드로이드 앱이다.

- 사용자: 단 1명 (개발자 본인). 광운대 컴퓨터정보공학부 1학년.
- 기기: **삼성 안드로이드 (One UI)** — 유일한 타겟. 다른 기기 대응 불필요.
- 배포: **Google Play 출시 안 함.** EAS Build로 APK를 직접 설치한다.
- 웹: 최종 스테이지에서 별도 구현. 지금은 만들지 않되 **재사용 가능한 구조는 지킨다.**

### 이 앱이 다른 캘린더와 다른 점
일정 알림이 "조용한 푸시"가 아니라 **끌 때까지 울리는 진짜 알람**이 될 수 있다는 것.
이 한 가지가 프로젝트의 기술적 난이도 대부분을 차지하며, 나머지 모든 설계는 여기에 종속된다.

---

## 1. 확정 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Expo (**dev client 필수**) + TypeScript | Expo Go 사용 불가 |
| 라우팅 | expo-router (file-based) | |
| 알림/알람 | **Notifee** | `expo-notifications` 사용 금지 (사유 §3.1) |
| 백엔드 | Supabase (Auth + Postgres + RLS) | 무료 티어 |
| 서버 상태 | TanStack Query + AsyncStorage persist | 오프라인 읽기 |
| 로컬 상태 | Zustand | UI 상태만 |
| 애니메이션 | Reanimated 3 + Gesture Handler | **전부 worklet** |
| 리스트 | FlashList | |
| 차트 | victory-native (Skia) | Stage 7 |
| 날짜 | date-fns + date-fns-tz | moment/dayjs 금지 |
| 반복 규칙 | `rrule` (RFC 5545) | |
| 폰트 | Pretendard Variable | |
| 배포 | EAS Build (APK) + EAS Update (OTA) | |

### 금지 사항
- `expo-notifications` — 전체화면 알람/상시 알림/AlarmManager 타입 지정 불가
- `moment`, `dayjs` — date-fns로 통일
- 클래스 컴포넌트
- `any` 타입 (불가피하면 `// TODO(any):` 주석과 사유 필수)
- 인라인 스타일 남발 — 디자인 토큰(§5)을 통해서만 색/간격 사용

---

## 2. 폴더 구조

```
src/
  domain/      ★ 순수 TypeScript. React Native import 절대 금지.
               반복일정 전개, 날짜 계산, 알람 시각 산출, 통계 집계, 타입 정의.
               → Stage 10(웹)에서 이 폴더를 통째로 재사용한다.
  data/        Supabase 쿼리, TanStack Query 훅, 로컬 캐시
  native/      Notifee 래퍼, 권한 체크, 포그라운드 서비스, 위젯 브릿지
  ui/
    tokens/    디자인 토큰 (색/타이포/간격/모션)
    components/ 재사용 컴포넌트
    screens/   화면 단위 컴포넌트
app/           expo-router 라우트 (얇게. 로직은 src/로)
docs/          이 문서 및 스테이지 문서
```

**`src/domain/`의 순수성은 절대 규칙이다.** 여기에 `react-native`나 `expo-*` import가 들어가는 순간 웹 재사용이 불가능해진다. 린트 룰(`no-restricted-imports`)로 강제한다.

---

## 3. 알람 아키텍처 (핵심)

### 3.1 왜 Notifee인가
전체화면 알람(`fullScreenAction`), 상시 고정 알림(`ongoing`), `SET_ALARM_CLOCK` 알람 타입 지정, 포그라운드 서비스 — 이 넷은 `expo-notifications`로 불가능하다. Notifee는 Expo config plugin으로 연결되며 dev client 빌드가 전제다.

### 3.2 알림 3종 — 서로 다른 구현

| 종류 | 동작 | 구현 |
|---|---|---|
| **① 리마인더** | 한 번 띄우고 끝 | `TriggerType.TIMESTAMP`, importance DEFAULT |
| **② 알람 모드** | 전체화면 + 끌 때까지 소리/진동 | `SET_ALARM_CLOCK` + `fullScreenAction` + 포그라운드 서비스 |
| **③ 상시 고정** | 알림창에 계속 표시 | `ongoing: true`, importance LOW, 스와이프 삭제 불가 |

`reminders.mode` 컬럼이 ①/②를 결정한다. ③은 별개 기능(오늘 일정 요약, 집중 타이머 진행 중)에서 사용한다.

### 3.3 알림 채널 (앱 시작 시 생성)

```
chrona.alarm     HIGH,    bypassDnd: true,  sound: 커스텀, vibration: 강
chrona.reminder  DEFAULT, sound: 기본
chrona.ongoing   LOW,     sound: 없음, badge: false
chrona.timer     LOW,     sound: 없음
```

삼성은 자체 앱이 채널을 선점하는 경우가 있으므로 **채널 ID에 `chrona.` prefix를 반드시 붙인다.**

### 3.4 필수 권한 (AndroidManifest — config plugin으로 주입)

```
POST_NOTIFICATIONS
USE_EXACT_ALARM
USE_FULL_SCREEN_INTENT
RECEIVE_BOOT_COMPLETED
WAKE_LOCK
FOREGROUND_SERVICE
FOREGROUND_SERVICE_MEDIA_PLAYBACK
VIBRATE
```

Play 출시를 하지 않으므로 정책상 정당화는 불필요하다.

### 3.5 ★ 앱이 죽어있을 때의 알람 (설계 제약 1)

전체화면 알람은 앱이 완전 종료된 상태에서도 떠야 한다. 이때 RN 브릿지 초기화 전이라 **Supabase는 물론 로컬 DB도 조회할 수 없다.**

**규칙: 알람을 예약하는 시점에, 표시에 필요한 모든 데이터를 알림 payload(`data`)에 직렬화해서 담는다.**

```ts
data: {
  eventId, occurrenceStart,   // 식별용
  title, timeLabel, colorHex, // 표시용 — 이것만으로 화면이 완성되어야 함
  snoozeMinutes, maxSnooze, currentSnoozeCount,
  soundKey,
}
```

`/alarm-ring` 화면은 **네트워크·DB 조회를 일절 하지 않고 payload만으로 렌더링**한다. 이 규칙은 협상 불가다.

### 3.6 ★ 예약 개수 관리 (설계 제약 2)

안드로이드는 앱당 스케줄 가능한 알람 수에 상한이 있다. 반복 일정을 전부 예약하면 안 된다.

**규칙: 항상 "가장 가까운 30건"만 예약한다.**

재계산(reschedule) 트리거 — 이 목록이 전부다:
1. 앱이 포그라운드로 진입할 때
2. 일정/알림/시간표 CRUD가 발생했을 때
3. 부팅 완료 (`BOOT_COMPLETED`)
4. **매일 자정 앵커 알람** (앱을 열지 않아도 유지되게 하는 장치)
5. 시간대 변경 / 시각 수동 변경 브로드캐스트

자정 앵커 알람은 재계산 후 **자기 자신을 다음 자정으로 다시 예약**한다.

### 3.7 재계산 로직이 지켜야 할 것

```
1. 활성 events를 rrule로 [지금, 지금+60일] 구간 전개
2. event_overrides 적용 — is_cancelled 회차는 제외, 시각 변경 회차는 교체
3. reminders의 offset_minutes를 빼서 알람 시각 산출
4. 과거 시각 제외 → 오름차순 정렬 → 상위 30건
5. 기존 예약 전체 취소 후 재예약 (부분 갱신 금지. 버그 온상)
```

**override를 반드시 참조할 것.** "이번 주 수업 휴강" 처리했는데 알람이 울리면 앱을 못 믿게 된다.

### 3.8 스누즈 정책 (확정)

- 간격 **5분**, 최대 **3회**. 3회 소진 시 자동 해제되며 "놓친 알람" 알림 1건 남김
- 스누즈는 새 `SET_ALARM_CLOCK` 예약이므로 앱이 종료돼도 유지된다
- 스누즈 카운트는 payload에 실어 전달한다 (DB 왕복 없음)

### 3.9 알람 충돌 정책 (확정)

울리는 중에 다른 알람 시각이 도래하면 → **새 알람이 덮어쓰고, 이전 알람은 자동 dismiss.**
큐로 쌓지 않는다. 개인용 앱에서 알람이 연속으로 밀리면 짜증만 난다.

### 3.10 알람음 (확정)

앱 번들에 **4종 + 무음(진동만)**. 시스템 링톤 피커(RingtoneManager)는 구현하지 않는다.
파일은 `android/app/src/main/res/raw/`에 배치하며 config plugin으로 복사한다.

---

## 4. 삼성(One UI) 대응 — 필수

삼성은 안드로이드 제조사 중 배터리 최적화가 가장 공격적이다. 아래를 처리하지 않으면 **며칠 뒤부터 알람이 조용히 안 울린다.**

### 4.1 온보딩 권한 체크리스트 (Stage 3에서 구현)

각 항목은 상태 표시 + 해당 설정 화면으로 이동하는 딥링크 버튼을 갖는다.

| # | 항목 | 확인 방법 | 이동 Intent |
|---|---|---|---|
| 1 | 알림 권한 | Notifee `getNotificationSettings` | `APP_NOTIFICATION_SETTINGS` |
| 2 | 알람 및 리마인더 | `AlarmManager.canScheduleExactAlarms` | `REQUEST_SCHEDULE_EXACT_ALARM` |
| 3 | 전체화면 알림 | `canUseFullScreenIntent` | `MANAGE_APP_USE_FULL_SCREEN_INTENT` |
| 4 | 배터리 제한 없음 | `isIgnoringBatteryOptimizations` | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` |
| 5 | 미사용 앱 절전 제외 | 프로그램적 확인 불가 → **안내 문구 + 설정 이동** | 배터리 설정 |
| 6 | 자동 최적화(재시작) 끄기 | 프로그램적 확인 불가 → **안내 문구** | 디바이스 케어 |

5·6번은 삼성 전용 함정이며 API로 확인할 수 없다. **스크린샷 수준의 구체적 안내 문구**를 넣는다.

### 4.2 권한 재확인 (중요)

삼성 자동 최적화가 설정을 되돌려 놓는다. **주 1회, 앱 포그라운드 진입 시 1~4번을 재확인**하고, 하나라도 깨졌으면 홈 화면 최상단에 경고 배너를 띄운다. `app_settings.permission_checked_at`에 마지막 확인일을 기록한다.

---

## 5. 디자인 시스템 (확정)

### 5.1 원칙
"부드럽고 프레임 높은 느낌"의 정체는 프레임 수가 아니라 **물리 기반 모션 + UI 스레드 실행**이다.
JS 스레드 애니메이션은 60fps여도 끊겨 보인다. **모든 모션은 예외 없이 Reanimated worklet.**

### 5.2 토큰

```ts
// color — 다크 퍼스트 (라이트 테마는 Stage 8에서)
bg:        '#0E0F13'
surface:   '#17191F'
surfaceAlt:'#1E2129'
border:    '#282C36'
text:      '#EDEFF5'
textSub:   '#9BA1B0'
textDim:   '#5E6473'
accent:    '#6C7BFF'   // 액센트는 이 하나뿐
danger:    '#FF6B6B'
success:   '#5BD8A6'

// 일정 색상 팔레트 8종 — 채도 낮게. 형광색 금지.
palette: ['#6C7BFF','#8B7BD8','#D87B9E','#D89B6C','#C7C06B','#7BC98A','#6BB8C7','#8A93A8']

// typography — Pretendard Variable, 숫자는 tabular-nums
display: 32 / 700   // 날짜 숫자, 알람 시각
title:   20 / 600
body:    15 / 400
caption: 13 / 400
micro:   11 / 500

// spacing: 4의 배수. 4 8 12 16 20 24 32 40
// radius:  sm 8 / md 14 / lg 20 / full 999

// motion — 스프링만 사용. duration 기반 easing 금지.
spring:      { damping: 18, stiffness: 180, mass: 1 }
springSoft:  { damping: 22, stiffness: 120 }
springSnappy:{ damping: 15, stiffness: 260 }
```

### 5.3 모션 규칙
- 월↔주 뷰 전환은 **드래그를 따라오는 인터랙티브 전환** (버튼 토글 아님)
- 리스트 진입은 stagger (항목당 20ms 지연)
- 로딩은 스피너 대신 **스켈레톤**
- 화면이 포커스를 잃으면 애니메이션 정지 (`useFocusEffect`) — 배터리
- 햅틱: 일정 생성 / 알람 해제 / 뷰 전환 / 타이머 완료

### 5.4 알람 화면(`/alarm-ring`)
전체화면, 시각만 거대하게(display 이상), 배경에 아주 느린 그라디언트 블롭.
**밀어서 해제 / 탭해서 스누즈.** 오조작 방지를 위해 해제는 반드시 슬라이드 제스처.

---

## 6. 배터리 정책 (설계 제약 3)

- **폴링 없음. 주기적 백그라운드 작업 없음.** AlarmManager 단발 예약만 사용한다 (OS가 재우고 정확히 깨우는 방식이 가장 저렴하다)
- 포그라운드 서비스는 **알람이 울리는 순간 / 타이머가 도는 순간에만** 생존. 종료 시 즉시 stop
- Supabase Realtime 구독은 **앱이 포그라운드일 때만** 연결
- 상시 알림(③)은 데이터 변경 시 + 자정 앵커에서만 갱신
- 위젯 데이터도 위 두 시점에만 write

---

## 7. 데이터 모델

### 7.1 스키마 전체

**Stage 1에서 아래를 한 번에 전부 생성한다.** 지금 쓰지 않는 컬럼도 미리 만든다 — 나중에 마이그레이션이 꼬이는 비용이 훨씬 크다.

```sql
-- 카테고리 (통계의 분류 기준)
categories (
  id uuid pk, user_id uuid,
  name text, color text, icon text, sort_order int
)

-- 학기 (시간표 생명주기)
semesters (
  id uuid pk, user_id uuid,
  name text,              -- '2026-2학기'
  start_date date, end_date date,
  is_active boolean
)

-- 교시 프리셋 (광운대 시간 시딩)
period_presets (
  id uuid pk, user_id uuid,
  period_no int, start_time time, end_time time
)

-- 일정 / 시간표 / 과제 통합
events (
  id uuid pk, user_id uuid,
  kind text,              -- 'schedule' | 'timetable' | 'task'
  title text, memo text,
  category_id uuid fk -> categories,
  color text,             -- 미지정 시 category 색 상속

  -- 시각. all_day=true면 start_date/end_date 사용, false면 starts_at/ends_at
  starts_at timestamptz, ends_at timestamptz,
  all_day boolean, start_date date, end_date date,

  -- 반복 (규칙만 저장. 전개는 클라이언트에서)
  rrule text, rrule_until timestamptz,

  -- task 전용
  due_at timestamptz, is_done boolean, done_at timestamptz,

  -- timetable 전용
  semester_id uuid fk -> semesters,
  location text, professor text,

  updated_at timestamptz, deleted_at timestamptz
)

-- 반복 일정의 개별 회차 예외
event_overrides (
  id uuid pk, event_id uuid fk -> events,
  original_start timestamptz,   -- 어느 회차인지 식별
  new_start timestamptz, new_end timestamptz,
  is_cancelled boolean,
  updated_at timestamptz
)

-- 알림 설정 (한 일정에 여러 개 가능)
reminders (
  id uuid pk, event_id uuid fk -> events,
  offset_minutes int,     -- 시작 전 분. task는 due_at 기준
  mode text,              -- 'notify' | 'alarm'
  sound_key text, vibrate boolean,
  enabled boolean
)

-- 일정과 무관한 순수 알람 (시계 앱)
standalone_alarms (
  id uuid pk, user_id uuid,
  time time, weekdays int[],   -- 0=일 ~ 6=토. 빈 배열이면 1회성
  label text, enabled boolean,
  sound_key text, vibrate boolean,
  updated_at timestamptz, deleted_at timestamptz
)

-- 집중 타이머 기록 (통계 소스)
focus_sessions (
  id uuid pk, user_id uuid,
  event_id uuid fk -> events null,
  started_at timestamptz, ended_at timestamptz,
  planned_minutes int, completed boolean
)

-- 앱 설정 (단일 행)
app_settings (
  user_id uuid pk,
  briefing_enabled boolean, briefing_time time,      -- 기본 23:00
  default_reminder_offset int,                        -- 기본 10
  snooze_minutes int,        -- 5
  max_snooze_count int,      -- 3
  default_sound_key text,
  fixed_timezone text,       -- 'Asia/Seoul' 고정 옵션
  theme text,
  permission_checked_at timestamptz
)
```

### 7.2 시각 저장 규칙 (설계 제약 4)

- 시각이 있는 일정 → **UTC `timestamptz`**로 저장, 표시 시 로컬 변환
- **종일 일정 → 절대 timestamp로 저장하지 않는다. `date` 타입만 사용한다.** 시차로 하루가 밀리는 버그의 원인이다
- 사용자가 `fixed_timezone`을 켜면 기기 시간대와 무관하게 `Asia/Seoul` 기준으로 표시한다

### 7.3 동기화 규칙

기기가 하나뿐이지만 앱 재설치·웹 추가 시 필요하다.
- soft delete: `deleted_at`으로 처리. 물리 삭제 금지
- **충돌 해결은 `updated_at` 기준 last-write-wins.** 그 이상의 병합 로직은 구현하지 않는다
- 로컬에서 레코드를 변경할 때는 **항상 `updated_at = now()`**

### 7.4 RLS

전 테이블 동일: `auth.uid() = user_id`. `event_overrides`, `reminders`는 부모 `events`를 통해 확인한다.

### 7.5 첫 실행 시딩

- 기본 카테고리 4개: 학교 / 과제 / 개인 / 약속
- 광운대 교시 프리셋 (`period_presets`)
- `app_settings` 기본 행

---

## 8. 화면 구조

```
app/
  (tabs)/
    index         홈      — 오늘 요약. D-day 칩, 다음 일정, 집중 타이머 시작,
                            권한 경고 배너
    calendar      캘린더  — 월간 ↔ 주간 드래그 전환, 하단 시트에 그날 일정
    timetable     시간표  — 요일×교시 격자. 학기 전환 드롭다운
    alarms        알람    — 시계 앱 스타일. standalone_alarms 관리
    more          더보기  — 통계 / 브리핑 설정 / 권한 체크리스트 / 백업 / 테마
  event/[id]                일정 상세·편집
  timer                     집중 타이머 (전체화면 모달)
  alarm-ring                ★ 전체화면 알람. 딥링크 전용. DB 조회 금지
  onboarding/permissions    권한 체크리스트
  debug                     개발용 (§10)
```

집중 타이머는 탭이 아니라 홈에서 시작하는 전체화면 모달이다.

---

## 9. 기능 스펙 요약

각 항목의 상세는 해당 스테이지 문서 참조.

**과제 D-day** — 계단식 알림(마감 3일/1일/3시간 전, 개별 on/off). 홈에 남은 일수 칩, 24시간 이내면 `danger` 색. 완료 시 캘린더에서 흐려짐.

**시간표** — 요일×교시 격자에서 드래그로 블록 생성. 각 과목은 `rrule`로 매주 반복되는 `kind='timetable'` event. 수업 10분 전 알림 일괄 on/off. 학기 복사 기능.

**집중 타이머** — 뽀모도로(25/5) + 커스텀. 포그라운드 서비스로 백그라운드 카운트, 진행 중엔 상시 알림(③)에 남은 시간 표시. 완료 시 짧은 알람. 일정에 연결하면 `focus_sessions.event_id`로 기록.
**타이머 도중 알람이 오면 → 타이머 서비스는 유지하고 알람을 그 위에 띄운다.** 타이머는 백그라운드에서 계속 카운트한다.

**잠들기 전 브리핑** — 매일 23:00(변경 가능) 알림 1건. 내일 일정 개수 + 첫 일정 시각 + D-day 3일 이내 과제. 탭하면 내일 타임라인으로 딥링크. **알람 모드 아님, 조용한 알림.**

**통계** — 주간 카테고리별 시간 배분 도넛 / 계획 시간 vs 실제 집중 시간 막대 / 과제 완료율 / 연속 집중 일수.

**홈 위젯** — 코틀린 `AppWidgetProvider` + `RemoteViews`. RN은 위젯을 그릴 수 없으므로 **JS가 SharedPreferences로 데이터를 내보내고 코틀린이 읽어 그린다.** 갱신 시점은 일정 CRUD 시 + 자정 앵커. 2종(오늘 일정 리스트 / 다음 수업+D-day 콤팩트).

**백업** — JSON 내보내기 + `.ics` 내보내기. 개인용이므로 Supabase 유실 대비가 오히려 중요하다.

**검색** — Postgres `ilike`. 제목·메모 대상.

---

## 10. 개발 편의 (필수)

**`/debug` 화면을 Stage 0에서 만들고 끝까지 유지한다.** 알람을 테스트할 때마다 실제로 기다릴 수는 없다.

- 「10초 뒤 알람 테스트」 — 3종(리마인더/알람/상시) 각각
- 현재 예약된 알람 목록 덤프
- 권한 상태 전체 조회
- 재계산 강제 실행
- 로컬 캐시 초기화

---

## 11. 스테이지 목록

| Stage | 내용 | 문서 |
|---|---|---|
| **0** | Expo dev client + Notifee → **삼성 실기기 전체화면 알람 PoC** | `stage-0-alarm-poc.md` |
| 1 | Supabase 스키마 전체 + Auth + events CRUD | `stage-1-data.md` |
| 2 | 캘린더 UI (월↔주) + Reanimated 전환 | |
| 3 | 알람 3종 통합 + 삼성 권한 온보딩 | |
| 4 | 과제 D-day + 홈 탭 | |
| 5 | 반복 일정 + override + 시간표 모드 | |
| 6 | 집중 타이머 + 잠들기 전 브리핑 | |
| 7 | 통계 | |
| 8 | 디자인 폴리싱 (햅틱 / stagger / 스켈레톤 / 라이트 테마) | |
| 9 | 홈 위젯 (네이티브 코틀린) | |
| 10 | 웹 (Vite + React, `src/domain` 재사용) | |

**Stage 0이 프로젝트 리스크의 전부다.** 여기서 막히면 나머지 설계가 전부 바뀌므로, UI를 먼저 만들지 않는다.

---

## 12. 작업 규칙 (스테이지 게이트)

Claude Code는 각 스테이지에서 아래 절차를 반드시 지킨다.

```
1. 스테이지 문서를 읽고, 작업 계획을 먼저 제시한다
2. 사용자 승인 후 브랜치를 판다:  stage-N-<slug>
3. 구현한다
4. 완료 시 다음을 보고한다:
   - 변경 파일 목록
   - 이 스테이지의 완료 기준(DoD) 충족 여부를 항목별로
   - 사용자가 직접 확인해야 할 실기기 검증 항목
   - 다음 스테이지로 넘길 미결 사항
5. ★ 사용자의 명시적 승인 없이 main에 머지하지 않는다
6. 머지 후 docs/PROGRESS.md에 요약을 기록한다
```

### 아키텍처 문서화 의무
스테이지 완료 시 새로 생긴 주요 결정·구조를 `docs/ARCHITECTURE.md`에 누적 기록한다. 다음 스테이지의 Claude Code 인스턴스가 이 문서만 읽고도 맥락을 파악할 수 있어야 한다.

### 막혔을 때
설계 제약(§3.5, §3.6, §6, §7.2)과 충돌하는 상황이 생기면 **임의로 우회하지 말고 작업을 멈추고 보고한다.** 이 네 가지는 나중에 고치는 비용이 가장 큰 항목들이다.
