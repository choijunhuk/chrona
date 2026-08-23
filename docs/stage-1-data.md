# Stage 1 — 데이터 계층 (Supabase 스키마 + Auth + events CRUD)

> **선행**: `docs/00-MASTER.md`, Stage 0 완료 및 main 머지
> **브랜치**: `stage-1-data`
> **목적**: 앱의 데이터 기반을 한 번에 완성한다. 이후 스테이지에서 스키마 마이그레이션이 발생하지 않도록 **지금 쓰지 않는 테이블·컬럼도 전부 만든다.**

---

## 0. 이 스테이지에서 하지 않는 것

- 캘린더 UI, 화면 디자인 (Stage 2)
- 알람 예약 로직 연결 (Stage 3) — 스키마의 `reminders` 테이블만 만들고 비워둔다
- rrule 전개 로직 (Stage 5) — 컬럼만 만든다
- 통계 집계 (Stage 7)

산출물은 **"화면 없이도 데이터가 완벽히 도는 계층"**이다. 검증은 `/debug` 화면에서 한다.

---

## 1. 작업 순서

### 1-1. Supabase 프로젝트 연결

- 클라이언트 초기화: `src/data/supabase.ts`
- **환경변수는 `app.config.ts`의 `extra`를 통해 주입**한다. 하드코딩 금지, `.env`는 gitignore
- `@supabase/supabase-js` + `react-native-url-polyfill` (RN에서 필수)
- 세션 저장은 AsyncStorage 어댑터로 연결하고 `autoRefreshToken: true`

### 1-2. 인증

**개인용 앱이므로 구글 OAuth는 만들지 않는다.** 매직링크(이메일) 방식으로 간다.

- `/auth` 화면: 이메일 입력 → 매직링크 발송 → 딥링크로 복귀
- 딥링크 스킴은 `chrona://` 로 통일 (app.config.ts의 `scheme`)
- 세션이 있으면 `(tabs)`로, 없으면 `/auth`로 보내는 라우트 가드
- 로그아웃은 `/more`에 배치

### 1-3. 스키마 생성 (마이그레이션 파일로)

**마스터 §7.1의 전체 스키마를 SQL 마이그레이션 파일로 작성한다.** Supabase 대시보드에서 손으로 만들지 말 것 — 재현 가능해야 한다.

```
supabase/migrations/
  0001_init.sql        전체 테이블 + 인덱스
  0002_rls.sql         RLS 정책
  0003_seed.sql        기본 카테고리 / 광운대 교시 프리셋
```

필수 인덱스:
```sql
events (user_id, starts_at) where deleted_at is null
events (user_id, kind, due_at) where kind = 'task'
events (user_id, semester_id) where kind = 'timetable'
events (user_id, updated_at)
event_overrides (event_id, original_start)
reminders (event_id) where enabled = true
focus_sessions (user_id, started_at)
```

`updated_at` 자동 갱신 트리거를 전 테이블에 건다:
```sql
create trigger set_updated_at before update on <table>
for each row execute function moddatetime(updated_at);
```

### 1-4. RLS

마스터 §7.4대로. 전 테이블 `auth.uid() = user_id`.
`event_overrides` / `reminders`는 부모 `events`를 조인해서 확인:

```sql
create policy "own via event" on reminders
for all using (
  exists (select 1 from events e
          where e.id = reminders.event_id and e.user_id = auth.uid())
);
```

**RLS를 켠 상태로 개발한다.** 나중에 켜면 반드시 터진다.

### 1-5. 타입 생성

```
supabase gen types typescript --project-id <id> > src/data/database.types.ts
```

이 명령을 `package.json` 스크립트(`pnpm types`)로 등록한다. 스키마 변경 시마다 재생성.

**단, 앱 코드는 이 생성 타입을 직접 쓰지 않는다.** `src/domain/types.ts`에 도메인 타입을 따로 정의하고, `src/data/`에서 매핑한다. 이유:
- 생성 타입은 DB 형상(snake_case, nullable 범벅)이라 UI에서 다루기 나쁘다
- Stage 10(웹)에서 도메인 타입만 재사용해야 한다

```ts
// src/domain/types.ts  — 순수 TS
export type EventKind = 'schedule' | 'timetable' | 'task'
export type ReminderMode = 'notify' | 'alarm'

export type ChronaEvent = {
  id: string
  kind: EventKind
  title: string
  memo: string | null
  categoryId: string | null
  color: string
  // 시각: allDay면 startDate/endDate, 아니면 startsAt/endsAt
  allDay: boolean
  startsAt: Date | null
  endsAt: Date | null
  startDate: string | null   // 'YYYY-MM-DD'
  endDate: string | null
  rrule: string | null
  rruleUntil: Date | null
  // task
  dueAt: Date | null
  isDone: boolean
  // timetable
  semesterId: string | null
  location: string | null
  professor: string | null
  updatedAt: Date
}
```

매핑 함수(`toDomain` / `toRow`)는 `src/data/mappers.ts`에 모으고 **단위 테스트를 붙인다.** 여기가 틀리면 전부 틀린다.

