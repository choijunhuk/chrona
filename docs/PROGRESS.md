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

## Stage 4~10 — 자율주행 일괄 (2026-08-24)

- 머지 커밋: `c5662ed` (main, GitHub 푸시됨)
- 브랜치 체인: stage-4-tasks-home → … → stage-10-web (순차 분기 — stage-10 머지가 전체 포함)
- 테스트 74개 전부 통과 (task 12 / recurrence 9 / rrule-ui 3 / stats 8 추가). 앱 release·웹 vite 빌드 성공
- 스펙 이탈(사유는 ARCHITECTURE): 통계 차트 SVG(Skia 미채택), 위젯 브릿지 파일 기반, 모노레포 루트 유지+별칭 보존, 브리핑 주말 토글 미구현
- 실기기 검증: 자율 검증분(빌드·prebuild 생존·재계산 파이프라인) 완료. 나머지는 사람 검증 체크리스트로 이관

## Stage 11 — 무료 운영 기능 팩 (2026-08-28)

- 머지 커밋: `fb87220` (main)
- 구현 요약: .ics 가져오기(RFC 5545 파서, UNTIL 분리, exclusive DTEND 보정), 자연어 빠른 추가(규칙 기반 한국어 파서 — AI/유료 API 0), 주1회 자동 로컬 백업(2세대), 아침 브리핑(로컬 설정, 자정 앵커 갱신), 점진 볼륨(30초 램프), 시험기간 모드(D-day 3→7일), 웹 월간 뷰(domain monthGrid 재사용). README 신규
- 검증: 테스트 88개(신규 14) / typecheck / lint / 릴리스 APK 빌드·기기 설치 / 웹 빌드 전부 그린
- 배포: Vercel 프로덕션 https://chrona-ebon.vercel.app (prebuilt 정적 — 원격 빌드는 workspace 의존성으로 불가)
- 미결: Supabase Redirect URL에 배포 도메인 추가(사용자), 빠른 추가·아침 브리핑·점진 볼륨 실기기 검증, 기존 이월 항목(Doze 65분, 스누즈 소진, 알람음 교체)
- 발견한 함정: ① 루트 tsconfig `include: **/*.ts`가 web/을 삼켜 typecheck 오염 — exclude 필수 ② Vercel 원격 빌드는 상위 폴더 workspace 참조 불가 — `--prebuilt`(Build Output API)로 우회 ③ vercel.json `buildCommand: null`은 프레임워크 감지에 덮임

## Stage 12 — 약속 잡기 (when2meet, 2026-08-28)

- 머지 커밋: `777ba35` (main)
- 구현 요약: meet_polls/meet_responses(주최자 전용 RLS) + 익명 security definer RPC 2개(meet_get_poll/meet_submit_response — search_path='', public revoke, 이름·슬롯·인원 캡), domain/meet(슬롯·히트맵·최적슬롯, 테스트 4), 앱 /meet(생성·날짜칩·시간범위·공유시트·현황·확정→일정 생성), 웹 #/meet/<token>(로그인 게이트 앞, 이름+드래그 페인팅 그리드+히트맵, 주최자 확정 패널)
- 검증: 테스트 92개 그린 / typecheck / lint / 익명 RPC curl 왕복 / RLS 직접 접근 차단 / 웹 프로덕션 실링크 렌더 / APK 기기 설치 / 웹 배포
- 미결: 실사용 검증(친구 응답 시나리오), 슬롯 키 벽시계 규약 문서만 — 해외 참여자 tz 표시(YAGNI)
- 발견한 함정: ① supabase CLI 미링크 시 psql 세션 풀러(aws-0-ap-northeast-2)로 마이그레이션 적용 가능 ② database.types.ts 수기 갱신 — 다음 `pnpm types` 재생성 시 meet 테이블 대조 필수 ③ security definer 함수는 search_path 고정 + execute revoke 없으면 공격면

## Stage 13 — 알람 제어·안정화 (2026-09-02)

