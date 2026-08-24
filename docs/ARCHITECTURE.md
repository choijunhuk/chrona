# Chrona — 아키텍처 기록

> 각 스테이지 완료 시 주요 결정·구조를 여기에 누적 기록한다 (마스터 §12).
> 다음 스테이지의 Claude Code 인스턴스는 이 문서만 읽고도 맥락을 파악할 수 있어야 한다.

---

## Stage 0 — 알람 엔진 PoC

### 구조

```
index.js                      진입점. React 밖에서 registerAlarmEngine() 호출
                              (headless 발화 수신에 필수 — expo-router/entry보다 먼저)
src/domain/alarm-payload.ts   AlarmPayload 타입 + serialize/parse (순수 TS, RN 의존 0)
src/domain/time-label.ts      '오후 9:00' 포맷터 (payload에 미리 담기 위함)
src/native/alarm.ts           ★ 유일한 Notifee 접점. 채널/예약/해제/스누즈/앵커/권한조회
src/native/alarm-store.ts     부팅 복구용 AsyncStorage 기록 (Stage 3에서 재계산으로 교체)
plugins/withChronaAlarm.js    매니페스트 권한 8종 + MainActivity 속성 주입
app/_layout.tsx               채널 생성, cold start 알람 라우팅, 포그라운드 알람 구독
app/alarm-ring.tsx            전체화면 알람. payload만으로 렌더 (스토리지/DB/네트워크 0)
app/debug.tsx                 Stage 0 유일 UI. 테스트 버튼 + 권한 조회
```

### 핵심 결정과 이유

**1. payload 자립 (§3.5) 구현 경로**
- 예약 시 `serializeAlarmPayload()`로 알림 `data`에 전 필드 문자열화 (Notifee data는 `Record<string, string>`)
- 앱 종료 상태 발화 → fullScreenAction이 MainActivity cold start → `getInitialNotification()`으로 payload 회수 → `/alarm-ring`에 **라우트 파라미터**로 전달
- 앱 실행 중 발화 → `DELIVERED` 이벤트 → 같은 방식으로 `router.push`
- 두 경로 모두 스토리지 조회 없음

**2. Doze 관통**
- `AlarmType.SET_ALARM_CLOCK` 고정. `SET_EXACT_AND_ALLOW_WHILE_IDLE`로 대체 금지 (리마인더①에만 사용)
- 소리 반복은 `loopSound: true` (Notifee가 FLAG_INSISTENT로 변환 → JS 없이 OS가 반복)

**3. 포그라운드 서비스**
- 알람 알림에 `asForegroundService: true`
- `registerForegroundService(() => new Promise(() => {}))` — 영원히 resolve 안 하는 runner. `stopForegroundService()`로만 종료
- 종료 경로 4개: 해제 / 스누즈 / 스누즈 소진 / 새 알람 덮어쓰기 — 전부 `dismissAlarm()` 또는 `overrideOlderAlarms()` 경유

**4. 알람 충돌 (§3.9)**
- `DELIVERED` 이벤트에서 `chrona.alarm` 채널의 기존 표시 알림을 전부 cancel → 새 알람만 남음

**5. 스누즈 (§3.8)**
- 카운트는 payload에만 존재. 스누즈 = 카운트+1로 새 SET_ALARM_CLOCK 예약
- 소진 상태(count ≥ max)로 울린 알람: 스누즈 버튼 비활성 + **60초 방치 시 자동 해제 + "놓친 알람" 알림** (스펙의 "자동 해제" 해석 — 재검토 여지 있음)

**6. 자정 앵커 (§3.6)**
- LOW 중요도 무음 알림으로 구현. `DELIVERED` 핸들러에서 로그 → 다음 자정 재예약 → 표시된 알림 즉시 cancel
- Stage 3에서 핸들러 내 TODO 위치에 30건 재계산이 들어간다
- 잔상(알림이 잠깐 보임)이 싫으면 Stage 3에서 개선 검토

### 알아둘 함정 / 미결

