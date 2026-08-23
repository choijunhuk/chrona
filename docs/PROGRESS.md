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