- 브랜치: `stage-13-alarm-control` (머지 대기)
- 계기: 사용자 "알람 끄는 기능이 없다" → 전체 점검. 알람 알림에 액션 버튼 0, 알림 탭 무반응(PRESS 미처리), 뒤로가기 시 소리 지속, 해제 후 /debug 착지가 근본 원인
- 구현 요약: 알림 해제/스누즈 액션(headless 처리), PRESS→/alarm-ring, BackHandler=해제, 자동 종료(기본 10분)+길게 눌러 해제 폴백, 스누즈 재계산 생존(`snooze:` id), 방해금지(quietUntil + 도메인 `applyAlarmFilters` + quiet 앵커), 이번만 건너뛰기(홈 칩, skippedAlarmKeys), 알람음 4종 생성+채널 분리+무음(진동), 리마인더별 enabled/사운드, 설정 6종(방해금지·모든 알람 끄기·기본음·스누즈 간격/횟수·자동 종료), 편집기 검증(빈 제목/종료<시작), 시간표 수업 편집 시 kind 보존, 시간표 일괄 토글 비파괴화, 알람 삭제 확인+낙관적 토글, reminders diff upsert, display 종일 반복 newStart 버그, `restore_backup` RPC 단일 트랜잭션 복원, 자동 백업 SAF 폴더 복사+앱 내 복원, meet client_key(이름 충돌 방지)+길이 캡, 웹 포인터 이벤트(터치)+모바일 레이아웃+Meet 코드 분할(참여자 552→494KB), CI 워크플로우, `pnpm verify`
- 검증: 테스트 121개(신규 29) / typecheck / lint / 웹 빌드 그린. 0006 마이그레이션 드라이런(롤백) 통과
- 머지 커밋: `2c30e66` (main, 푸시됨). 0006 DB 적용 완료(사용자 psql), 웹 프로덕션 배포 완료, 익명 RPC name_taken 409 왕복 확인
- 실기기 검증 (SM-S928N, 2026-09-03 새벽): ① 포그라운드 발화 → /alarm-ring warm 오픈 ✓ ② 뒤로가기 → 소리·FGS·알림 전부 정지 ✓ ③ 앱 백그라운드+화면 켜짐 → 헤드업(삼성 캡슐) + 펼치면 해제/스누즈 5분 버튼 ✓ ④ 알림 해제 버튼 → 앱 안 열고 정지 ✓ ⑤ headless 자동 종료(10분) — 아래 함정 ⑤ 계기로 추가, 검증 결과는 다음 항목
- 미결: 방해금지·건너뛰기·알람음 4종 청취·SAF 폴더·자동 백업 복원·스누즈 생존 실기기 확인. 웹 터치는 구조 검증만 — 실폰 확인 필요. expo-audio 재생이 USAGE_MEDIA 스트림 — 무음 모드에서 앱 자체 사운드가 죽을 수 있음(채널 사운드는 별도) → 알람 스트림 지정 검토
- 발견한 함정: ① 리마인더에 스누즈 액션 주면 snoozeAlarm이 SET_ALARM_CLOCK 알람으로 승격 — 리마인더는 해제만 ② 웹 셀별 pointerdown은 implicit capture 때문에 형제 셀 enter 안 옴 — 컨테이너 캡처 + elementFromPoint ③ `Alert.alert`는 버튼 3개 제한 — 선택지 5개는 Modal 시트 ④ opus 세션 한도(429)로 서브에이전트 3개 중단 — SendMessage로 컨텍스트 유지 재개 가능 ⑤ **알림 권한 NONE 상태에서 알람 발화 시 UI 0 + 무한 울림** → 사용자가 앱 삭제로 끔(재설치 uid 변경으로 확인). 자동 종료가 /alarm-ring 화면에만 있었음 → headless `timeout:<id>` 트리거로 이전(42bcbb4) ⑥ `adb install -r`은 데이터 유지하지만 앱이 삭제돼 있으면 로그인·알림 권한·배터리 설정 전부 초기화 — `pm grant POST_NOTIFICATIONS` + `appops set USE_FULL_SCREEN_INTENT allow` + `deviceidle whitelist +`로 복구 가능 ⑦ 앱 로그인 직후 첫 재계산은 세션 전 조회라 0건 — 포그라운드 재진입 시 정상(26건) ⑧ **Notifee ForegroundService는 manifest에 `foregroundServiceType="shortService"`** — Android 14+에서 3분 지나면 `Short FGS ANR'ed` → 앱 강제 종료("앱 종료됨" 다이얼로그). 3분 넘게 울린 알람이 앱을 죽이고 있었음. config plugin이 `mediaPlayback`으로 tools:replace + 알림에 `foregroundServiceTypes` 지정(c0e48c7). 실기기 FGS types=0x2 확인

## Stage 14 — 알람 스트림 네이티브 재생 + 벨소리 피커 (2026-09-03)