- **채널은 생성 후 속성 변경 불가.** 커스텀 알람음 4종은 Android 8+에서 채널 속성이므로, Stage 3에서 **사운드별 채널**(`chrona.alarm.alarm_01` 등)이 필요하다. 현재 `chrona.alarm`은 시스템 기본음.
- 사운드 파일 네이밍 확정: `assets/sounds/alarm_01.mp3` ~ `alarm_04.mp3` → plugin이 `res/raw/`로 복사. 무음은 파일 없이 soundKey `none` 처리(추후).
- 전체화면 알림 허용 여부(`canUseFullScreenIntent`)는 Notifee가 API를 안 주므로 수동 확인 안내로 대체.
- Notifee는 재부팅 후 트리거를 자체 복원한다. `alarm-store.ts`는 검증·보험용이며 Stage 3에서 재계산 로직으로 대체.
- config plugin은 `.js`로 유지 — expo config 로더가 로컬 `.ts` 플러그인 import를 해석하지 못함.
- pnpm은 `node-linker=hoisted` (.npmrc) — RN 네이티브 빌드 호환.
- `react-hooks/purity`/`refs` (React Compiler 린트): Reanimated worklet과 이벤트 핸들러에서 오탐 → alarm-ring은 파일 상단에서 `react-hooks/refs` off, debug 화면은 액션을 모듈 레벨로 분리.

### 삼성 실기기 검증 결과 (2026-08-23, SM-S928N / S24 Ultra)

| # | 항목 | 결과 |
|---|---|---|
| 1 | 포그라운드 알람 | ✅ |
| 2 | 백그라운드 알람 | ✅ |
| 3 | 완전 종료 후 알람 (payload 자립) | ✅ |
| 4 | 잠금화면 위 전체화면 | ✅ |
| 5 | 방해금지 관통 (bypassDnd) | ✅ |
| 6 | 해제까지 소리 지속 (loopSound) | ✅ |
| 7 | 해제 후 잔여 없음 | ✅ (초기 버그는 dev 메뉴 간섭이 원인, 재검증 통과) |
| 8 | 스누즈 5분 재발화 + 카운트 | ✅ |
| 9 | 스누즈 3회 소진 → 놓친 알람 | ⏸ 미검증 |
| 10 | 재부팅 후 복구 | ✅ 발화 (소리 간헐 — 아래 참고) |
| 11 | 비행기 모드 (오프라인 증명) | ✅ |
| 12 | Doze 1시간+ | ⏸ 미검증 (사용자 결정으로 스킵. SET_ALARM_CLOCK 사용 중이나 실증 안 됨 — **Stage 3에서 반드시 실증**) |
| 13 | 자정 앵커 발화 + 자기 재예약 | ✅ (로그 2회 확인) |

### 실기기에서 배운 것 (One UI)

- **FSI(전체화면 알림)는 화면 꺼짐/잠금에서만 액티비티를 띄운다** (Android 14+ 정책).
  화면 켜져 있으면 헤드업 + 소리만. 버그 아님 — 알람 앱 UX 설계 시 전제할 것.
- **채널 사운드는 신뢰 불가.** notification 스트림을 타서 One UI가 상황에 따라 소리를 삼킨다
  (재부팅 직후, 첫 발화 웜업 등에서 간헐 무음 관찰).
  → **Stage 3 필수 작업: 포그라운드 서비스에서 USAGE_ALARM 스트림으로 직접 사운드 재생.**
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 권한이 이미 매니페스트에 있음. 시계 앱 표준 방식.
- 자정 앵커(chrona.timer, LOW)가 One UI에서 "띠롱" 알림음을 냄 → Stage 3에서 완전 무음화
  (importance MIN 검토 또는 앵커 알림 즉시 cancel 타이밍 개선).
- RN dev 메뉴(Inspect/Touchables)가 알람 화면 터치를 가로챌 수 있음 — 테스트는 release 빌드로.
- 첫 알람 발화가 수 초 지연될 수 있음 (콜드 웜업). 이후 발화는 즉시. Doze 실증 때 재측정.