### 1-6. 시각 처리 유틸 (`src/domain/time.ts`)

마스터 §7.2 규칙을 코드로 강제한다.

```ts
// 종일 일정은 절대 Date/timestamp로 다루지 않는다
type DateOnly = string  // 'YYYY-MM-DD' 브랜디드 타입 권장

toDateOnly(d: Date, tz: string): DateOnly
fromDateOnly(s: DateOnly, tz: string): Date   // 해당 tz의 00:00
formatTimeLabel(d: Date, tz: string): string  // '오후 9:00'
resolveTimezone(settings): string             // fixedTimezone 있으면 그것, 없으면 기기
```

**모든 시각 포맷은 이 모듈을 통한다.** 화면에서 `toLocaleString` 직접 호출 금지.
`date-fns-tz` 사용. 테스트는 `Asia/Seoul` + `UTC` + `America/New_York` 3개 시간대로 돌린다 (종일 일정 하루 밀림 검증).

### 1-7. TanStack Query 세팅

- `QueryClient` + AsyncStorage persister
- `staleTime` 기본 30초, `gcTime` 24시간 (오프라인 읽기용)
- 쿼리 키 팩토리를 `src/data/keys.ts`에 모은다

```ts
export const qk = {
  events: (range: {from: string, to: string}) => ['events', range] as const,
  event:  (id: string) => ['events', id] as const,
  categories: () => ['categories'] as const,
  settings: () => ['settings'] as const,
  // ...
}
```

### 1-8. CRUD 훅 (`src/data/hooks/`)

```
useEvents(range)          기간 조회 (반복 전개는 아직 안 함 — Stage 5)
useEvent(id)
useCreateEvent()
useUpdateEvent()
useDeleteEvent()          ★ soft delete: deleted_at = now()
useCategories()
useSettings() / useUpdateSettings()
```

전 mutation에 **낙관적 업데이트**를 건다. 오프라인 체감의 대부분이 여기서 나온다.
mutation 시 항상 `updated_at = now()`를 명시적으로 세팅한다 (마스터 §7.3).

### 1-9. 오프라인 정책

- **읽기**: persist된 캐시로 오프라인에서도 동작
- **쓰기**: 온라인일 때만. 오프라인이면 토스트로 명확히 알리고 mutation을 막는다
- 완전한 오프라인 쓰기 큐는 만들지 않는다 (개인용 1기기, 비용 대비 효용 낮음)
- `@react-native-community/netinfo`로 온라인 상태를 Zustand에 보관

### 1-10. `/debug` 확장

Stage 0의 디버그 화면에 추가:
```
[테스트 일정 10건 생성]
[전체 events 덤프 (JSON)]
[캐시 상태 / 온라인 여부]
[시각 변환 테스트 — 종일 일정 3개 시간대 비교]
[스키마 버전 확인]
```

---

## 2. 검증

| # | 항목 | 통과 기준 |
|---|---|---|
| 1 | 매직링크 로그인 → 딥링크 복귀 | 세션 유지, 앱 재시작 후에도 로그인 상태 |
| 2 | 일정 생성/수정/삭제 | debug 덤프에 반영 |
| 3 | soft delete | `deleted_at` 세팅, 조회에서 제외, 물리 삭제 안 됨 |
| 4 | RLS | 다른 user_id 행이 조회되지 않음 (SQL로 직접 확인) |
| 5 | **종일 일정 하루 밀림** | 기기 시간대를 뉴욕으로 바꿔도 날짜 동일 |
| 6 | 오프라인 읽기 | 비행기 모드에서 앱 재시작 → 일정 보임 |
| 7 | 오프라인 쓰기 차단 | 명확한 안내 표시 |
| 8 | 낙관적 업데이트 | 생성 즉시 UI 반영, 실패 시 롤백 |
| 9 | 시딩 | 카테고리 4개 + 교시 프리셋 존재 |

**5번이 이 스테이지의 핵심 검증이다.**

---

## 3. DoD

- [ ] 마이그레이션 파일 3개로 스키마 전체가 재현됨 (DB를 날리고 다시 올려서 확인)
- [ ] RLS 켜진 상태로 모든 기능 동작
- [ ] `src/domain/`에 RN·Supabase 의존이 전혀 없음 (린트 통과)
- [ ] `mappers.ts` 단위 테스트 통과
- [ ] `time.ts` 3개 시간대 테스트 통과
- [ ] 검증 항목 9개 전부 통과
- [ ] `docs/ARCHITECTURE.md`에 스키마 다이어그램과 타입 매핑 규칙 기록

---

## 4. 사용자에게 물어야 할 것

1. Supabase 프로젝트를 새로 만들지, 기존 것을 쓸지
2. 매직링크에 쓸 이메일 주소
3. 광운대 교시 시간표 (1교시~N교시 시작·종료 시각) — 시딩에 필요

---

## 5. 다음으로 넘길 항목

- 반복 일정 전개 (Stage 5) — `rrule` 컬럼은 만들었으나 사용 안 함
- `reminders` 실제 연결 (Stage 3)
- `focus_sessions` 사용 (Stage 6)
