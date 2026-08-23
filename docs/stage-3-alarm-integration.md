# Stage 3 — 알람 3종 통합 + 삼성 권한 온보딩

> **선행**: Stage 0, 1, 2 완료 및 머지
> **브랜치**: `stage-3-alarm-integration`
> **목적**: Stage 0에서 증명한 알람 엔진을 실제 일정 데이터에 연결한다. 이 스테이지가 끝나면 앱이 "쓸 수 있는 물건"이 된다.
>
> ⚠️ **Stage 0의 실기기 검증 결과를 먼저 확인할 것.** 삼성 기기에서 실제로 확인된 제약(예: 특정 설정 없이는 Doze를 못 뚫는다 등)이 이 스테이지의 구현을 바꾼다. `docs/ARCHITECTURE.md`의 Stage 0 기록을 반드시 읽고 시작한다.

---

## 0. 이 스테이지에서 하지 않는 것

- 반복 일정의 알람 (Stage 5) — 재계산 로직은 **반복을 고려한 구조로 만들되**, 이번엔 단일 일정만 입력된다
- 집중 타이머의 상시 알림 (Stage 6) — 인프라만 재사용 가능하게
- 브리핑 알림 (Stage 6)

---

## 1. 작업 순서

### 1-1. 알람 시각 산출 (`src/domain/schedule.ts`)

**순수 함수로 만든다. RN 의존 0.** 이게 이 스테이지의 두뇌다.

```ts
type Occurrence = { eventId: string; start: Date; end: Date | null }

// 반복 전개 (Stage 5에서 rrule 연결. 지금은 단일 일정 pass-through)
expandOccurrences(events, range, overrides): Occurrence[]

// 알람 시각 산출
computeAlarmTimes(
  occurrences: Occurrence[],
  reminders: Reminder[],
  now: Date,
  limit: number,        // 30
): PlannedAlarm[]
```

`PlannedAlarm`은 `AlarmPayload` + `fireAt`을 담는다.
**단위 테스트를 반드시 붙인다.** 여기가 틀리면 알람이 안 울리거나 엉뚱한 때 울린다.

테스트 케이스:
- 과거 시각 제외
- 정확히 30건으로 잘림
- 오름차순 정렬
- override로 취소된 회차 제외
- override로 시각 변경된 회차 반영
- `enabled = false`인 reminder 제외
- 종일 일정의 알람 기준 시각 (해당 날 09:00 기준 — 아래 §1-2)
- task의 알람 기준은 `due_at`

### 1-2. 종일 일정·과제의 알람 기준

시각이 없는 항목에 "10분 전"은 의미가 없다. 규칙을 확정한다:

- **종일 일정**: 해당 날짜의 09:00(로컬)을 기준 시각으로 삼는다. `offset_minutes`는 여기서 뺀다
- **과제(task)**: `due_at`이 기준. `due_at`에 시각이 없으면 그날 23:59
- 이 기준값은 `app_settings`에 넣지 않는다 (설정이 늘어나면 관리가 안 된다). 상수로 고정

### 1-3. 재계산 엔진 (`src/native/rescheduler.ts`)

마스터 §3.6, §3.7 그대로.

```ts
async function rescheduleAll(): Promise<{ scheduled: number; nextAt: Date | null }> {
  // 1. 로컬 캐시에서 events / overrides / reminders 로드
  // 2. domain.expandOccurrences([now, now+60d])
  // 3. domain.computeAlarmTimes(..., limit: 30)
  // 4. notifee.cancelAllTriggerNotifications()   ★ 전체 취소 후 재예약
  // 5. 각각 scheduleAlarm / scheduleReminder
  // 6. 자정 앵커 재예약
  // 7. 위젯용 SharedPreferences write (Stage 9 훅. 지금은 no-op)
  // 8. 결과 로깅
}
```

**부분 갱신 금지.** 전체 취소 후 전체 재예약이 유일하게 안전한 방식이다.

호출 지점 5개(마스터 §3.6):
```
AppState 'active' 진입          → src/native/hooks/useAppStateReschedule.ts
events/reminders mutation 성공  → TanStack Query onSuccess
BOOT_COMPLETED                  → 네이티브 리시버 → headless task
자정 앵커 발화                   → notifee background event handler
시간대/시각 변경 브로드캐스트     → 네이티브 리시버
```

**Debounce를 건다.** CRUD가 연속으로 일어날 때 재계산이 폭주하면 안 된다. 300ms trailing.

### 1-4. 백그라운드 이벤트 핸들러

`notifee.onBackgroundEvent`를 index.js(엔트리) 최상단에 등록한다. RN 컴포넌트 안에 두면 앱이 죽었을 때 동작하지 않는다.

처리할 이벤트:
```
ACTION_PRESS  'dismiss'  → 알림 취소 + 포그라운드 서비스 종료
ACTION_PRESS  'snooze'   → 카운트+1로 재예약. max 도달 시 '놓친 알람' 알림
DELIVERED     (anchor)   → rescheduleAll() 실행 후 다음 자정 재예약
```

### 1-5. 알람 설정 UI

`/event/[id]` 편집 화면에 알림 섹션 추가:

```
알림
  [+ 알림 추가]
  ┌─────────────────────────────┐
  │ 10분 전    ·  [알림 ▾]       │  ← notify / alarm 토글
  │ 1시간 전   ·  [알람 ▾]  🗑    │
  └─────────────────────────────┘
```

