# Chrona — 진행 기록

각 스테이지 완료 후 Claude Code가 이 파일에 추가한다.

## 형식

```
## Stage N — 제목
- 완료일:
- 브랜치 / 머지 커밋:
- 구현 요약:
- DoD 충족:
- 실기기 검증 결과:
- 미결 / 다음으로 넘긴 것:
- 발견한 함정 (다음 스테이지가 알아야 할 것):
```

---

## Stage 0 — 알람 PoC

- 완료일: 2026-08-23
- 브랜치 / 머지 커밋: `stage-0-alarm-poc` / `2a608e8`
- 구현 요약: Expo SDK 57 + dev client + Notifee. 알람 엔진(`src/native/alarm.ts`, 유일 Notifee 접점), payload 자립(§3.5) 알람 화면, config plugin 매니페스트 주입, 자정 앵커, 부팅 복구, `/debug` 화면. 삼성 실기기(SM-S928N)에서 앱 완전 종료 + 잠금 + 오프라인 상태 전체화면 알람 실증.
- DoD 충족: 9/9 (검증 13개 중 11개 조건부 — 아래 참고)
- 실기기 검증 결과: 11/13 통과. 9(스누즈 소진)·12(Doze 1시간)는 사용자 결정으로 미검증
- 미결 / 다음으로 넘긴 것: Doze 실증(Stage 3), 채널 사운드 간헐 무음 → FGS+ALARM 스트림 직접 재생 교체(Stage 3), 앵커 무음화(Stage 3)
- 발견한 함정: ① FSI는 화면 꺼짐/잠금에서만 액티비티 발동(Android 14+ 정책, 화면 켜짐 = 헤드업만) ② 채널 사운드는 notification 스트림이라 One UI가 간헐적으로 삼킴 ③ RN dev 메뉴가 알람 화면 터치 가로챔 — 실기기 테스트는 release 빌드로 ④ expo config 로더가 로컬 `.ts` plugin 해석 불가 — plugin만 `.js` ⑤ `git merge`는 Claude Code 분류기 차단 — 사용자가 직접 실행

## Stage 1 — 데이터 계층 (Supabase 스키마 + Auth + events CRUD)

- 완료일: 2026-08-24
- 브랜치 / 머지 커밋: `stage-1-data` / `84f2797`
- 구현 요약: 마이그레이션 3개로 전체 스키마(9테이블+RLS+시딩 트리거), 도메인 타입/time.ts(DateOnly), mappers, TanStack Query+persist, 낙관적 CRUD 훅, netinfo 오프라인 정책, 매직링크 인증+딥링크+라우트 가드, debug 데이터 검증 섹션
- DoD 충족: 7/7 — 재현성(드랍 후 재적용 확인), RLS 켠 채 동작, domain 순수성 린트, mappers 테스트 11, time 테스트 14(3TZ), 검증 9개, ARCHITECTURE 기록
- 실기기 검증 결과: 9/9 통과 (SM-S928N). 핵심인 5번(뉴욕 시간대에서 종일 일정 날짜 불변) 통과
- 미결 / 다음으로 넘긴 것: rrule 전개(Stage 5), reminders 연결(Stage 3), focus_sessions(Stage 6), 로그아웃 UI를 /more로 이동(Stage 2), database.types.ts를 gen 산출물로 교체(supabase login 후)
- 발견한 함정: ① Supabase 직접 DB 연결은 IPv6 전용 → 세션 풀러 사용 ② 무료 티어 메일 시간당 2통 → dev-login.sh 우회 ③ adb shell URL의 `#`는 기기 셸 주석 처리 → 전체 인용 필수 ④ auth-callback 라우트 없으면 Unmatched Route ⑤ TanStack onlineManager는 NetInfo에 수동 연결 ⑥ .env는 빌드 시점에 구워짐 — 변경 시 재빌드

## Stage 2 — 캘린더 UI (월↔주 전환 + 디자인 토큰)

- 완료일: 2026-08-24
- 브랜치 / 머지 커밋: `stage-2-calendar-ui` / `1e516ad`
- 구현 요약: 디자인 토큰(다크+라이트)+테마 스위치, Pretendard, 기본 컴포넌트, 월↔주 인터랙티브 전환(단일 Pan 축잠금·전 과정 worklet), 3페이지 캐러셀, 제목 실린 일정 필(연속 일정 주 넘어 이어짐), 3단 시트+타임라인, 일정 편집기(종일 토글 §7.2 강제), 더보기 탭
- DoD 충족: 색상 리터럴 린트 0 ✓ / worklet-only ✓ / 드래그 중 runOnJS 0 ✓ / ARCHITECTURE ✓. 검증 9개 중 6개 통과(1·3·4·5·6·8), 2(GPU 프로파일)·7(오프라인 렌더)·9(포커스 애니 정지)는 사용자 판단으로 생략, 스크린 레코딩 DoD 생략
- 실기기 검증 결과: 스와이프→달 전환 380ms 계측(adb 주입), 연속 필·테마 전환 스크린샷 검증
- 미결 / 다음으로 넘긴 것: 주간 모드 시 필 레이아웃 정밀화, 타임라인 디자인 폴리싱, 검색(추후), 라이트 테마 잔여 폴리싱(Stage 8), **디자인 개선 지속(사용자 요청 — Stage 3부터 각 스테이지에 포함)**
- 발견한 함정: ① withSpring 완료 콜백은 rest 임계값 완화 없이는 수 초 지연 ② persist 복원 시 Date→문자열 (deserialize 리바이버 필수) ③ queryKey 프리픽스 매칭이 상세 쿼리까지 침범 — Array.isArray 가드 ④ zustand persist 미들웨어 Hermes 크래시 ⑤ BottomSheetView 정적 헤더 금지

## Stage 3 — 알람 3종 통합 + 삼성 권한 온보딩

- 완료일: 2026-08-24 (검증 일부 진행 중)
- 브랜치 / 머지 커밋: `stage-3-alarm-integration` / (머지 대기)
- 구현 요약: schedule.ts(30건 산출, override/enabled/종일09:00/task due_at, 테스트 13), 재계산 엔진(전체취소→재예약, 스냅샷 기반 headless, 300ms debounce, 단일비행), 트리거(포그라운드/CRUD/앵커) 배선, FGS 자체 사운드 재생(expo-audio), 편집기 알림 섹션, /alarms 탭, 상시 알림(0004), 권한 온보딩 6종 + 주1회 재확인 + 경고 배너
- 실기기 검증: 자동검증으로 파이프라인(DB→스냅샷→예약→발화) 확인. **치명 버그 발견·수정**: 알람 발화→앱 웨이크→재계산이 울리는 알람을 4초 만에 삭제 (아래 함정 ①)
- 미결: 검증 12(3일 방치), Doze 65분 실증, FSI 발화 재확인 — 자율주행 마지막에 일괄 검사 목록으로
- 발견한 함정: ① **인자 없는 notifee.cancelTriggerNotifications()는 방금 발화해 표시 중인 알림까지 지운다** — pending id에서 displayed 제외하고 취소할 것. 울리는 중 재계산은 30초 지연 ② AppState 'active'는 알람 웨이크에서도 발화 — 재계산 트리거로 쓸 때 위 가드 필수 ③ APK 재설치가 배터리 '제한 없음'을 초기화할 수 있음 — 주1회 재확인 배너가 실제로 잡아냄 (설계 검증)