---

## Stage 1 — 데이터 계층

### 구조

```
supabase/migrations/
  0001_init.sql        전 테이블(9) + 인덱스(7) + moddatetime 트리거 + §7.2 CHECK 제약
  0002_rls.sql         전 테이블 RLS. 자식(reminders/event_overrides)은 부모 events EXISTS
  0003_seed.sql        auth.users INSERT 트리거(handle_new_user) — 카테고리4/교시7/설정1 자동 시딩
src/domain/            (순수 TS — RN·Supabase·TanStack import 린트로 금지)
  types.ts             도메인 타입 (camelCase, ChronaEvent 등)
  time.ts              DateOnly 브랜디드 타입 + 시각 유틸. 모든 시각 포맷의 유일한 통로
  time.test.ts         Seoul/UTC/NY 3개 시간대 하루밀림·DST 검증 14케이스
src/data/
  supabase.ts          유일한 클라이언트. .env → app.config extra 주입. AppState 기반 토큰 갱신
  database.types.ts    DB 타입 (수기 — 클라우드 information_schema와 대조 완료)
  mappers.ts           Row ↔ 도메인 유일 변환 지점. §7.2 위반 시 throw. 테스트 11케이스
  keys.ts / query.tsx  쿼리 키 팩토리, QueryClient + AsyncStorage persister (24h)
  net.ts               NetInfo → Zustand + TanStack onlineManager. assertOnline() 쓰기 가드
  auth.ts              매직링크 + chrona://auth-callback 딥링크 세션 + useSession
  hooks/               events CRUD(낙관적 업데이트+롤백, soft delete), categories, settings
app/auth.tsx           로그인. app/auth-callback.tsx 복귀 라우트 (없으면 Unmatched Route)
```

### 핵심 결정

- **§7.2 3중 방어**: DB CHECK 제약(종일↔시각 형태 강제) + mappers throw + DateOnly 브랜드 타입.
  종일 일정은 DB('date')→도메인(string)→UI까지 Date 객체로 변환되지 않는다.
- **시딩은 SQL 파일이 아니라 auth 트리거**: user_id가 가입 전 존재하지 않으므로.
  DB를 리셋해도 다음 가입 때 자동 재시딩.
- **타입 2층**: database.types.ts는 src/data/ 밖 반출 금지. 웹(Stage 10)은 domain만 재사용.
- **오프라인**: 읽기 = persist 캐시, 쓰기 = assertOnline 차단+토스트. 쓰기 큐 없음 (1인 1기기).
- **라우트 가드 예외**: /alarm-ring은 세션 없이 접근 가능해야 함 (§3.5 payload 자립).

### 함정 / 노하우 (실검증에서 발견)

- **Supabase 직접 연결(db.*.supabase.co:5432)은 IPv6 전용** — IPv4 네트워크에선
  세션 풀러 `aws-0-ap-northeast-2.pooler.supabase.com:5432` + 유저 `postgres.<ref>` 사용.
- **무료 티어 매직링크 메일 = 시간당 2통.** 개발 중엔 `scripts/dev-login.sh`(gitignore, service_role 포함)로
  admin generate_link → verify → adb 딥링크 주입. **주의: adb shell에 `#` 포함 URL 전달 시
  기기 셸이 주석 처리 — 원격 명령 전체를 따옴표로 감쌀 것.**
- **매직링크 복귀 라우트(app/auth-callback.tsx) 필수** — 없으면 expo-router Unmatched Route.
- **TanStack onlineManager는 RN에서 수동 연결** — NetInfo 리스너에서 setOnline. 안 하면
  오프라인 복귀 후 refetch가 안 일어남.
- supabase gen types는 Docker 또는 access token 필요 → 수기 타입 유지 중.
  스키마 변경 시 information_schema 쿼리로 대조 (또는 `supabase login` 후 pnpm types).