- 프리셋: 정시 / 5분 / 10분 / 30분 / 1시간 / 1일 전 + 커스텀
- **mode가 'alarm'이면 시각적으로 강조**한다 (accent 배경 + 아이콘). 실수로 알람 모드를 켜면 새벽에 울린다
- 알람 모드 선택 시 알람음·진동 선택 노출
- 일정 저장 시 `reminders`도 함께 upsert (트랜잭션처럼 다뤄야 함 — 실패 시 롤백)

### 1-6. 순수 알람 탭 (`/alarms`)

시계 앱 스타일. `standalone_alarms` 테이블 사용.

```
  07:00   평일         [토글]
  월화수목금
  ─────────────────────
  09:30   1회성 · 병원   [토글]
  내일
```

- 시각 선택, 요일 반복(비트마스크 대신 `int[]`), 라벨, 알람음, 진동
- 토글 즉시 재계산
- 스와이프 삭제
- **다음 알람까지 남은 시간을 상단에 표시** ("12시간 34분 후")

순수 알람도 `computeAlarmTimes`의 입력으로 합류시킨다 — 30건 상한을 공유해야 한다.

### 1-7. 상시 알림 (③) — 오늘 일정 요약

- `app_settings`에 `ongoing_enabled` 추가 (마이그레이션 0004)
- 켜면 알림창에 오늘 남은 일정 요약이 고정됨
- 갱신 시점: 일정 CRUD + 자정 앵커 (마스터 §6)
- 탭하면 오늘 타임라인으로 딥링크
- importance LOW, 소리 없음, 스와이프 삭제 불가

### 1-8. ★ 삼성 권한 온보딩 (`/onboarding/permissions`)

마스터 §4.1의 6개 항목. **이 스테이지의 절반이 여기다.**

각 항목 카드:
```
┌──────────────────────────────────────┐
│ ✅  알림 권한                          │
│     알람을 표시하기 위해 필요합니다      │
├──────────────────────────────────────┤
│ ⚠️  배터리 제한 없음                   │
│     삼성 기기는 며칠 뒤 알람을 자동으로   │
│     차단합니다. 반드시 설정하세요.       │
│                        [설정 열기 →]   │
└──────────────────────────────────────┘
```

1~4번은 API로 상태 확인 + Intent 딥링크.
**5·6번(미사용 앱 절전 / 자동 최적화)은 API로 확인 불가**하므로:
- 체크박스로 "직접 확인했음"을 사용자가 표시
- 경로를 단계별 텍스트로 안내 (One UI 버전에 맞춰서 — Stage 0에서 확인한 버전 사용)
- 확인 시각을 `app_settings`에 기록

### 1-9. 주 1회 권한 재확인

마스터 §4.2.
- 앱 포그라운드 진입 시 `permission_checked_at`이 7일 이상 지났으면 1~4번 재확인
- 하나라도 깨졌으면 **홈 상단(Stage 4) 또는 캘린더 상단에 경고 배너** + 온보딩으로 이동
- 5·6번은 "마지막 확인: 12일 전" 형태로 상기시킨다

### 1-10. `/debug` 확장

```
[재계산 강제 실행 → 결과 표시]
[예약된 알람 30건 목록 (시각/제목/mode)]
[다음 알람까지 남은 시간]
[자정 앵커 상태]
[권한 6종 상태]
[N초 뒤 알람 (초 입력 가능)]
```

---

## 2. 검증

| # | 항목 | 통과 기준 |
|---|---|---|
| 1 | 일정에 알림 10분 전 추가 → 발화 | 조용한 알림 |
| 2 | 일정에 알람 모드 추가 → 발화 | 전체화면, 끌 때까지 소리 |
| 3 | 일정 시각 수정 | 재계산되어 새 시각에 발화 |
| 4 | 일정 삭제 | 알람도 취소됨 |
| 5 | 순수 알람 (평일 반복) | 지정 요일에만 발화 |
| 6 | 31건 이상 예약 시도 | 가까운 30건만 예약됨 |
| 7 | 상시 알림 | 고정, 자정에 갱신 |
| 8 | 앱 종료 후 알람 | payload만으로 정상 표시 |
| 9 | 재부팅 후 | 전체 재예약됨 |
| 10 | 권한 온보딩 6개 딥링크 | 정확한 설정 화면으로 이동 |
| 11 | 권한 깨뜨린 후 앱 실행 | 경고 배너 표시 |
| 12 | **3일 방치 후 알람** | 정상 발화 (삼성 최적화 통과) |

**12번은 실제로 3일이 걸린다.** 다른 항목을 먼저 끝내고 병행해서 돌린다.

---

## 3. DoD

- [ ] `src/domain/schedule.ts` 단위 테스트 전부 통과
- [ ] 재계산 트리거 5개 전부 동작 확인
- [ ] `notifee.onBackgroundEvent`가 엔트리 최상단에 등록됨
- [ ] 전체 취소 후 재예약 방식 (부분 갱신 코드 없음)
- [ ] 검증 12개 통과 (12번은 진행 중이어도 됨, 사용자에게 명시)
- [ ] 권한 온보딩 6개 항목 전부 구현
- [ ] `docs/ARCHITECTURE.md`에 재계산 흐름도 기록

---

## 4. 사용자에게 물어야 할 것

1. Stage 0 실기기 검증에서 발견된 삼성 특이사항이 있었는지
2. 기본 알림 offset (10분 권장)
3. 상시 알림을 기본 켬으로 할지 끔으로 할지

---

## 5. 다음으로 넘길 항목

- 반복 일정의 알람 (Stage 5) — `expandOccurrences`에 rrule 연결
- 브리핑 알림 (Stage 6) — 인프라 재사용
- 타이머 상시 알림 (Stage 6)