- 커밋: `cf1ea1b` (main 직접, 푸시됨)
- 계기: rusty-alarm(사용자 자작) 비교 → Chrona 알람음이 expo-audio `USAGE_MEDIA` + Notifee 채널 `USAGE_NOTIFICATION` → **무음/진동 모드에서 둘 다 안 울림**
- 구현 요약: Kotlin `ChronaAlarmSoundModule` (MediaPlayer `USAGE_ALARM`, STREAM_ALARM 최대 강제·복원, `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE`, 웨이크락 15분, 램프, 미리듣기, `RingtoneManager` TYPE_ALARM 목록) · alarm.ts가 네이티브로 위임(expo-audio 제거) · `SoundPicker` 공용 컴포넌트(설정 기본음·리마인더별·순수 알람 폼) — 내장 5 + 무음 + 시스템 벨소리 · 설정 "알람 볼륨 %"(로컬) · "알람 예고 N분 전"(순수 알람만, `chrona.prealarm` 저중요도 진동 채널, rusty-alarm PreAlarm 이식) · rescheduler 테스트 +1
- 검증: 테스트 122 / typecheck / lint / 웹 빌드 그린. 실기기(무음 모드): `usage=USAGE_ALARM state:started`, `setStreamVolume(STREAM_ALARM 15)`, 해제 시 정지·복원. 피커에 삼성 벨소리 목록 노출·미리듣기 동작
- 발견한 함정: ① `.gitignore`의 `android/`(슬래시 없음)가 `native/android/`까지 무시 → **위젯 Kotlin 소스가 stage-9부터 한 번도 커밋 안 됨**. 이번에 수정·추적 ② notifee `vibrationPattern`은 0 이하 값 거부 — `[0,250,…]` 불가 ③ 채널 사운드 + 네이티브 재생이 겹침(비무음 폰에서 같은 파일 2중 재생) — stage-0부터 있던 구조, FSI 폴백 목적으로 유지. 거슬리면 채널 sound 제거 검토
- 미결: 실사용에서 채널/네이티브 2중 재생 체감 확인, 알람 예고 실기기 확인, 순수 알람 기존 항목의 알람음 편집 UI 없음(폼에서만 선택)

## Stage 15 — 해제 게이트·기상 프리셋·설정 확장 (2026-09-03)

- 브랜치 / 커밋: 작업 중 (머지 대기)
- 계기: rusty-alarm 대비 부족분 정리 — 순수 알람에 해제 게이트가 없고, 만든 알람을 고칠 수 없고(삭제 후 재생성), 주 시작·시각 표기·기본 알림 모드가 하드코딩
- 구현 요약: `0007_stage15.sql` (`standalone_alarms.challenge` text not null default 'none' + check) · mappers `challenge` 왕복 + `toStandaloneAlarmUpdate` · `useUpdateAlarm`/`useRestoreAlarm`/`useRestoreEvent` · 순수 알람 **편집 UI**(카드 본문 탭 → 프리필 폼, 시각·요일·라벨·알람음·진동·해제 방법) · 기상 프리셋 3종(편안한 기상/지각 방지/강제 기상 — 폼 상태 + 기기 전역 동시 적용, 이미 켜둔 값은 유지) · 되돌리기 스낵바(`undo-store` + 탭 레이아웃 1회 렌더, 6초, 일정·순수 알람 삭제) · 설정 5종 추가(기본 알림 오프셋·기본 알림 모드·주 시작 요일·시각 표기·브리핑 주말 제외) · 도메인 전역 주입(`setTimeFormat`/`setWeekStartsOn`)
- 검증: 테스트 127개(신규 4 — challenge 매핑/레거시 none/insert/부분 update) 그린. 빌드·실기기: 메인 세션에서
- 미결: 0007 DB 적용(사용자 psql), 게이트 실동작·프리셋 체감·되돌리기 실기기 확인
- 발견한 함정: ① 되돌리기 UI를 삭제한 화면 안에 두면 화면이 닫히며 같이 사라진다 — 탭 레이아웃에 한 번만 렌더하고 스토어로 넘긴다 ② 시각 표기 변경은 화면만 다시 그려선 부족 — 알람 payload의 라벨은 예약 시점에 굳으므로 재계산 필요 ③ 프리셋이 계정 전역(스누즈 한도)까지 건드리면 알람 하나 고르다 다른 알람이 바뀐다 — 기기 로컬 값만 조정
