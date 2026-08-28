# Chrona

개인용 **캘린더 + 알람시계 하이브리드** 안드로이드 앱.

일반 캘린더의 "조용한 푸시"가 아니라, **끌 때까지 울리는 진짜 알람**을 일정에 붙일 수 있다.
삼성(One UI) 실기기 1대를 타겟으로 하며, Google Play에 출시하지 않고 APK를 직접 설치한다.

<p>
  <b>앱</b>: Expo (dev client) + React Native &nbsp;·&nbsp;
  <b>웹</b>: Vite + React &nbsp;·&nbsp;
  <b>백엔드</b>: Supabase
</p>

---

## 주요 기능

- **알람 모드 일정 알림** — 전체화면 알람(`fullScreenAction`) + `SET_ALARM_CLOCK`, 앱이 완전히 종료돼도 울린다. 밀어서 해제 / 탭해서 스누즈(5분 × 최대 3회)
- **캘린더** — 월간 ↔ 주간 드래그 전환(Reanimated worklet), 반복 일정(rrule) + 회차별 예외(휴강 처리)
- **시간표** — 요일×교시 격자 드래그 생성, 학기 단위 관리·복사, 수업 10분 전 알림 일괄 토글
- **과제 D-day** — 계단식 알림(3일/1일/3시간 전), 홈 화면 D-day 칩
- **순수 알람 탭** — 시계 앱 스타일 반복 알람 (`standalone_alarms`)
- **집중 타이머** — 뽀모도로/커스텀, 포그라운드 서비스 카운트, 상시 알림에 남은 시간 표시
- **잠들기 전 브리핑** — 매일 지정 시각에 내일 일정 요약 알림 (조용한 알림)
- **통계** — 카테고리별 시간 도넛, 계획 vs 실제 집중 막대, 과제 완료율, 연속 집중 일수
- **홈 위젯 2종** — 네이티브 Kotlin `AppWidgetProvider` (오늘 일정 리스트 / 다음 수업+D-day 콤팩트)
- **검색 / 백업** — 제목·메모 검색, JSON 내보내기·가져오기 + `.ics` 내보내기
- **웹 앱** — 주간 뷰, 드래그로 생성·이동·리사이즈. 도메인 로직을 앱과 100% 공유
- 다크/라이트 테마, 햅틱, 스켈레톤 로딩

## 기술 스택

| 영역 | 선택 |
|---|---|
| 앱 프레임워크 | Expo SDK 57 (dev client 필수) + React Native + TypeScript |
| 라우팅 | expo-router (file-based) |
| 알림/알람 | **Notifee** (`expo-notifications` 금지 — 전체화면 알람 불가) |
| 백엔드 | Supabase (Auth + Postgres + RLS) |
| 서버 상태 | TanStack Query + AsyncStorage persist (오프라인 읽기) |
| 로컬 상태 | Zustand |
| 애니메이션 | Reanimated + Gesture Handler (전부 worklet) |
| 날짜/반복 | date-fns + date-fns-tz / rrule (RFC 5545) |
| 웹 | Vite + React (react-native-web 미사용) |
| 테스트 | Vitest (도메인 로직 단위 테스트) |

## 저장소 구조 (pnpm 모노레포)

```
packages/domain/   ★ 순수 TypeScript 도메인 로직. RN import 절대 금지.
                   반복 전개, 알람 시각 산출, 통계 집계, 타입 — 앱·웹이 공유
src/
  data/            Supabase 쿼리, TanStack Query 훅, DB 타입, 매퍼
  native/          Notifee 래퍼, 권한 체크, 알람 재계산, 위젯 브릿지
  ui/              디자인 토큰 / 재사용 컴포넌트 / 화면
app/               expo-router 라우트 (얇게 유지)
native/android/    Kotlin 위젯 소스 (config plugin이 prebuild 시 주입)
plugins/           Expo config plugin (위젯, 권한, 알람음)
web/               @chrona/web — Vite 웹 앱
supabase/          스키마 마이그레이션
docs/              마스터 명세(00-MASTER.md), 스테이지 문서, ARCHITECTURE, PROGRESS
```

## 핵심 설계 제약

자세한 근거는 [`docs/00-MASTER.md`](docs/00-MASTER.md) 참조. 이 넷은 협상 불가:

1. **알람 payload 자급자족** (§3.5) — 알람 예약 시 표시에 필요한 모든 데이터를 알림 payload에 직렬화. `/alarm-ring` 화면은 네트워크·DB 조회 없이 payload만으로 렌더링 (앱 종료 상태 대응)
2. **예약 30건 상한** (§3.6) — 항상 가장 가까운 30건만 예약. 포그라운드 진입·CRUD·부팅·자정 앵커 알람·시간대 변경 시 전체 재계산 (부분 갱신 금지)
3. **배터리** (§6) — 폴링·주기적 백그라운드 작업 없음. AlarmManager 단발 예약만. 포그라운드 서비스는 알람·타이머 동작 중에만 생존
4. **시각 저장** (§7.2) — 시각 있는 일정은 UTC `timestamptz`, 종일 일정은 `date` 타입만 (시차 밀림 방지)

## 시작하기

### 요구 사항

- Node 20+, pnpm
- 안드로이드 실기기 + adb (알람 검증은 에뮬레이터로 불가한 부분이 많음)
- Supabase 프로젝트 (무료 티어)

### 설치

```bash
pnpm install

# 환경 변수
cp .env.example .env              # 앱: SUPABASE_URL, SUPABASE_ANON_KEY
cp web/.env.example web/.env      # 웹: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

# Supabase 스키마 적용 (linked project 기준)
supabase db push
```

### 앱 실행 (dev client 필수 — Expo Go 불가)

```bash
pnpm android          # dev client 빌드 + 설치
pnpm start            # Metro (--dev-client)
```

릴리스 APK:

```bash
cd android && ./gradlew assembleRelease
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

### 웹 실행

```bash
cd web
pnpm dev              # 개발 서버
pnpm build            # tsc -b + vite build
```

### 검증

```bash
pnpm test             # Vitest — 도메인 단위 테스트
pnpm typecheck        # tsc --noEmit (앱)
pnpm lint             # expo lint
pnpm types            # Supabase 타입 재생성 → src/data/database.types.ts
```

앱 내 `/debug` 화면에서 10초 뒤 알람 테스트(3종), 예약 목록 덤프, 권한 상태 조회, 재계산 강제 실행이 가능하다.

### 실기기 알람 체크리스트 (삼성)

삼성 배터리 최적화가 알람을 조용히 죽인다. 온보딩(`/onboarding/permissions`)의 6단계를 모두 통과해야 한다:
알림 권한 → 정확한 알람 → 전체화면 알림 → 배터리 제한 없음 → 미사용 앱 절전 제외 → 자동 최적화 끄기.
앱이 주 1회 자동 재확인하고, 깨졌으면 홈에 경고 배너를 띄운다.

## 문서

- [`docs/00-MASTER.md`](docs/00-MASTER.md) — 마스터 명세 (아키텍처·제약·데이터 모델의 단일 기준)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 스테이지별 누적 아키텍처 결정 기록
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — 진행 로그
- `docs/stage-N-*.md` — 스테이지별 상세 명세 (0: 알람 PoC ~ 10: 웹)

## 라이선스

개인 프로젝트. 라이선스 미지정.