- expo-constants extra는 빌드 시점에 .env를 굽는다 — **.env 변경 시 APK 재빌드 필요.**


---

## Stage 2 — 캘린더 UI

### 구조

```
src/ui/tokens/          colors(다크+라이트)/typography/spacing/radius/motion. 색상 리터럴은 린트로 금지
src/ui/theme.ts         useTheme() — dark/light/system, AsyncStorage 수동 persist
src/ui/components/      AppText(variant/nums)/Surface/Button/Skeleton/ColorDot/haptics
src/domain/calendar.ts  월 격자(항상 6주)/주 계산/한국어 날짜 라벨 — 월요일 시작. 테스트 7
src/ui/screens/calendar/
  calendar-screen.tsx   단일 Pan 축잠금 제스처(접기+페이징), 3페이지 캐러셀, 필 레인 배치
  month-page.tsx        6주 상시 렌더 + 제목 실린 일정 필 레이어(3레인, 주 넘어 이어짐)
  day-sheet.tsx         3단 스냅 시트, 카드 아이템, full=타임라인
  timeline-day.tsx      0~24h 격자, 겹침 가로분할, 현재시각 라인
src/ui/screens/event-editor.tsx  종일 토글 = §7.2 UI 강제. 초기값은 폼 마운트 시 주입(effect setState 회피)
app/(tabs)/             calendar + more(테마 스위치/디버그/로그아웃)
```

### 핵심 결정

- **월↔주 전환**: progress(0~1) shared value 하나로 컨테이너 높이·행 translateY·행 opacity 전부
  interpolate. 6주 그리드 상시 렌더(리마운트 없음), 드래그 중 runOnJS 0회, 스냅 완료 콜백에서 1회.
- **제스처는 단일 Pan + 축 잠금**: Race(세로Pan, 가로Pan) 조합은 첫 프레임 지터로 오판 —
  이동량 12px 이후 |tx| vs |ty|로 축 결정.
- **일정 표기 = 제목 실린 필**: 단일/연속 동일 레인 시스템(주당 3레인), 연속 일정은 주 행을
  가로질러 이어짐. 넘친 일정은 셀에 +N.
- **페이지 시프트**: 스냅 후 데이터 시프트 + translateX 리셋을 useLayoutEffect(커밋 프레임)에서 —
  shiftPage 내 리셋은 1프레임 플래시.
- 라이트 테마를 Stage 8에서 당겨옴 (사용자 요청). 알람 화면·debug는 의도적으로 정적 다크.

### 함정 (실기기에서 발견)

- **withSpring 완료 콜백은 rest 임계값까지 안 불린다**: 기본 임계값(0.01px)이면 화면상 멈춘 뒤에도
  서브픽셀 진동 수 초 → 콜백(=달 전환)이 그만큼 지연. 제스처 스냅엔 `springSnap`
  (restDisplacementThreshold 0.5, restSpeedThreshold 1, overshootClamping) 필수.
- **TanStack persist 복원은 Date를 문자열로 되살린다** → 첫 렌더 .getTime() 크래시.
  persister deserialize에서 ISO(T 포함) 문자열만 Date 리바이브. DateOnly는 문자열 유지 (§7.2).
- **낙관적 업데이트의 queryKey 프리픽스 매칭 주의**: ['events'] 필터가 상세 쿼리(객체)까지 매칭 —
  updater는 Array.isArray 가드 필수 ('iterator method is not callable' 크래시).
- **zustand/middleware persist가 Hermes 릴리즈에서 크래시** → 수동 AsyncStorage hydrate 사용.
- **BottomSheetView는 정적 헤더에 쓰면 접힌다** — 스크롤러블과 섞을 땐 일반 View.
- adb `shell input swipe`로 제스처 재현 + `screencap` 스크린샷으로 UI를 원격 검증 가능
  (화면 꺼져 있으면 input 무시됨 — KEYCODE_WAKEUP 먼저).
- expo config 로더/린트: 이 화면 계열은 react-hooks/immutability·refs 오탐 → 파일 상단 off.
